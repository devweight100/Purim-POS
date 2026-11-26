'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Plus, Trash2, X, Store, Truck, ShoppingCart, ClipboardList, Hand, LockOpen, Undo2, PackageCheck, MoreHorizontal, Pencil, PlayCircle, Send, CheckCheck, Ban, CircleCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatListDateTime, cn } from '@/lib/utils';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { acquirePosData, usePosDataDemand } from '@/lib/pos-data-policy';
import { onlineLineTotal, onlineOrderTotals, ONLINE_STATUS_LABELS, parseDeliveryFee, type OnlineOrderStatus } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { onlineOrderCartItems } from '@/lib/online-order-cart';
import { ReasonDialog } from '@/components/common/ReasonDialog';
import { askConfirm } from '@/lib/ask-dialog';
import { useAuthStore } from '@/lib/store/auth-store';
import { claimLabel, claimOrder, fetchPosPayload, isClaimConflict, markPicked, pickedLabel, printOnlinePickingSlip, releaseOrder, type OnlineClaim, type OnlinePicked } from '@/lib/online-order-actions';
import { isPickingAction, onlineOrderStep, type StepAction, type StepInfo } from '@/lib/online-order-steps';

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
  /** staff LINE group alerts of this order (Round B): sends so far, next reminder, log newest first */
  staffAlerts?: { count: number; nextAt: string | null; log: { kind: string; ok: boolean; result: string; createdAt: string }[] };
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
      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap ${PILL[status]}`}>{ONLINE_STATUS_LABELS[status]}</span>
      {paid && <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800 whitespace-nowrap">ชำระแล้ว</span>}
    </span>
  );
}

/** ใหม่ → รับงาน → จัดของ → จัดเสร็จ → (กำลังส่ง) → เสร็จ, the current step highlighted. */
export function StepIndicator({ info, cancelled }: { info: StepInfo; cancelled?: boolean }) {
  return (
    <ol aria-label="ขั้นตอนออเดอร์" data-testid="order-steps" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      {info.steps.map((s, i) => {
        const done = !cancelled && (i < info.current || (s.key === 'DONE' && info.current === i));
        const now = !cancelled && i === info.current && s.key !== 'DONE';
        return (
          <Fragment key={s.key}>
            {i > 0 && <li aria-hidden className={cn('h-0.5 w-4 lg:w-6', i <= info.current && !cancelled ? 'bg-emerald-500' : 'bg-slate-200')} />}
            <li
              aria-current={now ? 'step' : undefined}
              data-state={now ? 'current' : done ? 'done' : 'todo'}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 whitespace-nowrap',
                now ? 'border-indigo-600 bg-indigo-600 font-semibold text-white' : done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500',
              )}
            >
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs', now ? 'bg-white text-indigo-700' : done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500')}>
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s.label}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

const when = (iso: string) => formatListDateTime(iso); // detail view: date + time
const isBaseUnit = (id: string) => /^u-.*-base$/.test(id);

const STEP_ICON: Record<StepAction, typeof Check> = { accept: Check, prepare: PlayCircle, picked: PackageCheck, deliver: Send, done: CheckCheck, pay: ShoppingCart };

/**
 * One online order in a full-screen window (owner 2026-11-26, docs/online-orders-flow.md): header, step indicator +
 * what to do now, ONE next-step button (focused: Enter does it), the รับเงิน slot always in the same place, rare
 * actions (edit, claim / release / take over, close, cancel) in a secondary area. Esc / ปิด returns to the list.
 */
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
  const [editing, setEditing] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState<'product' | 'customer' | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const payRef = useRef<HTMLButtonElement | null>(null);
  const feeRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const ownStep = useRef(false);

  const apply = useCallback((x: Detail) => {
    setD(x);
    setItems(x.items);
    setFee(x.deliveryFee === null ? '' : String(x.deliveryFee));
    setCustomer(x.customer);
    setDirty(false);
    setEditing(false);
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

  const paid = !!d?.posOrder;
  const step = d ? onlineOrderStep({ status: d.status, fulfillment: d.fulfillment, paid }) : null;
  const stepAction = step?.primary?.action;

  // keyboard first: after loading and after every step the next-step button (or รับเงิน) has the focus, so Enter
  // does the next step; typing in a field is never interrupted
  useEffect(() => {
    if (!d) return;
    const t = setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      // a change made here (a step done from the fee field with Enter) moves on; a live update from another
      // terminal never takes the focus out of a field
      const own = ownStep.current;
      ownStep.current = false;
      if (!own && a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (document.querySelector('[data-slot="dialog-content"] [data-testid="reason-dialog"], [data-testid="confirm-dialog"]')) return;
      (stepAction === 'pay' ? payRef.current : primaryRef.current ?? payRef.current ?? closeRef.current)?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [d?.id, d?.status, stepAction, paid]); // eslint-disable-line react-hooks/exhaustive-deps

  const heldByOther = !!d?.claim && d.claim.userId !== me?.id;
  const lockReason = heldByOther ? `${claimLabel(d?.claim)} — งานจัดของทำไม่ได้จนกว่าจะปล่อยงาน${manager ? ' (หรือเลือก "ปลดล็อก/โอนมาที่ฉัน" ในเมนูอื่นๆ)' : ''} รับเงินได้ตามปกติ` : undefined;
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

  const close = async () => {
    if (dirtyRef.current && !(await askConfirm({ title: 'ยังไม่ได้บันทึกการแก้ไข', description: 'ปิดหน้าต่างและทิ้งการแก้ไข?', confirmLabel: 'ทิ้งการแก้ไข', danger: true }))) return;
    onBack();
  };

  const shell = (children: React.ReactNode) => (
    <Dialog open onOpenChange={(o) => !o && void close()}>
      <DialogContent
        showCloseButton={false}
        initialFocus={closeRef}
        aria-label="รายละเอียดออเดอร์ออนไลน์"
        className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 text-sm ring-0 data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        {children}
      </DialogContent>
    </Dialog>
  );

  if (!d || !step) {
    return shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-slate-500" data-testid="online-order-detail">
        <DialogTitle className="sr-only">ออเดอร์ออนไลน์</DialogTitle>
        กำลังโหลด…
        <Button ref={closeRef} variant="outline" onClick={() => onBack()}>ปิด</Button>
      </div>,
    );
  }

  const body = () => ({
    items: items.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.quantity, unitPrice: i.unitPrice })),
    ...(d.fulfillment === 'DELIVERY' ? { deliveryFee: fee.trim() === '' ? null : Number(fee) } : {}),
    customerId: customer?.id ?? null,
    usePriceLevel: false,
  });

  const run = async (fn: () => Promise<Detail>, ok: string) => {
    setBusy(true);
    try {
      const x = await fn();
      ownStep.current = true;
      apply(x);
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
      if (isClaimConflict(e)) void load();
    } finally {
      setBusy(false);
    }
  };
  const needSave = (what: string) => {
    if (!dirty) return false;
    toast.error(`บันทึกการแก้ไขก่อน แล้วจึง${what}`);
    return true;
  };
  const claim = () => run(() => claimOrder<Detail>(d.id), `รับจัดออเดอร์ ${d.orderNo} แล้ว`);
  const picked = () => {
    if (needSave('กดจัดของเสร็จ')) return;
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
    if (needSave('พิมพ์ใบจัดของ')) return;
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
      feeRef.current?.focus();
      return;
    }
    return run(() => apiFetch<Detail>(`/online-shop/orders/${d.id}/accept`, { method: 'POST', body: JSON.stringify(body()) }), `รับงาน ${d.orderNo} แล้ว — ต่อไป: เริ่มจัดของ (รับเงินได้ทุกเมื่อ)`);
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
    if (needSave(`เปลี่ยนเป็น "${ONLINE_STATUS_LABELS[status]}"`)) return;
    let unpaidOk = false;
    if (status === 'DONE' && !d.posOrder) {
      if (!(await askConfirm({ title: 'ออเดอร์นี้ยังไม่ได้รับเงินในหน้าขาย', description: 'ปิดออเดอร์โดยไม่บันทึกการขาย?', confirmLabel: 'ปิดออเดอร์', danger: true }))) return;
      unpaidOk = true;
    }
    await run(() => apiFetch<Detail>(`/online-shop/orders/${d.id}/status`, { method: 'POST', body: JSON.stringify({ status, unpaidOk }) }), `เปลี่ยนเป็น "${ONLINE_STATUS_LABELS[status]}" แล้ว`);
  };
  const openInPos = async () => {
    if (needSave('รับเงิน')) return;
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
  const doStep = (a: StepAction) => {
    switch (a) {
      case 'accept': return void accept();
      case 'prepare': return void setStatus('PREPARING');
      case 'picked': return void picked();
      case 'deliver': return void setStatus('DELIVERING');
      case 'done': return void setStatus('DONE');
      case 'pay': return void openInPos();
    }
  };

  const change = (idx: number, patch: Partial<DetailItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch, total: onlineLineTotal({ quantity: patch.quantity ?? it.quantity, unitPrice: patch.unitPrice ?? it.unitPrice }) } : it)));
    setDirty(true);
  };
  const editRows = editable && editing;
  const primary = step.primary;
  const primaryLocked = !!primary && isPickingAction(primary.action) && heldByOther;
  const PrimaryIcon = primary ? STEP_ICON[primary.action] : Check;
  // rare actions: the อื่นๆ menu (never next to the step button)
  const closeNow = isOpen && d.nextStatuses.includes('DONE') && primary?.action !== 'done';
  const claimable = !d.claim && (d.status === 'NEW' || canPick);
  const hasMenu = claimable || (!!d.claim && !heldByOther) || (heldByOther && manager) || closeNow || actionable;

  return shell(
    <div className="flex h-full min-h-0 flex-col" data-testid="online-order-detail">
      {/* header: order no, status, customer, pickup / delivery, close */}
      <header className="flex items-start justify-between gap-btn border-b border-slate-200 px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <DialogTitle className="text-xl font-semibold text-slate-900">{d.orderNo}</DialogTitle>
            <StatusPill status={d.status} paid={paid} />
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              {d.fulfillment === 'PICKUP' ? <Store className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
              {d.fulfillment === 'PICKUP' ? 'รับเองที่ร้าน' : 'ให้ร้านไปส่ง'}
            </span>
          </div>
          <DialogDescription className="mt-0.5 truncate text-sub text-muted-foreground">
            {d.contactName} · {d.contactPhone} · สั่งเมื่อ {when(d.createdAt)} · LINE: {d.lineName || '-'}
            {d.testProfile ? ' (โปรไฟล์ทดสอบ)' : ''}
          </DialogDescription>
        </div>
        <Button ref={closeRef} variant="outline" onClick={() => void close()} className="shrink-0 gap-1" aria-label="ปิด กลับไปรายการ (Esc)" title="กลับไปรายการ (Esc)">
          <X className="h-4 w-4" /> ปิด <span className="text-xs text-muted-foreground">Esc</span>
        </Button>
      </header>

      {/* where the order is and what to do now */}
      <div className="space-y-2 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:px-6">
        <StepIndicator info={step} cancelled={d.status === 'CANCELLED'} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p data-testid="step-hint" className="font-semibold text-slate-900">
            <span className="text-indigo-700">ตอนนี้:</span> {step.hint}
          </p>
          {isOpen && (
            <div data-testid="claim-bar" className="flex min-w-0 flex-wrap items-center gap-2 text-sub text-slate-600">
              <ClaimBadge claim={d.claim} meId={me?.id} status={d.status} picked={d.picked} />
              <span>
                {!d.claim
                  ? d.picked
                    ? 'จัดของเสร็จแล้ว — ใครก็รับเงิน/ส่งมอบได้'
                    : d.status === 'NEW' || canPick
                      ? 'ยังไม่มีใครรับจัด (กดรับงาน / เริ่มจัดของ ระบบล็อกไว้ที่คุณ)'
                      : 'ไม่มีใครถืองานจัดของอยู่'
                  : heldByOther
                    ? `${d.claim.name} กำลังจัดออเดอร์นี้`
                    : 'คุณเป็นผู้จัดออเดอร์นี้'}
                {d.picked && d.claim ? ` · ${pickedLabel(d.picked)}` : ''}
                {d.pickingPrintCount > 0 ? ` · พิมพ์ใบจัดของแล้ว ${d.pickingPrintCount} ครั้ง` : ''}
              </span>
            </div>
          )}
        </div>
        {heldByOther && <p className="rounded-lg bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-800" role="status">{lockReason}</p>}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:grid-rows-1">
        {/* items: the only long part, scrolls on its own */}
        <section aria-label="รายการสินค้า" className="min-h-0 overflow-y-auto px-4 py-3 lg:px-6">
          <table className="tbl w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">สินค้า ({items.length} รายการ)</th>
                <th className="text-right w-24">จำนวน</th>
                <th className="text-right w-28">ราคา/หน่วย</th>
                <th className="text-right w-28">รวม</th>
                {editRows && <th className="w-12"><span className="sr-only">ลบ</span></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.productId}|${it.unitId}`}>
                  <td>
                    <span className="font-medium">{it.name}</span>
                    <span className="block text-sub text-muted-foreground">{it.sku} · {it.unitName}{it.factor > 1 ? ` (${it.factor} ชิ้นฐาน)` : ''}{it.active === false ? ' · ปิดขายแล้ว' : ''}</span>
                  </td>
                  <td className="text-right">
                    {editRows ? (
                      <Input aria-label={`จำนวน ${it.name}`} type="number" min={1} step={1} className="h-9 w-20 text-right ml-auto" value={it.quantity} onChange={(e) => change(i, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} />
                    ) : (
                      <span className="tabular-nums">{it.quantity.toLocaleString('th-TH')} <span className="text-muted-foreground">{it.unitName}</span></span>
                    )}
                  </td>
                  <td className="text-right">
                    {editRows ? (
                      <Input aria-label={`ราคา ${it.name}`} type="number" min={0} step={0.01} className="h-9 w-24 text-right ml-auto" value={it.unitPrice} onChange={(e) => change(i, { unitPrice: Math.max(0, Math.round(Number(e.target.value) * 100) / 100 || 0) })} />
                    ) : (
                      <span className="tabular-nums">{formatCurrency(it.unitPrice)}</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums font-medium">{formatCurrency(it.total)}</td>
                  {editRows && (
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
          {editRows && (
            <Button size="sm" variant="outline" className="mt-3 gap-1" onClick={() => setPickOpen('product')}>
              <Plus className="w-4 h-4" /> เพิ่มสินค้า
            </Button>
          )}
        </section>

        {/* money + payment (always the same place) + customer */}
        <aside aria-label="ยอดเงินและลูกค้า" className="min-h-0 space-y-3 overflow-y-auto border-t border-slate-200 bg-slate-50 px-4 py-3 lg:border-t-0 lg:border-l">
          <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex justify-between"><span>ค่าสินค้า</span><b className="tabular-nums">{formatCurrency(totals.subtotal)}</b></div>
            <div className="flex items-center justify-between gap-btn">
              {d.fulfillment === 'PICKUP' ? <span>ค่าส่ง</span> : editable ? <label htmlFor="online-fee">ค่าส่ง</label> : <span>ค่าส่ง</span>}
              {d.fulfillment === 'PICKUP' ? (
                <b>ไม่มี (รับที่ร้าน)</b>
              ) : editable ? (
                <Input
                  ref={feeRef}
                  id="online-fee"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="ใส่ค่าส่ง"
                  className={`h-9 w-28 text-right ${fee.trim() === '' ? 'border-amber-500' : ''}`}
                  value={fee}
                  onChange={(e) => { setFee(e.target.value); setDirty(true); }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (d.status === 'NEW') void accept();
                    else if (dirty) void save();
                  }}
                />
              ) : (
                <b className="tabular-nums">{d.deliveryFee === null ? 'ยังไม่ระบุ' : formatCurrency(d.deliveryFee)}</b>
              )}
            </div>
            {!feeParsed.ok && <p className="text-xs text-rose-700">{feeParsed.error}</p>}
            <div className="flex justify-between border-t border-slate-200 pt-1 text-base"><span className="font-bold">ยอดรวม</span><b className="tabular-nums text-emerald-800" data-testid="order-total">{formatCurrency(totals.total)}{totals.feePending && d.fulfillment === 'DELIVERY' ? ' + ค่าส่ง' : ''}</b></div>
          </div>

          <div data-testid="payment-slot" className="rounded-xl border border-slate-200 bg-white p-3">
            {step.payment.state === 'paid' && d.posOrder ? (
              <p data-testid="payment-paid" className="flex items-center gap-2 font-semibold text-emerald-800">
                <CircleCheck className="h-5 w-5 shrink-0" /> ชำระแล้ว · บิล {d.posOrder.orderNumber} ({formatCurrency(d.posOrder.totalAmount)})
              </p>
            ) : step.payment.state === 'hidden' ? (
              <p className="text-slate-500">{d.status === 'DONE' ? 'ปิดออเดอร์โดยไม่ได้รับเงินในหน้าขาย' : 'ไม่มีการรับเงิน'}</p>
            ) : (
              <>
                <Button
                  ref={payRef}
                  size="lg"
                  disabled={busy || step.payment.state === 'disabled'}
                  onClick={() => void openInPos()}
                  className="w-full gap-2 bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500"
                  title={step.payment.state === 'disabled' ? step.payment.reason : 'เปิดเป็นบิลที่หน้าขาย แล้วรับชำระ'}
                >
                  <ShoppingCart className="h-4 w-4" /> รับเงิน
                </Button>
                <p className="mt-1.5 text-sub text-muted-foreground">
                  {step.payment.state === 'disabled'
                    ? step.payment.reason
                    : `เปิดบิลที่หน้าขายแล้วรับชำระ — รับได้ทุกขั้นตอน${d.picked ? '' : ' (ยังไม่ได้จัดของ: ตรวจของก่อนส่งมอบ)'}`}
                </p>
              </>
            )}
          </div>

          <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
            <p className="font-semibold">{d.fulfillment === 'PICKUP' ? 'ลูกค้ามารับที่ร้าน' : 'ส่งที่'}</p>
            <p>
              {d.contactName} · <a className="underline" href={`tel:${d.contactPhone}`}>{d.contactPhone}</a>
            </p>
            {d.address && <p className="text-slate-700 whitespace-pre-line">{d.address}</p>}
            {d.note && <p className="text-amber-800">หมายเหตุ: {d.note}</p>}
            <p className="pt-1 text-slate-600">
              {customer ? (
                <>สมาชิก: {customer.name}{customer.phone ? ` · ${customer.phone}` : ''} · ราคาระดับ {customer.priceLevel}{customer.deliveryFee != null ? ` · ค่าส่ง ${formatCurrency(customer.deliveryFee)}` : ''}</>
              ) : (
                <>ลูกค้าทั่วไป (ยังไม่ผูกสมาชิก) · ราคาที่สั่ง: {d.levelName}</>
              )}
            </p>
            {editRows && (
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

          {d.rejectReason && <p className="rounded-lg bg-rose-50 p-2 text-rose-800">เหตุผลที่ยกเลิก: {d.rejectReason}</p>}
          {d.picked && !isOpen && <p data-testid="picked-note" className="rounded-lg bg-emerald-50 p-2 font-semibold text-emerald-900">✓ {pickedLabel(d.picked)}</p>}
          <p className="text-xs text-slate-500">LINE: {d.lineNotice || 'ยังไม่มีการแจ้ง'}</p>
          {d.staffAlerts && d.staffAlerts.log.length > 0 && (
            <details className="text-xs text-slate-500" data-testid="staff-alert-log">
              <summary className="cursor-pointer">
                แจ้งกลุ่มพนักงาน {d.staffAlerts.log.length} ครั้ง{d.staffAlerts.nextAt ? ` · เตือนครั้งถัดไป ${formatListDateTime(d.staffAlerts.nextAt)}` : ''}
              </summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {d.staffAlerts.log.map((l, i) => (
                  <li key={i} className={l.ok ? '' : 'text-danger'}>{formatListDateTime(l.createdAt)} · {l.result}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>

      {/* the next step (one button) on the left; rare actions on the far right */}
      <footer className="flex flex-wrap items-center justify-between gap-btn border-t border-slate-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center gap-btn" data-testid="step-actions">
          {primary && primary.action !== 'pay' && (
            <Button
              ref={primaryRef}
              size="lg"
              data-testid="step-primary"
              disabled={busy || primaryLocked}
              title={primaryLocked ? lockReason : undefined}
              onClick={() => doStep(primary.action)}
              className="gap-2"
            >
              <PrimaryIcon className="h-4 w-4" /> {primary.label}
            </Button>
          )}
          {primary?.action === 'pay' && <p className="font-semibold text-emerald-800">ขั้นต่อไป: กด “รับเงิน” (ด้านขวา)</p>}
          {isOpen && d.status !== 'NEW' && (
            <Button disabled={busy || heldByOther} title={lockReason || 'พิมพ์ใบจัดของ (ชื่อสินค้า หน่วย จำนวน ไม่มีราคา) — รับจัดออเดอร์ให้อัตโนมัติ'} variant="outline" onClick={() => void printSlip()} className="gap-1">
              <ClipboardList className="w-4 h-4" /> พิมพ์ใบจัดของ{d.pickingPrintCount > 0 ? ' (ซ้ำ)' : ''}
            </Button>
          )}
          {editable && dirty && (
            <Button disabled={busy} variant="outline" onClick={() => void save()} className="border-amber-500 text-amber-900">
              {d.status === 'NEW' ? 'บันทึก (ยังไม่รับ)' : 'บันทึกการแก้ไข'}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-btn">
          {editable && (
            <Button variant="outline" aria-pressed={editing} onClick={() => setEditing((x) => !x)} className="gap-1">
              <Pencil className="h-4 w-4" /> {editing ? 'เลิกแก้ไขรายการ' : 'แก้ไขรายการ'}
            </Button>
          )}
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" className="gap-1" />} data-testid="order-more">
                <MoreHorizontal className="h-4 w-4" /> อื่นๆ
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                {claimable && (
                  <DropdownMenuItem disabled={busy} onClick={() => void claim()} className="gap-2 py-2">
                    <Hand className="h-4 w-4" /> รับจัดออเดอร์นี้
                  </DropdownMenuItem>
                )}
                {d.claim && !heldByOther && (
                  <DropdownMenuItem disabled={busy} onClick={() => void release()} className="gap-2 py-2">
                    <Undo2 className="h-4 w-4" /> ปล่อยงาน
                  </DropdownMenuItem>
                )}
                {heldByOther && manager && (
                  <DropdownMenuItem disabled={busy} onClick={() => setTakeoverOpen(true)} className="gap-2 py-2">
                    <LockOpen className="h-4 w-4" /> ปลดล็อก/โอนมาที่ฉัน
                  </DropdownMenuItem>
                )}
                {closeNow && (
                  <DropdownMenuItem disabled={busy} onClick={() => void setStatus('DONE')} className="gap-2 py-2">
                    <CheckCheck className="h-4 w-4" /> ปิดออเดอร์เลย (ข้ามขั้นตอน)
                  </DropdownMenuItem>
                )}
                {actionable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={busy || heldByOther} onClick={() => setRejectOpen(true)} className="gap-2 py-2" title={lockReason}>
                      <Ban className="h-4 w-4" /> ยกเลิกออเดอร์
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </footer>

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
    </div>,
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
