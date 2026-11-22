'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { fetchSuppliers } from '@/lib/supplier-return-service';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatusChip } from '@/components/ui/status-chip';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PackageX, Search, RefreshCw, Truck, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ShieldAlert, ArrowLeftRight, Boxes, Eye, FileText } from 'lucide-react';
import { LoadErrorState, errorMessage } from '@/components/common/LoadErrorState';

// Item representation for Claim Stock
interface ClaimStockItem {
  id: string;
  claimId: string;
  claimDate: string;
  orderNumber?: string;
  customerName: string;
  customerPhone?: string | null;
  productId: string;
  productName: string;
  sku: string;
  category: string;
  supplierId: string;
  supplierName: string;
  defectReason: string;
  quantity: number;        // Base quantity in pieces
  unitName: string;        // Smallest unit name (ชิ้น)
  costPrice: number;       // Base cost price per unit
  unitPrice: number;       // Selling price per unit
  totalCostValue: number;  // quantity * costPrice
  totalClaimValue: number; // claim value (selling price)
  status: string;          // PENDING_SUPPLIER, SENT_TO_SUPPLIER, etc.
  returnDocId?: string;    // RTN-xxxx if assigned to a return note
}

interface ProductClaimSummary {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  supplierId: string;
  supplierName: string;
  unitName: string;
  costPrice: number;
  unitPrice: number;
  totalPieces: number;
  inStockPieces: number;
  totalCostValue: number;
  inStockCostValue: number;
  totalClaimValue: number;
  latestClaimDate: string;
  claimCount: number;
}

interface SupplierClaimSummary {
  supplierId: string;
  supplierName: string;
  supplierPhone?: string;
  productCount: number;
  totalPieces: number;
  inStockPieces: number;
  totalCostValue: number;
  inStockCostValue: number;
  totalClaimValue: number;
  latestClaimDate: string;
}

/** GET /claims/claim-stock: the page computed on the server over every claim (it read the newest 500 claims). */
interface ClaimStockScreen {
  stats: { uniqueProducts: number; pieces: number; costValue: number; suppliersCount: number };
  categories: string[];
  filteredCount: number;
  products: { data: ProductClaimSummary[]; total: number };
  suppliers: SupplierClaimSummary[];
  records: { data: ClaimStockItem[]; total: number };
}

const RECORDS_PAGE = 50;

export default function ClaimInventoryPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [suppliersList, setSuppliersList] = useState<Array<{ id: string; name: string; phone?: string }>>([]);
  const [screen, setScreen] = useState<ClaimStockScreen | null>(null);
  
  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'IN_STOCK' | 'RETURNED' | 'ALL'>('IN_STOCK');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'products' | 'suppliers' | 'records'>('products');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [recordsPage, setRecordsPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  // Detail Modal
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductClaimSummary | null>(null);
  const [modalClaims, setModalClaims] = useState<ClaimStockItem[]>([]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // supplier list of the filter (phones come with the server rows)
  useEffect(() => {
    fetchSuppliers()
      .then((loaded) => setSuppliersList((loaded || []).map((s) => ({ id: s.id, name: s.name, phone: s.phone ?? undefined }))))
      .catch((err) => setLoadError(errorMessage(err, 'ไม่สามารถโหลดข้อมูลสต๊อกของเคลมได้')));
  }, []);

  // Reset page when filters change
  const currentPageResetKey = JSON.stringify([debouncedSearch, selectedSupplierId, statusFilter, categoryFilter, activeTab, pageSize]);
  const [currentPageResetKeySeen, setCurrentPageResetKeySeen] = useState(currentPageResetKey);
  if (currentPageResetKeySeen !== currentPageResetKey) {
    // a filter changed: back to page 1 (adjusted while rendering, no extra effect pass)
    setCurrentPageResetKeySeen(currentPageResetKey);
    setCurrentPage(1);
    setRecordsPage(1);
  }

  const filterParams = () => {
    const qs = new URLSearchParams({ status: statusFilter, supplierId: selectedSupplierId, category: categoryFilter });
    if (debouncedSearch.trim()) qs.set('search', debouncedSearch);
    return qs;
  };

  /** Loads the screen (figures over every claim, the products / records pages); a newer request wins. */
  const requestSeq = useRef(0);
  useEffect(() => {
    const seq = ++requestSeq.current;
    const qs = filterParams();
    qs.set('page', String(currentPage));
    qs.set('limit', String(pageSize));
    qs.set('recordsPage', String(recordsPage));
    qs.set('recordsLimit', String(RECORDS_PAGE));
    const run = async () => {
      try {
        const res = await apiFetch<ClaimStockScreen | null>(`/claims/claim-stock?${qs}`);
        if (!res || !res.products || !res.records) throw new Error('ข้อมูลสต๊อกของเคลมจากเซิร์ฟเวอร์ไม่ถูกต้อง');
        if (seq !== requestSeq.current) return;
        setScreen(res);
        setLoadError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        console.error('Error loading claim inventory:', err);
        setScreen(null);
        setLoadError(errorMessage(err, 'ไม่สามารถโหลดข้อมูลสต๊อกของเคลมได้'));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, selectedSupplierId, statusFilter, categoryFilter, currentPage, pageSize, recordsPage, reloadKey]);

  const fetchData = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const productSummaries = screen?.products.data || [];
  const productTotal = screen?.products.total || 0;
  const supplierSummaries = screen?.suppliers || [];
  const filteredClaims = screen?.records.data || [];
  const filteredCount = screen?.filteredCount || 0;
  const stats = screen?.stats || { uniqueProducts: 0, pieces: 0, costValue: 0, suppliersCount: 0 };
  const categoryOptions = screen?.categories || [];
  const paginatedProducts = productSummaries;
  const totalProductPages = Math.ceil(productTotal / pageSize) || 1;
  const totalRecordPages = Math.ceil(filteredCount / RECORDS_PAGE) || 1;

  // Open Product Claim Detail Modal
  const handleOpenProductDetail = (p: ProductClaimSummary) => {
    setSelectedProductForModal(p);
    setModalClaims([]);
    setIsDetailModalOpen(true);
    const qs = filterParams();
    qs.set('productId', p.productId);
    qs.set('sku', p.sku);
    qs.set('rowSupplierId', p.supplierId);
    apiFetch<ClaimStockItem[] | null>(`/claims/claim-stock/claims?${qs}`)
      .then((rows) => setModalClaims(Array.isArray(rows) ? rows : []))
      .catch((err) => setLoadError(errorMessage(err, 'ไม่สามารถโหลดใบเคลมของสินค้านี้ได้')));
  };

  return (
    <div className="page-shell">
      {loadError && <LoadErrorState message={loadError} onRetry={() => void fetchData()} retrying={loading} />}
      {/* ─── PAGE HEADER (Standard Consistent Header) ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="page-title">
            <PackageX />
            <span>สต๊อกของเคลม (Claim Stock Inventory)</span>
          </h1>
          <p className="page-subtitle">
            ตรวจสอบจำนวนสินค้าและมูลค่าของเคลมคงคลัง แยกดูตามบริษัทผู้จำหน่ายเพื่อเตรียมส่งคืนหรือลดหนี้
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            onClick={fetchData}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 sm:text-sm"
            title="รีเฟรชข้อมูลสต๊อกของเคลม"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>

          <Link href="/supplier-returns">
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white sm:text-sm gap-1.5"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>ส่งเคลม & ใบลดหนี้บริษัท</span>
            </Button>
          </Link>

          <Link href="/claims">
            <Button
              variant="outline"
              className="border-rose-200 text-rose-700 hover:bg-rose-50 sm:text-sm gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>รับเคลมสินค้า (ลูกค้า)</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* ─── TOP STATS OVERVIEW CARDS (Compact Single-line Layout matching orders page) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Card 1: Unique Claim Products */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
              <Boxes className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-rose-950">สินค้าเคลมในคลัง:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-rose-600 tracking-tight">
              {stats.uniqueProducts}
            </span>
            <span className="text-xs text-rose-700 font-sans font-bold">รายการ</span>
          </div>
        </div>

        {/* Card 2: Total Claim Pieces */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-amber-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 shrink-0">
              <PackageX className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-amber-950">จำนวนชิ้นรอเคลม:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-amber-700 tracking-tight">
              {stats.pieces}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">ชิ้น</span>
          </div>
        </div>

        {/* Card 3: Total Claim Cost Value */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-indigo-950">มูลค่าต้นทุนรวม:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-indigo-700 tracking-tight">
              {formatCurrency(stats.costValue)}
            </span>
          </div>
        </div>

        {/* Card 4: Distinct Suppliers */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-slate-100 text-slate-700 rounded-md border border-slate-200 shrink-0">
              <Truck className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-800">ผู้จำหน่ายที่มีของเคลม:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-slate-800 tracking-tight">
              {stats.suppliersCount}
            </span>
            <span className="text-xs text-slate-500 font-sans font-bold">บริษัท</span>
          </div>
        </div>
      </div>

      {/* ─── FILTERS & SEARCH TOOLBAR ─── */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
        <div className="flex flex-col lg:flex-row gap-2 items-stretch lg:items-center justify-between">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              type="text"
              placeholder="ค้นหาชื่อสินค้า, บาร์โค้ด, รหัสสินค้า, ชื่อผู้จำหน่าย, หรือเลขที่ใบเคลม..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-200 focus:bg-white sm:text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Supplier Filter (Primary Requirement) */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-bold text-slate-600 shrink-0">ผู้จำหน่าย:</label>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="h-10 px-2.5 text-sm sm:text-sm bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-800 max-w-[220px] truncate outline-none focus:border-indigo-500 shadow-2xs"
              >
                <option value="ALL">ทุกผู้จำหน่าย ({suppliersList.length} บริษัท)</option>
                {suppliersList.map((supp) => (
                  <option key={supp.id} value={supp.id}>
                    {supp.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-bold text-slate-600 shrink-0">สถานะสต็อก:</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="h-10 px-2.5 text-sm sm:text-sm bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-800 outline-none focus:border-indigo-500 shadow-2xs"
              >
                <option value="IN_STOCK">ของเคลมรอส่งคืน (ในสต็อก)</option>
                <option value="RETURNED">ส่งคืนบริษัทแล้ว</option>
                <option value="ALL">ทั้งหมด</option>
              </select>
            </div>

            {/* Category Filter */}
            {categoryOptions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-bold text-slate-600 shrink-0">หมวดหมู่:</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-10 px-2.5 text-sm sm:text-sm bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-800 outline-none focus:border-indigo-500 shadow-2xs"
                >
                  <option value="ALL">ทุกหมวดหมู่</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Quick Filter Reset */}
        {(search || selectedSupplierId !== 'ALL' || statusFilter !== 'IN_STOCK' || categoryFilter !== 'ALL') && (
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
            <span className="text-slate-500 font-medium">
              กำลังกรอง: พบ {productTotal} สินค้า ({filteredCount} รายการเคลม)
            </span>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSelectedSupplierId('ALL');
                setStatusFilter('IN_STOCK');
                setCategoryFilter('ALL');
              }}
              className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          </div>
        )}
      </div>

      {/* ─── MAIN TABS CONTENT ─── */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 pb-2">
          <TabsList className="bg-slate-100 p-1 rounded-xl h-auto">
            <TabsTrigger
              value="products"
              className="text-xs sm:text-sm font-bold data-[state=active]:bg-white data-[state=active]:text-indigo-900 rounded-lg px-3 py-1.5 gap-1.5"
            >
              <Boxes className="w-4 h-4" />
              <span>สรุปรายสินค้าเคลม ({productTotal})</span>
            </TabsTrigger>

            <TabsTrigger
              value="suppliers"
              className="text-xs sm:text-sm font-bold data-[state=active]:bg-white data-[state=active]:text-indigo-900 rounded-lg px-3 py-1.5 gap-1.5"
            >
              <Truck className="w-4 h-4" />
              <span>แยกตามผู้จำหน่าย ({supplierSummaries.length})</span>
            </TabsTrigger>

            <TabsTrigger
              value="records"
              className="text-xs sm:text-sm font-bold data-[state=active]:bg-white data-[state=active]:text-indigo-900 rounded-lg px-3 py-1.5 gap-1.5"
            >
              <FileText className="w-4 h-4" />
              <span>ประวัติใบเคลมย่อย ({filteredCount})</span>
            </TabsTrigger>
          </TabsList>

          <span className="text-xs font-bold text-slate-500 tabular-nums">
            แสดง {productTotal} สินค้าเคลม
          </span>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════════
            TAB 1: PRODUCT SUMMARY TABLE (Main View)
        ══════════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="products" className="m-0 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              {/* round 3: category under the name (was its own column); "#" and ทุน/หน่วย hidden when the table is under 1150 px */}
              <Table>
                <TableHeader >
                  <TableRow className="hover:bg-transparent">
                    <TableHead data-mid="hide" className="text-center w-10">#</TableHead>
                    <TableHead className="text-left">บาร์โค้ด / SKU</TableHead>
                    <TableHead className="text-left min-w-44 xl:min-w-56">ชื่อสินค้าเคลม / หมวดหมู่</TableHead>
                    <TableHead className="text-left min-w-44">บริษัทผู้จำหน่าย</TableHead>
                    <TableHead className="text-right">จำนวนเคลม</TableHead>
                    <TableHead data-mid="hide" className="text-right">ทุน/หน่วย</TableHead>
                    <TableHead className="text-right">มูลค่าทุนรวม</TableHead>
                    <TableHead className="text-center">รับเคลมล่าสุด</TableHead>
                    <TableHead className="text-right">การจัดการ</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-subtle">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                        กำลังโหลดข้อมูลสต๊อกของเคลม...
                      </TableCell>
                    </TableRow>
                  ) : paginatedProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-subtle">
                        <div className="flex flex-col items-center gap-2">
                          <PackageX className="w-10 h-10 text-subtle" />
                          <span className="font-medium text-muted-foreground">ไม่พบสินค้าในสต๊อกของเคลม</span>
                          <span className="text-sub text-subtle">
                            เมื่อมีลูกค้ามาทำรายการเคลมสินค้า สินค้าจะถูกนำมาเก็บไว้ที่สต๊อกของเคลมเพื่อรอส่งคืนบริษัท
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedProducts.map((item, idx) => {
                      const displayQty = statusFilter === 'IN_STOCK' ? item.inStockPieces : item.totalPieces;
                      const displayCost = statusFilter === 'IN_STOCK' ? item.inStockCostValue : item.totalCostValue;

                      return (
                        <tr key={`${item.productId}_${item.sku}_${idx}`} className="hover:bg-slate-50/70 transition-colors">
                          {/* 1. Sequence (ลำดับ) */}
                          <td data-mid="hide" className="text-center doc-no whitespace-nowrap font-medium text-muted-foreground">
                            {(currentPage - 1) * pageSize + idx + 1}
                          </td>

                          {/* 2. Barcode / SKU */}
                          <td className="doc-no whitespace-nowrap">
                            <span className="doc-no text-fg block">
                              {item.sku || '-'}
                            </span>
                          </td>

                          {/* 3. Product Name */}
                          <td className="min-w-44 xl:min-w-56">
                            <span className="font-medium text-fg line-clamp-2 break-words" title={item.productName}>
                              {item.productName}
                            </span>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                              <span className="text-sub text-muted-foreground doc-no whitespace-nowrap">
                                รวม {item.claimCount} ใบเคลม
                              </span>
                              {item.category && (
                                <span className="max-w-full truncate text-sub text-muted-foreground" title={item.category}>{item.category}</span>
                              )}
                              {item.inStockPieces > 0 && item.inStockPieces < item.totalPieces && (
                                <span className="text-sub text-warn font-medium">
                                  รอส่ง {item.inStockPieces} / ส่งแล้ว {item.totalPieces - item.inStockPieces}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 5. Supplier */}
                          <td className="min-w-44">
                            <div className="font-medium text-fg flex items-center gap-1.5">
                              <Truck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span className="line-clamp-2 break-words" title={item.supplierName}>{item.supplierName}</span>
                            </div>
                          </td>

                          {/* 6. Quantity of Claim Pieces */}
                          <td className="text-right tabular-nums whitespace-nowrap">
                            <span className="font-medium text-danger block">
                              {displayQty} <span className="text-sub font-medium text-muted-foreground">{item.unitName}</span>
                            </span>
                          </td>

                          {/* 7. Cost per Unit */}
                          <td data-mid="hide" className="text-right tabular-nums whitespace-nowrap text-fg sm:text-sm">
                            {formatCurrency(item.costPrice)}
                          </td>

                          {/* 8. Total Cost Value */}
                          <td className="text-right tabular-nums whitespace-nowrap">
                            <span className="font-medium text-fg block">
                              {formatCurrency(displayCost)}
                            </span>
                          </td>

                          {/* 9. Latest Claim Date (แยก col. วันที่) */}
                          <td data-narrow="wrap" className="text-center doc-no whitespace-nowrap text-muted-foreground">
                            {formatDate(item.latestClaimDate)}
                          </td>

                          {/* 10. Actions */}
                          <td className="w-px whitespace-nowrap">
                            <div className="flex flex-nowrap items-center justify-end gap-btn">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenProductDetail(item)}
                                className="border-slate-300 hover:bg-slate-50 text-fg gap-1"
                                title="ดูประวัติใบเคลมทั้งหมดของสินค้านี้"
                                aria-label={`ใบเคลม (${item.claimCount})`}
                              >
                                <Eye className="w-3.5 h-3.5 text-indigo-600" />
                                <span data-act-label>ใบเคลม ({item.claimCount})</span>
                              </Button>

                              <Link href="/supplier-returns">
                                <Button
                                  size="sm"
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
                                  title="ไปสร้างใบส่งคืนบริษัทผู้จำหน่าย"
                                  aria-label="ส่งคืน"
                                >
                                  <ArrowLeftRight className="w-3.5 h-3.5" />
                                  <span data-act-label>ส่งคืน</span>
                                </Button>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {productTotal > pageSize && (
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50/70 border-t border-slate-200 text-xs">
                <div className="text-slate-500 font-medium">
                  แสดงหน้า {currentPage} จากทั้งหมด {totalProductPages} หน้า (รวม {productTotal} สินค้า)
                </div>

                <div className="flex items-center gap-btn">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="px-2 tabular-nums font-bold text-slate-700">
                    {currentPage} / {totalProductPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalProductPages, p + 1))}
                    disabled={currentPage === totalProductPages}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(totalProductPages)}
                    disabled={currentPage === totalProductPages}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════════════
            TAB 2: SUPPLIER GROUPED SUMMARY
        ══════════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="suppliers" className="m-0 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader >
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-center w-16">
                      ลำดับ
                    </TableHead>
                    <TableHead className="text-left">
                      บริษัทผู้จำหน่าย
                    </TableHead>
                    <TableHead className="text-center">
                      จำนวนรายการสินค้า
                    </TableHead>
                    <TableHead className="text-right">
                      จำนวนชิ้นเคลมรวม
                    </TableHead>
                    <TableHead className="text-right">
                      มูลค่าต้นทุนรวม
                    </TableHead>
                    <TableHead className="text-center">
                      รับเคลมล่าสุด
                    </TableHead>
                    <TableHead className="text-center">
                      การจัดการ
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {supplierSummaries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-subtle">
                        ไม่พบข้อมูลสินค้าเคลมตามผู้จำหน่ายที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    supplierSummaries.map((supp, idx) => {
                      const displayQty = statusFilter === 'IN_STOCK' ? supp.inStockPieces : supp.totalPieces;
                      const displayCost = statusFilter === 'IN_STOCK' ? supp.inStockCostValue : supp.totalCostValue;

                      return (
                        <tr key={supp.supplierId} className="hover:bg-slate-50/70 transition-colors">
                          {/* 1. Sequence (ลำดับ) */}
                          <td className="text-center doc-no whitespace-nowrap font-medium text-muted-foreground">
                            {idx + 1}
                          </td>

                          {/* 2. Supplier Name & Phone */}
                          <td className="min-w-44 xl:min-w-56">
                            <div className="font-medium text-fg flex items-center gap-1.5">
                              <Truck className="w-4 h-4 text-indigo-600 shrink-0" />
                              <span className="line-clamp-2 break-words" title={supp.supplierName}>{supp.supplierName}</span>
                            </div>
                            {supp.supplierPhone && (
                              <span className="text-sub text-muted-foreground doc-no mt-0.5 block">
                                โทร: {supp.supplierPhone}
                              </span>
                            )}
                          </td>

                          {/* 3. Product Count */}
                          <td className="text-center doc-no whitespace-nowrap font-medium text-fg">
                            {supp.productCount} รายการ
                          </td>

                          {/* 4. Total Pieces */}
                          <td className="text-right tabular-nums whitespace-nowrap">
                            <span className="font-medium text-danger block">
                              {displayQty} <span className="text-sub font-medium text-muted-foreground">ชิ้น</span>
                            </span>
                          </td>

                          {/* 5. Total Cost Value */}
                          <td className="text-right tabular-nums whitespace-nowrap">
                            <span className="font-medium text-fg block">
                              {formatCurrency(displayCost)}
                            </span>
                          </td>

                          {/* 6. Latest Claim Date (แยก col. วันที่) */}
                          <td className="text-center doc-no whitespace-nowrap text-muted-foreground">
                            {formatDate(supp.latestClaimDate)}
                          </td>

                          {/* 7. Actions */}
                          <td className="w-px whitespace-nowrap">
                            <div className="flex flex-nowrap items-center justify-end gap-btn">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedSupplierId(supp.supplierId);
                                  setActiveTab('products');
                                }}
                                className="border-slate-300 hover:bg-slate-50 text-fg gap-1"
                              >
                                <span>ดู {supp.productCount} สินค้า</span>
                              </Button>

                              <Link href="/supplier-returns">
                                <Button
                                  size="sm"
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
                                >
                                  <ArrowLeftRight className="w-3.5 h-3.5" />
                                  <span>สร้างใบส่งคืน</span>
                                </Button>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════════════
            TAB 3: DETAILED CLAIM RECORDS TABLE
        ══════════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="records" className="m-0 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader >
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-center w-16">
                      ลำดับ
                    </TableHead>
                    <TableHead className="text-left w-36">
                      เลขที่เคลม
                    </TableHead>
                    <TableHead className="text-center w-36">
                      วันที่รับเคลม
                    </TableHead>
                    <TableHead className="text-left">
                      สินค้าเคลม
                    </TableHead>
                    <TableHead className="text-left w-48">
                      ผู้จำหน่าย
                    </TableHead>
                    <TableHead className="text-right w-32">
                      จำนวน
                    </TableHead>
                    <TableHead className="text-right w-36">
                      มูลค่าทุน
                    </TableHead>
                    <TableHead className="text-center w-36">
                      สถานะส่งคืน
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {filteredClaims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-subtle">
                        ไม่พบรายการใบเคลมตามเงื่อนไข
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClaims.map((claim, idx) => (
                      <tr key={claim.id} className="hover:bg-slate-50/70 transition-colors">
                        {/* 1. Sequence */}
                        <td className="text-center doc-no whitespace-nowrap font-medium text-muted-foreground">
                          {(recordsPage - 1) * RECORDS_PAGE + idx + 1}
                        </td>

                        {/* 2. Claim Ticket ID */}
                        <td className="doc-no whitespace-nowrap">
                          <span className="doc-no text-fg block">
                            {claim.claimId}
                          </span>
                          {claim.orderNumber && (
                            <span className="text-sub text-subtle block doc-no">
                              บิล: {claim.orderNumber}
                            </span>
                          )}
                        </td>

                        {/* 3. Claim Date (แยก col. วันที่) */}
                        <td className="text-center doc-no whitespace-nowrap text-muted-foreground">
                          {formatDate(claim.claimDate)}
                        </td>

                        {/* 4. Product Name & Defect */}
                        <td >
                          <p className="font-medium text-fg">{claim.productName}</p>
                          <p className="text-sub text-danger font-medium mt-0.5">
                            อาการ: {claim.defectReason}
                          </p>
                        </td>

                        {/* 5. Supplier */}
                        <td >
                          <span className="font-medium text-fg block">
                            {claim.supplierName}
                          </span>
                        </td>

                        {/* 6. Quantity */}
                        <td className="text-right tabular-nums whitespace-nowrap">
                          <span className="font-medium text-danger block">
                            {claim.quantity} <span className="text-sub font-medium text-muted-foreground">{claim.unitName}</span>
                          </span>
                        </td>

                        {/* 7. Cost Value */}
                        <td className="text-right tabular-nums whitespace-nowrap font-medium text-fg">
                          {formatCurrency(claim.totalCostValue)}
                        </td>

                        {/* 8. Status Badge */}
                        <td className="text-center">
                          {claim.returnDocId ? (
                            <StatusChip tone="success">
                              ส่งคืนใน {claim.returnDocId}
                            </StatusChip>
                          ) : claim.status === 'SCRAPPED' ? (
                            <StatusChip tone="neutral">
                              ตัดจำหน่าย
                            </StatusChip>
                          ) : (
                            <StatusChip tone="danger">
                              รอส่งคืนบริษัท
                            </StatusChip>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {filteredCount > RECORDS_PAGE && (
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50/70 border-t border-slate-200 text-xs">
                <div className="text-slate-500 font-medium">
                  แสดงหน้า {recordsPage} จากทั้งหมด {totalRecordPages} หน้า (รวม {filteredCount} ใบเคลม)
                </div>
                <div className="flex items-center gap-btn">
                  <Button variant="outline" size="sm" onClick={() => setRecordsPage((p) => Math.max(1, p - 1))} disabled={recordsPage === 1} className="h-7 w-7 p-0">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="px-2 tabular-nums font-bold text-slate-700">{recordsPage} / {totalRecordPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setRecordsPage((p) => Math.min(totalRecordPages, p + 1))} disabled={recordsPage >= totalRecordPages} className="h-7 w-7 p-0">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── DETAIL MODAL: SHOW ALL CLAIMS FOR A SELECTED PRODUCT ─── */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900 font-bold text-base">
              <Boxes className="w-5 h-5 text-indigo-600" />
              <span>รายการใบเคลมของ: {selectedProductForModal?.productName}</span>
            </DialogTitle>
          </DialogHeader>

          {selectedProductForModal && (
            <div className="space-y-4 pt-2">
              {/* Product Info Bar */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">บาร์โค้ด / SKU:</span>
                  <span className="tabular-nums font-bold text-slate-900 text-sm">
                    {selectedProductForModal.sku || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">บริษัทผู้จำหน่าย:</span>
                  <span className="font-bold text-indigo-700 text-sm truncate block">
                    {selectedProductForModal.supplierName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">จำนวนของเคลมรวม:</span>
                  <span className="tabular-nums font-semibold text-rose-600 text-sm">
                    {selectedProductForModal.totalPieces} {selectedProductForModal.unitName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">มูลค่าทุนรวม:</span>
                  <span className="tabular-nums font-semibold text-slate-900 text-sm">
                    {formatCurrency(selectedProductForModal.totalCostValue)}
                  </span>
                </div>
              </div>

              {/* Claims Breakdown Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <Table>
                  <TableHeader >
                    <TableRow>
                      <TableHead className="w-12 text-center">ลำดับ</TableHead>
                      <TableHead className="w-32">เลขที่เคลม</TableHead>
                      <TableHead className="w-28 text-center">วันที่</TableHead>
                      <TableHead >อาการชำรุด</TableHead>
                      <TableHead className="w-24 text-right">จำนวน</TableHead>
                      <TableHead className="w-28 text-right">มูลค่าทุน</TableHead>
                      <TableHead className="w-28 text-center">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100 text-sub">
                    {modalClaims.map((c, i) => (
                      <TableRow key={c.id}>
                        <td className="text-center doc-no whitespace-nowrap text-muted-foreground font-medium">
                          {i + 1}
                        </td>
                        <td className="doc-no whitespace-nowrap font-medium">
                          {c.claimId}
                        </td>
                        <td className="text-center doc-no whitespace-nowrap text-muted-foreground">
                          {formatDate(c.claimDate)}
                        </td>
                        <td className="text-fg">
                          {c.defectReason}
                        </td>
                        <td className="text-right tabular-nums whitespace-nowrap font-medium text-danger">
                          {c.quantity} {c.unitName}
                        </td>
                        <td className="text-right tabular-nums whitespace-nowrap font-medium text-fg">
                          {formatCurrency(c.totalCostValue)}
                        </td>
                        <td className="text-center">
                          {c.returnDocId ? (
                            <StatusChip tone="success">
                              ส่งคืนแล้ว
                            </StatusChip>
                          ) : (
                            <StatusChip tone="danger">
                              ในสต็อกเคลม
                            </StatusChip>
                          )}
                        </td>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Action Footer in Modal */}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDetailModalOpen(false)}
                  
                >
                  ปิดหน้าต่าง
                </Button>
                <Link href="/supplier-returns">
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>ไปหน้าสร้างใบส่งคืนบริษัท</span>
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
