import { useCartStore } from '@/lib/store/cart-store';
import { formatCurrency, formatListDateTime } from '@/lib/utils';
import { billToDeliveryNote } from '@/lib/delivery-note';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PlayCircle, Trash2, Clock, User, ShoppingBag, ClipboardList, Truck } from 'lucide-react';
import { printHeldBillPickingSlip } from '@/lib/pos/picking';
import { openHeldBillDeliveryNote } from '@/lib/pos/delivery-note-actions';
import { addQty, formatQty } from '@/lib/qty';
import { PosOnlineOrders } from '@/components/online-orders/PosOnlineOrders';

interface HeldBillsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HeldBillsSheet({ open, onOpenChange }: HeldBillsSheetProps) {
  const cart = useCartStore();
  const heldBills = cart.heldBills;

  const handleRecall = (id: string) => {
    cart.recallBill(id);
    onOpenChange(false);
  };

  const handleRemove = (id: string) => {
    cart.removeHeldBill(id);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" data-testid="held-bills-sheet" className="w-[min(560px,100vw)] data-[side=right]:w-[min(560px,100vw)] data-[side=right]:sm:max-w-[560px] bg-white border-l border-slate-200 text-slate-900 p-6">
        <SheetHeader className="mb-6 border-b border-slate-200 pb-4">
          <SheetTitle className="text-2xl font-black text-sky-600 flex items-center gap-2">
            <PlayCircle className="w-7 h-7 text-sky-500" />
            <span>รายการบิลที่พักไว้ ({heldBills.length} บิล)</span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto h-[calc(100vh-140px)] no-scrollbar pb-10">
          {open && <PosOnlineOrders onOpened={() => onOpenChange(false)} />}
          {heldBills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 text-slate-400 gap-3">
              <Clock className="w-16 h-16 opacity-30 text-slate-300" />
              <p className="text-base font-semibold">ไม่มีบิลค้างพักไว้ในขณะนี้</p>
            </div>
          ) : (
            heldBills.map((bill) => {
              // the bill's total by the shared pricing rules (same number as its บิลส่งของ and the checkout)
              const total = billToDeliveryNote(bill, { source: 'held' }).total;
              const itemCount = addQty(...bill.items.map((i) => i.quantity));

              return (
                <div key={bill.id} data-testid="held-bill" className="bg-slate-50 border-2 border-slate-200 hover:border-sky-300 rounded-2xl p-4 flex flex-col gap-3 shadow-sm transition-all">
                  <div className="flex justify-between items-start gap-3 border-b border-slate-200 pb-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <h4 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                        <ShoppingBag className="w-5 h-5 text-slate-500 shrink-0" />
                        {bill.label}
                      </h4>
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        พักบิลเมื่อ: {formatListDateTime(bill.heldAt)}
                      </p>

                      {/* Member name */}
                      {bill.customerName ? (
                        <div className="mt-2 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-xl flex items-start gap-2 min-w-0">
                          <User className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                          <span className="min-w-0 text-sm text-sky-900 break-words">
                            <span className="text-xs font-semibold text-sky-700">สมาชิก: </span>
                            <span className="font-bold">{bill.customerName}</span>
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-400 font-medium">
                          ลูกค้า: ทั่วไป (Walk-in)
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-bold text-xl text-slate-900 tabular-nums">{formatCurrency(total)}</p>
                      <span className="text-xs font-medium text-slate-600 mt-1 inline-block">
                        {formatQty(itemCount)} ชิ้น ({bill.items.length} รายการ)
                      </span>
                    </div>
                  </div>

                  <Button
                    className="h-12 text-base font-bold rounded-xl gap-2 bg-sky-500 hover:bg-sky-600 text-white"
                    onClick={() => handleRecall(bill.id)}
                  >
                    <PlayCircle className="w-5 h-5" />
                    เรียกคืนบิลนี้
                  </Button>
                  <div className="flex gap-btn">
                    <Button
                      variant="outline"
                      data-testid="held-delivery-note"
                      className="flex-1 h-11 rounded-xl gap-1.5"
                      onClick={() => void openHeldBillDeliveryNote(bill)}
                      title="พิมพ์บิลส่งของ: รายการ ราคา ยอดที่ต้องเก็บเงิน (ยังไม่ได้ชำระ ไม่ใช่ใบเสร็จ)"
                    >
                      <Truck className="w-5 h-5" />
                      บิลส่งของ
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-11 rounded-xl gap-1.5"
                      onClick={() => void printHeldBillPickingSlip(bill)}
                      title="พิมพ์ใบจัดของของบิลนี้ (ไม่มีราคา)"
                    >
                      <ClipboardList className="w-5 h-5" />
                      ใบจัดของ
                    </Button>
                    <Button
                      variant="outline"
                      className="w-12 h-11 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 hover:border-red-300"
                      onClick={() => handleRemove(bill.id)}
                      title="ลบบิลพักนี้"
                      aria-label="ลบบิลพักนี้"
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
