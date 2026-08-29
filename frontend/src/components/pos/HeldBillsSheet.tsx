import { useCartStore } from '@/lib/store/cart-store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PlayCircle, Trash2, Clock, User, ShoppingBag } from 'lucide-react';

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
      <SheetContent side="right" className="w-[420px] sm:w-[560px] bg-white border-l border-slate-200 text-slate-900 p-6">
        <SheetHeader className="mb-6 border-b border-slate-200 pb-4">
          <SheetTitle className="text-2xl font-black text-sky-600 flex items-center gap-2">
            <PlayCircle className="w-7 h-7 text-sky-500" />
            <span>รายการบิลที่พักไว้ ({heldBills.length} บิล)</span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto h-[calc(100vh-140px)] no-scrollbar pb-10">
          {heldBills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 text-slate-400 gap-3">
              <Clock className="w-16 h-16 opacity-30 text-slate-300" />
              <p className="text-base font-semibold">ไม่มีบิลค้างพักไว้ในขณะนี้</p>
            </div>
          ) : (
            heldBills.map((bill) => {
              // Calculate total for this bill
              const subtotal = bill.items.reduce((sum, item) => {
                const price = item.customPrice ?? item.originalPrice;
                const lineBefore = price * item.quantity;
                let discount = 0;
                if (item.discountType === 'baht') discount = Math.min(item.discountValue, lineBefore);
                if (item.discountType === 'percent') discount = lineBefore * (item.discountValue / 100);
                return sum + Math.max(0, lineBefore - discount);
              }, 0);
              
              let billDiscountAmount = 0;
              if (bill.billDiscountType === 'baht') billDiscountAmount = Math.min(bill.billDiscountValue, subtotal);
              if (bill.billDiscountType === 'percent') billDiscountAmount = subtotal * (bill.billDiscountValue / 100);
              
              const total = subtotal - billDiscountAmount;
              const itemCount = bill.items.reduce((sum, i) => sum + i.quantity, 0);

              return (
                <div key={bill.id} className="bg-slate-50 border-2 border-slate-200 hover:border-sky-300 rounded-2xl p-5 flex flex-col gap-4 shadow-sm transition-all">
                  <div className="flex justify-between items-start border-b border-slate-200 pb-3">
                    <div className="space-y-1">
                      <h4 className="font-extrabold text-slate-900 text-lg sm:text-xl flex items-center gap-2">
                        <ShoppingBag className="w-5 h-5 text-slate-500" />
                        {bill.label}
                      </h4>
                      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        พักบิลเมื่อ: {formatDate(new Date(bill.heldAt))}
                      </p>

                      {/* Prominent Member Customer Name Highlight Badge */}
                      {bill.customerName ? (
                        <div className="mt-2 bg-sky-100/90 border border-sky-300 px-3 py-1.5 rounded-xl flex items-center gap-2 w-fit shadow-xs">
                          <User className="w-4 h-4 text-sky-600 shrink-0" />
                          <span className="text-xs text-sky-800 font-bold">สมาชิก:</span>
                          <span className="text-base sm:text-lg font-black text-sky-900">{bill.customerName}</span>
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-400 font-medium">
                          ลูกค้า: ทั่วไป (Walk-in)
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="font-black text-xl sm:text-2xl text-slate-900 font-mono">{formatCurrency(total)}</p>
                      <span className="text-xs font-bold text-slate-600 bg-slate-200 px-2 py-0.5 rounded-md mt-1 inline-block">
                        {itemCount} ชิ้น ({bill.items.length} รายการ)
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button 
                      variant="outline" 
                      className="flex-1 bg-sky-500 hover:bg-sky-600 border-none text-white h-12 text-base font-extrabold rounded-xl shadow-md gap-2"
                      onClick={() => handleRecall(bill.id)}
                    >
                      <PlayCircle className="w-5 h-5" />
                      เรียกคืนบิลนี้
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-14 h-12 border-slate-300 bg-white text-slate-500 hover:text-red-600 hover:bg-red-50 hover:border-red-300 rounded-xl"
                      onClick={() => handleRemove(bill.id)}
                      title="ลบบิลพักนี้"
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
