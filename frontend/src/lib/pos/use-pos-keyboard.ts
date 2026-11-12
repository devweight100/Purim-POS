'use client';

import { useEffect, useEffectEvent, type RefObject } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '@/lib/store/cart-store';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';
import { canUseCartCharShortcut, msSincePreviousPrintableKey } from '@/lib/use-scanner';
import { addQty, subQty } from '@/lib/qty';
import type { CartItem } from '@/lib/types';
import type { PosDialogs } from './use-pos-dialogs';
import type { CartSelection } from './use-cart-selection';

const EMPTY_CART_WARNING = 'ยังไม่มีสินค้าในตะกร้า';

/** Hold the current bill, or (empty cart) toggle the held-bills sheet. Used by F10 and Ctrl+P. */
export function holdBillOrToggleHeld(setShowHeldBills: (update: (prev: boolean) => boolean) => void) {
  const cart = useCartStore.getState();
  if (cart.items.length > 0) {
    cart.holdBill();
    toast.success(`📌 พักบิลเรียบร้อยแล้ว (มีบิลพักค้างไว้ ${useCartStore.getState().heldBills.length} ใบ)`);
  } else {
    setShowHeldBills((prev) => !prev);
  }
}

interface PosKeyboardOptions {
  dialogs: PosDialogs;
  selection: CartSelection;
  scannerInputRef: RefObject<HTMLInputElement | null>;
}

function keyIs(e: KeyboardEvent, code: string, key: string) {
  return e.code === code || (e.key ? e.key.toLowerCase() : '') === key;
}

/**
 * Page shortcuts of the POS screens:
 * F2 quantity, F3 item discount (empty cart: left to the global document search), F4 price,
 * arrows select a row, Delete removes it, +/- change its quantity, F9 cash drawer,
 * F10 / Ctrl+P / Ctrl+Shift+P hold bill or held bills, F12 payment, Ctrl+H history,
 * Ctrl+M member, Ctrl+E clear cart.
 *
 * The listener is registered once; useEffectEvent gives it the current dialogs and selection on every
 * key press, so it can never act on a stale cart row or a stale "dialog open" flag.
 */
export function usePosKeyboard({ dialogs, selection, scannerInputRef }: PosKeyboardOptions) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const activeEl = document.activeElement as HTMLElement | null;
    // Track key timing for every key so scanner bursts are recognised
    const sincePrevKey = msSincePreviousPrintableKey(e);

    // Is the focused element the background scanner input (tabindex=-1 or sr-only)?
    const isHiddenScanner = !!activeEl && (
      activeEl === scannerInputRef.current ||
      activeEl.classList?.contains('sr-only') ||
      activeEl.getAttribute('tabindex') === '-1' ||
      activeEl.getAttribute('aria-hidden') === 'true'
    );
    // Inside a real editable text field (search bar, note input, etc.)
    const isRealTextInput = !isHiddenScanner && !!activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
    // Actively searching/typing = focused on an input that holds text
    const isSearching = isRealTextInput &&
      (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) &&
      activeEl.value.trim().length > 0;

    // A dialog is open: let it handle its own keys
    if (dialogs.keyboardBlocked || useDocumentSearchStore.getState().isOpen) return;

    const items = useCartStore.getState().items;
    const selectedItem = (): CartItem | undefined =>
      items[Math.min(items.length - 1, Math.max(0, selection.selectedIndex))];
    const charShortcutAllowed = () =>
      canUseCartCharShortcut(activeEl, isHiddenScanner ? (activeEl as HTMLInputElement) : scannerInputRef.current, sincePrevKey);

    if (keyIs(e, 'F2', 'f2')) {
      e.preventDefault();
      if (items.length === 0) {
        toast.warning(EMPTY_CART_WARNING);
        return;
      }
      dialogs.setQtyEditItem(selectedItem() ?? null);
    } else if (keyIs(e, 'F3', 'f3')) {
      // F3 has one owner: with items in the cart it is the item discount popup (preventDefault tells the
      // global document search to ignore it); with an empty cart it is left to the global document search.
      if (items.length === 0) return;
      e.preventDefault();
      dialogs.setEditItem(selectedItem() ?? null);
    } else if (keyIs(e, 'F4', 'f4')) {
      e.preventDefault();
      if (items.length === 0) {
        toast.warning(EMPTY_CART_WARNING);
        return;
      }
      dialogs.setPriceEditItem(selectedItem() ?? null);
    } else if ((keyIs(e, 'ArrowDown', 'arrowdown') || keyIs(e, 'ArrowUp', 'arrowup')) && !isSearching) {
      // only when NOT typing a search query
      if (items.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        selection.moveSelection(keyIs(e, 'ArrowDown', 'arrowdown') ? 1 : -1);
      }
    } else if (keyIs(e, 'Delete', 'delete') && !isRealTextInput) {
      const target = selectedItem();
      if (target) {
        e.preventDefault();
        useCartStore.getState().removeItem(target.productId, target.unitId);
        toast.info(`ลบ "${target.name}" ออกจากตะกร้าแล้ว`);
      }
    } else if (keyIs(e, 'NumpadAdd', '+') && charShortcutAllowed()) {
      const target = selectedItem();
      if (target) {
        e.preventDefault();
        useCartStore.getState().updateQuantity(target.productId, addQty(target.quantity, 1), target.unitId);
      }
    } else if (keyIs(e, 'NumpadSubtract', '-') && charShortcutAllowed()) {
      const target = selectedItem();
      if (target) {
        e.preventDefault();
        useCartStore.getState().updateQuantity(target.productId, subQty(target.quantity, 1), target.unitId);
      }
    } else if (keyIs(e, 'F9', 'f9')) {
      e.preventDefault();
      dialogs.setShowCashDrawerModal((prev) => !prev);
    } else if (keyIs(e, 'F10', 'f10') || (e.ctrlKey && keyIs(e, 'KeyP', 'p'))) {
      // F10, Ctrl+P and Ctrl+Shift+P
      e.preventDefault();
      holdBillOrToggleHeld(dialogs.setShowHeldBills);
    } else if (keyIs(e, 'F12', 'f12')) {
      e.preventDefault();
      dialogs.openPaymentIfItems();
    } else if (e.ctrlKey && keyIs(e, 'KeyH', 'h')) {
      e.preventDefault();
      dialogs.setShowOrderHistoryModal((prev) => !prev);
    } else if (e.ctrlKey && keyIs(e, 'KeyM', 'm')) {
      e.preventDefault();
      dialogs.setShowCustomerSelect((prev) => !prev);
    } else if (e.ctrlKey && keyIs(e, 'KeyE', 'e')) {
      e.preventDefault();
      useCartStore.getState().clearCart();
    }
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => onKeyDown(e);
    // Registered on document (bubble phase) so it always runs before window-level listeners such as the
    // global F3 document search, which checks e.defaultPrevented.
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
