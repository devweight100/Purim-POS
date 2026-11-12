import { formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Ban, CreditCard, CheckCircle2, FileText, Edit3, RotateCcw } from "lucide-react";
import type { OrderRow } from "./order-shared";

interface Props {
  isEditPaymentOpen: boolean;
  setIsEditPaymentOpen: (open: boolean) => void;
  editPaymentOrder: OrderRow | null;
  newPaymentMethod: string;
  setNewPaymentMethod: (m: string) => void;
  handleConfirmEditPayment: () => void;
  isEditNoteOpen: boolean;
  setIsEditNoteOpen: (open: boolean) => void;
  newNoteValue: string;
  setNewNoteValue: (v: string) => void;
  handleConfirmEditNote: () => void;
  isEditItemsOpen: boolean;
  setIsEditItemsOpen: (open: boolean) => void;
  editItemsTarget: OrderRow | null;
  handleConfirmEditItems: () => void;
  isRepeatOrderOpen: boolean;
  setIsRepeatOrderOpen: (open: boolean) => void;
  repeatOrderTarget: OrderRow | null;
  handleConfirmRepeatOrder: () => void;
  isVoidOpen: boolean;
  setIsVoidOpen: (open: boolean) => void;
  voidReason: string;
  setVoidReason: (v: string) => void;
  handleConfirmVoid: () => void;
}

/** Confirmation dialogs of the order actions: payment method, note, edit in POS, repeat, void. */
export function OrderActionDialogs({
  isEditPaymentOpen, setIsEditPaymentOpen, editPaymentOrder, newPaymentMethod, setNewPaymentMethod, handleConfirmEditPayment,
  isEditNoteOpen, setIsEditNoteOpen, newNoteValue, setNewNoteValue, handleConfirmEditNote,
  isEditItemsOpen, setIsEditItemsOpen, editItemsTarget, handleConfirmEditItems,
  isRepeatOrderOpen, setIsRepeatOrderOpen, repeatOrderTarget, handleConfirmRepeatOrder,
  isVoidOpen, setIsVoidOpen, voidReason, setVoidReason, handleConfirmVoid,
}: Props) {
  return (
    <>
      {/* 6. Edit Payment Method Modal */}
      <Dialog open={isEditPaymentOpen} onOpenChange={setIsEditPaymentOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <CreditCard className="w-5 h-5 text-indigo-600" />
              <span>เปลี่ยนช่องทางการชำระเงิน</span>
            </DialogTitle>
          </DialogHeader>

          {editPaymentOrder && (
            <div className="space-y-4 py-2 text-xs">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 flex justify-between">
                <div>
                  <span className="text-slate-500 block">เลขออเดอร์</span>
                  <span className="font-bold text-slate-900 font-mono">{editPaymentOrder.orderNumber}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block">ยอดรวมทั้งสิ้น</span>
                  <span className="font-black text-indigo-700 font-mono text-sm">
                    {formatCurrency(editPaymentOrder.totalAmount || editPaymentOrder.total || 0)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="font-bold text-slate-700 block">เลือกช่องทางการชำระเงินใหม่:</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "CASH", label: "💵 เงินสด (Cash)" },
                    { id: "QR_PROMPTPAY", label: "📱 QR พร้อมเพย์" },
                    { id: "TRANSFER", label: "🏦 โอนเงินผ่านธนาคาร" },
                    { id: "CREDIT_CARD", label: "💳 บัตรเครดิต" },
                  ].map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setNewPaymentMethod(method.id)}
                      className={`p-3 rounded-2xl border text-xs font-bold transition-all text-left flex items-center justify-between ${
                        newPaymentMethod === method.id
                          ? "border-indigo-600 bg-indigo-50 text-indigo-900 shadow-xs"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <span>{method.label}</span>
                      {newPaymentMethod === method.id && <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsEditPaymentOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmEditPayment} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 rounded-xl shadow-xs">
              บันทึกการเปลี่ยนแปลง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 7. Edit Note Dialog */}
      <Dialog open={isEditNoteOpen} onOpenChange={setIsEditNoteOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <FileText className="w-5 h-5 text-amber-600" />
              <span>แก้ไขหมายเหตุ / โน้ตบิล</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <label className="font-bold text-slate-700 block">ระบุข้อความหมายเหตุบิล:</label>
            <textarea
              value={newNoteValue}
              onChange={(e) => setNewNoteValue(e.target.value)}
              placeholder="พิมพ์หมายเหตุท้ายบิล เช่น ที่อยู่ส่งของ, โครงการ..."
              rows={3}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 outline-none focus:bg-white focus:border-indigo-500 shadow-inner"
            />
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsEditNoteOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmEditNote} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-5 rounded-xl shadow-xs">
              บันทึกหมายเหตุ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 8. Edit Items & Re-checkout Confirmation Dialog */}
      <Dialog open={isEditItemsOpen} onOpenChange={setIsEditItemsOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <Edit3 className="w-5 h-5 text-sky-600" />
              <span>ดึงบิลไปแก้ไขในหน้าขาย (POS)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-xs text-slate-600 space-y-2">
            <p>
              ระบบจะทำการล้างตะกร้าปัจจุบัน และนำรายการสินค้าของบิล{" "}
              <b className="font-mono text-slate-900">{editItemsTarget?.orderNumber}</b> ไปเปิดในหน้าขาย
            </p>
            <p className="bg-sky-50 text-sky-900 p-3 rounded-xl border border-sky-200 leading-relaxed font-semibold">
              💡 คุณสามารถเพิ่ม/ลดจำนวน ปรับส่วนลด และเมื่อกดชำระเงิน ระบบจะบันทึกทับบิลเดิมให้อัตโนมัติ
            </p>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsEditItemsOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmEditItems} className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-5 rounded-xl shadow-xs">
              ไปหน้าขายทันที
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 9. Repeat Order Confirmation Dialog */}
      <Dialog open={isRepeatOrderOpen} onOpenChange={setIsRepeatOrderOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <RotateCcw className="w-5 h-5 text-indigo-600" />
              <span>สั่งซื้อซ้ำ (Repeat Order)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-xs text-slate-600 space-y-2">
            <p>
              คุณต้องการคัดลอกรายการสินค้าจากบิล{" "}
              <b className="font-mono text-slate-900">{repeatOrderTarget?.orderNumber}</b> ลงในตะกร้าหน้าขายเพื่อเปิดบิลใหม่ใช่หรือไม่?
            </p>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsRepeatOrderOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmRepeatOrder} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 rounded-xl shadow-xs">
              คัดลอกลงตะกร้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 10. Void Order Dialog */}
      <Dialog open={isVoidOpen} onOpenChange={setIsVoidOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-rose-600 flex items-center gap-2 text-lg font-bold">
              <Ban className="w-5 h-5" />
              <span>ยืนยันการยกเลิกบิล (Void Order)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-3 text-xs">
            <p className="text-slate-600 leading-relaxed">
              การยกเลิกบิลจะทำการคืนสต็อกสินค้าเข้าสู่ระบบอัตโนมัติ และออเดอร์นี้จะไม่ถูกนำไปคิดรวมในยอดขายสุทธิ
            </p>
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 block">ระบุเหตุผลที่ยกเลิก *</label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="เช่น ลูกค้าขอคืนสินค้า, คีย์รายการผิดพลาด..."
                className="bg-white border-slate-300 h-10 text-slate-900 text-xs rounded-xl shadow-inner"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsVoidOpen(false)} className="text-slate-600">
              ย้อนกลับ
            </Button>
            <Button onClick={handleConfirmVoid} className="bg-rose-600 hover:bg-rose-700 text-white font-bold h-10 px-5 rounded-xl shadow-sm">
              ยืนยันยกเลิกบิล
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
