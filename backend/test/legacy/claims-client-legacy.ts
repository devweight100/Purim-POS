/**
 * FROZEN COPY of what the browser did with the claims list (frontend as of commit e1c61aa): the status /
 * order fields of claim-service mapServerClaim, the orders page "claimed" keys (orders/page.tsx) and the
 * eligibility filter of supplier-return-service getEligibleClaimsForReturn (step 1, before cost / supplier
 * enrichment). Test oracle only: the claims e2e test feeds it GET /claims rows and checks
 * GET /claims/claimed-orders and GET /claims/returnable. Types loosened to `any`; do not "fix" it.
 */
/* eslint-disable */
const CLAIM_STATUSES: readonly string[] = ['COMPLETED', 'PENDING_CHECKOUT', 'PENDING_SUPPLIER', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'SCRAPPED'];

/** The fields of mapServerClaim the two consumers read. */
export function mapServerClaimFields(c: any) {
  const claimId = c.claimNumber || c.id;
  const ordNum = c.order?.orderNumber || c.orderNumber || '-';
  const resolvedResType = (c.resolutionType ||
    (c.claimType === 'REFUND' ? 'REFUND_CASH' : c.claimType === 'EXCHANGE' ? 'REPLACE_ITEM' : 'REPLACE_ITEM'));
  let resolvedStatus = 'COMPLETED';
  const rawStatus = c.frontendStatus || c.claimStatus || c.status;
  if (rawStatus !== undefined && CLAIM_STATUSES.includes(rawStatus)) {
    resolvedStatus = rawStatus;
  } else if (rawStatus === 'IN_PROGRESS') {
    resolvedStatus = c.returnDocId ? 'SENT_TO_SUPPLIER' : 'PENDING_SUPPLIER';
  } else if (rawStatus === 'PENDING') {
    resolvedStatus = resolvedResType === 'STORE_DISCOUNT' ? 'PENDING_CHECKOUT' : 'PENDING_SUPPLIER';
  } else if (rawStatus === 'REJECTED') {
    resolvedStatus = 'SCRAPPED';
  }
  return {
    id: claimId,
    orderId: c.orderId || c.order?.id || '',
    orderNumber: ordNum !== '-' ? ordNum : '-',
    status: resolvedStatus,
    returnDocId: c.returnDocId,
  };
}

/** orders/page.tsx: keys of the claims list, then hasClaims per order row. */
export function claimedKeys(claimRows: any[]): Set<string> {
  const keys = new Set<string>();
  claimRows.map(mapServerClaimFields).forEach((c) => {
    if (c.orderId) keys.add(c.orderId);
    if (c.orderNumber) keys.add(c.orderNumber);
  });
  return keys;
}
export function orderHasClaims(bOrder: any, keys: Set<string>): boolean {
  const key = bOrder.orderNumber || bOrder.id;
  return (
    (Array.isArray(bOrder.claims) && bOrder.claims.length > 0) ||
    keys.has(key) ||
    keys.has(bOrder.id) ||
    keys.has(bOrder.orderNumber)
  );
}

/** getEligibleClaimsForReturn step 1 filter (ids of the eligible claims, list order kept). */
export function eligibleClaimIds(claimRows: any[]): string[] {
  return claimRows.map(mapServerClaimFields).filter((c) => !c.returnDocId && c.status !== 'SCRAPPED').map((c) => c.id);
}
