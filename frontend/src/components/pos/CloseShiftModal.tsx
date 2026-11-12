import { useState, useEffect } from 'react';
import { useHasChanged } from '@/lib/pos/use-has-changed';
import { useShiftStore } from '@/lib/store/shift-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogOut, Calculator, Coins, Unlock } from 'lucide-react';
import { CountCashModal } from './CountCashModal';
import { ShiftSummaryPdfModal, ShiftSummaryData, BankAccountBreakdownItem } from './ShiftSummaryPdfModal';
import { loadBankAccounts } from '@/lib/bank-account-storage';
import { getShiftDebtCollections } from '@/lib/debt-service';
import { mapServerShiftToSummary } from '@/lib/shift-service';
import { api } from '@/lib/api';
import { kickCashDrawer } from '@/lib/cash-drawer-service';
import { toast } from 'sonner';
import type { ApiShiftLike } from '@/lib/types';

interface CloseShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CloseShiftModal({ open, onOpenChange }: CloseShiftModalProps) {
  const { currentShift, closeShift, getExpectedCash, getTotalSales } = useShiftStore();

  const [actualCash, setActualCash] = useState<number | null>(null);
  const [showCountCashModal, setShowCountCashModal] = useState(false);

  // PDF Shift Summary Report Modal State
  const [summaryData, setSummaryData] = useState<ShiftSummaryData | null>(null);
  const [showSummaryPdf, setShowSummaryPdf] = useState(false);

  // Reset the form when the dialog opens or closes
  const openChanged = useHasChanged(open);
  if (openChanged) {
    setActualCash(null);
    setShowCountCashModal(false);
    // NOTE: do not hide the shift summary on close: closing this dialog is exactly when it is shown
    if (open) setShowSummaryPdf(false);
  }

  // Fetch live shift data when the dialog opens
  useEffect(() => {
    if (open) void useShiftStore.getState().fetchCurrentShift();
  }, [open]);

  // When a shift is active or newly opened, ensure old summary PDF popup is cleared
  const shiftChanged = useHasChanged(`${currentShift?.id}|${currentShift?.isOpen}`);
  if (shiftChanged && currentShift?.isOpen) {
    setShowSummaryPdf(false);
    setSummaryData(null);
  }

  const expectedCash = getExpectedCash();
  const diff = actualCash !== null ? actualCash - expectedCash : 0;
  // counted cash must be a real amount >= 0 (the server rejects anything else)
  const actualCashValid = actualCash !== null && Number.isFinite(actualCash) && actualCash >= 0;

  const handleCloseShift = async () => {
    if (!currentShift) return;
    if (!actualCashValid) {
      toast.error('กรุณาระบุยอดเงินสดที่นับได้เป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      return;
    }

    const finalActualCash = Math.round((actualCash as number) * 100) / 100;
    const closedTime = new Date().toISOString();

    // Bills are not kept on this device; the slip is filled from the server's shift summary
    // below (this local draft is only used when the summary cannot be read).
    const shiftStartTime = new Date(currentShift.openedAt).getTime();

    const availableBanks = loadBankAccounts();
    const defaultBankLabel = availableBanks.length > 0
      ? `${availableBanks[0].bankName} (${availableBanks[0].accountNumber})`
      : 'บัญชีโอนเงิน / QR (หลัก)';

    // QR / transfer sales of the shift, shown under the default bank account
    const totalQrTransferSales = (currentShift.qrSales || 0) + (currentShift.transferSales || 0);
    const bankAccountBreakdown: BankAccountBreakdownItem[] = totalQrTransferSales > 0
      ? [{ accountLabel: defaultBankLabel, amount: totalQrTransferSales }]
      : [];

    // Discount totals and credit sales come from the server's summary below
    const billDiscountsTotal = 0;
    const pointsDiscountsTotal = 0;
    const finalCreditSales = currentShift.creditSales !== undefined && currentShift.creditSales > 0
      ? currentShift.creditSales
      : 0;

    // Calculate Debt Payment Collections made during shift
    const debtCollections = getShiftDebtCollections(shiftStartTime, new Date(closedTime).getTime());

    let dataForReport: ShiftSummaryData = {
      shiftId: currentShift.shiftId || currentShift.shiftNumber || currentShift.id,
      userName: currentShift.userName || 'พนักงานขาย',
      openedAt: currentShift.openedAt,
      closedAt: closedTime,
      openingCash: currentShift.openingCash || 0,
      cashSales: currentShift.cashSales || 0,
      qrSales: currentShift.qrSales || 0,
      cardSales: currentShift.cardSales || 0,
      transferSales: currentShift.transferSales || 0,
      creditSales: finalCreditSales,
      totalSales: getTotalSales(),
      debtCollectionCount: debtCollections.count,
      debtCollectionTotal: debtCollections.total,
      debtCollectionCash: debtCollections.cashTotal,
      debtCollectionQrTransfer: debtCollections.qrTransferTotal,
      cashIn: currentShift.cashIn || 0,
      cashOut: currentShift.cashOut || 0,
      cashRefunds: currentShift.cashRefunds || 0,
      claimRefundCount: currentShift.claimRefundCount || 0,
      orderCount: currentShift.orderCount || 0,
      voidCount: currentShift.voidCount || 0,
      expectedCash: expectedCash,
      actualCash: finalActualCash,
      billDiscountsTotal,
      pointsDiscountsTotal,
      bankAccountBreakdown: bankAccountBreakdown,
    };

    try { await closeShift(finalActualCash); }
    catch (error) { toast.error('ปิดกะไม่ได้: ' + (error instanceof Error ? error.message : String(error))); return; }
    onOpenChange(false);

    // The server's figures for the closed shift (discounts, debt collections, returns, voids) win
    try {
      const srv = await api.shifts.getSummary(currentShift.id);
      if (srv?.shift) {
        const { shift, ...figures } = srv;
        // the raw shift row carries Decimal strings; mapServerShiftToSummary converts every figure with Number()
        const flat: ApiShiftLike = { ...(shift as unknown as ApiShiftLike), ...figures, userName: dataForReport.userName };
        const fromServer = mapServerShiftToSummary(flat);
        dataForReport = { ...fromServer, bankAccountBreakdown: dataForReport.bankAccountBreakdown, isOpen: false };
      }
    } catch {
      // offline: keep the figures computed on this terminal
    }


    setSummaryData(dataForReport);
    setShowSummaryPdf(true);
    toast.success('🔒 ปิดกะเรียบร้อยแล้ว แสดงใบสรุปปิดกะ (PDF Slip)');

    setActualCash(null);
  };

  return (
    <>
      {currentShift && (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-[500px] bg-white border-slate-200 text-slate-900 rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-rose-600 flex items-center gap-2">
              <LogOut className="w-5 h-5 text-rose-600" />
              <span>ปิดกะการขาย (Close Shift)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-4">
            
            <div className="grid grid-cols-2 gap-3 text-xs font-semibold">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <p className="text-slate-500">พนักงานขาย</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{currentShift.userName}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <p className="text-slate-500">จำนวนบิลขาย</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{currentShift.orderCount} บิล</p>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3 text-xs sm:text-sm font-medium">
              <div className="flex justify-between">
                <span className="text-slate-600">เงินสดตั้งต้น (เปิดกะ)</span>
                <span className="font-bold text-slate-900">{formatCurrency(currentShift.openingCash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">ยอดขายเงินสด</span>
                <span className="text-emerald-700 font-bold">+{formatCurrency(currentShift.cashSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">เงินเข้าลิ้นชัก (Cash In)</span>
                <span className="text-emerald-700 font-bold">+{formatCurrency(currentShift.cashIn)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">เงินออกลิ้นชัก (Cash Out)</span>
                <span className="text-rose-600 font-bold">-{formatCurrency(currentShift.cashOut)}</span>
              </div>
              {currentShift.cashRefunds !== undefined && currentShift.cashRefunds > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">คืนเงินสดเคลม ({currentShift.claimRefundCount || 1} ครั้ง)</span>
                  <span className="text-rose-600 font-bold">-{formatCurrency(currentShift.cashRefunds)}</span>
                </div>
              )}
            </div>

            {/* Expected Cash Drawer Display */}
            <div className="bg-sky-50/70 p-4 rounded-2xl border border-sky-200 text-center space-y-0.5 shadow-xs">
              <p className="text-sky-800 text-xs font-bold">เงินสดที่ควรมีในลิ้นชัก</p>
              <p className="text-3xl font-black text-sky-600 tracking-tight font-mono">{formatCurrency(expectedCash)}</p>
            </div>

            {/* Input Actual Counted Cash & Calculator Count Button */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>ระบุยอดเงินสดที่นับได้จริง (บาท)</span>
                <span className="text-[11px] text-sky-600 font-normal">กดปุ่มเครื่องคิดเลขเพื่อนับแยกตามแบงค์/เหรียญ</span>
              </label>

              <div className="flex gap-2">
                {/* Input Box (Circled in black) */}
                <Input
                  type="number"
                  value={actualCash === null ? '' : actualCash}
                  min={0}
                  step="0.01"
                  onChange={(e) => setActualCash(e.target.value !== '' ? parseFloat(e.target.value) : null)}
                  className="bg-slate-50 border-slate-300 h-13 text-xl font-black text-slate-900 rounded-xl focus:bg-white font-mono text-center flex-1 shadow-inner"
                  placeholder="0.00"
                />

                {/* Calculator Button for Counting Banknotes/Coins (Circled in red) */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCountCashModal(true)}
                  className="h-13 w-13 shrink-0 border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:border-sky-400 rounded-xl shadow-xs transition-all"
                  title="คลิกเพื่อนับแบงค์และเหรียญเหมือนตอนเปิดกะ"
                >
                  <Coins className="w-6 h-6 text-sky-600" />
                </Button>

                {/* Open Drawer Button */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const res = await kickCashDrawer({ reason: 'เปิดลิ้นชักเพื่อนับเงินปิดกะ' });
                    if (res.success) {
                      toast.success(`🔓 สั่งเปิดลิ้นชักเรียบร้อย (${res.printer || 'เครื่องพิมพ์สลิป'})`);
                    } else {
                      toast.error(`⚠️ ไม่สามารถเปิดลิ้นชักได้: ${res.error || 'ตรวจสอบเครื่องพิมพ์'}`);
                    }
                  }}
                  className="h-13 w-13 shrink-0 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 rounded-xl shadow-xs transition-all cursor-pointer"
                  title="คลิกเพื่อสั่งเด้งเปิดลิ้นชักเก็บเงิน"
                >
                  <Unlock className="w-6 h-6 text-amber-600" />
                </Button>
              </div>

              {actualCash !== null && !actualCashValid && (
                <div className="p-3 rounded-xl border bg-rose-50 border-rose-300 text-rose-800 text-xs font-bold">
                  ยอดเงินสดที่นับได้ต้องเป็นตัวเลขตั้งแต่ 0 บาทขึ้นไป
                </div>
              )}

              {/* Difference Status Badge */}
              {actualCashValid && (
                <div className={`p-3 rounded-xl border flex justify-between items-center text-xs font-bold transition-all ${
                  diff === 0 
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800' 
                    : diff > 0 
                    ? 'bg-sky-50 border-sky-300 text-sky-800' 
                    : 'bg-rose-50 border-rose-300 text-rose-800'
                }`}>
                  <span>{diff === 0 ? '✅ ยอดเงินสดในลิ้นชักพอดี' : diff > 0 ? '🔵 เงินสดในลิ้นชักเกิน' : '🔴 เงินสดในลิ้นชักขาด'}</span>
                  <span className="text-base font-black font-mono">{formatCurrency(Math.abs(diff))}</span>
                </div>
              )}
            </div>

          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-12 border-slate-300 text-slate-700 font-bold rounded-xl"
              onClick={() => onOpenChange(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white font-black text-base rounded-xl shadow-md"
              onClick={handleCloseShift}
              disabled={!actualCashValid}
            >
              ยืนยันปิดกะ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      )}

      {/* POSPOS Banknote & Coin Count Modal for Close Shift */}
      <CountCashModal
        open={showCountCashModal}
        onOpenChange={setShowCountCashModal}
        onConfirm={(totalCalculatedCash) => {
          setActualCash(totalCalculatedCash);
          toast.success(`นับยอดเงินสดรวมได้ ${formatCurrency(totalCalculatedCash)}`);
        }}
      />

      {/* PDF Shift Summary Slip Preview Modal */}
      {/* Rendered only while shown: removing it at once on close avoids the dialog staying stuck
          in its closing state on top of the POS screen (could not be closed after a shift ended). */}
      {summaryData && showSummaryPdf && (
        <ShiftSummaryPdfModal
          open={showSummaryPdf}
          onOpenChange={(isOpen) => {
            setShowSummaryPdf(isOpen);
            if (!isOpen) {
              setSummaryData(null);
            }
          }}
          data={summaryData}
        />
      )}
    </>
  );
}
