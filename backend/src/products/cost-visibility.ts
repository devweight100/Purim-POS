/**
 * Cost visibility (owner decision): purchase cost is shown only to ADMIN or users holding
 * the VIEW_COST permission (or the ALL wildcard). Everyone else gets product data with every
 * cost field removed. The server still enforces below-cost approvals on its own data.
 */
const COST_KEYS = new Set(['costPrice', 'cost', 'unitCost', 'lastCost']);

export function canViewCost(user: any): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const perms: string[] = Array.isArray(user.permissions) ? user.permissions.map((p: any) => String(p)) : [];
  return perms.includes('VIEW_COST') || perms.includes('ALL');
}

function isPlainObject(v: any): boolean {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Deep copy of plain objects/arrays without any cost field (Decimal/Date values are kept as is). */
export function stripCostFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripCostFields(v)) as any;
  if (!isPlainObject(value)) return value;
  const out: any = {};
  for (const [k, v] of Object.entries(value as any)) {
    if (COST_KEYS.has(k)) continue;
    out[k] = stripCostFields(v);
  }
  return out;
}

export function costFilterFor(user: any) {
  const visible = canViewCost(user);
  return <T>(value: T): T => (visible ? value : stripCostFields(value));
}
