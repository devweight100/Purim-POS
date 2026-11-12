'use client';

import { ShoppingCart, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import { formatQty } from '@/lib/qty';
import { CLASSIC_POS } from '@/lib/pos/pos-variant';
import { usePosController } from '@/lib/pos/use-pos-controller';
import { PosDialogs } from '@/components/pos/PosDialogs';
import { PosListLayout } from '@/components/pos/PosListLayout';
import { ClassicProductPanel } from '@/components/pos/classic/ClassicProductPanel';
import { ClassicCartPanel } from '@/components/pos/classic/ClassicCartPanel';

export default function POSPage() {
  const pos = usePosController(CLASSIC_POS);
  const { cart, dialogs: d } = pos;

  if (!pos.mounted) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-slate-100 p-6 text-slate-800">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-2xl shadow-lg mb-3 animate-pulse">
          P
        </div>
        <h2 className="text-lg font-black text-slate-900">กำลังเปิดระบบขายหน้าร้าน (POS)...</h2>
        <p className="text-xs text-slate-500 mt-1">กำลังเตรียมข้อมูลสินค้าและระบบขาย</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 pb-20 lg:pb-0 text-slate-900 lg:h-screen lg:overflow-hidden" onClick={pos.handleEmptySpaceClick}>
      <a href="#pos-cart" className="lg:hidden fixed bottom-3 left-3 right-3 z-40 rounded-xl bg-sky-700 px-4 py-3 text-center font-bold text-white shadow-lg">ดูตะกร้า / ชำระเงิน</a>

      {/* --- MAIN CONTENT --- */}
      {pos.viewMode === 'list_view' ? (
        <PosListLayout
          viewMode={pos.viewMode}
          onViewModeChange={pos.changeViewMode}
          onOpenPayment={d.togglePayment}
          onOpenSplitPayment={d.openSplitPayment}
          onOpenBillDiscount={() => d.setShowBillDiscount((prev) => !prev)}
          onEditItem={(item) => d.setEditItem(item)}
          onSelectCustomer={() => d.setShowCustomerSelect((prev) => !prev)}
          onOpenHoldBills={() => d.setShowHeldBills((prev) => !prev)}
          onOpenHistory={() => d.setShowOrderHistoryModal((prev) => !prev)}
          onOpenBarcodeScan={() => d.setShowBarcodeScan((prev) => !prev)}
          onOpenDebtPay={(cust) => d.openDebtPay(cust || pos.activeCustomer)}
          onOpenNumpadQty={(item) => d.setQtyEditItem(item)}
          onOpenCashDrawer={() => d.setShowCashDrawerModal(true)}
          shiftOpen={pos.isShiftOpen}
          onOpenShift={() => d.setShowOpenShift(true)}
          onCloseShift={() => d.setShowCloseShift(true)}
          onOpenCustomerStock={() => d.setShowCustomerStockModal(true)}
          onOpenItemClaim={(item) => d.setClaimTargetItem(item)}
          selectedCartIndex={pos.selection.selectedIndex}
          onSelectCartIndex={pos.selection.setSelectedIndex}
        />
      ) : (
        <div className="flex flex-1 flex-col overflow-visible lg:flex-row lg:overflow-hidden">
          <ClassicProductPanel pos={pos} />
          <ClassicCartPanel pos={pos} />
        </div>
      )}

      {/* Mobile Sticky Bottom Summary Bar (< lg) */}
      {cart.items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-bold">ตะกร้า ({formatQty(cart.getItemCount())} ชิ้น)</span>
            <span className="text-xl font-black text-primary font-mono">{formatCurrency(cart.getTotal())}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth' })}
              className="h-11 px-3 text-xs font-bold rounded-xl border-slate-300 text-slate-700"
            >
              <ShoppingCart className="w-4 h-4 mr-1" />
              ดูตะกร้า
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={d.openPayment}
              className="h-11 px-5 text-sm font-black rounded-xl bg-primary hover:bg-primary/90 text-white shadow-md flex items-center gap-1.5"
            >
              <CreditCard className="w-4 h-4" />
              ชำระเงิน
            </Button>
          </div>
        </div>
      )}

      <PosDialogs pos={pos} />
    </div>
  );
}
