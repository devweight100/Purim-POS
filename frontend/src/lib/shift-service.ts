'use client';

import { ShiftSummaryData } from '@/components/pos/ShiftSummaryPdfModal';
import { Shift } from '@/lib/types';
import { api } from '@/lib/api';

export const STORAGE_KEY_SHIFT_SUMMARIES = 'pos_shift_summaries_history';

// Mock/Initial sample shifts - cleaned (return empty array)
const getMockShiftSummaries = (): ShiftSummaryData[] => {
  return [];
};

export function mapServerShiftToSummary(s: any): ShiftSummaryData {
  const openingCash = Number(s.openingCash ?? s.startingCash) || 0;
  const cashSales = Number(s.cashSales) || 0;
  const qrSales = Number(s.qrSales ?? s.promptpaySales) || 0;
  const cardSales = Number(s.cardSales ?? s.creditCardSales) || 0;
  const transferSales = Number(s.transferSales) || 0;
  const creditSales = Number(s.creditSales ?? s.debtSales) || 0;
  const totalSales = Number(s.totalSales) || (cashSales + qrSales + cardSales + transferSales + creditSales);
  const cashIn = Number(s.cashIn ?? s.cashInAmount) || 0;
  const cashOut = Number(s.cashOut ?? s.cashOutAmount) || 0;
  const cashRefunds = Number(s.cashRefunds ?? s.cashRefundAmount) || 0;
  const claimRefundCount = Number(s.claimRefundCount) || 0;
  const expectedCash =
    s.expectedCash !== undefined
      ? Number(s.expectedCash)
      : openingCash + cashSales + cashIn - cashOut - cashRefunds;
  const actualCash =
    s.actualCash !== undefined && s.actualCash !== null
      ? Number(s.actualCash)
      : expectedCash;

  return {
    shiftId: s.shiftNumber || s.shiftId || s.id,
    userId: s.userId,
    userName: s.userName || s.user?.fullName || 'พนักงานขาย',
    openedAt: s.openedAt,
    closedAt: s.closedAt || new Date().toISOString(),
    openingCash,
    cashSales,
    qrSales,
    cardSales,
    transferSales,
    creditSales,
    totalSales,
    debtCollectionCount: s.debtCollectionCount,
    debtCollectionTotal: s.debtCollectionTotal,
    debtCollectionCash: s.debtCollectionCash,
    debtCollectionQrTransfer: s.debtCollectionQrTransfer,
    cashIn,
    cashOut,
    cashRefunds,
    claimRefundCount,
    orderCount: Number(s.orderCount ?? s.ordersCount) || 0,
    voidCount: Number(s.voidCount) || 0,
    expectedCash,
    actualCash,
    billDiscountsTotal: s.billDiscountsTotal,
    pointsDiscountsTotal: s.pointsDiscountsTotal,
    bankAccountBreakdown: s.bankAccountBreakdown,
  };
}

function readOfflineCachedShiftSummaries(): ShiftSummaryData[] {
  if (typeof window === 'undefined') return getMockShiftSummaries();

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHIFT_SUMMARIES);
    if (raw) {
      const parsed: ShiftSummaryData[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
      }
    }

    // If pos_shift_summaries_history is not set yet, check pos_last_shift_summary
    const lastRaw = localStorage.getItem('pos_last_shift_summary');
    if (lastRaw) {
      const lastSummary: ShiftSummaryData = JSON.parse(lastRaw);
      const mocks = getMockShiftSummaries();
      const combined = [lastSummary, ...mocks.filter((m) => m.shiftId !== lastSummary.shiftId)];
      localStorage.setItem(STORAGE_KEY_SHIFT_SUMMARIES, JSON.stringify(combined));
      return combined;
    }

    // Check pos_shifts_history from shift-store
    const oldHistoryRaw = localStorage.getItem('pos_shifts_history');
    if (oldHistoryRaw) {
      const oldShifts: Shift[] = JSON.parse(oldHistoryRaw);
      if (Array.isArray(oldShifts) && oldShifts.length > 0) {
        const converted: ShiftSummaryData[] = oldShifts.map((s) => ({
          shiftId: s.shiftId || s.id,
          userId: s.userId,
          userName: s.userName || 'พนักงานขาย',
          openedAt: s.openedAt,
          closedAt: s.closedAt || new Date().toISOString(),
          openingCash: s.openingCash || 0,
          cashSales: s.cashSales || 0,
          qrSales: s.qrSales || 0,
          cardSales: s.cardSales || 0,
          transferSales: s.transferSales || 0,
          creditSales: s.creditSales || 0,
          totalSales: (s.cashSales || 0) + (s.qrSales || 0) + (s.cardSales || 0) + (s.transferSales || 0) + (s.creditSales || 0),
          cashIn: s.cashIn || 0,
          cashOut: s.cashOut || 0,
          cashRefunds: s.cashRefunds || 0,
          claimRefundCount: s.claimRefundCount || 0,
          orderCount: s.orderCount || 0,
          voidCount: s.voidCount || 0,
          expectedCash: (s.openingCash || 0) + (s.cashSales || 0) + (s.cashIn || 0) - (s.cashOut || 0) - (s.cashRefunds || 0),
          actualCash: (s as any).actualCash !== undefined ? (s as any).actualCash : ((s.openingCash || 0) + (s.cashSales || 0) + (s.cashIn || 0) - (s.cashOut || 0) - (s.cashRefunds || 0)),
        }));
        localStorage.setItem(STORAGE_KEY_SHIFT_SUMMARIES, JSON.stringify(converted));
        return converted;
      }
    }

    return getMockShiftSummaries();
  } catch (error) {
    console.error('Failed to load shift summaries from offline cache:', error);
    return getMockShiftSummaries();
  }
}

/**
 * Fetch shift summaries from backend (/shifts/history) first, using localStorage only as an offline cache mirror.
 */
export async function fetchShiftSummaries(limit = 100, search?: string): Promise<ShiftSummaryData[]> {
  try {
    const res = await api.shifts.getHistory(1, limit, search);
    const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : null;
    if (rows) {
      const mapped = rows
        .map(mapServerShiftToSummary)
        .sort((a: ShiftSummaryData, b: ShiftSummaryData) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
      if (typeof window !== 'undefined' && !search) {
        try {
          localStorage.setItem(STORAGE_KEY_SHIFT_SUMMARIES, JSON.stringify(mapped));
        } catch {}
      }
      return mapped;
    }
  } catch (err) {
    console.warn('[ShiftService] Failed to fetch shift history from backend, falling back to local cache:', err);
  }
  return readOfflineCachedShiftSummaries();
}

/**
 * Load all shift closure summaries (refreshes from backend /shifts/history in background and returns cached mirror)
 */
export function loadAllShiftSummaries(): ShiftSummaryData[] {
  if (typeof window === 'undefined') return getMockShiftSummaries();
  void fetchShiftSummaries().catch(() => {});
  return readOfflineCachedShiftSummaries();
}

/**
 * Save a new shift summary into offline cache mirror
 */
export function saveShiftSummary(summary: ShiftSummaryData): void {
  if (typeof window === 'undefined') return;

  try {
    const list = readOfflineCachedShiftSummaries();
    // Prepend new summary, remove duplicates by shiftId
    const nextList = [summary, ...list.filter((s) => s.shiftId !== summary.shiftId)].slice(0, 100);
    localStorage.setItem(STORAGE_KEY_SHIFT_SUMMARIES, JSON.stringify(nextList));
    localStorage.setItem('pos_last_shift_summary', JSON.stringify(summary));
  } catch (error) {
    console.error('Failed to save shift summary:', error);
  }
}
