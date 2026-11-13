/**
 * Which way a print job from the web app goes (pure, unit-tested in print-route.test.js).
 *
 * - 'a4'           A4 document -> A4 printer (or the Windows dialog)
 * - 'raster'       receipt -> ESC/POS raster image sent RAW to the receipt printer (normal path)
 * - 'driver-image' receipt -> Windows driver, as a PICTURE of the slip (receiptPrintMode = "driver",
 *                  or the fallback when RAW sending fails)
 *
 * A receipt is never sent to the driver as text: thermal drivers replace TrueType text with
 * their built-in fonts, which have no Thai glyphs, and Thai prints as "?????".
 */

/** <meta name="purim-print-format" content="80mm|a4"> written by the web app into every print job */
function formatFromHtml(html) {
  const m = /<meta\s+name=["']purim-print-format["']\s+content=["'](80mm|a4)["']/i.exec(String(html || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Paper format of a job: the `format` the web app sent, else the marker in its HTML, else a guess
 * from the page CSS. The guess only looks at the document's own @page rule: page stylesheets
 * copied into a slip can mention "210mm" (A4 preview classes) without the slip being A4.
 */
function resolveFormat({ format, html }) {
  const f = String(format || '').toLowerCase();
  if (f === 'a4' || f === '80mm' || f === '58mm') return f === 'a4' ? 'a4' : '80mm';
  const marked = formatFromHtml(html);
  if (marked) return marked;
  return /@page\s*\{[^}]*size:\s*A4/i.test(String(html || '')) ? 'a4' : '80mm';
}

function decidePrintRoute({ format, html, mode, config = {} }) {
  const paper = resolveFormat({ format, html });
  if (paper === 'a4') return { paper, route: 'a4' };
  const receiptMode = mode || config.receiptPrintMode || 'raster';
  return { paper, route: receiptMode === 'driver' ? 'driver-image' : 'raster' };
}

module.exports = { resolveFormat, decidePrintRoute, formatFromHtml };
