'use client';

import { toast } from 'sonner';
import {
  ShoppingCart, Trash2, Minus, Plus, Tag, PauseCircle, Percent, CreditCard, Coins,
  ShieldAlert, ShieldCheck, User,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { addQty, formatQty, subQty } from '@/lib/qty';
import { useCartStore } from '@/lib/store/cart-store';
import type { PosController } from '@/lib/pos/use-pos-controller';

/** Right side of the neo touch screen: the bill (customer, rows, totals) and the three big buttons. */
export function NeoCartPanel({ pos }: { pos: PosController }) {
  const { cart, dialogs: d, activeCustomer } = pos;
  const { selectedIndex, setSelectedIndex, cartBottomRef } = pos.selection;

  /** "พักบิล" button: hold the current bill, else open the held bills, else say there is nothing to hold. */
  const holdOrShowHeld = () => {
    if (cart.items.length > 0) {
      cart.holdBill();
      toast.success(`📌 พักบิลเรียบร้อยแล้ว (มีบิลพักค้างไว้ ${useCartStore.getState().heldBills.length} ใบ)`);
    } else if (cart.heldBills.length > 0) {
      d.setShowHeldBills(true);
    } else {
      toast.info('ไม่มีสินค้าในตะกร้าที่จะพัก');
    }
  };

  return (
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
            onClick={() => d.setShowCustomerStockModal(true)}
            className="rounded-lg border border-black bg-[#E0E7FF] px-2 py-1 text-[11px] font-black text-black shadow-[1.5px_1.5px_0px_#000] hover:bg-[#C7D2FE] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            title="สิทธิ์เคลมและคลังสินค้าลูกค้า"
          >
            สิทธิ์เคลม
          </button>
          {activeCustomer && (
            <button
              type="button"
              onClick={() => d.setShowRedeemModal(true)}
              className="rounded-lg border border-black bg-[#FEF08A] px-2 py-1 text-[11px] font-black text-black shadow-[1.5px_1.5px_0px_#000] hover:bg-[#FDE047] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              {cart.getPointsDiscountAmount() > 0 ? 'ปรับแต้ม' : 'ใช้แต้ม'}
            </button>
          )}
          <button
            type="button"
            onClick={() => d.setShowCustomerSelect(true)}
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
              {selectedIndex + 1}/{cart.items.length}
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
            const isSelected = idx === selectedIndex;

            return (
              <div
                key={`${item.productId}-${item.unitId}`}
                id={`cart-item-${idx}`}
                onClick={() => setSelectedIndex(idx)}
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
                        setSelectedIndex(idx);
                        d.setEditItem(item);
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
                        setSelectedIndex(idx);
                        d.setPriceEditItem(item);
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
                          setSelectedIndex(idx);
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
                          setSelectedIndex(idx);
                          d.setQtyEditItem(item);
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
                          setSelectedIndex(idx);
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
            onClick={() => d.setShowBillDiscount(true)}
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
              onClick={() => d.setShowRedeemModal(true)}
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
          onClick={() => d.setShowCashDrawerModal(true)}
          className="h-13 rounded-xl border-2 border-black bg-[#BAE6FD] hover:bg-[#93C5FD] text-black font-black text-xs flex flex-col items-center justify-center gap-0.5 shadow-[2.5px_2.5px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          title="เปิดลิ้นชัก หรือนำเงินเข้า-ออก (F9)"
        >
          <Coins className="w-4 h-4 text-black" />
          <span>ลิ้นชัก (F9)</span>
        </button>

        {/* Hold Bill (F10) */}
        <button
          type="button"
          onClick={holdOrShowHeld}
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
          onClick={d.openPayment}
          disabled={cart.items.length === 0}
          className="h-13 rounded-xl border-2 border-black bg-[#FF6B00] hover:bg-[#FF7A1A] text-black font-black text-base flex items-center justify-center gap-1.5 shadow-[3.5px_3.5px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:pointer-events-none"
          title="ชำระเงิน (F12 หรือคลิก)"
        >
          <CreditCard className="w-5 h-5 text-black" />
          <span>ชำระเงิน</span>
        </button>
      </div>
    </div>
  );
}
