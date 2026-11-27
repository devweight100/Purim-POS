'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { sellableProducts, useProductStore } from '@/lib/store/product-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCustomerById } from '@/lib/customer-service';
import { notePosOpened } from '@/lib/pos-data-policy';
import type { Product, ProductUnit } from '@/lib/types';
import type { PosVariant } from './pos-variant';
import { isExactProductCode } from './pos-scan';
import { usePosDialogs } from './use-pos-dialogs';
import { useIsClient, useOpenShiftPrompt, usePosViewMode, useProductAutoRefresh } from './use-pos-session';
import { useTerminalHeartbeat, useTerminalLiveState } from './use-terminal-sync';
import { useProductFilter } from './use-product-filter';
import { useCartSelection } from './use-cart-selection';
import { usePosScanner } from './use-pos-scanner';
import { usePosKeyboard } from './use-pos-keyboard';
import { usePosScanBurst } from './use-pos-scan-burst';
import { currentScanHandler, focusScanBox, setFieldValue } from './scan-burst';
import { addToCart } from '@/lib/pos/pos-add';
import { priceChangeToast } from './cart-catalogue-refresh';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { MEMBER_PICKER_SCAN_EVENT, MEMBER_SEARCH_ID, memberForScan } from './member-scan';
import { loadCustomers } from '@/lib/customer-service';
import { startChooserEnabled } from './pos-add';

/**
 * After the payment dialog closed: back to standby (focus on the scan box) once the dialog's own focus return is
 * done (also after a focus return to the button / field that opened it), unless another dialog opened meanwhile.
 */
function usePaymentClosedStandby(paymentOpen: boolean, openMemberPicker: () => void) {
  const wasOpen = useRef(false);
  /** the payment dialog is closing from the success screen of a sale (PaymentModal onSaleClosed) */
  const saleClosed = useRef(false);
  const openPicker = useEffectEvent(openMemberPicker);
  useEffect(() => {
    if (paymentOpen) {
      wasOpen.current = true;
      saleClosed.current = false;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const afterSale = saleClosed.current;
    saleClosed.current = false;
    // setting "เปิดหน้าเลือกสมาชิกรอไว้หลังรับชำระเงิน" (docs/pos-member-picker.md): the member picker waits instead
    // of the scan box; the picker keeps the focus itself and a product scan closes it (scan not lost)
    if (afterSale && loadStoreSettings().posPickMemberAfterSale === true) {
      const t = setTimeout(() => openPicker(), 0);
      return () => clearTimeout(t);
    }
    const timers = [0, 120, 400, 1500, 3000].map((ms) =>
      setTimeout(() => {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        const a = document.activeElement as HTMLElement | null;
        // later checks only rescue a lost focus (nothing / the hidden receipt print frame)
        if (ms > 1000 && a && a !== document.body && a.tagName !== 'IFRAME') return;
        const inField = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && a.getAttribute('tabindex') !== '-1';
        if (ms > 200 && inField) return; // the cashier already clicked into a field
        focusScanBox();
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [paymentOpen]);
  return () => {
    saleClosed.current = true;
  };
}

/**
 * Everything a POS sales screen does apart from drawing itself: dialogs, product list and search,
 * scanner, keyboard shortcuts, cart selection, shift check and the store-monitor ping.
 */
export function usePosController(variant: PosVariant) {
  const cart = useCartStore();
  const isShiftOpen = useShiftStore((s) => s.isShiftOpen());
  const user = useAuthStore((s) => s.user);
  const { products: allProducts, categories, fetchProducts } = useProductStore();
  // disabled products (ปิดการใช้งาน) are not sold: left out of the grid, the search and the scanner
  const products = sellableProducts(allProducts);

  const mounted = useIsClient();
  const dialogs = usePosDialogs();
  // re-evaluated whenever the server's customer list is refreshed
  const activeCustomer = useCustomerById(cart.customerId);
  const { viewMode, changeViewMode } = usePosViewMode(variant);
  const filter = useProductFilter(products, variant.pageSize);
  const selection = useCartSelection(cart.items, variant);

  // the selected member's level changed on the server (customers page): the open bill follows it
  const memberLevel = activeCustomer && activeCustomer.id === cart.customerId ? activeCustomer.priceLevel : null;
  useEffect(() => {
    if (memberLevel) useCartStore.getState().setMemberLevel(memberLevel);
  }, [memberLevel]);

  // the selected member was renamed on the server: the bill shows the new name
  const memberName = activeCustomer && activeCustomer.id === cart.customerId ? activeCustomer.name : null;
  useEffect(() => {
    if (memberName && activeCustomer) useCartStore.getState().syncCustomerName(activeCustomer.id, memberName);
  }, [memberName, activeCustomer]);

  // a catalogue price changed (back office, another terminal, F5): lines priced by the catalogue follow it with a
  // notice; never while the payment dialog is open (runs when it closes), docs/pos-keys-refresh.md
  const paymentOpen = dialogs.showPayment;
  useEffect(() => {
    if (paymentOpen) return;
    const changes = useCartStore.getState().applyCatalogPrices();
    if (changes.length) toast.info(priceChangeToast(changes), { duration: 6000 });
  }, [allProducts, paymentOpen]);

  useProductAutoRefresh(fetchProducts);
  // POS session: the desktop app counts as a selling device from now on (pos-data-policy.ts)
  useEffect(() => notePosOpened(), []);
  useOpenShiftPrompt(mounted, dialogs.setShowOpenShift);
  useTerminalHeartbeat(user);
  useTerminalLiveState({
    items: cart.items,
    showPayment: dialogs.showPayment,
    showCashDrawer: dialogs.showCashDrawerModal,
    showClaim: dialogs.showCustomerStockModal,
    activeCustomer,
    user,
    idleDescription: variant.idleDescription,
  });

  const scanner = usePosScanner({
    variant,
    products,
    blocked: dialogs.scanBlocked,
    onProductAdded: () => filter.setSearchQuery(''),
  });

  usePosKeyboard({ dialogs, selection, scannerInputRef: scanner.scannerInputRef });

  // a scanner burst anywhere on the page (another field, a dialog, a numpad) -> add-to-cart flow
  // (docs/pos-keyboard-scan.md); the list layout routes it through its own add flow
  usePosScanBurst({
    enabled: mounted,
    onScan: (code) => {
      if (dialogs.showCustomerSelect && memberPickerScan(code)) return;
      (currentScanHandler() ?? scanner.processDetectedScan)(code);
    },
  });

  /**
   * A scan while the member picker is open (docs/pos-member-picker.md). A code that is not a product code goes to
   * the picker (member code / phone -> that member). In the picker opened after a sale, a product code closes the
   * picker ("sell without a member") and goes on to the cart. The picker opened with Ctrl+M stays open
   * (docs/pos-keyboard-scan.md).
   * Returns true when the scan was used up here.
   */
  const memberPickerScan = (raw: string): boolean => {
    // a scanner's first key can come a moment before the rest and stay in the picker's search: rejoin it
    const search = document.getElementById(MEMBER_SEARCH_ID) as HTMLInputElement | null;
    const typed = search?.value || '';
    const joined = typed.length === 1 && !isExactProductCode(products, raw) && isExactProductCode(products, typed + raw);
    const code = joined ? typed + raw : raw;
    if (joined) {
      if (dialogs.customerSelectAuto) closeMemberPicker();
      else if (search) setFieldValue(search, '');
      (currentScanHandler() ?? scanner.processDetectedScan)(code);
      return true;
    }
    // not a product: the picker opened after a sale takes it (member code / phone -> that member, else the code is
    // shown in its search); the Ctrl+M picker only when it is a member's code (other codes go on as before)
    if (!isExactProductCode(products, code) && (dialogs.customerSelectAuto || memberForScan(loadCustomers(), code) || (typed.length === 1 && memberForScan(loadCustomers(), typed + code)))) {
      window.dispatchEvent(new CustomEvent(MEMBER_PICKER_SCAN_EVENT, { detail: code }));
      return true;
    }
    if (dialogs.customerSelectAuto) closeMemberPicker();
    return false;
  };

  /** close the member picker and go back to standby (auto-opened picker: "no member" = the start-of-bill choice too) */
  const closeMemberPicker = () => {
    const auto = dialogs.customerSelectAuto;
    dialogs.setShowCustomerSelect(false);
    const c = useCartStore.getState();
    // with "เลือกลูกค้าก่อนเริ่มบิลทุกครั้ง" on as well: leaving the picker after a sale without a member already is
    // that choice (ลูกค้าทั่วไป ราคาปลีก, the start dialog's own Esc), the start dialog does not ask again
    if (!auto) return; // Ctrl+M: the dialog gives the focus back to where it was (unchanged)
    if (!c.levelChosen && c.items.length === 0 && startChooserEnabled()) c.setWalkInLevel(1);
    [0, 120, 400].forEach((ms) => setTimeout(() => {
      if (!document.querySelector('[role="dialog"], [role="alertdialog"]')) focusScanBox();
    }, ms));
  };

  // standby: when the payment dialog closes (sale done or cancelled) the focus goes back to the scan box,
  // or (setting, after a completed sale) the member picker opens and waits
  const noteSaleClosed = usePaymentClosedStandby(dialogs.showPayment, dialogs.openCustomerSelectAuto);

  /** Click on empty page space puts the focus back on the hidden scanner input. */
  const handleEmptySpaceClick = (e: React.MouseEvent) => {
    if (dialogs.focusClickBlocked) return;
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], dialog, label');
    if (!isInteractive && scanner.scannerInputRef.current) {
      scanner.scannerInputRef.current.focus();
    }
  };

  /** Enter in the search box: an exact SKU / barcode is a scan, otherwise add the first search result. */
  const handleSearchEnter = () => {
    const raw = filter.searchQuery.trim();
    if (!raw) return;
    if (isExactProductCode(products, raw)) {
      scanner.processBarcodeScan(raw);
      filter.setSearchQuery('');
    } else if (filter.filteredProducts.length > 0) {
      const matched = filter.filteredProducts[0];
      addToCart(matched, matched.units[0], { onAdded: () => toast.success(`เพิ่ม ${matched.name} ลงตะกร้าแล้ว`) });
      filter.setSearchQuery('');
    }
  };

  /** A product card (or one of its unit buttons) was clicked. */
  const addProductFromCard = (product: Product, unit: ProductUnit) => {
    addToCart(product, unit, { onAdded: () => toast.success(variant.cardAddedToast(product.name, unit.unitName)) });
  };

  return {
    variant,
    mounted,
    cart,
    isShiftOpen,
    user,
    products,
    categories,
    activeCustomer,
    viewMode,
    changeViewMode,
    dialogs,
    filter,
    selection,
    scanner,
    handleEmptySpaceClick,
    handleSearchEnter,
    /** PaymentModal: a completed sale's success screen is closing */
    noteSaleClosed,
    /** the member picker closed (Esc / ✕ / a member picked) */
    closeMemberPicker,
    addProductFromCard,
  };
}

export type PosController = ReturnType<typeof usePosController>;
