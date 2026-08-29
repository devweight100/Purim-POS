'use client';

import { useState, useEffect, useMemo } from 'react';
import { DebtRecord, DebtPaymentInstallment, PaymentMethodType } from '@/lib/types';
import { recordDebtPayment } from '@/lib/debt-service';
import { loadBankAccounts } from '@/lib/bank-account-storage';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  CreditCard, Banknote, QrCode, Building2, CheckCircle2, User, 
  FileText, ArrowRight, ShieldCheck, AlertCircle 
} from 'lucide-react';
import { toast } from 'sonner';

interface PayDebtModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debtRecord: DebtRecord | null;
  cashierName?: string;
  onPaymentSuccess: (debtRecord: DebtRecord, installment: DebtPaymentInstallment) => void;
}

export function PayDebtModal({
  open,
  onOpenChange,
  debtRecord,
  cashierName = 'พนักงานขาย',
  onPaymentSuccess,
}: PayDebtModalProps) {
  const [payMode, setPayMode] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [amountInput, setAmountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('CASH');
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const bankAccounts = useMemo(() => loadBankAccounts(), []);

  // Initialize form state whenever modal opens with a debt record
  useEffect(() => {
    if (debtRecord && open) {
      setPayMode('FULL');
      setAmountInput(debtRecord.remainingDebt.toString());
      setPaymentMethod('CASH');
      setReferenceNo('');
      setNote('');
      if (bankAccounts.length > 0) {
        setSelectedBank(`${bankAccounts[0].bankName} (${bankAccounts[0].accountNumber})`);
      }
    }
  }, [debtRecord, open, bankAccounts]);

  if (!debtRecord) return null;

  const currentRemaining = debtRecord.remainingDebt;
  const numAmount = parseFloat(amountInput) || 0;

  // New remaining calculation preview
  const previewRemaining = Math.max(0, currentRemaining - numAmount);
  const previewTotalPaid = debtRecord.paidAmount + numAmount;
  const previewPercent = debtRecord.totalAmount > 0 
    ? Math.min(100, Math.round((previewTotalPaid / debtRecord.totalAmount) * 100))
    : 100;

  const handleSelectFull = () => {
    setPayMode('FULL');
    setAmountInput(currentRemaining.toString());
  };

  const handleSelectPartial = () => {
    setPayMode('PARTIAL');
  };

  const handleQuickPercent = (percent: number) => {
    const calculated = Math.round((currentRemaining * percent) / 100);
    setAmountInput(calculated.toString());
  };

  const handleSubmit = () => {
    if (numAmount <= 0) {
      toast.error('กรุณาระบุจำนวนเงินที่ต้องการชำระ');
      return;
    }

    if (numAmount > currentRemaining) {
      toast.error(`จำนวนเงิน (${formatCurrency(numAmount)}) เกินยอดหนี้คงค้าง (${formatCurrency(currentRemaining)})`);
      return;
    }

    setIsSubmitting(true);

    try {
      const res = recordDebtPayment(
        debtRecord.orderId,
        numAmount,
        paymentMethod,
        {
          accountLabel: (paymentMethod === 'TRANSFER' || paymentMethod === 'QR_PROMPTPAY') ? selectedBank : undefined,
          referenceNo: referenceNo.trim() || undefined,
          note: note.trim() || undefined,
          cashierName,
        }
      );

      if (res.success && res.debtRecord && res.installment) {
        toast.success(`✅ รับชำระหนี้ ${formatCurrency(numAmount)} เรียบร้อยแล้ว!`);
        onPaymentSuccess(res.debtRecord, res.installment);
        onOpenChange(false);
      } else {
        toast.error(res.error || 'เกิดข้อผิดพลาดในการบันทึกรับชำระ');
      }
    } catch (err: any) {
      toast.error(err.message || 'บันทึกรับชำระไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[92vh] flex flex-col bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-100">
          <DialogTitle className="text-xl font-bold flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800">
              <CreditCard className="w-5 h-5 text-indigo-600" />
              <span>รับชำระหนี้ / ชำระบิลเงินเชื่อ</span>
            </div>
            <span className="text-xs font-mono text-slate-500 font-normal bg-slate-100 px-2.5 py-1 rounded-md">
              {debtRecord.orderNumber}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto pr-1">
          {/* Customer & Bill Overview Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-900">
                {debtRecord.customerType === 'COMPANY' ? <Building2 className="w-4 h-4 text-indigo-600" /> : <User className="w-4 h-4 text-sky-600" />}
                <span>{debtRecord.customerName}</span>
              </div>
              <span className="text-slate-500 font-mono">{debtRecord.customerPhone || 'ไม่มีเบอร์โทร'}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-200/80">
              <div className="p-1.5 bg-white rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block">ยอดเต็มบิล</span>
                <span className="font-bold text-xs text-slate-800">{formatCurrency(debtRecord.totalAmount)}</span>
              </div>
              <div className="p-1.5 bg-emerald-50/60 rounded-xl border border-emerald-200/60 shadow-2xs">
                <span className="text-[10px] text-emerald-700 block">ชำระแล้ว</span>
                <span className="font-bold text-xs text-emerald-700">{formatCurrency(debtRecord.paidAmount)}</span>
              </div>
              <div className="p-1.5 bg-rose-50/60 rounded-xl border border-rose-200/60 shadow-2xs">
                <span className="text-[10px] text-rose-700 font-bold block">ยอดคงค้าง</span>
                <span className="font-black text-xs text-rose-600">{formatCurrency(currentRemaining)}</span>
              </div>
            </div>
          </div>

          {/* Payment Mode Selection (Full vs Partial) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">รูปแบบการชำระเงิน:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleSelectFull}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  payMode === 'FULL'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>ชำระเต็มจำนวน ({formatCurrency(currentRemaining)})</span>
              </button>

              <button
                type="button"
                onClick={handleSelectPartial}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  payMode === 'PARTIAL'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Banknote className="w-4 h-4" />
                <span>แบ่งชำระ (ระบุยอดเอง)</span>
              </button>
            </div>
          </div>

          {/* Amount Input & Quick Percentage Buttons */}
          <div className="space-y-1.5 bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-800">ระบุจำนวนเงินที่รับชำระ (บาท):</label>
              {payMode === 'PARTIAL' && (
                <div className="flex gap-1">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleQuickPercent(pct)}
                      className="px-2.5 py-1 text-xs font-bold bg-white text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <Input
                type="number"
                min="1"
                max={currentRemaining}
                step="any"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="text-xl font-black text-center text-slate-900 bg-white border-slate-300 h-12 rounded-xl focus:border-indigo-500 font-mono shadow-inner"
                placeholder="0.00"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">บาท</span>
            </div>

            {/* Live Progress Preview */}
            <div className="pt-1.5 text-[11px] flex items-center justify-between text-slate-600 font-medium">
              <span>หลังชำระจะคงเหลือ: <strong className={previewRemaining <= 0 ? 'text-emerald-700' : 'text-rose-600 font-mono'}>{formatCurrency(previewRemaining)}</strong></span>
              <span className="font-bold text-indigo-700">คืบหน้า: {previewPercent}%</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">ช่องทางการรับเงิน:</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { id: 'CASH' as PaymentMethodType, label: 'เงินสด', icon: Banknote },
                { id: 'QR_PROMPTPAY' as PaymentMethodType, label: 'QR โอน', icon: QrCode },
                { id: 'TRANSFER' as PaymentMethodType, label: 'โอนธนาคาร', icon: Building2 },
                { id: 'CREDIT_CARD' as PaymentMethodType, label: 'บัตรเครดิต', icon: CreditCard },
              ].map((m) => {
                const Icon = m.icon;
                const active = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    className={`py-2 px-1 rounded-xl border text-[11px] font-bold flex flex-col items-center gap-1 transition-all ${
                      active
                        ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bank Account Selector if QR / Transfer */}
          {(paymentMethod === 'TRANSFER' || paymentMethod === 'QR_PROMPTPAY') && bankAccounts.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">เข้าบัญชีธนาคาร:</label>
              <select
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="w-full h-9 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-sky-500"
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={`${b.bankName} (${b.accountNumber})`}>
                    {b.bankName} - {b.accountNumber} ({b.accountName})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Reference & Note */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-600 block mb-0.5">เลขอ้างอิง / สลิป (ถ้ามี):</label>
              <Input
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="h-8.5 text-xs rounded-xl bg-slate-50 border-slate-200"
                placeholder="เช่น TXN12345"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-600 block mb-0.5">บันทึกช่วยจำ:</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-8.5 text-xs rounded-xl bg-slate-50 border-slate-200"
                placeholder="เช่น โอนงวด 2"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-3 border-t border-slate-100 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-11 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || numAmount <= 0}
            className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-md gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>ยืนยันรับชำระ ({formatCurrency(numAmount)})</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
