import { create } from 'zustand';
import { CartItem, HeldBill, Product, ProductUnit, ClaimRecord } from '../types';
import { calculateSmartRollupAndPricing } from '../cart-pricing';

interface CartStore {
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  billDiscountType: 'none' | 'baht' | 'percent';
  billDiscountValue: number;
  pointsDiscountValue: number;
  pointsUsed: number;
  attachedClaim: ClaimRecord | null;
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
  setItemNote: (productId: string, note: string, unitId?: string) => void;
  setItemUnit: (productId: string, unit: ProductUnit) => void;
  setBillDiscount: (type: 'none' | 'baht' | 'percent', value: number) => void;
  setPointsDiscount: (discountBaht: number, pointsUsed: number) => void;
  clearPointsDiscount: () => void;
  setAttachedClaim: (claim: ClaimRecord | null) => void;
  clearAttachedClaim: () => void;
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

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  billDiscountType: 'none' as const,
  billDiscountValue: 0,
  pointsDiscountValue: 0,
  pointsUsed: 0,
  attachedClaim: null,
  note: '',
  isVatEnabled: typeof window !== 'undefined' ? localStorage.getItem('pos_vat_enabled') !== 'false' : true,
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
        rawUpdated = state.items.map((i) =>
          i.productId === product.id && i.unitId === selectedUnit.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      } else {
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

  updateQuantity: (productId: string, quantity: number, unitId?: string) => {
    if (quantity <= 0) {
      get().removeItem(productId, unitId);
      return;
    }
    set((state) => {
      const rawUpdated = state.items.map((i) => {
        const match = unitId
          ? i.productId === productId && i.unitId === unitId
          : i.productId === productId;
        return match ? { ...i, quantity } : i;
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
        return match ? { ...i, discountType: type, discountValue: value } : i;
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
    set({ billDiscountType: type, billDiscountValue: value });
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

  setNote: (note: string) => {
    set({ note });
  },

  setVatEnabled: (enabled: boolean) => {
    try { localStorage.setItem('pos_vat_enabled', enabled ? 'true' : 'false'); } catch {}
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
    const lineBefore = price * item.quantity;
    if (item.discountType === 'baht') return Math.min(item.discountValue, lineBefore);
    if (item.discountType === 'percent') return lineBefore * (item.discountValue / 100);
    return 0;
  },

  getItemLineTotal: (item: CartItem) => {
    const price = item.customPrice ?? item.originalPrice;
    const lineBefore = price * item.quantity;
    const discount = get().getItemDiscountAmount(item);
    return Math.max(0, lineBefore - discount);
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
    const claim = get().attachedClaim;
    if (!claim) return 0;
    const subtotal = get().getSubtotal();
    const priorDiscounts = get().getBillDiscountAmount() + get().getPointsDiscountAmount();
    const remaining = Math.max(0, subtotal - priorDiscounts);
    const claimVal = claim.discountAmount ?? (claim.quantity * claim.unitPrice);
    return Math.min(claimVal, remaining);
  },

  getVatAmount: () => {
    if (!get().isVatEnabled) return 0;
    const items = get().items;
    const subtotal = get().getSubtotal();
    if (subtotal === 0) return 0;

    const totalDiscounts = get().getBillDiscountAmount() + get().getPointsDiscountAmount() + get().getClaimDiscountAmount();
    const discountRate = totalDiscounts / subtotal;

    let vatTotal = 0;
    for (const item of items) {
      if (item.hasVat) {
        const lineTotal = get().getItemLineTotal(item);
        const afterDiscount = lineTotal * (1 - discountRate);
        // VAT included: vat = amount × 7/107
        vatTotal += afterDiscount * (7 / 107);
      }
    }
    return vatTotal;
  },

  getTotal: () => {
    const total = get().getSubtotal() - get().getBillDiscountAmount() - get().getPointsDiscountAmount() - get().getClaimDiscountAmount();
    return Math.max(0, total);
  },

  getItemCount: () => {
    return get().items.reduce((sum, i) => sum + i.quantity, 0);
  },
}));
