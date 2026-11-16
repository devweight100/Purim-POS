import { useRouter } from 'next/navigation';
import { normVatType } from '@shared/po-calc';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import {
  Eye, CheckCircle, PackageOpen, Image as ImageIcon, Sparkles, Pencil, Ban, RotateCcw
} from 'lucide-react';
import { formatQty } from '@/lib/qty';
import { lineVatRate, receivedValue, type PreviewTarget, type PurchaseOrder } from './po-shared';
import { poStatusBadge } from './PoStatusBadge';

type PoAction = (po: PurchaseOrder, e?: React.MouseEvent) => void;

interface Props {
  isDetailOpen: boolean;
  setIsDetailOpen: (open: boolean) => void;
  currentPo: PurchaseOrder | null;
  openImagePreview: (product: PreviewTarget, e?: React.MouseEvent) => void;
  openIssueConfirmDialog: PoAction;
  openReceiveDialog: PoAction;
  openEditDialog: PoAction;
  openStatusChangeDialog: PoAction;
  openCancelDialog: PoAction;
  openPdfModal: PoAction;
  setReturnPo: (po: PurchaseOrder | null) => void;
}

/** Details of one purchase order with its actions. */
export function PoDetailDialog({
  isDetailOpen, setIsDetailOpen, currentPo, openImagePreview, openIssueConfirmDialog, openReceiveDialog,
  openEditDialog, openStatusChangeDialog, openCancelDialog, openPdfModal, setReturnPo,
}: Props) {
  const router = useRouter();
  return (
    <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4 text-xl font-bold text-slate-900">
            <span>รายละเอียดใบสั่งซื้อ {currentPo?.poNumber}</span>
            {currentPo && poStatusBadge(currentPo.status)}
          </DialogTitle>
        </DialogHeader>
        {currentPo && (
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-500 block mb-1">ผู้จำหน่าย</span>
                <span className="font-bold text-slate-900 text-base">{currentPo.supplier?.name || currentPo.supplierName}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-1">วันที่สร้าง</span>
                <span className="font-bold text-slate-900 text-base">{formatDate(currentPo.createdAt)}</span>
              </div>
            </div>
            
            <div>
              <h4 className="font-bold text-slate-900 mb-3 border-b border-slate-200 pb-2">รายการสินค้าสั่งซื้อ</h4>
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="border-slate-200">
                    <TableHead className="w-12 text-center text-slate-500 font-bold">ลำดับ</TableHead>
                    <TableHead className="text-slate-500 font-bold">สินค้า</TableHead>
                    <TableHead className="text-right text-slate-500 font-bold">สั่ง (ชิ้น)</TableHead>
                    <TableHead className="text-right text-slate-500 font-bold">รับแล้ว (ชิ้น)</TableHead>
                    <TableHead className="text-right text-slate-500 font-bold">ต้นทุน/หน่วย</TableHead>
                    <TableHead className="text-right text-slate-500 font-bold">รวม (รวม VAT)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentPo.items?.map((item, idx: number) => (
                    <TableRow key={idx} className="border-slate-100 hover:bg-slate-50">
                      <TableCell className="text-center text-slate-400 font-semibold">{idx + 1}</TableCell>
                      <TableCell className="text-slate-900 font-bold flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => openImagePreview(item, e)}
                          className="w-7 h-7 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-sky-600 shrink-0"
                          title="ดูรูปภาพสินค้า"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                        </button>
                        <span>{item.name || item.product?.name}</span>
                      </TableCell>
                      <TableCell className="text-right text-slate-700 font-semibold">{formatQty(item.quantity)}</TableCell>
                      <TableCell className="text-right text-emerald-600 font-bold">{formatQty(Number(item.receivedQty ?? item.receivedQuantity) || 0)}</TableCell>
                      <TableCell className="text-right text-slate-600">{formatCurrency(item.unitCost)}</TableCell>
                      <TableCell className="text-right text-slate-900 font-bold">
                        {formatCurrency(item.total !== undefined && item.total !== null ? Number(item.total) : item.quantity * item.unitCost)}
                        {normVatType(item.vatType) !== 'NONE' && (
                          <span className={`block text-[10px] font-semibold ${normVatType(item.vatType) === 'INCLUDED' ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {normVatType(item.vatType) === 'INCLUDED' ? 'รวม' : '+'}VAT {lineVatRate(item.vatRate)}% ({formatCurrency(Number(item.vatAmount) || 0)})
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="text-right mt-4 pt-4 border-t border-slate-200 flex justify-end">
                <div className="w-80 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-left">
                  {Number(currentPo.discountAmount) > 0 && (
                    <div className="flex justify-between text-xs text-slate-600 font-medium">
                      <span>ส่วนลดรวม:</span>
                      <span className="font-mono font-bold text-rose-600">-{formatCurrency(Number(currentPo.discountAmount))}</span>
                    </div>
                  )}
                  {Number(currentPo.vatAmount) > 0 && (
                    <>
                      <div className="flex justify-between text-xs text-slate-600 font-medium">
                        <span>มูลค่าก่อนภาษี:</span>
                        <span className="font-mono font-bold text-slate-800">{formatCurrency(Number(currentPo.subtotalAmount))}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-600 font-medium">
                        <span>ภาษีซื้อ (VAT):</span>
                        <span className="font-mono font-bold text-sky-700">{formatCurrency(Number(currentPo.vatAmount))}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-xs text-slate-600 font-medium">
                    <span>ยอดรวมบิลสั่งซื้อ:</span>
                    <span className="font-mono font-bold text-slate-800">{formatCurrency(currentPo.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600 font-medium">
                    <span>มูลค่าสินค้าที่รับแล้ว (ตั้งเป็นหนี้):</span>
                    <span className="font-mono font-bold text-indigo-700">
                      {formatCurrency(
                        receivedValue(currentPo)
                      )}
                    </span>
                  </div>

                  {/* Paid / remaining come from the database (payment vouchers incl. credit-note deductions). */}
                  <div className="flex justify-between text-xs text-slate-600 font-medium">
                    <span>ชำระแล้ว (รวมหักใบลดหนี้):</span>
                    <span className="font-mono font-bold text-emerald-700">{formatCurrency(Number(currentPo.paidAmount || 0))}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between font-black text-lg text-slate-900">
                    <span>ยอดค้างชำระ (ของที่รับแล้ว):</span>
                    <span className="text-rose-700 font-mono font-black">
                      {formatCurrency(
                        Math.max(
                          0,
                          Math.min(
                            Number(currentPo.remainingPayable ?? currentPo.totalAmount ?? 0),
                            receivedValue(currentPo) - Number(currentPo.paidAmount || 0),
                          ),
                        )
                      )}
                    </span>
                  </div>

                  {currentPo.status !== 'CANCELLED' && Number(currentPo.remainingPayable ?? 0) > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setIsDetailOpen(false);
                        router.push('/payables');
                      }}
                      className="mt-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 rounded-xl shadow-xs gap-1.5"
                      title="ชำระเงินและหักใบลดหนี้ทำที่หน้าเจ้าหนี้การค้า เพื่อให้ยอดตรงกับฐานข้อมูล"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>ชำระเงิน / หักใบลดหนี้ ที่หน้าเจ้าหนี้การค้า</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="flex justify-between items-center w-full sm:justify-between border-t border-slate-100 pt-4">
           <div className="flex gap-2 flex-wrap items-center">
              {currentPo?.status === 'DRAFT' && (
                <Button variant="outline" className="border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-bold" onClick={(e) => openIssueConfirmDialog(currentPo, e)}>
                  <CheckCircle className="w-4 h-4 mr-2" /> ออกใบสั่งซื้อ (Issue)
                </Button>
              )}
              {(currentPo?.status === 'ISSUED' || currentPo?.status === 'PARTIALLY_RECEIVED') && (
                <Button variant="outline" className="border-indigo-500 text-indigo-600 hover:bg-indigo-50 font-bold" onClick={(e) => { setIsDetailOpen(false); openReceiveDialog(currentPo, e); }}>
                  <PackageOpen className="w-4 h-4 mr-2" /> รับสินค้า (GRN)
                </Button>
              )}
              {currentPo?.status === 'DRAFT' && (
                <Button variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-50 font-bold" onClick={() => openEditDialog(currentPo)}>
                  <Pencil className="w-4 h-4 mr-2" /> แก้ไขใบสั่งซื้อ
                </Button>
              )}
              {/* Status Change / Rollback Button in Detail Modal */}
              <Button variant="outline" className="border-indigo-400 text-indigo-700 hover:bg-indigo-50 font-bold" onClick={(e) => { setIsDetailOpen(false); openStatusChangeDialog(currentPo!, e); }}>
                <RotateCcw className="w-4 h-4 mr-2" /> เปลี่ยน / ย้อนสถานะ
              </Button>
              {(currentPo?.status === 'PARTIALLY_RECEIVED' || currentPo?.status === 'COMPLETED' || currentPo?.status === 'RECEIVED') && (
                <Button variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-50 font-bold" onClick={() => { setIsDetailOpen(false); setReturnPo(currentPo); }}>
                  <RotateCcw className="w-4 h-4 mr-2" /> คืนสินค้าให้บริษัท
                </Button>
              )}
              {currentPo?.status !== 'CANCELLED' && (
                <Button variant="outline" className="border-rose-300 text-rose-600 hover:bg-rose-50 font-bold" onClick={() => { setIsDetailOpen(false); openCancelDialog(currentPo!); }}>
                  <Ban className="w-4 h-4 mr-2" /> ยกเลิกใบสั่งซื้อ
                </Button>
              )}
           </div>
           <div className="flex gap-2">
             <Button variant="outline" className="font-bold" onClick={() => { if (currentPo) { setIsDetailOpen(false); openPdfModal(currentPo); } }}>
               <Eye className="w-4 h-4 mr-2" /> ดู/พิมพ์ PDF
             </Button>
             <Button variant="ghost" onClick={() => setIsDetailOpen(false)} className="text-slate-500 hover:text-slate-900 hover:bg-slate-100">ปิดหน้าต่าง</Button>
           </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
