import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { CartItem, HeldBill, Product, ProductUnit, ClaimRecord, PendingClaimItem } from '../types';
import { calculateSmartRollupAndPricing } from '../cart-pricing';
import { loadStoreSettings } from '../store-settings-storage';
import { addQty, mulQty, roundQty, subQty } from '../qty';

/** Money to the satang (line totals with decimal quantities, e.g. 2.33 m x 15.50 = 36.12). */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface CartStore {
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  billDiscountType: 'none' | 'baht' | 'percent';
  billDiscountValue: number;
  pointsDiscountValue: number;
  pointsUsed: number;
  attachedClaim: ClaimRecord | null;
  pendingClaims: PendingClaimItem[];
  note: string;
  isVatEnabled: boolean;
  heldBills: HeldBill[];
  editingOrderId: string | null;

  // Actions
  addItem: (product: Product, unit?: ProductUnit) => void;
  removeItem: (productId: string, unitId?: string) => void;
  updateQuantity: (productId: string, quantity: number, unitId?: string) => void;
  setCustomPrice: (productId: string, price: number | null, unitId?: string) => void;
  setItemDiscount: (productId: string, type: 'none' | 'baht' | 'percent', value: number, unitId?: string) => void;
  setItemClaim: (productId: string, claimQty: number, reason?: string, unitId?: string, sourceOrderId?: string) => void;
  setItemNote: (productId: string, note: string, unitId?: string) => void;
  setItemUnit: (productId: string, unit: ProductUnit) => void;
  setBillDiscount: (type: 'none' | 'baht' | 'percent', value: number) => void;
  setPointsDiscount: (discountBaht: number, pointsUsed: number) => void;
  clearPointsDiscount: () => void;
  setAttachedClaim: (claim: ClaimRecord | null) => void;
  clearAttachedClaim: () => void;
  addPendingClaim: (claim: PendingClaimItem) => void;
  removePendingClaim: (id: string) => void;
  clearPendingClaims: () => void;
  setNote: (note: string) => void;
  setVatEnabled: (enabled: boolean) => void;
  setCustomer: (id: string | null, name: string | null) => void;
  setEditingOrderId: (id: string | null) => void;
  clearCart: () => void;
  holdBill: (label?: string) => void;
  recallBill: (id: string) => void;
  removeHeldBill: (id: string) => void;

  // Computed helpers
  getEffectivePrice: (item: CartItem) => number;
  getItemDiscountAmount: (item: CartItem) => number;
  getItemLineTotal: (item: CartItem) => number;
  getSubtotal: () => number;
  getBillDiscountAmount: () => number;
  getPointsDiscountAmount: () => number;
  getClaimDiscountAmount: () => number;
  getVatAmount: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

/**
 * Discount rules shared by every discount input (item popup, numpad, bill discount):
 * percent within 0-100, baht between 0 and the line/bill amount. Returns a Thai message or null when valid.
 */
export function validateDiscount(type: 'none' | 'baht' | 'percent', value: number, maxBaht: number): string | null {
  if (type === 'none') return null;
  if (!Number.isFinite(value) || value < 0) return 'ส่วนลดต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป';
  if (type === 'percent' && value > 100) return 'ส่วนลดเปอร์เซ็นต์ต้องอยู่ระหว่าง 0 - 100%';
  if (type === 'baht' && value > maxBaht + 1e-9) return `ส่วนลดต้องไม่เกินยอด ${maxBaht.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
  return null;
}

/** Last line of defence for stored discounts: never negative, percent never above 100. */
const clampDiscountValue = (type: 'none' | 'baht' | 'percent', value: number) => {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  return type === 'percent' ? Math.min(100, v) : v;
};

/** localStorage key of the persisted cart (per device / browser profile). */
export const CART_STORAGE_KEY = 'purim-pos-cart';
const CART_STORAGE_VERSION = 1;

type PersistedCart = Pick<CartStore,
  'items' | 'customerId' | 'customerName' | 'billDiscountType' | 'billDiscountValue' | 'pointsDiscountValue' |
  'pointsUsed' | 'attachedClaim' | 'pendingClaims' | 'note' | 'heldBills' | 'editingOrderId'>;

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const discType = (v: unknown): 'none' | 'baht' | 'percent' => (v === 'baht' || v === 'percent' ? v : 'none');
const isCartItem = (i: unknown): i is CartItem => {
  const it = i as CartItem;
  return !!it && typeof it === 'object' && typeof it.productId === 'string' && typeof it.name === 'string' &&
    Number.isFinite(Number(it.quantity)) && Number(it.quantity) > 0 && Number.isFinite(Number(it.originalPrice));
};

/** Defensive restore: anything malformed (old schema, manual edits, partial writes) is dropped, never crashes the POS. */
export function sanitizePersistedCart(raw: unknown): Partial<PersistedCart> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items.filter(isCartItem) : [];
  const heldBills = Array.isArray(r.heldBills)
    ? (r.heldBills as HeldBill[]).filter((b) => b && typeof b === 'object' && typeof b.id === 'string' && Array.isArray(b.items))
        .map((b) => ({ ...b, items: b.items.filter(isCartItem) }))
        .filter((b) => b.items.length > 0)
    : [];
  return {
    items,
    customerId: typeof r.customerId === 'string' ? r.customerId : null,
    customerName: typeof r.customerName === 'string' ? r.customerName : null,
    billDiscountType: discType(r.billDiscountType),
    billDiscountValue: num(r.billDiscountValue),
    pointsDiscountValue: num(r.pointsDiscountValue),
    pointsUsed: num(r.pointsUsed),
    attachedClaim: r.attachedClaim && typeof r.attachedClaim === 'object' ? (r.attachedClaim as ClaimRecord) : null,
    pendingClaims: Array.isArray(r.pendingClaims) ? (r.pendingClaims as PendingClaimItem[]) : [],
    note: typeof r.note === 'string' ? r.note : '',
    heldBills,
    editingOrderId: typeof r.editingOrderId === 'string' ? r.editingOrderId : null,
  };
}

// The cart and held (parked) bills are persisted on this device so a reload, crash or app restart does not
// lose them. Checkout calls clearCart(), which also clears the persisted cart (held bills stay).
export const useCartStore = create<CartStore>()(persist((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  billDiscountType: 'none' as const,
  billDiscountValue: 0,
  pointsDiscountValue: 0,
  pointsUsed: 0,
  attachedClaim: null,
  pendingClaims: [],
  note: '',
  // VAT on sales is a store-wide setting (Settings > ข้อมูลร้าน), not a per-terminal toggle
  isVatEnabled: loadStoreSettings().vatEnabled === true,
  heldBills: [],
  editingOrderId: null,

  setEditingOrderId: (id: string | null) => {
    set({ editingOrderId: id });
  },

  addItem: (product: Product, unit?: ProductUnit) => {
    const selectedUnit = unit || product.units[0];
    if (!selectedUnit) return;

    set((state) => {
      const existing = state.items.find(
        (i) => i.productId === product.id && i.unitId === selectedUnit.id
      );
      let rawUpdated: CartItem[];
      if (existing) {
        rawUpdated = state.items.map((i) => {
          if (i.productId === product.id && i.unitId === selectedUnit.id) {
            const newQty = addQty(i.quantity, 1);
            const updatedBundle = i.bundleData
              ? i.bundleData.map((b) => ({
                  ...b,
                  totalQuantity: mulQty(b.quantityPerBundle, newQty),
                }))
              : undefined;
            return { ...i, quantity: newQty, bundleData: updatedBundle };
          }
          return i;
        });
      } else {
        let bundleSnapshot: any = undefined;
        if (product.isBundle && product.bundleItems && product.bundleItems.length > 0) {
          bundleSnapshot = product.bundleItems.map((bi) => ({
            productId: bi.childProductId,
            productName: bi.childProduct?.name || 'สินค้าในชุด',
            sku: bi.childProduct?.sku || '',
            quantityPerBundle: Number(bi.quantity),
            totalQuantity: Number(bi.quantity),
            unitPrice: Number(bi.childProduct?.basePrice || bi.childProduct?.priceLevel1 || 0),
          }));
        }

        const newItem: CartItem = {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          originalPrice: selectedUnit.price,
          customPrice: null,
          quantity: 1,
          unitId: selectedUnit.id,
          unitName: selectedUnit.unitName,
          conversionFactor: selectedUnit.factor,
          discountType: 'none',
          discountValue: 0,
          hasVat: product.hasVat,
          isBundle: product.isBundle,
          bundleData: bundleSnapshot,
        };
        rawUpdated = [...state.items, newItem];
      }
      return { items: calculateSmartRollupAndPricing(rawUpdated) };
    });
  },

  removeItem: (productId: string, unitId?: string) => {
    set((state) => {
      const rawUpdated = state.items.filter((i) =>
        unitId
          ? !(i.productId === productId && i.unitId === unitId)
          : i.productId !== productId
      );
      return { items: calculateSmartRollupAndPricing(rawUpdated) };
    });
  },

  updateQuantity: (productId: string, rawQuantity: number, unitId?: string) => {
    const quantity = roundQty(rawQuantity);
    if (!(quantity > 0)) {
      get().removeItem(productId, unitId);
      return;
    }
    set((state) => {
      const rawUpdated = state.items.map((i) => {
        const match = unitId
          ? i.productId === productId && i.unitId === unitId
          : i.productId === productId;
        if (match) {
          const updatedBundle = i.bundleData
            ? i.bundleData.map((b) => ({
                ...b,
                totalQuantity: mulQty(b.quantityPerBundle, quantity),
              }))
            : undefined;
          return { ...i, quantity, bundleData: updatedBundle };
        }
        return i;
      });
      return { items: calculateSmartRollupAndPricing(rawUpdated) };
    });
  },

  setCustomPrice: (productId: string, price: number | null, unitId?: string) => {
    set((state) => ({
      items: state.items.map((i) => {
        const match = unitId
          ? i.productId === productId && i.unitId === unitId
          : i.productId === productId;
        return match ? { ...i, customPrice: price } : i;
      }),
    }));
  },

  setItemDiscount: (productId: string, type: 'none' | 'baht' | 'percent', value: number, unitId?: string) => {
    set((state) => ({
      items: state.items.map((i) => {
        const match = unitId
          ? i.productId === productId && i.unitId === unitId
          : i.productId === productId;
        return match ? { ...i, discountType: type, discountValue: clampDiscountValue(type, value) } : i;
      }),
    }));
  },

  setItemClaim: (productId: string, claimQty: number, reason?: string, unitId?: string, sourceOrderId?: string) => {
    set((state) => ({
      items: state.items.map((i) => {
        const match = unitId ? i.productId === productId && i.unitId === unitId : i.productId === productId;
        if (!match) return i;
        const validClaimQty = Math.max(0, Math.min(roundQty(claimQty), i.quantity));
        return {
          ...i,
          claimQuantity: validClaimQty,
          claimDefectReason: validClaimQty > 0 ? (reason || i.claimDefectReason || 'สินค้ามีปัญหา') : undefined,
          claimSourceOrderId: validClaimQty > 0 ? (sourceOrderId || i.claimSourceOrderId) : undefined,
        };
      }),
    }));
  },

  setItemNote: (productId: string, note: string, unitId?: string) => {
    set((state) => ({
      items: state.items.map((i) => {
        const match = unitId ? i.productId === productId && i.unitId === unitId : i.productId === productId;
        return match ? { ...i, itemNote: note } : i;
      }),
    }));
  },

  setItemUnit: (productId: string, unit: ProductUnit) => {
    set((state) => {
      const rawUpdated = state.items.map((i) =>
        i.productId === productId
          ? {
              ...i,
              unitId: unit.id,
              unitName: unit.unitName,
              conversionFactor: unit.factor,
              originalPrice: unit.price,
              customPrice: null,
              discountType: 'none' as const,
              discountValue: 0,
            }
          : i
      );
      return { items: calculateSmartRollupAndPricing(rawUpdated) };
    });
  },

  setBillDiscount: (type: 'none' | 'baht' | 'percent', value: number) => {
    set({ billDiscountType: type, billDiscountValue: clampDiscountValue(type, value) });
  },

  setPointsDiscount: (discountBaht: number, pointsUsed: number) => {
    set({ pointsDiscountValue: discountBaht, pointsUsed });
  },

  clearPointsDiscount: () => {
    set({ pointsDiscountValue: 0, pointsUsed: 0 });
  },

  setAttachedClaim: (claim: ClaimRecord | null) => {
    set({ attachedClaim: claim });
  },

  clearAttachedClaim: () => {
    set({ attachedClaim: null });
  },

  addPendingClaim: (claim: PendingClaimItem) => {
    set((state) => ({
      pendingClaims: [...state.pendingClaims.filter((c) => c.id !== claim.id), claim],
    }));
  },

  removePendingClaim: (id: string) => {
    set((state) => ({
      pendingClaims: state.pendingClaims.filter((c) => c.id !== id),
    }));
  },

  clearPendingClaims: () => {
    set({ pendingClaims: [] });
  },

  setNote: (note: string) => {
    set({ note });
  },

  setVatEnabled: (enabled: boolean) => {
    set({ isVatEnabled: enabled });
  },

  setCustomer: (id: string | null, name: string | null) => {
    if (!id) {
      set({ customerId: null, customerName: null, pointsDiscountValue: 0, pointsUsed: 0 });
    } else {
      set({ customerId: id, customerName: name });
    }
  },

  clearCart: () => {
    set({
      items: [],
      customerId: null,
      customerName: null,
      billDiscountType: 'none' as const,
      billDiscountValue: 0,
      pointsDiscountValue: 0,
      pointsUsed: 0,
      attachedClaim: null,
      pendingClaims: [],
      note: '',
      editingOrderId: null,
    });
  },

  holdBill: (label?: string) => {
    const state = get();
    if (state.items.length === 0) return;

    const bill: HeldBill = {
      id: Date.now().toString(),
      label: label || `บิลพัก #${state.heldBills.length + 1}`,
      items: [...state.items],
      customerId: state.customerId,
      customerName: state.customerName,
      billDiscountType: state.billDiscountType,
      billDiscountValue: state.billDiscountValue,
      pointsDiscountValue: state.pointsDiscountValue,
      pointsUsed: state.pointsUsed,
      pendingClaims: [...state.pendingClaims],
      note: state.note,
      heldAt: new Date().toISOString(),
    };

    set((s) => ({
      heldBills: [...s.heldBills, bill],
      items: [],
      customerId: null,
      customerName: null,
      billDiscountType: 'none' as const,
      billDiscountValue: 0,
      pointsDiscountValue: 0,
      pointsUsed: 0,
      attachedClaim: null,
      pendingClaims: [],
      note: '',
      editingOrderId: null,
    }));
  },

  recallBill: (id: string) => {
    const state = get();
    const bill = state.heldBills.find((b) => b.id === id);
    if (!bill) return;

    // Auto-hold current bill if has items
    if (state.items.length > 0) {
      get().holdBill();
    }

    set((s) => ({
      items: [...bill.items],
      customerId: bill.customerId,
      customerName: bill.customerName,
      billDiscountType: bill.billDiscountType,
      billDiscountValue: bill.billDiscountValue,
      pointsDiscountValue: bill.pointsDiscountValue || 0,
      pointsUsed: bill.pointsUsed || 0,
      pendingClaims: bill.pendingClaims || [],
      note: bill.note || '',
      heldBills: s.heldBills.filter((b) => b.id !== id),
    }));
  },

  removeHeldBill: (id: string) => {
    set((s) => ({
      heldBills: s.heldBills.filter((b) => b.id !== id),
    }));
  },

  // --- Computed helpers ---

  getEffectivePrice: (item: CartItem) => {
    return item.customPrice ?? item.originalPrice;
  },

  getItemDiscountAmount: (item: CartItem) => {
    const price = item.customPrice ?? item.originalPrice;
    const chargeableQty = Math.max(0, subQty(item.quantity, item.claimQuantity || 0));
    const lineBefore = round2(price * chargeableQty);
    if (item.discountType === 'baht') return Math.min(item.discountValue, lineBefore);
    if (item.discountType === 'percent') return lineBefore * (item.discountValue / 100);
    return 0;
  },

  getItemLineTotal: (item: CartItem) => {
    const price = item.customPrice ?? item.originalPrice;
    const chargeableQty = Math.max(0, subQty(item.quantity, item.claimQuantity || 0));
    const discount = get().getItemDiscountAmount(item);
    // same rounding as the server: round2(quantity x price - discount)
    return Math.max(0, round2(price * chargeableQty - discount));
  },

  getSubtotal: () => {
    return get().items.reduce((sum, item) => sum + get().getItemLineTotal(item), 0);
  },

  getBillDiscountAmount: () => {
    const { billDiscountType, billDiscountValue } = get();
    const subtotal = get().getSubtotal();
    if (billDiscountType === 'baht') return Math.min(billDiscountValue, subtotal);
    if (billDiscountType === 'percent') return subtotal * (billDiscountValue / 100);
    return 0;
  },

  getPointsDiscountAmount: () => {
    const subtotal = get().getSubtotal();
    const billDiscount = get().getBillDiscountAmount();
    const remaining = Math.max(0, subtotal - billDiscount);
    return Math.min(get().pointsDiscountValue || 0, remaining);
  },

  getClaimDiscountAmount: () => {
    const attachedClaim = get().attachedClaim;
    const pendingClaims = get().pendingClaims || [];
    const discountPendingClaims = pendingClaims.filter((c) => c.resolutionType === 'STORE_DISCOUNT');

    let totalClaimVal = 0;
    if (attachedClaim) {
      totalClaimVal += attachedClaim.discountAmount ?? (attachedClaim.quantity * attachedClaim.unitPrice);
    }
    for (const c of discountPendingClaims) {
      totalClaimVal += c.discountAmount ?? (c.quantity * c.unitPrice);
    }

    if (totalClaimVal === 0) return 0;
    const subtotal = get().getSubtotal();
    const priorDiscounts = get().getBillDiscountAmount() + get().getPointsDiscountAmount();
    const remaining = Math.max(0, subtotal - priorDiscounts);
    return Math.min(totalClaimVal, remaining);
  },

  getVatAmount: () => {
    if (!get().isVatEnabled || !loadStoreSettings().vatEnabled) return 0;
    const items = get().items;
    const subtotal = get().getSubtotal();
    if (subtotal === 0) return 0;

    const totalDiscounts = get().getBillDiscountAmount() + get().getPointsDiscountAmount() + get().getClaimDiscountAmount();
    const discountRate = totalDiscounts / subtotal;

    // VAT-inclusive prices: vat = amount × rate / (100 + rate), rate from store settings
    const rate = Number(loadStoreSettings().vatRate);
    const vatRate = Number.isFinite(rate) && rate >= 0 ? rate : 7;
    let vatTotal = 0;
    for (const item of items) {
      if (item.hasVat) {
        const lineTotal = get().getItemLineTotal(item);
        const afterDiscount = lineTotal * (1 - discountRate);
        vatTotal += afterDiscount * (vatRate / (100 + vatRate));
      }
    }
    return vatTotal;
  },

  getTotal: () => {
    const total = get().getSubtotal() - get().getBillDiscountAmount() - get().getPointsDiscountAmount() - get().getClaimDiscountAmount();
    return Math.max(0, total);
  },

  getItemCount: () => {
    return addQty(...get().items.map((i) => i.quantity));
  },
}), {
  name: CART_STORAGE_KEY,
  version: CART_STORAGE_VERSION,
  // On the server (SSR / prerender) localStorage does not exist; createJSONStorage then yields no storage
  // and the store simply starts empty. Pages using the cart render only after AuthGuard has mounted.
  storage: createJSONStorage(() => localStorage),
  partialize: (s): PersistedCart => ({
    items: s.items,
    customerId: s.customerId,
    customerName: s.customerName,
    billDiscountType: s.billDiscountType,
    billDiscountValue: s.billDiscountValue,
    pointsDiscountValue: s.pointsDiscountValue,
    pointsUsed: s.pointsUsed,
    attachedClaim: s.attachedClaim,
    pendingClaims: s.pendingClaims,
    note: s.note,
    heldBills: s.heldBills,
    editingOrderId: s.editingOrderId,
  }),
  // Unknown/older versions: keep whatever still validates instead of throwing away parked bills
  migrate: (persisted) => sanitizePersistedCart(persisted) as unknown as CartStore,
  merge: (persisted, current) => ({ ...current, ...sanitizePersistedCart(persisted) }),
}));

// Follow the store's VAT setting whenever settings are (re)loaded from the server
if (typeof window !== 'undefined') {
  window.addEventListener('purim:store-settings', (e) => {
    const enabled = (e as CustomEvent<{ vatEnabled?: boolean }>).detail?.vatEnabled === true;
    if (useCartStore.getState().isVatEnabled !== enabled) useCartStore.setState({ isVatEnabled: enabled });
  });
  // Another tab/window on this device changed the cart or held bills: pick up its version
  window.addEventListener('storage', (e) => {
    if (e.key === CART_STORAGE_KEY) void useCartStore.persist.rehydrate();
  });
}
