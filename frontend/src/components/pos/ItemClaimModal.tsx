'use client';

import React, { useState, useEffect } from 'react';
import { ShieldCheck, AlertCircle, X, Check, Info } from 'lucide-react';
import { CartItem } from '../../lib/types';
import { useCartStore } from '../../lib/store/cart-store';
import { getCustomerQuotaForProduct } from '../../lib/customer-claim-stock-service';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

interface ItemClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: CartItem | null;
  onConfirm: (claimQty: number, reason: string, sourceOrderId?: string) => void;
}

export const ItemClaimModal: React.FC<ItemClaimModalProps> = ({
  isOpen,
  onClose,
  item,
  onConfirm,
}) => {
  const { customerId, customerName, getEffectivePrice } = useCartStore();

  const [loading, setLoading] = useState(false);
  const [availableQuota, setAvailableQuota] = useState<number>(0);
  const [latestOrder, setLatestOrder] = useState<any>(null);
  const [claimQty, setClaimQty] = useState<number>(0);
  const [reason, setReason] = useState<string>('สินค้าชำรุด/มีปัญหาจากการใช้งาน');

  useEffect(() => {
    if (!isOpen || !item) {
      setClaimQty(0);
      setReason('สินค้าชำรุด/มีปัญหาจากการใช้งาน');
      setAvailableQuota(0);
      setLatestOrder(null);
      return;
    }

    setClaimQty(item.claimQuantity || 0);
    setReason(item.claimDefectReason || 'สินค้าชำรุด/มีปัญหาจากการใช้งาน');

    if (customerId || customerName) {
      setLoading(true);
      getCustomerQuotaForProduct(item.productId, { customerId, customerName })
        .then((res) => {
          setAvailableQuota(res.availableQuota);
          setLatestOrder(res.latestOrder);
          if (!item.claimQuantity && res.availableQuota > 0) {
            // default to 1 if available
            setClaimQty(1);
          }
        })
        .catch((err) => {
          console.error('Failed to get customer quota:', err);
        })
        .finally(() => setLoading(false));
    } else {
      setAvailableQuota(0);
      setLatestOrder(null);
    }
  }, [isOpen, item, customerId, customerName]);

  if (!isOpen || !item) return null;

  const unitPrice = getEffectivePrice(item);
  const cartQty = item.quantity;
  const maxClaim = Math.min(cartQty, availableQuota > 0 ? availableQuota : cartQty);

  const chargeableQty = Math.max(0, cartQty - claimQty);
  const chargeAmount = chargeableQty * unitPrice;
  const freeAmount = claimQty * unitPrice;

  const handleSave = () => {
    if (claimQty > cartQty) {
      toast.error('จำนวนเคลมต้องไม่เกินจำนวนสินค้าในตะกร้า');
      return;
    }
    if (claimQty > 0 && availableQuota > 0 && claimQty > availableQuota) {
      toast.error(`จำนวนเคลมเกินโควตาสิทธิคงเหลือ (${availableQuota} ชิ้น)`);
      return;
    }

    onConfirm(claimQty, reason, latestOrder?.orderId || item.claimSourceOrderId);
    toast.success(
      claimQty > 0
        ? `ระบุสินค้าเคลม ${claimQty} ${item.unitName} สำเร็จ (คิดเงิน ${chargeableQty} ชิ้น)`
        : 'ยกเลิกรายการเคลมชิ้นนี้แล้ว'
    );
    onClose();
  };

  const handleRemoveClaim = () => {
    onConfirm(0, '', undefined);
    toast.info('ยกเลิกรายการเคลมชิ้นนี้แล้ว');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                ระบุสินค้าเคลม (เปลี่ยนสินค้าฟรี)
              </h3>
              <p className="text-xs text-slate-500">
                ตัดยอดเคลมฟรีในรายการสินค้านี้ และคิดเงินเฉพาะส่วนต่าง
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* Item Overview */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 flex justify-between items-center">
            <div>
              <div className="font-bold text-slate-800 text-base">{item.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                SKU: {item.sku || '-'} | ราคา ฿{unitPrice.toLocaleString()} / {item.unitName}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">จำนวนในตะกร้า</div>
              <div className="text-lg font-bold text-slate-900">
                {cartQty} <span className="text-sm font-normal">{item.unitName}</span>
              </div>
            </div>
          </div>

          {/* Customer Quota Info */}
          {!customerId && !customerName ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5 text-amber-800 text-xs">
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold">ยังไม่ได้เลือกลูกค้าในบิลนี้</p>
                <p className="mt-0.5 text-amber-700">
                  ระบบจะไม่สามารถตรวจสอบประวัติการซื้อจริงของลูกค้าได้ แนะนำให้เลือกลูกค้าก่อน
                  หรือหากตรวจสอบเอกสารภายนอกแล้ว สามารถระบุจำนวนเคลมได้โดยตรง
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3.5 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-indigo-900 font-semibold flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-indigo-600" />
                  สิทธิ์เคลมของ: {customerName}
                </span>
                {loading ? (
                  <span className="text-slate-400">กำลังตรวจสอบ...</span>
                ) : (
                  <span
                    className={`font-bold px-2 py-0.5 rounded-full text-xs ${
                      availableQuota > 0
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-100 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {availableQuota > 0
                      ? `มีสิทธิ์เคลมคงเหลือ ${availableQuota} ${item.unitName}`
                      : 'ไม่มีสิทธิ์เคลมคงเหลือสำหรับสินค้านี้'}
                  </span>
                )}
              </div>
              {latestOrder && (
                <div className="text-xs text-slate-600 bg-white/80 p-2 rounded-lg border border-indigo-100/60">
                  อ้างอิงบิลเดิม: <span className="font-semibold text-slate-800">{latestOrder.orderNumber}</span> ({new Date(latestOrder.orderDate).toLocaleDateString('th-TH')})
                </div>
              )}
            </div>
          )}

          {/* Claim Quantity Input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-slate-700 text-xs">
                จำนวนชิ้นที่ต้องการเคลม (ฟรี):
              </label>
              <span className="text-xs text-slate-500">
                (สูงสุดไม่เกิน {maxClaim} {item.unitName})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setClaimQty(Math.max(0, claimQty - 1))}
                className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-lg flex items-center justify-center transition"
              >
                -
              </button>
              <input
                type="number"
                min="0"
                max={maxClaim}
                value={claimQty}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  setClaimQty(Math.max(0, Math.min(val, cartQty)));
                }}
                className="flex-1 h-10 text-center font-bold text-lg text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setClaimQty(Math.min(maxClaim, claimQty + 1))}
                className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-lg flex items-center justify-center transition"
              >
                +
              </button>
            </div>
          </div>

          {/* Defect Reason */}
          {claimQty > 0 && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <label className="font-semibold text-slate-700 text-xs">
                สาเหตุการเคลม / อาการชำรุด:
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น แตกหัก, เปิดไม่ติด, สินค้าไม่ทำงาน"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          )}

          {/* Pricing Preview Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>จำนวนทั้งหมดในตะกร้า:</span>
              <span className="font-medium text-slate-800">{cartQty} {item.unitName}</span>
            </div>
            <div className="flex justify-between text-emerald-600 font-semibold">
              <span>จำนวนสินค้าเคลมฟรี (ไม่คิดเงิน):</span>
              <span>-{claimQty} {item.unitName} ({formatCurrency(freeAmount)})</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-bold text-slate-900">
              <span>จำนวนคิดเงินในบิล:</span>
              <span className="text-indigo-600">
                {chargeableQty} {item.unitName} ({formatCurrency(chargeAmount)})
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-between items-center">
          {item.claimQuantity && item.claimQuantity > 0 ? (
            <button
              type="button"
              onClick={handleRemoveClaim}
              className="text-xs text-rose-600 hover:text-rose-700 font-medium hover:underline"
            >
              ยกเลิกเคลมรายการนี้
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              บันทึกสินค้าเคลม
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
