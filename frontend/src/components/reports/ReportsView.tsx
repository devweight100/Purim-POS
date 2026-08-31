'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  ReportTimeRange,
  loadAllOrders,
  filterOrdersByDateRange,
  calculateSalesAndProfitReport,
  calculateBestSellingProducts,
  calculateInventoryValuationReport,
  calculatePaymentsAndShiftsReport,
  calculateCustomerAndDebtsReport,
  calculatePurchasesAndClaimsReport,
} from '@/lib/reports-service';
import { useProductStore } from '@/lib/store/product-store';
import { loadPurchaseOrders, loadSuppliers } from '@/lib/supplier-return-service';
import { loadAllClaimRecords } from '@/lib/claim-service';
import { loadAllDebtRecords } from '@/lib/debt-service';
import { loadCustomers } from '@/lib/customer-service';
import { loadAllShiftSummaries } from '@/lib/shift-service';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  Sparkles,
  Boxes,
  Coins,
  Users,
  Truck,
  Calendar,
  Printer,
  Download,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  CheckCircle2,
  PackageX,
  FileText,
  RefreshCw,
  Clock,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Receipt,
  Building2,
  Tag,
  ShieldAlert
} from 'lucide-react';
import { toast } from 'sonner';

export type ReportTabKey = 'sales' | 'bestsellers' | 'inventory' | 'payments' | 'customers' | 'purchases';

const CHART_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#64748b'];

interface ReportsViewProps {
  initialTab?: ReportTabKey;
}

export function ReportsView({ initialTab = 'sales' }: ReportsViewProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Active Tab
  const [activeTab, setActiveTab] = useState<ReportTabKey>(initialTab);

  // Time Filter
  const [timeRange, setTimeRange] = useState<ReportTimeRange>('30days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Search in tables
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Raw data collections
  const [rawOrders, setRawOrders] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  // Sub-filter for inventory (all / deadstock / lowstock)
  const [inventorySubFilter, setInventorySubFilter] = useState<'all' | 'deadstock' | 'lowstock'>('all');

  const { products, fetchProducts } = useProductStore();

  // Load all raw data
  const loadData = () => {
    setLoading(true);
    try {
      setRawOrders(loadAllOrders());
      setPurchaseOrders(loadPurchaseOrders());
      setClaims(loadAllClaimRecords());
      setDebts(loadAllDebtRecords());
      setCustomers(loadCustomers());
      setShifts(loadAllShiftSummaries());
      setSuppliers(loadSuppliers());
      fetchProducts();
    } catch (err) {
      console.error('Failed to load reports data:', err);
      toast.error('ไม่สามารถโหลดข้อมูลรายงานได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Sync tab with props when navigating between sub-routes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Handle Tab Switch
  const handleTabChange = (tab: ReportTabKey) => {
    setActiveTab(tab);
    setSearch('');
    // If not already on /reports/tab, navigate
    if (pathname.startsWith('/reports/') && pathname !== `/reports/${tab}`) {
      router.push(`/reports/${tab}`);
    }
  };

  // Filter orders by date range
  const filteredOrders = useMemo(() => {
    return filterOrdersByDateRange(rawOrders, timeRange, customStartDate, customEndDate);
  }, [rawOrders, timeRange, customStartDate, customEndDate]);

  // 1. Sales & Profit
  const salesProfitReport = useMemo(() => {
    return calculateSalesAndProfitReport(filteredOrders, products);
  }, [filteredOrders, products]);

  // 2. Best Sellers
  const bestSellersReport = useMemo(() => {
    return calculateBestSellingProducts(filteredOrders, products);
  }, [filteredOrders, products]);

  // 3. Inventory Valuation & Deadstock
  const inventoryReport = useMemo(() => {
    return calculateInventoryValuationReport(products, rawOrders);
  }, [products, rawOrders]);

  // 4. Payments & Shifts
  const paymentsShiftsReport = useMemo(() => {
    return calculatePaymentsAndShiftsReport(filteredOrders, shifts);
  }, [filteredOrders, shifts]);

  // 5. Customers & Debts Aging
  const customerDebtsReport = useMemo(() => {
    return calculateCustomerAndDebtsReport(filteredOrders, debts, customers);
  }, [filteredOrders, debts, customers]);

  // 6. Purchases & Claims
  const purchasesClaimsReport = useMemo(() => {
    return calculatePurchasesAndClaimsReport(purchaseOrders, claims, suppliers);
  }, [purchaseOrders, claims, suppliers]);

  // Print Handler
  const handlePrint = () => {
    window.print();
  };

  // Export to CSV Handler
  const handleExportCsv = () => {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    let filename = `report_${activeTab}_${timeRange}.csv`;

    if (activeTab === 'sales') {
      csvContent += 'ลำดับ,วันที่,จำนวนออเดอร์,ยอดขายรวม(Gross),ส่วนลด,ยอดขายสุทธิ(Net),ต้นทุน(COGS),กำไรขั้นต้น(Gross Profit),% กำไร(Margin)\n';
      salesProfitReport.dailyBreakdown.forEach((row, i) => {
        csvContent += `${i + 1},"${row.date}",${row.orderCount},${row.grossSales},${row.discounts},${row.netSales},${row.cogs},${row.grossProfit},${row.profitMarginPercent}%\n`;
      });
    } else if (activeTab === 'bestsellers') {
      csvContent += 'ลำดับ,บาร์โค้ด,ชื่อสินค้า,หมวดหมู่,จำนวนที่ขายได้,ยอดขายรวม,ต้นทุนรวม,กำไรสุทธิ,% กำไร\n';
      bestSellersReport.allProducts.forEach((row, i) => {
        csvContent += `${i + 1},"${row.sku}","${row.name}","${row.category}",${row.quantitySold},${row.totalRevenue},${row.totalCost},${row.totalProfit},${row.profitMarginPercent}%\n`;
      });
    } else if (activeTab === 'inventory') {
      csvContent += 'ลำดับ,บาร์โค้ด,ชื่อสินค้า,หมวดหมู่,ผู้จำหน่าย,สต็อกคงเหลือ,ราคาทุน,มูลค่าทุนรวม,ราคาขาย,มูลค่าขายรวม,สถานะ\n';
      inventoryReport.items.forEach((row, i) => {
        const status = row.isDeadstock ? 'ขายช้า(Deadstock)' : row.isLowStock ? 'สต็อกต่ำ' : 'ปกติ';
        csvContent += `${i + 1},"${row.sku}","${row.name}","${row.category}","${row.supplierName}",${row.stock},${row.costPrice},${row.totalCostValue},${row.retailPrice},${row.totalRetailValue},"${status}"\n`;
      });
    } else {
      csvContent += 'ลำดับ,รายการ,ยอดรวม\n';
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-3 sm:p-4 lg:p-5 font-sans">
      {/* ─── PAGE HEADER ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 shrink-0" />
            <span>รายงาน & วิเคราะห์ธุรกิจ (Business Analytics & Reports)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ศูนย์รวมรายงานเชิงลึกสำหรับผู้ประกอบการ: ยอดขาย กำไร สต็อกจม ช่องทางชำระเงิน อายุหนี้ และยอดจัดซื้อ
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-8 px-3 text-xs sm:text-sm font-semibold shadow-2xs"
            title="รีเฟรชข้อมูลล่าสุด"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-8 px-3 text-xs sm:text-sm font-bold shadow-2xs gap-1.5"
            title="พิมพ์หน้ารายงานปัจจุบัน"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>พิมพ์รายงาน</span>
          </Button>

          <Button
            size="sm"
            onClick={handleExportCsv}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm h-8 px-3.5 rounded-lg shadow-2xs gap-1.5"
            title="ส่งออกไฟล์ข้อมูลเป็น CSV / Excel"
          >
            <Download className="w-3.5 h-3.5" />
            <span>ส่งออก CSV</span>
          </Button>
        </div>
      </div>

      {/* ─── TIME RANGE FILTER BAR (Global for applicable tabs) ─── */}
      <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Calendar className="w-4 h-4 text-indigo-600" />
            <span>ช่วงเวลาการวิเคราะห์:</span>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {[
              { key: 'today', label: 'วันนี้' },
              { key: 'yesterday', label: 'เมื่อวาน' },
              { key: '7days', label: '7 วันล่าสุด' },
              { key: '30days', label: '30 วันล่าสุด' },
              { key: 'thisMonth', label: 'เดือนนี้' },
              { key: 'lastMonth', label: 'เดือนที่แล้ว' },
              { key: 'thisYear', label: 'ปีนี้' },
              { key: 'all', label: 'ทั้งหมด' },
              { key: 'custom', label: 'กำหนดเอง...' },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTimeRange(t.key as any)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  timeRange === t.key
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {timeRange === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <Input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="h-7 text-xs w-36"
            />
            <span className="text-slate-400">ถึง</span>
            <Input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="h-7 text-xs w-36"
            />
          </div>
        )}
      </div>

      {/* ─── MAIN REPORT TABS (6 Core Executive Reports) ─── */}
      <div className="border-b border-slate-200">
        <div className="flex overflow-x-auto gap-1 pb-1 scrollbar-none">
          {[
            { key: 'sales', label: '1. ยอดขาย & กำไรขั้นต้น', icon: TrendingUp, href: '/reports/sales' },
            { key: 'bestsellers', label: '2. สินค้าขายดี & ทำกำไร', icon: Sparkles, href: '/reports/bestsellers' },
            { key: 'inventory', label: '3. มูลค่าคลัง & สต็อกช้า', icon: Boxes, href: '/reports/inventory' },
            { key: 'payments', label: '4. ช่องทางชำระ & ปิดกะ', icon: Coins, href: '/reports/payments' },
            { key: 'customers', label: '5. วิเคราะห์ลูกค้า & อายุหนี้', icon: Users, href: '/reports/customers' },
            { key: 'purchases', label: '6. ยอดจัดซื้อ & สถิติของเคลม', icon: Truck, href: '/reports/purchases' },
          ].map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key as ReportTabKey)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                  isTabActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className={`w-4 h-4 ${isTabActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          REPORT 1: SALES & GROSS PROFIT REPORT
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'sales' && (
        <div className="space-y-3">
          {/* KPI Summary Boxes (Orders style compact inline) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white px-3.5 py-2 rounded-xl border border-sky-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-sky-50 text-sky-600 rounded-md border border-sky-100 shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-sky-950">ยอดขายสุทธิ (Net):</span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono">
                <span className="text-lg sm:text-xl font-black text-sky-700 tracking-tight">
                  {formatCurrency(salesProfitReport.totalNetSales)}
                </span>
              </div>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
                  <Tag className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-amber-950">ต้นทุนสินค้า (COGS):</span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono">
                <span className="text-lg sm:text-xl font-black text-amber-700 tracking-tight">
                  {formatCurrency(salesProfitReport.totalCogs)}
                </span>
              </div>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
                  <Coins className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-emerald-950">กำไรขั้นต้น (Profit):</span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono">
                <span className="text-lg sm:text-xl font-black text-emerald-700 tracking-tight">
                  {formatCurrency(salesProfitReport.totalGrossProfit)}
                </span>
              </div>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-indigo-950">อัตรากำไร (Margin):</span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono">
                <span className="text-lg sm:text-xl font-black text-indigo-700 tracking-tight">
                  {salesProfitReport.overallMargin}%
                </span>
                <span className="text-xs text-slate-500 font-sans font-bold">
                  ({salesProfitReport.totalOrders} ออเดอร์)
                </span>
              </div>
            </div>
          </div>

          {/* Chart Visualization */}
          {salesProfitReport.dailyBreakdown.length > 1 && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex justify-between items-center mb-3">
                <p className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-indigo-600" />
                  <span>แนวโน้มยอดขายและกำไรขั้นต้นรายวัน</span>
                </p>
                <span className="text-xs text-slate-400 font-mono">เปรียบเทียบ ยอดขาย vs ต้นทุน vs กำไร</span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[...salesProfitReport.dailyBreakdown].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} tickFormatter={(v) => `฿${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`} />
                    <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                    <Bar dataKey="netSales" name="ยอดขายสุทธิ" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cogs" name="ต้นทุนสินค้า" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="grossProfit" name="กำไรขั้นต้น" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Data Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">ลำดับ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm">วันที่</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">จำนวนออเดอร์</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">ยอดขายรวม (Gross)</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">ส่วนลด</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">ยอดขายสุทธิ (Net)</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">ต้นทุน (COGS)</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">กำไรขั้นต้น</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">% กำไร (Margin)</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {salesProfitReport.dailyBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบข้อมูลยอดขายในช่วงเวลาที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    salesProfitReport.dailyBreakdown.map((row, idx) => (
                      <tr key={row.date} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                          {idx + 1}
                        </td>
                        <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-900 text-xs">
                          {formatDate(row.date)}
                        </td>
                        <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-700 text-sm">
                          {row.orderCount} บิล
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono text-slate-600 text-sm">
                          {formatCurrency(row.grossSales)}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono text-rose-600 text-sm">
                          {row.discounts > 0 ? `-${formatCurrency(row.discounts)}` : '-'}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-bold text-slate-900 text-[15px]">
                          {formatCurrency(row.netSales)}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono text-amber-700 text-sm">
                          {formatCurrency(row.cogs)}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-black text-emerald-700 text-[15px] sm:text-base">
                          {formatCurrency(row.grossProfit)}
                        </td>
                        <td className="py-3.5 px-3.5 text-center">
                          <span className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                            row.profitMarginPercent >= 30
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : row.profitMarginPercent >= 15
                              ? 'bg-sky-50 text-sky-800 border border-sky-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}>
                            {row.profitMarginPercent}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          REPORT 2: BEST SELLING & TOP PROFIT PRODUCTS
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'bestsellers' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
                  <Boxes className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-indigo-950">สินค้าที่มีการขาย:</span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono">
                <span className="text-lg sm:text-xl font-black text-indigo-700 tracking-tight">
                  {bestSellersReport.allProducts.length}
                </span>
                <span className="text-xs text-slate-600 font-sans font-bold">รายการ</span>
              </div>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-emerald-950">ขายดีอันดับ 1:</span>
              </div>
              <span className="text-xs sm:text-sm font-black text-emerald-700 truncate max-w-[170px]">
                {bestSellersReport.topByQuantity[0]?.name || '-'}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-sky-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-sky-50 text-sky-600 rounded-md border border-sky-100 shrink-0">
                  <Coins className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-sky-950">กำไรสูงสุดอันดับ 1:</span>
              </div>
              <span className="text-xs sm:text-sm font-black text-sky-700 truncate max-w-[170px]">
                {bestSellersReport.topByProfit[0]?.name || '-'}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-slate-100 text-slate-700 rounded-md border border-slate-200 shrink-0">
                  <Tag className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-slate-800">กำไรรวม Top 15:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-slate-800 font-mono tracking-tight">
                {formatCurrency(bestSellersReport.topByProfit.reduce((s, p) => s + p.totalProfit, 0))}
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">ลำดับ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-36 text-slate-700 font-bold text-sm">บาร์โค้ด / SKU</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left text-slate-700 font-bold text-sm">ชื่อสินค้า</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">หมวดหมู่</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">จำนวนที่ขายได้</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">ยอดขายรวม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">ต้นทุนรวม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">กำไรสุทธิ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">% กำไร</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {bestSellersReport.allProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบข้อมูลสินค้าขายในช่วงเวลานี้
                      </TableCell>
                    </TableRow>
                  ) : (
                    bestSellersReport.allProducts.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                          {idx + 1}
                        </td>
                        <td className="py-3.5 px-3.5 font-mono text-indigo-700 font-bold text-[15px]">
                          {p.sku}
                        </td>
                        <td className="py-3.5 px-3.5 font-bold text-slate-900 text-[15px]">
                          {p.name}
                        </td>
                        <td className="py-3.5 px-3.5 text-center">
                          <Badge variant="outline" className="text-xs">{p.category}</Badge>
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-black text-indigo-700 text-[15px]">
                          {p.quantitySold} <span className="text-xs font-bold text-slate-500 font-sans">{p.unitName}</span>
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-bold text-slate-800 text-[15px]">
                          {formatCurrency(p.totalRevenue)}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono text-amber-700 text-sm">
                          {formatCurrency(p.totalCost)}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-black text-emerald-700 text-[15px] sm:text-base">
                          {formatCurrency(p.totalProfit)}
                        </td>
                        <td className="py-3.5 px-3.5 text-center font-mono font-bold text-xs">
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded">
                            {p.profitMarginPercent}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          REPORT 3: INVENTORY VALUATION & DEADSTOCK REPORT
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'inventory' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
                  <Boxes className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-indigo-950">มูลค่าทุนคลังรวม:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-indigo-700 font-mono tracking-tight">
                {formatCurrency(inventoryReport.totalCostVal)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-emerald-950">มูลค่าขายปลีกรวม:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-emerald-700 font-mono tracking-tight">
                {formatCurrency(inventoryReport.totalRetailVal)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-rose-950">ทุนจมของขายช้า:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-rose-600 font-mono tracking-tight">
                {formatCurrency(inventoryReport.deadstockCostVal)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-amber-950">สินค้าสต็อกต่ำ:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-amber-700 font-mono tracking-tight">
                {inventoryReport.lowStockCount} <span className="text-xs font-sans">รายการ</span>
              </span>
            </div>
          </div>

          {/* Subfilter Bar */}
          <div className="flex gap-2 items-center">
            <span className="text-xs font-bold text-slate-600">กรองมุมมอง:</span>
            <button
              type="button"
              onClick={() => setInventorySubFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-bold ${
                inventorySubFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              สินค้าทั้งหมด ({inventoryReport.items.length})
            </button>
            <button
              type="button"
              onClick={() => setInventorySubFilter('deadstock')}
              className={`px-3 py-1 rounded-lg text-xs font-bold ${
                inventorySubFilter === 'deadstock' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              ⚠️ สินค้าขายช้า/ไม่เคลื่อนไหว &gt; 30 วัน ({inventoryReport.deadstockList.length})
            </button>
            <button
              type="button"
              onClick={() => setInventorySubFilter('lowstock')}
              className={`px-3 py-1 rounded-lg text-xs font-bold ${
                inventorySubFilter === 'lowstock' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              📦 สินค้าใกล้หมดสต็อก ({inventoryReport.lowStockList.length})
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">ลำดับ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-36 text-slate-700 font-bold text-sm">บาร์โค้ด / SKU</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left text-slate-700 font-bold text-sm">ชื่อสินค้า</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-48 text-slate-700 font-bold text-sm">ผู้จำหน่าย</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">คงคลัง</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">ราคาทุน</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">มูลค่าทุนรวม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">มูลค่าขายรวม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm">สถานะสต็อก</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {(inventorySubFilter === 'deadstock'
                    ? inventoryReport.deadstockList
                    : inventorySubFilter === 'lowstock'
                    ? inventoryReport.lowStockList
                    : inventoryReport.items
                  ).map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                        {idx + 1}
                      </td>
                      <td className="py-3.5 px-3.5 font-mono text-indigo-700 font-bold text-[15px]">
                        {item.sku}
                      </td>
                      <td className="py-3.5 px-3.5 font-bold text-slate-900 text-[15px]">
                        {item.name}
                      </td>
                      <td className="py-3.5 px-3.5 text-slate-800 font-medium text-sm truncate max-w-[190px]">
                        {item.supplierName}
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono font-bold text-[15px] text-slate-900">
                        {item.stock} <span className="text-xs font-normal text-slate-500">{item.unitName}</span>
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono text-sm text-slate-700">
                        {formatCurrency(item.costPrice)}
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono font-black text-slate-900 text-[15px]">
                        {formatCurrency(item.totalCostValue)}
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono font-bold text-emerald-700 text-sm">
                        {formatCurrency(item.totalRetailValue)}
                      </td>
                      <td className="py-3.5 px-3.5 text-center">
                        {item.isDeadstock ? (
                          <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-xs font-bold">
                            ⚠️ ขายช้า ({item.daysSinceLastSale === 999 ? 'ไม่เคยขาย' : `${item.daysSinceLastSale} วัน`})
                          </Badge>
                        ) : item.isLowStock ? (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs font-bold">
                            📦 สต็อกต่ำ
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                            ✓ ปกติ
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          REPORT 4: PAYMENT CHANNELS & SHIFT RECONCILIATION
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'payments' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white px-3.5 py-2 rounded-xl border border-sky-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-sky-50 text-sky-600 rounded-md border border-sky-100 shrink-0">
                  <Coins className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-sky-950">ยอดรับชำระทั้งหมด:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-sky-700 font-mono tracking-tight">
                {formatCurrency(paymentsShiftsReport.totalCollected)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
                  <Coins className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-emerald-950">เงินสด (Cash):</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-emerald-700 font-mono tracking-tight">
                {formatCurrency(paymentsShiftsReport.channels.find((c) => c.method === 'CASH')?.totalAmount || 0)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
                  <Coins className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-indigo-950">QR / โอนเงิน:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-indigo-700 font-mono tracking-tight">
                {formatCurrency(paymentsShiftsReport.channels.find((c) => c.method === 'QR_PROMPTPAY')?.totalAmount || 0)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-slate-100 text-slate-700 rounded-md border border-slate-200 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-slate-800">ผลต่างปิดกะสะสม:</span>
              </div>
              <span className={`text-lg sm:text-xl font-black font-mono tracking-tight ${
                paymentsShiftsReport.shifts.totalCashDiscrepancy === 0
                  ? 'text-slate-800'
                  : paymentsShiftsReport.shifts.totalCashDiscrepancy > 0
                  ? 'text-sky-700'
                  : 'text-rose-600'
              }`}>
                {paymentsShiftsReport.shifts.totalCashDiscrepancy > 0
                  ? `+${formatCurrency(paymentsShiftsReport.shifts.totalCashDiscrepancy)}`
                  : formatCurrency(paymentsShiftsReport.shifts.totalCashDiscrepancy)}
              </span>
            </div>
          </div>

          {/* Payment Methods Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <span className="font-bold text-sm text-slate-900">สรุปยอดตามช่องทางรับชำระเงิน</span>
              <span className="text-xs text-slate-500 font-mono">กระทบยอดเงินสดและเงินโอนเข้าบัญชี</span>
            </div>
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="py-3 px-3.5 text-center w-16 font-bold text-sm">ลำดับ</TableHead>
                  <TableHead className="py-3 px-3.5 text-left font-bold text-sm">ช่องทางการชำระเงิน</TableHead>
                  <TableHead className="py-3 px-3.5 text-center w-36 font-bold text-sm">จำนวนรายการ</TableHead>
                  <TableHead className="py-3 px-3.5 text-right w-48 font-bold text-sm">ยอดเงินรวม</TableHead>
                  <TableHead className="py-3 px-3.5 text-center w-36 font-bold text-sm">สัดส่วนยอดขาย</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {paymentsShiftsReport.channels.map((c, i) => (
                  <TableRow key={c.method} className="hover:bg-slate-50">
                    <td className="py-3 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">{i + 1}</td>
                    <td className="py-3 px-3.5 font-bold text-slate-900 text-[15px]">{c.label}</td>
                    <td className="py-3 px-3.5 text-center font-mono text-slate-700 text-sm">{c.orderCount} ครั้ง</td>
                    <td className="py-3 px-3.5 text-right font-mono font-black text-slate-900 text-[15px]">
                      {formatCurrency(c.totalAmount)}
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      <Badge variant="outline" className="font-mono font-bold text-xs bg-slate-50">
                        {c.percentage}%
                      </Badge>
                    </td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          REPORT 5: CUSTOMERS & DEBTS AGING
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
                  <Receipt className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-rose-950">หนี้เงินเชื่อคงค้างรวม:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-rose-600 font-mono tracking-tight">
                {formatCurrency(customerDebtsReport.totalOutstandingDebt)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-amber-950">บิลค้างชำระ:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-amber-700 font-mono tracking-tight">
                {customerDebtsReport.unpaidBillsCount} <span className="text-xs font-sans">บิล</span>
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-indigo-950">ลูกค้ายอดซื้อสูงสุด:</span>
              </div>
              <span className="text-xs sm:text-sm font-black text-indigo-700 truncate max-w-[170px]">
                {customerDebtsReport.topCustomers[0]?.name || '-'}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-red-200 shadow-2xs flex items-center justify-between bg-red-50/20">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-red-100 text-red-700 rounded-md border border-red-200 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-red-950">หนี้ค้างนาน &gt; 60 วัน:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-red-700 font-mono tracking-tight">
                {formatCurrency(customerDebtsReport.agingBuckets[3].totalAmount)}
              </span>
            </div>
          </div>

          {/* Debt Aging Buckets Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/50">
              <span className="font-bold text-sm text-slate-900">ตารางวิเคราะห์อายุหนี้เงินเชื่อ (Debt Aging Schedule)</span>
            </div>
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="py-3 px-3.5 text-center w-16 font-bold text-sm">ลำดับ</TableHead>
                  <TableHead className="py-3 px-3.5 text-left font-bold text-sm">ช่วงอายุหนี้</TableHead>
                  <TableHead className="py-3 px-3.5 text-center w-36 font-bold text-sm">จำนวนบิล</TableHead>
                  <TableHead className="py-3 px-3.5 text-right w-48 font-bold text-sm">ยอดหนี้ค้างชำระ</TableHead>
                  <TableHead className="py-3 px-3.5 text-center w-40 font-bold text-sm">ระดับความเสี่ยง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {customerDebtsReport.agingBuckets.map((bucket, i) => (
                  <TableRow key={bucket.rangeDays} className="hover:bg-slate-50">
                    <td className="py-3 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">{i + 1}</td>
                    <td className="py-3 px-3.5 font-bold text-slate-900 text-[15px]">{bucket.bucketName}</td>
                    <td className="py-3 px-3.5 text-center font-mono font-bold text-slate-700 text-sm">{bucket.billCount} บิล</td>
                    <td className="py-3 px-3.5 text-right font-mono font-black text-[15px]">
                      <span className={bucket.totalAmount > 0 ? (i >= 2 ? 'text-rose-600' : 'text-slate-900') : 'text-slate-400'}>
                        {formatCurrency(bucket.totalAmount)}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      <Badge className={
                        i === 0 ? 'bg-emerald-100 text-emerald-800' :
                        i === 1 ? 'bg-sky-100 text-sky-800' :
                        i === 2 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                      }>
                        {i === 0 ? 'หนี้ปกติ' : i === 1 ? 'ครบกำหนด' : i === 2 ? 'เริ่มค้าง' : 'เสี่ยงสูง/เกินกำหนด'}
                      </Badge>
                    </td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          REPORT 6: PURCHASES & SUPPLIER CLAIMS
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'purchases' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
                  <Truck className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-indigo-950">ยอดสั่งซื้อคู่ค้ารวม:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-indigo-700 font-mono tracking-tight">
                {formatCurrency(purchasesClaimsReport.totalPurchasesOverall)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-emerald-950">บริษัทคู่ค้าที่สั่งซื้อ:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-emerald-700 font-mono tracking-tight">
                {purchasesClaimsReport.supplierBreakdown.length} <span className="text-xs font-sans">บริษัท</span>
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
                  <PackageX className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-rose-950">มูลค่าของเคลมสะสม:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-rose-600 font-mono tracking-tight">
                {formatCurrency(purchasesClaimsReport.totalClaimsCostOverall)}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-amber-950">ชิ้นเคลมสะสม:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-amber-700 font-mono tracking-tight">
                {purchasesClaimsReport.supplierBreakdown.reduce((s, i) => s + i.claimPieces, 0)} <span className="text-xs font-sans">ชิ้น</span>
              </span>
            </div>
          </div>

          {/* Supplier Purchases Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">ลำดับ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left text-slate-700 font-bold text-sm">บริษัทผู้จำหน่าย</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">จำนวน PO</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">ยอดสั่งซื้อรวม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">ชำระแล้ว</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">หนี้ค้างจ่าย (AP)</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">จำนวนเคลม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">มูลค่าเคลมรวม</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {purchasesClaimsReport.supplierBreakdown.map((supp, idx) => (
                    <tr key={supp.supplierId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">{idx + 1}</td>
                      <td className="py-3.5 px-3.5 font-bold text-slate-900 text-[15px]">
                        <div className="flex items-center gap-1.5">
                          <Truck className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span>{supp.supplierName}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-700 text-sm">
                        {supp.poCount} ใบ
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono font-black text-slate-900 text-[15px]">
                        {formatCurrency(supp.totalPurchaseAmount)}
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono text-emerald-700 text-sm">
                        {formatCurrency(supp.totalPaidAmount)}
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono font-bold text-amber-700 text-sm">
                        {formatCurrency(supp.remainingPayable)}
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono font-bold text-rose-600 text-sm">
                        {supp.claimPieces} ชิ้น
                      </td>
                      <td className="py-3.5 px-3.5 text-right font-mono font-black text-rose-700 text-[15px]">
                        {formatCurrency(supp.claimCostTotal)}
                      </td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
