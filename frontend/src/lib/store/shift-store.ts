import { create } from 'zustand';
import { Shift, CashTransaction, Order } from '../types';
import { orders as masterMockOrders } from '../mock-data';

interface ShiftStore {
  currentShift: Shift | null;
  cashTransactions: CashTransaction[];
  completedOrders: Order[];

  // Actions
  openShift: (userName: string, openingCash: number) => void;
  closeShift: (actualCash?: number) => Shift | null;
  addCashTransaction: (type: 'in' | 'out', amount: number, reason: string) => void;
  recordClaimRefund: (amount: number, claimId?: string, reason?: string) => void;
  recordSale: (order: Order) => void;
  recordVoid: () => void;
  voidOrder: (orderId: string, reason: string) => void;
  updateOrderPaymentMethod: (orderId: string, oldPayments: any, newPayments: Array<{ method: any; amount: number; referenceNo?: string }>, totalAmount: number) => void;
  updateOrderSyncStatus: (orderId: string, isSynced: boolean) => void;
  updateOrderNote: (orderId: string, note: string) => void;

  // Getters
  isShiftOpen: () => boolean;
  getExpectedCash: () => number;
  getTotalSales: () => number;
  getShiftOrders: () => Order[];
}

const loadInitialShift = (): Shift | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('pos_current_shift');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveCurrentShift = (shift: Shift | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (shift) {
      localStorage.setItem('pos_current_shift', JSON.stringify(shift));
    } else {
      localStorage.removeItem('pos_current_shift');
    }
  } catch {}
};

const loadInitialCashTransactions = (): CashTransaction[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('pos_cash_transactions');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveCashTransactions = (txs: CashTransaction[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('pos_cash_transactions', JSON.stringify(txs));
  } catch {}
};

const loadInitialOrders = (): Order[] => {
  if (typeof window === 'undefined') return masterMockOrders;
  try {
    const raw = localStorage.getItem('pos_completed_orders');
    const parsed: Order[] = raw ? JSON.parse(raw) : [];

    // Filter out any legacy ORD-2026 bills
    const cleanedParsed = parsed.filter(
      (o) => !o.orderNumber?.startsWith('ORD-2026') && !o.id?.startsWith('ORD-2026')
    );
    if (cleanedParsed.length !== parsed.length) {
      try {
        localStorage.setItem('pos_completed_orders', JSON.stringify(cleanedParsed));
      } catch {}
    }

    const combinedMap = new Map<string, Order>();
    // Pre-populate with master ORD-OFFLINE orders matching real store products
    masterMockOrders
      .filter((o) => !o.orderNumber?.startsWith('ORD-2026') && !o.id?.startsWith('ORD-2026'))
      .forEach((o) => {
        const k = o.orderNumber || o.id;
        if (k) combinedMap.set(k, o);
      });
    // Overlay user completed orders from POS checkouts
    cleanedParsed.forEach((o) => {
      const k = o.orderNumber || o.id;
      if (k) combinedMap.set(k, o);
    });

    const all = Array.from(combinedMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return all;
  } catch {
    return masterMockOrders;
  }
};

const saveCompletedOrders = (orders: Order[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('pos_completed_orders', JSON.stringify(orders));
  } catch {}
};

export const useShiftStore = create<ShiftStore>((set, get) => ({
  currentShift: loadInitialShift(),
  cashTransactions: loadInitialCashTransactions(),
  completedOrders: loadInitialOrders(),

  openShift: (userName: string, openingCash: number) => {
    const shift: Shift = {
      id: Date.now().toString(),
      userId: '1',
      userName,
      openedAt: new Date().toISOString(),
      openingCash,
      closedAt: null,
      cashSales: 0,
      qrSales: 0,
      cardSales: 0,
      transferSales: 0,
      creditSales: 0,
      cashIn: 0,
      cashOut: 0,
      cashRefunds: 0,
      claimRefundCount: 0,
      orderCount: 0,
      voidCount: 0,
      isOpen: true,
    };
    saveCurrentShift(shift);
    saveCashTransactions([]);
    set({ currentShift: shift, cashTransactions: [] });
  },

  closeShift: (actualCash?: number) => {
    const shift = get().currentShift;
    if (!shift) return null;

    const closedShift: Shift = {
      ...shift,
      closedAt: new Date().toISOString(),
      isOpen: false,
    };

    try {
      const historyRaw = localStorage.getItem('pos_shifts_history');
      const history: Shift[] = historyRaw ? JSON.parse(historyRaw) : [];
      history.unshift(closedShift);
      localStorage.setItem('pos_shifts_history', JSON.stringify(history.slice(0, 50)));
    } catch {}

    saveCurrentShift(null);
    saveCashTransactions([]);
    set({ currentShift: null, cashTransactions: [] });
    return closedShift;
  },

  addCashTransaction: (type: 'in' | 'out', amount: number, reason: string) => {
    let shift = get().currentShift;
    if (!shift || !shift.isOpen) {
      shift = {
        id: Date.now().toString(),
        userId: '1',
        userName: 'พนักงานขาย',
        openedAt: new Date().toISOString(),
        openingCash: 0,
        closedAt: null,
        cashSales: 0,
        qrSales: 0,
        cardSales: 0,
        transferSales: 0,
        creditSales: 0,
        cashIn: 0,
        cashOut: 0,
        cashRefunds: 0,
        claimRefundCount: 0,
        orderCount: 0,
        voidCount: 0,
        isOpen: true,
      };
    }

    const currentCash = Math.max(0, shift.openingCash + shift.cashSales + shift.cashIn - shift.cashOut - (shift.cashRefunds || 0));
    if (type === 'out' && currentCash <= 0) {
      return;
    }

    const safeAmount = type === 'out' ? Math.min(amount, currentCash) : amount;

    const transaction: CashTransaction = {
      id: Date.now().toString(),
      shiftId: shift.id,
      type,
      amount: safeAmount,
      reason,
      createdAt: new Date().toISOString(),
    };

    const updatedShift: Shift = {
      ...shift,
      cashIn: shift.cashIn + (type === 'in' ? safeAmount : 0),
      cashOut: shift.cashOut + (type === 'out' ? safeAmount : 0),
    };
    saveCurrentShift(updatedShift);

    const nextTxs = [...get().cashTransactions, transaction];
    saveCashTransactions(nextTxs);

    set({
      cashTransactions: nextTxs,
      currentShift: updatedShift,
    });
  },

  recordClaimRefund: (amount: number, claimId?: string, reason?: string) => {
    const shift = get().currentShift;
    if (!shift) return;

    const transaction: CashTransaction = {
      id: Date.now().toString(),
      shiftId: shift.id,
      type: 'out',
      amount,
      reason: `คืนเงินสดเคลมสินค้า #${claimId || ''}${reason ? `: ${reason}` : ''}`,
      createdAt: new Date().toISOString(),
    };

    const updatedShift: Shift = {
      ...shift,
      cashRefunds: (shift.cashRefunds || 0) + amount,
      claimRefundCount: (shift.claimRefundCount || 0) + 1,
    };
    saveCurrentShift(updatedShift);

    const nextTxs = [...get().cashTransactions, transaction];
    saveCashTransactions(nextTxs);

    set({
      cashTransactions: nextTxs,
      currentShift: updatedShift,
    });
  },

  recordSale: (order: Order) => {
    set((state) => {
      let cashAdd = 0;
      let qrAdd = 0;
      let cardAdd = 0;
      let transferAdd = 0;
      let creditAdd = 0;

      for (const p of order.payments) {
        switch (p.method) {
          case 'CASH': cashAdd += p.amount; break;
          case 'QR_PROMPTPAY': qrAdd += p.amount; break;
          case 'CREDIT_CARD': cardAdd += p.amount; break;
          case 'TRANSFER': transferAdd += p.amount; break;
          case 'CREDIT_NOTE' as any:
          case 'CREDIT' as any:
            creditAdd += p.amount;
            break;
        }
      }

      const updatedOrders = [order, ...state.completedOrders];
      saveCompletedOrders(updatedOrders);

      const activeShift: Shift = (state.currentShift && state.currentShift.isOpen)
        ? state.currentShift
        : {
            id: Date.now().toString(),
            userId: '1',
            userName: 'พนักงานขาย',
            openedAt: new Date().toISOString(),
            openingCash: 0,
            closedAt: null,
            cashSales: 0,
            qrSales: 0,
            cardSales: 0,
            transferSales: 0,
            creditSales: 0,
            cashIn: 0,
            cashOut: 0,
            cashRefunds: 0,
            claimRefundCount: 0,
            orderCount: 0,
            voidCount: 0,
            isOpen: true,
          };

      const updatedShift: Shift = {
        ...activeShift,
        cashSales: activeShift.cashSales + cashAdd,
        qrSales: activeShift.qrSales + qrAdd,
        cardSales: activeShift.cardSales + cardAdd,
        transferSales: activeShift.transferSales + transferAdd,
        creditSales: (activeShift.creditSales || 0) + creditAdd,
        orderCount: activeShift.orderCount + 1,
      };
      saveCurrentShift(updatedShift);

      return {
        completedOrders: updatedOrders,
        currentShift: updatedShift,
      };
    });
  },

  updateOrderSyncStatus: (orderId: string, isSynced: boolean) => {
    set((state) => {
      const updated = state.completedOrders.map((o) =>
        o.id === orderId || o.orderNumber === orderId ? { ...o, isSynced } : o
      );
      saveCompletedOrders(updated);
      return { completedOrders: updated };
    });
  },

  recordVoid: () => {
    set((state) => ({
      currentShift: state.currentShift
        ? { ...state.currentShift, voidCount: state.currentShift.voidCount + 1 }
        : null,
    }));
  },

  voidOrder: (orderId: string, reason: string) => {
    set((state) => {
      const targetOrder = state.completedOrders.find(
        (o) => o.id === orderId || o.orderNumber === orderId
      );
      if (!targetOrder || (targetOrder as any).status === 'CANCELLED' || (targetOrder as any).status === 'VOIDED') {
        return state;
      }

      // Deduct paid amounts from current shift according to payment method
      let cashDeduct = 0;
      let qrDeduct = 0;
      let cardDeduct = 0;
      let transferDeduct = 0;
      let creditDeduct = 0;

      if (Array.isArray(targetOrder.payments) && targetOrder.payments.length > 0) {
        for (const p of targetOrder.payments) {
          switch (p.method) {
            case 'CASH': cashDeduct += p.amount; break;
            case 'QR_PROMPTPAY': qrDeduct += p.amount; break;
            case 'CREDIT_CARD': cardDeduct += p.amount; break;
            case 'TRANSFER': transferDeduct += p.amount; break;
            case 'CREDIT_NOTE' as any:
            case 'CREDIT' as any:
              creditDeduct += p.amount;
              break;
          }
        }
      } else {
        const method = (targetOrder as any).paymentMethod || 'CASH';
        const total = targetOrder.totalAmount || 0;
        if (method === 'CASH' || method === 'เงินสด') cashDeduct += total;
        else if (method.includes('QR') || method.includes('โอน')) qrDeduct += total;
        else if (method.includes('บัตร')) cardDeduct += total;
        else if (method.includes('เชื่อ') || method.includes('เครดิต')) creditDeduct += total;
      }

      const updatedOrders = state.completedOrders.map((o) =>
        o.id === orderId || o.orderNumber === orderId
          ? { ...o, status: 'VOIDED' as const, voidReason: reason, voidedAt: new Date().toISOString() }
          : o
      );
      saveCompletedOrders(updatedOrders);

      return {
        completedOrders: updatedOrders,
        currentShift: state.currentShift
          ? {
              ...state.currentShift,
              cashSales: Math.max(0, state.currentShift.cashSales - cashDeduct),
              qrSales: Math.max(0, state.currentShift.qrSales - qrDeduct),
              cardSales: Math.max(0, state.currentShift.cardSales - cardDeduct),
              transferSales: Math.max(0, state.currentShift.transferSales - transferDeduct),
              creditSales: Math.max(0, (state.currentShift.creditSales || 0) - creditDeduct),
              voidCount: state.currentShift.voidCount + 1,
            }
          : null,
      };
    });
  },

  updateOrderPaymentMethod: (orderId: string, oldPayments: any, newPayments: Array<{ method: any; amount: number; referenceNo?: string }>, totalAmount: number) => {
    set((state) => {
      const shift = state.currentShift;

      // Deduct old payments from shift totals
      let cashDeduct = 0;
      let qrDeduct = 0;
      let cardDeduct = 0;
      let transferDeduct = 0;

      const oldList = Array.isArray(oldPayments) ? oldPayments : [oldPayments];
      for (const p of oldList) {
        const m = typeof p === 'string' ? p : (p?.method || '');
        const amt = typeof p === 'string' ? totalAmount : (p?.amount || totalAmount);
        if (m === 'CASH' || m === 'เงินสด') cashDeduct += amt;
        else if (m === 'QR_PROMPTPAY' || m === 'TRANSFER' || m.includes?.('โอน') || m.includes?.('คิวอาร์')) qrDeduct += amt;
        else if (m === 'CREDIT_CARD' || m.includes?.('บัตร')) cardDeduct += amt;
        else transferDeduct += amt;
      }

      // Add new payments to shift totals
      let cashAdd = 0;
      let qrAdd = 0;
      let cardAdd = 0;
      let transferAdd = 0;

      for (const p of newPayments) {
        const m = p.method;
        const amt = p.amount || 0;
        if (m === 'CASH' || m === 'เงินสด') cashAdd += amt;
        else if (m === 'QR_PROMPTPAY' || m === 'TRANSFER' || m.includes?.('โอน') || m.includes?.('คิวอาร์')) qrAdd += amt;
        else if (m === 'CREDIT_CARD' || m.includes?.('บัตร')) cardAdd += amt;
        else transferAdd += amt;
      }

      const updatedShift = shift ? {
        ...shift,
        cashSales: Math.max(0, shift.cashSales - cashDeduct + cashAdd),
        qrSales: Math.max(0, shift.qrSales - qrDeduct + qrAdd),
        cardSales: Math.max(0, shift.cardSales - cardDeduct + cardAdd),
        transferSales: Math.max(0, shift.transferSales - transferDeduct + transferAdd),
      } : null;

      const primaryMethodStr = newPayments.length > 1 
        ? 'SPLIT' 
        : (newPayments[0]?.method || 'CASH');

      const updatedOrders = state.completedOrders.map((o) =>
        o.id === orderId || o.orderNumber === orderId
          ? {
              ...o,
              paymentMethod: primaryMethodStr,
              payments: newPayments as any
            }
          : o
      );

      saveCompletedOrders(updatedOrders);
      return { currentShift: updatedShift, completedOrders: updatedOrders };
    });
  },

  updateOrderNote: (orderId: string, note: string) => {
    set((state) => {
      const updatedOrders = state.completedOrders.map((o) =>
        o.id === orderId || o.orderNumber === orderId
          ? { ...o, note: note.trim() || undefined }
          : o
      );
      saveCompletedOrders(updatedOrders);
      return { completedOrders: updatedOrders };
    });
  },

  isShiftOpen: () => {
    return get().currentShift?.isOpen === true;
  },

  getExpectedCash: () => {
    const shift = get().currentShift;
    if (!shift || !shift.isOpen) return 0;
    const calculated = shift.openingCash + shift.cashSales + shift.cashIn - shift.cashOut - (shift.cashRefunds || 0);
    return Math.max(0, calculated);
  },

  getTotalSales: () => {
    const shift = get().currentShift;
    if (!shift) return 0;
    return shift.cashSales + shift.qrSales + shift.cardSales + shift.transferSales + (shift.creditSales || 0);
  },

  getShiftOrders: () => {
    return get().completedOrders;
  },
}));
