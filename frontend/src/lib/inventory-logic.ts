import { Product } from './types';
import { formatQty } from './qty';

export function formatStockDisplay(product: Product): string {
  if (!product.units || product.units.length === 0) {
    return `${product.stock} (ไม่มีหน่วย)`;
  }

  if (product.stock < 0) {
    const baseUnit = product.unit || product.units[0]?.unitName || 'ชิ้น';
    return `ติดลบ ${Math.abs(product.stock).toLocaleString()} ${baseUnit}`;
  }

  // Sort units descending by factor
  const sortedUnits = [...product.units].sort((a, b) => b.factor - a.factor);
  
  // whole hundredths: decimal stock (7.25 m) splits without float residue
  let remainingH = Math.round(product.stock * 100);
  const parts: string[] = [];

  for (const u of sortedUnits) {
    if (u.factor <= 0) continue;
    const unitH = Math.round(u.factor * 100);
    const qty = u.factor === 1 ? remainingH / 100 : Math.floor(remainingH / unitH);
    if (qty > 0) {
      parts.push(`${formatQty(qty)} ${u.unitName}`);
      remainingH = u.factor === 1 ? 0 : remainingH % unitH;
    }
  }

  if (parts.length === 0 && product.stock === 0) {
    return `0 ${sortedUnits[sortedUnits.length - 1].unitName}`;
  }

  return parts.join(' ');
}
