import type { CartItem } from '../types';

/**
 * The cart line the cashier touched last (scan, card / search / keyboard add, +/-, quantity edit, unit change).
 * The POS highlights it, scrolls to it and shows "ล่าสุด: ..." so a scan of an item that is already far up in a
 * long bill visibly registers. A line is identified like the cart rows themselves: productId + unitId.
 */
export interface LastTouchedLine {
  productId: string;
  unitId: string;
  /** grows on every touch, also when the same line is touched again (drives the flash / "+1" animation) */
  seq: number;
  /** quantity change of that line caused by the touch (+1 for a scan, 0 for a unit change) */
  delta: number;
}

let seqCounter = 0;
/** Next touch number (module-wide, so a cleared and re-touched line still gets a new number). */
export const nextTouchSeq = () => ++seqCounter;

export const cartLineKey = (l: { productId: string; unitId: string }) => `${l.productId}-${l.unitId}`;

/** Lines the smart rollup may re-key (no custom price / discount / claim); see calculateSmartRollupAndPricing. */
const isRolledLine = (i: CartItem) => i.customPrice === null && i.discountType === 'none' && !(i.claimQuantity && i.claimQuantity > 0);

/**
 * The line of `items` that stands for (productId, unitId) after the smart rollup ran: the same unit when it is
 * still there, else the product's line in a unit of the same size, else the product's first rolled line
 * (e.g. 11 pieces + 1 scanned piece became 1 pack), else the product's first line. null when the product is gone.
 */
export function findTouchedLine(items: CartItem[], productId: string, unitId: string, factor?: number): CartItem | null {
  const exact = items.find((i) => i.productId === productId && i.unitId === unitId);
  if (exact) return exact;
  const lines = items.filter((i) => i.productId === productId);
  if (lines.length === 0) return null;
  const rolled = lines.filter(isRolledLine);
  if (factor !== undefined) {
    const sameSize = rolled.find((i) => (i.conversionFactor || 1) === factor) || lines.find((i) => (i.conversionFactor || 1) === factor);
    if (sameSize) return sameSize;
  }
  return rolled[0] || lines[0];
}

/**
 * New last-touched state after a touch of (productId, unitId) turned `before` into `after`.
 * delta = the resolved line's quantity now minus that line's quantity before (0 when it is new).
 */
export function touchLine(before: CartItem[], after: CartItem[], productId: string, unitId: string, factor?: number): LastTouchedLine | null {
  const line = findTouchedLine(after, productId, unitId, factor);
  if (!line) return null;
  const prev = before.find((i) => i.productId === line.productId && i.unitId === line.unitId);
  const delta = Math.round((line.quantity - (prev?.quantity ?? 0)) * 100) / 100;
  return { productId: line.productId, unitId: line.unitId, seq: nextTouchSeq(), delta };
}

/**
 * Keep the last-touched line pointing at the same line after a change that is not a touch of it (another line
 * removed, rollup re-keyed the product's lines). Keeps seq so nothing flashes. null when its product is gone.
 */
export function followTouchedLine(last: LastTouchedLine | null, before: CartItem[], after: CartItem[]): LastTouchedLine | null {
  if (!last) return null;
  if (after.some((i) => i.productId === last.productId && i.unitId === last.unitId)) return last;
  const old = before.find((i) => i.productId === last.productId && i.unitId === last.unitId);
  const line = findTouchedLine(after, last.productId, last.unitId, old ? old.conversionFactor || 1 : undefined);
  return line ? { ...last, productId: line.productId, unitId: line.unitId } : null;
}
