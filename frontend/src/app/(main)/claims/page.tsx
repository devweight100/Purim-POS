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
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-200">
            <RotateCcw className="w-3 h-3" /> เปลี่ยนชิ้นใหม่
          </span>
        );
      case 'REFUND_CASH':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200">
            <Banknote className="w-3 h-3" /> คืนเงินสด
          </span>
        );
      case 'REFUND_TRANSFER':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-lg border border-sky-200">
            <Banknote className="w-3 h-3" /> คืนเงินโอน
          </span>
        );
      case 'STORE_DISCOUNT':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
            <Percent className="w-3 h-3" /> ส่วนลดบิล
          </span>
        );
      case 'SUPPLIER_RMA':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
            <Truck className="w-3 h-3" /> ส่งเคลมประกัน
          </span>
        );
      default:
        return <span>{res}</span>;
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Total Claims */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">รายการรับเคลมทั้งหมด</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900 font-mono">
              {claims.length} <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              บันทึกสำเร็จทั้งหมด
            </div>
          </CardContent>
        </Card>

        {/* 2. Total Claim Value */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">มูลค่าสินค้าเคลมรวม</CardTitle>
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

        {/* 3. Replacement Count */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">เปลี่ยนสินค้าชิ้นใหม่ให้ลูกค้า</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
              <RotateCcw className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-indigo-600 font-mono">
              {summary.replacedItemCount} <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              ตัดสต็อกสินค้าใหม่ให้ลูกค้าทันที
            </div>
          </CardContent>
        </Card>

        {/* 4. Cash / Transfer Refunds */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold text-slate-500">คืนเงินสด / โอนเงินคืน</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
              <Banknote className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-emerald-700 font-mono">
              {summary.refundedCount} <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              กระทบลิ้นชักเงินสด / บัญชีร้าน
            </div>
          </CardContent>
        </Card>
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
              <TableRow className="border-b border-slate-200 text-slate-600 font-bold text-xs">
                <TableHead className="pl-4 text-left w-36">เลขที่เคลม / วันที่</TableHead>
                <TableHead className="text-left w-36">บิลขาย / ลูกค้า</TableHead>
                <TableHead className="text-left">สินค้า & อาการชำรุด</TableHead>
                <TableHead className="text-center w-24">จำนวน</TableHead>
                <TableHead className="text-right w-28">มูลค่าเคลม (฿)</TableHead>
                <TableHead className="text-center w-36">วิธีดำเนินการ</TableHead>
                <TableHead className="text-center w-24 pr-4">พิมพ์เอกสาร</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    กำลังโหลดข้อมูลรายการเคลม...
                  </TableCell>
                </TableRow>
              ) : paginatedClaims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-14 text-slate-400 text-xs">
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
                      <div className="text-[10px] text-slate-400 font-mono">SKU: {claim.sku}</div>
                      <div className="text-[10.5px] text-rose-600 font-medium mt-0.5 line-clamp-1">
                        * อาการ: {claim.defectReason}
                      </div>
                      {claim.returnDocId && (
                        <div className="mt-1 flex items-center gap-1">
                          <Link
                            href="/supplier-returns"
                            className="text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200 px-1.5 py-0.2 rounded hover:bg-indigo-100 transition-colors flex items-center gap-1"
                            title="ไปที่เอกสารส่งคืนบริษัท"
                          >
                            <Building2 className="w-3 h-3 text-indigo-600" />
                            <span>เอกสารส่งคืน: {claim.returnDocId}</span>
                          </Link>
                        </div>
                      )}
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

                    {/* 7. Action: Print */}
                    <TableCell className="py-3 pr-4 text-center">
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
