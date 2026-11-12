'use client';

import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { formatQty, parseQty, useAllowDecimalQty } from '@/lib/qty';
import type { PosController } from '@/lib/pos/use-pos-controller';
import { PaymentModal } from './PaymentModal';
import { ItemEditPopup } from './ItemEditPopup';
import { BillDiscountPopup } from './BillDiscountPopup';
import { OpenShiftModal } from './OpenShiftModal';
import { CloseShiftModal } from './CloseShiftModal';
import { CashDrawerModal } from './CashDrawerModal';
import { HeldBillsSheet } from './HeldBillsSheet';
import { CustomerSelectModal } from './CustomerSelectModal';
import { BarcodeScanModal } from './BarcodeScanModal';
import { OrderHistoryModal } from './OrderHistoryModal';
import { NumpadPopup } from './NumpadPopup';
import { SelectUnitModal } from './SelectUnitModal';
import { RedeemPointsModal } from './RedeemPointsModal';
import { PosDebtSelectModal } from './PosDebtSelectModal';
import { ProductClaimModal } from './ProductClaimModal';
import { ItemClaimModal } from './ItemClaimModal';
import { CustomerClaimStockModal } from './CustomerClaimStockModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';

/** Every dialog of a POS sales screen (same for /pos and /pos-neo). */
export function PosDialogs({ pos }: { pos: PosController }) {
  const { dialogs: d, cart, scanner, variant } = pos;
  const allowDecimalQty = useAllowDecimalQty();

  const closeQtyEdit = () => {
    d.setQtyEditItem(null);
    scanner.focusScanner(20);
  };
  const closePriceEdit = () => {
    d.setPriceEditItem(null);
    scanner.focusScanner(20);
  };

  return (
    <>
      <PaymentModal open={d.showPayment} onOpenChange={d.setShowPayment} initialMethod={d.paymentInitialMethod} />
      <ItemEditPopup open={!!d.editItem} onOpenChange={(open) => !open && d.setEditItem(null)} item={d.editItem} />
      <BillDiscountPopup open={d.showBillDiscount} onOpenChange={d.setShowBillDiscount} />
      <OpenShiftModal open={d.showOpenShift} onOpenChange={d.setShowOpenShift} />
      <CloseShiftModal open={d.showCloseShift} onOpenChange={d.setShowCloseShift} />
      <CashDrawerModal
        open={d.showCashDrawerModal}
        onOpenChange={d.setShowCashDrawerModal}
        onOpenShiftRequired={() => d.setShowOpenShift(true)}
      />
      <HeldBillsSheet open={d.showHeldBills} onOpenChange={d.setShowHeldBills} />
      <CustomerSelectModal open={d.showCustomerSelect} onOpenChange={d.setShowCustomerSelect} />
      <BarcodeScanModal open={d.showBarcodeScan} onOpenChange={d.setShowBarcodeScan} />
      <OrderHistoryModal
        open={d.showOrderHistoryModal}
        onOpenChange={d.setShowOrderHistoryModal}
        onOpenPaymentModal={() => d.setShowPayment(true)}
      />
      <SelectUnitModal
        open={d.showUnitModal}
        onOpenChange={d.setShowUnitModal}
        product={d.unitModalProduct}
        onSelectUnit={(unit) => {
          if (d.unitModalProduct) {
            cart.addItem(d.unitModalProduct, unit);
            toast.success(variant.unitAddedToast(d.unitModalProduct.name, unit.unitName));
          }
        }}
      />
      <RedeemPointsModal open={d.showRedeemModal} onOpenChange={d.setShowRedeemModal} customer={pos.activeCustomer} />
      <PosDebtSelectModal
        open={d.showDebtCollectModal}
        onOpenChange={d.setShowDebtCollectModal}
        targetCustomer={d.debtTargetCustomer}
        cashierName={pos.user?.name || 'พนักงานขาย'}
      />
      <NumpadPopup
        open={!!d.qtyEditItem}
        onOpenChange={(open) => {
          if (!open) closeQtyEdit();
        }}
        title={`ระบุจำนวน: ${d.qtyEditItem?.name || ''}`}
        subtitle="จำนวนสินค้าที่ระบุ"
        initialValue={d.qtyEditItem?.quantity || 1}
        allowDecimals={allowDecimalQty}
        quantityMode
        onConfirm={(val) => {
          if (d.qtyEditItem && val > 0) {
            const qty = parseQty(val, allowDecimalQty);
            cart.updateQuantity(d.qtyEditItem.productId, qty, d.qtyEditItem.unitId);
            toast.success(`อัปเดตจำนวนเป็น ${formatQty(qty)} ${d.qtyEditItem.unitName}`);
          }
          closeQtyEdit();
        }}
      />
      <NumpadPopup
        open={!!d.priceEditItem}
        onOpenChange={(open) => {
          if (!open) closePriceEdit();
        }}
        title={`แก้ไขราคาขาย: ${d.priceEditItem?.name || ''}`}
        subtitle="ระบุราคาขายใหม่ต่อหน่วย (บาท)"
        initialValue={d.priceEditItem ? cart.getEffectivePrice(d.priceEditItem) : 0}
        allowDecimals={true}
        onConfirm={(val) => {
          if (d.priceEditItem && val >= 0) {
            cart.setCustomPrice(d.priceEditItem.productId, val, d.priceEditItem.unitId);
            toast.success(`แก้ไขราคาขาย "${d.priceEditItem.name}" เป็น ${formatCurrency(val)}`);
          }
          closePriceEdit();
        }}
      />
      <ProductClaimModal
        open={d.showClaimModal}
        onOpenChange={d.setShowClaimModal}
        onClaimCompleted={(claim) => {
          d.setCompletedClaimForPdf(claim);
          d.setShowClaimPdfModal(true);
        }}
      />
      <ClaimReceiptPdfModal open={d.showClaimPdfModal} onOpenChange={d.setShowClaimPdfModal} claim={d.completedClaimForPdf} />
      {/* Item Claim Popup (In-Cart Replacement) */}
      <ItemClaimModal
        isOpen={!!d.claimTargetItem}
        onClose={() => d.setClaimTargetItem(null)}
        item={d.claimTargetItem}
        onConfirm={(claimQty, reason, sourceOrderId) => {
          if (d.claimTargetItem) {
            cart.setItemClaim(d.claimTargetItem.productId, claimQty, reason, d.claimTargetItem.unitId, sourceOrderId);
          }
        }}
      />
      {/* Customer Claim Stock & Quota Inventory Modal */}
      <CustomerClaimStockModal
        isOpen={d.showCustomerStockModal}
        onClose={() => d.setShowCustomerStockModal(false)}
        onOpenCustomerSelect={() => d.setShowCustomerSelect(true)}
      />
    </>
  );
}

/** The invisible input that receives hardware-scanner keystrokes (Thai keyboard codes are converted). */
export function PosScannerInput({ pos }: { pos: PosController }) {
  return (
    <input
      {...pos.scanner.scannerInputProps}
      type="text"
      className="sr-only absolute -top-[9999px] -left-[9999px] opacity-0 pointer-events-none w-0 h-0"
      tabIndex={-1}
      aria-hidden="true"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
    />
  );
}
