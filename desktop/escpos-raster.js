/**
 * Receipt printing as an ESC/POS raster image.
 *
 * Thermal printer drivers (Epson TM-T82 etc.) swap Windows fonts for the printer's
 * built-in fonts, which have no Thai glyphs -> "?????" on paper, and the driver path
 * does not send the paper cut command. Here the receipt HTML is rendered by Chromium
 * into a bitmap, converted to 1-bit raster (GS v 0) and sent RAW to the spooler,
 * followed by feed + cut. Thai text then prints exactly as it looks on screen.
 *
 * Speed: one hidden render window and one PowerShell print helper (with the winspool
 * code already compiled) stay alive between receipts, so a receipt takes a few hundred ms
 * instead of several seconds. warmUp() prepares both when the app starts.
 */
const { BrowserWindow, app } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbg = (...a) => process.env.PURIM_PRINT_DEBUG && console.log('[raster]', ...a);
const WIN_HEIGHT = 4000; // device px kept ready; longer receipts grow the window

// ---------------------------------------------------------------- timing log (userData/print-log.txt)
function logLine(text) {
  try {
    const file = path.join(app.getPath('userData'), 'print-log.txt');
    try {
      if (fs.statSync(file).size > 200 * 1024) fs.renameSync(file, file + '.old');
    } catch {}
    fs.appendFileSync(file, `${new Date().toISOString()} ${text}${os.EOL}`);
  } catch {}
}

// ---------------------------------------------------------------- reusable render window
let renderWin = null;
let renderQueue = Promise.resolve();
const workDir = path.join(os.tmpdir(), `purim-render-${process.pid}`);

function getRenderWindow(dots) {
  if (renderWin && !renderWin.isDestroyed() && renderWin.__dots === dots) return renderWin;
  if (renderWin && !renderWin.isDestroyed()) {
    const old = renderWin;
    setTimeout(() => !old.isDestroyed() && old.close(), 50);
  }
  const win = new BrowserWindow({
    show: false,
    width: dots,
    height: WIN_HEIGHT,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });
  win.__dots = dots;
  win.webContents.setFrameRate(60);
  try {
    win.webContents.debugger.attach('1.3');
  } catch {}
  win.on('closed', () => {
    if (renderWin === win) renderWin = null;
  });
  renderWin = win;
  return win;
}

const evalJs = (win, code) => win.webContents.executeJavaScript(code, true);
const twoFrames = (win) =>
  evalJs(win, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))').catch(() => undefined);

async function renderOnce(html, { dots, baseURL, layoutWidth }) {
  const zoom = dots / layoutWidth;
  const t0 = Date.now();
  const win = getRenderWindow(dots);
  // Load from a temp file (data: URLs with a base URL fail on some setups);
  // a <base> tag keeps the server's stylesheets/fonts/images resolvable.
  let doc = String(html);
  if (!/<base\s/i.test(doc)) {
    doc = /<head[^>]*>/i.test(doc)
      ? doc.replace(/<head([^>]*)>/i, `<head$1><base href="${baseURL}">`)
      : `<base href="${baseURL}">` + doc;
  }
  fs.mkdirSync(workDir, { recursive: true });
  const file = path.join(workDir, 'receipt.html');
  fs.writeFileSync(file, doc, 'utf8');
  await win.loadFile(file).catch((err) => console.warn('[RasterPrint] load warning:', err && err.message));
  // use the print stylesheet rules (print:hidden, print:border-none ...) like a real print job
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
  } catch (err) {
    dbg('print media emulation unavailable', err && err.message);
  }
  win.webContents.setZoomFactor(zoom);
  // web fonts (Thai) and images; cached after the first receipt
  await evalJs(
    win,
    `Promise.race([
       Promise.all([
         document.fonts ? document.fonts.ready : Promise.resolve(),
         ...Array.from(document.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))
       ]),
       new Promise(r => setTimeout(r, 2500))
     ]).then(() => true)`,
  ).catch(() => undefined);
  const tLoad = Date.now();
  // real content height (scrollHeight is never smaller than the window itself)
  const cssHeight = await evalJs(
    win,
    `(() => { let m = 0; for (const el of document.body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.height > 0) m = Math.max(m, r.bottom + window.scrollY); } return Math.ceil(m + 8); })()`,
  );
  const height = Math.max(50, Math.min(30000, Math.ceil(cssHeight * zoom)));
  const [, winH] = win.getContentSize();
  if (height > winH) win.setContentSize(dots, height);
  await twoFrames(win);
  let image = await win.webContents.capturePage({ x: 0, y: 0, width: dots, height: Math.min(height, Math.max(winH, height)) });
  if (image.isEmpty()) {
    await twoFrames(win);
    image = await win.webContents.capturePage({ x: 0, y: 0, width: dots, height });
  }
  // HiDPI screens may hand back a scaled capture: normalise to the printer width
  if (image.getSize().width !== dots) image = image.resize({ width: dots, quality: 'best' });
  const size = image.getSize();
  const bitmap = Buffer.from(image.toBitmap());
  if (!size.width || !size.height || !bitmap.length) throw new Error('empty capture');
  dbg('render', { load: tLoad - t0, total: Date.now() - t0, height });
  return { bitmap, image, width: size.width, height: size.height, ms: { load: tLoad - t0, render: Date.now() - t0 } };
}

/** Render HTML to a bitmap exactly `dots` pixels wide (layout width 288 CSS px ~ 76mm). */
function renderHtmlToBitmap(html, { dots = 576, baseURL = 'http://localhost:3000/', layoutWidth = 288 } = {}) {
  const job = renderQueue.then(() => renderOnce(html, { dots, baseURL, layoutWidth }));
  renderQueue = job.catch(() => {
    // a broken window is replaced on the next job
    if (renderWin && !renderWin.isDestroyed()) {
      const w = renderWin;
      renderWin = null;
      setTimeout(() => !w.isDestroyed() && w.close(), 50);
    }
  });
  return job;
}

/** Trim blank rows at the bottom of a BGRA bitmap (keeps a small margin). */
function contentHeight(bitmap, width, height, threshold) {
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const a = bitmap[i + 3] / 255;
      const lum = (0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) return Math.min(height, y + 16);
    }
  }
  return height;
}

/** BGRA bitmap -> ESC/POS bytes (init, raster image in bands, feed, cut). */
function bitmapToEscPos(bitmap, width, height, { threshold = 160, cut = true, feedLines = 4 } = {}) {
  const usedHeight = contentHeight(bitmap, width, height, threshold);
  const bytesPerRow = Math.ceil(width / 8);
  const parts = [Buffer.from([0x1b, 0x40])]; // ESC @  initialise
  const BAND = 128;
  for (let y0 = 0; y0 < usedHeight; y0 += BAND) {
    const rows = Math.min(BAND, usedHeight - y0);
    const header = Buffer.from([
      0x1d, 0x76, 0x30, 0x00, // GS v 0 m=0
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      rows & 0xff, (rows >> 8) & 0xff,
    ]);
    const data = Buffer.alloc(bytesPerRow * rows);
    for (let y = 0; y < rows; y++) {
      const src = (y0 + y) * width * 4;
      for (let x = 0; x < width; x++) {
        const i = src + x * 4;
        const a = bitmap[i + 3] / 255;
        const lum = (0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2]) * a + 255 * (1 - a);
        if (lum < threshold) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    parts.push(header, data);
  }
  parts.push(Buffer.from([0x1b, 0x64, feedLines])); // ESC d n  feed n lines
  if (cut) parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // GS V 66 0  feed to cutter + partial cut
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- RAW spooler access (Windows)
const RAW_PRINT_CLASS = `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PurimRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static string Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OpenPrinter failed " + Marshal.GetLastWin32Error();
    try {
      DOCINFOW di = new DOCINFOW(); di.pDocName = "Purim POS Receipt"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) return "StartDocPrinter failed " + Marshal.GetLastWin32Error();
      try {
        StartPagePrinter(h);
        int written;
        bool ok = WritePrinter(h, bytes, bytes.Length, out written);
        EndPagePrinter(h);
        if (!ok || written != bytes.Length) return "WritePrinter failed " + Marshal.GetLastWin32Error();
      } finally { EndDocPrinter(h); }
      return "SUCCESS";
    } finally { ClosePrinter(h); }
  }
}
"@`;

const ONE_SHOT_SCRIPT = `param([string]$PrinterName, [string]$FilePath)
$ErrorActionPreference = 'Stop'
${RAW_PRINT_CLASS}
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
Write-Output ([PurimRawPrint]::Send($PrinterName, $bytes))
`;

// Long-running helper: compiles the winspool class once, then prints one file per stdin line
// ("<base64 printer>\t<base64 file path>") and answers one line ("SUCCESS" or an error).
const HOST_SCRIPT = `$ErrorActionPreference = 'Continue'
${RAW_PRINT_CLASS}
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'EXIT') { break }
  try {
    $parts = $line.Split([char]9)
    $printer = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[0]))
    $file = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
    $res = [PurimRawPrint]::Send($printer, [IO.File]::ReadAllBytes($file))
  } catch { $res = 'ERROR ' + $_.Exception.Message }
  [Console]::Out.WriteLine(($res -replace '[\\r\\n]', ' ')); [Console]::Out.Flush()
}
`;

const powershellExe = () => path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

class RawPrintHost {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.waiters = [];
    this.queue = Promise.resolve();
  }

  start() {
    if (this.proc) return this.ready;
    fs.mkdirSync(workDir, { recursive: true });
    const script = path.join(workDir, 'raw-print-host.ps1');
    fs.writeFileSync(script, '\ufeff' + HOST_SCRIPT, 'utf8');
    const proc = spawn(powershellExe(), ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const w = this.waiters.shift();
        if (w) w(line);
      }
    });
    proc.stderr.on('data', (d) => dbg('host stderr', String(d)));
    const reset = () => {
      if (this.proc === proc) this.proc = null;
      this.ready = null;
      for (const w of this.waiters.splice(0)) w('ERROR print helper exited');
    };
    proc.on('exit', reset);
    proc.on('error', reset);
    this.ready = this.nextLine(20000).then((line) => {
      if (line !== 'READY') throw new Error('print helper did not start: ' + line);
      return true;
    });
    this.ready.catch(() => this.stop());
    return this.ready;
  }

  nextLine(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (line) => {
        if (done) return;
        done = true;
        resolve(line);
      };
      this.waiters.push(finish);
      setTimeout(() => {
        const idx = this.waiters.indexOf(finish);
        if (idx >= 0) this.waiters.splice(idx, 1);
        finish('ERROR timeout');
      }, timeoutMs);
    });
  }

  send(printer, file) {
    const job = this.queue.then(async () => {
      await this.start();
      const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
      const answer = this.nextLine(15000);
      this.proc.stdin.write(`${b64(printer)}\t${b64(file)}\n`);
      const line = await answer;
      if (line === 'ERROR timeout' || line === 'ERROR print helper exited') this.stop();
      return line;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    this.ready = null;
    if (p) {
      try {
        p.stdin.write('EXIT\n');
      } catch {}
      setTimeout(() => {
        try {
          p.kill();
        } catch {}
      }, 500);
    }
  }
}

const host = new RawPrintHost();

function sendRawOneShot(printerName, dataFile) {
  return new Promise((resolve) => {
    const scriptFile = path.join(path.dirname(dataFile), 'raw-print.ps1');
    fs.writeFileSync(scriptFile, '\ufeff' + ONE_SHOT_SCRIPT, 'utf8');
    execFile(
      powershellExe(),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-PrinterName', printerName, '-FilePath', dataFile],
      { windowsHide: true, timeout: 30000 },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        const ok = !err && out.includes('SUCCESS');
        resolve({ success: ok, output: out, error: ok ? undefined : String(stderr || out || (err && err.message) || 'raw print failed').trim() });
      },
    );
  });
}

/** Send raw bytes to a Windows printer queue (PURIM_RAW_OUT=file writes them to a file instead, for testing). */
async function sendRaw(printerName, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purim-print-'));
  const dataFile = path.join(dir, 'receipt.bin');
  const cleanup = () => {
    setTimeout(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }, 5000);
  };
  fs.writeFileSync(dataFile, bytes);
  try {
    if (process.env.PURIM_RAW_OUT) {
      fs.copyFileSync(dataFile, process.env.PURIM_RAW_OUT);
      return { success: true, output: `written to ${process.env.PURIM_RAW_OUT}`, via: 'file' };
    }
    if (process.platform !== 'win32') return { success: false, error: 'RAW printing is only available on Windows' };
    try {
      const line = await host.send(printerName, dataFile);
      if (line === 'SUCCESS') return { success: true, output: line, via: 'host' };
      if (!line.startsWith('ERROR timeout') && !line.startsWith('ERROR print helper')) {
        return { success: false, error: line, via: 'host' };
      }
      dbg('host unavailable, one-shot fallback:', line);
    } catch (err) {
      dbg('host failed, one-shot fallback:', err && err.message);
    }
    return { ...(await sendRawOneShot(printerName, dataFile)), via: 'one-shot' };
  } finally {
    cleanup();
  }
}

/**
 * The slip as a picture for the Windows driver (fallback when RAW printing fails, or
 * receiptPrintMode = "driver"). Thermal drivers swap TrueType text for their built-in fonts,
 * which have no Thai glyphs ("?????"); a picture is printed as it is.
 */
function slipImageHtml(pngBuffer) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: 80mm auto; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
img { display: block; width: 100%; height: auto; }
</style></head><body><img src="data:image/png;base64,${Buffer.from(pngBuffer).toString('base64')}"></body></html>`;
}

/** Render the slip HTML to a PNG (same renderer as the RAW path). */
async function renderSlipPng(html, { dots = 576, baseURL } = {}) {
  const img = await renderHtmlToBitmap(html, { dots, baseURL });
  return img.image.toPNG();
}

async function printHtmlAsRaster(html, { printerName, dots = 576, baseURL, cut = true, threshold = 160 } = {}) {
  const started = Date.now();
  let img;
  try {
    img = await renderHtmlToBitmap(html, { dots, baseURL });
  } catch (err) {
    logLine(`raster RENDER FAIL printer="${printerName}" ${(err && err.message) || err}`);
    return { success: false, error: `render failed: ${(err && err.message) || err}`, mode: 'raster' };
  }
  const t1 = Date.now();
  const bytes = bitmapToEscPos(img.bitmap, img.width, img.height, { cut, threshold });
  const t2 = Date.now();
  const res = await sendRaw(printerName, bytes);
  const t3 = Date.now();
  const ms = { load: img.ms.load, render: t1 - started, encode: t2 - t1, send: t3 - t2, total: t3 - started };
  logLine(`raster ${res.success ? 'OK' : 'FAIL'} printer="${printerName}" via=${res.via || '-'} ${JSON.stringify(ms)} ${res.success ? '' : res.error || ''}`);
  // a failed send keeps the rendered picture, so the driver fallback prints exactly the same slip
  const png = res.success ? undefined : img.image.toPNG();
  return { ...res, mode: 'raster', bytes: bytes.length, ms, width: img.width, height: img.height, png };
}

/** Start the print helper and the render window early so the first receipt is fast too. */
function warmUp({ dots = 576 } = {}) {
  try {
    if (process.platform === 'win32' && !process.env.PURIM_RAW_OUT) {
      host.start().then(
        () => logLine('print helper ready'),
        (err) => logLine('print helper failed to start: ' + (err && err.message)),
      );
    }
    renderHtmlToBitmap('<!DOCTYPE html><html><body><div>warm-up</div></body></html>', { dots }).catch(() => undefined);
  } catch {}
}

function shutdown() {
  host.stop();
}

module.exports = { renderHtmlToBitmap, renderSlipPng, slipImageHtml, bitmapToEscPos, sendRaw, printHtmlAsRaster, warmUp, shutdown, logLine };
