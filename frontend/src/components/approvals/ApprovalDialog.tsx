'use client';

import { useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShieldCheck } from 'lucide-react';
import { PinPad } from '@/components/common/PinPad';
import { isCompletePin } from '@/lib/keyboard/pad-keys';
import { toast } from 'sonner';

export interface ApprovalNeeded {
  ticket: string;
  reasons: { code: string; message: string }[];
  total?: number;
}

/**
 * Manager / owner approves on this terminal with their PIN (mode 1).
 * The server returns a single-use approval id bound to this exact bill.
 * Keyboard: the PIN field has the focus (shared PinPad), Enter = อนุมัติ, Esc = ยกเลิก (docs/pos-keyboard-scan.md).
 */
export function ApprovalDialog({ request, onApproved, onCancel }: { request: ApprovalNeeded | null; onApproved: (approvalId: string, approvedBy: string) => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // fresh PIN / note for each request (adjusted while rendering)
  const [seenRequest, setSeenRequest] = useState(request);
  if (seenRequest !== request) {
    setSeenRequest(request);
    if (request) { setPin(''); setNote(''); }
  }

  const pinRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const submit = async () => {
    // Enter + click, or Enter held down: one request only
    if (busyRef.current || !request) return;
    if (!isCompletePin(pin)) {
      toast.error('กรุณาใส่ PIN 4-6 หลักของผู้อนุมัติ');
      pinRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await apiFetch('/approvals/pin', { method: 'POST', body: JSON.stringify({ ticket: request.ticket, pin, note: note || undefined }) });
      toast.success(`อนุมัติโดย ${res.approvedBy}`);
      onApproved(res.approvalId, res.approvedBy);
    } catch (err) {
      setPin('');
      toast.error((err as Error | undefined)?.message || 'อนุมัติไม่สำเร็จ');
      setTimeout(() => pinRef.current?.focus(), 0);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && !busyRef.current && onCancel()}>
      <DialogContent className="max-w-sm" data-testid="approval-pin-dialog" initialFocus={pinRef}>
        <DialogHeader><DialogTitle className="flex items-center gap-2 pr-8"><ShieldCheck className="w-5 h-5 text-amber-600" /> ต้องให้ผู้จัดการอนุมัติ</DialogTitle></DialogHeader>
        {request && (
          <form
            className="space-y-2.5 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <ul className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 space-y-1 text-amber-900">
              {request.reasons.map((r, i) => <li key={i}>• {r.message}</li>)}
            </ul>
            {request.total != null && <div className="text-right text-slate-600">ยอดบิล <b>{formatCurrency(request.total)}</b></div>}
            <label htmlFor="approval-pin" className="block text-center text-xs text-slate-500">ผู้จัดการ / เจ้าของ ใส่ PIN ของตัวเอง</label>
            <PinPad ref={pinRef} id="approval-pin" label="PIN ผู้อนุมัติ" value={pin} onChange={setPin} onSubmit={() => void submit()} disabled={busy} />
            <input
              className="w-full h-9 rounded-lg border border-slate-300 px-2 text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="หมายเหตุการอนุมัติ (ไม่บังคับ) · Enter = อนุมัติ"
              aria-label="หมายเหตุการอนุมัติ"
            />
            <DialogFooter className="gap-btn">
              <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>ยกเลิก (Esc)</Button>
              <Button type="submit" disabled={busy || pin.length < 4} className="bg-amber-600 hover:bg-amber-700 text-white">{busy ? 'กำลังตรวจสอบ...' : 'อนุมัติ (Enter)'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
