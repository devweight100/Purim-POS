"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Search, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/** A row of GET /products/page (the fields the picker shows). */
export interface PickedProduct {
  id: string;
  name: string;
  sku: string;
  unit?: string | null;
  stock?: number | string | null;
  isBundle?: boolean;
  isActive?: boolean;
  basePrice?: number | string | null;
  priceLevel1?: number | string | null;
  costPrice?: number | string | null;
  barcodes?: Array<string | { barcode?: string }>;
}

/**
 * One page of GET /products/page for a search box (the products page's search: name, SKU, ชื่อผู้ผลิต, barcodes,
 * pack barcodes, supplier names / codes). `exact` = q is a whole code (SKU any case / barcode / pack barcode).
 */
export function searchProductPage<T = PickedProduct>(
  q: string,
  opts: { limit?: number; status?: "all" | "active"; supplierId?: string | null; exact?: boolean } = {},
): Promise<T[]> {
  const p = new URLSearchParams({ page: "1", limit: String(opts.limit ?? 20), status: opts.status ?? "all", q: q.trim() });
  if (opts.supplierId) p.set("supplierId", opts.supplierId);
  if (opts.exact) p.set("exact", "1");
  return apiFetch<{ data: T[] }>(`/products/page?${p.toString()}`).then((r) => (Array.isArray(r?.data) ? r.data : []));
}

/** Why a row cannot be picked (shown on the row), or null when it can. */
export type PickBlock = (p: PickedProduct) => string | null;

const barcodeText = (p: PickedProduct) =>
  (p.barcodes || [])
    .map((b) => (typeof b === "string" ? b : b?.barcode || ""))
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");

/**
 * Type-to-search product picker (server paging search: name, SKU, ชื่อผู้ผลิต, barcodes, pack barcodes, supplier
 * names / codes - the same search as the products page; works with any number of products).
 * Keyboard: type, ↑/↓ to move, Enter picks, Escape closes the list. Rows that cannot be picked (see `blocked`) are
 * shown greyed with the reason and skipped by the arrows.
 */
export function ProductSearchPicker({
  onPick,
  blocked,
  placeholder = "พิมพ์ชื่อ / รหัส / บาร์โค้ด เพื่อค้นหาสินค้า",
  label = "ค้นหาสินค้า",
  testId,
  autoFocus,
}: {
  onPick: (p: PickedProduct) => void;
  blocked?: PickBlock;
  placeholder?: string;
  label?: string;
  testId?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PickedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpen = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
    setOpen(true);
  };

  useEffect(() => {
    const text = q.trim();
    if (!text) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      searchProductPage(text)
        .then((data) => {
          if (my !== seq.current) return;
          setRows(data);
          setActive(data.findIndex((p) => !blocked?.(p)));
        })
        .catch(() => {
          if (my === seq.current) setRows([]);
        })
        .finally(() => {
          if (my === seq.current) setLoading(false);
        });
    }, 200);
    return () => clearTimeout(t);
    // blocked is read when the reply comes in (the parent's list may have changed meanwhile: re-checked on pick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const change = (v: string) => {
    setQ(v);
    keepOpen();
    // the rows of the previous text are never picked by an Enter typed before the new rows arrive
    setRows([]);
    setActive(-1);
    if (v.trim()) setLoading(true);
    else {
      seq.current++;
      setLoading(false);
    }
  };

  const pick = (p: PickedProduct) => {
    if (blocked?.(p)) return;
    onPick(p);
    seq.current++;
    setQ("");
    setRows([]);
    setOpen(false);
    setActive(-1);
  };

  const move = (dir: 1 | -1) => {
    if (!rows.length) return;
    let i = active;
    for (let n = 0; n < rows.length; n++) {
      i = (i + dir + rows.length) % rows.length;
      if (!blocked?.(rows[i])) break;
    }
    setActive(i);
    listRef.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      // never submits the surrounding form / dialog
      e.preventDefault();
      e.stopPropagation();
      const p = rows[active];
      if (p) pick(p);
    } else if (e.key === "Escape" && open && q) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  const showList = open && q.trim() !== "";
  return (
    <div className="relative" data-testid={testId}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        onFocus={keepOpen}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
        className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm font-medium text-slate-800 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      {showList && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="ผลการค้นหาสินค้า"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {loading && rows.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">กำลังค้นหา...</li>}
          {!loading && rows.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">ไม่พบสินค้า &quot;{q.trim()}&quot;</li>}
          {rows.map((p, i) => {
            const why = blocked?.(p) || null;
            const price = Number(p.priceLevel1 ?? p.basePrice ?? 0);
            const bc = barcodeText(p);
            return (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                aria-disabled={!!why}
                data-testid="product-pick-option"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => !why && setActive(i)}
                onClick={() => pick(p)}
                className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
                  why ? "cursor-not-allowed bg-slate-50 text-slate-400" : i === active ? "cursor-pointer bg-purple-100 text-slate-900" : "cursor-pointer text-slate-800 hover:bg-purple-50"
                }`}
              >
                <span className="min-w-0">
                  <span className="block break-words font-semibold">{p.name}</span>
                  <span className="block text-xs text-slate-500">
                    {p.sku}
                    {bc ? ` · ${bc}` : ""}
                  </span>
                  {why && <span className="mt-0.5 inline-block rounded bg-slate-200 px-1.5 text-[11px] font-bold text-slate-600">{why}</span>}
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block font-bold">{formatCurrency(price)}</span>
                  {!p.isBundle && (
                    <span className="block text-slate-500">
                      สต็อก {Number(p.stock ?? 0).toLocaleString()} {p.unit || ""}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
