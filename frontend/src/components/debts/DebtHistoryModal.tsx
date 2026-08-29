'use client';

import { DebtRecord, DebtPaymentInstallment } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  History, Receipt, FileText, CheckCircle2, User, Building2, 
  Printer, ArrowDownRight, Calendar, Banknote, QrCode, CreditCard 
} from 'lucide-react';

interface DebtHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debtRecord: DebtRecord | null;
  onSelectInstallment?: (inst: DebtPaymentInstallment) => void; // 80mm slip
  onSelectInstallmentA4?: (inst: DebtPaymentInstallment) => void; // A4 receipt
  onPrintFullA4?: () => void; // Full settled A4 receipt
}

export function DebtHistoryModal({
  open,
  onOpenChange,
  debtRecord,
  onSelectInstallment,
  onSelectInstallmentA4,
  onPrintFullA4,
}: DebtHistoryModalProps) {
  if (!debtRecord) return null;

  const installments = debtRecord.installments || [];
  const isFullyPaid = debtRecord.remainingDebt <= 0 && debtRecord.paidAmount > 0;

  const getMethodBadge = (m: string) => {
    switch (m) {
      case 'CASH':
        return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"><Banknote className="w-3 h-3" /> เงินสด</span>;
      case 'QR_PROMPTPAY':
        return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200"><QrCode className="w-3 h-3" /> QR โอน</span>;
      case 'TRANSFER':
        return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200"><Building2 className="w-3 h-3" /> โอนธนาคาร</span>;
      case 'CREDIT_CARD':
        return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200"><CreditCard className="w-3 h-3" /> บัตรเครดิต</span>;
      default:
        return <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{m}</span>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-xl bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-100">
          <DialogTitle className="text-xl font-bold flex items-center justify-between pr-7">
            <div className="flex items-center gap-2 text-slate-800">
              <History className="w-5 h-5 text-sky-600" />
              <span>ประวัติการชำระหนี้ (Payment History)</span>
            </div>
            <span className="text-xs font-mono text-slate-500 font-normal bg-slate-100 px-2.5 py-1 rounded-md">
              {debtRecord.orderNumber}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5 py-2 max-h-[68vh] overflow-y-auto pr-1">
          {/* Customer & Bill Summary Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                {debtRecord.customerType === 'COMPANY' ? <Building2 className="w-4 h-4 text-indigo-600" /> : <User className="w-4 h-4 text-sky-600" />}
                {debtRecord.customerName}
              </span>
              <span className="text-slate-500 font-mono">วันที่ซื้อ: {new Date(debtRecord.orderDate).toLocaleDateString('th-TH')}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-200 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 block">ยอดเต็ม</span>
                <span className="font-bold text-slate-800">{formatCurrency(debtRecord.totalAmount)}</span>
              </div>
              <div>
                <span className="text-[10px] text-emerald-700 block">ชำระแล้วรวม</span>
                <span className="font-bold text-emerald-700">{formatCurrency(debtRecord.paidAmount)}</span>
              </div>
              <div>
                <span className="text-[10px] text-rose-700 block">คงเหลือ</span>
                <span className={`font-black ${debtRecord.remainingDebt <= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {debtRecord.remainingDebt <= 0 ? '฿0 (ครบแล้ว)' : formatCurrency(debtRecord.remainingDebt)}
                </span>
              </div>
            </div>

            {/* Power Bar */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between items-center text-[10px] font-bold text-slate-600">
                <span>ความคืบหน้าการชำระ:</span>
                <span className={debtRecord.progressPercent === 100 ? 'text-emerald-700' : 'text-indigo-700'}>
                  {debtRecord.progressPercent}%
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden border border-slate-300">
                <div 
                  className={`h-full transition-all duration-300 ${debtRecord.progressPercent === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                  style={{ width: `${debtRecord.progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Full Paid Banner with Print Full A4 Button */}
          {isFullyPaid && onPrintFullA4 && (
            <div className="bg-emerald-50 border-2 border-emerald-300 p-3 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-2 text-emerald-900">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>ชำระเงินเชื่อครบถ้วน 100% แล้ว</span>
              </div>
              <Button
                size="sm"
                onClick={onPrintFullA4}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 px-3 rounded-xl shadow-xs shrink-0 gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>พิมพ์ใบเสร็จยอดครบทั้งหมด (A4)</span>
              </Button>
            </div>
          )}

          {/* Installment History List */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-slate-500" />
              <span>รายการชำระแต่ละงวด ({installments.length} รายการ):</span>
            </h4>

            {installments.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                ยังไม่มีประวัติการชำระเงินสำหรับบิลนี้
              </div>
            ) : (
              installments.map((inst, idx) => (
                <div 
                  key={inst.id || idx}
                  className="bg-white p-3 rounded-2xl border border-slate-200 hover:border-sky-300 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                        งวดที่ {inst.installmentNo}
                      </span>
                      {getMethodBadge(inst.paymentMethod)}
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(inst.paymentDate).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      <span>ยอดจ่าย: <strong className="text-emerald-700 font-bold">{formatCurrency(inst.amountPaid)}</strong></span>
                      <span>คงเหลือหลังจ่าย: <strong className="text-slate-800">{formatCurrency(inst.remainingAfter)}</strong></span>
                      {inst.cashierName && <span>ผู้รับเงิน: {inst.cashierName}</span>}
                    </div>

                    {inst.note && (
                      <p className="text-[10px] text-slate-400 italic truncate">* {inst.note}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    {/* Print A4 Button */}
                    {onSelectInstallmentA4 && (
                      <Button
                        size="sm"
                        onClick={() => onSelectInstallmentA4(inst)}
                        className="h-8 px-2.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl font-bold gap-1 shadow-2xs"
                        title="พิมพ์ใบเสร็จรับเงิน A4 ของงวดนี้"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>พิมพ์ A4</span>
                      </Button>
                    )}

                    {/* Print Slip Button */}
                    {onSelectInstallment && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onSelectInstallment(inst)}
                        className="h-8 px-2 text-xs text-slate-700 border-slate-300 hover:bg-slate-100 rounded-xl font-semibold gap-1"
                        title="พิมพ์สลิป 80mm ของงวดนี้"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>สลิป</span>
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ปิด
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
