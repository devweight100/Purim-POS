'use client';

import { toast } from 'sonner';
import {
  ShoppingCart, Trash2, Minus, Plus, Tag, PauseCircle, CreditCard, Percent, Coins,
  ShieldAlert, ShieldCheck, Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { addQty, formatQty, mulQty, subQty } from '@/lib/qty';
import type { PosController } from '@/lib/pos/use-pos-controller';

/** Right side of the classic touch screen: customer, cart rows, totals and the action buttons. */
export function ClassicCartPanel({ pos }: { pos: PosController }) {
  const { cart, dialogs: d, activeCustomer } = pos;
  const { selectedIndex, setSelectedIndex, cartBottomRef } = pos.selection;

  return (
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
            onClick={() => d.setShowCustomerStockModal(true)}
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
              onClick={() => d.setShowRedeemModal(true)}
            >
              🎁 {cart.getPointsDiscountAmount() > 0 ? 'ปรับแต้ม' : 'ใช้แต้ม'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-medium text-xs"
            onClick={() => d.setShowCustomerSelect(true)}
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
              <span className="text-sm font-black text-amber-700">-{formatCurrency(cart.getClaimDiscountAmount())}</span>
            </div>
            <div className="text-[11px] text-amber-800">
              * สิทธิ์เคลมจะยังไม่ถูกตัดจนกว่าจะชำระเงินเสร็จสิ้น หากยกเลิกบิลสิทธิ์เคลมจะคงเดิม 100%
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {cart.pendingClaims.map((pc) => (
                <span key={pc.id} className="inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-amber-200 text-[10px] text-slate-700 font-medium">
                  <span>{pc.productName} ({formatQty(pc.quantity)} {pc.unitName})</span>
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
            {/* Keyboard Shortcuts Helper Strip */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="bg-sky-600 text-white px-1.5 py-0.2 rounded text-[10px] font-bold">⌨️ คีย์ลัด</span>
                <span>[↑/↓] เลือกแถว</span>
                <span>•</span>
                <span className="bg-white px-1 py-0.2 rounded border border-slate-300 font-bold">[F2] จำนวน</span>
                <span>•</span>
                <span className="bg-white px-1 py-0.2 rounded border border-slate-300 font-bold">[F3] ส่วนลด</span>
                <span>•</span>
                <span className="bg-white px-1 py-0.2 rounded border border-slate-300 font-bold">[F4] ราคา</span>
                <span>•</span>
                <span>[+/-] ปรับ</span>
                <span>•</span>
                <span>[Del] ลบ</span>
              </div>
              <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-slate-300 font-bold text-slate-700">
                {selectedIndex + 1}/{cart.items.length}
              </span>
            </div>

            {cart.items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const hasClaim = !!item.claimQuantity && item.claimQuantity > 0;
              return (
                <div
                  key={`${item.productId}-${item.unitId}`}
                  id={`classic-cart-item-${idx}`}
                  onClick={() => setSelectedIndex(idx)}
                  className={`flex flex-col gap-2 rounded-xl border p-3.5 shadow-sm transition-all cursor-pointer ${
                    isSelected ? 'border-sky-500 bg-sky-50/60 ring-2 ring-sky-400 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-bold text-slate-900">
                        {isSelected && (
                          <span className="text-[10px] bg-sky-600 text-white px-2 py-0.5 rounded-md font-bold shadow-2xs shrink-0">
                            ⚡ เลือกอยู่ [F2/F3/F4]
                          </span>
                        )}
                        <span className="truncate">{item.name}</span>
                        {item.isBundle && (
                          <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1 py-0.2 rounded font-bold shrink-0">🎁 ชุด</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                        <span className="font-mono">{item.sku}</span>
                        <span>·</span>
                        <span className="font-semibold text-slate-700">{item.unitName}</span>
                        {item.discountValue > 0 && (
                          <span className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded font-bold">
                            🏷️ ลด {item.discountValue}{item.discountType === 'percent' ? '%' : '฿'}
                          </span>
                        )}
                      </div>
                      {item.bundleData && item.bundleData.length > 0 && (
                        <div className="mt-1 text-[11px] text-purple-800 bg-purple-50/80 rounded px-2 py-0.5 border border-purple-100">
                          <span className="font-semibold">ในชุด: </span>
                          {item.bundleData.map((b, i) => (
                            <span key={i}>
                              {i > 0 && ', '}
                              {b.productName} x{formatQty(mulQty(b.quantityPerBundle, item.quantity))}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        cart.removeItem(item.productId, item.unitId);
                      }}
                      title="ลบรายการนี้ (Del)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between text-sm pt-1">
                    <div className="font-bold text-slate-900">{formatCurrency(cart.getEffectivePrice(item))}</div>
                    <div className="font-bold text-primary text-base">{formatCurrency(cart.getItemLineTotal(item))}</div>
                  </div>

                  {/* Free Claim Badge */}
                  {item.claimQuantity !== undefined && item.claimQuantity > 0 && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg w-fit shadow-2xs">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>เคลมฟรี {formatQty(item.claimQuantity)} {item.unitName} (คิดเงิน {formatQty(Math.max(0, subQty(item.quantity, item.claimQuantity)))} {item.unitName})</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-amber-800 hover:bg-amber-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(idx);
                          d.setEditItem(item);
                        }}
                        title="แก้ไขส่วนลด / รายละเอียดสินค้า (F3)"
                      >
                        <Percent className="w-3.5 h-3.5 mr-1 text-amber-600" />
                        <span>ส่วนลด (F3)</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-slate-700 hover:bg-slate-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(idx);
                          d.setPriceEditItem(item);
                        }}
                        title="แก้ไขราคาขาย (F4)"
                      >
                        <Tag className="w-3.5 h-3.5 mr-1 text-slate-500" />
                        <span>ราคา (F4)</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-7 px-2 text-xs font-semibold ${
                          hasClaim
                            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                            : 'text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(idx);
                          d.setClaimTargetItem(item);
                        }}
                        title="ระบุจำนวนสินค้าเคลมฟรีในรายการนี้"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                        <span>{hasClaim ? `เคลมฟรี ${item.claimQuantity}` : 'เคลม'}</span>
                      </Button>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-slate-600 hover:bg-white hover:text-slate-900 shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(idx);
                          cart.updateQuantity(item.productId, subQty(item.quantity, 1), item.unitId);
                        }}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(idx);
                          d.setQtyEditItem(item);
                        }}
                        className="w-12 h-9 text-center text-sm font-bold bg-white border border-slate-200 rounded hover:border-sky-400 hover:bg-sky-50 transition-all cursor-pointer flex items-center justify-center text-slate-800 shadow-xs"
                        title="คลิกเพื่อแก้ไขจำนวนด้วย Numpad (F2)"
                      >
                        {formatQty(item.quantity)}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-slate-600 hover:bg-white hover:text-slate-900 shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(idx);
                          cart.updateQuantity(item.productId, addQty(item.quantity, 1), item.unitId);
                        }}
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
            <button type="button" onClick={() => cart.setNote('')} className="text-slate-400 hover:text-red-500 text-xs px-1 font-bold" title="ล้างโน้ต">
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
            onClick={() => d.setShowBillDiscount(true)}
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
              onClick={() => d.setShowRedeemModal(true)}
              title="คลิกเพื่อแก้ไขการใช้แต้ม"
            >
              <span>🎁 ส่วนลดจากแต้ม ({cart.pointsUsed.toLocaleString()} แต้ม)</span>
            </div>
            <span className="text-amber-700 font-black">-{formatCurrency(cart.getPointsDiscountAmount())}</span>
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
                <span className="text-[10px] text-emerald-700 block font-mono">หักส่วนลดในบิลนี้ทันที (ตัดสิทธิ์เมื่อชำระเงิน)</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-black font-mono text-emerald-700">-{formatCurrency(cart.getClaimDiscountAmount())}</span>
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

        {/* VAT (only when the store charges VAT: Settings > ข้อมูลร้าน) */}
        {cart.isVatEnabled && (
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>ภาษีมูลค่าเพิ่ม (รวมในราคา)</span>
            <span className="font-semibold text-slate-700">{formatCurrency(cart.getVatAmount())}</span>
          </div>
        )}

        <div className="flex items-end justify-between border-t border-slate-200 pt-3">
          <span className="text-lg font-bold text-slate-800">ยอดสุทธิ</span>
          <span className="text-2xl font-bold text-primary sm:text-3xl">{formatCurrency(cart.getTotal())}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="grid shrink-0 grid-cols-3 gap-2 bg-slate-50 p-3 sm:p-4">
        <Button
          type="button"
          variant="outline"
          className="h-14 border-amber-300 bg-amber-50/80 hover:bg-amber-100 text-amber-900 font-extrabold text-xs sm:text-sm flex flex-col items-center justify-center gap-1 shadow-xs transition-all"
          onClick={() => d.setShowCashDrawerModal(true)}
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
          onClick={d.openPayment}
        >
          <CreditCard className="w-5 h-5" />
          <span>ชำระเงิน</span>
        </Button>
      </div>
    </div>
  );
}
