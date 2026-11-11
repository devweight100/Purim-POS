'use client';

import { getLowStockThreshold } from '@/lib/store-settings-storage';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { useProductStore } from '@/lib/store/product-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import { useGlobalBarcodeScanner, findProductByScannedCode, canUseCartCharShortcut, msSincePreviousPrintableKey } from '@/lib/use-scanner';
import { convertThaiToEnBarcode } from '@/lib/thai-barcode-converter';
import { getProductPackagingUnits } from '@/lib/cart-pricing';
import { 
  Search, ScanLine, ShoppingCart, Trash2, 
  Minus, Plus, Tag, PauseCircle, Percent,
  CreditCard, Clock, LogOut, Receipt, Coins, ArrowLeft,
  ShieldAlert, ShieldCheck, Package, Sparkles, Layers,
  Store, User, Monitor
} from 'lucide-react';
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
import { NumpadPopup } from '@/components/pos/NumpadPopup';
import { SelectUnitModal } from '@/components/pos/SelectUnitModal';
import { RedeemPointsModal } from '@/components/pos/RedeemPointsModal';
import { PosDebtSelectModal } from '@/components/pos/PosDebtSelectModal';
import { ProductClaimModal } from '@/components/pos/ProductClaimModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';
import { ItemClaimModal } from '@/components/pos/ItemClaimModal';
import { CustomerClaimStockModal } from '@/components/pos/CustomerClaimStockModal';
import { PosNeoListLayout } from '@/components/pos/PosNeoListLayout';
import { CartItem, Product, ProductUnit, ClaimRecord } from '@/lib/types';
import { getProductAvailableUnits, getDefaultSelectedUnit } from '@/lib/product-unit-helpers';
import { getCustomerById, Customer } from '@/lib/customer-service';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { getTerminalId } from '@/lib/terminal-id';
import { PosLogoutButton } from '@/components/pos/PosLogoutButton';
import { addQty, formatQty, parseQty, subQty, useAllowDecimalQty } from '@/lib/qty';

const PAGE_SIZE = 36;

/**
 * Neo-Brutalist Product Card
 */
function PosNeoProductCard({
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
  const isLowStock = product.stock <= (product.minStockAlert !== undefined && product.minStockAlert !== null ? Number(product.minStockAlert) : getLowStockThreshold());

  return (
    <div 
      onClick={() => onAddToCart(product, activeUnit)}
      className="group relative flex cursor-pointer select-none flex-col rounded-xl border-2 border-black bg-white p-3 shadow-[3px_3px_0px_#000] transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[5px_5px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
    >
      {/* Top Badges */}
      <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between gap-1 pointer-events-none">
        {product.isBundle ? (
          <span className="rounded-md border border-black bg-[#E9D5FF] px-1.5 py-0.5 text-[10px] font-black text-black shadow-[1px_1px_0px_#000]">
            🎁 ชุด ({product.bundleItems?.length || 0})
          </span>
        ) : <span />}

        {isLowStock && (
          <span className="rounded-md border border-black bg-[#FECDD3] px-1.5 py-0.5 text-[10px] font-black text-black shadow-[1px_1px_0px_#000]">
            เหลือ {product.stock}
          </span>
        )}
      </div>

      {/* Product Image Box */}
      <div className="mb-2.5 flex aspect-square w-full items-center justify-center rounded-lg border-2 border-black bg-[#F8F6F0] overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <span className="text-3xl select-none">{product.isBundle ? "🎁" : "📦"}</span>
        )}
      </div>

      {/* Product Name */}
      <div className="mb-1 line-clamp-2 text-sm font-black leading-snug text-black">
        {product.name}
      </div>

      {/* SKU & Barcode */}
      <div className="mb-2 flex items-center gap-1 text-[11px] font-mono font-bold text-neutral-600">
        <span className="rounded bg-neutral-100 px-1 py-0.2 border border-black/40">{product.sku}</span>
      </div>

      {/* Multi-Unit Selector or Single Price */}
      {units.length > 1 ? (
        <div className="mt-auto pt-2 border-t border-black/10 flex flex-wrap gap-1">
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
                className={`px-2 py-1 rounded-md text-xs font-black transition-all border border-black flex items-center gap-1 cursor-pointer ${
                  isOutOfStock
                    ? 'opacity-40 bg-neutral-200 text-neutral-500 cursor-not-allowed line-through'
                    : isActive
                    ? 'bg-[#FF6B00] text-black shadow-[2px_2px_0px_#000] ring-1 ring-black'
                    : 'bg-white hover:bg-[#FEF08A] text-black shadow-[1px_1px_0px_#000]'
                }`}
              >
                <span>{u.unitName}</span>
                <span className="font-mono text-[11px]">{formatCurrency(u.price)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-auto flex items-end justify-between pt-1">
          <div className="rounded-lg border-2 border-black bg-[#FEF08A] px-2.5 py-0.5 text-base font-black font-mono text-black shadow-[2px_2px_0px_#000]">
            {formatCurrency(activeUnit.price)}
          </div>
          <div className="text-xs font-black text-neutral-600">/{activeUnit.unitName}</div>
        </div>
      )}
    </div>
  );
}

export default function PosNeoPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [viewMode, setViewMode] = useState<'touch_screen' | 'list_view'>('touch_screen');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('pos_neo_screen_mode');
      if (savedMode === 'list_view' || savedMode === 'touch_screen') {
        setViewMode(savedMode);
      }
    }
  }, []);

  const handleViewModeChange = (mode: 'touch_screen' | 'list_view') => {
    setViewMode(mode);
    try {
      localStorage.setItem('pos_neo_screen_mode', mode);
    } catch {}
    toast.info(`เปลี่ยนรูปแบบหน้าจอเป็น "${mode === 'touch_screen' ? 'Touch Screen' : 'แบบรายการ'}"`);
  };
  
  // Modals state
  const [showPayment, setShowPayment] = useState(false);
  const [editItem, setEditItem] = useState<CartItem | null>(null);
  const [qtyEditItem, setQtyEditItem] = useState<CartItem | null>(null);
  const allowDecimalQty = useAllowDecimalQty();
  const [priceEditItem, setPriceEditItem] = useState<CartItem | null>(null);
  const [selectedCartIndex, setSelectedCartIndex] = useState<number>(0);
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

  const cartBottomRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const [scannerInputValue, setScannerInputValue] = useState('');

  // Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Customer binding
  useEffect(() => {
    if (cart.customerId) {
      setActiveCustomer(getCustomerById(cart.customerId));
    } else {
      setActiveCustomer(null);
    }
  }, [cart.customerId]);

  // Click on background focuses scanner
  const handleEmptySpaceClick = (e: React.MouseEvent) => {
    const isModalOpen = showPayment || showOpenShift || showCloseShift || editItem || showCustomerSelect || showHeldBills || qtyEditItem || showDebtCollectModal || showCashDrawerModal || showClaimModal || showUnitModal || showRedeemModal || showBarcodeScan;
    if (isModalOpen) return;
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], dialog, label');
    if (!isInteractive && scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  };

  // Auto scroll cart
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

  // Hold Bill handler (holds current bill or opens held bills sheet)
  const handleHoldBillAction = () => {
    if (cart.items.length > 0) {
      cart.holdBill();
      toast.success(`📌 พักบิลเรียบร้อยแล้ว (มีบิลพักค้างไว้ ${useCartStore.getState().heldBills.length} ใบ)`);
    } else if (cart.heldBills.length > 0) {
      setShowHeldBills(true);
    } else {
      toast.info('ไม่มีสินค้าในตะกร้าที่จะพัก');
    }
  };

  // Auto-select latest item when new item added to cart
  const prevItemsLength = useRef<number>(cart.items.length);
  useEffect(() => {
    if (cart.items.length > prevItemsLength.current) {
      setSelectedCartIndex(cart.items.length - 1);
      setTimeout(() => {
        const elem = document.getElementById(`cart-item-${cart.items.length - 1}`) || document.getElementById(`list-cart-item-${cart.items.length - 1}`);
        if (elem) elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    } else if (selectedCartIndex >= cart.items.length) {
      setSelectedCartIndex(Math.max(0, cart.items.length - 1));
    }
    prevItemsLength.current = cart.items.length;
  }, [cart.items.length, selectedCartIndex]);

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

  // Live state sync to Master Command Deck
  const prevItemsCount = useRef<number>(cart.items.length);
  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;
    const sendState = async () => {
      // Latest cart snapshot (the effect re-runs on cart.items; reading the whole store object as a
      // dependency would re-run it on every cart change, including unrelated fields)
      const cart = useCartStore.getState();
      try {
        const terminalId = getTerminalId();
        const storedName = localStorage.getItem('purim_terminal_custom_name') || `จุดขาย #${terminalId.slice(0, 6).toUpperCase()}`;

        let currentAction: 'IDLE' | 'SCANNING' | 'PAYMENT' | 'VOID' | 'DRAWER' | 'CLAIM' = 'IDLE';
        let currentDesc = 'จุดขายพร้อมให้บริการ (Neo UI)';
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
          currentDesc = `ยิงสินค้า: ${lastItem.name} (${formatQty(lastItem.quantity)} ${lastItem.unitName})`;

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
        // silent
      }
    };

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

  // Initial load
  useEffect(() => {
    setMounted(true);
    fetchProducts();

    const handleOnline = () => {
      void fetchProducts();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleOnline);
    const timer = setInterval(() => { if (!document.hidden) void fetchProducts(); }, 15000);
    return () => { clearInterval(timer); window.removeEventListener('online', handleOnline); window.removeEventListener('focus', handleOnline); };
  }, [fetchProducts]);

  // Shift check
  useEffect(() => {
    if (mounted) {
      // Read the store imperatively: this runs once per mount, not on every shift-store change
      useShiftStore.getState().fetchCurrentShift().then((serverShift) => {
        const isShiftOpen = serverShift?.isOpen === true || useShiftStore.getState().currentShift?.isOpen === true;
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

  // Reset pagination on filter change
  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [searchQuery, activeCategory]);

  // Barcode Scanner Processor
  const processBarcodeScan = (scannedBarcode: string) => {
    if (showPayment || showOpenShift || showCloseShift || editItem || showCustomerSelect || showHeldBills) return;

    const raw = scannedBarcode.trim();
    if (!raw) return;

    // Try the raw code first (ASCII SKUs like "RICE-JAS-5KG" stay intact), then the Thai-keyboard conversion
    const convertedCode = convertThaiToEnBarcode(raw).trim();
    const match = findProductByScannedCode(products, raw);
    const matchedProduct = match?.product;
    const code = match ? match.code : (raw.toLowerCase());

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

      const existingItem = cart.items.find(
        i => i.productId === matchedProduct.id && i.unitId === unit.id
      );
      const currentQty = existingItem ? existingItem.quantity : 0;
      const newQty = currentQty + 1;

      cart.addItem(matchedProduct, unit);
      setSearchQuery('');

      if (existingItem) {
        toast.success(`⚡ สแกนสินค้าซ้ำ: ${matchedProduct.name} (+1 รวมเป็น ${newQty} ${unit.unitName})`);
      } else {
        toast.success(`⚡ สแกนสำเร็จ: ${matchedProduct.name} (1 ${unit.unitName})`);
      }
    } else {
      const docPrefixes = ['ord-', 'clm-', 'shf-', 'po-', 'dn-', 'pv-', 'debt-'];
      const docCode = [raw, convertedCode].find(c => docPrefixes.some(p => c.toLowerCase().startsWith(p)));
      if (docCode) {
        toast.info(`🔍 ตรวจพบบาร์โค้ดเอกสาร: ${docCode.toUpperCase()} เปิดหน้าค้นหาทันที...`);
        useDocumentSearchStore.getState().openSearch(docCode.toUpperCase());
      } else {
        const thaiHint = convertedCode !== raw ? ` (ลองแปลงจากแป้นไทยเป็น "${convertedCode}" แล้ว)` : '';
        toast.error(`❌ ไม่พบสินค้าบาร์โค้ด: "${raw}"${thaiHint}`);
      }
    }

    setScannerInputValue('');
    setTimeout(() => scannerInputRef.current?.focus(), 10);
  };

  useGlobalBarcodeScanner((scannedBarcode) => {
    processBarcodeScan(scannedBarcode);
  }, mounted);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const keyLower = e.key ? e.key.toLowerCase() : '';
      const activeEl = document.activeElement as HTMLElement | null;
      // Track key timing for every key so scanner bursts are recognised
      const sincePrevKey = msSincePreviousPrintableKey(e);

      // Identify if the active element is a background scanner input (tabindex=-1 or sr-only)
      const isHiddenScanner = !!activeEl && (
        activeEl === scannerInputRef.current ||
        activeEl.classList?.contains('sr-only') ||
        activeEl.getAttribute('tabindex') === '-1' ||
        activeEl.getAttribute('aria-hidden') === 'true'
      );

      // Check if user is inside a real editable text field (search bar, note input, etc.)
      const isRealTextInput = !isHiddenScanner && !!activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      // Check the actual text value currently typed into this input
      const activeInputValue = (isRealTextInput && (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement))
        ? activeEl.value.trim()
        : '';

      // User is actively searching/typing if focused on an input and there is text in it
      const isSearching = isRealTextInput && activeInputValue.length > 0;

      // Check if modal or dialog is currently open - if so, let dialog handle its own keys
      const isModalOpen = showPayment || showOpenShift || showCloseShift || !!editItem || showCustomerSelect || showHeldBills || !!qtyEditItem || !!priceEditItem || showDebtCollectModal || showCashDrawerModal || showClaimModal || showUnitModal || showRedeemModal || showBarcodeScan || showOrderHistoryModal || showCustomerStockModal || !!claimTargetItem;
      if (isModalOpen || useDocumentSearchStore.getState().isOpen) return;

      // Helper to scroll to selected item
      const scrollToItem = (idx: number) => {
        setTimeout(() => {
          const elem = document.getElementById(`cart-item-${idx}`) || document.getElementById(`list-cart-item-${idx}`);
          if (elem) elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 15);
      };

      // F2 -> Edit Quantity of selected/latest cart item
      if (code === 'F2' || keyLower === 'f2') {
        e.preventDefault();
        const items = useCartStore.getState().items;
        if (items.length === 0) {
          toast.warning('ยังไม่มีสินค้าในตะกร้า');
          return;
        }
        const idx = Math.min(items.length - 1, Math.max(0, selectedCartIndex));
        setQtyEditItem(items[idx]);
      }
      // F3 -> Edit Discount & Details of selected/latest cart item.
      // F3 has one owner: with items in the cart it is the item discount popup (preventDefault tells the
      // global document search to ignore it); with an empty cart it is left to the global document search.
      else if (code === 'F3' || keyLower === 'f3') {
        const items = useCartStore.getState().items;
        if (items.length === 0) return;
        e.preventDefault();
        const idx = Math.min(items.length - 1, Math.max(0, selectedCartIndex));
        setEditItem(items[idx]);
      }
      // F4 -> Edit Selling Price of selected/latest cart item
      else if (code === 'F4' || keyLower === 'f4') {
        e.preventDefault();
        const items = useCartStore.getState().items;
        if (items.length === 0) {
          toast.warning('ยังไม่มีสินค้าในตะกร้า');
          return;
        }
        const idx = Math.min(items.length - 1, Math.max(0, selectedCartIndex));
        setPriceEditItem(items[idx]);
      }
      // Arrow Up / Down -> Navigate selection through cart items
      // ONLY when NOT actively searching/typing query in an input
      else if ((code === 'ArrowDown' || keyLower === 'arrowdown' || code === 'ArrowUp' || keyLower === 'arrowup') && !isSearching) {
        const items = useCartStore.getState().items;
        if (items.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          const isDown = code === 'ArrowDown' || keyLower === 'arrowdown';
          setSelectedCartIndex((prev) => {
            const next = isDown
              ? Math.min(items.length - 1, prev + 1)
              : Math.max(0, prev - 1);
            scrollToItem(next);
            return next;
          });
        }
      }
      // Delete -> Remove selected cart item (only when not typing in a real text input)
      else if ((code === 'Delete' || keyLower === 'delete') && !isRealTextInput) {
        const items = useCartStore.getState().items;
        if (items.length > 0) {
          e.preventDefault();
          const idx = Math.min(items.length - 1, Math.max(0, selectedCartIndex));
          const target = items[idx];
          if (target) {
            useCartStore.getState().removeItem(target.productId, target.unitId);
            toast.info(`ลบ "${target.name}" ออกจากตะกร้าแล้ว`);
          }
        }
      }
      // + / - keys -> Increase / Decrease quantity of selected item (only when not typing in a real text input)
      else if ((code === 'NumpadAdd' || keyLower === '+') && canUseCartCharShortcut(activeEl, isHiddenScanner ? (activeEl as HTMLInputElement) : scannerInputRef.current, sincePrevKey)) {
        const items = useCartStore.getState().items;
        if (items.length > 0) {
          e.preventDefault();
          const idx = Math.min(items.length - 1, Math.max(0, selectedCartIndex));
          const target = items[idx];
          if (target) {
            useCartStore.getState().updateQuantity(target.productId, addQty(target.quantity, 1), target.unitId);
          }
        }
      } else if ((code === 'NumpadSubtract' || keyLower === '-') && canUseCartCharShortcut(activeEl, isHiddenScanner ? (activeEl as HTMLInputElement) : scannerInputRef.current, sincePrevKey)) {
        const items = useCartStore.getState().items;
        if (items.length > 0) {
          e.preventDefault();
          const idx = Math.min(items.length - 1, Math.max(0, selectedCartIndex));
          const target = items[idx];
          if (target) {
            useCartStore.getState().updateQuantity(target.productId, subQty(target.quantity, 1), target.unitId);
          }
        }
      }
      // F9 -> Toggle Cash Drawer Modal
      else if (code === 'F9' || keyLower === 'f9') {
        e.preventDefault();
        setShowCashDrawerModal(prev => !prev);
      } 
      // F10 -> Hold Bill or Toggle Held Bills Sheet
      else if (code === 'F10' || keyLower === 'f10') {
        e.preventDefault();
        const currentCart = useCartStore.getState();
        if (currentCart.items.length > 0) {
          currentCart.holdBill();
          toast.success(`📌 พักบิลเรียบร้อยแล้ว (มีบิลพักค้างไว้ ${useCartStore.getState().heldBills.length} ใบ)`);
        } else {
          setShowHeldBills(prev => !prev);
        }
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
      } else if (e.ctrlKey && (code === 'KeyH' || keyLower === 'h')) {
        e.preventDefault();
        setShowOrderHistoryModal(prev => !prev);
      } else if (e.ctrlKey && (code === 'KeyM' || keyLower === 'm')) {
        e.preventDefault();
        setShowCustomerSelect(prev => !prev);
      } else if (e.ctrlKey && (code === 'KeyE' || keyLower === 'e')) {
        e.preventDefault();
        useCartStore.getState().clearCart();
      } else if (e.ctrlKey && (code === 'KeyP' || keyLower === 'p')) {
        e.preventDefault();
        const currentCart = useCartStore.getState();
        if (currentCart.items.length > 0) {
          currentCart.holdBill();
          toast.success(`📌 พักบิลเรียบร้อยแล้ว (มีบิลพักค้างไว้ ${useCartStore.getState().heldBills.length} ใบ)`);
        } else {
          setShowHeldBills(prev => !prev);
        }
      }
    };

    // Registered on document (bubble phase) so it always runs before window-level listeners such as the
    // global F3 document search, which checks e.defaultPrevented.
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    router, 
    selectedCartIndex, 
    searchQuery,
    showPayment, 
    showOpenShift, 
    showCloseShift, 
    editItem, 
    showCustomerSelect, 
    showHeldBills, 
    qtyEditItem, 
    priceEditItem, 
    showDebtCollectModal, 
    showCashDrawerModal, 
    showClaimModal, 
    showUnitModal, 
    showRedeemModal, 
    showBarcodeScan, 
    showOrderHistoryModal, 
    showCustomerStockModal, 
    claimTargetItem
  ]);

  // Filter products
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

  const visibleProducts = useMemo(() => {
    return filteredProducts.slice(0, displayLimit);
  }, [filteredProducts, displayLimit]);

  if (!mounted) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[#F5EFEB] p-6 text-black">
        <div className="w-16 h-16 rounded-2xl bg-[#FF6B00] border-2 border-black text-black flex items-center justify-center font-black text-3xl shadow-[4px_4px_0px_#000] mb-4 animate-bounce">
          ⚡
        </div>
        <h2 className="text-xl font-black text-black">กำลังเปิด PURIM POS (Neo-Brutalist Edition)...</h2>
        <p className="text-xs font-bold text-neutral-600 mt-1">กำลังโหลดแคตตาล็อกสินค้าและระบบคำนวณราคา</p>
      </div>
    );
  }

  return (
    <div 
      className="flex min-h-dvh flex-col bg-[#F5EFEB] pb-24 lg:pb-0 text-black lg:h-screen lg:overflow-hidden select-none font-sans" 
      onClick={handleEmptySpaceClick}
    >
      {/* Hidden Scanner Input */}
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
            if (raw) processBarcodeScan(raw);
          }
        }}
        className="sr-only absolute -top-[9999px] -left-[9999px] opacity-0 pointer-events-none w-0 h-0"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        spellCheck={false}
      />

      {/* Editing Order Banner */}
      {cart.editingOrderId && (
        <div className="bg-[#FEF08A] text-black px-4 py-2 border-b-2 border-black flex items-center justify-between shadow-[0_2px_0px_#000] shrink-0 z-30">
          <span className="font-black text-xs sm:text-sm flex items-center gap-2">
            ⚠️ กำลังอยู่ในโหมดแก้ไขรายการบิล #{cart.editingOrderId} (กดชำระเงินจะบันทึกทับบิลเดิม)
          </span>
          <button 
            type="button"
            onClick={() => cart.clearCart()}
            className="bg-white hover:bg-neutral-100 text-black text-xs font-black px-3 py-1 rounded-lg border-2 border-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
          >
            ยกเลิกการแก้ไข
          </button>
        </div>
      )}

      {/* TOP HEADER: Neo-Brutalist Retro Bar */}
      <header className="shrink-0 border-b-2 border-black bg-white px-3 py-2 sm:px-4 z-20 shadow-[0_2px_0px_#000]">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          
          {/* Left Brand & Navigation */}
          <div className="flex items-center gap-2 shrink-0">
            <Link 
              href="/dashboard"
              className="group flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#FEF08A] px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] transition-all hover:bg-[#FDE047] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="กลับหน้าแดชบอร์ดหลัก"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">แดชบอร์ด</span>
            </Link>

            <PosLogoutButton variant="neo" />

            <div className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-black px-2.5 py-1.5 text-white shadow-[2px_2px_0px_#000]">
              <span className="w-2 h-2 rounded-full bg-[#FF6B00] animate-ping" />
              <span className="text-xs font-black tracking-wider uppercase">PURIM POS</span>
              <span className="rounded bg-[#FF6B00] px-1 py-0.2 text-[9px] font-black text-black">NEO</span>
            </div>

            <Link
              href="/pos"
              className="hidden md:flex items-center gap-1 rounded-lg border-2 border-black bg-white px-2 py-1.5 text-[11px] font-bold text-neutral-700 shadow-[2px_2px_0px_#000] hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="สลับไปหน้าจอ POS แบบดั้งเดิม"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>โหมดคลาสสิก</span>
            </Link>
          </div>

          {/* Center Search & Scanner Bar */}
          <div className="flex-1 max-w-xl min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="ยิงบาร์โค้ด หรือพิมพ์ชื่อสินค้า / SKU แล้วกด Enter..."
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
                className="w-full h-10 rounded-xl border-2 border-black bg-[#F8F6F0] pl-9 pr-3 text-xs sm:text-sm font-bold text-black placeholder:text-neutral-500 shadow-[2px_2px_0px_#000] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6B00]"
              />
            </div>
          </div>

          {/* Right Action Pills */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* View Mode Selector */}
            <div className="flex items-center rounded-xl border-2 border-black bg-white p-0.5 shadow-[2px_2px_0px_#000]">
              <button
                type="button"
                onClick={() => handleViewModeChange('touch_screen')}
                className={`rounded-lg px-2 py-1 text-xs font-black transition-all flex items-center gap-1 ${
                  viewMode === 'touch_screen'
                    ? 'bg-[#FEF08A] text-black border border-black shadow-[1px_1px_0px_#000]'
                    : 'text-neutral-600 hover:text-black'
                }`}
                title="หน้าจอขายแบบ Touch Screen"
              >
                <span>📱 Touch</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('list_view')}
                className={`rounded-lg px-2 py-1 text-xs font-black transition-all flex items-center gap-1 ${
                  viewMode === 'list_view'
                    ? 'bg-[#FEF08A] text-black border border-black shadow-[1px_1px_0px_#000]'
                    : 'text-neutral-600 hover:text-black'
                }`}
                title="หน้าจอขายแบบรายการสินค้า"
              >
                <span>📋 รายการ</span>
              </button>
            </div>

            {/* Camera Barcode Scanner */}
            <button
              type="button"
              onClick={() => setShowBarcodeScan(true)}
              className="h-10 w-10 flex items-center justify-center rounded-xl border-2 border-black bg-white shadow-[2px_2px_0px_#000] hover:bg-[#FEF08A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="เปิดกล้องสแกนบาร์โค้ด"
            >
              <ScanLine className="w-4 h-4 text-black" />
            </button>

            {/* Document Search (F3) */}
            <button
              type="button"
              onClick={() => useDocumentSearchStore.getState().openSearch()}
              className="hidden sm:flex h-10 items-center gap-1.5 rounded-xl border-2 border-black bg-[#E0E7FF] px-2.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#C7D2FE] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="ค้นหาเอกสารทั้งหมด / สแกนบาร์โค้ดใบเสร็จ (F3 เมื่อตะกร้าว่าง; มีสินค้าในตะกร้า F3 = ส่วนลดรายการ)"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>ค้นหาเอกสาร</span>
              <span className="rounded bg-black px-1 py-0.2 font-mono text-[10px] text-white">F3</span>
            </button>

            {/* Held Bills Indicator (F10) */}
            {cart.heldBills.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHeldBills(true)}
                className="h-10 rounded-xl border-2 border-black bg-[#FEF08A] hover:bg-[#FDE047] text-black font-black text-xs px-2.5 shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1.5 animate-pulse"
                title="ดูรายการบิลที่พักไว้และเรียกคืน (F10)"
              >
                <PauseCircle className="w-3.5 h-3.5 text-black" />
                <span>บิลพัก ({cart.heldBills.length})</span>
              </button>
            )}

            {/* History (Ctrl+H) */}
            <button
              type="button"
              onClick={() => setShowOrderHistoryModal(prev => !prev)}
              className="hidden lg:flex h-10 items-center gap-1 rounded-xl border-2 border-black bg-white px-2.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="ประวัติการขาย (Ctrl+H)"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>ประวัติ</span>
            </button>

            {/* Digital Clock */}
            <div className="hidden xl:flex h-10 items-center rounded-xl border-2 border-black bg-[#FEF08A] px-2.5 font-mono text-xs font-black text-black shadow-[2px_2px_0px_#000]">
              {currentTime}
            </div>

            {/* Shift Open / Close */}
            {!shiftStore.isShiftOpen() ? (
              <button
                type="button"
                onClick={() => setShowOpenShift(true)}
                className="h-10 rounded-xl border-2 border-black bg-[#86EFAC] px-3 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#4ADE80] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1.5"
              >
                <Store className="w-3.5 h-3.5" />
                <span>เปิดกะ</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowCloseShift(true)}
                className="h-10 rounded-xl border-2 border-black bg-[#FECDD3] px-3 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#FDA4AF] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1.5"
                title="ปิดกะการขาย"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">ปิดกะ</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      {viewMode === 'list_view' ? (
        <PosNeoListLayout
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onOpenPayment={handleOpenNormalPayment}
          onOpenSplitPayment={() => {
            if (cart.items.length === 0) {
              toast.warning('ไม่มีสินค้าในตะกร้า ไม่สามารถชำระเงินได้');
              return;
            }
            setPaymentInitialMethod('SPLIT');
            setShowPayment(true);
          }}
          onOpenBillDiscount={() => setShowBillDiscount(true)}
          onEditItem={(item) => setEditItem(item)}
          onOpenNumpadQty={(item) => setQtyEditItem(item)}
          onSelectCustomer={() => setShowCustomerSelect(true)}
          onOpenHoldBills={() => setShowHeldBills(true)}
          onOpenHistory={() => setShowOrderHistoryModal(true)}
          onOpenBarcodeScan={() => setShowBarcodeScan(true)}
          onOpenDebtPay={(cust) => {
            setDebtTargetCustomer(cust || activeCustomer);
            setShowDebtCollectModal(true);
          }}
          onOpenCashDrawer={() => setShowCashDrawerModal(true)}
          onOpenCustomerStock={() => setShowCustomerStockModal(true)}
          onOpenItemClaim={(item) => setClaimTargetItem(item)}
          selectedCartIndex={selectedCartIndex}
          onSelectCartIndex={setSelectedCartIndex}
        />
      ) : (
      <div className="flex flex-1 flex-col overflow-visible lg:flex-row lg:overflow-hidden p-2 sm:p-3 gap-3">
        
        {/* LEFT: PRODUCTS EXPLORER */}
        <div className="flex min-w-0 flex-1 flex-col rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0px_#000] overflow-hidden">
          
          {/* Category Tabs: Neo-Brutalist Pill Slider */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b-2 border-black bg-[#FAF6EE] p-2.5 no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`rounded-lg px-3 py-1.5 text-xs font-black transition-all border-2 border-black ${
                activeCategory === null
                  ? 'bg-[#FF6B00] text-black shadow-[2px_2px_0px_#000] scale-102'
                  : 'bg-white text-black hover:bg-[#FEF08A] shadow-[2px_2px_0px_#000]'
              }`}
            >
              ทั้งหมด ({products.length})
            </button>
            {categories.map((c) => {
              const count = products.filter(p => p.categoryId === c.id).length;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black transition-all border-2 border-black whitespace-nowrap shrink-0 ${
                    activeCategory === c.id
                      ? 'bg-[#FF6B00] text-black shadow-[2px_2px_0px_#000] scale-102'
                      : 'bg-white text-black hover:bg-[#FEF08A] shadow-[2px_2px_0px_#000]'
                  }`}
                >
                  {c.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Quick Info & Telemetry bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#FAF6EE] border-b-2 border-black text-[11px] font-bold text-neutral-700">
            <span>แสดง {visibleProducts.length} จาก {filteredProducts.length} รายการ</span>
            <span className="flex items-center gap-1 font-mono text-[10px] bg-white border border-black px-1.5 py-0.2 rounded shadow-[1px_1px_0px_#000]">
              ⚡ ยิงบาร์โค้ดได้ทันทีโดยไม่ต้องคลิกช่องค้นหา
            </span>
          </div>

          {/* Products Grid */}
          <div className="flex-1 overflow-y-auto bg-[#FBF9F4] p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visibleProducts.map((p) => (
                <PosNeoProductCard
                  key={p.id}
                  product={p}
                  searchQuery={searchQuery}
                  onAddToCart={(prod, unit) => {
                    cart.addItem(prod, unit);
                    toast.success(`เพิ่ม ${prod.name} (${unit.unitName}) แล้ว`);
                  }}
                />
              ))}
            </div>

            {/* Pagination Load More */}
            {filteredProducts.length > displayLimit && (
              <div className="py-6 text-center">
                <button
                  type="button"
                  onClick={() => setDisplayLimit(prev => prev + PAGE_SIZE)}
                  className="rounded-xl border-2 border-black bg-white px-6 py-2.5 text-xs font-black text-black shadow-[3px_3px_0px_#000] hover:bg-[#FEF08A] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                >
                  โหลดสินค้าเพิ่มเติม (+{Math.min(PAGE_SIZE, filteredProducts.length - displayLimit)})
                </button>
              </div>
            )}

            {filteredProducts.length === 0 && (
              <div className="flex min-h-80 flex-col items-center justify-center text-neutral-400 space-y-3">
                <Search className="w-12 h-12 opacity-30 text-black" />
                <p className="font-black text-black text-base">ไม่พบสินค้าที่ตรงกับการค้นหา</p>
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setActiveCategory(null); }}
                  className="rounded-lg border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0px_#000] hover:bg-[#FEF08A]"
                >
                  ล้างตัวกรองทั้งหมด
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: CASHIER RECEIPT / TICKET CART */}
        <div 
          id="pos-cart" 
          className="flex w-full shrink-0 flex-col rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0px_#000] lg:w-[420px] xl:w-[460px] overflow-hidden"
        >
          {/* Ticket Title Bar */}
          <div className="flex shrink-0 items-center justify-between border-b-2 border-black bg-[#FAF6EE] p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-black bg-[#FF6B00] shadow-[2px_2px_0px_#000]">
                <ShoppingCart className="w-4 h-4 text-black" />
              </span>
              <div>
                <span className="font-black text-sm text-black block leading-none">รายการในบิล</span>
                <span className="text-[10px] font-bold text-neutral-500">CASHIER REGISTER</span>
              </div>
              <span className="rounded-md border border-black bg-[#FEF08A] px-2 py-0.5 text-xs font-black text-black shadow-[1px_1px_0px_#000] ml-1">
                {cart.getItemCount()} ชิ้น
              </span>
            </div>

            <button
              type="button"
              onClick={cart.clearCart}
              disabled={cart.items.length === 0}
              className="flex items-center gap-1 rounded-lg border border-black bg-white px-2 py-1 text-xs font-bold text-neutral-700 shadow-[1.5px_1.5px_0px_#000] hover:bg-[#FECDD3] hover:text-black active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-40 disabled:pointer-events-none"
              title="ล้างตะกร้า (Ctrl+E)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ล้าง</span>
            </button>
          </div>

          {/* Customer Selection Pill */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-black bg-[#F8F6F0] p-2.5">
            <div className="min-w-0">
              <div className="text-xs font-black text-black truncate flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-black" />
                <span>{cart.customerName ? cart.customerName : 'ลูกค้าทั่วไป'}</span>
              </div>
              {activeCustomer && (
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] font-bold">
                  <span className="rounded bg-[#FEF08A] px-1.5 py-0.2 border border-black font-mono">
                    🪙 {activeCustomer.points.toLocaleString()} แต้ม
                  </span>
                  {activeCustomer.priceLevel > 1 && (
                    <span className="rounded bg-[#BAE6FD] px-1.5 py-0.2 border border-black font-mono">
                      ระดับ {activeCustomer.priceLevel}
                    </span>
                  )}
                  {cart.getPointsDiscountAmount() > 0 && (
                    <span className="rounded bg-[#86EFAC] px-1.5 py-0.2 border border-black font-mono">
                      -{formatCurrency(cart.getPointsDiscountAmount())}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowCustomerStockModal(true)}
                className="rounded-lg border border-black bg-[#E0E7FF] px-2 py-1 text-[11px] font-black text-black shadow-[1.5px_1.5px_0px_#000] hover:bg-[#C7D2FE] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                title="สิทธิ์เคลมและคลังสินค้าลูกค้า"
              >
                สิทธิ์เคลม
              </button>
              {activeCustomer && (
                <button
                  type="button"
                  onClick={() => setShowRedeemModal(true)}
                  className="rounded-lg border border-black bg-[#FEF08A] px-2 py-1 text-[11px] font-black text-black shadow-[1.5px_1.5px_0px_#000] hover:bg-[#FDE047] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                >
                  {cart.getPointsDiscountAmount() > 0 ? 'ปรับแต้ม' : 'ใช้แต้ม'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCustomerSelect(true)}
                className="rounded-lg border border-black bg-white px-2 py-1 text-[11px] font-black text-black shadow-[1.5px_1.5px_0px_#000] hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              >
                {cart.customerName ? 'เปลี่ยน' : 'เลือกลูกค้า'}
              </button>
            </div>
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[#FAF8F5]">
            {/* Keyboard Shortcuts Helper Strip */}
            {cart.items.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 bg-[#FAF6EE] border-2 border-black rounded-xl text-[11px] font-black text-black shadow-[1.5px_1.5px_0px_#000]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="bg-[#FF6B00] text-black px-1.5 py-0.2 rounded border border-black text-[10px]">
                    ⌨️ คีย์ลัด
                  </span>
                  <span>[↑/↓] เลือกแถว</span>
                  <span>•</span>
                  <span className="bg-white px-1 py-0.2 rounded border border-black shadow-[1px_1px_0px_#000]">[F2] จำนวน</span>
                  <span>•</span>
                  <span className="bg-white px-1 py-0.2 rounded border border-black shadow-[1px_1px_0px_#000]">[F3] ส่วนลด</span>
                  <span>•</span>
                  <span className="bg-white px-1 py-0.2 rounded border border-black shadow-[1px_1px_0px_#000]">[F4] ราคา</span>
                  <span>•</span>
                  <span>[+/-] ปรับ</span>
                  <span>•</span>
                  <span>[Del] ลบ</span>
                </div>
                <span className="font-mono text-[10px] bg-white px-2 py-0.5 rounded border border-black font-bold">
                  {selectedCartIndex + 1}/{cart.items.length}
                </span>
              </div>
            )}

            {/* Pending Claims Banner */}
            {cart.pendingClaims && cart.pendingClaims.length > 0 && (
              <div className="rounded-xl border-2 border-black bg-[#FEF08A] p-2.5 text-xs shadow-[2px_2px_0px_#000] space-y-1">
                <div className="flex items-center justify-between font-black text-black">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-black" />
                    มีส่วนลดเคลมรอหัก ({cart.pendingClaims.length} รายการ):
                  </span>
                  <span className="font-mono text-sm">
                    -{formatCurrency(cart.getClaimDiscountAmount())}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {cart.pendingClaims.map((pc) => (
                    <span key={pc.id} className="inline-flex items-center gap-1 rounded border border-black bg-white px-1.5 py-0.5 text-[10px] font-bold">
                      <span>{pc.productName} ({formatQty(pc.quantity)} {pc.unitName})</span>
                      <button
                        type="button"
                        onClick={() => {
                          cart.removePendingClaim(pc.id);
                          toast.info(`ยกเลิกส่วนลดเคลม ${pc.productName} แล้ว`);
                        }}
                        className="font-black hover:text-red-600 ml-1"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {cart.items.length === 0 ? (
              <div className="flex h-full min-h-52 flex-col items-center justify-center text-neutral-400 space-y-2">
                <ShoppingCart className="w-12 h-12 opacity-20 text-black" />
                <p className="font-black text-neutral-700 text-sm">ยังไม่มีสินค้าในบิล</p>
                <p className="text-xs font-bold text-neutral-500">ยิงบาร์โค้ด หรือคลิกเลือกสินค้าจากรายการ</p>
              </div>
            ) : (
              cart.items.map((item, idx) => {
                const lineTotal = cart.getItemLineTotal(item);
                const effectivePrice = cart.getEffectivePrice(item);
                const isSelected = idx === selectedCartIndex;

                return (
                  <div
                    key={`${item.productId}-${item.unitId}`}
                    id={`cart-item-${idx}`}
                    onClick={() => setSelectedCartIndex(idx)}
                    className={`rounded-xl border-2 p-2.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-black bg-[#FEF08A]/40 ring-2 ring-[#FF6B00] shadow-[3.5px_3.5px_0px_#FF6B00]'
                        : 'border-black bg-white shadow-[2px_2px_0px_#000] hover:border-black hover:shadow-[3px_3px_0px_#000]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isSelected && (
                            <span className="rounded bg-[#FF6B00] px-1.5 py-0.2 text-[9px] font-black text-black shadow-[1px_1px_0px_#000] shrink-0">
                              ⚡ เลือกอยู่ [F2/F3/F4]
                            </span>
                          )}
                          <div className="font-black text-xs sm:text-sm text-black leading-snug truncate">
                            {item.name}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-600 mt-0.5">
                          <span className="font-mono">{item.sku}</span>
                          <span>•</span>
                          <span className="rounded bg-neutral-100 px-1 py-0.2 border border-black/30 text-black">
                            {item.unitName}
                          </span>
                          {item.discountValue > 0 && (
                            <span className="rounded bg-[#FECDD3] px-1.5 py-0.2 border border-black text-[10px] font-black text-black">
                              🏷️ ลด {item.discountValue}{item.discountType === 'percent' ? '%' : '฿'}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          cart.removeItem(item.productId, item.unitId);
                        }}
                        className="h-6 w-6 rounded-md border border-black bg-white flex items-center justify-center text-neutral-600 hover:bg-[#FECDD3] hover:text-black shadow-[1px_1px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none shrink-0"
                        title="ลบรายการนี้ (Del)"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Free Claim Badge */}
                    {item.claimQuantity !== undefined && item.claimQuantity > 0 && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded border border-black bg-[#86EFAC] px-2 py-0.5 text-[10px] font-black text-black shadow-[1px_1px_0px_#000]">
                        <ShieldCheck className="w-3 h-3 text-black" />
                        <span>เคลมฟรี {formatQty(item.claimQuantity)} {item.unitName} (คิดเงิน {formatQty(Math.max(0, subQty(item.quantity, item.claimQuantity)))} {item.unitName})</span>
                      </div>
                    )}

                    {/* Price and Quantity Controller */}
                    <div className="mt-2 flex items-center justify-between border-t border-black/10 pt-2">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-neutral-500">
                          @{formatCurrency(effectivePrice)}
                        </span>
                        <span className="font-mono text-sm font-black text-black">
                          {formatCurrency(lineTotal)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCartIndex(idx);
                            setEditItem(item);
                          }}
                          className="h-7 px-2 rounded-lg border border-black bg-white text-[10px] font-black text-black shadow-[1px_1px_0px_#000] hover:bg-[#FEF08A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                          title="แก้ไขส่วนลด / รายละเอียดสินค้า (F3)"
                        >
                          <Percent className="w-3 h-3 inline mr-0.5" />
                          ส่วนลด (F3)
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCartIndex(idx);
                            setPriceEditItem(item);
                          }}
                          className="h-7 px-2 rounded-lg border border-black bg-white text-[10px] font-black text-black shadow-[1px_1px_0px_#000] hover:bg-[#FEF08A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none mr-0.5"
                          title="แก้ไขราคาขาย (F4)"
                        >
                          <Tag className="w-3 h-3 inline mr-0.5" />
                          ราคา (F4)
                        </button>

                        <div className="flex items-center rounded-lg border border-black bg-[#FAF6EE] p-0.5 shadow-[1px_1px_0px_#000]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCartIndex(idx);
                              cart.updateQuantity(item.productId, subQty(item.quantity, 1), item.unitId);
                            }}
                            className="h-7 w-7 rounded border border-black bg-white flex items-center justify-center font-black hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px]"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCartIndex(idx);
                              setQtyEditItem(item);
                            }}
                            className="h-7 w-10 text-center font-mono font-black text-xs text-black hover:bg-[#FEF08A] transition-colors"
                            title="คลิกเพื่อแก้ไขจำนวนด้วย Numpad (F2)"
                          >
                            {formatQty(item.quantity)}
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCartIndex(idx);
                              cart.updateQuantity(item.productId, addQty(item.quantity, 1), item.unitId);
                            }}
                            className="h-7 w-7 rounded border border-black bg-white flex items-center justify-center font-black hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={cartBottomRef} />
          </div>

          {/* Cart Breakdown Summary */}
          <div className="shrink-0 space-y-2 border-t-2 border-black bg-white p-3 sm:p-3.5">
            {/* Bill Note */}
            <div className="flex items-center gap-2 rounded-lg border-2 border-black bg-[#FAF6EE] px-2.5 py-1 shadow-[1.5px_1.5px_0px_#000]">
              <span className="text-[11px] font-black text-black shrink-0">โน้ตบิล:</span>
              <input
                type="text"
                placeholder="ระบุหมายเหตุท้ายบิล..."
                value={cart.note || ''}
                onChange={(e) => cart.setNote(e.target.value)}
                className="w-full bg-transparent text-xs font-bold text-black placeholder:text-neutral-500 focus:outline-none"
              />
              {cart.note && (
                <button
                  type="button"
                  onClick={() => cart.setNote('')}
                  className="text-neutral-400 hover:text-black text-xs font-black"
                >
                  &times;
                </button>
              )}
            </div>

            {/* Subtotal */}
            <div className="flex justify-between items-center rounded-xl border-2 border-black bg-[#FAF6EE] p-2.5 shadow-[1.5px_1.5px_0px_#000]">
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-black text-black">ยอดรวม</span>
                <span className="text-xs sm:text-sm font-black text-black bg-white px-2 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000]">
                  รวมทั้งหมด <span className="underline font-mono text-sm sm:text-base font-black">{cart.getItemCount()}</span> ชิ้น
                </span>
              </div>
              <span className="font-mono text-lg sm:text-2xl font-black text-black">{formatCurrency(cart.getSubtotal())}</span>
            </div>

            {/* Bill Discount */}
            <div className="flex justify-between items-center text-xs font-bold">
              <button
                type="button"
                onClick={() => setShowBillDiscount(true)}
                className="flex items-center gap-1 border-b border-dashed border-black pb-0.5 text-black hover:text-[#FF6B00]"
                title="คลิกเพื่อเพิ่มส่วนลดท้ายบิล"
              >
                <span>ส่วนลดท้ายบิล</span>
                {cart.billDiscountType !== 'none' && (
                  <span className="rounded border border-black bg-[#FECDD3] px-1 text-[10px] font-black">
                    {cart.billDiscountValue}{cart.billDiscountType === 'percent' ? '%' : '฿'}
                  </span>
                )}
              </button>
              <span className="font-mono font-black text-red-600">
                {cart.getBillDiscountAmount() > 0 ? `-${formatCurrency(cart.getBillDiscountAmount())}` : '฿0.00'}
              </span>
            </div>

            {/* Points Discount */}
            {cart.getPointsDiscountAmount() > 0 && (
              <div className="flex justify-between items-center text-xs font-bold text-amber-900">
                <button
                  type="button"
                  onClick={() => setShowRedeemModal(true)}
                  className="hover:underline"
                >
                  🎁 ส่วนลดจากแต้ม ({cart.pointsUsed.toLocaleString()} แต้ม)
                </button>
                <span className="font-mono font-black text-amber-700">
                  -{formatCurrency(cart.getPointsDiscountAmount())}
                </span>
              </div>
            )}

            {/* Claim Discount */}
            {cart.getClaimDiscountAmount() > 0 && (
              <div className="flex justify-between items-center text-xs font-bold text-emerald-900 bg-[#86EFAC] px-2 py-1 rounded-md border border-black">
                <span>🛡️ ส่วนลดสิทธิ์เคลม</span>
                <span className="font-mono font-black">
                  -{formatCurrency(cart.getClaimDiscountAmount())}
                </span>
              </div>
            )}

            {/* VAT 7% */}
            <div className="flex justify-between items-center text-xs font-bold text-neutral-600">
              <div className="flex items-center gap-1.5">
                <span>ภาษี VAT 7%</span>
                <button
                  type="button"
                  onClick={() => cart.setVatEnabled(!cart.isVatEnabled)}
                  className={`rounded border border-black px-1.5 py-0.2 text-[10px] font-black shadow-[1px_1px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] ${
                    cart.isVatEnabled ? 'bg-[#86EFAC] text-black' : 'bg-neutral-200 text-neutral-600'
                  }`}
                >
                  {cart.isVatEnabled ? 'ถอด VAT' : 'ไม่มี VAT'}
                </button>
              </div>
              <span className="font-mono font-bold text-black">
                {cart.isVatEnabled ? formatCurrency(cart.getVatAmount()) : '฿0.00'}
              </span>
            </div>

            {/* GRAND TOTAL: Big Neo-Brutalist Box */}
            <div className="rounded-xl border-2 border-black bg-[#FEF08A] p-3.5 shadow-[3.5px_3.5px_0px_#000] flex items-center justify-between">
              <div>
                <span className="text-xs sm:text-sm font-black tracking-wider uppercase text-black block">ยอดชำระสุทธิ (NET)</span>
                <span className="text-[10px] font-mono font-bold text-neutral-700">GRAND TOTAL</span>
              </div>
              <div className="text-right">
                <span className="font-mono text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-black leading-none">
                  {formatCurrency(cart.getTotal())}
                </span>
              </div>
            </div>
          </div>

          {/* ACTION BUTTONS (Bottom 3 Chunky Buttons) */}
          <div className="grid shrink-0 grid-cols-3 gap-2 border-t-2 border-black bg-[#FAF6EE] p-2.5 sm:p-3">
            {/* Drawer (F9) */}
            <button
              type="button"
              onClick={() => setShowCashDrawerModal(true)}
              className="h-13 rounded-xl border-2 border-black bg-[#BAE6FD] hover:bg-[#93C5FD] text-black font-black text-xs flex flex-col items-center justify-center gap-0.5 shadow-[2.5px_2.5px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              title="เปิดลิ้นชัก หรือนำเงินเข้า-ออก (F9)"
            >
              <Coins className="w-4 h-4 text-black" />
              <span>ลิ้นชัก (F9)</span>
            </button>

            {/* Hold Bill (F10) */}
            <button
              type="button"
              onClick={handleHoldBillAction}
              disabled={cart.items.length === 0 && cart.heldBills.length === 0}
              className={`h-13 rounded-xl border-2 border-black text-black font-black text-xs flex flex-col items-center justify-center gap-0.5 shadow-[2.5px_2.5px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:pointer-events-none transition-all ${
                cart.items.length > 0 
                  ? 'bg-white hover:bg-neutral-100' 
                  : cart.heldBills.length > 0
                  ? 'bg-[#FEF08A] hover:bg-[#FDE047] animate-pulse'
                  : 'bg-white'
              }`}
              title="พักบิลปัจจุบัน หรือ ดูบิลที่พักไว้ (F10)"
            >
              <PauseCircle className="w-4 h-4 text-black" />
              <span>
                {cart.items.length > 0 
                  ? 'พักบิล (F10)' 
                  : cart.heldBills.length > 0 
                  ? `บิลพัก (${cart.heldBills.length})` 
                  : 'พักบิล (F10)'}
              </span>
            </button>

            {/* Pay Button (F12) - Radiant Electric Orange */}
            <button
              type="button"
              onClick={handleOpenNormalPayment}
              disabled={cart.items.length === 0}
              className="h-13 rounded-xl border-2 border-black bg-[#FF6B00] hover:bg-[#FF7A1A] text-black font-black text-base flex items-center justify-center gap-1.5 shadow-[3.5px_3.5px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:pointer-events-none"
              title="ชำระเงิน (F12 หรือคลิก)"
            >
              <CreditCard className="w-5 h-5 text-black" />
              <span>ชำระเงิน</span>
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Floating Bottom Bar for Mobile Screen (< lg) */}
      {cart.items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden border-t-2 border-black bg-white p-3 shadow-[0_-3px_0px_#000] flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-neutral-600">
              ตะกร้า ({cart.getItemCount()} ชิ้น)
            </span>
            <span className="text-xl font-black font-mono text-black">
              {formatCurrency(cart.getTotal())}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const cartElem = document.getElementById('pos-cart');
                if (cartElem) cartElem.scrollIntoView({ behavior: 'smooth' });
              }}
              className="rounded-xl border-2 border-black bg-white px-3 py-2 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              ดูบิล
            </button>
            <button
              type="button"
              onClick={handleOpenNormalPayment}
              className="rounded-xl border-2 border-black bg-[#FF6B00] px-5 py-2 text-sm font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1"
            >
              <CreditCard className="w-4 h-4" />
              <span>ชำระเงิน</span>
            </button>
          </div>
        </div>
      )}

      {/* ALL PRODUCTION MODALS (Completely Untouched Logic) */}
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
            toast.success(`เพิ่ม ${unitModalProduct.name} (${unit.unitName}) แล้ว`);
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
        allowDecimals={allowDecimalQty}
        quantityMode
        onConfirm={(val) => {
          if (qtyEditItem && val > 0) {
            const qty = parseQty(val, allowDecimalQty);
            cart.updateQuantity(qtyEditItem.productId, qty, qtyEditItem.unitId);
            toast.success(`อัปเดตจำนวนเป็น ${formatQty(qty)} ${qtyEditItem.unitName}`);
          }
          setQtyEditItem(null);
          setTimeout(() => scannerInputRef.current?.focus(), 20);
        }}
      />

      <NumpadPopup
        open={!!priceEditItem}
        onOpenChange={(open) => {
          if (!open) {
            setPriceEditItem(null);
            setTimeout(() => scannerInputRef.current?.focus(), 20);
          }
        }}
        title={`แก้ไขราคาขาย: ${priceEditItem?.name || ''}`}
        subtitle="ระบุราคาขายใหม่ต่อหน่วย (บาท)"
        initialValue={priceEditItem ? cart.getEffectivePrice(priceEditItem) : 0}
        allowDecimals={true}
        onConfirm={(val) => {
          if (priceEditItem && val >= 0) {
            cart.setCustomPrice(priceEditItem.productId, val, priceEditItem.unitId);
            toast.success(`แก้ไขราคาขาย "${priceEditItem.name}" เป็น ${formatCurrency(val)}`);
          }
          setPriceEditItem(null);
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

      <CustomerClaimStockModal
        isOpen={showCustomerStockModal}
        onClose={() => setShowCustomerStockModal(false)}
        onOpenCustomerSelect={() => setShowCustomerSelect(true)}
      />
    </div>
  );
}
