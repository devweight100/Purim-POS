'use client';

import { ShiftSummaryData } from '@/components/pos/ShiftSummaryPdfModal';
import { api } from '@/lib/api';

export function mapServerShiftToSummary(s: any): ShiftSummaryData {
  const openingCash = Number(s.openingCash ?? s.startingCash) || 0;
  const cashSales = Number(s.cashSales) || 0;
  const qrSales = Number(s.qrSales ?? s.promptpaySales) || 0;
  const cardSales = Number(s.cardSales ?? s.creditCardSales) || 0;
  const transferSales = Number(s.transferSales) || 0;
  const creditSales = Number(s.creditSales ?? s.debtSales) || 0;
  const totalSales = Number(s.totalSales) || (cashSales + qrSales + cardSales + transferSales + creditSales);
  // cash in other than debt collections (those have their own line); older servers only send cashIn
  const debtCollectionCash = Number(s.debtCollectionCash) || 0;
  const cashIn = s.otherCashIn !== undefined ? Number(s.otherCashIn) || 0 : Number(s.cashIn ?? s.cashInAmount) || 0;
  const cashOut = Number(s.cashOut ?? s.cashOutAmount) || 0;
  const cashRefunds = Number(s.cashRefunds ?? s.cashRefundAmount) || 0;
  const claimRefundCount = Number(s.claimRefundCount) || 0;
  const expectedCash =
    s.expectedCash !== undefined
      ? Number(s.expectedCash)
      : openingCash + cashSales + cashIn - cashOut - cashRefunds;
  // an open shift has no counted cash yet (server sends null); keep a number for list arithmetic
  const isOpen = s.isOpen ?? (s.shiftStatus ?? s.status) === 'OPEN';
  const actualCash =
    s.actualCash !== undefined && s.actualCash !== null
      ? Number(s.actualCash)
      : expectedCash;

  return {
    shiftId: s.shiftCode || s.shiftNumber || s.shiftId || s.id,
    shiftCode: s.shiftCode || s.code || s.shiftNumber || undefined,
    status: s.status,
    isOpen: !!isOpen,
    cashInExcludesDebt: s.otherCashIn !== undefined,
    userId: s.userId,
    userName: s.userName || s.user?.fullName || 'พนักงานขาย',
    openedAt: s.openedAt,
    // open shift: no closing time; sorted / bucketed by its opening time
    closedAt: s.closedAt || s.openedAt || new Date().toISOString(),
    openingCash,
    cashSales,
    qrSales,
    cardSales,
    transferSales,
    creditSales,
    totalSales,
    debtCollectionCount: s.debtCollectionCount,
    debtCollectionTotal: s.debtCollectionTotal,
    debtCollectionCash,
    debtCollectionQrTransfer: s.debtCollectionQrTransfer,
    returnsTotal: Number(s.returnsTotal) || 0,
    returnCount: Number(s.returnCount) || 0,
    netSales: s.netSales !== undefined ? Number(s.netSales) : totalSales,
    returnRefundAmount: Number(s.returnRefundAmount) || 0,
    returnRefundCount: Number(s.returnRefundCount) || 0,
    voidRefundAmount: Number(s.voidRefundAmount) || 0,
    voidRefundCount: Number(s.voidRefundCount) || 0,
    claimRefundAmount: s.claimRefundAmount !== undefined ? Number(s.claimRefundAmount) || 0 : cashRefunds,
    cashIn,
    cashOut,
    cashRefunds,
    claimRefundCount,
    orderCount: Number(s.orderCount ?? s.ordersCount) || 0,
    voidCount: Number(s.voidCount) || 0,
    expectedCash,
    actualCash,
    // server: line + bill discounts (points redemptions are part of the bill discount)
    billDiscountsTotal: s.discountTotal !== undefined ? Number(s.discountTotal) || 0 : s.billDiscountsTotal,
    pointsDiscountsTotal: s.discountTotal !== undefined ? 0 : s.pointsDiscountsTotal,
    bankAccountBreakdown: s.bankAccountBreakdown,
  };
}

/** Last shift history the server returned in this session (memory only, never localStorage). */
let lastServerSummaries: ShiftSummaryData[] = [];

/**
 * Shift summaries from the server (/shifts/history). Throws when the server cannot be reached.
 */
export async function fetchShiftSummaries(limit = 100, search?: string): Promise<ShiftSummaryData[]> {
  const res = await api.shifts.getHistory(1, limit, search);
  const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : null;
  if (!rows) throw new Error('ข้อมูลประวัติกะจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  const mapped = rows
    .map(mapServerShiftToSummary)
    .sort((a: ShiftSummaryData, b: ShiftSummaryData) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
  if (!search) lastServerSummaries = mapped;
  return mapped;
}

/**
 * Shift summaries the server returned most recently in this session, plus a background refresh.
 */
export function loadAllShiftSummaries(): ShiftSummaryData[] {
  if (typeof window === 'undefined') return [];
  void fetchShiftSummaries().catch(() => {});
  return lastServerSummaries;
}
