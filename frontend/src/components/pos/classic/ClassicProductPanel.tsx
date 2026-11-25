'use client';

import { SearchMatchHint } from '@/components/common/SearchMatchHint';
import Link from 'next/link';
import { Search, ScanLine, Clock, LogOut, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/utils';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { backOfficeHomeFor } from '@/lib/permissions';
import { formatQty } from '@/lib/qty';
import { useProductCardUnit } from '@/lib/pos/use-product-card-unit';
import type { PosController } from '@/lib/pos/use-pos-controller';
import type { PosViewMode } from '@/lib/pos/pos-variant';
import type { Product, ProductUnit } from '@/lib/types';
import { PosLogoutButton } from '../PosLogoutButton';
import { PosRefreshButton } from '../PosRefreshButton';
import { PosScannerInput } from '../PosDialogs';
import { useCartStore } from '@/lib/store/cart-store';
import { shownUnitPrice } from '@/lib/pos/price-level';

/** Arrow keys between the product cards (the grid's column count is read from the layout). */
function moveInGrid(card: HTMLElement, key: string) {
  const cards = Array.from(card.parentElement?.querySelectorAll<HTMLElement>('[data-testid="pos-product-card"]') ?? []);
  const i = cards.indexOf(card);
  const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
  const next = key === 'ArrowRight' ? i + 1 : key === 'ArrowLeft' ? i - 1 : key === 'ArrowDown' ? i + cols : i - cols;
  if (key === 'ArrowUp' && i - cols < 0) {
    // above the first row: back to the search box
    document.querySelector<HTMLInputElement>('input[aria-label^="ค้นหาสินค้า"]')?.focus();
    return;
  }
  const target = cards[Math.max(0, Math.min(cards.length - 1, next))];
  if (!target) return;
  cards.forEach((c) => (c.tabIndex = c === target ? 0 : -1));
  target.focus();
  target.scrollIntoView({ block: 'nearest' });
}

function ClassicProductCard({
  product,
  searchQuery,
  onAddToCart,
  tabIndex,
}: {
  product: Product;
  searchQuery: string;
  onAddToCart: (product: Product, unit: ProductUnit) => void;
  tabIndex: number;
}) {
  const { units, activeUnit, isLowStock, pickUnit, resetUnit, unitStep } = useProductCardUnit(product, searchQuery);
  // prices at the bill's level (member / walk-in level), as the cart will charge them
  const level = useCartStore((s) => s.priceLevel);
  const priceOf = (u: ProductUnit) => shownUnitPrice(product, u, level);

  return (
    <div
      data-testid="pos-product-card"
      role="button"
      tabIndex={tabIndex}
      aria-label={`${product.name}${units.length > 1 ? ` ${activeUnit.unitName}` : ''} ${formatCurrency(priceOf(activeUnit))} (Enter = เพิ่มลงตะกร้า${units.length > 1 ? ', ←/→ = เลือกหน่วย' : ''})`}
      onClick={() => onAddToCart(product, activeUnit)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onAddToCart(product, activeUnit);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          // ← / → go through this card's units first (owner 2026-11-25: every pack reachable by arrows), then on
          // to the neighbouring card; leaving the card by arrows drops a unit picked only by browsing
          const next = e.key === 'ArrowRight' ? unitStep(1) : e.key === 'ArrowLeft' ? unitStep(-1) : null;
          if (next) {
            pickUnit(next);
            return;
          }
          resetUnit();
          moveInGrid(e.currentTarget, e.key);
        }
      }}
      className="relative flex cursor-pointer select-none flex-col rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-xs transition-all hover:border-sky-400 hover:bg-sky-50/40 hover:shadow-md group outline-none focus-visible:ring-4 focus-visible:ring-sky-400 focus-visible:border-sky-500"
    >
      {product.isBundle && (
        <Badge className="absolute top-2 left-2 bg-purple-50 text-purple-700 border-purple-200 text-[10px] font-bold z-10">
          🎁 สินค้าชุด ({product.bundleItems?.length || 0})
        </Badge>
      )}

      {/* stock left is always shown (it used to appear only when low, so a normal stock looked "unknown") */}
      <Badge
        data-testid="pos-card-stock"
        variant={isLowStock ? 'destructive' : 'outline'}
        className={`absolute top-2 right-2 z-10 text-xs font-bold ${
          isLowStock ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white/90 text-slate-600 border-slate-200'
        }`}
      >
        {Number(product.stock) <= 0 ? `หมด (${formatQty(product.stock || 0)})` : `${isLowStock ? 'เหลือ' : 'คงเหลือ'} ${formatQty(product.stock)}`}
      </Badge>

      <div className="mb-2.5 flex aspect-square w-full items-center justify-center rounded-xl bg-slate-100 overflow-hidden group-hover:scale-102 transition-transform">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl sm:text-4xl">{product.isBundle ? '🎁' : '📦'}</span>
        )}
      </div>

      <div className="mb-1 line-clamp-2 font-black text-sm leading-snug text-slate-900">{product.name}</div>
      <SearchMatchHint product={product} query={searchQuery} className="mb-1" />
      <div className="mb-2 text-xs text-slate-400 font-mono">{product.sku}</div>

      {/* Packaging Units Selector Buttons */}
      {units.length > 1 ? (
        <div className="mt-auto pt-2 border-t border-slate-100 flex flex-wrap gap-1">
          {units.map((u) => {
            const isOutOfStock = product.stock < u.factor;
            const isActive = activeUnit.unitName === u.unitName;
            return (
              <button
                key={u.id || u.unitName}
                type="button"
                disabled={isOutOfStock}
                aria-pressed={isActive}
                data-testid="pos-card-unit"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isOutOfStock) {
                    pickUnit(u);
                    onAddToCart(product, u);
                  }
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 cursor-pointer ${
                  isOutOfStock
                    ? 'opacity-40 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through'
                    : isActive
                    ? 'bg-sky-600 text-white border-sky-600 shadow-xs font-black ring-2 ring-sky-300'
                    : 'bg-slate-50 hover:bg-sky-100 hover:text-sky-900 text-slate-700 border-slate-300'
                }`}
                title={isOutOfStock ? `สต๊อกไม่พอ (ต้องใช้ ${u.factor} หน่วย)` : `เลือก ${u.unitName}`}
              >
                <span>{u.unitName}</span>
                <span className="font-mono text-xs opacity-90">{formatCurrency(priceOf(u))}</span>
                {isOutOfStock && <span className="text-[11px] text-red-500 font-bold ml-0.5">(หมด)</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-auto flex items-end justify-between pt-1">
          <div className="text-base font-extrabold text-sky-700 sm:text-lg">{formatCurrency(priceOf(activeUnit))}</div>
          <div className="text-xs text-slate-500 font-bold">/{activeUnit.unitName}</div>
        </div>
      )}
    </div>
  );
}

/** Left side of the classic touch screen: toolbar, categories and the product grid. */
export function ClassicProductPanel({ pos }: { pos: PosController }) {
  const { cart, dialogs: d, filter, categories } = pos;
  const { activeCategory } = filter;
  const backOfficeHome = backOfficeHomeFor(useAuthStore((st) => st.user));

  return (
    <div className="flex min-w-0 flex-1 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
      {/* Editing Order Banner */}
      {cart.editingOrderId && (
        <div className="bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between shadow-md shrink-0">
          <span className="font-extrabold text-xs sm:text-sm flex items-center gap-2">
            ✏️ กำลังอยู่ในโหมดแก้ไขรายการบิล #{cart.editingOrderId} (เมื่อกดชำระเงินจะบันทึกทับบิลเดิมให้อัตโนมัติ)
          </span>
          <button
            type="button"
            onClick={() => cart.clearCart()}
            className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1 rounded-lg transition-colors border border-white/30"
          >
            ยกเลิกการแก้ไข
          </button>
        </div>
      )}

      {/* Hidden input dedicated for Barcode Scanner (Invisible to user, captures scanner input & converts Thai to English) */}
      <PosScannerInput pos={pos} />

      {/* Toolbar */}
      <div data-testid="pos-top-bar" className="flex shrink-0 flex-wrap items-center gap-btn-lg border-b border-slate-200 bg-white px-edge py-2.5">
        {/* Back to the back office (the first page this user may open; none = no button) */}
        {backOfficeHome && (
          <Link
            href={backOfficeHome}
            className="h-11 px-3 rounded-xl border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-2xs transition-colors"
            title="กลับไปเมนูหลัก (หลังร้าน)"
          >
            <ArrowLeft className="w-4 h-4 text-slate-500" />
            <span className="hidden sm:inline">เมนูหลัก</span>
          </Link>
        )}

        {/* Search Input */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="ค้นหาชื่อสินค้า, หมวดหมู่, SKU (พิมพ์ค้นหา)..."
            value={filter.searchQuery}
            onChange={(e) => filter.setSearchQuery(e.target.value)}
            aria-label="ค้นหาสินค้า (Enter = เพิ่มรายการแรก, ↓ = เลือกจากตาราง)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.repeat) return;
                pos.handleSearchEnter();
              } else if (e.key === 'ArrowDown') {
                const first = document.querySelector<HTMLElement>('[data-pos-grid] [data-testid="pos-product-card"]');
                if (first) {
                  e.preventDefault();
                  e.stopPropagation();
                  first.focus();
                }
              }
            }}
            className="h-11 bg-white pl-9 text-xs sm:text-sm font-medium"
          />
        </div>

        {/* Scan Barcode Modal Button */}
        <Button
          size="icon"
          variant="outline"
          className="h-11 w-11 shrink-0 border-slate-300 bg-white shadow-2xs"
          aria-label="เปิดกล้องสแกนบาร์โค้ด"
          onClick={() => d.setShowBarcodeScan(true)}
          title="เปิดกล้องสแกนบาร์โค้ด"
        >
          <ScanLine className="w-5 h-5 text-slate-600" />
        </Button>

        {/* Document Search (F3) */}
        <Button
          size="sm"
          variant="outline"
          className="h-11 border-indigo-200 bg-indigo-50/80 text-indigo-900 hover:bg-indigo-100 font-bold text-xs shadow-2xs hidden sm:flex items-center gap-1.5"
          onClick={() => useDocumentSearchStore.getState().openSearch()}
          title="ค้นหาเอกสารทั้งหมด / สแกนบาร์โค้ดใบเสร็จ (F3 เมื่อตะกร้าว่าง; มีสินค้าในตะกร้า F3 = ส่วนลดรายการ)"
        >
          <ScanLine className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
          <span className="hidden md:inline">ค้นหาเอกสาร</span>
          <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-white text-indigo-700 border border-indigo-200 font-bold">F3</span>
        </Button>

        {/* Screen View Mode Selector */}
        <select
          value={pos.viewMode}
          onChange={(e) => pos.changeViewMode(e.target.value as PosViewMode)}
          className="h-11 bg-slate-50 hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold rounded-xl px-2.5 outline-none shadow-2xs cursor-pointer transition-all shrink-0"
          title="สลับรูปแบบหน้าจอขาย"
        >
          <option value="touch_screen">📱 Touch Screen</option>
          <option value="list_view">📋 แบบรายการ</option>
        </select>

        {/* Order History (Ctrl+H) */}
        <Button
          variant="outline"
          size="sm"
          className="h-11 border-slate-300 text-slate-600 hover:text-primary font-bold text-xs hidden lg:flex items-center"
          onClick={() => d.setShowOrderHistoryModal((prev) => !prev)}
          title="ประวัติการขาย (Ctrl+H)"
        >
          <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
          <span>ประวัติ</span>
        </Button>

        {/* Shift Open / Close */}
        {!pos.isShiftOpen ? (
          <Button size="sm" className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs" onClick={() => d.setShowOpenShift(true)}>
            เปิดกะ
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-11 border-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 font-bold text-xs" onClick={() => d.setShowCloseShift(true)} title="ปิดกะ">
            <LogOut className="w-3.5 h-3.5 mr-1" />
            <span className="hidden sm:inline">ปิดกะ</span>
          </Button>
        )}

        {/* Logout last, away from the sale buttons */}
        <PosLogoutButton compact />
      </div>

      {/* Categories */}
      {/* wraps (max 2 rows, then scrolls down) instead of scrolling sideways */}
      <div className="flex shrink-0 flex-wrap gap-btn max-h-[6.25rem] overflow-y-auto border-b border-slate-200 bg-slate-50 px-edge py-3" role="toolbar" aria-label="หมวดหมู่สินค้า">
        <Button
          variant={activeCategory === null ? 'default' : 'outline'}
          aria-pressed={activeCategory === null}
          className={activeCategory === null ? 'bg-primary hover:bg-primary/90 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}
          onClick={() => filter.setActiveCategory(null)}
        >
          ทั้งหมด
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={activeCategory === c.id ? 'default' : 'outline'}
            aria-pressed={activeCategory === c.id}
            className={`max-w-[16rem] ${activeCategory === c.id ? 'bg-primary hover:bg-primary/90 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
            onClick={() => filter.setActiveCategory(c.id)}
            title={c.name}
          >
            <span className="truncate">{c.name}</span>
          </Button>
        ))}
      </div>

      {/* Status info bar */}
      <div className="flex flex-wrap items-center justify-between gap-btn px-edge py-2 bg-slate-100 border-b border-slate-200 text-xs text-slate-600 font-medium">
        <span>แสดง {filter.visibleProducts.length} จากทั้งหมด {filter.filteredProducts.length} รายการ · ↓ จากช่องค้นหา = เลือกด้วยลูกศร + Enter</span>
        <div className="flex flex-wrap items-center gap-btn">
          <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1 font-semibold">
            ⚡ สแกนเนอร์บาร์โค้ดทำงานอัตโนมัติ ไม่ต้องคลิกช่องค้นหา
          </span>
          {/* F5 รีเฟรชข้อมูล + last sync time (docs/pos-keys-refresh.md) */}
          <PosRefreshButton size="inline" />
        </div>
      </div>

      {/* Product Grid */}
      <div className="flex-1 overflow-visible bg-slate-50 p-edge lg:overflow-y-auto">
        <div data-pos-grid className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filter.visibleProducts.map((p, i) => (
            <ClassicProductCard key={p.id} product={p} searchQuery={filter.searchQuery} onAddToCart={pos.addProductFromCard} tabIndex={i === 0 ? 0 : -1} />
          ))}
        </div>

        {/* Pagination Load More */}
        {filter.hiddenCount > 0 && (
          <div className="py-6 text-center">
            <Button
              variant="outline"
              className="bg-white border-slate-300 text-slate-700 hover:bg-slate-100 font-bold px-6 shadow-sm"
              onClick={filter.loadMore}
            >
              โหลดสินค้าเพิ่มเติม (+{Math.min(pos.variant.pageSize, filter.hiddenCount)})
            </Button>
          </div>
        )}

        {filter.filteredProducts.length === 0 && (
          <div className="flex min-h-80 flex-col items-center justify-center text-slate-500 space-y-2">
            <Search className="w-12 h-12 opacity-20" />
            <p className="font-semibold text-slate-700">ไม่พบสินค้าที่ตรงกับการค้นหา</p>
          </div>
        )}
      </div>
    </div>
  );
}
