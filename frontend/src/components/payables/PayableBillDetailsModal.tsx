'use client';

import { useState } from 'react';
import { FileText, Receipt, RotateCcw, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency, formatListDate } from '@/lib/utils';
import { SupplierPayableBill, PayablePaymentEntry, rollbackPayableBillPayment } from '@/lib/payable-service';
import { toast } from 'sonner';
import type { ApiPurchaseOrderItem } from '@/lib/types';
import { askConfirm } from '@/lib/ask-dialog';

interface PayableBillDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: SupplierPayableBill | null;
  onSettleClick: (bill: SupplierPayableBill) => void;
  onViewVoucher: (bill: SupplierPayableBill, payment: PayablePaymentEntry) => void;
  onReload: () => void;
}

/** A line of the bill as shown here (payable-service keeps them untyped). */
/** One PO line of the bill, as the server sends it. */
type PayableBillItem = ApiPurchaseOrderItem;

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

  const handleRollbackPayment = async (paymentId?: string) => {
    const ok = await askConfirm(
      paymentId
        ? { title: 'ต้องการยกเลิก/ย้อนสถานะการชำระเงินรอบนี้หรือไม่?', description: 'ยอดเงินสด/โอน และเครดิตใบลดหนี้จะถูกคืนกลับสถานะเดิม', confirmLabel: 'ย้อนสถานะ', danger: true }
        : { title: `ต้องการย้อนสถานะการชำระเงินทั้งหมดของบิล ${bill.poNumber} หรือไม่?`, description: 'ยอดเงินที่จ่ายไปและเครดิตใบลดหนี้จะถูกคืนสถานะทั้งหมด และยอดหนี้จะกลับมาค้างชำระเต็มจำนวน', confirmLabel: 'ย้อนสถานะ', danger: true },
    );
    if (!ok) return;

    setIsRollingBack(true);
    try {
      const res = await rollbackPayableBillPayment(bill, paymentId);
      if (res.success) {
        toast.success(res.message);
        onReload();
        onOpenChange(false);
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      toast.error((e as Error).message || 'เกิดข้อผิดพลาดในการย้อนสถานะ');
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
                  <span className="tabular-nums text-indigo-600">{bill.poNumber}</span>
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
          {/* Document facts (round 4: moved here from the bills table) */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-4" data-testid="bill-facts">
            <div><dt className="text-[10.5px] font-bold text-slate-400">เลขที่เอกสาร (PO)</dt><dd className="tabular-nums font-bold text-slate-900">{bill.poNumber}</dd></div>
            <div><dt className="text-[10.5px] font-bold text-slate-400">วันที่บิล</dt><dd className="font-semibold text-slate-800">{formatListDate(bill.billDate)}</dd></div>
            <div>
              <dt className="text-[10.5px] font-bold text-slate-400">เลขที่บิลผู้จำหน่าย</dt>
              <dd className="tabular-nums font-semibold text-slate-800 break-all">{bill.supplierInvoiceNo || <span className="font-sans italic text-slate-400">ยังไม่ระบุ</span>}</dd>
            </div>
            <div><dt className="text-[10.5px] font-bold text-slate-400">ลงวันที่ (บิลผู้จำหน่าย)</dt><dd className="font-semibold text-slate-800">{bill.supplierInvoiceDate ? formatListDate(bill.supplierInvoiceDate) : '-'}</dd></div>
            {bill.paymentStatus === 'PARTIALLY_PAID' && bill.remainingPayable <= 0 && (
              <div className="col-span-2 sm:col-span-4 text-[11px] font-bold text-teal-700">จ่ายครบตามมูลค่าที่รับแล้ว ยังมีสินค้ารอรับ (รอรับของ)</div>
            )}
          </dl>

          {/* KPI Financial Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200">
              <span className="text-[10.5px] text-slate-400 font-bold block">ยอดหนี้ (รับของแล้ว)</span>
              <span className="tabular-nums font-bold text-sm text-slate-900">
                {formatCurrency(bill.receivedAmount ?? bill.totalAmount)}
                                {bill.receivedAmount !== undefined && Math.abs(bill.receivedAmount - bill.totalAmount) > 0.004 && (
                                  <span className="block text-[10px] font-medium text-slate-400">จาก PO {formatCurrency(bill.totalAmount)}</span>
                                )}
              </span>
            </div>

            <div className="bg-amber-50/70 p-2.5 rounded-2xl border border-amber-200">
              <span className="text-[10.5px] text-amber-700 font-bold block">ส่วนลดท้ายบิล</span>
              <span className="tabular-nums font-bold text-sm text-amber-900">
                {formatCurrency(bill.alreadyDiscountAmount || 0)}
              </span>
            </div>

            <div className="bg-indigo-50/70 p-2.5 rounded-2xl border border-indigo-200">
              <span className="text-[10.5px] text-indigo-700 font-bold block">ประกบใบลดหนี้</span>
              <span className="tabular-nums font-bold text-sm text-indigo-900">
                {formatCurrency(bill.alreadyDeductedReturns || 0)}
              </span>
            </div>

            <div className="bg-emerald-50/70 p-2.5 rounded-2xl border border-emerald-200">
              <span className="text-[10.5px] text-emerald-700 font-bold block">จ่ายเงินแล้ว</span>
              <span className="tabular-nums font-bold text-sm text-emerald-900">
                {formatCurrency(bill.alreadyPaidAmount || 0)}
              </span>
            </div>

            <div className="bg-rose-50/70 p-2.5 rounded-2xl border border-rose-200 col-span-2 sm:col-span-1">
              <span className="text-[10.5px] text-rose-700 font-bold block">หนี้คงค้างสุทธิ</span>
              <span className="tabular-nums font-semibold text-sm text-rose-900">
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
              <table className="tbl w-full text-xs">
                <thead >
                  <tr>
                    <th className="text-center w-10">ลำดับ</th>
                    <th className="text-left">สินค้า / SKU</th>
                    <th className="text-center w-24">จำนวนที่สั่ง</th>
                    <th className="text-center w-24">รับเข้าแล้ว</th>
                    <th className="text-right w-24">ราคาทุน (฿)</th>
                    <th className="text-right w-28">รวม (฿)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!bill.items || bill.items.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="text-center text-subtle">
                        ไม่มีข้อมูลรายการสินค้าในบิลนี้
                      </td>
                    </tr>
                  ) : (
                    bill.items.map((item: PayableBillItem, idx: number) => {
                      const qty = Number(item.quantity || 0);
                      const cost = Number(item.unitPrice || item.costPrice || 0);
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="text-center text-subtle">{idx + 1}</td>
                          <td >
                            <p className="font-medium text-fg">{item.productName}</p>
                            <p className="text-sub text-subtle doc-no">SKU: {item.sku}</p>
                          </td>
                          <td className="text-center doc-no">
                            {qty} {item.unitName || 'ชิ้น'}
                          </td>
                          <td className="text-center doc-no text-ok font-medium">
                            {item.receivedQuantity ?? qty} {item.unitName || 'ชิ้น'}
                          </td>
                          <td className="text-right tabular-nums">
                            {formatCurrency(cost)}
                          </td>
                          <td className="text-right tabular-nums font-medium text-fg">
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
                          <span className="tabular-nums font-bold text-indigo-700">{p.id}</span>
                          <Badge variant="outline" className="text-[10px] bg-white font-bold">
                            {p.paymentMethod === 'CASH'
                              ? 'เงินสด'
                              : p.paymentMethod === 'TRANSFER'
                              ? 'โอนเงิน'
                              : 'เช็ค/อื่นๆ'}
                          </Badge>
                          <span className="text-[11px] text-slate-400">
                            {formatListDate(p.paymentDate)}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-600">
                          <span>จ่ายจริง: <strong className="text-emerald-700 tabular-nums">{formatCurrency(p.netCashOrTransferPaid)}</strong></span>
                          {p.discountAmount && p.discountAmount > 0 ? (
                            <span>• ส่วนลดท้ายบิล: <strong className="text-amber-700 tabular-nums">{formatCurrency(p.discountAmount)}</strong></span>
                          ) : null}
                          {p.deductedCreditAmount > 0 ? (
                            <span>• ประกบใบลดหนี้: <strong className="text-indigo-700 tabular-nums">{formatCurrency(p.deductedCreditAmount)}</strong></span>
                          ) : null}
                        </div>

                        {p.referenceNo && (
                          <p className="text-[10.5px] text-slate-400 tabular-nums">เลขอ้างอิง: {p.referenceNo}</p>
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
                          disabled={isRollingBack}
                          onClick={() => handleRollbackPayment(p.id)}
                          className="border-amber-200 text-amber-700 hover:bg-amber-50 gap-1"
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
                className="border-amber-300 text-amber-800 hover:bg-amber-50 gap-1.5 w-full sm:w-auto"
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
              className="text-slate-600"
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
                className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
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
