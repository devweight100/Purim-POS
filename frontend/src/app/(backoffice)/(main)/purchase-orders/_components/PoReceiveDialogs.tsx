import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CheckCircle, PackageOpen, Image as ImageIcon, AlertTriangle, Info } from 'lucide-react';
import { addQty, formatQty, mulQty, parseQty, qtyInputMode, qtyStep, subQty } from '@/lib/qty';
import type { PoReceiveItem, PreviewTarget, PurchaseOrder } from './po-shared';

interface ReceiveProps {
  isReceiveOpen: boolean;
  setIsReceiveOpen: (open: boolean) => void;
  currentPo: PurchaseOrder | null;
  receiveItems: PoReceiveItem[];
  setReceiveItems: React.Dispatch<React.SetStateAction<PoReceiveItem[]>>;
  receiveSupplierInvoiceNo: string;
  setReceiveSupplierInvoiceNo: (v: string) => void;
  receiveSupplierInvoiceDate: string;
  setReceiveSupplierInvoiceDate: (v: string) => void;
  allowDecimalQty: boolean;
  openImagePreview: (product: PreviewTarget, e?: React.MouseEvent) => void;
  handleTriggerReceivePO: () => void;
}

/** Receive goods (GRN) against a purchase order. */
export function PoReceiveDialog({
  isReceiveOpen, setIsReceiveOpen, currentPo, receiveItems, setReceiveItems,
  receiveSupplierInvoiceNo, setReceiveSupplierInvoiceNo, receiveSupplierInvoiceDate, setReceiveSupplierInvoiceDate,
  allowDecimalQty, openImagePreview, handleTriggerReceivePO,
}: ReceiveProps) {
  return (
    <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[85vw] lg:w-[75vw] max-w-[75vw] h-[88vh] max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-slate-50/80 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2.5 text-slate-900">
              <PackageOpen className="w-7 h-7 text-amber-500" />
              ตรวจนับและรับสินค้าเข้าคลัง (PO: {currentPo?.poNumber})
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReceiveItems(prev => prev.map(i => ({ ...i, toReceive: i.remainingQty })))}
                className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-semibold h-8"
              >
                ✓ รับครบทั้งหมด
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReceiveItems(prev => prev.map(i => ({ ...i, toReceive: 0 })))}
                className="text-xs border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold h-8"
              >
                ล้างเป็น 0
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-8 py-6 pb-8 space-y-5">
          <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">ขั้นตอนการตรวจรับสินค้า (GRN):</span> ตรวจสอบจำนวนสินค้าจริงที่มาส่ง หากจำนวนไม่ตรงกับใบสั่งซื้อ สามารถปรับแก้ตัวเลขในช่อง <b>&quot;รับเพิ่มครั้งนี้&quot;</b> ได้ทันที เมื่อกดยืนยันระบบจะนำจำนวนที่ได้รับจริงไป <b>เพิ่มสต็อกสินค้าในคลังให้อัตโนมัติ</b>
            </div>
          </div>

          {/* Supplier Invoice Information Card */}
          <div className="bg-slate-50/90 border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-2xs">
            <div>
              <label className="text-xs font-bold text-slate-800 block mb-1">
                เลขที่บิล / ใบกำกับภาษี / ใบส่งของของผู้จำหน่าย (Supplier Invoice / DO No.)
              </label>
              <Input
                placeholder="เช่น INV-670123 หรือ DO-8899"
                value={receiveSupplierInvoiceNo}
                onChange={(e) => setReceiveSupplierInvoiceNo(e.target.value)}
                className="bg-white border-slate-300 h-9 text-xs font-mono font-bold text-slate-900"
              />
              <p className="text-[11px] text-slate-500 mt-1">ใช้ประกบคู่กับ PO เพื่อนำไปจับคู่ชำระเงินในระบบเจ้าหนี้การค้า</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-800 block mb-1">
                วันที่ในบิลผู้จำหน่าย (Invoice Date)
              </label>
              <Input
                type="date"
                value={receiveSupplierInvoiceDate}
                onChange={(e) => setReceiveSupplierInvoiceDate(e.target.value)}
                className="bg-white border-slate-300 h-9 text-xs text-slate-800"
              />
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow className="border-slate-200">
                  <TableHead className="w-10 text-center text-slate-500 font-bold">#</TableHead>
                  <TableHead className="text-slate-500 font-bold min-w-[200px]">สินค้า</TableHead>
                  <TableHead className="text-center text-slate-500 font-bold">หน่วย</TableHead>
                  <TableHead className="text-center text-slate-500 font-bold">สั่งซื้อ</TableHead>
                  <TableHead className="text-center text-slate-500 font-bold">รับแล้ว</TableHead>
                  <TableHead className="text-center text-slate-500 font-bold">ค้างรับ</TableHead>
                  <TableHead className="text-right text-slate-500 font-bold w-32">รับเพิ่มครั้งนี้</TableHead>
                  <TableHead className="text-right text-slate-500 font-bold min-w-[130px]">สต็อกในคลัง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiveItems.map((item, idx) => {
                  const toRec = Number(item.toReceive) || 0;
                  const mult = Number(item.multiplier) || 1;
                  const stockDelta = mulQty(toRec, mult);
                  const currentStock = Number(item.currentStock || 0);
                  const newStock = addQty(currentStock, stockDelta);

                  return (
                    <TableRow key={idx} className="border-slate-100 hover:bg-slate-50/70">
                      <TableCell className="text-center text-slate-400 font-semibold text-xs">{idx + 1}</TableCell>
                      <TableCell className="text-slate-900 font-bold">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={(e) => openImagePreview(item, e)}
                            className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-sky-600 shrink-0 shadow-2xs"
                            title="ดูรูปภาพสินค้า"
                          >
                            <ImageIcon className="w-4 h-4" />
                          </button>
                          <div className="min-w-0">
                            <div className="truncate text-sm">{item.name}</div>
                            <div className="text-xs text-slate-400 font-mono font-normal">{item.sku}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-xs font-semibold">
                          {item.unitName} {mult > 1 ? `(×${mult})` : ''}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-slate-700 font-semibold">{formatQty(item.orderedQty)}</TableCell>
                      <TableCell className="text-center text-emerald-600 font-bold">{formatQty(item.receivedQty)}</TableCell>
                      <TableCell className="text-center text-amber-700 font-bold">{formatQty(item.remainingQty)}</TableCell>
                      <TableCell className="text-right">
                        <Input 
                          type="number" 
                          min="0"
                          step={qtyStep(allowDecimalQty)}
                          inputMode={qtyInputMode(allowDecimalQty)}
                          value={item.toReceive}
                          onChange={(e) => {
                            const val = Math.max(0, parseQty(e.target.value, allowDecimalQty) || 0);
                            const newItems = [...receiveItems];
                            newItems[idx].toReceive = val;
                            setReceiveItems(newItems);
                          }}
                          className="bg-white border-slate-300 h-9 text-right font-bold text-sky-600 focus-visible:ring-sky-500 w-full"
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <div className="flex flex-col items-end">
                          <span className="font-semibold text-slate-800">
                            {formatQty(currentStock)} → <b className="text-emerald-600 font-bold">{formatQty(newStock)}</b>
                          </span>
                          {stockDelta > 0 && (
                            <span className="text-[11px] font-bold text-emerald-600">
                              (+{formatQty(stockDelta)} ชิ้น)
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Status Preview Card */}
          {(() => {
            const isAllReceived = receiveItems.every((i) => addQty(i.receivedQty || 0, Number(i.toReceive) || 0) >= i.orderedQty);
            const totalItemsReceiving = receiveItems.filter(i => Number(i.toReceive) > 0).length;
            const totalUnitsReceiving = receiveItems.reduce((s, i) => s + (Number(i.toReceive) || 0) * (Number(i.multiplier) || 1), 0);

            return (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="text-xs text-slate-600">
                    รายการที่จะรับเข้าครั้งนี้: <b className="text-slate-900">{totalItemsReceiving} รายการ</b> (เพิ่มเข้าสต็อกรวม <b className="text-emerald-600 font-bold">{totalUnitsReceiving} ชิ้น</b>)
                  </div>
                  <div>
                    {isAllReceived ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs font-bold px-2.5 py-1">
                        สถานะ PO จะเปลี่ยนเป็น: COMPLETED (รับครบถ้วน)
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold px-2.5 py-1">
                        สถานะ PO จะเปลี่ยนเป็น: PARTIALLY_RECEIVED (รับบางส่วน)
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <DialogFooter className="border-t border-slate-200 px-8 py-4.5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
          <Button variant="ghost" onClick={() => setIsReceiveOpen(false)} className="text-slate-600 hover:bg-slate-200/60 font-semibold">
            ยกเลิก
          </Button>
          <Button onClick={handleTriggerReceivePO} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-7 h-11 shadow-sm text-sm">
            <PackageOpen className="w-4 h-4 mr-2" /> ยืนยันรับสินค้าและปรับสต็อกเข้าคลัง
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UnderReceiveProps {
  isUnderReceiveModalOpen: boolean;
  setIsUnderReceiveModalOpen: (open: boolean) => void;
  currentPo: PurchaseOrder | null;
  receiveItems: PoReceiveItem[];
  underReceiveAction: 'ADJUST_AND_COMPLETE' | 'PARTIAL';
  setUnderReceiveAction: (a: 'ADJUST_AND_COMPLETE' | 'PARTIAL') => void;
  executeReceivePO: (adjustAndComplete: boolean) => void;
}

/** Confirmation when fewer goods arrived than ordered (เมื่อรับสินค้าไม่ครบตามใบสั่งซื้อ). */
export function PoUnderReceiveDialog({
  isUnderReceiveModalOpen, setIsUnderReceiveModalOpen, currentPo, receiveItems,
  underReceiveAction, setUnderReceiveAction, executeReceivePO,
}: UnderReceiveProps) {
  return (
    <Dialog open={isUnderReceiveModalOpen} onOpenChange={setIsUnderReceiveModalOpen}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[620px] max-w-[620px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-amber-50/70 shrink-0">
          <DialogTitle className="flex items-center gap-2.5 text-xl font-bold text-amber-900">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            ตรวจพบการรับสินค้าไม่ครบตามใบสั่งซื้อ
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-8 pt-6 pb-10 space-y-5">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-2.5">
            <div className="font-bold text-slate-900 text-sm flex items-center justify-between">
              <span>ใบสั่งซื้อ: {currentPo?.poNumber}</span>
              <span className="text-slate-500 font-normal">ผู้จำหน่าย: {currentPo?.supplier?.name || currentPo?.supplierName}</span>
            </div>
            <p className="text-slate-600">
              รายการสินค้าด้านล่างนี้ มียอดรับจริงน้อยกว่าจำนวนที่ระบุในใบสั่งซื้อ:
            </p>
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white max-h-40 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                  <tr>
                    <th className="p-2.5">สินค้า</th>
                    <th className="p-2.5 text-center">สั่งซื้อ</th>
                    <th className="p-2.5 text-center">รับรวมครั้งนี้</th>
                    <th className="p-2.5 text-right text-rose-600">ค้างรับ/ขาด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receiveItems
                    .filter(i => addQty(Number(i.receivedQty) || 0, Number(i.toReceive) || 0) < Number(i.orderedQty))
                    .map((item, idx) => {
                      const totalRec = addQty(Number(item.receivedQty) || 0, Number(item.toReceive) || 0);
                      const diff = subQty(item.orderedQty, totalRec);
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-medium text-slate-900">{item.name}</td>
                          <td className="p-2.5 text-center font-bold text-slate-700">{formatQty(item.orderedQty)} {item.unitName}</td>
                          <td className="p-2.5 text-center font-bold text-emerald-700">{formatQty(totalRec)} {item.unitName}</td>
                          <td className="p-2.5 text-right font-bold text-rose-600">-{formatQty(diff)} {item.unitName}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-bold text-slate-900 block">
              โปรดเลือกวิธีจัดการเอกสารใบสั่งซื้อ (PO):
            </label>

            <div className="space-y-3">
              {/* Option 1: Adjust PO & Complete */}
              <label
                onClick={() => setUnderReceiveAction('ADJUST_AND_COMPLETE')}
                className={`flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer ${
                  underReceiveAction === 'ADJUST_AND_COMPLETE'
                    ? 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-400/40 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="underReceiveAction"
                  value="ADJUST_AND_COMPLETE"
                  checked={underReceiveAction === 'ADJUST_AND_COMPLETE'}
                  onChange={() => setUnderReceiveAction('ADJUST_AND_COMPLETE')}
                  className="accent-emerald-600 mt-1 h-4 w-4"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-900 text-sm">
                      ปรับยอดในใบ PO ให้เท่ากับจำนวนที่รับจริง & ปิดเอกสารสมบูรณ์ (COMPLETED)
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-300">
                      แนะนำ
                    </span>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    เหมาะสำหรับกรณีที่<b>สินค้ามาส่งแค่นี้และจะไม่มีการส่งเพิ่มอีกแล้ว</b> ระบบจะปรับลดจำนวนสินค้าและคำนวณยอดเงินรวม (Subtotal, VAT, ยอดสุทธิ) ในเอกสาร PO ใหม่โดยอัตโนมัติตามยอดรับจริง <b>เพื่อความถูกต้องในการนำไปจ่ายเงิน/ตัดยอดบัญชี</b>
                  </p>
                </div>
              </label>

              {/* Option 2: Partial & Wait for remaining */}
              <label
                onClick={() => setUnderReceiveAction('PARTIAL')}
                className={`flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer ${
                  underReceiveAction === 'PARTIAL'
                    ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-400/40 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="underReceiveAction"
                  value="PARTIAL"
                  checked={underReceiveAction === 'PARTIAL'}
                  onChange={() => setUnderReceiveAction('PARTIAL')}
                  className="accent-amber-600 mt-1 h-4 w-4"
                />
                <div className="flex-1 space-y-1">
                  <div className="font-bold text-amber-900 text-sm">
                    บันทึกเป็นรับบางส่วน (PARTIALLY_RECEIVED) & รอรับสินค้าส่วนที่เหลือ
                  </div>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    เหมาะสำหรับกรณีที่<b>ผู้จำหน่ายจะนำสินค้าที่ค้างส่งมาส่งเพิ่มในภายหลัง</b> ระบบจะคงยอดจำนวนสั่งซื้อเดิมไว้ และสามารถกลับมาตรวจรับสินค้าส่วนที่เหลือในครั้งต่อไปได้
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 px-8 py-5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
          <Button
            variant="ghost"
            onClick={() => setIsUnderReceiveModalOpen(false)}
            className="text-slate-600 hover:bg-slate-200/60 font-semibold"
          >
            ย้อนกลับไปแก้ไขจำนวน
          </Button>
          <Button
            onClick={() => executeReceivePO(underReceiveAction === 'ADJUST_AND_COMPLETE')}
            className={`text-white font-bold px-7 h-11 shadow-sm text-sm ${
              underReceiveAction === 'ADJUST_AND_COMPLETE'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            <CheckCircle className="w-4 h-4 mr-2" />
            {underReceiveAction === 'ADJUST_AND_COMPLETE'
              ? 'ยืนยันปรับยอด PO และปิดเอกสาร'
              : 'ยืนยันบันทึกรับบางส่วน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
