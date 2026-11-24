'use client';

import { useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { exportPost, settleExportPin, useExportPinRequest, type ExportPinRequest } from '@/lib/export-approval';

/** The manager / owner PIN dialog of every data export (lib/export-approval.ts). Mounted once in Providers. */
export function ExportPinHost() {
  const req = useExportPinRequest();
  if (!req) return null;
  return <ExportPinDialog key={req.id} req={req} />;
}

function ExportPinDialog({ req }: { req: ExportPinRequest }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin)) {
      setError('กรุณาใส่ PIN 4-6 หลักของผู้จัดการ / เจ้าของร้าน');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await exportPost<{ approvalId: string }>('/exports/approve', { kind: req.kind, filters: req.filters, pin });
      settleExportPin(req.id, r.approvalId);
    } catch (e) {
      setPin('');
      setError(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ');
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && settleExportPin(req.id, null)}>
      <DialogContent className="max-w-md" data-testid="export-pin-dialog" initialFocus={inputRef}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <ShieldCheck className="h-5 w-5 text-amber-600" /> ส่งออกข้อมูล: ต้องใส่ PIN ผู้จัดการ
          </DialogTitle>
          <DialogDescription className="text-slate-700">
            {req.what}
            <br />
            ผู้จัดการ / เจ้าของร้านใส่ PIN ของตัวเองทุกครั้งที่ส่งออก (ระบบบันทึกว่าใครส่งออกและใครอนุมัติ)
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="export-pin" className="text-sm font-semibold text-slate-700">PIN ผู้อนุมัติ</label>
          <Input
            id="export-pin"
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="PIN 4-6 หลัก"
            className="text-center text-lg tracking-[0.4em]"
          />
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <DialogFooter className="gap-btn pt-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => settleExportPin(req.id, null)}>ยกเลิก</Button>
            <Button type="submit" disabled={busy || pin.length < 4}>{busy ? 'กำลังตรวจสอบ...' : 'อนุมัติและส่งออก'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
