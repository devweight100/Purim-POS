'use client';

import { ROW_NAV_CLASS, useRowNav } from "@/lib/use-row-nav";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building2, Receipt, DollarSign, Plus, Search, ShieldAlert, CheckCircle2, ArrowLeftRight, FileText, Printer, Eye, RefreshCw, RotateCcw, XCircle, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency, formatListDate } from '@/lib/utils';
import { RowActionsMenu } from '@/components/common/RowActionsMenu';
import PurchaseOrderPdfModal, { type PurchaseOrderData } from '@/components/pos/PurchaseOrderPdfModal';
import { api } from '@/lib/api';
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
import { askConfirm, askReason } from '@/lib/ask-dialog';

const BILL_PAGE_SIZE = 50;
const VOUCHER_PAGE_SIZE = 50;
const EMPTY_SUMMARY: PayablesSummary = {
  billCount: 0, unpaidCount: 0, totalOutstanding: 0, totalPaid: 0, availableCredit: 0, availableCreditCount: 0, suppliers: [],
};

/**
 * Paid part of a bill (round 4): a bar filled by settled / bill amount (paid + credit notes + discount), red-amber when
 * nothing is paid, sky when partly paid, green when settled; "จ่ายแล้ว ฿x / ค้าง ฿y" under it (full breakdown as tooltip).
 */
function PaidProgress({ bill }: { bill: SupplierPayableBill }) {
  const settled = Math.max(0, (bill.alreadyPaidAmount || 0) + (bill.alreadyDeductedReturns || 0) + (bill.alreadyDiscountAmount || 0));
  const remaining = Math.max(0, bill.remainingPayable || 0);
  const base = settled + remaining;
  const pct = base > 0 ? Math.round((settled / base) * 100) : 0;
  const done = remaining <= 0.004 && settled > 0;
  const waitingGoods = done && bill.paymentStatus === 'PARTIALLY_PAID';
  const state = done ? 'paid' : settled > 0 ? 'partial' : 'unpaid';
  const bar = state === 'paid' ? (waitingGoods ? 'bg-teal-500' : 'bg-emerald-500') : state === 'partial' ? 'bg-sky-500' : 'bg-amber-400';
  const text = state === 'paid' ? (waitingGoods ? 'จ่ายครบตามที่รับ (รอรับของ)' : 'ชำระครบแล้ว') : `จ่ายแล้ว ${formatCurrency(settled)} / ค้าง ${formatCurrency(remaining)}`;
  const tip = [
    `ยอดเอกสาร (รับของแล้ว) ${formatCurrency(bill.receivedAmount ?? bill.totalAmount)}`,
    Math.abs((bill.receivedAmount ?? bill.totalAmount) - bill.totalAmount) > 0.004 ? `ยอดใบสั่งซื้อ ${formatCurrency(bill.totalAmount)}` : '',
    `จ่ายเงินแล้ว ${formatCurrency(bill.alreadyPaidAmount || 0)}`,
    bill.alreadyDeductedReturns > 0 ? `ประกบใบลดหนี้ ${formatCurrency(bill.alreadyDeductedReturns)}` : '',
    bill.alreadyDiscountAmount > 0 ? `ส่วนลด ${formatCurrency(bill.alreadyDiscountAmount)}` : '',
    `คงค้าง ${formatCurrency(remaining)}`,
  ].filter(Boolean).join('\n');
  return (
    <div className="mt-1 ml-auto w-full max-w-56" title={tip} data-testid="bill-progress" data-state={state}>
      <div
        role="progressbar"
        aria-label={`ชำระแล้ว ${pct}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={`h-1.5 w-full overflow-hidden rounded-full ${state === 'unpaid' ? 'bg-amber-100' : 'bg-slate-200'}`}
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${state === 'paid' ? 100 : pct}%` }} />
      </div>
      <p className={`mt-0.5 truncate text-[11px] font-medium ${state === 'paid' ? 'text-emerald-700' : state === 'partial' ? 'text-sky-700' : 'text-amber-700'}`}>{text}</p>
    </div>
  );
}

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

  // PO document (PDF) from the row menu
  const [pdfPo, setPdfPo] = useState<PurchaseOrderData | null>(null);
  const openPoPdf = async (bill: SupplierPayableBill) => {
    try {
      const po = await api.purchaseOrders.getOne(bill.poId);
      setPdfPo(po as unknown as PurchaseOrderData);
    } catch (e) {
      toast.error(errorMessage(e, 'โหลดใบสั่งซื้อไม่สำเร็จ'));
    }
  };

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

    // one in-page dialog (was a native confirm + prompt): what happens, the reason, confirm
    const reason = await askReason({
      title: `ยกเลิกใบสำคัญจ่าย ${voucher.voucherNumber}`,
      description: `- ยอดเงินที่ชำระตามบิลทั้ง ${voucher.bills.length} ฉบับจะถูกคืนกลับสถานะเดิมเป็นหนี้ค้างชำระ\n- เครดิตใบลดหนี้ (ถ้ามี) จะถูกคืนกลับมาพร้อมใช้งาน`,
      label: 'เหตุผลการยกเลิก',
      defaultValue: 'ยกเลิกการชำระเงิน',
      required: false,
      confirmLabel: 'ยืนยันยกเลิกใบสำคัญจ่าย',
      cancelLabel: 'ไม่ยกเลิก',
      inputId: 'voucher-cancel-reason',
    });
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
    if (!(await askConfirm({ title: `ต้องการย้อนสถานะการชำระเงินของบิล ${bill.poNumber} หรือไม่?`, description: 'ยอดเงินที่จ่ายและเครดิตใบลดหนี้จะถูกคืนกลับสถานะเดิม ยอดหนี้จะกลับมาค้างชำระ', confirmLabel: 'ย้อนสถานะ', danger: true }))) {
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
    const reason = await askReason({ title: `ยกเลิกบิล ${bill.poNumber}`, label: 'เหตุผลการยกเลิกบิล', required: false, confirmLabel: 'ยืนยันยกเลิกบิล', cancelLabel: 'ไม่ยกเลิก', inputId: 'bill-cancel-reason' });
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

  const billNav = useRowNav(filteredBills.length, (i) => handleOpenDetails(filteredBills[i]));
  const voucherNav = useRowNav(paymentVouchers.length, (i) => handleOpenVoucherDirect(paymentVouchers[i]));
  return (
    <div className="page-shell">
      {loadError && <LoadErrorState message={loadError} onRetry={() => void refreshData()} retrying={loading} />}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Receipt />
            <span>เจ้าหนี้การค้า & บิลค้างจ่ายบริษัท (Accounts Payable)</span>
          </h1>
          <p className="page-subtitle">
            จัดการหนี้ค้างชำระจากการรับสินค้า (PO), ประกบเอกสารลดหนี้ (Debit Note) เพื่อหักยอด และบันทึกจ่ายเงิน
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={openingMulti}
            onClick={() => {
              setSelectedBills({});
              void openMultiSettle(undefined);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>สร้างใบชำระหนี้ (หลายบิล)</span>
          </Button>

          <Link href="/supplier-returns">
            <Button
              variant="outline"
              className="border-indigo-200 text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 gap-1.5"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>ส่งเคลม / ใบลดหนี้</span>
            </Button>
          </Link>

          <Button
            type="button"
            variant="outline"
            onClick={refreshData}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5"
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
        <div className="stat-tile">
          <div className="flex items-center gap-2">
            <div className="stat-tile-icon">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="stat-tile-label">หนี้ค้างจ่ายรวม:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="stat-tile-value">
              {formatCurrency(totalOutstandingDebt)}
            </span>
          </div>
        </div>

        {/* Card 2: Unpaid Bills Count */}
        <div className="stat-tile">
          <div className="flex items-center gap-2">
            <div className="stat-tile-icon">
              <Receipt className="w-4 h-4" />
            </div>
            <span className="stat-tile-label">บิลค้างชำระ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="stat-tile-value is-danger">
              {unpaidBillsCount}
            </span>
            <span className="stat-tile-unit">บิล</span>
          </div>
        </div>

        {/* Card 3: Available Debit Notes */}
        <div className="stat-tile">
          <div className="flex items-center gap-2">
            <div className="stat-tile-icon">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <span className="stat-tile-label">ใบลดหนี้พร้อมหัก:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="stat-tile-value">
              {formatCurrency(totalAvailableDebitCredit)}
            </span>
          </div>
        </div>

        {/* Card 4: Total Paid to Date */}
        <div className="stat-tile">
          <div className="flex items-center gap-2">
            <div className="stat-tile-icon">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="stat-tile-label">ชำระแล้วทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="stat-tile-value">
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
                className="pl-10 sm:text-sm bg-slate-50 border-slate-200"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="h-10 px-3 text-sm sm:text-sm bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 w-full md:w-56"
              >
                <option value="ALL">ผู้จำหน่ายทั้งหมด</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as PayableBillStatusFilter)}
                className="h-10 px-3 text-sm sm:text-sm bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 w-full md:w-40"
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
              <div className="tbl-wrap">
                {/* round 4 (owner): only เลขที่เอกสาร / วันที่ / บริษัท / ยอดเอกสาร with a paid progress bar; every other
                    detail (invoice date, discount, credit notes, paid, PO amount, items, payments) is in the bill
                    details (row click / Enter); the row's actions are in one "⋯" menu */}
                <table className="tbl w-full text-sm" data-testid="payable-bills-table">
                  <thead >
                    <tr>
                      <th className="text-center w-10">
                        <Checkbox
                          aria-label="เลือกบิลค้างชำระทั้งหน้า"
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
                      <th className="text-left">เลขที่เอกสาร</th>
                      <th className="text-left w-28">วันที่</th>
                      <th className="text-left">บริษัท</th>
                      <th className="text-right w-64">ยอดเอกสาร</th>
                      <th className="w-12"><span className="sr-only">การจัดการ</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100" {...billNav.bodyProps}>
                    {filteredBills.map((bill, idx) => (
                      <tr key={bill.poId} aria-label={`บิล ${bill.poNumber} ${bill.supplierName} (Enter = รายละเอียด)`} className={`hover:bg-slate-50/70 transition-colors ${ROW_NAV_CLASS}`} {...billNav.rowProps(idx)}>
                        <td className="text-center">
                          {bill.remainingPayable > 0 ? (
                            <Checkbox
                              aria-label={`เลือกบิล ${bill.poNumber}`}
                              checked={selectedPoIds.includes(bill.poId)}
                              onCheckedChange={() => handleToggleSelectPo(bill)}
                            />
                          ) : (
                            <span className="text-subtle">-</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap">
                          <p className="doc-no font-medium text-fg" data-testid="bill-doc-no">{bill.poNumber}</p>
                          {bill.supplierInvoiceNo && (
                            <p className="mt-0.5 max-w-[14rem] truncate doc-no text-sub text-muted-foreground" title={`เลขที่บิลผู้จำหน่าย ${bill.supplierInvoiceNo}`}>บิล {bill.supplierInvoiceNo}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-fg" data-testid="bill-date">{formatListDate(bill.billDate)}</td>
                        <td>
                          <p className="font-medium text-fg line-clamp-2 break-words min-w-40" title={bill.supplierName}>{bill.supplierName}</p>
                        </td>
                        <td className="text-right">
                          <span className="doc-no whitespace-nowrap font-medium text-fg">{formatCurrency(bill.receivedAmount ?? bill.totalAmount)}</span>
                          <PaidProgress bill={bill} />
                        </td>
                        <td className="text-right">
                          <RowActionsMenu
                            label={`การจัดการบิล ${bill.poNumber}`}
                            testId="bill-actions"
                            actions={[
                              { label: 'ดูรายละเอียดบิล', icon: Eye, onSelect: () => handleOpenDetails(bill), testId: 'bill-action-details' },
                              { label: 'ชำระเงิน / ประกบใบลดหนี้', icon: Receipt, onSelect: () => handleOpenSettle(bill), hidden: !(bill.remainingPayable > 0), testId: 'bill-action-pay' },
                              { label: 'ระบุ / แก้ไขเลขที่บิลผู้จำหน่าย', icon: Edit3, onSelect: () => { setEditingInvoicePoId(bill.poId); setEditingInvoiceValue(bill.supplierInvoiceNo || ''); } },
                              { label: 'พิมพ์ใบสั่งซื้อ (PDF)', icon: Printer, onSelect: () => void openPoPdf(bill), testId: 'bill-action-print' },
                              { label: 'ดู / พิมพ์ใบสำคัญจ่ายล่าสุด', icon: FileText, onSelect: () => handleOpenVoucher(bill, bill.payments[bill.payments.length - 1]), hidden: !(bill.payments?.length > 0) },
                              { label: 'ย้อนสถานะการชำระเงิน...', icon: RotateCcw, danger: true, onSelect: () => void handleRollbackBill(bill), hidden: !(bill.alreadyPaidAmount > 0 || bill.alreadyDeductedReturns > 0 || bill.alreadyDiscountAmount > 0 || bill.paymentStatus === 'PAID'), testId: 'bill-action-rollback' },
                              { label: 'ยกเลิกบิล...', icon: XCircle, danger: true, onSelect: () => void handleCancelBillAction(bill), hidden: !(bill.paymentStatus === 'UNPAID' && bill.status !== 'CANCELLED') },
                            ]}
                          />
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
                <Badge className="bg-indigo-500 text-white tabular-nums text-xs px-2.5 py-0.5 font-bold">
                  {selectedPoIds.length} บิล
                </Badge>
                <span className="text-xs sm:text-sm font-bold text-slate-200">
                  เลือกบิลแล้ว ยอดรวม: <strong className="text-amber-400 tabular-nums">{formatCurrency(selectedTotal)}</strong>
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
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
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
                        <strong className="tabular-nums text-amber-800 text-sm sm:text-base font-bold">{formatCurrency(suppDebt)}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>ใบลดหนี้พร้อมประกบ:</span>
                        <strong className="tabular-nums text-indigo-700 font-bold">
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
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
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
              <div className="tbl-wrap overflow-x-auto">
                <table className="tbl w-full text-sm">
                  <thead className="sm:text-[13px]">
                    <tr>
                      <th className="text-left">เลขที่สำคัญจ่าย / วันที่</th>
                      <th className="text-left">บิลและ Invoice ที่จ่าย</th>
                      <th className="text-left">บริษัทผู้จำหน่าย</th>
                      <th className="text-right">ยอดหนี้รวม</th>
                      <th className="text-right">ส่วนลดท้ายบิล</th>
                      <th className="text-right">หักใบลดหนี้</th>
                      <th className="text-right">ยอดจ่ายจริงสุทธิ</th>
                      <th className="text-center">วิธีชำระ</th>
                      <th className="w-12"><span className="sr-only">การจัดการ</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100" {...voucherNav.bodyProps}>
                    {paymentVouchers.map((voucher, vIdx) => {
                      const isCancelled = voucher.status === 'CANCELLED';

                      return (
                        <tr
                          key={voucher.id}
                          aria-label={`ใบสำคัญจ่าย ${voucher.voucherNumber} (Enter = เปิดดู / พิมพ์)`}
                          className={`transition-colors ${ROW_NAV_CLASS} ${isCancelled ? 'bg-rose-50/30 opacity-75' : 'hover:bg-slate-50/70'}`}
                          {...voucherNav.rowProps(vIdx)}
                        >
                          <td className="doc-no whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold text-sm block ${isCancelled ? 'text-slate-500 line-through' : 'text-indigo-700'}`}>
                                {voucher.voucherNumber}
                              </span>
                              {isCancelled && (
                                <StatusChip tone="danger">
                                  ยกเลิกแล้ว
                                </StatusChip>
                              )}
                            </div>
                            <span className="text-sub text-muted-foreground block mt-0.5">
                              {formatListDate(voucher.paymentDate)}
                            </span>
                            {isCancelled && voucher.cancelReason && (
                              <p className="text-sub text-danger italic mt-0.5">
                                เหตุผล: {voucher.cancelReason}
                              </p>
                            )}
                          </td>

                          <td >
                            <div className="space-y-1">
                              <div className="text-sub text-muted-foreground">{voucher.bills.length} บิล</div>
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {voucher.bills.map((b, i) => (
                                  <span key={i} className="doc-no text-fg after:content-[','] last:after:content-none">
                                    {b.supplierInvoiceNo || b.poNumber}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </td>

                          <td className="font-medium text-fg">
                            {voucher.supplierName}
                          </td>

                          <td className="text-right tabular-nums whitespace-nowrap font-medium text-fg">
                            {formatCurrency(voucher.totalBillsAmount)}
                          </td>

                          <td className="text-right tabular-nums whitespace-nowrap text-warn font-medium">
                            {voucher.discountAmount && voucher.discountAmount > 0 ? formatCurrency(voucher.discountAmount) : '-'}
                          </td>

                          <td className="text-right tabular-nums whitespace-nowrap font-medium">
                            {voucher.deductedCreditAmount > 0 ? formatCurrency(voucher.deductedCreditAmount) : '-'}
                          </td>

                          <td className="text-right tabular-nums whitespace-nowrap font-medium">
                            <span className={isCancelled ? 'line-through text-subtle' : 'text-fg'}>
                              {formatCurrency(voucher.netPaidAmount)}
                            </span>
                          </td>

                          <td className="text-center">
                            <span className="text-fg">
                              {voucher.paymentMethod === 'CASH'
                                ? 'เงินสด'
                                : voucher.paymentMethod === 'TRANSFER'
                                ? 'โอนเงิน'
                                : 'อื่นๆ'}
                            </span>
                          </td>

                          <td className="text-right">
                            <RowActionsMenu
                              label={`การจัดการใบสำคัญจ่าย ${voucher.voucherNumber}`}
                              testId="voucher-actions"
                              actions={[
                                { label: 'ดู / พิมพ์ใบสำคัญจ่าย (A4)', icon: Printer, onSelect: () => handleOpenVoucherDirect(voucher) },
                                { label: 'ยกเลิกใบสำคัญจ่าย...', icon: XCircle, danger: true, hidden: isCancelled, onSelect: () => void handleCancelVoucher(voucher) },
                              ]}
                            />
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

      <PurchaseOrderPdfModal open={!!pdfPo} onOpenChange={(o) => { if (!o) setPdfPo(null); }} po={pdfPo} />

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
                className="tabular-nums"
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
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
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
