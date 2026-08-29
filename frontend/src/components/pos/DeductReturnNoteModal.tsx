'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, CheckCircle2, FileText, ArrowRight, 
  ShieldAlert, DollarSign, AlertCircle, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  getAvailableReturnNotesForSupplier, 
  deductReturnNoteFromBill 
} from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';

interface DeductReturnNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  po: any | null;
  onSuccess: (updatedPo: any) => void;
}

export function DeductReturnNoteModal({
  open,
  onOpenChange,
  po,
  onSuccess,
}: DeductReturnNoteModalProps) {
  const [availableNotes, setAvailableNotes] = useState<SupplierReturnNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [deductAmount, setDeductAmount] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const supplierId = po?.supplierId || po?.supplier?.id || 'supp_1';
  const supplierName = po?.supplierName || po?.supplier?.name || 'บริษัทคู่ค้า';

  // Calculate remaining payable on PO (considering any already applied deductions)
  const poTotal = Number(po?.totalAmount || 0);
  const alreadyDeducted = (po?.deductedReturns || []).reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
  const currentRemainingPayable = Math.max(0, poTotal - alreadyDeducted);

  useEffect(() => {
    if (open && po) {
      const notes = getAvailableReturnNotesForSupplier(supplierId);
      setAvailableNotes(notes);
      if (notes.length > 0) {
        setSelectedNoteId(notes[0].id);
        const defaultDeduct = Math.min(notes[0].remainingCreditAmount, currentRemainingPayable);
        setDeductAmount(String(defaultDeduct));
      } else {
        setSelectedNoteId('');
        setDeductAmount('');
      }
    }
  }, [open, po, supplierId, currentRemainingPayable]);

  const selectedNote = availableNotes.find((n) => n.id === selectedNoteId);

  const handleSelectNote = (noteId: string) => {
    setSelectedNoteId(noteId);
    const n = availableNotes.find((item) => item.id === noteId);
    if (n) {
      const defaultDeduct = Math.min(n.remainingCreditAmount, currentRemainingPayable);
      setDeductAmount(String(defaultDeduct));
    }
  };

  const parsedDeductAmount = parseFloat(deductAmount) || 0;
  const netPayableAfterDeduct = Math.max(0, currentRemainingPayable - parsedDeductAmount);

  const handleSubmit = () => {
    if (!selectedNote) {
      toast.error('กรุณาเลือกใบลดหนี้สินค้าเคลม');
      return;
    }
    if (parsedDeductAmount <= 0) {
      toast.error('กรุณาระบุจำนวนเงินที่ต้องการหักลบ');
      return;
    }
    if (parsedDeductAmount > selectedNote.remainingCreditAmount) {
      toast.error(`ยอดหักลบต้องไม่เกินเครดิตคงเหลือของใบลดหนี้ (฿${selectedNote.remainingCreditAmount.toLocaleString()})`);
      return;
    }
    if (parsedDeductAmount > currentRemainingPayable) {
      toast.error(`ยอดหักลบต้องไม่เกินยอดค้างชำระของบิลนี้ (฿${currentRemainingPayable.toLocaleString()})`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = deductReturnNoteFromBill(
        selectedNote.id,
        po.poNumber,
        parsedDeductAmount,
        poTotal,
        note.trim() || undefined
      );

      if (res.success) {
        toast.success(`🎉 ${res.message}`);

        // Update PO in local storage and state
        const savedCustom = localStorage.getItem('custom_purchase_orders');
        let allPOs: any[] = [];
        if (savedCustom) {
          try { allPOs = JSON.parse(savedCustom); } catch {}
        }

        const deductionEntry = {
          returnNoteId: selectedNote.id,
          returnNumber: selectedNote.id,
          amount: parsedDeductAmount,
          deductedAt: new Date().toISOString(),
          note: note.trim() || undefined,
        };

        const updatedPo = {
          ...po,
          deductedReturns: [...(po.deductedReturns || []), deductionEntry],
          netAmountPayable: Math.max(0, currentRemainingPayable - parsedDeductAmount),
        };

        const updatedPOs = allPOs.map((p) => (p.id === po.id ? updatedPo : p));
        localStorage.setItem('custom_purchase_orders', JSON.stringify(updatedPOs));

        onSuccess(updatedPo);
        onOpenChange(false);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      console.error(err);
      toast.error('เกิดข้อผิดพลาดในการหักลดยอดบิล');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[650px] max-w-[650px] bg-white border-slate-200 text-slate-900 rounded-3xl p-6 sm:p-7 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <span>หักลบใบลดหนี้สินค้าเคลมกับบิลเรียกเก็บเงิน</span>
          </DialogTitle>
          <p className="text-xs text-slate-500 font-medium">
            นำมูลค่าสินค้าเคลมที่ส่งคืนบริษัทมาหักลดยอดชำระในใบสั่งซื้อ/บิลรับของนี้
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Bill Info Card */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-500 block font-medium">บิลสั่งซื้อ PO / เลขที่เอกสาร:</span>
              <b className="text-slate-900 font-mono text-sm">{po?.poNumber}</b>
              <span className="block text-slate-600 font-bold">{supplierName}</span>
            </div>
            <div className="text-right">
              <span className="text-slate-500 block font-medium">ยอดเรียกเก็บสุทธิของบิล</span>
              <b className="text-slate-900 text-lg font-black font-mono">
                {formatCurrency(currentRemainingPayable)}
              </b>
            </div>
          </div>

          {/* Available Return Notes */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 block">
              เลือกใบลดหนี้สินค้าเคลม (RTN) ที่มีอยู่ของบริษัทนี้:
            </label>

            {availableNotes.length === 0 ? (
              <div className="p-6 text-center bg-amber-50/70 rounded-2xl border border-amber-200 text-xs space-y-1">
                <AlertCircle className="w-6 h-6 text-amber-600 mx-auto" />
                <p className="font-bold text-amber-900">ไม่มีใบลดหนี้สินค้าเคลมที่รอหักของบริษัทนี้</p>
                <p className="text-slate-500">
                  หากมีสินค้าเคลมของบริษัทนี้ ท่านสามารถไปที่เมนู <b>"เคลมสินค้า (Claims)"</b> เพื่อออกใบส่งคืนสินค้า (RTN) ก่อนได้ครับ
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {availableNotes.map((noteItem) => {
                  const isSelected = noteItem.id === selectedNoteId;
                  return (
                    <div
                      key={noteItem.id}
                      onClick={() => handleSelectNote(noteItem.id)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-400/30 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-sm text-slate-900">
                            {noteItem.id}
                          </span>
                          <span className="text-xs text-slate-500">
                            ({new Date(noteItem.returnDate).toLocaleDateString('th-TH')})
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          ส่งคืน {noteItem.totalQuantity} ชิ้น · มูลค่ารวม {formatCurrency(noteItem.totalCreditAmount)}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[11px] text-slate-500 block">เครดิตคงเหลือที่หักได้</span>
                        <span className="text-base font-black text-emerald-700 font-mono">
                          {formatCurrency(noteItem.remainingCreditAmount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Amount to Deduct Input */}
          {selectedNote && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-bold text-slate-700">จำนวนเงินที่ต้องการนำมาหักลดหนี้ (บาท):</label>
                  <button
                    type="button"
                    onClick={() => {
                      const maxDeduct = Math.min(selectedNote.remainingCreditAmount, currentRemainingPayable);
                      setDeductAmount(String(maxDeduct));
                    }}
                    className="text-indigo-600 font-bold hover:underline"
                  >
                    หักเต็มจำนวนสูงสุด (฿{Math.min(selectedNote.remainingCreditAmount, currentRemainingPayable).toLocaleString()})
                  </button>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={deductAmount}
                    onChange={(e) => setDeductAmount(e.target.value)}
                    className="h-11 text-lg font-black text-emerald-700 pr-12 font-mono"
                    placeholder="0.00"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    บาท
                  </span>
                </div>
              </div>

              {/* Calculation Preview */}
              <div className="p-4 bg-emerald-50/80 border-2 border-emerald-300 rounded-2xl space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>ยอดบิลเรียกเก็บเดิม:</span>
                  <span className="font-mono font-bold">{formatCurrency(currentRemainingPayable)}</span>
                </div>
                <div className="flex justify-between font-bold text-rose-600">
                  <span>หักลดหนี้สินค้าเคลม ({selectedNote.id}):</span>
                  <span className="font-mono">-{formatCurrency(parsedDeductAmount)}</span>
                </div>
                <div className="border-t border-emerald-300 pt-1.5 flex justify-between items-center text-sm font-black text-slate-900">
                  <span>ยอดชำระสุทธิหลังหักลบ (Net Payable):</span>
                  <span className="text-xl text-emerald-700 font-mono font-black">
                    {formatCurrency(netPayableAfterDeduct)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="pt-3 border-t border-slate-200 flex justify-between items-center shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedNote || parsedDeductAmount <= 0}
            className="h-10 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl shadow-md gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>ยืนยันหักลดหนี้ในบิลนี้</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}