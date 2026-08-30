'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Building2, Receipt, DollarSign, Plus, Search, Filter, 
  CreditCard, Banknote, ShieldAlert, CheckCircle2, Clock, 
  ArrowLeftRight, FileText, Printer, Eye, ChevronRight, RefreshCw, AlertCircle, RotateCcw, XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  loadPayableBills, 
  SupplierPayableBill, 
  PayablePaymentEntry,
  rollbackPayableBillPayment,
  cancelPayableBill
} from '@/lib/payable-service';
import { 
  loadSuppliers, 
  loadSupplierReturnNotes
} from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';
import { SettlePayableModal } from '@/components/payables/SettlePayableModal';
import { PaymentVoucherModal } from '@/components/payables/PaymentVoucherModal';
import { PayableBillDetailsModal } from '@/components/payables/PayableBillDetailsModal';

export default function PayablesPage() {
  const [bills, setBills] = useState<SupplierPayableBill[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [returnNotes, setReturnNotes] = useState<SupplierReturnNote[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals
  const [selectedBillForSettle, setSelectedBillForSettle] = useState<SupplierPayableBill | null>(null);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);

  const [selectedPaymentForVoucher, setSelectedPaymentForVoucher] = useState<PayablePaymentEntry | null>(null);
  const [selectedBillForVoucher, setSelectedBillForVoucher] = useState<SupplierPayableBill | null>(null);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);

  const [selectedBillForDetails, setSelectedBillForDetails] = useState<SupplierPayableBill | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const refreshData = () => {
    setLoading(true);
    try {
      const allBills = loadPayableBills();
      setBills(allBills);

      const supps = loadSuppliers();
      setSuppliers(supps);

      const notes = loadSupplierReturnNotes();
      setReturnNotes(notes);
    } catch (e) {
      console.error('Failed to load payables data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleOpenSettle = (bill: SupplierPayableBill) => {
    setSelectedBillForSettle(bill);
    setIsSettleModalOpen(true);
  };

  const handleOpenVoucher = (bill: SupplierPayableBill, payment: PayablePaymentEntry) => {
    setSelectedBillForVoucher(bill);
    setSelectedPaymentForVoucher(payment);
    setIsVoucherModalOpen(true);
  };

  const handleOpenDetails = (bill: SupplierPayableBill) => {
    setSelectedBillForDetails(bill);
    setIsDetailsModalOpen(true);
  };

  const handleRollbackBill = (bill: SupplierPayableBill) => {
    if (!confirm(`ต้องการย้อนสถานะการชำระเงินของบิล ${bill.poNumber} หรือไม่?\n(ยอดเงินที่จ่ายและเครดิตใบลดหนี้จะถูกคืนกลับสถานะเดิม ยอดหนี้จะกลับมาค้างชำระ)`)) {
      return;
    }
    const res = rollbackPayableBillPayment(bill.poId);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  const handleRollbackSinglePayment = (poId: string, paymentId: string) => {
    if (!confirm(`ต้องการยกเลิก/ย้อนสถานะการชำระเงินรอบนี้หรือไม่?\n(ยอดเงินและเครดิตใบลดหนี้ในรอบนี้จะถูกคืนกลับสถานะเดิม)`)) {
      return;
    }
    const res = rollbackPayableBillPayment(poId, paymentId);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  const handleCancelBillAction = (bill: SupplierPayableBill) => {
    const reason = prompt(`กรุณาระบุเหตุผลการยกเลิกบิล ${bill.poNumber}:`);
    if (reason === null) return;
    const res = cancelPayableBill(bill.poId, reason);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  // KPIs
  const totalOutstandingDebt = bills.reduce((sum, b) => sum + b.remainingPayable, 0);
  const unpaidBillsCount = bills.filter((b) => b.paymentStatus !== 'PAID').length;
  
  const availableDebitNotes = returnNotes.filter(
    (n) => n.status !== 'CANCELLED' && n.remainingCreditAmount > 0
  );
  const totalAvailableDebitCredit = availableDebitNotes.reduce(
    (sum, n) => sum + Number(n.remainingCreditAmount || 0),
    0
  );

  const totalPaidAmount = bills.reduce(
    (sum, b) => sum + b.alreadyPaidAmount + b.alreadyDeductedReturns,
    0
  );

  // Filtered Bills
  const filteredBills = bills.filter((b) => {
    const matchesSearch =
      b.poNumber.toLowerCase().includes(search.toLowerCase()) ||
      b.supplierName.toLowerCase().includes(search.toLowerCase());

    const matchesSupplier = supplierFilter === 'ALL' || b.supplierId === supplierFilter;

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'UNPAID' && b.paymentStatus === 'UNPAID') ||
      (statusFilter === 'PARTIALLY_PAID' && b.paymentStatus === 'PARTIALLY_PAID') ||
      (statusFilter === 'PAID' && b.paymentStatus === 'PAID');

    return matchesSearch && matchesSupplier && matchesStatus;
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                เจ้าหนี้การค้า & บิลค้างจ่ายบริษัท (Accounts Payable)
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                จัดการหนี้ค้างชำระจากการรับสินค้า (PO), ประกบเอกสารลดหนี้ (Debit Note) เพื่อหักยอด และบันทึกจ่ายเงิน
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/supplier-returns">
            <Button
              variant="outline"
              className="rounded-2xl font-bold text-indigo-700 border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 gap-1.5 h-11"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>ส่งเคลม / ใบลดหนี้</span>
            </Button>
          </Link>

          <Button
            type="button"
            variant="outline"
            onClick={refreshData}
            className="rounded-2xl font-bold text-slate-600 border-slate-200 hover:bg-slate-50 gap-1.5 h-11 px-4"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>รีเฟรช</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Outstanding AP Debt */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">ยอดหนี้ค้างจ่ายรวม</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-amber-700 font-mono">
              {formatCurrency(totalOutstandingDebt)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            ยอดเงินที่ต้องชำระให้แก่คู่ค้าบริษัท
          </p>
        </div>

        {/* Card 2: Unpaid Bills Count */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">บิลที่ยังค้างชำระ</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-slate-900 font-mono">
              {unpaidBillsCount}
            </span>
            <span className="text-xs text-slate-400 font-bold ml-1.5">บิล</span>
          </div>
          <p className="text-[11px] text-rose-600 font-bold">
            รอชำระหรือชำระบางส่วน
          </p>
        </div>

        {/* Card 3: Available Debit Notes */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">ใบลดหนี้พร้อมประกบหัก</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-indigo-700 font-mono">
              {formatCurrency(totalAvailableDebitCredit)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            รวม {availableDebitNotes.length} ฉบับพร้อมนำมาหักลดหนี้
          </p>
        </div>

        {/* Card 4: Total Paid to Date */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">ชำระแล้วทั้งหมด</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-emerald-700 font-mono">
              {formatCurrency(totalPaidAmount)}
            </span>
          </div>
          <p className="text-[11px] text-emerald-600 font-bold">
            ชำระเงินสด/โอน และหักใบลดหนี้สะสม
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="bills" className="w-full space-y-4">
        <TabsList className="bg-slate-100 p-1 rounded-2xl h-11">
          <TabsTrigger
            value="bills"
            className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:shadow-xs px-4"
          >
            รายการบิลเจ้าหนี้ ({bills.length})
          </TabsTrigger>
          <TabsTrigger
            value="suppliers"
            className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:shadow-xs px-4 gap-1.5"
          >
            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>สรุปยอดหนี้ตามบริษัท ({suppliers.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:shadow-xs px-4 gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-600" />
            <span>ประวัติการจ่ายเงิน & ใบสำคัญจ่าย</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: PAYABLE BILLS LIST */}
        <TabsContent value="bills" className="space-y-4 m-0">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="ค้นหาเลขที่ PO, ชื่อบริษัทผู้จำหน่าย..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-11 text-xs bg-slate-50 border-slate-200 rounded-2xl"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="h-11 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 w-full md:w-56"
              >
                <option value="ALL">🏢 ผู้จำหน่ายทั้งหมด</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-11 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 w-full md:w-40"
              >
                <option value="ALL">ทุกสถานะการชำระ</option>
                <option value="UNPAID">รอชำระ</option>
                <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
                <option value="PAID">ชำระครบแล้ว</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
            {filteredBills.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Receipt className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-base font-bold text-slate-600">ไม่พบบิลเจ้าหนี้ค้างชำระ</p>
                <p className="text-xs text-slate-400">เมื่อมีใบสั่งซื้อหรือรับของเข้าคลัง หนี้จะแสดงขึ้นที่นี่อัตโนมัติ</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5 text-left">เลขที่ PO / วันที่</th>
                      <th className="p-3.5 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="p-3.5 text-right">ยอดหนี้ตามบิล</th>
                      <th className="p-3.5 text-right">ส่วนลดท้ายบิล</th>
                      <th className="p-3.5 text-right">ประกบใบลดหนี้</th>
                      <th className="p-3.5 text-right">จ่ายเงินแล้ว</th>
                      <th className="p-3.5 text-right">หนี้คงเหลือสุทธิ</th>
                      <th className="p-3.5 text-center">สถานะ</th>
                      <th className="p-3.5 text-center w-36">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBills.map((bill) => (
                      <tr key={bill.poId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3.5 font-mono">
                          <span className="font-bold text-slate-900 text-sm block">{bill.poNumber}</span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(bill.billDate).toLocaleDateString('th-TH')}
                          </span>
                        </td>

                        <td className="p-3.5">
                          <p className="font-bold text-slate-900">{bill.supplierName}</p>
                          {bill.supplierPhone && (
                            <p className="text-[10.5px] text-slate-400 font-mono">{bill.supplierPhone}</p>
                          )}
                        </td>

                        <td className="p-3.5 text-right font-mono font-bold text-slate-800">
                          {formatCurrency(bill.totalAmount)}
                        </td>

                        <td className="p-3.5 text-right font-mono">
                          {bill.alreadyDiscountAmount > 0 ? (
                            <span className="text-amber-700 font-bold">
                              {formatCurrency(bill.alreadyDiscountAmount)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="p-3.5 text-right font-mono">
                          {bill.alreadyDeductedReturns > 0 ? (
                            <span className="text-indigo-600 font-bold">
                              {formatCurrency(bill.alreadyDeductedReturns)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="p-3.5 text-right font-mono">
                          {bill.alreadyPaidAmount > 0 ? (
                            <span className="text-emerald-700 font-bold">
                              {formatCurrency(bill.alreadyPaidAmount)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="p-3.5 text-right font-mono font-black text-sm">
                          {bill.remainingPayable > 0 ? (
                            <span className="text-amber-700">
                              {formatCurrency(bill.remainingPayable)}
                            </span>
                          ) : (
                            <span className="text-emerald-600 font-bold">
                              ฿0.00 (ครบแล้ว)
                            </span>
                          )}
                        </td>

                        <td className="p-3.5 text-center">
                          {bill.paymentStatus === 'PAID' ? (
                            <Badge className="bg-emerald-600 text-white font-bold">ชำระครบแล้ว</Badge>
                          ) : bill.paymentStatus === 'PARTIALLY_PAID' ? (
                            <Badge className="bg-sky-600 text-white font-bold">ชำระบางส่วน</Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50 font-bold">
                              รอชำระ
                            </Badge>
                          )}
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenDetails(bill)}
                              title="ดูรายละเอียดบิลและประวัติการชำระ"
                              className="h-8 px-2.5 rounded-xl border-slate-200 hover:border-slate-300 font-bold text-xs gap-1"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-600" />
                              <span>ดูเอกสาร</span>
                            </Button>

                            {bill.remainingPayable > 0 && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenSettle(bill)}
                                title="ประกบใบลดหนี้หรือบันทึกจ่ายเงิน"
                                className="h-8 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1 shadow-xs"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                                <span>ชำระหนี้</span>
                              </Button>
                            )}

                            {(bill.alreadyPaidAmount > 0 || bill.alreadyDeductedReturns > 0 || bill.alreadyDiscountAmount > 0 || bill.paymentStatus === 'PAID') && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRollbackBill(bill)}
                                title="ย้อนสถานะการชำระเงินกลับเป็นรอชำระ"
                                className="h-8 px-2 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 font-bold text-xs gap-1"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>ย้อนสถานะ</span>
                              </Button>
                            )}

                            {bill.paymentStatus === 'UNPAID' && bill.status !== 'CANCELLED' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCancelBillAction(bill)}
                                title="ยกเลิกบิลเจ้าหนี้นี้"
                                className="h-8 px-2 rounded-xl text-slate-400 hover:text-rose-600 font-bold text-xs gap-1"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>ยกเลิก</span>
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
          </div>
        </TabsContent>

        {/* TAB 2: SUMMARY BY SUPPLIER */}
        <TabsContent value="suppliers" className="space-y-4 m-0">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map((supp) => {
              const suppBills = bills.filter((b) => b.supplierId === supp.id);
              const suppDebt = suppBills.reduce((s, b) => s + b.remainingPayable, 0);
              const suppCreditNotes = returnNotes.filter(
                (n) => n.supplierId === supp.id && n.status !== 'CANCELLED' && n.remainingCreditAmount > 0
              );
              const suppCreditTotal = suppCreditNotes.reduce((s, n) => s + Number(n.remainingCreditAmount || 0), 0);

              const firstOpenBill = suppBills.find((b) => b.remainingPayable > 0);

              return (
                <div
                  key={supp.id}
                  className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="max-w-[70%]">
                        <h3 className="font-bold text-slate-900 text-sm truncate">{supp.name}</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {supp.contactName ? `ติดต่อ: ${supp.contactName}` : supp.phone || 'ไม่มีข้อมูลติดต่อ'}
                        </p>
                      </div>
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] font-bold">
                        {suppBills.filter((b) => b.remainingPayable > 0).length} บิลค้าง
                      </Badge>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-1 text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>ยอดหนี้ค้างจ่ายรวม:</span>
                        <strong className="font-mono text-amber-800 text-sm">{formatCurrency(suppDebt)}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>ใบลดหนี้พร้อมประกบ:</span>
                        <strong className="font-mono text-indigo-700">
                          {suppCreditNotes.length} ฉบับ ({formatCurrency(suppCreditTotal)})
                        </strong>
                      </div>
                    </div>
                  </div>

                  {firstOpenBill ? (
                    <Button
                      type="button"
                      onClick={() => handleOpenSettle(firstOpenBill)}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-9 text-xs rounded-xl shadow-xs gap-1.5"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>ประกบลดหนี้ & ชำระเงินบิล ({firstOpenBill.poNumber})</span>
                    </Button>
                  ) : (
                    <p className="text-center text-[11px] text-emerald-600 font-bold py-1">
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
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
            {bills.flatMap((b) => (b.payments || []).map((p) => ({ ...p, bill: b }))).length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <FileText className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-base font-bold text-slate-600">ยังไม่มีประวัติการชำระเงินเจ้าหนี้</p>
                <p className="text-xs text-slate-400">เมื่อมีการประกบใบลดหนี้และบันทึกจ่ายเงิน ใบสำคัญจ่ายจะปรากฏที่นี่</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5 text-left">เลขที่สำคัญจ่าย / วันที่</th>
                      <th className="p-3.5 text-left">บิล PO ที่ชำระ</th>
                      <th className="p-3.5 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="p-3.5 text-right">ยอดหนี้ตามบิล</th>
                      <th className="p-3.5 text-right">ส่วนลดท้ายบิล</th>
                      <th className="p-3.5 text-right">ประกบหักใบลดหนี้</th>
                      <th className="p-3.5 text-right">เงินสด/โอนที่จ่ายจริง</th>
                      <th className="p-3.5 text-center">วิธีชำระ</th>
                      <th className="p-3.5 text-center w-28">ใบสำคัญจ่าย</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bills.flatMap((b) => (b.payments || []).map((p) => ({ ...p, bill: b }))).map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3.5 font-mono">
                          <span className="font-bold text-indigo-700 text-sm block">{item.id}</span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(item.paymentDate).toLocaleDateString('th-TH')}
                          </span>
                        </td>

                        <td className="p-3.5 font-mono font-bold text-slate-800">
                          {item.bill.poNumber}
                        </td>

                        <td className="p-3.5 font-bold text-slate-900">
                          {item.bill.supplierName}
                        </td>

                        <td className="p-3.5 text-right font-mono">
                          {formatCurrency(item.totalBillAmount)}
                        </td>

                        <td className="p-3.5 text-right font-mono text-amber-700 font-bold">
                          {item.discountAmount && item.discountAmount > 0 ? formatCurrency(item.discountAmount) : '-'}
                        </td>

                        <td className="p-3.5 text-right font-mono text-indigo-700 font-bold">
                          {item.deductedCreditAmount > 0 ? formatCurrency(item.deductedCreditAmount) : '-'}
                        </td>

                        <td className="p-3.5 text-right font-mono text-emerald-700 font-bold text-sm">
                          {formatCurrency(item.netCashOrTransferPaid)}
                        </td>

                        <td className="p-3.5 text-center">
                          <Badge variant="outline" className="text-[10px] font-bold">
                            {item.paymentMethod === 'CASH'
                              ? '💵 เงินสด'
                              : item.paymentMethod === 'TRANSFER'
                              ? '📱 โอนเงิน'
                              : '💳 อื่นๆ'}
                          </Badge>
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenVoucher(item.bill, item)}
                              className="h-8 px-2.5 rounded-xl border-slate-200 hover:border-indigo-300 hover:text-indigo-600 font-bold text-xs gap-1"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>พิมพ์</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRollbackSinglePayment(item.bill.poId, item.id)}
                              title="ยกเลิก/ย้อนสถานะการชำระเงินรอบนี้"
                              className="h-8 px-2 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 font-bold text-xs gap-1"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>ย้อนสถานะ</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

      {/* Settle Payable & Match Debit Note Modal */}
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

      {/* Payment Voucher Modal */}
      <PaymentVoucherModal
        open={isVoucherModalOpen}
        onOpenChange={setIsVoucherModalOpen}
        paymentEntry={selectedPaymentForVoucher}
        bill={selectedBillForVoucher}
      />
    </div>
  );
}
