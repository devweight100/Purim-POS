/**
 * Cost per unit shown in the products / inventory tables: the cost of the stock on hand (FIFO pool, sent with the
 * server's table rows), else the product's reference cost. NEVER the selling price (`basePrice` of a store product
 * is the selling price - BUG-05 v1.5.3). undefined = not known / the user may not see costs.
 */
type CostNumber = number | string | null | undefined;

export function displayUnitCost(p: { stockUnitCost?: CostNumber; costPrice?: CostNumber; cost?: CostNumber }): number | undefined {
  const raw = p.stockUnitCost ?? p.costPrice ?? p.cost;
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
