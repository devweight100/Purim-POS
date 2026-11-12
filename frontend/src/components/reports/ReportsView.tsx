'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  ReportTimeRange,
  ReportTabsResponse,
  fetchReportTabs,
  EMPTY_SALES,
  EMPTY_CLAIMS_AND_VAT,
  EMPTY_BESTSELLERS,
  EMPTY_INVENTORY,
  EMPTY_PAYMENTS,
  EMPTY_CUSTOMERS,
  EMPTY_PURCHASES,
} from '@/lib/reports-service';
import { downloadReport, ExportColumn } from './report-export';
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

function formatCategory(cat: any): string {
  if (!cat) return 'ทั่วไป';
  if (typeof cat === 'string') return cat;
  if (typeof cat === 'object' && cat.name) return String(cat.name);
  return 'ทั่วไป';
}

interface ReportPaginationProps {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  unitLabel?: string;
}

function ReportPagination({
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  unitLabel = 'รายการ',
}: ReportPaginationProps) {
  if (totalItems <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="p-3 sm:px-4 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
      <div className="text-slate-500 font-medium">
        แสดงรายการที่ <span className="font-bold text-slate-800">{start}</span> - <span className="font-bold text-slate-800">{end}</span> จากทั้งหมด <span className="font-bold text-slate-800">{totalItems.toLocaleString()}</span> {unitLabel}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-slate-600">
          <span>แสดงหน้าละ:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            className="h-8 rounded-lg border border-slate-300 bg-white px-2 font-bold text-slate-800 outline-none focus:border-indigo-500 shadow-2xs cursor-pointer"
          >
            <option value={10}>10 {unitLabel}</option>
            <option value={15}>15 {unitLabel}</option>
            <option value={25}>25 {unitLabel}</option>
            <option value={50}>50 {unitLabel}</option>
            <option value={100}>100 {unitLabel}</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(1)}
            className="h-8 w-8 p-0 text-slate-600 cursor-pointer disabled:cursor-not-allowed"
            title="หน้าแรก"
          >
            <ChevronsLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            className="h-8 w-8 p-0 text-slate-600 cursor-pointer disabled:cursor-not-allowed"
            title="หน้าก่อนหน้า"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="px-3 font-bold text-slate-800">
            หน้า {currentPage} / {totalPages}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            className="h-8 w-8 p-0 text-slate-600 cursor-pointer disabled:cursor-not-allowed"
            title="หน้าถัดไป"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(totalPages)}
            className="h-8 w-8 p-0 text-slate-600 cursor-pointer disabled:cursor-not-allowed"
            title="หน้าสุดท้าย"
          >
            <ChevronsRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ReportsViewProps {
  initialTab?: ReportTabKey;
}

export function ReportsView({ initialTab = 'sales' }: ReportsViewProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Active Tab
  const [activeTab, setActiveTab] = useState<ReportTabKey>(initialTab);

  // Pagination State
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Time Filter
  const [timeRange, setTimeRange] = useState<ReportTimeRange>('30days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Search in tables
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Figures of the tab on screen for the selected period, computed by the server (GET /reports/tabs)
  const [report, setReport] = useState<ReportTabsResponse | null>(null);

  // Sub-filter for inventory (all / deadstock / lowstock)
  const [inventorySubFilter, setInventorySubFilter] = useState<'all' | 'deadstock' | 'lowstock'>('all');

  // Reset pagination on filter or tab change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, timeRange, search, customStartDate, customEndDate, inventorySubFilter]);

  // Load the figures of the active tab for the period (the newest request wins)
  const requestSeq = useRef(0);
  const loadData = async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const data = await fetchReportTabs({ range: timeRange, start: customStartDate, end: customEndDate, tab: activeTab });
      if (seq === requestSeq.current) setReport(data);
    } catch (err) {
      console.error('Failed to load reports data:', err);
      if (seq === requestSeq.current) toast.error('ไม่สามารถโหลดข้อมูลรายงานได้');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, timeRange, customStartDate, customEndDate]);

  useEffect(() => {
    const handleSynced = () => loadDataRef.current();
    window.addEventListener('purim:data-synced', handleSynced);
    return () => {
      window.removeEventListener('purim:data-synced', handleSynced);
    };
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

  // Report figures (server-computed); placeholders until the tab's data has arrived
  const salesProfitReport = report?.sales ?? EMPTY_SALES;
  const claimsAndVat = report?.claimsAndVat ?? EMPTY_CLAIMS_AND_VAT;
  const bestSellersReport = report?.bestsellers ?? EMPTY_BESTSELLERS;
  const inventoryReport = report?.inventory ?? EMPTY_INVENTORY;
  const paymentsShiftsReport = report?.payments ?? EMPTY_PAYMENTS;
  const customerDebtsReport = report?.customers ?? EMPTY_CUSTOMERS;
  const purchasesClaimsReport = report?.purchases ?? EMPTY_PURCHASES;

  // ─── PAGINATED & FILTERED DATASETS FOR ALL REPORT TABLES ───
  // 1. Sales
  const filteredDailySales = useMemo(() => {
    if (!search.trim()) return salesProfitReport.dailyBreakdown;
    const q = search.toLowerCase().trim();
    return salesProfitReport.dailyBreakdown.filter(d => d.date.includes(q));
  }, [salesProfitReport.dailyBreakdown, search]);

  const paginatedDailySales = useMemo(() => {
    return filteredDailySales.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredDailySales, currentPage, pageSize]);

  // 2. Best Sellers
  const filteredBestSellers = useMemo(() => {
    if (!search.trim()) return bestSellersReport.allProducts;
    const q = search.toLowerCase().trim();
    return bestSellersReport.allProducts.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      formatCategory(p.category).toLowerCase().includes(q)
    );
  }, [bestSellersReport.allProducts, search]);

  const paginatedBestSellers = useMemo(() => {
    return filteredBestSellers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredBestSellers, currentPage, pageSize]);

  // 3. Inventory
  const filteredInventoryItems = useMemo(() => {
    let list = inventoryReport.items;
    if (inventorySubFilter === 'deadstock') list = inventoryReport.deadstockList;
    else if (inventorySubFilter === 'lowstock') list = inventoryReport.lowStockList;
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(item =>
      item.name.toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q) ||
      formatCategory(item.category).toLowerCase().includes(q) ||
      item.supplierName.toLowerCase().includes(q)
    );
  }, [inventoryReport, inventorySubFilter, search]);

  const paginatedInventoryItems = useMemo(() => {
    return filteredInventoryItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredInventoryItems, currentPage, pageSize]);

  // 4. Customers
  const filteredCustomers = useMemo(() => {
    let list = customerDebtsReport.allCustomers || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q)
    );
  }, [customerDebtsReport.allCustomers, search]);

  const paginatedCustomers = useMemo(() => {
    return filteredCustomers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredCustomers, currentPage, pageSize]);

  // 5. Purchases / Suppliers
  const filteredSuppliers = useMemo(() => {
    let list = purchasesClaimsReport.supplierBreakdown || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(s =>
      s.supplierName.toLowerCase().includes(q)
    );
  }, [purchasesClaimsReport.supplierBreakdown, search]);

  const paginatedSuppliers = useMemo(() => {
    return filteredSuppliers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredSuppliers, currentPage, pageSize]);

  // Print Handler
  const handlePrint = () => {
    window.print();
  };

  // Export (Excel .xlsx or CSV) of the active tab
  const handleExport = async (format: 'csv' | 'xlsx') => {
    const base = `report_${activeTab}_${timeRange === 'custom' ? `${customStartDate || 'start'}_${customEndDate || 'end'}` : timeRange}`;
    const no = { header: 'ลำดับ', value: (_r: any, i: number) => i + 1 };
    let file = '';
    try {
      if (activeTab === 'sales') {
        const cols: ExportColumn<any>[] = [
          no,
          { header: 'วันที่', value: (r) => r.date },
          { header: 'จำนวนออเดอร์', value: (r) => r.orderCount },
          { header: 'ยอดขายรวมก่อนส่วนลด (Gross)', value: (r) => r.grossSales },
          { header: 'ส่วนลด (สินค้า+บิล)', value: (r) => r.discounts },
          { header: 'ยอดขายสุทธิหลังคืนสินค้า (Net)', value: (r) => r.netSales },
          { header: 'ต้นทุน (COGS)', value: (r) => r.cogs },
          { header: 'กำไรขั้นต้น', value: (r) => r.grossProfit },
          { header: '% กำไร', value: (r) => r.profitMarginPercent },
        ];
        file = await downloadReport(format, base, 'ยอดขาย', salesProfitReport.dailyBreakdown, cols);
      } else if (activeTab === 'bestsellers') {
        const cols: ExportColumn<any>[] = [
          no,
          { header: 'รหัส/บาร์โค้ด', value: (r) => r.sku },
          { header: 'ชื่อสินค้า', value: (r) => r.name },
          { header: 'หมวดหมู่', value: (r) => formatCategory(r.category) },
          { header: 'จำนวนขายสุทธิ', value: (r) => r.quantitySold },
          { header: 'ยอดขายสุทธิ', value: (r) => r.totalRevenue },
          { header: 'ต้นทุนรวม', value: (r) => r.totalCost },
          { header: 'กำไร', value: (r) => r.totalProfit },
          { header: '% กำไร', value: (r) => r.profitMarginPercent },
        ];
        file = await downloadReport(format, base, 'สินค้าขายดี', bestSellersReport.allProducts, cols);
      } else if (activeTab === 'inventory') {
        const cols: ExportColumn<any>[] = [
          no,
          { header: 'รหัส/บาร์โค้ด', value: (r) => r.sku },
          { header: 'ชื่อสินค้า', value: (r) => r.name },
          { header: 'หมวดหมู่', value: (r) => formatCategory(r.category) },
          { header: 'ผู้จำหน่าย', value: (r) => r.supplierName },
          { header: 'สต็อกคงเหลือ', value: (r) => r.stock },
          { header: 'ราคาทุนเฉลี่ย', value: (r) => r.costPrice },
          { header: 'มูลค่าทุนรวม', value: (r) => r.totalCostValue },
          { header: 'ราคาขาย', value: (r) => r.retailPrice },
          { header: 'มูลค่าขายรวม', value: (r) => r.totalRetailValue },
          { header: 'สถานะ', value: (r) => (r.isDeadstock ? 'ขายช้า(Deadstock)' : r.isLowStock ? 'สต็อกต่ำ' : 'ปกติ') },
        ];
        file = await downloadReport(format, base, 'มูลค่าคลัง', inventoryReport.items, cols);
      } else if (activeTab === 'payments') {
        const rows = [
          ...paymentsShiftsReport.channels.map((c) => ({ label: c.label, count: c.orderCount, amount: c.totalAmount, pct: c.percentage })),
          { label: 'เงินรับจริง (รวมรับชำระหนี้ ไม่รวมขายเชื่อ)', count: null, amount: paymentsShiftsReport.totalCollected, pct: null },
          { label: `ผลต่างปิดกะสะสม (${paymentsShiftsReport.shifts.totalShiftsCount} กะ)`, count: paymentsShiftsReport.shifts.totalShiftsCount, amount: paymentsShiftsReport.shifts.totalCashDiscrepancy, pct: null },
        ];
        const cols: ExportColumn<any>[] = [
          no,
          { header: 'ช่องทาง / รายการ', value: (r) => r.label },
          { header: 'จำนวนรายการ', value: (r) => r.count },
          { header: 'ยอดเงิน', value: (r) => r.amount },
          { header: '% ของยอดขาย', value: (r) => r.pct },
        ];
        file = await downloadReport(format, base, 'ช่องทางชำระ', rows, cols);
      } else if (activeTab === 'customers') {
        const cols: ExportColumn<any>[] = [
          no,
          { header: 'รหัสลูกค้า', value: (r) => r.code },
          { header: 'ชื่อลูกค้า', value: (r) => r.name },
          { header: 'เบอร์โทรศัพท์', value: (r) => r.phone },
          { header: 'จำนวนครั้งที่ซื้อ', value: (r) => r.orderCount },
          { header: 'ยอดซื้อเฉลี่ยต่อบิล', value: (r) => r.averageTicket },
          { header: 'ยอดซื้อสุทธิ (หลังคืนสินค้า)', value: (r) => r.totalSpent },
          { header: 'แต้มสะสม', value: (r) => r.points },
          { header: 'หนี้คงค้าง', value: (r) => r.outstandingDebt },
          { header: 'วันที่ซื้อล่าสุด', value: (r) => r.lastOrderDate },
        ];
        file = await downloadReport(format, base, 'ลูกค้า', customerDebtsReport.allCustomers, cols);
      } else if (activeTab === 'purchases') {
        const cols: ExportColumn<any>[] = [
          no,
          { header: 'บริษัทคู่ค้า', value: (r) => r.supplierName },
          { header: 'PO ที่รับของในช่วงนี้', value: (r) => r.poCount },
          { header: 'ยอดซื้อ (รับของแล้วในช่วงนี้)', value: (r) => r.totalPurchaseAmount },
          { header: 'สั่งแล้วยังไม่รับของ', value: (r) => r.orderedNotReceived },
          { header: 'ค้างจ่าย (AP) ปัจจุบัน', value: (r) => r.remainingPayable },
          { header: 'จำนวนเคลม', value: (r) => r.claimsCount },
          { header: 'ชิ้นที่เคลม', value: (r) => r.claimPieces },
          { header: 'มูลค่าเคลมรวม', value: (r) => r.claimCostTotal },
        ];
        file = await downloadReport(format, base, 'จัดซื้อ', purchasesClaimsReport.supplierBreakdown, cols);
      }
      toast.success(`ส่งออกไฟล์ ${file} เรียบร้อยแล้ว`);
    } catch (err) {
      console.error('export failed', err);
      toast.error('ส่งออกไฟล์ไม่สำเร็จ');
    }
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
            onClick={() => handleExport('xlsx')}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm h-8 px-3.5 rounded-lg shadow-2xs gap-1.5"
            title="ส่งออกไฟล์ Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('csv')}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-8 px-3 text-xs sm:text-sm font-bold shadow-2xs gap-1.5"
            title="ส่งออกไฟล์ CSV (UTF-8)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
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
                onClick={() => setTimeRange(t.key as typeof timeRange)}
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

          {/* Net profit after claims + output VAT */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-rose-200/80 shadow-2xs space-y-1.5 text-sm">
              <p className="font-bold text-rose-900">ผลกระทบจากเคลมสินค้า (ช่วงเวลาเดียวกัน)</p>
              <div className="flex justify-between"><span className="text-slate-600">ต้นทุนของที่เปลี่ยนให้ลูกค้า</span><span className="font-mono font-bold text-rose-700">-{formatCurrency(claimsAndVat.replacementCost)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">คืนเงินลูกค้า (เงินสด/โอน)</span><span className="font-mono font-bold text-rose-700">-{formatCurrency(claimsAndVat.refundsPaid)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">ได้คืนจากบริษัท (ใบลดหนี้ของเสีย)</span><span className="font-mono font-bold text-emerald-700">+{formatCurrency(claimsAndVat.supplierRecovery)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-black">
                <span className="text-slate-900">กำไรสุทธิหลังหักเคลม</span>
                <span className="font-mono text-emerald-800">{formatCurrency(salesProfitReport.totalGrossProfit - claimsAndVat.claimNetCost)}</span>
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-xl border border-sky-200/80 shadow-2xs space-y-1.5 text-sm">
              <p className="font-bold text-sky-900">ภาษีขาย (VAT) จากบิลที่คิด VAT</p>
              <div className="flex justify-between"><span className="text-slate-600">ยอดขายรวม VAT</span><span className="font-mono font-bold">{formatCurrency(claimsAndVat.vatSales)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">ยอดขายก่อน VAT (ฐานภาษี)</span><span className="font-mono font-bold">{formatCurrency(claimsAndVat.vatBase)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-black">
                <span className="text-slate-900">ภาษีขายที่ต้องนำส่ง</span>
                <span className="font-mono text-sky-800">{formatCurrency(claimsAndVat.vatAmount)}</span>
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
                    <Bar dataKey="netSales" name="ยอดขายสุทธิ" fill="#0ea5e9" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="cogs" name="ต้นทุนสินค้า" fill="#f59e0b" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="grossProfit" name="กำไรขั้นต้น" fill="#10b981" radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
                  {filteredDailySales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบข้อมูลยอดขายในช่วงเวลาที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedDailySales.map((row, idx) => {
                      const itemIndex = (currentPage - 1) * pageSize + idx + 1;
                      return (
                        <tr key={row.date} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                            {itemIndex}
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
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <ReportPagination
              totalItems={filteredDailySales.length}
              currentPage={currentPage}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              unitLabel="วัน"
            />
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
                  {filteredBestSellers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบข้อมูลสินค้าขายในช่วงเวลานี้
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedBestSellers.map((p, idx) => {
                      const itemIndex = (currentPage - 1) * pageSize + idx + 1;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                            {itemIndex}
                          </td>
                          <td className="py-3.5 px-3.5 font-mono text-indigo-700 font-bold text-[15px]">
                            {p.sku}
                          </td>
                          <td className="py-3.5 px-3.5 font-bold text-slate-900 text-[15px]">
                            {p.name}
                          </td>
                          <td className="py-3.5 px-3.5 text-center">
                            <Badge variant="outline" className="text-xs">{formatCategory(p.category)}</Badge>
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
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <ReportPagination
              totalItems={filteredBestSellers.length}
              currentPage={currentPage}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              unitLabel="สินค้า"
            />
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
                <span className="text-sm font-bold text-amber-950">สินค้าสต็อกต่ำ (≤ {inventoryReport.lowStockThreshold}):</span>
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
              ⚠️ ขายช้า: ไม่มีขายและไม่ได้รับเข้า &gt; 30 วัน ({inventoryReport.deadstockList.length})
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
                  {filteredInventoryItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบรายการสินค้าคงคลังที่ตรงกับเงื่อนไข
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedInventoryItems.map((item, idx) => {
                      const itemIndex = (currentPage - 1) * pageSize + idx + 1;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                            {itemIndex}
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
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <ReportPagination
              totalItems={filteredInventoryItems.length}
              currentPage={currentPage}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              unitLabel="รายการ"
            />
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
                <span className="text-sm font-bold text-sky-950" title="เงินที่ได้รับจริง: เงินสด + QR/โอน + บัตร หักคืนเงิน รวมรับชำระหนี้ (ไม่รวมขายเชื่อที่ยังไม่ได้รับเงิน)">
                  เงินรับจริง (รวมรับชำระหนี้):
                </span>
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

          <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1 px-1">
            <span>ยอดขายรับเงินแล้ว (สุทธิหลังคืนเงิน): <b className="font-mono text-slate-700">{formatCurrency(paymentsShiftsReport.salesCollected)}</b></span>
            <span>รับชำระหนี้ลูกค้า: <b className="font-mono text-slate-700">{formatCurrency(paymentsShiftsReport.debtReceived)}</b></span>
            <span>ขายเชื่อ (ยังไม่ได้รับเงิน ไม่นับเป็นเงินรับ): <b className="font-mono text-amber-700">{formatCurrency(paymentsShiftsReport.creditSales)}</b></span>
            <span>สถิติปิดกะ: เฉพาะกะในช่วงเวลาที่เลือก ({paymentsShiftsReport.shifts.totalShiftsCount} กะ)</span>
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
          REPORT 5: CUSTOMERS PURCHASES & DEBTS AGING
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-indigo-950">ลูกค้าทั้งหมด:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-indigo-700 font-mono tracking-tight">
                {customerDebtsReport.allCustomers.length} <span className="text-xs font-sans">คน</span>
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-emerald-950">ยอดซื้อเฉลี่ย/คน:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-emerald-700 font-mono tracking-tight">
                {formatCurrency(
                  customerDebtsReport.allCustomers.length > 0
                    ? Math.round(customerDebtsReport.allCustomers.reduce((s, c) => s + c.totalSpent, 0) / customerDebtsReport.allCustomers.length)
                    : 0
                )}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-amber-950">ลูกค้ายอดซื้อสูงสุด:</span>
              </div>
              <span className="text-xs sm:text-sm font-black text-amber-700 truncate max-w-[170px]">
                {customerDebtsReport.allCustomers[0]?.name || '-'}
              </span>
            </div>

            <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
                  <Receipt className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-rose-950">หนี้เงินเชื่อคงค้าง:</span>
              </div>
              <span className="text-lg sm:text-xl font-black text-rose-600 font-mono tracking-tight">
                {formatCurrency(customerDebtsReport.totalOutstandingDebt)}
              </span>
            </div>
          </div>

          {/* Table 1: Customer Purchases & Spending Report */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <span className="font-bold text-sm text-slate-900">ตารางสรุปยอดซื้อและสถิติประวัติลูกค้าแต่ละคน (Customer Purchases Report)</span>
              </div>
              <span className="text-xs text-slate-500 font-mono">เรียงตามยอดซื้อสะสมจากมากไปน้อย</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">ลำดับ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-28 text-slate-700 font-bold text-sm">รหัสสมาชิก</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left text-slate-700 font-bold text-sm">ชื่อ-นามสกุลลูกค้า</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-36 text-slate-700 font-bold text-sm">เบอร์โทรศัพท์</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">จำนวนบิล</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">ยอดซื้อเฉลี่ย/บิล</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">ยอดซื้อสะสมรวม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">แต้มสะสม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">หนี้ค้างชำระ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-32 text-slate-700 font-bold text-sm">ซื้อล่าสุด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100">
                  {filteredCustomers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบข้อมูลประวัติยอดซื้อของลูกค้าที่ตรงกับเงื่อนไข
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedCustomers.map((c, idx) => {
                      const itemIndex = (currentPage - 1) * pageSize + idx + 1;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                            {itemIndex}
                          </td>
                          <td className="py-3.5 px-3.5 font-mono text-indigo-700 font-bold text-[14px]">
                            {c.code}
                          </td>
                          <td className="py-3.5 px-3.5 font-bold text-slate-900 text-[15px]">
                            <div className="flex items-center gap-1.5">
                              <span>{c.name}</span>
                              {idx === 0 && currentPage === 1 && (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] px-1 py-0 font-bold">
                                  👑 VIP #1
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-3.5 font-mono text-slate-700 text-sm">
                            {c.phone}
                          </td>
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-700 text-sm">
                            {c.orderCount} ครั้ง
                          </td>
                          <td className="py-3.5 px-3.5 text-right font-mono text-slate-700 text-sm">
                            {formatCurrency(c.averageTicket)}
                          </td>
                          <td className="py-3.5 px-3.5 text-right font-mono font-black text-indigo-700 text-[15px] sm:text-base">
                            {formatCurrency(c.totalSpent)}
                          </td>
                          <td className="py-3.5 px-3.5 text-right font-mono font-bold text-amber-700 text-sm">
                            {c.points.toLocaleString()} แต้ม
                          </td>
                          <td className="py-3.5 px-3.5 text-right font-mono font-bold text-sm">
                            {c.outstandingDebt > 0 ? (
                              <span className="text-rose-600 font-black">{formatCurrency(c.outstandingDebt)}</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="py-3.5 px-3.5 text-center font-mono text-xs text-slate-500">
                            {c.lastOrderDate ? formatDate(c.lastOrderDate) : '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <ReportPagination
              totalItems={filteredCustomers.length}
              currentPage={currentPage}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              unitLabel="คน"
            />
          </div>

          {/* Table 2: Debt Aging Buckets Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/50">
              <span className="font-bold text-sm text-slate-900">ตารางวิเคราะห์อายุหนี้เงินเชื่อ — นับตามอายุบิล (วันนับจากวันที่ขาย)</span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                หมายเหตุ: หน้า &quot;การเงิน&quot; แบ่งช่วงตาม &quot;จำนวนวันที่เลยกำหนดชำระ&quot; ตัวเลขแต่ละช่วงจึงต่างกันได้ แต่ยอดรวมเท่ากัน
              </p>
            </div>
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="py-3 px-3.5 text-center w-16 font-bold text-sm">ลำดับ</TableHead>
                  <TableHead className="py-3 px-3.5 text-left font-bold text-sm">ช่วงอายุบิล</TableHead>
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
                <span className="text-sm font-bold text-indigo-950" title="มูลค่าสินค้าที่รับเข้าแล้วในช่วงเวลาที่เลือก (ตามวันที่รับของ)">ยอดซื้อ (รับของแล้วในช่วงนี้):</span>
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
                <span className="text-sm font-bold text-emerald-950" title="ยอดค้างจ่ายสำหรับสินค้าที่รับแล้ว (ตรงกับหน้าการเงิน) / สั่งแล้วยังไม่ได้รับของ">ค้างจ่าย / สั่งแล้วยังไม่รับ:</span>
              </div>
              <span className="text-sm sm:text-base font-black text-emerald-700 font-mono tracking-tight text-right">
                {formatCurrency(purchasesClaimsReport.totalRemainingPayable)}
                <span className="block text-xs text-slate-500 font-bold">{formatCurrency(purchasesClaimsReport.totalOrderedNotReceived)}</span>
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
                  <Layers className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-amber-950">จำนวนชิ้นที่ส่งเคลม:</span>
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
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">PO ที่รับของ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">ยอดซื้อ (รับแล้วในช่วงนี้)</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">สั่งแล้วยังไม่รับ</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">ค้างจ่าย (AP) ปัจจุบัน</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">จำนวนเคลม</TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">มูลค่าเคลมรวม</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {filteredSuppliers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบข้อมูลการสั่งซื้อบริษัทคู่ค้าที่ตรงกับเงื่อนไข
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedSuppliers.map((supp, idx) => {
                      const itemIndex = (currentPage - 1) * pageSize + idx + 1;
                      return (
                        <tr key={supp.supplierId} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">{itemIndex}</td>
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
                          <td className="py-3.5 px-3.5 text-right font-mono text-slate-600 text-sm">
                            {formatCurrency(supp.orderedNotReceived)}
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
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <ReportPagination
              totalItems={filteredSuppliers.length}
              currentPage={currentPage}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              unitLabel="บริษัท"
            />
          </div>
        </div>
      )}
    </div>
  );
}
