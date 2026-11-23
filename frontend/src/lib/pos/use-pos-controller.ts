'use client';

import { useEffect } from 'react';
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
import { addToCart } from '@/lib/pos/pos-add';

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
    enabled: mounted,
    products,
    blocked: dialogs.scanBlocked,
    onProductAdded: () => filter.setSearchQuery(''),
  });

  usePosKeyboard({ dialogs, selection, scannerInputRef: scanner.scannerInputRef });

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
    addProductFromCard,
  };
}

export type PosController = ReturnType<typeof usePosController>;
