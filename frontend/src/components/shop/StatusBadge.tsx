import type { ShopOrderStatus } from '@/lib/shop/shop-api';

const COLORS: Record<ShopOrderStatus, string> = {
  NEW: 'bg-amber-100 text-amber-950 border-amber-500',
  ACCEPTED: 'bg-sky-100 text-sky-950 border-sky-600',
  PREPARING: 'bg-sky-100 text-sky-950 border-sky-600',
  READY: 'bg-teal-100 text-teal-950 border-teal-700',
  DELIVERING: 'bg-violet-100 text-violet-950 border-violet-600',
  DONE: 'bg-emerald-100 text-emerald-950 border-emerald-700',
  CANCELLED: 'bg-red-100 text-red-900 border-red-600',
};

export function StatusBadge({ status, label }: { status: ShopOrderStatus; label: string }) {
  return <span className={`inline-block rounded-xl border-2 px-3 py-0.5 text-lg font-bold ${COLORS[status]}`}>{label}</span>;
}
