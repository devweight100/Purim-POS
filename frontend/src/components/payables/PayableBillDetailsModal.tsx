'use client';

import { useState } from 'react';
import { 
  Building2, FileText, Receipt, CheckCircle2, RotateCcw, 
  Printer, DollarSign, Calendar, Phone, Package, Tag, ShieldAlert, AlertTriangle, ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { SupplierPayableBill, PayablePaymentEntry, rollbackPayableBillPayment } from '@/lib/payable-service';
import { toast } from 'sonner';

interface PayableBillDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: SupplierPayableBill | null;
  onSettleClick: (bill: SupplierPayableBill) => void;
  onViewVoucher: (bill: SupplierPayableBill, payment: PayablePaymentEntry) => void;
  onReload: () => void;
}

export function PayableBillDetailsModal({
  open,
  onOpenChange,
  bill,
  onSettleClick,
  onViewVoucher,
  onReload,
}: PayableBillDetailsModalProps) {
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [activeTab, setActiveTab] = useState<'items' | 'payments'>('items');

  if (!bill) return null;

  const handleRollbackPayment = (paymentId?: string) => {
    const confirmMsg = paymentId
      ? `ต้องการยกเลิก/ย้อนสถานะการชำระเงินรอบนี้หรือไม่?\n(ยอดเงินสด/โอน และเครดิตใบลดหนี้จะถูกคืนกลับสถานะเดิม)`
      : `ต้องการย้อนสถานะการชำระเงินทั้งหมดของบิล ${bill.poNumber} หรือไม่?\n(ยอดเงินที่จ่ายไปและเครดิตใบลดหนี้จะถูกคืนสถานะทั้งหมด และยอดหนี้จะกลับมาค้างชำระเต็มจำนวน)`;

    if (!confirm(confirmMsg)) return;

    setIsRollingBack(true);
    try {
      const res = rollbackPayableBillPayment(bill.poId, paymentId);
      if (res.success) {
        toast.success(res.message);
        onReload();
        onOpenChange(false);
      } else {
        toast.error(res.message);
      }
    } catch (e: any) {
      toast.error(e.message || 'เกิดข้อผิดพลาดในการย้อนสถานะ');
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[92vh] flex flex-col bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <span>รายละเอียดบิลเจ้าหนี้</span>
                  <span className="font-mono text-indigo-600">{bill.poNumber}</span>
                </DialogTitle>
                <p className="text-xs text-slate-500 font-medium">
                  {bill.supplierName} {bill.supplierPhone ? `• โทร ${bill.supplierPhone}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                className={`text-xs font-bold ${
                  bill.paymentStatus === 'PAID'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : bill.paymentStatus === 'PARTIALLY_PAID'
                    ? 'bg-sky-100 text-sky-800 border-sky-300'
                    : 'bg-amber-100 text-amber-800 border-amber-300'
                }`}
              >
                {bill.paymentStatus === 'PAID'
                  ? '✓ ชำระครบแล้ว'
                  : bill.paymentStatus === 'PARTIALLY_PAID'
                  ? 'ชำระบางส่วน'
                  : 'รอชำระ'}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Body */}
        <div className="space-y-4 py-3 flex-1 overflow-y-auto pr-1 text-xs">
          {/* KPI Financial Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200">
              <span className="text-[10.5px] text-slate-400 font-bold block">ยอดหนี้ตามบิล</span>
              <span className="font-mono font-bold text-sm text-slate-900">
                {formatCurrency(bill.totalAmount)}
              </span>
            </div>

            <div className="bg-amber-50/70 p-2.5 rounded-2xl border border-amber-200">
              <span className="text-[10.5px] text-amber-700 font-bold block">ส่วนลดท้ายบิล</span>
              <span className="font-mono font-bold text-sm text-amber-900">
                {formatCurrency(bill.alreadyDiscountAmount || 0)}
              </span>
            </div>

            <div className="bg-indigo-50/70 p-2.5 rounded-2xl border border-indigo-200">
              <span className="text-[10.5px] text-indigo-700 font-bold block">ประกบใบลดหนี้</span>
              <span className="font-mono font-bold text-sm text-indigo-900">
                {formatCurrency(bill.alreadyDeductedReturns || 0)}
              </span>
            </div>

            <div className="bg-emerald-50/70 p-2.5 rounded-2xl border border-emerald-200">
              <span className="text-[10.5px] text-emerald-700 font-bold block">จ่ายเงินแล้ว</span>
              <span className="font-mono font-bold text-sm text-emerald-900">
                {formatCurrency(bill.alreadyPaidAmount || 0)}
              </span>
            </div>

            <div className="bg-rose-50/70 p-2.5 rounded-2xl border border-rose-200 col-span-2 sm:col-span-1">
              <span className="text-[10.5px] text-rose-700 font-bold block">หนี้คงค้างสุทธิ</span>
              <span className="font-mono font-black text-sm text-rose-900">
                {formatCurrency(bill.remainingPayable)}
              </span>
            </div>
          </div>

          {/* Sub Navigation Tabs */}
          <div className="flex border-b border-slate-200 gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('items')}
              className={`pb-2 font-bold text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === 'items'
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>รายการสินค้าในใบสั่งซื้อ ({(bill.items || []).length} รายการ)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`pb-2 font-bold text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === 'payments'
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>ประวัติการจ่ายเงิน & หักหนี้ ({(bill.payments || []).length} รอบ)</span>
            </button>
          </div>

          {/* TAB 1: PO ITEMS TABLE */}
          {activeTab === 'items' && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-center w-10">ลำดับ</th>
                    <th className="p-2.5 text-left">สินค้า / SKU</th>
                    <th className="p-2.5 text-center w-24">จำนวนที่สั่ง</th>
                    <th className="p-2.5 text-center w-24">รับเข้าแล้ว</th>
                    <th className="p-2.5 text-right w-24">ราคาทุน (฿)</th>
                    <th className="p-2.5 text-right w-28">รวม (฿)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!bill.items || bill.items.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-400">
                        ไม่มีข้อมูลรายการสินค้าในบิลนี้
                      </td>
                    </tr>
                  ) : (
                    bill.items.map((item: any, idx: number) => {
                      const qty = Number(item.quantity || 0);
                      const cost = Number(item.unitPrice || item.costPrice || 0);
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="p-2.5 text-center text-slate-400">{idx + 1}</td>
                          <td className="p-2.5">
                            <p className="font-bold text-slate-900">{item.productName}</p>
                            <p className="text-[10px] text-slate-400 font-mono">SKU: {item.sku}</p>
                          </td>
                          <td className="p-2.5 text-center font-mono">
                            {qty} {item.unitName || 'ชิ้น'}
                          </td>
                          <td className="p-2.5 text-center font-mono text-emerald-700 font-bold">
                            {item.receivedQuantity ?? qty} {item.unitName || 'ชิ้น'}
                          </td>
                          <td className="p-2.5 text-right font-mono">
                            {formatCurrency(cost)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(qty * cost)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: PAYMENTS & DEDUCTIONS HISTORY */}
          {activeTab === 'payments' && (
            <div className="space-y-3">
              {(!bill.payments || bill.payments.length === 0) ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 space-y-1">
                  <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="font-bold text-slate-600">ยังไม่มีประวัติการชำระเงินของบิลนี้</p>
                  <p className="text-[11px] text-slate-400">เมื่อมีการจ่ายเงินหรือประกบใบลดหนี้ ข้อมูลจะปรากฏที่นี่</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {bill.payments.map((p, idx) => (
                    <div
                      key={p.id}
                      className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row justify-between sm:items-center gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-indigo-700">{p.id}</span>
                          <Badge variant="outline" className="text-[10px] bg-white font-bold">
                            {p.paymentMethod === 'CASH'
                              ? '💵 เงินสด'
                              : p.paymentMethod === 'TRANSFER'
                              ? '📱 โอนเงิน'
                              : '💳 เช็ค/อื่นๆ'}
                          </Badge>
                          <span className="text-[11px] text-slate-400">
                            {new Date(p.paymentDate).toLocaleDateString('th-TH')}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-600">
                          <span>จ่ายจริง: <strong className="text-emerald-700 font-mono">{formatCurrency(p.netCashOrTransferPaid)}</strong></span>
                          {p.discountAmount && p.discountAmount > 0 ? (
                            <span>• ส่วนลดท้ายบิล: <strong className="text-amber-700 font-mono">{formatCurrency(p.discountAmount)}</strong></span>
                          ) : null}
                          {p.deductedCreditAmount > 0 ? (
                            <span>• ประกบใบลดหนี้: <strong className="text-indigo-700 font-mono">{formatCurrency(p.deductedCreditAmount)}</strong></span>
                          ) : null}
                        </div>

                        {p.referenceNo && (
                          <p className="text-[10.5px] text-slate-400 font-mono">เลขอ้างอิง: {p.referenceNo}</p>
                        )}
                        {p.note && (
                          <p className="text-[10.5px] text-slate-500 italic">หมายเหตุ: {p.note}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onViewVoucher(bill, p)}
                          className="h-8 text-xs font-bold rounded-xl border-slate-200 hover:border-indigo-300 hover:text-indigo-600 gap-1"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>ใบสำคัญจ่าย</span>
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isRollingBack}
                          onClick={() => handleRollbackPayment(p.id)}
                          className="h-8 text-xs font-bold rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>ย้อนสถานะรอบนี้</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <DialogFooter className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-2 shrink-0">
          <div>
            {(bill.payments && bill.payments.length > 0) && (
              <Button
                type="button"
                variant="outline"
                disabled={isRollingBack}
                onClick={() => handleRollbackPayment()}
                className="rounded-xl font-bold border-amber-300 text-amber-800 hover:bg-amber-50 gap-1.5 text-xs w-full sm:w-auto"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ย้อนสถานะการชำระเงินทั้งหมด</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl font-bold text-slate-600"
            >
              ปิด
            </Button>

            {bill.remainingPayable > 0 && (
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onSettleClick(bill);
                }}
                className="rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-md"
              >
                <Receipt className="w-4 h-4" />
                <span>ชำระหนี้ & ประกบใบลดหนี้</span>
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
