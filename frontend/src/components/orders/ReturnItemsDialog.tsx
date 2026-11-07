'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useShiftStore } from '@/lib/store/shift-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';

interface OrderItem { id: string; productId: string; quantity: number; baseQuantity?: number | null; unitName?: string | null; total: number | string; product?: { name: string; unit?: string | null } }
interface OrderDetail {
  id: string; orderNumber: string; subtotal: number | string; totalAmount: number | string; returnedAmount?: number | string;
  items: OrderItem[]; debt?: { remainingAmount: number | string } | null;
  returns?: { returnNumber: string; refundAmount: number | string; createdAt: string; items: { orderItemId: string; quantity: number }[] }[];
}
type Method = 'CASH' | 'TRANSFER' | 'DEBT_REDUCTION';
const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ret-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Return some items / quantities of a completed bill and refund the customer. */
export function ReturnItemsDialog({ orderId, onClose, onDone }: { orderId: string | null; onClose: () => void; onDone: () => void }) {
  const currentShift = useShiftStore((s) => s.currentShift);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<Method>('CASH');
  const [banks, setBanks] = useState<{ id: string; bankName: string; accountNumber: string; isDefault?: boolean }[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [clientId, setClientId] = useState(newId());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setOrder(null); setQty({}); setRestock({}); setReason(''); setClientId(newId()); setMethod('CASH');
    apiFetch(`/orders/${orderId}`).then(setOrder).catch((err: any) => toast.error(err?.message || 'โหลดบิลไม่สำเร็จ'));
    api.bankAccounts.getAll().then((rows: any[]) => { setBanks(rows || []); setBankAccountId(rows?.find((b) => b.isDefault)?.id || rows?.[0]?.id || ''); }).catch(() => setBanks([]));
  }, [orderId]);

  const returned = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of order?.returns || []) for (const it of r.items) m.set(it.orderItemId, (m.get(it.orderItemId) || 0) + it.quantity);
    return m;
  }, [order]);
  const billFactor = order && Number(order.subtotal) > 0 ? Number(order.totalAmount) / Number(order.subtotal) : 1;
  const refund = useMemo(() => {
    if (!order) return 0;
    let sum = 0;
    for (const it of order.items) sum += ((Number(it.total) * (qty[it.id] || 0)) / it.quantity) * billFactor;
    return Math.round(sum * 100) / 100;
  }, [order, qty, billFactor]);
  const debtLeft = Number(order?.debt?.remainingAmount || 0);

  const submit = async () => {
    if (!order) return;
    const items = order.items.filter((it) => (qty[it.id] || 0) > 0).map((it) => ({ orderItemId: it.id, quantity: qty[it.id], restock: restock[it.id] !== false }));
    if (!items.length) return toast.error('กรุณาระบุจำนวนสินค้าที่ลูกค้าคืน');
    if (!reason.trim()) return toast.error('กรุณาระบุเหตุผลการคืน');
    if (method === 'CASH' && !currentShift?.id) return toast.error('คืนเงินสดต้องเปิดกะที่หน้าขายก่อน');
    setSaving(true);
    try {
      const res = await apiFetch(`/orders/${order.id}/returns`, {
        method: 'POST',
        body: JSON.stringify({ clientReturnId: clientId, items, refundMethod: method, bankAccountId: method === 'TRANSFER' ? bankAccountId : undefined, shiftId: method === 'CASH' ? currentShift?.id : undefined, reason }),
      });
      toast.success(`บันทึกรับคืน ${res.returnNumber} คืนเงิน ${formatCurrency(res.refundAmount)} แล้ว`);
      if (method === 'CASH') void useShiftStore.getState().fetchCurrentShift();
      onClose(); onDone();
    } catch (err: any) { toast.error(err?.message || 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!orderId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><RotateCcw className="w-5 h-5 text-amber-600" /> รับคืนสินค้า {order ? `บิล ${order.orderNumber}` : ''}</DialogTitle></DialogHeader>
        {!order ? <div className="p-6 text-slate-400">กำลังโหลด...</div> : (
          <div className="space-y-3 text-sm max-h-[65vh] overflow-y-auto pr-1">
            <table className="w-full text-sm">
              <thead className="text-slate-500"><tr><th className="text-left p-1">สินค้า</th><th className="text-right p-1">ซื้อ</th><th className="text-right p-1">คืนแล้ว</th><th className="text-center p-1">คืนครั้งนี้</th><th className="text-center p-1">เข้าสต็อก</th></tr></thead>
              <tbody>
                {order.items.map((it) => {
                  const left = it.quantity - (returned.get(it.id) || 0);
                  return (
                    <tr key={it.id} className="border-t border-slate-100">
                      <td className="p-1">{it.product?.name}<div className="text-xs text-slate-400">{formatCurrency(Number(it.total) / it.quantity)} / {it.unitName || it.product?.unit || 'ชิ้น'}</div></td>
                      <td className="p-1 text-right">{it.quantity}</td>
                      <td className="p-1 text-right">{returned.get(it.id) || 0}</td>
                      <td className="p-1 text-center">
                        <Input type="number" min={0} max={left} disabled={left <= 0} className="w-20 h-8 mx-auto text-center" value={qty[it.id] || ''}
                          onChange={(e) => setQty({ ...qty, [it.id]: Math.max(0, Math.min(left, Math.floor(Number(e.target.value) || 0))) })} placeholder="0" />
                      </td>
                      <td className="p-1 text-center">
                        <input type="checkbox" checked={restock[it.id] !== false} onChange={(e) => setRestock({ ...restock, [it.id]: e.target.checked })} title="ติ๊ก = สินค้ายังดี นำกลับเข้าสต็อก / ไม่ติ๊ก = ของเสีย ไม่เข้าสต็อก" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">ไม่ติ๊ก &quot;เข้าสต็อก&quot; ถ้าของเสียหาย (ต้นทุนยังนับเป็นค่าใช้จ่าย ถ้าจะส่งเคลมบริษัทให้ทำเอกสารส่งคืนแยก)</p>
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant={method === 'CASH' ? 'default' : 'outline'} onClick={() => setMethod('CASH')}>คืนเงินสด</Button>
              <Button type="button" variant={method === 'TRANSFER' ? 'default' : 'outline'} onClick={() => setMethod('TRANSFER')}>โอนคืน</Button>
              <Button type="button" variant={method === 'DEBT_REDUCTION' ? 'default' : 'outline'} disabled={debtLeft <= 0} onClick={() => setMethod('DEBT_REDUCTION')}>หักจากหนี้{debtLeft > 0 ? ` (${formatCurrency(debtLeft)})` : ''}</Button>
            </div>
            {method === 'CASH' && <p className="text-xs text-slate-500">{currentShift?.id ? 'จ่ายเงินสดจากลิ้นชักของกะที่เปิดอยู่' : '⚠️ ยังไม่ได้เปิดกะ — เปิดกะที่หน้าขายก่อนคืนเงินสด'}</p>}
            {method === 'TRANSFER' && (
              <select className="w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                {banks.map((b) => <option key={b.id} value={b.id}>โอนจาก {b.bankName} {b.accountNumber}</option>)}
              </select>
            )}
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล เช่น ลูกค้าซื้อเกิน, สินค้าไม่ตรงรุ่น" />
            <div className="flex justify-between rounded-xl bg-amber-50 border border-amber-200 p-3 font-black">
              <span>ยอดคืนเงิน (รวมส่วนลดท้ายบิลตามสัดส่วน)</span><span className="font-mono">{formatCurrency(refund)}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={saving || !order || refund <= 0} className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => void submit()}>{saving ? 'กำลังบันทึก...' : 'ยืนยันรับคืน'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
