import { create } from 'zustand';
import { api } from '../api';
import { Shift, CashTransaction, Order } from '../types';

interface ShiftStore {
  currentShift: Shift | null;
  cashTransactions: CashTransaction[];
  completedOrders: Order[];

  // Actions
  fetchCurrentShift: () => Promise<Shift | null>;
  openShift: (userName: string, openingCash: number) => Promise<void>;
  closeShift: (actualCash?: number) => Promise<Shift | null>;
  addCashTransaction: (type: 'in' | 'out', amount: number, reason: string, operationId?: string) => Promise<void>;
  recordClaimRefund: (amount: number, claimId?: string, reason?: string) => void;
  recordSale: (order: Order) => void;
  recordVoid: () => void;
  voidOrder: (orderId: string, reason: string) => void;
  updateOrderPaymentMethod: (orderId: string, oldPayments: any, newPayments: Array<{ method: any; amount: number; referenceNo?: string }>, totalAmount: number) => void;
  updateOrderSyncStatus: (orderId: string, isSynced: boolean) => void;
  updateOrderAfterSync: (localIdOrNumber: string, backendOrderNumber: string, backendId?: string) => void;
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
  if (typeof window === 'undefined') return [];
  try { const rows = JSON.parse(localStorage.getItem('pos_completed_orders') || '[]'); return Array.isArray(rows) ? rows : []; }
  catch { return []; }
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

  fetchCurrentShift: async () => {
    try {
      const res: any = await api.shifts.getCurrent();
      const s = res?.shift || res;
      if (s && (s.status === 'OPEN' || res?.status === 'OPEN')) {
        const cashMovements: CashTransaction[] = Array.isArray(s.cashMovements)
          ? s.cashMovements.map((m: any) => ({
              id: m.id,
              shiftId: s.id,
              type: (m.type || '').toLowerCase() === 'out' ? 'out' : 'in',
              amount: Number(m.amount) || 0,
              reason: m.reason || '',
              createdAt: m.createdAt,
            }))
          : get().cashTransactions;

        const mapped: Shift = {
          id: s.id,
          shiftId: s.shiftNumber || s.id,
          userId: s.userId || '1',
          userName: s.user?.fullName || 'พนักงานขาย',
          openedAt: s.openedAt,
          openingCash: Number(res.startingCash ?? s.startingCash) || 0,
          closedAt: s.closedAt,
          cashSales: Number(res.cashSales ?? s.cashSales) || 0,
          qrSales: Number(res.qrSales ?? res.promptpaySales ?? s.promptpaySales) || 0,
          cardSales: Number(res.cardSales ?? res.creditCardSales ?? s.creditCardSales) || 0,
          transferSales: Number(res.transferSales ?? 0) || 0,
          creditSales: Number(res.creditSales ?? res.debtSales ?? s.debtSales) || 0,
          cashIn: Number(res.cashIn ?? s.cashIn) || 0,
          cashOut: Number(res.cashOut ?? s.cashOut) || 0,
          cashRefunds: Number(res.cashRefunds ?? 0) || 0,
          claimRefundCount: Number(res.claimRefundCount ?? 0) || 0,
          orderCount: Number(res.orderCount ?? s.orders?.length) || 0,
          voidCount: Number(res.voidCount ?? 0) || 0,
          isOpen: true,
        };
        saveCurrentShift(mapped);
        saveCashTransactions(cashMovements);
        set({ currentShift: mapped, cashTransactions: cashMovements });
        return mapped;
      } else {
        saveCurrentShift(null);
        saveCashTransactions([]);
        set({ currentShift: null, cashTransactions: [] });
        return null;
      }
    } catch (err) {
      console.warn('[ShiftStore] Failed to fetch current shift from server:', err);
      return get().currentShift;
    }
  },

  openShift: async (userName: string, openingCash: number) => {
    try {
      const serverRes: any = await api.shifts.open(openingCash);
      const s = serverRes?.shift || serverRes;
      if (s?.id) {
        const cashMovements: CashTransaction[] = Array.isArray(s.cashMovements)
          ? s.cashMovements.map((m: any) => ({
              id: m.id,
              shiftId: s.id,
              type: (m.type || '').toLowerCase() === 'out' ? 'out' : 'in',
              amount: Number(m.amount) || 0,
              reason: m.reason || '',
              createdAt: m.createdAt,
            }))
          : [];
        const mapped: Shift = {
          id: s.id,
          shiftId: s.shiftNumber || s.id,
          userId: s.userId || '1',
          userName: s.user?.fullName || userName,
          openedAt: s.openedAt || new Date().toISOString(),
          openingCash: Number(serverRes.startingCash ?? s.startingCash ?? openingCash) || 0,
          closedAt: null,
          cashSales: Number(serverRes.cashSales ?? s.cashSales ?? 0) || 0,
          qrSales: Number(serverRes.qrSales ?? serverRes.promptpaySales ?? s.promptpaySales ?? 0) || 0,
          cardSales: Number(serverRes.cardSales ?? serverRes.creditCardSales ?? s.creditCardSales ?? 0) || 0,
          transferSales: Number(serverRes.transferSales ?? 0) || 0,
          creditSales: Number(serverRes.creditSales ?? serverRes.debtSales ?? s.debtSales ?? 0) || 0,
          cashIn: Number(serverRes.cashIn ?? s.cashIn ?? 0) || 0,
          cashOut: Number(serverRes.cashOut ?? s.cashOut ?? 0) || 0,
          cashRefunds: Number(serverRes.cashRefunds ?? 0) || 0,
          claimRefundCount: Number(serverRes.claimRefundCount ?? 0) || 0,
          orderCount: Number(serverRes.orderCount ?? s.orders?.length ?? 0) || 0,
          voidCount: Number(serverRes.voidCount ?? 0) || 0,
          isOpen: true,
        };
        saveCurrentShift(mapped);
        saveCashTransactions(cashMovements);
        set({ currentShift: mapped, cashTransactions: cashMovements });
        return;
      }
    } catch (err) { throw err; }
    throw new Error('เซิร์ฟเวอร์ยังไม่ยืนยันการเปิดกะ');
  },

  closeShift: async (actualCash?: number) => {
    const shift = get().currentShift;
    if (!shift) return null;

    const { getPendingOfflineOrders } = await import('../offline-db');
    if ((await getPendingOfflineOrders()).some(o => o.syncStatus !== 'confirmed' && o.shiftId === shift.id)) {
      throw new Error('ยังมีบิลรอส่งในกะนี้ กรุณาซิงค์ให้ครบก่อนปิดกะ');
    }
    await api.shifts.close(shift.id, actualCash ?? 0);
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

  addCashTransaction: async (type: 'in' | 'out', amount: number, reason: string, operationId?: string) => {
    const shift = get().currentShift;
    if (!shift?.isOpen) throw new Error('กรุณาเปิดกะบนฐานข้อมูลก่อนทำรายการเงินสด');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('จำนวนเงินต้องมากกว่า 0');

    const currentCash = Math.max(0, shift.openingCash + shift.cashSales + shift.cashIn - shift.cashOut - (shift.cashRefunds || 0));
    if (type === 'out' && currentCash <= 0) {
      throw new Error('ยอดเงินสดคงเหลือไม่เพียงพอ');
    }

    const safeAmount = amount;

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
    const { newOperationId } = await import('../order-sync-service');
    const serverMovement = await api.shifts.addCashMovement(shift.id, { type, amount: safeAmount, reason, clientMovementId: operationId || newOperationId() });
    transaction.id = serverMovement.id;
    if (get().cashTransactions.some(t => t.id === transaction.id)) return;
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

    const refundReason = `คืนเงินสดเคลมสินค้า #${claimId || ''}${reason ? `: ${reason}` : ''}`;
    const clientMovementId = ('claim-refund-' + (claimId || Date.now()) + '-' + Math.random().toString(36).slice(2, 8)).slice(0, 95);
    const transaction: CashTransaction = {
      id: clientMovementId,
      shiftId: shift.id,
      type: 'out',
      amount,
      reason: refundReason,
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

    // Notify backend shift cash movement so expectedCash in database is reduced accurately
    try {
      api.shifts.addCashMovement(shift.id, {
        type: 'out',
        amount,
        reason: refundReason,
        clientMovementId,
      }).catch((e) => console.warn('[ShiftStore] Failed to sync claim refund cash movement:', e));
    } catch {}
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
          case 'CREDIT_DEBT' as any:
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

  updateOrderAfterSync: (localIdOrNumber: string, backendOrderNumber: string, backendId?: string) => {
    set((state) => {
      const updated = state.completedOrders.map((o) =>
        o.id === localIdOrNumber || o.orderNumber === localIdOrNumber
          ? { ...o, id: backendId || o.id, orderNumber: backendOrderNumber, isSynced: true }
          : o
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
            case 'CREDIT_DEBT' as any:
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
      let creditDeduct = 0;

      const oldList = Array.isArray(oldPayments) ? oldPayments : [oldPayments];
      for (const p of oldList) {
        const m = typeof p === 'string' ? p : (p?.method || '');
        const amt = typeof p === 'string' ? totalAmount : (p?.amount || totalAmount);
        if (m === 'CASH' || m === 'เงินสด') cashDeduct += amt;
        else if (m === 'QR_PROMPTPAY' || m.includes?.('คิวอาร์') || m.includes?.('พร้อมเพย์')) qrDeduct += amt;
        else if (m === 'TRANSFER' || m.includes?.('โอน')) transferDeduct += amt;
        else if (m === 'CREDIT_CARD' || m.includes?.('บัตร')) cardDeduct += amt;
        else if (m === 'CREDIT_DEBT' || m === 'CREDIT_NOTE' || m === 'CREDIT' || m.includes?.('เชื่อ') || m.includes?.('เครดิต')) creditDeduct += amt;
        else transferDeduct += amt;
      }

      // Add new payments to shift totals
      let cashAdd = 0;
      let qrAdd = 0;
      let cardAdd = 0;
      let transferAdd = 0;
      let creditAdd = 0;

      for (const p of newPayments) {
        const m = p.method;
        const amt = p.amount || 0;
        if (m === 'CASH' || m === 'เงินสด') cashAdd += amt;
        else if (m === 'QR_PROMPTPAY' || m.includes?.('คิวอาร์') || m.includes?.('พร้อมเพย์')) qrAdd += amt;
        else if (m === 'TRANSFER' || m.includes?.('โอน')) transferAdd += amt;
        else if (m === 'CREDIT_CARD' || m.includes?.('บัตร')) cardAdd += amt;
        else if (m === 'CREDIT_DEBT' || m === 'CREDIT_NOTE' || m === 'CREDIT' || m.includes?.('เชื่อ') || m.includes?.('เครดิต')) creditAdd += amt;
        else transferAdd += amt;
      }

      const updatedShift = shift ? {
        ...shift,
        cashSales: Math.max(0, shift.cashSales - cashDeduct + cashAdd),
        qrSales: Math.max(0, shift.qrSales - qrDeduct + qrAdd),
        cardSales: Math.max(0, shift.cardSales - cardDeduct + cardAdd),
        transferSales: Math.max(0, shift.transferSales - transferDeduct + transferAdd),
        creditSales: Math.max(0, (shift.creditSales || 0) - creditDeduct + creditAdd),
      } : null;

      if (updatedShift) saveCurrentShift(updatedShift);

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
    return shift.openingCash + shift.cashSales + shift.cashIn - shift.cashOut - (shift.cashRefunds || 0);
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
