'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { fetchClaimsPage, type ClaimSummary } from '@/lib/claim-service';
import { ClaimRecord, ClaimResolutionType } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatusChip, type ChipTone } from '@/components/ui/status-chip';
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
import { ShieldAlert, Search, RefreshCw, Printer, RotateCcw, Banknote, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, User, Plus, ArrowLeftRight, Building2, Calendar } from 'lucide-react';
import { ProductClaimModal } from '@/components/pos/ProductClaimModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';
import { LoadErrorState, errorMessage } from '@/components/common/LoadErrorState';

const EMPTY_SUMMARY: ClaimSummary = {
  totalClaims: 0, totalClaimValue: 0, pendingSupplierCount: 0, completedCount: 0, scrappedCount: 0,
  replacedItemCount: 0, refundedCount: 0, discountedCount: 0,
};

export default function ClaimsPage() {
  // one page of claims (filters, search, sort and paging on the server, over every claim)
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [total, setTotal] = useState(0);
  // summary cards: over every claim
  const [summary, setSummary] = useState<ClaimSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [resolutionFilter, setResolutionFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'value_desc' | 'value_asc'>('newest');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [reloadKey, setReloadKey] = useState(0);

  // Modals
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [selectedClaimForPdf, setSelectedClaimForPdf] = useState<ClaimRecord | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

  // typing in the search box asks the server once it pauses
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const currentPageResetKey = JSON.stringify([debouncedSearch, resolutionFilter, startDate, endDate, sort, pageSize]);
  const [currentPageResetKeySeen, setCurrentPageResetKeySeen] = useState(currentPageResetKey);
  if (currentPageResetKeySeen !== currentPageResetKey) {
    // a filter changed: back to page 1 (adjusted while rendering, no extra effect pass)
    setCurrentPageResetKeySeen(currentPageResetKey);
    setCurrentPage(1);
  }

  /** Loads the page; state is only updated after the request (a newer request wins). */
  const requestSeq = useRef(0);
  useEffect(() => {
    const seq = ++requestSeq.current;
    const run = async () => {
      try {
        const res = await fetchClaimsPage({
          page: currentPage, limit: pageSize, search: debouncedSearch, resolutionType: resolutionFilter,
          startDate, endDate, sort,
        });
        if (seq !== requestSeq.current) return;
        setClaims(res.rows);
        setTotal(res.total);
        setSummary(res.summary);
        setLoadError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setClaims([]);
        setTotal(0);
        setLoadError(errorMessage(err, 'ไม่สามารถโหลดข้อมูลรายการเคลมได้'));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    };
    void run();
  }, [currentPage, pageSize, debouncedSearch, resolutionFilter, startDate, endDate, sort, reloadKey]);

  const fetchClaims = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paginatedClaims = claims;

  // Resolution Badge Helper
  const getResolutionBadge = (res: ClaimResolutionType) => {
    // how the claim was resolved = a status chip (one chip style)
    const map: Partial<Record<ClaimResolutionType, [string, ChipTone]>> = {
      REPLACE_ITEM: ['เปลี่ยนชิ้นใหม่', 'primary'],
      REFUND_CASH: ['คืนเงินสด', 'warning'],
      REFUND_TRANSFER: ['คืนเงินโอน', 'info'],
      STORE_DISCOUNT: ['ส่วนลดบิล', 'success'],
      SUPPLIER_RMA: ['ส่งเคลมประกัน', 'neutral'],
    };
    const [label, tone] = map[res] ?? [String(res), 'neutral' as ChipTone];
    return <StatusChip tone={tone}>{label}</StatusChip>;
  };

  // Open Print PDF Modal
  const handlePrintPdf = (claim: ClaimRecord, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedClaimForPdf(claim);
    setIsPdfModalOpen(true);
  };

  return (
    <div className="page-shell">
      {loadError && <LoadErrorState message={loadError} onRetry={() => void fetchClaims()} retrying={loading} />}
      {/* ─── PAGE HEADER ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title">
            <ShieldAlert />
            <span>ประวัติการเคลมสินค้า (ลูกค้า)</span>
          </h1>
          <p className="page-subtitle">
            บันทึกการรับเคลมสินค้าจากลูกค้าหน้าร้าน (เปลี่ยนชิ้นใหม่, คืนเงินสด, หรือรับเคลมประกัน)
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Link href="/supplier-returns">
            <Button
              variant="outline"
              className="border-indigo-200 text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 gap-1.5"
              title="ไปยังหน้าระบบส่งเคลมและคืนสินค้าบริษัทผู้จำหน่าย"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>ส่งเคลม / คืนสินค้าบริษัท</span>
            </Button>
          </Link>

          <Button
            onClick={() => setIsClaimModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>รับเคลมสินค้าใหม่</span>
          </Button>

          <Button
            variant="outline"
            onClick={fetchClaims}
            className="border-slate-200 text-slate-700 hover:bg-slate-50"
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
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-indigo-700 tracking-tight">
              {summary.totalClaims}
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
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-rose-600 tracking-tight">
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
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-indigo-600 tracking-tight">
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
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-emerald-700 tracking-tight">
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
              className="pl-10 bg-slate-50 border-slate-200"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <select
              value={resolutionFilter}
              onChange={(e) => setResolutionFilter(e.target.value)}
              className="h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 w-full md:w-48"
            >
              <option value="ALL">ทุกประเภทการรับเคลม</option>
              <option value="REPLACE_ITEM">เปลี่ยนชิ้นใหม่</option>
              <option value="REFUND_CASH">คืนเงินสด</option>
              <option value="REFUND_TRANSFER">คืนเงินโอน</option>
              <option value="STORE_DISCOUNT">🏷️ ส่วนลดบิล</option>
              <option value="SUPPLIER_RMA">ส่งเคลมประกัน</option>
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              aria-label="เรียงลำดับ"
              className="h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 w-full md:w-40"
            >
              <option value="newest">ใหม่ล่าสุดก่อน</option>
              <option value="oldest">เก่าที่สุดก่อน</option>
              <option value="value_desc">มูลค่าเคลมมากไปน้อย</option>
              <option value="value_asc">มูลค่าเคลมน้อยไปมาก</option>
            </select>

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-2xl px-2.5 h-10 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
                className="bg-transparent text-xs text-slate-700 outline-none cursor-pointer"
              />
              <span className="text-slate-400">-</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
                className="bg-transparent text-xs text-slate-700 outline-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── MAIN CLAIMS TABLE ─── */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          {/* round 3: the claimed product is shown (it was only in the printed document); "#" and จำนวน hidden when the table is narrow */}
          <Table>
            <TableHeader >
              <TableRow >
                <TableHead data-narrow="hide" className="text-center w-10">#</TableHead>
                <TableHead className="text-left">เลขที่เคลม</TableHead>
                <TableHead className="text-center">วันที่</TableHead>
                <TableHead className="text-left min-w-32 xl:min-w-40">ลูกค้า</TableHead>
                <TableHead className="text-left min-w-32 xl:min-w-48">สินค้าที่เคลม</TableHead>
                <TableHead data-narrow="hide" className="text-center">จำนวน</TableHead>
                <TableHead className="text-right">มูลค่าเคลม</TableHead>
                <TableHead className="text-center">วิธีดำเนินการ</TableHead>
                <TableHead className="text-right">การจัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-subtle">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    กำลังโหลดข้อมูลรายการเคลม...
                  </TableCell>
                </TableRow>
              ) : paginatedClaims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-subtle">
                    <div className="flex flex-col items-center gap-2">
                      <ShieldAlert className="w-8 h-8 text-subtle" />
                      <span className="font-medium text-muted-foreground">ไม่พบประวัติการรับเคลมสินค้า</span>
                      <Button
                        size="sm"
                        onClick={() => setIsClaimModalOpen(true)}
                        className="bg-indigo-600 text-white mt-1"
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
                    <TableCell data-narrow="hide" className="text-center doc-no whitespace-nowrap font-medium text-muted-foreground">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </TableCell>

                    {/* 2. Claim ID */}
                    <TableCell className="doc-no whitespace-nowrap">
                      <div className="doc-no text-fg">{claim.id}</div>
                      {claim.returnDocId && (
                        <div className="mt-1">
                          <Link
                            href="/supplier-returns"
                            className="text-sub font-medium bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-md hover:bg-indigo-100 transition-colors inline-flex items-center gap-1"
                            title="ไปที่เอกสารส่งคืนบริษัท"
                          >
                            <Building2 className="w-3 h-3 text-indigo-600" />
                            <span>ส่งคืน: {claim.returnDocId}</span>
                          </Link>
                        </div>
                      )}
                    </TableCell>

                    {/* 3. Date (แยก col. วันที่) */}
                    <TableCell data-narrow="wrap" className="text-center doc-no whitespace-nowrap text-muted-foreground">
                      {formatDate(claim.claimDate)}
                    </TableCell>

                    {/* 4. Customer Column (Center Align) */}
                    <TableCell className="min-w-32 xl:min-w-40">
                      <div className="font-medium text-fg flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-subtle shrink-0" />
                        <span className="line-clamp-2 break-words" title={claim.customerName || ''}>{claim.customerName || 'ลูกค้าทั่วไป'}</span>
                      </div>
                      {claim.customerPhone && (
                        <div className="text-sub text-subtle doc-no mt-0.5">
                          {claim.customerPhone}
                        </div>
                      )}
                    </TableCell>

                    {/* 4b. Product (round 3) */}
                    <TableCell className="min-w-32 xl:min-w-48" data-testid="claim-product">
                      <span className="line-clamp-2 break-words text-fg" title={claim.productName || ''}>{claim.productName || '-'}</span>
                    </TableCell>

                    {/* 5. Total Claim Quantity */}
                    <TableCell data-narrow="hide" className="text-center doc-no whitespace-nowrap">
                      <div className="font-medium text-fg">
                        {claim.baseQuantity !== undefined ? claim.baseQuantity : (claim.quantity * (claim.conversionFactor || 1))} {claim.conversionFactor && claim.conversionFactor > 1 ? (claim.replacementUnitName || 'ชิ้น') : (claim.unitName || 'ชิ้น')}
                      </div>
                      {claim.conversionFactor && claim.conversionFactor > 1 && (
                        <div className="text-sub text-subtle font-normal mt-0.5">
                          ({claim.quantity} {claim.unitName})
                        </div>
                      )}
                    </TableCell>

                    {/* 6. Total Claim Value */}
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      <span className="font-medium text-fg block">
                        {formatCurrency(claim.totalClaimValue)}
                      </span>
                    </TableCell>

                    {/* 7. Resolution */}
                    <TableCell className="text-center whitespace-nowrap">
                      {getResolutionBadge(claim.resolutionType)}
                    </TableCell>

                    {/* 8. Action: Print */}
                    <TableCell className="w-px whitespace-nowrap text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => handlePrintPdf(claim, e)}
                        className="text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 gap-1.5 whitespace-nowrap"
                        title="พิมพ์ใบรับเคลม / ดูรายละเอียด"
                        aria-label="พิมพ์"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span data-act-label>พิมพ์</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Footer */}
        {total > 0 && (
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
              <span>รายการ จากทั้งหมด {total} รายการ</span>
            </div>

            <div className="flex items-center gap-btn">
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
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage >= totalPages}
                className="h-8 w-8 p-0"
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
