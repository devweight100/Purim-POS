import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CheckCircle, Ban, AlertTriangle, RotateCcw, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import type { PurchaseOrder } from './po-shared';
import { poStatusBadge } from './PoStatusBadge';

interface IssueProps {
  isIssueModalOpen: boolean;
  setIsIssueModalOpen: (open: boolean) => void;
  targetIssuePo: PurchaseOrder | null;
  handleConfirmIssue: () => void;
}

/** Confirm DRAFT -> ISSUED. */
export function PoIssueDialog({ isIssueModalOpen, setIsIssueModalOpen, targetIssuePo, handleConfirmIssue }: IssueProps) {
  return (
    <Dialog open={isIssueModalOpen} onOpenChange={setIsIssueModalOpen}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-emerald-600">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            ยืนยันการออกใบสั่งซื้อ (Issue PO)
          </DialogTitle>
        </DialogHeader>
        <div className="py-3 space-y-4 text-sm">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 space-y-2">
            <div className="font-bold text-sm text-emerald-800 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> ใบสั่งซื้อ: {targetIssuePo?.poNumber}
            </div>
            <div className="text-slate-600">
              ผู้จำหน่าย: <b>{targetIssuePo?.supplier?.name || targetIssuePo?.supplierName || '-'}</b>
            </div>
            <div className="text-slate-600">
              ยอดรวมทั้งสิ้น: <b className="text-emerald-700 font-bold text-sm">{formatCurrency(targetIssuePo?.totalAmount || 0)}</b>
            </div>
          </div>
          <p className="text-xs text-slate-600">
            เมื่อออกใบสั่งซื้อแล้ว สถานะจะเปลี่ยนจาก <b>DRAFT</b> เป็น <b>ISSUED</b> เพื่อเตรียมพร้อมส่งเอกสารให้ผู้จำหน่ายและตรวจรับสินค้าเข้าคลัง
          </p>
        </div>
        <DialogFooter className="flex justify-between items-center gap-2 border-t border-slate-100 pt-3">
          <Button variant="ghost" onClick={() => setIsIssueModalOpen(false)} className="text-slate-600 hover:bg-slate-100">
            ยกเลิก
          </Button>
          <Button
            onClick={handleConfirmIssue}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5"
          >
            <CheckCircle className="w-4 h-4 mr-1.5" /> ยืนยันออกใบสั่งซื้อ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StatusChangeProps {
  isStatusChangeModalOpen: boolean;
  setIsStatusChangeModalOpen: (open: boolean) => void;
  targetStatusChangePo: PurchaseOrder | null;
  newSelectedStatus: string;
  setNewSelectedStatus: (s: string) => void;
  statusChangeNote: string;
  setStatusChangeNote: (s: string) => void;
  handleConfirmStatusChange: () => void;
}

/** Change / roll back the status of a purchase order. */
export function PoStatusChangeDialog({
  isStatusChangeModalOpen, setIsStatusChangeModalOpen, targetStatusChangePo, newSelectedStatus, setNewSelectedStatus,
  statusChangeNote, setStatusChangeNote, handleConfirmStatusChange,
}: StatusChangeProps) {
  return (
    <Dialog open={isStatusChangeModalOpen} onOpenChange={setIsStatusChangeModalOpen}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[580px] max-w-[580px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-slate-50/80 shrink-0">
          <DialogTitle className="flex items-center gap-2.5 text-xl font-bold text-indigo-700">
            <RotateCcw className="w-6 h-6 text-indigo-600" />
            เปลี่ยน / ย้อนสถานะใบสั่งซื้อ ({targetStatusChangePo?.poNumber})
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-8 pt-6 pb-12 space-y-6">
          <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500 font-semibold">สถานะปัจจุบันของเอกสาร:</span>
            <span>{targetStatusChangePo && poStatusBadge(targetStatusChangePo.status)}</span>
          </div>

          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-700 block">เลือกสถานะใหม่ที่ต้องการเปลี่ยน / ย้อนกลับ:</label>
            <div className="space-y-2.5 text-xs">
              {[
                {
                  value: 'DRAFT',
                  label: 'DRAFT (ฉบับร่าง)',
                  desc: 'ดึงกลับมาเป็นฉบับร่างเพื่อแก้ไขรายการสินค้าและราคาใหม่',
                  color: 'text-slate-700',
                },
                {
                  value: 'ISSUED',
                  label: 'ISSUED (ออกเอกสารแล้ว)',
                  desc: 'ส่งเอกสารให้ผู้จำหน่ายแล้ว อยู่ในขั้นตอนรอรับสินค้า',
                  color: 'text-sky-700',
                },
                {
                  value: 'PARTIALLY_RECEIVED',
                  label: 'PARTIALLY_RECEIVED (รับบางส่วน)',
                  desc: 'สินค้ามาส่งแล้วบางรายการ/บางจำนวน ยังรับไม่ครบ',
                  color: 'text-amber-700',
                },
                {
                  value: 'COMPLETED',
                  label: 'COMPLETED (รับครบถ้วนสมบูรณ์)',
                  desc: 'สินค้าตรวจรับครบทุกรายการแล้ว และเสร็จสิ้นกระบวนการสั่งซื้อ',
                  color: 'text-emerald-700',
                },
                {
                  value: 'CANCELLED',
                  label: 'CANCELLED (ยกเลิกเอกสาร)',
                  desc: 'ยกเลิกใบสั่งซื้อนี้ ไม่สามารถรับของเข้าคลังได้',
                  color: 'text-rose-700',
                },
              ]
                // Only transitions the backend supports: DRAFT -> ISSUED, and cancel (nothing received / paid)
                .filter((st) => st.value === targetStatusChangePo?.status || st.value === 'CANCELLED' || (st.value === 'ISSUED' && targetStatusChangePo?.status === 'DRAFT'))
                .map((st) => (
                <label
                  key={st.value}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    newSelectedStatus === st.value
                      ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-400 shadow-2xs'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="newSelectedStatus"
                    value={st.value}
                    checked={newSelectedStatus === st.value}
                    onChange={() => setNewSelectedStatus(st.value)}
                    className="accent-indigo-600 mt-0.5"
                  />
                  <div className="flex-1">
                    <div className={`font-bold ${st.color}`}>{st.label}</div>
                    <div className="text-slate-500 text-[11px] mt-0.5">{st.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {(targetStatusChangePo?.status === 'COMPLETED' || targetStatusChangePo?.status === 'PARTIALLY_RECEIVED') && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-xs text-amber-900 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>ใบสั่งซื้อนี้รับสินค้าเข้าคลังแล้ว จึงย้อนสถานะไม่ได้ หากต้องคืนสินค้าให้บริษัท ให้ทำเอกสารที่เมนู “ส่งเคลม &amp; ใบลดหนี้บริษัท”</span>
            </div>
          )}

          <div className="space-y-2 pb-6">
            <label className="text-xs font-bold text-slate-700 block">หมายเหตุ / เหตุผลในการเปลี่ยนสถานะ (ถ้ามี):</label>
            <Input
              placeholder="เช่น ตรวจนับสต็อกใหม่, ผู้จำหน่ายส่งของไม่ถูกต้อง, ลูกค้าเปลี่ยนใจ..."
              value={statusChangeNote}
              onChange={(e) => setStatusChangeNote(e.target.value)}
              className="text-xs bg-white border-slate-300 h-10"
            />
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 px-8 py-5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
          <Button variant="ghost" onClick={() => setIsStatusChangeModalOpen(false)} className="text-slate-600 hover:bg-slate-200/60 font-semibold">
            ยกเลิก
          </Button>
          <Button
            onClick={handleConfirmStatusChange}
            disabled={newSelectedStatus === targetStatusChangePo?.status}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-7 h-11 shadow-sm text-sm"
          >
            <ArrowLeftRight className="w-4 h-4 mr-2" /> ยืนยันการเปลี่ยนสถานะ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CancelProps {
  isCancelModalOpen: boolean;
  setIsCancelModalOpen: (open: boolean) => void;
  targetCancelPo: PurchaseOrder | null;
  cancelReason: string;
  setCancelReason: (s: string) => void;
  cancelCustomReason: string;
  setCancelCustomReason: (s: string) => void;
  handleConfirmCancelPO: () => void;
}

/** Cancel a purchase order with a reason. */
export function PoCancelDialog({
  isCancelModalOpen, setIsCancelModalOpen, targetCancelPo, cancelReason, setCancelReason,
  cancelCustomReason, setCancelCustomReason, handleConfirmCancelPO,
}: CancelProps) {
  return (
    <Dialog open={isCancelModalOpen} onOpenChange={setIsCancelModalOpen}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-rose-600">
            <Ban className="w-5 h-5 text-rose-600" />
            ยกเลิกใบสั่งซื้อ {targetCancelPo?.poNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="py-3 space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-rose-900">
              <AlertTriangle className="w-4 h-4 text-rose-600" /> คำเตือนการยกเลิกเอกสาร
            </div>
            <p>เมื่อยกเลิกแล้ว สถานะเอกสารจะเปลี่ยนเป็น <b>CANCELLED</b> และไม่สามารถนำไปรับสินค้าเข้าคลังได้อีก</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 block">ระบุเหตุผลการยกเลิก:</label>
            <div className="space-y-2 text-xs">
              {[
                'ผู้จำหน่ายแจ้งสินค้าหมด/ยกเลิก',
                'สั่งซื้อซ้ำซ้อน / สั่งผิดรายการ',
                'เปลี่ยนผู้จำหน่ายรายอื่น',
                'ทางร้านขอยกเลิกรายการสั่งซื้อ',
              ].map((reason) => (
                <label key={reason} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="radio"
                    name="cancelReason"
                    value={reason}
                    checked={cancelReason === reason}
                    onChange={() => setCancelReason(reason)}
                    className="accent-rose-600"
                  />
                  <span className="text-slate-800 font-medium">{reason}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="radio"
                  name="cancelReason"
                  value="other"
                  checked={cancelReason === 'other'}
                  onChange={() => setCancelReason('other')}
                  className="accent-rose-600"
                />
                <span className="text-slate-800 font-medium">ระบุเหตุผลอื่นๆ</span>
              </label>
            </div>

            {cancelReason === 'other' && (
              <Input
                placeholder="พิมพ์เหตุผลการยกเลิก..."
                value={cancelCustomReason}
                onChange={(e) => setCancelCustomReason(e.target.value)}
                className="mt-2 text-xs bg-slate-50 border-slate-300"
                autoFocus
              />
            )}
          </div>
        </div>
        <DialogFooter className="flex justify-between items-center gap-2 border-t border-slate-100 pt-3">
          <Button variant="ghost" onClick={() => setIsCancelModalOpen(false)} className="text-slate-600 hover:bg-slate-100">
            ย้อนกลับ
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmCancelPO}
            className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
          >
            <Ban className="w-4 h-4 mr-1.5" /> ยืนยันยกเลิกใบสั่งซื้อ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
