'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { calculatePurchaseBill, normVatType, toBaseUnitLine, type PoVatType } from '@shared/po-calc';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, ChevronLeft, Building2, Package, Image as ImageIcon, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { addQty, parseQty } from '@/lib/qty';
import {
  defaultUnitCost, getProductUnits, isBoundToSupplier, lineVatRate,
  type BillVatMode, type DiscountKind, type PoCartItem, type PoProductLike, type PoSupplier,
  type PreviewTarget, type PurchaseOrder, type PurchaseOrderLine,
} from './po-shared';
import { PoSupplierStep } from './PoSupplierStep';
import { PoItemsTable } from './PoItemsTable';
import { PoCartSummary } from './PoCartSummary';
import { PoSupplierCatalogDialog } from './PoSupplierCatalogDialog';

/** State the create / edit screen starts from (set by "เปิดใบสั่งซื้อใหม่" or "แก้ไข"). */
export interface PoCreateInit {
  editingPo: PurchaseOrder | null;
  suppliers: PoSupplier[];
  supplierProducts: PoProductLike[];
  createStep: 'supplier' | 'items';
  selectedSupplier: PoSupplier | null;
  cartItems: PoCartItem[];
  billDiscountType: DiscountKind;
  billDiscountValue: number;
  vatType: BillVatMode;
}

interface Props {
  init: PoCreateInit;
  /** kept by the page so they survive between two POs, as before */
  searchScope: 'supplier' | 'all';
  setSearchScope: (s: 'supplier' | 'all') => void;
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

/** Create / edit a purchase order: pick the supplier, then fill the order table. */
export function PoCreateView({
  init, searchScope, setSearchScope, catalogSearch, setCatalogSearch, allowDecimalQty,
  loadAllProducts, fetchPOs, openImagePreview, onCancel, onSaved, children,
}: Props) {
  const editingPo = init.editingPo;
  const suppliers = init.suppliers;
  const [createStep, setCreateStep] = useState<'supplier' | 'items'>(init.createStep);
  const [searchSupplier, setSearchSupplier] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<PoSupplier | null>(init.selectedSupplier);
  const [supplierProducts, setSupplierProducts] = useState<PoProductLike[]>(init.supplierProducts);
  const [searchProduct, setSearchProduct] = useState('');
  const [cartItems, setCartItems] = useState<PoCartItem[]>(init.cartItems);
  const [billDiscountType, setBillDiscountType] = useState<DiscountKind>(init.billDiscountType);
  const [billDiscountValue, setBillDiscountValue] = useState<number>(init.billDiscountValue);
  const [vatType, setVatType] = useState<BillVatMode>(init.vatType);
  const [isSupplierCatalogOpen, setIsSupplierCatalogOpen] = useState(false);

  // Keyboard navigation
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSelectSupplier = async (supplier: PoSupplier) => {
    setSelectedSupplier(supplier);
    const prods = await loadAllProducts();
    setSupplierProducts(prods);
    setSearchProduct('');
    setHighlightIndex(0);
    setCreateStep('items');
    setTimeout(() => searchInputRef.current?.focus(), 150);
  };

  const createCartItemFromProduct = (product: PoProductLike, quantity = 1): PoCartItem => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
    unitCost: defaultUnitCost(product),
    quantity,
    discountType: 'baht' as 'baht' | 'percent',
    discountValue: 0,
    vatType: normVatType(vatType) as PoVatType,
    vatRate: 7,
    imageUrl: product.imageUrl || null,
  });

  const updateProductQuantity = (product: PoProductLike, quantity: number) => {
    const safeQuantity = Math.max(0, parseQty(quantity, allowDecimalQty) || 0);
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (safeQuantity === 0) {
        return prev.filter(item => item.productId !== product.id);
      }
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, quantity: safeQuantity } : item
        );
      }
      return [...prev, createCartItemFromProduct(product, safeQuantity)];
    });
  };

  const updateProductUnitCost = (product: PoProductLike, cost: number) => {
    const safeCost = Math.max(0, Number(cost) || 0);
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, unitCost: safeCost } : item
        );
      }
      return [...prev, { ...createCartItemFromProduct(product), unitCost: safeCost }];
    });
  };

  const updateProductDiscount = (product: PoProductLike, key: 'discountType' | 'discountValue', value: 'baht' | 'percent' | number) => {
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, [key]: value } : item
        );
      }
      return [...prev, { ...createCartItemFromProduct(product), [key]: value }];
    });
  };

  const removeCartItem = (productId: string) => {
    setCartItems(prev => prev.filter(item => item.productId !== productId));
  };

  const handleCreatePO = async () => {
    if (!selectedSupplier || cartItems.length === 0) {
      toast.error("กรุณาเลือกผู้จำหน่ายและเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return;
    }

    // same arithmetic as the server (shared/src/po-calc.ts); the server recalculates and stores the result
    const bill = calculatePurchaseBill(cartItems, { type: billDiscountType, value: billDiscountValue });
    const totalBeforeDiscount = Math.round((bill.baseAmount - bill.lineDiscountAmount) * 100) / 100;
    const calculatedVat = bill.vatAmount;
    const netAmount = bill.subtotalAmount;
    const finalTotal = bill.totalAmount;
    // The server stores, receives and costs stock in BASE units only: a line ordered in a pack unit
    // (2 โหล x12 @ 120) is sent as 24 units @ 10 with the same line total (see toBaseUnitLine).
    const baseLines = cartItems.map((i) => {
      const base = toBaseUnitLine(i);
      return {
        ...i,
        ...base,
        unitName: (Number(i.multiplier) || 1) > 1 ? (i.baseUnit || 'ชิ้น') : (i.unitName || i.baseUnit || 'ชิ้น'),
        multiplier: 1,
      };
    });
    const apiItems = baseLines.map((i) => ({
      productId: i.productId,
      quantity: Number(i.quantity),
      unitCost: Number(i.unitCost),
      discountType: i.discountType || 'baht',
      discountValue: Number(i.discountValue) || 0,
      vatType: normVatType(i.vatType),
      vatRate: lineVatRate(i.vatRate),
    }));

    if (editingPo) {
      const updatedPO: PurchaseOrder = {
        ...editingPo,
        supplierId: selectedSupplier.id,
        supplier: selectedSupplier,
        supplierName: selectedSupplier.name,
        totalAmount: finalTotal,
        subtotal: totalBeforeDiscount,
        discountType: billDiscountType,
        discountValue: billDiscountValue,
        vatType,
        vatAmount: calculatedVat,
        netAmount,
        updatedAt: new Date().toISOString(),
        items: baseLines.map((i) => ({
          id: i.id || "poi_" + Math.random().toString(36).substring(2, 7),
          productId: i.productId,
          name: i.name,
          sku: i.sku,
          quantity: Number(i.quantity) || 1,
          receivedQuantity: Number(i.receivedQuantity) || 0,
          unitCost: Number(i.unitCost) || 0,
          unitName: i.unitName || i.baseUnit || 'ชิ้น',
          multiplier: i.multiplier || 1,
          discountType: i.discountType || 'baht',
          discountValue: Number(i.discountValue) || 0,
          vatType: normVatType(i.vatType),
          vatRate: lineVatRate(i.vatRate),
        })),
      };

      // Database first: the backend accepts only these fields (status/payment changes have their own endpoints)
      try {
        await apiFetch(`/purchase-orders/${editingPo.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            supplierId: updatedPO.supplierId,
            notes: updatedPO.notes,
            billDiscountType,
            billDiscountValue,
            items: apiItems,
          }),
        });
      } catch (error) {
        toast.error(`บันทึกการแก้ไขไม่สำเร็จ: ${(error as Error | undefined)?.message || 'เชื่อมต่อฐานข้อมูลไม่ได้'}`);
        return;
      }
      void fetchPOs();

      toast.success(`บันทึกการแก้ไขใบสั่งซื้อ ${editingPo.poNumber} สำเร็จ`);
      onSaved(updatedPO);
      return;
    }

    const poNumber = "PO" + Date.now().toString().slice(-6);

    const newPO: PurchaseOrder = {
      id: "po_" + Date.now(),
      poNumber,
      supplierId: selectedSupplier.id,
      supplier: selectedSupplier,
      supplierName: selectedSupplier.name,
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      totalAmount: finalTotal,
      subtotal: totalBeforeDiscount,
      discountType: billDiscountType,
      discountValue: billDiscountValue,
      vatType,
      vatAmount: calculatedVat,
      netAmount,
      items: baseLines.map((i) => ({
        id: "poi_" + Math.random().toString(36).substring(2, 7),
        productId: i.productId,
        name: i.name,
        sku: i.sku,
        quantity: Number(i.quantity) || 1,
        receivedQuantity: 0,
        unitCost: Number(i.unitCost) || 0,
        unitName: i.unitName || i.baseUnit || 'ชิ้น',
        multiplier: i.multiplier || 1,
        discountType: i.discountType || 'baht',
        discountValue: Number(i.discountValue) || 0,
        vatType: normVatType(i.vatType),
        vatRate: lineVatRate(i.vatRate),
      })),
    };

    let createdPoObj = newPO;
    try {
      const serverRes = await apiFetch("/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: selectedSupplier.id,
          billDiscountType,
          billDiscountValue,
          items: apiItems,
        })
      });
      if (serverRes && serverRes.id) {
        createdPoObj = {
          ...newPO,
          id: serverRes.id,
          poNumber: serverRes.poNumber || newPO.poNumber,
          items: Array.isArray(serverRes.items) && serverRes.items.length > 0
            ? (serverRes.items as PurchaseOrderLine[]).map((srvItem, idx: number) => ({
                ...newPO.items[idx],
                id: srvItem.id,
                purchaseOrderItemId: srvItem.id,
                productId: srvItem.productId,
                quantity: Number(srvItem.quantity) || newPO.items[idx]?.quantity,
                unitCost: Number(srvItem.unitCost) || newPO.items[idx]?.unitCost,
              }))
            : newPO.items
        };
      }
    } catch (error) {
      // No local-only purchase orders: they would never reach payables / receiving
      toast.error(`สร้างใบสั่งซื้อไม่สำเร็จ: ${(error as Error | undefined)?.message || 'เชื่อมต่อฐานข้อมูลไม่ได้'}`);
      return;
    }

    await fetchPOs();

    toast.success("สร้างใบสั่งซื้อสำเร็จ");
    onSaved(createdPoObj);
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(searchSupplier.toLowerCase()) ||
    (s.phone && s.phone.includes(searchSupplier))
  );

  const addCartItemWithUnit = (product: PoProductLike, unitName: string, multiplier: number, deltaQty = 1) => {
    const targetUnit = unitName || product.unit || 'ชิ้น';
    const cartKey = `${product.id}_${targetUnit}`;
    const baseCost = defaultUnitCost(product);
    const unitCost = Math.round(baseCost * multiplier * 100) / 100;

    setCartItems(prev => {
      const existingIndex = prev.findIndex(item => (item.cartKey ? item.cartKey === cartKey : (item.productId === product.id && item.unitName === targetUnit)));
      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const newQty = addQty(existing.quantity, deltaQty);
        if (newQty <= 0) return prev.filter((_, idx) => idx !== existingIndex);
        const updated = [...prev];
        updated[existingIndex] = { ...existing, quantity: newQty };
        return updated;
      }
      const newItem = {
        cartKey,
        productId: product.id,
        name: product.name,
        sku: product.sku,
        stock: product.stock,
        baseUnit: product.unit || 'ชิ้น',
        unitName: targetUnit,
        multiplier: multiplier,
        unitCost: unitCost,
        quantity: deltaQty,
        discountType: 'baht' as 'baht' | 'percent',
        discountValue: 0,
        vatType: normVatType(vatType) as PoVatType,
        vatRate: 7,
        imageUrl: product.imageUrl || null,
      };
      return [...prev, newItem];
    });
    toast.success(`เพิ่ม "${product.name}" (${targetUnit}) ลงตารางเรียบร้อยแล้ว`);
  };

  const filteredSupplierProducts = useMemo(() => {
    let list = supplierProducts;
    if (searchScope === 'supplier' && selectedSupplier) {
      list = list.filter(p => isBoundToSupplier(p, selectedSupplier.id));
    }
    const q = searchProduct.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcodes && p.barcodes.some((b) => (b.barcode || '').includes(q)))
    );
  }, [supplierProducts, searchScope, selectedSupplier, searchProduct]);

  const filteredCatalogProducts = useMemo(() => {
    if (!selectedSupplier) return [];
    const bound = supplierProducts.filter(p => isBoundToSupplier(p, selectedSupplier.id));
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return bound;
    return bound.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcodes && p.barcodes.some((b) => (b.barcode || '').includes(q)))
    );
  }, [supplierProducts, selectedSupplier, catalogSearch]);

  // Keyboard navigation inside search dropdown
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const list = filteredSupplierProducts.slice(0, 8);
    if (list.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => (prev + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => (prev - 1 + list.length) % list.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedProd = list[highlightIndex] || list[0];
      if (selectedProd) {
        const units = getProductUnits(selectedProd);
        addCartItemWithUnit(selectedProd, units[0].name, units[0].mult, 1);
        setSearchProduct('');
        setHighlightIndex(0);
      }
    } else if (e.key === 'Escape') {
      setSearchProduct('');
    }
  };

  // Ref to always hold latest handleCreatePO function for shortcuts
  const handleCreatePORef = useRef(handleCreatePO);
  useEffect(() => {
    handleCreatePORef.current = handleCreatePO;
  });

  // Global keyboard shortcuts (Ctrl+Enter to save)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (createStep === 'items') {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          handleCreatePORef.current?.();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [createStep]);

  // Live totals with the same arithmetic as the server (shared/src/po-calc.ts)
  const liveBill = calculatePurchaseBill(cartItems, { type: billDiscountType, value: billDiscountValue });
  // per-row amount: after the line discount, incl. that line's VAT (bill discount shown separately)
  const rowBill = calculatePurchaseBill(cartItems);
  const getItemTotal = (item: PoCartItem) => rowBill.lines[cartItems.indexOf(item)]?.total ?? 0;
  const updateItemVat = (productId: string, patch: { vatType?: PoVatType; vatRate?: number }) =>
    setCartItems((prev) => prev.map((it) => (it.productId === productId ? { ...it, ...patch } : it)));
  const applyVatToAll = (t: 'none' | 'include' | 'exclude') => {
    setVatType(t);
    setCartItems((prev) => prev.map((it) => ({ ...it, vatType: normVatType(t) })));
  };

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
          <div className="z-10 flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
              <Button variant="ghost" size="sm" onClick={() => setCreateStep('supplier')} className="text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                <ChevronLeft className="w-4 h-4 mr-1" /> เปลี่ยนผู้จำหน่าย
              </Button>
              <div className="hidden h-4 w-px bg-slate-200 mx-1 sm:block"></div>
              <h2 className="flex min-w-0 items-center gap-2 font-semibold text-slate-900 text-lg">
                <Building2 className="w-5 h-5 text-sky-500" />
                <span className="truncate">{selectedSupplier?.name}</span>
                {editingPo && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold ml-1.5 shrink-0">
                    กำลังแก้ไข ({editingPo.poNumber})
                  </Badge>
                )}
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-slate-500 hover:bg-slate-100">
              {editingPo ? 'ยกเลิกการแก้ไข' : 'ยกเลิก'}
            </Button>
          </div>
          
          <div className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-slate-50">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
              <div className="mb-4 flex shrink-0 flex-col gap-3 px-1 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" /> ตารางสั่งของ
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">เลือกขอบเขตค้นหา สั่งสินค้าตามหน่วยบรรจุ แล้วกด [Enter] หรือคลิกเพิ่มสินค้าอย่างสะดวกรวดเร็ว</p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
                  {/* Radio Options */}
                  <div className="flex items-center gap-3 bg-white px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 shadow-sm shrink-0">
                    <span className="font-bold text-slate-500">ค้นหา:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-sky-600 font-semibold">
                      <input
                        type="radio"
                        name="searchScope"
                        value="supplier"
                        checked={searchScope === 'supplier'}
                        onChange={() => setSearchScope('supplier')}
                        className="accent-sky-600 h-3.5 w-3.5"
                      />
                      <span>เฉพาะผู้จำหน่ายนี้ ({selectedSupplier?.name || 'ซัพพลายเออร์'})</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-sky-600 font-semibold">
                      <input
                        type="radio"
                        name="searchScope"
                        value="all"
                        checked={searchScope === 'all'}
                        onChange={() => setSearchScope('all')}
                        className="accent-sky-600 h-3.5 w-3.5"
                      />
                      <span>สินค้าทั้งหมดในระบบ</span>
                    </label>
                  </div>

                  <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <Input
                      ref={searchInputRef}
                      placeholder="พิมพ์ค้นหาสินค้า (↑/↓ เลื่อน, Enter เลือก)..."
                      className="h-10 bg-white pl-9 pr-8 text-sm border-slate-300 focus-visible:ring-sky-500 shadow-sm"
                      value={searchProduct}
                      onChange={(e) => {
                        setSearchProduct(e.target.value);
                        setHighlightIndex(0);
                      }}
                      onKeyDown={handleSearchKeyDown}
                    />
                    {searchProduct.trim() && (
                      <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl max-h-96 overflow-y-auto">
                        {filteredSupplierProducts.slice(0, 10).length === 0 ? (
                          <div className="p-4 text-sm text-slate-500 text-center space-y-2">
                            <p>
                              {searchScope === 'supplier' 
                                ? `ไม่พบสินค้าที่ผูกกับผู้จำหน่าย "${selectedSupplier?.name}" (ค้นหา: "${searchProduct}")` 
                                : `ไม่พบสินค้าที่ค้นหา "${searchProduct}"`}
                            </p>
                            {searchScope === 'supplier' && (
                              <button
                                type="button"
                                onClick={() => setSearchScope('all')}
                                className="inline-flex items-center gap-1 text-xs text-sky-600 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-100 font-semibold transition-colors"
                              >
                                สลับไปค้นหา &quot;สินค้าทั้งหมดในระบบ&quot;
                              </button>
                            )}
                          </div>
                        ) : (
                          filteredSupplierProducts.slice(0, 10).map((product, idx: number) => {
                            const isHighlighted = idx === highlightIndex;
                            const units = getProductUnits(product);

                            return (
                              <div
                                key={product.id}
                                className={`flex flex-col gap-2 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 transition-colors ${
                                  isHighlighted ? "bg-sky-50/90 border-sky-200" : "hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <button
                                      type="button"
                                      onClick={(e) => openImagePreview(product, e)}
                                      className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors"
                                      title="กดเพื่อดูรูปสินค้า"
                                    >
                                      <ImageIcon className="w-4 h-4" />
                                    </button>
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-bold text-slate-900">{product.name}</div>
                                      <div className="truncate text-xs text-slate-500 flex items-center gap-1.5">
                                        <span>{product.sku}</span>
                                        <span>·</span>
                                        <span>คงเหลือ:</span>
                                        {Number(product.stock ?? 0) < 0 ? (
                                          <span className="font-extrabold text-rose-600 bg-rose-50 px-1 rounded border border-rose-200">
                                            🔻 {product.stock} {product.unit || 'ชิ้น'}
                                          </span>
                                        ) : (
                                          <b className="text-slate-700">{product.stock ?? '-'} {product.unit || 'ชิ้น'}</b>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {isHighlighted && (
                                    <span className="text-[10px] bg-sky-500 text-white font-bold px-1.5 py-0.5 rounded shrink-0">
                                      Enter ↵
                                    </span>
                                  )}
                                </div>

                                {/* Packaging Units Selector Pills */}
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                  <span className="text-[11px] text-slate-400 font-medium mr-1">สั่งเพิ่มหน่วย:</span>
                                  {units.map((u, ui) => {
                                    const isAdded = cartItems.some(i => i.productId === product.id && (i.unitName === u.name || (!i.unitName && u.name === (product.unit || 'ชิ้น'))));
                                    return (
                                      <button
                                        key={ui}
                                        type="button"
                                        onClick={() => {
                                          addCartItemWithUnit(product, u.name, u.mult, 1);
                                          setSearchProduct('');
                                          setHighlightIndex(0);
                                        }}
                                        className={`text-xs font-semibold px-2.5 py-1 rounded-md border transition-all flex items-center gap-1 ${
                                          isAdded
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                            : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-500 hover:text-white shadow-xs'
                                        }`}
                                      >
                                        <span>+1 {u.name}</span>
                                        {u.mult > 1 && <span className="text-[10px] opacity-75">(×{u.mult})</span>}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
                    onClick={() => setIsSupplierCatalogOpen(true)}
                  >
                    <Package className="mr-2 h-4 w-4 text-sky-500" />
                    ดูสินค้าจากผู้จำหน่ายทั้งหมด
                  </Button>
                </div>
              </div>

              {/* Table */}
              <PoItemsTable
                cartItems={cartItems}
                supplierProducts={supplierProducts}
                getItemTotal={getItemTotal}
                allowDecimalQty={allowDecimalQty}
                openImagePreview={openImagePreview}
                updateProductUnitCost={updateProductUnitCost}
                updateProductQuantity={updateProductQuantity}
                updateProductDiscount={updateProductDiscount}
                updateItemVat={updateItemVat}
                removeCartItem={removeCartItem}
              />
            </div>

            <PoCartSummary
              cartItems={cartItems}
              liveBill={liveBill}
              billDiscountValue={billDiscountValue}
              setBillDiscountValue={setBillDiscountValue}
              billDiscountType={billDiscountType}
              setBillDiscountType={setBillDiscountType}
              vatType={vatType}
              applyVatToAll={applyVatToAll}
              editingPo={editingPo}
              handleCreatePO={handleCreatePO}
            />

            <PoSupplierCatalogDialog
              isSupplierCatalogOpen={isSupplierCatalogOpen}
              setIsSupplierCatalogOpen={setIsSupplierCatalogOpen}
              selectedSupplier={selectedSupplier}
              catalogSearch={catalogSearch}
              setCatalogSearch={setCatalogSearch}
              filteredCatalogProducts={filteredCatalogProducts}
              cartItems={cartItems}
              openImagePreview={openImagePreview}
              addCartItemWithUnit={addCartItemWithUnit}
            />
          </div>
        </div>
      )}

      {/* Product Image Preview Modal */}
      {children}
    </div>
  );
}
