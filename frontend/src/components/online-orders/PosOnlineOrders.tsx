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
import type { CartItem } from '@/lib/types';
import { Button } from '@/components/ui/button';

interface PayableRow {
  id: string;
  orderNo: string;
  contactName: string;
  fulfillment: 'PICKUP' | 'DELIVERY';
  totalAmount: number;
  itemCount: number;
  customer: { id: string; name: string } | null;
}

interface PosPayload {
  id: string;
  orderNo: string;
  customer: { id: string; name: string } | null;
  contactName: string;
  note: string;
  lines: { productId: string; sku: string; name: string; unitId: string | null; unitName: string; factor: number; quantity: number; unitPrice: number; isBundle: boolean }[];
}

/** Turns an accepted online order into POS cart lines at the agreed prices (ค่าส่ง included as a service line). */
export function onlineOrderCartItems(p: PosPayload, products: { id: string; hasVat?: boolean; isBundle?: boolean; bundleItems?: { childProductId: string; quantity: number; childProduct?: { name?: string; sku?: string; basePrice?: number; priceLevel1?: number } }[] }[]): CartItem[] {
  const byId = new Map(products.map((x) => [x.id, x]));
  return p.lines.map((l) => {
    const prod = byId.get(l.productId);
    const bundle = prod?.isBundle && prod.bundleItems?.length
      ? prod.bundleItems.map((bi) => ({
          productId: bi.childProductId,
          productName: bi.childProduct?.name || 'สินค้าในชุด',
          sku: bi.childProduct?.sku || '',
          quantityPerBundle: Number(bi.quantity),
          totalQuantity: Number(bi.quantity) * l.quantity,
          unitPrice: Number(bi.childProduct?.basePrice || bi.childProduct?.priceLevel1 || 0),
        }))
      : undefined;
    return {
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      originalPrice: l.unitPrice,
      customPrice: null,
      quantity: l.quantity,
      unitId: l.unitId || `u-${l.productId}-base`,
      unitName: l.unitName,
      conversionFactor: l.factor || 1,
      discountType: 'none',
      discountValue: 0,
      hasVat: prod?.hasVat !== false,
      isBundle: l.isBundle,
      bundleData: bundle,
      pricingNote: `ออเดอร์ออนไลน์ ${p.orderNo}`,
    };
  });
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
      const p = await apiFetch<PosPayload>(`/online-shop/orders/${id}/pos`);
      const items = onlineOrderCartItems(p, useProductStore.getState().products as never);
      useCartStore.getState().loadOnlineOrder({ id: p.id, orderNo: p.orderNo, customerId: p.customer?.id || null, customerName: p.customer?.name || null, note: p.note, items });
      toast.success(`เปิดออเดอร์ออนไลน์ ${p.orderNo} แล้ว รับชำระได้เลย`);
      onOpened();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปิดออเดอร์ไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="ออเดอร์ออนไลน์รอชำระ" className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 space-y-3">
      <h3 className="font-black text-emerald-900 text-lg flex items-center gap-2">
        <Globe className="w-5 h-5" /> ออเดอร์ออนไลน์ (LINE) รอชำระ ({rows.length})
      </h3>
      {rows.map((r) => (
        <div key={r.id} data-testid="pos-online-order" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-emerald-200 p-3">
          <div className="min-w-0">
            <p className="font-extrabold text-slate-900">{r.orderNo} · {r.customer?.name || r.contactName}</p>
            <p className="text-xs font-semibold text-slate-600">{r.itemCount} รายการ · {r.fulfillment === 'PICKUP' ? 'รับที่ร้าน' : 'ส่งของ'}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-black font-mono text-lg">{formatCurrency(r.totalAmount)}</span>
            <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 text-white font-bold gap-2" disabled={busy !== null || current === r.id} onClick={() => void open(r.id)}>
              <PlayCircle className="w-4 h-4" /> {current === r.id ? 'อยู่ในตะกร้า' : 'เปิดบิล'}
            </Button>
          </div>
        </div>
      ))}
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
