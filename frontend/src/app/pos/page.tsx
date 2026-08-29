'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { useProductStore } from '@/lib/store/product-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import { useGlobalBarcodeScanner } from '@/lib/use-scanner';
import { getProductPackagingUnits } from '@/lib/cart-pricing';
import { 
  Search, ScanLine, ShoppingCart, Trash2, 
  Minus, Plus, Tag, PauseCircle, PlayCircle, 
  CreditCard, Clock, LogOut, Percent, Check, Receipt
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
import { OrderHistoryModal } from '@/components/pos/OrderHistoryModal';
import { NumpadPopup } from '@/components/pos/NumpadPopup';
import { PosListLayout } from '@/components/pos/PosListLayout';
import { SelectUnitModal } from '@/components/pos/SelectUnitModal';
import { RedeemPointsModal } from '@/components/pos/RedeemPointsModal';
import { PosDebtSelectModal } from '@/components/pos/PosDebtSelectModal';
import { ProductClaimModal } from '@/components/pos/ProductClaimModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';
import { CartItem, Product, ProductUnit, ClaimRecord } from '@/lib/types';
import { ShieldAlert } from 'lucide-react';
import { getProductAvailableUnits, getDefaultSelectedUnit } from '@/lib/product-unit-helpers';
import { getCustomerById, Customer } from '@/lib/customer-service';
import { toast } from 'sonner';

const PAGE_SIZE = 32;

function PosProductCardItem({
  product,
  searchQuery,
  onAddToCart,
}: {
  product: Product;
  searchQuery: string;
  onAddToCart: (product: Product, unit: ProductUnit) => void;
}) {
  const units = useMemo(() => getProductAvailableUnits(product), [product]);
  const defaultUnit = useMemo(() => getDefaultSelectedUnit(product, units, searchQuery), [product, units, searchQuery]);
  const [activeUnitId, setActiveUnitId] = useState<string>(defaultUnit.id || defaultUnit.unitName);

  useEffect(() => {
    setActiveUnitId(defaultUnit.id || defaultUnit.unitName);
  }, [defaultUnit]);

  const activeUnit = units.find(u => u.id === activeUnitId || u.unitName === activeUnitId) || defaultUnit;

  return (
    <div 
      onClick={() => onAddToCart(product, activeUnit)}
      className="relative flex cursor-pointer select-none flex-col rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-xs transition-all hover:border-sky-400 hover:bg-sky-50/40 hover:shadow-md group"
    >
      {product.stock <= (product.minStockAlert !== undefined && product.minStockAlert !== null ? Number(product.minStockAlert) : 10) && (
        <Badge variant="destructive" className="absolute top-2 right-2 bg-red-50 text-xs text-red-600 border-red-200 z-10 font-bold">
          เหลือ {product.stock}
        </Badge>
      )}

      <div className="mb-2.5 flex aspect-square w-full items-center justify-center rounded-xl bg-slate-100 overflow-hidden group-hover:scale-102 transition-transform">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl sm:text-4xl">📦</span>
        )}
      </div>

      <div className="mb-1 line-clamp-2 font-black text-sm leading-snug text-slate-900">
        {product.name}
      </div>
      <div className="mb-2 text-xs text-slate-400 font-mono">{product.sku}</div>

      {/* Packaging Units Selector Buttons */}
      {units.length > 1 ? (
        <div className="mt-auto pt-2 border-t border-slate-100 flex flex-wrap gap-1">
          {units.map((u) => {
            const isOutOfStock = product.stock < u.factor;
            const isActive = activeUnit.unitName === u.unitName;

            return (
              <button
                key={u.id || u.unitName}
                type="button"
                disabled={isOutOfStock}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isOutOfStock) {
                    setActiveUnitId(u.id || u.unitName);
                    onAddToCart(product, u);
                  }
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 cursor-pointer ${
                  isOutOfStock
                    ? 'opacity-40 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through'
                    : isActive
                    ? 'bg-sky-600 text-white border-sky-600 shadow-xs font-black ring-2 ring-sky-300'
                    : 'bg-slate-50 hover:bg-sky-100 hover:text-sky-900 text-slate-700 border-slate-300'
                }`}
                title={isOutOfStock ? `สต๊อกไม่พอ (ต้องใช้ ${u.factor} หน่วย)` : `เลือก ${u.unitName}`}
              >
                <span>{u.unitName}</span>
                <span className="font-mono text-xs opacity-90">{formatCurrency(u.price)}</span>
                {isOutOfStock && <span className="text-[11px] text-red-500 font-bold ml-0.5">(หมด)</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-auto flex items-end justify-between pt-1">
          <div className="text-base font-extrabold text-sky-700 sm:text-lg">
            {formatCurrency(activeUnit.price)}
          </div>
          <div className="text-xs text-slate-500 font-bold">/{activeUnit.unitName}</div>
        </div>
      )}
    </div>
  );
}

export default function POSPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [mounted, setMounted] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [editItem, setEditItem] = useState<CartItem | null>(null);
  const [qtyEditItem, setQtyEditItem] = useState<CartItem | null>(null);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showHeldBills, setShowHeldBills] = useState(false);
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const [showBarcodeScan, setShowBarcodeScan] = useState(false);
  const [showOrderHistoryModal, setShowOrderHistoryModal] = useState(false);
  const [unitModalProduct, setUnitModalProduct] = useState<Product | null>(null);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [viewMode, setViewMode] = useState<'touch_screen' | 'list_view'>('touch_screen');
  const [paymentInitialMethod, setPaymentInitialMethod] = useState<'SPLIT' | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [showDebtCollectModal, setShowDebtCollectModal] = useState(false);
  const [debtTargetCustomer, setDebtTargetCustomer] = useState<Customer | null>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [completedClaimForPdf, setCompletedClaimForPdf] = useState<ClaimRecord | null>(null);
  const [showClaimPdfModal, setShowClaimPdfModal] = useState(false);

  const cart = useCartStore();
  const shiftStore = useShiftStore();
  const authStore = useAuthStore();
  const router = useRouter();
  const { products, categories, fetchProducts } = useProductStore();

  useEffect(() => {
    if (cart.customerId) {
      setActiveCustomer(getCustomerById(cart.customerId));
    } else {
      setActiveCustomer(null);
    }
  }, [cart.customerId]);

  const cartBottomRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleEmptySpaceClick = (e: React.MouseEvent) => {
    const isModalOpen = showPayment || showOpenShift || showCloseShift || editItem || showCustomerSelect || showHeldBills || qtyEditItem || showDebtCollectModal;
    if (isModalOpen) return;
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], dialog, label');
    if (!isInteractive && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // Auto-scroll to bottom of cart when items change
  useEffect(() => {
    if (cart.items.length > 0 && cartBottomRef.current) {
      cartBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cart.items.length, cart.items]);

  const handleOpenNormalPayment = () => {
    setPaymentInitialMethod(null);
    setShowPayment(true);
  };

  const handleOpenSplitPayment = () => {
    setPaymentInitialMethod('SPLIT');
    setShowPayment(true);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('pos_screen_mode');
      if (savedMode === 'list_view' || savedMode === 'touch_screen') {
        setViewMode(savedMode);
      }
    }
  }, []);

  const handleViewModeChange = (mode: 'touch_screen' | 'list_view') => {
    setViewMode(mode);
    try {
      localStorage.setItem('pos_screen_mode', mode);
    } catch {}
    toast.info(`เปลี่ยนรูปแบบหน้าจอเป็น "${mode === 'touch_screen' ? 'หน้าจอแบบ touch screen' : 'หน้าจอแบบรายการ'}"`);
  };

  useEffect(() => {
    setMounted(true);
    fetchProducts();
  }, [fetchProducts]);

  // Auto popup OpenShiftModal when entering POS page if shift is not open and not skipped today
  useEffect(() => {
    if (mounted) {
      const isShiftOpen = shiftStore.currentShift?.isOpen === true;
      const todayStr = new Date().toISOString().split('T')[0];
      let skippedDate: string | null = null;
      try {
        skippedDate = localStorage.getItem('pos_shift_skipped_date');
      } catch (e) {}

      if (!isShiftOpen && skippedDate !== todayStr) {
        setShowOpenShift(true);
      }
    }
  }, [mounted, shiftStore.currentShift]);

  // Reset pagination limit on search/category filter change
  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [searchQuery, activeCategory]);

  // Global Barcode Scanner Listener (scans automatically regardless of cursor focus)
  useGlobalBarcodeScanner((scannedBarcode) => {
    if (showPayment || showOpenShift || showCloseShift || editItem || showCustomerSelect || showHeldBills) return;

    const code = scannedBarcode.trim().toLowerCase();
    if (!code) return;

    const matchedProduct = products.find(p => {
      const matchSku = p.sku?.toLowerCase().trim() === code;
      const matchUnitBarcode = p.units?.some(u => u.barcode?.toLowerCase().trim() === code);
      const matchProductBarcodes = (p as any).barcodes?.some((b: any) => b.barcode?.toLowerCase().trim() === code);
      const pkgUnits = getProductPackagingUnits(p.id);
      const matchPkgBarcode = pkgUnits.some(u => u.barcode?.toLowerCase().trim() === code);
      return matchSku || matchUnitBarcode || matchProductBarcodes || matchPkgBarcode;
    });

    if (matchedProduct) {
      const pkgUnits = getProductPackagingUnits(matchedProduct.id);
      const matchedPkg = pkgUnits.find(u => u.barcode?.toLowerCase().trim() === code);
      let unit = matchedProduct.units?.find(u => u.barcode?.toLowerCase().trim() === code) || matchedProduct.units[0];
      if (matchedPkg) {
        unit = {
          id: `pkg-${matchedProduct.id}-${matchedPkg.name}`,
          unitName: matchedPkg.name,
          factor: matchedPkg.multiplier,
          price: matchedPkg.priceLevel1 || (unit.price * matchedPkg.multiplier),
          barcode: matchedPkg.barcode,
        };
      }

      // Check if item is already in cart to provide clear feedback
      const existingItem = cart.items.find(
        i => i.productId === matchedProduct.id && i.unitId === unit.id
      );
      const currentQty = existingItem ? existingItem.quantity : 0;
      const newQty = currentQty + 1;

      cart.addItem(matchedProduct, unit);
      setSearchQuery('');

      if (existingItem) {
        toast.success(`⚡ สแกนสินค้าเดิมซ้ำ: ${matchedProduct.name} (+1 รวมเป็น ${newQty} ${unit.unitName})`);
      } else {
        toast.success(`⚡ สแกนบาร์โค้ดสำเร็จ: ${matchedProduct.name} (${unit.unitName})`);
      }
    } else {
      toast.error(`ไม่พบสินค้าจากบาร์โค้ด: ${scannedBarcode}`);
    }
  }, mounted);

  // POS Global Keyboard Shortcuts (F12, F10, Ctrl+H, Ctrl+M, Ctrl+E, Ctrl+P) - Supports Toggle & Thai/English OS layouts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const keyLower = e.key ? e.key.toLowerCase() : '';

      // F10 (or Ctrl+Shift+P) -> Toggle Held Bills Sheet
      if (code === 'F10' || keyLower === 'f10' || (e.ctrlKey && e.shiftKey && (code === 'KeyP' || keyLower === 'p'))) {
        e.preventDefault();
        setShowHeldBills(prev => !prev);
      }
      // F12 -> Toggle Payment Modal
      else if (code === 'F12' || keyLower === 'f12') {
        e.preventDefault();
        setShowPayment(prev => {
          if (prev) return false;
          if (useCartStore.getState().items.length > 0) {
            setPaymentInitialMethod(null);
            return true;
          }
          return false;
        });
      }
      // Ctrl + H -> Toggle Order History Modal
      else if (e.ctrlKey && (code === 'KeyH' || keyLower === 'h')) {
        e.preventDefault();
        setShowOrderHistoryModal(prev => !prev);
      }
      // Ctrl + M -> Toggle Member Customer Select Modal
      else if (e.ctrlKey && (code === 'KeyM' || keyLower === 'm')) {
        e.preventDefault();
        setShowCustomerSelect(prev => !prev);
      }
      // Ctrl + E -> Clear Cart
      else if (e.ctrlKey && (code === 'KeyE' || keyLower === 'e')) {
        e.preventDefault();
        useCartStore.getState().clearCart();
      }
      // Ctrl + P -> Hold Bill or Toggle Held Bills Sheet
      else if (e.ctrlKey && (code === 'KeyP' || keyLower === 'p')) {
        e.preventDefault();
        setShowHeldBills(prev => {
          if (prev) return false; // If held bills sheet is open, close it!
          const currentCart = useCartStore.getState();
          if (currentCart.items.length > 0) {
            currentCart.holdBill();
            toast.success('📌 พักบิลปัจจุบันเรียบร้อยแล้ว');
            return false;
          }
          return true; // Open held bills sheet
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  // Filter products in memory (takes ~1ms in JS)
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(q) || 
                            p.sku.toLowerCase().includes(q) ||
                            p.units.some(u => 
                              (u.barcode && u.barcode.includes(searchQuery)) ||
                              (u.unitName && u.unitName.toLowerCase().includes(q))
                            );
      const matchesCategory = activeCategory ? p.categoryId === activeCategory : true;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, activeCategory]);

  // High-performance lazy pagination (render top N cards)
  const visibleProducts = useMemo(() => {
    return filteredProducts.slice(0, displayLimit);
  }, [filteredProducts, displayLimit]);

  const handleProductCardClick = (product: Product) => {
    if (product.units && product.units.length > 1) {
      setUnitModalProduct(product);
      setShowUnitModal(true);
    } else {
      cart.addItem(product, product.units[0]);
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-slate-100 p-6 text-slate-800">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-2xl shadow-lg mb-3 animate-pulse">
          P
        </div>
        <h2 className="text-lg font-black text-slate-900">กำลังเปิดระบบขายหน้าร้าน (POS)...</h2>
        <p className="text-xs text-slate-500 mt-1">กำลังเตรียมข้อมูลสินค้าและระบบขาย</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 lg:h-screen lg:overflow-hidden" onClick={handleEmptySpaceClick}>
      
      {/* --- TOP STATUS BAR --- */}
      <header className="flex flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0 shrink-0">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link href="/dashboard" className="mr-2 text-lg font-bold text-primary sm:text-xl">
            PURIM POS
          </Link>
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
            กะ: {shiftStore.isShiftOpen() ? shiftStore.currentShift?.userName : 'ยังไม่เปิดกะ'}
          </Badge>
          {shiftStore.isShiftOpen() && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              เงินลิ้นชัก: {formatCurrency(shiftStore.getExpectedCash())}
            </Badge>
          )}

          {/* VAT 7% Toggle in Top Header */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs ml-auto sm:ml-2">
            <button
              type="button"
              onClick={() => { cart.setVatEnabled(true); toast.success('เปิดโหมดคิดภาษี VAT 7%'); }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${cart.isVatEnabled ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              มี VAT 7%
            </button>
            <button
              type="button"
              onClick={() => { cart.setVatEnabled(false); toast.info('เปลี่ยนเป็นโหมด ไม่มี VAT (0%)'); }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${!cart.isVatEnabled ? "bg-slate-700 text-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              ไม่มี VAT (0%)
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Screen View Mode Option Selector */}
          <select 
            value={viewMode}
            onChange={(e) => handleViewModeChange(e.target.value as 'touch_screen' | 'list_view')}
            className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs font-bold rounded-md px-2.5 py-1.5 outline-none shadow-sm cursor-pointer transition-all"
          >
            <option value="touch_screen">📱 หน้าจอแบบ touch screen</option>
            <option value="list_view">📋 หน้าจอแบบรายการ</option>
          </select>

          <Button 
            variant="ghost" 
            size="sm" 
            className="text-slate-600 hover:text-primary font-bold"
            onClick={() => setShowOrderHistoryModal(prev => !prev)}
          >
            <Clock className="w-4 h-4 mr-2" />
            ประวัติการขาย (Ctrl+H)
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-rose-700 hover:bg-rose-50 font-bold border border-rose-200 shadow-2xs"
            onClick={() => {
              setDebtTargetCustomer(activeCustomer);
              setShowDebtCollectModal(true);
            }}
          >
            <Receipt className="w-4 h-4 mr-1.5 text-rose-600" />
            รับชำระหนี้
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-indigo-700 hover:bg-indigo-50 font-bold border border-indigo-200 shadow-2xs"
            onClick={() => setShowClaimModal(true)}
            title="รับเคลมสินค้า / ตรวจสอบประวัติการซื้อ"
          >
            <ShieldAlert className="w-4 h-4 mr-1.5 text-indigo-600" />
            รับเคลมสินค้า
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-slate-600 hover:text-primary"
            onClick={() => setShowHeldBills(prev => !prev)}
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            บิลพัก ({cart.heldBills.length})
          </Button>
          <div className="hidden h-4 w-px bg-slate-200 mx-2 sm:block" />
          {!shiftStore.isShiftOpen() ? (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold" onClick={() => setShowOpenShift(true)}>
              เปิดกะ
            </Button>
          ) : (
            <Button size="sm" variant="destructive" className="bg-red-600 hover:bg-red-700 text-white font-bold" onClick={() => setShowCloseShift(true)}>
              <LogOut className="w-4 h-4 mr-2" />
              ปิดกะ
            </Button>
          )}
        </div>
      </header>

      {/* --- MAIN CONTENT --- */}
      {viewMode === 'list_view' ? (
        <PosListLayout 
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onOpenPayment={() => setShowPayment(prev => {
            if (prev) return false;
            if (useCartStore.getState().items.length > 0) {
              setPaymentInitialMethod(null);
              return true;
            }
            return false;
          })}
          onOpenSplitPayment={handleOpenSplitPayment}
          onOpenBillDiscount={() => setShowBillDiscount(prev => !prev)}
          onEditItem={(item) => setEditItem(item)}
          onSelectCustomer={() => setShowCustomerSelect(prev => !prev)}
          onOpenHoldBills={() => setShowHeldBills(prev => !prev)}
          onOpenHistory={() => setShowOrderHistoryModal(prev => !prev)}
          onOpenBarcodeScan={() => setShowBarcodeScan(prev => !prev)}
          onOpenDebtPay={(cust) => {
            setDebtTargetCustomer(cust || activeCustomer);
            setShowDebtCollectModal(true);
          }}
          onOpenNumpadQty={(item) => setQtyEditItem(item)}
        />
      ) : (
      <div className="flex flex-1 flex-col overflow-visible lg:flex-row lg:overflow-hidden">
        
        {/* LEFT: PRODUCTS */}
        <div className="flex min-w-0 flex-1 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
          
          {/* Editing Order Banner */}
          {cart.editingOrderId && (
            <div className="bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between shadow-md shrink-0">
              <span className="font-extrabold text-xs sm:text-sm flex items-center gap-2">
                ✏️ กำลังอยู่ในโหมดแก้ไขรายการบิล #{cart.editingOrderId} (เมื่อกดชำระเงินจะบันทึกทับบิลเดิมให้อัตโนมัติ)
              </span>
              <button 
                type="button"
                onClick={() => cart.clearCart()}
                className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1 rounded-lg transition-colors border border-white/30"
              >
                ยกเลิกการแก้ไข
              </button>
            </div>
          )}
          
          {/* Toolbar */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-3 sm:flex-row sm:p-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input 
                placeholder="ค้นหาชื่อสินค้า, SKU, บาร์โค้ด (หรือยิงสแกนเนอร์ได้ทันที)..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredProducts.length > 0) {
                    e.preventDefault();
                    const matched = filteredProducts[0];
                    cart.addItem(matched, matched.units[0]);
                    setSearchQuery('');
                    toast.success(`เพิ่ม ${matched.name} ลงตะกร้าแล้ว`);
                  }
                }}
                className="h-12 bg-white pl-10 text-base sm:text-lg"
              />
            </div>
            <Button 
              size="icon" 
              variant="outline" 
              className="h-12 w-full shrink-0 border-slate-300 bg-white sm:w-12"
              onClick={() => setShowBarcodeScan(true)}
              title="เปิดกล้องสแกนบาร์โค้ด"
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

          {/* Status info bar */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-100 border-b border-slate-200 text-xs text-slate-600 font-medium">
            <span>แสดง {visibleProducts.length} จากทั้งหมด {filteredProducts.length} รายการ</span>
            <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1 font-semibold">
              ⚡ สแกนเนอร์บาร์โค้ดทำงานอัตโนมัติ ไม่ต้องคลิกช่องค้นหา
            </span>
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-visible bg-slate-50 p-3 sm:p-4 lg:overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visibleProducts.map(p => (
                <PosProductCardItem
                  key={p.id}
                  product={p}
                  searchQuery={searchQuery}
                  onAddToCart={(prod, unit) => {
                    cart.addItem(prod, unit);
                    toast.success(`เพิ่ม ${prod.name} (${unit.unitName}) ลงตะกร้าแล้ว`);
                  }}
                />
              ))}
            </div>

            {/* Pagination Load More */}
            {filteredProducts.length > displayLimit && (
              <div className="py-6 text-center">
                <Button
                  variant="outline"
                  className="bg-white border-slate-300 text-slate-700 hover:bg-slate-100 font-bold px-6 shadow-sm"
                  onClick={() => setDisplayLimit(prev => prev + PAGE_SIZE)}
                >
                  โหลดสินค้าเพิ่มเติม (+{Math.min(PAGE_SIZE, filteredProducts.length - displayLimit)})
                </Button>
              </div>
            )}

            {filteredProducts.length === 0 && (
              <div className="flex min-h-80 flex-col items-center justify-center text-slate-500 space-y-2">
                <Search className="w-12 h-12 opacity-20" />
                <p className="font-semibold text-slate-700">ไม่พบสินค้าที่ตรงกับการค้นหา</p>
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
              <span className="font-bold text-base">ตะกร้าสินค้า</span>
              <Badge variant="secondary" className="ml-2 bg-primary/10 text-primary font-bold">
                {cart.getItemCount()} ชิ้น
              </Badge>
            </div>
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-red-600" onClick={cart.clearCart}>
              <Trash2 className="w-4 h-4 mr-1.5" />
              ล้างตะกร้า
            </Button>
          </div>

          {/* Customer Selection */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-800 truncate">
                {cart.customerName ? `👤 ${cart.customerName}` : '👤 ลูกค้าทั่วไป'}
              </div>
              {activeCustomer && (
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                  <span className="text-amber-700 font-bold">🪙 {activeCustomer.points.toLocaleString()} แต้ม</span>
                  {activeCustomer.priceLevel > 1 && (
                    <span className="text-sky-700 font-semibold">• ระดับราคา {activeCustomer.priceLevel}</span>
                  )}
                  {cart.getPointsDiscountAmount() > 0 && (
                    <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                      ลดแต้ม -{formatCurrency(cart.getPointsDiscountAmount())}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {activeCustomer && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 font-bold text-xs"
                  onClick={() => setShowRedeemModal(true)}
                >
                  🎁 {cart.getPointsDiscountAmount() > 0 ? 'ปรับแต้ม' : 'ใช้แต้ม'}
                </Button>
              )}
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-medium text-xs"
                onClick={() => setShowCustomerSelect(true)}
              >
                {cart.customerName ? 'เปลี่ยน' : 'เลือกลูกค้า'}
              </Button>
            </div>
          </div>

          {/* Cart Item List */}
          <div className="flex-1 overflow-y-auto p-4">
            {cart.items.length === 0 ? (
              <div className="flex h-full min-h-48 flex-col items-center justify-center text-slate-400 space-y-2">
                <ShoppingCart className="w-12 h-12 opacity-20" />
                <p className="font-semibold text-slate-600">ไม่มีสินค้าในตะกร้า</p>
                <p className="text-xs text-slate-400">เลือกสินค้าจากรายการ หรือยิงสแกนเนอร์บาร์โค้ด</p>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.items.map((item) => {
                  const lineTotal = cart.getItemLineTotal(item);
                  const effectivePrice = cart.getEffectivePrice(item);
                  const product = products.find(p => p.id === item.productId);

                  return (
                    <div 
                      key={`${item.productId}-${item.unitId}`}
                      className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-slate-300"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900">{item.name}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{item.sku}</span>
                            <span>·</span>
                            <span className="font-semibold text-slate-700">{item.unitName}</span>
                          </div>
                        </div>
                        <Button 
                          variant="ghost" size="icon" 
                          className="h-6 w-6 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                          onClick={() => cart.removeItem(item.productId, item.unitId)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                      <div className="flex items-center justify-between text-sm pt-1">
                        <div className="font-bold text-slate-900">
                          {formatCurrency(effectivePrice)}
                        </div>
                        <div className="font-bold text-primary text-base">
                          {formatCurrency(lineTotal)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          onClick={() => setEditItem(item)}
                        >
                          <Tag className="w-3.5 h-3.5 mr-1" />
                          <span>แก้ไขราคา/ส่วนลด</span>
                        </Button>
                        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1">
                          <Button 
                            variant="ghost" size="icon" className="h-9 w-9 text-slate-600 hover:bg-white hover:text-slate-900 shadow-sm"
                            onClick={() => cart.updateQuantity(item.productId, item.quantity - 1, item.unitId)}
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                          <button
                            type="button"
                            onClick={() => setQtyEditItem(item)}
                            className="w-12 h-9 text-center text-sm font-bold bg-white border border-slate-200 rounded hover:border-sky-400 hover:bg-sky-50 transition-all cursor-pointer flex items-center justify-center text-slate-800 shadow-xs"
                            title="คลิกเพื่อแก้ไขจำนวนด้วย Numpad"
                          >
                            {item.quantity}
                          </button>
                          <Button 
                            variant="ghost" size="icon" className="h-9 w-9 text-slate-600 hover:bg-white hover:text-slate-900 shadow-sm"
                            onClick={() => cart.updateQuantity(item.productId, item.quantity + 1, item.unitId)}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={cartBottomRef} />
              </div>
            )}
          </div>

          {/* Cart Summary */}
          <div className="shrink-0 space-y-2.5 border-t border-slate-200 bg-white p-4">
            {/* Bill Note Input (Touch Screen Mode) */}
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-500 shrink-0">📝 โน้ตบิล:</span>
              <input
                type="text"
                placeholder="ระบุโน้ต / หมายเหตุท้ายบิล..."
                value={cart.note || ''}
                onChange={(e) => cart.setNote(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 shadow-2xs"
              />
              {cart.note && (
                <button
                  type="button"
                  onClick={() => cart.setNote('')}
                  className="text-slate-400 hover:text-red-500 text-xs px-1 font-bold"
                  title="ล้างโน้ต"
                >
                  &times;
                </button>
              )}
            </div>

            <div className="flex justify-between text-sm text-slate-600 font-medium">
              <span>ยอดรวมสินค้า ({cart.getItemCount()} ชิ้น)</span>
              <span className="font-bold text-slate-900">{formatCurrency(cart.getSubtotal())}</span>
            </div>
            
            <div className="flex justify-between items-center text-sm">
              <div 
                className="flex cursor-pointer items-center gap-1 border-b border-dashed border-slate-300 pb-0.5 text-slate-600 hover:text-primary font-medium"
                title="คลิกเพื่อเพิ่มส่วนลดท้ายบิล"
                onClick={() => setShowBillDiscount(true)}
              >
                <span>ส่วนลดท้ายบิล</span>
                {cart.billDiscountType !== 'none' && (
                  <Badge variant="outline" className="h-5 px-1 bg-red-50 text-red-600 border-red-200">
                    {cart.billDiscountValue}{cart.billDiscountType === 'percent' ? '%' : '฿'}
                  </Badge>
                )}
              </div>
              <span className="text-red-600 font-bold">
                {cart.getBillDiscountAmount() > 0 ? `-${formatCurrency(cart.getBillDiscountAmount())}` : '฿0.00'}
              </span>
            </div>

            {/* Separate Points Discount Row */}
            {cart.getPointsDiscountAmount() > 0 && (
              <div className="flex justify-between items-center text-sm">
                <div 
                  className="flex cursor-pointer items-center gap-1 text-amber-800 font-bold hover:text-amber-900"
                  onClick={() => setShowRedeemModal(true)}
                  title="คลิกเพื่อแก้ไขการใช้แต้ม"
                >
                  <span>🎁 ส่วนลดจากแต้ม ({cart.pointsUsed.toLocaleString()} แต้ม)</span>
                </div>
                <span className="text-amber-700 font-black">
                  -{formatCurrency(cart.getPointsDiscountAmount())}
                </span>
              </div>
            )}

            {/* Separate Claim Discount Row */}
            {cart.attachedClaim && (
              <div className="flex justify-between items-center text-sm bg-emerald-50 border border-emerald-200 p-2 rounded-xl text-emerald-950">
                <div className="flex items-center gap-1.5 truncate">
                  <ShieldAlert className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div className="truncate">
                    <span className="font-bold text-xs block truncate">ส่วนลดเคลม: {cart.attachedClaim.productName}</span>
                    <span className="text-[10px] text-emerald-700 block font-mono">
                      #{cart.attachedClaim.id} · สิทธิ์ {formatCurrency(Number(cart.attachedClaim.discountAmount ?? cart.attachedClaim.totalClaimValue ?? cart.attachedClaim.quantity * cart.attachedClaim.unitPrice))}
                    </span>
                    {Number(cart.attachedClaim.discountAmount ?? cart.attachedClaim.totalClaimValue ?? cart.attachedClaim.quantity * cart.attachedClaim.unitPrice) > cart.getClaimDiscountAmount() && (
                      <span className="text-[10px] text-amber-700 block font-bold">
                        ต้องเพิ่มยอดบิลอีก {formatCurrency(Number(cart.attachedClaim.discountAmount ?? cart.attachedClaim.totalClaimValue ?? cart.attachedClaim.quantity * cart.attachedClaim.unitPrice) - cart.getClaimDiscountAmount())} เพื่อใช้สิทธิ์ครบ
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-black font-mono text-emerald-700">
                    -{formatCurrency(cart.getClaimDiscountAmount())}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      cart.clearAttachedClaim();
                      toast.info('ยกเลิกการใช้ส่วนลดเคลมในบิลนี้แล้ว');
                    }}
                    className="w-5 h-5 rounded-full hover:bg-emerald-200/80 flex items-center justify-center text-slate-500 hover:text-slate-900 font-black text-xs"
                    title="ยกเลิกส่วนลดเคลม"
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}

            {/* VAT 7% Display & Toggle */}
            <div className="flex justify-between items-center text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span>ภาษี VAT 7%</span>
                <Badge
                  variant="outline"
                  className={`cursor-pointer text-[10px] px-1.5 py-0.5 font-bold ${cart.isVatEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}
                  onClick={() => cart.setVatEnabled(!cart.isVatEnabled)}
                >
                  {cart.isVatEnabled ? 'ถอด VAT 7%' : 'ไม่มี VAT'}
                </Badge>
              </div>
              <span className="font-semibold text-slate-700">
                {cart.isVatEnabled ? formatCurrency(cart.getVatAmount()) : 'ไม่มี VAT (฿0.00)'}
              </span>
            </div>

            <div className="flex items-end justify-between border-t border-slate-200 pt-3">
              <span className="text-lg font-bold text-slate-800">ยอดสุทธิ</span>
              <span className="text-2xl font-bold text-primary sm:text-3xl">
                {formatCurrency(cart.getTotal())}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="grid shrink-0 grid-cols-2 gap-3 bg-slate-50 p-4">
            <Button 
              variant="outline" 
              className="h-14 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-bold"
              onClick={() => cart.holdBill()}
              disabled={cart.items.length === 0}
            >
              <PauseCircle className="w-5 h-5 mr-2" />
              พักบิล
            </Button>
            <Button 
              className="h-14 bg-primary text-lg text-white font-bold shadow-lg shadow-primary/20 hover:bg-primary/90"
              disabled={cart.items.length === 0}
              onClick={handleOpenNormalPayment}
            >
              <CreditCard className="w-5 h-5 mr-2" />
              ชำระเงิน
            </Button>
          </div>

        </div>
      </div>
      )}
      
      <PaymentModal open={showPayment} onOpenChange={setShowPayment} initialMethod={paymentInitialMethod} />
      <ItemEditPopup open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)} item={editItem} />
      <BillDiscountPopup open={showBillDiscount} onOpenChange={setShowBillDiscount} />
      <OpenShiftModal open={showOpenShift} onOpenChange={setShowOpenShift} />
      <CloseShiftModal open={showCloseShift} onOpenChange={setShowCloseShift} />
      <HeldBillsSheet open={showHeldBills} onOpenChange={setShowHeldBills} />
      <CustomerSelectModal open={showCustomerSelect} onOpenChange={setShowCustomerSelect} />
      <BarcodeScanModal open={showBarcodeScan} onOpenChange={setShowBarcodeScan} />
      <OrderHistoryModal 
        open={showOrderHistoryModal} 
        onOpenChange={setShowOrderHistoryModal} 
        onOpenPaymentModal={() => setShowPayment(true)}
      />
      <SelectUnitModal
        open={showUnitModal}
        onOpenChange={setShowUnitModal}
        product={unitModalProduct}
        onSelectUnit={(unit) => {
          if (unitModalProduct) {
            cart.addItem(unitModalProduct, unit);
            toast.success(`เพิ่ม ${unitModalProduct.name} (${unit.unitName}) ลงตะกร้าเรียบร้อยแล้ว`);
          }
        }}
      />
      <RedeemPointsModal
        open={showRedeemModal}
        onOpenChange={setShowRedeemModal}
        customer={activeCustomer}
      />
      <PosDebtSelectModal
        open={showDebtCollectModal}
        onOpenChange={setShowDebtCollectModal}
        targetCustomer={debtTargetCustomer}
        cashierName={authStore.user?.name || 'พนักงานขาย'}
      />
      <NumpadPopup
        open={!!qtyEditItem}
        onOpenChange={(open) => {
          if (!open) {
            setQtyEditItem(null);
            setTimeout(() => searchInputRef.current?.focus(), 20);
          }
        }}
        title={`ระบุจำนวน: ${qtyEditItem?.name || ''}`}
        subtitle="จำนวนสินค้าที่ระบุ"
        initialValue={qtyEditItem?.quantity || 1}
        allowDecimals={false}
        onConfirm={(val) => {
          if (qtyEditItem && val > 0) {
            cart.updateQuantity(qtyEditItem.productId, Math.floor(val), qtyEditItem.unitId);
            toast.success(`อัปเดตจำนวนเป็น ${Math.floor(val)} ${qtyEditItem.unitName}`);
          }
          setQtyEditItem(null);
          setTimeout(() => searchInputRef.current?.focus(), 20);
        }}
      />

      <ProductClaimModal
        open={showClaimModal}
        onOpenChange={setShowClaimModal}
        onClaimCompleted={(claim) => {
          setCompletedClaimForPdf(claim);
          setShowClaimPdfModal(true);
        }}
      />
      <ClaimReceiptPdfModal
        open={showClaimPdfModal}
        onOpenChange={setShowClaimPdfModal}
        claim={completedClaimForPdf}
      />
    </div>
  );
}
