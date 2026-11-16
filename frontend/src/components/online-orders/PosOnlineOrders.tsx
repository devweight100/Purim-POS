'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Globe, PlayCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { hasPermission } from '@/lib/permissions';
import { onlineOrderCartItems } from '@/lib/online-order-cart';
import { claimLabel, fetchPosPayload, type OnlineClaim } from '@/lib/online-order-actions';
import { Button } from '@/components/ui/button';

interface PayableRow {
  id: string;
  orderNo: string;
  contactName: string;
  fulfillment: 'PICKUP' | 'DELIVERY';
  totalAmount: number;
  itemCount: number;
  customer: { id: string; name: string } | null;
  claim: OnlineClaim | null;
}

/** POS held-bills sheet: accepted online orders waiting for payment (shared by every terminal, from the server). */
export function PosOnlineOrders({ onOpened }: { onOpened: () => void }) {
  const user = useAuthStore((s) => s.user);
  const allowed = !!user && hasPermission(user, 'POS_SELL');
  const [rows, setRows] = useState<PayableRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const current = useCartStore((s) => s.onlineOrderId);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: PayableRow[] }>('/online-shop/orders?status=payable&limit=50');
      setRows(r.data);
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [allowed, load]);

  if (!allowed || !rows || rows.length === 0) return null;

  const open = async (id: string) => {
    setBusy(id);
    try {
      const p = await fetchPosPayload(id);
      if (!p) return;
      const items = onlineOrderCartItems(p, useProductStore.getState().products as never);
      useCartStore.getState().loadOnlineOrder({ id: p.id, orderNo: p.orderNo, customerId: p.customer?.id || null, customerName: p.customer?.name || null, note: p.note, items });
      toast.success(`เปิดออเดอร์ออนไลน์ ${p.orderNo} แล้ว รับชำระได้เลย`);
      onOpened();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปิดออเดอร์ไม่สำเร็จ');
      void load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="ออเดอร์ออนไลน์รอชำระ" className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 space-y-3">
      <h3 className="font-black text-emerald-900 text-lg flex items-center gap-2">
        <Globe className="w-5 h-5" /> ออเดอร์ออนไลน์ (LINE) รอชำระ ({rows.length})
      </h3>
      {rows.map((r) => {
        // someone else is preparing it: only that person (or a manager) may take the payment
        const heldByOther = !!r.claim && r.claim.userId !== user?.id && user?.role !== 'ADMIN' && user?.role !== 'MANAGER';
        return (
          <div key={r.id} data-testid="pos-online-order" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-emerald-200 p-3">
            <div className="min-w-0">
              <p className="font-extrabold text-slate-900">{r.orderNo} · {r.customer?.name || r.contactName}</p>
              <p className="text-xs font-semibold text-slate-600">{r.itemCount} รายการ · {r.fulfillment === 'PICKUP' ? 'รับที่ร้าน' : 'ส่งของ'}</p>
              {r.claim && (
                <p className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${r.claim.userId === user?.id ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                  {r.claim.userId === user?.id ? 'คุณกำลังจัด' : claimLabel(r.claim)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-black font-mono text-lg">{formatCurrency(r.totalAmount)}</span>
              <Button
                className="h-11 bg-emerald-700 hover:bg-emerald-800 text-white font-bold gap-2"
                disabled={busy !== null || current === r.id || heldByOther}
                title={heldByOther ? `${claimLabel(r.claim)} — เปิดบิลไม่ได้` : undefined}
                onClick={() => void open(r.id)}
              >
                <PlayCircle className="w-4 h-4" /> {current === r.id ? 'อยู่ในตะกร้า' : 'เปิดบิล'}
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** POS: says that the cart is an online order (payment links the bill to it). */
export function OnlineOrderCartBanner() {
  const id = useCartStore((s) => s.onlineOrderId);
  const note = useCartStore((s) => s.note);
  if (!id) return null;
  return (
    <div role="status" data-testid="pos-online-banner" className="bg-emerald-700 text-white px-4 py-2 text-sm font-bold flex flex-wrap items-center justify-between gap-2">
      <span>🛒 {note || 'ออเดอร์ออนไลน์'} — รับชำระตามปกติ ระบบจะผูกบิลกับออเดอร์ให้อัตโนมัติ</span>
      <button type="button" className="rounded-lg bg-white/15 px-3 py-1 hover:bg-white/25" onClick={() => useCartStore.getState().clearCart()}>
        ล้างตะกร้า
      </button>
    </div>
  );
}
