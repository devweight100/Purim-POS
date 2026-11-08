/**
 * Purchase bill arithmetic (copy of backend/src/purchase-orders/po-calc.ts — keep both identical).
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
export type DiscountType = 'baht' | 'percent';

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
  return String(v) === 'percent' ? 'percent' : 'baht';
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
    const lineDiscount = r2(Math.min(baseAmount, discountType === 'percent' ? (baseAmount * Math.min(discountValue, 100)) / 100 : discountValue));
    return { quantity, unitCost, discountType, discountValue, vatType, vatRate, baseAmount, lineDiscount, afterLine: r2(baseAmount - lineDiscount) };
  });

  const sumAfterLine = r2(prepared.reduce((s, l) => s + l.afterLine, 0));
  const bdType = normDiscountType(billDiscount.type);
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
export function grossPerUnit(line: { quantity: number; total?: unknown; unitCost?: unknown }): number {
  const qty = Number(line.quantity) || 0;
  if (qty <= 0) return Number(line.unitCost) || 0;
  const total = Number(line.total);
  return Number.isFinite(total) ? total / qty : Number(line.unitCost) || 0;
}

/** Stock cost per unit: gross, or net when the shop claims VAT back (VAT-registered). */
export function stockCostPerUnit(
  line: { quantity: number; total?: unknown; netAmount?: unknown; unitCost?: unknown },
  shopVatRegistered: boolean,
): number {
  const qty = Number(line.quantity) || 0;
  if (qty <= 0) return Number(line.unitCost) || 0;
  const amount = shopVatRegistered ? Number(line.netAmount) : Number(line.total);
  const v = Number.isFinite(amount) ? amount / qty : Number(line.unitCost) || 0;
  return Math.round(v * 10000) / 10000;
}

// ── frontend only (not in the backend copy) ─────────────────────────────────────────────────────

/**
 * A purchase line ordered in a pack unit (e.g. 2 โหล x12 @ 120) expressed in BASE units for the
 * server, which stores and receives base units only: 24 units @ 10. When the pack price does not
 * divide into whole satang (100 / 12), the unit cost is rounded UP to the satang and the extra is
 * given back as a baht line discount, so the line amount, VAT and bill totals stay exactly the same.
 */
export function toBaseUnitLine(line: {
  quantity: number | string;
  unitCost: number | string;
  multiplier?: number | string | null;
  discountType?: string | null;
  discountValue?: number | string | null;
}): { quantity: number; unitCost: number; discountType: DiscountType; discountValue: number } {
  const mult = Math.max(1, Math.round(Number(line.multiplier) || 1));
  const quantity = Number(line.quantity) || 0;
  const unitCost = Number(line.unitCost) || 0;
  const discountType = normDiscountType(line.discountType);
  const discountValue = Math.max(0, Number(line.discountValue) || 0);
  if (mult === 1) return { quantity, unitCost, discountType, discountValue };

  const baseQty = quantity * mult;
  const costCents = Math.round(unitCost * 100);
  if (costCents % mult === 0) {
    return { quantity: baseQty, unitCost: costCents / mult / 100, discountType, discountValue };
  }
  const baseCost = Math.ceil(costCents / mult) / 100;
  const originalBase = r2(quantity * unitCost);
  const lineDiscount = r2(Math.min(originalBase, discountType === 'percent' ? (originalBase * Math.min(discountValue, 100)) / 100 : discountValue));
  const extra = r2(baseQty * baseCost - originalBase);
  return { quantity: baseQty, unitCost: baseCost, discountType: 'baht', discountValue: r2(lineDiscount + extra) };
}
