'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { poUnitOptions, type PoUnitOption } from '@shared/po-calc';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { searchProductPage } from '@/components/products/ProductSearchPicker';
import { SearchMatchHint } from '@/components/common/SearchMatchHint';
import { formatCurrency } from '@/lib/utils';
import { formatQty } from '@/lib/qty';
import type { PoGridProduct } from './po-grid';

const barcodeText = (p: PoGridProduct) =>
  (p.barcodes || []).map((b) => (typeof b === 'string' ? b : b?.barcode || '')).filter(Boolean).slice(0, 2).join(', ');

/**
 * Product search popup of the PO grid (docs/po-grid-entry.md): opened by Enter in a code / name cell with the typed
 * text already in the box; server search (GET /products/page, active products, the same search as the products
 * page). ↑/↓ move, Enter picks (base unit), a pack chip picks that pack, Esc goes back to the cell.
 */
export function PoProductSearchDialog({ initialQuery, supplierId, supplierName, onPick, onClose }: {
  initialQuery: string;
  supplierId: string | null;
  supplierName?: string | null;
  onPick: (p: PoGridProduct, unit: PoUnitOption | null) => void;
  onClose: () => void;
}) {
  const listId = useId();
  const [q, setQ] = useState(initialQuery);
  const [onlySupplier, setOnlySupplier] = useState(false);
  const [rows, setRows] = useState<PoGridProduct[]>([]);
  const [loading, setLoading] = useState(!!initialQuery.trim());
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (!text) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      searchProductPage<PoGridProduct>(text, { limit: 30, status: 'active', supplierId: onlySupplier ? supplierId : null })
        .then((data) => { if (my === seq.current) { setRows(data); setActive(0); } })
        .catch(() => { if (my === seq.current) setRows([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 180);
    return () => clearTimeout(t);
  }, [q, onlySupplier, supplierId]);

  const restart = () => {
    // rows of the previous text are never picked by an Enter typed before the new rows arrive
    setRows([]);
    setActive(0);
  };
  const change = (v: string) => {
    setQ(v);
    restart();
    if (v.trim()) setLoading(true);
    else { seq.current++; setLoading(false); }
  };
  const toggleScope = () => {
    setOnlySupplier((v) => !v);
    restart();
    if (q.trim()) setLoading(true);
    inputRef.current?.focus();
  };

  const move = (dir: 1 | -1) => {
    if (!rows.length) return;
    const i = (active + dir + rows.length) % rows.length;
    setActive(i);
    listRef.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const p = rows[active];
      if (p && !loading) onPick(p, null);
    } else if (e.altKey && (e.key === 's' || e.key === 'S' || e.key === 'ห')) {
      e.preventDefault();
      toggleScope();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        data-testid="po-search-dialog"
        className="flex max-h-[calc(100dvh-2rem)] w-[min(820px,calc(100vw-2rem))] max-w-none flex-col gap-3 bg-white p-4 sm:max-w-none"
        initialFocus={() => inputRef.current || true}
        finalFocus={false}
      >
        <DialogHeader className="pr-10">
          <DialogTitle>ค้นหาสินค้า</DialogTitle>
          <DialogDescription className="text-sub">↑/↓ เลือก · Enter ใส่ในแถว · คลิกหน่วยบรรจุเพื่อสั่งเป็นหน่วยนั้น · Esc กลับไปที่ช่อง</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              autoFocus
              type="text"
              role="combobox"
              aria-label="ค้นหาสินค้า"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
              data-testid="po-search-input"
              value={q}
              placeholder="พิมพ์ชื่อ / รหัส / บาร์โค้ด / ชื่อหรือรหัสของผู้ขาย"
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
          </div>
          {supplierId && (
            <label className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sub text-muted-foreground" title={supplierName || undefined}>
              <input type="checkbox" checked={onlySupplier} onChange={toggleScope} className="h-4 w-4 accent-primary" />
              เฉพาะสินค้าของผู้จำหน่ายนี้ (Alt+S)
            </label>
          )}
        </div>
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="ผลการค้นหาสินค้า"
          className="min-h-40 flex-1 overflow-y-auto rounded-xl border border-slate-200 p-1"
        >
          {!q.trim() && <li className="px-3 py-6 text-center text-muted-foreground">พิมพ์ชื่อ รหัส หรือบาร์โค้ดเพื่อค้นหา</li>}
          {q.trim() && loading && rows.length === 0 && <li className="px-3 py-6 text-center text-muted-foreground">กำลังค้นหา...</li>}
          {q.trim() && !loading && rows.length === 0 && (
            <li className="px-3 py-6 text-center text-muted-foreground">
              ไม่พบสินค้า &quot;{q.trim()}&quot;{onlySupplier ? ' ของผู้จำหน่ายนี้ (Alt+S ค้นหาทั้งหมด)' : ''}
            </li>
          )}
          {rows.map((p, i) => {
            const packs = poUnitOptions(p.unit, p.packagingUnits).slice(1);
            const bc = barcodeText(p);
            const cost = Number(p.costPrice);
            return (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                data-testid="po-search-option"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(p, null)}
                className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg px-3 py-2 ${i === active ? 'bg-sky-50 ring-1 ring-sky-300' : 'hover:bg-slate-50'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium text-fg">{p.name}</span>
                  <SearchMatchHint product={p} query={q} />
                  <span className="block truncate text-sub text-muted-foreground">
                    {p.sku}{bc ? ` · ${bc}` : ''}
                  </span>
                  {packs.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {packs.map((u) => (
                        <button
                          key={`${u.name}-${u.factor}`}
                          type="button"
                          tabIndex={-1}
                          data-testid="po-search-pack"
                          onClick={(e) => { e.stopPropagation(); onPick(p, u); }}
                          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-sub text-fg hover:border-primary hover:text-primary"
                          title={`สั่งเป็น${u.name} (${u.factor} ${p.unit || 'ชิ้น'})`}
                        >
                          {u.name} ×{u.factor}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right text-sub">
                  <span className="block text-fg">คงเหลือ {formatQty(Number(p.stock ?? 0))} {p.unit || 'ชิ้น'}</span>
                  {Number.isFinite(cost) && cost > 0 && <span className="block text-muted-foreground">ทุน {formatCurrency(cost)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
