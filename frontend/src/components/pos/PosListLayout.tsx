'use client';

import { useState, useRef, useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { Product, CartItem, ProductUnit } from '@/lib/types';
import { getProductAvailableUnits, getDefaultSelectedUnit } from '@/lib/product-unit-helpers';
import { 
  Grid, Calculator, ChevronDown, Edit3, Trash2, 
  Clock, User, ShoppingBag, ScanLine, StickyNote, Coins
} from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { NumpadPopup } from './NumpadPopup';
import { ItemNotePopup } from './ItemNotePopup';
import { SelectUnitModal } from './SelectUnitModal';
import { RedeemPointsModal } from './RedeemPointsModal';
import { Customer, getCustomerById, calculateEarnedPoints } from '@/lib/customer-service';
import { toast } from 'sonner';

interface PosListLayoutProps {
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
}

export function PosListLayout({
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
  onOpenCashDrawer
}: PosListLayoutProps) {
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cartBottomRef = useRef<HTMLDivElement>(null);

  const handleEmptySpaceClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], label, table');
    if (!isInteractive && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // Auto focus search input on mount
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Auto-scroll to bottom of list when items change
  useEffect(() => {
    if (cart.items.length > 0 && cartBottomRef.current) {
      cartBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cart.items.length, cart.items]);

  // Filter products for search dropdown
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
      toast.error(`สต๊อกไม่เพียงพอสำหรับหน่วย ${targetUnit.unitName} (คงเหลือ ${product.stock} หน่วยฐาน)`);
      return;
    }

    cart.addItem(product, targetUnit);
    toast.success(`เพิ่ม ${product.name} (${targetUnit.unitName}) ลงตะกร้าแล้ว`);
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
      e.preventDefault();
      setSelectedIndex(prev => {
        const next = (prev + 1) % Math.max(1, filteredProducts.length);
        setSelectedUnitIndex(0);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const next = (prev - 1 + filteredProducts.length) % Math.max(1, filteredProducts.length);
        setSelectedUnitIndex(0);
        return next;
      });
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
      if (filteredProducts.length > 0) {
        const p = filteredProducts[selectedIndex || 0];
        const availableUnits = getProductAvailableUnits(p);
        const targetUnit = availableUnits[selectedUnitIndex] || getDefaultSelectedUnit(p, availableUnits, searchQuery);
        handleSelectProduct(p, targetUnit);
      } else if (searchQuery.trim()) {
        const exact = products.find(p => p.sku === searchQuery.trim() || p.units?.some(u => u.barcode === searchQuery.trim()));
        if (exact) {
          const availableUnits = getProductAvailableUnits(exact);
          const targetUnit = availableUnits[selectedUnitIndex] || getDefaultSelectedUnit(exact, availableUnits, searchQuery);
          handleSelectProduct(exact, targetUnit);
        } else {
          toast.error(`ไม่พบสินค้า: ${searchQuery}`);
        }
      }
    } else if (e.key === 'Escape') {
      setIsSearchOpen(false);
      setSelectedUnitIndex(0);
    }
  };

  // Shortcut key handling (F12, F10, Ctrl+H, Ctrl+M, Ctrl+E, Ctrl+P) - Works on Thai & English OS layouts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const keyLower = e.key ? e.key.toLowerCase() : '';

      // F9 -> Open Cash Drawer (Cash In / Out)
      if (code === 'F9' || keyLower === 'f9') {
        e.preventDefault();
        onOpenCashDrawer?.();
      }
      // F10 -> Direct shortcut to open Held Bills Sheet
      else if (code === 'F10' || keyLower === 'f10' || (e.ctrlKey && e.shiftKey && (code === 'KeyP' || keyLower === 'p'))) {
        e.preventDefault();
        onOpenHoldBills();
      }
      // F12 -> Payment
      else if (code === 'F12' || keyLower === 'f12') {
        e.preventDefault();
        if (useCartStore.getState().items.length > 0) onOpenPayment();
      } 
      // Ctrl + H -> Order History
      else if (e.ctrlKey && (code === 'KeyH' || keyLower === 'h')) {
        e.preventDefault();
        onOpenHistory();
      } 
      // Ctrl + M -> Select Customer
      else if (e.ctrlKey && (code === 'KeyM' || keyLower === 'm')) {
        e.preventDefault();
        onSelectCustomer();
      } 
      // Ctrl + E -> Clear Cart
      else if (e.ctrlKey && (code === 'KeyE' || keyLower === 'e')) {
        e.preventDefault();
        useCartStore.getState().clearCart();
      } 
      // Ctrl + P -> Hold Bill / View Held Bills
      else if (e.ctrlKey && (code === 'KeyP' || keyLower === 'p')) {
        e.preventDefault();
        const currentCart = useCartStore.getState();
        if (currentCart.items.length > 0) {
          currentCart.holdBill();
          toast.success('📌 พักบิลปัจจุบันเรียบร้อยแล้ว');
        } else {
          onOpenHoldBills();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenPayment, onOpenHistory, onSelectCustomer, onOpenHoldBills, onOpenCashDrawer]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 text-slate-900 overflow-hidden font-sans" onClick={handleEmptySpaceClick}>
      
      {/* ─── EDITING ORDER BANNER ─── */}
      {cart.editingOrderId && (
        <div className="bg-indigo-600 text-white px-5 py-2.5 flex items-center justify-between shadow-md shrink-0">
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

      {/* ─── CUSTOMER TOP BAR (Dynamic Customer Loyalty & Points) ─── */}
      {cart.customerId && (
        <div className="bg-sky-50/90 px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b-2 border-sky-500 shadow-2xs">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-slate-700 text-xs sm:text-sm font-bold flex items-center gap-1.5">
              <User className="w-4 h-4 text-sky-600" /> สมาชิก:
            </span>
            <span className="text-slate-900 font-extrabold text-sm sm:text-base bg-white px-3 py-0.5 rounded-lg border border-slate-200 shadow-2xs">
              {cart.customerName}
            </span>
            {currentCustomer?.type === 'COMPANY' && (
              <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold px-1.5 py-0.5 rounded">
                🏢 บริษัท
              </span>
            )}
            {currentCustomer?.priceLevel && currentCustomer.priceLevel > 1 && (
              <span className="text-xs bg-sky-100 text-sky-800 font-bold px-2 py-0.5 rounded">
                ราคา ระดับ {currentCustomer.priceLevel}
              </span>
            )}
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white/90 px-2.5 py-0.5 rounded-lg border border-slate-200">
              <span>แต้มสะสม:</span>
              <b className="text-amber-700 font-black">{(currentCustomer?.points ?? 0).toLocaleString()} แต้ม</b>
              {earnedPointsFromCart > 0 && (
                <span className="text-emerald-600 font-extrabold text-xs">
                  (บิลนี้ได้ +{earnedPointsFromCart} แต้ม)
                </span>
              )}
            </div>
            {cart.getPointsDiscountAmount() > 0 && (
              <div className="flex items-center gap-1 text-xs font-black bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-lg">
                <span>🎁 ใช้ {cart.pointsUsed.toLocaleString()} แต้ม ลด {formatCurrency(cart.getPointsDiscountAmount())}</span>
              </div>
            )}
            {currentCustomer?.currentDebt && currentCustomer.currentDebt > 0 ? (
              <button
                type="button"
                onClick={() => onOpenDebtPay?.(currentCustomer)}
                className="flex items-center gap-1.5 text-xs font-extrabold bg-rose-100 hover:bg-rose-200 text-rose-900 border border-rose-300 px-2.5 py-0.5 rounded-lg transition-colors cursor-pointer"
                title="คลิกเพื่อรับชำระหนี้/เงินเชื่อของสมาชิกรายนี้"
              >
                <span>ค้างชำระ: {formatCurrency(currentCustomer.currentDebt)}</span>
                <span className="bg-rose-600 text-white text-xs px-1.5 py-0.5 rounded shadow-2xs font-bold">รับชำระ</span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {currentCustomer?.currentDebt && currentCustomer.currentDebt > 0 && (
              <button
                type="button"
                onClick={() => onOpenDebtPay?.(currentCustomer)}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span>💳 รับชำระหนี้</span>
              </button>
            )}
            <button 
              type="button"
              onClick={() => setShowRedeemModal(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>{cart.getPointsDiscountAmount() > 0 ? '✏️ ปรับแต้มส่วนลด' : '🎁 ใช้แต้มลดราคา'}</span>
            </button>
            <button 
              type="button"
              onClick={() => cart.setCustomer(null, null)} 
              title="ยกเลิกการเลือกสมาชิก"
              className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full w-6 h-6 flex items-center justify-center transition-colors border border-slate-200 bg-white cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* ─── 1. TOP CONTROL & DIGITAL LED DISPLAY BAR ─── */}
      <div className="bg-white p-3 sm:p-4 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-center shrink-0 shadow-sm">
        
        {/* Left Search & Note Input Area (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-2.5">
          {/* Note Input */}
          <div className="flex items-center bg-white rounded-xl h-13 shadow-sm border border-slate-300 overflow-hidden">
            <div className="bg-[#9aa0ac] w-14 h-full flex items-center justify-center shrink-0">
               <Grid className="w-6 h-6 text-white" />
            </div>
            <input 
              type="text"
              placeholder="ระบุโน้ต"
              value={cart.note || ''}
              onChange={(e) => cart.setNote?.(e.target.value)}
              className="w-full text-base font-bold outline-none bg-transparent px-3.5 text-slate-900 placeholder:text-slate-400"
            />
          </div>

          {/* Search/Barcode Dropdown Box */}
          <div className="relative">
            <div className="flex items-center bg-white rounded-xl h-13 shadow-sm border-2 border-sky-500 overflow-hidden focus-within:ring-2 focus-within:ring-sky-400">
              <div className="bg-sky-500 w-14 h-full flex items-center justify-center shrink-0">
                 <Calculator className="w-6 h-6 text-white" />
              </div>
              <input 
                ref={searchInputRef}
                type="text"
                placeholder="ชื่อ / ซีเรียล / บาร์โค้ด"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setIsSearchOpen(true); }}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setIsSearchOpen(true)}
                className="w-full text-base sm:text-lg font-bold outline-none bg-transparent px-3.5 text-slate-900 placeholder:text-slate-400"
              />
              <button 
                type="button"
                onClick={onOpenBarcodeScan}
                className="px-3 h-full bg-white hover:bg-slate-50 border-l border-slate-200 text-slate-500 hover:text-sky-600 transition-colors flex items-center"
                title="เปิดสแกนบาร์โค้ด"
              >
                <ChevronDown className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Dropdown Results */}
            {isSearchOpen && filteredProducts.length > 0 && (
              <div ref={dropdownRef} className="absolute left-0 top-full mt-1.5 w-full bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden max-h-80 overflow-y-auto divide-y divide-slate-100">
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
                      className={`p-3.5 text-sm flex items-center justify-between cursor-pointer transition-all ${isCurrentRow ? 'bg-sky-100/90 text-sky-950 font-bold border-l-4 border-l-sky-600 shadow-xs' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="font-extrabold text-base text-slate-900 truncate">{p.name}</div>
                        <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                          <span>SKU: {p.sku}</span>
                          <span>·</span>
                          <span>สต็อก:</span>
                          {Number(p.stock ?? 0) < 0 ? (
                            <span className="font-extrabold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 shadow-2xs">
                              🔻 {p.stock} {p.unit || 'ชิ้น'}
                            </span>
                          ) : Number(p.stock ?? 0) === 0 ? (
                            <span className="font-bold text-rose-600">0 {p.unit || 'ชิ้น'}</span>
                          ) : (
                            <span className="font-semibold text-slate-700">{p.stock} {p.unit || 'ชิ้น'}</span>
                          )}
                        </div>
                      </div>

                      {/* Unit Selector Pills */}
                      <div className="flex items-center gap-1.5 shrink-0">
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
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 cursor-pointer ${
                                isOutOfStock
                                  ? 'opacity-40 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through'
                                  : isActive
                                  ? 'bg-sky-600 text-white border-sky-600 font-black shadow-md ring-2 ring-sky-400 scale-105'
                                  : 'bg-white hover:bg-sky-50 text-slate-700 border-slate-300'
                              }`}
                            >
                              <span>{u.unitName}</span>
                              <span className="font-mono opacity-90">{formatCurrency(u.price)}</span>
                              {isOutOfStock && <span className="text-[9px] text-red-500 font-bold ml-0.5">(หมด)</span>}
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

        {/* Center High-Contrast Black Digital LED Display (5 cols) */}
        <div className="lg:col-span-5 bg-slate-950 rounded-2xl p-4 sm:p-5 text-white flex items-center justify-between border-2 border-slate-900 shadow-2xl h-[112px]">
          <div className="flex flex-col justify-center h-full space-y-0.5">
            <span className="text-xs sm:text-sm text-slate-300 font-bold">ราคารวม {formatCurrency(cart.getSubtotal())}</span>
            {cart.getBillDiscountAmount() > 0 && (
              <span className="text-xs text-rose-400 font-bold">ลดท้ายบิล -{formatCurrency(cart.getBillDiscountAmount())}</span>
            )}
            {cart.getPointsDiscountAmount() > 0 && (
              <span className="text-xs text-amber-400 font-extrabold">ลดแต้ม ({cart.pointsUsed.toLocaleString()} แต้ม) -{formatCurrency(cart.getPointsDiscountAmount())}</span>
            )}
            {cart.getClaimDiscountAmount() > 0 && (
              <span className="text-xs text-emerald-400 font-extrabold">ลดเคลมสินค้า -{formatCurrency(cart.getClaimDiscountAmount())}</span>
            )}
          </div>
          <div className="flex flex-col items-end justify-center h-full">
            <span className="text-xs text-slate-300 font-bold mb-0.5 uppercase tracking-wider">รวมสุทธิ</span>
            <span className="text-5xl lg:text-6xl font-black text-[#00ff00] font-sans drop-shadow-[0_0_12px_rgba(0,255,0,0.85)] leading-none">
              {formatCurrency(cart.getTotal())}
            </span>
          </div>
        </div>

        {/* Right Discount & Payment Action Buttons (3 cols) */}
        <div className="lg:col-span-3 flex flex-col gap-2.5">
          {/* Bill Discount Bar */}
          <div 
            onClick={onOpenBillDiscount}
            className="flex items-center justify-between bg-white text-slate-800 rounded-xl px-4 h-13 shadow-sm border border-slate-300 cursor-pointer hover:bg-slate-50 hover:border-slate-400 transition-all"
          >
            <div className="flex items-center gap-1.5 text-base font-extrabold text-slate-800">
              <span>ลด ฿</span>
              <ChevronDown className="w-5 h-5 text-slate-400" />
            </div>
            <span className="text-base sm:text-lg font-black text-red-600 font-mono">
              {cart.getBillDiscountAmount() > 0 ? formatNumber(cart.getBillDiscountAmount()) : '0.00'}
            </span>
          </div>

          {/* Payment Buttons */}
          <div className="flex gap-2.5">
            <button 
              onClick={onOpenPayment}
              disabled={cart.items.length === 0}
              className="flex-[2] bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-black text-lg sm:text-xl h-13 rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-all"
            >
              <span>ชำระเงิน</span>
              <span className="text-xs opacity-90 font-semibold">(F12)</span>
            </button>
            <button 
              onClick={onOpenSplitPayment}
              disabled={cart.items.length === 0}
              className="flex-1 bg-white hover:bg-slate-50 disabled:opacity-50 text-sky-600 font-bold text-xs sm:text-sm leading-tight h-13 px-1 rounded-xl shadow-sm border border-slate-300 transition-colors flex items-center justify-center text-center"
            >
              ชำระหลาย<br/>ช่องทาง
            </button>
          </div>
        </div>
      </div>

      {/* ─── 2. MAIN TABLE CONTENT AREA ─── */}
      <div className="flex-1 overflow-y-auto bg-white p-3 sm:p-4">
        {cart.items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 min-h-64 py-12">
            {/* POSPOS Logo Graphic Scanner Placeholder */}
            <div className="border-2 border-dashed border-sky-300 rounded-2xl p-8 sm:p-12 flex flex-col items-center justify-center bg-sky-50/40 shadow-sm max-w-lg w-full">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-black text-3xl text-slate-800 tracking-wider">POSPOS</span>
                <span className="text-xs text-sky-600 font-bold bg-sky-100 px-2 py-1 rounded-md">by PURIM</span>
              </div>
              <div className="w-64 h-16 bg-white border border-slate-200 rounded-xl flex items-center justify-center gap-1 shadow-sm my-4 px-4">
                <div className="flex gap-1.5 items-center justify-center w-full">
                  <div className="w-2 h-12 bg-slate-800" />
                  <div className="w-1 h-12 bg-slate-800" />
                  <div className="w-3 h-12 bg-slate-800" />
                  <div className="w-1.5 h-12 bg-slate-800" />
                  <div className="w-1 h-12 bg-slate-800" />
                  <div className="w-4 h-12 bg-slate-800" />
                  <div className="w-1.5 h-12 bg-slate-800" />
                  <div className="w-3 h-12 bg-slate-800" />
                  <div className="w-1 h-12 bg-slate-800" />
                  <div className="w-2 h-12 bg-slate-800" />
                </div>
              </div>
              <p className="text-sm text-slate-500 font-semibold text-center">
                ยิงบาร์โค้ดด้วยเครื่องสแกน หรือค้นหาชื่อสินค้าเพื่อเพิ่มลงรายการ
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
            <table className="w-full text-left">
                <thead className="text-sm font-bold text-slate-700 border-b-2 border-slate-200 bg-slate-50/90 sticky top-0 z-10">
                  <tr>
                    <th className="py-3.5 px-4 font-bold w-2/5">ชื่อรายการสินค้า <span className="font-semibold text-slate-500 text-xs">({cart.items.length} รายการ, {cart.getItemCount()} ชิ้น)</span></th>
                    <th className="py-3.5 px-4 font-bold text-right">ราคา/หน่วย</th>
                    <th className="py-3.5 px-4 font-bold text-center w-28">จำนวน</th>
                    <th className="py-3.5 px-4 font-bold text-center">ส่วนลด</th>
                    <th className="py-3.5 px-4 font-bold text-right">ราคารวม</th>
                    <th className="py-3.5 px-4 font-bold text-center w-20">จัดการ</th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {cart.items.map((item, idx) => {
                  const lineTotal = cart.getItemLineTotal(item);
                  const effectivePrice = cart.getEffectivePrice(item);
                  const itemDiscount = cart.getItemDiscountAmount(item);

                  return (
                    <tr key={`${item.productId}-${item.unitId}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-4 px-4 text-slate-900">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-bold text-base min-w-[24px]">{idx + 1}.</span>
                            <span className="text-base sm:text-lg font-bold text-slate-900 leading-snug">{item.name}</span>
                          </div>
                          {item.itemNote && (
                            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-medium mt-0.5 inline-block w-fit ml-8">
                              📝 โน้ต: {item.itemNote}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right font-bold text-slate-800 text-base sm:text-lg">
                        <div className="flex items-center justify-end gap-1.5 cursor-pointer hover:text-sky-600" onClick={() => setPriceEditItem(item)} title="คลิกเพื่อแก้ไขราคาต่อหน่วย (Numpad)">
                          <span>{formatCurrency(effectivePrice)}</span>
                          <Edit3 className="w-4 h-4 text-slate-400 hover:text-sky-600" />
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div 
                          onClick={() => onOpenNumpadQty?.(item)}
                          className="inline-flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-sm h-10 w-24 cursor-pointer hover:border-sky-500 hover:bg-sky-50 transition-all"
                          title="คลิกเพื่อแก้ไขจำนวนด้วย Numpad"
                        >
                          <span className="w-full text-center font-extrabold text-slate-900 text-base">{item.quantity}</span>
                          <span className="px-2 text-xs font-semibold text-slate-600 border-l border-slate-300 h-full flex items-center bg-slate-50 whitespace-nowrap">{item.unitName}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div className="inline-flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-sm h-10 w-32 focus-within:border-sky-500 hover:border-sky-400 transition-all">
                          <span 
                            onClick={() => setDiscountEditItem(item)}
                            className="flex-1 text-sm font-extrabold text-slate-900 text-right pr-2 cursor-pointer hover:text-sky-600 truncate h-full flex items-center justify-end"
                            title="คลิกเพื่อระบุส่วนลดด้วย Numpad"
                          >
                            {item.discountValue > 0 ? formatNumber(item.discountValue) : '0'}
                          </span>
                          <select
                            value={item.discountType === 'percent' ? 'percent' : 'baht'}
                            onChange={(e) => {
                              const newType = e.target.value as 'baht' | 'percent';
                              cart.setItemDiscount(item.productId, newType, item.discountValue, item.unitId);
                            }}
                            className="px-1.5 bg-slate-100 hover:bg-slate-200 border-l border-slate-300 text-slate-800 h-full flex items-center font-extrabold text-xs outline-none cursor-pointer"
                            title="เลือกชนิดส่วนลด (บาท หรือ %)"
                          >
                            <option value="baht">฿</option>
                            <option value="percent">%</option>
                          </select>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right font-black text-slate-900 text-lg sm:text-xl">
                        {formatCurrency(lineTotal)}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            type="button"
                            onClick={() => setNoteEditItem(item)} 
                            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="ระบุโน้ตประจำรายการ"
                          >
                            <StickyNote className="w-5 h-5" />
                          </button>
                          <button 
                            type="button"
                            onClick={() => cart.removeItem(item.productId, item.unitId)} 
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="ลบรายการ"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div ref={cartBottomRef} />
          </div>
        )}
      </div>

      {/* ─── 3. BOTTOM ACTION SHORTCUTS BAR ─── */}
      <div className="bg-white border-t border-slate-200 px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm shrink-0 shadow-lg">
        <div className="flex flex-wrap items-center gap-2">
          <button 
            type="button"
            onClick={onOpenHistory} 
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold px-3.5 py-2.5 min-h-[44px] rounded-lg shadow-sm transition-all text-xs sm:text-sm"
          >
            <Clock className="w-4 h-4" />
            <span>ประวัติ</span>
            <span className="text-xs opacity-80 font-normal">(Ctrl+H)</span>
          </button>
          
          <button 
            type="button"
            onClick={onSelectCustomer} 
            className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 text-white font-extrabold px-3.5 py-2.5 min-h-[44px] rounded-lg shadow-sm transition-all text-xs sm:text-sm"
          >
            <User className="w-4 h-4" />
            <span>ลูกค้า</span>
            <span className="text-xs opacity-80 font-normal">(Ctrl+M)</span>
          </button>
          
          <button 
            type="button"
            onClick={() => cart.clearCart()} 
            className="flex items-center gap-1.5 bg-rose-500 hover:bg-rose-600 text-white font-extrabold px-3.5 py-2.5 min-h-[44px] rounded-lg shadow-sm transition-all text-xs sm:text-sm"
          >
            <Trash2 className="w-4 h-4" />
            <span>เคลียร์</span>
            <span className="text-xs opacity-80 font-normal">(Ctrl+E)</span>
          </button>

          <button 
            type="button"
            onClick={() => {
              if (cart.items.length > 0) {
                cart.holdBill();
                toast.success('📌 พักบิลปัจจุบันเรียบร้อยแล้ว');
              } else {
                onOpenHoldBills();
              }
            }} 
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white font-extrabold px-3.5 py-2.5 min-h-[44px] rounded-lg shadow-sm transition-all text-xs sm:text-sm"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>พักบิล</span>
            <span className="text-xs opacity-80 font-normal">(Ctrl+P)</span>
          </button>

          <button 
            type="button"
            onClick={onOpenHoldBills} 
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-3.5 py-2.5 min-h-[44px] rounded-lg shadow-sm transition-all text-xs sm:text-sm"
          >
            <Clock className="w-4 h-4" />
            <span>ดูบิลพัก</span>
            <span className="text-xs opacity-80 font-normal">(F10)</span>
          </button>

          <button 
            type="button"
            onClick={onOpenCashDrawer} 
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-3.5 py-2.5 min-h-[44px] rounded-lg shadow-sm transition-all text-xs sm:text-sm"
            title="เปิดลิ้นชัก / บันทึกเงินเข้า-ออก (F9)"
          >
            <Coins className="w-4 h-4" />
            <span>เปิดลิ้นชัก</span>
            <span className="text-xs opacity-80 font-normal">(F9)</span>
          </button>
        </div>

        {/* Option Selector for Sales Screen View */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs sm:text-sm text-slate-700 font-extrabold hidden sm:inline">รูปแบบหน้าจอขาย:</span>
          <select 
            value={viewMode}
            onChange={(e) => onViewModeChange(e.target.value as 'touch_screen' | 'list_view')}
            className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs sm:text-sm font-bold rounded-lg px-3 py-2 outline-none shadow-sm cursor-pointer transition-all"
          >
            <option value="touch_screen">📱 หน้าจอแบบ touch screen</option>
            <option value="list_view">📋 หน้าจอแบบรายการ</option>
          </select>
        </div>
      </div>

      {/* Unit Price Numpad Popup (With Decimals) */}
      <NumpadPopup
        open={!!priceEditItem}
        onOpenChange={(open) => {
          if (!open) {
            setPriceEditItem(null);
            setTimeout(() => searchInputRef.current?.focus(), 20);
          }
        }}
        title={`ระบุราคาต่อหน่วย: ${priceEditItem?.name || ''}`}
        subtitle="ราคาสินค้าที่ระบุ"
        initialValue={priceEditItem ? cart.getEffectivePrice(priceEditItem) : 0}
        allowDecimals={true}
        onConfirm={(val) => {
          if (priceEditItem && val >= 0) {
            cart.setCustomPrice(priceEditItem.productId, val, priceEditItem.unitId);
            toast.success(`อัปเดตราคาเป็น ฿${val.toFixed(2)} / ${priceEditItem.unitName}`);
          }
          setPriceEditItem(null);
          setTimeout(() => searchInputRef.current?.focus(), 20);
        }}
      />

      {/* Item Discount Numpad Popup (With Decimals) */}
      <NumpadPopup
        open={!!discountEditItem}
        onOpenChange={(open) => {
          if (!open) {
            setDiscountEditItem(null);
            setTimeout(() => searchInputRef.current?.focus(), 20);
          }
        }}
        title={`ระบุส่วนลด: ${discountEditItem?.name || ''}`}
        subtitle="ส่วนลดที่ระบุ"
        initialValue={discountEditItem?.discountValue || 0}
        allowDecimals={true}
        onConfirm={(val) => {
          if (discountEditItem && val >= 0) {
            const currentType = discountEditItem.discountType === 'none' ? 'baht' : discountEditItem.discountType;
            cart.setItemDiscount(discountEditItem.productId, currentType, val, discountEditItem.unitId);
            toast.success(`อัปเดตส่วนลดเป็น ${val} ${currentType === 'percent' ? '%' : 'บาท'}`);
          }
          setDiscountEditItem(null);
          setTimeout(() => searchInputRef.current?.focus(), 20);
        }}
      />

      {/* Item Note Popup */}
      <ItemNotePopup
        open={!!noteEditItem}
        onOpenChange={(open) => {
          if (!open) {
            setNoteEditItem(null);
            setTimeout(() => searchInputRef.current?.focus(), 20);
          }
        }}
        title={`ระบุโน้ต: ${noteEditItem?.name || ''}`}
        initialNote={noteEditItem?.itemNote || ''}
        onConfirm={(note) => {
          if (noteEditItem) {
            cart.setItemNote(noteEditItem.productId, note, noteEditItem.unitId);
            if (note) {
              toast.success(`บันทึกโน้ต "${note}" เรียบร้อยแล้ว`);
            } else {
              toast.info('ล้างโน้ตรายการเรียบร้อยแล้ว');
            }
          }
          setNoteEditItem(null);
          setTimeout(() => searchInputRef.current?.focus(), 20);
        }}
      />

      <SelectUnitModal
        open={showUnitModal}
        onOpenChange={setShowUnitModal}
        product={unitModalProduct}
        onSelectUnit={(unit) => {
          if (unitModalProduct) {
            cart.addItem(unitModalProduct, unit);
            toast.success(`เพิ่ม ${unitModalProduct.name} (${unit.unitName}) ลงตะกร้าแล้ว`);
            setTimeout(() => searchInputRef.current?.focus(), 20);
          }
        }}
      />

      <RedeemPointsModal
        open={showRedeemModal}
        onOpenChange={setShowRedeemModal}
        customer={currentCustomer}
      />
    </div>
  );
}
