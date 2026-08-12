'use client';

import { useState, useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { useProductStore } from '@/lib/store/product-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import { 
  Search, ScanLine, ShoppingCart, Trash2, 
  Minus, Plus, Tag, PauseCircle, PlayCircle, 
  CreditCard, Clock, LogOut, MoreVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { ItemEditPopup } from '@/components/pos/ItemEditPopup';
import { BillDiscountPopup } from '@/components/pos/BillDiscountPopup';
import { OpenShiftModal } from '@/components/pos/OpenShiftModal';
import { CloseShiftModal } from '@/components/pos/CloseShiftModal';
import { HeldBillsSheet } from '@/components/pos/HeldBillsSheet';
import { CustomerSelectModal } from '@/components/pos/CustomerSelectModal';
import { BarcodeScanModal } from '@/components/pos/BarcodeScanModal';
import { CartItem } from '@/lib/types';
import { toast } from 'sonner';

export default function POSPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [editItem, setEditItem] = useState<CartItem | null>(null);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showHeldBills, setShowHeldBills] = useState(false);
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const [showBarcodeScan, setShowBarcodeScan] = useState(false);

  const cart = useCartStore();
  const shiftStore = useShiftStore();
  const authStore = useAuthStore();
  const router = useRouter();
  const { products, categories, fetchProducts, isLoading } = useProductStore();

  useEffect(() => {
    if (!authStore.isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchProducts();
    setMounted(true);
  }, [fetchProducts, authStore.isAuthenticated, router]);

  if (!mounted) return null;

  // Filter products
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.units.some(u => u.barcode && u.barcode.includes(searchQuery));
    const matchesCategory = activeCategory ? p.categoryId === activeCategory : true;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 lg:h-screen lg:overflow-hidden">
      
      {/* --- TOP STATUS BAR --- */}
      <header className="flex flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0 shrink-0">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link href="/dashboard" className="mr-2 text-lg font-bold text-primary sm:text-xl">
            PURIM POS
          </Link>
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
            กะ: {shiftStore.currentShift?.userName || 'ยังไม่เปิดกะ'}
          </Badge>
          {shiftStore.currentShift && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              เงินลิ้นชัก: {formatCurrency(shiftStore.getExpectedCash())}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-slate-600 hover:text-primary"
            onClick={() => toast.info('ประวัติบิลขาย จะเปิดใช้งานใน Phase 5 (ระบบรายงานและประวัติ)')}
          >
            <Clock className="w-4 h-4 mr-2" />
            บิลเก่า
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-slate-600 hover:text-primary"
            onClick={() => setShowHeldBills(true)}
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            บิลพัก ({cart.heldBills.length})
          </Button>
          <div className="hidden h-4 w-px bg-slate-200 mx-2 sm:block" />
          {!shiftStore.currentShift ? (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowOpenShift(true)}>
              เปิดกะ
            </Button>
          ) : (
            <Button size="sm" variant="destructive" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => setShowCloseShift(true)}>
              <LogOut className="w-4 h-4 mr-2" />
              ปิดกะ
            </Button>
          )}
        </div>
      </header>

      {/* --- MAIN CONTENT --- */}
      <div className="flex flex-1 flex-col overflow-visible lg:flex-row lg:overflow-hidden">
        
        {/* LEFT: PRODUCTS */}
        <div className="flex min-w-0 flex-1 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
          
          {/* Toolbar */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-3 sm:flex-row sm:p-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input 
                placeholder="ค้นหาชื่อสินค้า, SKU, บาร์โค้ด..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 bg-white pl-10 text-base sm:text-lg"
              />
            </div>
            <Button 
              size="icon" 
              variant="outline" 
              className="h-12 w-full shrink-0 border-slate-300 bg-white sm:w-12"
              onClick={() => setShowBarcodeScan(true)}
            >
              <ScanLine className="w-5 h-5 text-slate-600" />
            </Button>
          </div>

          {/* Categories */}
          <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50 p-3 sm:p-4 no-scrollbar">
            <Button 
              variant={activeCategory === null ? 'default' : 'outline'}
              className={activeCategory === null ? 'bg-primary hover:bg-primary/90 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}
              onClick={() => setActiveCategory(null)}
            >
              ทั้งหมด
            </Button>
            {categories.map(c => (
              <Button 
                key={c.id}
                variant={activeCategory === c.id ? 'default' : 'outline'}
                className={activeCategory === c.id ? 'bg-primary hover:bg-primary/90 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}
                onClick={() => setActiveCategory(c.id)}
              >
                {c.name}
              </Button>
            ))}
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-visible bg-slate-50 p-3 sm:p-4 lg:overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredProducts.map(p => {
                // For now, always add the base unit when clicking card
                const defaultUnit = p.units[0];
                return (
                  <div 
                    key={p.id}
                    onClick={() => cart.addItem(p, defaultUnit)}
                    className="relative flex cursor-pointer select-none flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-primary/50 hover:bg-sky-50 sm:p-4"
                  >
                    {p.stock < 10 && (
                      <Badge variant="destructive" className="absolute top-2 right-2 bg-red-50 text-xs text-red-600 border-red-200">
                        เหลือ {p.stock}
                      </Badge>
                    )}
                    <div className="mb-3 flex aspect-square w-full items-center justify-center rounded-lg bg-slate-100">
                      <span className="text-3xl sm:text-4xl">📦</span>
                    </div>
                    <div className="mb-1 line-clamp-2 font-semibold leading-tight text-slate-900">
                      {p.name}
                    </div>
                    <div className="mb-2 text-xs text-slate-500">{p.sku}</div>
                    <div className="mt-auto flex items-end justify-between">
                      <div className="text-base font-bold text-primary sm:text-lg">
                        {formatCurrency(defaultUnit.price)}
                      </div>
                      <div className="text-xs text-slate-500">/{defaultUnit.unitName}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {filteredProducts.length === 0 && (
              <div className="flex min-h-80 flex-col items-center justify-center text-slate-500">
                <Search className="w-12 h-12 mb-4 opacity-20" />
                <p>ไม่พบสินค้าที่ค้นหา</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: CART */}
        <div className="flex w-full shrink-0 flex-col bg-white lg:w-[420px] xl:w-[450px]">
          
          {/* Cart Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-slate-700">
              <ShoppingCart className="w-5 h-5 text-primary" />
              <span className="font-semibold">ตะกร้าสินค้า</span>
              <Badge variant="secondary" className="ml-2 bg-primary/10 text-primary">
                {cart.getItemCount()}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-red-600" onClick={cart.clearCart}>
              <Trash2 className="w-4 h-4 mr-2" />
              ล้าง
            </Button>
          </div>

          {/* Customer Selection */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-3">
            <div className="text-sm text-slate-400">
              {cart.customerName ? `ลูกค้า: ${cart.customerName}` : 'ลูกค้าทั่วไป'}
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              onClick={() => setShowCustomerSelect(true)}
            >
              เลือกลูกค้า
            </Button>
          </div>

          {/* Cart Items */}
          <div className="max-h-[45dvh] flex-1 overflow-y-auto p-2 no-scrollbar lg:max-h-none">
            {cart.items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                <ShoppingCart className="w-16 h-16 opacity-20" />
                <p>ตะกร้าว่างเปล่า</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.items.map(item => {
                  const effectivePrice = cart.getEffectivePrice(item);
                  const discountAmt = cart.getItemDiscountAmount(item);
                  const lineTotal = cart.getItemLineTotal(item);
                  
                  return (
                    <div key={`${item.productId}-${item.unitId}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 pr-2">
                          <div className="line-clamp-1 font-medium text-slate-900">{item.name}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                            <span 
                              className="cursor-pointer border-b border-dashed border-slate-300 hover:text-primary"
                              title="คลิกเพื่อแก้ไขราคา"
                              onClick={() => setEditItem(item)}
                            >
                              ฿{effectivePrice.toFixed(2)} /{item.unitName}
                            </span>
                            {item.discountType !== 'none' && (
                              <Badge variant="outline" className="h-5 px-1 bg-red-950/30 text-red-400 border-red-900/50">
                                ลด {item.discountValue}{item.discountType === 'percent' ? '%' : '฿'}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-slate-900">{formatCurrency(lineTotal)}</div>
                          {discountAmt > 0 && (
                            <div className="text-xs text-slate-500 line-through">
                              {formatCurrency(effectivePrice * item.quantity)}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 px-2 text-slate-500 hover:text-primary" 
                          title="ลดราคา/แก้ราคา"
                          onClick={() => setEditItem(item)}
                        >
                          <Tag className="w-3.5 h-3.5 mr-1" />
                          <span className="text-xs">ส่วนลด</span>
                        </Button>
                        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
                          <Button 
                            variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            onClick={() => cart.updateQuantity(item.productId, item.quantity - 1, item.unitId)}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                          <Button 
                            variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            onClick={() => cart.updateQuantity(item.productId, item.quantity + 1, item.unitId)}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart Summary */}
          <div className="shrink-0 space-y-3 border-t border-slate-200 bg-white p-4">
            <div className="flex justify-between text-sm text-slate-400">
              <span>ยอดรวม ({cart.getItemCount()} ชิ้น)</span>
              <span>{formatCurrency(cart.getSubtotal())}</span>
            </div>
            
            <div className="flex justify-between items-center text-sm">
              <div 
                className="flex cursor-pointer items-center gap-1 border-b border-dashed border-slate-300 pb-0.5 text-slate-500 hover:text-primary"
                title="คลิกเพื่อเพิ่มส่วนลดท้ายบิล"
                onClick={() => setShowBillDiscount(true)}
              >
                <span>ส่วนลดท้ายบิล</span>
                {cart.billDiscountType !== 'none' && (
                  <Badge variant="outline" className="h-5 px-1 bg-red-950/30 text-red-400 border-red-900/50">
                    {cart.billDiscountValue}{cart.billDiscountType === 'percent' ? '%' : '฿'}
                  </Badge>
                )}
              </div>
              <span className="text-red-400">
                {cart.getBillDiscountAmount() > 0 ? `-${formatCurrency(cart.getBillDiscountAmount())}` : '฿0.00'}
              </span>
            </div>

            <div className="flex justify-between text-xs text-slate-500">
              <span>รวมภาษีมูลค่าเพิ่ม 7%</span>
              <span>{formatCurrency(cart.getVatAmount())}</span>
            </div>

            <div className="flex items-end justify-between border-t border-slate-200 pt-3">
              <span className="text-lg font-medium text-slate-700">ยอดสุทธิ</span>
              <span className="text-2xl font-bold text-primary sm:text-3xl">
                {formatCurrency(cart.getTotal())}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="grid shrink-0 grid-cols-2 gap-3 bg-slate-50 p-4">
            <Button 
              variant="outline" 
              className="h-14 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              onClick={() => cart.holdBill()}
              disabled={cart.items.length === 0}
            >
              <PauseCircle className="w-5 h-5 mr-2" />
              พักบิล
            </Button>
            <Button 
              className="h-14 bg-primary text-lg text-white shadow-lg shadow-primary/20 hover:bg-primary/90"
              disabled={cart.items.length === 0}
              onClick={() => setShowPayment(true)}
            >
              <CreditCard className="w-5 h-5 mr-2" />
              ชำระเงิน
            </Button>
          </div>

        </div>
      </div>
      
      <PaymentModal open={showPayment} onOpenChange={setShowPayment} />
      <ItemEditPopup open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)} item={editItem} />
      <BillDiscountPopup open={showBillDiscount} onOpenChange={setShowBillDiscount} />
      <OpenShiftModal open={showOpenShift} onOpenChange={setShowOpenShift} />
      <CloseShiftModal open={showCloseShift} onOpenChange={setShowCloseShift} />
      <HeldBillsSheet open={showHeldBills} onOpenChange={setShowHeldBills} />
      <CustomerSelectModal open={showCustomerSelect} onOpenChange={setShowCustomerSelect} />
      <BarcodeScanModal open={showBarcodeScan} onOpenChange={setShowBarcodeScan} />
    </div>
  );
}
