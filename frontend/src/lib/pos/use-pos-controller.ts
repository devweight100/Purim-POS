'use client';

import { toast } from 'sonner';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { useProductStore } from '@/lib/store/product-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCustomerById } from '@/lib/customer-service';
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

/**
 * Everything a POS sales screen does apart from drawing itself: dialogs, product list and search,
 * scanner, keyboard shortcuts, cart selection, shift check and the store-monitor ping.
 * /pos and /pos-neo both use it; only their layout differs.
 */
export function usePosController(variant: PosVariant) {
  const cart = useCartStore();
  const isShiftOpen = useShiftStore((s) => s.isShiftOpen());
  const user = useAuthStore((s) => s.user);
  const { products, categories, fetchProducts } = useProductStore();

  const mounted = useIsClient();
  const dialogs = usePosDialogs();
  // re-evaluated whenever the server's customer list is refreshed
  const activeCustomer = useCustomerById(cart.customerId);
  const { viewMode, changeViewMode } = usePosViewMode(variant);
  const filter = useProductFilter(products, variant.pageSize);
  const selection = useCartSelection(cart.items, variant);

  useProductAutoRefresh(fetchProducts);
  useOpenShiftPrompt(mounted, dialogs.setShowOpenShift);
  useTerminalHeartbeat(user);
  useTerminalLiveState({
    items: cart.items,
    showPayment: dialogs.showPayment,
    showCashDrawer: dialogs.showCashDrawerModal,
    showClaim: dialogs.showClaimModal || dialogs.showCustomerStockModal,
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
      cart.addItem(matched, matched.units[0]);
      filter.setSearchQuery('');
      toast.success(`เพิ่ม ${matched.name} ลงตะกร้าแล้ว`);
    }
  };

  /** A product card (or one of its unit buttons) was clicked. */
  const addProductFromCard = (product: Product, unit: ProductUnit) => {
    cart.addItem(product, unit);
    toast.success(variant.cardAddedToast(product.name, unit.unitName));
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
