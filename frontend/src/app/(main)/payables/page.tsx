'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Building2, Receipt, DollarSign, Plus, Search, Filter, 
  CreditCard, Banknote, ShieldAlert, CheckCircle2, Clock, 
  ArrowLeftRight, FileText, Printer, Eye, ChevronRight, RefreshCw, AlertCircle, RotateCcw, XCircle,
  Edit3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { LoadErrorState, errorMessage } from '@/components/common/LoadErrorState';
import {
  fetchPayableBillsPage,
  fetchOpenPayableBills,
  SupplierPayableBill,
  PayablePaymentEntry,
  PaymentVoucher,
  PayablesSummary,
  PayableBillStatusFilter,
  fetchPaymentVouchersPage,
  updateBillInvoiceNo,
  rollbackPayableBillPayment,
  cancelPayableBill,
  cancelPaymentVoucher
} from '@/lib/payable-service';
import {
  fetchSuppliers,
  fetchAvailableReturnNotes
} from '@/lib/supplier-return-service';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { SimplePager } from '@/components/common/SimplePager';
import { SettlePayableModal } from '@/components/payables/SettlePayableModal';
import { SettleMultipleBillsModal } from '@/components/payables/SettleMultipleBillsModal';
import { PaymentVoucherModal } from '@/components/payables/PaymentVoucherModal';
import { PayableBillDetailsModal } from '@/components/payables/PayableBillDetailsModal';

const BILL_PAGE_SIZE = 50;
const VOUCHER_PAGE_SIZE = 50;
const EMPTY_SUMMARY: PayablesSummary = {
  billCount: 0, unpaidCount: 0, totalOutstanding: 0, totalPaid: 0, availableCredit: 0, availableCreditCount: 0, suppliers: [],
};

export default function PayablesPage() {
  // Bills are computed and paged on the server (GET /payables/bills): one page here, cards over every bill.
  const [bills, setBills] = useState<SupplierPayableBill[]>([]);
  const [billTotal, setBillTotal] = useState(0);
  const [billPage, setBillPage] = useState(1);
  const [summary, setSummary] = useState<PayablesSummary>(EMPTY_SUMMARY);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; contactName?: string | null; phone?: string | null }>>([]);
  const [paymentVouchers, setPaymentVouchers] = useState<PaymentVoucher[]>([]);
  const [voucherTotal, setVoucherTotal] = useState(0);
  const [voucherPage, setVoucherPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<PayableBillStatusFilter>('ALL');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Multi-Bill Settle (selection survives paging: the selected bills are kept by id)
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [selectedBills, setSelectedBills] = useState<Record<string, SupplierPayableBill>>({});
  /** bills with something payable now, loaded when the settle-several-bills dialog opens */
  const [openBills, setOpenBills] = useState<SupplierPayableBill[]>([]);
  const [openingMulti, setOpeningMulti] = useState(false);
  const [isMultiSettleModalOpen, setIsMultiSettleModalOpen] = useState(false);
  const [multiSettleSupplierId, setMultiSettleSupplierId] = useState<string | undefined>(undefined);

  // Single Bill Settle
  const [selectedBillForSettle, setSelectedBillForSettle] = useState<SupplierPayableBill | null>(null);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);

  // Voucher Modal
  const [selectedVoucherForModal, setSelectedVoucherForModal] = useState<PaymentVoucher | null>(null);
  const [selectedPaymentForVoucher, setSelectedPaymentForVoucher] = useState<PayablePaymentEntry | null>(null);
  const [selectedBillForVoucher, setSelectedBillForVoucher] = useState<SupplierPayableBill | null>(null);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);

  // Details Modal
  const [selectedBillForDetails, setSelectedBillForDetails] = useState<SupplierPayableBill | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  // Quick edit invoice no dialog
  const [editingInvoicePoId, setEditingInvoicePoId] = useState<string | null>(null);
  const [editingInvoiceValue, setEditingInvoiceValue] = useState<string>('');

  /** Loads the bills page + cards, suppliers, credit notes and the vouchers page; state is only updated after the requests. */
  const loadData = async () => {
    try {
      const [billRes, supps, , vouchers] = await Promise.all([
        fetchPayableBillsPage({ page: billPage, limit: BILL_PAGE_SIZE, search: debouncedSearch, supplierId: supplierFilter, paymentStatus: statusFilter }),
        fetchSuppliers(),
        // every credit note with credit left: the settle dialogs read them
        fetchAvailableReturnNotes(),
        fetchPaymentVouchersPage({ page: voucherPage, limit: VOUCHER_PAGE_SIZE }),
      ]);
      setBills(billRes.data);
      setBillTotal(billRes.meta.total);
      setSummary(billRes.summary);
      setSuppliers(supps);
      setPaymentVouchers(vouchers.rows);
      setVoucherTotal(vouchers.total);
      setLoadError(null);
    } catch (e) {
      console.error('Failed to load payables data:', e);
      setBills([]);
      setBillTotal(0);
      setSummary(EMPTY_SUMMARY);
      setSuppliers([]);
      setPaymentVouchers([]);
      setVoucherTotal(0);
      setLoadError(errorMessage(e, 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    await loadData();
  };

  // a filter changed: back to page 1 (adjusted while rendering, no extra effect pass)
  const billFilterKey = JSON.stringify([debouncedSearch, supplierFilter, statusFilter]);
  const [billFilterKeySeen, setBillFilterKeySeen] = useState(billFilterKey);
  if (billFilterKeySeen !== billFilterKey) {
    setBillFilterKeySeen(billFilterKey);
    setBillPage(1);
  }

  useEffect(() => {
    const run = async () => { await loadData(); };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billPage, voucherPage, debouncedSearch, supplierFilter, statusFilter]);

  /** Opens the settle-several-bills dialog with every open bill (optionally pre-selecting a supplier's bills). */
  const openMultiSettle = async (supplierId?: string, preselect?: 'supplier' | 'selection') => {
    setOpeningMulti(true);
    try {
      const open = await fetchOpenPayableBills();
      setOpenBills(open);
      setMultiSettleSupplierId(supplierId);
      if (preselect === 'supplier' && supplierId) {
        setSelectedPoIds(open.filter((b) => b.supplierId === supplierId).map((b) => b.poId));
      } else if (preselect !== 'selection') {
        setSelectedPoIds([]);
      }
      setIsMultiSettleModalOpen(true);
    } catch (e) {
      toast.error(errorMessage(e, 'โหลดบิลค้างชำระไม่สำเร็จ'));
    } finally {
      setOpeningMulti(false);
    }
  };

  const handleOpenSettle = (bill: SupplierPayableBill) => {
    setSelectedBillForSettle(bill);
    setIsSettleModalOpen(true);
  };

  const handleOpenVoucher = (bill: SupplierPayableBill, payment: PayablePaymentEntry) => {
    setSelectedBillForVoucher(bill);
    setSelectedPaymentForVoucher(payment);
    setSelectedVoucherForModal(null);
    setIsVoucherModalOpen(true);
  };

  const handleOpenVoucherDirect = (voucher: PaymentVoucher) => {
    setSelectedVoucherForModal(voucher);
    setSelectedBillForVoucher(null);
    setSelectedPaymentForVoucher(null);
    setIsVoucherModalOpen(true);
  };

  const handleCancelVoucher = async (voucher: PaymentVoucher) => {
    if (voucher.status === 'CANCELLED') {
      toast.error('ใบสำคัญจ่ายนี้ถูกยกเลิกไปแล้ว');
      return;
    }

    const confirmMsg = `ต้องการยกเลิกใบสำคัญจ่ายเลขที่ ${voucher.voucherNumber} หรือไม่?\n\n- ยอดเงินที่ชำระตามบิลทั้ง ${voucher.bills.length} ฉบับจะถูกคืนกลับสถานะเดิมเป็นหนี้ค้างชำระ\n- เครดิตใบลดหนี้ (ถ้ามี) จะถูกคืนกลับมาพร้อมใช้งาน\n\nกดยืนยันเพื่อดำเนินการ`;
    if (!confirm(confirmMsg)) return;

    const reason = prompt(`ระบุเหตุผลการยกเลิกใบสำคัญจ่าย ${voucher.voucherNumber}:`, 'ยกเลิกการชำระเงิน');
    if (reason === null) return;

    const res = await cancelPaymentVoucher(voucher.id, reason, voucher);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  const handleSaveInlineInvoice = async (poId: string) => {
    if (!editingInvoiceValue.trim()) {
      setEditingInvoicePoId(null);
      return;
    }
    const res = await updateBillInvoiceNo(poId, editingInvoiceValue.trim());
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
    setEditingInvoicePoId(null);
  };

  const handleToggleSelectPo = (bill: SupplierPayableBill) => {
    const poId = bill.poId;
    setSelectedPoIds((prev) => (prev.includes(poId) ? prev.filter((id) => id !== poId) : [...prev, poId]));
    setSelectedBills((prev) => {
      const next = { ...prev };
      if (next[poId]) delete next[poId];
      else next[poId] = bill;
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedPoIds([]);
    setSelectedBills({});
  };

  const handleOpenDetails = (bill: SupplierPayableBill) => {
    setSelectedBillForDetails(bill);
    setIsDetailsModalOpen(true);
  };

  const handleRollbackBill = async (bill: SupplierPayableBill) => {
    if (!confirm(`ต้องการย้อนสถานะการชำระเงินของบิล ${bill.poNumber} หรือไม่?\n(ยอดเงินที่จ่ายและเครดิตใบลดหนี้จะถูกคืนกลับสถานะเดิม ยอดหนี้จะกลับมาค้างชำระ)`)) {
      return;
    }
    const res = await rollbackPayableBillPayment(bill);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  const handleCancelBillAction = async (bill: SupplierPayableBill) => {
    const reason = prompt(`กรุณาระบุเหตุผลการยกเลิกบิล ${bill.poNumber}:`);
    if (reason === null) return;
    const res = await cancelPayableBill(bill.poId, reason, bill.poNumber);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  // KPIs (over every bill, from the server)
  const totalOutstandingDebt = summary.totalOutstanding;
  const unpaidBillsCount = summary.unpaidCount;
  const totalAvailableDebitCredit = summary.availableCredit;
  const totalPaidAmount = summary.totalPaid;
  const supplierSummary = new Map(summary.suppliers.map((row) => [row.supplierId, row]));

  // the current page (search / supplier / status filtered on the server)
  const filteredBills = bills;
  const pageOpenBills = filteredBills.filter((b) => b.remainingPayable > 0);
  const selectedTotal = Object.values(selectedBills).reduce((s, b) => s + b.remainingPayable, 0);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7 font-sans">
      {loadError && <LoadErrorState message={loadError} onRetry={() => void refreshData()} retrying={loading} />}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <Receipt className="w-6 h-6 text-indigo-600 shrink-0" />
            <span>เจ้าหนี้การค้า & บิลค้างจ่ายบริษัท (Accounts Payable)</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            จัดการหนี้ค้างชำระจากการรับสินค้า (PO), ประกบเอกสารลดหนี้ (Debit Note) เพื่อหักยอด และบันทึกจ่ายเงิน
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={openingMulti}
            onClick={() => {
              setSelectedBills({});
              void openMultiSettle(undefined);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white h-10 px-4 text-xs font-bold shadow-sm gap-1.5 rounded-xl"
          >
            <Plus className="w-4 h-4" />
            <span>+ สร้างใบชำระหนี้ (หลายบิล)</span>
          </Button>

          <Link href="/supplier-returns">
            <Button
              variant="outline"
              size="sm"
              className="border-indigo-200 text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 h-10 px-4 text-xs font-bold shadow-2xs gap-1.5 rounded-xl"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>ส่งเคลม / ใบลดหนี้</span>
            </Button>
          </Link>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshData}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 h-10 px-3.5 text-xs font-semibold shadow-2xs rounded-xl gap-1.5"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>รีเฟรช</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Card 1: Total Outstanding AP Debt */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-amber-950">หนี้ค้างจ่ายรวม:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-amber-700 tracking-tight">
              {formatCurrency(totalOutstandingDebt)}
            </span>
          </div>
        </div>

        {/* Card 2: Unpaid Bills Count */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-rose-950">บิลค้างชำระ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-rose-600 tracking-tight">
              {unpaidBillsCount}
            </span>
            <span className="text-xs text-rose-700 font-sans font-bold">บิล</span>
          </div>
        </div>

        {/* Card 3: Available Debit Notes */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-indigo-950">ใบลดหนี้พร้อมหัก:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-indigo-700 tracking-tight">
              {formatCurrency(totalAvailableDebitCredit)}
            </span>
          </div>
        </div>

        {/* Card 4: Total Paid to Date */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-emerald-950">ชำระแล้วทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-emerald-700 tracking-tight">
              {formatCurrency(totalPaidAmount)}
            </span>
          </div>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="bills" className="w-full space-y-4">
        <TabsList className="bg-slate-100 p-1 rounded-xl h-10">
          <TabsTrigger
            value="bills"
            className="rounded-lg font-bold text-xs sm:text-sm data-[state=active]:bg-white data-[state=active]:shadow-xs px-4"
          >
            รายการบิลเจ้าหนี้ ({summary.billCount.toLocaleString()})
          </TabsTrigger>
          <TabsTrigger
            value="suppliers"
            className="rounded-lg font-bold text-xs sm:text-sm data-[state=active]:bg-white data-[state=active]:shadow-xs px-4 gap-1.5"
          >
            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>สรุปยอดหนี้ตามบริษัท ({suppliers.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="rounded-lg font-bold text-xs sm:text-sm data-[state=active]:bg-white data-[state=active]:shadow-xs px-4 gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-600" />
            <span>ประวัติการจ่ายเงิน & ใบสำคัญจ่าย</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: PAYABLE BILLS LIST */}
        <TabsContent value="bills" className="space-y-4 m-0">
          {/* Filters Bar */}
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="ค้นหาเลขที่ PO, ชื่อบริษัทผู้จำหน่าย..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-10 text-xs sm:text-sm bg-slate-50 border-slate-200 rounded-xl"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="h-10 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 w-full md:w-56"
              >
                <option value="ALL">🏢 ผู้จำหน่ายทั้งหมด</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as PayableBillStatusFilter)}
                className="h-10 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 w-full md:w-40"
              >
                <option value="ALL">ทุกสถานะการชำระ</option>
                <option value="UNPAID">รอชำระ</option>
                <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
                <option value="PAID">ชำระครบแล้ว</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {filteredBills.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Receipt className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-base font-bold text-slate-700">ไม่พบบิลเจ้าหนี้ค้างชำระ</p>
                <p className="text-xs sm:text-sm text-slate-400">เมื่อมีใบสั่งซื้อหรือรับของเข้าคลัง หนี้จะแสดงขึ้นที่นี่อัตโนมัติ</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-sm">
                    <tr>
                      <th className="py-3.5 px-3 text-center w-12">
                        <Checkbox
                          checked={pageOpenBills.length > 0 && pageOpenBills.every((b) => selectedPoIds.includes(b.poId))}
                          onCheckedChange={(checked) => {
                            // selects / clears the open bills of this page (other pages' selection is kept)
                            const ids = new Set(pageOpenBills.map((b) => b.poId));
                            setSelectedPoIds((prev) => (checked ? [...prev.filter((id) => !ids.has(id)), ...ids] : prev.filter((id) => !ids.has(id))));
                            setSelectedBills((prev) => {
                              const next = { ...prev };
                              for (const b of pageOpenBills) {
                                if (checked) next[b.poId] = b;
                                else delete next[b.poId];
                              }
                              return next;
                            });
                          }}
                        />
                      </th>
                      <th className="py-3.5 px-2 text-center w-12">#</th>
                      <th className="py-3.5 px-3.5 text-left min-w-[170px]">เลขที่บิลผู้จำหน่าย (Invoice)</th>
                      <th className="py-3.5 px-3 text-left w-32">เลขที่ PO</th>
                      <th className="py-3.5 px-3 text-center w-28">วันที่บิล</th>
                      <th className="py-3.5 px-3 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="py-3.5 px-3 text-right font-bold text-sm" title="มูลค่าสินค้าที่รับเข้าแล้ว (ตั้งเป็นหนี้)">ยอดหนี้ (รับของแล้ว)</th>
                      <th className="py-3.5 px-2.5 text-right font-bold text-sm">ส่วนลด</th>
                      <th className="py-3.5 px-2.5 text-right font-bold text-sm">ประกบลดหนี้</th>
                      <th className="py-3.5 px-2.5 text-right font-bold text-sm">จ่ายแล้ว</th>
                      <th className="py-3.5 px-3 text-right font-bold text-sm">หนี้คงเหลือสุทธิ</th>
                      <th className="py-3.5 px-2.5 text-center font-bold text-sm">สถานะ</th>
                      <th className="py-3.5 px-3 text-center font-bold text-sm whitespace-nowrap">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBills.map((bill, idx) => (
                      <tr key={bill.poId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-3 text-center">
                          {bill.remainingPayable > 0 ? (
                            <Checkbox
                              checked={selectedPoIds.includes(bill.poId)}
                              onCheckedChange={() => handleToggleSelectPo(bill)}
                            />
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>

                        <td className="py-3.5 px-2 text-center font-mono font-bold text-slate-500 text-sm">
                          {(billPage - 1) * BILL_PAGE_SIZE + idx + 1}
                        </td>

                        <td className="py-3.5 px-3.5">
                          <div className="flex items-center gap-1.5">
                            {bill.supplierInvoiceNo ? (
                              <span className="font-mono font-bold text-indigo-900 text-[13px] bg-indigo-50/80 px-2 py-0.5 rounded border border-indigo-100">
                                {bill.supplierInvoiceNo}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">ยังไม่ระบุเลขที่บิล</span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingInvoicePoId(bill.poId);
                                setEditingInvoiceValue(bill.supplierInvoiceNo || '');
                              }}
                              title="ระบุหรือแก้ไขเลขที่บิล Invoice"
                              className="text-slate-400 hover:text-indigo-600 p-1 hover:bg-slate-100 rounded"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {bill.supplierInvoiceDate && (
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                              ลงวันที่: {new Date(bill.supplierInvoiceDate).toLocaleDateString('th-TH')}
                            </p>
                          )}
                        </td>

                        <td className="py-3.5 px-3 font-mono">
                          <span className="font-bold text-slate-900 text-[14px] block">{bill.poNumber}</span>
                        </td>

                        <td className="py-3.5 px-3 text-center font-mono text-xs text-slate-600">
                          {new Date(bill.billDate).toLocaleDateString('th-TH')}
                        </td>

                        <td className="py-3 px-3">
                          <p className="font-bold text-slate-900 text-[14px]">{bill.supplierName}</p>
                          {bill.supplierPhone && (
                            <p className="text-xs text-slate-400 font-mono mt-0.5">{bill.supplierPhone}</p>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 text-sm sm:text-[14px]">
                          {formatCurrency(bill.receivedAmount ?? bill.totalAmount)}
                                {bill.receivedAmount !== undefined && Math.abs(bill.receivedAmount - bill.totalAmount) > 0.004 && (
                                  <span className="block text-[11px] font-medium text-slate-400">จาก PO {formatCurrency(bill.totalAmount)}</span>
                                )}
                        </td>

                        <td className="py-3 px-2.5 text-right font-mono text-sm sm:text-[14px]">
                          {bill.alreadyDiscountAmount > 0 ? (
                            <span className="text-amber-700 font-bold">
                              {formatCurrency(bill.alreadyDiscountAmount)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="py-3 px-2.5 text-right font-mono text-sm sm:text-[14px]">
                          {bill.alreadyDeductedReturns > 0 ? (
                            <span className="text-indigo-600 font-bold">
                              {formatCurrency(bill.alreadyDeductedReturns)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="py-3 px-2.5 text-right font-mono text-sm sm:text-[14px]">
                          {bill.alreadyPaidAmount > 0 ? (
                            <span className="text-emerald-700 font-bold">
                              {formatCurrency(bill.alreadyPaidAmount)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-black text-[14px] sm:text-[15px]">
                          {bill.remainingPayable > 0 ? (
                            <span className="text-amber-700">
                              {formatCurrency(bill.remainingPayable)}
                            </span>
                          ) : (
                            <span className="text-emerald-600 font-bold text-sm">
                              ครบแล้ว
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-2.5 text-center">
                          {bill.paymentStatus === 'PAID' ? (
                            <Badge className="bg-emerald-600 text-white font-bold text-xs px-2.5 py-1">ชำระครบแล้ว</Badge>
                          ) : bill.paymentStatus === 'PARTIALLY_PAID' && bill.remainingPayable <= 0 ? (
                            <Badge className="bg-teal-600 text-white font-bold text-xs px-2.5 py-1" title="จ่ายครบตามมูลค่าที่รับแล้ว ยังมีสินค้ารอรับ">จ่ายครบตามที่รับ (รอรับของ)</Badge>
                          ) : bill.paymentStatus === 'PARTIALLY_PAID' ? (
                            <Badge className="bg-sky-600 text-white font-bold text-xs px-2.5 py-1">ชำระบางส่วน</Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50 font-bold text-xs px-2.5 py-1">
                              รอชำระ
                            </Badge>
                          )}
                        </td>

                        <td className="py-3 px-3 text-center">
                          <div className="flex items-center justify-center gap-1 flex-nowrap whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenDetails(bill)}
                              title="ดูรายละเอียดบิลและประวัติการชำระ"
                              className="h-8 px-2.5 rounded-xl border-slate-200 hover:border-slate-300 font-bold text-xs gap-1 shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-600" />
                              <span>ดูเอกสาร</span>
                            </Button>

                            {bill.remainingPayable > 0 && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenSettle(bill)}
                                title="ประกบใบลดหนี้หรือบันทึกจ่ายเงิน"
                                className="h-8 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1 shadow-xs shrink-0"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                                <span>ชำระเงิน</span>
                              </Button>
                            )}

                            {(bill.alreadyPaidAmount > 0 || bill.alreadyDeductedReturns > 0 || bill.alreadyDiscountAmount > 0 || bill.paymentStatus === 'PAID') && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRollbackBill(bill)}
                                title="ย้อนสถานะการชำระเงินกลับเป็นรอชำระ"
                                className="h-8 w-8 p-0 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 font-bold text-xs shrink-0"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>
                            )}

                            {bill.paymentStatus === 'UNPAID' && bill.status !== 'CANCELLED' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCancelBillAction(bill)}
                                title="ยกเลิกบิลเจ้าหนี้นี้"
                                className="h-8 w-8 p-0 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 font-bold text-xs shrink-0"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {billTotal > 0 && (
              <SimplePager page={billPage} pageSize={BILL_PAGE_SIZE} total={billTotal} onPage={setBillPage} unit="บิล" testId="bill-pager" />
            )}
          </div>

          {/* Floating Sticky Multi-Bill Action Bar */}
          {selectedPoIds.length > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-4 z-50 animate-in fade-in slide-in-from-bottom-5 max-w-[90vw]">
              <div className="flex items-center gap-2.5">
                <Badge className="bg-indigo-500 text-white font-mono text-xs px-2.5 py-0.5 font-bold">
                  {selectedPoIds.length} บิล
                </Badge>
                <span className="text-xs sm:text-sm font-bold text-slate-200">
                  เลือกบิลแล้ว ยอดรวม: <strong className="text-amber-400 font-mono">{formatCurrency(selectedTotal)}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={openingMulti}
                  onClick={() => {
                    const firstBill = selectedBills[selectedPoIds[0]];
                    void openMultiSettle(firstBill?.supplierId, 'selection');
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-4 rounded-xl gap-1.5 shadow-sm"
                >
                  <Receipt className="w-4 h-4" />
                  <span>สร้างใบชำระหนี้ (ออกใบสำคัญจ่าย)</span>
                </Button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-slate-400 hover:text-white underline px-2 py-1"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* TAB 2: SUMMARY BY SUPPLIER */}
        <TabsContent value="suppliers" className="space-y-4 m-0">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map((supp) => {
              const row = supplierSummary.get(supp.id);
              const suppOpenCount = row?.openCount || 0;
              const suppDebt = row?.debt || 0;
              const suppCreditCount = row?.creditCount || 0;
              const suppCreditTotal = row?.creditTotal || 0;

              return (
                <div
                  key={supp.id}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="max-w-[70%]">
                        <h3 className="font-bold text-slate-900 text-base truncate">{supp.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {supp.contactName ? `ติดต่อ: ${supp.contactName}` : supp.phone || 'ไม่มีข้อมูลติดต่อ'}
                        </p>
                      </div>
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs font-semibold px-2 py-0.5">
                        {suppOpenCount} บิลค้าง
                      </Badge>
                    </div>

                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1.5 text-xs sm:text-sm">
                      <div className="flex justify-between text-slate-600">
                        <span>ยอดหนี้ค้างจ่ายรวม:</span>
                        <strong className="font-mono text-amber-800 text-sm sm:text-base font-bold">{formatCurrency(suppDebt)}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>ใบลดหนี้พร้อมประกบ:</span>
                        <strong className="font-mono text-indigo-700 font-bold">
                          {suppCreditCount} ฉบับ ({formatCurrency(suppCreditTotal)})
                        </strong>
                      </div>
                    </div>
                  </div>

                  {suppOpenCount > 0 ? (
                    <Button
                      type="button"
                      disabled={openingMulti}
                      onClick={() => {
                        setSelectedBills({});
                        void openMultiSettle(supp.id, 'supplier');
                      }}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-9 text-xs rounded-xl shadow-xs gap-1.5"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>ชำระหนี้รอบบิล ({suppOpenCount} บิล)</span>
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-emerald-600 font-bold py-1">
                      ✓ ไม่มีหนี้ค้างชำระกับบริษัทนี้
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* TAB 3: PAYMENT HISTORY & VOUCHERS */}
        <TabsContent value="history" className="space-y-4 m-0">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {voucherTotal === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <FileText className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-base font-bold text-slate-700">ยังไม่มีประวัติการชำระเงินเจ้าหนี้</p>
                <p className="text-xs sm:text-sm text-slate-400">เมื่อมีการบันทึกชำระหนี้ ใบสำคัญจ่ายจะปรากฏที่นี่ และสามารถเปิดดูหรือพิมพ์ย้อนหลังได้ตลอดเวลา</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-xs sm:text-[13px]">
                    <tr>
                      <th className="py-3.5 px-3.5 text-left">เลขที่สำคัญจ่าย / วันที่</th>
                      <th className="py-3.5 px-3.5 text-left">บิลและ Invoice ที่จ่าย</th>
                      <th className="py-3.5 px-3.5 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="py-3.5 px-3.5 text-right">ยอดหนี้รวม</th>
                      <th className="py-3.5 px-3.5 text-right">ส่วนลดท้ายบิล</th>
                      <th className="py-3.5 px-3.5 text-right">หักใบลดหนี้</th>
                      <th className="py-3.5 px-3.5 text-right">ยอดจ่ายจริงสุทธิ</th>
                      <th className="py-3.5 px-3.5 text-center">วิธีชำระ</th>
                      <th className="py-3.5 px-3.5 text-center whitespace-nowrap">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentVouchers.map((voucher) => {
                      const isCancelled = voucher.status === 'CANCELLED';

                      return (
                        <tr
                          key={voucher.id}
                          className={`transition-colors ${isCancelled ? 'bg-rose-50/30 opacity-75' : 'hover:bg-slate-50/70'}`}
                        >
                          <td className="py-3 px-3.5 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold text-sm block ${isCancelled ? 'text-slate-500 line-through' : 'text-indigo-700'}`}>
                                {voucher.voucherNumber}
                              </span>
                              {isCancelled && (
                                <Badge variant="outline" className="text-[10px] font-bold text-rose-700 bg-rose-50 border-rose-300">
                                  ยกเลิกแล้ว
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 block mt-0.5">
                              {new Date(voucher.paymentDate).toLocaleDateString('th-TH')}
                            </span>
                            {isCancelled && voucher.cancelReason && (
                              <p className="text-[10px] text-rose-600 italic mt-0.5">
                                เหตุผล: {voucher.cancelReason}
                              </p>
                            )}
                          </td>

                          <td className="py-3 px-3.5">
                            <div className="space-y-1">
                              <Badge variant="outline" className="text-[11px] font-mono font-bold bg-slate-50">
                                {voucher.bills.length} บิล
                              </Badge>
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {voucher.bills.map((b, i) => (
                                  <span key={i} className="text-[11px] font-mono bg-indigo-50/70 text-indigo-900 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold">
                                    {b.supplierInvoiceNo || b.poNumber}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-3.5 font-bold text-slate-900 text-sm">
                            {voucher.supplierName}
                          </td>

                          <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-800">
                            {formatCurrency(voucher.totalBillsAmount)}
                          </td>

                          <td className="py-3 px-3.5 text-right font-mono text-amber-700 font-bold">
                            {voucher.discountAmount && voucher.discountAmount > 0 ? formatCurrency(voucher.discountAmount) : '-'}
                          </td>

                          <td className="py-3 px-3.5 text-right font-mono text-indigo-700 font-bold">
                            {voucher.deductedCreditAmount > 0 ? formatCurrency(voucher.deductedCreditAmount) : '-'}
                          </td>

                          <td className="py-3 px-3.5 text-right font-mono font-black text-sm sm:text-base">
                            <span className={isCancelled ? 'line-through text-slate-400' : 'text-emerald-700'}>
                              {formatCurrency(voucher.netPaidAmount)}
                            </span>
                          </td>

                          <td className="py-3 px-3.5 text-center">
                            <Badge variant="outline" className="text-xs font-semibold px-2.5 py-0.5">
                              {voucher.paymentMethod === 'CASH'
                                ? '💵 เงินสด'
                                : voucher.paymentMethod === 'TRANSFER'
                                ? '📱 โอนเงิน'
                                : '💳 อื่นๆ'}
                            </Badge>
                          </td>

                          <td className="py-3 px-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-nowrap whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenVoucherDirect(voucher)}
                                className="h-8 px-2.5 rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs gap-1 shrink-0"
                                title="ดูและพิมพ์ใบสำคัญจ่าย A4"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>ใบสำคัญจ่าย (A4)</span>
                              </Button>

                              {!isCancelled ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelVoucher(voucher)}
                                  className="h-8 px-2 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 font-bold text-xs gap-1 shrink-0"
                                  title="ยกเลิกใบสำคัญจ่ายและคืนยอดหนี้ของบิลทั้งหมด"
                                >
                                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                  <span>ยกเลิก</span>
                                </Button>
                              ) : (
                                <span className="text-[11px] text-rose-600 font-bold px-1">
                                  ยกเลิกแล้ว
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {voucherTotal > 0 && (
              <SimplePager page={voucherPage} pageSize={VOUCHER_PAGE_SIZE} total={voucherTotal} onPage={setVoucherPage} unit="ใบ" testId="voucher-pager" />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Payable Bill Details Modal */}
      <PayableBillDetailsModal
        open={isDetailsModalOpen}
        onOpenChange={setIsDetailsModalOpen}
        bill={selectedBillForDetails}
        onSettleClick={(bill) => handleOpenSettle(bill)}
        onViewVoucher={(bill, payment) => handleOpenVoucher(bill, payment)}
        onReload={refreshData}
      />

      {/* Single Bill Settle Modal */}
      <SettlePayableModal
        open={isSettleModalOpen}
        onOpenChange={setIsSettleModalOpen}
        bill={selectedBillForSettle}
        onSuccess={(paymentEntry) => {
          refreshData();
          if (selectedBillForSettle) {
            handleOpenVoucher(selectedBillForSettle, paymentEntry);
          }
        }}
      />

      {/* Multi-Bill Settle Modal */}
      <SettleMultipleBillsModal
        open={isMultiSettleModalOpen}
        onOpenChange={setIsMultiSettleModalOpen}
        allBills={openBills}
        initialSupplierId={multiSettleSupplierId}
        preSelectedPoIds={selectedPoIds}
        onSuccess={(voucher) => {
          refreshData();
          clearSelection();
          setSelectedVoucherForModal(voucher);
          setSelectedBillForVoucher(null);
          setSelectedPaymentForVoucher(null);
          setIsVoucherModalOpen(true);
        }}
      />

      {/* Payment Voucher Modal */}
      <PaymentVoucherModal
        open={isVoucherModalOpen}
        onOpenChange={setIsVoucherModalOpen}
        voucher={selectedVoucherForModal}
        paymentEntry={selectedPaymentForVoucher}
        bill={selectedBillForVoucher}
      />

      {/* Quick Edit Invoice No Dialog */}
      <Dialog open={!!editingInvoicePoId} onOpenChange={(open) => { if (!open) setEditingInvoicePoId(null); }}>
        <DialogContent className="bg-white max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              <span>ระบุ / แก้ไขเลขที่บิลผู้จำหน่าย (Invoice No.)</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-slate-500">
              เลขที่บิลหรือใบส่งของที่ผู้จำหน่ายแนบมากับสินค้า เพื่อใช้ในการตรวจสอบและวางบิล
            </p>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">เลขที่บิล Invoice / DO No.</label>
              <Input
                value={editingInvoiceValue}
                onChange={(e) => setEditingInvoiceValue(e.target.value)}
                placeholder="เช่น INV-670123 หรือ DO-9912"
                className="font-mono font-bold"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditingInvoicePoId(null)}>
              ยกเลิก
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
              onClick={() => {
                if (editingInvoicePoId) {
                  handleSaveInlineInvoice(editingInvoicePoId);
                }
              }}
            >
              บันทึกเลขที่บิล
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
