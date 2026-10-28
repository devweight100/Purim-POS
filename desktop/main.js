const { app, BrowserWindow, ipcMain, globalShortcut, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

let mainWindow = null;

// Persistent configuration path in userData
const configPath = path.join(app.getPath('userData'), 'purim-pos-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(data);
      // Migrate obsolete hardcoded dev IP (192.168.1.131)
      if (parsed.serverUrl && parsed.serverUrl.includes('192.168.1.131')) {
        parsed.serverUrl = 'http://localhost:3000';
        saveConfig(parsed);
      }
      return parsed;
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return {
    serverUrl: 'http://localhost:3000',
    printerName: '',
    kickMethod: 'auto'
  };
}

function saveConfig(updates) {
  try {
    const current = loadConfig();
    const next = { ...current, ...updates };
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (err) {
    console.error('Error saving config:', err);
    return loadConfig();
  }
}

// Check if a URL responds to /pos or /api/health within a short timeout
function checkServerPos(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    try {
      const clean = (url || '').trim().replace(/\/+$/, '');
      if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        return resolve({ ok: false, error: 'URL ไม่ถูกต้อง' });
      }
      const parsed = new URL(clean);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: '/pos',
        method: 'GET',
        timeout: timeoutMs
      }, (res) => {
        resolve({
          ok: res.statusCode === 200 || res.statusCode === 307 || res.statusCode === 308,
          status: res.statusCode
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'หมดเวลาเชื่อมต่อ (Timeout)' });
      });
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

// Get non-internal IPv4 addresses of this machine
function getLocalIps() {
  const ifaces = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(ifaces)) {
    for (const item of ifaces[name]) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254')) {
        list.push(item.address);
      }
    }
  }
  return list;
}

// Concurrently scan local subnet /24 on port 3000 to find any Purim POS server
async function scanSubnetForServer(port = 3000) {
  const ips = getLocalIps();
  const found = [];

  // Check localhost first (50ms)
  const localCheck = await checkServerPos(`http://localhost:${port}`, 600);
  if (localCheck.ok) found.push(`http://localhost:${port}`);

  // Check machine's own IP next (50ms)
  for (const ip of ips) {
    const check = await checkServerPos(`http://${ip}:${port}`, 600);
    if (check.ok && !found.includes(`http://${ip}:${port}`)) {
      found.push(`http://${ip}:${port}`);
    }
  }
  if (found.length > 0) return found;

  // Scan /24 subnets in batches of 30 hosts
  for (const localIp of ips) {
    const parts = localIp.split('.');
    if (parts.length !== 4) continue;
    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const allHosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
    const batchSize = 30;

    for (let i = 0; i < allHosts.length; i += batchSize) {
      const batch = allHosts.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (host) => {
          const res = await checkServerPos(`http://${host}:${port}`, 400);
          return res.ok ? `http://${host}:${port}` : null;
        })
      );
      for (const hit of results) {
        if (hit && !found.includes(hit)) found.push(hit);
      }
      if (found.length > 0) return found;
    }
  }
  return found;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'ร้านปุริม POS',
    backgroundColor: '#0f172a',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Allow loading LAN resources
    }
  });

  mainWindow.maximize();

  // Load connection screen immediately as splash / auto-detect
  loadConnectScreen();
  autoConnectOrShowScreen();

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.warn(`Page load failed (${errorCode}: ${errorDescription}), falling back to connect screen...`);
    loadConnectScreen();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Probing candidate servers on startup without hanging
async function autoConnectOrShowScreen() {
  if (!mainWindow) return;

  const config = loadConfig();
  const candidateUrls = [];

  // Priority 1: localhost (fastest, for single-PC setups)
  candidateUrls.push('http://localhost:3000');

  // Priority 2: configured serverUrl (if not localhost)
  if (config.serverUrl && !candidateUrls.includes(config.serverUrl)) {
    candidateUrls.push(config.serverUrl);
  }

  // Priority 3: machine's own LAN IPs
  for (const ip of getLocalIps()) {
    const u = `http://${ip}:3000`;
    if (!candidateUrls.includes(u)) {
      candidateUrls.push(u);
    }
  }

  // Test candidates sequentially with quick timeout
  for (const url of candidateUrls) {
    const res = await checkServerPos(url, 1000);
    if (res.ok) {
      console.log(`[AutoConnect] Active server found at: ${url}`);
      saveConfig({ serverUrl: url });
      loadPosScreen(url);
      return;
    }
  }

  // If no immediate candidate is up, notify connection screen to show manual/scan form
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('connection-failed', {
      localIps: getLocalIps(),
      lastUrl: config.serverUrl || 'http://localhost:3000'
    });
  }
}

function loadPosScreen(customUrl) {
  if (!mainWindow) return;
  const config = loadConfig();
  let base = (customUrl || config.serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const posUrl = `${base}/pos`;
  console.log(`Navigating to POS: ${posUrl}`);
  mainWindow.loadURL(posUrl).catch(() => {
    loadConnectScreen();
  });
}

function loadRouteScreen(route) {
  if (!mainWindow) return;
  const config = loadConfig();
  let base = (config.serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const targetUrl = `${base}${route.startsWith('/') ? route : '/' + route}`;
  console.log(`Navigating to route: ${targetUrl}`);
  mainWindow.loadURL(targetUrl).catch(() => {
    loadConnectScreen();
  });
}

function loadDashboardScreen() {
  loadRouteScreen('/dashboard');
}

function loadConnectScreen() {
  if (!mainWindow) return;
  mainWindow.loadFile(path.join(__dirname, 'connect-server.html'));
}

function setupAppMenu() {
  const template = [
    {
      label: 'ระบบขาย & หลังบ้าน',
      submenu: [
        {
          label: '🛒 หน้าขายหน้าร้าน (POS)',
          accelerator: 'F1',
          click: () => loadPosScreen()
        },
        {
          label: '📊 แดชบอร์ดระบบหลังบ้าน (Dashboard)',
          accelerator: 'F2',
          click: () => loadDashboardScreen()
        },
        { type: 'separator' },
        {
          label: '📦 จัดการสินค้า & ราคา (Products)',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => loadRouteScreen('/products')
        },
        {
          label: '🏢 คลังสินค้า & สต็อก (Inventory)',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => loadRouteScreen('/inventory')
        },
        {
          label: '📋 รายงานยอดขาย & ธุรกิจ (Reports)',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => loadRouteScreen('/reports')
        },
        {
          label: '🚚 จัดซื้อ & ใบสั่งซื้อ PO',
          click: () => loadRouteScreen('/purchase-orders')
        },
        {
          label: '⚙️ ตั้งค่าระบบ (Settings)',
          click: () => loadRouteScreen('/settings')
        },
        {
          label: '🚀 แผงควบคุมเครื่องแม่ (Master Command)',
          click: () => loadRouteScreen('/master-control')
        },
        { type: 'separator' },
        {
          label: 'ออกจากโปรแกรม',
          role: 'quit'
        }
      ]
    },
    {
      label: 'การแสดงผล & เมนู',
      submenu: [
        {
          label: '🔄 รีโหลดหน้าจอ (Reload)',
          accelerator: 'CmdOrCtrl+R',
          click: () => { if (mainWindow) mainWindow.reload(); }
        },
        {
          label: '🖥️ สลับเต็มจอ (Toggle Fullscreen)',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
        { type: 'separator' },
        {
          label: '🌐 ตั้งค่าเชื่อมต่อเซิร์ฟเวอร์ (Server Setup)',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => loadConnectScreen()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────

ipcMain.handle('get-server-url', () => {
  const config = loadConfig();
  return config.serverUrl || 'http://localhost:3000';
});

ipcMain.handle('save-server-url', (event, url) => {
  return saveConfig({ serverUrl: url.trim().replace(/\/+$/, '') });
});

ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('save-config', (event, updates) => {
  return saveConfig(updates);
});

ipcMain.handle('get-local-ips', () => {
  return getLocalIps();
});

ipcMain.handle('scan-network', async () => {
  return await scanSubnetForServer(3000);
});

ipcMain.handle('test-server-url', async (event, url) => {
  return await checkServerPos(url, 3000);
});

ipcMain.handle('load-pos-screen', (event, customUrl) => {
  loadPosScreen(customUrl);
  return true;
});

ipcMain.handle('open-server-config', () => {
  loadConnectScreen();
  return true;
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle('reload-app', () => {
  if (mainWindow) {
    mainWindow.reload();
  }
});

// Hardware: Get installed printers in Windows
ipcMain.handle('get-printers', async () => {
  if (!mainWindow) return [];
  try {
    return await mainWindow.webContents.getPrintersAsync();
  } catch (err) {
    console.error('Error fetching printers:', err);
    return [];
  }
});

// Helper: Smart printer detection
async function resolvePrinterDevice(requestedName) {
  try {
    let printers = [];
    if (mainWindow && mainWindow.webContents) {
      printers = await mainWindow.webContents.getPrintersAsync();
    }
    if (!printers || printers.length === 0) {
      return requestedName || '';
    }

    // 1. If requestedName is specified, check exact or partial match
    if (requestedName && requestedName.trim()) {
      const clean = requestedName.trim().toLowerCase();
      const exact = printers.find(p => p.name.toLowerCase() === clean);
      if (exact) return exact.name;

      const partial = printers.find(p => p.name.toLowerCase().includes(clean));
      if (partial) return partial.name;
    }

    // 2. Look for EPSON TM-T82 or Thermal Receipt printers
    const epsonT82 = printers.find(p => {
      const n = p.name.toLowerCase();
      return (n.includes('epson') && (n.includes('t82') || n.includes('tm-'))) ||
             (n.includes('t82') && n.includes('receipt'));
    });
    if (epsonT82) return epsonT82.name;

    // 3. Any EPSON printer
    const epson = printers.find(p => p.name.toLowerCase().includes('epson'));
    if (epson) return epson.name;

    // 4. Any Receipt / Thermal / POS printer
    const receipt = printers.find(p => {
      const n = p.name.toLowerCase();
      return n.includes('receipt') || n.includes('thermal') || n.includes('pos') || n.includes('slip');
    });
    if (receipt) return receipt.name;

    // 5. Windows Default printer
    const def = printers.find(p => p.isDefault);
    if (def) return def.name;

    return printers[0]?.name || requestedName || '';
  } catch (e) {
    console.warn('Error resolving printer device:', e);
    return requestedName || '';
  }
}

// Embedded PowerShell script to guarantee execution even outside unpacked directories
const EMBEDDED_KICK_SCRIPT = `[CmdletBinding()]
param (
    [Parameter(Mandatory=$false)]
    [AllowEmptyString()]
    [string]$PrinterName = ""
)

$printers = Get-CimInstance Win32_Printer
$chosenPrinter = $null

if ($PrinterName -and $PrinterName.Trim() -ne "") {
    $cleanName = $PrinterName.Trim()
    $chosenPrinter = $printers | Where-Object { $_.Name -eq $cleanName } | Select-Object -First 1
    if (-not $chosenPrinter) {
        $chosenPrinter = $printers | Where-Object { $_.Name -like "*$cleanName*" } | Select-Object -First 1
    }
}

if (-not $chosenPrinter) {
    $chosenPrinter = $printers | Where-Object { 
        $_.Name -like "*EPSON*" -or 
        $_.Name -like "*TM-*" -or 
        $_.Name -like "*T82*" -or 
        $_.Name -like "*Receipt*" -or 
        $_.Name -like "*POS*" -or 
        $_.Name -like "*Thermal*" -or
        $_.Name -like "*Slip*"
    } | Select-Object -First 1
}

if (-not $chosenPrinter) {
    $chosenPrinter = $printers | Where-Object { $_.Default -eq $true } | Select-Object -First 1
}

if (-not $chosenPrinter -and $printers.Count -gt 0) {
    $chosenPrinter = $printers[0]
}

if (-not $chosenPrinter) {
    Write-Error "No printer found on Windows."
    exit 1
}

$targetDevice = $chosenPrinter.Name

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytes(string szPrinterName, byte[] bytes) {
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "PurimPOS Cash Drawer Kick";
        di.pDataType = "RAW";
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            bool success = false;
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int dwWritten = 0;
                    success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
            return success;
        }
        return false;
    }
}
"@

# Standard pure ESC/POS kick pulses with 100ms ON duration for Pin 2 and Pin 5 (NO Line Feed 0x0A to eliminate paper feed)
[byte[]]$kickCodes = @(
    0x1B, 0x70, 0x00, 0x32, 0x78,
    0x1B, 0x70, 0x01, 0x32, 0x78
)

try {
    $res = [RawPrinterHelper]::SendBytes($targetDevice, $kickCodes)
    if ($res) {
        Write-Output "SUCCESS: Drawer kick pulse sent to [$targetDevice]"
        exit 0
    } else {
        Write-Error "FAILED: Winspool SendBytes returned false for [$targetDevice]"
        exit 1
    }
} catch {
    Write-Error "ERROR: $_"
    exit 1
}
`;

function getKickExePath() {
  const directPath = path.join(__dirname, 'kick-drawer.exe');
  if (fs.existsSync(directPath) && !directPath.includes('app.asar')) {
    return directPath;
  }
  const unpackedPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'kick-drawer.exe');
  if (fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }
  return null;
}

function getKickScriptPath() {
  const tempPath = path.join(app.getPath('temp'), 'purim-pos-kick-drawer.ps1');
  try {
    const directPath = path.join(__dirname, 'kick-drawer.ps1');
    if (fs.existsSync(directPath) && !directPath.includes('app.asar')) {
      return directPath;
    }
    const unpackedPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'kick-drawer.ps1');
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
    fs.writeFileSync(tempPath, EMBEDDED_KICK_SCRIPT, 'utf8');
    return tempPath;
  } catch (err) {
    console.error('Error finding unpacked script, falling back to temp file:', err);
    try {
      fs.writeFileSync(tempPath, EMBEDDED_KICK_SCRIPT, 'utf8');
      return tempPath;
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Kick Methods: Raw Spooler (ESC/POS) & Epson APD Control Font
// ─────────────────────────────────────────────────────────────

function kickViaRawSpooler(targetPrinter) {
  return new Promise((resolve) => {
    try {
      const { execFile } = require('child_process');

      // 1. FAST PATH: Use compiled C# native utility (Takes <100ms, ZERO lag!)
      const kickExe = getKickExePath();
      if (kickExe) {
        console.log(`[RawSpoolerKick] Using ultra-fast native exe: ${kickExe}`);
        return execFile(kickExe, [targetPrinter], { windowsHide: true }, (err, stdout, stderr) => {
          const outText = (stdout || '').trim();
          const errText = (stderr || '').trim();
          console.log(`[NativeExeKick] output: ${outText} ${errText}`);
          const isSuccess = !err && outText.includes('SUCCESS');
          resolve({
            success: isSuccess,
            output: outText,
            error: isSuccess ? undefined : (errText || err?.message || 'Native kick failed')
          });
        });
      }

      // 2. FALLBACK PATH: PowerShell script
      const psScript = getKickScriptPath();
      if (!psScript) {
        return resolve({ success: false, error: 'ไม่พบสคริปต์คำสั่งเปิดลิ้นชัก (kick script)' });
      }

      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript];
      if (targetPrinter) {
        args.push('-PrinterName', targetPrinter);
      }

      execFile('powershell.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
        const outText = (stdout || '').trim();
        const errText = (stderr || '').trim();
        console.log(`[RawSpoolerKick] output: ${outText} ${errText}`);
        const isSuccess = !err && (outText.includes('SUCCESS') || outText.includes('True'));
        resolve({
          success: isSuccess,
          output: outText,
          error: isSuccess ? undefined : (errText || err?.message || 'Winspool failed')
        });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

function kickViaEpsonFont(targetPrinter) {
  return new Promise((resolve) => {
    let printWin = null;
    try {
      printWin = new BrowserWindow({
        show: false,
        width: 100,
        height: 100,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false
        }
      });

      // Epson APD built-in device font "Control" (or "FontControl")
      // Character 'A' = Kick Drawer 1 (pin 2 pulse)
      // Character 'a' = Kick Drawer 2 (pin 5 pulse)
      // Character 'B' = Drawer 1 without feed
      const kickHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@page { size: 80mm 50mm; margin: 0; }
body { margin: 0; padding: 0; font-family: 'Control', 'FontControl', sans-serif; font-size: 10pt; line-height: 1; }
</style>
</head>
<body>A</body>
</html>`;

      const timer = setTimeout(() => {
        if (printWin && !printWin.isDestroyed()) {
          printWin.close();
        }
        resolve({ success: false, failureReason: 'Timeout waiting for printer driver (5s)' });
      }, 5000);

      printWin.webContents.on('did-finish-load', () => {
        printWin.webContents.print({
          silent: true,
          deviceName: targetPrinter,
          margins: { marginType: 'none' }
        }, (success, failureReason) => {
          clearTimeout(timer);
          if (printWin && !printWin.isDestroyed()) {
            printWin.close();
          }
          console.log(`[EpsonFontKick] Print to [${targetPrinter}]: success=${success}, reason=${failureReason}`);
          resolve({ success, failureReason });
        });
      });

      printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(kickHtml)}`);
    } catch (err) {
      if (printWin && !printWin.isDestroyed()) {
        printWin.close();
      }
      console.error('[EpsonFontKick] Error:', err);
      resolve({ success: false, failureReason: err.message });
    }
  });
}

// Hardware: 100% Silent Direct Print to Epson TM-T82 without any popup dialog
ipcMain.handle('print-silent', async (event, { html, printerName }) => {
  return new Promise(async (resolve) => {
    let printWin = null;
    try {
      const isA4 = html.includes('a4') || html.includes('A4') || html.includes('210mm');
      // 302px exactly equals 80mm at 96 DPI, preventing thermal roll shrinkage
      const winWidth = isA4 ? 794 : 302;

      printWin = new BrowserWindow({
        show: false,
        width: winWidth,
        height: 900,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false
        }
      });

      const config = loadConfig();
      const serverBase = config.serverUrl ? config.serverUrl.replace(/\/+$/, '') : 'http://192.168.1.131:3000';
      const targetPrinter = await resolvePrinterDevice(printerName || config.printerName);

      printWin.webContents.on('did-finish-load', () => {
        const printOptions = {
          silent: true,
          printBackground: true,
          deviceName: targetPrinter,
          margins: {
            marginType: 'none'
          }
        };

        // Explicit 80mm thermal roll sizing for receipt printers
        if (!isA4) {
          printOptions.pageSize = {
            width: 80000,   // 80mm in microns
            height: 300000  // continuous thermal roll
          };
        }

        printWin.webContents.print(printOptions, (success, failureReason) => {
          if (printWin && !printWin.isDestroyed()) {
            printWin.close();
          }
          console.log(`Print job to [${targetPrinter}]: success=${success}, reason=${failureReason}`);
          resolve({ success, printer: targetPrinter, failureReason });
        });
      });

      // Load receipt HTML with baseURLForDataURL so styles, fonts, and assets resolve properly
      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
        baseURLForDataURL: `${serverBase}/`
      });
    } catch (err) {
      if (printWin && !printWin.isDestroyed()) {
        printWin.close();
      }
      console.error('Silent print failed:', err);
      resolve({ success: false, failureReason: err.message });
    }
  });
});

// Hardware: Cash Drawer Kick pulse supporting Auto (Dual ESC/POS + Epson APD Font), ESC/POS only, or APD Font only
ipcMain.handle('kick-drawer', async (event, options) => {
  try {
    let reqPrinter = null;
    let method = 'auto'; // 'auto' | 'escpos' | 'epson_font'

    if (typeof options === 'string') {
      reqPrinter = options;
    } else if (options && typeof options === 'object') {
      reqPrinter = options.printerName;
      method = options.method || 'auto';
    }

    const config = loadConfig();
    const targetPrinter = await resolvePrinterDevice(reqPrinter || config.printerName);
    const chosenMethod = method || config.kickMethod || 'auto';
    console.log(`[KickDrawer] Target printer: "${targetPrinter}", method: "${chosenMethod}"`);

    if (!targetPrinter) {
      return { 
        success: false, 
        error: 'ไม่พบเครื่องพิมพ์ที่เชื่อมต่อในระบบ Windows (กรุณาเปิดเครื่องพิมพ์หรือตรวจสอบสาย USB)' 
      };
    }

    let results = {
      printer: targetPrinter,
      method: chosenMethod,
      escposSuccess: false,
      epsonFontSuccess: false,
      output: '',
      error: ''
    };

    // 1. Raw ESC/POS pulse via Windows Spooler (<100ms instant kick)
    if (chosenMethod === 'escpos' || chosenMethod === 'auto') {
      const rawRes = await kickViaRawSpooler(targetPrinter);
      results.escposSuccess = rawRes.success;
      results.output += `[Raw ESC/POS: ${rawRes.success ? 'สำเร็จ' : 'ไม่สำเร็จ'}] `;
      if (rawRes.error) results.error = rawRes.error;

      // If raw ESC/POS succeeded, return immediately for zero delay and no unnecessary font print!
      if (rawRes.success) {
        return {
          success: true,
          printer: targetPrinter,
          method: chosenMethod,
          output: results.output.trim()
        };
      }
    }

    // 2. Epson APD Control Font 'A' silent pulse (Official Epson driver fallback method)
    if (chosenMethod === 'epson_font' || (chosenMethod === 'auto' && !results.escposSuccess)) {
      const fontRes = await kickViaEpsonFont(targetPrinter);
      results.epsonFontSuccess = fontRes.success;
      results.output += `[Epson Driver Font: ${fontRes.success ? 'สำเร็จ' : 'ไม่สำเร็จ'}] `;
      if (!results.error && fontRes.failureReason) results.error = fontRes.failureReason;
    }

    const overallSuccess = (chosenMethod === 'auto')
      ? (results.escposSuccess || results.epsonFontSuccess)
      : (chosenMethod === 'escpos' ? results.escposSuccess : results.epsonFontSuccess);

    return {
      success: overallSuccess,
      printer: targetPrinter,
      method: chosenMethod,
      output: results.output.trim(),
      error: overallSuccess ? undefined : results.error
    };
  } catch (err) {
    console.error('[KickDrawer] Unexpected error:', err);
    return { success: false, error: err.message };
  }
});

// ─────────────────────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  setupAppMenu();
  createWindow();

  // Register Global Shortcuts:
  // F1 -> Go to POS screen
  globalShortcut.register('F1', () => {
    loadPosScreen();
  });

  // F2 -> Go to Back-office / Dashboard
  globalShortcut.register('F2', () => {
    loadDashboardScreen();
  });

  // F11 -> Fullscreen toggle
  globalShortcut.register('F11', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  // Ctrl+Shift+S -> Server Connection Setup Dialog
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    loadConnectScreen();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
