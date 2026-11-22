'use client';

import { SearchMatchHint } from '@/components/common/SearchMatchHint';
import { ROW_NAV_CLASS, useRowNav } from "@/lib/use-row-nav";
import { getLowStockThreshold } from '@/lib/store-settings-storage';
import { useState, useEffect, useMemo, useRef } from 'react';
import { api, apiFetch } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import Link from 'next/link';
import { isSellable, toStoreProduct, useProductStore } from '@/lib/store/product-store';
import { usePosDataDemand } from '@/lib/pos-data-policy';
import type { ApiProduct, Product } from '@/lib/types';
import { displayUnitCost } from '@/lib/product-cost';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { StatusChip, type ChipTone } from '@/components/ui/status-chip';
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
  SlidersHorizontal,
  History,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  ShoppingCart,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import {
  StockMovement,
  fetchStockMovements,
  fetchStockMovementsPage,
  movementFrom,
  adjustSingleProductStock,
} from '@/lib/stock-service';
import { toast } from 'sonner';
import { LoadErrorState } from '@/components/common/LoadErrorState';
import { addQty, formatQty, isValidQty, qtyInputMode, qtyStep, subQty, useAllowDecimalQty } from '@/lib/qty';

/** Product as listed here (older rows may still carry cost / price). */
type InvProduct = Product & { cost?: number; price?: number };
/** A packaging unit of a product, whichever naming the row uses. */
type PkgUnit = { name?: string; unitName?: string; multiplier?: number; factor?: number; qtyPerPrev?: number | string };

/** Stock movement types (audit action STOCK_<type>) with their label and chip tone. */
const MOVEMENT_TYPES: Record<string, { label: string; tone: ChipTone }> = {
  IN_PO: { label: 'รับเข้าจาก PO', tone: 'success' },
  OUT_POS: { label: 'ขายออกหน้าร้าน', tone: 'info' },
  IN_VOID: { label: 'คืนสต็อก (ยกเลิกบิล)', tone: 'primary' },
  IN_RETURN: { label: 'รับคืนจากลูกค้า', tone: 'primary' },
  OUT_CLAIM: { label: 'จ่ายเปลี่ยนสินค้าเคลม', tone: 'warning' },
  IN_CLAIM_REVERSAL: { label: 'คืนสต็อก (ยกเลิกเคลม)', tone: 'primary' },
  ADJUST_ADD: { label: 'ปรับเพิ่ม', tone: 'success' },
  ADJUST_SUB: { label: 'ปรับลด (ชำรุด / หาย)', tone: 'warning' },
  ADJUST_SET: { label: 'ตรวจนับจริง', tone: 'neutral' },
  PRODUCT_DELETE: { label: 'ลบสินค้า', tone: 'danger' },
};

export default function InventoryPage() {
  const allowDecimalQty = useAllowDecimalQty();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'normal' | 'low' | 'out' | 'negative'>('all');
  const [activeTab, setActiveTab] = useState<'inventory' | 'movements' | 'reorder'>('inventory');

  // Pagination for Inventory Table
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(10);

  // Movements filtering & pagination
  // Stock-card tab (ประวัติสต็อกการ์ด): one server page (GET /inventory/movements/page) + its totals, so the count on
  // the tab (all movements) and the list (paged, filtered on the server) come from the same query. Before
  // 2026-11-22 the tab showed the length of a 100-row client list and the list stayed empty: the filters started
  // as 'ALL' but were compared with 'all', so the type filter matched nothing.
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [movementAllCount, setMovementAllCount] = useState<number | null>(null);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');
  const [movementDateFilter, setMovementDateFilter] = useState<string>('all');
  // single product stock card (dialog): that product's own movements
  const [cardMovements, setCardMovements] = useState<StockMovement[] | null>(null);
  const [movementPage, setMovementPage] = useState(1);
  const [movementPageSize, setMovementPageSize] = useState(10);

  // Modal State for Manual Adjustment
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [targetProduct, setTargetProduct] = useState<InvProduct | null>(null);
  const [adjustType, setAdjustType] = useState<'ADD' | 'SUB' | 'SET'>('ADD');
  const [adjustAmount, setAdjustAmount] = useState<number | string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [adjustCustomReason, setAdjustCustomReason] = useState<string>('');

  // Modal State for Stock Card Detail
  const [isStockCardOpen, setIsStockCardOpen] = useState(false);
  const [stockCardProduct, setStockCardProduct] = useState<InvProduct | null>(null);

  // whole catalogue (product store): only for the adjust dialog's product list, loaded when it opens
  const { products, categories: storeCategories, fetchProducts } = useProductStore();
  // kept loaded (and current) while the adjust dialog is open; a back-office device releases it afterwards
  usePosDataDemand({ products: true }, isAdjustModalOpen);
  // the stock table, the reorder list and the cards come from the server (GET /products/page, paged + filtered)
  const [pageRows, setPageRows] = useState<InvProduct[]>([]);
  const [filteredCount, setFilteredCount] = useState(0);
  const [reorderRows, setReorderRows] = useState<InvProduct[]>([]);
  const [reorderTotal, setReorderTotal] = useState(0);
  const [stats, setStats] = useState({ totalItems: 0, totalBaseUnits: 0, totalValuation: 0, lowStockCount: 0, outOfStockCount: 0, negativeStockCount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const pageQuery = new URLSearchParams({ page: String(inventoryPage), limit: String(inventoryPageSize), stats: '1' });
  if (debouncedSearch) pageQuery.set('q', debouncedSearch);
  if (activeCategory !== 'all') pageQuery.set('categoryId', activeCategory);
  if (stockStatusFilter !== 'all') pageQuery.set('stock', stockStatusFilter);
  const pageUrl = `/products/page?${pageQuery.toString()}`;
  const latestPageUrl = useRef(pageUrl);

  const loadPage = async (url: string) => {
    try {
      const res = await apiFetch<{ data: ApiProduct[]; meta: { total: number }; stats?: typeof stats }>(url);
      if (latestPageUrl.current !== url) return;
      setPageRows((res?.data || []).map(toStoreProduct));
      setFilteredCount(Number(res?.meta?.total) || 0);
      if (res?.stats) setStats(res.stats);
      setProductsError(null);
    } catch (err) {
      if (latestPageUrl.current !== url) return;
      setPageRows([]);
      setFilteredCount(0);
      setProductsError((err as Error | undefined)?.message || 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      if (latestPageUrl.current === url) setIsLoading(false);
    }
  };

  const loadReorder = async () => {
    try {
      const res = await apiFetch<{ data: ApiProduct[]; meta: { total: number } }>('/products/page?page=1&limit=500&stock=reorder');
      setReorderRows((res?.data || []).map(toStoreProduct));
      setReorderTotal(Number(res?.meta?.total) || 0);
    } catch {
      setReorderRows([]);
      setReorderTotal(0);
    }
  };

  useEffect(() => {
    latestPageUrl.current = pageUrl;
    const run = async () => { await loadPage(pageUrl); };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageUrl]);

  useEffect(() => {
    if (activeTab !== 'reorder') return;
    const run = async () => { await loadReorder(); };
    void run();
  }, [activeTab]);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  // "now" for the movement date filter: when the movements were (re)loaded
  const [movementsLoadedAt, setMovementsLoadedAt] = useState(() => Date.now());
  const [movementsReload, setMovementsReload] = useState(0);
  const loadError = productsError || movementsError;

  const reloadData = async () => {
    await loadPage(latestPageUrl.current);
    if (activeTab === 'reorder') await loadReorder();
    if (products.length) void fetchProducts();
    setMovementsLoadedAt(Date.now());
    setMovementsReload((n) => n + 1);
  };

  useEffect(() => {
    const run = async () => { await reloadData(); };
    void run();
  }, []);

  // Reset pagination when filters change
  const inventoryPageResetKey = JSON.stringify([search, activeCategory, stockStatusFilter, inventoryPageSize]);
  const [inventoryPageResetKeySeen, setInventoryPageResetKeySeen] = useState(inventoryPageResetKey);
  if (inventoryPageResetKeySeen !== inventoryPageResetKey) {
    // a filter changed: back to page 1 (adjusted while rendering, no extra effect pass)
    setInventoryPageResetKeySeen(inventoryPageResetKey);
    setInventoryPage(1);
  }

  const movementPageResetKey = JSON.stringify([movementSearch, movementTypeFilter, movementDateFilter, movementPageSize]);
  const [movementPageResetKeySeen, setMovementPageResetKeySeen] = useState(movementPageResetKey);
  if (movementPageResetKeySeen !== movementPageResetKey) {
    // a filter changed: back to page 1 (adjusted while rendering, no extra effect pass)
    setMovementPageResetKeySeen(movementPageResetKey);
    setMovementPage(1);
  }

  const getCategoryName = (id: string) => storeCategories.find((c) => c.id === id)?.name || 'ไม่ระบุ';

  // Packaging units come with each product from the server (prod.units)
  const allPackaging: Record<string, PkgUnit[]> = {};

  // Format stock breakdown into packaging units (e.g. 10 ลัง 5 ชิ้น)
  const formatPackagingBreakdown = (prod: InvProduct) => {
    const stock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
    const baseUnit = prod.unit || 'ชิ้น';
    const pkgList: PkgUnit[] = allPackaging[prod.id] || prod.units || [];

    if (stock < 0) {
      return `ติดลบ ${Math.abs(stock).toLocaleString()} ${baseUnit}`;
    }

    if (!pkgList || pkgList.length === 0) {
      return `${stock.toLocaleString()} ${baseUnit}`;
    }

    // Sort packaging descending by multiplier
    const sorted = [...pkgList]
      .map((u) => ({
        name: u.name || u.unitName,
        multiplier: Number(u.multiplier || u.factor || u.qtyPerPrev || 1),
      }))
      .filter((u) => u.multiplier > 1)
      .sort((a, b) => b.multiplier - a.multiplier);

    if (sorted.length === 0) {
      return `${stock.toLocaleString()} ${baseUnit}`;
    }

    // whole hundredths: decimal stock (7.25 m) splits into packs without float residue
    let remainingH = Math.round(stock * 100);
    const parts: string[] = [];

    for (const p of sorted) {
      const unitH = Math.round(p.multiplier * 100);
      if (remainingH >= unitH) {
        const count = Math.floor(remainingH / unitH);
        parts.push(`${count.toLocaleString()} ${p.name}`);
        remainingH = remainingH % unitH;
      }
    }

    if (remainingH > 0 || parts.length === 0) {
      parts.push(`${formatQty(remainingH / 100, { grouping: true })} ${baseUnit}`);
    }

    return parts.join(' ');
  };

  const filteredProducts = { length: filteredCount };
  const totalInventoryPages = Math.max(1, Math.ceil(filteredCount / inventoryPageSize));
  const paginatedProducts = pageRows;

  // Stock-card page from the server (same filters as before: search, type, today / 7 / 30 days)
  const debouncedMovementSearch = useDebouncedValue(movementSearch, 300);
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(movementPage), limit: String(movementPageSize) });
    if (debouncedMovementSearch.trim()) qs.set('q', debouncedMovementSearch.trim());
    if (movementTypeFilter !== 'all') qs.set('type', movementTypeFilter);
    const from = movementFrom(movementDateFilter, movementsLoadedAt);
    if (from) qs.set('from', from);
    const run = async () => {
      setMovementsLoading(true);
      try {
        const res = await fetchStockMovementsPage(qs);
        if (cancelled) return;
        setMovements(res.data);
        setMovementTotal(res.meta.total);
        setMovementAllCount(res.meta.allCount);
        setMovementsError(null);
      } catch (err) {
        if (cancelled) return;
        setMovements([]);
        setMovementTotal(0);
        setMovementsError((err as Error | undefined)?.message || 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
      } finally {
        if (!cancelled) setMovementsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [movementPage, movementPageSize, debouncedMovementSearch, movementTypeFilter, movementDateFilter, movementsLoadedAt, movementsReload]);

  const filteredMovements = { length: movementTotal };
  const totalMovementPages = Math.max(1, Math.ceil(movementTotal / movementPageSize));
  const paginatedMovements = movements;

  // Handle Opening Adjustment Modal
  const openAdjustDialog = (prod: InvProduct | null = null) => {
    // the product list of the dialog needs every product (store catalogue, delta-synced after the first load)
    void fetchProducts().then(() => {
      if (!prod) setTargetProduct((cur) => cur || useProductStore.getState().products.find(isSellable) || null);
    });
    setTargetProduct(prod || products.find(isSellable) || null);
    setAdjustType('ADD');
    setAdjustAmount('');
    setAdjustReason(''); // no preset reason: the user picks one (BUG-10)
    setAdjustCustomReason('');
    setIsAdjustModalOpen(true);
  };

  // Handle Opening Stock Card Modal
  const openStockCardDialog = (prod: InvProduct) => {
    setStockCardProduct(prod);
    setCardMovements(null);
    setIsStockCardOpen(true);
    fetchStockMovements(prod.id)
      .then((rows) => setCardMovements(rows))
      .catch((err) => {
        setCardMovements([]);
        toast.error(`โหลดสต็อกการ์ดไม่สำเร็จ: ${(err as Error | undefined)?.message || 'ติดต่อเซิร์ฟเวอร์ไม่ได้'}`);
      });
  };

  // Deep link from the products page "⋯" menu: /inventory?product=<id>&open=card|adjust opens that dialog once
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current) return;
    deepLinkDone.current = true;
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get('product');
    const open = qs.get('open');
    if (!id || (open !== 'card' && open !== 'adjust')) return;
    window.history.replaceState(null, '', window.location.pathname);
    const run = async () => {
      let prod: InvProduct | undefined = useProductStore.getState().products.find((p) => p.id === id);
      if (!prod) {
        try {
          prod = toStoreProduct(await api.products.getOne(id));
        } catch {
          prod = undefined;
        }
      }
      if (!prod) {
        toast.error('ไม่พบสินค้านี้');
        return;
      }
      if (open === 'card') openStockCardDialog(prod);
      else openAdjustDialog(prod);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // Submit Stock Adjustment
  const handleSaveAdjustment = async () => {
    if (!targetProduct) {
      toast.error('กรุณาเลือกสินค้าที่ต้องการปรับสต็อก');
      return;
    }

    const numAmount = Number(adjustAmount);
    if (isNaN(numAmount) || numAmount < 0) {
      toast.error('กรุณากรอกจำนวนตัวเลขที่ถูกต้อง');
      return;
    }

    if (!adjustReason || (adjustReason === 'other' && !adjustCustomReason.trim())) {
      toast.error('กรุณาเลือกเหตุผลการปรับสต็อก');
      return;
    }
    const finalReason = adjustReason === 'other' ? adjustCustomReason.trim() : adjustReason;

    if ((adjustType === 'ADD' || adjustType === 'SUB') && numAmount <= 0) {
      toast.error('จำนวนที่ปรับต้องมากกว่า 0');
      return;
    }
    if (!isValidQty(numAmount, { allowDecimal: allowDecimalQty, min: 'nonneg' })) {
      toast.error(allowDecimalQty ? 'จำนวนมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' : 'จำนวนต้องเป็นจำนวนเต็ม');
      return;
    }

    let res;
    try {
      // the server records the logged-in user on the stock movement
      res = await adjustSingleProductStock({
        productId: targetProduct.id || targetProduct.sku,
        type: adjustType,
        amount: numAmount,
        reason: finalReason,
      });
    } catch (err) {
      // rejected by the server (e.g. not enough stock, no permission): nothing was changed
      toast.error(`ปรับสต็อกไม่สำเร็จ: ${(err as Error | undefined)?.message || 'เกิดข้อผิดพลาด'}`);
      return;
    }

    if (res.success) {
      toast.success(
        `ปรับสต็อก ${targetProduct.name} เรียบร้อย: ${res.previousStock} ➔ ${res.newStock} (${res.delta >= 0 ? '+' : ''}${res.delta} ${targetProduct.unit || 'ชิ้น'})`
      );
      setIsAdjustModalOpen(false);
      await reloadData();
    } else {
      toast.error(res.error || 'ไม่สามารถปรับสต็อกสินค้าได้');
    }
  };

  // Movement type = a status chip (one chip style, docs/ui-style.md)
  const getMovementBadge = (type: string) => {
    const t = MOVEMENT_TYPES[type];
    return <StatusChip tone={t?.tone ?? 'neutral'}>{t?.label ?? type}</StatusChip>;
  };

  const stockNav = useRowNav(paginatedProducts.length, (i) => openStockCardDialog(paginatedProducts[i]));
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      {loadError && <LoadErrorState message={loadError} onRetry={() => void reloadData()} retrying={isLoading} />}
      {/* Sleek Compact Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Package className="w-6 h-6 text-sky-500" /> คลังสินค้าและความเคลื่อนไหวสต็อก (Inventory)
          </h1>
          <p className="page-subtitle">
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
        <div className="flex flex-wrap gap-btn bg-slate-100/90 p-1 rounded-lg border border-slate-200/80">
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
            <span>ประวัติสต็อกการ์ด{movementAllCount !== null ? ` (${movementAllCount.toLocaleString()})` : ''}</span>
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
                {storeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter buttons */}
            <div className="flex flex-wrap gap-btn w-full lg:w-auto pb-1 lg:pb-0">
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
                  onClick={() => setStockStatusFilter(st.value as typeof stockStatusFilter)}
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
              <TableHeader className="">
                <TableRow>
                  <TableHead className="min-w-44 xl:min-w-64">ชื่อสินค้า / รหัส (SKU)</TableHead>
                  <TableHead className="">หมวดหมู่</TableHead>
                  <TableHead className="text-right">ต้นทุน / หน่วย</TableHead>
                  <TableHead className="text-right">คงเหลือ (หน่วยฐาน)</TableHead>
                  <TableHead className="">ตามขนาดบรรจุ</TableHead>
                  <TableHead className="text-center">สถานะ</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody {...stockNav.bodyProps}>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-48 text-muted-foreground">
                      กำลังโหลดข้อมูลคลังสินค้า...
                    </TableCell>
                  </TableRow>
                ) : paginatedProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-48 text-subtle">
                      ไม่พบข้อมูลสินค้าที่ตรงกับเงื่อนไขการค้นหา
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedProducts.map((p: InvProduct, pi: number) => {
                    const stock = Number(p.stock !== undefined && p.stock !== null ? p.stock : 0);
                    const minAlert = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : getLowStockThreshold();
                    const isNegative = stock < 0;
                    const isLow = stock > 0 && stock <= minAlert;
                    const isOut = stock === 0;

                    return (
                      <TableRow key={p.id} className={`hover:bg-slate-50/80 border-slate-100 transition-colors ${ROW_NAV_CLASS}`} {...stockNav.rowProps(pi)}>
                        {/* Product Info */}
                        <TableCell className="min-w-44 xl:min-w-64">
                          <div className="space-y-0.5">
                            <span className="font-medium text-fg line-clamp-2 break-words hover:text-sky-600 transition-colors" title={p.name}>
                              {p.name}
                            </span>
                            <SearchMatchHint product={p} query={debouncedSearch} />
                            <div className="flex flex-wrap items-center gap-x-2 text-sub text-subtle doc-no">
                              <span className="whitespace-nowrap">SKU: {p.sku || '-'}</span>
                              {p.barcodes && p.barcodes.length > 0 && (
                                <span className="whitespace-nowrap">บาร์โค้ด: {p.barcodes[0]?.barcode}</span>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Category */}
                        <TableCell className="">
                          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-sub font-semibold max-w-28 xl:max-w-36 truncate block" title={getCategoryName(p.categoryId)}>
                            {getCategoryName(p.categoryId)}
                          </Badge>
                        </TableCell>

                        {/* Cost */}
                        <TableCell className="text-right font-semibold text-fg whitespace-nowrap tabular-nums">
                          {displayUnitCost(p) !== undefined ? formatCurrency(displayUnitCost(p)!) : '-'}
                        </TableCell>

                        {/* Stock Base Units */}
                        <TableCell className="text-right whitespace-nowrap">
                          {isNegative ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-danger bg-rose-50 px-2.5 py-0.5 rounded-lg border border-rose-200 shadow-2xs">
                              <span className="text-sub">🔻</span>
                              {stock.toLocaleString()}{' '}
                              <span className="text-sub font-normal text-danger">
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
                              <span className="text-sub font-medium text-muted-foreground">
                                {p.unit || 'ชิ้น'}
                              </span>
                            </span>
                          )}
                        </TableCell>

                        {/* Packaging Breakdown */}
                        <TableCell className={`font-semibold text-xs min-w-28 ${isNegative ? 'text-rose-600 font-bold' : 'text-amber-700'}`}>
                          {isNegative && <span className="mr-1">🔻</span>}
                          {formatPackagingBreakdown(p)}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="text-center">
                          {isNegative ? (
                            <Badge className="bg-rose-600 text-white border-rose-700 text-sub font-medium shadow-2xs">
                              🔻 ติดลบ
                            </Badge>
                          ) : isOut ? (
                            <Badge className="bg-rose-100 text-danger border-rose-200 text-sub font-medium whitespace-nowrap">
                              หมดสต็อก
                            </Badge>
                          ) : isLow ? (
                            <Badge className="bg-amber-100 text-warn border-amber-300 text-sub font-medium whitespace-nowrap">
                              ⚠️ ใกล้หมด
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-50 text-ok border-emerald-200 text-sub font-medium">
                              ปกติ
                            </Badge>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="w-px whitespace-nowrap">
                          <div className="flex flex-nowrap items-center justify-end gap-btn">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAdjustDialog(p)}
                              className="h-8 text-sub border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 font-medium px-2.5 rounded-lg shadow-2xs"
                              title="ปรับยอดสต็อก"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 mr-1" /> ปรับยอด
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openStockCardDialog(p)}
                              className="h-8 text-sub text-muted-foreground hover:text-fg hover:bg-slate-100 px-2 rounded-lg"
                              title="ดูประวัติสต็อกการ์ด"
                              aria-label={`ประวัติสต็อกการ์ด ${p.name}`}
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
              <div className="flex items-center gap-btn">
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
                {Object.entries(MOVEMENT_TYPES).map(([id, t]) => (
                  <option key={id} value={id}>{t.label}</option>
                ))}
              </select>

              <select
                value={movementDateFilter}
                onChange={(e) => setMovementDateFilter(e.target.value as typeof movementDateFilter)}
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
              <TableHeader className="">
                <TableRow>
                  <TableHead className="">วัน-เวลา</TableHead>
                  <TableHead className="min-w-44 xl:min-w-56">สินค้า</TableHead>
                  <TableHead className="">ประเภท</TableHead>
                  <TableHead className="text-right">เปลี่ยน</TableHead>
                  <TableHead className="text-right">
                    ก่อน ➔ คงเหลือ
                  </TableHead>
                  <TableHead className="">เอกสารอ้างอิง</TableHead>
                  <TableHead className="min-w-40">หมายเหตุ / ผู้ทำ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedMovements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="tbl-empty" data-testid="movements-empty">
                      {movementsLoading ? 'กำลังโหลด...' : 'ยังไม่มีประวัติความเคลื่อนไหวสต็อกที่ตรงกับเงื่อนไข'}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedMovements.map((m) => {
                    const isPositive = m.quantityChange > 0;
                    return (
                      <TableRow key={m.id} className="hover:bg-slate-50 border-slate-100 text-sub">
                        <TableCell className="font-medium text-muted-foreground whitespace-nowrap">
                          {formatDate(m.createdAt)}
                        </TableCell>
                        <TableCell className="">
                          <div className="font-medium text-fg line-clamp-2 break-words" title={m.productName}>{m.productName}</div>
                          <div className="text-sub text-subtle doc-no">{m.sku}</div>
                        </TableCell>
                        <TableCell className="">{getMovementBadge(m.type)}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">
                          <span className={isPositive ? 'text-emerald-600' : 'text-rose-600'}>
                            {isPositive ? `+${m.quantityChange.toLocaleString()}` : m.quantityChange.toLocaleString()}{' '}
                            <span className="text-sub font-normal text-muted-foreground">{m.unitName}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          <span className="text-muted-foreground">{m.previousStock}</span> ➔{' '}
                          <b className="text-fg font-medium">{m.currentStock}</b>
                        </TableCell>
                        <TableCell className="doc-no whitespace-nowrap font-semibold text-fg">
                          {m.referenceNo || '-'}
                        </TableCell>
                        <TableCell className="">
                          <div className="text-fg font-medium">{m.reason || '-'}</div>
                          <div className="text-sub text-subtle">โดย: {m.userName || 'ระบบ'}</div>
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

              <div className="flex items-center gap-btn">
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
              <TableHeader className="">
                <TableRow>
                  <TableHead className="w-[30%]">ชื่อสินค้า / รหัส (SKU)</TableHead>
                  <TableHead className="w-[15%]">หมวดหมู่</TableHead>
                  <TableHead className="w-[15%] text-right">สต็อกคงเหลือ</TableHead>
                  <TableHead className="w-[15%] text-right">จุดแจ้งเตือน</TableHead>
                  <TableHead className="w-[10%] text-center">สถานะ</TableHead>
                  <TableHead className="w-[15%] text-center">ดำเนินการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reorderRows
                  .map((p: InvProduct) => {
                    const stock = Number(p.stock !== undefined && p.stock !== null ? p.stock : 0);
                    const minAlert = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : getLowStockThreshold();
                    const isNegative = stock < 0;
                    const isOut = stock === 0;

                    return (
                      <TableRow key={p.id} className="hover:bg-slate-50 border-slate-100">
                        <TableCell className="">
                          <span className="font-medium text-fg block">{p.name}</span>
                          <span className="text-sub text-subtle doc-no">SKU: {p.sku}</span>
                        </TableCell>
                        <TableCell className="">
                          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-sub">
                            {getCategoryName(p.categoryId)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {isNegative ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-danger bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200">
                              <span className="text-sub">🔻</span> {stock.toLocaleString()} {p.unit || 'ชิ้น'}
                            </span>
                          ) : (
                            <span className={isOut ? 'text-rose-600' : 'text-amber-600'}>
                              {stock.toLocaleString()} {p.unit || 'ชิ้น'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground font-semibold">
                          {minAlert.toLocaleString()} {p.unit || 'ชิ้น'}
                        </TableCell>
                        <TableCell className="text-center">
                          {isNegative ? (
                            <Badge className="bg-rose-600 text-white border-rose-700 text-sub font-medium shadow-2xs">
                              🔻 ติดลบ
                            </Badge>
                          ) : isOut ? (
                            <Badge className="bg-rose-100 text-danger border-rose-200 text-sub font-medium whitespace-nowrap">
                              หมดสต็อก
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-warn border-amber-300 text-sub font-medium whitespace-nowrap">
                              ⚠️ ใกล้หมด
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Link href="/purchase-orders">
                            <Button
                              size="sm"
                              className="bg-sky-500 hover:bg-sky-600 text-white font-medium h-8 text-sub px-3 rounded-lg shadow-2xs"
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
            {reorderTotal > reorderRows.length && (
              <div className="border-t border-slate-200 bg-amber-50/60 px-4 py-2 text-xs font-medium text-amber-900">
                แสดง {reorderRows.length.toLocaleString()} รายการแรกจาก {reorderTotal.toLocaleString()} รายการ (ดูทั้งหมดได้ที่แท็บภาพรวมสต็อก ตัวกรอง &quot;ใกล้หมด&quot; / &quot;หมด&quot;)
              </div>
            )}
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
                  const found = products.find((p: InvProduct) => p.id === e.target.value);
                  setTargetProduct(found || null);
                }}
                className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 shadow-2xs"
              >
                {/* disabled products are left out of the list (one opened from its own row stays selectable) */}
                {products.filter((p: InvProduct) => isSellable(p) || p.id === targetProduct?.id).map((p: InvProduct) => (
                  <option key={p.id} value={p.id}>
                    [{p.sku || '-'}] {p.name} (คงเหลือ: {p.stock ?? 0} {p.unit || 'ชิ้น'}){isSellable(p) ? '' : ' · ปิดใช้งาน'}
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
                  <span className="text-slate-500 block">ต้นทุน / หน่วย:</span>
                  <b className="text-slate-700 font-bold">{displayUnitCost(targetProduct) !== undefined ? formatCurrency(displayUnitCost(targetProduct)!) : '-'}</b>
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
                    setAdjustReason(''); // no preset reason: the user picks one (BUG-10)
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
                    setAdjustReason(''); // no preset reason: the user picks one (BUG-10)
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
                    setAdjustReason(''); // no preset reason: the user picks one (BUG-10)
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
                step={qtyStep(allowDecimalQty)}
                inputMode={qtyInputMode(allowDecimalQty)}
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
                      {adjustType === 'ADD' && formatQty(addQty(targetProduct.stock ?? 0, adjustAmount), { grouping: true })}
                      {adjustType === 'SUB' && formatQty(Math.max(0, subQty(targetProduct.stock ?? 0, adjustAmount)), { grouping: true })}
                      {adjustType === 'SET' && formatQty(adjustAmount, { grouping: true })}
                    </span>{' '}
                    {targetProduct.unit || 'ชิ้น'}
                  </div>
                </div>
              )}
            </div>

            {/* Reason Selection */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">เหตุผล / สาเหตุในการปรับสต็อก *</label>
              {!adjustReason && <p data-testid="adjust-reason-required" className="text-xs font-semibold text-amber-700">กรุณาเลือกเหตุผลก่อนยืนยัน</p>}
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
              disabled={adjustAmount === '' || Number(adjustAmount) < 0 || !adjustReason || (adjustReason === 'other' && !adjustCustomReason.trim())}
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
                <TableHeader className="">
                  <TableRow className="">
                    <TableHead className="">วัน-เวลา</TableHead>
                    <TableHead className="">ประเภท</TableHead>
                    <TableHead className="text-right">จำนวน</TableHead>
                    <TableHead className="text-right">คงเหลือ</TableHead>
                    <TableHead className="">เอกสาร/เหตุผล</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cardMovements === null ? (
                    <TableRow>
                      <TableCell colSpan={5} className="tbl-empty">กำลังโหลด...</TableCell>
                    </TableRow>
                  ) : cardMovements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="tbl-empty">
                        ยังไม่มีประวัติการเคลื่อนไหวของสินค้านี้
                      </TableCell>
                    </TableRow>
                  ) : (
                    cardMovements
                      .map((m) => {
                        const isPositive = m.quantityChange > 0;
                        return (
                          <TableRow key={m.id} className="hover:bg-slate-50 border-slate-100">
                            <TableCell className="font-medium text-fg">{formatDate(m.createdAt)}</TableCell>
                            <TableCell className="">{getMovementBadge(m.type)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              <span className={isPositive ? 'text-emerald-600' : 'text-rose-600'}>
                                {isPositive ? `+${m.quantityChange}` : m.quantityChange} {m.unitName}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-fg">{m.currentStock} {stockCardProduct?.unit || 'ชิ้น'}</TableCell>
                            <TableCell className="text-fg">
                              {m.referenceNo && <b className="doc-no text-fg mr-1.5">{m.referenceNo}:</b>}
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
