'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, CheckCircle2, DollarSign, Receipt, CreditCard, 
  Wallet, Banknote, ShieldAlert, ArrowDownCircle, CheckSquare, Square, X
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
  SupplierPayableBill, 
  settlePayableBill,
  PayablePaymentEntry
} from '@/lib/payable-service';
import { 
  getAvailableReturnNotesForSupplier
} from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';
import { loadBankAccounts, BankAccount } from '@/lib/bank-account-storage';
import { useShiftStore } from '@/lib/store/shift-store';

interface SettlePayableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: SupplierPayableBill | null;
  onSuccess: (paymentEntry: PayablePaymentEntry) => void;
}

export function SettlePayableModal({
  open,
  onOpenChange,
  bill,
  onSuccess,
}: SettlePayableModalProps) {
  const [availableDebitNotes, setAvailableDebitNotes] = useState<SupplierReturnNote[]>([]);
  const [selectedNotesMap, setSelectedNotesMap] = useState<Record<string, number>>({});
  
  // Payment fields
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER'>('CASH');
  const [cashOrTransferAmountStr, setCashOrTransferAmountStr] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState('');
  const [note, setNote] = useState('');
  const [deductFromDrawer, setDeductFromDrawer] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const drawerBalance = useShiftStore((state) => state.getExpectedCash());

  useEffect(() => {
    if (open && bill) {
      const notes = getAvailableReturnNotesForSupplier(bill.supplierId);
      setAvailableDebitNotes(notes);
      setSelectedNotesMap({});

      const accounts = loadBankAccounts();
      setBankAccounts(accounts);
      if (accounts.length > 0) {
        setSelectedBankId(accounts[0].id);
      }

      setPaymentMethod('CASH');
      setReferenceNo('');
      setNote('');
      setDeductFromDrawer(true);
    }
  }, [open, bill]);

  if (!bill) return null;

  // Toggle or update debit note deduction amount
  const handleToggleDebitNote = (returnNote: SupplierReturnNote) => {
    const isCurrentlySelected = selectedNotesMap[returnNote.id] !== undefined;
    if (isCurrentlySelected) {
      const newMap = { ...selectedNotesMap };
      delete newMap[returnNote.id];
      setSelectedNotesMap(newMap);
    } else {
      // Calculate max credit we can apply without exceeding remaining bill debt
      const currentDebitTotal = Object.values(selectedNotesMap).reduce((s, v) => s + v, 0);
      const remainingDebtBeforeThis = Math.max(0, bill.remainingPayable - currentDebitTotal);
      const canApply = Math.min(returnNote.remainingCreditAmount, remainingDebtBeforeThis);
      setSelectedNotesMap((prev) => ({
        ...prev,
        [returnNote.id]: Math.round(canApply * 100) / 100,
      }));
    }
  };

  const handleUpdateDebitNoteAmount = (noteId: string, maxCredit: number, val: number) => {
    const clamped = Math.max(0, Math.min(val, maxCredit));
    setSelectedNotesMap((prev) => ({
      ...prev,
      [noteId]: Math.round(clamped * 100) / 100,
    }));
  };

  // Calculations
  const totalDebitDeducted = Object.values(selectedNotesMap).reduce((s, v) => s + v, 0);
  const netDebtToPay = Math.max(0, Math.round((bill.remainingPayable - totalDebitDeducted) * 100) / 100);

  // Auto-sync cash amount if user hasn't typed
  const finalCashOrTransferAmount = cashOrTransferAmountStr !== '' 
    ? (parseFloat(cashOrTransferAmountStr) || 0)
    : netDebtToPay;

  const handleSubmit = () => {
    if (totalDebitDeducted <= 0 && finalCashOrTransferAmount <= 0) {
      toast.error('กรุณาเลือกประกบใบลดหนี้ หรือระบุจำนวนเงินที่ต้องการจ่าย');
      return;
    }

    if (paymentMethod === 'CASH' && deductFromDrawer && finalCashOrTransferAmount > drawerBalance) {
      if (!confirm(`เงินสดในลิ้นชักมี ฿${drawerBalance.toLocaleString()} ซึ่งน้อยกว่ายอดที่ต้องจ่าย ฿${finalCashOrTransferAmount.toLocaleString()}\nต้องการดำเนินการต่อหรือไม่?`)) {
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const matchedDebitNotes = Object.entries(selectedNotesMap).map(([returnNoteId, amountToDeduct]) => ({
        returnNoteId,
        amountToDeduct,
      }));

      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);

      const res = settlePayableBill({
        poId: bill.poId,
        matchedDebitNotes,
        cashOrTransferAmount: finalCashOrTransferAmount,
        paymentMethod,
        bankAccountId: selectedBank?.id,
        bankAccountLabel: selectedBank ? `${selectedBank.bankName} (${selectedBank.accountNumber})` : undefined,
        referenceNo: referenceNo.trim() || undefined,
        note: note.trim() || undefined,
        deductFromCashDrawer: deductFromDrawer,
      });

      if (res.success && res.paymentEntry) {
        toast.success(res.message);
        onSuccess(res.paymentEntry);
        onOpenChange(false);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการบันทึกการชำระเงิน');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[94vh] flex flex-col bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-900">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                <Receipt className="w-5 h-5" />
              </div>
              <span>ชำระหนี้บิลเจ้าหนี้ & ประกบใบลดหนี้</span>
            </DialogTitle>
          </div>
          <p className="text-xs text-slate-500 font-medium pt-1">
            นำเอกสารส่งคืน (Debit Note) มาประกบเพื่อหักลดยอดเวลาจ่ายเงิน และบันทึกจ่ายเงินเจ้าหนี้
          </p>
        </DialogHeader>

        {/* Scrollable Form Content */}
        <div className="space-y-4 py-3 flex-1 overflow-y-auto pr-1">
          {/* Bill Summary Banner */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <div>
                <span className="font-mono font-bold text-base text-slate-900">{bill.poNumber}</span>
                <p className="text-[11px] text-slate-500 mt-0.5">บริษัท: <b className="text-slate-800">{bill.supplierName}</b></p>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-slate-400 block">หนี้คงค้างเดิม</span>
                <span className="font-mono font-black text-amber-700 text-lg">
                  {formatCurrency(bill.remainingPayable)}
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 1: MATCH DEBIT NOTES */}
          <div className="space-y-2.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-indigo-600" />
                <span>1. ประกบเอกสารลดหนี้ (Debit Note) ของบริษัทนี้:</span>
              </label>
              <span className="text-[11px] text-slate-500 font-semibold">
                มี {availableDebitNotes.length} ฉบับพร้อมหัก
              </span>
            </div>

            {availableDebitNotes.length === 0 ? (
              <div className="p-4 text-center bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-400">
                ไม่มีเอกสารลดหนี้ที่มียอดคงเหลือสำหรับบริษัทนี้ (สามารถชำระด้วยเงินสด/โอนเงินได้ตามปกติ)
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {availableDebitNotes.map((note) => {
                  const isChecked = selectedNotesMap[note.id] !== undefined;
                  const currentAmount = selectedNotesMap[note.id] || 0;

                  return (
                    <div
                      key={note.id}
                      className={`p-3 rounded-2xl border transition-all ${
                        isChecked
                          ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className="flex items-center gap-2.5 cursor-pointer flex-1"
                          onClick={() => handleToggleDebitNote(note)}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div>
                            <span className="font-mono font-bold text-slate-900 text-xs">{note.id}</span>
                            <p className="text-[11px] text-slate-500">
                              วันที่ {new Date(note.returnDate).toLocaleDateString('th-TH')} | เครดิตคงเหลือ: <strong className="text-emerald-700 font-mono">{formatCurrency(note.remainingCreditAmount)}</strong>
                            </p>
                          </div>
                        </div>

                        {isChecked && (
                          <div className="flex items-center gap-2 pl-3">
                            <span className="text-[11px] font-bold text-indigo-900">หักเงิน:</span>
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                max={note.remainingCreditAmount}
                                step="any"
                                value={currentAmount}
                                onChange={(e) =>
                                  handleUpdateDebitNoteAmount(
                                    note.id,
                                    note.remainingCreditAmount,
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                className="h-8 w-24 text-right font-mono font-bold text-xs bg-white"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: PAYMENT OF REMAINING BALANCE */}
          <div className="space-y-3 pt-2 border-t border-slate-200">
            <label className="text-xs font-bold text-slate-800 block">
              2. บันทึกจ่ายเงินเจ้าหนี้ส่วนที่เหลือ:
            </label>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'CASH', label: 'เงินสด', icon: Banknote },
                { id: 'TRANSFER', label: 'โอนเงินธนาคาร', icon: CreditCard },
                { id: 'CHEQUE', label: 'เช็ค / อื่นๆ', icon: Wallet },
              ].map((m) => {
                const Icon = m.icon;
                const isSel = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id as any)}
                    className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                      isSel
                        ? 'border-indigo-500 bg-indigo-50/70 text-indigo-950 font-bold ring-2 ring-indigo-400/30'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isSel ? 'text-indigo-600' : 'text-slate-500'}`} />
                    <span className="text-xs font-bold">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Amount input */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>จำนวนเงินที่จ่าย (฿):</span>
                {netDebtToPay > 0 && (
                  <button
                    type="button"
                    onClick={() => setCashOrTransferAmountStr(String(netDebtToPay))}
                    className="text-[11px] text-indigo-600 hover:underline font-bold"
                  >
                    จ่ายเต็มยอดคงเหลือ ({formatCurrency(netDebtToPay)})
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  max={netDebtToPay}
                  value={cashOrTransferAmountStr !== '' ? cashOrTransferAmountStr : netDebtToPay}
                  onChange={(e) => setCashOrTransferAmountStr(e.target.value)}
                  className="h-10 text-base font-mono font-black text-slate-900 bg-slate-50 pr-12 text-right rounded-xl"
                  placeholder="0.00"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  บาท
                </span>
              </div>
            </div>

            {/* Drawer Cash Option for CASH */}
            {paymentMethod === 'CASH' && (
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 font-bold text-amber-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deductFromDrawer}
                    onChange={(e) => setDeductFromDrawer(e.target.checked)}
                    className="rounded accent-indigo-600 h-4 w-4"
                  />
                  <span>หักเงินสดออกจากลิ้นชัก POS ทันที (Cash Drawer)</span>
                </label>
                <span className="text-amber-800 font-mono font-bold">
                  (เงินในลิ้นชัก: {formatCurrency(drawerBalance)})
                </span>
              </div>
            )}

            {/* Bank Account Selection for TRANSFER */}
            {paymentMethod === 'TRANSFER' && bankAccounts.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">โอนจากบัญชีร้าน:</label>
                <select
                  value={selectedBankId}
                  onChange={(e) => setSelectedBankId(e.target.value)}
                  className="w-full h-10 px-3 text-xs bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800"
                >
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.bankName} - {acc.accountNumber} ({acc.accountName})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Reference & Note */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">เลขที่อ้างอิง / สลิปโอน:</label>
                <Input
                  type="text"
                  placeholder="เช่น SLIP-0912..."
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  className="h-9 text-xs bg-slate-50"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">บันทึกเพิ่มเติม:</label>
                <Input
                  type="text"
                  placeholder="ระบุข้อความ..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="h-9 text-xs bg-slate-50"
                />
              </div>
            </div>
          </div>

          {/* CALCULATION SUMMARY CARD */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>หนี้เดิมตามบิล:</span>
              <span className="font-mono">{formatCurrency(bill.remainingPayable)}</span>
            </div>
            {totalDebitDeducted > 0 && (
              <div className="flex justify-between text-indigo-700 font-bold">
                <span>ประกบหักใบลดหนี้ ({Object.keys(selectedNotesMap).length} ฉบับ):</span>
                <span className="font-mono">-{formatCurrency(totalDebitDeducted)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <span>ชำระด้วยเงินสด / เงินโอน:</span>
              <span className="font-mono font-bold text-slate-900">
                -{formatCurrency(finalCashOrTransferAmount)}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-black text-slate-900">
              <span>หนี้คงเหลือสุทธิหลังชำระ:</span>
              <span className="font-mono text-emerald-700 text-base">
                {formatCurrency(Math.max(0, bill.remainingPayable - totalDebitDeducted - finalCashOrTransferAmount))}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="pt-3 border-t border-slate-100 flex justify-between items-center shrink-0">
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
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-md px-5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>ยืนยันการชำระเงิน</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
