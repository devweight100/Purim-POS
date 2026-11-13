import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';

/** What the page asked the desktop app to print (window.electronAPI.printSilent). */
export interface CapturedPrint {
  html: string;
  format?: string;
  printerName?: string;
  showDialog?: boolean;
}

/**
 * Desktop bridge stub: records every print job instead of printing. Install with
 * `page.addInitScript(ELECTRON_STUB)` before the app loads.
 */
export const ELECTRON_STUB = () => {
  const w = window as unknown as { __prints: unknown[]; electronAPI: unknown };
  w.__prints = [];
  w.electronAPI = {
    isDesktop: true,
    printSilent: async (o: unknown) => {
      w.__prints.push(o);
      return { success: true };
    },
    kickDrawer: async () => ({ success: true }),
    getAppVersion: async () => '1.5.0',
    saveConfig: async () => ({ success: true }),
  };
};

export async function clearPrints(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __prints: unknown[] }).__prints = [];
  });
}

/** Run `action` and return the print job it caused. */
export async function capturePrint(page: Page, action: () => Promise<unknown>, timeoutMs = 15_000): Promise<CapturedPrint> {
  await clearPrints(page);
  await action();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const jobs = await page.evaluate(() => (window as unknown as { __prints: CapturedPrint[] }).__prints);
    if (jobs.length) return jobs[jobs.length - 1];
    await page.waitForTimeout(150);
  }
  throw new Error('no print job');
}

const SLIP_CSS_WIDTH = 288; // escpos-raster layoutWidth (576 printer dots / zoom 2)

export interface SlipRender {
  png: string;
  png1bit: string;
  cssHeight: number;
  scrollWidth: number;
  text: string;
}

async function loadPrintHtml(page: Page, html: string) {
  await page.emulateMedia({ media: 'print' });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await (document as Document & { fonts: FontFaceSet }).fonts.ready;
  });
  await page.waitForTimeout(100);
}

/**
 * Thermal slip as the desktop app prints it: escpos-raster lays the HTML out 288 CSS px wide with
 * print media, zoomed to 576 dots, and sends a 1-bit image (threshold 160). Saves the screenshot
 * and the 1-bit version (what comes out of the printer); also a PDF of the Windows-driver path
 * (302 px window, 80 mm page).
 */
export async function renderSlip(browser: Browser, html: string, out: string, name: string): Promise<SlipRender> {
  const ctx = await browser.newContext({ viewport: { width: SLIP_CSS_WIDTH, height: 600 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await loadPrintHtml(page, html);
    // same height measurement as escpos-raster
    const cssHeight = await page.evaluate(() => {
      let m = 0;
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) m = Math.max(m, r.bottom + window.scrollY);
      }
      return Math.ceil(m + 8);
    });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const text = await page.evaluate(() => document.body.innerText);
    const png = path.join(out, `${name}.png`);
    await page.setViewportSize({ width: SLIP_CSS_WIDTH, height: Math.max(100, cssHeight) });
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: SLIP_CSS_WIDTH, height: cssHeight } });
    fs.writeFileSync(png, buf);
    // 1-bit like bitmapToEscPos (luminance < 160 -> black dot)
    const png1bit = path.join(out, `${name}-1bit.png`);
    const oneBit = await page.evaluate(async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const a = d.data[i + 3] / 255;
        const lum = (0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]) * a + 255 * (1 - a);
        const v = lum < 160 ? 0 : 255;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png');
    }, `data:image/png;base64,${buf.toString('base64')}`);
    fs.writeFileSync(png1bit, Buffer.from(oneBit.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(out, `${name}.html`), html);
    return { png, png1bit, cssHeight, scrollWidth, text };
  } finally {
    await ctx.close();
  }
}

/** Windows-driver path for slips (printViaDriver: 302 px window, 80 mm wide page). */
export async function renderSlipDriverPdf(browser: Browser, html: string, out: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 302, height: 900 } });
  const page = await ctx.newPage();
  try {
    await loadPrintHtml(page, html);
    const pdf = path.join(out, `${name}-driver.pdf`);
    await page.pdf({ path: pdf, width: '80mm', height: '300mm', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    toPngs(pdf, 100);
    return pdf;
  } finally {
    await ctx.close();
  }
}

/** A4 document as Chromium prints it (printViaDriver: 794 px window, A4). */
export async function renderA4(browser: Browser, html: string, out: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 } });
  const page = await ctx.newPage();
  try {
    await loadPrintHtml(page, html);
    const pdf = path.join(out, `${name}.pdf`);
    await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.join(out, `${name}.html`), html);
    const pages = toPngs(pdf, 70);
    const text = await page.evaluate(() => document.body.innerText);
    return { pdf, pages, text };
  } finally {
    await ctx.close();
  }
}

/** PDF -> PNG per page (pdftoppm); returns the files. */
function toPngs(pdf: string, dpi: number): string[] {
  const prefix = pdf.replace(/\.pdf$/, '');
  try {
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), pdf, prefix]);
  } catch {
    return [];
  }
  const dir = path.dirname(pdf);
  const base = path.basename(prefix);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${base}-`) && /-\d+\.png$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Screenshot of an on-screen preview (dialog content). */
export async function shotPreview(page: Page, selector: string, out: string, name: string) {
  const el = page.locator(selector).first();
  await el.screenshot({ path: path.join(out, `${name}-preview.png`) });
}
