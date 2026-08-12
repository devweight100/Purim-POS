'use client';

import { useEffect, useState } from 'react';
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
  Trash2, Search, ChevronLeft, Building2, Package
} from 'lucide-react';
import { toast } from 'sonner';

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

  // For Detail Dialog
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [currentPo, setCurrentPo] = useState<any>(null);

  // For Receive Dialog
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
      setCreateStep('items');
    } catch (error) {
      toast.error("ไม่สามารถโหลดข้อมูลสินค้าของผู้จำหน่ายได้");
    }
  };

  const createCartItemFromProduct = (product: any, quantity = 1) => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
    unitCost: product.unitCost || product.basePrice || 0,
    quantity,
    discountType: 'baht' as 'baht' | 'percent',
    discountValue: 0
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
      toast.error("กรุณาเลือกผู้จำหน่ายและเพิ่มสินค้า");
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
                  เปิดใบสั่งซื้อ (PO) ใหม่
                </h1>
                <p className="text-slate-500 text-sm mt-1">ขั้นตอนที่ 1: กรุณาเลือกผู้จำหน่ายที่ต้องการสั่งซื้อสินค้า</p>
              </div>
              <Button variant="ghost" onClick={() => setViewMode('list')} className="text-slate-500 hover:bg-slate-100">
                ยกเลิก
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
              <div className="mx-auto grid max-w-7xl grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 sm:gap-6">
                {filteredSuppliers.map((supplier) => (
                  <div 
                    key={supplier.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-sky-300 cursor-pointer transition-all flex flex-col items-center text-center group"
                    onClick={() => handleSelectSupplier(supplier)}
                  >
                    <div className="w-12 h-12 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <h3 className="font-semibold text-slate-900 text-lg mb-1">{supplier.name}</h3>
                    <p className="text-slate-500 text-sm">{supplier.phone || 'ไม่มีเบอร์ติดต่อ'}</p>
                    {supplier.creditTerms && (
                      <Badge variant="outline" className="mt-3 text-xs text-slate-600 border-slate-200 bg-slate-50">
                        เครดิต {supplier.creditTerms}
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
                <h2 className="flex min-w-0 items-center gap-2 font-semibold text-slate-900">
                  <Building2 className="w-4 h-4 text-sky-500" />
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
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">ตารางสั่งของ</h3>
                    <p className="mt-1 text-xs text-slate-500">ค้นหาสินค้าเพื่อเพิ่มเข้าตาราง หรือเปิดดูสินค้าจากผู้จำหน่ายทั้งหมด</p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                    <div className="relative w-full sm:w-80">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                      <Input
                        placeholder="ค้นหาชื่อ, SKU, บาร์โค้ด..."
                        className="h-9 bg-white pl-8 text-sm border-slate-300 focus-visible:ring-sky-500"
                        value={searchProduct}
                        onChange={(e) => setSearchProduct(e.target.value)}
                      />
                      {searchProduct.trim() && (
                        <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                          {filteredSupplierProducts.slice(0, 8).length === 0 ? (
                            <div className="p-3 text-sm text-slate-500">ไม่พบสินค้าที่ค้นหา</div>
                          ) : (
                            filteredSupplierProducts.slice(0, 8).map((product) => {
                              const item = getCartItem(product.id);
                              return (
                                <button
                                  key={product.id}
                                  type="button"
                                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-sky-50"
                                  onClick={() => {
                                    updateProductQuantity(product, (item?.quantity || 0) + 1);
                                    setSearchProduct('');
                                  }}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-slate-900">{product.name}</div>
                                    <div className="truncate text-xs text-slate-500">{product.sku} · คงเหลือ {product.stock ?? '-'}</div>
                                  </div>
                                  <Badge className={item ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-600'}>
                                    {item ? `สั่งแล้ว ${item.quantity}` : 'เพิ่ม'}
                                  </Badge>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      onClick={() => setIsSupplierCatalogOpen(true)}
                    >
                      <Package className="mr-2 h-4 w-4" />
                      ดูสินค้าจากผู้จำหน่าย
                    </Button>
                  </div>
                </div>
                
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="hidden grid-cols-[minmax(0,1.6fr)_90px_96px_88px_150px_112px_44px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
                    <div>สินค้า</div>
                    <div className="text-right">คงเหลือ</div>
                    <div className="text-right">ต้นทุน</div>
                    <div className="text-right">จำนวน</div>
                    <div>ส่วนลดรายการ</div>
                    <div className="text-right">รวม</div>
                    <div />
                  </div>

                  {cartItems.length === 0 ? (
                    <div className="flex min-h-80 flex-col items-center justify-center text-center text-slate-500">
                      <PackageOpen className="mb-3 h-12 w-12 text-slate-300" />
                      <p>ยังไม่มีสินค้าในตารางสั่งของ</p>
                      <p className="mt-1 text-sm">ค้นหาสินค้าด้านบน หรือกดดูสินค้าจากผู้จำหน่ายเพื่อเพิ่มรายการ</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {cartItems.map((item) => {
                        const product = supplierProducts.find(p => p.id === item.productId) || { ...item, id: item.productId };
                        const unitCost = item.unitCost;
                        const quantity = item.quantity;
                        const discountType = item.discountType;
                        const discountValue = item.discountValue;
                        const rowTotal = getItemTotal(item);

                        return (
                          <div
                            key={item.productId}
                            className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-slate-50 lg:grid-cols-[minmax(0,1.6fr)_90px_96px_88px_150px_112px_44px] lg:items-center"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Package className="h-5 w-5 shrink-0 text-slate-300" />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-slate-900">{product.name}</div>
                                  <div className="truncate text-xs text-slate-500">{product.sku}</div>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-sm text-slate-600 lg:block lg:text-right">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                              {item.stock ?? product.stock ?? '-'}
                            </div>

                            <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                              <span className="lg:hidden">ต้นทุน</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={unitCost}
                                onChange={(e) => updateProductUnitCost(product, Number(e.target.value))}
                                className="h-9 bg-white text-right text-sm border-slate-300"
                              />
                            </label>

                            <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                              <span className="lg:hidden">จำนวน</span>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={quantity}
                                onChange={(e) => updateProductQuantity(product, Number(e.target.value))}
                                className="h-9 bg-white text-right text-sm border-slate-300"
                              />
                            </label>

                            <div className="grid grid-cols-[84px_1fr] items-center gap-2 lg:block">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">ส่วนลด</span>
                              <div className="grid grid-cols-[1fr_54px] gap-2">
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
                                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-sky-500"
                              >
                                <option value="baht">บาท</option>
                                <option value="percent">%</option>
                              </select>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-sm font-semibold text-slate-900 lg:block lg:text-right">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">รวม</span>
                              {formatCurrency(rowTotal)}
                            </div>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => removeCartItem(item.productId)}
                              title="ลบออกจากรายการ"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-white p-4 shadow-[0_-4px_10px_-6px_rgba(15,23,42,0.25)]">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="flex min-w-0 items-center gap-3 text-sm text-slate-500">
                    <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                      เลือกแล้ว {cartItems.length} รายการ
                    </Badge>
                    <span className="truncate">ใส่จำนวนมากกว่า 0 เพื่อเพิ่มสินค้าเข้าใบ PO</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">ยอดรวมก่อนส่วนลด</span>
                      <span className="font-medium text-slate-900">{formatCurrency(subtotalBeforeDiscount)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">ส่วนลดรายการ</span>
                      <span className="font-medium text-red-600">-{formatCurrency(itemDiscountTotal)}</span>
                    </div>
                    <div className="grid grid-cols-[1fr_96px_68px] items-center gap-2 text-sm">
                      <span className="text-slate-500">ส่วนลดท้ายบิล</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={billDiscountValue}
                        onChange={(e) => setBillDiscountValue(Math.max(0, Number(e.target.value) || 0))}
                        className="h-9 bg-white text-right text-sm border-slate-300"
                      />
                      <select
                        value={billDiscountType}
                        onChange={(e) => setBillDiscountType(e.target.value as 'baht' | 'percent')}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-sky-500"
                      >
                        <option value="baht">บาท</option>
                        <option value="percent">%</option>
                      </select>
                    </div>
                    <div className="flex items-end justify-between border-t border-slate-200 pt-2">
                      <span className="text-sm font-medium text-slate-700">ยอดรวมสุทธิ</span>
                      <span className="text-2xl font-bold text-sky-600">{formatCurrency(cartTotal)}</span>
                    </div>
                    <Button
                      className="h-12 w-full bg-sky-500 text-base font-semibold text-white hover:bg-sky-600"
                      disabled={cartItems.length === 0}
                      onClick={handleCreatePO}
                    >
                      สร้างใบสั่งซื้อ
                    </Button>
                  </div>
                </div>
              </div>

              <Dialog open={isSupplierCatalogOpen} onOpenChange={setIsSupplierCatalogOpen}>
                <DialogContent className="max-h-[90dvh] max-w-5xl overflow-hidden bg-white p-0 text-slate-900">
                  <DialogHeader className="border-b border-slate-200 px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
                      <Package className="h-5 w-5 text-sky-500" />
                      สินค้าจากผู้จำหน่าย: {selectedSupplier?.name}
                    </DialogTitle>
                  </DialogHeader>

                  <div className="min-h-0 overflow-y-auto p-4">
                    <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_110px_120px_120px] items-center gap-3 rounded-t-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
                      <div>สินค้า</div>
                      <div className="text-right">คงเหลือ</div>
                      <div className="text-right">ต้นทุน</div>
                      <div className="text-center">สถานะ</div>
                      <div className="text-right">จัดการ</div>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-slate-200 lg:rounded-t-none lg:border-t-0">
                      {supplierProducts.length === 0 ? (
                        <div className="flex min-h-56 flex-col items-center justify-center text-center text-slate-500">
                          <PackageOpen className="mb-3 h-10 w-10 text-slate-300" />
                          <p>ไม่พบสินค้าในผู้จำหน่ายนี้</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {supplierProducts.map((product) => {
                            const item = getCartItem(product.id);
                            return (
                              <div
                                key={product.id}
                                className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.5fr)_110px_110px_120px_120px] lg:items-center"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Package className="h-5 w-5 shrink-0 text-slate-300" />
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-medium text-slate-900">{product.name}</div>
                                      <div className="truncate text-xs text-slate-500">{product.sku}</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between text-sm text-slate-600 lg:block lg:text-right">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                                  {product.stock ?? '-'}
                                </div>

                                <div className="flex items-center justify-between text-sm font-medium text-slate-900 lg:block lg:text-right">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">ต้นทุน</span>
                                  {formatCurrency(product.unitCost || product.basePrice || 0)}
                                </div>

                                <div className="flex items-center justify-between lg:justify-center">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">สถานะ</span>
                                  {item ? (
                                    <Badge className="bg-sky-50 text-sky-700 border-sky-200">สั่งแล้ว {item.quantity}</Badge>
                                  ) : (
                                    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">ยังไม่สั่ง</Badge>
                                  )}
                                </div>

                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    className="bg-sky-500 text-white hover:bg-sky-600"
                                    onClick={() => updateProductQuantity(product, (item?.quantity || 0) + 1)}
                                  >
                                    {item ? 'เพิ่มจำนวน' : 'สั่งสินค้า'}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">ใบสั่งซื้อ (PO)</h1>
          <p className="text-slate-500 mt-2">จัดการการสั่งซื้อสินค้าจากผู้จำหน่าย</p>
        </div>
        <Button 
          className="bg-sky-500 hover:bg-sky-600 text-white font-medium"
          onClick={openCreateDialog}
        >
          <Plus className="w-4 h-4 mr-2" />
          เปิดใบสั่งซื้อ
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
          <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-slate-500 font-medium">เลข PO</TableHead>
                <TableHead className="text-slate-500 font-medium">ผู้จำหน่าย</TableHead>
                <TableHead className="text-slate-500 font-medium">วันที่</TableHead>
                <TableHead className="text-slate-500 font-medium text-right">ยอดรวม</TableHead>
                <TableHead className="text-slate-500 font-medium text-center">สถานะ</TableHead>
                <TableHead className="text-slate-500 font-medium text-center">จัดการ</TableHead>
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
                    ไม่พบข้อมูล
                  </TableCell>
                </TableRow>
              ) : (
                filteredPOs.map((po) => (
                  <TableRow key={po.id} className="border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => handleViewDetail(po.id)}>
                    <TableCell className="font-medium text-slate-900">{po.poNumber}</TableCell>
                    <TableCell className="text-slate-600">{po.supplier?.name || po.supplierName || "-"}</TableCell>
                    <TableCell className="text-slate-600">{formatDate(po.createdAt)}</TableCell>
                    <TableCell className="text-right text-slate-900 font-medium">{formatCurrency(po.totalAmount)}</TableCell>
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
      </div>



      {/* Receive Dialog (GRN) */}
      <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">รับสินค้า (PO: {currentPo?.poNumber})</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow className="border-slate-200">
                  <TableHead className="text-slate-500 font-medium">สินค้า</TableHead>
                  <TableHead className="text-center text-slate-500 font-medium">สั่ง</TableHead>
                  <TableHead className="text-center text-slate-500 font-medium">รับแล้ว</TableHead>
                  <TableHead className="text-right text-slate-500 font-medium w-32">รับเพิ่ม</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiveItems.map((item, idx) => (
                  <TableRow key={idx} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="text-slate-900 font-medium">{item.name}</TableCell>
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
                        className="bg-white border-slate-300 h-9 text-right focus-visible:ring-sky-500"
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
            <Button onClick={handleReceivePO} className="bg-sky-500 hover:bg-sky-600 text-white">
              ยืนยันการรับสินค้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-4 text-xl font-bold text-slate-900">
              <span>รายละเอียดใบสั่งซื้อ {currentPo?.poNumber}</span>
              {currentPo && getStatusBadge(currentPo.status)}
            </DialogTitle>
          </DialogHeader>
          {currentPo && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-lg border border-slate-100">
                <div>
                  <span className="text-slate-500 block mb-1">ผู้จำหน่าย</span>
                  <span className="font-semibold text-slate-900">{currentPo.supplier?.name || currentPo.supplierName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">วันที่สร้าง</span>
                  <span className="font-semibold text-slate-900">{formatDate(currentPo.createdAt)}</span>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold text-slate-900 mb-3 border-b border-slate-200 pb-2">รายการสินค้า</h4>
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow className="border-slate-200">
                      <TableHead className="text-slate-500 font-medium">สินค้า</TableHead>
                      <TableHead className="text-right text-slate-500 font-medium">สั่ง (ชิ้น)</TableHead>
                      <TableHead className="text-right text-slate-500 font-medium">รับแล้ว (ชิ้น)</TableHead>
                      <TableHead className="text-right text-slate-500 font-medium">ต้นทุน</TableHead>
                      <TableHead className="text-right text-slate-500 font-medium">รวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPo.items?.map((item: any, idx: number) => (
                      <TableRow key={idx} className="border-slate-100 hover:bg-slate-50">
                        <TableCell className="text-slate-900 font-medium">{item.name || item.product?.name}</TableCell>
                        <TableCell className="text-right text-slate-600">{item.quantity}</TableCell>
                        <TableCell className="text-right text-emerald-600 font-medium">{item.receivedQuantity || 0}</TableCell>
                        <TableCell className="text-right text-slate-600">{formatCurrency(item.unitCost)}</TableCell>
                        <TableCell className="text-right text-slate-900 font-semibold">{formatCurrency(item.quantity * item.unitCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-right mt-4 pt-4 border-t border-slate-200 flex justify-end">
                  <div className="w-56 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div className="flex justify-between font-bold text-lg text-slate-900">
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
                  <Button variant="outline" className="border-sky-500 text-sky-600 hover:bg-sky-50" onClick={(e) => handleIssuePO(currentPo.id, e)}>
                    <CheckCircle className="w-4 h-4 mr-2" /> ออกใบสั่งซื้อ
                  </Button>
                )}
                {(currentPo?.status === 'ISSUED' || currentPo?.status === 'PARTIALLY_RECEIVED') && (
                  <Button variant="outline" className="border-amber-500 text-amber-600 hover:bg-amber-50" onClick={(e) => { setIsDetailOpen(false); openReceiveDialog(currentPo, e); }}>
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
