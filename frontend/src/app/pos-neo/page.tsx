'use client';

import { CreditCard } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { NEO_POS } from '@/lib/pos/pos-variant';
import { usePosController } from '@/lib/pos/use-pos-controller';
import { PosDialogs, PosScannerInput } from '@/components/pos/PosDialogs';
import { PosNeoListLayout } from '@/components/pos/PosNeoListLayout';
import { NeoHeader } from '@/components/pos/neo/NeoHeader';
import { NeoProductPanel } from '@/components/pos/neo/NeoProductPanel';
import { NeoCartPanel } from '@/components/pos/neo/NeoCartPanel';

export default function PosNeoPage() {
  const pos = usePosController(NEO_POS);
  const { cart, dialogs: d } = pos;

  if (!pos.mounted) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[#F5EFEB] p-6 text-black">
        <div className="w-16 h-16 rounded-2xl bg-[#FF6B00] border-2 border-black text-black flex items-center justify-center font-black text-3xl shadow-[4px_4px_0px_#000] mb-4 animate-bounce">
          ⚡
        </div>
        <h2 className="text-xl font-black text-black">กำลังเปิด PURIM POS (Neo-Brutalist Edition)...</h2>
        <p className="text-xs font-bold text-neutral-600 mt-1">กำลังโหลดแคตตาล็อกสินค้าและระบบคำนวณราคา</p>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-dvh flex-col bg-[#F5EFEB] pb-24 lg:pb-0 text-black lg:h-screen lg:overflow-hidden select-none font-sans"
      onClick={pos.handleEmptySpaceClick}
    >
      {/* Hidden Scanner Input */}
      <PosScannerInput pos={pos} />

      <NeoHeader pos={pos} />

      {/* MAIN CONTENT */}
      {pos.viewMode === 'list_view' ? (
        <PosNeoListLayout
          viewMode={pos.viewMode}
          onViewModeChange={pos.changeViewMode}
          onOpenPayment={d.openPayment}
          onOpenSplitPayment={d.openSplitPayment}
          onOpenBillDiscount={() => d.setShowBillDiscount(true)}
          onEditItem={(item) => d.setEditItem(item)}
          onOpenNumpadQty={(item) => d.setQtyEditItem(item)}
          onSelectCustomer={() => d.setShowCustomerSelect(true)}
          onOpenHoldBills={() => d.setShowHeldBills(true)}
          onOpenHistory={() => d.setShowOrderHistoryModal(true)}
          onOpenBarcodeScan={() => d.setShowBarcodeScan(true)}
          onOpenDebtPay={(cust) => d.openDebtPay(cust || pos.activeCustomer)}
          onOpenCashDrawer={() => d.setShowCashDrawerModal(true)}
          onOpenCustomerStock={() => d.setShowCustomerStockModal(true)}
          onOpenItemClaim={(item) => d.setClaimTargetItem(item)}
          selectedCartIndex={pos.selection.selectedIndex}
          onSelectCartIndex={pos.selection.setSelectedIndex}
        />
      ) : (
        <div className="flex flex-1 flex-col overflow-visible lg:flex-row lg:overflow-hidden p-2 sm:p-3 gap-3">
          <NeoProductPanel pos={pos} />
          <NeoCartPanel pos={pos} />
        </div>
      )}

      {/* Floating Bottom Bar for Mobile Screen (< lg) */}
      {cart.items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden border-t-2 border-black bg-white p-3 shadow-[0_-3px_0px_#000] flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-neutral-600">ตะกร้า ({cart.getItemCount()} ชิ้น)</span>
            <span className="text-xl font-black font-mono text-black">{formatCurrency(cart.getTotal())}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth' })}
              className="rounded-xl border-2 border-black bg-white px-3 py-2 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              ดูบิล
            </button>
            <button
              type="button"
              onClick={d.openPayment}
              className="rounded-xl border-2 border-black bg-[#FF6B00] px-5 py-2 text-sm font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1"
            >
              <CreditCard className="w-4 h-4" />
              <span>ชำระเงิน</span>
            </button>
          </div>
        </div>
      )}

      <PosDialogs pos={pos} />
    </div>
  );
}
