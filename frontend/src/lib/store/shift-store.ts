import { create } from 'zustand';
import { Shift, CashTransaction, Order } from '../types';

interface ShiftStore {
  currentShift: Shift | null;
  cashTransactions: CashTransaction[];
  completedOrders: Order[];

  // Actions
  openShift: (userName: string, openingCash: number) => void;
  closeShift: () => Shift | null;
  addCashTransaction: (type: 'in' | 'out', amount: number, reason: string) => void;
  recordSale: (order: Order) => void;
  recordVoid: () => void;

  // Getters
  isShiftOpen: () => boolean;
  getExpectedCash: () => number;
  getTotalSales: () => number;
  getShiftOrders: () => Order[];
}

export const useShiftStore = create<ShiftStore>((set, get) => ({
  currentShift: null,
  cashTransactions: [],
  completedOrders: [],

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
      cashIn: 0,
      cashOut: 0,
      orderCount: 0,
      voidCount: 0,
      isOpen: true,
    };
    set({ currentShift: shift, cashTransactions: [], completedOrders: [] });
  },

  closeShift: () => {
    const shift = get().currentShift;
    if (!shift) return null;

    const closedShift: Shift = {
      ...shift,
      closedAt: new Date().toISOString(),
      isOpen: false,
    };
    set({ currentShift: closedShift });
    return closedShift;
  },

  addCashTransaction: (type: 'in' | 'out', amount: number, reason: string) => {
    const shift = get().currentShift;
    if (!shift) return;

    const transaction: CashTransaction = {
      id: Date.now().toString(),
      shiftId: shift.id,
      type,
      amount,
      reason,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      cashTransactions: [...state.cashTransactions, transaction],
      currentShift: state.currentShift
        ? {
            ...state.currentShift,
            cashIn: state.currentShift.cashIn + (type === 'in' ? amount : 0),
            cashOut: state.currentShift.cashOut + (type === 'out' ? amount : 0),
          }
        : null,
    }));
  },

  recordSale: (order: Order) => {
    set((state) => {
      if (!state.currentShift) return state;

      let cashAdd = 0;
      let qrAdd = 0;
      let cardAdd = 0;
      let transferAdd = 0;

      for (const p of order.payments) {
        switch (p.method) {
          case 'CASH': cashAdd += p.amount; break;
          case 'QR_PROMPTPAY': qrAdd += p.amount; break;
          case 'CREDIT_CARD': cardAdd += p.amount; break;
          case 'TRANSFER': transferAdd += p.amount; break;
        }
      }

      return {
        completedOrders: [...state.completedOrders, order],
        currentShift: {
          ...state.currentShift,
          cashSales: state.currentShift.cashSales + cashAdd,
          qrSales: state.currentShift.qrSales + qrAdd,
          cardSales: state.currentShift.cardSales + cardAdd,
          transferSales: state.currentShift.transferSales + transferAdd,
          orderCount: state.currentShift.orderCount + 1,
        },
      };
    });
  },

  recordVoid: () => {
    set((state) => ({
      currentShift: state.currentShift
        ? { ...state.currentShift, voidCount: state.currentShift.voidCount + 1 }
        : null,
    }));
  },

  isShiftOpen: () => {
    return get().currentShift?.isOpen === true;
  },

  getExpectedCash: () => {
    const shift = get().currentShift;
    if (!shift) return 0;
    return shift.openingCash + shift.cashSales + shift.cashIn - shift.cashOut;
  },

  getTotalSales: () => {
    const shift = get().currentShift;
    if (!shift) return 0;
    return shift.cashSales + shift.qrSales + shift.cardSales + shift.transferSales;
  },

  getShiftOrders: () => {
    return get().completedOrders;
  },
}));
