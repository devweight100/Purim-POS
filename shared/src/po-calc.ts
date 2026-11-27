/**
 * Purchase bill arithmetic: the one implementation used by the server (purchase-orders,
 * payables, finance, reports) and the purchase-order screens.
 *
 * Per line:  quantity x unitCost (price as written on the supplier's bill)
 *            - line discount (baht or %)
 *            - share of the bill discount (spread by line value)
 *            = line amount, then VAT per line:
 *              NONE      no VAT                       net = gross = amount
 *              INCLUDED  price already includes VAT   vat = amount x r/(100+r), gross = amount
 *              EXCLUDED  VAT is added on top          vat = amount x r/100,    gross = amount + vat
 * The supplier is owed the gross. Stock cost per unit is the gross (VAT cannot be claimed back)
 * unless the shop is VAT-registered, then it is the net.
 */

export type PoVatType = 'NONE' | 'INCLUDED' | 'EXCLUDED';
/**
 * Line discount: 'baht' = baht for the whole line (older lines), 'percent' = % of the line (= % of the unit price),
 * 'unit' = baht off EACH unit (grid entry, 2026-11-27): the line discount is quantity x value.
 */
export type DiscountType = 'baht' | 'percent' | 'unit';

export interface PoLineInput {
  quantity: number;
  unitCost: number;
  discountType?: string | null;
  discountValue?: number | string | null;
  vatType?: string | null;
  vatRate?: number | string | null;
}

export interface PoLineResult {
  quantity: number;
  unitCost: number;
  discountType: DiscountType;
  discountValue: number;
  vatType: PoVatType;
  vatRate: number;
  /** qty x unitCost */
  baseAmount: number;
  /** line discount + share of the bill discount */
  discountAmount: number;
  netAmount: number;
  vatAmount: number;
  /** amount owed for this line (incl. VAT) */
  total: number;
}

export interface PoTotals {
  lines: PoLineResult[];
  baseAmount: number;
  lineDiscountAmount: number;
  billDiscountAmount: number;
  discountAmount: number;
  subtotalAmount: number; // before VAT
  vatAmount: number;
  totalAmount: number; // owed to the supplier
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function normVatType(v: unknown): PoVatType {
  const s = String(v || '').toUpperCase();
  if (s === 'INCLUDED' || s === 'INCLUDE') return 'INCLUDED';
  if (s === 'EXCLUDED' || s === 'EXCLUDE') return 'EXCLUDED';
  return 'NONE';
}

export function normDiscountType(v: unknown): DiscountType {
  const s = String(v);
  return s === 'percent' ? 'percent' : s === 'unit' ? 'unit' : 'baht';
}

/** A line's own discount (before any share of the bill discount), never more than the line. */
export function lineOwnDiscount(baseAmount: number, quantity: number, type: unknown, value: unknown): number {
  const t = normDiscountType(type);
  const v = Math.max(0, Number(value) || 0);
  const raw = t === 'percent' ? (baseAmount * Math.min(v, 100)) / 100 : t === 'unit' ? (Number(quantity) || 0) * v : v;
  return r2(Math.min(baseAmount, raw));
}

export function calculatePurchaseBill(
  inputs: PoLineInput[],
  billDiscount: { type?: string | null; value?: number | string | null } = {},
): PoTotals {
  const prepared = inputs.map((i) => {
    const quantity = Number(i.quantity) || 0;
    const unitCost = Number(i.unitCost) || 0;
    const discountType = normDiscountType(i.discountType);
    const discountValue = Math.max(0, Number(i.discountValue) || 0);
    const vatType = normVatType(i.vatType);
    const rate = Number(i.vatRate);
    const vatRate = vatType === 'NONE' ? 0 : Number.isFinite(rate) && rate >= 0 ? rate : 7;
    const baseAmount = r2(quantity * unitCost);
    const lineDiscount = lineOwnDiscount(baseAmount, quantity, discountType, discountValue);
    return { quantity, unitCost, discountType, discountValue, vatType, vatRate, baseAmount, lineDiscount, afterLine: r2(baseAmount - lineDiscount) };
  });

  const sumAfterLine = r2(prepared.reduce((s, l) => s + l.afterLine, 0));
  const bdType = String(billDiscount.type) === 'percent' ? 'percent' : 'baht';
  const bdValue = Math.max(0, Number(billDiscount.value) || 0);
  const billDiscountAmount = r2(Math.min(sumAfterLine, bdType === 'percent' ? (sumAfterLine * Math.min(bdValue, 100)) / 100 : bdValue));

  // spread the bill discount over the lines by value; the last line takes the rounding rest
  let allocated = 0;
  const lastIdx = prepared.reduce((last, l, idx) => (l.afterLine > 0 ? idx : last), -1);
  const lines: PoLineResult[] = prepared.map((l, idx) => {
    let share = 0;
    if (billDiscountAmount > 0 && sumAfterLine > 0 && l.afterLine > 0) {
      share = idx === lastIdx ? r2(billDiscountAmount - allocated) : r2((billDiscountAmount * l.afterLine) / sumAfterLine);
      share = Math.min(share, l.afterLine);
      allocated = r2(allocated + share);
    }
    const amount = r2(l.afterLine - share);
    let netAmount = amount;
    let vatAmount = 0;
    let total = amount;
    if (l.vatType === 'INCLUDED') {
      vatAmount = r2((amount * l.vatRate) / (100 + l.vatRate));
      netAmount = r2(amount - vatAmount);
    } else if (l.vatType === 'EXCLUDED') {
      vatAmount = r2((amount * l.vatRate) / 100);
      total = r2(amount + vatAmount);
    }
    return {
      quantity: l.quantity,
      unitCost: l.unitCost,
      discountType: l.discountType,
      discountValue: l.discountValue,
      vatType: l.vatType,
      vatRate: l.vatRate,
      baseAmount: l.baseAmount,
      discountAmount: r2(l.lineDiscount + share),
      netAmount,
      vatAmount,
      total,
    };
  });

  const sum = (k: keyof PoLineResult) => r2(lines.reduce((s, l) => s + (Number(l[k]) || 0), 0));
  const lineDiscountAmount = r2(prepared.reduce((s, l) => s + l.lineDiscount, 0));
  return {
    lines,
    baseAmount: sum('baseAmount'),
    lineDiscountAmount,
    billDiscountAmount,
    discountAmount: r2(lineDiscountAmount + billDiscountAmount),
    subtotalAmount: sum('netAmount'),
    vatAmount: sum('vatAmount'),
    totalAmount: sum('total'),
  };
}

/** Amount owed per unit of a stored line (incl. VAT). */
export function grossPerUnit(line: { quantity: unknown; total?: unknown; unitCost?: unknown }): number {
  const qty = Number(line.quantity) || 0;
  if (qty <= 0) return Number(line.unitCost) || 0;
  const total = Number(line.total);
  return Number.isFinite(total) ? total / qty : Number(line.unitCost) || 0;
}

/**
 * Stock cost per BASE unit: gross, or net when the shop claims VAT back (VAT-registered). A line ordered in a pack
 * unit (unitFactor 12 = ลัง of 12) costs its pack price / 12 per base unit (FIFO batches are in base units).
 */
export function stockCostPerUnit(
  line: { quantity: unknown; total?: unknown; netAmount?: unknown; unitCost?: unknown; unitFactor?: unknown },
  shopVatRegistered: boolean,
): number {
  const factor = unitFactorOf(line.unitFactor);
  const qty = Number(line.quantity) || 0;
  if (qty <= 0) return Math.round(((Number(line.unitCost) || 0) / factor) * 10000) / 10000;
  const amount = shopVatRegistered ? Number(line.netAmount) : Number(line.total);
  const v = Number.isFinite(amount) ? amount / (qty * factor) : (Number(line.unitCost) || 0) / factor;
  return Math.round(v * 10000) / 10000;
}

// ── Pack units (2026-11-27, docs/po-grid-entry.md) ─────────────────────────────────────────────────────────
// A PO line may be ordered in one of the product's packaging units: quantity, unit price and received quantity are
// then in that unit (2 ลัง @ 1,200) and `unitFactor` is how many base units one pack holds (12). Stock and FIFO
// costs are in base units: base qty = qty x factor, cost per base unit = pack amount / factor.
// Lines written before this have no unit (factor 1 = the product's base unit).

/** A stored / sent unit factor: a whole number >= 1 (anything else = 1, the base unit). */
export function unitFactorOf(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Base units of a quantity given in a pack unit (2 decimals, like every stored quantity). */
export function baseQtyOf(quantity: unknown, unitFactor: unknown): number {
  return Math.round((Number(quantity) || 0) * unitFactorOf(unitFactor) * 100) / 100;
}

export interface PackUnitRow {
  id?: string | null;
  name?: string | null;
  qtyPerPrev?: number | string | null;
  barcode?: string | null;
}

export interface PoUnitOption {
  /** packaging unit id; null = the base unit */
  id: string | null;
  name: string;
  /** base units in one of this unit */
  factor: number;
  barcode: string | null;
}

/**
 * The units a product can be ordered in: its base unit, then each packaging unit in order, each one holding
 * qtyPerPrev of the one before (กล่อง = 12 ม้วน, ลัง = 10 กล่อง -> 120). Same chain as the product form / POS.
 */
export function poUnitOptions(baseUnit: string | null | undefined, packs: PackUnitRow[] | null | undefined): PoUnitOption[] {
  const out: PoUnitOption[] = [{ id: null, name: (baseUnit || '').trim() || 'ชิ้น', factor: 1, barcode: null }];
  let f = 1;
  for (const u of Array.isArray(packs) ? packs : []) {
    f = f * Math.max(1, Math.round(Number(u?.qtyPerPrev) || 1));
    const name = String(u?.name || '').trim();
    if (name) out.push({ id: u?.id ? String(u.id) : null, name, factor: f, barcode: u?.barcode ? String(u.barcode) : null });
  }
  return out;
}

/** One earlier purchase of the product (newest first): its unit factor and unit price in that unit. */
export interface PoPriceHistoryRow {
  unitFactor: number | string | null | undefined;
  unitCost: number | string;
}

/**
 * Default unit price of a new PO line (owner 2026-11-27): the last price paid to this supplier in the same unit;
 * else the last price paid to this supplier in any unit, converted by the factors; else the product's cost x factor.
 * `history` = this supplier's earlier lines of the product, newest first. Always editable on the screen.
 */
export function defaultPoUnitPrice(history: PoPriceHistoryRow[] | null | undefined, unitFactor: unknown, productCost: unknown): { price: number; source: 'same-unit' | 'other-unit' | 'cost' } {
  const f = unitFactorOf(unitFactor);
  const rows = Array.isArray(history) ? history.filter((h) => Number.isFinite(Number(h?.unitCost)) && Number(h.unitCost) >= 0) : [];
  const same = rows.find((h) => unitFactorOf(h.unitFactor) === f);
  if (same) return { price: r2(Number(same.unitCost)), source: 'same-unit' };
  const any = rows[0];
  if (any) return { price: r2((Number(any.unitCost) / unitFactorOf(any.unitFactor)) * f), source: 'other-unit' };
  return { price: r2(Math.max(0, Number(productCost) || 0) * f), source: 'cost' };
}

/**
 * Per-unit discount as typed in the grid: "5" = 5 baht off each unit, "5%" = 5 % of the unit price, "" = none.
 * Returns null when the text is not a discount (then the cell shows an error and keeps the old value).
 */
export function parseUnitDiscount(text: string): { discountType: 'unit' | 'percent'; discountValue: number } | null {
  const t = String(text ?? '').replace(/[,\s฿]/g, '').replace(/บาท$/, '');
  if (t === '') return { discountType: 'unit', discountValue: 0 };
  const m = /^(\d+(?:\.\d{0,2})?|\.\d{1,2})(%)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v < 0) return null;
  if (m[2]) return v > 100 ? null : { discountType: 'percent', discountValue: v };
  return { discountType: 'unit', discountValue: v };
}

/**
 * The grid's text for a stored line discount: percent -> "5%", per unit -> "5". An older whole-line baht discount
 * reads per unit when it divides exactly by the quantity (then `unit` is what the line becomes), else null
 * (the line keeps its whole-line discount and the cell says so).
 */
export function unitDiscountText(type: unknown, value: unknown, quantity: unknown): { text: string; discountType: DiscountType; discountValue: number } | null {
  const t = normDiscountType(type);
  const v = Math.max(0, Number(value) || 0);
  const fmt = (n: number) => String(r2(n));
  if (t === 'percent') return { text: v ? fmt(v) + '%' : '', discountType: 'percent', discountValue: v };
  if (t === 'unit') return { text: v ? fmt(v) : '', discountType: 'unit', discountValue: v };
  if (v === 0) return { text: '', discountType: 'unit', discountValue: 0 };
  const q = Number(quantity) || 0;
  if (q <= 0) return null;
  const per = v / q;
  if (Math.abs(r2(per) * q - v) > 0.0001) return null;
  return { text: fmt(per), discountType: 'unit', discountValue: r2(per) };
}
