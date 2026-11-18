/**
 * Products table columns by the table's own width (owner 2026-11-18: price levels as their own columns, at least
 * ราคา 1-3 at 1366x768 and 1093x614, 1-5 at 1920x1080, never a sideways scroll). Pure, so it can be unit tested.
 *
 * Fixed columns: select 32, expand 28, quantity + unit 84, cost 80 (VIEW_COST only), edit 40, category 140 (wide
 * tables only, otherwise a chip under the name). Each price column is 80 px (96 on wide tables, 68 when levels 4-5
 * are forced into a narrow table). The name column takes the rest and keeps at least NAME_MIN.
 */
export const NAME_MIN = 280;
export const COL = { select: 32, expand: 28, stock: 84, cost: 80, edit: 40, category: 140 } as const;
/** table width from which the category gets its own column and the price columns are wider */
export const WIDE_TABLE = 1300;

export interface ProductColumns {
  /** price levels shown as columns (1..n) */
  levels: number[];
  /** width of one price column, px */
  priceWidth: number;
  showCategory: boolean;
  /** levels 4-5 do not fit by themselves: offer the "แสดงราคา 4–5" switch */
  canForce: boolean;
  /** narrow table with forced levels: smaller numbers, no photo in the name cell */
  tight: boolean;
}

export function productColumns(tableWidth: number, opts: { showCost: boolean; force45: boolean }): ProductColumns {
  const w = tableWidth > 0 ? tableWidth : 1000;
  const showCategory = w >= WIDE_TABLE;
  const fixed = COL.select + COL.expand + COL.stock + COL.edit + (opts.showCost ? COL.cost : 0) + (showCategory ? COL.category : 0);
  const priceWidth = showCategory ? 96 : 80;
  const auto = Math.max(3, Math.min(5, Math.floor((w - fixed - NAME_MIN) / priceWidth)));
  const canForce = auto < 5;
  if (canForce && opts.force45) {
    return { levels: [1, 2, 3, 4, 5], priceWidth: 68, showCategory, canForce, tight: true };
  }
  return { levels: Array.from({ length: auto }, (_, i) => i + 1), priceWidth, showCategory, canForce, tight: false };
}
