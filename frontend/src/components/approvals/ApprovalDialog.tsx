'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShieldCheck, Delete } from 'lucide-react';
import { toast } from 'sonner';

export interface ApprovalNeeded {
  ticket: string;
  reasons: { code: string; message: string }[];
  total?: number;
}

/**
 * Manager / owner approves on this terminal with their PIN (mode 1).
 * The server returns a single-use approval id bound to this exact bill.
 */
export function ApprovalDialog({ request, onApproved, onCancel }: { request: ApprovalNeeded | null; onApproved: (approvalId: string, approvedBy: string) => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (request) { setPin(''); setNote(''); } }, [request]);

  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin)) return toast.error('กรุณาใส่ PIN 4-6 หลักของผู้อนุมัติ');
    setBusy(true);
    try {
      const res = await apiFetch('/approvals/pin', { method: 'POST', body: JSON.stringify({ ticket: request!.ticket, pin, note: note || undefined }) });
      toast.success(`อนุมัติโดย ${res.approvedBy}`);
      onApproved(res.approvalId, res.approvedBy);
    } catch (err) {
      setPin('');
      toast.error((err as Error | undefined)?.message || 'อนุมัติไม่สำเร็จ');
    } finally { setBusy(false); }
  };
  const press = (k: string) => setPin((p) => (k === 'del' ? p.slice(0, -1) : p.length < 6 ? p + k : p));

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-amber-600" /> ต้องให้ผู้จัดการอนุมัติ</DialogTitle></DialogHeader>
        {request && (
          <div className="space-y-3 text-sm">
            <ul className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1 text-amber-900">
              {request.reasons.map((r, i) => <li key={i}>• {r.message}</li>)}
            </ul>
            {request.total != null && <div className="text-right text-slate-600">ยอดบิล <b>{formatCurrency(request.total)}</b></div>}
            <div className="text-center text-xs text-slate-500">ผู้จัดการ / เจ้าของ กด PIN ของตัวเอง</div>
            <div className="flex justify-center gap-2 h-10 items-center" aria-label="PIN">
              {Array.from({ length: 6 }).map((_, i) => <span key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? 'bg-slate-900' : 'bg-slate-200'}`} />)}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => k === '' ? <span key="blank" /> : (
                <Button key={k} type="button" variant="outline" className="h-12 text-lg font-bold" onClick={() => press(k)}>
                  {k === 'del' ? <Delete className="w-5 h-5" /> : k}
                </Button>
              ))}
            </div>
            <input className="w-full h-9 rounded-lg border border-slate-300 px-2 text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุการอนุมัติ (ไม่บังคับ)" />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>ยกเลิก</Button>
          <Button disabled={busy || pin.length < 4} className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => void submit()}>{busy ? 'กำลังตรวจสอบ...' : 'อนุมัติ'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
