'use client';

import { useEffect, useState, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Eye, CheckCircle, PackageOpen,
  Trash2, Search, ChevronLeft, Building2, Package,
  Image as ImageIcon, Keyboard, ArrowDown, ArrowUp, X, Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

function loadProductImages(productId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`img_${productId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cover = parsed.find((i: any) => i.isCover)?.dataUrl;
        const others = parsed.filter((i: any) => !i.isCover).map((i: any) => i.dataUrl);
        return cover ? [cover, ...others] : parsed.map((i: any) => i.dataUrl);
      }
    }
  } catch {}
  return [];
}

export default function PurchaseOrdersPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  const [createStep, setCreateStep] = useState<'supplier' | 'items'>('supplier');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [searchSupplier, setSearchSupplier] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [supplierProducts, setSupplierProducts] = useState<any[]>([]);
  const [searchProduct, setSearchProduct] = useState('');
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [billDiscountType, setBillDiscountType] = useState<'baht' | 'percent'>('baht');
  const [billDiscountValue, setBillDiscountValue] = useState<number>(0);
  const [isSupplierCatalogOpen, setIsSupplierCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');

  // Keyboard navigation & Image preview state
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [previewProduct, setPreviewProduct] = useState<any | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);

  // Detail Dialog
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [currentPo, setCurrentPo] = useState<any>(null);

  // Receive Dialog
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);

  const fetchPOs = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/purchase-orders");
      setPurchaseOrders(data || []);
    } catch (error) {
      toast.error("ดึงข้อมูลใบสั่งซื้อไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPOs();
  }, []);

  const openCreateDialog = async () => {
    try {
      const supps = await apiFetch("/suppliers");
      setSuppliers(supps || []);
      setCreateStep('supplier');
      setSelectedSupplier(null);
      setSupplierProducts([]);
      setCartItems([]);
      setBillDiscountType('baht');
      setBillDiscountValue(0);
      setIsSupplierCatalogOpen(false);
      setSearchSupplier('');
      setSearchProduct('');
      setHighlightIndex(0);
      setViewMode('create');
    } catch (error) {
      toast.error("ไม่สามารถโหลดข้อมูลผู้จำหน่ายได้");
    }
  };

  const handleSelectSupplier = async (supplier: any) => {
    setSelectedSupplier(supplier);
    try {
      const products = await apiFetch(`/suppliers/${supplier.id}/products`);
      setSupplierProducts(products || []);
      setSearchProduct('');
      setHighlightIndex(0);
      setCreateStep('items');
      setTimeout(() => searchInputRef.current?.focus(), 150);
    } catch (error) {
      toast.error("ไม่สามารถโหลดข้อมูลสินค้าของผู้จำหน่ายได้");
    }
  };

  const openImagePreview = (product: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const imgs = loadProductImages(product.id || product.productId);
    if (imgs.length === 0 && product.imageUrl) imgs.push(product.imageUrl);
    setPreviewImages(imgs);
    setSelectedImageIdx(0);
    setPreviewProduct(product);
  };

  const createCartItemFromProduct = (product: any, quantity = 1) => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
    unitCost: product.unitCost || product.basePrice || 0,
    quantity,
    discountType: 'baht' as 'baht' | 'percent',
    discountValue: 0,
    imageUrl: product.imageUrl || null,
  });

  const getCartItem = (productId: string) => cartItems.find(item => item.productId === productId);

  const updateProductQuantity = (product: any, quantity: number) => {
    const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
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

  const updateProductUnitCost = (product: any, cost: number) => {
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

  const updateProductDiscount = (product: any, key: 'discountType' | 'discountValue', value: 'baht' | 'percent' | number) => {
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
    try {
      await apiFetch("/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: selectedSupplier.id,
          items: cartItems.map((i: any) => ({
            productId: i.productId,
            quantity: Number(i.quantity),
            unitCost: Number(i.unitCost)
          }))
        })
      });
      toast.success("สร้างใบสั่งซื้อสำเร็จ");
      setViewMode('list');
      fetchPOs();
    } catch (error) {
      toast.error("สร้างใบสั่งซื้อไม่สำเร็จ");
    }
  };

  const handleIssuePO = async (id: string, e: any) => {
    e.stopPropagation();
    try {
      await apiFetch(`/purchase-orders/${id}/issue`, { method: "POST" });
      toast.success("ออกใบสั่งซื้อสำเร็จ");
      fetchPOs();
      if (isDetailOpen) handleViewDetail(id);
    } catch (error) {
      toast.error("ทำรายการไม่สำเร็จ");
    }
  };

  const handleViewDetail = async (id: string) => {
    try {
      const data = await apiFetch(`/purchase-orders/${id}`);
      setCurrentPo(data);
      setIsDetailOpen(true);
    } catch (error) {
      toast.error("ดึงข้อมูลใบสั่งซื้อไม่สำเร็จ");
    }
  };

  const openReceiveDialog = (po: any, e: any) => {
    e.stopPropagation();
    setCurrentPo(po);
    setReceiveItems(po.items.map((item: any) => ({
      id: item.id,
      productId: item.productId,
      name: item.name || item.product?.name,
      orderedQty: item.quantity,
      receivedQty: item.receivedQuantity || 0,
      toReceive: Math.max(0, item.quantity - (item.receivedQuantity || 0)),
      unitCost: item.unitCost
    })));
    setIsReceiveOpen(true);
  };

  const handleReceivePO = async () => {
    try {
      await apiFetch(`/purchase-orders/${currentPo.id}/receive`, {
        method: "POST",
        body: JSON.stringify({
          items: receiveItems.map((i: any) => ({
            purchaseOrderItemId: i.id,
            receivedQty: Number(i.toReceive),
            unitCost: Number(i.unitCost)
          })).filter((i: any) => i.receivedQty > 0)
        })
      });
      toast.success("รับสินค้าสำเร็จ");
      setIsReceiveOpen(false);
      fetchPOs();
    } catch (error) {
      toast.error("รับสินค้าไม่สำเร็จ");
    }
  };

  const filteredPOs = purchaseOrders.filter(po => 
    statusFilter === "ALL" ? true : po.status === statusFilter
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT': return <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200">DRAFT</Badge>;
      case 'ISSUED': return <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-100">ISSUED</Badge>;
      case 'PARTIALLY_RECEIVED': return <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-100">PARTIAL</Badge>;
      case 'COMPLETED': return <Badge className="bg-green-50 text-green-700 hover:bg-green-100">COMPLETED</Badge>;
      case 'CANCELLED': return <Badge className="bg-red-50 text-red-600 hover:bg-red-100">CANCELLED</Badge>;
      default: return <Badge className="bg-slate-100 text-slate-800">{status}</Badge>;
    }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchSupplier.toLowerCase()) || 
    (s.phone && s.phone.includes(searchSupplier))
  );

  const filteredSupplierProducts = supplierProducts.filter(p =>
    p.name.toLowerCase().includes(searchProduct.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchProduct.toLowerCase()) ||
    (p.barcodes && p.barcodes.some((b: any) => b.barcode.includes(searchProduct)))
  );

  const filteredCatalogProducts = supplierProducts.filter(p =>
    p.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
    p.sku.toLowerCase().includes(catalogSearch.toLowerCase())
  );

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
        const item = getCartItem(selectedProd.id);
        updateProductQuantity(selectedProd, (item?.quantity || 0) + 1);
        setSearchProduct('');
        setHighlightIndex(0);
        toast.success(`เพิ่ม "${selectedProd.name}" ลงรายการแล้ว`);
      }
    } else if (e.key === 'Escape') {
      setSearchProduct('');
    }
  };

  // Global keyboard shortcuts (Ctrl+Enter to save)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (viewMode === 'create' && createStep === 'items') {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          handleCreatePO();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [viewMode, createStep, cartItems, selectedSupplier]);

  const getItemGross = (item: any) => item.quantity * item.unitCost;

  const getItemDiscountAmount = (item: any) => {
    const gross = getItemGross(item);
    const value = Math.max(0, Number(item.discountValue) || 0);
    const discount = item.discountType === 'percent' ? gross * Math.min(value, 100) / 100 : value;
    return Math.min(gross, discount);
  };

  const getItemTotal = (item: any) => Math.max(0, getItemGross(item) - getItemDiscountAmount(item));

  const subtotalBeforeDiscount = cartItems.reduce((sum, item) => sum + getItemGross(item), 0);
  const itemDiscountTotal = cartItems.reduce((sum, item) => sum + getItemDiscountAmount(item), 0);
  const subtotalAfterItemDiscount = Math.max(0, subtotalBeforeDiscount - itemDiscountTotal);
  const billDiscountAmount = Math.min(
    subtotalAfterItemDiscount,
    billDiscountType === 'percent'
      ? subtotalAfterItemDiscount * Math.min(Math.max(0, billDiscountValue), 100) / 100
      : Math.max(0, billDiscountValue || 0)
  );
  const cartTotal = Math.max(0, subtotalAfterItemDiscount - billDiscountAmount);

  if (viewMode === 'create') {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] w-full max-w-full flex-col overflow-hidden bg-slate-50 lg:h-dvh">
        {createStep === 'supplier' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-6 h-6 text-primary" /> เปิดใบสั่งซื้อ (PO) ใหม่
                </h1>
                <p className="text-slate-500 text-sm mt-1">ขั้นตอนที่ 1: เลือกผู้จำหน่ายที่ต้องการสั่งซื้อสินค้า</p>
              </div>
              <Button variant="ghost" onClick={() => setViewMode('list')} className="text-slate-500 hover:bg-slate-100">
                ยกเลิก (Esc)
              </Button>
            </div>
            <div className="bg-white px-4 py-4 border-b border-slate-200 shrink-0 sm:px-6">
              <div className="relative max-w-2xl mx-auto">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <Input 
                  placeholder="ค้นหาชื่อผู้จำหน่าย หรือ เบอร์โทร..." 
                  className="pl-12 bg-slate-50 border-slate-300 focus-visible:ring-sky-500 h-12 text-lg rounded-full"
                  value={searchSupplier}
                  onChange={(e) => setSearchSupplier(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
              <div className="mx-auto grid max-w-7xl grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 sm:gap-6">
                {filteredSuppliers.map((supplier) => (
                  <div 
                    key={supplier.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-sky-400 cursor-pointer transition-all flex flex-col items-center text-center group"
                    onClick={() => handleSelectSupplier(supplier)}
                  >
                    <div className="w-14 h-14 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-inner">
                      <Building2 className="w-7 h-7" />
                    </div>
                    <h3 className="font-semibold text-slate-900 text-lg mb-1">{supplier.name}</h3>
                    <p className="text-slate-500 text-sm">{supplier.phone || 'ไม่มีเบอร์ติดต่อ'}</p>
                    {supplier.creditTerms && (
                      <Badge variant="outline" className="mt-3 text-xs text-sky-700 border-sky-200 bg-sky-50">
                        เครดิต {supplier.creditTerms} วัน
                      </Badge>
                    )}
                  </div>
                ))}
                {filteredSuppliers.length === 0 && (
                  <div className="col-span-full py-12 text-center text-slate-500">
                    ไม่พบผู้จำหน่ายที่ค้นหา
                  </div>
                )}
              </div>
            </div>
          </div>
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
                </h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setViewMode('list')} className="text-slate-500 hover:bg-slate-100">
                ยกเลิก
              </Button>
            </div>
            
            <div className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-slate-50">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
                <div className="mb-4 flex shrink-0 flex-col gap-3 px-1 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" /> ตารางสั่งของ
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">พิมพ์ชื่อสินค้าแล้วใช้ลูกศร [↑/↓] เลื่อน แล้วกด [Enter] เพื่อเลือกสินค้าได้อย่างสะดวกรวดเร็ว</p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                    <div className="relative w-full sm:w-96">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <Input
                        ref={searchInputRef}
                        placeholder="พิมพ์เพื่อค้นหา (↑/↓ เลื่อน, Enter เลือก)..."
                        className="h-10 bg-white pl-9 pr-8 text-sm border-slate-300 focus-visible:ring-sky-500 shadow-sm"
                        value={searchProduct}
                        onChange={(e) => {
                          setSearchProduct(e.target.value);
                          setHighlightIndex(0);
                        }}
                        onKeyDown={handleSearchKeyDown}
                      />
                      {searchProduct.trim() && (
                        <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
                          {filteredSupplierProducts.slice(0, 8).length === 0 ? (
                            <div className="p-4 text-sm text-slate-500 text-center">ไม่พบสินค้าที่ค้นหา</div>
                          ) : (
                            filteredSupplierProducts.slice(0, 8).map((product, idx) => {
                              const item = getCartItem(product.id);
                              const isHighlighted = idx === highlightIndex;
                              return (
                                <button
                                  key={product.id}
                                  type="button"
                                  className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-left last:border-b-0 transition-colors ${
                                    isHighlighted ? "bg-sky-100/70 border-sky-200" : "hover:bg-slate-50"
                                  }`}
                                  onClick={() => {
                                    updateProductQuantity(product, (item?.quantity || 0) + 1);
                                    setSearchProduct('');
                                    setHighlightIndex(0);
                                  }}
                                >
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
                                      <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                                      <div className="truncate text-xs text-slate-500">{product.sku} · คงเหลือ {product.stock ?? '-'}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {isHighlighted && (
                                      <span className="text-[10px] bg-sky-500 text-white font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                        Enter ↵
                                      </span>
                                    )}
                                    <Badge className={item ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-600'}>
                                      {item ? `สั่งแล้ว ${item.quantity}` : 'เลือก'}
                                    </Badge>
                                  </div>
                                </button>
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
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="hidden grid-cols-[48px_minmax(0,1.6fr)_90px_96px_88px_150px_112px_44px] items-center gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
                    <div className="text-center">ลำดับ</div>
                    <div>สินค้า</div>
                    <div className="text-right">คงเหลือ</div>
                    <div className="text-right">ต้นทุน/หน่วย</div>
                    <div className="text-right">จำนวน</div>
                    <div>ส่วนลดรายการ</div>
                    <div className="text-right">รวมสุทธิ</div>
                    <div className="text-center">ลบ</div>
                  </div>

                  {cartItems.length === 0 ? (
                    <div className="flex min-h-72 flex-col items-center justify-center text-center text-slate-500 space-y-3">
                      <PackageOpen className="h-14 w-14 text-slate-300" />
                      <p className="font-semibold text-base text-slate-700">ยังไม่มีสินค้าในตารางสั่งของ</p>
                      <p className="text-sm text-slate-400">พิมพ์ค้นหาสินค้าด้านบนแล้วกด Enter หรือคลิก "ดูสินค้าจากผู้จำหน่ายทั้งหมด"</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {cartItems.map((item, index) => {
                        const product = supplierProducts.find(p => p.id === item.productId) || { ...item, id: item.productId };
                        const unitCost = item.unitCost;
                        const quantity = item.quantity;
                        const discountType = item.discountType;
                        const discountValue = item.discountValue;
                        const rowTotal = getItemTotal(item);

                        return (
                          <div
                            key={item.productId}
                            className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-sky-50/30 lg:grid-cols-[48px_minmax(0,1.6fr)_90px_96px_88px_150px_112px_44px] lg:items-center"
                          >
                            {/* Col 1: ลำดับ */}
                            <div className="hidden lg:block text-center font-semibold text-slate-400 text-sm">
                              {index + 1}
                            </div>

                            {/* Col 2: สินค้า + รูป */}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2.5">
                                <span className="lg:hidden text-xs font-bold text-slate-400">#{index + 1}</span>
                                <button
                                  type="button"
                                  onClick={(e) => openImagePreview(product, e)}
                                  className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors shadow-sm"
                                  title="กดเพื่อดูรูปภาพสินค้า"
                                >
                                  <ImageIcon className="w-4 h-4" />
                                </button>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-bold text-slate-900">{product.name}</div>
                                  <div className="truncate text-xs text-slate-500 font-mono">{product.sku}</div>
                                </div>
                              </div>
                            </div>

                            {/* Col 3: คงเหลือ */}
                            <div className="flex items-center justify-between text-sm text-slate-600 lg:block lg:text-right">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                              <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                                {item.stock ?? product.stock ?? '-'}
                              </Badge>
                            </div>

                            {/* Col 4: ต้นทุน */}
                            <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                              <span className="lg:hidden">ต้นทุน</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={unitCost}
                                onChange={(e) => updateProductUnitCost(product, Number(e.target.value))}
                                className="h-9 bg-white text-right text-sm border-slate-300 focus-visible:ring-sky-500 font-semibold text-slate-900"
                              />
                            </label>

                            {/* Col 5: จำนวน */}
                            <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                              <span className="lg:hidden">จำนวน</span>
                              <Input
                                type="number"
                                min="1"
                                step="1"
                                value={quantity}
                                onChange={(e) => updateProductQuantity(product, Number(e.target.value))}
                                className="h-9 bg-white text-right text-sm border-slate-300 focus-visible:ring-sky-500 font-bold text-sky-600"
                              />
                            </label>

                            {/* Col 6: ส่วนลด */}
                            <div className="grid grid-cols-[84px_1fr] items-center gap-2 lg:block">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">ส่วนลด</span>
                              <div className="grid grid-cols-[1fr_54px] gap-1.5">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={discountValue}
                                  onChange={(e) => updateProductDiscount(product, 'discountValue', Number(e.target.value))}
                                  className="h-9 bg-white text-right text-sm border-slate-300"
                                />
                                <select
                                  value={discountType}
                                  onChange={(e) => updateProductDiscount(product, 'discountType', e.target.value as 'baht' | 'percent')}
                                  className="h-9 rounded-lg border border-slate-300 bg-white px-1.5 text-xs font-medium text-slate-700 outline-none focus:border-sky-500"
                                >
                                  <option value="baht">บาท</option>
                                  <option value="percent">%</option>
                                </select>
                              </div>
                            </div>

                            {/* Col 7: รวมสุทธิ */}
                            <div className="flex items-center justify-between text-base font-bold text-slate-900 lg:block lg:text-right">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">รวม</span>
                              {formatCurrency(rowTotal)}
                            </div>

                            {/* Col 8: ปุ่มลบ */}
                            <div className="text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-400 hover:bg-red-50 hover:text-red-600"
                                onClick={() => removeCartItem(item.productId)}
                                title="ลบรายการนี้"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Summary Bar */}
              <div className="shrink-0 border-t border-slate-200 bg-white p-4 shadow-lg">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    <Badge className="bg-sky-500 text-white font-bold px-3 py-1 text-sm">
                      เลือกสั่งรวม {cartItems.length} รายการ
                    </Badge>
                    <span>จำนวนชิ้นรวม: <b>{cartItems.reduce((s, i) => s + (i.quantity || 0), 0)}</b> ชิ้น</span>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">ยอดรวมก่อนส่วนลด</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(subtotalBeforeDiscount)}</span>
                    </div>
                    {itemDiscountTotal > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">ส่วนลดรายการ</span>
                        <span className="font-semibold text-red-600">-{formatCurrency(itemDiscountTotal)}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-[1fr_100px_68px] items-center gap-2 text-sm">
                      <span className="text-slate-500">ส่วนลดท้ายบิล</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={billDiscountValue}
                        onChange={(e) => setBillDiscountValue(Math.max(0, Number(e.target.value) || 0))}
                        className="h-9 bg-white text-right text-sm border-slate-300 font-semibold"
                      />
                      <select
                        value={billDiscountType}
                        onChange={(e) => setBillDiscountType(e.target.value as 'baht' | 'percent')}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-500"
                      >
                        <option value="baht">บาท</option>
                        <option value="percent">%</option>
                      </select>
                    </div>
                    <div className="flex items-end justify-between border-t border-slate-200 pt-2">
                      <span className="text-base font-bold text-slate-800">ยอดรวมสุทธิ</span>
                      <span className="text-2xl font-bold text-sky-600">{formatCurrency(cartTotal)}</span>
                    </div>
                    <Button
                      className="h-12 w-full bg-sky-500 text-base font-bold text-white hover:bg-sky-600 shadow-md"
                      disabled={cartItems.length === 0}
                      onClick={handleCreatePO}
                    >
                      สร้างใบสั่งซื้อ (Ctrl + Enter)
                    </Button>
                  </div>
                </div>
              </div>

              {/* Keyboard Shortcut Hints Bar */}
              <div className="bg-slate-900 text-slate-200 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 shrink-0">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 font-semibold text-amber-400">
                    <Keyboard className="w-4 h-4" /> ทางลัดคีย์บอร์ด:
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">↑ / ↓</kbd> เลื่อนเลือกสินค้า
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Enter</kbd> เพิ่มสินค้าลงตาราง
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl + Enter</kbd> บันทึกใบ PO
                  </span>
                </div>
                <div className="text-slate-400">
                  กด <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Esc</kbd> เพื่อยกเลิก
                </div>
              </div>

              {/* Larger Supplier Catalog Dialog */}
              <Dialog open={isSupplierCatalogOpen} onOpenChange={setIsSupplierCatalogOpen}>
                <DialogContent className="max-h-[92dvh] max-w-[95vw] lg:max-w-6xl xl:max-w-7xl overflow-hidden bg-white p-0 text-slate-900 flex flex-col border-slate-200">
                  <DialogHeader className="border-b border-slate-200 px-6 py-4 flex flex-row items-center justify-between shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
                      <Package className="h-6 w-6 text-sky-500" />
                      รายการสินค้าจากผู้จำหน่าย: <span className="text-sky-600">{selectedSupplier?.name}</span>
                    </DialogTitle>
                  </DialogHeader>

                  <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
                    <div className="relative max-w-md">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <Input
                        placeholder="ค้นหาชื่อ หรือ SKU สินค้า..."
                        className="pl-9 bg-white border-slate-300 h-10 text-sm"
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-6">
                    <div className="hidden grid-cols-[48px_minmax(0,1.8fr)_110px_120px_130px_140px] items-center gap-4 rounded-t-xl border border-slate-200 bg-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
                      <div className="text-center">ลำดับ</div>
                      <div>สินค้า</div>
                      <div className="text-right">คงเหลือ</div>
                      <div className="text-right">ต้นทุน/หน่วย</div>
                      <div className="text-center">สถานะสั่งซื้อ</div>
                      <div className="text-right">จัดการ</div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200 lg:rounded-t-none lg:border-t-0 bg-white">
                      {filteredCatalogProducts.length === 0 ? (
                        <div className="flex min-h-64 flex-col items-center justify-center text-center text-slate-500 space-y-2">
                          <PackageOpen className="h-12 w-12 text-slate-300" />
                          <p className="font-semibold text-slate-700">ไม่พบสินค้าจากผู้จำหน่ายนี้</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {filteredCatalogProducts.map((product, idx) => {
                            const item = getCartItem(product.id);
                            return (
                              <div
                                key={product.id}
                                className="grid grid-cols-1 gap-3 px-4 py-3.5 hover:bg-sky-50/40 transition-colors lg:grid-cols-[48px_minmax(0,1.8fr)_110px_120px_130px_140px] lg:items-center"
                              >
                                <div className="hidden lg:block text-center font-semibold text-slate-400 text-sm">
                                  {idx + 1}
                                </div>

                                <div className="min-w-0">
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={(e) => openImagePreview(product, e)}
                                      className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors shadow-sm"
                                      title="กดเพื่อดูรูปสินค้า"
                                    >
                                      <ImageIcon className="w-5 h-5" />
                                    </button>
                                    <div className="min-w-0">
                                      <div className="truncate text-base font-semibold text-slate-900">{product.name}</div>
                                      <div className="truncate text-xs text-slate-500 font-mono">{product.sku}</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between text-sm font-semibold text-slate-700 lg:block lg:text-right">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                                  {product.stock ?? '-'}
                                </div>

                                <div className="flex items-center justify-between text-sm font-bold text-slate-900 lg:block lg:text-right">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">ต้นทุน</span>
                                  {formatCurrency(product.unitCost || product.basePrice || 0)}
                                </div>

                                <div className="flex items-center justify-between lg:justify-center">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">สถานะ</span>
                                  {item ? (
                                    <Badge className="bg-sky-50 text-sky-700 border-sky-200 px-3 py-1 font-semibold">สั่งแล้ว {item.quantity}</Badge>
                                  ) : (
                                    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500 font-normal">ยังไม่สั่ง</Badge>
                                  )}
                                </div>

                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    className="bg-sky-500 text-white hover:bg-sky-600 font-semibold px-4"
                                    onClick={() => updateProductQuantity(product, (item?.quantity || 0) + 1)}
                                  >
                                    {item ? '+1 เพิ่มจำนวน' : '+ เพิ่มในบิล'}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <DialogFooter className="border-t border-slate-200 px-6 py-4 bg-slate-50 shrink-0">
                    <Button onClick={() => setIsSupplierCatalogOpen(false)} className="bg-slate-900 text-white hover:bg-slate-800">
                      ปิดหน้าต่าง (Esc)
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        )}

        {/* Product Image Preview Modal */}
        <Dialog open={previewProduct !== null} onOpenChange={(open) => { if (!open) setPreviewProduct(null); }}>
          <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md p-6">
            <DialogHeader className="mb-2">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <ImageIcon className="w-5 h-5 text-primary" />
                รูปภาพสินค้า: <span className="text-sky-600">{previewProduct?.name}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              {previewImages.length > 0 ? (
                <div className="space-y-3">
                  <div className="aspect-square rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-50 flex items-center justify-center shadow-inner">
                    <img src={previewImages[selectedImageIdx] || previewImages[0]} alt={previewProduct?.name} className="w-full h-full object-cover" />
                  </div>
                  {previewImages.length > 1 && (
                    <div className="flex gap-2 justify-center">
                      {previewImages.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedImageIdx(idx)}
                          className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${selectedImageIdx === idx ? "border-primary ring-2 ring-primary/20" : "border-slate-200 opacity-60 hover:opacity-100"}`}
                        >
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-56 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Package className="w-12 h-12 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">ไม่มีรูปภาพสินค้าสำหรับรายการนี้</p>
                  <p className="text-xs text-slate-400">สามารถเพิ่มรูปได้ในหน้าแก้ไขสินค้า</p>
                </div>
              )}

              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                <span>รหัส SKU: <b className="font-mono text-slate-700">{previewProduct?.sku}</b></span>
                <span>คงเหลือ: <b className="text-slate-900">{previewProduct?.stock ?? '-'}</b></span>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setPreviewProduct(null)} className="w-full border-slate-300">
                ปิดหน้าต่าง (Esc)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl flex items-center gap-2">
            <PackageOpen className="w-8 h-8 text-sky-500" /> ใบสั่งซื้อ (PO)
          </h1>
          <p className="text-slate-500 mt-1">จัดการเอกสารใบสั่งซื้อสินค้าและเปิดใบ PO ถึงผู้จำหน่าย</p>
        </div>
        <Button 
          className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-11 px-6 shadow-sm"
          onClick={openCreateDialog}
        >
          <Plus className="w-5 h-5 mr-2" />
          เปิดใบสั่งซื้อใหม่
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
          <Tabs defaultValue="ALL" onValueChange={setStatusFilter}>
            <TabsList className="bg-slate-100 border border-slate-200">
              <TabsTrigger value="ALL" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">ทั้งหมด</TabsTrigger>
              <TabsTrigger value="DRAFT" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">DRAFT</TabsTrigger>
              <TabsTrigger value="ISSUED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">ISSUED</TabsTrigger>
              <TabsTrigger value="COMPLETED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">COMPLETED</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-slate-500 font-bold">เลข PO</TableHead>
                <TableHead className="text-slate-500 font-bold">ผู้จำหน่าย</TableHead>
                <TableHead className="text-slate-500 font-bold">วันที่สร้าง</TableHead>
                <TableHead className="text-slate-500 font-bold text-right">ยอดรวมสุทธิ</TableHead>
                <TableHead className="text-slate-500 font-bold text-center">สถานะ</TableHead>
                <TableHead className="text-slate-500 font-bold text-center">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-slate-500">
                    กำลังโหลดข้อมูล...
                  </TableCell>
                </TableRow>
              ) : filteredPOs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-slate-500">
                    ไม่พบข้อมูลใบสั่งซื้อ
                  </TableCell>
                </TableRow>
              ) : (
                filteredPOs.map((po) => (
                  <TableRow key={po.id} className="border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => handleViewDetail(po.id)}>
                    <TableCell className="font-bold text-slate-900">{po.poNumber}</TableCell>
                    <TableCell className="text-slate-700 font-medium">{po.supplier?.name || po.supplierName || "-"}</TableCell>
                    <TableCell className="text-slate-600">{formatDate(po.createdAt)}</TableCell>
                    <TableCell className="text-right text-slate-900 font-bold">{formatCurrency(po.totalAmount)}</TableCell>
                    <TableCell className="text-center">{getStatusBadge(po.status)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex gap-2 justify-center">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-sky-600 hover:bg-sky-50" onClick={(e) => { e.stopPropagation(); handleViewDetail(po.id); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {po.status === 'DRAFT' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50" onClick={(e) => handleIssuePO(po.id, e)}>
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                        )}
                        {(po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED') && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50" onClick={(e) => openReceiveDialog(po, e)}>
                            <PackageOpen className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Receive Dialog (GRN) */}
      <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <PackageOpen className="w-5 h-5 text-amber-500" />
              รับสินค้าตามใบสั่งซื้อ (PO: {currentPo?.poNumber})
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow className="border-slate-200">
                  <TableHead className="w-12 text-center text-slate-500 font-bold">ลำดับ</TableHead>
                  <TableHead className="text-slate-500 font-bold">สินค้า</TableHead>
                  <TableHead className="text-center text-slate-500 font-bold">สั่งซื้อ</TableHead>
                  <TableHead className="text-center text-slate-500 font-bold">รับแล้ว</TableHead>
                  <TableHead className="text-right text-slate-500 font-bold w-32">รับเพิ่มครั้งนี้</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiveItems.map((item, idx) => (
                  <TableRow key={idx} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="text-center text-slate-400 font-semibold">{idx + 1}</TableCell>
                    <TableCell className="text-slate-900 font-bold flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => openImagePreview(item, e)}
                        className="w-7 h-7 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-sky-600 shrink-0"
                        title="ดูรูปภาพสินค้า"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                      </button>
                      <span>{item.name}</span>
                    </TableCell>
                    <TableCell className="text-center text-slate-600">{item.orderedQty}</TableCell>
                    <TableCell className="text-center text-emerald-600 font-semibold">{item.receivedQty}</TableCell>
                    <TableCell className="text-right">
                      <Input 
                        type="number" min="0" max={item.orderedQty - item.receivedQty}
                        value={item.toReceive}
                        onChange={(e) => {
                          const newItems = [...receiveItems];
                          newItems[idx].toReceive = Number(e.target.value);
                          setReceiveItems(newItems);
                        }}
                        className="bg-white border-slate-300 h-9 text-right font-bold text-sky-600 focus-visible:ring-sky-500"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsReceiveOpen(false)} className="border-slate-300 text-slate-600 hover:bg-slate-50">
              ยกเลิก
            </Button>
            <Button onClick={handleReceivePO} className="bg-sky-500 hover:bg-sky-600 text-white font-bold">
              ยืนยันการรับสินค้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-4 text-xl font-bold text-slate-900">
              <span>รายละเอียดใบสั่งซื้อ {currentPo?.poNumber}</span>
              {currentPo && getStatusBadge(currentPo.status)}
            </DialogTitle>
          </DialogHeader>
          {currentPo && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 block mb-1">ผู้จำหน่าย</span>
                  <span className="font-bold text-slate-900 text-base">{currentPo.supplier?.name || currentPo.supplierName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">วันที่สร้าง</span>
                  <span className="font-bold text-slate-900 text-base">{formatDate(currentPo.createdAt)}</span>
                </div>
              </div>
              
              <div>
                <h4 className="font-bold text-slate-900 mb-3 border-b border-slate-200 pb-2">รายการสินค้าสั่งซื้อ</h4>
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow className="border-slate-200">
                      <TableHead className="w-12 text-center text-slate-500 font-bold">ลำดับ</TableHead>
                      <TableHead className="text-slate-500 font-bold">สินค้า</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">สั่ง (ชิ้น)</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">รับแล้ว (ชิ้น)</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">ต้นทุน/หน่วย</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">รวมสุทธิ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPo.items?.map((item: any, idx: number) => (
                      <TableRow key={idx} className="border-slate-100 hover:bg-slate-50">
                        <TableCell className="text-center text-slate-400 font-semibold">{idx + 1}</TableCell>
                        <TableCell className="text-slate-900 font-bold flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => openImagePreview(item, e)}
                            className="w-7 h-7 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-sky-600 shrink-0"
                            title="ดูรูปภาพสินค้า"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                          </button>
                          <span>{item.name || item.product?.name}</span>
                        </TableCell>
                        <TableCell className="text-right text-slate-700 font-semibold">{item.quantity}</TableCell>
                        <TableCell className="text-right text-emerald-600 font-bold">{item.receivedQuantity || 0}</TableCell>
                        <TableCell className="text-right text-slate-600">{formatCurrency(item.unitCost)}</TableCell>
                        <TableCell className="text-right text-slate-900 font-bold">{formatCurrency(item.quantity * item.unitCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-right mt-4 pt-4 border-t border-slate-200 flex justify-end">
                  <div className="w-64 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="flex justify-between font-bold text-xl text-slate-900">
                      <span>ยอดสุทธิ</span>
                      <span className="text-sky-600">{formatCurrency(currentPo.totalAmount)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between items-center w-full sm:justify-between border-t border-slate-100 pt-4">
             <div className="flex gap-2">
                {currentPo?.status === 'DRAFT' && (
                  <Button variant="outline" className="border-sky-500 text-sky-600 hover:bg-sky-50 font-bold" onClick={(e) => handleIssuePO(currentPo.id, e)}>
                    <CheckCircle className="w-4 h-4 mr-2" /> ออกใบสั่งซื้อ
                  </Button>
                )}
                {(currentPo?.status === 'ISSUED' || currentPo?.status === 'PARTIALLY_RECEIVED') && (
                  <Button variant="outline" className="border-amber-500 text-amber-600 hover:bg-amber-50 font-bold" onClick={(e) => { setIsDetailOpen(false); openReceiveDialog(currentPo, e); }}>
                    <PackageOpen className="w-4 h-4 mr-2" /> รับสินค้า
                  </Button>
                )}
             </div>
             <Button variant="ghost" onClick={() => setIsDetailOpen(false)} className="text-slate-500 hover:text-slate-900 hover:bg-slate-100">ปิดหน้าต่าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
