'use client';

import { Search } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useProductCardUnit } from '@/lib/pos/use-product-card-unit';
import type { PosController } from '@/lib/pos/use-pos-controller';
import type { Product, ProductUnit } from '@/lib/types';

/** Neo-Brutalist product card */
function NeoProductCard({
  product,
  searchQuery,
  onAddToCart,
}: {
  product: Product;
  searchQuery: string;
  onAddToCart: (product: Product, unit: ProductUnit) => void;
}) {
  const { units, activeUnit, isLowStock, pickUnit } = useProductCardUnit(product, searchQuery);

  return (
    <div
      onClick={() => onAddToCart(product, activeUnit)}
      className="group relative flex cursor-pointer select-none flex-col rounded-xl border-2 border-black bg-white p-3 shadow-[3px_3px_0px_#000] transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[5px_5px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
    >
      {/* Top Badges */}
      <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between gap-1 pointer-events-none">
        {product.isBundle ? (
          <span className="rounded-md border border-black bg-[#E9D5FF] px-1.5 py-0.5 text-[10px] font-black text-black shadow-[1px_1px_0px_#000]">
            🎁 ชุด ({product.bundleItems?.length || 0})
          </span>
        ) : <span />}

        {isLowStock && (
          <span className="rounded-md border border-black bg-[#FECDD3] px-1.5 py-0.5 text-[10px] font-black text-black shadow-[1px_1px_0px_#000]">
            เหลือ {product.stock}
          </span>
        )}
      </div>

      {/* Product Image Box */}
      <div className="mb-2.5 flex aspect-square w-full items-center justify-center rounded-lg border-2 border-black bg-[#F8F6F0] overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <span className="text-3xl select-none">{product.isBundle ? "🎁" : "📦"}</span>
        )}
      </div>

      {/* Product Name */}
      <div className="mb-1 line-clamp-2 text-sm font-black leading-snug text-black">
        {product.name}
      </div>

      {/* SKU & Barcode */}
      <div className="mb-2 flex items-center gap-1 text-[11px] font-mono font-bold text-neutral-600">
        <span className="rounded bg-neutral-100 px-1 py-0.2 border border-black/40">{product.sku}</span>
      </div>

      {/* Multi-Unit Selector or Single Price */}
      {units.length > 1 ? (
        <div className="mt-auto pt-2 border-t border-black/10 flex flex-wrap gap-1">
          {units.map((u) => {
            const isOutOfStock = product.stock < u.factor;
            const isActive = activeUnit.unitName === u.unitName;

            return (
              <button
                key={u.id || u.unitName}
                type="button"
                disabled={isOutOfStock}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isOutOfStock) {
                    pickUnit(u);
                    onAddToCart(product, u);
                  }
                }}
                className={`px-2 py-1 rounded-md text-xs font-black transition-all border border-black flex items-center gap-1 cursor-pointer ${
                  isOutOfStock
                    ? 'opacity-40 bg-neutral-200 text-neutral-500 cursor-not-allowed line-through'
                    : isActive
                    ? 'bg-[#FF6B00] text-black shadow-[2px_2px_0px_#000] ring-1 ring-black'
                    : 'bg-white hover:bg-[#FEF08A] text-black shadow-[1px_1px_0px_#000]'
                }`}
              >
                <span>{u.unitName}</span>
                <span className="font-mono text-[11px]">{formatCurrency(u.price)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-auto flex items-end justify-between pt-1">
          <div className="rounded-lg border-2 border-black bg-[#FEF08A] px-2.5 py-0.5 text-base font-black font-mono text-black shadow-[2px_2px_0px_#000]">
            {formatCurrency(activeUnit.price)}
          </div>
          <div className="text-xs font-black text-neutral-600">/{activeUnit.unitName}</div>
        </div>
      )}
    </div>
  );
}

/** Left side of the neo touch screen: categories and the product grid. */
export function NeoProductPanel({ pos }: { pos: PosController }) {
  const { filter } = pos;

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0px_#000] overflow-hidden">

      {/* Category Tabs: Neo-Brutalist Pill Slider */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b-2 border-black bg-[#FAF6EE] p-2.5 no-scrollbar">
        <button
          type="button"
          onClick={() => filter.setActiveCategory(null)}
          className={`rounded-lg px-3 py-1.5 text-xs font-black transition-all border-2 border-black ${
            filter.activeCategory === null
              ? 'bg-[#FF6B00] text-black shadow-[2px_2px_0px_#000] scale-102'
              : 'bg-white text-black hover:bg-[#FEF08A] shadow-[2px_2px_0px_#000]'
          }`}
        >
          ทั้งหมด ({pos.products.length})
        </button>
        {pos.categories.map((c) => {
          const count = pos.products.filter(p => p.categoryId === c.id).length;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => filter.setActiveCategory(c.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-black transition-all border-2 border-black whitespace-nowrap shrink-0 ${
                filter.activeCategory === c.id
                  ? 'bg-[#FF6B00] text-black shadow-[2px_2px_0px_#000] scale-102'
                  : 'bg-white text-black hover:bg-[#FEF08A] shadow-[2px_2px_0px_#000]'
              }`}
            >
              {c.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Quick Info & Telemetry bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#FAF6EE] border-b-2 border-black text-[11px] font-bold text-neutral-700">
        <span>แสดง {filter.visibleProducts.length} จาก {filter.filteredProducts.length} รายการ</span>
        <span className="flex items-center gap-1 font-mono text-[10px] bg-white border border-black px-1.5 py-0.2 rounded shadow-[1px_1px_0px_#000]">
          ⚡ ยิงบาร์โค้ดได้ทันทีโดยไม่ต้องคลิกช่องค้นหา
        </span>
      </div>

      {/* Products Grid */}
      <div className="flex-1 overflow-y-auto bg-[#FBF9F4] p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filter.visibleProducts.map((p) => (
            <NeoProductCard key={p.id} product={p} searchQuery={filter.searchQuery} onAddToCart={pos.addProductFromCard} />
          ))}
        </div>

        {/* Pagination Load More */}
        {filter.hiddenCount > 0 && (
          <div className="py-6 text-center">
            <button
              type="button"
              onClick={filter.loadMore}
              className="rounded-xl border-2 border-black bg-white px-6 py-2.5 text-xs font-black text-black shadow-[3px_3px_0px_#000] hover:bg-[#FEF08A] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              โหลดสินค้าเพิ่มเติม (+{Math.min(pos.variant.pageSize, filter.hiddenCount)})
            </button>
          </div>
        )}

        {filter.filteredProducts.length === 0 && (
          <div className="flex min-h-80 flex-col items-center justify-center text-neutral-400 space-y-3">
            <Search className="w-12 h-12 opacity-30 text-black" />
            <p className="font-black text-black text-base">ไม่พบสินค้าที่ตรงกับการค้นหา</p>
            <button
              type="button"
              onClick={() => { filter.setSearchQuery(''); filter.setActiveCategory(null); }}
              className="rounded-lg border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0px_#000] hover:bg-[#FEF08A]"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
