'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  loadAllClaimRecords, 
  getClaimStockSummary 
} from '@/lib/claim-service';
import { ClaimRecord, ClaimResolutionType } from '@/lib/types';
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
  ShieldAlert,
  Search,
  RefreshCw,
  Printer,
  RotateCcw,
  Banknote,
  Percent,
  Truck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User,
  Plus,
  ArrowLeftRight,
  Building2,
  Calendar
} from 'lucide-react';
import { ProductClaimModal } from '@/components/pos/ProductClaimModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';
import { toast } from 'sonner';

export default function ClaimsPage() {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resolutionFilter, setResolutionFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Modals
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [selectedClaimForPdf, setSelectedClaimForPdf] = useState<ClaimRecord | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

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
    fetchClaims();
  }, []);

  // Summary statistics
  const summary = useMemo(() => {
    return getClaimStockSummary(claims);
  }, [claims]);

  // Filtered claims
  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      // Resolution Filter
      if (resolutionFilter !== 'ALL' && claim.resolutionType !== resolutionFilter) {
        return false;
      }

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
        const orderMatch = (claim.orderNumber || '').toLowerCase().includes(q);
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
  }, [claims, resolutionFilter, startDate, endDate, search]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredClaims.length / pageSize));
  const paginatedClaims = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredClaims.slice(start, start + pageSize);
  }, [filteredClaims, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, resolutionFilter, pageSize]);

  // Resolution Badge Helper
  const getResolutionBadge = (res: ClaimResolutionType) => {
    switch (res) {
      case 'REPLACE_ITEM':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
            <RotateCcw className="w-3.5 h-3.5" /> เปลี่ยนชิ้นใหม่
          </span>
        );
      case 'REFUND_CASH':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
            <Banknote className="w-3.5 h-3.5" /> คืนเงินสด
          </span>
        );
      case 'REFUND_TRANSFER':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200">
            <Banknote className="w-3.5 h-3.5" /> คืนเงินโอน
          </span>
        );
      case 'STORE_DISCOUNT':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
            <Percent className="w-3.5 h-3.5" /> ส่วนลดบิล
          </span>
        );
      case 'SUPPLIER_RMA':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
            <Truck className="w-3.5 h-3.5" /> ส่งเคลมประกัน
          </span>
        );
      default:
        return <span className="text-xs font-bold">{res}</span>;
    }
  };

  // Open Print PDF Modal
  const handlePrintPdf = (claim: ClaimRecord, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedClaimForPdf(claim);
    setIsPdfModalOpen(true);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7 font-sans">
      {/* ─── PAGE HEADER ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-indigo-600 shrink-0" />
            <span>ประวัติการเคลมสินค้า (ลูกค้า)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            บันทึกการรับเคลมสินค้าจากลูกค้าหน้าร้าน (เปลี่ยนชิ้นใหม่, คืนเงินสด, หรือรับเคลมประกัน)
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Link href="/supplier-returns">
            <Button
              variant="outline"
              size="sm"
              className="border-indigo-200 text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 h-10 px-4 text-xs font-bold shadow-2xs gap-1.5 rounded-2xl"
              title="ไปยังหน้าระบบส่งเคลมและคืนสินค้าบริษัทผู้จำหน่าย"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>ส่งเคลม / คืนสินค้าบริษัท</span>
            </Button>
          </Link>

          <Button
            size="sm"
            onClick={() => setIsClaimModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-4 rounded-2xl shadow-xs gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>รับเคลมสินค้าใหม่</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchClaims}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 h-10 px-3.5 text-xs font-semibold shadow-2xs rounded-2xl"
            title="รีเฟรชข้อมูลรายการเคลม"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ─── TOP KPI STATS CARDS ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/* 1. Total Claims */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-indigo-950">รายการเคลมทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-indigo-700 tracking-tight">
              {claims.length}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">รายการ</span>
          </div>
        </div>

        {/* 2. Total Claim Value */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
              <Banknote className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-rose-950">มูลค่าเคลมรวม:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-rose-600 tracking-tight">
              {formatCurrency(summary.totalClaimValue)}
            </span>
          </div>
        </div>

        {/* 3. Replacement Count */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
              <RotateCcw className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-indigo-950">เปลี่ยนชิ้นใหม่:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-indigo-600 tracking-tight">
              {summary.replacedItemCount}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">รายการ</span>
          </div>
        </div>

        {/* 4. Cash / Transfer Refunds */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
              <Banknote className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-emerald-950">คืนเงินสด/โอน:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-emerald-700 tracking-tight">
              {summary.refundedCount}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">รายการ</span>
          </div>
        </div>
      </div>

      {/* ─── SEARCH & FILTER BAR ─── */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="ค้นหาเลขที่ใบเคลม, บิลขาย, ชื่อลูกค้า, หรือชื่อสินค้า/SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 text-xs bg-slate-50 border-slate-200 rounded-2xl"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <select
              value={resolutionFilter}
              onChange={(e) => setResolutionFilter(e.target.value)}
              className="h-10 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 w-full md:w-48"
            >
              <option value="ALL">🔍 ทุกประเภทการรับเคลม</option>
              <option value="REPLACE_ITEM">🔄 เปลี่ยนชิ้นใหม่</option>
              <option value="REFUND_CASH">💵 คืนเงินสด</option>
              <option value="REFUND_TRANSFER">📱 คืนเงินโอน</option>
              <option value="STORE_DISCOUNT">🏷️ ส่วนลดบิล</option>
              <option value="SUPPLIER_RMA">🚚 ส่งเคลมประกัน</option>
            </select>

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-2xl px-2.5 h-10 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-xs text-slate-700 outline-none"
              />
              <span className="text-slate-400">-</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-xs text-slate-700 outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── MAIN CLAIMS TABLE ─── */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-b border-slate-200 text-slate-700 font-bold text-sm">
                <TableHead className="pl-4 text-center w-16 font-bold text-sm">ลำดับ</TableHead>
                <TableHead className="text-left w-36 font-bold text-sm">เลขที่เคลม</TableHead>
                <TableHead className="text-center w-40 font-bold text-sm">วันที่ทำรายการ</TableHead>
                <TableHead className="text-center font-bold text-sm">ลูกค้า</TableHead>
                <TableHead className="text-center w-36 font-bold text-sm">จำนวนที่เคลม</TableHead>
                <TableHead className="text-right w-36 font-bold text-sm">มูลค่าเคลม (฿)</TableHead>
                <TableHead className="text-center w-36 font-bold text-sm">วิธีดำเนินการ</TableHead>
                <TableHead className="text-center w-32 pr-4 font-bold text-sm whitespace-nowrap">การจัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    กำลังโหลดข้อมูลรายการเคลม...
                  </TableCell>
                </TableRow>
              ) : paginatedClaims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-14 text-slate-400 text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <ShieldAlert className="w-8 h-8 text-slate-300" />
                      <span className="font-bold text-slate-600 text-base">ไม่พบประวัติการรับเคลมสินค้า</span>
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
                paginatedClaims.map((claim, idx) => (
                  <TableRow
                    key={claim.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    {/* 1. Index (ลำดับ) */}
                    <TableCell className="py-3.5 pl-4 text-center font-mono font-bold text-slate-500 text-sm">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </TableCell>

                    {/* 2. Claim ID */}
                    <TableCell className="py-3.5 font-mono">
                      <div className="font-bold text-indigo-600 text-[15px]">{claim.id}</div>
                      {claim.returnDocId && (
                        <div className="mt-1">
                          <Link
                            href="/supplier-returns"
                            className="text-xs font-bold bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-md hover:bg-indigo-100 transition-colors inline-flex items-center gap-1"
                            title="ไปที่เอกสารส่งคืนบริษัท"
                          >
                            <Building2 className="w-3 h-3 text-indigo-600" />
                            <span>ส่งคืน: {claim.returnDocId}</span>
                          </Link>
                        </div>
                      )}
                    </TableCell>

                    {/* 3. Date (แยก col. วันที่) */}
                    <TableCell className="py-3.5 text-center font-mono text-xs text-slate-600">
                      {new Date(claim.claimDate).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </TableCell>

                    {/* 4. Customer Column (Center Align) */}
                    <TableCell className="py-3.5 text-center">
                      <div className="font-bold text-slate-900 text-[15px] flex items-center justify-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{claim.customerName || 'ลูกค้าทั่วไป'}</span>
                      </div>
                      {claim.customerPhone && (
                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                          {claim.customerPhone}
                        </div>
                      )}
                    </TableCell>

                    {/* 5. Total Claim Quantity */}
                    <TableCell className="py-3.5 text-center font-mono">
                      <div className="font-bold text-[15px] text-slate-900">
                        {claim.baseQuantity !== undefined ? claim.baseQuantity : (claim.quantity * (claim.conversionFactor || 1))} {claim.conversionFactor && claim.conversionFactor > 1 ? (claim.replacementUnitName || 'ชิ้น') : (claim.unitName || 'ชิ้น')}
                      </div>
                      {claim.conversionFactor && claim.conversionFactor > 1 && (
                        <div className="text-xs text-slate-400 font-normal mt-0.5">
                          ({claim.quantity} {claim.unitName})
                        </div>
                      )}
                    </TableCell>

                    {/* 6. Total Claim Value */}
                    <TableCell className="py-3.5 text-right font-mono">
                      <span className="font-black text-[15px] sm:text-base text-slate-900 block">
                        {formatCurrency(claim.totalClaimValue)}
                      </span>
                    </TableCell>

                    {/* 7. Resolution */}
                    <TableCell className="py-3.5 text-center">
                      {getResolutionBadge(claim.resolutionType)}
                    </TableCell>

                    {/* 8. Action: Print */}
                    <TableCell className="py-3.5 pr-4 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => handlePrintPdf(claim, e)}
                        className="h-8 px-3 text-xs text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 rounded-xl font-bold gap-1.5 whitespace-nowrap"
                        title="พิมพ์ใบรับเคลม / ดูรายละเอียด"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>พิมพ์เอกสาร</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Footer */}
        {filteredClaims.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-slate-100 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span>แสดง</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-8 px-2 border border-slate-200 rounded-lg bg-slate-50 font-bold"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
              <span>รายการ จากทั้งหมด {filteredClaims.length} รายการ</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage <= 1}
                className="h-8 w-8 p-0 rounded-lg"
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="h-8 w-8 p-0 rounded-lg"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <span className="px-3 font-bold text-slate-700">
                หน้า {currentPage} จาก {totalPages}
              </span>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="h-8 w-8 p-0 rounded-lg"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage >= totalPages}
                className="h-8 w-8 p-0 rounded-lg"
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODALS ─── */}
      {/* 1. Receive New Customer Claim Modal */}
      <ProductClaimModal
        open={isClaimModalOpen}
        onOpenChange={setIsClaimModalOpen}
        onClaimCompleted={(claim: ClaimRecord) => {
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
    </div>
  );
}
