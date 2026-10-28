'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { useProductStore } from '@/lib/store/product-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import { useGlobalBarcodeScanner } from '@/lib/use-scanner';
import { convertThaiToEnBarcode } from '@/lib/thai-barcode-converter';
import { getProductPackagingUnits } from '@/lib/cart-pricing';
import { 
  Search, ScanLine, ShoppingCart, Trash2, 
  Minus, Plus, Tag, PauseCircle, PlayCircle, 
  CreditCard, Clock, LogOut, Percent, Check, Receipt, Coins, ArrowLeft
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
import { CashDrawerModal } from '@/components/pos/CashDrawerModal';
import { HeldBillsSheet } from '@/components/pos/HeldBillsSheet';
import { CustomerSelectModal } from '@/components/pos/CustomerSelectModal';
import { BarcodeScanModal } from '@/components/pos/BarcodeScanModal';
import { OrderHistoryModal } from '@/components/pos/OrderHistoryModal';
import { ClientDbSync } from '@/components/common/ClientDbSync';
import { NumpadPopup } from '@/components/pos/NumpadPopup';
import { PosListLayout } from '@/components/pos/PosListLayout';
import { SelectUnitModal } from '@/components/pos/SelectUnitModal';
import { RedeemPointsModal } from '@/components/pos/RedeemPointsModal';
import { PosDebtSelectModal } from '@/components/pos/PosDebtSelectModal';
import { ProductClaimModal } from '@/components/pos/ProductClaimModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';
import { ItemClaimModal } from '@/components/pos/ItemClaimModal';
import { CustomerClaimStockModal } from '@/components/pos/CustomerClaimStockModal';
import { PwaInstallButton } from '@/components/common/PwaInstallButton';
import { CartItem, Product, ProductUnit, ClaimRecord } from '@/lib/types';
import { ShieldAlert, ShieldCheck, Package } from 'lucide-react';
import { getProductAvailableUnits, getDefaultSelectedUnit } from '@/lib/product-unit-helpers';
import { getCustomerById, Customer } from '@/lib/customer-service';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { getTerminalId } from '@/lib/terminal-id';

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
      {product.isBundle && (
        <Badge className="absolute top-2 left-2 bg-purple-50 text-purple-700 border-purple-200 text-[10px] font-bold z-10">
          🎁 สินค้าชุด ({product.bundleItems?.length || 0})
        </Badge>
      )}

      {product.stock <= (product.minStockAlert !== undefined && product.minStockAlert !== null ? Number(product.minStockAlert) : 10) && (
        <Badge variant="destructive" className="absolute top-2 right-2 bg-red-50 text-xs text-red-600 border-red-200 z-10 font-bold">
          เหลือ {product.stock}
        </Badge>
      )}

      <div className="mb-2.5 flex aspect-square w-full items-center justify-center rounded-xl bg-slate-100 overflow-hidden group-hover:scale-102 transition-transform">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl sm:text-4xl">{product.isBundle ? "🎁" : "📦"}</span>
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
  const [showCustomerStockModal, setShowCustomerStockModal] = useState(false);
  const [claimTargetItem, setClaimTargetItem] = useState<CartItem | null>(null);
  const [completedClaimForPdf, setCompletedClaimForPdf] = useState<ClaimRecord | null>(null);
  const [showClaimPdfModal, setShowClaimPdfModal] = useState(false);
  const [showCashDrawerModal, setShowCashDrawerModal] = useState(false);

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
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const [scannerInputValue, setScannerInputValue] = useState('');

  const handleEmptySpaceClick = (e: React.MouseEvent) => {
    const isModalOpen = showPayment || showOpenShift || showCloseShift || editItem || showCustomerSelect || showHeldBills || qtyEditItem || showDebtCollectModal || showCashDrawerModal || showClaimModal || showUnitModal || showRedeemModal || showBarcodeScan;
    if (isModalOpen) return;
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], dialog, label');
    if (!isInteractive && scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  };

  // Auto-scroll to bottom of cart when items change
  useEffect(() => {
    if (cart.items.length > 0 && cartBottomRef.current) {
      cartBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cart.items.length, cart.items]);

  const handleOpenNormalPayment = () => {
    if (cart.items.length === 0) {
      toast.warning('ไม่มีสินค้าในตะกร้า ไม่สามารถชำระเงินได้');
      return;
    }
    setPaymentInitialMethod(null);
    setShowPayment(true);
  };

  const handleOpenSplitPayment = () => {
    if (cart.items.length === 0) {
      toast.warning('ไม่มีสินค้าในตะกร้า ไม่สามารถชำระเงินได้');
      return;
    }
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

  // Heartbeat to Server Control Command Deck
  useEffect(() => {
    const reportHeartbeat = async () => {
      try {
        const terminalId = getTerminalId();
        const storedName = localStorage.getItem('purim_terminal_custom_name') || `จุดขาย #${terminalId.slice(0, 6).toUpperCase()}`;
        await apiFetch('/server-control/ping', {
          method: 'POST',
          body: JSON.stringify({
            terminalId,
            terminalName: storedName,
            userName: authStore.user?.name || authStore.user?.username || 'แคชเชียร์',
          }),
        });
      } catch {
        // silent
      }
    };
    reportHeartbeat();
    const interval = setInterval(reportHeartbeat, 10000);
    return () => clearInterval(interval);
  }, [authStore.user]);

  // Real-time Digital Twin state sync to Master Command Deck (0.5KB lightweight state broadcast)
  const prevItemsCount = useRef<number>(cart.items.length);
  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;
    const sendState = async () => {
      try {
        const terminalId = getTerminalId();
        const storedName = localStorage.getItem('purim_terminal_custom_name') || `จุดขาย #${terminalId.slice(0, 6).toUpperCase()}`;

        let currentAction: 'IDLE' | 'SCANNING' | 'PAYMENT' | 'VOID' | 'DRAWER' | 'CLAIM' = 'IDLE';
        let currentDesc = 'จุดขายพร้อมให้บริการ (ว่าง)';
        let alertLevel: 'NORMAL' | 'WARNING' | 'ALERT' = 'NORMAL';

        const totalAmt = cart.getTotal();
        const discountAmt = cart.getBillDiscountAmount();

        if (showPayment) {
          currentAction = 'PAYMENT';
          currentDesc = `กำลังเปิดหน้าชำระเงิน (ยอดรวม ฿${totalAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })})`;
        } else if (showCashDrawerModal) {
          currentAction = 'DRAWER';
          currentDesc = 'เปิดลิ้นชักเก็บเงินหน้าร้าน';
        } else if (showClaimModal || showCustomerStockModal) {
          currentAction = 'CLAIM';
          currentDesc = 'กำลังทำรายการเคลม/เปลี่ยนสินค้า';
        } else if (cart.items.length > 0) {
          currentAction = 'SCANNING';
          const lastItem = cart.items[cart.items.length - 1];
          currentDesc = `ยิงสินค้า: ${lastItem.name} (${lastItem.quantity} ${lastItem.unitName})`;

          if (cart.items.length < prevItemsCount.current) {
            currentAction = 'VOID';
            currentDesc = `⚠️ มีการลบสินค้าออกจากตะกร้า (เหลือ ${cart.items.length} รายการ)`;
            alertLevel = 'WARNING';
          }
        }

        prevItemsCount.current = cart.items.length;

        const simplifiedCartItems = cart.items.map((it) => ({
          productId: it.productId,
          name: it.name,
          barcode: it.sku || '',
          unitName: it.unitName,
          price: cart.getEffectivePrice(it),
          quantity: it.quantity,
          total: cart.getItemLineTotal(it),
        }));

        const liveState = {
          activeAction: currentAction,
          actionDescription: currentDesc,
          actionTimestamp: new Date().toISOString(),
          customerName: activeCustomer?.name || (cart.customerId ? 'ลูกค้าสมาชิก' : undefined),
          itemCount: cart.getItemCount(),
          totalAmount: totalAmt,
          discountAmount: discountAmt,
          cartItems: simplifiedCartItems,
          alertLevel,
        };

        await apiFetch('/server-control/sync-live-state', {
          method: 'POST',
          body: JSON.stringify({
            terminalId,
            terminalName: storedName,
            userName: authStore.user?.name || authStore.user?.username || 'แคชเชียร์',
            liveState,
          }),
        });
      } catch {
        // silent fail - zero impact on cashier operations
      }
    };

    // Debounce 300ms so rapid scanning batches cleanly
    timeout = setTimeout(sendState, 300);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [
    cart.items,
    showPayment,
    showCashDrawerModal,
    showClaimModal,
    showCustomerStockModal,
    activeCustomer,
    authStore.user,
  ]);

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
    // Outbox sync is managed globally by ClientDbSync.

    const handleOnline = () => {
      void fetchProducts();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleOnline);
    const timer = setInterval(() => { if (!document.hidden) void fetchProducts(); }, 15000);
    return () => { clearInterval(timer); window.removeEventListener('online', handleOnline); window.removeEventListener('focus', handleOnline); };
  }, [fetchProducts]);

  // Auto fetch current shift from central database on POS load
  useEffect(() => {
    if (mounted) {
      shiftStore.fetchCurrentShift().then((serverShift) => {
        const isShiftOpen = serverShift?.isOpen === true || shiftStore.currentShift?.isOpen === true;
        const todayStr = new Date().toISOString().split('T')[0];
        let skippedDate: string | null = null;
        try {
          skippedDate = localStorage.getItem('pos_shift_skipped_date');
        } catch (e) {}

        if (!isShiftOpen && skippedDate !== todayStr) {
          setShowOpenShift(true);
        }
      });
    }
  }, [mounted]);

  // Reset pagination limit on search/category filter change
  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [searchQuery, activeCategory]);

  // Unified Barcode Scan Processor (supports Thai-to-English auto-conversion)
  const processBarcodeScan = (scannedBarcode: string) => {
    if (showPayment || showOpenShift || showCloseShift || editItem || showCustomerSelect || showHeldBills) return;

    const raw = scannedBarcode.trim();
    if (!raw) return;

    // Convert Thai Kedmanee to English/Numeric
    const convertedCode = convertThaiToEnBarcode(raw).trim();
    const code = convertedCode.toLowerCase();

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
        toast.success(`⚡ สแกนบาร์โค้ดสำเร็จ: ${matchedProduct.name} (1 ${unit.unitName})`);
      }
    } else {
      const docPrefixes = ['ord-', 'clm-', 'shf-', 'po-', 'dn-', 'pv-', 'debt-'];
      const isDocCode = docPrefixes.some(p => code.startsWith(p));
      if (isDocCode) {
        toast.info(`🔍 ตรวจพบบาร์โค้ดเอกสาร: ${convertedCode.toUpperCase()} เปิดหน้าค้นหาทันที...`);
        useDocumentSearchStore.getState().openSearch(convertedCode.toUpperCase());
      } else {
        const thaiHint = convertedCode !== raw ? ` (แปลงจากภาษาไทย: "${raw}")` : '';
        toast.error(`❌ ไม่พบสินค้าบาร์โค้ด: "${convertedCode}"${thaiHint}`);
      }
    }

    // Always reset scanner input and refocus
    setScannerInputValue('');
    setTimeout(() => scannerInputRef.current?.focus(), 10);
  };

  // Global Barcode Scanner Listener
  useGlobalBarcodeScanner((scannedBarcode) => {
    processBarcodeScan(scannedBarcode);
  }, mounted);

  // POS Global Keyboard Shortcuts (F12, F10, Ctrl+H, Ctrl+M, Ctrl+E, Ctrl+P) - Supports Toggle & Thai/English OS layouts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const keyLower = e.key ? e.key.toLowerCase() : '';

      // F9 -> Toggle Cash Drawer Modal (Cash In / Out)
      if (code === 'F9' || keyLower === 'f9') {
        e.preventDefault();
        setShowCashDrawerModal(prev => !prev);
      }
      // F10 (or Ctrl+Shift+P) -> Toggle Held Bills Sheet
      else if (code === 'F10' || keyLower === 'f10' || (e.ctrlKey && e.shiftKey && (code === 'KeyP' || keyLower === 'p'))) {
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
    <div className="flex min-h-dvh flex-col bg-slate-50 pb-20 lg:pb-0 text-slate-900 lg:h-screen lg:overflow-hidden" onClick={handleEmptySpaceClick}>
      <a href="#pos-cart" className="lg:hidden fixed bottom-3 left-3 right-3 z-40 rounded-xl bg-sky-700 px-4 py-3 text-center font-bold text-white shadow-lg">ดูตะกร้า / ชำระเงิน</a>
      
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
          onOpenCashDrawer={() => setShowCashDrawerModal(true)}
          onOpenCustomerStock={() => setShowCustomerStockModal(true)}
          onOpenItemClaim={(item) => setClaimTargetItem(item)}
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
          
          {/* Hidden input dedicated for Barcode Scanner (Invisible to user, captures scanner input & converts Thai to English) */}
          <input
            ref={scannerInputRef}
            type="text"
            value={scannerInputValue}
            onChange={(e) => setScannerInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const raw = scannerInputValue.trim();
                setScannerInputValue('');
                if (raw) {
                  processBarcodeScan(raw);
                }
              }
            }}
            className="sr-only absolute -top-[9999px] -left-[9999px] opacity-0 pointer-events-none w-0 h-0"
            tabIndex={-1}
            aria-hidden="true"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />

          {/* Toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-2.5 sm:px-3 sm:py-2.5">
            {/* Back to Dashboard */}
            <Link
              href="/dashboard"
              className="h-11 px-3 rounded-xl border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-2xs transition-colors"
              title="กลับไปหน้าแดชบอร์ด / เมนูหลัก"
            >
              <ArrowLeft className="w-4 h-4 text-slate-500" />
              <span className="hidden sm:inline">แดชบอร์ด</span>
            </Link>

            {/* Search Input */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                ref={searchInputRef}
                placeholder="ค้นหาชื่อสินค้า, หมวดหมู่, SKU (พิมพ์ค้นหา)..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const raw = searchQuery.trim();
                    if (!raw) return;

                    const converted = convertThaiToEnBarcode(raw).toLowerCase().trim();
                    const matchedByBarcode = products.find(p => {
                      const matchSku = p.sku?.toLowerCase().trim() === converted;
                      const matchUnitBarcode = p.units?.some(u => u.barcode?.toLowerCase().trim() === converted);
                      const matchProductBarcodes = (p as any).barcodes?.some((b: any) => b.barcode?.toLowerCase().trim() === converted);
                      const pkgUnits = getProductPackagingUnits(p.id);
                      const matchPkgBarcode = pkgUnits.some(u => u.barcode?.toLowerCase().trim() === converted);
                      return matchSku || matchUnitBarcode || matchProductBarcodes || matchPkgBarcode;
                    });

                    if (matchedByBarcode) {
                      processBarcodeScan(raw);
                      setSearchQuery('');
                    } else if (filteredProducts.length > 0) {
                      const matched = filteredProducts[0];
                      cart.addItem(matched, matched.units[0]);
                      setSearchQuery('');
                      toast.success(`เพิ่ม ${matched.name} ลงตะกร้าแล้ว`);
                    }
                  }
                }}
                className="h-11 bg-white pl-9 text-xs sm:text-sm font-medium"
              />
            </div>

            {/* Scan Barcode Modal Button */}
            <Button 
              size="icon" 
              variant="outline" 
              className="h-11 w-11 shrink-0 border-slate-300 bg-white shadow-2xs"
              onClick={() => setShowBarcodeScan(true)}
              title="เปิดกล้องสแกนบาร์โค้ด"
            >
              <ScanLine className="w-5 h-5 text-slate-600" />
            </Button>

            {/* Document Search (F3) */}
            <Button 
              size="sm" 
              variant="outline" 
              className="h-11 border-indigo-200 bg-indigo-50/80 text-indigo-900 hover:bg-indigo-100 font-bold text-xs shadow-2xs hidden sm:flex items-center gap-1.5"
              onClick={() => useDocumentSearchStore.getState().openSearch()}
              title="ค้นหาเอกสารทั้งหมด / สแกนบาร์โค้ดใบเสร็จ (F3)"
            >
              <ScanLine className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
              <span className="hidden md:inline">ค้นหาเอกสาร</span>
              <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-white text-indigo-700 border border-indigo-200 font-bold">F3</span>
            </Button>

            {/* Screen View Mode Selector */}
            <select 
              value={viewMode}
              onChange={(e) => handleViewModeChange(e.target.value as 'touch_screen' | 'list_view')}
              className="h-11 bg-slate-50 hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold rounded-xl px-2.5 outline-none shadow-2xs cursor-pointer transition-all shrink-0"
              title="สลับรูปแบบหน้าจอขาย"
            >
              <option value="touch_screen">📱 Touch Screen</option>
              <option value="list_view">📋 แบบรายการ</option>
            </select>

            {/* Order History (Ctrl+H) */}
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-11 text-slate-600 hover:text-primary font-bold text-xs hidden lg:flex items-center"
              onClick={() => setShowOrderHistoryModal(prev => !prev)}
              title="ประวัติการขาย (Ctrl+H)"
            >
              <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
              <span>ประวัติ</span>
            </Button>

            {/* Shift Open / Close */}
            {!shiftStore.isShiftOpen() ? (
              <Button size="sm" className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs" onClick={() => setShowOpenShift(true)}>
                เปิดกะ
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-11 border-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 font-bold text-xs" onClick={() => setShowCloseShift(true)} title="ปิดกะ">
                <LogOut className="w-3.5 h-3.5 mr-1" />
                <span className="hidden sm:inline">ปิดกะ</span>
              </Button>
            )}
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
        <div id="pos-cart" className="flex w-full shrink-0 flex-col bg-white lg:w-[420px] xl:w-[450px]">
          
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
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 font-bold text-xs flex items-center gap-1 shadow-2xs"
                onClick={() => setShowCustomerStockModal(true)}
                title="เปิดดูคลังสินค้าลูกค้า & สิทธิ์เคลมคงเหลือ"
              >
                <Package className="w-3.5 h-3.5 text-indigo-600" />
                <span>สิทธิ์เคลม</span>
              </Button>
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
            {/* Pending Claims Discount Banner */}
            {cart.pendingClaims && cart.pendingClaims.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-3 text-xs shadow-xs space-y-1.5 animate-in fade-in">
                <div className="flex items-center justify-between text-amber-900 font-bold">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    มีส่วนลดเคลมรอหักในบิลนี้ ({cart.pendingClaims.length} รายการ):
                  </span>
                  <span className="text-sm font-black text-amber-700">
                    -{formatCurrency(cart.getClaimDiscountAmount())}
                  </span>
                </div>
                <div className="text-[11px] text-amber-800">
                  * สิทธิ์เคลมจะยังไม่ถูกตัดจนกว่าจะชำระเงินเสร็จสิ้น หากยกเลิกบิลสิทธิ์เคลมจะคงเดิม 100%
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {cart.pendingClaims.map((pc) => (
                    <span key={pc.id} className="inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-amber-200 text-[10px] text-slate-700 font-medium">
                      <span>{pc.productName} ({pc.quantity} {pc.unitName})</span>
                      <button
                        type="button"
                        onClick={() => {
                          cart.removePendingClaim(pc.id);
                          toast.info(`ยกเลิกส่วนลดเคลม ${pc.productName} แล้ว`);
                        }}
                        className="text-slate-400 hover:text-red-600 font-bold ml-1 text-xs"
                        title="ยกเลิกส่วนลดรายการนี้"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

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
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <span>{item.name}</span>
                            {item.isBundle && (
                              <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1 py-0.2 rounded font-bold shrink-0">
                                🎁 ชุด
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{item.sku}</span>
                            <span>·</span>
                            <span className="font-semibold text-slate-700">{item.unitName}</span>
                          </div>
                          {item.bundleData && item.bundleData.length > 0 && (
                            <div className="mt-1 text-[11px] text-purple-800 bg-purple-50/80 rounded px-2 py-0.5 border border-purple-100">
                              <span className="font-semibold">ในชุด: </span>
                              {item.bundleData.map((b, i) => (
                                <span key={i}>
                                  {i > 0 && ", "}
                                  {b.productName} x{b.quantityPerBundle * item.quantity}
                                </span>
                              ))}
                            </div>
                          )}
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

                      {/* Free Claim Badge */}
                      {item.claimQuantity !== undefined && item.claimQuantity > 0 && (
                        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg w-fit shadow-2xs">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>เคลมฟรี {item.claimQuantity} {item.unitName} (คิดเงิน {Math.max(0, item.quantity - item.claimQuantity)} {item.unitName})</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            onClick={() => setEditItem(item)}
                          >
                            <Tag className="w-3.5 h-3.5 mr-1" />
                            <span>แก้ไขราคา</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-2 text-xs font-semibold ${
                              item.claimQuantity && item.claimQuantity > 0
                                ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                                : 'text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700'
                            }`}
                            onClick={() => setClaimTargetItem(item)}
                            title="ระบุจำนวนสินค้าเคลมฟรีในรายการนี้"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                            <span>{item.claimQuantity && item.claimQuantity > 0 ? `เคลมฟรี ${item.claimQuantity}` : 'สินค้าเคลม'}</span>
                          </Button>
                        </div>
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
            {cart.getClaimDiscountAmount() > 0 && (
              <div className="flex justify-between items-center text-sm bg-emerald-50 border border-emerald-200 p-2 rounded-xl text-emerald-950">
                <div className="flex items-center gap-1.5 truncate">
                  <ShieldAlert className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div className="truncate">
                    <span className="font-bold text-xs block truncate">
                      {cart.attachedClaim
                        ? `ส่วนลดเคลม: ${cart.attachedClaim.productName}`
                        : `ส่วนลดสินค้าเคลม (${cart.pendingClaims.length} รายการ)`}
                    </span>
                    <span className="text-[10px] text-emerald-700 block font-mono">
                      หักส่วนลดในบิลนี้ทันที (ตัดสิทธิ์เมื่อชำระเงิน)
                    </span>
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
                      cart.clearPendingClaims();
                      toast.info('ยกเลิกการใช้ส่วนลดเคลมในบิลนี้แล้ว');
                    }}
                    className="w-5 h-5 rounded-full hover:bg-emerald-200/80 flex items-center justify-center text-slate-500 hover:text-slate-900 font-black text-xs"
                    title="ยกเลิกส่วนลดเคลมทั้งหมด"
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
          <div className="grid shrink-0 grid-cols-3 gap-2 bg-slate-50 p-3 sm:p-4">
            <Button 
              type="button"
              variant="outline" 
              className="h-14 border-amber-300 bg-amber-50/80 hover:bg-amber-100 text-amber-900 font-extrabold text-xs sm:text-sm flex flex-col items-center justify-center gap-1 shadow-xs transition-all"
              onClick={() => setShowCashDrawerModal(true)}
              title="เปิดลิ้นชัก หรือนำเงินเข้า-ออก (F9)"
            >
              <Coins className="w-5 h-5 text-amber-600" />
              <span>เปิดลิ้นชัก</span>
            </Button>
            <Button 
              variant="outline" 
              className="h-14 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-bold text-xs sm:text-sm flex flex-col items-center justify-center gap-1 shadow-xs"
              onClick={() => cart.holdBill()}
              disabled={cart.items.length === 0}
            >
              <PauseCircle className="w-5 h-5 text-slate-600" />
              <span>พักบิล</span>
            </Button>
            <Button 
              className="h-14 bg-primary text-white font-extrabold text-base sm:text-lg shadow-lg shadow-primary/20 hover:bg-primary/90 flex items-center justify-center gap-2"
              disabled={cart.items.length === 0}
              onClick={handleOpenNormalPayment}
            >
              <CreditCard className="w-5 h-5" />
              <span>ชำระเงิน</span>
            </Button>
          </div>

        </div>
      </div>
      )}
      
      {/* Mobile Sticky Bottom Summary Bar (< lg) */}
      {cart.items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-bold">
              ตะกร้า ({cart.items.reduce((s, i) => s + i.quantity, 0)} ชิ้น)
            </span>
            <span className="text-xl font-black text-primary font-mono">
              {formatCurrency(cart.getTotal())}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const cartElem = document.getElementById('pos-cart');
                if (cartElem) cartElem.scrollIntoView({ behavior: 'smooth' });
              }}
              className="h-11 px-3 text-xs font-bold rounded-xl border-slate-300 text-slate-700"
            >
              <ShoppingCart className="w-4 h-4 mr-1" />
              ดูตะกร้า
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleOpenNormalPayment}
              className="h-11 px-5 text-sm font-black rounded-xl bg-primary hover:bg-primary/90 text-white shadow-md flex items-center gap-1.5"
            >
              <CreditCard className="w-4 h-4" />
              ชำระเงิน
            </Button>
          </div>
        </div>
      )}

      <PaymentModal open={showPayment} onOpenChange={setShowPayment} initialMethod={paymentInitialMethod} />
      <ItemEditPopup open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)} item={editItem} />
      <BillDiscountPopup open={showBillDiscount} onOpenChange={setShowBillDiscount} />
      <OpenShiftModal open={showOpenShift} onOpenChange={setShowOpenShift} />
      <CloseShiftModal open={showCloseShift} onOpenChange={setShowCloseShift} />
      <CashDrawerModal 
        open={showCashDrawerModal} 
        onOpenChange={setShowCashDrawerModal} 
        onOpenShiftRequired={() => setShowOpenShift(true)} 
      />
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
            setTimeout(() => scannerInputRef.current?.focus(), 20);
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
          setTimeout(() => scannerInputRef.current?.focus(), 20);
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

      {/* Item Claim Popup (In-Cart Replacement) */}
      <ItemClaimModal
        isOpen={!!claimTargetItem}
        onClose={() => setClaimTargetItem(null)}
        item={claimTargetItem}
        onConfirm={(claimQty, reason, sourceOrderId) => {
          if (claimTargetItem) {
            cart.setItemClaim(
              claimTargetItem.productId,
              claimQty,
              reason,
              claimTargetItem.unitId,
              sourceOrderId
            );
          }
        }}
      />

      {/* Customer Claim Stock & Quota Inventory Modal */}
      <CustomerClaimStockModal
        isOpen={showCustomerStockModal}
        onClose={() => setShowCustomerStockModal(false)}
        onOpenCustomerSelect={() => setShowCustomerSelect(true)}
      />
    </div>
  );
}
