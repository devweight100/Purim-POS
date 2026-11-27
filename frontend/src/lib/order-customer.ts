/**
 * Customer name of a bill as the screens show it (docs/pos-member-picker.md).
 * The server's orders have no name column: a member bill carries the member as `customer: { name }` (GET /orders,
 * GET /orders/:id), while the POS's own bill objects (sale just made, outbox, held bills) carry `customerName`.
 * The POS history read `customerName` only, so every member bill showed "ลูกค้าทั่วไป" once the history came from
 * the server alone. The member's current name wins; then a name kept on the bill object; else null (walk-in).
 */
export interface OrderCustomerLike {
  customer?: { name?: string | null } | string | null;
  customerName?: string | null;
}

export function orderCustomerName(order: OrderCustomerLike | null | undefined): string | null {
  if (!order) return null;
  const c = order.customer;
  const member = c && typeof c === 'object' ? c.name : typeof c === 'string' ? c : null;
  const name = (member || '').trim() || (order.customerName || '').trim();
  return name || null;
}
