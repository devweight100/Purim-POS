'use client';

import { MemberImport } from '@/components/customers/MemberImport';
import { pointRatesText, rateValue, shopPointRates, type MemberPointFields } from '@shared/loyalty';
import { memberRates, shopRates } from '@/lib/loyalty-rates';
import { CustomerLevelNote } from '@/components/online-orders/CustomerLevelNote';
import { CustomerOnlineFields } from '@/components/online-orders/CustomerOnlineFields';
import { ROW_NAV_CLASS, useRowNav } from "@/lib/use-row-nav";
import { RowDeleteMenu } from '@/components/common/RowDeleteMenu';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Customer, LoyaltySystemConfig, fetchCustomerPage, type CustomerPageStats, fetchLoyaltyConfig, loadLoyaltyConfig, saveLoyaltyConfig } from '@/lib/customer-service';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Search, UserPlus, Edit, Building2, User, CreditCard, Coins, Receipt, Phone, CheckCircle2, AlertCircle, Tag, Gift, RefreshCw, Eye, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store/auth-store';
import { LoadErrorState, errorMessage } from '@/components/common/LoadErrorState';
import { askConfirm } from '@/lib/ask-dialog';

/** The member has at least one rate of their own (else every rate is the shop's). */
function hasOwnRate(c: MemberPointFields | null | undefined): boolean {
  return !!c && [c.pointEarnRateBaht, c.pointEarnUnits, c.pointRedeemRatePoints, c.pointRedeemDiscountBaht].some((v) => rateValue(v) !== null);
}

export default function CustomersPage() {
  const authUser = useAuthStore((st) => st.user);
  // credit limit / terms / block may only be changed by debt managers (enforced by the server too)
  const canEditCredit = !authUser || authUser.role === 'ADMIN' || authUser.role === 'MANAGER' || (Array.isArray(authUser.permissions) && (authUser.permissions.includes('ALL') || authUser.permissions.includes('MANAGE_DEBTS')));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'INDIVIDUAL' | 'COMPANY' | 'credit' | 'hasDebt'>('all');
  const [priceLevelFilter, setPriceLevelFilter] = useState<string>('all');
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltySystemConfig>(loadLoyaltyConfig());

  // Dialog States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<Customer>>({
    type: 'INDIVIDUAL',
    code: '',
    name: '',
    phone: '',
    email: '',
    address: '',
    creditLimit: 0,
    creditTerms: 30,
    currentDebt: 0,
    isCreditBlocked: false,
    priceLevel: 1,
    points: 0,
    // empty = the shop's rate (shared/src/loyalty.ts)
    pointEarnRateBaht: undefined,
    pointEarnUnits: undefined,
    pointRedeemRatePoints: undefined,
    pointRedeemDiscountBaht: undefined,
    companyName: '',
    taxId: '',
    branchType: 'HEAD_OFFICE',
    branchNumber: '00000',
    taxAddress: '',
    contactPerson: '',
    contactPhone: '',
    note: '',
  });

  const [activeFormTab, setActiveFormTab] = useState<'general' | 'tax' | 'credit' | 'loyalty'>('general');

  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Server-side paging / filters / search (GET /customers?page&limit&search&type&priceLevel)
  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = useState(1);
  const [filteredCount, setFilteredCount] = useState(0);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [stats, setStats] = useState<CustomerPageStats>({
    total: 0, individualCount: 0, companyCount: 0, totalCreditCustomers: 0, totalDebt: 0, totalPoints: 0, nextCode: 'CUST-0001',
  });
  // a filter changed: back to page 1 (adjusted while rendering, no extra effect pass)
  const pageResetKey = JSON.stringify([search, typeFilter, priceLevelFilter]);
  const [pageResetKeySeen, setPageResetKeySeen] = useState(pageResetKey);
  if (pageResetKeySeen !== pageResetKey) {
    setPageResetKeySeen(pageResetKey);
    setCurrentPage(1);
  }

  /** Loads one page; state is only updated after the request. */
  const loadData = async () => {
    try {
      const [res, config] = await Promise.all([
        fetchCustomerPage({ page: currentPage, limit: PAGE_SIZE, search: debouncedSearch, type: typeFilter, priceLevel: priceLevelFilter }),
        fetchLoyaltyConfig(),
      ]);
      setCustomers(res.rows);
      setFilteredCount(res.total);
      setStats(res.stats);
      setLoyaltyConfig(config);
      setLoadError(null);
    } catch (err) {
      setCustomers([]);
      setFilteredCount(0);
      setLoadError(errorMessage(err, 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setIsLoading(false);
    }
  };

  const reloadData = async () => {
    setIsLoading(true);
    await loadData();
  };

  useEffect(() => {
    const run = async () => { await loadData(); };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, debouncedSearch, typeFilter, priceLevelFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const filteredCustomers = customers;

  // Open Create Dialog
  const handleOpenAdd = () => {
    const nextCode = stats.nextCode;
    setFormData({
      type: 'INDIVIDUAL',
      code: nextCode,
      name: '',
      phone: '',
      email: '',
      address: '',
      creditLimit: 0,
      creditTerms: 30,
      currentDebt: 0,
      isCreditBlocked: false,
      priceLevel: 1,
      points: 0,
      // a new member follows the shop's rate (it used to get a copy that never followed later changes)
      pointEarnRateBaht: undefined,
      pointEarnUnits: undefined,
      pointRedeemRatePoints: undefined,
      pointRedeemDiscountBaht: undefined,
      companyName: '',
      taxId: '',
      branchType: 'HEAD_OFFICE',
      branchNumber: '00000',
      taxAddress: '',
      contactPerson: '',
      contactPhone: '',
      note: '',
    });
    setSelectedCustomer(null);
    setActiveFormTab('general');
    setIsFormOpen(true);
  };

  // Open Edit Dialog
  const handleOpenEdit = (cust: Customer) => {
    setSelectedCustomer(cust);
    setFormData({ ...cust });
    setActiveFormTab('general');
    setIsFormOpen(true);
  };

  // Open Detail Dialog
  const handleOpenDetail = (cust: Customer) => {
    setSelectedCustomer(cust);
    setIsDetailOpen(true);
  };
  const customerNav = useRowNav(filteredCustomers.length, (i) => handleOpenDetail(filteredCustomers[i]));

  // Save Customer
  const handleSaveCustomer = async () => {
    if (!formData.name?.trim()) {
      toast.error('กรุณากรอกชื่อลูกค้า / ชื่อบริษัท');
      return;
    }
    if (!formData.phone?.trim()) {
      toast.error('กรุณากรอกเบอร์โทรศัพท์');
      return;
    }
    if (!/^[0-9+\-\s()]{3,20}$/.test(formData.phone.trim())) {
      toast.error('เบอร์โทรศัพท์ไม่ถูกต้อง (ใช้ได้เฉพาะตัวเลข - + และช่องว่าง)');
      return;
    }
    if (formData.contactPhone?.trim() && !/^[0-9+\-\s()]{3,20}$/.test(formData.contactPhone.trim())) {
      toast.error('เบอร์ผู้ประสานงานไม่ถูกต้อง (ใช้ได้เฉพาะตัวเลข - + และช่องว่าง)');
      return;
    }
    if (formData.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      toast.error('รูปแบบอีเมลไม่ถูกต้อง');
      return;
    }
    const creditLimitNum = Number(formData.creditLimit ?? 0);
    const creditTermsNum = Number(formData.creditTerms ?? 0);
    if (!Number.isFinite(creditLimitNum) || creditLimitNum < 0) {
      toast.error('วงเงินเครดิตต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      return;
    }
    if (!Number.isInteger(creditTermsNum) || creditTermsNum < 0) {
      toast.error('เครดิตเทอมต้องเป็นจำนวนวันเต็ม ตั้งแต่ 0 ขึ้นไป');
      return;
    }

    try {
      const payload: Record<string, unknown> & { name: string } = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        // รหัสสมาชิก shown in the form is saved (it was not sent: rows without one got a code by list position)
        ...(formData.code?.trim() ? { code: formData.code.trim() } : {}),
        email: formData.email?.trim() || null,
        address: formData.address?.trim() || null,
        type: formData.type || 'INDIVIDUAL',
        priceLevel: formData.priceLevel || 1,
        deliveryFee: formData.deliveryFee ?? null,
        creditLimit: creditLimitNum,
        creditTerms: creditTermsNum,
        isCreditBlocked: Boolean(formData.isCreditBlocked),
        companyName: formData.companyName?.trim() || undefined,
        taxId: formData.taxId?.trim() || undefined,
        branchType: formData.branchType || 'HEAD_OFFICE',
        branchNumber: formData.branchNumber?.trim() || undefined,
        taxAddress: formData.taxAddress?.trim() || undefined,
        contactPerson: formData.contactPerson?.trim() || undefined,
        contactPhone: formData.contactPhone?.trim() || undefined,
        note: formData.note?.trim() || undefined,
        // member's own point rates: a number > 0, or null = the shop's rate (they were not sent before: the form's
        // values were never saved)
        pointEarnRateBaht: rateValue(formData.pointEarnRateBaht),
        pointEarnUnits: rateValue(formData.pointEarnUnits),
        pointRedeemRatePoints: rateValue(formData.pointRedeemRatePoints),
        pointRedeemDiscountBaht: rateValue(formData.pointRedeemDiscountBaht),
      };

      if (selectedCustomer?.id) {
        await apiFetch(`/customers/${selectedCustomer.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success(`แก้ไขข้อมูลสมาชิก "${payload.name}" เรียบร้อยแล้ว`);
      } else {
        await apiFetch('/customers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success(`เพิ่มข้อมูลสมาชิก "${payload.name}" เรียบร้อยแล้ว`);
      }
      setIsFormOpen(false);
      reloadData();
    } catch (err) {
      toast.error((err as Error | undefined)?.message || 'บันทึกข้อมูลลูกค้าไม่สำเร็จ');
    }
  };

  // Delete Customer
  const handleDeleteCustomer = async (cust: Customer) => {
    if (await askConfirm({ title: `คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลสมาชิก "${cust.name}"?`, confirmLabel: 'ลบสมาชิก', danger: true })) {
      try {
        await apiFetch(`/customers/${cust.id}`, { method: 'DELETE' });
        toast.success(`ลบสมาชิก "${cust.name}" เรียบร้อยแล้ว`);
        reloadData();
      } catch (err) {
        toast.error((err as Error | undefined)?.message || 'ลบลูกค้าไม่สำเร็จ');
      }
    }
  };

  // Save Global Loyalty Settings
  const handleSaveLoyaltySettings = async () => {
    if (loadError) {
      // never overwrite the server's loyalty settings with values it has not confirmed
      toast.error('ยังบันทึกไม่ได้: โหลดการตั้งค่าจากเซิร์ฟเวอร์ไม่สำเร็จ กรุณากด "ลองใหม่" ก่อน');
      return;
    }
    try { await saveLoyaltyConfig(loyaltyConfig); }
    catch (error) { toast.error('บันทึกการตั้งค่าคะแนนไม่ได้: ' + (error instanceof Error ? error.message : String(error))); return; }
    toast.success('บันทึกการตั้งค่าระบบคะแนนสะสมเรียบร้อยแล้ว');
    setIsSettingsOpen(false);
    reloadData();
  };

  // Price Level Badge Helper
  const getPriceLevelBadge = (level: number) => {
    // plain text (style pass: no chip around a plain value)
    const names: Record<number, string> = { 1: 'ทั่วไป', 2: 'สมาชิก', 3: 'ช่าง/ส่ง', 4: 'VIP', 5: 'ตัวแทน' };
    return (
      <span className="text-fg">
        ระดับ {level}
        {names[level] && <span className="text-muted-foreground"> ({names[level]})</span>}
      </span>
    );
  };

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title">
            <UserPlus /> ลูกค้าสมาชิกและ CRM (Customers & Membership)
          </h1>
          <p className="page-subtitle">
            จัดการข้อมูลสมาชิก วงเงินเครดิต ระดับราคาขาย อัตราสะสมแต้ม และข้อมูลนิติบุคคลออกใบกำกับภาษี
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            onClick={reloadData}
            className="border-slate-300 text-slate-700 hover:bg-slate-50"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> รีเฟรช
          </Button>
          <MemberImport onImported={() => void reloadData()} />
          <Button
            variant="outline"
            onClick={() => setIsSettingsOpen(true)}
            className="border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
            ตั้งค่าสะสมแต้ม
          </Button>
          <Button
            onClick={handleOpenAdd}
            className="bg-sky-500 hover:bg-sky-600 text-white"
          >
            <UserPlus className="w-4 h-4 mr-1.5" />
            เพิ่มสมาชิกใหม่
          </Button>
        </div>
      </div>

      {/* 1-Row Compact Stats Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white p-2.5 sm:px-4 sm:py-2.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="px-3 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-slate-500" />
            <span>สมาชิกทั้งหมด:</span>
            <b className="font-bold text-slate-900">{stats.total} ราย</b>
            <span className="text-slate-400">({stats.individualCount} บุคคล / {stats.companyCount} บริษัท)</span>
          </div>

          <div className="px-3 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
            <span>ลูกค้าเครดิต:</span>
            <b className="font-bold">{stats.totalCreditCustomers} ราย</b>
          </div>

          <div className="px-3 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            <span>ยอดหนี้ค้างชำระรวม:</span>
            <b className="font-bold text-amber-900">{formatCurrency(stats.totalDebt)}</b>
          </div>

          <div className="px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2">
            <Coins className="w-3.5 h-3.5 text-emerald-600" />
            <span>แต้มสะสมหมุนเวียน:</span>
            <b className="font-bold text-emerald-900">{stats.totalPoints.toLocaleString()} แต้ม</b>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 font-medium">
          ⚙️ เรทกลางของร้าน: {pointRatesText(shopPointRates(loyaltyConfig))}{(loyaltyConfig.minRedeemPoints ?? 0) > 0 ? ` · ใช้ขั้นต่ำ ${loyaltyConfig.minRedeemPoints} แต้ม` : ''}
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs w-full">
        {/* Toolbar */}
        <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row gap-3 items-center justify-between">
          <div className="flex flex-1 flex-col sm:flex-row gap-2.5 w-full lg:max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="ค้นหาชื่อ, เบอร์โทร, เลขผู้เสียภาษี (Tax ID), ชื่อบริษัท, รหัสสมาชิก..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-white border-slate-300"
              />
            </div>

            <select
              value={priceLevelFilter}
              onChange={(e) => setPriceLevelFilter(e.target.value)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-sky-500 shadow-2xs"
            >
              <option value="all">ระดับราคาทั้งหมด</option>
              <option value="1">ระดับ 1 (ทั่วไป)</option>
              <option value="2">ระดับ 2 (สมาชิก)</option>
              <option value="3">ระดับ 3 (ช่าง/ราคาส่ง)</option>
              <option value="4">ระดับ 4 (VIP)</option>
              <option value="5">ระดับ 5 (ตัวแทน)</option>
            </select>
          </div>

          {/* Type Filters */}
          <div className="flex flex-wrap gap-btn w-full lg:w-auto pb-1 lg:pb-0">
            {[
              { value: 'all', label: 'ทั้งหมด' },
              { value: 'INDIVIDUAL', label: 'บุคคลธรรมดา' },
              { value: 'COMPANY', label: 'บริษัท/นิติบุคคล' },
              { value: 'credit', label: 'มีเครดิต' },
              { value: 'hasDebt', label: 'มียอดค้างชำระ' },
            ].map((st) => (
              <Button
                key={st.value}
                variant={typeFilter === st.value ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setTypeFilter(st.value as typeof typeFilter)}
                className={`transition-all ${
                  typeFilter === st.value
                    ? 'bg-sky-50 text-sky-700 border border-sky-300 shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                }`}
              >
                {st.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Customers Table */}
        <div className="w-full">
          <Table className="w-full table-fixed">
            <TableHeader >
              <TableRow>
                <TableHead className="min-w-44 xl:min-w-64">รหัส / ชื่อสมาชิก & บริษัท</TableHead>
                <TableHead >ติดต่อ & เลขผู้เสียภาษี</TableHead>
                <TableHead className="text-center">ระดับราคา</TableHead>
                <TableHead className="text-right">วงเงินเครดิต / ยอดค้าง</TableHead>
                <TableHead className="text-center">แต้มสะสม</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody {...customerNav.bodyProps}>
              {loadError ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <LoadErrorState message={loadError} onRetry={() => void reloadData()} retrying={isLoading} />
                  </TableCell>
                </TableRow>
              ) : filteredCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-48 text-subtle">
                    {isLoading ? 'กำลังโหลด...' : 'ไม่พบข้อมูลลูกค้าที่ตรงกับเงื่อนไขการค้นหา'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers.map((c, ci) => {
                  const isCompany = c.type === 'COMPANY';
                  const hasCredit = (c.creditLimit || 0) > 0;
                  const hasDebt = (c.currentDebt || 0) > 0;

                  return (
                    <TableRow key={c.id} className={`hover:bg-slate-50/80 border-slate-100 transition-colors ${ROW_NAV_CLASS}`} {...customerNav.rowProps(ci)}>
                      {/* Name & Type */}
                      <TableCell className="min-w-44 xl:min-w-64">
                        <div className="flex items-start gap-2.5">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span className="font-medium text-fg line-clamp-2 break-words hover:text-sky-600" title={c.name}>
                                {c.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sub text-muted-foreground mt-0.5">
                              <span className="doc-no">{c.code || '-'}</span>
                              <span>· {isCompany ? 'นิติบุคคล' : 'บุคคล'}</span>
                              {c.companyName && c.companyName !== c.name && (
                                <span className="truncate max-w-[200px] text-muted-foreground">· {c.companyName}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Contact & Tax Info */}
                      <TableCell className="whitespace-nowrap">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-fg tabular-nums">
                            <Phone className="w-3.5 h-3.5 text-subtle" />
                            <span>{c.phone}</span>
                          </div>
                          {c.taxId && (
                            <div className="flex items-center gap-1 text-muted-foreground doc-no text-sub">
                              <Receipt className="w-3 h-3 text-indigo-500" />
                              <span>Tax ID: <b>{c.taxId}</b></span>
                              <span className="text-sub text-subtle">({c.branchType === 'HEAD_OFFICE' ? 'สนญ.' : `สาขา ${c.branchNumber}`})</span>
                            </div>
                          )}
                          {c.contactPerson && (
                            <div className="text-sub text-subtle truncate max-w-[220px]">
                              ผู้ติดต่อ: <span className="text-muted-foreground font-medium">{c.contactPerson}</span>
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* Price Level */}
                      <TableCell className="text-center whitespace-nowrap">
                        {getPriceLevelBadge(c.priceLevel || 1)}
                      </TableCell>

                      {/* Credit & Debt */}
                      <TableCell className="text-right whitespace-nowrap">
                        {hasCredit ? (
                          <div className="space-y-0.5">
                            <div className="text-fg">
                              วงเงิน: <b className="font-medium text-fg">{formatCurrency(c.creditLimit)}</b> ({c.creditTerms || 30} วัน)
                            </div>
                            {hasDebt ? (
                              <Link
                                href={`/debts?customerId=${c.id}&customerName=${encodeURIComponent(c.name)}`}
                                className="font-medium text-danger hover:underline inline-flex items-center gap-1 group"
                                title="คลิกเพื่อเปิดดูบิลค้างชำระและรับชำระเงิน"
                              >
                                <span>ค้างชำระ: {formatCurrency(c.currentDebt)}</span>
                                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform text-danger" />
                              </Link>
                            ) : (
                              <span className="text-ok font-medium">ไม่มียอดค้าง</span>
                            )}
                            {c.isCreditBlocked && (
                              <span className="block text-sub text-danger font-medium">ระงับเครดิตชั่วคราว</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">เงินสด (ไม่มีเครดิต)</span>
                        )}
                      </TableCell>

                      {/* Points & Loyalty */}
                      <TableCell className="text-center">
                        {/* round 3: the member's earn / redeem rate is the badge tooltip (it is the same for most members) */}
                        <div
                          className="whitespace-nowrap tabular-nums text-fg"
                          title={`${pointRatesText(memberRates(c))}${hasOwnRate(c) ? ' (เรทเฉพาะสมาชิก)' : ' (เรทกลางของร้าน)'}`}
                        >
                          {(c.points || 0).toLocaleString()} <span className="text-sub text-muted-foreground">แต้ม</span>
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="w-px whitespace-nowrap">
                        <div className="flex flex-nowrap items-center justify-end gap-btn">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenDetail(c)}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-sky-600 hover:bg-sky-50"
                            title="ดูข้อมูลละเอียด & ใบกำกับภาษี"
                            aria-label={`ดูข้อมูล ${c.name}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenEdit(c)}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50"
                            title="แก้ไขข้อมูลสมาชิก"
                            aria-label={`แก้ไข ${c.name}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <RowDeleteMenu label="ลบสมาชิก" onDelete={() => handleDeleteCustomer(c)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {filteredCount > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3">
            <div className="text-xs text-slate-500 font-medium">
              แสดง <b className="text-slate-800">{(currentPage - 1) * PAGE_SIZE + 1}</b> - <b className="text-slate-800">{Math.min(currentPage * PAGE_SIZE, filteredCount)}</b> จากทั้งหมด <b className="text-slate-800">{filteredCount.toLocaleString()}</b> ราย
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="h-8 px-3 text-xs font-semibold border-slate-300">‹ ก่อนหน้า</Button>
              <span className="px-2 text-xs font-bold text-slate-700">หน้า {currentPage} <span className="font-normal text-slate-400">/ {totalPages}</span></span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="border-slate-300">ถัดไป ›</Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal 1: Create / Edit Customer Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[750px] max-w-[750px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-7 py-4 bg-slate-50 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <UserPlus className="w-5 h-5 text-sky-500" />
              {selectedCustomer ? `แก้ไขข้อมูลสมาชิก: ${selectedCustomer.name}` : 'เพิ่มสมาชิกใหม่ (New Customer)'}
            </DialogTitle>
          </DialogHeader>

          {/* Form Tabs */}
          <div className="flex border-b border-slate-200 bg-slate-100/70 px-7 shrink-0 gap-2 pt-2">
            {[
              { id: 'general', label: '1. ข้อมูลทั่วไป', icon: User },
              { id: 'tax', label: '2. นิติบุคคล & ใบกำกับภาษี', icon: Receipt },
              { id: 'credit', label: '3. เครดิต & ระดับราคา', icon: CreditCard },
              { id: 'loyalty', label: '4. คะแนนสะสม (Loyalty)', icon: Coins },
            ].map((t) => {
              const IconComp = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveFormTab(t.id as typeof activeFormTab)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                    activeFormTab === t.id
                      ? 'border-sky-500 text-sky-700 bg-white rounded-t-lg shadow-2xs'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <IconComp className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4">
            {/* TAB 1: General Info */}
            {activeFormTab === 'general' && (
              <div className="space-y-4 text-xs">
                {/* Type Selection */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700 block">ประเภทลูกค้า *</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, type: 'INDIVIDUAL' })}
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all ${
                        formData.type === 'INDIVIDUAL'
                          ? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-400/30'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <User className="w-4 h-4 text-sky-600" />
                      <span>บุคคลธรรมดา (Individual)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({
                          ...formData,
                          type: 'COMPANY',
                          companyName: formData.companyName || formData.name,
                        });
                      }}
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all ${
                        formData.type === 'COMPANY'
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-800 ring-2 ring-indigo-400/30'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Building2 className="w-4 h-4 text-indigo-600" />
                      <span>นิติบุคคล / บริษัท (Company)</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-700">รหัสสมาชิก</label>
                      <span className="text-[10px] text-slate-400 font-medium">(ระบบสร้างให้อัตโนมัติ)</span>
                    </div>
                    <div className="h-9 px-3 rounded-lg bg-slate-100 border border-slate-200 flex items-center tabular-nums font-bold text-slate-700 text-xs select-none">
                      {formData.code || 'CUST-XXXX (อัตโนมัติ)'}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">
                      {formData.type === 'COMPANY' ? 'ชื่อบริษัท / องค์กร *' : 'ชื่อ - นามสกุล *'}
                    </label>
                    <Input
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder={formData.type === 'COMPANY' ? 'เช่น บริษัท ปุริม จำกัด' : 'เช่น คุณสมชาย ใจดี'}
                      
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">เบอร์โทรศัพท์หลัก *</label>
                    <Input
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="เช่น 081-234-5678"
                      className="tabular-nums"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">อีเมล</label>
                    <Input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="เช่น contact@example.com"
                      
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">ที่อยู่จัดส่ง / ติดต่อทั่วไป</label>
                  <Input
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="บ้านเลขที่, ถนน, ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์"
                    
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">หมายเหตุเพิ่มเติม</label>
                  <Input
                    value={formData.note || ''}
                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                    placeholder="บันทึกข้อความเฉพาะลูกค้าท่านนี้..."
                    
                  />
                </div>
              </div>
            )}

            {/* TAB 2: Corporate & Tax Info */}
            {activeFormTab === 'tax' && (
              <div className="space-y-4 text-xs">
                <div className="bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-200 text-indigo-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Receipt className="w-4 h-4 text-indigo-600" />
                    ข้อมูลผู้เสียภาษีสำหรับออกใบกำกับภาษีเต็มรูป (Full Tax Invoice)
                  </div>
                  <p className="text-[11px] text-indigo-700">
                    ข้อมูลส่วนนี้จะถูกนำไปพิมพ์ลงบนใบเสร็จรับเงิน/ใบกำกับภาษีเมื่อมีการเลือกลูกค้าท่านนี้
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">ชื่อนิติบุคคล / ชื่อจดทะเบียนภาษี</label>
                  <Input
                    value={formData.companyName || ''}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="เช่น บริษัท ปุริมพัฒนา คอนสตรัคชั่น จำกัด"
                    
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1 sm:col-span-2">
                    <label className="font-bold text-slate-700">เลขประจำตัวผู้เสียภาษี 13 หลัก (Tax ID)</label>
                    <Input
                      maxLength={13}
                      value={formData.taxId || ''}
                      onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                      placeholder="เช่น 0105560123456"
                      className="tabular-nums text-indigo-700"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">ประเภทสาขา</label>
                    <select
                      value={formData.branchType || 'HEAD_OFFICE'}
                      onChange={(e) => setFormData({ ...formData, branchType: e.target.value as Customer['branchType'] })}
                      className="w-full h-10 rounded-lg border border-slate-300 bg-white px-2.5 font-medium text-slate-800 outline-none"
                    >
                      <option value="HEAD_OFFICE">สำนักงานใหญ่ (00000)</option>
                      <option value="BRANCH">สาขา (ระบุเลข)</option>
                    </select>
                  </div>
                </div>

                {formData.branchType === 'BRANCH' && (
                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">เลขที่สาขา (5 หลัก)</label>
                    <Input
                      maxLength={5}
                      value={formData.branchNumber || ''}
                      onChange={(e) => setFormData({ ...formData, branchNumber: e.target.value })}
                      placeholder="เช่น 00001"
                      className="tabular-nums"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">ที่อยู่ออกใบกำกับภาษี (Tax Registered Address)</label>
                  <textarea
                    rows={2}
                    value={formData.taxAddress || ''}
                    onChange={(e) => setFormData({ ...formData, taxAddress: e.target.value })}
                    placeholder="ระบุที่อยู่ตามภพ.20 สำหรับพิมพ์ใบกำกับภาษี..."
                    className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">ผู้ประสานงาน / ฝ่ายจัดซื้อ (Contact Person)</label>
                    <Input
                      value={formData.contactPerson || ''}
                      onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                      placeholder="เช่น คุณกิตติศักดิ์"
                      
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">เบอร์โทรผู้ประสานงาน</label>
                    <Input
                      value={formData.contactPhone || ''}
                      onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                      placeholder="เช่น 089-111-2233"
                      className="tabular-nums"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Credit & Price Tier */}
            {activeFormTab === 'credit' && (
              <div className="space-y-4 text-xs">
                {/* 2. Price Level Selection */}
                <div className="space-y-2">
                  <label className="font-bold text-slate-700 block">
                    ระดับราคาขายเริ่มต้นของลูกค้า (Price Level) *
                  </label>
                  <div className="grid grid-cols-5 gap-2 text-center font-bold">
                    {[
                      { level: 1, label: 'ระดับ 1', sub: 'ราคาปกติทั่วไป' },
                      { level: 2, label: 'ระดับ 2', sub: 'ราคาสมาชิก' },
                      { level: 3, label: 'ระดับ 3', sub: 'ช่าง / ขายส่ง' },
                      { level: 4, label: 'ระดับ 4', sub: 'ลูกค้า VIP' },
                      { level: 5, label: 'ระดับ 5', sub: 'ตัวแทนพิเศษ' },
                    ].map((lv) => (
                      <button
                        key={lv.level}
                        type="button"
                        onClick={() => setFormData({ ...formData, priceLevel: lv.level as Customer['priceLevel'] })}
                        className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                          formData.priceLevel === lv.level
                            ? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-400/40 shadow-xs'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Tag className="w-4 h-4 text-sky-600" />
                        <span className="text-xs">{lv.label}</span>
                        <span className="text-[10px] text-slate-400 font-normal truncate">{lv.sub}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    เมื่อเลือกลูกค้ารายนี้ในหน้าขายหน้าร้าน (POS) ระบบจะดึงราคาขายตามระดับนี้ให้อัตโนมัติ
                  </p>
                  <CustomerLevelNote level={formData.priceLevel} />
                </div>

                <CustomerOnlineFields
                  key={selectedCustomer?.id || 'new'}
                  customerId={selectedCustomer?.id}
                  value={formData.deliveryFee}
                  onChange={(v) => setFormData({ ...formData, deliveryFee: v })}
                />

                <div className="border-t border-slate-200 pt-3 space-y-3">
                  {/* 1. Credit Terms */}
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-indigo-600" />
                    การให้เครดิตและวงเงินเชื่อ (Credit Terms)
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-700">วงเงินเครดิต (บาท)</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={!canEditCredit}
                        value={formData.creditLimit ?? 0}
                        onChange={(e) => setFormData({ ...formData, creditLimit: Number(e.target.value) })}
                        placeholder="0 = ไม่ให้เชื่อ"
                        className="text-indigo-600"
                      />
                      <span className="text-[10px] text-slate-400">ใส่ 0 หากซื้อขายสดเท่านั้น</span>
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-slate-700">เครดิตเทอม (วัน)</label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        disabled={!canEditCredit}
                        value={formData.creditTerms ?? 30}
                        onChange={(e) => setFormData({ ...formData, creditTerms: Number(e.target.value) })}
                        placeholder="เช่น 30 วัน"
                        
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-slate-700">ยอดหนี้ค้างชำระปัจจุบัน (บาท)</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.currentDebt ?? 0}
                        onChange={(e) => setFormData({ ...formData, currentDebt: Number(e.target.value) })}
                        className="text-amber-600"
                      />
                    </div>
                  </div>

                  <div className="pt-1">
                    <label className="flex items-center gap-2 p-2 rounded-lg border border-rose-200 bg-rose-50/50 hover:bg-rose-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(formData.isCreditBlocked)}
                        disabled={!canEditCredit}
                        onChange={(e) => setFormData({ ...formData, isCreditBlocked: e.target.checked })}
                        className="accent-rose-600"
                      />
                      <span className="font-bold text-rose-800">ระงับการให้เครดิตชั่วคราว (Block Credit)</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: Loyalty & Points Rules */}
            {activeFormTab === 'loyalty' && (
              <div className="space-y-4 text-xs">
                <div className="bg-amber-50/70 p-3.5 rounded-xl border border-amber-200 text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-amber-600" />
                    กฎการให้และใช้คะแนนสะสมสำหรับสมาชิกรวม (Points & Rewards)
                  </div>
                  <p className="text-[11px] text-amber-800">
                    กำหนดอัตราการสะสมแต้มเมื่อซื้อสินค้า และอัตราแลกแต้มเป็นส่วนลดเงินบาท
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">แต้มสะสมปัจจุบัน (Points Balance)</label>
                  <div className="h-10 flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 font-bold text-amber-700" data-testid="member-points-balance">
                    {(formData.points ?? 0).toLocaleString()} แต้ม
                  </div>
                  <p className="text-[11px] text-slate-500">แต้มเปลี่ยนจากการขาย / แลกแต้ม และการนำเข้าสมาชิก (บันทึกประวัติ &quot;นำเข้าคะแนน&quot;)</p>
                </div>

                <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-900" data-testid="member-rate-hint">
                  เว้นว่าง = ใช้เรทกลางของร้าน ({pointRatesText(shopRates())}) · กรอกตัวเลขมากกว่า 0 = เรทเฉพาะสมาชิกคนนี้
                </p>

                {([
                  { title: 'การให้คะแนนสะสม (Earning Rate)', icon: <Gift className="w-4 h-4 text-emerald-600" />, fields: [
                    { key: 'pointEarnRateBaht', label: 'ยอดซื้อทุกๆ (บาท)', shop: shopRates().earnBaht },
                    { key: 'pointEarnUnits', label: 'ได้คะแนน (แต้ม)', shop: shopRates().earnPoints },
                  ] },
                  { title: 'การใช้คะแนนเป็นส่วนลด (Redemption Rate)', icon: <Coins className="w-4 h-4 text-indigo-600" />, fields: [
                    { key: 'pointRedeemRatePoints', label: 'ใช้คะแนนทุกๆ (แต้ม)', shop: shopRates().redeemPoints },
                    { key: 'pointRedeemDiscountBaht', label: 'ลดได้ (บาท)', shop: shopRates().redeemBaht },
                  ] },
                ] as const).map((g) => (
                  <div key={g.title} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                    <div className="font-bold text-slate-800 flex items-center gap-1.5">{g.icon}{g.title}</div>
                    <div className="grid grid-cols-2 gap-3 items-start">
                      {g.fields.map((f) => (
                        <div key={f.key} className="space-y-1">
                          <label htmlFor={`member-${f.key}`} className="text-[11px] text-slate-500 font-semibold">{f.label} · เว้นว่าง = ใช้เรทกลางของร้าน</label>
                          <Input
                            id={`member-${f.key}`}
                            type="number"
                            min="0"
                            step="any"
                            value={formData[f.key] ?? ''}
                            placeholder={`เรทกลาง ${f.shop.toLocaleString()}`}
                            onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                            className="text-slate-900"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[12px] font-semibold text-emerald-900" data-testid="member-effective-rate">
                  เรทที่ใช้จริงของสมาชิกคนนี้: {pointRatesText(memberRates(formData))}
                  <span className="ml-1 font-normal text-emerald-800">({hasOwnRate(formData) ? 'มีเรทเฉพาะสมาชิก' : 'ใช้เรทกลางของร้านทั้งหมด'})</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="m-0 border-t border-slate-200 px-7 py-4.5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
            <Button
              variant="ghost"
              onClick={() => setIsFormOpen(false)}
              className="text-slate-600 hover:bg-slate-200/60"
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handleSaveCustomer}
              className="bg-sky-500 hover:bg-sky-600 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> บันทึกข้อมูลสมาชิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Customer Detail Dialog (Tax Invoice & Ledger View) */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[650px] max-w-[650px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-7 py-4.5 bg-slate-50 shrink-0">
            <DialogTitle className="flex items-center justify-between text-xl font-semibold text-slate-900">
              <div className="flex items-center gap-2.5">
                {selectedCustomer?.type === 'COMPANY' ? (
                  <Building2 className="w-6 h-6 text-indigo-600" />
                ) : (
                  <User className="w-6 h-6 text-sky-500" />
                )}
                <span>{selectedCustomer?.name}</span>
              </div>
              <Badge variant="outline" className="tabular-nums font-bold text-sm bg-slate-100 px-2.5 py-1">
                {selectedCustomer?.code}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4 text-sm">
            {/* Quick Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-sky-50 p-3.5 rounded-xl border border-sky-200 text-center">
                <span className="text-slate-600 block text-xs font-bold">ระดับราคา</span>
                <div className="mt-1.5">{selectedCustomer && getPriceLevelBadge(selectedCustomer.priceLevel)}</div>
              </div>
              <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200 text-center">
                <span className="text-amber-800 block text-xs font-bold">แต้มสะสมปัจจุบัน</span>
                <b className="text-amber-900 text-lg font-semibold block mt-0.5">{(selectedCustomer?.points || 0).toLocaleString()} แต้ม</b>
              </div>
              <div className="bg-rose-50/80 p-3.5 rounded-xl border border-rose-200 text-center">
                <span className="text-rose-800 block text-xs font-bold">ยอดหนี้คงค้าง</span>
                <b className="text-rose-600 text-lg font-semibold block mt-0.5">{formatCurrency(selectedCustomer?.currentDebt || 0)}</b>
                {(selectedCustomer?.currentDebt || 0) > 0 && (
                  <Link
                    href={`/debts?customerId=${selectedCustomer?.id}&customerName=${encodeURIComponent(selectedCustomer?.name || '')}`}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-white font-bold bg-rose-600 hover:bg-rose-700 px-2.5 py-1 rounded-lg shadow-2xs transition-colors"
                  >
                    <span>ดูบิล / ชำระหนี้</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>

            {/* Tax Info Card */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5">
              <div className="font-bold text-slate-900 text-base flex items-center gap-2 border-b pb-2">
                <Receipt className="w-4 h-4 text-indigo-600" />
                ข้อมูลสำหรับพิมพ์ใบกำกับภาษี (Tax Invoice Details)
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-slate-500 block text-xs font-bold">ชื่อจดทะเบียน:</span>
                  <b className="text-slate-900 font-bold text-sm sm:text-base">{selectedCustomer?.companyName || selectedCustomer?.name || '-'}</b>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs font-bold">เลขประจำตัวผู้เสียภาษี (Tax ID):</span>
                  <b className="text-indigo-700 tabular-nums font-bold text-sm sm:text-base">{selectedCustomer?.taxId || '-'}</b>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs font-bold">สาขา:</span>
                  <span className="text-slate-800 font-semibold text-sm">
                    {selectedCustomer?.branchType === 'HEAD_OFFICE' ? 'สำนักงานใหญ่ (00000)' : `สาขา ${selectedCustomer?.branchNumber}`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs font-bold">ผู้ประสานงาน:</span>
                  <span className="text-slate-800 font-semibold text-sm">{selectedCustomer?.contactPerson || '-'} ({selectedCustomer?.contactPhone || selectedCustomer?.phone})</span>
                </div>
              </div>
              <div>
                <span className="text-slate-500 block text-xs font-bold">ที่อยู่ออกใบกำกับภาษี:</span>
                <span className="text-slate-800 font-medium text-sm">{selectedCustomer?.taxAddress || selectedCustomer?.address || '-'}</span>
              </div>
            </div>

            {/* Credit & Terms */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5">
              <div className="font-bold text-slate-900 text-base flex items-center gap-2 border-b pb-2">
                <CreditCard className="w-4 h-4 text-indigo-600" />
                เงื่อนไขเครดิตและการชำระเงิน
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-slate-500 block text-xs font-bold">วงเงินเครดิตสูงสุด:</span>
                  <b className="text-slate-900 font-semibold text-sm sm:text-base">{formatCurrency(selectedCustomer?.creditLimit || 0)}</b>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs font-bold">ระยะเวลาเครดิตเทอม:</span>
                  <b className="text-slate-900 font-semibold text-sm sm:text-base">{selectedCustomer?.creditTerms || 0} วัน</b>
                </div>
              </div>
            </div>

            {/* Points Rules */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5">
              <div className="font-bold text-slate-900 text-base flex items-center gap-2 border-b pb-2">
                <Coins className="w-4 h-4 text-amber-600" />
                สิทธิประโยชน์คะแนนสะสม
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-slate-500 block text-xs font-bold">อัตราได้รับแต้ม:</span>
                  <span className="text-emerald-700 font-bold text-sm">ซื้อครบ {memberRates(selectedCustomer).earnBaht.toLocaleString()}฿ ได้ {memberRates(selectedCustomer).earnPoints.toLocaleString()} แต้ม</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs font-bold">อัตราแลกส่วนลด:</span>
                  <span className="text-indigo-700 font-bold text-sm">ใช้ {memberRates(selectedCustomer).redeemPoints.toLocaleString()} แต้ม = ส่วนลด {memberRates(selectedCustomer).redeemBaht.toLocaleString()}฿</span>
                  <span className="block text-[11px] text-slate-500">{hasOwnRate(selectedCustomer) ? 'เรทเฉพาะสมาชิกคนนี้' : 'ใช้เรทกลางของร้าน'}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="m-0 border-t border-slate-200 px-7 py-4.5 bg-slate-50 shrink-0 flex justify-end">
            <Button onClick={() => setIsDetailOpen(false)} className="bg-slate-800 hover:bg-slate-900 text-white">
              ปิดหน้าต่าง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 3: Global Loyalty Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md rounded-2xl shadow-2xl p-0 overflow-hidden">
          <DialogHeader className="border-b border-slate-200 px-6 py-4 bg-slate-50">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              <SlidersHorizontal className="w-5 h-5 text-indigo-600" />
              ตั้งค่าระบบคะแนนสะสมมาตรฐาน (Default Loyalty Config)
            </DialogTitle>
          </DialogHeader>

          <div className="p-6 space-y-4 text-xs">
            <p className="text-slate-500 text-[11px]">
              เรทกลางของร้าน: ใช้กับสมาชิกทุกคนที่ไม่ได้กำหนดเรทเฉพาะตัว (ช่องเรทในข้อมูลสมาชิกเว้นว่าง) ทั้งหน้าขาย การบันทึกบิล และใบเสร็จ
            </p>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <Gift className="w-4 h-4 text-emerald-600" />
                3. อัตราการให้คะแนนสะสม
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-500 font-semibold">ยอดซื้อทุกๆ (บาท):</label>
                  <Input
                    type="number"
                    min="1"
                    value={loyaltyConfig.defaultPointEarnRateBaht}
                    onChange={(e) =>
                      setLoyaltyConfig({
                        ...loyaltyConfig,
                        defaultPointEarnRateBaht: Number(e.target.value),
                      })
                    }
                    
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 font-semibold">ได้กี่คะแนน (แต้ม):</label>
                  <Input
                    type="number"
                    min="1"
                    value={loyaltyConfig.defaultPointEarnUnits}
                    onChange={(e) =>
                      setLoyaltyConfig({
                        ...loyaltyConfig,
                        defaultPointEarnUnits: Number(e.target.value),
                      })
                    }
                    className="text-emerald-600"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-indigo-600" />
                4. อัตราการแลกคะแนนเป็นส่วนลด
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-500 font-semibold">ใช้กี่คะแนน (แต้ม):</label>
                  <Input
                    type="number"
                    min="1"
                    value={loyaltyConfig.defaultPointRedeemRatePoints}
                    onChange={(e) =>
                      setLoyaltyConfig({
                        ...loyaltyConfig,
                        defaultPointRedeemRatePoints: Number(e.target.value),
                      })
                    }
                    
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 font-semibold">ลดได้กี่บาท (บาท):</label>
                  <Input
                    type="number"
                    min="1"
                    value={loyaltyConfig.defaultPointRedeemDiscountBaht}
                    onChange={(e) =>
                      setLoyaltyConfig({
                        ...loyaltyConfig,
                        defaultPointRedeemDiscountBaht: Number(e.target.value),
                      })
                    }
                    className="text-indigo-600"
                  />
                </div>
              </div>
            </div>
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1">
              <label htmlFor="loyalty-min-redeem" className="text-[11px] text-slate-500 font-semibold">ใช้แต้มขั้นต่ำต่อครั้ง (แต้ม) · 0 = ไม่มีขั้นต่ำ</label>
              <Input
                id="loyalty-min-redeem"
                type="number"
                min="0"
                step="1"
                value={loyaltyConfig.minRedeemPoints ?? 0}
                onChange={(e) => setLoyaltyConfig({ ...loyaltyConfig, minRedeemPoints: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
            </div>
          </div>

          <DialogFooter className="m-0 border-t border-slate-200 px-6 py-4.5 bg-slate-50 flex justify-between">
            <Button variant="ghost" onClick={() => setIsSettingsOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleSaveLoyaltySettings} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> บันทึกการตั้งค่า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
