'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { loadAllClaimRecords } from '@/lib/claim-service';
import { 
  loadSuppliers, 
  resolveProductSupplierAndCost 
} from '@/lib/supplier-return-service';
import { useProductStore } from '@/lib/store/product-store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card } from '@/components/ui/card';
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
import {
  PackageX,
  Search,
  RefreshCw,
  Truck,
  Building2,
  Calendar,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ShieldAlert,
  ArrowLeftRight,
  Boxes,
  Eye,
  ExternalLink,
  Plus,
  CheckCircle2,
  FileText,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';

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
  claims: ClaimStockItem[];
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
  products: ProductClaimSummary[];
}

export default function ClaimInventoryPage() {
  const [loading, setLoading] = useState(true);
  const [claimItems, setClaimItems] = useState<ClaimStockItem[]>([]);
  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  
  // Filters
  const [search, setSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'IN_STOCK' | 'RETURNED' | 'ALL'>('IN_STOCK');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'products' | 'suppliers' | 'records'>('products');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Detail Modal
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductClaimSummary | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Load and enrich all claim stock data
  const fetchData = () => {
    setLoading(true);
    try {
      const rawClaims = loadAllClaimRecords();
      const loadedSuppliers = loadSuppliers();
      setSuppliersList(loadedSuppliers);

      const storeProducts = useProductStore.getState().products || [];

      const enriched: ClaimStockItem[] = rawClaims.map((c) => {
        // Resolve supplier and cost price
        let suppId = c.supplierId;
        let suppName = c.supplierName;
        let cost = Number(c.costPrice || 0);

        if (!suppId || cost <= 0) {
          const resolved = resolveProductSupplierAndCost(c.productId, c.sku);
          if (!suppId) {
            suppId = resolved.supplierId;
            suppName = resolved.supplierName;
          }
          if (cost <= 0) {
            cost = resolved.costPrice > 0 ? resolved.costPrice : Number(c.unitPrice || 0);
          }
        }

        // Category resolution
        const matchedProduct = storeProducts.find(
          (p) => p.id === c.productId || p.sku === c.sku
        );
        const category = matchedProduct?.category || 'ทั่วไป';

        // Base unit quantity
        const factor = Number(c.conversionFactor || 1);
        const baseQty = Number(
          c.baseQuantity !== undefined
            ? c.baseQuantity
            : Number(c.quantity || 1) * factor
        );
        const baseUnit = factor > 1 ? (c.replacementUnitName || 'ชิ้น') : (c.unitName || 'ชิ้น');
        const baseCost = factor > 1 && cost > 0 ? cost / factor : cost;
        const totalCost = Math.round(baseCost * baseQty * 100) / 100;

        return {
          id: c.id,
          claimId: c.id,
          claimDate: c.claimDate || c.orderDate || new Date().toISOString(),
          orderNumber: c.orderNumber,
          customerName: c.customerName || 'ลูกค้าทั่วไป',
          customerPhone: c.customerPhone,
          productId: c.productId,
          productName: c.productName,
          sku: c.sku,
          category,
          supplierId: suppId || 'UNKNOWN',
          supplierName: suppName || 'ไม่ระบุผู้จำหน่าย',
          defectReason: c.defectReason || 'สินค้าชำรุด',
          quantity: baseQty,
          unitName: baseUnit,
          costPrice: baseCost,
          unitPrice: Number(c.unitPrice || 0),
          totalCostValue: totalCost,
          totalClaimValue: Number(c.totalClaimValue || 0),
          status: c.status,
          returnDocId: c.returnDocId,
        };
      });

      setClaimItems(enriched);
    } catch (err) {
      console.error('Error loading claim inventory:', err);
      toast.error('ไม่สามารถโหลดข้อมูลสต๊อกของเคลมได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter claim items
  const filteredClaims = useMemo(() => {
    return claimItems.filter((item) => {
      // 1. Status Filter
      if (statusFilter === 'IN_STOCK') {
        // Items currently in claim stock (unreturned to supplier and not scrapped)
        if (item.returnDocId || item.status === 'SCRAPPED' || item.status === 'SENT_TO_SUPPLIER' || item.status === 'COMPLETED' || item.status === 'SUPPLIER_REPLACED') {
          return false;
        }
      } else if (statusFilter === 'RETURNED') {
        // Items already packaged in a supplier return note
        if (!item.returnDocId && item.status !== 'SENT_TO_SUPPLIER' && item.status !== 'COMPLETED' && item.status !== 'SUPPLIER_REPLACED') {
          return false;
        }
      }

      // 2. Supplier Filter
      if (selectedSupplierId !== 'ALL' && item.supplierId !== selectedSupplierId) {
        return false;
      }

      // 3. Category Filter
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) {
        return false;
      }

      // 4. Search Filter
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchName = item.productName.toLowerCase().includes(q);
        const matchSku = item.sku.toLowerCase().includes(q);
        const matchSupp = item.supplierName.toLowerCase().includes(q);
        const matchClaim = item.claimId.toLowerCase().includes(q);
        const matchOrder = item.orderNumber ? item.orderNumber.toLowerCase().includes(q) : false;
        return matchName || matchSku || matchSupp || matchClaim || matchOrder;
      }

      return true;
    });
  }, [claimItems, statusFilter, selectedSupplierId, categoryFilter, search]);

  // Aggregate by Product
  const productSummaries = useMemo(() => {
    const map = new Map<string, ProductClaimSummary>();

    filteredClaims.forEach((item) => {
      const key = `${item.productId}_${item.sku}_${item.supplierId}`;
      const existing = map.get(key);

      const isInStock = !item.returnDocId && item.status !== 'SCRAPPED' && item.status !== 'SENT_TO_SUPPLIER' && item.status !== 'COMPLETED' && item.status !== 'SUPPLIER_REPLACED';

      if (!existing) {
        map.set(key, {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          category: item.category,
          supplierId: item.supplierId,
          supplierName: item.supplierName,
          unitName: item.unitName,
          costPrice: item.costPrice,
          unitPrice: item.unitPrice,
          totalPieces: item.quantity,
          inStockPieces: isInStock ? item.quantity : 0,
          totalCostValue: item.totalCostValue,
          inStockCostValue: isInStock ? item.totalCostValue : 0,
          totalClaimValue: item.totalClaimValue,
          latestClaimDate: item.claimDate,
          claims: [item],
        });
      } else {
        existing.totalPieces += item.quantity;
        if (isInStock) {
          existing.inStockPieces += item.quantity;
          existing.inStockCostValue += item.totalCostValue;
        }
        existing.totalCostValue += item.totalCostValue;
        existing.totalClaimValue += item.totalClaimValue;
        if (new Date(item.claimDate) > new Date(existing.latestClaimDate)) {
          existing.latestClaimDate = item.claimDate;
        }
        existing.claims.push(item);
      }
    });

    return Array.from(map.values()).sort((a, b) => b.inStockCostValue - a.inStockCostValue);
  }, [filteredClaims]);

  // Aggregate by Supplier
  const supplierSummaries = useMemo(() => {
    const map = new Map<string, SupplierClaimSummary>();

    productSummaries.forEach((p) => {
      const suppId = p.supplierId || 'UNKNOWN';
      const existing = map.get(suppId);

      const suppInfo = suppliersList.find((s) => s.id === suppId);

      if (!existing) {
        map.set(suppId, {
          supplierId: suppId,
          supplierName: p.supplierName,
          supplierPhone: suppInfo?.phone,
          productCount: 1,
          totalPieces: p.totalPieces,
          inStockPieces: p.inStockPieces,
          totalCostValue: p.totalCostValue,
          inStockCostValue: p.inStockCostValue,
          totalClaimValue: p.totalClaimValue,
          latestClaimDate: p.latestClaimDate,
          products: [p],
        });
      } else {
        existing.productCount += 1;
        existing.totalPieces += p.totalPieces;
        existing.inStockPieces += p.inStockPieces;
        existing.totalCostValue += p.totalCostValue;
        existing.inStockCostValue += p.inStockCostValue;
        existing.totalClaimValue += p.totalClaimValue;
        if (new Date(p.latestClaimDate) > new Date(existing.latestClaimDate)) {
          existing.latestClaimDate = p.latestClaimDate;
        }
        existing.products.push(p);
      }
    });

    return Array.from(map.values()).sort((a, b) => b.inStockCostValue - a.inStockCostValue);
  }, [productSummaries, suppliersList]);

  // Overall Statistics for KPI Cards (Filtered scope)
  const stats = useMemo(() => {
    const inStockClaims = claimItems.filter(
      (c) => !c.returnDocId && c.status !== 'SCRAPPED' && c.status !== 'SENT_TO_SUPPLIER' && c.status !== 'COMPLETED' && c.status !== 'SUPPLIER_REPLACED'
    );

    const totalUniqueInStockProducts = new Set(inStockClaims.map((c) => `${c.productId}_${c.sku}`)).size;
    const totalInStockPieces = inStockClaims.reduce((s, c) => s + c.quantity, 0);
    const totalInStockCost = inStockClaims.reduce((s, c) => s + c.totalCostValue, 0);

    const distinctSuppliers = new Set(inStockClaims.map((c) => c.supplierId));

    return {
      uniqueProducts: totalUniqueInStockProducts,
      pieces: totalInStockPieces,
      costValue: totalInStockCost,
      suppliersCount: distinctSuppliers.size,
    };
  }, [claimItems]);

  // Unique categories list for filter dropdown
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    claimItems.forEach((c) => {
      if (c.category) set.add(c.category);
    });
    return Array.from(set);
  }, [claimItems]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedSupplierId, statusFilter, categoryFilter, activeTab]);

  // Paginated Products
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return productSummaries.slice(start, start + pageSize);
  }, [productSummaries, currentPage, pageSize]);

  const totalProductPages = Math.ceil(productSummaries.length / pageSize) || 1;

  // Open Product Claim Detail Modal
  const handleOpenProductDetail = (p: ProductClaimSummary) => {
    setSelectedProductForModal(p);
    setIsDetailModalOpen(true);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-3 sm:p-4 lg:p-5 font-sans">
      {/* ─── PAGE HEADER (Standard Consistent Header) ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <PackageX className="w-5 h-5 sm:w-6 sm:h-6 text-rose-600 shrink-0" />
            <span>สต๊อกของเคลม (Claim Stock Inventory)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ตรวจสอบจำนวนสินค้าและมูลค่าของเคลมคงคลัง แยกดูตามบริษัทผู้จำหน่ายเพื่อเตรียมส่งคืนหรือลดหนี้
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-8 px-3 text-xs sm:text-sm font-semibold shadow-2xs"
            title="รีเฟรชข้อมูลสต๊อกของเคลม"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>

          <Link href="/supplier-returns">
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm h-8 px-3.5 rounded-lg shadow-2xs gap-1.5"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>ส่งเคลม & ใบลดหนี้บริษัท</span>
            </Button>
          </Link>

          <Link href="/claims">
            <Button
              variant="outline"
              size="sm"
              className="border-rose-200 text-rose-700 hover:bg-rose-50 h-8 px-3 text-xs sm:text-sm font-bold shadow-2xs gap-1.5"
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
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-rose-600 tracking-tight">
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
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-amber-700 tracking-tight">
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
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-indigo-700 tracking-tight">
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
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">
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
              className="pl-9 h-9 bg-slate-50 border-slate-200 focus:bg-white text-xs sm:text-sm font-medium rounded-lg"
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
                className="h-9 px-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-800 max-w-[220px] truncate outline-none focus:border-indigo-500 shadow-2xs"
              >
                <option value="ALL">🏢 ทุกผู้จำหน่าย ({suppliersList.length} บริษัท)</option>
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
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-9 px-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:border-indigo-500 shadow-2xs"
              >
                <option value="IN_STOCK">📦 ของเคลมรอส่งคืน (ในสต็อก)</option>
                <option value="RETURNED">🚚 ส่งคืนบริษัทแล้ว</option>
                <option value="ALL">📋 ทั้งหมด</option>
              </select>
            </div>

            {/* Category Filter */}
            {categoryOptions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-bold text-slate-600 shrink-0">หมวดหมู่:</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-9 px-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:border-indigo-500 shadow-2xs"
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
              กำลังกรอง: พบ {productSummaries.length} สินค้า ({filteredClaims.length} รายการเคลม)
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
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 pb-2">
          <TabsList className="bg-slate-100 p-1 rounded-xl h-auto">
            <TabsTrigger
              value="products"
              className="text-xs sm:text-sm font-bold data-[state=active]:bg-white data-[state=active]:text-indigo-900 rounded-lg px-3 py-1.5 gap-1.5"
            >
              <Boxes className="w-4 h-4" />
              <span>สรุปรายสินค้าเคลม ({productSummaries.length})</span>
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
              <span>ประวัติใบเคลมย่อย ({filteredClaims.length})</span>
            </TabsTrigger>
          </TabsList>

          <span className="text-xs font-bold text-slate-500 font-mono">
            แสดง {productSummaries.length} สินค้าเคลม
          </span>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════════
            TAB 1: PRODUCT SUMMARY TABLE (Main View)
        ══════════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="products" className="m-0 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">
                      ลำดับ
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-36 text-slate-700 font-bold text-sm">
                      บาร์โค้ด / SKU
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left text-slate-700 font-bold text-sm">
                      ชื่อสินค้าเคลม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-28 text-slate-700 font-bold text-sm">
                      หมวดหมู่
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-52 text-slate-700 font-bold text-sm">
                      บริษัทผู้จำหน่าย
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">
                      จำนวนของเคลม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">
                      ทุน/หน่วย
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">
                      มูลค่าทุนรวม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm">
                      รับเคลมล่าสุด
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm whitespace-nowrap">
                      การจัดการ
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-sm">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                        กำลังโหลดข้อมูลสต๊อกของเคลม...
                      </TableCell>
                    </TableRow>
                  ) : paginatedProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-14 text-slate-400 text-sm">
                        <div className="flex flex-col items-center gap-2">
                          <PackageX className="w-10 h-10 text-slate-300" />
                          <span className="font-bold text-slate-600 text-base">ไม่พบสินค้าในสต๊อกของเคลม</span>
                          <span className="text-xs text-slate-400">
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
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                            {(currentPage - 1) * pageSize + idx + 1}
                          </td>

                          {/* 2. Barcode / SKU */}
                          <td className="py-3.5 px-3.5 font-mono">
                            <span className="font-bold text-indigo-700 text-[15px] block">
                              {item.sku || '-'}
                            </span>
                          </td>

                          {/* 3. Product Name */}
                          <td className="py-3.5 px-3.5">
                            <span className="font-bold text-slate-900 text-[15px] block">
                              {item.productName}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-500 font-mono">
                                รวม {item.claims.length} ใบเคลม
                              </span>
                              {item.inStockPieces > 0 && item.inStockPieces < item.totalPieces && (
                                <span className="text-[11px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                  รอส่ง {item.inStockPieces} / ส่งแล้ว {item.totalPieces - item.inStockPieces}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 4. Category */}
                          <td className="py-3.5 px-3.5 text-center">
                            <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-300 font-medium text-xs">
                              {item.category}
                            </Badge>
                          </td>

                          {/* 5. Supplier */}
                          <td className="py-3.5 px-3.5">
                            <div className="font-bold text-slate-800 text-[15px] flex items-center gap-1.5">
                              <Truck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span className="truncate max-w-[200px]">{item.supplierName}</span>
                            </div>
                          </td>

                          {/* 6. Quantity of Claim Pieces */}
                          <td className="py-3.5 px-3.5 text-right font-mono">
                            <span className="text-[15px] sm:text-base font-black text-rose-600 block">
                              {displayQty} <span className="text-xs font-bold text-slate-500 font-sans">{item.unitName}</span>
                            </span>
                          </td>

                          {/* 7. Cost per Unit */}
                          <td className="py-3.5 px-3.5 text-right font-mono text-slate-700 text-sm sm:text-[15px]">
                            {formatCurrency(item.costPrice)}
                          </td>

                          {/* 8. Total Cost Value */}
                          <td className="py-3.5 px-3.5 text-right font-mono">
                            <span className="font-black text-[15px] sm:text-base text-slate-900 block">
                              {formatCurrency(displayCost)}
                            </span>
                          </td>

                          {/* 9. Latest Claim Date (แยก col. วันที่) */}
                          <td className="py-3.5 px-3.5 text-center font-mono text-xs text-slate-600">
                            {formatDate(item.latestClaimDate)}
                          </td>

                          {/* 10. Actions */}
                          <td className="py-3.5 px-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenProductDetail(item)}
                                className="h-8 px-2.5 border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-lg shadow-2xs gap-1"
                                title="ดูประวัติใบเคลมทั้งหมดของสินค้านี้"
                              >
                                <Eye className="w-3.5 h-3.5 text-indigo-600" />
                                <span>ดูใบเคลม ({item.claims.length})</span>
                              </Button>

                              <Link href="/supplier-returns">
                                <Button
                                  size="sm"
                                  className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-2xs gap-1"
                                  title="ไปสร้างใบส่งคืนบริษัทผู้จำหน่าย"
                                >
                                  <ArrowLeftRight className="w-3.5 h-3.5" />
                                  <span>ส่งคืน</span>
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
            {productSummaries.length > pageSize && (
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50/70 border-t border-slate-200 text-xs">
                <div className="text-slate-500 font-medium">
                  แสดงหน้า {currentPage} จากทั้งหมด {totalProductPages} หน้า (รวม {productSummaries.length} สินค้า)
                </div>

                <div className="flex items-center gap-1">
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
                  <span className="px-2 font-mono font-bold text-slate-700">
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
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">
                      ลำดับ
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left text-slate-700 font-bold text-sm">
                      บริษัทผู้จำหน่าย
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm">
                      จำนวนรายการสินค้า
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-40 text-slate-700 font-bold text-sm">
                      จำนวนชิ้นเคลมรวม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-48 text-slate-700 font-bold text-sm">
                      มูลค่าต้นทุนรวม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm">
                      รับเคลมล่าสุด
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-52 text-slate-700 font-bold text-sm whitespace-nowrap">
                      การจัดการ
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {supplierSummaries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-sm">
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
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                            {idx + 1}
                          </td>

                          {/* 2. Supplier Name & Phone */}
                          <td className="py-3.5 px-3.5">
                            <div className="font-bold text-slate-900 text-[15px] flex items-center gap-1.5">
                              <Truck className="w-4 h-4 text-indigo-600 shrink-0" />
                              <span>{supp.supplierName}</span>
                            </div>
                            {supp.supplierPhone && (
                              <span className="text-xs text-slate-500 font-mono mt-0.5 block">
                                โทร: {supp.supplierPhone}
                              </span>
                            )}
                          </td>

                          {/* 3. Product Count */}
                          <td className="py-3.5 px-3.5 text-center font-mono font-bold text-[15px] text-slate-800">
                            {supp.productCount} รายการ
                          </td>

                          {/* 4. Total Pieces */}
                          <td className="py-3.5 px-3.5 text-right font-mono">
                            <span className="text-[15px] sm:text-base font-black text-rose-600 block">
                              {displayQty} <span className="text-xs font-bold text-slate-500 font-sans">ชิ้น</span>
                            </span>
                          </td>

                          {/* 5. Total Cost Value */}
                          <td className="py-3.5 px-3.5 text-right font-mono">
                            <span className="font-black text-[15px] sm:text-base text-slate-900 block">
                              {formatCurrency(displayCost)}
                            </span>
                          </td>

                          {/* 6. Latest Claim Date (แยก col. วันที่) */}
                          <td className="py-3.5 px-3.5 text-center font-mono text-xs text-slate-600">
                            {formatDate(supp.latestClaimDate)}
                          </td>

                          {/* 7. Actions */}
                          <td className="py-3.5 px-3.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedSupplierId(supp.supplierId);
                                  setActiveTab('products');
                                }}
                                className="h-8 px-2.5 border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-lg shadow-2xs gap-1"
                              >
                                <span>ดู {supp.productCount} สินค้า</span>
                              </Button>

                              <Link href="/supplier-returns">
                                <Button
                                  size="sm"
                                  className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-2xs gap-1"
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
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-3.5 px-3.5 text-center w-16 text-slate-700 font-bold text-sm">
                      ลำดับ
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-36 text-slate-700 font-bold text-sm">
                      เลขที่เคลม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm">
                      วันที่รับเคลม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left text-slate-700 font-bold text-sm">
                      สินค้าเคลม
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-left w-48 text-slate-700 font-bold text-sm">
                      ผู้จำหน่าย
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-32 text-slate-700 font-bold text-sm">
                      จำนวน
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-right w-36 text-slate-700 font-bold text-sm">
                      มูลค่าทุน
                    </TableHead>
                    <TableHead className="py-3.5 px-3.5 text-center w-36 text-slate-700 font-bold text-sm">
                      สถานะส่งคืน
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {filteredClaims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                        ไม่พบรายการใบเคลมตามเงื่อนไข
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClaims.map((claim, idx) => (
                      <tr key={claim.id} className="hover:bg-slate-50/70 transition-colors">
                        {/* 1. Sequence */}
                        <td className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                          {idx + 1}
                        </td>

                        {/* 2. Claim Ticket ID */}
                        <td className="py-3.5 px-3.5 font-mono">
                          <span className="font-bold text-indigo-700 text-[15px] block">
                            {claim.claimId}
                          </span>
                          {claim.orderNumber && (
                            <span className="text-xs text-slate-400 block font-mono">
                              บิล: {claim.orderNumber}
                            </span>
                          )}
                        </td>

                        {/* 3. Claim Date (แยก col. วันที่) */}
                        <td className="py-3.5 px-3.5 text-center font-mono text-xs text-slate-600">
                          {formatDate(claim.claimDate)}
                        </td>

                        {/* 4. Product Name & Defect */}
                        <td className="py-3.5 px-3.5">
                          <p className="font-bold text-slate-900 text-[15px]">{claim.productName}</p>
                          <p className="text-xs text-rose-600 font-medium mt-0.5">
                            อาการ: {claim.defectReason}
                          </p>
                        </td>

                        {/* 5. Supplier */}
                        <td className="py-3.5 px-3.5">
                          <span className="font-bold text-slate-800 text-sm block">
                            {claim.supplierName}
                          </span>
                        </td>

                        {/* 6. Quantity */}
                        <td className="py-3.5 px-3.5 text-right font-mono">
                          <span className="font-black text-rose-600 text-[15px] block">
                            {claim.quantity} <span className="text-xs font-bold text-slate-500 font-sans">{claim.unitName}</span>
                          </span>
                        </td>

                        {/* 7. Cost Value */}
                        <td className="py-3.5 px-3.5 text-right font-mono font-black text-slate-900 text-[15px]">
                          {formatCurrency(claim.totalCostValue)}
                        </td>

                        {/* 8. Status Badge */}
                        <td className="py-3.5 px-3.5 text-center">
                          {claim.returnDocId ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs font-bold px-2 py-0.5">
                              ✓ ส่งคืนใน {claim.returnDocId}
                            </Badge>
                          ) : claim.status === 'SCRAPPED' ? (
                            <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-300 text-xs font-bold px-2 py-0.5">
                              ตัดจำหน่าย
                            </Badge>
                          ) : (
                            <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-xs font-bold px-2 py-0.5">
                              📦 รอส่งคืนบริษัท
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
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
                  <span className="font-mono font-bold text-slate-900 text-sm">
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
                  <span className="font-mono font-black text-rose-600 text-sm">
                    {selectedProductForModal.totalPieces} {selectedProductForModal.unitName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">มูลค่าทุนรวม:</span>
                  <span className="font-mono font-black text-slate-900 text-sm">
                    {formatCurrency(selectedProductForModal.totalCostValue)}
                  </span>
                </div>
              </div>

              {/* Claims Breakdown Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-50 border-b border-slate-200 text-xs">
                    <TableRow>
                      <TableHead className="w-12 text-center font-bold">ลำดับ</TableHead>
                      <TableHead className="w-32 font-bold">เลขที่เคลม</TableHead>
                      <TableHead className="w-28 text-center font-bold">วันที่</TableHead>
                      <TableHead className="font-bold">อาการชำรุด</TableHead>
                      <TableHead className="w-24 text-right font-bold">จำนวน</TableHead>
                      <TableHead className="w-28 text-right font-bold">มูลค่าทุน</TableHead>
                      <TableHead className="w-28 text-center font-bold">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100 text-xs">
                    {selectedProductForModal.claims.map((c, i) => (
                      <TableRow key={c.id}>
                        <td className="py-2.5 px-3 text-center font-mono text-slate-500 font-bold">
                          {i + 1}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">
                          {c.claimId}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                          {formatDate(c.claimDate)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          {c.defectReason}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                          {c.quantity} {c.unitName}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(c.totalCostValue)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {c.returnDocId ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10.5px] font-bold">
                              ส่งคืนแล้ว
                            </Badge>
                          ) : (
                            <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10.5px] font-bold">
                              ในสต็อกเคลม
                            </Badge>
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
                  className="font-bold text-xs"
                >
                  ปิดหน้าต่าง
                </Button>
                <Link href="/supplier-returns">
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5"
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
