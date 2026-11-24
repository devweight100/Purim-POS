import { StatusChip } from '@/components/ui/status-chip';

/** Short Thai PO status names (chips, list tabs, status dialog). Round B: no English codes on screen. */
export const PO_STATUS_TH: Record<string, string> = {
  DRAFT: 'ร่าง',
  ISSUED: 'ออกแล้ว',
  PARTIALLY_RECEIVED: 'รับบางส่วน',
  RECEIVED: 'รับครบ',
  COMPLETED: 'รับครบ',
  CANCELLED: 'ยกเลิก',
};

export const poStatusTh = (status: string) => PO_STATUS_TH[status] || status;

/** PO status as the shared status chip (docs/ui-style.md). */
export function poStatusBadge(status: string) {
  switch (status) {
    case 'DRAFT': return <StatusChip tone="neutral">{PO_STATUS_TH.DRAFT}</StatusChip>;
    case 'ISSUED': return <StatusChip tone="info">{PO_STATUS_TH.ISSUED}</StatusChip>;
    case 'PARTIALLY_RECEIVED': return <StatusChip tone="warning">{PO_STATUS_TH.PARTIALLY_RECEIVED}</StatusChip>;
    case 'RECEIVED':
    case 'COMPLETED': return <StatusChip tone="success">{PO_STATUS_TH.COMPLETED}</StatusChip>;
    case 'CANCELLED': return <StatusChip tone="danger">{PO_STATUS_TH.CANCELLED}</StatusChip>;
    default: return <StatusChip tone="neutral">{status}</StatusChip>;
  }
}
