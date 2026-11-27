// Pure model of the PO entry grid (docs/po-grid-entry.md): rows, cell order for Enter / Shift+Enter, what is sent to
// the server. The arithmetic is shared/src/po-calc.ts (the server recalculates and validates every line).
import {
  normVatType,
  parseUnitDiscount,
  poUnitOptions,
  unitDiscountText,
  unitFactorOf,
  type PackUnitRow,
  type PoLineInput,
  type PoUnitOption,
  type PoVatType,
} from '@shared/po-calc';

/** A product as the grid needs it (a GET /products/page row, a catalogue product or a PO line's product). */
export interface PoGridProduct {
  id: string;
  name: string;
  sku: string;
  unit?: string | null;
  stock?: number | string | null;
  costPrice?: number | string | null;
  imageUrl?: string | null;
  manufacturerName?: string | null;
  suppliers?: Array<{ supplierId?: string; supplierProductName?: string | null; supplierSku?: string | null }>;
  barcodes?: Array<string | { barcode?: string | null }>;
  packagingUnits?: PackUnitRow[];
}

export interface PoGridRow {
  key: string;
  /** stored PO line id (editing) */
  id?: string;
  product: PoGridProduct | null;
  /** text of the code cell (the SKU once a product is chosen) */
  code: string;
  /** text of the name cell while no product is chosen */
  name: string;
  qty: string;
  unitId: string | null;
  unitName: string | null;
  unitFactor: number;
  price: string;
  /** the price was typed by the user (a late default price never overwrites it) */
  priceEdited: boolean;
  discount: string;
  /** an older line's whole-line baht discount that does not divide per unit: kept until the cell is edited */
  legacyDiscount: number | null;
  vatType: PoVatType;
  vatRate: number;
}

export const GRID_COLS = ['code', 'name', 'qty', 'unit', 'price', 'discount', 'vat'] as const;
export type GridCol = (typeof GRID_COLS)[number];

let seq = 0;
export const newRowKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankRow(vatType: PoVatType = 'NONE', vatRate = 7): PoGridRow {
  return {
    key: newRowKey(), product: null, code: '', name: '', qty: '', unitId: null, unitName: null, unitFactor: 1,
    price: '', priceEdited: false, discount: '', legacyDiscount: null, vatType, vatRate,
  };
}

export const isBlank = (r: PoGridRow) => !r.product && !r.code.trim() && !r.name.trim();

/** Always exactly one empty row at the bottom for the next item. */
export function withTrailingBlank(rows: PoGridRow[], vatType: PoVatType = 'NONE'): PoGridRow[] {
  let end = rows.length;
  while (end > 0 && isBlank(rows[end - 1])) end--;
  const kept = rows.slice(0, end);
  const lastBlank = end < rows.length ? rows[end] : null;
  return [...kept, lastBlank ?? blankRow(vatType)];
}

/** Units the row can use: base + the product's packs; a stored pack the product no longer has stays selectable. */
export function rowUnits(row: PoGridRow): PoUnitOption[] {
  const opts = poUnitOptions(row.product?.unit, row.product?.packagingUnits);
  if (row.unitFactor > 1 && row.unitName && !opts.some((o) => o.name === row.unitName && o.factor === row.unitFactor)) {
    opts.push({ id: row.unitId, name: row.unitName, factor: row.unitFactor, barcode: null });
  }
  return opts;
}

export function unitIndex(row: PoGridRow): number {
  const opts = rowUnits(row);
  if (row.unitFactor <= 1 && !row.unitId) return 0;
  const i = opts.findIndex((o) => (row.unitId && o.id === row.unitId) || (o.name === row.unitName && o.factor === row.unitFactor));
  return i >= 0 ? i : 0;
}

export const num = (s: string | number | null | undefined) => {
  const t = String(s ?? '').replace(/[,\s฿]/g, '');
  if (t === '') return NaN;
  return Number(t);
};

/** The line as po-calc reads it (a row without a product counts as nothing). */
export function rowLine(row: PoGridRow): PoLineInput {
  const quantity = row.product ? Math.max(0, num(row.qty) || 0) : 0;
  const unitCost = Math.max(0, num(row.price) || 0);
  const d = row.legacyDiscount !== null ? { discountType: 'baht', discountValue: row.legacyDiscount } : parseUnitDiscount(row.discount) || { discountType: 'unit', discountValue: 0 };
  return { quantity, unitCost, discountType: d.discountType, discountValue: d.discountValue, vatType: row.vatType, vatRate: row.vatRate };
}

/** What is wrong with a filled row (Thai, shown on the cell / when saving), or null. */
export function rowError(row: PoGridRow, allowDecimal: boolean): { col: GridCol; message: string } | null {
  if (!row.product) return row.code.trim() || row.name.trim() ? { col: row.name.trim() && !row.code.trim() ? 'name' : 'code', message: 'ยังไม่ได้เลือกสินค้า (กด Enter เพื่อค้นหา)' } : null;
  const q = num(row.qty);
  if (!Number.isFinite(q) || q <= 0) return { col: 'qty', message: 'จำนวนต้องมากกว่า 0' };
  if (Math.abs(q * 100 - Math.round(q * 100)) > 1e-6) return { col: 'qty', message: 'จำนวนมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' };
  if (!allowDecimal && !Number.isInteger(q)) return { col: 'qty', message: 'ร้านไม่ได้เปิดใช้จำนวนทศนิยม' };
  const p = num(row.price);
  if (!Number.isFinite(p) || p < 0) return { col: 'price', message: 'ราคาต่อหน่วยไม่ถูกต้อง' };
  if (row.legacyDiscount === null) {
    const d = parseUnitDiscount(row.discount);
    if (!d) return { col: 'discount', message: 'ส่วนลดไม่ถูกต้อง (เช่น 5 = 5 บาทต่อหน่วย, 5% = 5%)' };
    if (d.discountType === 'unit' && d.discountValue > p + 0.0001) return { col: 'discount', message: 'ส่วนลดต่อหน่วยมากกว่าราคาต่อหน่วย' };
  }
  return null;
}

/** The cells Enter visits in a row: code, name (only while no product), qty, unit, price, discount, VAT (when shown). */
export function rowCells(row: PoGridRow, showVat: boolean): GridCol[] {
  return GRID_COLS.filter((c) => !(c === 'name' && row.product) && !(c === 'vat' && !showVat));
}

/** Next cell for Enter (dir 1) / Shift+Enter (dir -1); null = nowhere to go. */
export function stepCell(rows: PoGridRow[], at: { row: number; col: GridCol }, dir: 1 | -1, showVat: boolean): { row: number; col: GridCol } | null {
  const cells = rowCells(rows[at.row], showVat);
  let i = cells.indexOf(at.col);
  if (i < 0) i = dir === 1 ? -1 : cells.length;
  const j = i + dir;
  if (j >= 0 && j < cells.length) return { row: at.row, col: cells[j] };
  const r = at.row + dir;
  if (r < 0 || r >= rows.length) return null;
  const other = rowCells(rows[r], showVat);
  return { row: r, col: dir === 1 ? 'code' : other[other.length - 1] };
}

export interface PoApiItem {
  productId: string;
  quantity: number;
  unitCost: number;
  unitId: string | null;
  unitName: string | null;
  unitFactor: number;
  discountType: string;
  discountValue: number;
  vatType: PoVatType;
  vatRate: number;
}

export function toApiItems(rows: PoGridRow[]): PoApiItem[] {
  return rows.filter((r) => r.product).map((r) => {
    const l = rowLine(r);
    return {
      productId: r.product!.id,
      quantity: Number(l.quantity),
      unitCost: Number(l.unitCost),
      unitId: r.unitFactor > 1 ? r.unitId : null,
      unitName: r.unitFactor > 1 ? r.unitName : null,
      unitFactor: r.unitFactor,
      discountType: String(l.discountType),
      discountValue: Number(l.discountValue) || 0,
      vatType: normVatType(r.vatType),
      vatRate: r.vatRate,
    };
  });
}

const money = (n: number) => String(Math.round(n * 100) / 100);

/** Rows of a stored PO (editing). `products` = what is known of each product (packs, stock, ...). */
export function rowsFromPoItems(
  items: Array<{
    id?: string; productId?: string; quantity: unknown; unitCost: unknown; unitId?: string | null; unitName?: string | null; unitFactor?: unknown;
    multiplier?: unknown; discountType?: string | null; discountValue?: unknown; vatType?: string | null; vatRate?: unknown;
    product?: { name?: string; sku?: string; unit?: string; manufacturerName?: string | null } | null; name?: string; sku?: string;
  }>,
  products: Map<string, PoGridProduct>,
  fallbackVat: PoVatType = 'NONE',
): PoGridRow[] {
  return items.map((i) => {
    const pid = String(i.productId || '');
    const known = products.get(pid);
    const product: PoGridProduct = known || {
      id: pid,
      name: i.product?.name || i.name || 'สินค้า',
      sku: i.product?.sku || i.sku || '',
      unit: i.product?.unit,
      manufacturerName: i.product?.manufacturerName ?? null,
    };
    const qty = Number(i.quantity) || 0;
    const d = unitDiscountText(i.discountType, i.discountValue, qty);
    const vatType = normVatType(i.vatType ?? fallbackVat);
    const factor = unitFactorOf(i.unitFactor ?? i.multiplier);
    return {
      key: newRowKey(),
      id: i.id,
      product,
      code: product.sku,
      name: '',
      qty: String(qty),
      unitId: i.unitId ?? null,
      unitName: factor > 1 ? i.unitName ?? null : null,
      unitFactor: factor,
      price: money(Number(i.unitCost) || 0),
      priceEdited: true,
      discount: d ? d.text : '',
      legacyDiscount: d ? null : Math.max(0, Number(i.discountValue) || 0),
      vatType,
      vatRate: vatType === 'NONE' ? 7 : Number.isFinite(Number(i.vatRate)) ? Number(i.vatRate) : 7,
    };
  });
}

/** Bill discount typed in the footer: "100" = 100 baht, "5%" = 5 %. */
export function parseBillDiscount(text: string): { type: 'baht' | 'percent'; value: number } | null {
  const d = parseUnitDiscount(text);
  if (!d) return null;
  return { type: d.discountType === 'percent' ? 'percent' : 'baht', value: d.discountValue };
}

/** Exact code match of a search row: SKU (any case), barcode or pack barcode -> the unit it names. */
export function exactCodeUnit(p: PoGridProduct, code: string): PoUnitOption | null {
  const c = code.trim();
  if (!c) return null;
  const opts = poUnitOptions(p.unit, p.packagingUnits);
  const pack = opts.find((o) => o.barcode && o.barcode === c);
  if (pack) return pack;
  if ((p.sku || '').toLowerCase() === c.toLowerCase()) return opts[0];
  const bcs = (p.barcodes || []).map((b) => (typeof b === 'string' ? b : b?.barcode || ''));
  if (bcs.includes(c)) return opts[0];
  return null;
}
