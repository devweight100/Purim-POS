import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import { getCashDrawerConfig } from './cash-drawer-service';
import { getElectronAPI, type ElectronAPI } from './electron-api';

/**
 * Universal Print & PDF Export Utility for Purim POS
 * Guarantees 100% WYSIWYG matching between screen preview and physical print/PDF.
 */

/**
 * Markup of the element to print, without the inline styles that keep an off-screen
 * render container hidden (position:fixed; left:-9999px; opacity:0 ...). Copying those
 * made the printed page blank.
 */
function printableMarkup(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  for (const prop of ['position', 'left', 'top', 'right', 'bottom', 'opacity', 'z-index', 'visibility', 'pointer-events', 'transform']) {
    clone.style.removeProperty(prop);
  }
  return clone.outerHTML || clone.innerHTML;
}

/** true when the document is laid out as explicit A4 sheets (`.a4-page`, one per printed page) */
function isPagedA4(element: HTMLElement): boolean {
  return element.classList.contains('a4-page') || !!element.querySelector('.a4-page');
}

/** Electron: thermal docs go to the receipt printer, A4 docs to the A4 printer (or the system dialog). */
export function electronPrintTarget(format: '80mm' | 'a4'): { printerName?: string; showDialog: boolean } {
  let cfg: ReturnType<typeof getCashDrawerConfig> | null = null;
  try {
    cfg = getCashDrawerConfig();
  } catch {
    cfg = null;
  }
  if (format === 'a4') {
    const a4 = (cfg?.selectedA4Printer || '').trim();
    return a4 ? { printerName: a4, showDialog: false } : { printerName: undefined, showDialog: true };
  }
  return { printerName: cfg?.selectedPrinter || undefined, showDialog: false };
}

/**
 * Baseline for slips when the app stylesheet is not available (e.g. the desktop raster printer):
 * borders are off unless a utility turns them on, so `border-dashed` never draws a box.
 */
const THERMAL_FALLBACK_CSS = `
          *, *::before, *::after { border-width: 0; border-style: solid; }
          .flex { display: flex !important; }
          .flex-col { flex-direction: column !important; }
          .justify-between { justify-content: space-between !important; }
          .justify-center { justify-content: center !important; }
          .items-center { align-items: center !important; }
          .items-start { align-items: flex-start !important; }
          .text-center { text-align: center !important; }
          .text-right { text-align: right !important; }
          .text-left { text-align: left !important; }
          .font-bold { font-weight: 700 !important; }
          .font-black, .font-extrabold { font-weight: 900 !important; }
          .font-semibold { font-weight: 600 !important; }
          .border { border-width: 1px; }
          .border-2 { border-width: 2px; }
          .border-b { border-bottom-width: 1px; }
          .border-b-2 { border-bottom-width: 2px; }
          .border-t { border-top-width: 1px; }
          .border-t-2 { border-top-width: 2px; }
          .border-l-2 { border-left-width: 2px; }
          .border-dashed { border-style: dashed; }
          .border-black { border-color: #000000 !important; }
          .w-full { width: 100% !important; }
          .w-1\\/2 { width: 50% !important; }
          .w-1\\/4 { width: 25% !important; }
          .w-3\\/4 { width: 75% !important; }
          .shrink-0 { flex-shrink: 0 !important; }
          .min-w-0 { min-width: 0 !important; }
          .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .break-words { word-break: break-word; overflow-wrap: anywhere; }
          .whitespace-pre-wrap { white-space: pre-wrap !important; }
          .space-y-0\\.5 > * + * { margin-top: 2px !important; }
          .space-y-1 > * + * { margin-top: 4px !important; }
          .space-y-1\\.5 > * + * { margin-top: 6px !important; }
          .space-y-2 > * + * { margin-top: 8px !important; }
          .py-1 { padding-top: 4px !important; padding-bottom: 4px !important; }
          .pb-1 { padding-bottom: 4px !important; }
          .pt-1 { padding-top: 4px !important; }
          .pl-1 { padding-left: 4px !important; }
          .px-2\\.5 { padding-left: 10px !important; padding-right: 10px !important; }
          .py-0\\.5 { padding-top: 2px !important; padding-bottom: 2px !important; }
          .leading-tight { line-height: 1.25 !important; }
          .tracking-wider { letter-spacing: 0.05em !important; }
          .uppercase { text-transform: uppercase !important; }
          .inline-block { display: inline-block !important; }
`;

export function buildPrintHtml(element: HTMLElement, title: string, format: '80mm' | 'a4' = 'a4'): string {
  const isSlip = format === '80mm';
  const paged = !isSlip && isPagedA4(element);

  // Clone all application stylesheets and <style> tags from parent document with absolute URLs
  const headStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => {
      if (node.tagName === 'LINK') {
        const link = node as HTMLLinkElement;
        return `<link rel="stylesheet" href="${link.href}" />`;
      }
      return node.outerHTML;
    })
    .join('\n');

  // The app's fonts are next/font classes on <body> that define --font-sarabun etc. Without them
  // `font-sans` in the copy resolved to nothing and the paper used another font than the preview.
  const fontVarClasses = typeof document !== 'undefined'
    ? Array.from(document.body.classList).filter((c) => /variable/i.test(c)).join(' ')
    : '';

  const pageSize = isSlip ? '80mm auto' : 'A4 portrait';
  const containerMaxWidth = isSlip ? '100%' : '210mm';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const slipCss = `
          ${THERMAL_FALLBACK_CSS}
          @media print {
            @page { size: 80mm auto; margin: 0mm !important; }
            html, body { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
            .print-wrapper { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
            * { color: #000000 !important; border-color: #000000 !important; text-shadow: none !important; }
          }
          * { color: #000000 !important; border-color: #000000 !important; }
  `;

  // A4: content flows over as many pages as needed - nothing is clipped. Documents built from
  // explicit `.a4-page` sheets get one sheet per printed page; other documents paginate
  // naturally with the table header repeated on every page.
  const a4Css = `
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr, .break-inside-avoid { page-break-inside: avoid; break-inside: avoid; }
          @media print {
            @page { size: A4 portrait; margin: ${paged ? '0' : '10mm 0'}; }
            html, body {
              width: 210mm !important;
              height: auto !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: visible !important;
              background: #ffffff !important;
            }
            .print-wrapper { width: 210mm !important; max-width: 210mm !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
            .a4-preview-stack { display: block !important; gap: 0 !important; padding: 0 !important; margin: 0 !important; background: #ffffff !important; }
            .a4-page {
              width: 210mm !important;
              min-height: 296mm !important;
              height: auto !important;
              max-height: none !important;
              margin: 0 !important;
              border: none !important;
              box-shadow: none !important;
              border-radius: 0 !important;
              overflow: visible !important;
              page-break-after: always;
              break-after: page;
            }
            .a4-page:last-child { page-break-after: auto; break-after: auto; }
            .a4-container:not(.a4-page) {
              width: 210mm !important;
              max-width: 210mm !important;
              height: auto !important;
              min-height: 0 !important;
              max-height: none !important;
              margin: 0 !important;
              padding: 0 10mm !important;
              border: none !important;
              box-shadow: none !important;
              overflow: visible !important;
            }
            /* a single sheet drawn 297 mm tall on screen would spill a few mm onto a 2nd page inside
               the page margins: on paper it is as tall as its content */
            .print-wrapper > *:not(.a4-page):not(.a4-preview-stack) {
              min-height: 0 !important;
              height: auto !important;
              border: none !important;
              box-shadow: none !important;
              border-radius: 0 !important;
            }
            .no-print-preview { display: none !important; }
          }
  `;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <meta charset="utf-8" />
        <meta name="purim-print-format" content="${format}" />
        <base href="${baseUrl}/" />
        ${headStyles}
        <style>
          @page {
            size: ${pageSize};
            margin: 0mm;
          }
          *, *::before, *::after {
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            font-family: var(--font-sarabun), 'Sarabun', 'Leelawadee UI', Tahoma, sans-serif !important;
            ${isSlip ? `width: 100% !important; max-width: 100% !important;` : `width: 210mm !important; max-width: 210mm !important;`}
          }
          .no-print {
            display: none !important;
          }
          .print-wrapper {
            width: 100% !important;
            max-width: ${containerMaxWidth} !important;
            margin: 0 auto !important;
            padding: 0 !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
          }
          ${isSlip ? slipCss : a4Css}
        </style>
      </head>
      <body class="${fontVarClasses}">
        <div class="print-wrapper">
          ${printableMarkup(element)}
        </div>
      </body>
    </html>
  `;
}

/** The desktop app reports a failed job as { success: false, failureReason }. */
function failedJobReason(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { success?: boolean; failureReason?: string; error?: string };
  if (r.success !== false) return null;
  // the Windows dialog closed with "cancel" is not an error
  if (/cancel/i.test(String(r.failureReason || r.error || ''))) return null;
  return r.failureReason || r.error || 'ไม่ทราบสาเหตุ';
}

/** Load HTML into a hidden iframe and resolve once styles and fonts are ready (max ~2.5 s). */
function loadIntoIframe(html: string, widthCss: string): Promise<HTMLIFrameElement | null> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = widthCss;
  iframe.style.height = '297mm';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    iframe.remove();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
      const fontsReady = fonts?.ready ? fonts.ready.then(() => undefined, () => undefined) : Promise.resolve();
      Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => setTimeout(() => resolve(iframe), 100));
    };
    iframe.addEventListener('load', start, { once: true });
    doc.open();
    doc.write(html);
    doc.close();
    if (doc.readyState === 'complete') start();
    // a stylesheet that never finishes loading must not block printing
    setTimeout(start, 2500);
  });
}

function printIframeOnce(iframe: HTMLIFrameElement) {
  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  } catch (e) {
    console.warn('Iframe print error', e);
  }
  setTimeout(() => iframe.remove(), 3000);
}

/**
 * The slip as a PICTURE page (one <img>, 72 mm wide). Thermal printer drivers replace text with
 * their built-in fonts, which have no Thai glyphs ("?????"); a picture prints as it looks.
 * Returns null when the picture cannot be made.
 */
async function slipPictureHtml(fullHtml: string, title: string): Promise<string | null> {
  const frame = await loadIntoIframe(fullHtml, `${SLIP_LAYOUT_PX}px`);
  if (!frame) return null;
  try {
    const root = frame.contentDocument?.querySelector<HTMLElement>('.print-wrapper');
    if (!root) return null;
    const canvas = await html2canvas(root, {
      scale: 2, // 576 dots: the printer's resolution at 72 mm
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: SLIP_LAYOUT_PX,
      onclone: (_d: Document, el: HTMLElement) => replaceModernColors(el),
    });
    const dataUrl = canvas.toDataURL('image/png');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="purim-print-format" content="80mm"><title>${title}</title><style>
      @page { size: 80mm auto; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      img { display: block; width: ${SLIP_LAYOUT_PX}px; max-width: 100%; height: auto; margin: 0 auto; }
    </style></head><body><img src="${dataUrl}" alt=""></body></html>`;
  } catch (err) {
    console.warn('Slip picture failed', err);
    return null;
  } finally {
    frame.remove();
  }
}

/** Browser printing of a slip: as a picture (see slipPictureHtml); as HTML if that fails. */
async function printSlipInBrowser(fullHtml: string, title: string): Promise<void> {
  const html = (await slipPictureHtml(fullHtml, title)) || fullHtml;
  const frame = await loadIntoIframe(html, '80mm');
  if (!frame) {
    window.print();
    return;
  }
  const img = frame.contentDocument?.querySelector('img');
  if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; });
  printIframeOnce(frame);
}

/**
 * Desktop apps older than 1.2.0 print every job through the Windows driver as text (Thai -> "???").
 * They have no getAppVersion (added in 1.2.3); 1.2.0-1.2.2 also lack it, a picture is fine there too.
 */
async function desktopPrintsSlipsAsText(electron: ElectronAPI): Promise<boolean> {
  if (typeof electron.getAppVersion !== 'function') return true;
  try {
    const v = String((await electron.getAppVersion()) || '0').split('.').map((n) => Number(n) || 0);
    return v[0] < 1 || (v[0] === 1 && v[1] < 2);
  } catch {
    return true;
  }
}

/** Layout width of a slip: 576 printer dots (72 mm) = 288 CSS px, as the desktop app renders it. */
const SLIP_LAYOUT_PX = 288;

/**
 * Print a document. Desktop app: silent print (slips -> receipt printer as an ESC/POS picture,
 * A4 -> A4 printer or the system dialog); browser: hidden iframe + print() (slips as a picture).
 * Resolves when the job was handed over; a failed desktop job shows the reason to the cashier.
 */
export async function printDocumentIframe(
  element: HTMLElement,
  title: string,
  format: '80mm' | 'a4' = 'a4'
): Promise<void> {
  const isSlip = format === '80mm';
  const fullHtml = buildPrintHtml(element, title, format);

  const electron = getElectronAPI();
  if (electron?.printSilent) {
    const target = electronPrintTarget(format);
    try {
      // an old desktop app would send the slip to the driver as text: hand it a picture instead
      const html = isSlip && (await desktopPrintsSlipsAsText(electron)) ? (await slipPictureHtml(fullHtml, title)) || fullHtml : fullHtml;
      const result = await electron.printSilent({
        html,
        printerName: target.printerName,
        showDialog: target.showDialog,
        format,
      });
      const failed = failedJobReason(result);
      if (failed) toast.error(`พิมพ์ไม่สำเร็จ: ${failed}`, { id: 'print-failed' });
    } catch (err) {
      console.error('Electron silent print failed:', err);
      toast.error('พิมพ์ไม่สำเร็จ (ติดต่อเครื่องพิมพ์ไม่ได้)', { id: 'print-failed' });
    }
    return;
  }

  if (isSlip) {
    await printSlipInBrowser(fullHtml, title);
    return;
  }
  const frame = await loadIntoIframe(fullHtml, '210mm');
  if (!frame) {
    window.print();
    return;
  }
  printIframeOnce(frame);
}

/** Render a canvas onto A4 pages, slicing it vertically when taller than one page. */
function addCanvasPaged(pdf: jsPDF, canvas: HTMLCanvasElement, margin: number, firstPage: boolean): void {
  const pageW = 210;
  const pageH = 297;
  const printW = pageW - margin * 2;
  const printH = pageH - margin * 2;
  const pxPerMm = canvas.width / printW;
  const slicePx = Math.floor(printH * pxPerMm);
  // tolerate a few px of rounding on full-height sheets
  const tolerance = Math.ceil(pxPerMm * 1.5);
  let offset = 0;
  let first = firstPage;
  while (offset < canvas.height) {
    let h = Math.min(slicePx, canvas.height - offset);
    if (canvas.height - offset - h <= tolerance) h = canvas.height - offset;
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    const ctx = slice.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, offset, canvas.width, h, 0, 0, canvas.width, h);
    if (!first) pdf.addPage();
    first = false;
    pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, printW, Math.min(printH, h / pxPerMm));
    offset += h;
  }
}

/**
 * html2canvas 1.x cannot parse modern color functions (Tailwind v4 uses oklch()), which made
 * every PDF download fail. Before capture, rewrite such computed colors on the cloned DOM to rgb().
 */
const COLOR_PROPS = [
  'color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'outline-color', 'text-decoration-color', 'column-rule-color', 'caret-color', 'fill', 'stroke',
  '-webkit-text-stroke-color', '-webkit-text-fill-color',
];
const MODERN_COLOR = /(oklch|oklab|lch|lab|color-mix|color)\(/i;

function makeColorConverter(): (value: string) => string {
  const cache = new Map<string, string>();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (value: string) => {
    const hit = cache.get(value);
    if (hit) return hit;
    let out = 'rgba(0, 0, 0, 0)';
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      out = `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
    }
    cache.set(value, out);
    return out;
  };
}

function replaceModernColors(root: HTMLElement): void {
  const win = root.ownerDocument.defaultView;
  if (!win) return;
  const toRgb = makeColorConverter();
  const els = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const el of els) {
    const cs = win.getComputedStyle(el);
    for (const prop of COLOR_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && MODERN_COLOR.test(v)) el.style.setProperty(prop, toRgb(v), 'important');
    }
    const shadow = cs.getPropertyValue('box-shadow');
    if (shadow && MODERN_COLOR.test(shadow)) el.style.setProperty('box-shadow', 'none', 'important');
    const textShadow = cs.getPropertyValue('text-shadow');
    if (textShadow && MODERN_COLOR.test(textShadow)) el.style.setProperty('text-shadow', 'none', 'important');
    const bgImage = cs.getPropertyValue('background-image');
    if (bgImage && MODERN_COLOR.test(bgImage)) el.style.setProperty('background-image', 'none', 'important');
  }
}

async function withPlainPageBackground<T>(run: () => Promise<T>): Promise<T> {
  // html2canvas reads the <html>/<body> background of the live page, which is oklch() too
  const targets = [document.documentElement, document.body].filter(Boolean) as HTMLElement[];
  const saved = targets.map((el) => el.style.getPropertyValue('background-color'));
  const savedPrio = targets.map((el) => el.style.getPropertyPriority('background-color'));
  targets.forEach((el) => el.style.setProperty('background-color', '#ffffff', 'important'));
  try {
    return await run();
  } finally {
    targets.forEach((el, i) => {
      if (saved[i]) el.style.setProperty('background-color', saved[i], savedPrio[i]);
      else el.style.removeProperty('background-color');
    });
  }
}

function captureElement(element: HTMLElement): Promise<HTMLCanvasElement> {
  return withPlainPageBackground(() => html2canvas(element, {
    onclone: (_doc: Document, clonedEl: HTMLElement) => replaceModernColors(clonedEl),
    scale: 2.5,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: document.documentElement.offsetWidth,
  }));
}

/** html2canvas with the modern-color fix (drop-in for direct html2canvas calls). */
export function capturePrintable(
  element: HTMLElement,
  options: Parameters<typeof html2canvas>[1] = {},
): Promise<HTMLCanvasElement> {
  const userOnClone = options?.onclone;
  return withPlainPageBackground(() => html2canvas(element, {
    ...options,
    onclone: (doc: Document, clonedEl: HTMLElement) => {
      replaceModernColors(clonedEl);
      if (userOnClone) return userOnClone(doc, clonedEl);
    },
  }));
}

/**
 * Build a multi-page A4 PDF of a document. `.a4-page` sheets become one PDF page each;
 * any other document is sliced over as many pages as it needs (nothing is cut off).
 */
export async function buildA4Pdf(element: HTMLElement): Promise<jsPDF> {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const sheets = element.classList.contains('a4-page')
    ? [element]
    : (Array.from(element.querySelectorAll('.a4-page')) as HTMLElement[]);
  if (sheets.length > 0) {
    for (let i = 0; i < sheets.length; i++) {
      const canvas = await captureElement(sheets[i]);
      addCanvasPaged(pdf, canvas, 0, i === 0);
    }
  } else {
    const canvas = await captureElement(element);
    addCanvasPaged(pdf, canvas, 8, true);
  }
  return pdf;
}

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  format: '80mm' | 'a4' = 'a4'
): Promise<boolean> {
  try {
    const name = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    if (format === '80mm') {
      const canvas = await captureElement(element);
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const mmWidth = 80;
      const mmHeight = (canvas.height * mmWidth) / canvas.width;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [mmWidth, Math.max(120, mmHeight + 6)],
      });
      pdf.addImage(imgData, 'JPEG', 0, 2, mmWidth, mmHeight);
      pdf.save(name);
    } else {
      const pdf = await buildA4Pdf(element);
      pdf.save(name);
    }
    return true;
  } catch (err) {
    console.error('Failed to generate PDF:', err);
    return false;
  }
}
