export interface CSVProductRow {
  productCode: string;
  productName: string;
  /** purchase cost (-> costPrice); undefined when the cell is blank */
  cost?: number;
  /** selling price level 1 (-> basePrice) */
  price?: number;
  priceLevel1?: number;
  priceLevel2?: number;
  priceLevel3?: number;
  priceLevel4?: number;
  priceLevel5?: number;
  customBarcodeId: string;
  barcodeForSelling: string; // customBarcodeId or productCode if barcode is missing
  category?: string;
  stock?: number;
  unit?: string;
}

export interface FormattedProductItem {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  category?: string;
  stock: number;
  hasVat: boolean;
  cost?: number;
  costPrice?: number;
  basePrice: number;
  price?: number | null;
  priceLevel1?: number | null;
  priceLevel2?: number | null;
  priceLevel3?: number | null;
  priceLevel4?: number | null;
  priceLevel5?: number | null;
  unit: string;
  image: string | null;
  barcodes: { barcode: string }[];
  units: {
    id: string;
    unitName: string;
    factor: number;
    price: number;
    barcode: string;
  }[];
}

export function normalizeProductIdentifier(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  const cleaned = raw
    .replace(/^\uFEFF/, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, '');

  if (!/[eE]/.test(cleaned)) return cleaned;

  const match = cleaned.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return cleaned;

  const sign = match[1] === '-' ? '-' : '';
  const intPart = match[2] || '';
  const fracPart = match[3] || '';
  const exponent = parseInt(match[4], 10);
  if (!Number.isFinite(exponent)) return cleaned;

  const digits = intPart + fracPart;
  const decimalIndex = intPart.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${'0'.repeat(Math.abs(decimalIndex))}${digits}`.replace(/\.?0+$/, '');
  }

  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }

  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`.replace(/\.?0+$/, '');
}

function normalizeNumericCell(value: string | undefined, fallback = '0'): string {
  return normalizeProductIdentifier(value ?? fallback).replace(/,/g, '').trim();
}

/** Error for a bad CSV file / row; the message is Thai and names the row. */
export class CsvImportError extends Error {
  row?: number;
  constructor(message: string, row?: number) {
    super(message);
    this.name = 'CsvImportError';
    this.row = row;
  }
}

/**
 * Pick the field delimiter from the header line: ',' (default), ';' (Excel in locales that use a
 * decimal comma) or a tab. Characters inside quotes are ignored.
 */
export function detectCSVDelimiter(text: string): string {
  const firstLine: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === '\n' || c === '\r')) break;
    else if (!inQuotes) firstLine.push(c);
  }
  const count = (d: string) => firstLine.filter((c) => c === d).length;
  const candidates: Array<[string, number]> = [[',', count(',')], [';', count(';')], ['\t', count('\t')]];
  candidates.sort((x, y) => y[1] - x[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ',';
}

/**
 * Robust CSV Line Parser that handles quotes, escaped quotes, and newlines inside fields.
 * The delimiter is detected from the header line unless given.
 */
export function parseCSVLines(text: string, delimiter?: string): string[][] {
  const sep = delimiter || detectCSVDelimiter(text.replace(/^\uFEFF/, ''));
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === sep) {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        lines.push(currentRow);
        currentRow = [];
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    lines.push(currentRow);
  }

  return lines;
}

type CsvField =
  | 'code' | 'name' | 'barcode' | 'category' | 'cost'
  | 'price1' | 'price2' | 'price3' | 'price4' | 'price5'
  | 'stock' | 'unit';

/**
 * Accepted header names per column (compared EXACTLY after trimming / lower-casing; a header like
 * "ราคาทุน (Cost Price)" is matched by its text outside or inside the brackets). Exact matching keeps
 * "barcode" from being read as "code" and "unit cost" from being read as "unit".
 */
const HEADER_ALIASES: Record<CsvField, string[]> = {
  code: ['code', 'product code', 'productcode', 'item code', 'sku', 'รหัส', 'รหัสสินค้า'],
  name: ['name', 'product name', 'productname', 'product_name', 'ชื่อ', 'ชื่อสินค้า'],
  barcode: ['barcode', 'bar code', 'custom barcode', 'custombarcodeid', 'บาร์โค้ด', 'บาร์โค๊ด'],
  category: ['category', 'หมวด', 'หมวดหมู่', 'หมวดหมู่สินค้า'],
  cost: ['cost', 'cost price', 'costprice', 'unit cost', 'ทุน', 'ราคาทุน', 'ต้นทุน'],
  price1: ['price', 'price 1', 'price1', 'price level 1', 'pricelevel1', 'level 1', 'level1', 'retail price', 'selling price',
    'ราคา', 'ราคา 1', 'ราคา1', 'ราคาขาย', 'ราคาขาย 1', 'ราคาขายปลีก', 'ราคาทั่วไป', 'ทั่วไป', 'ระดับราคา 1', 'ราคาขาย 1 / ขายปลีก'],
  price2: ['price 2', 'price2', 'price level 2', 'pricelevel2', 'level 2', 'level2', 'ราคา 2', 'ราคา2', 'ราคาขาย 2', 'ราคาสมาชิก', 'สมาชิก', 'ระดับราคา 2'],
  price3: ['price 3', 'price3', 'price level 3', 'pricelevel3', 'level 3', 'level3', 'ราคา 3', 'ราคา3', 'ราคาขาย 3', 'ราคาช่าง', 'ราคาส่ง', 'ช่าง', 'ช่าง/ส่ง', 'ระดับราคา 3'],
  price4: ['price 4', 'price4', 'price level 4', 'pricelevel4', 'level 4', 'level4', 'ราคา 4', 'ราคา4', 'ราคาขาย 4', 'vip', 'ราคา vip', 'ระดับราคา 4'],
  price5: ['price 5', 'price5', 'price level 5', 'pricelevel5', 'level 5', 'level5', 'ราคา 5', 'ราคา5', 'ราคาขาย 5', 'ราคาตัวแทน', 'ตัวแทน', 'ระดับราคา 5'],
  stock: ['stock', 'qty', 'quantity', 'สต็อก', 'สต๊อก', 'จำนวน', 'จำนวนสต็อก', 'จำนวนสต๊อก', 'คงเหลือ'],
  unit: ['unit', 'unit name', 'หน่วย', 'หน่วยนับ'],
};

function headerForms(h: string): string[] {
  const clean = h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const forms = [clean];
  const m = clean.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) forms.push(m[1].trim(), m[2].trim());
  return forms.filter(Boolean);
}

/** Column index per field (-1 = not in the file). The first column that matches a field wins. */
export function mapCSVHeader(headerRow: string[]): Record<CsvField, number> {
  const result = {} as Record<CsvField, number>;
  const fields = Object.keys(HEADER_ALIASES) as CsvField[];
  for (const f of fields) result[f] = -1;
  headerRow.forEach((h, idx) => {
    const forms = headerForms(h || '');
    // the whole header first, then its bracket parts ("ราคา 1 (ทั่วไป)" -> "ราคา 1")
    for (const form of forms) {
      const field = fields.find((f) => result[f] === -1 && HEADER_ALIASES[f].includes(form));
      if (field) {
        result[field] = idx;
        break;
      }
    }
  });
  return result;
}

/**
 * Parse CSV text into product rows based on header column names.
 * Supports Price Levels 1 to 5, category, stock, unit, cost, barcode; ',' or ';' delimited.
 * Product code and barcode are separate identifiers. Blank cells are left undefined (the import
 * then keeps the product's current value). Negative or non-numeric amounts throw CsvImportError.
 */
export function parseProductCSV(csvText: string): CSVProductRow[] {
  const delimiter = detectCSVDelimiter(csvText.replace(/^\uFEFF/, ''));
  const lines = parseCSVLines(csvText, delimiter);
  if (lines.length === 0) return [];

  const col = mapCSVHeader(lines[0]);
  if (col.code < 0 && col.name < 0 && col.barcode < 0) {
    throw new CsvImportError('ไม่พบหัวคอลัมน์รหัสสินค้า ชื่อสินค้า หรือบาร์โค้ดในแถวแรกของไฟล์');
  }
  const cell = (row: string[], idx: number) => (idx >= 0 && row[idx] !== undefined ? row[idx] : '');

  const results: CSVProductRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.length === 0 || row.every((c) => !String(c).trim())) continue;
    const rowNo = i + 1; // file line (row 1 = header)

    const num = (idx: number, label: string, opts: { integer?: boolean } = {}): number | undefined => {
      const rawCell = cell(row, idx).trim();
      // ';'-separated files usually come from Excel with a decimal comma: "7,50" = 7.5
      const text = delimiter === ';' && /^-?\d+,\d{1,2}$/.test(rawCell)
        ? rawCell.replace(',', '.')
        : normalizeNumericCell(rawCell, '');
      if (!text) return undefined;
      const n = Number(text);
      if (!Number.isFinite(n)) throw new CsvImportError(`แถวที่ ${rowNo}: ${label} "${cell(row, idx)}" ไม่ใช่ตัวเลข`, rowNo);
      if (n < 0) throw new CsvImportError(`แถวที่ ${rowNo}: ${label}ต้องไม่ติดลบ`, rowNo);
      if (opts.integer && !Number.isInteger(n)) throw new CsvImportError(`แถวที่ ${rowNo}: ${label}ต้องเป็นจำนวนเต็ม`, rowNo);
      return n;
    };

    const productCode = normalizeProductIdentifier(cell(row, col.code));
    const productName = cell(row, col.name).trim();
    const customBarcodeId = normalizeProductIdentifier(cell(row, col.barcode));
    const category = cell(row, col.category).trim();
    const unit = cell(row, col.unit).trim();

    if (!productCode && !productName && !customBarcodeId) continue;

    const cost = num(col.cost, 'ราคาทุน');
    const price1 = num(col.price1, 'ราคาขาย 1');
    const price2 = num(col.price2, 'ราคาขาย 2');
    const price3 = num(col.price3, 'ราคาขาย 3');
    const price4 = num(col.price4, 'ราคาขาย 4');
    const price5 = num(col.price5, 'ราคาขาย 5');
    const stock = num(col.stock, 'จำนวนสต็อก', { integer: true });

    results.push({
      productCode,
      productName,
      cost,
      price: price1,
      priceLevel1: price1,
      priceLevel2: price2,
      priceLevel3: price3,
      priceLevel4: price4,
      priceLevel5: price5,
      customBarcodeId,
      barcodeForSelling: customBarcodeId,
      category,
      stock,
      unit,
    });
  }

  return results;
}

/**
 * Converts parsed CSV rows into formatted Product objects ready for POS & Database
 */
export function csvRowsToProducts(rows: CSVProductRow[]): FormattedProductItem[] {
  return rows.map((r, idx) => {
    const id = r.productCode || `PROD-${idx + 1}`;
    const p1 = r.priceLevel1 != null ? r.priceLevel1 : r.price;
    const unitName = r.unit || '';
    const sellingPrice = p1 ?? 0;

    return {
      id,
      sku: r.productCode || id,
      name: r.productName,
      categoryId: 'c6', // Default category: อื่นๆ
      category: r.category || 'ทั่วไป',
      stock: r.stock !== undefined ? r.stock : 0,
      hasVat: true,
      cost: r.cost,
      costPrice: r.cost,
      // basePrice is the SELLING price (priceLevel1), never the cost
      basePrice: sellingPrice,
      price: p1 ?? null,
      priceLevel1: p1 ?? null,
      priceLevel2: r.priceLevel2 ?? null,
      priceLevel3: r.priceLevel3 ?? null,
      priceLevel4: r.priceLevel4 ?? null,
      priceLevel5: r.priceLevel5 ?? null,
      unit: unitName,
      image: null,
      barcodes: r.barcodeForSelling ? [{ barcode: r.barcodeForSelling }] : [],
      units: [
        {
          id: `u-${id}-base`,
          unitName: unitName || '',
          factor: 1,
          price: sellingPrice,
          barcode: r.barcodeForSelling || '',
        }
      ]
    };
  });
}
