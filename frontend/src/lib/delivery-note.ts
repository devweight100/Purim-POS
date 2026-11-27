/**
 * บิลส่งของ (delivery note, docs/pos-member-picker.md): a held bill / the current cart / a held online order printed
 * with its lines, prices, discounts, delivery fee and the amount still to collect, for delivering the goods or
 * collecting the money. NOT a receipt: no receipt number, no VAT / tax-invoice wording, no payment method or change.
 * Printing sells nothing, moves no stock, takes no document number and leaves the held bill as it is.
 *
 * The amounts are the held bill's own at print time, from the same shared pricing functions as the cart and the
 * checkout (shared/src/pricing.ts). The payment re-checks the prices as today; a later price change can make the
 * paid total differ from a printed note.
 */
import { cartLineTotal, cartTotals, type CartLineInput } from '@shared/pricing';
import { DELIVERY_FEE_SKU } from './picking-slip';
import type { CartItem, HeldBill, PendingClaimItem } from './types';

export type DeliveryNoteSource = 'held' | 'cart' | 'online';

export interface DeliveryNoteLine {
  name: string;
  quantity: number;
  unitName: string;
  unitPrice: number;
  /** baht off this line (item discount, claimed units) */
  discount: number;
  lineTotal: number;
  note?: string;
}

export interface DeliveryNoteData {
  source: DeliveryNoteSource;
  /** held bill label / online order no. / '' for the current cart */
  reference: string;
  /** when the bill was held / the online order was placed */
  heldAt?: string | null;
  printedAt: string;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  note: string | null;
  /** online orders: ส่ง / รับเองที่ร้าน */
  fulfillment?: 'PICKUP' | 'DELIVERY' | null;
  lines: DeliveryNoteLine[];
  /** sum of the goods lines (delivery fee not included) */
  goodsTotal: number;
  billDiscount: number;
  pointsDiscount: number;
  claimDiscount: number;
  /** null = no fee line; online delivery with the fee not set yet: feePending */
  deliveryFee: number | null;
  feePending?: boolean;
  /** what the customer pays */
  total: number;
  cashierName: string | null;
  /** online orders: delivery notes printed before this one */
  printCount?: number;
}

export const DELIVERY_NOTE_TITLE = 'บิลส่งของ';
export const DELIVERY_NOTE_REF_LABEL: Record<DeliveryNoteSource, string> = { held: 'บิลพัก', cart: 'ตะกร้า', online: 'ออเดอร์ออนไลน์' };

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function pricingLine(item: CartItem): CartLineInput {
  return {
    unitPrice: item.customPrice ?? item.originalPrice,
    quantity: item.quantity,
    claimQuantity: item.claimQuantity || 0,
    discountType: item.discountType,
    discountValue: item.discountValue,
    hasVat: item.hasVat,
  };
}

/** claim credit of the STORE_DISCOUNT pending claims (the cart's own rule) */
function pendingClaimCredit(claims: PendingClaimItem[] | undefined, attached?: { discountAmount?: number; quantity: number; unitPrice: number } | null) {
  let total = 0;
  if (attached) total += attached.discountAmount ?? attached.quantity * attached.unitPrice;
  for (const c of (claims || []).filter((p) => p.resolutionType === 'STORE_DISCOUNT')) total += c.discountAmount ?? c.quantity * c.unitPrice;
  return total;
}

const isFeeLine = (i: CartItem) => i.sku === DELIVERY_FEE_SKU;

export interface CartLikeBill {
  items: CartItem[];
  customerName?: string | null;
  billDiscountType?: HeldBill['billDiscountType'];
  billDiscountValue?: number;
  pointsDiscountValue?: number;
  pendingClaims?: PendingClaimItem[];
  attachedClaim?: { discountAmount?: number; quantity: number; unitPrice: number } | null;
  note?: string | null;
}

/** A held bill (or the current cart) -> delivery note, with the amounts it holds now. */
export function billToDeliveryNote(
  bill: CartLikeBill,
  opts: {
    source: 'held' | 'cart';
    reference?: string;
    heldAt?: string | null;
    printedAt?: string;
    customer?: { name?: string | null; phone?: string | null; address?: string | null; taxAddress?: string | null } | null;
    cashierName?: string | null;
  },
): DeliveryNoteData {
  const totals = cartTotals({
    lines: bill.items.map(pricingLine),
    billDiscountType: bill.billDiscountType || 'none',
    billDiscountValue: bill.billDiscountValue || 0,
    pointsDiscount: bill.pointsDiscountValue || 0,
    claimDiscount: pendingClaimCredit(bill.pendingClaims, bill.attachedClaim),
    vatRate: 0, // VAT is included in the prices; the total is the same with or without it
  });
  const goods = bill.items.filter((i) => !isFeeLine(i));
  const fees = bill.items.filter(isFeeLine);
  const lines = goods.map((i) => {
    const p = pricingLine(i);
    const lineTotal = cartLineTotal(p);
    return {
      name: i.name,
      quantity: i.quantity,
      unitName: i.unitName,
      unitPrice: p.unitPrice,
      discount: Math.max(0, round2(p.unitPrice * i.quantity - lineTotal)),
      lineTotal,
      note: i.itemNote || undefined,
    };
  });
  const c = opts.customer;
  const address = (c?.address || '').trim() || (c?.taxAddress || '').trim() || null;
  return {
    source: opts.source,
    reference: opts.reference || '',
    heldAt: opts.heldAt || null,
    printedAt: opts.printedAt || new Date().toISOString(),
    customerName: c?.name || bill.customerName || null,
    phone: c?.phone || null,
    address,
    note: bill.note?.trim() || null,
    lines,
    goodsTotal: round2(lines.reduce((s, l) => s + l.lineTotal, 0)),
    billDiscount: totals.billDiscountAmount,
    pointsDiscount: totals.pointsDiscountAmount,
    claimDiscount: totals.claimDiscountAmount,
    deliveryFee: fees.length ? round2(fees.reduce((s, i) => s + cartLineTotal(pricingLine(i)), 0)) : null,
    total: totals.totalAmount,
    cashierName: opts.cashierName || null,
  };
}

/** GET /online-shop/orders/:id/delivery-note */
export interface OnlineDeliveryNotePayload {
  orderNo: string;
  createdAt: string;
  fulfillment: 'PICKUP' | 'DELIVERY';
  customerName: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  lines: { name: string; unitName: string; quantity: number; unitPrice: number; lineTotal: number; isService?: boolean }[];
  subtotal: number;
  deliveryFee: number | null;
  totalAmount: number;
  printCount: number;
}

/** A held online order -> delivery note at the agreed prices and fee. */
export function onlineToDeliveryNote(p: OnlineDeliveryNotePayload, opts: { cashierName?: string | null; printedAt?: string } = {}): DeliveryNoteData {
  const lines = p.lines.map((l) => ({
    name: l.name,
    quantity: l.quantity,
    unitName: l.unitName,
    unitPrice: l.unitPrice,
    discount: Math.max(0, round2(l.unitPrice * l.quantity - l.lineTotal)),
    lineTotal: l.lineTotal,
  }));
  const goodsTotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const delivery = p.fulfillment === 'DELIVERY';
  return {
    source: 'online',
    reference: p.orderNo,
    heldAt: p.createdAt,
    printedAt: opts.printedAt || new Date().toISOString(),
    customerName: p.customerName || null,
    phone: p.phone,
    address: delivery ? p.address : null,
    note: p.note,
    fulfillment: p.fulfillment,
    lines,
    goodsTotal,
    billDiscount: Math.max(0, round2(goodsTotal - p.subtotal)),
    pointsDiscount: 0,
    claimDiscount: 0,
    deliveryFee: delivery ? p.deliveryFee : null,
    feePending: delivery && p.deliveryFee === null,
    total: p.totalAmount,
    cashierName: opts.cashierName || null,
    printCount: p.printCount,
  };
}
