'use client';

import { useState } from 'react';
import { btn } from './ShopShell';

export function SearchBox({ initial = '', onSearch }: { initial?: string; onSearch: (q: string) => void }) {
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(q.trim());
      }}
    >
      <label className="sr-only" htmlFor="shop-search">ค้นหาสินค้า</label>
      <input
        id="shop-search"
        type="search"
        enterKeyHint="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="พิมพ์ชื่อสินค้า เช่น ปูน"
        className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-slate-500 bg-white px-4 text-xl placeholder:text-slate-500 focus:border-emerald-700 focus:outline-none"
      />
      <button type="submit" className={`${btn.primary} shrink-0 px-4`}>
        ค้นหา
      </button>
    </form>
  );
}

