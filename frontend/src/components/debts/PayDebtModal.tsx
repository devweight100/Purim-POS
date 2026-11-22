'use client';

import { useState, useEffect, useRef } from 'react';
import { DebtRecord, DebtPaymentInstallment, PaymentMethodType } from '@/lib/types';
import { recordDebtPayment } from '@/lib/debt-service';
import { fetchBankAccountsFromBackend, loadBankAccounts, type BankAccount } from '@/lib/bank-account-storage';
import { formatCurrency, formatListDateTime } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { ApiError, errorText } from '@/lib/api-error';
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
  FileText, ArrowRight, ShieldCheck, AlertCircle, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { PromptPayQr } from '@/components/common/PromptPayQr';
import { promptPayOf } from '@/lib/promptpay-qr';

interface PayDebtModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debtRecord: DebtRecord | null;
  cashierName?: string;
  onPaymentSuccess: (debtRecord: DebtRecord, installment: DebtPaymentInstallment) => void;
  /**
   * Back office (debts page): choose which OPEN cashier shift the money goes into, or none
   * ("ไม่เข้ากะแคชเชียร์": cash to the safe, transfer / QR to the bank). Without it (POS) the current shift is used.
   */
  chooseShift?: boolean;
}

/** GET /debts/open-shifts row */
export interface OpenShiftOption {
  id: string;
  shiftNumber: string;
  userId: string;
  cashierName: string;
  terminalId: string | null;
  terminalName: string;
  openedAt: string;
}

/** value of the shift picker for "not in a cashier shift" */
export const NO_SHIFT = 'NONE';

/** "SH2611-0001 · สมหญิง · จุดขาย 1 · เปิด 20 พ.ย. 69 08:00 น." */
export function openShiftLabel(s: OpenShiftOption) {
  return `${s.shiftNumber} · ${s.cashierName} · ${s.terminalName} · เปิด ${formatListDateTime(s.openedAt)} น.`;
}

export function PayDebtModal({
  open,
  onOpenChange,
  debtRecord,
  cashierName = 'พนักงานขาย',
  onPaymentSuccess,
  chooseShift = false,
}: PayDebtModalProps) {
  const [payMode, setPayMode] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [amountInput, setAmountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('CASH');
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const submitting = useRef(false);
  // Bank accounts: the last server list, refreshed each time the dialog opens (the dialog is mounted
  // with the page, often before the first list arrived; offline it keeps the last list)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(() => loadBankAccounts());
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchBankAccountsFromBackend()
      .then((accs) => { if (alive) setBankAccounts(accs); })
      .catch(() => { /* offline: keep the last list */ });
    return () => { alive = false; };
  }, [open]);

  // Back office: open shifts to receive into (reloaded on every open and after a "shift closed" refusal)
  const [openShifts, setOpenShifts] = useState<OpenShiftOption[] | null>(null);
  const [shiftsError, setShiftsError] = useState<string | null>(null);
  const [shiftChoice, setShiftChoice] = useState<string>('');
  const [shiftsVersion, setShiftsVersion] = useState(0);
  useEffect(() => {
    if (!open || !chooseShift) return;
    let alive = true;
    apiFetch<OpenShiftOption[]>('/debts/open-shifts')
      .then((rows) => {
        if (!alive) return;
        const list = Array.isArray(rows) ? rows : [];
        setOpenShifts(list);
        setShiftsError(null);
        // keep a still-open choice; no default (owner 2026-11-20): the user picks a shift or "ไม่เข้ากะ"
        setShiftChoice((prev) => (prev === NO_SHIFT || list.some((x) => x.id === prev) ? prev : ''));
      })
      .catch((err) => { if (alive) setShiftsError(errorText(err) || 'โหลดรายการกะที่เปิดอยู่ไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [open, chooseShift, shiftsVersion]);

  // Initialize form state whenever modal opens with a debt record (adjusted while rendering)
  // (null until the first render, so a modal mounted already open is filled in too)
  const [seen, setSeen] = useState<{ debtRecord: typeof debtRecord; open: boolean } | null>(null);
  if (!seen || seen.debtRecord !== debtRecord || seen.open !== open) {
    setSeen({ debtRecord, open });
    if (debtRecord && open) {
      setPayMode('FULL');
      setAmountInput(debtRecord.remainingDebt.toString());
      setPaymentMethod('CASH');
      setReferenceNo('');
      setNote('');
      // '' = the store's default bank account (the server rejects unknown accounts)
      setSelectedBank('');
      setShiftChoice('');
    } else {
      setPayMode('FULL');
      setAmountInput('');
      setPaymentMethod('CASH');
      setReferenceNo('');
      setNote('');
    }
  }

  if (!debtRecord) return null;

  const currentRemaining = debtRecord.remainingDebt;
  // back office: saving stays disabled until a shift or "ไม่เข้ากะแคชเชียร์" is picked (no default)
  const needsShift = chooseShift && !shiftChoice;
  const numAmount = parseFloat(amountInput) || 0;

  // Chosen bank account (default account until the user picks one). QR for the amount being paid:
  // generated PromptPay QR when the account has an ID, else its uploaded image.
  const bankLabel = (b: BankAccount) => `${b.bankName} (${b.accountNumber})`;
  const selectedBankAccount =
    bankAccounts.find((b) => bankLabel(b) === selectedBank) || bankAccounts.find((b) => b.isDefault) || bankAccounts[0] || null;
  const selectedPromptPay = promptPayOf(selectedBankAccount);

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

  const handleSubmit = async () => {
    if (submitting.current) return;
    if (numAmount <= 0) {
      toast.error('กรุณาระบุจำนวนเงินที่ต้องการชำระ');
      return;
    }

    if (numAmount > currentRemaining) {
      toast.error(`จำนวนเงิน (${formatCurrency(numAmount)}) เกินยอดหนี้คงค้าง (${formatCurrency(currentRemaining)})`);
      return;
    }

    if (needsShift) {
      toast.error('กรุณาเลือกกะแคชเชียร์ที่รับเงิน หรือเลือก "ไม่เข้ากะแคชเชียร์"');
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);

    try {
      const res = await recordDebtPayment(
        debtRecord.orderId,
        numAmount,
        paymentMethod,
        {
          accountLabel: (paymentMethod === 'TRANSFER' || paymentMethod === 'QR_PROMPTPAY') && selectedBankAccount ? bankLabel(selectedBankAccount) : undefined,
          bankAccountId: (paymentMethod === 'TRANSFER' || paymentMethod === 'QR_PROMPTPAY')
            ? selectedBankAccount?.id
            : undefined,
          referenceNo: referenceNo.trim() || undefined,
          note: note.trim() || undefined,
          cashierName,
          ...(chooseShift ? { shift: shiftChoice === NO_SHIFT ? { noShift: true as const } : { shiftId: shiftChoice } } : {}),
        }
      );

      if (res.success && res.debtRecord && res.installment) {
        toast.success(`✅ รับชำระหนี้ ${formatCurrency(numAmount)} เรียบร้อยแล้ว!`);
        onPaymentSuccess(res.debtRecord, res.installment);
        onOpenChange(false);
      } else {
        toast.error(res.error || 'เกิดข้อผิดพลาดในการบันทึกรับชำระ');
      }
    } catch (err) {
      if (err instanceof ApiError && err.data?.code === 'SHIFT_NOT_OPEN') {
        // the chosen shift was closed meanwhile: reload the open shifts and let the user pick again
        setShiftChoice('');
        setShiftsVersion((v) => v + 1);
      }
      toast.error((err as Error).message || 'บันทึกรับชำระไม่สำเร็จ');
    } finally {
      submitting.current = false;
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
            <span className="text-xs tabular-nums text-slate-500 font-normal bg-slate-100 px-2.5 py-1 rounded-md">
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
              <span className="text-slate-500 tabular-nums">{debtRecord.customerPhone || 'ไม่มีเบอร์โทร'}</span>
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
                <span className="font-semibold text-xs text-rose-600">{formatCurrency(currentRemaining)}</span>
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
                <div className="flex gap-btn">
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
                className="text-xl text-center text-slate-900 bg-white border-slate-300 focus:border-indigo-500 tabular-nums"
                placeholder="0.00"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">บาท</span>
            </div>

            {/* Live Progress Preview */}
            <div className="pt-1.5 text-[11px] flex items-center justify-between text-slate-600 font-medium">
              <span>หลังชำระจะคงเหลือ: <strong className={previewRemaining <= 0 ? 'text-emerald-700' : 'text-rose-600 tabular-nums'}>{formatCurrency(previewRemaining)}</strong></span>
              <span className="font-bold text-indigo-700">คืบหน้า: {previewPercent}%</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">ช่องทางการรับเงิน:</label>
            {/* no card: the server takes debt payments in cash / QR / transfer only */}
            <div className="grid grid-cols-3 gap-btn">
              {[
                { id: 'CASH' as PaymentMethodType, label: 'เงินสด', icon: Banknote },
                { id: 'QR_PROMPTPAY' as PaymentMethodType, label: 'QR โอน', icon: QrCode },
                { id: 'TRANSFER' as PaymentMethodType, label: 'โอนธนาคาร', icon: Building2 },
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
                aria-label="เข้าบัญชีธนาคาร"
                value={selectedBankAccount ? bankLabel(selectedBankAccount) : ''}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-sky-500"
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={`${b.bankName} (${b.accountNumber})`}>
                    {b.bankName} - {b.accountNumber} ({b.accountName})
                  </option>
                ))}
              </select>
            </div>
          )}

          {paymentMethod === 'QR_PROMPTPAY' && selectedBankAccount && (selectedPromptPay || selectedBankAccount.qrImageUrl) && (
            <div className="flex justify-center rounded-2xl border-2 border-slate-200 bg-white p-3" data-testid="debt-qr">
              {selectedPromptPay ? (
                <PromptPayQr
                  type={selectedPromptPay.type}
                  id={selectedPromptPay.id}
                  amount={numAmount}
                  accountName={selectedBankAccount.accountName}
                  size={220}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- data: URL uploaded by the owner
                <img src={selectedBankAccount.qrImageUrl!} alt="QR PromptPay" className="w-56 h-56 object-contain" />
              )}
            </div>
          )}

          {/* Back office: which cashier shift the money goes into */}
          {chooseShift && (
            <div className={`space-y-1.5 rounded-2xl border p-3 ${shiftChoice ? 'border-amber-200 bg-amber-50/60' : 'border-amber-400 bg-amber-50 ring-2 ring-amber-200'}`}>
              <label htmlFor="pay-debt-shift" className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Clock className="h-4 w-4 text-amber-600" />
                รับเงินเข้ากะแคชเชียร์: <span className="text-rose-600">* ต้องเลือก</span>
              </label>
              <select
                id="pay-debt-shift"
                data-testid="pay-debt-shift"
                value={shiftChoice}
                onChange={(e) => setShiftChoice(e.target.value)}
                className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              >
                <option value="" disabled>
                  {openShifts === null ? 'กำลังโหลดกะที่เปิดอยู่...' : '— เลือกกะที่รับเงิน —'}
                </option>
                {(openShifts || []).map((sh) => (
                  <option key={sh.id} value={sh.id}>{openShiftLabel(sh)}</option>
                ))}
                <option value={NO_SHIFT}>ไม่เข้ากะแคชเชียร์ (บันทึกเข้าบัญชีร้านโดยตรง)</option>
              </select>
              <p className="text-[11px] font-medium text-slate-600" data-testid="pay-debt-shift-hint">
                {shiftsError
                  ? shiftsError
                  : !shiftChoice
                    ? 'เลือกกะที่เปิดอยู่ หรือ "ไม่เข้ากะแคชเชียร์"'
                    : shiftChoice === NO_SHIFT
                      ? paymentMethod === 'CASH'
                        ? 'เงินสดเข้าเซฟของร้าน ไม่นับในลิ้นชักของกะใด'
                        : 'เงินเข้าบัญชีธนาคารที่เลือก ไม่นับในกะใด'
                      : paymentMethod === 'CASH'
                        ? 'เงินสดเข้าลิ้นชักของกะนี้ นับในยอดเงินที่ต้องมีตอนปิดกะ'
                        : 'เงินเข้าบัญชีธนาคารที่เลือก และนับในยอดรับชำระหนี้ของกะนี้'}
                {openShifts !== null && openShifts.length === 0 && !shiftsError ? ' (ตอนนี้ไม่มีกะที่เปิดอยู่)' : ''}
              </p>
            </div>
          )}

          {/* Reference & Note */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-600 block mb-0.5">เลขอ้างอิง / สลิป (ถ้ามี):</label>
              <Input
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="bg-slate-50 border-slate-200"
                placeholder="เช่น TXN12345"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-600 block mb-0.5">บันทึกช่วยจำ:</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="bg-slate-50 border-slate-200"
                placeholder="เช่น โอนงวด 2"
              />
            </div>
          </div>
        </div>

        {needsShift && (
          <label
            htmlFor="pay-debt-shift"
            data-testid="pay-debt-save-hint"
            className="shrink-0 cursor-pointer rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900"
          >
            ยังบันทึกไม่ได้: เลือกกะที่รับเงิน หรือ &quot;ไม่เข้ากะแคชเชียร์&quot; ก่อน
          </label>
        )}
        <div className="flex gap-2 pt-3 border-t border-slate-100 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 border-slate-300 text-slate-700"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || numAmount <= 0 || needsShift}
            title={needsShift ? 'เลือกกะที่รับเงินก่อนบันทึก' : undefined}
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
