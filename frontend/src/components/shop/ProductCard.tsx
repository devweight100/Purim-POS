'use client';

import { useState } from 'react';
import { ONLINE_LIMITS } from '@shared/online-shop';
import { baht, type ShopProduct } from '@/lib/shop/shop-api';
import { useShopCart, useShopSession } from '@/lib/shop/shop-store';
import { btn } from './ShopShell';

export function QtyStepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const set = (n: number) => onChange(Math.max(1, Math.min(ONLINE_LIMITS.maxQtyPerLine, Math.floor(n) || 1)));
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`จำนวน ${label}`}>
      <button type="button" onClick={() => set(value - 1)} disabled={value <= 1} className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-slate-800 bg-white text-3xl font-bold leading-none text-slate-900 disabled:opacity-40 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400" aria-label="ลดจำนวน">
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={ONLINE_LIMITS.maxQtyPerLine}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="h-12 w-16 rounded-xl border-2 border-slate-400 bg-white text-center text-xl font-bold [appearance:textfield] focus:border-emerald-700 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={`จำนวน ${label}`}
      />
      <button type="button" onClick={() => set(value + 1)} className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-slate-800 bg-white text-3xl font-bold leading-none text-slate-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400" aria-label="เพิ่มจำนวน">
        +
      </button>
    </div>
  );
}

export function ProductPhoto({ src, alt, size = 'h-24 w-24' }: { src: string | null; alt: string; size?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- thumbnails served by our API, no optimizer through the tunnel
    <img src={src} alt={alt} loading="lazy" decoding="async" className={`${size} shrink-0 rounded-xl border border-slate-200 bg-white object-cover`} />
  ) : (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-4xl`} aria-hidden>
      📦
    </div>
  );
}

/** Photo, name, unit choice with price, มีของ / หมด, quantity and "ใส่ตะกร้า". */
export function ProductCard({ product }: { product: ShopProduct }) {
  const firstInStock = Math.max(0, product.units.findIndex((u) => u.inStock));
  const [unitIdx, setUnitIdx] = useState(firstInStock);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const add = useShopCart((s) => s.add);
  const member = useShopSession((s) => s.me?.member);
  const unit = product.units[unitIdx] || product.units[0];
  if (!unit) return null;
  const inStock = unit.inStock;

  return (
    <article className="rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm" data-testid="shop-product" data-name={product.name}>
      <div className="flex gap-3">
        <ProductPhoto src={product.imageUrl} alt={product.name} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-xl font-bold leading-snug">{product.name}</h3>
          <p className="mt-1 text-2xl font-extrabold text-emerald-800">
            {baht(unit.price)} <span className="text-lg font-semibold text-slate-700">/ {unit.name}</span>
          </p>
          {member && member.level > 1 && unit.levelPrice === false && (
            <p data-testid="shop-retail-note" className="text-lg font-semibold text-amber-900">
              ราคาปลีก · สินค้านี้ยังไม่มี{member.levelName}
            </p>
          )}
          <p className={`mt-1 inline-block rounded-lg px-2 text-lg font-bold ${inStock ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-800'}`}>{inStock ? 'มีของ' : 'หมด'}</p>
        </div>
      </div>
      {product.units.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="เลือกหน่วย">
          {product.units.map((u, i) => (
            <button
              key={u.id ?? 'base'}
              type="button"
              role="radio"
              aria-checked={i === unitIdx}
              onClick={() => {
                setUnitIdx(i);
                setAdded(false);
              }}
              className={`min-h-12 rounded-xl border-2 px-3 text-lg font-bold focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400 ${i === unitIdx ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-400 bg-white text-slate-900'} ${u.inStock ? '' : 'opacity-60'}`}
            >
              {u.name} {baht(u.price)}
            </button>
          ))}
        </div>
      )}
      {inStock ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <QtyStepper value={qty} onChange={(n) => { setQty(n); setAdded(false); }} label={product.name} />
          <button
            type="button"
            className={`${btn.primary} min-w-0 flex-1`}
            onClick={() => {
              add(product, unit, qty);
              setAdded(true);
              setQty(1);
            }}
          >
            {added ? '✓ ใส่แล้ว' : 'ใส่ตะกร้า'}
          </button>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-slate-100 px-3 py-3 text-center text-lg font-semibold text-slate-700">สินค้าหมด สั่งไม่ได้ตอนนี้</p>
      )}
      <p aria-live="polite" className="sr-only">{added ? `ใส่ ${product.name} ลงตะกร้าแล้ว` : ''}</p>
    </article>
  );
}
