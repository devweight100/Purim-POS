'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import {
  Customer,
  CustomerType,
  LoyaltySystemConfig,
  loadCustomers,
  saveCustomers,
  upsertCustomer,
  deleteCustomer,
  loadLoyaltyConfig,
  saveLoyaltyConfig,
  calculateEarnedPoints,
  calculateRedemptionDiscount,
  generateNextCustomerCode,
} from '@/lib/customer-service';
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
import {
  Search,
  UserPlus,
  Edit,
  Trash2,
  Building2,
  User,
  CreditCard,
  Coins,
  Receipt,
  Phone,
  Mail,
  MapPin,
  FileText,
  Sliders,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Tag,
  Gift,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  ArrowRight,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

export default function CustomersPage() {
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
    pointEarnRateBaht: 500,
    pointEarnUnits: 10,
    pointRedeemRatePoints: 100,
    pointRedeemDiscountBaht: 1,
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

  const reloadData = async () => {
    try {
      const list = await apiFetch('/customers');
      setCustomers(Array.isArray(list) ? list : []);
    } catch {
      setCustomers([]);
    }
    setLoyaltyConfig(loadLoyaltyConfig());
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Summary Stats
  const stats = useMemo(() => {
    let total = customers.length;
    let individualCount = 0;
    let companyCount = 0;
    let totalCreditCustomers = 0;
    let totalDebt = 0;
    let totalPoints = 0;

    customers.forEach((c) => {
      if (c.type === 'COMPANY') companyCount++;
      else individualCount++;

      if (c.creditLimit > 0) totalCreditCustomers++;
      totalDebt += Number(c.currentDebt || 0);
      totalPoints += Number(c.points || 0);
    });

    return {
      total,
      individualCount,
      companyCount,
      totalCreditCustomers,
      totalDebt,
      totalPoints,
    };
  }, [customers]);

  // Filtered List
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch =
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.companyName && c.companyName.toLowerCase().includes(q)) ||
        (c.taxId && c.taxId.includes(q)) ||
        (c.contactPerson && c.contactPerson.toLowerCase().includes(q));

      let matchType = true;
      if (typeFilter === 'INDIVIDUAL') matchType = c.type === 'INDIVIDUAL';
      else if (typeFilter === 'COMPANY') matchType = c.type === 'COMPANY';
      else if (typeFilter === 'credit') matchType = (c.creditLimit || 0) > 0;
      else if (typeFilter === 'hasDebt') matchType = (c.currentDebt || 0) > 0;

      let matchPrice = true;
      if (priceLevelFilter !== 'all') {
        matchPrice = c.priceLevel === Number(priceLevelFilter);
      }

      return matchSearch && matchType && matchPrice;
    });
  }, [customers, search, typeFilter, priceLevelFilter]);

  // Open Create Dialog
  const handleOpenAdd = () => {
    const nextCode = generateNextCustomerCode();
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
      pointEarnRateBaht: loyaltyConfig.defaultPointEarnRateBaht,
      pointEarnUnits: loyaltyConfig.defaultPointEarnUnits,
      pointRedeemRatePoints: loyaltyConfig.defaultPointRedeemRatePoints,
      pointRedeemDiscountBaht: loyaltyConfig.defaultPointRedeemDiscountBaht,
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

    try {
      const payload: any = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        email: formData.email?.trim() || undefined,
        address: formData.address?.trim() || undefined,
        type: formData.type || 'INDIVIDUAL',
        priceLevel: formData.priceLevel || 1,
        creditLimit: Number(formData.creditLimit || 0),
        creditTerms: Number(formData.creditTerms || 0),
        companyName: formData.companyName?.trim() || undefined,
        taxId: formData.taxId?.trim() || undefined,
        branchType: formData.branchType || 'HEAD_OFFICE',
        branchNumber: formData.branchNumber?.trim() || undefined,
        taxAddress: formData.taxAddress?.trim() || undefined,
        contactPerson: formData.contactPerson?.trim() || undefined,
        contactPhone: formData.contactPhone?.trim() || undefined,
        note: formData.note?.trim() || undefined,
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
    } catch (err: any) {
      toast.error('เกิดข้อผิดพลาด: ' + (err.message || 'ไม่สามารถบันทึกได้'));
    }
  };

  // Delete Customer
  const handleDeleteCustomer = async (cust: Customer) => {
    if (confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลสมาชิก "${cust.name}"?`)) {
      try {
        await apiFetch(`/customers/${cust.id}`, { method: 'DELETE' });
        toast.success(`ลบสมาชิก "${cust.name}" เรียบร้อยแล้ว`);
        reloadData();
      } catch (err: any) {
        toast.error('เกิดข้อผิดพลาดในการลบ: ' + err.message);
      }
    }
  };

  // Save Global Loyalty Settings
  const handleSaveLoyaltySettings = () => {
    saveLoyaltyConfig(loyaltyConfig);
    toast.success('บันทึกการตั้งค่าระบบคะแนนสะสมเรียบร้อยแล้ว');
    setIsSettingsOpen(false);
    reloadData();
  };

  // Price Level Badge Helper
  const getPriceLevelBadge = (level: number) => {
    switch (level) {
      case 1:
        return <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-xs font-semibold">ระดับ 1 (ทั่วไป)</Badge>;
      case 2:
        return <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-300 text-xs font-bold">ระดับ 2 (สมาชิก)</Badge>;
      case 3:
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-xs font-bold">ระดับ 3 (ช่าง/ส่ง)</Badge>;
      case 4:
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300 text-xs font-bold">ระดับ 4 (VIP)</Badge>;
      case 5:
        return <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 text-xs font-bold">ระดับ 5 (ตัวแทน)</Badge>;
      default:
        return <Badge variant="outline">ระดับ {level}</Badge>;
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-sky-500" /> ลูกค้าสมาชิกและ CRM (Customers & Membership)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการข้อมูลสมาชิก วงเงินเครดิต ระดับราคาขาย อัตราสะสมแต้ม และข้อมูลนิติบุคคลออกใบกำกับภาษี
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={reloadData}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-9 px-3 text-xs font-semibold shadow-2xs"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> รีเฟรช
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-9 px-3 text-xs font-semibold shadow-2xs"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
            ตั้งค่าสะสมแต้ม
          </Button>
          <Button
            size="sm"
            onClick={handleOpenAdd}
            className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-9 px-4 text-xs shadow-2xs rounded-lg"
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
          ⚙️ อัตราแต้มมาตรฐาน: ซื้อ {loyaltyConfig.defaultPointEarnRateBaht}฿ = {loyaltyConfig.defaultPointEarnUnits} แต้ม | แลก {loyaltyConfig.defaultPointRedeemRatePoints} แต้ม = {loyaltyConfig.defaultPointRedeemDiscountBaht}฿
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
                className="pl-10 bg-white border-slate-300 h-9 text-sm"
              />
            </div>

            <select
              value={priceLevelFilter}
              onChange={(e) => setPriceLevelFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-sky-500 shadow-2xs"
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
          <div className="flex gap-1.5 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
            {[
              { value: 'all', label: 'ทั้งหมด' },
              { value: 'INDIVIDUAL', label: '👤 บุคคลธรรมดา' },
              { value: 'COMPANY', label: '🏢 บริษัท/นิติบุคคล' },
              { value: 'credit', label: '💳 มีเครดิต' },
              { value: 'hasDebt', label: '⚠️ มียอดค้างชำระ' },
            ].map((st) => (
              <Button
                key={st.value}
                variant={typeFilter === st.value ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setTypeFilter(st.value as any)}
                className={`h-8 px-3 text-xs font-bold rounded-lg transition-all ${
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
          <Table className="w-full">
            <TableHeader className="bg-slate-50/90 border-b border-slate-200">
              <TableRow>
                <TableHead className="w-[28%] text-slate-600 font-bold text-xs uppercase">รหัส / ชื่อสมาชิก & บริษัท</TableHead>
                <TableHead className="w-[18%] text-slate-600 font-bold text-xs uppercase">ข้อมูลติดต่อ & เลขผู้เสียภาษี</TableHead>
                <TableHead className="w-[12%] text-center text-slate-600 font-bold text-xs uppercase">ระดับราคา (Price Tier)</TableHead>
                <TableHead className="w-[18%] text-right text-slate-600 font-bold text-xs uppercase">วงเงินเครดิต & ยอดหนี้คงค้าง</TableHead>
                <TableHead className="w-[14%] text-center text-slate-600 font-bold text-xs uppercase">คะแนนสะสม & อัตราแลก</TableHead>
                <TableHead className="w-[10%] text-center text-slate-600 font-bold text-xs uppercase">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-48 text-slate-400">
                    ไม่พบข้อมูลลูกค้าที่ตรงกับเงื่อนไขการค้นหา
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers.map((c) => {
                  const isCompany = c.type === 'COMPANY';
                  const hasCredit = (c.creditLimit || 0) > 0;
                  const hasDebt = (c.currentDebt || 0) > 0;

                  return (
                    <TableRow key={c.id} className="hover:bg-slate-50/80 border-slate-100 transition-colors">
                      {/* Name & Type */}
                      <TableCell className="py-3.5">
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                              isCompany
                                ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                                : 'bg-sky-50 text-sky-600 border-sky-200'
                            }`}
                          >
                            {isCompany ? <Building2 className="w-5 h-5" /> : <User className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 text-sm truncate hover:text-sky-600">
                                {c.name}
                              </span>
                              {isCompany ? (
                                <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] font-bold px-1.5 py-0">
                                  🏢 นิติบุคคล
                                </Badge>
                              ) : (
                                <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px] font-medium px-1.5 py-0">
                                  บุคคล
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-0.5">
                              <span>{c.code || '-'}</span>
                              {c.companyName && c.companyName !== c.name && (
                                <span className="truncate max-w-[200px] text-slate-500">· {c.companyName}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Contact & Tax Info */}
                      <TableCell className="py-3.5 text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-slate-800 font-mono font-semibold">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <span>{c.phone}</span>
                          </div>
                          {c.taxId && (
                            <div className="flex items-center gap-1 text-slate-500 font-mono text-[11px]">
                              <Receipt className="w-3 h-3 text-indigo-500" />
                              <span>Tax ID: <b>{c.taxId}</b></span>
                              <span className="text-[10px] text-slate-400">({c.branchType === 'HEAD_OFFICE' ? 'สนญ.' : `สาขา ${c.branchNumber}`})</span>
                            </div>
                          )}
                          {c.contactPerson && (
                            <div className="text-[11px] text-slate-400 truncate max-w-[220px]">
                              ผู้ติดต่อ: <span className="text-slate-600 font-medium">{c.contactPerson}</span>
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* Price Level */}
                      <TableCell className="py-3.5 text-center">
                        {getPriceLevelBadge(c.priceLevel || 1)}
                      </TableCell>

                      {/* Credit & Debt */}
                      <TableCell className="py-3.5 text-right text-xs">
                        {hasCredit ? (
                          <div className="space-y-0.5">
                            <div className="text-slate-700">
                              วงเงิน: <b className="font-bold text-slate-900">{formatCurrency(c.creditLimit)}</b> ({c.creditTerms || 30} วัน)
                            </div>
                            {hasDebt ? (
                              <Link
                                href={`/debts?customerId=${c.id}&customerName=${encodeURIComponent(c.name)}`}
                                className="font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-lg border border-rose-200 inline-flex items-center gap-1 shadow-2xs transition-all group"
                                title="คลิกเพื่อเปิดดูบิลค้างชำระและรับชำระเงิน"
                              >
                                <span>ค้างชำระ: {formatCurrency(c.currentDebt)}</span>
                                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform text-rose-500" />
                              </Link>
                            ) : (
                              <span className="text-emerald-600 font-medium">ไม่มียอดค้าง</span>
                            )}
                            {c.isCreditBlocked && (
                              <span className="block text-[10px] text-rose-600 font-bold">🚫 ระงับเครดิตชั่วคราว</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-medium">เงินสด (ไม่มีเครดิต)</span>
                        )}
                      </TableCell>

                      {/* Points & Loyalty */}
                      <TableCell className="py-3.5 text-center">
                        <div className="inline-flex flex-col items-center">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                            <Coins className="w-3.5 h-3.5 text-amber-600" />
                            <span>{(c.points || 0).toLocaleString()} แต้ม</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            สะสม {c.pointEarnRateBaht || 500}฿={c.pointEarnUnits || 10} | แลก {c.pointRedeemRatePoints || 100}={c.pointRedeemDiscountBaht || 1}฿
                          </div>
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenDetail(c)}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg"
                            title="ดูข้อมูลละเอียด & ใบกำกับภาษี"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenEdit(c)}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                            title="แก้ไขข้อมูลสมาชิก"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteCustomer(c)}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                            title="ลบสมาชิก"
                          >
                            <Trash2 className="w-4 h-4" />
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
                  onClick={() => setActiveFormTab(t.id as any)}
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
                    <div className="h-9 px-3 rounded-lg bg-slate-100 border border-slate-200 flex items-center font-mono font-bold text-slate-700 text-xs select-none">
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
                      className="h-9 font-bold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">เบอร์โทรศัพท์หลัก *</label>
                    <Input
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="เช่น 081-234-5678"
                      className="h-9 font-mono font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">อีเมล</label>
                    <Input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="เช่น contact@example.com"
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">ที่อยู่จัดส่ง / ติดต่อทั่วไป</label>
                  <Input
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="บ้านเลขที่, ถนน, ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์"
                    className="h-9"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">หมายเหตุเพิ่มเติม</label>
                  <Input
                    value={formData.note || ''}
                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                    placeholder="บันทึกข้อความเฉพาะลูกค้าท่านนี้..."
                    className="h-9"
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
                    className="h-9 font-semibold"
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
                      className="h-9 font-mono font-bold text-indigo-700"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">ประเภทสาขา</label>
                    <select
                      value={formData.branchType || 'HEAD_OFFICE'}
                      onChange={(e) => setFormData({ ...formData, branchType: e.target.value as any })}
                      className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2.5 font-bold text-slate-800 outline-none"
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
                      className="h-9 font-mono"
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
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-slate-700">เบอร์โทรผู้ประสานงาน</label>
                    <Input
                      value={formData.contactPhone || ''}
                      onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                      placeholder="เช่น 089-111-2233"
                      className="h-9 font-mono"
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
                        onClick={() => setFormData({ ...formData, priceLevel: lv.level as any })}
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
                    💡 เมื่อเลือกลูกค้ารายนี้ในหน้าขายหน้าร้าน (POS) ระบบจะดึงราคาขายตามระดับนี้ให้อัตโนมัติ
                  </p>
                </div>

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
                        value={formData.creditLimit ?? 0}
                        onChange={(e) => setFormData({ ...formData, creditLimit: Number(e.target.value) })}
                        placeholder="0 = ไม่ให้เชื่อ"
                        className="h-9 font-extrabold text-indigo-600"
                      />
                      <span className="text-[10px] text-slate-400">ใส่ 0 หากซื้อขายสดเท่านั้น</span>
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-slate-700">เครดิตเทอม (วัน)</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.creditTerms ?? 30}
                        onChange={(e) => setFormData({ ...formData, creditTerms: Number(e.target.value) })}
                        placeholder="เช่น 30 วัน"
                        className="h-9 font-bold"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-slate-700">ยอดหนี้ค้างชำระปัจจุบัน (บาท)</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.currentDebt ?? 0}
                        onChange={(e) => setFormData({ ...formData, currentDebt: Number(e.target.value) })}
                        className="h-9 font-extrabold text-amber-600"
                      />
                    </div>
                  </div>

                  <div className="pt-1">
                    <label className="flex items-center gap-2 p-2 rounded-lg border border-rose-200 bg-rose-50/50 hover:bg-rose-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(formData.isCreditBlocked)}
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
                  <Input
                    type="number"
                    value={formData.points ?? 0}
                    onChange={(e) => setFormData({ ...formData, points: Number(e.target.value) })}
                    className="h-9 font-extrabold text-base text-amber-700"
                  />
                </div>

                {/* 3. Earn Rate */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-emerald-600" />
                    3. การให้คะแนนสะสม (Earning Rate)
                  </div>
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-500 font-semibold">ยอดซื้อสินค้าครบทุกๆ (บาท):</label>
                      <Input
                        type="number"
                        min="1"
                        value={formData.pointEarnRateBaht ?? 500}
                        onChange={(e) => setFormData({ ...formData, pointEarnRateBaht: Number(e.target.value) })}
                        className="h-9 font-bold text-slate-900"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-500 font-semibold">จะได้รับคะแนนสะสม (แต้ม):</label>
                      <Input
                        type="number"
                        min="1"
                        value={formData.pointEarnUnits ?? 10}
                        onChange={(e) => setFormData({ ...formData, pointEarnUnits: Number(e.target.value) })}
                        className="h-9 font-extrabold text-emerald-600"
                      />
                    </div>
                  </div>
                  <div className="text-[11px] text-emerald-700 font-medium">
                    📌 สรุปกฎ: ซื้อของครบ <b>{formData.pointEarnRateBaht ?? 500} บาท</b> จะได้รับ <b>{formData.pointEarnUnits ?? 10} คะแนน</b>
                  </div>
                </div>

                {/* 4. Redeem Rate */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-indigo-600" />
                    4. การใช้คะแนนสะสมเป็นส่วนลด (Redemption Rate)
                  </div>
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-500 font-semibold">ใช้คะแนนสะสมทุกๆ (แต้ม):</label>
                      <Input
                        type="number"
                        min="1"
                        value={formData.pointRedeemRatePoints ?? 100}
                        onChange={(e) => setFormData({ ...formData, pointRedeemRatePoints: Number(e.target.value) })}
                        className="h-9 font-bold text-slate-900"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-500 font-semibold">เท่ากับส่วนลดเงินสด (บาท):</label>
                      <Input
                        type="number"
                        min="1"
                        value={formData.pointRedeemDiscountBaht ?? 1}
                        onChange={(e) => setFormData({ ...formData, pointRedeemDiscountBaht: Number(e.target.value) })}
                        className="h-9 font-extrabold text-indigo-600"
                      />
                    </div>
                  </div>
                  <div className="text-[11px] text-indigo-700 font-medium">
                    📌 สรุปกฎ: ใช้ <b>{formData.pointRedeemRatePoints ?? 100} คะแนน</b> จะได้ส่วนลดเงินสด <b>{formData.pointRedeemDiscountBaht ?? 1} บาท</b>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="m-0 border-t border-slate-200 px-7 py-4.5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
            <Button
              variant="ghost"
              onClick={() => setIsFormOpen(false)}
              className="text-slate-600 hover:bg-slate-200/60 font-semibold h-10 px-5"
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handleSaveCustomer}
              className="bg-sky-500 hover:bg-sky-600 text-white font-bold px-7 h-10 shadow-sm text-sm"
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
            <DialogTitle className="flex items-center justify-between text-xl font-extrabold text-slate-900">
              <div className="flex items-center gap-2.5">
                {selectedCustomer?.type === 'COMPANY' ? (
                  <Building2 className="w-6 h-6 text-indigo-600" />
                ) : (
                  <User className="w-6 h-6 text-sky-500" />
                )}
                <span>{selectedCustomer?.name}</span>
              </div>
              <Badge variant="outline" className="font-mono font-bold text-sm bg-slate-100 px-2.5 py-1">
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
                <b className="text-amber-900 text-lg font-black block mt-0.5">{(selectedCustomer?.points || 0).toLocaleString()} แต้ม</b>
              </div>
              <div className="bg-rose-50/80 p-3.5 rounded-xl border border-rose-200 text-center">
                <span className="text-rose-800 block text-xs font-bold">ยอดหนี้คงค้าง</span>
                <b className="text-rose-600 text-lg font-extrabold block mt-0.5">{formatCurrency(selectedCustomer?.currentDebt || 0)}</b>
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
                  <b className="text-indigo-700 font-mono font-bold text-sm sm:text-base">{selectedCustomer?.taxId || '-'}</b>
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
                  <b className="text-slate-900 font-extrabold text-sm sm:text-base">{formatCurrency(selectedCustomer?.creditLimit || 0)}</b>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs font-bold">ระยะเวลาเครดิตเทอม:</span>
                  <b className="text-slate-900 font-extrabold text-sm sm:text-base">{selectedCustomer?.creditTerms || 0} วัน</b>
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
                  <span className="text-emerald-700 font-bold text-sm">ซื้อครบ {selectedCustomer?.pointEarnRateBaht || 500}฿ ได้ {selectedCustomer?.pointEarnUnits || 10} แต้ม</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs font-bold">อัตราแลกส่วนลด:</span>
                  <span className="text-indigo-700 font-bold text-sm">ใช้ {selectedCustomer?.pointRedeemRatePoints || 100} แต้ม = ส่วนลด {selectedCustomer?.pointRedeemDiscountBaht || 1}฿</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="m-0 border-t border-slate-200 px-7 py-4.5 bg-slate-50 shrink-0 flex justify-end">
            <Button onClick={() => setIsDetailOpen(false)} className="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 h-10 text-sm">
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
              ค่าเหล่านี้จะถูกใช้เป็นค่าเริ่มต้นสำหรับสมาชิกทุกคนที่สมัครใหม่
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
                    className="h-9 font-bold"
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
                    className="h-9 font-bold text-emerald-600"
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
                    className="h-9 font-bold"
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
                    className="h-9 font-bold text-indigo-600"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="m-0 border-t border-slate-200 px-6 py-4.5 bg-slate-50 flex justify-between">
            <Button variant="ghost" onClick={() => setIsSettingsOpen(false)} className="text-slate-600 h-10 px-4">
              ยกเลิก
            </Button>
            <Button onClick={handleSaveLoyaltySettings} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm h-10 px-5">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> บันทึกการตั้งค่า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
