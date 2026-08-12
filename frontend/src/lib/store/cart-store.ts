import { create } from 'zustand';
import { CartItem, HeldBill, Product, ProductUnit } from '../types';

interface CartStore {
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  billDiscountType: 'none' | 'baht' | 'percent';
  billDiscountValue: number;
  heldBills: HeldBill[];

  // Actions
  addItem: (product: Product, unit?: ProductUnit) => void;
  removeItem: (productId: string, unitId?: string) => void;
  updateQuantity: (productId: string, quantity: number, unitId?: string) => void;
  setCustomPrice: (productId: string, price: number | null) => void;
  setItemDiscount: (productId: string, type: 'none' | 'baht' | 'percent', value: number) => void;
  setItemUnit: (productId: string, unit: ProductUnit) => void;
  setBillDiscount: (type: 'none' | 'baht' | 'percent', value: number) => void;
  setCustomer: (id: string | null, name: string | null) => void;
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
  heldBills: [],

  addItem: (product: Product, unit?: ProductUnit) => {
    const selectedUnit = unit || product.units[0];
    if (!selectedUnit) return;

    set((state) => {
      const key = `${product.id}__${selectedUnit.id}`;
      const existing = state.items.find(
        (i) => i.productId === product.id && i.unitId === selectedUnit.id
      );
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === product.id && i.unitId === selectedUnit.id
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        };
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
      };
      return { items: [...state.items, newItem] };
    });
  },

  removeItem: (productId: string, unitId?: string) => {
    set((state) => ({
      items: state.items.filter((i) =>
        unitId
          ? !(i.productId === productId && i.unitId === unitId)
          : i.productId !== productId
      ),
    }));
  },

  updateQuantity: (productId: string, quantity: number, unitId?: string) => {
    if (quantity <= 0) {
      get().removeItem(productId, unitId);
      return;
    }
    set((state) => ({
      items: state.items.map((i) => {
        const match = unitId
          ? i.productId === productId && i.unitId === unitId
          : i.productId === productId;
        return match ? { ...i, quantity } : i;
      }),
    }));
  },

  setCustomPrice: (productId: string, price: number | null) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.productId === productId ? { ...i, customPrice: price } : i
      ),
    }));
  },

  setItemDiscount: (productId: string, type: 'none' | 'baht' | 'percent', value: number) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.productId === productId
          ? { ...i, discountType: type, discountValue: value }
          : i
      ),
    }));
  },

  setItemUnit: (productId: string, unit: ProductUnit) => {
    set((state) => ({
      items: state.items.map((i) =>
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
      ),
    }));
  },

  setBillDiscount: (type: 'none' | 'baht' | 'percent', value: number) => {
    set({ billDiscountType: type, billDiscountValue: value });
  },

  setCustomer: (id: string | null, name: string | null) => {
    set({ customerId: id, customerName: name });
  },

  clearCart: () => {
    set({
      items: [],
      customerId: null,
      customerName: null,
      billDiscountType: 'none' as const,
      billDiscountValue: 0,
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
      heldAt: new Date().toISOString(),
    };

    set((s) => ({
      heldBills: [...s.heldBills, bill],
      items: [],
      customerId: null,
      customerName: null,
      billDiscountType: 'none' as const,
      billDiscountValue: 0,
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

  getVatAmount: () => {
    const items = get().items;
    const subtotal = get().getSubtotal();
    if (subtotal === 0) return 0;

    const billDiscountRate = get().getBillDiscountAmount() / subtotal;

    let vatTotal = 0;
    for (const item of items) {
      if (item.hasVat) {
        const lineTotal = get().getItemLineTotal(item);
        const afterBillDiscount = lineTotal * (1 - billDiscountRate);
        // VAT included: vat = amount × 7/107
        vatTotal += afterBillDiscount * (7 / 107);
      }
    }
    return vatTotal;
  },

  getTotal: () => {
    return get().getSubtotal() - get().getBillDiscountAmount();
  },

  getItemCount: () => {
    return get().items.reduce((sum, i) => sum + i.quantity, 0);
  },
}));
