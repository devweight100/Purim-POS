'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Check, Plus, Trash2, X, Store, Truck, ShoppingCart, ClipboardList, Hand, LockOpen, Undo2, PackageCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatListDateTime } from '@/lib/utils';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { acquirePosData, usePosDataDemand } from '@/lib/pos-data-policy';
import { onlineLineTotal, onlineOrderTotals, ONLINE_STATUS_LABELS, parseDeliveryFee, type OnlineOrderStatus } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { onlineOrderCartItems } from '@/lib/online-order-cart';
import { ReasonDialog } from '@/components/common/ReasonDialog';
import { askConfirm } from '@/lib/ask-dialog';
import { useAuthStore } from '@/lib/store/auth-store';
import { claimLabel, claimOrder, fetchPosPayload, isClaimConflict, markPicked, pickedLabel, printOnlinePickingSlip, releaseOrder, type OnlineClaim, type OnlinePicked } from '@/lib/online-order-actions';

interface DetailItem {
  id?: string;
  productId: string;
  sku: string;
  name: string;
  unitId: string | null;
  unitName: string;
  factor: number;
  quantity: number;
  unitPrice: number;
  total: number;
  active?: boolean;
}

interface Detail {
  id: string;
  orderNo: string;
  status: OnlineOrderStatus;
  fulfillment: 'PICKUP' | 'DELIVERY';
  priceLevel: number;
  levelName: string;
  contactName: string;
  contactPhone: string;
  address: string | null;
  note: string | null;
  subtotal: number;
  deliveryFee: number | null;
  totalAmount: number;
  rejectReason: string | null;
  paidAt: string | null;
  createdAt: string;
  lineNotice: string | null;
  lineName: string | null;
  testProfile: boolean;
  customer: { id: string; name: string; phone: string | null; priceLevel: number; deliveryFee: number | null } | null;
  posOrder: { id: string; orderNumber: string; totalAmount: number; status: string } | null;
  nextStatuses: OnlineOrderStatus[];
  items: DetailItem[];
  claim: OnlineClaim | null;
  picked: OnlinePicked | null;
  pickingPrintCount: number;
}

const OPEN: OnlineOrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'];
/** "จัดของเสร็จ" is offered in these statuses (READY is set by it) */
const PICKABLE: OnlineOrderStatus[] = ['ACCEPTED', 'PREPARING'];

/** Colored "who is picking / who picked" badge (list rows, detail). */
export function ClaimBadge({ claim, meId, status, picked }: { claim: OnlineClaim | null; meId?: string; status: OnlineOrderStatus; picked?: OnlinePicked | null }) {
  if (!OPEN.includes(status) && !(status === 'DONE' && picked)) return null;
  if (!claim && picked) {
    return <span data-testid="claim-badge" className="rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-900">✓ {pickedLabel(picked)}</span>;
  }
  if (!OPEN.includes(status)) return null;
  if (!claim) {
    return status === 'NEW' ? (
      <span data-testid="claim-badge" className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">ยังไม่มีคนจัด</span>
    ) : (
      <span data-testid="claim-badge" className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-700">ยังไม่มีคนจัด</span>
    );
  }
  const mine = claim.userId === meId;
  return (
    <span
      data-testid="claim-badge"
      className={`rounded-full border px-2 py-0.5 text-xs font-bold ${mine ? 'border-sky-400 bg-sky-100 text-sky-900' : 'border-rose-300 bg-rose-50 text-rose-900'}`}
    >
      {mine ? claimLabel(claim).replace(/^กำลังจัดโดย [^·]+/, 'คุณกำลังจัด ') : claimLabel(claim)}
    </span>
  );
}

const PILL: Record<OnlineOrderStatus, string> = {
  NEW: 'bg-amber-100 text-amber-900 border-amber-300',
  ACCEPTED: 'bg-sky-100 text-sky-900 border-sky-300',
  PREPARING: 'bg-sky-100 text-sky-900 border-sky-300',
  READY: 'bg-teal-100 text-teal-900 border-teal-400',
  DELIVERING: 'bg-violet-100 text-violet-900 border-violet-300',
  DONE: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  CANCELLED: 'bg-rose-100 text-rose-900 border-rose-300',
};

export function StatusPill({ status, paid }: { status: OnlineOrderStatus; paid?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${PILL[status]}`}>{ONLINE_STATUS_LABELS[status]}</span>
      {paid && <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">ชำระแล้ว</span>}
    </span>
  );
}

const when = (iso: string) => formatListDateTime(iso); // detail view: date + time
const isBaseUnit = (id: string) => /^u-.*-base$/.test(id);

/** One online order: edit items / prices / fee / member, accept, reject, status, open in the POS. */
export function OnlineOrderDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const manager = me?.role === 'ADMIN' || me?.role === 'MANAGER';
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [d, setD] = useState<Detail | null>(null);
  const [items, setItems] = useState<DetailItem[]>([]);
  const [fee, setFee] = useState('');
  const [customer, setCustomer] = useState<Detail['customer']>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState<'product' | 'customer' | null>(null);

  const apply = useCallback((x: Detail) => {
    setD(x);
    setItems(x.items);
    setFee(x.deliveryFee === null ? '' : String(x.deliveryFee));
    setCustomer(x.customer);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await apiFetch<Detail>(`/online-shop/orders/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    }
  }, [id, apply]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // other terminals claim / change the order: refresh live (keeps unsaved edits, updates status + claim)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      if ((e as CustomEvent<{ entity?: string }>).detail?.entity !== 'onlineOrder') return;
      clearTimeout(t);
      t = setTimeout(() => {
        apiFetch<Detail>(`/online-shop/orders/${id}`).then(
          (x) => {
            if (dirtyRef.current) setD(x);
            else apply(x);
          },
          () => undefined,
        );
      }, 300);
    };
    window.addEventListener('purim:realtime', on);
    return () => {
      clearTimeout(t);
      window.removeEventListener('purim:realtime', on);
    };
  }, [id, apply]);

  const heldByOther = !!d?.claim && d.claim.userId !== me?.id;
  const lockReason = heldByOther ? `${claimLabel(d?.claim)} — งานจัดของทำไม่ได้จนกว่าจะปล่อยงาน${manager ? ' (หรือกด "ปลดล็อก/โอนมาที่ฉัน")' : ''} รับเงินได้ตามปกติ` : undefined;
  // unpaid open order: actions shown; picking actions on someone else's order stay visible but disabled (with the
  // reason); payment and the hand-over steps (กำลังส่ง / เสร็จ) are open to every cashier
  const actionable = !!d && !d.posOrder && OPEN.includes(d.status);
  const editable = actionable && !heldByOther;
  const isOpen = !!d && OPEN.includes(d.status);
  const feeParsed = parseDeliveryFee(fee);
  const totals = useMemo(() => {
    const f = parseDeliveryFee(fee);
    return onlineOrderTotals(items, d?.fulfillment === 'PICKUP' ? 0 : f.ok ? f.value : null);
  }, [items, d?.fulfillment, fee]);

  if (!d) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">กำลังโหลด…</div>;

  const body = () => ({
    items: items.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.quantity, unitPrice: i.unitPrice })),
    ...(d.fulfillment === 'DELIVERY' ? { deliveryFee: fee.trim() === '' ? null : Number(fee) } : {}),
    customerId: customer?.id ?? null,
    usePriceLevel: false,
  });

  const run = async (fn: () => Promise<Detail>, ok: string) => {
    setBusy(true);
    try {
      apply(await fn());
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
      if (isClaimConflict(e)) void load();
    } finally {
      setBusy(false);
    }
  };
  const claim = () => run(() => claimOrder<Detail>(d.id), `รับจัดออเดอร์ ${d.orderNo} แล้ว`);
  const picked = () => {
    if (dirty) {
      toast.error('บันทึกการแก้ไขก่อน แล้วจึงกดจัดของเสร็จ');
      return;
    }
    return run(() => markPicked<Detail>(d.id), `จัดของ ${d.orderNo} เสร็จแล้ว — แคชเชียร์ทุกคนรับเงิน/ส่งมอบได้`);
  };
  const canPick = PICKABLE.includes(d.status);
  const release = () => run(() => releaseOrder<Detail>(d.id), 'ปล่อยงานแล้ว คนอื่นรับจัดต่อได้');
  const takeover = () =>
    run(async () => {
      const r = await claimOrder<Detail>(d.id, true);
      setTakeoverOpen(false);
      return r;
    }, `โอนออเดอร์ ${d.orderNo} มาที่คุณแล้ว (บันทึกในประวัติ)`);
  const printSlip = async () => {
    if (dirty) {
      toast.error('บันทึกการแก้ไขก่อน แล้วจึงพิมพ์ใบจัดของ');
      return;
    }
    setBusy(true);
    try {
      await printOnlinePickingSlip(d.id);
      toast.success(`ส่งพิมพ์ใบจัดของ ${d.orderNo} แล้ว`);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'พิมพ์ใบจัดของไม่สำเร็จ');
      if (isClaimConflict(e)) void load();
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => apiFetch<Detail>(`/online-shop/orders/${d.id}`, { method: 'PATCH', body: JSON.stringify(body()) }), 'บันทึกแล้ว');
  const accept = () => {
    if (d.fulfillment === 'DELIVERY' && (fee.trim() === '' || !feeParsed.ok)) {
      toast.error('กรุณาใส่ค่าส่งก่อนรับออเดอร์');
      return;
    }
    return run(() => apiFetch<Detail>(`/online-shop/orders/${d.id}/accept`, { method: 'POST', body: JSON.stringify(body()) }), `รับออเดอร์ ${d.orderNo} แล้ว — ไปรับเงินที่หน้าขาย (บิลพัก)`);
  };
  const reject = (reason: string) =>
    run(async () => {
      const r = await apiFetch<Detail>(`/online-shop/orders/${d.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
      setRejectOpen(false);
      return r;
    }, 'ยกเลิกออเดอร์แล้ว');
  const setStatus = async (status: OnlineOrderStatus) => {
    if (status === 'CANCELLED') {
      setRejectOpen(true);
      return;
    }
    let unpaidOk = false;
    if (status === 'DONE' && !d.posOrder) {
      if (!(await askConfirm({ title: 'ออเดอร์นี้ยังไม่ได้รับเงินในหน้าขาย', description: 'ปิดออเดอร์โดยไม่บันทึกการขาย?', confirmLabel: 'ปิดออเดอร์', danger: true }))) return;
      unpaidOk = true;
    }
    await run(() => apiFetch<Detail>(`/online-shop/orders/${d.id}/status`, { method: 'POST', body: JSON.stringify({ status, unpaidOk }) }), `เปลี่ยนเป็น "${ONLINE_STATUS_LABELS[status]}" แล้ว`);
  };
  const openInPos = async () => {
    if (dirty) {
      toast.error('บันทึกการแก้ไขก่อน');
      return;
    }
    try {
      const p = await fetchPosPayload(d.id);
      if (!p) return;
      // the cart lines come from the POS catalogue: loaded first when this device does not keep it
      const releaseCatalog = acquirePosData({ products: true });
      setTimeout(releaseCatalog, 3000);
      if (!useProductStore.getState().products.length) await useProductStore.getState().fetchProducts();
      const cartItems = onlineOrderCartItems(p, useProductStore.getState().products as never);
      const c = (p as unknown as { customer: { id: string; name: string } | null }).customer;
      useCartStore.getState().loadOnlineOrder({ id: p.id, orderNo: p.orderNo, customerId: c?.id || null, customerName: c?.name || null, note: p.note, items: cartItems });
      router.push('/pos');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปิดในหน้าขายไม่สำเร็จ');
      if (isClaimConflict(e)) void load();
    }
  };

  const change = (idx: number, patch: Partial<DetailItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch, total: onlineLineTotal({ quantity: patch.quantity ?? it.quantity, unitPrice: patch.unitPrice ?? it.unitPrice }) } : it)));
    setDirty(true);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs" data-testid="online-order-detail">
      <div className="flex flex-wrap items-start justify-between gap-btn">
        <div className="flex items-start gap-btn">
          <Button variant="outline" size="sm" onClick={onBack} className="xl:hidden gap-1" aria-label="กลับไปรายการ">
            <ArrowLeft className="w-4 h-4" /> รายการ
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{d.orderNo}</h2>
            <p className="text-xs text-slate-500">
              สั่งเมื่อ {when(d.createdAt)} · LINE: {d.lineName || '-'}
              {d.testProfile ? ' (โปรไฟล์ทดสอบ)' : ''}
            </p>
          </div>
        </div>
        <StatusPill status={d.status} paid={!!d.paidAt} />
      </div>

      {isOpen && (
        <div
          data-testid="claim-bar"
          className={`flex flex-wrap items-center justify-between gap-btn rounded-xl border-2 p-3 ${!d.claim ? (d.picked ? 'border-emerald-400 bg-emerald-50' : 'border-amber-400 bg-amber-50') : heldByOther ? 'border-rose-300 bg-rose-50' : 'border-sky-300 bg-sky-50'}`}
        >
          <div className="min-w-0 text-sm">
            <ClaimBadge claim={d.claim} meId={me?.id} status={d.status} picked={d.picked} />
            <p className="mt-1 font-semibold text-slate-700">
              {!d.claim
                ? d.picked
                  ? 'จัดของเสร็จแล้ว — แคชเชียร์ทุกคนรับเงินและส่งมอบของได้'
                  : d.status === 'NEW' || canPick
                    ? 'ยังไม่มีใครรับจัด — กดรับจัดก่อนไปหยิบของ กันสองคนจัดซ้ำ'
                    : 'ไม่มีใครถืองานจัดของอยู่'
                : heldByOther
                  ? `งานจัดของปิดอยู่: ${d.claim.name} กำลังจัดออเดอร์นี้ (รับเงินได้ตามปกติ)`
                  : canPick
                    ? 'คุณเป็นผู้จัดออเดอร์นี้ จัดเสร็จแล้วกด "จัดของเสร็จ" ให้คนอื่นรับเงิน/ส่งมอบต่อได้'
                    : 'คุณเป็นผู้จัดออเดอร์นี้ เครื่องอื่นแก้ไขรายการไม่ได้'}
              {d.picked && d.claim ? ` · ${pickedLabel(d.picked)}` : ''}
              {d.pickingPrintCount > 0 ? ` · พิมพ์ใบจัดของแล้ว ${d.pickingPrintCount} ครั้ง` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-btn">
            {!d.claim && (d.status === 'NEW' || canPick) && (
              <Button disabled={busy} onClick={() => void claim()} className="gap-1 bg-amber-600 hover:bg-amber-700 text-white">
                <Hand className="w-4 h-4" /> รับจัดออเดอร์นี้
              </Button>
            )}
            {canPick && (
              <Button disabled={busy || heldByOther} onClick={() => void picked()} title={lockReason || (d.claim ? undefined : 'รับจัดให้อัตโนมัติ แล้วบันทึกว่าจัดเสร็จ')} className="gap-1 bg-teal-700 hover:bg-teal-800 text-white">
                <PackageCheck className="w-4 h-4" /> จัดของเสร็จ
              </Button>
            )}
            {d.claim && !heldByOther && (
              <Button disabled={busy} variant="outline" onClick={() => void release()} className="gap-1">
                <Undo2 className="w-4 h-4" /> ปล่อยงาน
              </Button>
            )}
            {heldByOther && manager && (
              <Button disabled={busy} variant="outline" onClick={() => setTakeoverOpen(true)} className="gap-1 border-rose-400 text-rose-800 hover:bg-rose-100">
                <LockOpen className="w-4 h-4" /> ปลดล็อก/โอนมาที่ฉัน
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-3 space-y-1">
          <p className="font-bold flex items-center gap-1.5">
            {d.fulfillment === 'PICKUP' ? <Store className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
            {d.fulfillment === 'PICKUP' ? 'รับเองที่ร้าน' : 'ให้ร้านไปส่ง'}
          </p>
          <p>
            {d.contactName} · <a className="underline" href={`tel:${d.contactPhone}`}>{d.contactPhone}</a>
          </p>
          {d.address && <p className="text-slate-700 whitespace-pre-line">{d.address}</p>}
          {d.note && <p className="text-amber-800">หมายเหตุ: {d.note}</p>}
        </div>
        <div className="rounded-xl bg-slate-50 p-3 space-y-1">
          <p className="font-bold">ลูกค้าในระบบ</p>
          {customer ? (
            <p>
              {customer.name} {customer.phone ? `· ${customer.phone}` : ''} · ราคาระดับ {customer.priceLevel}
              {customer.deliveryFee != null ? ` · ค่าส่ง ${formatCurrency(customer.deliveryFee)}` : ''}
            </p>
          ) : (
            <p className="text-slate-500">ลูกค้าทั่วไป (ยังไม่ผูกสมาชิก) · ราคาที่สั่ง: {d.levelName}</p>
          )}
          {editable && (
            <div className="flex flex-wrap gap-btn pt-1">
              <Button size="sm" variant="outline" onClick={() => setPickOpen('customer')}>
                {customer ? 'เปลี่ยนลูกค้า' : 'เลือก / สร้างลูกค้า'}
              </Button>
              {customer && (
                <Button size="sm" variant="outline" onClick={() => { setCustomer(null); setDirty(true); }}>
                  ไม่ระบุลูกค้า
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead >
            <tr>
              <th className="text-left">สินค้า</th>
              <th className="text-right w-24">จำนวน</th>
              <th className="text-right w-28">ราคา/หน่วย</th>
              <th className="text-right w-28">รวม</th>
              {editable && <th className="w-12"><span className="sr-only">ลบ</span></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={`${it.productId}|${it.unitId}`} className="border-t border-slate-100">
                <td >
                  <span className="font-semibold">{it.name}</span>
                  <span className="block text-sub text-muted-foreground">{it.sku} · {it.unitName}{it.factor > 1 ? ` (${it.factor} ชิ้นฐาน)` : ''}{it.active === false ? ' · ปิดขายแล้ว' : ''}</span>
                </td>
                <td className="text-right">
                  {editable ? (
                    <Input aria-label={`จำนวน ${it.name}`} type="number" min={1} step={1} className="h-9 w-20 text-right ml-auto" value={it.quantity} onChange={(e) => change(i, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} />
                  ) : (
                    it.quantity.toLocaleString('th-TH')
                  )}
                </td>
                <td className="text-right">
                  {editable ? (
                    <Input aria-label={`ราคา ${it.name}`} type="number" min={0} step={0.01} className="h-9 w-24 text-right ml-auto" value={it.unitPrice} onChange={(e) => change(i, { unitPrice: Math.max(0, Math.round(Number(e.target.value) * 100) / 100 || 0) })} />
                  ) : (
                    formatCurrency(it.unitPrice)
                  )}
                </td>
                <td className="text-right tabular-nums font-medium">{formatCurrency(it.total)}</td>
                {editable && (
                  <td className="text-right">
                    <Button size="sm" variant="ghost" aria-label={`ลบ ${it.name}`} disabled={items.length <= 1} onClick={() => { setItems((p) => p.filter((_, k) => k !== i)); setDirty(true); }}>
                      <Trash2 className="w-4 h-4 text-danger" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setPickOpen('product')}>
          <Plus className="w-4 h-4" /> เพิ่มสินค้า
        </Button>
      )}

      <div className="ml-auto max-w-sm space-y-1 text-sm">
        <div className="flex justify-between"><span>ค่าสินค้า</span><b className="tabular-nums">{formatCurrency(totals.subtotal)}</b></div>
        <div className="flex items-center justify-between gap-btn">
          <label htmlFor="online-fee">ค่าส่ง</label>
          {d.fulfillment === 'PICKUP' ? (
            <b>ไม่มี (รับที่ร้าน)</b>
          ) : editable ? (
            <Input id="online-fee" type="number" min={0} step={1} placeholder="ใส่ค่าส่ง" className={`h-9 w-28 text-right ${fee.trim() === '' ? 'border-amber-500' : ''}`} value={fee} onChange={(e) => { setFee(e.target.value); setDirty(true); }} />
          ) : (
            <b className="tabular-nums">{d.deliveryFee === null ? 'ยังไม่ระบุ' : formatCurrency(d.deliveryFee)}</b>
          )}
        </div>
        {!feeParsed.ok && <p className="text-xs text-rose-700">{feeParsed.error}</p>}
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base"><span className="font-bold">ยอดรวม</span><b className="tabular-nums text-emerald-800">{formatCurrency(totals.total)}{totals.feePending && d.fulfillment === 'DELIVERY' ? ' + ค่าส่ง' : ''}</b></div>
      </div>

      {heldByOther && <p className="rounded-lg bg-rose-50 p-2 text-sm font-semibold text-rose-800" role="status">{lockReason}</p>}
      {d.rejectReason && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">เหตุผลที่ยกเลิก: {d.rejectReason}</p>}
      {d.picked && !isOpen && <p data-testid="picked-note" className="rounded-lg bg-emerald-50 p-2 text-sm font-semibold text-emerald-900">✓ {pickedLabel(d.picked)}</p>}
      {d.posOrder && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">รับเงินแล้ว บิล {d.posOrder.orderNumber} ({formatCurrency(d.posOrder.totalAmount)})</p>}
      <p className="text-xs text-slate-500">LINE: {d.lineNotice || 'ยังไม่มีการแจ้ง'}</p>

      <div className="flex flex-wrap gap-btn border-t border-slate-100 pt-3">
        {d.status === 'NEW' && (
          <Button disabled={busy || heldByOther} title={lockReason} onClick={() => void accept()} className="gap-1 bg-emerald-700 hover:bg-emerald-800 text-white">
            <Check className="w-4 h-4" /> รับออเดอร์
          </Button>
        )}
        {isOpen && (
          <Button disabled={busy || heldByOther} title={lockReason || 'พิมพ์ใบจัดของ (ชื่อสินค้า หน่วย จำนวน ไม่มีราคา) — รับจัดออเดอร์ให้อัตโนมัติ'} variant="outline" onClick={() => void printSlip()} className="gap-1 border-slate-400">
            <ClipboardList className="w-4 h-4" /> พิมพ์ใบจัดของ{d.pickingPrintCount > 0 ? ' (ซ้ำ)' : ''}
          </Button>
        )}
        {editable && d.status !== 'NEW' && (
          <Button disabled={busy || !dirty} variant="outline" onClick={() => void save()}>บันทึกการแก้ไข</Button>
        )}
        {editable && d.status === 'NEW' && dirty && (
          <Button disabled={busy} variant="outline" onClick={() => void save()}>บันทึก (ยังไม่รับ)</Button>
        )}
        {actionable && d.status !== 'NEW' && (
          <Button disabled={busy} title={d.picked ? undefined : 'ยังไม่ได้จัดของ — รับเงินได้ ตรวจของก่อนส่งมอบ'} onClick={() => void openInPos()} className="gap-1 bg-sky-600 hover:bg-sky-700 text-white">
            <ShoppingCart className="w-4 h-4" /> รับเงินที่หน้าขาย
          </Button>
        )}
        {d.nextStatuses.filter((s) => s !== 'CANCELLED').map((s) => {
          // "เตรียมของ" is a picking step (claim lock); กำลังส่ง / เสร็จ: any cashier
          const locked = s === 'PREPARING' && heldByOther;
          return <Button key={s} disabled={busy || locked} title={locked ? lockReason : undefined} variant="outline" onClick={() => void setStatus(s)}>{ONLINE_STATUS_LABELS[s]}</Button>;
        })}
        {actionable && (
          <Button disabled={busy || heldByOther} title={lockReason} variant="outline" className="gap-1 text-rose-700 border-rose-300 hover:bg-rose-50" onClick={() => setRejectOpen(true)}>
            <X className="w-4 h-4" /> ยกเลิกออเดอร์
          </Button>
        )}
      </div>

      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onConfirm={(reason) => reject(reason)}
        title={`ยกเลิกออเดอร์ ${d.orderNo}`}
        label="เหตุผล (ลูกค้าจะเห็นข้อความนี้ใน LINE)"
        inputId="reject-reason"
        placeholder="เช่น สินค้าหมด / ส่งไม่ถึงพื้นที่"
        cancelLabel="ไม่ยกเลิก"
        confirmLabel="ยืนยันยกเลิก"
        busy={busy}
      />

      <Dialog open={takeoverOpen} onOpenChange={setTakeoverOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>ปลดล็อก/โอนออเดอร์ {d.orderNo}</DialogTitle></DialogHeader>
          <p className="text-sm">
            {claimLabel(d.claim)} — โอนมาเป็นของคุณ? คนเดิมจะทำรายการต่อไม่ได้ (ควรบอกเขาก่อนว่าหยุดหยิบของ) และระบบจะบันทึกไว้ในประวัติการใช้งาน
          </p>
          <DialogFooter className="gap-btn">
            <Button variant="outline" onClick={() => setTakeoverOpen(false)}>ไม่โอน</Button>
            <Button disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => void takeover()}>ยืนยันโอนมาที่ฉัน</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductPicker open={pickOpen === 'product'} onClose={() => setPickOpen(null)} onPick={(it) => {
        setItems((prev) => {
          const k = prev.findIndex((p) => p.productId === it.productId && p.unitId === it.unitId);
          if (k >= 0) return prev.map((p, i) => (i === k ? { ...p, quantity: p.quantity + 1, total: onlineLineTotal({ quantity: p.quantity + 1, unitPrice: p.unitPrice }) } : p));
          return [...prev, it];
        });
        setDirty(true);
      }} />
      <CustomerPicker open={pickOpen === 'customer'} onClose={() => setPickOpen(null)} defaultName={d.contactName} defaultPhone={d.contactPhone} onPick={(c) => {
        setCustomer(c);
        if (d.fulfillment === 'DELIVERY' && c.deliveryFee != null && fee.trim() === '') setFee(String(c.deliveryFee));
        setDirty(true);
      }} />
    </div>
  );
}

/** Add a product line (POS catalogue in memory; price = the unit's retail price, editable after). */
function ProductPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (it: DetailItem) => void }) {
  const products = useProductStore((s) => s.products);
  usePosDataDemand({ products: true }, open);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open && products.length === 0) void useProductStore.getState().fetchProducts();
  }, [open, products.length]);
  const found = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return products.filter((p) => words.every((w) => p.name.toLowerCase().includes(w) || p.sku.toLowerCase().includes(w))).slice(0, 12);
  }, [q, products]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>เพิ่มสินค้าในออเดอร์</DialogTitle></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัสสินค้า" aria-label="ค้นหาสินค้า" autoFocus />
        <ul className="max-h-80 overflow-y-auto space-y-1">
          {found.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-2">
              <p className="text-sm font-semibold">{p.name} <span className="text-xs text-slate-500">{p.sku}</span></p>
              <div className="mt-1 flex flex-wrap gap-btn">
                {p.units.map((u) => (
                  <Button key={u.id} size="sm" variant="outline" onClick={() => {
                    onPick({ productId: p.id, sku: p.sku, name: p.name, unitId: isBaseUnit(u.id) ? null : u.id, unitName: u.unitName, factor: u.factor, quantity: 1, unitPrice: u.price, total: u.price });
                    onClose();
                  }}>
                    {u.unitName} {formatCurrency(u.price)}
                  </Button>
                ))}
              </div>
            </li>
          ))}
          {q.trim() && found.length === 0 && <li className="p-3 text-sm text-slate-500">ไม่พบสินค้า</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

interface CustomerHit { id: string; name: string; phone: string | null; priceLevel?: number; deliveryFee?: number | null }

/** Pick a member (server search) or create one from the order's contact. */
function CustomerPicker({ open, onClose, onPick, defaultName, defaultPhone }: { open: boolean; onClose: () => void; onPick: (c: NonNullable<Detail['customer']>) => void; defaultName: string; defaultPhone: string }) {
  const [q, setQ] = useState(defaultPhone);
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !q.trim()) return;
    const t = setTimeout(() => {
      apiFetch<{ data: CustomerHit[] }>(`/customers?page=1&limit=10&search=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.data), () => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);
  const pick = (c: CustomerHit) => {
    onPick({ id: c.id, name: c.name, phone: c.phone, priceLevel: Number(c.priceLevel) || 1, deliveryFee: c.deliveryFee ?? null });
    onClose();
  };
  const create = async () => {
    setBusy(true);
    try {
      const c = await apiFetch<CustomerHit>('/customers', { method: 'POST', body: JSON.stringify({ name: defaultName, phone: defaultPhone, priceLevel: 1 }) });
      toast.success(`สร้างลูกค้า ${c.name} แล้ว`);
      pick(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สร้างลูกค้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>เลือกลูกค้าสมาชิก</DialogTitle></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อ / เบอร์โทร" aria-label="ค้นหาลูกค้า" autoFocus />
        <ul className="max-h-72 overflow-y-auto space-y-1">
          {hits.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => pick(c)} className="w-full rounded-lg border border-slate-200 p-2 text-left text-sm hover:border-emerald-400 focus-visible:outline-2 focus-visible:outline-sky-500">
                <b>{c.name}</b> · {c.phone || '-'} · ราคาระดับ {c.priceLevel || 1}
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-btn">
          <Button variant="outline" disabled={busy} onClick={() => void create()}>สร้างลูกค้าใหม่ “{defaultName}” {defaultPhone}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
