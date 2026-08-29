'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Coins, Gift, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { Customer, calculateRedemptionDiscount } from '@/lib/customer-service';
import { useCartStore } from '@/lib/store/cart-store';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

interface RedeemPointsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
}

export function RedeemPointsModal({ open, onOpenChange, customer }: RedeemPointsModalProps) {
  const [pointsInput, setPointsInput] = useState<number>(0);
  const cart = useCartStore();

  const ratePoints = customer?.pointRedeemRatePoints || 100;
  const rateDiscount = customer?.pointRedeemDiscountBaht || 1;
  const availablePoints = customer?.points || 0;

  useEffect(() => {
    if (open) {
      setPointsInput(cart.pointsUsed || 0);
    }
  }, [open, cart.pointsUsed]);

  // Calculate valid points that are exact multiples of ratePoints
  const validPoints = useMemo(() => {
    if (!customer || pointsInput <= 0) return 0;
    const bounded = Math.min(pointsInput, availablePoints);
    return Math.floor(bounded / ratePoints) * ratePoints;
  }, [customer, pointsInput, availablePoints, ratePoints]);

  // Calculate discount amount from points
  const calculatedDiscount = useMemo(() => {
    if (!customer || validPoints <= 0) return 0;
    return calculateRedemptionDiscount(customer, validPoints);
  }, [customer, validPoints]);

  const maxRedeemablePoints = useMemo(() => {
    if (!customer) return 0;
    const subtotal = cart.getSubtotal();
    // Maximum discount cannot exceed subtotal
    const maxPointsForSubtotal = Math.floor(subtotal / rateDiscount) * ratePoints;
    const maxPointsForBalance = Math.floor(availablePoints / ratePoints) * ratePoints;
    return Math.min(maxPointsForBalance, maxPointsForSubtotal);
  }, [customer, cart.getSubtotal(), availablePoints, ratePoints, rateDiscount]);

  const hasRemainder = pointsInput > 0 && pointsInput % ratePoints !== 0;

  const handleApplyRedeem = () => {
    if (pointsInput <= 0 || validPoints <= 0) {
      toast.error(`กรุณาระบุจำนวนแต้มอย่างน้อย ${ratePoints.toLocaleString()} แต้ม`);
      return;
    }
    if (pointsInput > availablePoints) {
      toast.error(`แต้มสะสมไม่เพียงพอ (ลูกค้ามี ${availablePoints.toLocaleString()} แต้ม)`);
      return;
    }
    if (calculatedDiscount <= 0) {
      toast.error(`ต้องใช้แต้มอย่างน้อย ${ratePoints.toLocaleString()} แต้ม เพื่อแลกส่วนลด`);
      return;
    }

    // Apply as separate points discount in cart with exact valid points
    cart.setPointsDiscount(calculatedDiscount, validPoints);
    toast.success(`แลกแต้มสำเร็จ! ใช้ ${validPoints.toLocaleString()} แต้ม ได้รับส่วนลด ฿${calculatedDiscount.toLocaleString()}`);
    onOpenChange(false);
  };

  const handleClearRedeem = () => {
    cart.clearPointsDiscount();
    toast.info('ยกเลิกการใช้แต้มส่วนลดแล้ว');
    onOpenChange(false);
  };

  if (!customer) return null;

  // Dynamic quick buttons based on ratePoints
  const quickMultipliers = [1, 2, 5, 10, 20];
  const quickPointOptions = quickMultipliers
    .map(m => m * ratePoints)
    .filter(pts => pts <= availablePoints && pts <= maxRedeemablePoints);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white text-slate-900 border-slate-200 sm:max-w-md p-0 overflow-hidden rounded-2xl shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-6 py-4 bg-slate-50">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Coins className="w-5 h-5 text-amber-600" />
            ใช้คะแนนสะสมเป็นส่วนลด (Redeem Points)
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            แลกคะแนนสะสมของสมาชิกเป็นส่วนลดท้ายบิล (ต้องเป็นจำนวนเท่าของ {ratePoints} แต้ม)
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-4 text-xs">
          {/* Customer Points Summary Card */}
          <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200 flex items-center justify-between">
            <div>
              <span className="text-slate-500 block text-xs">สมาชิก:</span>
              <b className="text-slate-900 text-sm">{customer.name}</b>
              <div className="text-xs text-slate-500 font-mono mt-0.5">📞 {customer.phone}</div>
            </div>
            <div className="text-right">
              <span className="text-amber-800 block text-xs font-medium">แต้มคงเหลือ</span>
              <div className="inline-flex items-center gap-1 text-lg font-black text-amber-700">
                <Coins className="w-4 h-4 text-amber-600" />
                <span>{availablePoints.toLocaleString()}</span>
                <span className="text-xs font-normal text-slate-500">แต้ม</span>
              </div>
            </div>
          </div>

          {/* Rule Note */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-600 space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <Gift className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                อัตราแลก: ทุกๆ <b className="text-slate-900 font-bold">{ratePoints.toLocaleString()} แต้ม</b> = ได้รับส่วนลด <b className="text-emerald-700 font-bold">{formatCurrency(rateDiscount)}</b>
              </span>
            </div>
            <p className="text-xs text-slate-500 pl-6">
              * การใช้แต้มต้องหารด้วย {ratePoints.toLocaleString()} ลงตัวเสมอ ไม่สามารถแลกเป็นเศษสตางค์ได้
            </p>
          </div>

          {/* Input Points */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-700">จำนวนแต้มที่ต้องการใช้:</label>
              {maxRedeemablePoints > 0 && (
                <button
                  type="button"
                  onClick={() => setPointsInput(maxRedeemablePoints)}
                  className="text-xs text-sky-600 hover:text-sky-700 font-bold underline"
                >
                  ใช้แต้มสูงสุด ({maxRedeemablePoints.toLocaleString()} แต้ม)
                </button>
              )}
            </div>
            <div className="relative">
              <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" />
              <Input
                type="number"
                min="0"
                step={ratePoints}
                max={availablePoints}
                value={pointsInput || ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  setPointsInput(Math.max(0, val));
                }}
                placeholder={`ระบุจำนวนแต้ม (เช่น ${ratePoints}, ${ratePoints * 2}, ${ratePoints * 5}...)`}
                className="pl-9 h-11 text-base font-extrabold text-slate-900"
                autoFocus
              />
            </div>

            {/* Remainder Alert */}
            {hasRemainder && (
              <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  แต้มที่คำนวณส่วนลดได้คือ <b className="font-bold">{validPoints.toLocaleString()} แต้ม</b> (เศษ {pointsInput % ratePoints} แต้มไม่ถูกนำมาคิดส่วนลด)
                </span>
              </div>
            )}
          </div>

          {/* Quick Select Buttons */}
          {quickPointOptions.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-semibold">ปุ่มลัดเลือกแต้ม:</span>
              <div className="flex flex-wrap gap-1.5">
                {quickPointOptions.map((pts) => {
                  return (
                    <Button
                      key={pts}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPointsInput(pts)}
                      className={`h-10 px-2.5 text-sm font-bold ${
                        pointsInput === pts ? 'bg-sky-50 text-sky-700 border-sky-300' : 'text-slate-600'
                      }`}
                    >
                      {pts.toLocaleString()} แต้ม (-{formatCurrency((pts / ratePoints) * rateDiscount)})
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Discount Calculation Preview */}
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
            <div>
              <span className="font-bold text-emerald-900 block">ส่วนลดที่จะได้รับ:</span>
              <span className="text-xs text-emerald-700 font-medium">ใช้จริง {validPoints.toLocaleString()} แต้ม</span>
            </div>
            <b className="text-lg font-black text-emerald-700 font-mono">
              - {formatCurrency(calculatedDiscount)}
            </b>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 px-6 py-4 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-600 text-xs">
              ปิด
            </Button>
            {cart.pointsUsed > 0 && (
              <Button
                variant="outline"
                onClick={handleClearRedeem}
                className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700 text-xs font-bold"
              >
                ยกเลิกการใช้แต้ม
              </Button>
            )}
          </div>
          <Button
            onClick={handleApplyRedeem}
            disabled={calculatedDiscount <= 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-5 shadow-sm"
          >
            <CheckCircle2 className="w-4 h-4 mr-1.5" /> ยืนยันใช้แต้มลด ฿{calculatedDiscount.toLocaleString()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
