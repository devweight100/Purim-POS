/**
 * Cost per unit shown in the products / inventory tables.
 *
 * - displayUnitCost: the cost the owner typed in the product form (`costPrice`, the reference cost used for new
 *   stock) when entered (> 0), else the cost of the stock on hand (FIFO pool sent with the server's table rows). Editing ต้นทุน in the
 *   form shows up in the tables at once (owner request, v1.5.14).
 * - stockOnHandCost: the FIFO average of the stock on hand; the tables show it as a small second line when it
 *   differs from the typed cost (profit of sales is still booked from the real stock cost).
 *
 * NEVER the selling price (`basePrice` of a store product is the selling price - BUG-05 v1.5.3).
 * undefined = not known / the user may not see costs.
 */
type CostNumber = number | string | null | undefined;
type CostFields = { stockUnitCost?: CostNumber; costPrice?: CostNumber; cost?: CostNumber };

function num(raw: CostNumber): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** a typed cost of 0 means "not entered" (the form's default; the server treats it the same way for oversold stock) */
function typed(raw: CostNumber): number | undefined {
  const n = num(raw);
  return n !== undefined && n > 0 ? n : undefined;
}

export function displayUnitCost(p: CostFields): number | undefined {
  return typed(p.costPrice) ?? typed(p.cost) ?? num(p.stockUnitCost) ?? num(p.costPrice) ?? num(p.cost);
}

/** FIFO cost of the stock on hand when it differs from the displayed (typed) cost by at least 1 satang, else undefined */
export function stockOnHandCost(p: CostFields): number | undefined {
  const stock = num(p.stockUnitCost);
  const shown = displayUnitCost(p);
  if (stock === undefined || shown === undefined) return undefined;
  return Math.abs(stock - shown) >= 0.005 ? stock : undefined;
}
