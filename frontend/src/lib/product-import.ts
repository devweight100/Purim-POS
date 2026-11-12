import { round2 } from '@shared/money';
/**
 * Product import / export file, "one row per unit" format.
 *
 *   รหัสสินค้า | ชื่อสินค้า | หมวดหมู่ | หน่วย | 1 หน่วยนี้ = กี่หน่วยก่อนหน้า | บาร์โค้ด | ราคาทุน | ราคาขาย 1..5 | จำนวนคงเหลือ | รายละเอียด
 *
 * Rows with the same รหัสสินค้า are one product. Its FIRST row is the smallest unit (ชิ้น / ขวด):
 * the "1 หน่วยนี้ = ..." cell stays empty and its cost / prices / barcodes are the product's own.
 * Every following row is a larger unit (แพ็ค, ลัง ...) holding N of the unit on the row above,
 * with its own barcode and prices (= ProductPackagingUnit.qtyPerPrev / barcode / priceLevel1-5).
 * Stock may be counted in any unit: the system stores it in the smallest unit
 * (5 ลัง x 12 + 3 แพ็ค x 6 + 10 ขวด = 88 ขวด).
 */
import type * as XLSXType from 'xlsx';
import { addQty, decimalQtyEnabled, formatQty, mulQty } from './qty';

type XLSXLib = typeof XLSXType;

export const COL = {
  sku: 'รหัสสินค้า (SKU)',
  name: 'ชื่อสินค้า',
  category: 'หมวดหมู่',
  unit: 'หน่วย',
  perPrev: '1 หน่วยนี้ = กี่หน่วยก่อนหน้า',
  barcode: 'บาร์โค้ด',
  cost: 'ราคาทุน (ต่อหน่วยเล็กสุด)',
  p1: 'ราคาขาย 1 (ปลีก)',
  p2: 'ราคาขาย 2',
  p3: 'ราคาขาย 3',
  p4: 'ราคาขาย 4',
  p5: 'ราคาขาย 5',
  stock: 'จำนวนคงเหลือ (นับในหน่วยนี้)',
  description: 'รายละเอียด',
  id: 'รหัสระบบ (ห้ามแก้ไข)',
} as const;

const COLUMN_ORDER = [
  COL.sku, COL.name, COL.category, COL.unit, COL.perPrev, COL.barcode, COL.cost,
  COL.p1, COL.p2, COL.p3, COL.p4, COL.p5, COL.stock, COL.description, COL.id,
];
const COLUMN_WIDTHS = [16, 34, 16, 10, 16, 30, 14, 14, 11, 11, 11, 11, 16, 30, 38];

export const UNITS_SHEET = 'สินค้า';

/** The file is in the per-unit format when it has the "1 หน่วยนี้ = ..." column. */
export function isUnitsFormat(headers: string[]): boolean {
  return headers.some((h) => norm(h).startsWith(norm('1 หน่วยนี้')));
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

/** Header in the file -> column key (exact template text, or the text without the bracket part). */
function buildHeaderMap(headers: string[]): Map<string, keyof typeof COL> {
  const map = new Map<string, keyof typeof COL>();
  const byText = new Map<string, keyof typeof COL>();
  for (const [key, text] of Object.entries(COL) as [keyof typeof COL, string][]) {
    byText.set(norm(text), key);
    byText.set(norm(text.replace(/\s*\(.*\)\s*$/, '')), key);
  }
  byText.set(norm('SKU'), 'sku');
  byText.set(norm('Barcode'), 'barcode');
  for (const h of headers) {
    const key = byText.get(norm(h)) ?? (norm(h).startsWith(norm('1 หน่วยนี้')) ? 'perPrev' : undefined);
    if (key) map.set(h, key);
  }
  return map;
}

export class ImportFileError extends Error {}

export interface ImportPackUnit {
  name: string;
  qtyPerPrev: number;
  barcode: string | null;
  priceLevel1?: number;
  priceLevel2?: number;
  priceLevel3?: number;
  priceLevel4?: number;
  priceLevel5?: number;
}

export interface ImportProduct {
  rowNo: number;
  id?: string;
  sku: string;
  name: string;
  categoryName: string;
  unit: string;
  barcode: string;
  barcodes: string[];
  costPrice?: number;
  priceLevel1?: number;
  priceLevel2?: number;
  priceLevel3?: number;
  priceLevel4?: number;
  priceLevel5?: number;
  /** total in the smallest unit; undefined = no stock column filled (stock is left as it is) */
  stock?: number;
  /** how the stock was counted, e.g. "5 ลัง + 3 แพ็ค + 10 ขวด = 88 ขวด" */
  stockNote?: string;
  description: string;
  packagingUnits: ImportPackUnit[];
}

function cellText(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function cellNumber(v: unknown, rowNo: number, label: string, opts: { integer?: boolean; min?: number; maxDecimals?: number } = {}): number | undefined {
  const t = cellText(v).replace(/,/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new ImportFileError(`แถวที่ ${rowNo}: ${label} "${cellText(v)}" ไม่ใช่ตัวเลข`);
  if (n < (opts.min ?? 0)) throw new ImportFileError(`แถวที่ ${rowNo}: ${label} ต้องไม่ต่ำกว่า ${opts.min ?? 0}`);
  if (opts.integer && !Number.isInteger(n)) throw new ImportFileError(`แถวที่ ${rowNo}: ${label} ต้องเป็นจำนวนเต็ม`);
  if (opts.maxDecimals !== undefined && Math.abs(n * 10 ** opts.maxDecimals - Math.round(n * 10 ** opts.maxDecimals)) > 1e-6) {
    throw new ImportFileError(`แถวที่ ${rowNo}: ${label} มีทศนิยมได้ไม่เกิน ${opts.maxDecimals} ตำแหน่ง`);
  }
  return n;
}

const splitBarcodes = (v: unknown) =>
  cellText(v)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);


/**
 * Rows (objects keyed by the header text, as from XLSX sheet_to_json) -> products.
 * `firstRowNo` is the spreadsheet row of rows[0] (2 when row 1 is the header).
 * Throws ImportFileError naming the row on any problem.
 */
export function parseUnitsRows(rows: Record<string, unknown>[], headers: string[], firstRowNo = 2): ImportProduct[] {
  const hmap = buildHeaderMap(headers);
  if (![...hmap.values()].includes('unit')) throw new ImportFileError(`ไม่พบคอลัมน์ "${COL.unit}" ในไฟล์`);
  const get = (row: Record<string, unknown>, key: keyof typeof COL) => {
    for (const [h, k] of hmap) if (k === key) return row[h];
    return undefined;
  };

  const groups = new Map<string, { rowNo: number; row: Record<string, unknown> }[]>();
  const order: string[] = [];
  let anon = 0;
  rows.forEach((row, i) => {
    const rowNo = firstRowNo + i;
    const sku = cellText(get(row, 'sku'));
    const name = cellText(get(row, 'name'));
    const unit = cellText(get(row, 'unit'));
    if (!sku && !name && !unit) return; // empty line
    const key = sku ? `sku:${sku.toLowerCase()}` : `row:${++anon}`;
    if (!sku && cellText(get(row, 'perPrev'))) {
      throw new ImportFileError(`แถวที่ ${rowNo}: แถวหน่วยบรรจุ (แพ็ค/ลัง) ต้องมี "${COL.sku}" เดียวกับหน่วยเล็กสุดของสินค้านั้น`);
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push({ rowNo, row });
  });

  return order.map((key) => {
    const lines = groups.get(key)!;
    const [first, ...packs] = lines;
    const r = first.row;
    const rowNo = first.rowNo;
    const unit = cellText(get(r, 'unit'));
    const name = lines.map((l) => cellText(get(l.row, 'name'))).find(Boolean) || '';
    if (!unit) throw new ImportFileError(`แถวที่ ${rowNo}: กรุณาระบุ "${COL.unit}"`);
    if (!name) throw new ImportFileError(`แถวที่ ${rowNo}: กรุณาระบุ "${COL.name}"`);
    const firstPer = cellText(get(r, 'perPrev'));
    if (firstPer && firstPer !== '1') {
      throw new ImportFileError(
        `แถวที่ ${rowNo}: แถวแรกของสินค้า "${name}" ต้องเป็นหน่วยเล็กสุด (ช่อง "${COL.perPrev}" ต้องว่าง) — เรียงแถวจากหน่วยเล็กไปใหญ่`,
      );
    }

    const price = (row: Record<string, unknown>, n: number, k: keyof typeof COL, label: string) => cellNumber(get(row, k), n, label);
    const product: ImportProduct = {
      rowNo,
      id: cellText(get(r, 'id')) || undefined,
      sku: cellText(get(r, 'sku')),
      name,
      categoryName: lines.map((l) => cellText(get(l.row, 'category'))).find(Boolean) || '',
      unit,
      barcode: '',
      barcodes: [],
      costPrice: cellNumber(get(r, 'cost'), rowNo, 'ราคาทุน'),
      priceLevel1: price(r, rowNo, 'p1', 'ราคาขาย 1'),
      priceLevel2: price(r, rowNo, 'p2', 'ราคาขาย 2'),
      priceLevel3: price(r, rowNo, 'p3', 'ราคาขาย 3'),
      priceLevel4: price(r, rowNo, 'p4', 'ราคาขาย 4'),
      priceLevel5: price(r, rowNo, 'p5', 'ราคาขาย 5'),
      description: lines.map((l) => cellText(get(l.row, 'description'))).find(Boolean) || '',
      packagingUnits: [],
    };
    const baseCodes = splitBarcodes(get(r, 'barcode'));
    product.barcode = baseCodes[0] || '';
    product.barcodes = baseCodes.slice(1);

    // stock counted in every unit -> smallest unit
    let factor = 1;
    let stockTotal = 0;
    const allowDecimalStock = decimalQtyEnabled();
    let anyStock = false;
    const stockParts: string[] = [];
    const addStock = (row: Record<string, unknown>, n: number, unitName: string, f: number) => {
      // whole units unless the store allows decimal quantities (then up to 2 decimals, e.g. 12.5 เมตร)
      const c = cellNumber(get(row, 'stock'), n, `จำนวนคงเหลือ (${unitName})`, allowDecimalStock ? { maxDecimals: 2 } : { integer: true });
      if (c === undefined) return;
      anyStock = true;
      stockTotal = addQty(stockTotal, mulQty(c, f));
      if (c > 0) stockParts.push(`${formatQty(c, { grouping: true })} ${unitName}`);
    };
    addStock(r, rowNo, unit, 1);

    const seenNames = new Set([unit.toLowerCase()]);
    for (const line of packs) {
      const pr = line.row;
      const pn = line.rowNo;
      const pUnit = cellText(get(pr, 'unit'));
      if (!pUnit) throw new ImportFileError(`แถวที่ ${pn}: กรุณาระบุ "${COL.unit}" ของหน่วยบรรจุ`);
      if (seenNames.has(pUnit.toLowerCase())) throw new ImportFileError(`แถวที่ ${pn}: หน่วย "${pUnit}" ซ้ำในสินค้า "${name}"`);
      seenNames.add(pUnit.toLowerCase());
      const per = cellNumber(get(pr, 'perPrev'), pn, `"${COL.perPrev}"`, { integer: true, min: 2 });
      if (per === undefined) {
        throw new ImportFileError(`แถวที่ ${pn}: หน่วย "${pUnit}" ต้องระบุ "${COL.perPrev}" (เช่น 1 ${pUnit} = 6 หน่วยก่อนหน้า ใส่ 6)`);
      }
      factor *= per;
      const codes = splitBarcodes(get(pr, 'barcode'));
      if (codes.length > 1) throw new ImportFileError(`แถวที่ ${pn}: หน่วยบรรจุ "${pUnit}" ใส่บาร์โค้ดได้ 1 ตัว`);
      const unitPrice = (k: keyof typeof COL, label: string) => price(pr, pn, k, `${label} (${pUnit})`);
      const p1 = unitPrice('p1', 'ราคาขาย 1');
      product.packagingUnits.push({
        name: pUnit,
        qtyPerPrev: per,
        barcode: codes[0] || null,
        // no pack price -> pro rata from the smallest unit, so a pack never sells at the unit price
        priceLevel1: p1 ?? (product.priceLevel1 !== undefined ? round2(product.priceLevel1 * factor) : undefined),
        priceLevel2: unitPrice('p2', 'ราคาขาย 2'),
        priceLevel3: unitPrice('p3', 'ราคาขาย 3'),
        priceLevel4: unitPrice('p4', 'ราคาขาย 4'),
        priceLevel5: unitPrice('p5', 'ราคาขาย 5'),
      });
      addStock(pr, pn, pUnit, factor);
    }
    if (anyStock) {
      product.stock = stockTotal;
      product.stockNote =
        stockParts.length > 1 ? `${stockParts.join(' + ')} = ${formatQty(stockTotal, { grouping: true })} ${unit}` : undefined;
    }
    return product;
  });
}

/** Short text of a product's pack chain, e.g. "ขวด → แพ็ค (6) → ลัง (2)". */
export function packChainText(unit: string, packs: { name: string; qtyPerPrev: number }[] | undefined): string {
  return [unit || 'ชิ้น', ...(packs || []).map((u) => `${u.name} (${u.qtyPerPrev})`)].join(' → ');
}

function sheetFromRows(XLSX: XLSXLib, rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMN_ORDER });
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

const HOW_TO = [
  ['วิธีกรอกไฟล์นำเข้าสินค้า (1 แถว = 1 หน่วยของสินค้า)'],
  [''],
  ['1. สินค้าหนึ่งตัวใช้หลายแถวได้ ทุกแถวของสินค้าเดียวกันต้องใส่ "รหัสสินค้า (SKU)" เหมือนกัน'],
  ['2. แถวแรกของสินค้า = หน่วยเล็กสุด (เช่น ชิ้น / ขวด / ซอง) ช่อง "1 หน่วยนี้ = กี่หน่วยก่อนหน้า" ให้เว้นว่าง'],
  ['3. แถวต่อ ๆ ไป = หน่วยที่ใหญ่ขึ้นตามลำดับ (แพ็ค แล้วค่อย ลัง) ใส่ว่า 1 หน่วยนี้ บรรจุหน่วยของแถวก่อนหน้ากี่หน่วย'],
  ['   ตัวอย่าง: ขวด → แพ็ค ใส่ 6 (1 แพ็ค = 6 ขวด) → ลัง ใส่ 2 (1 ลัง = 2 แพ็ค = 12 ขวด)'],
  ['4. บาร์โค้ด: แต่ละหน่วยมีบาร์โค้ดของตัวเองได้ หน่วยเล็กสุดใส่ได้หลายตัว คั่นด้วยเครื่องหมายจุลภาค (,)'],
  ['   บาร์โค้ดห้ามซ้ำกับสินค้าอื่น ถ้าไม่มีบาร์โค้ด เว้นว่างได้ (สแกนรหัสสินค้าแทนได้)'],
  ['5. ราคาทุน: ใส่ที่แถวหน่วยเล็กสุดเท่านั้น (ทุนต่อ 1 หน่วยเล็กสุด)'],
  ['6. ราคาขาย 1-5: ใส่ได้ทุกแถว เป็นราคาของหน่วยในแถวนั้น ถ้าแถวแพ็ค/ลังไม่ใส่ราคาขาย 1 ระบบคิดให้ = ราคาหน่วยเล็กสุด × จำนวนที่บรรจุ'],
  ['7. จำนวนคงเหลือ: นับแยกตามหน่วยได้ เช่น ลัง 5, แพ็ค 3, ขวด 10 ระบบรวมเป็นหน่วยเล็กสุด = 5×12 + 3×6 + 10 = 88 ขวด'],
  ['   ถ้าเว้นว่างทุกแถวของสินค้านั้น = ไม่เปลี่ยนสต็อกเดิม (ใส่ 0 = ตั้งสต็อกเป็น 0)'],
  ['8. สินค้าที่มีอยู่แล้ว (รหัสสินค้าตรงกัน): ระบบอัปเดตเฉพาะช่องที่กรอก ช่องว่าง = คงค่าเดิม'],
  ['   ถ้ามีแถวหน่วยบรรจุ (แพ็ค/ลัง) ระบบจะใช้หน่วยบรรจุตามไฟล์แทนของเดิมทั้งหมด ถ้าไม่มีแถวหน่วยบรรจุ หน่วยบรรจุเดิมจะไม่ถูกแตะ'],
  ['9. ชื่อสินค้า หมวดหมู่ รายละเอียด ใส่แค่แถวแรกของสินค้าก็พอ หมวดหมู่ที่ยังไม่มีระบบสร้างให้'],
  ['10. ช่อง "รหัสระบบ (ห้ามแก้ไข)" มีในไฟล์ที่ส่งออกจากระบบ ใช้จับคู่สินค้าเดิม สินค้าใหม่ให้เว้นว่าง'],
  ['11. ระบบแสดงตัวอย่างก่อนบันทึกเสมอ ถ้ามีแถวผิด จะบอกเลขแถวให้แก้ไข'],
];

/** Template with examples (sheet "สินค้า") and how-to (sheet "วิธีกรอก"). */
export function buildTemplateWorkbook(XLSX: XLSXLib) {
  const r = (o: Partial<Record<keyof typeof COL, unknown>>) => Object.fromEntries(COLUMN_ORDER.map((h) => {
    const key = (Object.keys(COL) as (keyof typeof COL)[]).find((k) => COL[k] === h)!;
    return [h, o[key] ?? ''];
  }));
  const examples = [
    r({ sku: 'DRK-001', name: 'น้ำดื่มตราช้าง 600 มล.', category: 'เครื่องดื่ม', unit: 'ขวด', barcode: '8850001111111', cost: 4.5, p1: 7, p2: 6.8, p3: 6.5, stock: 10, description: 'ขายเป็นขวด / แพ็ค 6 / ลัง 12' }),
    r({ sku: 'DRK-001', unit: 'แพ็ค', perPrev: 6, barcode: '8850001111128', p1: 39, p2: 38, stock: 3 }),
    r({ sku: 'DRK-001', unit: 'ลัง', perPrev: 2, barcode: '8850001111135', p1: 75, p2: 72, stock: 5 }),
    r({ sku: 'NDL-001', name: 'บะหมี่กึ่งสำเร็จรูป รสต้มยำ', category: 'อาหารแห้ง', unit: 'ซอง', barcode: '8850002222222, 8850002222239', cost: 5.2, p1: 7, stock: 24 }),
    r({ sku: 'NDL-001', unit: 'แพ็ค', perPrev: 10, barcode: '8850002222246', p1: 65 }),
    r({ sku: 'NDL-001', unit: 'ลัง', perPrev: 3, barcode: '8850002222253', p1: 190, stock: 4 }),
    r({ sku: 'CEM-050', name: 'ปูนซีเมนต์ 50 กก.', category: 'วัสดุก่อสร้าง', unit: 'ถุง', barcode: '8850003333333', cost: 128, p1: 145, p2: 140, stock: 40 }),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, examples), UNITS_SHEET);
  const how = XLSX.utils.aoa_to_sheet(HOW_TO);
  how['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, how, 'วิธีกรอก');
  return wb;
}

/** A packaging unit as product lists carry it (server row or the products page's form shape). */
export interface ExportablePackagingUnit {
  name?: string;
  unitName?: string;
  qtyPerPrev?: unknown;
  barcode?: string | null;
  priceLevel1?: unknown;
  priceLevel2?: unknown;
  priceLevel3?: unknown;
  priceLevel4?: unknown;
  priceLevel5?: unknown;
}

/** A product as the export reads it: server products or the products page's list; numbers may be strings. */
export interface ExportableProduct {
  id?: string;
  sku?: string;
  name?: string;
  category?: string | { name?: string } | null;
  unit?: string | null;
  description?: string | null;
  barcode?: string | null;
  barcodes?: Array<string | { barcode?: string } | null>;
  packagingUnits?: ExportablePackagingUnit[];
  costPrice?: unknown;
  cost?: unknown;
  basePrice?: unknown;
  price?: unknown;
  priceLevel1?: unknown;
  priceLevel2?: unknown;
  priceLevel3?: unknown;
  priceLevel4?: unknown;
  priceLevel5?: unknown;
  stock?: unknown;
  computedStock?: unknown;
}

/** Current products in the same per-unit format (export -> edit -> import round trip). */
export function buildExportWorkbook(XLSX: XLSXLib, products: ExportableProduct[], opts: { withCost: boolean }) {
  const rows: Record<string, unknown>[] = [];
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? '' : Number(v));
  for (const p of products) {
    const codes = [
      p.barcode,
      ...(Array.isArray(p.barcodes) ? p.barcodes.map((b) => (typeof b === 'string' ? b : b?.barcode)) : []),
    ].filter(Boolean);
    const packs: ExportablePackagingUnit[] = Array.isArray(p.packagingUnits) ? p.packagingUnits : [];
    const packCodes = new Set(packs.map((u) => u?.barcode).filter(Boolean));
    const baseCodes = Array.from(new Set(codes)).filter((c) => !packCodes.has(c));
    rows.push({
      [COL.sku]: p.sku || '',
      [COL.name]: p.name || '',
      [COL.category]: (typeof p.category === 'object' ? p.category?.name : undefined) || (typeof p.category === 'string' ? p.category : '') || '',
      [COL.unit]: p.unit || 'ชิ้น',
      [COL.perPrev]: '',
      [COL.barcode]: baseCodes.join(', '),
      [COL.cost]: opts.withCost ? num(p.costPrice ?? p.cost) : '',
      [COL.p1]: num(p.priceLevel1 ?? p.basePrice ?? p.price),
      [COL.p2]: num(p.priceLevel2),
      [COL.p3]: num(p.priceLevel3),
      [COL.p4]: num(p.priceLevel4),
      [COL.p5]: num(p.priceLevel5),
      [COL.stock]: num(p.stock ?? p.computedStock ?? 0),
      [COL.description]: p.description || '',
      [COL.id]: p.id || '',
    });
    for (const u of packs) {
      rows.push({
        [COL.sku]: p.sku || '',
        [COL.unit]: u.name || u.unitName || '',
        [COL.perPrev]: num(u.qtyPerPrev),
        [COL.barcode]: u.barcode || '',
        [COL.p1]: num(u.priceLevel1),
        [COL.p2]: num(u.priceLevel2),
        [COL.p3]: num(u.priceLevel3),
        [COL.p4]: num(u.priceLevel4),
        [COL.p5]: num(u.priceLevel5),
        [COL.id]: p.id || '',
      });
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, rows), UNITS_SHEET);
  const how = XLSX.utils.aoa_to_sheet(HOW_TO);
  how['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, how, 'วิธีกรอก');
  return wb;
}
