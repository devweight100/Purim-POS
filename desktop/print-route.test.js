// node --test desktop/print-route.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decidePrintRoute, resolveFormat } = require('./print-route');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'test-fixtures', name), 'utf8');

test('slips from the POS sale and from every history reprint go to the raster printer', () => {
  for (const name of ['slip-pos-sale.html', 'slip-history-reprint.html']) {
    const html = fixture(name);
    assert.deepStrictEqual(decidePrintRoute({ format: '80mm', html }), { paper: '80mm', route: 'raster' }, name);
    // also when an older web app sends no format: the marker in the HTML decides
    assert.deepStrictEqual(decidePrintRoute({ html }), { paper: '80mm', route: 'raster' }, `${name} without format`);
  }
});

test('page stylesheets that mention A4 sizes do not turn a slip into an A4 job', () => {
  const slip = `<html><head><style>.a4-page{width:210mm} .x{size: A4}</style></head><body>ใบเสร็จ</body></html>`;
  assert.strictEqual(resolveFormat({ html: slip }), '80mm');
  assert.strictEqual(resolveFormat({ html: '<style>@page { size: A4 portrait; margin: 0 }</style>' }), 'a4');
});

test('A4 documents go to the A4 route', () => {
  assert.deepStrictEqual(decidePrintRoute({ format: 'a4', html: '' }), { paper: 'a4', route: 'a4' });
  assert.deepStrictEqual(decidePrintRoute({ html: '<meta name="purim-print-format" content="a4">' }), { paper: 'a4', route: 'a4' });
});

test('receiptPrintMode "driver" prints the slip as a picture, never as text', () => {
  assert.deepStrictEqual(decidePrintRoute({ format: '80mm', html: '', config: { receiptPrintMode: 'driver' } }), {
    paper: '80mm',
    route: 'driver-image',
  });
});
