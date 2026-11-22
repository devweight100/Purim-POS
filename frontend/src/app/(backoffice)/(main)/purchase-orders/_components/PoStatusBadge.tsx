import { StatusChip } from '@/components/ui/status-chip';

/** PO status as the shared status chip (docs/ui-style.md). */
export function poStatusBadge(status: string) {
  switch (status) {
    case 'DRAFT': return <StatusChip tone="neutral">DRAFT</StatusChip>;
    case 'ISSUED': return <StatusChip tone="info">ISSUED</StatusChip>;
    case 'PARTIALLY_RECEIVED': return <StatusChip tone="warning">PARTIAL</StatusChip>;
    case 'COMPLETED': return <StatusChip tone="success">COMPLETED</StatusChip>;
    case 'CANCELLED': return <StatusChip tone="danger">CANCELLED</StatusChip>;
    default: return <StatusChip tone="neutral">{status}</StatusChip>;
  }
}
