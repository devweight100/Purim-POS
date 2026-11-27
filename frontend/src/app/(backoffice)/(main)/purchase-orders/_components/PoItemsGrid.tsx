'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { defaultPoUnitPrice, lineOwnDiscount, normVatType, type PoLineResult, type PoUnitOption, type PoVatType, type PoPriceHistoryRow } from '@shared/po-calc';
import { docLineName, type DocNameMode } from '@shared/product-names';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { formatQty } from '@/lib/qty';
import { searchProductPage } from '@/components/products/ProductSearchPicker';
import { PoLineName } from './PoLineName';
import { PoProductSearchDialog } from './PoProductSearchDialog';
import {
  exactCodeUnit, rowError, rowUnits, stepCell, unitIndex, withTrailingBlank,
  type GridCol, type PoGridProduct, type PoGridRow,
} from './po-grid';

interface LastPrices { costPrice: number; history: PoPriceHistoryRow[] }

interface Props {
  rows: PoGridRow[];
  setRows: (update: (prev: PoGridRow[]) => PoGridRow[]) => void;
  /** po-calc lines of `rows` (same order), without the bill discount: ราคารวม = qty x (price - discount) */
  lines: PoLineResult[];
  supplierId: string | null;
  supplierName?: string | null;
  editingPoId: string | null;
  showVat: boolean;
  defaultVat: PoVatType;
  allowDecimalQty: boolean;
  docNameMode: DocNameMode;
}

const cellCls =
  'h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-body text-fg outline-none hover:border-slate-200 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20';
const errCls = ' border-rose-400 bg-rose-50/60';

/**
 * The PO entry grid (docs/po-grid-entry.md): one row per line + always an empty row at the bottom.
 * Enter moves code -> (name while no product) -> qty -> unit -> price -> discount (-> VAT) -> next row's code;
 * Shift+Enter goes back; Tab as usual; Ctrl+Delete deletes the row. Enter in a code cell: an exact SKU / barcode /
 * pack barcode picks the product (a pack barcode also its unit), anything else opens the search popup with that
 * text, like Enter in the name cell. Enter never saves the PO.
 */
export function PoItemsGrid({ rows, setRows, lines, supplierId, supplierName, editingPoId, showVat, defaultVat, allowDecimalQty, docNameMode }: Props) {
  const cells = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<{ key: string; col: GridCol } | null>(null);
  const [search, setSearch] = useState<{ rowKey: string; col: GridCol; q: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, GridCol | undefined>>({});
  const busy = useRef(false);
  const priceCache = useRef(new Map<string, Promise<LastPrices>>());
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; });

  const ref = (key: string, col: GridCol) => (el: HTMLElement | null) => {
    const k = `${key}:${col}`;
    if (el) cells.current.set(k, el);
    else cells.current.delete(k);
  };
  const focusCell = useCallback((key: string, col: GridCol) => {
    const el = cells.current.get(`${key}:${col}`);
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
    return true;
  }, []);
  // focus requested before the row re-rendered (a picked product, a new blank row)
  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (f && focusCell(f.key, f.col)) pendingFocus.current = null;
  });
  const focusLater = (key: string, col: GridCol) => {
    pendingFocus.current = { key, col };
    requestAnimationFrame(() => {
      const f = pendingFocus.current;
      if (f && focusCell(f.key, f.col)) pendingFocus.current = null;
    });
  };

  const patchRow = (key: string, patch: Partial<PoGridRow> | ((r: PoGridRow) => Partial<PoGridRow>)) =>
    setRows((prev) => withTrailingBlank(prev.map((r) => (r.key === key ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)), defaultVat));

  const lastPrices = (productId: string): Promise<LastPrices> => {
    const k = `${productId}|${supplierId || ''}`;
    let p = priceCache.current.get(k);
    if (!p) {
      const qs = new URLSearchParams({ productId, ...(supplierId ? { supplierId } : {}), ...(editingPoId ? { excludePoId: editingPoId } : {}) });
      p = apiFetch<LastPrices>(`/purchase-orders/last-prices?${qs.toString()}`).catch(() => ({ costPrice: NaN, history: [] }));
      priceCache.current.set(k, p);
    }
    return p;
  };

  /** default unit price for the row's product + unit (owner rule, shared defaultPoUnitPrice), unless typed */
  const applyDefaultPrice = (key: string, product: PoGridProduct, factor: number) => {
    void lastPrices(product.id).then((lp) => {
      const cost = Number.isFinite(lp.costPrice) ? lp.costPrice : Number(product.costPrice) || 0;
      const { price } = defaultPoUnitPrice(lp.history, factor, cost);
      setRows((prev) => prev.map((r) => (r.key === key && !r.priceEdited && r.product?.id === product.id && r.unitFactor === factor ? { ...r, price: String(price) } : r)));
    });
  };

  const choose = (key: string, product: PoGridProduct, unit: PoUnitOption | null) => {
    const u = unit && (unit.factor > 1 || unit.id) ? unit : null;
    const factor = u ? u.factor : 1;
    const provisional = defaultPoUnitPrice([], factor, product.costPrice).price;
    setRows((prev) => withTrailingBlank(prev.map((r) => (r.key === key ? {
      ...r,
      product,
      code: product.sku,
      name: '',
      qty: r.product && r.qty ? r.qty : '1',
      unitId: u ? u.id : null,
      unitName: u ? u.name : null,
      unitFactor: factor,
      price: String(provisional),
      priceEdited: false,
      discount: '',
      legacyDiscount: null,
    } : r)), defaultVat));
    setErrors((e) => ({ ...e, [key]: undefined }));
    applyDefaultPrice(key, product, factor);
    focusLater(key, 'qty');
  };

  const move = (rowIdx: number, col: GridCol, dir: 1 | -1) => {
    const list = rowsRef.current;
    const to = stepCell(list, { row: rowIdx, col }, dir, showVat);
    if (to) focusCell(list[to.row].key, to.col);
  };

  const deleteRow = (rowIdx: number) => {
    const list = rowsRef.current;
    const r = list[rowIdx];
    if (!r) return;
    const next = withTrailingBlank(list.filter((_, i) => i !== rowIdx), defaultVat);
    setRows(() => next);
    const target = next[Math.min(rowIdx, next.length - 1)];
    focusLater(target.key, 'code');
  };

  const codeEnter = async (rowIdx: number) => {
    const r = rowsRef.current[rowIdx];
    const text = r.code.trim();
    if (r.product && (text === r.product.sku || !text)) {
      if (!text) patchRow(r.key, { code: r.product.sku });
      return move(rowIdx, 'code', 1);
    }
    if (!text) {
      if (r.name.trim()) return setSearch({ rowKey: r.key, col: 'code', q: r.name.trim() });
      return;
    }
    if (busy.current) return;
    busy.current = true;
    try {
      const exact = await searchProductPage<PoGridProduct>(text, { exact: true, status: 'active', limit: 5 }).catch(() => [] as PoGridProduct[]);
      const hits = exact.map((p) => ({ p, unit: exactCodeUnit(p, text) })).filter((h) => h.unit);
      if (hits.length === 1) choose(r.key, hits[0].p, hits[0].unit);
      else setSearch({ rowKey: r.key, col: 'code', q: text });
    } finally {
      busy.current = false;
    }
  };

  const onCellKey = (rowIdx: number, col: GridCol) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing) return;
    const r = rowsRef.current[rowIdx];
    if (e.key === 'Delete' && e.ctrlKey) {
      e.preventDefault();
      deleteRow(rowIdx);
      return;
    }
    if (col === 'unit' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      // ↑/↓ change the unit in place (a closed <select> would open or behave differently per OS)
      e.preventDefault();
      const opts = rowUnits(r);
      if (!r.product || opts.length < 2) return;
      const i = (unitIndex(r) + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      setUnit(r, opts[i]);
      return;
    }
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return;
    // Enter never submits anything here
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.shiftKey) return move(rowIdx, col, -1);
    if (col === 'code') return void codeEnter(rowIdx);
    if (col === 'name') {
      if (!r.product && r.name.trim()) setSearch({ rowKey: r.key, col: 'name', q: r.name.trim() });
      else if (r.product) move(rowIdx, col, 1);
      return;
    }
    if (!r.product) return focusCell(r.key, 'code');
    const err = rowError(r, allowDecimalQty);
    if (err && err.col === col) {
      setErrors((x) => ({ ...x, [r.key]: col }));
      toast.error(`แถว ${rowIdx + 1}: ${err.message}`);
      return;
    }
    setErrors((x) => ({ ...x, [r.key]: undefined }));
    move(rowIdx, col, 1);
  };

  const setUnit = (r: PoGridRow, u: PoUnitOption) => {
    const isBase = u.factor === 1 && !u.id;
    patchRow(r.key, { unitId: isBase ? null : u.id, unitName: isBase ? null : u.name, unitFactor: u.factor, priceEdited: false, price: String(defaultPoUnitPrice([], u.factor, r.product?.costPrice).price) });
    if (r.product) applyDefaultPrice(r.key, r.product, u.factor);
  };

  // the same product in the same unit on two rows: a hint (allowed, e.g. two prices)
  const seen = new Map<string, number>();
  rows.forEach((r, i) => { if (r.product) { const k = `${r.product.id}|${r.unitFactor}`; if (!seen.has(k)) seen.set(k, i); } });

  const searchRow = search ? rows.find((r) => r.key === search.rowKey) : null;

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white" data-testid="po-grid">
      <table className="w-full table-fixed border-collapse text-body">
        <colgroup>
          <col className="w-12" />
          <col className="w-[12%]" />
          <col />
          <col className="w-[7%]" />
          <col className="w-[11%]" />
          <col className="w-[9%]" />
          <col className="w-[8%]" />
          {showVat && <col className="w-[12%]" />}
          <col className="w-[10%]" />
          <col className="w-10" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-50 text-th font-medium text-muted-foreground">
          <tr className="h-9 border-b border-slate-200">
            <th className="px-2 text-center font-medium">ลำดับ</th>
            <th className="px-2 text-left font-medium whitespace-nowrap" title="รหัสสินค้า / บาร์โค้ด"><span className="hidden 2xl:inline">รหัสสินค้า/บาร์โค้ด</span><span className="2xl:hidden">รหัส/บาร์โค้ด</span></th>
            <th className="px-2 text-left font-medium">ชื่อสินค้า</th>
            <th className="px-2 text-right font-medium">จำนวน</th>
            <th className="px-2 text-left font-medium">หน่วย</th>
            <th className="px-2 text-right font-medium whitespace-nowrap" title="ราคาต่อหน่วย"><span className="hidden 2xl:inline">ราคาต่อหน่วย</span><span className="2xl:hidden">ราคา/หน่วย</span></th>
            <th className="px-2 text-right font-medium whitespace-nowrap" title="ส่วนลดต่อหน่วย: 5 = ลด 5 บาทต่อหน่วย, 5% = ลด 5%"><span className="hidden 2xl:inline">ส่วนลดต่อหน่วย</span><span className="2xl:hidden">ลด/หน่วย</span></th>
            {showVat && <th className="px-2 text-left font-medium">VAT</th>}
            <th className="px-2 text-right font-medium">ราคารวม</th>
            <th className="px-1"><span className="sr-only">ลบ</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const line = lines[i];
            const err = r.product ? rowError(r, allowDecimalQty) : null;
            const marked = errors[r.key];
            const bad = (c: GridCol) => (marked === c || (err && err.col === c && c !== 'qty' && c !== 'price') ? errCls : '');
            const units = rowUnits(r);
            const dupOf = r.product ? seen.get(`${r.product.id}|${r.unitFactor}`) : undefined;
            const printed = r.product ? docLineName(docNameMode, r.product, supplierId, r.product.name) : null;
            const total = line ? Math.round((line.baseAmount - lineOwnDiscount(line.baseAmount, line.quantity, line.discountType, line.discountValue)) * 100) / 100 : 0;
            return (
              <tr key={r.key} className="h-11 border-b border-[#edf1f5] align-middle hover:bg-slate-50/60" data-testid="po-grid-row">
                <td className="px-2 text-center text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-1">
                  <input
                    ref={ref(r.key, 'code')}
                    data-testid={`po-cell-code-${i}`}
                    aria-label={`รหัสสินค้า/บาร์โค้ด แถว ${i + 1}`}
                    autoComplete="off"
                    className={cellCls + ' tabular-nums' + bad('code')}
                    value={r.code}
                    placeholder={r.product ? '' : i === rows.length - 1 ? 'รหัส / บาร์โค้ด' : ''}
                    onChange={(e) => patchRow(r.key, { code: e.target.value })}
                    onKeyDown={onCellKey(i, 'code')}
                    onBlur={() => { if (r.product && !rowsRef.current.find((x) => x.key === r.key)?.code.trim()) patchRow(r.key, { code: r.product.sku }); }}
                  />
                </td>
                <td className="min-w-0 px-1">
                  {r.product ? (
                    <div className="flex min-w-0 items-center gap-2 px-2" title={r.product.name}>
                      <PoLineName item={{ docName: printed?.name, docCode: printed?.code, name: r.product.name }} className="line-clamp-2 min-w-0 flex-1 text-body font-medium leading-tight" />
                      {dupOf !== undefined && dupOf !== i && <span className="shrink-0 text-sub text-warn">ซ้ำแถว {dupOf + 1}</span>}
                      <span className="shrink-0 text-sub text-muted-foreground tabular-nums" data-testid="po-grid-stock" title={`คงเหลือ ${formatQty(Number(r.product.stock ?? 0))} ${r.product.unit || 'ชิ้น'}`}>
                        <span className="hidden xl:inline">คงเหลือ </span>{formatQty(Number(r.product.stock ?? 0))}
                      </span>
                    </div>
                  ) : (
                    <input
                      ref={ref(r.key, 'name')}
                      data-testid={`po-cell-name-${i}`}
                      aria-label={`ชื่อสินค้า แถว ${i + 1}`}
                      autoComplete="off"
                      className={cellCls + bad('name')}
                      value={r.name}
                      placeholder={i === rows.length - 1 ? 'พิมพ์ชื่อสินค้าแล้วกด Enter' : ''}
                      onChange={(e) => patchRow(r.key, { name: e.target.value })}
                      onKeyDown={onCellKey(i, 'name')}
                    />
                  )}
                </td>
                <td className="px-1">
                  <input
                    ref={ref(r.key, 'qty')}
                    data-testid={`po-cell-qty-${i}`}
                    aria-label={`จำนวน แถว ${i + 1}`}
                    inputMode={allowDecimalQty ? 'decimal' : 'numeric'}
                    autoComplete="off"
                    disabled={!r.product}
                    className={cellCls + ' text-right tabular-nums disabled:opacity-0' + (marked === 'qty' || (err?.col === 'qty' && r.qty !== '') ? errCls : '')}
                    value={r.qty}
                    onChange={(e) => patchRow(r.key, { qty: e.target.value })}
                    onKeyDown={onCellKey(i, 'qty')}
                  />
                </td>
                <td className="px-1">
                  <select
                    ref={ref(r.key, 'unit')}
                    data-testid={`po-cell-unit-${i}`}
                    aria-label={`หน่วย แถว ${i + 1}`}
                    disabled={!r.product}
                    title={units[unitIndex(r)]?.factor > 1 ? `${units[unitIndex(r)].name} ละ ${units[unitIndex(r)].factor} ${r.product?.unit || 'ชิ้น'}` : undefined}
                    className={cellCls + ' cursor-pointer pr-1 disabled:opacity-0'}
                    value={String(unitIndex(r))}
                    onChange={(e) => setUnit(r, units[Number(e.target.value)])}
                    onKeyDown={onCellKey(i, 'unit')}
                  >
                    {units.map((u, k) => (
                      <option key={`${u.name}-${u.factor}`} value={String(k)}>
                        {u.factor > 1 ? `${u.name} ×${u.factor}` : u.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1">
                  <input
                    ref={ref(r.key, 'price')}
                    data-testid={`po-cell-price-${i}`}
                    aria-label={`ราคาต่อหน่วย แถว ${i + 1}`}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={!r.product}
                    className={cellCls + ' text-right tabular-nums disabled:opacity-0' + (marked === 'price' || err?.col === 'price' ? errCls : '')}
                    value={r.price}
                    onChange={(e) => patchRow(r.key, { price: e.target.value, priceEdited: true })}
                    onKeyDown={onCellKey(i, 'price')}
                  />
                </td>
                <td className="px-1">
                  <input
                    ref={ref(r.key, 'discount')}
                    data-testid={`po-cell-discount-${i}`}
                    aria-label={`ส่วนลดต่อหน่วย แถว ${i + 1}`}
                    autoComplete="off"
                    disabled={!r.product}
                    title={r.legacyDiscount !== null ? `ส่วนลดเดิมทั้งรายการ ${formatCurrency(r.legacyDiscount)} (พิมพ์ใหม่เพื่อเปลี่ยนเป็นส่วนลดต่อหน่วย)` : '5 = ลด 5 บาทต่อหน่วย, 5% = ลด 5%'}
                    placeholder={r.legacyDiscount !== null ? `${formatCurrency(r.legacyDiscount)}/รายการ` : ''}
                    className={cellCls + ' text-right tabular-nums disabled:opacity-0' + bad('discount')}
                    value={r.discount}
                    onChange={(e) => patchRow(r.key, { discount: e.target.value, legacyDiscount: null })}
                    onKeyDown={onCellKey(i, 'discount')}
                  />
                </td>
                {showVat && (
                  <td className="px-1">
                    <div className={`flex items-center gap-1 ${r.product ? '' : 'invisible'}`}>
                      <select
                        ref={ref(r.key, 'vat')}
                        data-testid={`po-cell-vat-${i}`}
                        aria-label={`VAT แถว ${i + 1}`}
                        disabled={!r.product}
                        className={cellCls + ' min-w-0 flex-1 cursor-pointer pr-0 text-sub'}
                        value={normVatType(r.vatType)}
                        onChange={(e) => patchRow(r.key, { vatType: e.target.value as PoVatType })}
                        onKeyDown={onCellKey(i, 'vat')}
                      >
                        <option value="NONE">ไม่มี</option>
                        <option value="INCLUDED">รวมแล้ว</option>
                        <option value="EXCLUDED">+แยก</option>
                      </select>
                      <input
                        aria-label={`อัตรา VAT แถว ${i + 1}`}
                        inputMode="decimal"
                        disabled={!r.product || normVatType(r.vatType) === 'NONE'}
                        className={cellCls + ' w-11 shrink-0 px-1 text-right text-sub tabular-nums disabled:text-subtle'}
                        value={normVatType(r.vatType) === 'NONE' ? '' : String(r.vatRate)}
                        onChange={(e) => patchRow(r.key, { vatRate: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
                      />
                    </div>
                  </td>
                )}
                <td className="px-2 text-right font-medium tabular-nums" data-testid={`po-cell-total-${i}`}>
                  {r.product ? formatCurrency(total) : ''}
                </td>
                <td className="px-1 text-center">
                  {(r.product || r.code || r.name) && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid={`po-row-delete-${i}`}
                      onClick={() => deleteRow(i)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-danger"
                      title="ลบแถว (Ctrl+Delete)"
                      aria-label={`ลบแถว ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {search && searchRow && (
        <PoProductSearchDialog
          initialQuery={search.q}
          supplierId={supplierId}
          supplierName={supplierName}
          onPick={(p, unit) => {
            const key = search.rowKey;
            setSearch(null);
            choose(key, p, unit);
          }}
          onClose={() => {
            const { rowKey, col } = search;
            setSearch(null);
            focusLater(rowKey, col);
          }}
        />
      )}
    </div>
  );
}
