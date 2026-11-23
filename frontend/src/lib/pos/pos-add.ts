'use client';

/**
 * Every "put this product in the cart" of the POS goes through addToCart (docs/pos-price-level.md):
 * - a product without any price (every level 0) is not added: popup "สินค้านี้ยังไม่ได้ตั้งราคา"; a user allowed
 *   to override prices may type a manual price there (the checkout applies the existing approval rules);
 * - with "เลือกลูกค้าก่อนเริ่มบิลทุกครั้ง" on, the first item of a new bill opens the start-of-bill dialog and waits
 *   there (also later scans made while it is open), then goes in at the chosen customer / level.
 */
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { askConfirm, askReason } from '@/lib/ask-dialog';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCartStore } from '@/lib/store/cart-store';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { DEFAULT_LEVEL_NAMES, levelNames, normalizeLevel, shortLevelName, type PriceLevel } from '@shared/price-level';
import type { Product, ProductUnit } from '@/lib/types';
import { productHasNoPrice } from './price-level';

export interface PendingAdd {
  product: Product;
  unit: ProductUnit;
  /** feedback after it went in (toast, clear the search box) */
  onAdded?: () => void;
}

interface StartState {
  open: boolean;
  pending: PendingAdd[];
}

/** Start-of-bill dialog: open flag and the items waiting for the customer / level choice. */
export const usePosStart = create<StartState>(() => ({ open: false, pending: [] }));

export const startChooserEnabled = () => loadStoreSettings().posAskCustomerAtStart === true;

/** May set prices by hand / sell below the level price without approval (same rule as the checkout). */
export function canOverridePrice(user = useAuthStore.getState().user): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.includes('ALL') || perms.includes('POS_DISCOUNT');
}

/** A walk-in bill may use ราคา 2-5 (setting "ต้องมีสิทธิ์ให้ส่วนลด", default: every cashier). */
export function canUseWalkInLevel(level: number, user = useAuthStore.getState().user): boolean {
  if (normalizeLevel(level) === 1) return true;
  return loadStoreSettings().walkInLevelNeedsDiscount !== true || canOverridePrice(user);
}

export type AddResult = 'added' | 'pending' | 'no-price';

/** Put a product unit in the cart (see the file comment). */
export function addToCart(product: Product, unit?: ProductUnit, opts: { onAdded?: () => void } = {}): AddResult {
  const selected = unit || product.units[0];
  if (!selected) return 'no-price';
  if (productHasNoPrice(product)) {
    void noPricePopup(product, selected, opts.onAdded);
    return 'no-price';
  }
  const start = usePosStart.getState();
  const cart = useCartStore.getState();
  if (start.open || (startChooserEnabled() && cart.items.length === 0 && !cart.levelChosen && !cart.onlineOrderId && !cart.editingOrderId)) {
    usePosStart.setState({ open: true, pending: [...start.pending, { product, unit: selected, onAdded: opts.onAdded }] });
    return 'pending';
  }
  if (!cart.addItem(product, selected)) return 'no-price';
  opts.onAdded?.();
  return 'added';
}

/** The start-of-bill choice was made (customer / level already set): add what was waiting, close. */
export function finishStart() {
  const { pending } = usePosStart.getState();
  usePosStart.setState({ open: false, pending: [] });
  for (const p of pending) {
    if (useCartStore.getState().addItem(p.product, p.unit)) p.onAdded?.();
  }
}

/** Popup for a product without any price; manual price for users allowed to override. */
async function noPricePopup(product: Product, unit: ProductUnit, onAdded?: () => void) {
  const may = canOverridePrice();
  const ok = await askConfirm({
    title: 'สินค้านี้ยังไม่ได้ตั้งราคา',
    description: `${product.name}\nยังไม่ได้ใส่ราคา 1-5 จึงยังไม่ใส่ลงตะกร้า ตั้งราคาได้ที่หน้า รายการสินค้า & ราคา` +
      (may ? '\nหรือกด "ใส่ราคาเอง" เพื่อขายบิลนี้ด้วยราคาที่พิมพ์ (บันทึกเป็นราคาที่แก้เอง)' : ''),
    confirmLabel: may ? 'ใส่ราคาเอง' : 'ตกลง',
    cancelLabel: 'ปิด',
    alertOnly: !may,
    testId: 'no-price-dialog',
  });
  if (!ok || !may) return;
  const raw = await askReason({
    title: `ราคาขาย: ${product.name}`,
    label: `ราคาต่อ ${unit.unitName || 'หน่วย'} (บาท)`,
    placeholder: 'เช่น 25.00',
    confirmLabel: 'ใส่ตะกร้า',
    inputId: 'manual-price-input',
  });
  if (raw === null) return;
  const price = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
    toast.error('ราคาต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
    return;
  }
  if (useCartStore.getState().addItem(product, unit, price)) {
    onAdded?.();
    toast.success(`ใส่ "${product.name}" ราคาที่แก้เอง ฿${price.toFixed(2)}`);
  }
}

// ── level names for the POS (store settings mirror: works offline) ──

const subscribeSettings = (l: () => void) => {
  window.addEventListener('purim:store-settings', l);
  window.addEventListener('storage', l);
  return () => {
    window.removeEventListener('purim:store-settings', l);
    window.removeEventListener('storage', l);
  };
};
let lastKey = '';
let lastNames: Record<PriceLevel, string> = DEFAULT_LEVEL_NAMES;
let lastLevels: PriceLevel[] = [1, 2, 3];
const namesSnapshot = () => {
  const s = loadStoreSettings();
  const key = JSON.stringify([s.levelNames, s.usedLevels]);
  if (key !== lastKey) {
    lastKey = key;
    lastNames = levelNames(s.levelNames);
    lastLevels = (s.usedLevels && s.usedLevels.length ? s.usedLevels : [1, 2, 3]) as PriceLevel[];
  }
  return lastKey;
};

/** Shop names of the price levels + the levels the shop uses (from the store settings mirror). */
export function usePosLevels(): { names: Record<PriceLevel, string>; used: PriceLevel[]; short: (l: number) => string } {
  useSyncExternalStore(subscribeSettings, namesSnapshot, () => '');
  namesSnapshot();
  return { names: lastNames, used: lastLevels, short: (l: number) => shortLevelName(lastNames[normalizeLevel(l)], l) };
}
