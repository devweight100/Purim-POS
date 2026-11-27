'use client';

import { normDocNameMode, type DocNameMode } from '@shared/product-names';
import { DocNameModeToggle } from '@/components/common/DocNameModeToggle';
import { defaultSupplierDocNameMode } from '@/lib/store-settings-storage';
import { matchesOtherNames } from '@shared/product-names';
import { bangkokDayKey } from '@shared/bangkok-date';
import { useEffect, useState, useRef, useMemo } from 'react';
import { calculatePurchaseBill, normVatType, poUnitOptions, unitFactorOf, type PoVatType } from '@shared/po-calc';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronDown, Package, Save } from 'lucide-react';
import { toast } from 'sonner';
import { addQty } from '@/lib/qty';
import {
  isBoundToSupplier, lineVatRate,
  type BillVatMode, type DiscountKind, type PoProductLike, type PoSupplier,
  type PreviewTarget, type PurchaseOrder,
} from './po-shared';
import { PoSupplierStep } from './PoSupplierStep';
import { PoItemsGrid } from './PoItemsGrid';
import { PoSupplierCatalogDialog } from './PoSupplierCatalogDialog';
import {
  num, parseBillDiscount, rowError, rowLine, rowsFromPoItems, toApiItems, withTrailingBlank,
  type PoGridProduct, type PoGridRow,
} from './po-grid';

/** State the create / edit screen starts from (set by "เปิดใบสั่งซื้อใหม่" or "แก้ไข"). */
export interface PoCreateInit {
  editingPo: PurchaseOrder | null;
  suppliers: PoSupplier[];
  supplierProducts: PoProductLike[];
  createStep: 'supplier' | 'items';
  selectedSupplier: PoSupplier | null;
  billDiscountType: DiscountKind;
  billDiscountValue: number;
  vatType: BillVatMode;
}

interface Props {
  init: PoCreateInit;
  catalogSearch: string;
  setCatalogSearch: (s: string) => void;
  allowDecimalQty: boolean;
  loadAllProducts: () => Promise<PoProductLike[]>;
  fetchPOs: () => Promise<void>;
  openImagePreview: (product: PreviewTarget, e?: React.MouseEvent) => void;
  /** leave without saving */
  onCancel: () => void;
  /** saved: back to the list and show the PO */
  onSaved: (po: PurchaseOrder) => void;
  children?: React.ReactNode;
}

const vatOf = (m: BillVatMode): PoVatType => normVatType(m);
const dateInput = (v: unknown) => (v ? bangkokDayKey(v as string) : '');
const asGridProduct = (p: PoProductLike): PoGridProduct => ({
  id: p.id, name: p.name, sku: p.sku, unit: p.unit, stock: p.stock, costPrice: p.costPrice as number | undefined, imageUrl: p.imageUrl,
  manufacturerName: p.manufacturerName, barcodes: p.barcodes, packagingUnits: p.packagingUnits as PoGridProduct['packagingUnits'],
  suppliers: (p.supplierEntries || []).map((s) => ({ supplierId: s.supplierId, supplierProductName: s.supplierProductName, supplierSku: s.supplierSku })),
});

/**
 * Create / edit a purchase order (docs/po-grid-entry.md): pick the supplier, then type the lines into the grid.
 * The bill (supplier, dates, invoice no., notes, name mode) is a compact strip on top; discounts, VAT and totals a
 * slim footer; the grid gets the rest of the window. Saving is explicit (button, Ctrl+S, Ctrl+Enter) - never Enter.
 */
export function PoCreateView({
  init, catalogSearch, setCatalogSearch, allowDecimalQty,
  loadAllProducts, fetchPOs, openImagePreview, onCancel, onSaved, children,
}: Props) {
  const editingPo = init.editingPo;
  const suppliers = init.suppliers;
  const [createStep, setCreateStep] = useState<'supplier' | 'items'>(init.createStep);
  const [searchSupplier, setSearchSupplier] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<PoSupplier | null>(init.selectedSupplier);
  const [supplierProducts, setSupplierProducts] = useState<PoProductLike[]>(init.supplierProducts);
  const [vatMode, setVatMode] = useState<BillVatMode>(init.vatType);
  const [rows, setRowsState] = useState<PoGridRow[]>(() => {
    const known = new Map(init.supplierProducts.map((p) => [p.id, asGridProduct(p)]));
    return withTrailingBlank(rowsFromPoItems(editingPo?.items || [], known, vatOf(init.vatType)), vatOf(init.vatType));
  });
  const setRows = (update: (prev: PoGridRow[]) => PoGridRow[]) => setRowsState(update);
  // VAT is hidden unless asked for (or the PO being edited has VAT lines)
  const [showVat, setShowVat] = useState(() => rows.some((r) => r.product && normVatType(r.vatType) !== 'NONE'));
  const [billDiscountText, setBillDiscountText] = useState(() =>
    init.billDiscountValue > 0 ? `${init.billDiscountValue}${init.billDiscountType === 'percent' ? '%' : ''}` : '',
  );
  const [billDate, setBillDate] = useState(() => dateInput((editingPo as { billDate?: string } | null)?.billDate) || bangkokDayKey(Date.now()));
  const [dueDate, setDueDate] = useState(() => dateInput((editingPo as { dueDate?: string } | null)?.dueDate));
  const [invoiceNo, setInvoiceNo] = useState(editingPo?.supplierInvoiceNo || '');
  const [notes, setNotes] = useState(editingPo?.notes || '');
  const [notesOpen, setNotesOpen] = useState(!!editingPo?.notes);
  // "ใช้ชื่อร้าน / ใช้ชื่อผู้ผลิต": the PO's own, else the store default (ตั้งค่า > สินค้าและสต็อก)
  const [docNameMode, setDocNameMode] = useState<DocNameMode>(() => (editingPo ? normDocNameMode(editingPo.docNameMode) : defaultSupplierDocNameMode()));
  const [isSupplierCatalogOpen, setIsSupplierCatalogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const gridWrap = useRef<HTMLDivElement>(null);

  const focusFirstCode = () => setTimeout(() => gridWrap.current?.querySelector<HTMLInputElement>('[data-testid^="po-cell-code-"]:placeholder-shown, [data-testid="po-cell-code-0"]')?.focus(), 120);

  const handleSelectSupplier = async (supplier: PoSupplier) => {
    setSelectedSupplier(supplier);
    const prods = await loadAllProducts();
    setSupplierProducts(prods);
    setCreateStep('items');
    focusFirstCode();
  };
  useEffect(() => {
    if (init.createStep === 'items') focusFirstCode();
    // once, when the grid opens for editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filled = rows.filter((r) => r.product);
  const bd = parseBillDiscount(billDiscountText);
  // totals with the same arithmetic as the server (shared/src/po-calc.ts)
  const liveBill = calculatePurchaseBill(filled.map(rowLine), { type: bd?.type, value: bd?.value });
  const rowLines = calculatePurchaseBill(rows.map(rowLine)).lines;

  const handleCreatePO = async () => {
    if (saving) return;
    if (!selectedSupplier) { toast.error('กรุณาเลือกผู้จำหน่าย'); return; }
    if (filled.length === 0) { toast.error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ'); return; }
    for (const [i, r] of rows.entries()) {
      const err = rowError(r, allowDecimalQty);
      if (err) {
        toast.error(`แถว ${i + 1}: ${err.message}`);
        gridWrap.current?.querySelector<HTMLElement>(`[data-testid="po-cell-${err.col}-${i}"]`)?.focus();
        return;
      }
    }
    if (!bd) { toast.error('ส่วนลดท้ายบิลไม่ถูกต้อง (เช่น 100 หรือ 5%)'); return; }
    const items = toApiItems(rows).map((i) => ({ ...i, vatRate: lineVatRate(i.vatRate) }));
    const header = {
      supplierId: selectedSupplier.id,
      docNameMode,
      billDiscountType: bd.type,
      billDiscountValue: bd.value,
      billDate: billDate || undefined,
      dueDate: dueDate || null,
      supplierInvoiceNo: invoiceNo.trim() || null,
      notes: notes.trim() || null,
      items,
    };
    setSaving(true);
    try {
      const saved = editingPo
        ? await apiFetch<PurchaseOrder>(`/purchase-orders/${editingPo.id}`, { method: 'PATCH', body: JSON.stringify(header) })
        : await apiFetch<PurchaseOrder>('/purchase-orders', { method: 'POST', body: JSON.stringify(header) });
      if (!saved?.id) throw new Error('ไม่ได้รับการยืนยันจากฐานข้อมูล');
      void fetchPOs();
      toast.success(editingPo ? `บันทึกการแก้ไขใบสั่งซื้อ ${editingPo.poNumber} สำเร็จ` : 'สร้างใบสั่งซื้อสำเร็จ');
      onSaved({ ...saved, supplier: saved.supplier || selectedSupplier });
    } catch (error) {
      // No local-only purchase orders: they would never reach payables / receiving
      toast.error(`${editingPo ? 'บันทึกการแก้ไข' : 'สร้างใบสั่งซื้อ'}ไม่สำเร็จ: ${(error as Error | undefined)?.message || 'เชื่อมต่อฐานข้อมูลไม่ได้'}`);
    } finally {
      setSaving(false);
    }
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(searchSupplier.toLowerCase()) ||
    (s.phone && s.phone.includes(searchSupplier))
  );

  /** "ดูสินค้าจากผู้จำหน่ายทั้งหมด": +1 of a unit (adds to the row of that product + unit, else a new row) */
  const addCartItemWithUnit = (product: PoProductLike, unitName: string, multiplier: number, deltaQty = 1) => {
    const gp = asGridProduct(product);
    const unit = poUnitOptions(gp.unit, gp.packagingUnits).find((u) => u.name === unitName && u.factor === unitFactorOf(multiplier)) || null;
    const factor = unit?.factor ?? 1;
    setRows((prev) => {
      const at = prev.findIndex((r) => r.product?.id === product.id && r.unitFactor === factor);
      if (at >= 0) return prev.map((r, i) => (i === at ? { ...r, qty: String(addQty(num(r.qty) || 0, deltaQty)) } : r));
      const blank = prev[prev.length - 1];
      const row: PoGridRow = {
        ...blank, product: gp, code: gp.sku, name: '', qty: String(deltaQty),
        unitId: factor > 1 ? unit!.id : null, unitName: factor > 1 ? unit!.name : null, unitFactor: factor,
        price: String(Math.round((Number(gp.costPrice) || 0) * factor * 100) / 100), priceEdited: false,
      };
      return withTrailingBlank([...prev.slice(0, -1), row], vatOf(vatMode));
    });
    toast.success(`เพิ่ม "${product.name}" (${unitName}) ลงตารางเรียบร้อยแล้ว`);
  };

  const filteredCatalogProducts = useMemo(() => {
    if (!selectedSupplier) return [];
    const bound = supplierProducts.filter(p => isBoundToSupplier(p, selectedSupplier.id));
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return bound;
    return bound.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcodes && p.barcodes.some((b) => (b.barcode || '').includes(q))) ||
      matchesOtherNames(p, q)
    );
  }, [supplierProducts, selectedSupplier, catalogSearch]);

  // Saving is an explicit shortcut: Ctrl+S / Ctrl+Enter (Enter alone only moves between cells)
  const saveRef = useRef(handleCreatePO);
  useEffect(() => { saveRef.current = handleCreatePO; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (createStep !== 'items' || !e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === 's' || e.key === 'S' || e.code === 'KeyS') {
        if (document.querySelector('[data-testid="po-search-dialog"]')) return;
        e.preventDefault();
        void saveRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createStep]);

  const applyVatToAll = (m: BillVatMode) => {
    setVatMode(m);
    setRows((prev) => prev.map((r) => ({ ...r, vatType: vatOf(m) })));
  };

  const fieldCls = 'h-8 rounded-md border border-slate-300 bg-white px-2 text-sub text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
  const labelCls = 'flex items-center gap-1.5 whitespace-nowrap text-sub text-muted-foreground';

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] w-full max-w-full flex-col overflow-hidden bg-slate-50 lg:h-dvh">
      {createStep === 'supplier' ? (
        <PoSupplierStep
          editingPo={editingPo}
          searchSupplier={searchSupplier}
          setSearchSupplier={setSearchSupplier}
          filteredSuppliers={filteredSuppliers}
          onSkip={() => setCreateStep('items')}
          onCancel={onCancel}
          handleSelectSupplier={handleSelectSupplier}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Bill header strip */}
          <div className="z-10 shrink-0 border-b border-slate-200 bg-white px-4 py-2" data-testid="po-header">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-0 max-w-full items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setCreateStep('supplier')} title="เปลี่ยนผู้จำหน่าย">
                  <ChevronLeft /> ผู้จำหน่าย
                </Button>
                <span className="min-w-0 truncate text-section font-semibold text-fg" title={selectedSupplier?.name} data-testid="po-supplier-name">
                  {selectedSupplier?.name || 'ยังไม่เลือกผู้จำหน่าย'}
                </span>
                {editingPo && <span className="shrink-0 text-sub text-warn">กำลังแก้ไข {editingPo.poNumber}</span>}
              </div>
              <label className={labelCls}>วันที่บิล
                <input type="date" className={fieldCls} value={billDate} onChange={(e) => setBillDate(e.target.value)} data-testid="po-bill-date" />
              </label>
              <label className={labelCls}>ครบกำหนด
                <input type="date" className={fieldCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="po-due-date" />
              </label>
              <label className={labelCls}>เลขที่บิลผู้ขาย
                <input className={fieldCls + ' w-28'} value={invoiceNo} maxLength={50} onChange={(e) => setInvoiceNo(e.target.value)} data-testid="po-invoice-no" />
              </label>
              <DocNameModeToggle label="ชื่อบนเอกสาร" value={docNameMode} onChange={setDocNameMode} className="[&_button]:py-0.5" />
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen} data-testid="po-notes-toggle">
                  หมายเหตุ{notes.trim() ? ' •' : ''} <ChevronDown className={notesOpen ? 'rotate-180' : ''} />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsSupplierCatalogOpen(true)} title="ดูสินค้าจากผู้จำหน่ายทั้งหมด">
                  <Package /> สินค้าผู้จำหน่าย
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  {editingPo ? 'ยกเลิกการแก้ไข' : 'ยกเลิก'}
                </Button>
              </div>
            </div>
            {notesOpen && (
              <textarea
                className="mt-2 block w-full resize-y rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sub text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                rows={2}
                maxLength={1000}
                placeholder="หมายเหตุถึงผู้จำหน่าย / ในเอกสาร"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="po-notes"
              />
            )}
          </div>

          {/* The grid */}
          <div ref={gridWrap} className="flex min-h-0 w-full flex-1 flex-col px-4 py-2">
            <PoItemsGrid
              rows={rows}
              setRows={setRows}
              lines={rowLines}
              supplierId={selectedSupplier?.id || null}
              supplierName={selectedSupplier?.name}
              editingPoId={editingPo?.id || null}
              showVat={showVat}
              defaultVat={vatOf(vatMode)}
              allowDecimalQty={allowDecimalQty}
              docNameMode={docNameMode}
            />
          </div>

          {/* Slim footer: VAT switch, discounts, totals, save */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2" data-testid="po-footer">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="whitespace-nowrap text-sub text-muted-foreground" data-testid="po-line-count">{filled.length} รายการ</span>
              <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sub text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={showVat} onChange={(e) => setShowVat(e.target.checked)} data-testid="po-vat-toggle" />
                VAT รายบรรทัด
              </label>
              {showVat && (
                <div role="group" aria-label="VAT ทุกบรรทัด" className="inline-flex gap-1 rounded-md bg-slate-100 p-0.5 text-sub">
                  {([['none', 'ไม่มี VAT'], ['include', 'รวม VAT'], ['exclude', 'แยก VAT']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => applyVatToAll(m)} aria-pressed={vatMode === m}
                      className={`rounded px-2 py-0.5 ${vatMode === m ? 'bg-white text-fg shadow-sm' : 'text-muted-foreground hover:text-fg'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <span className="hidden whitespace-nowrap text-sub text-subtle 2xl:inline">Enter ช่องถัดไป · Shift+Enter ย้อน · Ctrl+Delete ลบแถว</span>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sub">
                <span className="whitespace-nowrap text-muted-foreground">รวม <b className="font-medium text-fg tabular-nums">{formatCurrency(liveBill.baseAmount)}</b></span>
                {liveBill.lineDiscountAmount > 0 && (
                  <span className="whitespace-nowrap text-muted-foreground">ส่วนลดรายการ <b className="font-medium text-fg tabular-nums">-{formatCurrency(liveBill.lineDiscountAmount)}</b></span>
                )}
                <label className={labelCls}>ส่วนลดท้ายบิล
                  <input
                    className={fieldCls + ' w-20 text-right tabular-nums' + (bd ? '' : ' border-rose-400 bg-rose-50')}
                    value={billDiscountText}
                    placeholder="0 / 5%"
                    title="100 = ลด 100 บาท, 5% = ลด 5%"
                    onChange={(e) => setBillDiscountText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                    data-testid="po-bill-discount"
                  />
                </label>
                {liveBill.vatAmount > 0 && (
                  <span className="whitespace-nowrap text-muted-foreground" data-testid="po-vat-amount">VAT <b className="font-medium text-fg tabular-nums">{formatCurrency(liveBill.vatAmount)}</b></span>
                )}
                <span className="whitespace-nowrap text-muted-foreground">สุทธิ <b className="text-lg font-semibold text-fg tabular-nums" data-testid="po-total">{formatCurrency(liveBill.totalAmount)}</b></span>
                <Button onClick={() => void handleCreatePO()} disabled={saving || filled.length === 0} data-testid="po-save" title="บันทึก (Ctrl+S หรือ Ctrl+Enter)">
                  <Save /> {editingPo ? 'บันทึกการแก้ไข' : 'บันทึกใบสั่งซื้อ'} <span className="text-sub opacity-80">Ctrl+S</span>
                </Button>
              </div>
            </div>
          </div>

          <PoSupplierCatalogDialog
            isSupplierCatalogOpen={isSupplierCatalogOpen}
            setIsSupplierCatalogOpen={setIsSupplierCatalogOpen}
            selectedSupplier={selectedSupplier}
            catalogSearch={catalogSearch}
            setCatalogSearch={setCatalogSearch}
            filteredCatalogProducts={filteredCatalogProducts}
            cartItems={filled.map((r) => ({ productId: r.product!.id, unitName: r.unitName || r.product!.unit || 'ชิ้น', quantity: num(r.qty) || 0 }))}
            openImagePreview={openImagePreview}
            addCartItemWithUnit={addCartItemWithUnit}
          />
        </div>
      )}

      {/* Product Image Preview Modal */}
      {children}
    </div>
  );
}
