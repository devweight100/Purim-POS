'use client';

import { useState, useEffect } from 'react';
import { RotateCcw, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { SupplierReturnNote } from '@/lib/types';
import { changeSupplierReturnStatus } from '@/lib/supplier-return-service';

interface ChangeReturnStatusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnNote: SupplierReturnNote | null;
  onSuccess: () => void;
}

export function ChangeReturnStatusModal({
  open,
  onOpenChange,
  returnNote,
  onSuccess,
}: ChangeReturnStatusModalProps) {
  const [selectedStatus, setSelectedStatus] = useState<SupplierReturnNote['status']>('PENDING_DEDUCTION');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (returnNote) {
      setSelectedStatus(returnNote.status);
    }
  }, [returnNote]);

  if (!returnNote) return null;

  const handleConfirm = () => {
    setIsSubmitting(true);
    try {
      const res = changeSupplierReturnStatus(returnNote.id, selectedStatus);
      if (res.success) {
        toast.success(res.message);
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRevertingDeduction =
    (returnNote.status === 'DEDUCTED' || returnNote.status === 'PARTIALLY_DEDUCTED') &&
    selectedStatus === 'PENDING_DEDUCTION';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:max-w-md rounded-3xl p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="border-b border-slate-100 pb-3">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <RotateCcw className="w-5 h-5 text-indigo-600" />
            <span>เปลี่ยน / ย้อนสถานะเอกสารส่งคืน</span>
          </DialogTitle>
          <div className="flex items-center justify-between pt-2 text-xs">
            <span className="text-slate-500">เลขที่เอกสาร:</span>
            <span className="font-mono font-bold text-indigo-600">{returnNote.id}</span>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-3 text-xs">
          <div className="space-y-2">
            <label className="font-bold text-slate-700 block">เลือกสถานะที่ต้องการ:</label>
            <div className="space-y-2">
              {[
                {
                  value: 'PENDING_DEDUCTION',
                  label: 'รอหักลดหนี้ (Pending Deduction)',
                  desc: 'ดึงกลับมาเป็นรอหักลดหนี้ หรือใช้เป็นเครดิตในรอบหน้า',
                  color: 'border-amber-400 bg-amber-50/60 text-amber-950',
                },
                {
                  value: 'DEDUCTED',
                  label: 'หักลดหนี้แล้ว (Deducted)',
                  desc: 'ระบุว่าเอกสารนี้ถูกนำไปหักลดยอดหนี้ในบิลเรียกเก็บเรียบร้อยแล้ว',
                  color: 'border-emerald-400 bg-emerald-50/60 text-emerald-950',
                },
                {
                  value: 'CANCELLED',
                  label: 'ยกเลิกเอกสาร (Cancelled)',
                  desc: 'ยกเลิกเอกสารส่งคืน คืนยอดสต็อกสินค้าปกติ และคืนสถานะใบเคลม',
                  color: 'border-rose-400 bg-rose-50/60 text-rose-950',
                },
              ].map((item) => (
                <label
                  key={item.value}
                  className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                    selectedStatus === item.value
                      ? `${item.color} ring-2 ring-indigo-400/40 font-semibold shadow-2xs`
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="returnNoteStatus"
                    value={item.value}
                    checked={selectedStatus === item.value}
                    onChange={() => setSelectedStatus(item.value as any)}
                    className="accent-indigo-600 mt-0.5"
                  />
                  <div>
                    <p className="font-bold">{item.label}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Warning when reverting deduction */}
          {isRevertingDeduction && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5 space-y-1.5 text-xs text-amber-900">
              <div className="font-bold flex items-center gap-1.5 text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>ตรวจพบการย้อนสถานะจาก "หักหนี้แล้ว"</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                เอกสารนี้เคยถูกหักลดยอดหนี้ในใบสั่งซื้อ (PO) แล้ว หากย้อนสถานะกลับเป็น <b>รอหักลดหนี้</b> ระบบจะทำการ <b>คืนยอดหนี้ค้างชำระในใบ PO</b> ให้โดยอัตโนมัติ
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between items-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl font-bold text-slate-600"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || selectedStatus === returnNote.status}
            className="rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-md"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>ยืนยันเปลี่ยนสถานะ</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
