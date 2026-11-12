import { create } from 'zustand';
import { api } from '../api';
import { Shift, CashTransaction, Order, ApiCashMovement, ApiShiftRecord, ApiShiftSummary } from '../types';

/** Why cash goes in/out of the drawer (posted to the finance ledger by the server). */
export interface CashPurposeInput {
  purpose: 'EXPENSE' | 'TO_SAFE' | 'TO_BANK' | 'OTHER' | 'FROM_SAFE' | 'FROM_BANK' | 'OTHER_INCOME';
  expenseCategoryId?: string;
  bankAccountId?: string;
  /** manager approval for a movement above the store's limit (see CashDrawerModal) */
  approvalId?: string;
}

interface ShiftStore {
  currentShift: Shift | null;
  cashTransactions: CashTransaction[];

  // Actions
  fetchCurrentShift: () => Promise<Shift | null>;
  openShift: (userName: string, openingCash: number) => Promise<void>;
  closeShift: (actualCash?: number) => Promise<Shift | null>;
  addCashTransaction: (type: 'in' | 'out', amount: number, reason: string, operationId?: string, purpose?: CashPurposeInput) => Promise<void>;
  /** Show a just-completed sale in this screen's shift totals until the next server refresh. */
  recordSale: (order: Order) => void;

  // Getters
  isShiftOpen: () => boolean;
  getExpectedCash: () => number;
  getTotalSales: () => number;
}

/**
 * READ-ONLY OFFLINE CACHE of the shift the server last confirmed open for this terminal, so a POS
 * reloaded while the network is down still knows its shift and can keep selling through the
 * order outbox. Written only from server responses (open / current / close), never from local
 * sales bookkeeping; logout and "clear data" forget it.
 */
export const CURRENT_SHIFT_CACHE_KEY = 'purim-cache:current-shift';

const loadCachedShift = (): Shift | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CURRENT_SHIFT_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** The shift row of a /shifts/current or /shifts/open reply (older servers sent the row itself). */
function shiftRowOf(res: ApiShiftSummary | null): ApiShiftRecord | null {
  if (!res) return null;
  return res.shift || (res as unknown as ApiShiftRecord);
}

const toCashTransaction = (shiftId: string) => (m: ApiCashMovement): CashTransaction => ({
  id: m.id,
  shiftId,
  type: (m.type || '').toLowerCase() === 'out' ? 'out' : 'in',
  amount: Number(m.amount) || 0,
  reason: m.reason || '',
  createdAt: m.createdAt,
});

const cacheServerShift = (shift: Shift | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (shift) {
      localStorage.setItem(CURRENT_SHIFT_CACHE_KEY, JSON.stringify(shift));
    } else {
      localStorage.removeItem(CURRENT_SHIFT_CACHE_KEY);
    }
  } catch {}
};

export const useShiftStore = create<ShiftStore>((set, get) => ({
  currentShift: loadCachedShift(),
  cashTransactions: [],


  fetchCurrentShift: async () => {
    try {
      const res = await api.shifts.getCurrent();
      const s = shiftRowOf(res);
      if (res && s && (s.status === 'OPEN' || res.status === 'OPEN')) {
        const cashMovements: CashTransaction[] = Array.isArray(s.cashMovements)
          ? s.cashMovements.map(toCashTransaction(s.id))
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
        cacheServerShift(mapped);
        set({ currentShift: mapped, cashTransactions: cashMovements });
        return mapped;
      } else {
        cacheServerShift(null);
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
      const serverRes = await api.shifts.open(openingCash);
      const s = shiftRowOf(serverRes);
      if (serverRes && s?.id) {
        const cashMovements: CashTransaction[] = Array.isArray(s.cashMovements)
          ? s.cashMovements.map(toCashTransaction(s.id))
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
        cacheServerShift(mapped);
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

    cacheServerShift(null);
    set({ currentShift: null, cashTransactions: [] });
    return closedShift;
  },

  addCashTransaction: async (type: 'in' | 'out', amount: number, reason: string, operationId?: string, purpose?: CashPurposeInput) => {
    const shift = get().currentShift;
    if (!shift?.isOpen) throw new Error('กรุณาเปิดกะบนฐานข้อมูลก่อนทำรายการเงินสด');
    amount = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0.01) throw new Error('จำนวนเงินต้องไม่น้อยกว่า 0.01 บาท');

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
    const serverMovement = await api.shifts.addCashMovement(shift.id, { type, amount: safeAmount, reason, clientMovementId: operationId || newOperationId(), ...(purpose || {}) });
    transaction.id = serverMovement.id;
    if (get().cashTransactions.some(t => t.id === transaction.id)) return;

    const nextTxs = [...get().cashTransactions, transaction];

    set({
      cashTransactions: nextTxs,
      currentShift: updatedShift,
    });
    // the server's figures replace the local projection
    void get().fetchCurrentShift();
  },


  recordSale: (order: Order) => {
    set((state) => {
      const shift = state.currentShift;
      if (!shift || !shift.isOpen) return state;
      let cashAdd = 0;
      let qrAdd = 0;
      let cardAdd = 0;
      let transferAdd = 0;
      let creditAdd = 0;

      for (const p of order.payments) {
        // the server also sends CREDIT_DEBT / CREDIT for credit sales
        const method: string = p.method;
        switch (method) {
          case 'CASH': cashAdd += p.amount; break;
          case 'QR_PROMPTPAY': qrAdd += p.amount; break;
          case 'CREDIT_CARD': cardAdd += p.amount; break;
          case 'TRANSFER': transferAdd += p.amount; break;
          case 'CREDIT_DEBT':
          case 'CREDIT_NOTE':
          case 'CREDIT':
            creditAdd += p.amount;
            break;
        }
      }

      // in memory only: the next fetchCurrentShift() replaces it with the server's totals
      return {
        currentShift: {
          ...shift,
          cashSales: shift.cashSales + cashAdd,
          qrSales: shift.qrSales + qrAdd,
          cardSales: shift.cardSales + cardAdd,
          transferSales: shift.transferSales + transferAdd,
          creditSales: (shift.creditSales || 0) + creditAdd,
          orderCount: shift.orderCount + 1,
        },
      };
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
}));
