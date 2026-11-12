/**
 * Money rounding to the satang (0.01 baht). Two flavours exist on purpose and must not be mixed up:
 * - round2: plain Math.round(n x 100) / 100 (reports, finance, returns, claims, PO arithmetic)
 * - roundSatang: adds Number.EPSILON first so 1.005 -> 1.01 (what the POS cart, checkout and shift
 *   totals have always used; the cart preview and the server charge must round the same way)
 */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const roundSatang = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** round2 that treats null / undefined / NaN / Decimal strings as numbers (NaN -> 0). */
export const round2n = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
