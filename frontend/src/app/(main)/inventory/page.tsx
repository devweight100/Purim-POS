'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { categories } from '@/lib/mock-data';
import { useProductStore } from '@/lib/store/product-store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  Plus,
  Filter,
  AlertTriangle,
  Package,
  ArrowDownRight,
  ArrowUpRight,
  RotateCcw,
  SlidersHorizontal,
  History,
  DollarSign,
  TrendingDown,
  TrendingUp,
  PackageCheck,
  PackageX,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowRight,
  ShoppingCart,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
} from 'lucide-react';
import {
  StockMovement,
  loadStockMovements,
  adjustSingleProductStock,
} from '@/lib/stock-service';
import { toast } from 'sonner';

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'normal' | 'low' | 'out' | 'negative'>('all');
  const [activeTab, setActiveTab] = useState<'inventory' | 'movements' | 'reorder'>('inventory');

  // Pagination for Inventory Table
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(10);

  // Movements filtering & pagination
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');
  const [movementDateFilter, setMovementDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [movementPage, setMovementPage] = useState(1);
  const [movementPageSize, setMovementPageSize] = useState(10);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  // Adjustment Modal State
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [targetProduct, setTargetProduct] = useState<any | null>(null);
  const [adjustType, setAdjustType] = useState<'ADD' | 'SUB' | 'SET'>('ADD');
  const [adjustAmount, setAdjustAmount] = useState<number | string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [adjustCustomReason, setAdjustCustomReason] = useState<string>('');

  // Single Product Stock Card Modal
  const [isStockCardOpen, setIsStockCardOpen] = useState(false);
  const [stockCardProduct, setStockCardProduct] = useState<any | null>(null);

  const { products, fetchProducts, isLoading } = useProductStore();

  const reloadData = async () => {
    await fetchProducts();
    setMovements(loadStockMovements());
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setInventoryPage(1);
  }, [search, activeCategory, stockStatusFilter, inventoryPageSize]);

  useEffect(() => {
    setMovementPage(1);
  }, [movementSearch, movementTypeFilter, movementDateFilter, movementPageSize]);

  const getCategoryName = (id: string) => categories.find((c) => c.id === id)?.name || 'ไม่ระบุ';

  // Load custom packaging from localStorage
  const allPackaging: Record<string, any[]> = useMemo(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem('product_packaging_units');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  // Format stock breakdown into packaging units (e.g. 10 ลัง 5 ชิ้น)
  const formatPackagingBreakdown = (prod: any) => {
    const stock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
    const baseUnit = prod.unit || 'ชิ้น';
    const pkgList = allPackaging[prod.id] || prod.units || [];

    if (stock < 0) {
      return `ติดลบ ${Math.abs(stock).toLocaleString()} ${baseUnit}`;
    }

    if (!pkgList || pkgList.length === 0) {
      return `${stock.toLocaleString()} ${baseUnit}`;
    }

    // Sort packaging descending by multiplier
    const sorted = [...pkgList]
      .map((u: any) => ({
        name: u.name || u.unitName,
        multiplier: Number(u.multiplier || u.factor || u.qtyPerPrev || 1),
      }))
      .filter((u) => u.multiplier > 1)
      .sort((a, b) => b.multiplier - a.multiplier);

    if (sorted.length === 0) {
      return `${stock.toLocaleString()} ${baseUnit}`;
    }

    let remaining = stock;
    const parts: string[] = [];

    for (const p of sorted) {
      if (remaining >= p.multiplier) {
        const count = Math.floor(remaining / p.multiplier);
        parts.push(`${count.toLocaleString()} ${p.name}`);
        remaining = remaining % p.multiplier;
      }
    }

    if (remaining > 0 || parts.length === 0) {
      parts.push(`${remaining.toLocaleString()} ${baseUnit}`);
    }

    return parts.join(' ');
  };

  // Inventory stats summary
  const stats = useMemo(() => {
    let totalItems = products.length;
    let totalBaseUnits = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let negativeStockCount = 0;

    products.forEach((p: any) => {
      const stock = Number(p.stock !== undefined && p.stock !== null ? p.stock : 0);
      const cost = Number(p.basePrice || p.cost || p.price || 0);
      const minAlert = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10;

      totalBaseUnits += stock;
      totalValuation += Math.max(0, stock) * cost;

      if (stock < 0) {
        negativeStockCount++;
      } else if (stock === 0) {
        outOfStockCount++;
      } else if (stock <= minAlert) {
        lowStockCount++;
      }
    });

    return {
      totalItems,
      totalBaseUnits,
      totalValuation,
      lowStockCount,
      outOfStockCount,
      negativeStockCount,
    };
  }, [products]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((p: any) => {
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.sku && p.sku.toLowerCase().includes(search.toLowerCase())) ||
        (p.barcodes && p.barcodes.some((b: any) => b.barcode && b.barcode.toLowerCase().includes(search.toLowerCase())));

      const matchCategory = activeCategory === 'all' || p.categoryId === activeCategory;

      const stock = Number(p.stock !== undefined && p.stock !== null ? p.stock : 0);
      const minAlert = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10;

      let matchStatus = true;
      if (stockStatusFilter === 'negative') matchStatus = stock < 0;
      else if (stockStatusFilter === 'normal') matchStatus = stock > minAlert;
      else if (stockStatusFilter === 'low') matchStatus = stock > 0 && stock <= minAlert;
      else if (stockStatusFilter === 'out') matchStatus = stock === 0;

      return matchSearch && matchCategory && matchStatus;
    });
  }, [products, search, activeCategory, stockStatusFilter]);

  // Paginated Products
  const totalInventoryPages = Math.max(1, Math.ceil(filteredProducts.length / inventoryPageSize));
  const paginatedProducts = useMemo(() => {
    const start = (inventoryPage - 1) * inventoryPageSize;
    return filteredProducts.slice(start, start + inventoryPageSize);
  }, [filteredProducts, inventoryPage, inventoryPageSize]);

  // Filtered Movements
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      const matchSearch =
        m.productName.toLowerCase().includes(movementSearch.toLowerCase()) ||
        m.sku.toLowerCase().includes(movementSearch.toLowerCase()) ||
        (m.referenceNo && m.referenceNo.toLowerCase().includes(movementSearch.toLowerCase())) ||
        (m.reason && m.reason.toLowerCase().includes(movementSearch.toLowerCase()));

      const matchType = movementTypeFilter === 'all' || m.type === movementTypeFilter;

      let matchDate = true;
      if (movementDateFilter !== 'all') {
        const moveTime = new Date(m.createdAt).getTime();
        const now = Date.now();
        if (movementDateFilter === 'today') {
          const todayStart = new Date().setHours(0, 0, 0, 0);
          matchDate = moveTime >= todayStart;
        } else if (movementDateFilter === '7days') {
          matchDate = now - moveTime <= 7 * 24 * 60 * 60 * 1000;
        } else if (movementDateFilter === '30days') {
          matchDate = now - moveTime <= 30 * 24 * 60 * 60 * 1000;
        }
      }

      return matchSearch && matchType && matchDate;
    });
  }, [movements, movementSearch, movementTypeFilter, movementDateFilter]);

  // Paginated Movements
  const totalMovementPages = Math.max(1, Math.ceil(filteredMovements.length / movementPageSize));
  const paginatedMovements = useMemo(() => {
    const start = (movementPage - 1) * movementPageSize;
    return filteredMovements.slice(start, start + movementPageSize);
  }, [filteredMovements, movementPage, movementPageSize]);

  // Handle Opening Adjustment Modal
  const openAdjustDialog = (prod: any = null) => {
    setTargetProduct(prod || products[0] || null);
    setAdjustType('ADD');
    setAdjustAmount('');
    setAdjustReason('ตรวจนับพบสินค้าเกิน');
    setAdjustCustomReason('');
    setIsAdjustModalOpen(true);
  };

  // Handle Opening Stock Card Modal
  const openStockCardDialog = (prod: any) => {
    setStockCardProduct(prod);
    setIsStockCardOpen(true);
  };

  // Submit Stock Adjustment
  const handleSaveAdjustment = () => {
    if (!targetProduct) {
      toast.error('กรุณาเลือกสินค้าที่ต้องการปรับสต็อก');
      return;
    }

    const numAmount = Number(adjustAmount);
    if (isNaN(numAmount) || numAmount < 0) {
      toast.error('กรุณากรอกจำนวนตัวเลขที่ถูกต้อง');
      return;
    }

    const finalReason =
      adjustReason === 'other' ? adjustCustomReason.trim() || 'ปรับยอดสต็อก' : adjustReason;

    const res = adjustSingleProductStock({
      productId: targetProduct.id || targetProduct.sku,
      type: adjustType,
      amount: numAmount,
      reason: finalReason,
      userName: 'ผู้ดูแลระบบ',
    });

    if (res.success) {
      toast.success(
        `ปรับสต็อก ${targetProduct.name} เรียบร้อย: ${res.previousStock} ➔ ${res.newStock} (${res.delta >= 0 ? '+' : ''}${res.delta} ${targetProduct.unit || 'ชิ้น'})`
      );
      setIsAdjustModalOpen(false);
      reloadData();
    } else {
      toast.error('ไม่สามารถปรับสต็อกสินค้าได้');
    }
  };

  // Helper for Movement Badge
  const getMovementBadge = (type: string) => {
    switch (type) {
      case 'IN_PO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" /> รับเข้าจาก PO
          </span>
        );
      case 'OUT_POS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300">
            <ArrowUpRight className="w-3.5 h-3.5 text-sky-600" /> ขายออกหน้าร้าน (POS)
          </span>
        );
      case 'IN_VOID':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <RotateCcw className="w-3.5 h-3.5 text-purple-600" /> คืนสต็อก (ยกเลิกบิล)
          </span>
        );
      case 'ADJUST_ADD':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-600" /> ปรับยอดเพิ่ม (+)
          </span>
        );
      case 'ADJUST_SUB':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <TrendingDown className="w-3.5 h-3.5 text-amber-600" /> ปรับยอดยกออก (-)
          </span>
        );
      case 'ADJUST_SET':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" /> ตรวจนับสต็อกจริง (=)
          </span>
        );
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      {/* Sleek Compact Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <Package className="w-6 h-6 text-sky-500" /> คลังสินค้าและความเคลื่อนไหวสต็อก (Inventory)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ตรวจเช็กสต็อกสินค้า บันทึกประวัติสต็อกการ์ด และปรับยอดสต็อก
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={reloadData}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-9 px-3 text-xs font-semibold shadow-2xs"
            title="รีเฟรชข้อมูลสต็อก"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> รีเฟรช
          </Button>
          <Button
            size="sm"
            onClick={() => openAdjustDialog()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-9 px-3.5 text-xs shadow-2xs"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
            ปรับยอดสต็อก
          </Button>
          <Link href="/purchase-orders">
            <Button size="sm" className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-9 px-3.5 text-xs shadow-2xs">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              สั่งซื้อ (PO)
            </Button>
          </Link>
        </div>
      </div>

      {/* Compact 1-Row Combined Bar: Sleek Segmented Tabs + Mini Summary Stats */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 bg-white p-2 sm:px-3 sm:py-2 rounded-xl border border-slate-200 shadow-2xs">
        {/* Sleek Segmented Pill Tabs */}
        <div className="flex flex-wrap gap-1 bg-slate-100/90 p-1 rounded-lg border border-slate-200/80">
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'inventory'
                ? 'bg-white text-sky-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>ภาพรวมสต็อกสินค้า ({filteredProducts.length.toLocaleString()})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('movements')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'movements'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>ประวัติสต็อกการ์ด ({movements.length.toLocaleString()})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reorder')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'reorder'
                ? 'bg-white text-amber-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>สินค้าใกล้หมด ({(stats.lowStockCount + stats.outOfStockCount).toLocaleString()})</span>
          </button>
        </div>

        {/* Compact Summary Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
            <span className="text-slate-400 mr-1.5">มูลค่าทุนรวม:</span>
            <b className="font-bold text-slate-900">{formatCurrency(stats.totalValuation)}</b>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
            <span className="text-slate-400 mr-1.5">สต็อกรวม:</span>
            <b className="font-bold text-slate-900">{stats.totalBaseUnits.toLocaleString()} หน่วย</b>
          </div>
          {stats.negativeStockCount > 0 && (
            <div className="px-2.5 py-1 rounded-lg bg-rose-100 border border-rose-300 text-rose-800 font-extrabold flex items-center gap-1 shadow-2xs">
              <span>🔻</span> สต็อกติดลบ: {stats.negativeStockCount}
            </div>
          )}
          {stats.lowStockCount > 0 && (
            <div className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold">
              ⚠️ ใกล้หมด: {stats.lowStockCount}
            </div>
          )}
          {stats.outOfStockCount > 0 && (
            <div className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-bold">
              🚫 หมด: {stats.outOfStockCount}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area based on Active Tab */}
      {activeTab === 'inventory' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          {/* Toolbar */}
          <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row gap-3 items-center justify-between">
            <div className="flex flex-1 flex-col sm:flex-row gap-2.5 w-full lg:max-w-2xl">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="ค้นหาชื่อสินค้า, SKU, บาร์โค้ด..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 bg-white border-slate-300 h-9 text-sm"
                />
              </div>
              <select
                value={activeCategory}
                onChange={(e) => setActiveCategory(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-sky-500 shadow-2xs"
              >
                <option value="all">หมวดหมู่ทั้งหมด</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter buttons */}
            <div className="flex gap-1.5 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
              {[
                { value: 'all', label: 'ทั้งหมด' },
                ...(stats.negativeStockCount > 0
                  ? [{ value: 'negative', label: `🔻 ติดลบ (${stats.negativeStockCount})` }]
                  : []),
                { value: 'normal', label: 'สต็อกปกติ' },
                { value: 'low', label: '⚠️ ใกล้หมด' },
                { value: 'out', label: '🚫 หมด' },
              ].map((st) => (
                <Button
                  key={st.value}
                  variant={stockStatusFilter === st.value ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setStockStatusFilter(st.value as any)}
                  className={`h-8 px-3 text-xs font-bold rounded-lg transition-all ${
                    stockStatusFilter === st.value
                      ? st.value === 'negative'
                        ? 'bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs'
                        : 'bg-sky-50 text-sky-700 border border-sky-300 shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  {st.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Inventory Table - Responsive, Full Width with No Horizontal Scroll on standard viewports */}
          <div className="w-full">
            <Table className="w-full">
              <TableHeader className="bg-slate-50/90 border-b border-slate-200">
                <TableRow>
                  <TableHead className="w-[30%] text-slate-600 font-bold text-xs uppercase tracking-wide">
                    ชื่อสินค้า / รหัส (SKU)
                  </TableHead>
                  <TableHead className="w-[12%] text-slate-600 font-bold text-xs uppercase tracking-wide">
                    หมวดหมู่
                  </TableHead>
                  <TableHead className="w-[12%] text-right text-slate-600 font-bold text-xs uppercase tracking-wide">
                    ต้นทุน / หน่วย
                  </TableHead>
                  <TableHead className="w-[15%] text-right text-slate-600 font-bold text-xs uppercase tracking-wide">
                    สต็อกคงเหลือ (หน่วยฐาน)
                  </TableHead>
                  <TableHead className="w-[15%] text-slate-600 font-bold text-xs uppercase tracking-wide">
                    สรุปตามขนาดบรรจุ
                  </TableHead>
                  <TableHead className="w-[8%] text-center text-slate-600 font-bold text-xs uppercase tracking-wide">
                    สถานะ
                  </TableHead>
                  <TableHead className="w-[8%] text-center text-slate-600 font-bold text-xs uppercase tracking-wide">
                    จัดการ
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-48 text-slate-500">
                      กำลังโหลดข้อมูลคลังสินค้า...
                    </TableCell>
                  </TableRow>
                ) : paginatedProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-48 text-slate-400">
                      ไม่พบข้อมูลสินค้าที่ตรงกับเงื่อนไขการค้นหา
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedProducts.map((p: any) => {
                    const stock = Number(p.stock !== undefined && p.stock !== null ? p.stock : 0);
                    const minAlert = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10;
                    const isNegative = stock < 0;
                    const isLow = stock > 0 && stock <= minAlert;
                    const isOut = stock === 0;

                    return (
                      <TableRow key={p.id} className="hover:bg-slate-50/80 border-slate-100 transition-colors">
                        {/* Product Info */}
                        <TableCell className="py-3.5">
                          <div className="space-y-0.5">
                            <span className="font-bold text-slate-900 text-sm block hover:text-sky-600 transition-colors">
                              {p.name}
                            </span>
                            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                              <span>SKU: {p.sku || '-'}</span>
                              {p.barcodes && p.barcodes.length > 0 && (
                                <>
                                  <span>•</span>
                                  <span>บาร์โค้ด: {p.barcodes[0]?.barcode}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Category */}
                        <TableCell className="py-3.5">
                          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-xs font-semibold">
                            {getCategoryName(p.categoryId)}
                          </Badge>
                        </TableCell>

                        {/* Cost */}
                        <TableCell className="py-3.5 text-right font-semibold text-slate-700 text-sm">
                          {formatCurrency(p.basePrice || p.cost || 0)}
                        </TableCell>

                        {/* Stock Base Units */}
                        <TableCell className="py-3.5 text-right">
                          {isNegative ? (
                            <span className="inline-flex items-center gap-1 font-extrabold text-base text-rose-600 bg-rose-50 px-2.5 py-0.5 rounded-lg border border-rose-200 shadow-2xs">
                              <span className="text-xs">🔻</span>
                              {stock.toLocaleString()}{' '}
                              <span className="text-xs font-normal text-rose-500">
                                {p.unit || 'ชิ้น'}
                              </span>
                            </span>
                          ) : (
                            <span
                              className={`font-extrabold text-base ${
                                isOut
                                  ? 'text-rose-600'
                                  : isLow
                                  ? 'text-amber-600'
                                  : 'text-slate-900'
                              }`}
                            >
                              {stock.toLocaleString()}{' '}
                              <span className="text-xs font-medium text-slate-500">
                                {p.unit || 'ชิ้น'}
                              </span>
                            </span>
                          )}
                        </TableCell>

                        {/* Packaging Breakdown */}
                        <TableCell className={`py-3.5 font-semibold text-xs ${isNegative ? 'text-rose-600 font-bold' : 'text-amber-700'}`}>
                          {isNegative && <span className="mr-1">🔻</span>}
                          {formatPackagingBreakdown(p)}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="py-3.5 text-center">
                          {isNegative ? (
                            <Badge className="bg-rose-600 text-white border-rose-700 text-xs font-bold shadow-2xs">
                              🔻 ติดลบ
                            </Badge>
                          ) : isOut ? (
                            <Badge className="bg-rose-100 text-rose-700 border-rose-200 text-xs font-bold">
                              หมดสต็อก
                            </Badge>
                          ) : isLow ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold">
                              ⚠️ ใกล้หมด
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium">
                              ปกติ
                            </Badge>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="py-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAdjustDialog(p)}
                              className="h-8 text-xs border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 font-bold px-2.5 rounded-lg shadow-2xs"
                              title="ปรับยอดสต็อก"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 mr-1" /> ปรับยอด
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openStockCardDialog(p)}
                              className="h-8 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-2 rounded-lg"
                              title="ดูประวัติสต็อกการ์ด"
                            >
                              <History className="w-3.5 h-3.5" />
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

          {/* Pagination Controls for Inventory Table */}
          <div className="p-3.5 sm:px-6 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* Showing info */}
            <div className="text-xs text-slate-500 font-medium">
              แสดงรายการที่{' '}
              <span className="font-bold text-slate-800">
                {filteredProducts.length === 0 ? 0 : (inventoryPage - 1) * inventoryPageSize + 1}
              </span>{' '}
              -{' '}
              <span className="font-bold text-slate-800">
                {Math.min(inventoryPage * inventoryPageSize, filteredProducts.length)}
              </span>{' '}
              จากทั้งหมด{' '}
              <span className="font-bold text-slate-800">{filteredProducts.length.toLocaleString()}</span> รายการ
            </div>

            {/* Page size select & Navigation buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span>แสดงหน้าละ:</span>
                <select
                  value={inventoryPageSize}
                  onChange={(e) => setInventoryPageSize(Number(e.target.value))}
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 font-bold text-slate-800 outline-none focus:border-sky-500 shadow-2xs"
                >
                  <option value={10}>10 รายการ</option>
                  <option value={20}>20 รายการ</option>
                  <option value={50}>50 รายการ</option>
                  <option value={100}>100 รายการ</option>
                </select>
              </div>

              {/* Page Buttons */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={inventoryPage <= 1}
                  onClick={() => setInventoryPage(1)}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าแรกสุด"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={inventoryPage <= 1}
                  onClick={() => setInventoryPage((p) => Math.max(1, p - 1))}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าก่อนหน้า"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <div className="px-3 text-xs font-bold text-slate-800">
                  หน้า {inventoryPage} / {totalInventoryPages}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={inventoryPage >= totalInventoryPages}
                  onClick={() => setInventoryPage((p) => Math.min(totalInventoryPages, p + 1))}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าถัดไป"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={inventoryPage >= totalInventoryPages}
                  onClick={() => setInventoryPage(totalInventoryPages)}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าสุดท้าย"
                >
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Stock Movement Log / Stock Card Ledger */}
      {activeTab === 'movements' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          {/* Movement Toolbar */}
          <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full lg:max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="ค้นหาชื่อสินค้า, SKU, เลขที่เอกสาร, หมายเหตุ..."
                value={movementSearch}
                onChange={(e) => setMovementSearch(e.target.value)}
                className="pl-10 bg-white border-slate-300 h-9 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2.5 w-full lg:w-auto items-center">
              <select
                value={movementTypeFilter}
                onChange={(e) => setMovementTypeFilter(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 shadow-2xs"
              >
                <option value="all">ประเภทความเคลื่อนไหวทั้งหมด</option>
                <option value="IN_PO">📥 รับเข้าจากใบ PO</option>
                <option value="OUT_POS">📤 ขายออกหน้าร้าน (POS)</option>
                <option value="IN_VOID">🔄 คืนสต็อก (ยกเลิกบิล)</option>
                <option value="ADJUST_ADD">➕ ปรับเพิ่มสต็อก</option>
                <option value="ADJUST_SUB">➖ ปรับลดสต็อก (ชำรุด/หมดอายุ)</option>
                <option value="ADJUST_SET">🎯 ตรวจนับสต็อกจริง</option>
              </select>

              <select
                value={movementDateFilter}
                onChange={(e) => setMovementDateFilter(e.target.value as any)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 shadow-2xs"
              >
                <option value="all">ช่วงเวลาทั้งหมด</option>
                <option value="today">วันนี้</option>
                <option value="7days">7 วันล่าสุด</option>
                <option value="30days">30 วันล่าสุด</option>
              </select>
            </div>
          </div>

          {/* Movement Table */}
          <div className="w-full">
            <Table className="w-full">
              <TableHeader className="bg-slate-50/90 border-b border-slate-200">
                <TableRow>
                  <TableHead className="w-[15%] text-slate-600 font-bold text-xs uppercase">วัน-เวลา</TableHead>
                  <TableHead className="w-[25%] text-slate-600 font-bold text-xs uppercase">สินค้า</TableHead>
                  <TableHead className="w-[15%] text-slate-600 font-bold text-xs uppercase">ประเภท</TableHead>
                  <TableHead className="w-[10%] text-right text-slate-600 font-bold text-xs uppercase">จำนวนที่เปลี่ยน</TableHead>
                  <TableHead className="w-[12%] text-right text-slate-600 font-bold text-xs uppercase">
                    ก่อนหน้า ➔ คงเหลือ
                  </TableHead>
                  <TableHead className="w-[10%] text-slate-600 font-bold text-xs uppercase">เอกสารอ้างอิง</TableHead>
                  <TableHead className="w-[13%] text-slate-600 font-bold text-xs uppercase">หมายเหตุ / ผู้ทำ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedMovements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-48 text-slate-400">
                      ยังไม่มีประวัติความเคลื่อนไหวสต็อกที่ตรงกับเงื่อนไข
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedMovements.map((m) => {
                    const isPositive = m.quantityChange > 0;
                    return (
                      <TableRow key={m.id} className="hover:bg-slate-50 border-slate-100 text-xs">
                        <TableCell className="font-medium text-slate-600 py-3.5">
                          {formatDate(m.createdAt)}
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="font-bold text-slate-900 text-sm">{m.productName}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{m.sku}</div>
                        </TableCell>
                        <TableCell className="py-3.5">{getMovementBadge(m.type)}</TableCell>
                        <TableCell className="py-3.5 text-right font-extrabold text-sm">
                          <span className={isPositive ? 'text-emerald-600' : 'text-rose-600'}>
                            {isPositive ? `+${m.quantityChange.toLocaleString()}` : m.quantityChange.toLocaleString()}{' '}
                            <span className="text-xs font-normal text-slate-500">{m.unitName}</span>
                          </span>
                        </TableCell>
                        <TableCell className="py-3.5 text-right font-medium">
                          <span className="text-slate-500">{m.previousStock}</span> ➔{' '}
                          <b className="text-slate-900 font-bold">{m.currentStock}</b>
                        </TableCell>
                        <TableCell className="py-3.5 font-mono font-semibold text-slate-700">
                          {m.referenceNo || '-'}
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="text-slate-700 font-medium">{m.reason || '-'}</div>
                          <div className="text-[11px] text-slate-400">โดย: {m.userName || 'ระบบ'}</div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls for Movement Table */}
          <div className="p-3.5 sm:px-6 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-500 font-medium">
              แสดงรายการที่{' '}
              <span className="font-bold text-slate-800">
                {filteredMovements.length === 0 ? 0 : (movementPage - 1) * movementPageSize + 1}
              </span>{' '}
              -{' '}
              <span className="font-bold text-slate-800">
                {Math.min(movementPage * movementPageSize, filteredMovements.length)}
              </span>{' '}
              จากทั้งหมด{' '}
              <span className="font-bold text-slate-800">{filteredMovements.length.toLocaleString()}</span> รายการ
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span>แสดงหน้าละ:</span>
                <select
                  value={movementPageSize}
                  onChange={(e) => setMovementPageSize(Number(e.target.value))}
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 font-bold text-slate-800 outline-none focus:border-indigo-500 shadow-2xs"
                >
                  <option value={10}>10 รายการ</option>
                  <option value={20}>20 รายการ</option>
                  <option value={50}>50 รายการ</option>
                  <option value={100}>100 รายการ</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={movementPage <= 1}
                  onClick={() => setMovementPage(1)}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าแรกสุด"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={movementPage <= 1}
                  onClick={() => setMovementPage((p) => Math.max(1, p - 1))}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าก่อนหน้า"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <div className="px-3 text-xs font-bold text-slate-800">
                  หน้า {movementPage} / {totalMovementPages}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={movementPage >= totalMovementPages}
                  onClick={() => setMovementPage((p) => Math.min(totalMovementPages, p + 1))}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าถัดไป"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={movementPage >= totalMovementPages}
                  onClick={() => setMovementPage(totalMovementPages)}
                  className="h-8 w-8 p-0 text-slate-600"
                  title="หน้าสุดท้าย"
                >
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Low Stock & Reorder */}
      {activeTab === 'reorder' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-amber-50/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-sm sm:text-base">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              รายการสินค้าที่ต้องสั่งซื้อเข้าคลังด่วน (สต็อกต่ำกว่าจุดเตือน)
            </div>
            <Link href="/purchase-orders">
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white font-bold h-9 text-xs px-3.5 rounded-xl shadow-2xs">
                <Plus className="w-3.5 h-3.5 mr-1" /> เปิดใบสั่งซื้อ PO ทั้งหมด
              </Button>
            </Link>
          </div>

          <div className="w-full">
            <Table className="w-full">
              <TableHeader className="bg-slate-50/90 border-b border-slate-200">
                <TableRow>
                  <TableHead className="w-[30%] text-slate-600 font-bold text-xs uppercase">ชื่อสินค้า / รหัส (SKU)</TableHead>
                  <TableHead className="w-[15%] text-slate-600 font-bold text-xs uppercase">หมวดหมู่</TableHead>
                  <TableHead className="w-[15%] text-right text-slate-600 font-bold text-xs uppercase">สต็อกคงเหลือ</TableHead>
                  <TableHead className="w-[15%] text-right text-slate-600 font-bold text-xs uppercase">จุดแจ้งเตือน</TableHead>
                  <TableHead className="w-[10%] text-center text-slate-600 font-bold text-xs uppercase">สถานะ</TableHead>
                  <TableHead className="w-[15%] text-center text-slate-600 font-bold text-xs uppercase">ดำเนินการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products
                  .filter((p: any) => {
                    const stock = Number(p.stock !== undefined && p.stock !== null ? p.stock : 0);
                    const minAlert = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10;
                    return stock <= minAlert;
                  })
                  .map((p: any) => {
                    const stock = Number(p.stock !== undefined && p.stock !== null ? p.stock : 0);
                    const minAlert = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10;
                    const isNegative = stock < 0;
                    const isOut = stock === 0;

                    return (
                      <TableRow key={p.id} className="hover:bg-slate-50 border-slate-100">
                        <TableCell className="py-3">
                          <span className="font-bold text-slate-900 text-sm block">{p.name}</span>
                          <span className="text-xs text-slate-400 font-mono">SKU: {p.sku}</span>
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-xs">
                            {getCategoryName(p.categoryId)}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 text-right font-extrabold text-base">
                          {isNegative ? (
                            <span className="inline-flex items-center gap-1 font-extrabold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200">
                              <span className="text-xs">🔻</span> {stock.toLocaleString()} {p.unit || 'ชิ้น'}
                            </span>
                          ) : (
                            <span className={isOut ? 'text-rose-600' : 'text-amber-600'}>
                              {stock.toLocaleString()} {p.unit || 'ชิ้น'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 text-right text-slate-600 font-semibold text-xs">
                          {minAlert.toLocaleString()} {p.unit || 'ชิ้น'}
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          {isNegative ? (
                            <Badge className="bg-rose-600 text-white border-rose-700 text-xs font-bold shadow-2xs">
                              🔻 ติดลบ
                            </Badge>
                          ) : isOut ? (
                            <Badge className="bg-rose-100 text-rose-700 border-rose-200 text-xs font-bold">
                              หมดสต็อก
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold">
                              ⚠️ ใกล้หมด
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          <Link href="/purchase-orders">
                            <Button
                              size="sm"
                              className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-8 text-xs px-3 rounded-lg shadow-2xs"
                            >
                              <ShoppingCart className="w-3.5 h-3.5 mr-1" /> สั่งซื้อเพิ่ม (PO)
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      <Dialog open={isAdjustModalOpen} onOpenChange={setIsAdjustModalOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[540px] max-w-[540px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-indigo-50/70 shrink-0">
            <DialogTitle className="flex items-center gap-2.5 text-xl font-bold text-indigo-900">
              <SlidersHorizontal className="w-6 h-6 text-indigo-600" />
              ปรับยอดสต็อกสินค้า (Stock Adjustment)
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-8 pt-6 pb-10 space-y-5">
            {/* Select Product */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">เลือกสินค้าที่ต้องการปรับสต็อก *</label>
              <select
                value={targetProduct?.id || ''}
                onChange={(e) => {
                  const found = products.find((p: any) => p.id === e.target.value);
                  setTargetProduct(found || null);
                }}
                className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 shadow-2xs"
              >
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    [{p.sku || '-'}] {p.name} (คงเหลือ: {p.stock ?? 0} {p.unit || 'ชิ้น'})
                  </option>
                ))}
              </select>
            </div>

            {/* Current Stock Banner */}
            {targetProduct && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-500 block">สต็อกคงเหลือปัจจุบัน:</span>
                  <b className="text-slate-900 text-lg font-extrabold">
                    {targetProduct.stock ?? 0} {targetProduct.unit || 'ชิ้น'}
                  </b>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block">ต้นทุนฐาน:</span>
                  <b className="text-slate-700 font-bold">{formatCurrency(targetProduct.basePrice || 0)}</b>
                </div>
              </div>
            )}

            {/* Adjustment Type Radios */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">ประเภทการปรับสต็อก *</label>
              <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setAdjustType('ADD');
                    setAdjustReason('ตรวจนับพบสินค้าเกิน');
                  }}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${
                    adjustType === 'ADD'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-400/40 shadow-xs'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                  <span>เพิ่มสต็อก (+)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAdjustType('SUB');
                    setAdjustReason('สินค้าชำรุด / เสียหาย');
                  }}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${
                    adjustType === 'SUB'
                      ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-400/40 shadow-xs'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <TrendingDown className="w-5 h-5 text-amber-600" />
                  <span>ปรับลดยอด (-)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAdjustType('SET');
                    setAdjustReason('ตรวจนับสต็อกจริงประจำงวด');
                  }}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${
                    adjustType === 'SET'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800 ring-2 ring-indigo-400/40 shadow-xs'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                  <span>นับจริง (=)</span>
                </button>
              </div>
            </div>

            {/* Amount Input & Live Preview */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">
                {adjustType === 'ADD' && 'จำนวนที่ต้องการเพิ่มเข้าสต็อก *'}
                {adjustType === 'SUB' && 'จำนวนที่ต้องการตัดออกจากสต็อก *'}
                {adjustType === 'SET' && 'จำนวนสต็อกที่ตรวจนับได้จริง *'}
              </label>
              <Input
                type="number"
                min="0"
                placeholder="ระบุจำนวนตัวเลข..."
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                className="h-11 border-slate-300 font-extrabold text-lg text-indigo-600"
              />

              {/* Real-time Result Preview */}
              {adjustAmount !== '' && targetProduct && (
                <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 text-xs text-indigo-900 flex items-center justify-between">
                  <span>ผลลัพธ์หลังการปรับ:</span>
                  <div className="font-extrabold text-sm">
                    {targetProduct.stock ?? 0} ➔{' '}
                    <span className="text-emerald-700 text-base">
                      {adjustType === 'ADD' && (Number(targetProduct.stock ?? 0) + Number(adjustAmount)).toLocaleString()}
                      {adjustType === 'SUB' && Math.max(0, Number(targetProduct.stock ?? 0) - Number(adjustAmount)).toLocaleString()}
                      {adjustType === 'SET' && Number(adjustAmount).toLocaleString()}
                    </span>{' '}
                    {targetProduct.unit || 'ชิ้น'}
                  </div>
                </div>
              )}
            </div>

            {/* Reason Selection */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">เหตุผล / สาเหตุในการปรับสต็อก *</label>
              <div className="space-y-1.5 text-xs">
                {(adjustType === 'ADD'
                  ? [
                      'ตรวจนับพบสินค้าเกิน',
                      'รับโอนสินค้าเข้าคลังพิเศษ',
                      'ลูกค้านำสินค้ามาคืนสภาพเดิม',
                      'ปรับยอดเริ่มต้น',
                    ]
                  : adjustType === 'SUB'
                  ? [
                      'สินค้าชำรุด / เสียหาย / แตกหัก',
                      'สินค้าหมดอายุ / เสื่อมสภาพ',
                      'ตรวจนับพบสินค้าสูญหาย',
                      'เบิกใช้งานภายในร้าน',
                      'ตัวอย่างสินค้า / ของแถม',
                    ]
                  : [
                      'ตรวจนับสต็อกจริงประจำงวด',
                      'ตรวจสอบความถูกต้องของสินค้า',
                      'ปรับยอดตามการตรวจนับ Physical Count',
                    ]
                ).map((r) => (
                  <label
                    key={r}
                    className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="adjustReason"
                      value={r}
                      checked={adjustReason === r}
                      onChange={() => setAdjustReason(r)}
                      className="accent-indigo-600"
                    />
                    <span className="text-slate-800 font-medium">{r}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="radio"
                    name="adjustReason"
                    value="other"
                    checked={adjustReason === 'other'}
                    onChange={() => setAdjustReason('other')}
                    className="accent-indigo-600"
                  />
                  <span className="text-slate-800 font-medium">ระบุเหตุผลอื่นๆ</span>
                </label>
              </div>

              {adjustReason === 'other' && (
                <Input
                  placeholder="พิมพ์เหตุผลการปรับสต็อก..."
                  value={adjustCustomReason}
                  onChange={(e) => setAdjustCustomReason(e.target.value)}
                  className="mt-2 text-xs bg-slate-50 border-slate-300"
                  autoFocus
                />
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-8 py-5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
            <Button
              variant="ghost"
              onClick={() => setIsAdjustModalOpen(false)}
              className="text-slate-600 hover:bg-slate-200/60 font-semibold"
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handleSaveAdjustment}
              disabled={adjustAmount === '' || Number(adjustAmount) < 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-7 h-11 shadow-sm text-sm"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" /> ยืนยันปรับยอดสต็อก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Product Stock Card Modal */}
      <Dialog open={isStockCardOpen} onOpenChange={setIsStockCardOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[1320px] max-w-[1320px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-slate-50/80 shrink-0">
            <DialogTitle className="flex items-center justify-between text-xl font-black text-slate-900">
              <div className="flex items-center gap-2.5">
                <History className="w-6 h-6 text-indigo-600" />
                <span>สต็อกการ์ด: {stockCardProduct?.name}</span>
              </div>
              <Badge variant="outline" className="font-mono font-bold text-sm bg-slate-100 px-3 py-1">
                SKU: {stockCardProduct?.sku}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between text-sm">
              <div>
                <span className="text-slate-500 block font-medium">สต็อกคงเหลือปัจจุบัน:</span>
                {(stockCardProduct?.stock ?? 0) < 0 ? (
                  <b className="text-rose-600 text-2xl font-black inline-flex items-center gap-1.5 bg-rose-50 px-3 py-1 rounded-lg border border-rose-200 mt-0.5">
                    <span>🔻</span> {stockCardProduct?.stock ?? 0} {stockCardProduct?.unit || 'ชิ้น'}
                  </b>
                ) : (
                  <b className="text-emerald-700 text-2xl font-black block mt-0.5">
                    {stockCardProduct?.stock ?? 0} {stockCardProduct?.unit || 'ชิ้น'}
                  </b>
                )}
              </div>
              <div className="text-right text-slate-700">
                <span className="text-slate-500 font-medium">สรุปขนาดบรรจุ: </span>
                <b className="text-amber-800 font-black text-base ml-1">{stockCardProduct && formatPackagingBreakdown(stockCardProduct)}</b>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="border-slate-200">
                    <TableHead className="text-slate-700 font-bold text-sm py-3.5">วัน-เวลา</TableHead>
                    <TableHead className="text-slate-700 font-bold text-sm py-3.5">ประเภท</TableHead>
                    <TableHead className="text-right text-slate-700 font-bold text-sm py-3.5">จำนวน</TableHead>
                    <TableHead className="text-right text-slate-700 font-bold text-sm py-3.5">คงเหลือ</TableHead>
                    <TableHead className="text-slate-700 font-bold text-sm py-3.5">เอกสาร/เหตุผล</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.filter(
                    (m) =>
                      m.productId === stockCardProduct?.id ||
                      m.productId === stockCardProduct?.sku ||
                      m.sku === stockCardProduct?.sku
                  ).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center h-32 text-slate-400 text-sm">
                        ยังไม่มีประวัติการเคลื่อนไหวของสินค้านี้
                      </TableCell>
                    </TableRow>
                  ) : (
                    movements
                      .filter(
                        (m) =>
                          m.productId === stockCardProduct?.id ||
                          m.productId === stockCardProduct?.sku ||
                          m.sku === stockCardProduct?.sku
                      )
                      .map((m) => {
                        const isPositive = m.quantityChange > 0;
                        return (
                          <TableRow key={m.id} className="hover:bg-slate-50 text-sm border-slate-100">
                            <TableCell className="font-medium text-slate-700 py-3">{formatDate(m.createdAt)}</TableCell>
                            <TableCell className="py-3">{getMovementBadge(m.type)}</TableCell>
                            <TableCell className="text-right font-black py-3">
                              <span className={isPositive ? 'text-emerald-600' : 'text-rose-600'}>
                                {isPositive ? `+${m.quantityChange}` : m.quantityChange} {m.unitName}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-black text-slate-900 py-3 text-base">{m.currentStock} {stockCardProduct?.unit || 'ชิ้น'}</TableCell>
                            <TableCell className="text-slate-700 py-3">
                              {m.referenceNo && <b className="font-mono text-slate-900 mr-1.5">{m.referenceNo}:</b>}
                              {m.reason || '-'}
                            </TableCell>
                          </TableRow>
                        );
                      })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-8 py-4 bg-slate-50 shrink-0 flex justify-end">
            <Button onClick={() => setIsStockCardOpen(false)} className="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6">
              ปิดหน้าต่าง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
