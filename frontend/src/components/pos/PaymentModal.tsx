'use client';

import { useState, useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { formatCurrency } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CreditCard, QrCode, Banknote, Edit3, CheckCircle2, SplitSquareHorizontal, UserCheck, Building2, ArrowRight, FileText } from 'lucide-react';
import { NumpadPopup } from './NumpadPopup';
import { ReceiptPdfModal, ReceiptData } from './ReceiptPdfModal';
import { loadBankAccounts, BankAccount } from '@/lib/bank-account-storage';
import { deductPosSaleStock } from '@/lib/stock-service';
import { recordCustomerSale } from '@/lib/customer-service';
import { updateClaimStatus } from '@/lib/claim-service';
import { toast } from 'sonner';

type Step = 'METHOD' | 'PROCESS' | 'SUCCESS';
type Method = 'CASH' | 'QR' | 'CARD' | 'SPLIT' | 'CREDIT';
type NumpadTarget = 'NONE' | 'CASH' | 'QR' | 'SPLIT_CASH' | 'SPLIT_QR';

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMethod?: Method | null;
  orderToEditPayment?: any | null;
  onPaymentEditSuccess?: () => void;
}

export function PaymentModal({ 
  open, 
  onOpenChange, 
  initialMethod = null,
  orderToEditPayment = null,
  onPaymentEditSuccess
}: PaymentModalProps) {
  const cart = useCartStore();
  const shiftStore = useShiftStore();

  const [step, setStep] = useState<Step>('METHOD');
  const [method, setMethod] = useState<Method | null>(null);
  
  // Cash & QR tracking
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [qrReceived, setQrReceived] = useState<number>(0);
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>('NONE');

  // Bank accounts for QR payment & Split payment
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<BankAccount | null>(null);

  // PDF Receipt state
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [showReceiptPdf, setShowReceiptPdf] = useState(false);

  const total = orderToEditPayment ? (orderToEditPayment.totalAmount || 0) : cart.getTotal();
  
  // Cash method logic
  const isCashSufficient = cashReceived >= total;
  const change = isCashSufficient ? cashReceived - total : 0;

  // Split method logic
  const splitTotalReceived = cashReceived + qrReceived;
  const splitRemaining = Math.max(0, total - splitTotalReceived);
  const splitChange = Math.max(0, splitTotalReceived - total);
  const isSplitSufficient = splitTotalReceived >= total;

  // Auto-close countdown timer state for SUCCESS step
  const [countdown, setCountdown] = useState<number>(5);

  // Force reset when opened & Auto-close timer on SUCCESS
  useEffect(() => {
    if (open) {
      const accs = loadBankAccounts();
      setBankAccounts(accs);
      const def = accs.find(a => a.isDefault) || accs[0] || null;
      setSelectedBank(def);

      if (initialMethod) {
        setMethod(initialMethod);
        setStep('PROCESS');
      } else {
        setStep('METHOD');
        setMethod(null);
      }
      setCashReceived(0);
      setQrReceived(0);
      setNumpadTarget('NONE');
    }
  }, [open, initialMethod]);

  useEffect(() => {
    let timer: any = null;
    let interval: any = null;

    if (open && step === 'SUCCESS') {
      setCountdown(5);
      interval = setInterval(() => {
        setCountdown((prev) => Math.max(0, prev - 1));
      }, 1000);

      timer = setTimeout(() => {
        cart.clearCart();
        onOpenChange(false);
      }, 5000);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [open, step]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      if (step === 'SUCCESS' || orderToEditPayment) {
        cart.clearCart();
      }
    }
    onOpenChange(isOpen);
  };

  const handleSelectMethod = (m: Method) => {
    setMethod(m);
    setStep('PROCESS');
    if (m === 'CASH') setCashReceived(0);
    if (m === 'SPLIT') {
      setCashReceived(0);
      setQrReceived(0);
    }
  };

  const addCash = (amount: number) => {
    setCashReceived(prev => prev + amount);
  };

  const exactCash = () => {
    setCashReceived(total);
  };

  const handleConfirmPayment = async () => {
    let payments = [];
    let recordedCashReceived = 0;
    let recordedChangeAmount = 0;
    const attachedClaim = cart.attachedClaim;
    const claimDiscountAmt = cart.getClaimDiscountAmount();
    const claimFaceValue = attachedClaim
      ? Number(attachedClaim.discountAmount ?? attachedClaim.totalClaimValue ?? (attachedClaim.quantity || 1) * (attachedClaim.unitPrice || 0))
      : 0;

    if (attachedClaim && claimFaceValue > claimDiscountAmt) {
      toast.error(
        `ยอดบิลยังไม่พอใช้ส่วนลดเคลม ${formatCurrency(claimFaceValue)} ได้ครบ กรุณาเพิ่มสินค้าอีก ${formatCurrency(claimFaceValue - claimDiscountAmt)} หรือยกเลิกส่วนลดเคลมก่อนชำระ`
      );
      return;
    }
    
    if (method === 'CASH') {
      payments.push({ method: 'CASH' as const, amount: total });
      recordedCashReceived = cashReceived;
      recordedChangeAmount = change;
    } else if (method === 'QR') {
      payments.push({ 
        method: 'QR_PROMPTPAY' as const, 
        amount: total, 
        referenceNo: selectedBank ? `${selectedBank.bankName} (${selectedBank.accountNumber})` : undefined 
      });
      recordedCashReceived = total;
    } else if (method === 'SPLIT') {
      if (qrReceived > 0) {
        payments.push({ 
          method: 'QR_PROMPTPAY' as const, 
          amount: qrReceived,
          referenceNo: selectedBank ? `${selectedBank.bankName} (${selectedBank.accountNumber})` : undefined 
        });
      }
      if (cashReceived > 0) {
        payments.push({ method: 'CASH' as const, amount: total - qrReceived });
      }
      recordedCashReceived = cashReceived;
      recordedChangeAmount = splitChange;
    } else if (method === 'CREDIT') {
      payments.push({ method: 'CREDIT_NOTE' as const, amount: total });
    }

    // Direct Payment Method Edit for existing order (without touching cart!)
    if (orderToEditPayment) {
      const orderId = orderToEditPayment.orderNumber || orderToEditPayment.id;
      const oldPayments = orderToEditPayment.payments || [orderToEditPayment.paymentMethod || 'CASH'];
      const primaryNewMethod = payments.length > 1 ? 'SPLIT' : (payments[0]?.method || 'CASH');

      // Update shift store sales accounting for new payments
      shiftStore.updateOrderPaymentMethod(orderId, oldPayments, payments, total);

      // Try API update
      try {
        await apiFetch(`/orders/${orderToEditPayment.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ paymentMethod: primaryNewMethod, payments: payments })
        });
      } catch (e) {}

      const completedReceipt: ReceiptData = {
        orderNumber: orderId,
        createdAt: orderToEditPayment.createdAt || new Date().toISOString(),
        customerName: orderToEditPayment.customerName || 'ลูกค้าทั่วไป',
        userName: orderToEditPayment.userName || shiftStore.currentShift?.userName || 'พนักงาน POS',
        items: (orderToEditPayment.items || []).map((i: any) => ({
          name: i.name || i.productName || 'สินค้า',
          quantity: i.quantity || 1,
          unitName: i.unitName || 'ชิ้น',
          unitPrice: i.unitPrice || i.price || 0,
          lineTotal: i.lineTotal || (i.quantity * (i.unitPrice || i.price || 0)),
          itemNote: i.itemNote || i.note
        })),
        subtotal: orderToEditPayment.subtotal || total,
        billDiscountAmount: orderToEditPayment.billDiscountAmount || 0,
        vatAmount: orderToEditPayment.vatAmount || 0,
        totalAmount: total,
        paymentMethod: payments.length > 1 ? 'แบ่งชำระ (Split Payment)' : (method === 'CASH' ? 'เงินสด (Cash)' : method === 'QR' ? 'QR PromptPay' : method === 'CARD' ? 'บัตรเครดิต' : 'โอนเงิน'),
        payments: payments,
        cashReceived: recordedCashReceived,
        changeAmount: recordedChangeAmount
      };

      setReceiptData(completedReceipt);
      setStep('SUCCESS');
      setShowReceiptPdf(true);
      onPaymentEditSuccess?.();
      toast.success(`✅ อัปเดตวิธีชำระเงินบิล #${orderId} เรียบร้อยแล้ว!`);
      return;
    }

    let isSynced = false;
    let backendOrder: any = null;
    try {
      try {
        backendOrder = await apiFetch('/orders/checkout', {
          method: 'POST',
          body: JSON.stringify({
            customerId: cart.customerId,
            discountAmount: cart.getBillDiscountAmount(),
            note: `Shift: ${shiftStore.currentShift?.id || 'unknown'}`,
            items: cart.items.map(i => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: cart.getEffectivePrice(i)
            })),
            payments: payments
          })
        });
        isSynced = true;
      } catch (backendError) {
        isSynced = false;
        console.warn('Backend server offline or unreachable, proceeding with offline POS checkout:', backendError);
        toast.warning('⚠️ บันทึกออเดอร์ในเครื่องเรียบร้อย (รอ Sync ขึ้น Backend เมื่อออนไลน์)', { duration: 5000 });
      }

      const finalOrderNumber = backendOrder?.orderNumber || `ORD-OFFLINE-${Date.now()}`;
      const finalOrderId = backendOrder?.id || Date.now().toString();

      const previousEditingId = cart.editingOrderId;
      if (previousEditingId) {
        shiftStore.voidOrder(previousEditingId, "แก้ไขรายการสินค้าและชำระเงินใหม่แทนบิลเดิม");
        cart.setEditingOrderId(null);
      }

      const claimInfoObj = attachedClaim ? {
        claimId: attachedClaim.id,
        originalOrderNumber: attachedClaim.orderNumber,
        productName: attachedClaim.productName,
        quantity: attachedClaim.quantity,
        unitName: attachedClaim.unitName,
        defectReason: attachedClaim.defectReason,
        discountAmount: claimDiscountAmt,
      } : undefined;

      shiftStore.recordSale({
        id: finalOrderId,
        shiftId: shiftStore.currentShift?.id || 'shift_default',
        orderNumber: finalOrderNumber,
        customerId: cart.customerId,
        customerName: cart.customerName,
        items: cart.items.map(i => ({
          productId: i.productId,
          name: i.name,
          sku: i.sku,
          quantity: i.quantity,
          unitName: i.unitName,
          unitId: i.unitId,
          conversionFactor: i.conversionFactor || 1,
          unitPrice: cart.getEffectivePrice(i),
          originalPrice: i.originalPrice,
          discountType: i.discountType,
          discountValue: i.discountValue,
          discountAmount: cart.getItemDiscountAmount(i),
          lineTotal: cart.getItemLineTotal(i),
          hasVat: i.hasVat
        })),
        subtotal: cart.getSubtotal(),
        billDiscountType: cart.billDiscountType,
        billDiscountValue: cart.billDiscountValue,
        billDiscountAmount: cart.getBillDiscountAmount(),
        pointsDiscountAmount: cart.getPointsDiscountAmount(),
        pointsUsed: cart.pointsUsed,
        claimDiscountAmount: claimDiscountAmt,
        claimInfo: claimInfoObj,
        vatAmount: cart.getVatAmount(),
        totalAmount: total,
        payments: payments as any,
        cashReceived: recordedCashReceived,
        changeAmount: recordedChangeAmount,
        status: 'COMPLETED',
        note: cart.note?.trim() || undefined,
        userId: shiftStore.currentShift?.userId || 'unknown',
        userName: shiftStore.currentShift?.userName || 'unknown',
        createdAt: backendOrder?.createdAt ? new Date(backendOrder.createdAt).toISOString() : new Date().toISOString(),
        isSynced: isSynced
      });

      // If an attached warranty claim was used as a store discount, complete it now!
      if (attachedClaim) {
        updateClaimStatus(attachedClaim.id, 'COMPLETED', {
          note: `นำมาใช้เป็นส่วนลดในบิล #${finalOrderNumber}`,
          claimedInOrderNumber: finalOrderNumber,
        });
      }

      // Deduct stock from inventory and log stock movement
      deductPosSaleStock(
        cart.items.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          conversionFactor: i.conversionFactor || 1,
          name: i.name,
          sku: i.sku,
          unitName: i.unitName,
        })),
        finalOrderNumber,
        shiftStore.currentShift?.userName || 'พนักงาน POS'
      );

      // Award points, deduct redeemed points, and accumulate credit debt for member customer
      const isCreditSale = method === 'CREDIT' || payments.some(p => p.method === 'CREDIT_NOTE');
      const custSaleRes = recordCustomerSale(
        cart.customerId,
        total,
        isCreditSale,
        finalOrderNumber,
        cart.pointsUsed
      );

      if (custSaleRes.earnedPoints > 0 || custSaleRes.pointsUsed > 0) {
        toast.success(
          `🎉 สมาชิก ${custSaleRes.customerName} : ${custSaleRes.pointsUsed > 0 ? `ใช้ ${custSaleRes.pointsUsed.toLocaleString()} แต้ม ` : ''}${custSaleRes.earnedPoints > 0 ? `ได้รับ +${custSaleRes.earnedPoints} แต้ม ` : ''}(คงเหลือ ${custSaleRes.newTotalPoints.toLocaleString()} แต้ม)`
        );
      }

      const completedReceipt: ReceiptData = {
        orderNumber: finalOrderNumber,
        createdAt: backendOrder?.createdAt ? new Date(backendOrder.createdAt).toISOString() : new Date().toISOString(),
        customerName: cart.customerName,
        userName: shiftStore.currentShift?.userName || 'พนักงาน POS',
        note: cart.note?.trim() || undefined,
        items: cart.items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          unitName: i.unitName,
          unitPrice: cart.getEffectivePrice(i),
          lineTotal: cart.getItemLineTotal(i),
          discountAmount: cart.getItemDiscountAmount(i),
          itemNote: i.itemNote
        })),
        subtotal: cart.getSubtotal(),
        billDiscountAmount: cart.getBillDiscountAmount(),
        pointsDiscountAmount: cart.getPointsDiscountAmount(),
        pointsUsed: cart.pointsUsed,
        claimDiscountAmount: claimDiscountAmt,
        claimInfo: claimInfoObj,
        customerPointsEarned: custSaleRes.earnedPoints,
        customerPointsBalance: custSaleRes.newTotalPoints,
        vatAmount: cart.getVatAmount(),
        totalAmount: total,
        paymentMethod: method === 'CASH' ? 'เงินสด (Cash)' : method === 'QR' ? 'QR PromptPay' : method === 'SPLIT' ? 'แบ่งชำระ (Split)' : 'เงินเชื่อ (Credit)',
        payments: payments,
        cashReceived: recordedCashReceived,
        changeAmount: recordedChangeAmount
      };

      setReceiptData(completedReceipt);
      setStep('SUCCESS');
      setShowReceiptPdf(true); // Automatically pop up the PDF receipt preview!
    } catch (error) {
      toast.error('ไม่สามารถประมวลผลการชำระเงินได้');
    }
  };

  const handleFinish = () => {
    cart.clearCart();
    onOpenChange(false);
  };

  const handleNumpadConfirm = (val: number) => {
    if (numpadTarget === 'CASH') setCashReceived(val);
    if (numpadTarget === 'QR') setQrReceived(val);
    if (numpadTarget === 'SPLIT_CASH') setCashReceived(val);
    if (numpadTarget === 'SPLIT_QR') setQrReceived(val);
    setNumpadTarget('NONE');
  };

  const getNumpadInitialValue = () => {
    if (numpadTarget === 'CASH') return cashReceived > 0 ? cashReceived : 0;
    if (numpadTarget === 'QR') return qrReceived > 0 ? qrReceived : total;
    if (numpadTarget === 'SPLIT_CASH') return cashReceived;
    if (numpadTarget === 'SPLIT_QR') return qrReceived;
    return 0;
  };

  const getNumpadFullAmount = () => {
    if (numpadTarget === 'CASH' || numpadTarget === 'QR') {
      return total;
    }
    if (numpadTarget === 'SPLIT_CASH') {
      // Remaining needed after subtracting QR portion
      return Math.max(0, Math.round((total - qrReceived) * 100) / 100);
    }
    if (numpadTarget === 'SPLIT_QR') {
      // Remaining needed after subtracting Cash portion
      return Math.max(0, Math.round((total - cashReceived) * 100) / 100);
    }
    return total;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-[85vw] max-w-6xl h-[82vh] max-h-[850px] flex flex-col p-6 sm:p-8 overflow-y-auto bg-white border-slate-200 text-slate-900 shadow-2xl rounded-3xl">
          <DialogHeader className="shrink-0 pb-3 border-b border-slate-100 mb-4">
            <DialogTitle className="text-2xl font-bold flex items-center gap-3">
              <CreditCard className="w-8 h-8 text-sky-500" />
              <span>
                {step === 'METHOD' && 'เลือกช่องทางการชำระเงิน'}
                {step === 'PROCESS' && method === 'CASH' && 'รับชำระด้วยเงินสด (Cash)'}
                {step === 'PROCESS' && method === 'QR' && 'รับชำระผ่าน QR PromptPay / โอนเงิน'}
                {step === 'PROCESS' && method === 'SPLIT' && 'รับชำระแบบแบ่งจ่าย (Split Payment)'}
                {step === 'PROCESS' && method === 'CREDIT' && 'บันทึกเป็นเงินเชื่อ (ค้างชำระ)'}
                {step === 'SUCCESS' && 'ทำรายการชำระเงินสำเร็จ!'}
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* STEP 1: METHOD SELECTION */}
          {step === 'METHOD' && (
            <div className="py-2 flex-1 flex flex-col justify-between space-y-6">
              <div className="text-center bg-sky-50/70 p-6 sm:p-8 rounded-3xl border-2 border-sky-200 shadow-sm">
                <p className="text-slate-500 text-sm font-bold uppercase tracking-wider mb-1">ยอดรวมสุทธิที่ต้องชำระ</p>
                <div className="text-5xl sm:text-6xl font-extrabold text-sky-600">{formatCurrency(total)}</div>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 flex-1">
                {/* 1. Cash */}
                <button 
                  type="button"
                  className="h-32 sm:h-36 flex flex-row items-center gap-5 p-5 text-left border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 transition-all rounded-3xl shadow-sm group"
                  onClick={() => handleSelectMethod('CASH')}
                >
                  <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                    <Banknote className="w-9 h-9" />
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-slate-900 block group-hover:text-sky-600">เงินสด (Cash)</span>
                    <span className="text-sm text-slate-500">ชำระด้วยธนบัตรหรือเหรียญ</span>
                  </div>
                </button>

                {/* 2. QR PromptPay */}
                <button 
                  type="button"
                  className="h-32 sm:h-36 flex flex-row items-center gap-5 p-5 text-left border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 transition-all rounded-3xl shadow-sm group"
                  onClick={() => handleSelectMethod('QR')}
                >
                  <div className="w-16 h-16 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                    <QrCode className="w-9 h-9" />
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-slate-900 block group-hover:text-sky-600">QR PromptPay / โอนเงิน</span>
                    <span className="text-sm text-slate-500">สแกน QR Code หรือโอนผ่านแอปธนาคาร</span>
                  </div>
                </button>

                {/* 3. Split */}
                <button 
                  type="button"
                  className="h-32 sm:h-36 flex flex-row items-center gap-5 p-5 text-left border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 transition-all rounded-3xl shadow-sm group"
                  onClick={() => handleSelectMethod('SPLIT')}
                >
                  <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                    <SplitSquareHorizontal className="w-9 h-9" />
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-slate-900 block group-hover:text-sky-600">แบ่งชำระ (Split)</span>
                    <span className="text-sm text-slate-500">รับโอนบางส่วน + เงินสดบางส่วน</span>
                  </div>
                </button>

                {/* 4. Credit */}
                {cart.customerId ? (
                  <button 
                    type="button"
                    className="h-32 sm:h-36 flex flex-row items-center gap-5 p-5 text-left border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 transition-all rounded-3xl shadow-sm group"
                    onClick={() => handleSelectMethod('CREDIT')}
                  >
                    <div className="w-16 h-16 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                      <UserCheck className="w-9 h-9" />
                    </div>
                    <div>
                      <span className="text-2xl font-bold text-slate-900 block group-hover:text-sky-600">เงินเชื่อ ({cart.customerName})</span>
                      <span className="text-sm text-slate-500">ลงบันทึกเป็นหนี้ค้างชำระของลูกค้า</span>
                    </div>
                  </button>
                ) : (
                  <div className="h-32 sm:h-36 flex flex-row items-center gap-5 p-5 text-left border-2 border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed rounded-3xl">
                    <div className="w-16 h-16 rounded-2xl bg-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                      <UserCheck className="w-9 h-9" />
                    </div>
                    <div>
                      <span className="text-xl font-bold text-slate-400 block">เงินเชื่อ (ต้องเลือกลูกค้าก่อน)</span>
                      <span className="text-sm text-slate-400">กรุณาเลือกลูกค้าในหน้า POS เพื่อเปิดใช้งาน</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (CASH) */}
          {step === 'PROCESS' && method === 'CASH' && (
            <div className="py-2 flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Left side: Received Cash & Calculator */}
                <div className="border-b border-slate-200 pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-8 space-y-6">
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">ยอดรวมที่ต้องชำระ</p>
                    <div className="text-4xl font-extrabold text-slate-900">{formatCurrency(total)}</div>
                  </div>
                  
                  <div className="p-5 bg-sky-50 border-2 border-sky-300 rounded-3xl relative group shadow-sm">
                    <p className="text-sm text-sky-800 font-bold mb-1">รับเงินสดมา (กดช่องนี้เพื่อพิมพ์/เปิด Numpad)</p>
                    <div 
                      className="text-5xl font-extrabold text-sky-600 cursor-pointer py-2 font-mono"
                      onClick={() => setNumpadTarget('CASH')}
                    >
                      {formatCurrency(cashReceived)}
                    </div>
                    <Button 
                      size="icon" 
                      variant="outline" 
                      className="absolute top-4 right-4 h-10 w-10 border-sky-300 bg-white text-sky-600 hover:bg-sky-100 shadow-sm"
                      onClick={() => setNumpadTarget('CASH')}
                      title="กดเพื่อเปิด Numpad"
                    >
                      <Edit3 className="w-5 h-5" />
                    </Button>
                  </div>

                  <div className="p-5 bg-emerald-50/70 border-2 border-emerald-200 rounded-2xl">
                    <div className="flex justify-between items-center">
                      <span className="text-base font-bold text-emerald-900">เงินทอนลูกค้า</span>
                      <span className={`font-extrabold text-4xl ${change > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {formatCurrency(change)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right side: Fast Banknotes */}
                <div className="space-y-4">
                  <p className="text-sm font-bold text-slate-700">กดธนบัตรเพื่อนับเงิน (กดซ้ำเพื่อบวกสะสมยอด)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Button variant="outline" className="h-20 text-2xl font-extrabold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-all rounded-2xl shadow-sm" onClick={() => addCash(20)}>
                      ฿20
                    </Button>
                    <Button variant="outline" className="h-20 text-2xl font-extrabold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-all rounded-2xl shadow-sm" onClick={() => addCash(50)}>
                      ฿50
                    </Button>
                    <Button variant="outline" className="h-20 text-2xl font-extrabold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-all rounded-2xl shadow-sm" onClick={() => addCash(100)}>
                      ฿100
                    </Button>
                    <Button variant="outline" className="h-20 text-2xl font-extrabold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-all rounded-2xl shadow-sm" onClick={() => addCash(500)}>
                      ฿500
                    </Button>
                    <Button variant="outline" className="h-20 text-2xl font-extrabold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-all rounded-2xl shadow-sm" onClick={() => addCash(1000)}>
                      ฿1,000
                    </Button>
                    <Button variant="outline" className="h-20 text-2xl font-extrabold border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-500 hover:text-white transition-all rounded-2xl shadow-sm" onClick={exactCash}>
                      พอดี (฿{total.toFixed(0)})
                    </Button>
                  </div>
                  <Button variant="ghost" className="w-full text-slate-500 hover:text-red-600 font-semibold" onClick={() => setCashReceived(0)}>
                    ล้างยอดเงินสด
                  </Button>
                </div>
              </div>

              <div className="flex gap-4 mt-8 pt-4 border-t border-slate-200">
                <Button variant="outline" className="w-44 h-14 text-base border-slate-300 rounded-2xl font-semibold" onClick={() => setStep('METHOD')}>
                  ย้อนกลับ
                </Button>
                <Button 
                  className="flex-1 h-14 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xl rounded-2xl shadow-lg" 
                  disabled={!isCashSufficient}
                  onClick={handleConfirmPayment}
                >
                  ยืนยันรับเงินสด
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (QR PromptPay / Bank Transfer) */}
          {step === 'PROCESS' && method === 'QR' && (
            <div className="py-2 flex-1 flex flex-col justify-between space-y-6">
              {/* Account selection tabs if multiple exist */}
              {bankAccounts.length > 1 && (
                <div className="flex gap-3 overflow-x-auto pb-2 border-b border-slate-200 no-scrollbar shrink-0">
                  {bankAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => setSelectedBank(acc)}
                      className={`px-5 py-3 rounded-2xl text-base font-bold transition-all border flex items-center gap-2.5 ${
                        selectedBank?.id === acc.id
                          ? "bg-sky-500 text-white border-sky-500 shadow-md"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      <Building2 className="w-5 h-5" />
                      {acc.bankName}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center flex-1">
                {/* Left: Large QR Code & Details */}
                <div className="flex flex-col items-center text-center p-6 bg-slate-50 border-2 border-slate-200 rounded-3xl shadow-inner">
                  <Badge className="mb-4 bg-sky-100 text-sky-900 border-sky-300 text-sm px-4 py-1 font-bold">
                    {selectedBank?.bankName || 'QR PromptPay'}
                  </Badge>

                  {/* XL QR Image */}
                  <div className="w-72 h-72 border-2 border-slate-200 rounded-3xl overflow-hidden bg-white p-4 shadow-md flex items-center justify-center mb-4">
                    {selectedBank?.qrImageUrl ? (
                      <img src={selectedBank.qrImageUrl} alt="QR PromptPay" className="w-full h-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-400 gap-3">
                        <QrCode className="w-32 h-32 text-slate-300" />
                        <span className="text-sm text-slate-500 font-semibold">สแกนชำระผ่าน PromptPay</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm text-slate-600">ชื่อบัญชี: <b className="text-slate-900 text-base">{selectedBank?.accountName || 'ร้านปุริม'}</b></p>
                    <p className="text-sm text-slate-600">เลขที่บัญชี / พร้อมเพย์: <b className="font-mono text-slate-900 text-xl font-bold">{selectedBank?.accountNumber || '081-234-5678'}</b></p>
                  </div>
                </div>

                {/* Right: Net Amount & Confirm */}
                <div className="flex flex-col justify-between h-full p-8 bg-white border-2 border-slate-200 rounded-3xl space-y-6">
                  <div 
                    className="p-5 bg-sky-50 border-2 border-sky-300 rounded-3xl relative group cursor-pointer shadow-sm hover:bg-sky-100/60 transition-all"
                    onClick={() => setNumpadTarget('QR')}
                    title="กดเพื่อเปิด Numpad ตรวจสอบหรือใส่ยอดเงิน"
                  >
                    <span className="text-sky-800 text-sm font-bold block mb-1">
                      ยอดรวมสุทธิที่ต้องสแกนโอน (กดช่องนี้เพื่อเปิด Numpad)
                    </span>
                    <div className="text-5xl font-extrabold text-sky-600 font-mono py-1">
                      {formatCurrency(qrReceived > 0 ? qrReceived : total)}
                    </div>
                    <Button 
                      size="icon" 
                      variant="outline" 
                      className="absolute top-4 right-4 h-10 w-10 border-sky-300 bg-white text-sky-600 hover:bg-sky-100 shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNumpadTarget('QR');
                      }}
                      title="กดเพื่อเปิด Numpad"
                    >
                      <Edit3 className="w-5 h-5" />
                    </Button>
                  </div>

                  <div className="p-5 bg-sky-50 border-2 border-sky-200 rounded-2xl text-sm text-sky-900 space-y-2">
                    <p className="font-bold text-base flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-sky-600" /> คำแนะนำการรับชำระ:
                    </p>
                    <p>1. ให้ลูกค้าสแกน QR Code และสแกนชำระตามยอดสุทธิที่ระบุ</p>
                    <p>2. ตรวจสอบสลิปการโอนเงินจากมือถือของลูกค้าก่อนกดปุ่มยืนยัน</p>
                  </div>

                  <div className="flex flex-col gap-3 pt-2">
                    <Button 
                      className="h-16 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xl rounded-2xl shadow-lg"
                      onClick={handleConfirmPayment}
                    >
                      <CheckCircle2 className="w-6 h-6 mr-2" /> ลูกค้าชำระเงินเรียบร้อยแล้ว
                    </Button>
                    <Button variant="outline" className="h-12 border-slate-300 text-slate-600 rounded-2xl font-semibold" onClick={() => setStep('METHOD')}>
                      ย้อนกลับ
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (SPLIT Payment with Bank Account Selection) */}
          {step === 'PROCESS' && method === 'SPLIT' && (
            <div className="py-2 flex-1 flex flex-col justify-between space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                <div className="space-y-5">
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">ยอดรวมที่ต้องชำระทั้งหมด</p>
                    <div className="text-4xl font-extrabold text-slate-900">{formatCurrency(total)}</div>
                  </div>

                  <div className="space-y-4">
                    {/* 1. Transfer Portion + Bank Account Selector */}
                    <div className="p-4 bg-sky-50/50 border border-sky-200 rounded-2xl space-y-3">
                      <label className="text-sm font-bold text-sky-900 block">1. ยอดโอนเงิน (QR PromptPay)</label>
                      <div className="flex gap-2">
                        <Input 
                          type="number"
                          placeholder="0.00"
                          className="bg-white border-slate-300 h-12 text-xl font-bold text-sky-600 flex-1"
                          value={qrReceived || ''}
                          onChange={(e) => setQrReceived(parseFloat(e.target.value) || 0)}
                          onClick={() => setNumpadTarget('SPLIT_QR')}
                        />
                        <Button 
                          variant="outline" 
                          className="h-12 px-4 border-slate-300 bg-white hover:bg-sky-100 hover:text-sky-600"
                          onClick={() => setNumpadTarget('SPLIT_QR')}
                        >
                          <Edit3 className="w-5 h-5" />
                        </Button>
                      </div>

                      {/* Explicit Bank Account Selection for Transfer Portion */}
                      {bankAccounts.length > 0 && (
                        <div className="space-y-1 pt-1">
                          <label className="text-xs font-bold text-slate-600 block">เลือกบัญชีธนาคารที่รับเงินโอน:</label>
                          <select
                            value={selectedBank?.id || ''}
                            onChange={(e) => {
                              const acc = bankAccounts.find(a => a.id === e.target.value);
                              if (acc) setSelectedBank(acc);
                            }}
                            className="w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-sky-500 shadow-sm"
                          >
                            {bankAccounts.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.bankName} - {a.accountName} ({a.accountNumber})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* 2. Cash Portion */}
                    <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-2xl space-y-2">
                      <label className="text-sm font-bold text-emerald-900 block">2. ยอดเงินสดที่รับมา</label>
                      <div className="flex gap-2">
                        <Input 
                          type="number"
                          placeholder="0.00"
                          className="bg-white border-slate-300 h-12 text-xl font-bold text-emerald-600 flex-1"
                          value={cashReceived || ''}
                          onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
                          onClick={() => setNumpadTarget('SPLIT_CASH')}
                        />
                        <Button 
                          variant="outline" 
                          className="h-12 px-4 border-slate-300 bg-white hover:bg-emerald-100 hover:text-emerald-600"
                          onClick={() => setNumpadTarget('SPLIT_CASH')}
                        >
                          <Edit3 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-6 sm:p-8 rounded-3xl border-2 border-slate-200 flex flex-col justify-between shadow-inner">
                  <div className="space-y-4">
                    <h4 className="font-bold text-slate-900 text-lg border-b border-slate-200 pb-3">สรุปการรับชำระแบบผสม</h4>
                    <div className="flex justify-between text-base">
                      <span className="text-slate-600">ยอดรวมรับแล้ว:</span>
                      <span className="font-extrabold text-slate-900 text-2xl">{formatCurrency(splitTotalReceived)}</span>
                    </div>
                    {selectedBank && qrReceived > 0 && (
                      <div className="text-xs text-sky-800 bg-sky-100/70 p-3 rounded-xl font-medium border border-sky-200">
                        บัญชีโอนเงิน: <b>{selectedBank.bankName}</b> ({selectedBank.accountNumber})
                      </div>
                    )}
                    {splitRemaining > 0 ? (
                      <div className="p-6 bg-red-50 border-2 border-red-300 rounded-3xl text-center shadow-sm space-y-1">
                        <span className="text-xs font-bold text-red-700 uppercase tracking-wider block">
                          ⚠️ ยอดเงินสดที่ยังขาดอยู่ (ต้องเก็บเพิ่ม)
                        </span>
                        <span className="text-5xl font-extrabold text-red-600 font-mono block">
                          {formatCurrency(splitRemaining)}
                        </span>
                        <span className="text-xs text-red-500 font-semibold block pt-1">
                          ลูกค้าโอนแล้ว {formatCurrency(qrReceived)} · รับเงินสดแล้ว {formatCurrency(cashReceived)}
                        </span>
                      </div>
                    ) : splitChange > 0 ? (
                      <div className="p-6 bg-emerald-50 border-2 border-emerald-300 rounded-3xl text-center shadow-sm space-y-1">
                        <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">
                          ✅ เงินทอนลูกค้า (จากเงินสด)
                        </span>
                        <span className="text-5xl font-extrabold text-emerald-600 font-mono block">
                          {formatCurrency(splitChange)}
                        </span>
                      </div>
                    ) : (
                      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center text-emerald-800 font-bold text-base">
                        ✅ รับชำระเงินครบถ้วนเรียบร้อยแล้ว
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4 pt-6">
                    <Button variant="outline" className="w-36 h-14 border-slate-300 rounded-2xl font-semibold text-base" onClick={() => setStep('METHOD')}>
                      ย้อนกลับ
                    </Button>
                    <Button 
                      className="flex-1 h-14 bg-sky-500 hover:bg-sky-600 text-white font-bold text-lg rounded-2xl shadow-lg" 
                      disabled={!isSplitSufficient}
                      onClick={handleConfirmPayment}
                    >
                      ยืนยันรับเงิน
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (CREDIT) */}
          {step === 'PROCESS' && method === 'CREDIT' && (
            <div className="py-12 text-center space-y-6 flex-1 flex flex-col justify-center">
              <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <UserCheck className="w-12 h-12" />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">บันทึกเป็นเงินเชื่อ (ค้างชำระ)</h2>
                <p className="text-slate-600 text-base mt-2">
                  ลูกหนี้: <b className="text-slate-900 text-lg">{cart.customerName}</b> · ยอดหนี้: <b className="text-sky-600 text-xl">{formatCurrency(total)}</b>
                </p>
              </div>

              <div className="flex gap-4 justify-center pt-6">
                <Button variant="outline" className="w-40 h-14 text-base border-slate-300 rounded-2xl font-semibold" onClick={() => setStep('METHOD')}>
                  ย้อนกลับ
                </Button>
                <Button className="w-56 h-14 bg-sky-500 hover:bg-sky-600 text-white font-bold text-lg rounded-2xl shadow-lg" onClick={handleConfirmPayment}>
                  ยืนยันบันทึกหนี้
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: SUCCESS */}
          {step === 'SUCCESS' && (
            <div className="py-12 text-center space-y-6 flex-1 flex flex-col justify-center">
              <div className="w-28 h-28 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-16 h-16" />
              </div>
              <div>
                <h2 className="text-4xl font-extrabold text-slate-900">ชำระเงินสำเร็จ!</h2>
                <p className="text-slate-500 text-base mt-1">
                  รับชำระเงินและบันทึกออเดอร์เข้าในระบบเรียบร้อยแล้ว
                </p>
                <div className="pt-2">
                  <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-300 font-extrabold text-xs px-3 py-1.5 rounded-full shadow-xs">
                    ⏳ หน้าต่างจะปิดอัตโนมัติและล้างตะกร้าใน {countdown} วินาที...
                  </span>
                </div>
              </div>

              {method === 'CASH' && change > 0 && (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-3xl p-6 inline-block mx-auto min-w-72 shadow-sm">
                  <span className="text-emerald-800 text-base block font-bold">เงินทอนลูกค้า</span>
                  <span className="text-5xl font-extrabold text-emerald-600 font-mono">{formatCurrency(change)}</span>
                </div>
              )}

              {method === 'SPLIT' && splitChange > 0 && (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-3xl p-6 inline-block mx-auto min-w-72 shadow-sm">
                  <span className="text-emerald-800 text-base block font-bold">เงินทอนลูกค้า (จากเงินสด)</span>
                  <span className="text-5xl font-extrabold text-emerald-600 font-mono">{formatCurrency(splitChange)}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-4 pt-6">
                <Button 
                  variant="outline"
                  className="h-14 px-8 border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-500 hover:text-white font-bold text-lg rounded-2xl shadow-md transition-all flex items-center gap-2" 
                  onClick={() => setShowReceiptPdf(true)}
                >
                  <FileText className="w-5 h-5" />
                  ดู / พิมพ์ใบเสร็จ PDF
                </Button>

                <Button className="h-14 px-8 bg-sky-600 hover:bg-sky-700 text-white font-bold text-lg rounded-2xl shadow-lg" onClick={handleFinish}>
                  ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PDF Receipt Preview Modal */}
      <ReceiptPdfModal
        open={showReceiptPdf}
        onOpenChange={setShowReceiptPdf}
        data={receiptData}
      />

      {/* Numpad Popup with Full Amount ("เต็ม") Support */}
      <NumpadPopup 
        open={numpadTarget !== 'NONE'}
        onOpenChange={(isOpen) => !isOpen && setNumpadTarget('NONE')}
        onConfirm={handleNumpadConfirm}
        title={
          numpadTarget === 'SPLIT_QR' || numpadTarget === 'QR'
            ? 'ระบุยอดโอนเงิน' 
            : 'ระบุจำนวนเงินสดที่รับ'
        }
        subtitle={
          numpadTarget === 'SPLIT_QR' || numpadTarget === 'QR'
            ? 'จำนวนเงินที่โอน' 
            : 'จำนวนเงินสดที่รับมา'
        }
        initialValue={getNumpadInitialValue()}
        fullAmount={getNumpadFullAmount()}
      />
    </>
  );
}
