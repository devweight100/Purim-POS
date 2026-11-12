import { round2, roundSatang } from './money';
import { subQty } from './qty';

/**
 * POS bill pricing: the cart preview (frontend/src/lib/store/cart-store.ts) and the checkout that
 * stores and charges the bill (backend/src/orders/orders.service.ts) both use these functions, so
 * the total the cashier sees is the total the server accepts.
 *
 * Prices are VAT-inclusive. Order of the bill:
 *   line = round(price x (qty - claimed qty) - line discount)
 *   subtotal = round(sum of lines)
 *   discount = bill discount + points discount + claim credit (never above the subtotal), rounded
 *   total = round(subtotal - discount)
 *   VAT inside the total = round(total x rate / (100 + rate)) when the store charges VAT
 */
export type DiscountKind = 'none' | 'baht' | 'percent';

export interface CartLineInput {
  /** price per unit as charged (custom price or the original price) */
  unitPrice: number;
  quantity: number;
  /** units of this line that are a claim replacement (not charged) */
  claimQuantity?: number | null;
  discountType?: DiscountKind | string | null;
  discountValue?: number | null;
  /**
   * false = the line carries no VAT (a product flagged non-VAT on this device). Products have no
   * such flag in the database, so for the server every line is a VAT line (the default).
   */
  hasVat?: boolean;
}

/** Quantity that is charged: quantity minus the claim-replacement units, never negative. */
export function chargeableQty(line: Pick<CartLineInput, 'quantity' | 'claimQuantity'>): number {
  return Math.max(0, subQty(line.quantity, line.claimQuantity || 0));
}

/** Line discount in baht (a baht discount is capped at the line value; percent is not rounded). */
export function cartLineDiscount(line: CartLineInput): number {
  const lineBefore = roundSatang(line.unitPrice * chargeableQty(line));
  const value = Number(line.discountValue) || 0;
  if (line.discountType === 'baht') return Math.min(value, lineBefore);
  if (line.discountType === 'percent') return lineBefore * (value / 100);
  return 0;
}

/** Line amount to the satang, the same rounding the server stores: round(qty x price - discount). */
export function cartLineTotal(line: CartLineInput): number {
  return Math.max(0, roundSatang(line.unitPrice * chargeableQty(line) - cartLineDiscount(line)));
}

/**
 * What the checkout payload carries for a line: unit price and the discount that makes
 * quantity x unitPrice - discountAmount equal the line total (claimed units count as discount).
 */
export function checkoutLineDiscount(line: CartLineInput): number {
  return Math.max(0, line.quantity * line.unitPrice - cartLineTotal(line));
}

/** Bill-level (ท้ายบิล) discount on the subtotal: baht capped at the subtotal, percent of it. */
export function billDiscountAmount(subtotal: number, type: DiscountKind | string | null | undefined, value: number | null | undefined): number {
  const v = Number(value) || 0;
  if (type === 'baht') return Math.min(v, subtotal);
  if (type === 'percent') return subtotal * (v / 100);
  return 0;
}

/** VAT contained in a VAT-inclusive amount; 0 when the rate is 0 (store does not charge VAT). */
export function vatIncluded(amount: number, vatRate: number): number {
  return vatRate > 0 ? round2((amount * vatRate) / (100 + vatRate)) : 0;
}

/** Store VAT rate as stored in settings (7 when missing / invalid). */
export function normVatRate(rate: unknown): number {
  const n = Number(rate);
  return rate !== null && rate !== undefined && rate !== '' && Number.isFinite(n) && n >= 0 ? n : 7;
}

/** Line amounts as stored by the checkout (see lineAmounts). */
export interface StoredLineAmounts {
  storedUnitPrice: number;
  total: number;
  storedDiscount: number;
}

/**
 * Line amounts stored by the checkout. The line total is computed from the price the cashier saw
 * (possibly with more than 2 decimals after a % discount) so it matches the payment, while the
 * stored unit price is rounded UP to the cent and the difference goes into the stored line
 * discount, so that quantity * unitPrice - discountAmount === total holds exactly for every row.
 */
export function lineAmounts(quantity: number, unitPrice: number, lineDiscount: number): StoredLineAmounts {
  const cents = Math.round(unitPrice * 100 * 10000) / 10000; // drop float noise below 1/10000 cent
  const storedUnitPrice = Math.ceil(cents - 1e-6) / 100;
  const total = roundSatang(quantity * unitPrice - lineDiscount);
  const storedDiscount = Math.max(0, roundSatang(quantity * storedUnitPrice - total));
  return { storedUnitPrice, total, storedDiscount };
}

/**
 * Bill totals from the stored line totals and the requested discount, exactly as the checkout
 * stores them. `vatRate` = 0 when the store does not charge VAT.
 */
export function billTotals(lineTotals: number[], discountAmount: number, vatRate: number) {
  const subtotal = roundSatang(lineTotals.reduce((s, t) => s + t, 0));
  const discount = roundSatang(Number(discountAmount) || 0);
  const totalAmount = round2(subtotal - discount);
  return { subtotal, discountAmount: discount, totalAmount, vatAmount: vatIncluded(totalAmount, vatRate) };
}

export interface CartTotalsInput {
  lines: CartLineInput[];
  billDiscountType?: DiscountKind | string | null;
  billDiscountValue?: number | null;
  /** baht value of the redeemed points (capped at what is left after the bill discount) */
  pointsDiscount?: number | null;
  /** claim credit (STORE_DISCOUNT claims), capped at what is left after bill + points */
  claimDiscount?: number | null;
  /** 0 when the store does not charge VAT */
  vatRate?: number;
}

/** Everything the POS shows for a cart, computed the way the checkout will store it. */
export function cartTotals(input: CartTotalsInput) {
  const lineTotals = input.lines.map(cartLineTotal);
  const rawSubtotal = lineTotals.reduce((s, t) => s + t, 0);
  const subtotal = roundSatang(rawSubtotal);
  const bill = billDiscountAmount(subtotal, input.billDiscountType, input.billDiscountValue);
  const points = Math.min(Number(input.pointsDiscount) || 0, Math.max(0, subtotal - bill));
  const claim = Math.min(Number(input.claimDiscount) || 0, Math.max(0, subtotal - bill - points));
  // the payload's discountAmount (bill + points + claim, never above the subtotal)
  const requestedDiscount = Math.min(bill + points + claim, subtotal);
  const vatRate = Number(input.vatRate) || 0;
  const totals = billTotals(lineTotals, requestedDiscount, vatRate);
  let vatAmount = totals.vatAmount;
  if (vatRate > 0 && input.lines.some((l) => l.hasVat === false)) {
    // only the VAT lines' share of the total (after the bill-level discounts) carries VAT
    const vatable = lineTotals.reduce((s, t, i) => s + (input.lines[i].hasVat === false ? 0 : t), 0);
    vatAmount = subtotal > 0 ? vatIncluded((vatable * Math.max(0, totals.totalAmount)) / subtotal, vatRate) : 0;
  }
  return {
    lineTotals,
    subtotal: totals.subtotal,
    billDiscountAmount: bill,
    pointsDiscountAmount: points,
    claimDiscountAmount: claim,
    requestedDiscount,
    discountAmount: totals.discountAmount,
    totalAmount: Math.max(0, totals.totalAmount),
    vatAmount,
  };
}

/** Loyalty points earned on a bill: one block of `units` per full `rateBaht` spent. */
export function earnedPoints(totalAmount: number, rateBaht: number, units: number): number {
  if (!(totalAmount > 0) || !(rateBaht > 0)) return 0;
  return Math.floor(totalAmount / rateBaht) * units;
}
