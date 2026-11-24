/**
 * Cart lines follow catalogue price changes (docs/pos-keys-refresh.md): a price edited in the back office while a
 * bill is open re-prices the lines that are priced by the catalogue (not a manual price, not an agreed online-order
 * price). The caller never runs it while the payment dialog is open, so a bill does not change mid-payment.
 */
import type { PriceLevel } from '@shared/price-level';
import { calculateSmartRollupAndPricing } from '../cart-pricing';
import { formatCurrency } from '../utils';
import type { CartItem, Product } from '../types';
import { unitCandidates } from './price-level';

export interface CartPriceChange {
  name: string;
  unitName: string;
  from: number;
  to: number;
}

/** manual price (F4) or agreed online-order price: never re-priced */
const keepsOwnPrice = (i: CartItem) => i.customPrice !== null || i.fixedPrice === true;

const sameNumbers = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((v, k) => Number(v) === Number(b[k]));

/** What decides a line's money: compared to tell whether anything changed at all. */
const pricingKey = (items: CartItem[]) =>
  JSON.stringify(items.map((i) => [i.productId, i.unitName, i.conversionFactor, i.quantity, i.originalPrice, i.customPrice, i.levelPrices, i.priceLevel, i.isWholesaleApplied ?? false]));

/** "ราคาอัปเดต ฿20.00 → ฿25.00" (shown under the line until the cart changes again) */
export function priceNoticeText(from: number, to: number): string {
  return `ราคาอัปเดต ${formatCurrency(from)} → ${formatCurrency(to)}`;
}

/** Short toast text: "ราคาอัปเดต: น้ำยาล้างจาน ฿20.00 → ฿25.00, … (+2)". */
export function priceChangeToast(changes: CartPriceChange[]): string {
  const shown = changes.slice(0, 2).map((c) => `${c.name} (${c.unitName}) ${formatCurrency(c.from)} → ${formatCurrency(c.to)}`);
  return `ราคาอัปเดต: ${shown.join(', ')}${changes.length > 2 ? ` (+${changes.length - 2} รายการ)` : ''}`;
}

/**
 * The cart re-priced from the current catalogue, or null when nothing changes. Lines of products that are not in the
 * catalogue (deleted, offline) keep their price.
 */
export function repriceCartFromCatalog(
  items: CartItem[],
  level: PriceLevel,
  findProduct: (productId: string) => Product | undefined,
): { items: CartItem[]; changes: CartPriceChange[] } | null {
  if (!items.length) return null;
  // lines of a product the catalogue does not have (deleted, not loaded yet) are left exactly as they are
  const unknown = items.filter((i) => !keepsOwnPrice(i) && !findProduct(i.productId));
  if (unknown.length === items.length) return null;
  const fresh = items.filter((i) => !unknown.includes(i)).map((i) => {
    if (keepsOwnPrice(i)) return i;
    const product = findProduct(i.productId)!;
    const levelPrices = unitCandidates(product, { id: i.unitId, unitName: i.unitName, factor: i.conversionFactor });
    return sameNumbers(levelPrices, i.levelPrices) ? i : { ...i, levelPrices: [...levelPrices] };
  });
  // the lines stay where the cashier sees them (the roll-up lists lines with a discount first): selection keeps its row
  const firstIndex = (line: CartItem) => {
    const k = items.findIndex((o) => o.productId === line.productId && o.unitName === line.unitName);
    return k >= 0 ? k : items.findIndex((o) => o.productId === line.productId);
  };
  const next = [...calculateSmartRollupAndPricing(fresh, level), ...unknown]
    .map((line, k) => ({ line, k, at: firstIndex(line) }))
    .sort((a, b) => (a.at === b.at ? a.k - b.k : a.at < 0 ? 1 : b.at < 0 ? -1 : a.at - b.at))
    .map((x) => x.line);
  if (pricingKey(next) === pricingKey(items)) return null;

  const changes: CartPriceChange[] = [];
  const out = next.map((line) => {
    const before = items.find((o) => o.productId === line.productId && o.conversionFactor === line.conversionFactor && o.unitName === line.unitName)
      ?? items.find((o) => o.productId === line.productId && o.conversionFactor === line.conversionFactor);
    if (!before || keepsOwnPrice(line)) return line;
    const from = before.originalPrice;
    const to = line.originalPrice;
    if (Math.abs(from - to) < 0.005) return before.priceNotice ? { ...line, priceNotice: before.priceNotice } : line;
    changes.push({ name: line.name, unitName: line.unitName, from, to });
    return { ...line, priceNotice: priceNoticeText(from, to) };
  });
  return { items: out, changes };
}
