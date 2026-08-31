'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DebtRecord, DebtPaymentInstallment, DebtStatus } from '@/lib/types';
import { loadAllDebtRecords } from '@/lib/debt-service';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Receipt,
  Search,
  RefreshCw,
  CreditCard,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingUp,
  User,
  Building2,
  History,
  Printer,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  SlidersHorizontal,
  Calendar,
  Layers,
  Banknote,
  DollarSign,
  X,
  ArrowRight,
  AlertTriangle
} from 'lucide-react';
import { PayDebtModal } from '@/components/debts/PayDebtModal';
import { DebtReceiptPdfModal } from '@/components/debts/DebtReceiptPdfModal';
import { DebtHistoryModal } from '@/components/debts/DebtHistoryModal';
import { useAuthStore } from '@/lib/store/auth-store';
import { toast } from 'sonner';

function DebtsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerIdParam = searchParams.get('customerId');
  const customerNameParam = searchParams.get('customerName');

  const { user } = useAuthStore();
  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusTab, setStatusTab] = useState<'all' | 'unpaid' | 'overdue' | 'paid'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'INDIVIDUAL' | 'COMPANY'>('all');

  // Specific customer filter from URL params
  const [activeCustomerIdFilter, setActiveCustomerIdFilter] = useState<string | null>(customerIdParam);

  useEffect(() => {
    if (customerIdParam) {
      setActiveCustomerIdFilter(customerIdParam);
    }
  }, [customerIdParam]);

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Modals state
  const [payModalOpen, setPayModalOpen] = useState<boolean>(false);
  const [selectedDebtForPay, setSelectedDebtForPay] = useState<DebtRecord | null>(null);

  const [historyModalOpen, setHistoryModalOpen] = useState<boolean>(false);
  const [selectedDebtForHistory, setSelectedDebtForHistory] = useState<DebtRecord | null>(null);

  const [receiptModalOpen, setReceiptModalOpen] = useState<boolean>(false);
  const [receiptDebtRecord, setReceiptDebtRecord] = useState<DebtRecord | null>(null);
  const [receiptInstallment, setReceiptInstallment] = useState<DebtPaymentInstallment | null>(null);

  const reloadData = () => {
    setLoading(true);
    try {
      const records = loadAllDebtRecords();
      setDebts(records);
    } catch (err) {
      console.error('Failed to load debt records:', err);
      toast.error('ไม่สามารถโหลดข้อมูลบิลค้างชำระได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Summary statistics across all debts
  const stats = useMemo(() => {
    let totalOutstanding = 0;
    let totalCollected = 0;
    let totalDebtValue = 0;
    let unpaidCount = 0;
    let paidCount = 0;
    let overdueCount = 0;

    const now = Date.now();

    debts.forEach((d) => {
      totalDebtValue += d.totalAmount;
      totalCollected += d.paidAmount;
      totalOutstanding += d.remainingDebt;

      const isPaid = d.status === 'PAID' || d.remainingDebt <= 0;
      if (isPaid) {
        paidCount++;
      } else {
        unpaidCount++;
        if (d.dueDate && new Date(d.dueDate).getTime() < now) {
          overdueCount++;
        }
      }
    });

    return {
      totalOutstanding,
      totalCollected,
      totalDebtValue,
      unpaidCount,
      paidCount,
      overdueCount,
      totalBills: debts.length,
    };
  }, [debts]);

  // Filtered debts based on search, status tab, customer type, and activeCustomerIdFilter
  const filteredDebts = useMemo(() => {
    const now = Date.now();
    return debts.filter((d) => {
      // 0. Filter by active customer ID from URL
      if (activeCustomerIdFilter && d.customerId !== activeCustomerIdFilter) {
        return false;
      }

      // 1. Status tab filter
      if (statusTab === 'unpaid' && (d.status === 'PAID' || d.remainingDebt <= 0)) return false;
      if (statusTab === 'overdue' && (d.status === 'PAID' || d.remainingDebt <= 0 || !d.dueDate || new Date(d.dueDate).getTime() >= now)) return false;
      if (statusTab === 'paid' && (d.status !== 'PAID' && d.remainingDebt > 0)) return false;

      // 2. Customer type filter
      if (typeFilter !== 'all' && d.customerType !== typeFilter) return false;

      // 3. Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchNumber = d.orderNumber?.toLowerCase().includes(q);
        const matchName = d.customerName?.toLowerCase().includes(q);
        const matchCode = d.customerCode?.toLowerCase().includes(q);
        const matchPhone = d.customerPhone?.toLowerCase().includes(q);
        const matchCompany = d.companyName?.toLowerCase().includes(q);
        const matchTax = d.taxId?.toLowerCase().includes(q);
        if (!matchNumber && !matchName && !matchCode && !matchPhone && !matchCompany && !matchTax) {
          return false;
        }
      }

      return true;
    });
  }, [debts, activeCustomerIdFilter, statusTab, typeFilter, search]);

  // Reset pagination when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusTab, typeFilter, activeCustomerIdFilter, pageSize]);

  // Paginated records
  const totalPages = Math.max(1, Math.ceil(filteredDebts.length / pageSize));
  const paginatedDebts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredDebts.slice(start, start + pageSize);
  }, [filteredDebts, currentPage, pageSize]);

  const handleOpenPay = (debt: DebtRecord) => {
    setSelectedDebtForPay(debt);
    setPayModalOpen(true);
  };

  const handleOpenHistory = (debt: DebtRecord) => {
    setSelectedDebtForHistory(debt);
    setHistoryModalOpen(true);
  };

  const handlePaymentSuccess = (updatedDebt: DebtRecord, newInstallment: DebtPaymentInstallment) => {
    reloadData();
    setReceiptDebtRecord(updatedDebt);
    setReceiptInstallment(newInstallment);
    setReceiptModalOpen(true);
  };

  const handleSelectHistoryInstallment = (inst: DebtPaymentInstallment) => {
    if (selectedDebtForHistory) {
      setReceiptDebtRecord(selectedDebtForHistory);
      setReceiptInstallment(inst);
      setReceiptModalOpen(true);
    }
  };

  const handleClearCustomerFilter = () => {
    setActiveCustomerIdFilter(null);
    router.replace('/debts');
  };

  const activeFilteredCustomerName = useMemo(() => {
    if (!activeCustomerIdFilter) return null;
    const match = debts.find(d => d.customerId === activeCustomerIdFilter);
    return match?.customerName || customerNameParam || 'สมาชิกที่เลือก';
  }, [activeCustomerIdFilter, debts, customerNameParam]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-2 p-2.5 sm:p-3.5 lg:p-4 font-sans">
      {/* ─── PAGE HEADER (Standard Consistent Header) ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <Receipt className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 shrink-0" />
            <span>ลูกหนี้และบิลค้างชำระ (Accounts Receivable)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ติดตามยอดค้างชำระ จัดการเงินเชื่อ และบันทึกรับชำระหนี้ (ชำระเต็มจำนวน / แบ่งชำระ)
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={reloadData}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-8 px-3 text-xs sm:text-sm font-semibold shadow-2xs"
            title="รีเฟรชข้อมูลลูกหนี้"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
        </div>
      </div>

      {/* ─── SPECIFIC CUSTOMER ACTIVE FILTER BANNER (If navigated from /customers) ─── */}
      {activeCustomerIdFilter && (
        <div className="bg-indigo-50 border border-indigo-300 text-indigo-950 px-3 py-1.5 rounded-xl flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
            <User className="w-4 h-4 text-indigo-600" />
            <span>กำลังแสดงเฉพาะรายการบิลของ:</span>
            <span className="bg-white px-2 py-0.5 rounded-md border border-indigo-200 text-indigo-900 font-extrabold">
              {activeFilteredCustomerName}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClearCustomerFilter}
            className="text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-indigo-100 border border-indigo-300 px-2.5 py-0.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>แสดงบิลลูกหนี้ทั้งหมด</span>
          </button>
        </div>
      )}

      {/* ─── TOP STATS OVERVIEW CARDS (3 Cards, Single-line Inline Layout) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Card 1: Total Outstanding Debt (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-rose-900">ยอดหนี้ทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-rose-600 tracking-tight">
              {formatCurrency(stats.totalOutstanding)}
            </span>
            <span className="text-xs text-slate-500 font-sans font-medium">
              ({stats.unpaidCount} บิล)
            </span>
          </div>
        </div>

        {/* Card 2: Pending / Partial Bills Count (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-amber-950">ยังชำระไม่ครบ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-amber-700 tracking-tight">
              {stats.unpaidCount}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">บิล</span>
          </div>
        </div>

        {/* Card 3: Overdue Bills Count (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-red-200 shadow-2xs flex items-center justify-between bg-red-50/20">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-red-100 text-red-700 rounded-md border border-red-200 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-red-950">เกินกำหนดชำระ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-red-600 tracking-tight">
              {stats.overdueCount}
            </span>
            <span className="text-xs text-red-700 font-sans font-bold">บิล</span>
          </div>
        </div>
      </div>

      {/* ─── STATUS FILTER TABS & SEARCH BAR ─── */}
      <div className="bg-white rounded-xl border border-slate-200 p-2 sm:p-2.5 shadow-2xs space-y-2">
        {/* Status Tabs (All / Unpaid / Overdue / Paid) & Customer Type Filter */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex flex-wrap gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
            <button
              type="button"
              onClick={() => setStatusTab('all')}
              className={`px-3 py-1 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 ${
                statusTab === 'all'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>ทั้งหมด ({debts.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusTab('unpaid')}
              className={`px-3 py-1 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 ${
                statusTab === 'unpaid'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-amber-800 hover:bg-amber-50'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>ยังชำระไม่ครบ ({stats.unpaidCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusTab('overdue')}
              className={`px-3 py-1 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 ${
                statusTab === 'overdue'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-rose-700 hover:bg-rose-50'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>เกินกำหนดชำระ ({stats.overdueCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusTab('paid')}
              className={`px-3 py-1 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 ${
                statusTab === 'paid'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>ชำระครบแล้ว ({stats.paidCount})</span>
            </button>
          </div>

          {/* Customer Type Quick Filter */}
          <div className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-600">
            <span className="font-semibold text-slate-500">ประเภทลูกค้า:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 font-bold text-slate-800 text-xs sm:text-sm outline-none focus:border-indigo-500 shadow-2xs"
            >
              <option value="all">ทั้งหมด</option>
              <option value="INDIVIDUAL">👤 บุคคลธรรมดา</option>
              <option value="COMPANY">🏢 นิติบุคคล / บริษัท</option>
            </select>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาตามเลขที่บิล, ชื่อลูกค้า, บริษัท, เบอร์โทร, เลขผู้เสียภาษี..."
              className="pl-9 h-8.5 bg-slate-50 border-slate-300 rounded-lg focus:bg-white text-xs sm:text-sm font-medium shadow-inner"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
              >
                ล้าง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── DATA TABLE (Compact Rows for Fitting 10 Bills on Screen) ─── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/90 border-b border-slate-200">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-bold text-slate-700 text-sm py-2 pl-3 text-center w-16">ลำดับ</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 w-[130px]">เลขที่บิล</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 text-center w-[140px]">วันที่บิล</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 min-w-[190px]">ลูกค้า / ผู้ซื้อ</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 text-right w-[110px]">ยอดเต็มบิล</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 text-right w-[110px]">ชำระแล้ว</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 text-right w-[120px]">คงค้างชำระ</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 text-center w-[150px]">
                  ความคืบหน้าชำระ
                </TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 text-center w-[120px]">สถานะ</TableHead>
                <TableHead className="font-bold text-slate-700 text-sm py-2 text-center w-[165px] pr-3">การจัดการ</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-slate-400 text-sm">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-1.5 text-indigo-500" />
                    กำลังโหลดข้อมูลลูกหนี้และบิลค้างชำระ...
                  </TableCell>
                </TableRow>
              ) : paginatedDebts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-slate-400 text-sm">
                    <div className="flex flex-col items-center gap-1">
                      <Receipt className="w-6 h-6 text-slate-300" />
                      <span className="font-bold text-slate-600 text-sm">ไม่พบบิลค้างชำระตามเงื่อนไข</span>
                      <span className="text-xs text-slate-400">ลองเปลี่ยนคำค้นหาหรือเปลี่ยนแท็บสถานะ</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedDebts.map((debt, idx) => {
                  const isPaid = debt.status === 'PAID' || debt.remainingDebt <= 0;
                  const isPartial = debt.status === 'PARTIAL' || (debt.paidAmount > 0 && debt.remainingDebt > 0);
                  const isOverdue = !!(debt.dueDate && new Date(debt.dueDate).getTime() < Date.now() && debt.remainingDebt > 0);
                  const progressPct = debt.progressPercent;

                  return (
                    <TableRow key={debt.orderId} className="hover:bg-slate-50/70 transition-colors">
                      {/* 1. Index (ลำดับ) */}
                      <TableCell className="py-2 pl-3 text-center font-mono font-bold text-slate-500 text-sm">
                        {(currentPage - 1) * pageSize + idx + 1}
                      </TableCell>

                      {/* 2. Order Number */}
                      <TableCell className="py-2 font-mono">
                        <span className="font-bold text-slate-900 text-[15px] block">{debt.orderNumber}</span>
                      </TableCell>

                      {/* 3. Date (แยก col. วันที่) */}
                      <TableCell className="py-2 text-center font-mono">
                        <div className="text-xs text-slate-600 font-bold">
                          {new Date(debt.orderDate).toLocaleDateString('th-TH')}
                        </div>
                        {debt.dueDate && (
                          <div className={`text-[11px] font-sans font-medium flex items-center justify-center gap-1 mt-0.5 ${isOverdue ? 'text-rose-600 font-bold' : 'text-amber-700'}`}>
                            <span>ครบกำหนด: {new Date(debt.dueDate).toLocaleDateString('th-TH')}</span>
                            {isOverdue && <span className="text-[9.5px] bg-rose-100 text-rose-700 px-1 py-0.2 rounded font-bold">เกินกำหนด</span>}
                          </div>
                        )}
                      </TableCell>

                      {/* 4. Customer Name, Phone & Type */}
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900 text-[15px] leading-snug">
                          {debt.customerType === 'COMPANY' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 shrink-0 font-medium">
                              <Building2 className="w-3 h-3" /> นิติบุคคล
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 shrink-0 font-medium">
                              <User className="w-3 h-3" /> บุคคล
                            </span>
                          )}
                          <span className="truncate max-w-[190px]">{debt.customerName}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                          {debt.customerCode && <span className="text-slate-600">[{debt.customerCode}]</span>}
                          {debt.customerPhone && <span>โทร: {debt.customerPhone}</span>}
                          {debt.taxId && <span>Tax: {debt.taxId}</span>}
                        </div>
                      </TableCell>

                      {/* 3. Total Amount */}
                      <TableCell className="py-1.5 sm:py-2 text-right font-bold text-sm text-slate-800 font-mono">
                        {formatCurrency(debt.totalAmount)}
                      </TableCell>

                      {/* 4. Paid Amount */}
                      <TableCell className="py-1.5 sm:py-2 text-right font-bold text-sm text-emerald-600 font-mono">
                        {formatCurrency(debt.paidAmount)}
                      </TableCell>

                      {/* 5. Remaining Balance */}
                      <TableCell className="py-1.5 sm:py-2 text-right font-black font-mono">
                        <span className={debt.remainingDebt > 0 ? 'text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 inline-block font-extrabold text-sm' : 'text-slate-400 text-sm'}>
                          {formatCurrency(debt.remainingDebt)}
                        </span>
                      </TableCell>

                      {/* 6. Pastel Progress Bar */}
                      <TableCell className="py-1.5 sm:py-2 text-center px-2">
                        <div className="space-y-0.5 max-w-[125px] mx-auto">
                          <div className="flex items-center justify-between text-[11px] font-semibold">
                            <span className={isPaid ? 'text-teal-700 font-bold' : isPartial ? 'text-indigo-700 font-bold' : 'text-slate-500'}>
                              {isPaid ? '100%' : `${progressPct}%`}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {debt.installments?.length || 0} งวด
                            </span>
                          </div>

                          {/* Soft Pastel Progress Bar */}
                          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isPaid
                                  ? 'bg-teal-400'
                                  : isPartial
                                  ? 'bg-indigo-400'
                                  : 'bg-slate-200'
                              }`}
                              style={{ width: `${Math.max(progressPct > 0 ? 5 : 0, progressPct)}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>

                      {/* 7. Status Badge */}
                      <TableCell className="py-1.5 sm:py-2 text-center">
                        {isPaid ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-bold text-xs gap-1 hover:bg-emerald-50 px-2 py-0.5">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> ชำระครบแล้ว
                          </Badge>
                        ) : isPartial ? (
                          <Badge className="bg-amber-50 text-amber-800 border-amber-200 font-bold text-xs gap-1 hover:bg-amber-50 px-2 py-0.5">
                            <Clock className="w-3 h-3 text-amber-600" /> ชำระบางส่วน
                          </Badge>
                        ) : (
                          <Badge className="bg-rose-50 text-rose-700 border-rose-200 font-bold text-xs gap-1 hover:bg-rose-50 px-2 py-0.5">
                            <AlertCircle className="w-3 h-3 text-rose-600" /> ยังไม่ชำระ
                          </Badge>
                        )}
                      </TableCell>

                      {/* 8. Action Buttons */}
                      <TableCell className="py-1.5 sm:py-2 pr-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Pay Button */}
                          {!isPaid ? (
                            <Button
                              size="sm"
                              onClick={() => handleOpenPay(debt)}
                              className="h-7.5 px-2.5 text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-2xs gap-1"
                              title="รับชำระหนี้บิลนี้"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              <span>รับชำระ</span>
                            </Button>
                          ) : (
                            <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              เคลียร์แล้ว
                            </span>
                          )}

                          {/* History / Slip Button */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenHistory(debt)}
                            className="h-7.5 px-2 text-xs sm:text-sm text-slate-700 border-slate-300 hover:bg-slate-100 rounded-lg font-medium"
                            title="ดูประวัติการชำระและพิมพ์สลิป"
                          >
                            <History className="w-3.5 h-3.5 mr-1" />
                            <span>ประวัติ</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* ─── PAGINATION ─── */}
        <div className="py-1.5 px-3 sm:px-4 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs sm:text-sm">
          <div className="text-slate-500 font-medium">
            แสดงรายการที่{' '}
            <span className="font-bold text-slate-800">
              {filteredDebts.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
            </span>{' '}
            -{' '}
            <span className="font-bold text-slate-800">
              {Math.min(currentPage * pageSize, filteredDebts.length)}
            </span>{' '}
            จากทั้งหมด{' '}
            <span className="font-bold text-slate-800">{filteredDebts.length.toLocaleString()}</span> บิล
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-slate-600">
              <span className="font-medium">แสดงหน้าละ:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-8 rounded-lg border border-slate-300 bg-white px-2 font-bold text-slate-800 text-xs sm:text-sm outline-none focus:border-indigo-500 shadow-2xs"
              >
                <option value={10}>10 บิล</option>
                <option value={20}>20 บิล</option>
                <option value={50}>50 บิล</option>
                <option value={100}>100 บิล</option>
              </select>
            </div>

            <div className="flex items-center gap-0.5">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(1)}
                className="h-7.5 w-7.5 p-0 text-slate-600 rounded-md"
                title="หน้าแรก"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-7.5 w-7.5 p-0 text-slate-600 rounded-md"
                title="หน้าก่อนหน้า"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>

              <div className="px-2 font-bold text-slate-800 text-xs sm:text-sm">
                หน้า {currentPage} / {totalPages}
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-7.5 w-7.5 p-0 text-slate-600 rounded-md"
                title="หน้าถัดไป"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="h-7.5 w-7.5 p-0 text-slate-600 rounded-md"
                title="หน้าสุดท้าย"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── MODALS ─── */}

      {/* 1. Pay Debt Modal (Full / Partial) */}
      <PayDebtModal
        open={payModalOpen}
        onOpenChange={setPayModalOpen}
        debtRecord={selectedDebtForPay}
        cashierName={user?.name || 'พนักงานขาย'}
        onPaymentSuccess={handlePaymentSuccess}
      />

      {/* 2. Debt Payment History Modal */}
      <DebtHistoryModal
        open={historyModalOpen}
        onOpenChange={setHistoryModalOpen}
        debtRecord={selectedDebtForHistory}
        onSelectInstallment={handleSelectHistoryInstallment}
      />

      {/* 3. Debt Settlement Receipt Slip Modal (80mm & PDF) */}
      <DebtReceiptPdfModal
        open={receiptModalOpen}
        onOpenChange={setReceiptModalOpen}
        debtRecord={receiptDebtRecord}
        installment={receiptInstallment}
      />
    </div>
  );
}

export default function DebtsPage() {
  return (
    <Suspense fallback={
      <div className="p-8 text-center text-xs text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
        กำลังโหลดระบบจัดการลูกหนี้...
      </div>
    }>
      <DebtsContent />
    </Suspense>
  );
}
