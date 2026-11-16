'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Check, Plus, Trash2, X, Store, Truck, ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { onlineLineTotal, onlineOrderTotals, ONLINE_STATUS_LABELS, parseDeliveryFee, type OnlineOrderStatus } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { onlineOrderCartItems } from '@/lib/online-order-cart';

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
}

const PILL: Record<OnlineOrderStatus, string> = {
  NEW: 'bg-amber-100 text-amber-900 border-amber-300',
  ACCEPTED: 'bg-sky-100 text-sky-900 border-sky-300',
  PREPARING: 'bg-sky-100 text-sky-900 border-sky-300',
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

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const isBaseUnit = (id: string) => /^u-.*-base$/.test(id);

/** One online order: edit items / prices / fee / member, accept, reject, status, open in the POS. */
export function OnlineOrderDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [items, setItems] = useState<DetailItem[]>([]);
  const [fee, setFee] = useState('');
  const [customer, setCustomer] = useState<Detail['customer']>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
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

  const editable = !!d && !d.posOrder && ['NEW', 'ACCEPTED', 'PREPARING', 'DELIVERING'].includes(d.status);
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
  const reject = () =>
    run(async () => {
      const r = await apiFetch<Detail>(`/online-shop/orders/${d.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
      setRejectOpen(false);
      setReason('');
      return r;
    }, 'ยกเลิกออเดอร์แล้ว');
  const setStatus = async (status: OnlineOrderStatus) => {
    if (status === 'CANCELLED') {
      setRejectOpen(true);
      return;
    }
    let unpaidOk = false;
    if (status === 'DONE' && !d.posOrder) {
      if (!window.confirm('ออเดอร์นี้ยังไม่ได้รับเงินในหน้าขาย ปิดออเดอร์โดยไม่บันทึกการขาย?')) return;
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
      const p = await apiFetch<Parameters<typeof onlineOrderCartItems>[0]>(`/online-shop/orders/${d.id}/pos`);
      const cartItems = onlineOrderCartItems(p, useProductStore.getState().products as never);
      const c = (p as unknown as { customer: { id: string; name: string } | null }).customer;
      useCartStore.getState().loadOnlineOrder({ id: p.id, orderNo: p.orderNo, customerId: c?.id || null, customerName: c?.name || null, note: p.note, items: cartItems });
      router.push('/pos');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปิดในหน้าขายไม่สำเร็จ');
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
            <h2 className="text-xl font-black text-slate-900">{d.orderNo}</h2>
            <p className="text-xs text-slate-500">
              สั่งเมื่อ {when(d.createdAt)} · LINE: {d.lineName || '-'}
              {d.testProfile ? ' (โปรไฟล์ทดสอบ)' : ''}
            </p>
          </div>
        </div>
        <StatusPill status={d.status} paid={!!d.paidAt} />
      </div>

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
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-left">สินค้า</th>
              <th className="p-2 text-right w-24">จำนวน</th>
              <th className="p-2 text-right w-28">ราคา/หน่วย</th>
              <th className="p-2 text-right w-28">รวม</th>
              {editable && <th className="p-2 w-12"><span className="sr-only">ลบ</span></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={`${it.productId}|${it.unitId}`} className="border-t border-slate-100">
                <td className="p-2">
                  <span className="font-semibold">{it.name}</span>
                  <span className="block text-xs text-slate-500">{it.sku} · {it.unitName}{it.factor > 1 ? ` (${it.factor} ชิ้นฐาน)` : ''}{it.active === false ? ' · ปิดขายแล้ว' : ''}</span>
                </td>
                <td className="p-2 text-right">
                  {editable ? (
                    <Input aria-label={`จำนวน ${it.name}`} type="number" min={1} step={1} className="h-9 w-20 text-right ml-auto" value={it.quantity} onChange={(e) => change(i, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} />
                  ) : (
                    it.quantity.toLocaleString('th-TH')
                  )}
                </td>
                <td className="p-2 text-right">
                  {editable ? (
                    <Input aria-label={`ราคา ${it.name}`} type="number" min={0} step={0.01} className="h-9 w-24 text-right ml-auto" value={it.unitPrice} onChange={(e) => change(i, { unitPrice: Math.max(0, Math.round(Number(e.target.value) * 100) / 100 || 0) })} />
                  ) : (
                    formatCurrency(it.unitPrice)
                  )}
                </td>
                <td className="p-2 text-right font-mono font-bold">{formatCurrency(it.total)}</td>
                {editable && (
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" aria-label={`ลบ ${it.name}`} disabled={items.length <= 1} onClick={() => { setItems((p) => p.filter((_, k) => k !== i)); setDirty(true); }}>
                      <Trash2 className="w-4 h-4 text-rose-600" />
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
        <div className="flex justify-between"><span>ค่าสินค้า</span><b className="font-mono">{formatCurrency(totals.subtotal)}</b></div>
        <div className="flex items-center justify-between gap-btn">
          <label htmlFor="online-fee">ค่าส่ง</label>
          {d.fulfillment === 'PICKUP' ? (
            <b>ไม่มี (รับที่ร้าน)</b>
          ) : editable ? (
            <Input id="online-fee" type="number" min={0} step={1} placeholder="ใส่ค่าส่ง" className={`h-9 w-28 text-right ${fee.trim() === '' ? 'border-amber-500' : ''}`} value={fee} onChange={(e) => { setFee(e.target.value); setDirty(true); }} />
          ) : (
            <b className="font-mono">{d.deliveryFee === null ? 'ยังไม่ระบุ' : formatCurrency(d.deliveryFee)}</b>
          )}
        </div>
        {!feeParsed.ok && <p className="text-xs text-rose-700">{feeParsed.error}</p>}
        <div className="flex justify-between border-t border-slate-200 pt-1 text-base"><span className="font-bold">ยอดรวม</span><b className="font-mono text-emerald-800">{formatCurrency(totals.total)}{totals.feePending && d.fulfillment === 'DELIVERY' ? ' + ค่าส่ง' : ''}</b></div>
      </div>

      {d.rejectReason && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">เหตุผลที่ยกเลิก: {d.rejectReason}</p>}
      {d.posOrder && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">รับเงินแล้ว บิล {d.posOrder.orderNumber} ({formatCurrency(d.posOrder.totalAmount)})</p>}
      <p className="text-xs text-slate-500">LINE: {d.lineNotice || 'ยังไม่มีการแจ้ง'}</p>

      <div className="flex flex-wrap gap-btn border-t border-slate-100 pt-3">
        {d.status === 'NEW' && (
          <Button disabled={busy} onClick={() => void accept()} className="gap-1 bg-emerald-700 hover:bg-emerald-800 text-white">
            <Check className="w-4 h-4" /> รับออเดอร์
          </Button>
        )}
        {editable && d.status !== 'NEW' && (
          <Button disabled={busy || !dirty} variant="outline" onClick={() => void save()}>บันทึกการแก้ไข</Button>
        )}
        {editable && d.status === 'NEW' && dirty && (
          <Button disabled={busy} variant="outline" onClick={() => void save()}>บันทึก (ยังไม่รับ)</Button>
        )}
        {editable && d.status !== 'NEW' && (
          <Button disabled={busy} onClick={() => void openInPos()} className="gap-1 bg-sky-600 hover:bg-sky-700 text-white">
            <ShoppingCart className="w-4 h-4" /> รับเงินที่หน้าขาย
          </Button>
        )}
        {d.nextStatuses.filter((s) => s !== 'CANCELLED').map((s) => (
          <Button key={s} disabled={busy} variant="outline" onClick={() => void setStatus(s)}>{ONLINE_STATUS_LABELS[s]}</Button>
        ))}
        {editable && (
          <Button disabled={busy} variant="outline" className="gap-1 text-rose-700 border-rose-300 hover:bg-rose-50" onClick={() => setRejectOpen(true)}>
            <X className="w-4 h-4" /> ยกเลิกออเดอร์
          </Button>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>ยกเลิกออเดอร์ {d.orderNo}</DialogTitle></DialogHeader>
          <label className="text-sm font-semibold" htmlFor="reject-reason">เหตุผล (ลูกค้าจะเห็นข้อความนี้ใน LINE)</label>
          <Input id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น สินค้าหมด / ส่งไม่ถึงพื้นที่" autoFocus />
          <DialogFooter className="gap-btn">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>ไม่ยกเลิก</Button>
            <Button disabled={busy || !reason.trim()} className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => void reject()}>ยืนยันยกเลิก</Button>
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
