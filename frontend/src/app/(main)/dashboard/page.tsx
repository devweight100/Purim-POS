"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { api, apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  LayoutDashboard,
  TrendingUp,
  CreditCard,
  Banknote,
  QrCode,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Calendar,
  Layers,
  ChevronRight,
  ShoppingBag,
  Clock,
  Sparkles,
  RefreshCw,
  Eye,
  Percent,
  CheckCircle2,
  Box,
  Truck,
  RotateCcw,
  Ban,
  ShieldAlert,
  ArrowRight,
  Info,
  Smartphone
} from "lucide-react";
import { fetchClaimRefundSummary } from "@/lib/claim-service";
import { bangkokDate, bangkokParts, bangkokStartOfDay, DAY_MS } from "@shared/bangkok-date";

// Palette colors for charts
const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#64748b"];

type DashboardRange = "today" | "7days" | "30days" | "month" | "all";

/** Thai short label for a Bangkok day key (YYYY-MM-DD) or month key (YYYY-MM). */
function bucketLabel(key: string) {
  if (/^\d{4}-\d{2}$/.test(key)) {
    return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
}

type Num = number | string | null | undefined;

/** One bill in the dashboard's recent-orders list. */
interface DashboardOrder {
  id?: string;
  orderNumber?: string;
  status?: string;
  payments?: Array<{ method: string }>;
  customerName?: string | null;
  customer?: string | { name?: string } | null;
  createdAt: string;
  totalAmount?: number;
  total?: number;
  itemCount?: number;
  items?: unknown[];
}

/** Response of GET /reports/dashboard (local shape; candidate for lib/types.ts). */
interface DashboardReport {
  sales?: {
    voidedAmount?: Num; returnsAmount?: Num; billsInclVat?: Num; netSales?: Num; completedCount?: Num;
    voidedCount?: Num; returnCount?: Num; unitsSoldNet?: Num; averageBasket?: Num;
  };
  payments?: { cash?: Num; qrTransfer?: Num; credit?: Num; card?: Num; other?: Num };
  inventory?: {
    lowStockCount?: Num; outOfStockCount?: Num; lowStockThreshold?: Num; totalProducts?: Num;
    stockCostValue?: Num; stockRetailValue?: Num;
  };
  receivables?: { totalPending?: Num };
  totalCustomers?: Num;
  timeline?: Array<{ date: string; sales?: Num; voided?: Num; returns?: Num; netSales?: Num; orders?: Num }>;
  topProducts?: Array<{ name: string; sku?: string; quantity?: Num; revenue?: Num }>;
  recentOrders?: DashboardOrder[];
}

/** Claim refunds of the same period (Bangkok calendar) -- shown separately, like the P&L. undefined = every claim. */
function claimPeriodStart(range: DashboardRange, now: number): number | undefined {
  const today = bangkokStartOfDay(now);
  const { year, month } = bangkokParts(now);
  return range === "today" ? today
    : range === "7days" ? today - 6 * DAY_MS
    : range === "30days" ? today - 29 * DAY_MS
    : range === "month" ? bangkokDate(year, month, 1)
    : undefined;
}

export default function DashboardPage() {
  const [timeFilter, setTimeFilter] = useState<DashboardRange>("7days");
  // starts as loading: the first load runs right after mount
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<DashboardReport | null>(null);
  // claim refunds of the period (computed on the server over every claim)
  const [claimRefunds, setClaimRefunds] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 });

  // All figures come from the server aggregate (/reports/dashboard): no row cap for "all",
  // returns netted like the P&L, Bangkok days, one low-stock threshold (StoreSettings).
  /** Loads the figures; state is only updated after the requests. */
  const fetchDashboard = async (range: DashboardRange) => {
    try {
      const [dashRes, claimsRes] = await Promise.allSettled([
        apiFetch(`/reports/dashboard?range=${range}`),
        fetchClaimRefundSummary(claimPeriodStart(range, Date.now())),
      ]);
      if (dashRes.status === "fulfilled") setDash(dashRes.value);
      else setDash(null);
      if (claimsRes.status === "fulfilled") setClaimRefunds(claimsRes.value);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardData = async (range: DashboardRange = timeFilter) => {
    setLoading(true);
    await fetchDashboard(range);
  };

  const changeTimeFilter = (range: DashboardRange) => {
    if (range !== timeFilter) setLoading(true);
    setTimeFilter(range);
  };

  useEffect(() => {
    const run = async () => { await fetchDashboard(timeFilter); };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeFilter]);

  const kpi = useMemo(() => {
    const s: NonNullable<DashboardReport["sales"]> = dash?.sales || {};
    const pay: NonNullable<DashboardReport["payments"]> = dash?.payments || {};
    const inv: NonNullable<DashboardReport["inventory"]> = dash?.inventory || {};

    const claimRefundAmount = claimRefunds.amount;
    const claimRefundCount = claimRefunds.count;

    const voidedAmount = Number(s.voidedAmount || 0);
    const returnsAmount = Number(s.returnsAmount || 0);
    const completedRevenue = Number(s.billsInclVat || 0);
    const grossSales = completedRevenue + voidedAmount; // every bill rung up, before voids / returns
    const totalRefunds = voidedAmount + returnsAmount; // voided bills + partial returns
    const netRevenue = Number(s.netSales || 0); // = P&L sales incl. VAT (net of returns)
    const completedOrdersCount = Number(s.completedCount || 0);
    const voidedOrdersCount = Number(s.voidedCount || 0);

    return {
      grossSales,
      completedRevenue,
      voidedAmount,
      returnsAmount,
      returnCount: Number(s.returnCount || 0),
      claimRefundAmount,
      claimRefundCount,
      totalRefunds,
      netRevenue,
      refundRate: grossSales > 0 ? ((totalRefunds / grossSales) * 100).toFixed(1) : "0",
      totalOrdersCount: completedOrdersCount + voidedOrdersCount,
      completedOrdersCount,
      voidedOrdersCount,
      totalUnitsSold: Number(s.unitsSoldNet || 0),
      averageBasket: Number(s.averageBasket || 0),
      cashSales: Number(pay.cash || 0),
      qrSales: Number(pay.qrTransfer || 0),
      creditSales: Number(pay.credit || 0), // CREDIT_DEBT (ขายเชื่อ) net of DEBT_REDUCTION returns
      cardSales: Number(pay.card || 0),
      otherSales: Number(pay.other || 0),
      totalPendingDebt: Number(dash?.receivables?.totalPending || 0),
      lowStockCount: Number(inv.lowStockCount || 0),
      outOfStockCount: Number(inv.outOfStockCount || 0),
      lowStockThreshold: Number(inv.lowStockThreshold ?? 5),
      totalProductsCount: Number(inv.totalProducts || 0),
      totalInventoryValue: Number(inv.stockCostValue || 0), // at cost
      totalInventoryRetailValue: Number(inv.stockRetailValue || 0),
      totalCustomers: Number(dash?.totalCustomers || 0),
    };
  }, [dash, claimRefunds]);

  // Timeline (Bangkok days, or months for long ranges)
  const salesTimelineData = useMemo(() => {
    return (dash?.timeline || []).map((t) => ({
      date: bucketLabel(t.date),
      fullDate: t.date,
      grossSales: Number(t.sales || 0) + Number(t.voided || 0),
      refunds: Number(t.returns || 0) + Number(t.voided || 0),
      netSales: Number(t.netSales || 0),
      orders: Number(t.orders || 0),
    }));
  }, [dash]);

  // Payment Channels Donut Chart Data (net of refunds)
  const paymentChartData = useMemo(() => {
    const data = [
      { name: "เงินสด (Cash)", value: kpi.cashSales, color: "#10b981" },
      { name: "QR พร้อมเพย์ / โอน", value: kpi.qrSales, color: "#0ea5e9" },
      { name: "ขายเชื่อ (Credit)", value: kpi.creditSales, color: "#f59e0b" },
      { name: "บัตรเครดิต", value: kpi.cardSales, color: "#8b5cf6" },
      { name: "อื่นๆ / ใบลดหนี้", value: kpi.otherSales, color: "#64748b" },
    ].filter((item) => item.value > 0);

    if (data.length === 0) {
      return [{ name: "ไม่มีรายการ", value: 1, color: "#e2e8f0" }];
    }
    return data;
  }, [kpi]);

  // Top 5 products by net revenue (after bill discounts and returns)
  const topProductsData = useMemo(() => {
    return (dash?.topProducts || []).map((p) => ({ name: p.name, sku: p.sku, quantity: Number(p.quantity || 0), revenue: Number(p.revenue || 0) })) as {
      name: string; sku?: string; quantity: number; revenue: number;
    }[];
  }, [dash]);

  const recentOrders: DashboardOrder[] = useMemo(() => dash?.recentOrders || [], [dash]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6 lg:p-7 font-sans">
      {/* ─── PAGE HEADER & TIME RANGE SELECTOR ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 sm:text-2xl flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <span>แดชบอร์ด & ภาพรวมรายได้ (Dashboard & Revenue Overview)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            วิเคราะห์ยอดขายจริง สรุปรายการคืนเงิน/ยกเลิกบิล และสถานะการเงินหน้าร้านแบบเรียลไทม์
          </p>
        </div>

        {/* Time Filters Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-white rounded-2xl border border-slate-200 shadow-2xs">
            {[
              { id: "today", label: "วันนี้" },
              { id: "7days", label: "7 วันล่าสุด" },
              { id: "30days", label: "30 วัน" },
              { id: "month", label: "เดือนนี้" },
              { id: "all", label: "ทั้งหมด" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => changeTimeFilter(tab.id as typeof timeFilter)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  timeFilter === tab.id
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadDashboardData()}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-9 px-3 text-xs font-bold rounded-xl shadow-2xs gap-1.5 cursor-pointer"
            title="รีเฟรชข้อมูลแดชบอร์ด"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>รีเฟรช</span>
          </Button>
          <Link
            href="/m"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
            title="สรุปยอดขาย สต็อก ราคา และบิล สำหรับหน้าจอมือถือ"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>มุมมองมือถือ</span>
          </Link>
        </div>
      </div>

      {/* ─── 🌟 CRYSTAL CLEAR FINANCIAL FLOW BANNER (สรุปแจกแจงรายได้ & การคืนเงินแบบชัดเจน - ธีมสว่างคลีน) ─── */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-xs border border-slate-200/90 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>สรุปแจกแจงกระแสรายได้และการคืนเงิน (Financial Flow Breakdown)</span>
                {kpi.totalRefunds > 0 && (
                  <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-bold">
                    มีรายการคืนเงิน/ยกเลิก
                  </Badge>
                )}
              </h2>
              <p className="text-[11px] text-slate-500">
                แจกแจงยอดขายรวมก่อนหัก ยอดที่ยกเลิก/คืนเงินให้ลูกค้า และรายได้สุทธิที่ร้านค้าได้รับจริง
              </p>
            </div>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            ช่วงเวลา: <span className="text-indigo-600 font-bold">{timeFilter === "today" ? "วันนี้" : timeFilter === "7days" ? "7 วันล่าสุด" : timeFilter === "30days" ? "30 วันล่าสุด" : timeFilter === "month" ? "เดือนนี้" : "ทั้งหมด"}</span>
          </div>
        </div>

        {/* 3 Steps Equation: [ Gross Sales ] - [ Refunds & Voids ] = [ Net Revenue ] */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {/* Step 1: Gross Sales */}
          <div className="bg-emerald-50/50 p-3.5 rounded-xl border border-emerald-200/80 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs text-emerald-900 font-bold">1. ยอดขายรวม (Gross Sales)</span>
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-bold">
                {kpi.totalOrdersCount} ออเดอร์
              </Badge>
            </div>
            <div className="text-xl sm:text-2xl font-black font-mono text-emerald-700 mt-1">
              +{formatCurrency(kpi.grossSales)}
            </div>
            <p className="text-[11px] text-emerald-700/90 mt-1 font-medium">
              มูลค่าสินค้าที่ขายออกไปทั้งหมดก่อนหักรายการยกเลิก
            </p>
          </div>

          {/* Step 2: Total Refunds & Voids */}
          <div className="bg-rose-50/50 p-3.5 rounded-xl border border-rose-200/80 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs text-rose-900 font-bold">2. คืนเงิน & ยกเลิกบิล (Refunds)</span>
              <Badge className="bg-rose-100 text-rose-800 border-rose-300 text-[10px] font-bold">
                {kpi.voidedOrdersCount} ยกเลิก / {kpi.returnCount} คืนสินค้า
              </Badge>
            </div>
            <div className="text-xl sm:text-2xl font-black font-mono text-rose-600 mt-1">
              -{formatCurrency(kpi.totalRefunds)}
            </div>
            <div className="text-[11px] text-rose-700/90 mt-1 flex flex-wrap gap-x-2 font-medium">
              <span>ยกเลิกบิล: -{formatCurrency(kpi.voidedAmount)}</span>
              {kpi.returnsAmount > 0 && <span>• คืนสินค้า ({kpi.returnCount}): -{formatCurrency(kpi.returnsAmount)}</span>}
              {kpi.claimRefundAmount > 0 && <span>• เคลมคืนเงิน (แสดงแยก ไม่หักจากยอดขาย): {formatCurrency(kpi.claimRefundAmount)}</span>}
            </div>
          </div>

          {/* Step 3: Net Revenue */}
          <div className="bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-200/90 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs text-indigo-950 font-bold">3. รายได้สุทธิที่ได้รับจริง (Net)</span>
              <Badge className="bg-indigo-100 text-indigo-800 border-indigo-300 text-[10px] font-bold">
                รับจริง {kpi.completedOrdersCount} บิล
              </Badge>
            </div>
            <div className="text-xl sm:text-2xl font-black font-mono text-indigo-700 mt-1">
              ={formatCurrency(kpi.netRevenue)}
            </div>
            <p className="text-[11px] text-indigo-800/90 mt-1 font-medium">
              ยอดเงินคงเหลือสุทธิหลังหักการคืนเงินทั้งหมดแล้ว
            </p>
          </div>
        </div>
      </div>

      {/* ─── PRIMARY KPI STATS CARDS (4 Cards) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* 1. Net Revenue (Indigo Theme) */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs text-slate-500 block font-bold">รายได้สุทธิ (Net Sales)</span>
              <span className="text-base sm:text-lg font-black text-indigo-700 font-mono tracking-tight">
                {formatCurrency(kpi.netRevenue)}
              </span>
            </div>
          </div>
          <div className="text-right text-[10px] text-slate-400 font-mono">
            <div>ขาย {formatCurrency(kpi.grossSales)}</div>
            <div className="text-rose-500">คืน -{formatCurrency(kpi.totalRefunds)}</div>
          </div>
        </div>

        {/* 2. Total Refunds & Voids (Rose Theme) */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg border border-rose-100 shrink-0">
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs text-slate-500 block font-bold">คืนเงิน & ยกเลิกบิล</span>
              <span className="text-base sm:text-lg font-black text-rose-600 font-mono tracking-tight">
                {formatCurrency(kpi.totalRefunds)}
              </span>
            </div>
          </div>
          <div className="text-right text-[10px] text-slate-400">
            <div>{kpi.voidedOrdersCount} บิลยกเลิก</div>
            <div>{kpi.returnCount} รายการคืนสินค้า</div>
          </div>
        </div>

        {/* 3. Total Completed Orders (Sky Theme) */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-sky-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-sky-50 text-sky-600 rounded-lg border border-sky-100 shrink-0">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs text-slate-500 block font-bold">ออเดอร์สำเร็จ</span>
              <span className="text-base sm:text-lg font-black text-sky-700 font-mono tracking-tight">
                {kpi.completedOrdersCount} <span className="text-xs font-bold text-slate-600 font-sans">บิล</span>
              </span>
            </div>
          </div>
          <div className="text-right text-[10px] text-slate-400">
            <div>เฉลี่ย/บิล</div>
            <div className="font-mono font-bold text-sky-700">{formatCurrency(kpi.averageBasket)}</div>
          </div>
        </div>

        {/* 4. Pending Credit Receivables (Amber Theme) */}
        <Link
          href="/debts"
          className="bg-white px-3.5 py-2.5 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between hover:border-amber-400 transition-colors group cursor-pointer"
          title="คลิกเพื่อไปที่หน้าระบบลูกหนี้"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-100 shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs text-slate-500 block font-bold group-hover:text-amber-800">เงินเชื่อคงค้าง</span>
              <span className="text-base sm:text-lg font-black text-amber-700 font-mono tracking-tight">
                {formatCurrency(kpi.totalPendingDebt)}
              </span>
            </div>
          </div>
          <div className="text-right text-[10px] text-slate-400">
            <div>ลูกหนี้ค้าง</div>
            <div className="font-bold text-amber-800">คลิกดูรายละเอียด &gt;</div>
          </div>
        </Link>
      </div>

      {/* ─── SECONDARY MINI-METRICS BAR ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Package className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs text-slate-500 block font-medium">สินค้าในระบบ</span>
            <span className="font-mono font-bold text-slate-900 text-sm">{kpi.totalProductsCount.toLocaleString()} รายการ</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-2 sm:border-l sm:border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs text-slate-500 block font-medium">มูลค่าสต็อก (ราคาทุน)</span>
            <span className="font-mono font-bold text-emerald-700 text-sm">{formatCurrency(kpi.totalInventoryValue)}</span>
            <span className="text-[10px] text-slate-400 block font-mono">ตามราคาขาย: {formatCurrency(kpi.totalInventoryRetailValue)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-2 border-t sm:border-t-0 pt-2 sm:pt-0 sm:border-l sm:border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs text-slate-500 block font-medium">สมาชิกสะสมแต้ม</span>
            <span className="font-mono font-bold text-indigo-700 text-sm">{kpi.totalCustomers.toLocaleString()} คน</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-2 border-t sm:border-t-0 pt-2 sm:pt-0 sm:border-l sm:border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-rose-600 shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs text-slate-500 block font-medium">สินค้าใกล้หมด (≤ {kpi.lowStockThreshold}) / หมด</span>
            <span className="font-mono font-bold text-rose-600 text-sm">{kpi.lowStockCount + kpi.outOfStockCount} รายการ</span>
          </div>
        </div>
      </div>

      {/* ─── CHARTS SECTION (2 Columns: Timeline & Payment Breakdown) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 1. Sales Trend Area Chart (2 Cols) */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                <span>แนวโน้มยอดขาย & การคืนเงินตามช่วงเวลา</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                กราฟแสดงยอดขายรวม ยอดคืนเงิน/ยกเลิก และยอดสุทธิในแต่ละวัน
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[11px] font-bold text-indigo-600">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span> ยอดสุทธิ
              </span>
              <span className="flex items-center gap-1 text-[11px] font-bold text-rose-500">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> คืนเงิน
              </span>
              <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[11px] font-bold">
                {timeFilter === "today" ? "วันนี้" : timeFilter === "7days" ? "7 วันล่าสุด" : timeFilter === "30days" ? "30 วันล่าสุด" : timeFilter === "month" ? "เดือนนี้" : "ทั้งหมด"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-5">
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesTimelineData} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="dashboardSalesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="dashboardRefundGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val)}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const dataItem = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-3.5 rounded-xl shadow-xl text-xs space-y-1.5 border border-slate-700 min-w-[170px]">
                            <p className="font-bold text-slate-300 border-b border-slate-700 pb-1">{label}</p>
                            <p className="text-emerald-400 font-mono font-medium flex justify-between">
                              <span>ขายรวม:</span>
                              <span>+{formatCurrency(Number(dataItem.grossSales || 0))}</span>
                            </p>
                            {Number(dataItem.refunds || 0) > 0 && (
                              <p className="text-rose-400 font-mono font-medium flex justify-between">
                                <span>คืนเงิน/ยกเลิก:</span>
                                <span>-{formatCurrency(Number(dataItem.refunds || 0))}</span>
                              </p>
                            )}
                            <p className="text-indigo-300 font-mono font-black text-sm border-t border-slate-700/80 pt-1 flex justify-between">
                              <span>ยอดสุทธิ:</span>
                              <span>{formatCurrency(Number(dataItem.netSales || 0))}</span>
                            </p>
                            <p className="text-sky-300 font-medium text-[11px] pt-0.5">
                              ออเดอร์สำเร็จ: {dataItem.orders} บิล
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="netSales"
                    name="ยอดขายสุทธิ (฿)"
                    stroke="#4f46e5"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#dashboardSalesGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="refunds"
                    name="ยอดคืนเงิน (฿)"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#dashboardRefundGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 2. Payment Method Distribution Donut Chart (1 Col) */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl overflow-hidden flex flex-col justify-between">
          <CardHeader className="pb-2 border-b border-slate-100">
            <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-600" />
              <span>สัดส่วนช่องทางชำระเงิน</span>
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              ยอดเงินที่ได้รับจำแนกตามช่องทาง
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 flex-1 flex flex-col items-center justify-center">
            <div className="h-[220px] w-full flex items-center justify-center relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={88}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {paymentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), "ยอดรวม"]}
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      color: "#ffffff",
                      borderRadius: "12px",
                      fontSize: "13px",
                      fontWeight: "bold",
                      border: "none",
                      padding: "8px 12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Center Total Text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="text-xs font-bold text-slate-400">รายได้สุทธิ</span>
                <span className="text-sm font-black text-slate-900 font-mono tracking-tight mt-0.5">
                  {formatCurrency(kpi.netRevenue)}
                </span>
              </div>
            </div>

            {/* Custom Payment Legend */}
            <div className="w-full space-y-2 pt-3 border-t border-slate-100">
              {paymentChartData.map((p, idx) => {
                const percent = kpi.netRevenue > 0 ? ((p.value / kpi.netRevenue) * 100).toFixed(1) : "0";
                return (
                  <div key={idx} className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="text-slate-700 font-semibold">{p.name}</span>
                    </div>
                    <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                      <span>{formatCurrency(p.value)}</span>
                      <span className="text-xs text-slate-500 font-medium font-sans">({percent}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── LOWER SECTION: TOP SELLING PRODUCTS & LIVE RECENT ACTIVITY ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Top 5 Best Selling Products */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>สินค้าขายดี 5 อันดับแรก (Top Selling)</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                เรียงตามมูลค่ายอดขายรวมสุทธิ
              </CardDescription>
            </div>
            <Link href="/products" className="text-xs font-bold text-indigo-600 hover:underline">
              ดูสินค้าทั้งหมด
            </Link>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {topProductsData.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                ยังไม่มีข้อมูลการขายสินค้าในช่วงเวลานี้
              </div>
            ) : (
              topProductsData.map((prod, idx) => {
                const maxRevenue = topProductsData[0]?.revenue || 1;
                const percent = Math.min(100, Math.round((prod.revenue / maxRevenue) * 100));

                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2 font-bold text-slate-900 truncate max-w-[65%] text-sm">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0 ${
                            idx === 0
                              ? "bg-amber-500"
                              : idx === 1
                              ? "bg-slate-400"
                              : idx === 2
                              ? "bg-amber-700"
                              : "bg-slate-300 text-slate-700"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="truncate">{prod.name}</span>
                        {prod.sku && (
                          <span className="text-xs text-slate-400 font-mono hidden sm:inline font-normal">
                            ({prod.sku})
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="font-mono font-black text-slate-900 text-sm">
                          {formatCurrency(prod.revenue)}
                        </span>
                        <span className="text-xs text-slate-500 block font-medium">
                          {prod.quantity} ชิ้น
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* 2. Recent Live Orders Feed */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-600" />
                <span>ออเดอร์ล่าสุด (Recent Orders)</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                รายการขายล่าสุดในระบบหน้าร้าน
              </CardDescription>
            </div>
            <Link href="/orders" className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-0.5">
              <span>ไปที่หน้ารายการออเดอร์</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {recentOrders.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                ยังไม่มีรายการออเดอร์ในระบบ
              </div>
            ) : (
              recentOrders.map((ord, idx) => {
                const isVoid = ord.status === "VOIDED" || ord.status === "CANCELLED";
                const isCredit =
                  Array.isArray(ord.payments) &&
                  ord.payments.some((p) => p.method === "CREDIT_DEBT");

                return (
                  <div
                    key={ord.id || ord.orderNumber || idx}
                    className="p-2.5 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-100/80 transition-colors flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-indigo-600 text-sm">
                          {ord.orderNumber}
                        </span>
                        {isVoid ? (
                          <Badge className="bg-rose-100 text-rose-700 border-rose-300 text-xs py-0.5 font-bold line-through">
                            ยกเลิก/คืนเงิน
                          </Badge>
                        ) : isCredit ? (
                          <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-xs py-0.5 font-bold">
                            เงินเชื่อ
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs py-0.5 font-bold">
                            สำเร็จ
                          </Badge>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 truncate flex items-center gap-2 font-medium">
                        <span>{ord.customerName || (typeof ord.customer === "object" ? ord.customer?.name : ord.customer) || "ลูกค้าทั่วไป"}</span>
                        <span>•</span>
                        <span>{new Date(ord.createdAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} น.</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className={`font-mono font-black text-sm block ${isVoid ? "text-slate-400 line-through" : "text-slate-900"}`}>
                        {formatCurrency(ord.totalAmount || ord.total || 0)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {ord.itemCount ?? ord.items?.length ?? 0} รายการ
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── INVENTORY ALERTS & QUICK SHORTCUTS ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Quick Shortcut 1: POS Selling */}
        <Link
          href="/pos"
          className="bg-gradient-to-br from-indigo-600 to-indigo-700 p-3.5 sm:p-4 rounded-xl text-white shadow-xs hover:shadow-md transition-all flex items-center justify-between group cursor-pointer"
        >
          <div className="space-y-1">
            <span className="text-xs font-semibold text-indigo-200 block">เปิดจุดขายหน้าร้าน</span>
            <h3 className="text-base font-bold tracking-tight">ไปที่หน้าขาย POS</h3>
            <p className="text-xs text-indigo-100/90">ยิงบาร์โค้ด คิดเงิน พิมพ์ใบเสร็จ</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
            <ShoppingCart className="w-5 h-5 text-white" />
          </div>
        </Link>

        {/* Quick Shortcut 2: Debt Management */}
        <Link
          href="/debts"
          className="bg-gradient-to-br from-amber-500 to-amber-600 p-3.5 sm:p-4 rounded-xl text-white shadow-xs hover:shadow-md transition-all flex items-center justify-between group cursor-pointer"
        >
          <div className="space-y-1">
            <span className="text-xs font-semibold text-amber-200 block">ระบบลูกหนี้ & เงินเชื่อ</span>
            <h3 className="text-base font-bold tracking-tight">ค้างชำระ {formatCurrency(kpi.totalPendingDebt)}</h3>
            <p className="text-xs text-amber-100/90">รับชำระค่างวด และออกใบเสร็จ</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
            <Receipt className="w-5 h-5 text-white" />
          </div>
        </Link>

        {/* Quick Shortcut 3: Inventory Warehouse */}
        <Link
          href="/inventory"
          className="bg-gradient-to-br from-slate-800 to-slate-900 p-3.5 sm:p-4 rounded-xl text-white shadow-xs hover:shadow-md transition-all flex items-center justify-between group cursor-pointer"
        >
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-300 block">คลังสินค้า & สต็อก</span>
            <h3 className="text-base font-bold tracking-tight">สต็อกต่ำ {kpi.lowStockCount + kpi.outOfStockCount} รายการ</h3>
            <p className="text-xs text-slate-300">ตรวจนับสต็อก และสร้างใบ PO</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
            <Package className="w-5 h-5 text-white" />
          </div>
        </Link>
      </div>
    </div>
  );
}
