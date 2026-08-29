'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  loadAllClaimRecords, 
  updateClaimStatus, 
  getClaimStockSummary 
} from '@/lib/claim-service';
import { ClaimRecord, ClaimStatus, ClaimResolutionType } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ShieldAlert,
  Search,
  RefreshCw,
  Printer,
  FileText,
  RotateCcw,
  Banknote,
  Percent,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Package,
  Layers,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User,
  Phone,
  Clock,
  Ban,
  Plus,
  Building2
} from 'lucide-react';
import { ProductClaimModal } from '@/components/pos/ProductClaimModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';
import { CreateSupplierReturnModal } from '@/components/claims/CreateSupplierReturnModal';
import { SupplierReturnPdfModal } from '@/components/claims/SupplierReturnPdfModal';
import { SupplierReturnNotesListModal } from '@/components/claims/SupplierReturnNotesListModal';
import { 
  getPendingReturnsGroupedBySupplier, 
  loadSupplierReturnNotes,
  PendingSupplierGroup 
} from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';
import { toast } from 'sonner';

export default function ClaimsPage() {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<'all' | 'pending' | 'sent' | 'completed' | 'scrapped'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Modals
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [selectedClaimForPdf, setSelectedClaimForPdf] = useState<ClaimRecord | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

  // Supplier Return & Debit Note Modals
  const [isSupplierReturnModalOpen, setIsSupplierReturnModalOpen] = useState(false);
  const [isReturnNotesListOpen, setIsReturnNotesListOpen] = useState(false);
  const [selectedReturnNoteForPdf, setSelectedReturnNoteForPdf] = useState<SupplierReturnNote | null>(null);
  const [isReturnPdfModalOpen, setIsReturnPdfModalOpen] = useState(false);

  // Update Status Modal
  const [targetClaimForStatus, setTargetClaimForStatus] = useState<ClaimRecord | null>(null);
  const [newStatus, setNewStatus] = useState<ClaimStatus>('SENT_TO_SUPPLIER');
  const [supplierName, setSupplierName] = useState('');
  const [supplierTrackingNo, setSupplierTrackingNo] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);

  const fetchClaims = () => {
    setLoading(true);
    try {
      const records = loadAllClaimRecords();
      setClaims(records);
    } catch (err) {
      toast.error('ไม่สามารถโหลดข้อมูลรายการเคลมได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setIsMounted(true);
    fetchClaims();
  }, []);

  // Summary statistics - computed directly from claims state to prevent SSR hydration mismatch
  const summary = useMemo(() => {
    return getClaimStockSummary(claims);
  }, [claims]);

  // Filtered claims
  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      // Status Tab filter
      if (statusTab === 'pending' && claim.status !== 'PENDING_SUPPLIER') return false;
      if (statusTab === 'sent' && claim.status !== 'SENT_TO_SUPPLIER') return false;
      if (statusTab === 'completed' && claim.status !== 'COMPLETED' && claim.status !== 'SUPPLIER_REPLACED') return false;
      if (statusTab === 'scrapped' && claim.status !== 'SCRAPPED') return false;

      // Date range filter
      if (startDate) {
        const dStart = new Date(startDate).getTime();
        const cTime = new Date(claim.claimDate).getTime();
        if (cTime < dStart) return false;
      }
      if (endDate) {
        const dEnd = new Date(endDate).getTime() + 24 * 60 * 60 * 1000;
        const cTime = new Date(claim.claimDate).getTime();
        if (cTime > dEnd) return false;
      }

      // Keyword search
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const idMatch = claim.id.toLowerCase().includes(q);
        const orderMatch = claim.orderNumber.toLowerCase().includes(q);
        const custMatch = (claim.customerName || '').toLowerCase().includes(q);
        const prodMatch = (claim.productName || '').toLowerCase().includes(q);
        const skuMatch = (claim.sku || '').toLowerCase().includes(q);
        const reasonMatch = (claim.defectReason || '').toLowerCase().includes(q);

        if (!idMatch && !orderMatch && !custMatch && !prodMatch && !skuMatch && !reasonMatch) {
          return false;
        }
      }

      return true;
    });
  }, [claims, statusTab, startDate, endDate, search]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredClaims.length / pageSize));
  const paginatedClaims = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredClaims.slice(start, start + pageSize);
  }, [filteredClaims, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusTab, pageSize]);

  // Status Badge Helper
  const getStatusBadge = (status: ClaimStatus) => {
    switch (status) {
      case 'PENDING_CHECKOUT':
        return <Badge className="bg-purple-100 text-purple-900 border-purple-300 font-bold text-[10.5px]">⏳ รอชำระเงินบิลหน้าร้าน</Badge>;
      case 'PENDING_SUPPLIER':
        return <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-[10.5px]">🟡 รอส่งซัพพลายเออร์</Badge>;
      case 'SENT_TO_SUPPLIER':
        return <Badge className="bg-sky-100 text-sky-800 border-sky-300 font-bold text-[10.5px]">🚚 ส่งซัพพลายเออร์แล้ว</Badge>;
      case 'SUPPLIER_REPLACED':
        return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-300 font-bold text-[10.5px]">✨ ซัพพลายเออร์เปลี่ยนของแล้ว</Badge>;
      case 'COMPLETED':
        return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10.5px]">✅ เคลมสำเร็จ</Badge>;
      case 'SCRAPPED':
        return <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-bold text-[10.5px]">🗑️ ตัดจำหน่าย (ทิ้ง)</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Resolution Badge Helper
  const getResolutionBadge = (res: ClaimResolutionType) => {
    switch (res) {
      case 'REPLACE_ITEM':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200"><RotateCcw className="w-3 h-3" /> เปลี่ยนตัวใหม่</span>;
      case 'REFUND_CASH':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200"><Banknote className="w-3 h-3" /> คืนเงินสด</span>;
      case 'REFUND_TRANSFER':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200"><Banknote className="w-3 h-3" /> คืนเงินโอน</span>;
      case 'STORE_DISCOUNT':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"><Percent className="w-3 h-3" /> ส่วนลดบิลซื้อ</span>;
      case 'SUPPLIER_RMA':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200"><Truck className="w-3 h-3" /> ส่งซัพพลายเออร์</span>;
      default:
        return <span>{res}</span>;
    }
  };

  // Open Update Status Dialog
  const handleOpenUpdateStatus = (claim: ClaimRecord, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTargetClaimForStatus(claim);
    setNewStatus(claim.status === 'PENDING_SUPPLIER' ? 'SENT_TO_SUPPLIER' : claim.status);
    setSupplierName(claim.supplierName || '');
    setSupplierTrackingNo(claim.supplierTrackingNo || '');
    setStatusNote('');
    setIsStatusModalOpen(true);
  };

  const handleConfirmUpdateStatus = () => {
    if (!targetClaimForStatus) return;

    updateClaimStatus(targetClaimForStatus.id, newStatus, {
      supplierName: supplierName.trim(),
      supplierTrackingNo: supplierTrackingNo.trim(),
      note: statusNote.trim(),
    });

    toast.success(`✅ อัปเดตสถานะใบเคลม #${targetClaimForStatus.id} เรียบร้อยแล้ว`);
    setIsStatusModalOpen(false);
    fetchClaims();
  };

  // Open Print PDF Modal
  const handlePrintPdf = (claim: ClaimRecord, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedClaimForPdf(claim);
    setIsPdfModalOpen(true);
  };

  // Pending Returns to Suppliers
  const pendingSupplierGroups = useMemo(() => {
    if (!isMounted) return [];
    return getPendingReturnsGroupedBySupplier();
  }, [claims, isMounted]);

  const totalPendingReturnQty = pendingSupplierGroups.reduce((s, g) => s + g.totalItemsQuantity, 0);
  const totalPendingReturnCost = pendingSupplierGroups.reduce((s, g) => s + g.totalCostValue, 0);

  const handleOpenReturnPdf = (note: SupplierReturnNote) => {
    setSelectedReturnNoteForPdf(note);
    setIsReturnPdfModalOpen(true);
  };

  const handleFindAndOpenReturnPdfByDocId = (docId: string) => {
    const notes = loadSupplierReturnNotes();
    const target = notes.find((n) => n.id === docId);
    if (target) {
      handleOpenReturnPdf(target);
    } else {
      toast.error(`ไม่พบเอกสาร ${docId}`);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7 font-sans">
      {/* ─── PAGE HEADER ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-indigo-600 shrink-0" />
            <span>ระบบเคลมสินค้า & สต็อกของเคลม (Product Claims & RMA)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ตรวจสอบประวัติการซื้อ ป้องกันการเคลมซ้ำ จัดการของเสีย ส่งคืนซัพพลายเออร์ และออกใบลดหนี้หักยอดบิล
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            size="sm"
            onClick={() => setIsSupplierReturnModalOpen(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-xs gap-1.5"
            title="รวบรวมของเสียเพื่อออกใบส่งคืนและใบลดหนี้ให้บริษัทคู่ค้า"
          >
            <Building2 className="w-4 h-4" />
            <span>ออกใบส่งคืนบริษัท & ใบลดหนี้</span>
            {totalPendingReturnQty > 0 && (
              <span className="bg-white text-rose-700 text-[10px] font-black px-1.5 py-0.2 rounded-full ml-0.5 shadow-2xs">
                {totalPendingReturnQty}
              </span>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsReturnNotesListOpen(true)}
            className="border-rose-200 text-rose-700 bg-rose-50/80 hover:bg-rose-100 h-9 px-3 text-xs font-bold shadow-2xs gap-1.5"
            title="ดูประวัติใบส่งคืนสินค้าเคลมและใบลดหนี้ทั้งหมด"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>ประวัติใบส่งคืน (RTN)</span>
          </Button>

          <Button
            size="sm"
            onClick={() => setIsClaimModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-xs gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>รับเคลมสินค้าใหม่</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchClaims}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-9 px-3 text-xs font-semibold shadow-2xs"
            title="รีเฟรชข้อมูลรายการเคลม"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
        </div>
      </div>

      {/* ─── SUPPLIER RETURN ACTION BANNER (When items waiting to be returned) ─── */}
      {totalPendingReturnQty > 0 && (
        <div className="bg-gradient-to-r from-rose-50 to-amber-50 border border-rose-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-rose-950 text-sm flex items-center gap-2">
                <span>มีสินค้าเคลมรอรวบรวมส่งคืนบริษัท {pendingSupplierGroups.length} บริษัท</span>
                <span className="bg-rose-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                  รวม {totalPendingReturnQty} ชิ้น
                </span>
              </h3>
              <p className="text-xs text-rose-800/80 font-medium mt-0.5">
                คิดเป็นมูลค่าตามราคาทุนรวม <b className="text-rose-900 font-mono font-black">{formatCurrency(totalPendingReturnCost)}</b> สามารถออกเอกสาร RTN เพื่อนำยอดไปหักลดหนี้กับบิลเรียกเก็บเงินของบริษัทคู่ค้าได้ทันที
              </p>
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => setIsSupplierReturnModalOpen(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-xs shrink-0 gap-1.5"
          >
            <Building2 className="w-4 h-4" />
            <span>ออกเอกสารส่งคืน & หักหนี้</span>
          </Button>
        </div>
      )}

      {/* ─── TOP KPI STATS CARDS ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Total Claims */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">รายการเคลมทั้งหมด</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900 font-mono">
              {summary.totalClaims} <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              เปลี่ยนของ: <b>{summary.replacedItemCount}</b> | คืนเงิน/ลด: <b>{summary.refundedCount + summary.discountedCount}</b>
            </div>
          </CardContent>
        </Card>

        {/* 2. Total Claim Value */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">มูลค่าของเคลมรวม</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center">
              <Banknote className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-rose-600 font-mono">
              {formatCurrency(summary.totalClaimValue)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              มูลค่าต้นทุนสินค้าที่รับเคลมสะสม
            </div>
          </CardContent>
        </Card>

        {/* 3. Pending Supplier RMA */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">รอส่งเคลมซัพพลายเออร์</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-amber-600 font-mono">
              {summary.pendingSupplierCount} <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              สินค้าชำรุดรอส่งโรงงาน / รอเปลี่ยน
            </div>
          </CardContent>
        </Card>

        {/* 4. Completed Claims */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">เคลมสำเร็จ / ดำเนินการแล้ว</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-emerald-700 font-mono">
              {summary.completedCount} <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              ตัดจำหน่ายทิ้ง: <b>{summary.scrappedCount} รายการ</b>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── SEARCH & FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
            {[
              { id: 'all', label: `ทั้งหมด (${claims.length})` },
              { id: 'pending', label: `รอส่งซัพพลายเออร์ (${summary.pendingSupplierCount})` },
              { id: 'completed', label: `เคลมสำเร็จ (${summary.completedCount})` },
              { id: 'scrapped', label: `ตัดจำหน่าย (${summary.scrappedCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusTab(tab.id as any)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  statusTab === tab.id
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">ช่วงวันที่เคลม:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none shadow-2xs"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none shadow-2xs"
            />
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาตามเลขใบเคลม, เลขออเดอร์, ชื่อลูกค้า, ชื่อสินค้า, SKU, หรืออาการเสีย..."
            className="pl-9 h-10 bg-slate-50 border-slate-300 rounded-xl focus:bg-white text-xs sm:text-sm font-medium shadow-inner"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              ล้าง
            </button>
          )}
        </div>
      </div>

      {/* ─── CLAIMS DATA TABLE ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/90 border-b border-slate-200">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 pl-4 w-[160px]">เลขที่เคลม / วันที่</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5">อ้างอิงบิล / ลูกค้า</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5">สินค้าที่เคลม</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-center w-[90px]">จำนวน</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-right w-[110px]">มูลค่าเคลม</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-center w-[140px]">รูปแบบการเคลม</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-center w-[150px]">สถานะ</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-center w-[150px] pr-4">จัดการ</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-xs">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    กำลังโหลดข้อมูลรายการเคลม...
                  </TableCell>
                </TableRow>
              ) : paginatedClaims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-14 text-slate-400 text-xs">
                    <div className="flex flex-col items-center gap-2">
                      <ShieldAlert className="w-8 h-8 text-slate-300" />
                      <span className="font-bold text-slate-600 text-sm">ไม่พบประวัติการรับเคลมสินค้า</span>
                      <Button
                        size="sm"
                        onClick={() => setIsClaimModalOpen(true)}
                        className="bg-indigo-600 text-white font-bold text-xs h-8 px-3 rounded-xl mt-1"
                      >
                        + รับเคลมสินค้าใหม่
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedClaims.map((claim) => (
                  <TableRow
                    key={claim.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    {/* 1. Claim ID & Date */}
                    <TableCell className="py-3 pl-4 font-mono">
                      <div className="font-bold text-indigo-600 text-xs">{claim.id}</div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        {new Date(claim.claimDate).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </TableCell>

                    {/* 2. Order Number & Customer */}
                    <TableCell className="py-3">
                      <div className="font-mono font-bold text-slate-800 text-xs">
                        #{claim.orderNumber}
                      </div>
                      <div className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{claim.customerName || 'ลูกค้าทั่วไป'}</span>
                      </div>
                    </TableCell>

                    {/* 3. Product Details & Defect Reason */}
                    <TableCell className="py-3">
                      <div className="font-bold text-slate-900 text-xs">{claim.productName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{claim.sku}</div>
                      <div className="text-[10.5px] text-rose-600 font-medium mt-0.5 line-clamp-1">
                        * อาการ: {claim.defectReason}
                      </div>
                      {/* Supplier & Return / Debit Note Badges */}
                      {claim.returnDocId ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleFindAndOpenReturnPdfByDocId(claim.returnDocId!)}
                            className="text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200 px-1.5 py-0.2 rounded hover:bg-rose-100 transition-colors flex items-center gap-1 cursor-pointer"
                            title="คลิกเพื่อดูใบส่งคืนสินค้าและใบลดหนี้ A4"
                          >
                            <Building2 className="w-3 h-3 text-rose-600" />
                            <span>{claim.returnDocId}</span>
                          </button>
                          {claim.settledInBillNumber && (
                            <span className="text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 rounded">
                              ✓ หักบิล {claim.settledInBillNumber}
                            </span>
                          )}
                        </div>
                      ) : claim.supplierName ? (
                        <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          <span>บริษัท: <b className="text-slate-700">{claim.supplierName}</b></span>
                          {claim.costPrice ? <span className="text-slate-400 font-mono">(ทุน {formatCurrency(claim.costPrice)})</span> : null}
                        </div>
                      ) : null}
                    </TableCell>

                    {/* 4. Quantity */}
                    <TableCell className="py-3 text-center font-bold text-xs text-slate-900 font-mono">
                      {claim.quantity} {claim.unitName}
                    </TableCell>

                    {/* 5. Claim Value */}
                    <TableCell className="py-3 text-right font-black text-xs text-slate-900 font-mono">
                      {formatCurrency(claim.totalClaimValue)}
                    </TableCell>

                    {/* 6. Resolution */}
                    <TableCell className="py-3 text-center">
                      {getResolutionBadge(claim.resolutionType)}
                    </TableCell>

                    {/* 7. Status Badge */}
                    <TableCell className="py-3 text-center">
                      {getStatusBadge(claim.status)}
                    </TableCell>

                    {/* 8. Actions */}
                    <TableCell className="py-3 pr-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Print Button */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => handlePrintPdf(claim, e)}
                          className="h-8 px-2.5 text-xs text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 rounded-xl font-bold gap-1"
                          title="พิมพ์ใบรับเคลม / ใบเปลี่ยนสินค้า"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>พิมพ์</span>
                        </Button>

                        {/* More Action Dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 text-slate-600 border-slate-300 rounded-xl hover:bg-slate-100"
                                title="เมนูจัดการใบเคลม"
                                aria-label="เมนูจัดการใบเคลม"
                              />
                            }
                          >
                            <MoreVertical className="w-4 h-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52 p-1.5 rounded-2xl bg-white shadow-xl border border-slate-200 text-xs">
                            <DropdownMenuItem
                              onClick={(e) => handlePrintPdf(claim, e as any)}
                              className="font-bold text-indigo-700 py-2 rounded-xl cursor-pointer"
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              พิมพ์เอกสารใบรับเคลม
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="my-1" />

                            <DropdownMenuItem
                              onClick={(e) => handleOpenUpdateStatus(claim, e as any)}
                              className="font-bold text-slate-800 py-2 rounded-xl cursor-pointer"
                            >
                              <Truck className="w-4 h-4 mr-2 text-amber-600" />
                              อัปเดตสถานะส่งเคลม / RMA
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* ─── PAGINATION ─── */}
        <div className="p-3.5 sm:px-6 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-slate-500 font-medium">
            แสดงรายการที่{' '}
            <span className="font-bold text-slate-800">
              {filteredClaims.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
            </span>{' '}
            -{' '}
            <span className="font-bold text-slate-800">
              {Math.min(currentPage * pageSize, filteredClaims.length)}
            </span>{' '}
            จากทั้งหมด <span className="font-bold text-slate-800">{filteredClaims.length.toLocaleString()}</span> รายการ
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
              className="h-8 w-8 p-0 text-slate-600"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8 p-0 text-slate-600"
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
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 w-8 p-0 text-slate-600"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="h-8 w-8 p-0 text-slate-600"
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* ─── MODALS ─── */}

      {/* 1. In-Store Product Claim Creation Modal */}
      <ProductClaimModal
        open={isClaimModalOpen}
        onOpenChange={setIsClaimModalOpen}
        isBackoffice={true}
        onClaimCompleted={(claim) => {
          fetchClaims();
          setSelectedClaimForPdf(claim);
          setIsPdfModalOpen(true);
        }}
      />

      {/* 2. Print Claim Receipt Modal */}
      <ClaimReceiptPdfModal
        open={isPdfModalOpen}
        onOpenChange={setIsPdfModalOpen}
        claim={selectedClaimForPdf}
      />

      {/* 3. Update Claim / RMA Status Modal */}
      <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <Truck className="w-5 h-5 text-indigo-600" />
              <span>อัปเดตสถานะของเคลม / RMA</span>
            </DialogTitle>
          </DialogHeader>

          {targetClaimForStatus && (
            <div className="space-y-3.5 py-2 text-xs">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-1">
                <div className="flex justify-between font-mono">
                  <span className="text-slate-500">เลขที่ใบเคลม:</span>
                  <span className="font-bold text-slate-900">{targetClaimForStatus.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">สินค้า:</span>
                  <span className="font-bold text-slate-900">{targetClaimForStatus.productName} ({targetClaimForStatus.quantity} {targetClaimForStatus.unitName})</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">เลือกสถานะใหม่:</label>
                <div className="space-y-1.5">
                  {[
                    { id: 'PENDING_SUPPLIER', label: '🟡 รอส่งซัพพลายเออร์' },
                    { id: 'SENT_TO_SUPPLIER', label: '🚚 ส่งเคลมซัพพลายเออร์แล้ว' },
                    { id: 'SUPPLIER_REPLACED', label: '✨ ได้รับของเปลี่ยนจากซัพพลายเออร์แล้ว' },
                    { id: 'COMPLETED', label: '✅ เคลมสำเร็จสมบูรณ์' },
                    { id: 'SCRAPPED', label: '🗑️ ตัดจำหน่าย / ทิ้ง (Scrapped)' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setNewStatus(st.id as ClaimStatus)}
                      className={`w-full p-2.5 rounded-xl border text-xs font-bold text-left transition-all flex items-center justify-between ${
                        newStatus === st.id
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-950 shadow-2xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span>{st.label}</span>
                      {newStatus === st.id && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                    </button>
                  ))}
                </div>
              </div>

              {(newStatus === 'SENT_TO_SUPPLIER' || newStatus === 'SUPPLIER_REPLACED') && (
                <div className="space-y-2 pt-1">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">ชื่อซัพพลายเออร์ / โรงงาน:</label>
                    <Input
                      type="text"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="เช่น บริษัท อุปกรณ์ไอที จำกัด"
                      className="h-9 bg-white border-slate-300 rounded-xl text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">เลขพัสดุ / เลข RMA ซัพพลายเออร์:</label>
                    <Input
                      type="text"
                      value={supplierTrackingNo}
                      onChange={(e) => setSupplierTrackingNo(e.target.value)}
                      placeholder="เช่น RMA-987654321 หรือ TH0123456"
                      className="h-9 bg-white border-slate-300 rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="font-bold text-slate-700 block mb-1">บันทึกเพิ่มเติม:</label>
                <Input
                  type="text"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder="เช่น ซัพพลายเออร์ส่งของเปลี่ยนกลับมาแล้ว..."
                  className="h-9 bg-white border-slate-300 rounded-xl text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsStatusModalOpen(false)} className="text-slate-600 text-xs">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmUpdateStatus} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 rounded-xl shadow-xs text-xs">
              บันทึกสถานะ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── CREATE SUPPLIER RETURN MODAL (RTN) ─── */}
      <CreateSupplierReturnModal
        open={isSupplierReturnModalOpen}
        onOpenChange={setIsSupplierReturnModalOpen}
        onSuccess={(newReturnNote) => {
          fetchClaims();
          setSelectedReturnNoteForPdf(newReturnNote);
          setIsReturnPdfModalOpen(true);
        }}
      />

      {/* ─── SUPPLIER RETURN A4 PDF PREVIEW / PRINT MODAL ─── */}
      <SupplierReturnPdfModal
        open={isReturnPdfModalOpen}
        onOpenChange={setIsReturnPdfModalOpen}
        returnNote={selectedReturnNoteForPdf}
      />

      {/* ─── SUPPLIER RETURN NOTES LIST MODAL ─── */}
      <SupplierReturnNotesListModal
        open={isReturnNotesListOpen}
        onOpenChange={setIsReturnNotesListOpen}
        onViewPdf={(note) => {
          setSelectedReturnNoteForPdf(note);
          setIsReturnPdfModalOpen(true);
        }}
      />
    </div>
  );
}
