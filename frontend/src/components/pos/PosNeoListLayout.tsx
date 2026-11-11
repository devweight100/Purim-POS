'use client';

import { useState, useRef, useEffect } from 'react';
import { useCartStore, validateDiscount } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { Product, CartItem, ProductUnit } from '@/lib/types';
import { getProductAvailableUnits, getDefaultSelectedUnit } from '@/lib/product-unit-helpers';
import { 
  Grid, Calculator, ChevronDown, Edit3, Trash2, 
  Clock, User, ShoppingBag, ScanLine, StickyNote, Coins,
  ShieldCheck, ShieldAlert, Package, ArrowLeft, Plus, Minus, Tag, CreditCard,
  Layers, Monitor
} from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { NumpadPopup } from './NumpadPopup';
import { ItemNotePopup } from './ItemNotePopup';
import { SelectUnitModal } from './SelectUnitModal';
import { RedeemPointsModal } from './RedeemPointsModal';
import { Customer, getCustomerById, calculateEarnedPoints } from '@/lib/customer-service';
import { convertThaiToEnBarcode } from '@/lib/thai-barcode-converter';
import { toast } from 'sonner';
import { addQty, formatQty, subQty } from '@/lib/qty';

interface PosNeoListLayoutProps {
  viewMode: 'touch_screen' | 'list_view';
  onViewModeChange: (mode: 'touch_screen' | 'list_view') => void;
  onOpenPayment: () => void;
  onOpenSplitPayment: () => void;
  onOpenBillDiscount: () => void;
  onEditItem: (item: CartItem) => void;
  onOpenNumpadQty?: (item: CartItem) => void;
  onSelectCustomer: () => void;
  onOpenHoldBills: () => void;
  onOpenHistory: () => void;
  onOpenBarcodeScan: () => void;
  onOpenDebtPay?: (customer?: Customer | null) => void;
  onOpenCashDrawer?: () => void;
  onOpenCustomerStock?: () => void;
  onOpenItemClaim?: (item: CartItem) => void;
  selectedCartIndex?: number;
  onSelectCartIndex?: (idx: number) => void;
}

export function PosNeoListLayout({
  viewMode,
  onViewModeChange,
  onOpenPayment,
  onOpenSplitPayment,
  onOpenBillDiscount,
  onEditItem,
  onOpenNumpadQty,
  onSelectCustomer,
  onOpenHoldBills,
  onOpenHistory,
  onOpenBarcodeScan,
  onOpenDebtPay,
  onOpenCashDrawer,
  onOpenCustomerStock,
  onOpenItemClaim,
  selectedCartIndex = 0,
  onSelectCartIndex
}: PosNeoListLayoutProps) {
  const cart = useCartStore();
  const { products } = useProductStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);
  const [priceEditItem, setPriceEditItem] = useState<CartItem | null>(null);
  const [discountEditItem, setDiscountEditItem] = useState<CartItem | null>(null);
  const [noteEditItem, setNoteEditItem] = useState<CartItem | null>(null);
  const [unitModalProduct, setUnitModalProduct] = useState<Product | null>(null);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [currentCustomer, setCurrentCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    if (cart.customerId) {
      const cust = getCustomerById(cart.customerId);
      setCurrentCustomer(cust);
    } else {
      setCurrentCustomer(null);
    }
  }, [cart.customerId]);

  const earnedPointsFromCart = currentCustomer ? calculateEarnedPoints(currentCustomer, cart.getTotal()) : 0;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const [scannerInputValue, setScannerInputValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cartBottomRef = useRef<HTMLDivElement>(null);

  const handleEmptySpaceClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], label, table');
    if (!isInteractive && scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  };

  useEffect(() => {
    if (scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  }, []);

  const findProductByExactCode = (code: string): Product | undefined => {
    if (!code) return undefined;
    return products.find(p => {
      const matchSku = p.sku?.toLowerCase().trim() === code;
      const matchUnitBarcode = p.units?.some(u => u.barcode?.toLowerCase().trim() === code);
      const matchProductBarcodes = (p as any).barcodes?.some((b: any) => b.barcode?.toLowerCase().trim() === code);
      const availableUnits = getProductAvailableUnits(p);
      const matchAvailBarcode = availableUnits.some(u => u.barcode?.toLowerCase().trim() === code);
      return matchSku || matchUnitBarcode || matchProductBarcodes || matchAvailBarcode;
    });
  };

  const processBarcodeScan = (scannedBarcode: string) => {
    const raw = scannedBarcode.trim();
    if (!raw) return;

    // Raw code first (ASCII SKUs like "RICE-JAS-5KG" stay intact), Thai-keyboard conversion only as fallback
    const convertedCode = convertThaiToEnBarcode(raw).trim();
    let code = raw.toLowerCase();
    let matchedProduct: Product | undefined;
    for (const candidate of [raw.toLowerCase(), convertedCode.toLowerCase()]) {
      matchedProduct = findProductByExactCode(candidate);
      if (matchedProduct) { code = candidate; break; }
    }

    if (matchedProduct) {
      const availableUnits = getProductAvailableUnits(matchedProduct);
      const targetUnit = availableUnits.find(u => u.barcode?.toLowerCase().trim() === code) || getDefaultSelectedUnit(matchedProduct, availableUnits, convertedCode);
      handleSelectProduct(matchedProduct, targetUnit);
      setSearchQuery('');
      setIsSearchOpen(false);
    } else {
      const thaiHint = convertedCode !== raw ? ` (ลองแปลงจากแป้นไทยเป็น "${convertedCode}" แล้ว)` : '';
      toast.error(`❌ ไม่พบสินค้าบาร์โค้ด: "${raw}"${thaiHint}`);
    }

    setScannerInputValue('');
    setTimeout(() => scannerInputRef.current?.focus(), 10);
  };

  useEffect(() => {
    if (cart.items.length > 0 && cartBottomRef.current) {
      cartBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cart.items.length, cart.items]);

  const filteredProducts = products.filter(p => {
    if (!searchQuery.trim()) return false;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || 
           p.sku.toLowerCase().includes(q) ||
           p.units?.some(u => 
             (u.barcode && u.barcode.toLowerCase().includes(q)) ||
             (u.unitName && u.unitName.toLowerCase().includes(q))
           );
  }).slice(0, 10);

  const handleSelectProduct = (product: Product, specificUnit?: ProductUnit) => {
    const availableUnits = getProductAvailableUnits(product);
    const targetUnit = specificUnit || getDefaultSelectedUnit(product, availableUnits, searchQuery);

    if (product.stock < targetUnit.factor) {
      toast.error(`สต๊อกไม่พอสำหรับหน่วย ${targetUnit.unitName} (คงเหลือ ${product.stock} หน่วยฐาน)`);
      return;
    }

    cart.addItem(product, targetUnit);
    toast.success(`เพิ่ม ${product.name} (${targetUnit.unitName}) แล้ว`);
    setSearchQuery('');
    setIsSearchOpen(false);
    setSelectedUnitIndex(0);
  };

  useEffect(() => {
    if (isSearchOpen && dropdownRef.current) {
      const activeElement = dropdownRef.current.children[selectedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, isSearchOpen]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (isSearchOpen && filteredProducts.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent?.stopImmediatePropagation?.();
        setSelectedIndex(prev => {
          const next = (prev + 1) % filteredProducts.length;
          setSelectedUnitIndex(0);
          return next;
        });
      }
      // If search dropdown is closed or empty, let ArrowDown bubble to window to navigate cart
    } else if (e.key === 'ArrowUp') {
      if (isSearchOpen && filteredProducts.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent?.stopImmediatePropagation?.();
        setSelectedIndex(prev => {
          const next = (prev - 1 + filteredProducts.length) % filteredProducts.length;
          setSelectedUnitIndex(0);
          return next;
        });
      }
      // If search dropdown is closed or empty, let ArrowUp bubble to window to navigate cart
    } else if (e.key === 'ArrowRight') {
      if (filteredProducts.length > 0) {
        e.preventDefault();
        const p = filteredProducts[selectedIndex || 0];
        const availableUnits = getProductAvailableUnits(p);
        setSelectedUnitIndex(prev => Math.min(availableUnits.length - 1, prev + 1));
      }
    } else if (e.key === 'ArrowLeft') {
      if (filteredProducts.length > 0) {
        e.preventDefault();
        setSelectedUnitIndex(prev => Math.max(0, prev - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const raw = searchQuery.trim();
      if (!raw) return;

      const matchedBarcode = findProductByExactCode(raw.toLowerCase()) || findProductByExactCode(convertThaiToEnBarcode(raw).toLowerCase().trim());

      if (matchedBarcode) {
        processBarcodeScan(raw);
      } else if (filteredProducts.length > 0) {
        const p = filteredProducts[selectedIndex || 0];
        const availableUnits = getProductAvailableUnits(p);
        const targetUnit = availableUnits[selectedUnitIndex] || getDefaultSelectedUnit(p, availableUnits, searchQuery);
        handleSelectProduct(p, targetUnit);
      } else {
        toast.error(`ไม่พบสินค้า: ${raw}`);
      }
    } else if (e.key === 'Escape') {
      setIsSearchOpen(false);
      setSelectedUnitIndex(0);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-[#F5EFEB] select-none text-black font-sans" onClick={handleEmptySpaceClick}>
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
        <div className="bg-[#FEF08A] text-black px-4 py-2 border-b-2 border-black flex items-center justify-between shadow-[0_2px_0px_#000] shrink-0">
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

      {/* CUSTOMER LOYALTY BANNER (Neo-Brutalist Strip) */}
      {cart.customerId && (
        <div className="bg-[#FEF08A] px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-b-2 border-black shadow-[0_2px_0px_#000] shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-black text-xs font-black flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-black" /> สมาชิก:
            </span>
            <span className="rounded-lg border-2 border-black bg-white px-2.5 py-0.5 text-xs font-black text-black shadow-[1.5px_1.5px_0px_#000]">
              {cart.customerName}
            </span>
            {currentCustomer?.priceLevel && currentCustomer.priceLevel > 1 && (
              <span className="rounded-md border border-black bg-[#BAE6FD] px-2 py-0.5 text-[11px] font-black">
                ระดับราคา {currentCustomer.priceLevel}
              </span>
            )}
            <div className="flex items-center gap-1 text-xs font-black rounded-lg border border-black bg-white px-2 py-0.5 shadow-[1px_1px_0px_#000]">
              <span>แต้ม:</span>
              <span className="font-mono text-amber-900">{(currentCustomer?.points ?? 0).toLocaleString()}</span>
              {earnedPointsFromCart > 0 && (
                <span className="text-emerald-700 font-black text-[11px]">
                  (+{earnedPointsFromCart} แต้ม)
                </span>
              )}
            </div>
            {cart.getPointsDiscountAmount() > 0 && (
              <span className="rounded-md border border-black bg-[#86EFAC] px-2 py-0.5 text-[11px] font-black text-black">
                🎁 ลดแต้ม -{formatCurrency(cart.getPointsDiscountAmount())}
              </span>
            )}
            {currentCustomer?.currentDebt && currentCustomer.currentDebt > 0 && (
              <button
                type="button"
                onClick={() => onOpenDebtPay?.(currentCustomer)}
                className="flex items-center gap-1 rounded-md border border-black bg-[#FECDD3] px-2 py-0.5 text-[11px] font-black text-black hover:bg-[#FDA4AF] shadow-[1px_1px_0px_#000] active:translate-x-[1px] active:translate-y-[1px]"
              >
                <span>ค้างชำระ: {formatCurrency(currentCustomer.currentDebt)}</span>
                <span className="rounded bg-black text-white px-1 py-0.2 text-[10px]">รับชำระ</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowRedeemModal(true)}
              className="rounded-lg border-2 border-black bg-white px-2.5 py-1 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              {cart.getPointsDiscountAmount() > 0 ? '✏️ ปรับแต้ม' : '🎁 ใช้แต้ม'}
            </button>
            <button
              type="button"
              onClick={() => cart.setCustomer(null, null)}
              className="h-7 w-7 rounded-lg border border-black bg-white hover:bg-[#FECDD3] flex items-center justify-center font-black text-xs shadow-[1px_1px_0px_#000]"
              title="ยกเลิกการเลือกสมาชิก"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* TOP CONTROL DECK: Neo-Brutalist Register Deck */}
      <div className="bg-white p-3 sm:p-3.5 border-b-2 border-black grid grid-cols-1 lg:grid-cols-12 gap-3 items-center shrink-0 shadow-[0_2px_0px_#000]">
        
        {/* Left Inputs (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-2">
          {/* Bill Note */}
          <div className="flex items-center rounded-xl border-2 border-black bg-[#FAF6EE] h-11 shadow-[2.5px_2.5px_0px_#000] overflow-hidden">
            <div className="w-10 h-full flex items-center justify-center border-r-2 border-black bg-white font-black text-xs shrink-0">
              📝
            </div>
            <input 
              type="text"
              placeholder="ระบุโน้ตท้ายบิล..."
              value={cart.note || ''}
              onChange={(e) => cart.setNote?.(e.target.value)}
              className="w-full text-xs sm:text-sm font-bold bg-transparent px-3 text-black placeholder:text-neutral-500 outline-none"
            />
            {cart.note && (
              <button 
                type="button" 
                onClick={() => cart.setNote?.('')}
                className="px-2 text-neutral-400 hover:text-black font-black"
              >
                &times;
              </button>
            )}
          </div>

          {/* Search & Barcode Input */}
          <div className="relative">
            <div className="flex items-center rounded-xl border-2 border-black bg-white h-11 shadow-[2.5px_2.5px_0px_#000] overflow-hidden focus-within:ring-2 focus-within:ring-[#FF6B00]">
              <div className="w-10 h-full flex items-center justify-center border-r-2 border-black bg-[#FEF08A] font-black text-xs shrink-0">
                🔍
              </div>
              <input 
                ref={searchInputRef}
                type="text"
                placeholder="พิมพ์ชื่อสินค้า / SKU / บาร์โค้ด (Enter)..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setIsSearchOpen(true); }}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setIsSearchOpen(true)}
                className="w-full text-xs sm:text-sm font-bold bg-transparent px-3 text-black placeholder:text-neutral-500 outline-none"
              />
              <button 
                type="button"
                onClick={onOpenBarcodeScan}
                className="px-3 h-full border-l-2 border-black bg-[#FAF6EE] hover:bg-[#FEF08A] text-black font-black transition-colors flex items-center"
                title="เปิดกล้องสแกนบาร์โค้ด"
              >
                <ScanLine className="w-4 h-4" />
              </button>
            </div>

            {/* Dropdown Results */}
            {isSearchOpen && filteredProducts.length > 0 && (
              <div ref={dropdownRef} className="absolute left-0 top-full mt-1.5 w-full bg-white text-black rounded-xl border-2 border-black shadow-[4px_4px_0px_#000] z-50 overflow-hidden max-h-80 overflow-y-auto divide-y-2 divide-black/10">
                {filteredProducts.map((p, idx) => {
                  const availableUnits = getProductAvailableUnits(p);
                  const isCurrentRow = idx === selectedIndex;
                  const defaultUnit = getDefaultSelectedUnit(p, availableUnits, searchQuery);

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        const targetUnit = isCurrentRow && availableUnits[selectedUnitIndex] ? availableUnits[selectedUnitIndex] : defaultUnit;
                        handleSelectProduct(p, targetUnit);
                      }}
                      className={`p-3 text-xs sm:text-sm flex items-center justify-between cursor-pointer transition-all ${
                        isCurrentRow 
                          ? 'bg-[#FEF08A] text-black font-black border-l-4 border-l-black shadow-xs' 
                          : 'hover:bg-[#FAF6EE]'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="font-black text-sm text-black truncate">{p.name}</div>
                        <div className="text-[11px] font-mono text-neutral-600 flex items-center gap-1.5 mt-0.5">
                          <span>SKU: {p.sku}</span>
                          <span>•</span>
                          <span>สต็อก: {p.stock}</span>
                        </div>
                      </div>

                      {/* Units */}
                      <div className="flex items-center gap-1 shrink-0">
                        {availableUnits.map((u, uIdx) => {
                          const isOutOfStock = p.stock < u.factor;
                          const isActive = isCurrentRow 
                            ? uIdx === selectedUnitIndex
                            : defaultUnit.unitName === u.unitName;

                          return (
                            <button
                              key={u.id || u.unitName}
                              type="button"
                              disabled={isOutOfStock}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectProduct(p, u);
                              }}
                              className={`px-2 py-1 rounded-md text-xs font-black transition-all border border-black flex items-center gap-1 ${
                                isOutOfStock
                                  ? 'opacity-40 bg-neutral-200 text-neutral-500 cursor-not-allowed line-through'
                                  : isActive
                                  ? 'bg-[#FF6B00] text-black shadow-[2px_2px_0px_#000]'
                                  : 'bg-white hover:bg-[#FEF08A] text-black shadow-[1px_1px_0px_#000]'
                              }`}
                            >
                              <span>{u.unitName}</span>
                              <span className="font-mono">{formatCurrency(u.price)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Center Grand Total Display (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl border-2 border-black bg-[#FEF08A] p-3.5 text-black flex items-center justify-between shadow-[4px_4px_0px_#000] min-h-[105px]">
          <div className="flex flex-col justify-center h-full">
            <div className="flex items-baseline gap-2">
              <span className="text-base sm:text-lg font-black uppercase tracking-wider text-black">ยอดรวม</span>
              <span className="font-mono text-xl sm:text-2xl font-black text-black">
                {formatCurrency(cart.getSubtotal())}
              </span>
            </div>
            {cart.getBillDiscountAmount() > 0 && (
              <span className="text-xs font-black text-red-600">ลดท้ายบิล -{formatCurrency(cart.getBillDiscountAmount())}</span>
            )}
            {cart.getPointsDiscountAmount() > 0 && (
              <span className="text-xs font-black text-amber-900">ลดแต้ม -{formatCurrency(cart.getPointsDiscountAmount())}</span>
            )}
            {cart.getClaimDiscountAmount() > 0 && (
              <span className="text-xs font-black text-emerald-800">ลดเคลม -{formatCurrency(cart.getClaimDiscountAmount())}</span>
            )}
            <div className="mt-1.5">
              <span className="text-sm sm:text-base font-black text-black bg-white/80 px-2.5 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000] inline-block">
                รวมทั้งหมด <span className="underline font-mono text-base sm:text-lg font-black">{cart.getItemCount()}</span> ชิ้น
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end justify-center h-full pl-2">
            <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-neutral-800">ยอดชำระสุทธิ (NET)</span>
            <span className="font-mono text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-black leading-none">
              {formatCurrency(cart.getTotal())}
            </span>
          </div>
        </div>

        {/* Right Action Buttons (3 cols) */}
        <div className="lg:col-span-3 flex flex-col gap-2">
          {/* Bill Discount Bar */}
          <button
            type="button"
            onClick={onOpenBillDiscount}
            className="flex items-center justify-between rounded-xl border-2 border-black bg-white px-3 h-11 shadow-[2.5px_2.5px_0px_#000] hover:bg-[#FAF6EE] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            title="ใส่ส่วนลดท้ายบิล"
          >
            <div className="flex items-center gap-1 font-black text-xs sm:text-sm text-black">
              <span>ส่วนลดท้ายบิล (฿/%)</span>
              <ChevronDown className="w-4 h-4 text-neutral-500" />
            </div>
            <span className="font-mono text-sm font-black text-red-600">
              {cart.getBillDiscountAmount() > 0 ? `-${formatNumber(cart.getBillDiscountAmount())}` : '฿0.00'}
            </span>
          </button>

          {/* Checkout Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onOpenPayment}
              disabled={cart.items.length === 0}
              className="flex-[2] rounded-xl border-2 border-black bg-[#FF6B00] hover:bg-[#FF7A1A] disabled:opacity-40 text-black font-black text-base h-11 shadow-[3px_3px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center justify-center gap-1.5 transition-all"
            >
              <CreditCard className="w-4 h-4 text-black" />
              <span>ชำระเงิน (F12)</span>
            </button>
            <button
              type="button"
              onClick={onOpenSplitPayment}
              disabled={cart.items.length === 0}
              className="flex-1 rounded-xl border-2 border-black bg-white hover:bg-neutral-100 disabled:opacity-40 text-black font-black text-xs leading-tight h-11 px-1 shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center justify-center text-center"
            >
              แยกชำระ
            </button>
          </div>
        </div>
      </div>

      {/* MAIN TABLE AREA */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-3 bg-[#FAF8F5]">
        {cart.items.length === 0 ? (
          <div className="h-full min-h-64 flex flex-col items-center justify-center text-neutral-400 py-12">
            <div className="rounded-2xl border-2 border-black bg-white p-8 sm:p-12 flex flex-col items-center justify-center shadow-[4px_4px_0px_#000] max-w-lg w-full text-center space-y-3">
              <span className="text-4xl">📋</span>
              <h3 className="text-lg font-black text-black">ยังไม่มีรายการสินค้าในบิล</h3>
              <p className="text-xs font-bold text-neutral-600">
                สแกนเนอร์บาร์โค้ดพร้อมทำงานทันที หรือพิมพ์ค้นหาและกด Enter ด้านบน
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onViewModeChange('touch_screen')}
                  className="rounded-lg border-2 border-black bg-[#FEF08A] px-3 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#FDE047] active:translate-x-[1px] active:translate-y-[1px]"
                >
                  📱 สลับไปโหมด Touch Screen
                </button>
                <button
                  type="button"
                  onClick={onOpenBarcodeScan}
                  className="rounded-lg border-2 border-black bg-white px-3 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px]"
                >
                  📷 สแกนผ่านกล้อง
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-black bg-white shadow-[4px_4px_0px_#000] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-black bg-[#FAF6EE] text-[11px] font-black uppercase text-black">
                    <th className="py-2.5 px-3 w-12 text-center">#</th>
                    <th className="py-2.5 px-3">รายการสินค้า / บาร์โค้ด</th>
                    <th className="py-2.5 px-3 text-right">ราคา/หน่วย</th>
                    <th className="py-2.5 px-3 text-center w-36">จำนวน</th>
                    <th className="py-2.5 px-3 text-right">ส่วนลด</th>
                    <th className="py-2.5 px-3 text-right">ยอดรวม</th>
                    <th className="py-2.5 px-3 text-center w-28">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-black/10 text-xs sm:text-sm font-bold text-black">
                  {cart.items.map((item, idx) => {
                    const lineTotal = cart.getItemLineTotal(item);
                    const effectivePrice = cart.getEffectivePrice(item);
                    const itemDiscount = cart.getItemDiscountAmount(item);
                    const isSelected = idx === selectedCartIndex;

                    return (
                      <tr 
                        key={`${item.productId}-${item.unitId}`}
                        id={`list-cart-item-${idx}`}
                        onClick={() => onSelectCartIndex?.(idx)}
                        className={`cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[#FEF08A] font-black border-l-6 border-l-[#FF6B00] shadow-xs'
                            : 'hover:bg-[#FEF08A]/30'
                        }`}
                      >
                        {/* Index */}
                        <td className="py-3 px-3 text-center font-mono font-black text-xs">
                          {isSelected ? <span className="text-[#FF6B00] text-sm font-black">👉</span> : idx + 1}
                        </td>

                        {/* Name & SKU */}
                        <td className="py-3 px-3">
                          <div className="font-black text-sm text-black">{item.name}</div>
                          <div className="flex items-center gap-1.5 text-[11px] text-neutral-600 mt-0.5">
                            <span className="font-mono">{item.sku}</span>
                            <span>•</span>
                            <span className="rounded bg-[#FAF6EE] border border-black/40 px-1 py-0.2 text-[10px] text-black">
                              {item.unitName}
                            </span>
                            {item.isBundle && (
                              <span className="rounded bg-[#E9D5FF] border border-black px-1 py-0.2 text-[10px] font-black">
                                🎁 ชุด
                              </span>
                            )}
                          </div>
                          {item.claimQuantity !== undefined && item.claimQuantity > 0 && (
                            <div className="mt-1 inline-flex items-center gap-1 rounded border border-black bg-[#86EFAC] px-1.5 py-0.2 text-[10px] font-black">
                              <ShieldCheck className="w-3 h-3 text-black" />
                              <span>เคลมฟรี {formatQty(item.claimQuantity)} {item.unitName}</span>
                            </div>
                          )}
                          {item.itemNote && (
                            <div className="mt-0.5 text-[11px] font-bold text-amber-900 bg-[#FEF08A]/60 px-1.5 py-0.2 rounded w-fit">
                              📝 {item.itemNote}
                            </div>
                          )}
                        </td>

                        {/* Unit Price */}
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setPriceEditItem(item)}
                            className="font-mono font-black hover:underline cursor-pointer"
                            title="คลิกเพื่อแก้ไขราคาต่อหน่วย"
                          >
                            {formatCurrency(effectivePrice)}
                          </button>
                        </td>

                        {/* Quantity Controller */}
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-center rounded-lg border border-black bg-[#FAF6EE] p-0.5 shadow-[1px_1px_0px_#000] w-fit mx-auto">
                            <button
                              type="button"
                              onClick={() => cart.updateQuantity(item.productId, subQty(item.quantity, 1), item.unitId)}
                              className="h-7 w-7 rounded border border-black bg-white flex items-center justify-center font-black hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px]"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenNumpadQty?.(item)}
                              className="h-7 w-12 text-center font-mono font-black text-xs text-black hover:bg-[#FEF08A] transition-colors"
                              title="คลิกเพื่อระบุจำนวนด้วย Numpad"
                            >
                              {formatQty(item.quantity)}
                            </button>
                            <button
                              type="button"
                              onClick={() => cart.updateQuantity(item.productId, addQty(item.quantity, 1), item.unitId)}
                              className="h-7 w-7 rounded border border-black bg-white flex items-center justify-center font-black hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px]"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        {/* Item Discount */}
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setDiscountEditItem(item)}
                            className="font-mono font-black text-red-600 hover:underline cursor-pointer"
                            title="คลิกเพื่อแก้ไขส่วนลดสินค้า (F3)"
                          >
                            {itemDiscount > 0 ? `-${formatCurrency(itemDiscount)}` : <span className="text-neutral-400">0 ฿</span>}
                          </button>
                        </td>

                        {/* Line Total */}
                        <td className="py-3 px-3 text-right font-mono font-black text-base text-black">
                          {formatCurrency(lineTotal)}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setNoteEditItem(item)}
                              className="h-7 w-7 rounded border border-black bg-white hover:bg-[#FAF6EE] flex items-center justify-center shadow-[1px_1px_0px_#000] active:translate-x-[1px] active:translate-y-[1px]"
                              title="โน้ตรายการ"
                            >
                              <StickyNote className="w-3.5 h-3.5 text-neutral-700" />
                            </button>
                            {onOpenItemClaim && (
                              <button
                                type="button"
                                onClick={() => onOpenItemClaim(item)}
                                className="h-7 w-7 rounded border border-black bg-white hover:bg-[#86EFAC] flex items-center justify-center shadow-[1px_1px_0px_#000] active:translate-x-[1px] active:translate-y-[1px]"
                                title="ระบุสินค้าเคลมฟรี"
                              >
                                <ShieldCheck className="w-3.5 h-3.5 text-neutral-700" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => cart.removeItem(item.productId, item.unitId)}
                              className="h-7 w-7 rounded border border-black bg-white hover:bg-[#FECDD3] flex items-center justify-center shadow-[1px_1px_0px_#000] active:translate-x-[1px] active:translate-y-[1px]"
                              title="ลบรายการ"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-neutral-700" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Keyboard Shortcuts Helper Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#FAF6EE] border-t-2 border-black text-xs font-black text-black shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-[#FF6B00] text-black px-2 py-0.5 rounded-md border border-black shadow-[1px_1px_0px_#000]">
                  ⌨️ คีย์ลัดรายการ
                </span>
                <span>[↑ / ↓] เลือกแถว</span>
                <span>•</span>
                <span className="bg-white px-1.5 py-0.5 rounded border border-black shadow-[1px_1px_0px_#000]">[F2] แก้ไขจำนวน</span>
                <span>•</span>
                <span className="bg-white px-1.5 py-0.5 rounded border border-black shadow-[1px_1px_0px_#000]">[F3] แก้ไขส่วนลด</span>
                <span>•</span>
                <span className="bg-white px-1.5 py-0.5 rounded border border-black shadow-[1px_1px_0px_#000]">[F4] แก้ไขราคา</span>
                <span>•</span>
                <span>[+ / -] ปรับจำนวน</span>
                <span>•</span>
                <span>[Del] ลบ</span>
              </div>
              {cart.items.length > 0 && (
                <div className="font-mono text-xs bg-white px-2.5 py-0.5 rounded-md border border-black font-black shadow-[1px_1px_0px_#000]">
                  รายการที่ {(selectedCartIndex ?? 0) + 1} จาก {cart.items.length}
                </div>
              )}
            </div>
            <div ref={cartBottomRef} />
          </div>
        )}
      </div>

      {/* BOTTOM FOOTER BAR */}
      <footer className="border-t-2 border-black bg-white p-2.5 sm:px-4 shrink-0 shadow-[0_-2px_0px_#000]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          
          {/* Left Buttons: Mode switch, Member select, Drawer, Hold */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onViewModeChange('touch_screen')}
              className="rounded-lg border-2 border-black bg-[#FAF6EE] hover:bg-[#FEF08A] px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>สลับไป Touch Screen</span>
            </button>

            <button
              type="button"
              onClick={onSelectCustomer}
              className="rounded-lg border-2 border-black bg-white hover:bg-[#FAF6EE] px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1"
              title="เลือกลูกค้าสมาชิก (Ctrl+M)"
            >
              <User className="w-3.5 h-3.5" />
              <span>{cart.customerName ? cart.customerName : 'เลือกลูกค้า (Ctrl+M)'}</span>
            </button>

            {/* Hold Bill or View Held Bills */}
            <button
              type="button"
              onClick={() => {
                if (cart.items.length > 0) {
                  cart.holdBill();
                  toast.success(`📌 พักบิลเรียบร้อยแล้ว (มีบิลพักค้างไว้ ${useCartStore.getState().heldBills.length} ใบ)`);
                } else if (cart.heldBills.length > 0) {
                  onOpenHoldBills();
                } else {
                  toast.info('ไม่มีสินค้าในตะกร้าที่จะพัก');
                }
              }}
              className={`rounded-lg border-2 border-black px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1 ${
                cart.items.length > 0
                  ? 'bg-white hover:bg-[#FAF6EE]'
                  : cart.heldBills.length > 0
                  ? 'bg-[#FEF08A] hover:bg-[#FDE047] animate-pulse'
                  : 'bg-white text-neutral-400 opacity-60'
              }`}
              title="พักบิลปัจจุบัน หรือ ดูบิลที่พักไว้ (F10)"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>
                {cart.items.length > 0 
                  ? 'พักบิล (F10)' 
                  : cart.heldBills.length > 0 
                  ? `บิลพัก (${cart.heldBills.length})` 
                  : 'พักบิล (F10)'}
              </span>
            </button>

            {cart.heldBills.length > 0 && cart.items.length > 0 && (
              <button
                type="button"
                onClick={onOpenHoldBills}
                className="rounded-lg border-2 border-black bg-[#FEF08A] hover:bg-[#FDE047] px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1"
                title="ดูรายการบิลที่พักไว้"
              >
                <span>ดูบิลพัก ({cart.heldBills.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenCashDrawer}
              className="rounded-lg border-2 border-black bg-[#BAE6FD] hover:bg-[#93C5FD] px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1"
              title="เปิดลิ้นชักเก็บเงิน (F9)"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>ลิ้นชัก (F9)</span>
            </button>

            <button
              type="button"
              onClick={onOpenHistory}
              className="rounded-lg border-2 border-black bg-white hover:bg-neutral-100 px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1"
              title="ประวัติการขาย (Ctrl+H)"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>ประวัติ</span>
            </button>
          </div>

          {/* Right Summary Totals */}
          <div className="flex items-center gap-3">
            <div className="text-right text-xs sm:text-sm font-black text-black">
              <span>รวมทั้งหมด <span className="font-mono text-sm sm:text-base underline">{cart.getItemCount()}</span> ชิ้น • ยอดสุทธิ </span>
              <span className="font-mono text-xl sm:text-2xl font-black text-black">
                {formatCurrency(cart.getTotal())}
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenPayment}
              disabled={cart.items.length === 0}
              className="rounded-xl border-2 border-black bg-[#FF6B00] hover:bg-[#FF7A1A] disabled:opacity-40 px-5 py-2 text-sm font-black text-black shadow-[3px_3px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center gap-1.5"
            >
              <CreditCard className="w-4 h-4" />
              <span>ชำระเงิน (F12)</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Sub Modals for Item Price, Discount, and Note */}
      {priceEditItem && (
        <NumpadPopup
          open={!!priceEditItem}
          onOpenChange={(open) => {
            if (!open) {
              setPriceEditItem(null);
              setTimeout(() => scannerInputRef.current?.focus(), 20);
            }
          }}
          title={`แก้ไขราคา: ${priceEditItem.name}`}
          subtitle="ราคาสินค้าที่ระบุ"
          initialValue={cart.getEffectivePrice(priceEditItem)}
          allowDecimals={true}
          onConfirm={(val) => {
            if (val >= 0) {
              cart.setCustomPrice(priceEditItem.productId, val, priceEditItem.unitId);
              toast.success(`อัปเดตราคาเป็น ฿${val.toFixed(2)} / ${priceEditItem.unitName}`);
            }
            setPriceEditItem(null);
            setTimeout(() => scannerInputRef.current?.focus(), 20);
          }}
        />
      )}

      {discountEditItem && (
        <NumpadPopup
          open={!!discountEditItem}
          onOpenChange={(open) => {
            if (!open) {
              setDiscountEditItem(null);
              setTimeout(() => scannerInputRef.current?.focus(), 20);
            }
          }}
          title={`ระบุส่วนลด: ${discountEditItem.name}`}
          subtitle="ส่วนลดที่ระบุ"
          initialValue={discountEditItem.discountValue || 0}
          allowDecimals={true}
          onConfirm={(val) => {
            if (val >= 0) {
              const currentType = discountEditItem.discountType === 'none' ? 'baht' : discountEditItem.discountType;
              const discountError = validateDiscount(currentType, val, cart.getEffectivePrice(discountEditItem) * Math.max(0, subQty(discountEditItem.quantity, discountEditItem.claimQuantity || 0)));
              if (discountError) {
                toast.error(discountError);
                return;
              }
              cart.setItemDiscount(discountEditItem.productId, currentType, val, discountEditItem.unitId);
              toast.success(`อัปเดตส่วนลดเป็น ${val} ${currentType === 'percent' ? '%' : 'บาท'}`);
            }
            setDiscountEditItem(null);
            setTimeout(() => scannerInputRef.current?.focus(), 20);
          }}
        />
      )}

      {noteEditItem && (
        <ItemNotePopup
          open={!!noteEditItem}
          onOpenChange={(open) => {
            if (!open) setNoteEditItem(null);
          }}
          title={`ระบุโน้ต: ${noteEditItem.name}`}
          initialNote={noteEditItem.itemNote || ''}
          onConfirm={(note: string) => {
            cart.setItemNote(noteEditItem.productId, note, noteEditItem.unitId);
            if (note) {
              toast.success(`บันทึกโน้ต "${note}" เรียบร้อยแล้ว`);
            } else {
              toast.info('ล้างโน้ตรายการเรียบร้อยแล้ว');
            }
            setNoteEditItem(null);
            setTimeout(() => scannerInputRef.current?.focus(), 20);
          }}
        />
      )}

      {/* Select Unit Modal */}
      {unitModalProduct && (
        <SelectUnitModal
          open={showUnitModal}
          onOpenChange={setShowUnitModal}
          product={unitModalProduct}
          onSelectUnit={(unit) => {
            handleSelectProduct(unitModalProduct, unit);
            setShowUnitModal(false);
          }}
        />
      )}

      {/* Redeem Points Modal */}
      {showRedeemModal && (
        <RedeemPointsModal
          open={showRedeemModal}
          onOpenChange={setShowRedeemModal}
          customer={currentCustomer}
        />
      )}
    </div>
  );
}
