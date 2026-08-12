import { Product } from './types';

export function formatStockDisplay(product: Product): string {
  if (!product.units || product.units.length === 0) {
    return `${product.stock} (ไม่มีหน่วย)`;
  }

  // Sort units descending by factor
  const sortedUnits = [...product.units].sort((a, b) => b.factor - a.factor);
  
  let remaining = product.stock;
  const parts: string[] = [];

  for (const u of sortedUnits) {
    if (u.factor <= 0) continue;
    const qty = Math.floor(remaining / u.factor);
    if (qty > 0) {
      parts.push(`${qty} ${u.unitName}`);
      remaining = remaining % u.factor;
    }
  }

  if (parts.length === 0 && product.stock === 0) {
    return `0 ${sortedUnits[sortedUnits.length - 1].unitName}`;
  }

  return parts.join(' ');
}
