'use client';

import { ShiftSummaryData } from '@/components/pos/ShiftSummaryPdfModal';
import { Shift } from '@/lib/types';

export const STORAGE_KEY_SHIFT_SUMMARIES = 'pos_shift_summaries_history';

// Mock/Initial sample shifts if no real shift has been closed yet
const getMockShiftSummaries = (): ShiftSummaryData[] => {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  return [
    {
      shiftId: 'SHIFT-20260830-01',
      userName: 'สมศรี มีทรัพย์ (แคชเชียร์ 1)',
      openedAt: `${todayStr}T08:00:00.000Z`,
      closedAt: `${todayStr}T14:30:00.000Z`,
      openingCash: 1000,
      cashSales: 4520,
      qrSales: 3150,
      cardSales: 0,
      transferSales: 890,
      creditSales: 0,
      totalSales: 8560,
      debtCollectionCount: 1,
      debtCollectionTotal: 500,
      debtCollectionCash: 500,
      debtCollectionQrTransfer: 0,
      cashIn: 0,
      cashOut: 200,
      cashRefunds: 0,
      claimRefundCount: 0,
      orderCount: 24,
      voidCount: 0,
      expectedCash: 5820, // 1000 + 4520 + 500 - 200
      actualCash: 5820,
      billDiscountsTotal: 120,
      pointsDiscountsTotal: 50,
      bankAccountBreakdown: [
        { accountLabel: 'กสิกรไทย (095-2-84721-3) - ร้านปุริม', amount: 4040 }
      ]
    },
    {
      shiftId: 'SHIFT-20260829-02',
      userName: 'วิชัย การค้า (แคชเชียร์ 2)',
      openedAt: `${yesterdayStr}T15:00:00.000Z`,
      closedAt: `${yesterdayStr}T22:15:00.000Z`,
      openingCash: 1000,
      cashSales: 6840,
      qrSales: 4200,
      cardSales: 1500,
      transferSales: 0,
      creditSales: 0,
      totalSales: 12540,
      debtCollectionCount: 0,
      debtCollectionTotal: 0,
      debtCollectionCash: 0,
      debtCollectionQrTransfer: 0,
      cashIn: 500,
      cashOut: 350,
      cashRefunds: 0,
      claimRefundCount: 0,
      orderCount: 38,
      voidCount: 1,
      expectedCash: 7990, // 1000 + 6840 + 500 - 350
      actualCash: 8000, // เกิน 10 บาท
      billDiscountsTotal: 180,
      pointsDiscountsTotal: 100,
      bankAccountBreakdown: [
        { accountLabel: 'กสิกรไทย (095-2-84721-3) - ร้านปุริม', amount: 4200 }
      ]
    },
    {
      shiftId: 'SHIFT-20260829-01',
      userName: 'สมศรี มีทรัพย์ (แคชเชียร์ 1)',
      openedAt: `${yesterdayStr}T08:00:00.000Z`,
      closedAt: `${yesterdayStr}T15:00:00.000Z`,
      openingCash: 1000,
      cashSales: 5120,
      qrSales: 2800,
      cardSales: 0,
      transferSales: 600,
      creditSales: 0,
      totalSales: 8520,
      debtCollectionCount: 0,
      debtCollectionTotal: 0,
      debtCollectionCash: 0,
      debtCollectionQrTransfer: 0,
      cashIn: 0,
      cashOut: 0,
      cashRefunds: 0,
      claimRefundCount: 0,
      orderCount: 29,
      voidCount: 0,
      expectedCash: 6120,
      actualCash: 6120,
      billDiscountsTotal: 90,
      pointsDiscountsTotal: 0,
      bankAccountBreakdown: [
        { accountLabel: 'กสิกรไทย (095-2-84721-3) - ร้านปุริม', amount: 3400 }
      ]
    }
  ];
};

/**
 * Load all shift closure summaries from localStorage
 */
export function loadAllShiftSummaries(): ShiftSummaryData[] {
  if (typeof window === 'undefined') return getMockShiftSummaries();

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHIFT_SUMMARIES);
    if (raw) {
      const parsed: ShiftSummaryData[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
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
          shiftId: s.id,
          userName: s.userName || 'พนักงานขาย',
          openedAt: s.openedAt,
          closedAt: s.closedAt || new Date().toISOString(),
          openingCash: s.openingCash || 0,
          cashSales: s.cashSales || 0,
          qrSales: s.qrSales || 0,
          cardSales: s.cardSales || 0,
          transferSales: s.transferSales || 0,
          creditSales: s.creditSales || 0,
          totalSales: (s.cashSales || 0) + (s.qrSales || 0) + (s.cardSales || 0) + (s.transferSales || 0),
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

    // Default mock data for presentation and initial testing
    const defaultMocks = getMockShiftSummaries();
    localStorage.setItem(STORAGE_KEY_SHIFT_SUMMARIES, JSON.stringify(defaultMocks));
    return defaultMocks;
  } catch (error) {
    console.error('Failed to load shift summaries:', error);
    return getMockShiftSummaries();
  }
}

/**
 * Save a new shift summary into history
 */
export function saveShiftSummary(summary: ShiftSummaryData): void {
  if (typeof window === 'undefined') return;

  try {
    const list = loadAllShiftSummaries();
    // Prepend new summary, remove duplicates by shiftId
    const nextList = [summary, ...list.filter((s) => s.shiftId !== summary.shiftId)].slice(0, 100);
    localStorage.setItem(STORAGE_KEY_SHIFT_SUMMARIES, JSON.stringify(nextList));
    localStorage.setItem('pos_last_shift_summary', JSON.stringify(summary));
  } catch (error) {
    console.error('Failed to save shift summary:', error);
  }
}
