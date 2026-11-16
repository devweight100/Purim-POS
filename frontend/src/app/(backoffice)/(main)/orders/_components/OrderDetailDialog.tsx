import { formatCurrency, formatDate } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban, CreditCard, User, Printer, FileText, Edit3, RotateCcw, History } from "lucide-react";
import { isCreditOrderFullyPaid, isOrderCredit, type OrderAction, type OrderRow } from "./order-shared";

interface Props {
  isDetailOpen: boolean;
  setIsDetailOpen: (open: boolean) => void;
  currentOrder: OrderRow | null;
  handleOpenCreditHistory: OrderAction;
  handleOpenA4Receipt: OrderAction;
  handleOpenSlipReceipt: OrderAction;
  handleStartEditPayment: OrderAction;
  handleStartEditItems: OrderAction;
  handleStartVoid: OrderAction;
  setReturnOrderId: (id: string | null) => void;
}

/** Details of one order with its print / edit actions. */
export function OrderDetailDialog({
  isDetailOpen, setIsDetailOpen, currentOrder, handleOpenCreditHistory, handleOpenA4Receipt, handleOpenSlipReceipt,
  handleStartEditPayment, handleStartEditItems, handleStartVoid, setReturnOrderId,
}: Props) {
  return (
    <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-7 rounded-3xl shadow-2xl">
        <DialogHeader className="border-b border-slate-200 pb-3">
          <DialogTitle className="flex justify-between items-center mr-4">
            <span className="text-xl font-extrabold text-slate-900">
              รายละเอียดออเดอร์ {currentOrder?.orderNumber}
            </span>
            {currentOrder?.status === "VOIDED" || currentOrder?.status === "CANCELLED" ? (
              <Badge className="bg-rose-100 text-rose-700 border-rose-300 text-xs px-3 py-1 font-bold">
                ยกเลิกแล้ว
              </Badge>
            ) : isOrderCredit(currentOrder) ? (
              isCreditOrderFullyPaid(currentOrder) ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs px-3 py-1">
                  สำเร็จ
                </Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-xs px-3 py-1">
                  เงินเชื่อ
                </Badge>
              )
            ) : (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs px-3 py-1">
                สำเร็จ
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {currentOrder && (
          <div className="space-y-4 py-2 text-xs">
            {/* Top Details Box */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <div>
                <span className="text-slate-500 block mb-0.5">วันที่ / เวลาขาย</span>
                <span className="font-bold text-slate-900 text-sm">{formatDate(currentOrder.createdAt)}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">ชื่อลูกค้า</span>
                <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-sky-600" />
                  {currentOrder.customerName || (typeof currentOrder.customer === "object" ? currentOrder.customer?.name : currentOrder.customer) || "ลูกค้าทั่วไป"}
                </span>
              </div>
              {currentOrder.voidReason && (
                <div className="col-span-1 sm:col-span-2 pt-2 border-t border-slate-200">
                  <span className="text-rose-600 font-bold block mb-0.5">เหตุผลที่ยกเลิก:</span>
                  <span className="text-slate-700 bg-rose-50 p-2 rounded-xl border border-rose-200 block">
                    {currentOrder.voidReason}
                  </span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-bold text-slate-800 text-xs">รายการสินค้า</TableHead>
                    <TableHead className="text-center font-bold text-slate-800 text-xs">จำนวน</TableHead>
                    <TableHead className="text-right font-bold text-slate-800 text-xs">ราคา/หน่วย</TableHead>
                    <TableHead className="text-right font-bold text-slate-800 text-xs">รวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100">
                  {(currentOrder.items || []).map((item, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-bold text-slate-800 text-xs">
                        {item.name || item.productName || "สินค้า"}
                      </TableCell>
                      <TableCell className="text-center font-mono font-bold text-xs">
                        {item.quantity} {item.unitName || "ชิ้น"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatCurrency(item.unitPrice || item.price || 0)}
                      </TableCell>
                      <TableCell className="text-right font-bold font-mono text-xs">
                        {formatCurrency(item.lineTotal || item.quantity * (item.unitPrice || item.price || 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Financial Calculation Summary */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1.5">
              <div className="flex justify-between text-slate-600">
                <span>รวมราคาสินค้า:</span>
                <span className="font-mono font-bold">{formatCurrency(currentOrder.subtotal || currentOrder.totalAmount || 0)}</span>
              </div>
              {(currentOrder.billDiscountAmount ?? 0) > 0 && (
                <div className="flex justify-between text-rose-600 font-semibold">
                  <span>ส่วนลดท้ายบิล:</span>
                  <span className="font-mono">-{formatCurrency(currentOrder.billDiscountAmount)}</span>
                </div>
              )}
              {(currentOrder.pointsDiscountAmount ?? 0) > 0 && (
                <div className="flex justify-between text-amber-800 font-bold">
                  <span>ส่วนลดแต้มสะสม:</span>
                  <span className="font-mono">-{formatCurrency(currentOrder.pointsDiscountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-slate-900">
                <span className="font-bold text-sm">ยอดเงินรวมสุทธิ:</span>
                <span className="font-black text-2xl text-indigo-700 font-mono">
                  {formatCurrency(currentOrder.totalAmount || currentOrder.total || 0)}
                </span>
              </div>
            </div>

            {/* Action Buttons inside Modal */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200">
              <div className="flex flex-wrap gap-2">
                {isOrderCredit(currentOrder) ? (
                  <Button
                    size="sm"
                    onClick={(e) => handleOpenCreditHistory(currentOrder, e)}
                    className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs gap-1.5"
                  >
                    <History className="w-4 h-4" />
                    <span>ประวัติชำระ & ออกใบเสร็จ</span>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={(e) => handleOpenA4Receipt(currentOrder, e)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs gap-1.5"
                  >
                    <FileText className="w-4 h-4" />
                    <span>พิมพ์ใบเสร็จเต็มรูปแบบ (A4)</span>
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => handleOpenSlipReceipt(currentOrder, e)}
                  className="border-slate-300 text-slate-700 font-semibold text-xs h-9 px-3 rounded-xl gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>พิมพ์สลิป 80mm</span>
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {currentOrder.status !== "VOIDED" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => handleStartEditPayment(currentOrder, e)}
                      className="border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-bold text-xs h-9 px-3 rounded-xl"
                    >
                      <CreditCard className="w-3.5 h-3.5 mr-1" />
                      เปลี่ยนวิธีชำระ
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => handleStartEditItems(currentOrder, e)}
                      className="border-sky-300 text-sky-800 hover:bg-sky-50 font-bold text-xs h-9 px-3 rounded-xl"
                    >
                      <Edit3 className="w-3.5 h-3.5 mr-1" />
                      แก้ไขในหน้าขาย
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReturnOrderId(currentOrder.id)}
                      className="border-amber-300 text-amber-700 hover:bg-amber-50 font-bold text-xs h-9 px-3 rounded-xl"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      รับคืนสินค้า
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => handleStartVoid(currentOrder, e)}
                      className="border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-9 px-3 rounded-xl"
                    >
                      <Ban className="w-3.5 h-3.5 mr-1" />
                      ยกเลิกบิล
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
