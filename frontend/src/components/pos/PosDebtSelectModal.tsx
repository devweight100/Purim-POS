'use client';

import { useState, useEffect, useMemo } from 'react';
import { DebtRecord, DebtPaymentInstallment, Customer } from '@/lib/types';
import { loadAllDebtRecords } from '@/lib/debt-service';
import { useShiftStore } from '@/lib/store/shift-store';
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
  Receipt, Search, CreditCard, User, Building2, Clock, CheckCircle2, 
  AlertCircle, History, ArrowRight, Banknote 
} from 'lucide-react';
import { PayDebtModal } from '@/components/debts/PayDebtModal';
import { DebtReceiptPdfModal } from '@/components/debts/DebtReceiptPdfModal';
import { toast } from 'sonner';

interface PosDebtSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetCustomer?: Customer | null;
  cashierName?: string;
}

export function PosDebtSelectModal({
  open,
  onOpenChange,
  targetCustomer,
  cashierName = 'พนักงานขาย',
}: PosDebtSelectModalProps) {
  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Pay Modal
  const [payModalOpen, setPayModalOpen] = useState<boolean>(false);
  const [selectedDebtForPay, setSelectedDebtForPay] = useState<DebtRecord | null>(null);

  // Receipt Modal
  const [receiptModalOpen, setReceiptModalOpen] = useState<boolean>(false);
  const [receiptDebtRecord, setReceiptDebtRecord] = useState<DebtRecord | null>(null);
  const [receiptInstallment, setReceiptInstallment] = useState<DebtPaymentInstallment | null>(null);

  const reloadDebts = () => {
    setLoading(true);
    try {
      const records = loadAllDebtRecords();
      setDebts(records);
    } catch {
      toast.error('ไม่สามารถโหลดข้อมูลบิลลูกหนี้ได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      reloadDebts();
      if (targetCustomer) {
        setSearch(targetCustomer.name || targetCustomer.phone || '');
      } else {
        setSearch('');
      }
    }
  }, [open, targetCustomer]);

  // Filter only unpaid debts matching search or target customer
  const unpaidDebts = useMemo(() => {
    return debts.filter((d) => {
      // Must have remaining debt
      if (d.remainingDebt <= 0 || d.status === 'PAID') return false;

      // Target customer filter if provided
      if (targetCustomer && d.customerId !== targetCustomer.id) {
        return false;
      }

      // Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchNumber = d.orderNumber?.toLowerCase().includes(q);
        const matchName = d.customerName?.toLowerCase().includes(q);
        const matchCode = d.customerCode?.toLowerCase().includes(q);
        const matchPhone = d.customerPhone?.toLowerCase().includes(q);
        const matchCompany = d.companyName?.toLowerCase().includes(q);
        if (!matchNumber && !matchName && !matchCode && !matchPhone && !matchCompany) {
          return false;
        }
      }

      return true;
    });
  }, [debts, targetCustomer, search]);

  const handleStartPay = (debt: DebtRecord) => {
    setSelectedDebtForPay(debt);
    setPayModalOpen(true);
  };

  const handlePaymentSuccess = (updatedDebt: DebtRecord, newInstallment: DebtPaymentInstallment) => {
    // 1. If payment method is CASH, automatically record cash into current shift drawer!
    if (newInstallment.paymentMethod === 'CASH') {
      const isShiftActive = useShiftStore.getState().isShiftOpen();
      if (isShiftActive) {
        useShiftStore.getState().addCashTransaction(
          'in',
          newInstallment.amountPaid,
          `รับชำระหนี้บิล #${updatedDebt.orderNumber} (${updatedDebt.customerName})`
        );
        toast.success(`💵 เพิ่มเงินสด ${formatCurrency(newInstallment.amountPaid)} เข้าลิ้นชักกะการขายเรียบร้อยแล้ว!`);
      }
    }

    reloadDebts();
    setReceiptDebtRecord(updatedDebt);
    setReceiptInstallment(newInstallment);
    setReceiptModalOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:max-w-2xl bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
          <DialogHeader className="pb-3 border-b border-slate-100">
            <DialogTitle className="text-xl font-bold flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-800">
                <CreditCard className="w-5 h-5 text-rose-600" />
                <span>รับชำระหนี้ / บิลเงินเชื่อหน้าร้าน (POS)</span>
              </div>
              {targetCustomer && (
                <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
                  {targetCustomer.name}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Search Input */}
            {!targetCustomer && (
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหาตามชื่อลูกค้า, บริษัท, เบอร์โทร, เลขที่บิล..."
                  className="pl-9 h-10 bg-slate-50 border-slate-300 rounded-xl text-xs sm:text-sm font-medium shadow-inner"
                />
              </div>
            )}

            {/* List of Unpaid Bills */}
            <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
              {loading ? (
                <div className="text-center py-10 text-xs text-slate-400">
                  กำลังโหลดข้อมูลบิลค้างชำระ...
                </div>
              ) : unpaidDebts.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-1">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                  <p className="font-bold text-sm text-slate-700">ไม่มียอดค้างชำระ</p>
                  <p className="text-xs text-slate-400">
                    {targetCustomer ? 'ลูกค้ารายนี้ไม่มีบิลค้างชำระในระบบ' : 'ไม่พบบิลค้างชำระตามคำค้นหา'}
                  </p>
                </div>
              ) : (
                unpaidDebts.map((debt) => (
                  <div
                    key={debt.orderId}
                    className="p-3.5 bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                          {debt.orderNumber}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          {new Date(debt.orderDate).toLocaleDateString('th-TH')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                        {debt.customerType === 'COMPANY' ? <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" /> : <User className="w-3.5 h-3.5 text-sky-600 shrink-0" />}
                        <span className="truncate">{debt.customerName}</span>
                        {debt.customerPhone && <span className="text-xs text-slate-400 font-normal">({debt.customerPhone})</span>}
                      </div>

                      {/* Progress Power Bar */}
                      <div className="space-y-0.5 pt-1 max-w-[280px]">
                        <div className="flex justify-between text-xs font-bold text-slate-500">
                          <span>ชำระแล้ว: {formatCurrency(debt.paidAmount)} / {formatCurrency(debt.totalAmount)}</span>
                          <span className="text-indigo-700">{debt.progressPercent}%</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden border border-slate-200">
                          <div
                            className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                            style={{ width: `${debt.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">ยอดคงค้าง</span>
                        <span className="text-base font-black text-rose-600 font-mono">
                          {formatCurrency(debt.remainingDebt)}
                        </span>
                      </div>

                      <Button
                        size="sm"
                        onClick={() => handleStartPay(debt)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs gap-1"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>รับชำระ</span>
                      </Button>
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
              ปิดหน้าต่าง
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pay Debt Modal */}
      <PayDebtModal
        open={payModalOpen}
        onOpenChange={setPayModalOpen}
        debtRecord={selectedDebtForPay}
        cashierName={cashierName}
        onPaymentSuccess={handlePaymentSuccess}
      />

      {/* Debt Payment Settlement Receipt Modal */}
      <DebtReceiptPdfModal
        open={receiptModalOpen}
        onOpenChange={setReceiptModalOpen}
        debtRecord={receiptDebtRecord}
        installment={receiptInstallment}
      />
    </>
  );
}
