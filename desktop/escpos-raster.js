/**
 * Receipt printing as an ESC/POS raster image.
 *
 * Thermal printer drivers (Epson TM-T82 etc.) swap Windows fonts for the printer's
 * built-in fonts, which have no Thai glyphs -> "?????" on paper, and the driver path
 * does not send the paper cut command. Here the receipt HTML is rendered by Chromium
 * into a bitmap, converted to 1-bit raster (GS v 0) and sent RAW to the spooler,
 * followed by feed + cut. Thai text then prints exactly as it looks on screen.
 */
const { BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = (...a) => process.env.PURIM_PRINT_DEBUG && console.log('[raster]', ...a);

/**
 * Render HTML to a bitmap exactly `dots` pixels wide.
 * Layout width is 288 CSS px (~76mm), scaled to the printer's dot width.
 */
async function renderHtmlToBitmap(html, { dots = 576, baseURL = 'http://localhost:3000/', layoutWidth = 288 } = {}) {
  const zoom = dots / layoutWidth;
  const win = new BrowserWindow({
    show: false,
    width: dots,
    height: 1200,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      javascript: true,
    },
  });
  let tmpDir = null;
  try {
    win.webContents.setFrameRate(10);
    // Load from a temp file (data: URLs with a base URL fail on some setups);
    // a <base> tag keeps the server's stylesheets/fonts/images resolvable.
    let doc = String(html);
    if (!/<base\s/i.test(doc)) {
      doc = /<head[^>]*>/i.test(doc)
        ? doc.replace(/<head([^>]*)>/i, `<head$1><base href="${baseURL}">`)
        : `<base href="${baseURL}">` + doc;
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purim-render-'));
    const file = path.join(tmpDir, 'receipt.html');
    fs.writeFileSync(file, doc, 'utf8');
    dbg('load');
    await win.loadFile(file).catch((err) => console.warn('[RasterPrint] load warning:', err && err.message));
    dbg('loaded');
    // use the print stylesheet rules (print:hidden, print:border-none ...) like a real print job
    try {
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
    } catch (err) {
      dbg('print media emulation unavailable', err && err.message);
    }
    win.webContents.setZoomFactor(zoom);
    // wait for web fonts (Thai) and images
    await win.webContents
      .executeJavaScript(
        `Promise.race([
           Promise.all([
             document.fonts ? document.fonts.ready : Promise.resolve(),
             ...Array.from(document.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))
           ]),
           new Promise(r => setTimeout(r, 3000))
         ]).then(() => true)`,
        true,
      )
      .catch(() => undefined);
    dbg('fonts ok');
    await sleep(150);
    // real content height (scrollHeight is never smaller than the window itself)
    const cssHeight = await win.webContents.executeJavaScript(
      `(() => { let m = 0; for (const el of document.body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.height > 0) m = Math.max(m, r.bottom + window.scrollY); } return Math.ceil(m + 8); })()`,
      true,
    );
    const height = Math.max(50, Math.min(30000, Math.ceil(cssHeight * zoom)));
    dbg('size', cssHeight, height);
    win.setContentSize(dots, height);
    await sleep(300);
    let image = await win.webContents.capturePage();
    // HiDPI screens may hand back a scaled capture: normalise to the printer width
    dbg('captured', image.getSize());
    if (image.getSize().width !== dots) image = image.resize({ width: dots, quality: 'best' });
    const size = image.getSize();
    const bitmap = Buffer.from(image.toBitmap());
    dbg('bitmap', bitmap.length);
    return { bitmap, width: size.width, height: size.height };
  } finally {
    // close on the next tick: destroying an offscreen window mid-capture can crash Chromium
    setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, 50);
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }
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

const RAW_PRINT_SCRIPT = `param([string]$PrinterName, [string]$FilePath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
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
"@
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
Write-Output ([PurimRawPrint]::Send($PrinterName, $bytes))
`;

/** Send raw bytes to a Windows printer queue (PURIM_RAW_OUT=file writes them to a file instead, for testing). */
function sendRaw(printerName, bytes) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purim-print-'));
    const dataFile = path.join(dir, 'receipt.bin');
    const cleanup = () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    };
    fs.writeFileSync(dataFile, bytes);
    if (process.env.PURIM_RAW_OUT) {
      fs.copyFileSync(dataFile, process.env.PURIM_RAW_OUT);
      cleanup();
      return resolve({ success: true, output: `written to ${process.env.PURIM_RAW_OUT}` });
    }
    if (process.platform !== 'win32') {
      cleanup();
      return resolve({ success: false, error: 'RAW printing is only available on Windows' });
    }
    const scriptFile = path.join(dir, 'raw-print.ps1');
    fs.writeFileSync(scriptFile, '﻿' + RAW_PRINT_SCRIPT, 'utf8');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-PrinterName', printerName, '-FilePath', dataFile],
      { windowsHide: true, timeout: 30000 },
      (err, stdout, stderr) => {
        cleanup();
        const out = String(stdout || '').trim();
        const ok = !err && out.includes('SUCCESS');
        resolve({ success: ok, output: out, error: ok ? undefined : String(stderr || out || (err && err.message) || 'raw print failed').trim() });
      },
    );
  });
}

async function printHtmlAsRaster(html, { printerName, dots = 576, baseURL, cut = true, threshold = 160 } = {}) {
  const started = Date.now();
  const img = await renderHtmlToBitmap(html, { dots, baseURL });
  const bytes = bitmapToEscPos(img.bitmap, img.width, img.height, { cut, threshold });
  const res = await sendRaw(printerName, bytes);
  return { ...res, mode: 'raster', bytes: bytes.length, ms: Date.now() - started, width: img.width, height: img.height };
}

module.exports = { renderHtmlToBitmap, bitmapToEscPos, sendRaw, printHtmlAsRaster };
