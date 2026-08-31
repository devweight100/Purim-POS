'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  History, Clock, Calendar, Search, Filter, Printer, Eye, 
  Coins, CheckCircle2, AlertTriangle, ArrowUpRight, ArrowDownRight, 
  RefreshCw, FileText, ShoppingCart, User, ChevronRight, Layers
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { useShiftStore } from '@/lib/store/shift-store';
import { ShiftSummaryData, ShiftSummaryPdfModal } from '@/components/pos/ShiftSummaryPdfModal';
import { loadAllShiftSummaries } from '@/lib/shift-service';

export default function ShiftsHistoryPage() {
  const [shifts, setShifts] = useState<ShiftSummaryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'YESTERDAY' | '7DAYS' | '30DAYS' | 'CUSTOM'>('ALL');
  const [customDate, setCustomDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'BALANCED' | 'SHORT' | 'OVER'>('ALL');

  // Modal state for reprinting shift summary slip
  const [selectedShiftForSlip, setSelectedShiftForSlip] = useState<ShiftSummaryData | null>(null);
  const [isSlipModalOpen, setIsSlipModalOpen] = useState(false);

  // Active current shift in store
  const { currentShift, isShiftOpen } = useShiftStore();

  const fetchShifts = () => {
    setLoading(true);
    try {
      const data = loadAllShiftSummaries();
      setShifts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShifts();
  }, []);

  // Filter shifts based on Date, Search, and Status
  const filteredShifts = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yesterday = yest.toISOString().split('T')[0];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return shifts.filter((s) => {
      // 1. Date Filter
      const shiftDate = s.closedAt ? s.closedAt.split('T')[0] : s.openedAt.split('T')[0];

      if (dateFilter === 'TODAY' && shiftDate !== today) return false;
      if (dateFilter === 'YESTERDAY' && shiftDate !== yesterday) return false;
      if (dateFilter === '7DAYS' && new Date(shiftDate) < sevenDaysAgo) return false;
      if (dateFilter === '30DAYS' && new Date(shiftDate) < thirtyDaysAgo) return false;
      if (dateFilter === 'CUSTOM' && customDate && shiftDate !== customDate) return false;

      // 2. Status Filter
      const diff = s.actualCash - s.expectedCash;
      if (statusFilter === 'BALANCED' && diff !== 0) return false;
      if (statusFilter === 'SHORT' && diff >= 0) return false;
      if (statusFilter === 'OVER' && diff <= 0) return false;

      // 3. Search Filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchId = s.shiftId.toLowerCase().includes(q);
        const matchUser = s.userName.toLowerCase().includes(q);
        if (!matchId && !matchUser) return false;
      }

      return true;
    });
  }, [shifts, dateFilter, customDate, statusFilter, search]);

  // Group filtered shifts by Calendar Day (Date string 'YYYY-MM-DD')
  const groupedByDay = useMemo(() => {
    const map = new Map<string, ShiftSummaryData[]>();

    filteredShifts.forEach((s) => {
      const dateKey = s.closedAt ? s.closedAt.split('T')[0] : s.openedAt.split('T')[0];
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(s);
    });

    // Sort days descending (most recent date first)
    const sortedDays = Array.from(map.entries()).sort(
      ([dayA], [dayB]) => new Date(dayB).getTime() - new Date(dayA).getTime()
    );

    return sortedDays.map(([dateKey, dayShifts]) => {
      // Within each day, sort shifts chronologically to determine round 1, round 2
      const sortedShifts = [...dayShifts].sort(
        (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
      );

      const totalSalesDay = sortedShifts.reduce((sum, s) => sum + (s.totalSales || 0), 0);
      const totalCashSalesDay = sortedShifts.reduce((sum, s) => sum + (s.cashSales || 0), 0);
      const totalDiffDay = sortedShifts.reduce((sum, s) => sum + (s.actualCash - s.expectedCash), 0);

      return {
        dateKey,
        shifts: sortedShifts,
        roundsCount: sortedShifts.length,
        totalSalesDay,
        totalCashSalesDay,
        totalDiffDay,
      };
    });
  }, [filteredShifts]);

  // KPI Metrics Calculation
  const totalRoundsCount = filteredShifts.length;
  const totalSalesOverall = filteredShifts.reduce((sum, s) => sum + (s.totalSales || 0), 0);
  const totalActualCashOverall = filteredShifts.reduce((sum, s) => sum + (s.actualCash || 0), 0);
  const totalDiffOverall = filteredShifts.reduce((sum, s) => sum + (s.actualCash - s.expectedCash), 0);
  const balancedCount = filteredShifts.filter((s) => s.actualCash - s.expectedCash === 0).length;
  const shortCount = filteredShifts.filter((s) => s.actualCash - s.expectedCash < 0).length;
  const overCount = filteredShifts.filter((s) => s.actualCash - s.expectedCash > 0).length;

  const handlePrintSlip = (shift: ShiftSummaryData) => {
    setSelectedShiftForSlip(shift);
    setIsSlipModalOpen(true);
  };

  const formatThaiDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('th-TH', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatTimeRange = (openStr: string, closeStr: string) => {
    try {
      const openD = new Date(openStr);
      const closeD = new Date(closeStr);
      const openTime = openD.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const closeTime = closeD.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

      const diffMinutes = Math.round((closeD.getTime() - openD.getTime()) / (1000 * 60));
      const hours = Math.floor(diffMinutes / 60);
      const mins = diffMinutes % 60;
      const duration = hours > 0 ? `${hours} ชม. ${mins} นาที` : `${mins} นาที`;

      return {
        openTime,
        closeTime,
        duration,
      };
    } catch {
      return { openTime: openStr, closeTime: closeStr, duration: '' };
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      {/* ─── HEADER ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                ประวัติการปิดกะ (Shift History)
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                ตรวจสอบผลการปิดกะแต่ละวัน สรุปยอดเงินสดลิ้นชัก ยอดขาด/เกิน และพิมพ์ใบสรุปปิดกะซ้ำ
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Active Shift Indicator */}
          {isShiftOpen() && (
            <div className="bg-emerald-50 border border-emerald-200 px-3.5 py-1.5 rounded-2xl flex items-center gap-2 text-xs text-emerald-800 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>กะปัจจุบัน: {currentShift?.userName} (กำลังเปิดอยู่)</span>
              <Link href="/pos" className="underline text-emerald-900 ml-1 hover:text-emerald-700">
                ไปที่หน้าขาย
              </Link>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchShifts}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 h-10 px-3.5 text-xs font-semibold shadow-2xs rounded-2xl gap-1.5"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>รีเฟรช</span>
          </Button>

          <Link href="/pos">
            <Button
              size="sm"
              className="bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs h-10 px-4 rounded-2xl shadow-xs gap-1.5"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>เปิดหน้าขาย (Purim POS)</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* ─── TOP KPI STATS ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Card 1: Total Closed Shifts */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
              <History className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-indigo-950">รอบการปิดกะ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-indigo-700 tracking-tight">
              {totalRoundsCount}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">รอบ</span>
          </div>
        </div>

        {/* Card 2: Total Sales Across Shifts */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
              <Coins className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-emerald-950">ยอดขายรวม:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-emerald-700 tracking-tight">
              {formatCurrency(totalSalesOverall)}
            </span>
          </div>
        </div>

        {/* Card 3: Accuracy Breakdown */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-sky-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-sky-50 text-sky-600 rounded-md border border-sky-100 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-sky-950">ความถูกต้อง:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-emerald-600 tracking-tight">
              {balancedCount}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">รอบตรง</span>
            {(shortCount > 0 || overCount > 0) && (
              <span className="text-xs font-bold text-rose-600 font-sans ml-1">
                ({shortCount > 0 && `ขาด ${shortCount}`}{overCount > 0 && ` เกิน ${overCount}`})
              </span>
            )}
          </div>
        </div>

        {/* Card 4: Net Cash Discrepancy */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1 rounded-md shrink-0 border ${
              totalDiffOverall === 0 
                ? 'bg-slate-100 text-slate-600 border-slate-200' 
                : totalDiffOverall > 0 
                ? 'bg-sky-50 text-sky-700 border-sky-200' 
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-900">เงินขาด/เกินสุทธิ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className={`text-lg sm:text-xl font-black tracking-tight ${
              totalDiffOverall === 0 
                ? 'text-slate-800' 
                : totalDiffOverall > 0 
                ? 'text-sky-700' 
                : 'text-rose-600'
            }`}>
              {totalDiffOverall > 0 ? `+${formatCurrency(totalDiffOverall)}` : formatCurrency(totalDiffOverall)}
            </span>
          </div>
        </div>
      </div>

      {/* ─── FILTERS BAR ─── */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="ค้นหาชื่อพนักงานแคชเชียร์, หรือรหัสกะ (SHIFT-...)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-11 text-xs bg-slate-50 border-slate-200 rounded-2xl"
          />
        </div>

        {/* Quick Date Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="h-11 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700"
          >
            <option value="ALL">📅 ทุกช่วงวันที่</option>
            <option value="TODAY">วันนี้</option>
            <option value="YESTERDAY">เมื่อวาน</option>
            <option value="7DAYS">7 วันล่าสุด</option>
            <option value="30DAYS">30 วันล่าสุด</option>
            <option value="CUSTOM">เลือกวันที่เฉพาะ...</option>
          </select>

          {dateFilter === 'CUSTOM' && (
            <Input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="h-11 text-xs bg-slate-50 border-slate-200 rounded-2xl w-40"
            />
          )}

          {/* Status Discrepancy Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-11 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700"
          >
            <option value="ALL">ทุกผลการปิดกะ</option>
            <option value="BALANCED">✓ เงินตรงพอดี</option>
            <option value="SHORT">⚠️ เงินขาด</option>
            <option value="OVER">ℹ️ เงินเกิน</option>
          </select>
        </div>
      </div>

      {/* ─── DAILY SHIFTS LIST ─── */}
      {groupedByDay.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 space-y-3 shadow-2xs">
          <History className="w-12 h-12 text-slate-300 mx-auto" />
          <p className="text-base font-bold text-slate-700">ไม่พบประวัติการปิดกะตามเงื่อนไขที่เลือก</p>
          <p className="text-xs text-slate-400">
            ลองปรับเปลี่ยนคำค้นหา หรือช่วงวันที่เพื่อดูข้อมูลประวัติกะ
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByDay.map((dayGroup) => (
            <div
              key={dayGroup.dateKey}
              className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden"
            >
              {/* Day Header Banner */}
              <div className="bg-slate-50/80 px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">
                      {formatThaiDate(dayGroup.dateKey)}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-mono">
                      วันที่ {dayGroup.dateKey}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
                  <Badge variant="outline" className="bg-white border-slate-300 text-slate-700 font-bold px-2.5 py-1 text-xs">
                    ปิดกะ {dayGroup.roundsCount} รอบ
                  </Badge>

                  <div className="text-right">
                    <span className="text-[11px] text-slate-500 block">ยอดขายรวมประจำวัน</span>
                    <span className="font-mono text-sm font-black text-emerald-700">
                      {formatCurrency(dayGroup.totalSalesDay)}
                    </span>
                  </div>

                  <div className="text-right pl-3 border-l border-slate-200">
                    <span className="text-[11px] text-slate-500 block">ผลเงินสดสุทธิ</span>
                    <span className={`font-mono text-xs font-bold ${
                      dayGroup.totalDiffDay === 0 
                        ? 'text-emerald-600' 
                        : dayGroup.totalDiffDay > 0 
                        ? 'text-sky-600' 
                        : 'text-rose-600'
                    }`}>
                      {dayGroup.totalDiffDay === 0 
                        ? '✓ เงินตรง' 
                        : dayGroup.totalDiffDay > 0 
                        ? `+${formatCurrency(dayGroup.totalDiffDay)}` 
                        : formatCurrency(dayGroup.totalDiffDay)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Table of Shifts in this Day */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100/70 text-slate-700 font-bold border-b border-slate-200 text-sm">
                    <tr>
                      <th className="p-3.5 text-center w-20">รอบที่</th>
                      <th className="p-3.5 text-left">รหัสกะ / แคชเชียร์</th>
                      <th className="p-3.5 text-left">เวลาเปิด - ปิดกะ (ระยะเวลา)</th>
                      <th className="p-3.5 text-right">เงินทอนเปิดกะ</th>
                      <th className="p-3.5 text-right">ยอดขายรวมในกะ</th>
                      <th className="p-3.5 text-right">เงินเข้า/ออกลิ้นชัก</th>
                      <th className="p-3.5 text-right">เงินควรมี (Expected)</th>
                      <th className="p-3.5 text-right">เงินนับได้จริง (Actual)</th>
                      <th className="p-3.5 text-center">ผลการปิดกะ</th>
                      <th className="p-3.5 text-center w-36">พิมพ์ใบสรุป</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dayGroup.shifts.map((shift, idx) => {
                      const roundNumber = idx + 1;
                      const { openTime, closeTime, duration } = formatTimeRange(shift.openedAt, shift.closedAt);
                      const diff = shift.actualCash - shift.expectedCash;

                      return (
                        <tr key={shift.shiftId} className="hover:bg-slate-50/70 transition-colors">
                          {/* Round Number */}
                          <td className="p-3.5 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 font-black text-sm">
                              {roundNumber}
                            </span>
                          </td>

                          {/* Shift ID & Cashier */}
                          <td className="p-3.5">
                            <span className="font-mono font-bold text-slate-900 text-[15px] block">
                              {shift.shiftId}
                            </span>
                            <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              <span>{shift.userName}</span>
                            </span>
                          </td>

                          {/* Time & Duration */}
                          <td className="p-3.5">
                            <div className="font-bold text-slate-800 text-[15px] flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              <span>{openTime} - {closeTime} น.</span>
                            </div>
                            <span className="text-xs text-slate-500 font-mono block mt-0.5">
                              ระยะเวลา: {duration} (ขาย {shift.orderCount || 0} บิล)
                            </span>
                          </td>

                          {/* Opening Cash */}
                          <td className="p-3.5 text-right font-mono font-bold text-slate-700 text-sm">
                            {formatCurrency(shift.openingCash)}
                          </td>

                          {/* Total Sales */}
                          <td className="p-3.5 text-right font-mono">
                            <span className="font-bold text-slate-900 block text-[15px]">
                              {formatCurrency(shift.totalSales)}
                            </span>
                            <span className="text-[11px] text-slate-500 block">
                              สด {formatCurrency(shift.cashSales)} | อื่นๆ {formatCurrency(shift.totalSales - shift.cashSales)}
                            </span>
                          </td>

                          {/* Cash In / Out */}
                          <td className="p-3.5 text-right font-mono text-xs">
                            {shift.cashIn > 0 && (
                              <span className="text-emerald-700 block font-semibold">
                                +{formatCurrency(shift.cashIn)}
                              </span>
                            )}
                            {shift.cashOut > 0 && (
                              <span className="text-rose-700 block font-semibold">
                                -{formatCurrency(shift.cashOut)}
                              </span>
                            )}
                            {shift.cashIn === 0 && shift.cashOut === 0 && (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* Expected Cash */}
                          <td className="p-3.5 text-right font-mono font-bold text-slate-800 text-[15px]">
                            {formatCurrency(shift.expectedCash)}
                          </td>

                          {/* Actual Cash */}
                          <td className="p-3.5 text-right font-mono font-black text-slate-900 text-[15px] sm:text-base">
                            {formatCurrency(shift.actualCash)}
                          </td>

                          {/* Discrepancy Status Badge */}
                          <td className="p-3.5 text-center">
                            {diff === 0 ? (
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 font-bold text-[10.5px] gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>ตรงพอดี</span>
                              </Badge>
                            ) : diff < 0 ? (
                              <Badge className="bg-rose-100 text-rose-800 border-rose-200 font-bold text-[10.5px] gap-1">
                                <ArrowDownRight className="w-3 h-3 text-rose-600" />
                                <span>ขาด {formatCurrency(Math.abs(diff))}</span>
                              </Badge>
                            ) : (
                              <Badge className="bg-sky-100 text-sky-800 border-sky-200 font-bold text-[10.5px] gap-1">
                                <ArrowUpRight className="w-3 h-3 text-sky-600" />
                                <span>เกิน +{formatCurrency(diff)}</span>
                              </Badge>
                            )}
                          </td>

                          {/* Actions: Print Slip */}
                          <td className="p-3.5 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrintSlip(shift)}
                              className="h-8 px-2.5 rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs gap-1.5 shadow-2xs"
                              title="พิมพ์ใบสรุปปิดกะ (Slip 80mm / A4)"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>พิมพ์สลิปซ้ำ</span>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── PRINT SLIP MODAL (ShiftSummaryPdfModal) ─── */}
      <ShiftSummaryPdfModal
        open={isSlipModalOpen}
        onOpenChange={setIsSlipModalOpen}
        data={selectedShiftForSlip}
      />
    </div>
  );
}
