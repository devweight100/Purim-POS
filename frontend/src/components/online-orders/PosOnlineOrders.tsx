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
import { claimLabel, fetchPosPayload, pickedLabel, type OnlineClaim, type OnlinePicked } from '@/lib/online-order-actions';
import { Button } from '@/components/ui/button';
import { onlineOrderStep } from '@/lib/online-order-steps';
import type { OnlineOrderStatus } from '@shared/online-shop';

interface PayableRow {
  id: string;
  orderNo: string;
  status: OnlineOrderStatus;
  paid: boolean;
  contactName: string;
  fulfillment: 'PICKUP' | 'DELIVERY';
  totalAmount: number;
  itemCount: number;
  customer: { id: string; name: string } | null;
  claim: OnlineClaim | null;
  picked: OnlinePicked | null;
}

/** Picking state of an online order for the POS: who picked it, who is picking it, or not picked yet (a warning only). */
export function PickingNote({ picked, claim, meId }: { picked: OnlinePicked | null | undefined; claim: OnlineClaim | null | undefined; meId?: string }) {
  if (picked) {
    return <span data-testid="picking-note" className="inline-block rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-900">✓ {pickedLabel(picked)}</span>;
  }
  return (
    <span data-testid="picking-note" className="inline-block rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-950">
      ยังไม่ได้จัดของ{claim ? ` · ${claim.userId === meId ? 'คุณกำลังจัด' : claimLabel(claim)}` : ''}
    </span>
  );
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
      if (p.picked) toast.success(`เปิดออเดอร์ออนไลน์ ${p.orderNo} แล้ว รับชำระได้เลย`);
      else toast.warning(`เปิดออเดอร์ออนไลน์ ${p.orderNo} แล้ว — ยังไม่ได้จัดของ รับชำระได้ แต่ตรวจของก่อนส่งมอบ`);
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
      <h3 className="font-semibold text-emerald-900 text-lg flex items-center gap-2">
        <Globe className="w-5 h-5" /> ออเดอร์ออนไลน์ (LINE) รอชำระ ({rows.length})
      </h3>
      {rows.map((r) => {
        // picking is for the picker; every cashier may take the payment (picked or not: a note, never a block)
        return (
          <div key={r.id} data-testid="pos-online-order" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-emerald-200 p-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{r.orderNo} · {r.customer?.name || r.contactName}</p>
              <p className="text-xs font-semibold text-slate-600">
                {r.itemCount} รายการ · {r.fulfillment === 'PICKUP' ? 'รับที่ร้าน' : 'ส่งของ'}
                {r.status && <span data-testid="pos-online-step"> · ขั้นตอน: {onlineOrderStep({ status: r.status, fulfillment: r.fulfillment, paid: !!r.paid }).todo}</span>}
              </p>
              <p className="mt-1">
                <PickingNote picked={r.picked} claim={r.claim} meId={user?.id} />
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold tabular-nums text-lg">{formatCurrency(r.totalAmount)}</span>
              <Button
                className="bg-emerald-700 hover:bg-emerald-800 text-white gap-2"
                disabled={busy !== null || current === r.id}
                title={r.picked ? undefined : 'ยังไม่ได้จัดของ — รับชำระได้ ตรวจของก่อนส่งมอบ'}
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
  const meId = useAuthStore((s) => s.user?.id);
  // picking state, live (the picker may press "จัดของเสร็จ" while the bill is open here)
  const [pick, setPick] = useState<{ id: string; picked: OnlinePicked | null; claim: OnlineClaim | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      apiFetch<{ picked: OnlinePicked | null; claim: OnlineClaim | null }>(`/online-shop/orders/${id}`).then(
        (d) => alive && setPick({ id, picked: d.picked, claim: d.claim }),
        () => undefined,
      );
    const on = (e: Event) => {
      if ((e as CustomEvent<{ entity?: string }>).detail?.entity !== 'onlineOrder') return;
      clearTimeout(t);
      t = setTimeout(() => void load(), 300);
    };
    t = setTimeout(() => void load(), 0);
    window.addEventListener('purim:realtime', on);
    return () => {
      alive = false;
      clearTimeout(t);
      window.removeEventListener('purim:realtime', on);
    };
  }, [id]);
  if (!id) return null;
  const state = pick?.id === id ? pick : null;
  return (
    <div role="status" data-testid="pos-online-banner" className="bg-emerald-700 text-white px-4 py-2 text-sm font-bold flex flex-wrap items-center justify-between gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <span>🛒 {note || 'ออเดอร์ออนไลน์'} — รับชำระตามปกติ ระบบจะผูกบิลกับออเดอร์ให้อัตโนมัติ</span>
        {state && <PickingNote picked={state.picked} claim={state.claim} meId={meId} />}
      </span>
      <button type="button" className="rounded-lg bg-white/15 px-3 py-1 hover:bg-white/25" onClick={() => useCartStore.getState().clearCart()}>
        ล้างตะกร้า
      </button>
    </div>
  );
}
