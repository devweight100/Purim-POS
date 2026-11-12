'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '@/lib/store/cart-store';
import type { CartItem, ClaimRecord, Product } from '@/lib/types';
import type { Customer } from '@/lib/customer-service';

const EMPTY_CART_PAY_WARNING = 'ไม่มีสินค้าในตะกร้า ไม่สามารถชำระเงินได้';

/** Open / closed state of every dialog of a POS sales screen, plus the payment openers. */
export function usePosDialogs() {
  const [showPayment, setShowPayment] = useState(false);
  const [paymentInitialMethod, setPaymentInitialMethod] = useState<'SPLIT' | null>(null);
  const [editItem, setEditItem] = useState<CartItem | null>(null);
  const [qtyEditItem, setQtyEditItem] = useState<CartItem | null>(null);
  const [priceEditItem, setPriceEditItem] = useState<CartItem | null>(null);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showHeldBills, setShowHeldBills] = useState(false);
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const [showBarcodeScan, setShowBarcodeScan] = useState(false);
  const [showOrderHistoryModal, setShowOrderHistoryModal] = useState(false);
  const [unitModalProduct, setUnitModalProduct] = useState<Product | null>(null);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [showDebtCollectModal, setShowDebtCollectModal] = useState(false);
  const [debtTargetCustomer, setDebtTargetCustomer] = useState<Customer | null>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showCustomerStockModal, setShowCustomerStockModal] = useState(false);
  const [claimTargetItem, setClaimTargetItem] = useState<CartItem | null>(null);
  const [completedClaimForPdf, setCompletedClaimForPdf] = useState<ClaimRecord | null>(null);
  const [showClaimPdfModal, setShowClaimPdfModal] = useState(false);
  const [showCashDrawerModal, setShowCashDrawerModal] = useState(false);

  /** A scan is ignored while one of these is open. */
  const scanBlocked =
    showPayment || showOpenShift || showCloseShift || !!editItem || showCustomerSelect || showHeldBills;

  /** A click on empty space re-focuses the hidden scanner input unless one of these is open. */
  const focusClickBlocked =
    scanBlocked || !!qtyEditItem || showDebtCollectModal || showCashDrawerModal || showClaimModal ||
    showUnitModal || showRedeemModal || showBarcodeScan;

  /** Page shortcuts are off while any of these is open (the dialog handles its own keys). */
  const keyboardBlocked =
    focusClickBlocked || !!priceEditItem || showOrderHistoryModal || showCustomerStockModal || !!claimTargetItem;

  const openPaymentWith = (method: 'SPLIT' | null) => {
    if (useCartStore.getState().items.length === 0) {
      toast.warning(EMPTY_CART_PAY_WARNING);
      return;
    }
    setPaymentInitialMethod(method);
    setShowPayment(true);
  };

  /**
   * F12: open the payment dialog when the cart has items (silently does nothing otherwise).
   * Not a toggle: in list mode the list layout's own F12 handler calls this too, and a toggle run twice
   * by one key press used to open and immediately close the dialog.
   */
  const openPaymentIfItems = () => {
    if (useCartStore.getState().items.length > 0) {
      setPaymentInitialMethod(null);
      setShowPayment(true);
    }
  };

  const openDebtPay = (customer: Customer | null) => {
    setDebtTargetCustomer(customer);
    setShowDebtCollectModal(true);
  };

  return {
    showPayment, setShowPayment, paymentInitialMethod,
    editItem, setEditItem,
    qtyEditItem, setQtyEditItem,
    priceEditItem, setPriceEditItem,
    showBillDiscount, setShowBillDiscount,
    showOpenShift, setShowOpenShift,
    showCloseShift, setShowCloseShift,
    showHeldBills, setShowHeldBills,
    showCustomerSelect, setShowCustomerSelect,
    showBarcodeScan, setShowBarcodeScan,
    showOrderHistoryModal, setShowOrderHistoryModal,
    unitModalProduct, setUnitModalProduct,
    showUnitModal, setShowUnitModal,
    showRedeemModal, setShowRedeemModal,
    showDebtCollectModal, setShowDebtCollectModal,
    debtTargetCustomer,
    showClaimModal, setShowClaimModal,
    showCustomerStockModal, setShowCustomerStockModal,
    claimTargetItem, setClaimTargetItem,
    completedClaimForPdf, setCompletedClaimForPdf,
    showClaimPdfModal, setShowClaimPdfModal,
    showCashDrawerModal, setShowCashDrawerModal,
    scanBlocked,
    focusClickBlocked,
    keyboardBlocked,
    /** "ชำระเงิน" button: warns when the cart is empty */
    openPayment: () => openPaymentWith(null),
    /** split payment: warns when the cart is empty */
    openSplitPayment: () => openPaymentWith('SPLIT'),
    openPaymentIfItems,
    openDebtPay,
  };
}

export type PosDialogs = ReturnType<typeof usePosDialogs>;
