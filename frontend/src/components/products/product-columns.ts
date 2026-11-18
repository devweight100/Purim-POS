/**
 * Products table columns by the table's own width (owner 2026-11-18: price levels as their own columns, at least
 * ราคา 1-3 at 1366x768 and 1093x614, 1-5 at 1920x1080, never a sideways scroll). Pure, so it can be unit tested.
 *
 * Fixed columns: select 32, expand 28, quantity + unit 112 (number and unit side by side), cost 80 (VIEW_COST
 * only), edit 40, category 104 (128 on wide tables) from CATEGORY_TABLE px, otherwise a small chip under the name.
 * Each price column is 80 px (96 on wide tables, 68 when levels 4-5 are forced into a narrow table). The name column
 * (name only since round 4: no photo, no barcodes) takes the rest and keeps at least NAME_MIN.
 */
export const NAME_MIN = 240;
export const COL = { select: 32, expand: 28, stock: 112, cost: 80, edit: 40, category: 104, categoryWide: 128 } as const;
/** table width from which the category is a narrow column of its own (round 4: 1366x768 in both sidebar states) */
export const CATEGORY_TABLE = 1000;
/** table width from which the price and category columns are wider */
export const WIDE_TABLE = 1300;

export interface ProductColumns {
  /** price levels shown as columns (1..n) */
  levels: number[];
  /** width of one price column, px */
  priceWidth: number;
  showCategory: boolean;
  /** width of the category column, px (when showCategory) */
  categoryWidth: number;
  /** levels 4-5 do not fit by themselves: offer the "แสดงราคา 4–5" switch */
  canForce: boolean;
  /** narrow table with forced levels: smaller numbers, no photo in the name cell */
  tight: boolean;
}

export function productColumns(tableWidth: number, opts: { showCost: boolean; force45: boolean }): ProductColumns {
  const w = tableWidth > 0 ? tableWidth : 1000;
  const showCategory = w >= CATEGORY_TABLE;
  const wide = w >= WIDE_TABLE;
  const categoryWidth = wide ? COL.categoryWide : COL.category;
  const fixed = COL.select + COL.expand + COL.stock + COL.edit + (opts.showCost ? COL.cost : 0) + (showCategory ? categoryWidth : 0);
  const priceWidth = wide ? 96 : 80;
  const auto = Math.max(3, Math.min(5, Math.floor((w - fixed - NAME_MIN) / priceWidth)));
  const canForce = auto < 5;
  if (canForce && opts.force45) {
    return { levels: [1, 2, 3, 4, 5], priceWidth: 68, showCategory, categoryWidth, canForce, tight: true };
  }
  return { levels: Array.from({ length: auto }, (_, i) => i + 1), priceWidth, showCategory, categoryWidth, canForce, tight: false };
}
