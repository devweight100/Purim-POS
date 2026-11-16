'use client';
import { newOperationId } from '@/lib/order-sync-service';

import { useState, useEffect, useRef } from 'react';
import { useHasChanged } from '@/lib/pos/use-has-changed';
import { useProductStore } from '@/lib/store/product-store';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { formatCurrency } from '@/lib/utils';
import { api, apiFetch, ApiError, isRetryableError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CreditCard, QrCode, Banknote, Edit3, CheckCircle2, SplitSquareHorizontal, UserCheck, Building2, ArrowRight, FileText, Printer, ShieldCheck } from 'lucide-react';
import { NumpadPopup } from './NumpadPopup';
import { ReceiptPdfModal, ReceiptData } from './ReceiptPdfModal';
import { orderToReceiptData, summarizePaymentMethods, isCreditMethod } from '@/lib/receipt-mapper';
import { printThermalReceiptDirect } from './ThermalReceiptView';
import { cartToPickingSlip } from '@/lib/picking-slip';
import { productUnitLookup } from '@/lib/pos/picking';
import { getReceiptOptions } from '@/lib/receipt-options';
import { loadBankAccounts, BankAccount } from '@/lib/bank-account-storage';
import { PromptPayQr } from '@/components/common/PromptPayQr';
import { promptPayOf } from '@/lib/promptpay-qr';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe } from '@/lib/pdf-print-service';

import { updateClaimStatus, processClaim } from '@/lib/claim-service';
import { kickCashDrawer, getCashDrawerConfig } from '@/lib/cash-drawer-service';
import { toast } from 'sonner';
import { ApprovalDialog, ApprovalNeeded } from '@/components/approvals/ApprovalDialog';
import { getTerminalId } from '@/lib/terminal-id';
import type { OrderPayment } from '@/lib/types';

type Step = 'METHOD' | 'PROCESS' | 'SUCCESS';
type Method = 'CASH' | 'QR' | 'CARD' | 'SPLIT' | 'CREDIT';
type NumpadTarget = 'NONE' | 'CASH' | 'QR' | 'SPLIT_CASH' | 'SPLIT_QR';

/** A payment line sent to checkout (lib/types PaymentMethodType has no CREDIT_DEBT yet). */
type PosPaymentLine = Omit<OrderPayment, 'method'> & { method: OrderPayment['method'] | 'CREDIT_DEBT' };

/** A saved bill whose payment is being changed (from the sales history); passed on to the receipt mapper. */
export interface EditablePaymentOrder {
  id: string;
  orderNumber?: string;
  totalAmount?: number;
  userName?: string;
  [field: string]: unknown;
}

/** What checkout answers (only the fields read here). */
interface CheckoutResult {
  id: string;
  orderNumber: string;
  isOfflineSaved?: boolean;
  createdAt?: string;
  pointsEarned?: number | string | null;
  pointsUsed?: number | string | null;
  customer?: string | { points?: number | string | null } | null;
}

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMethod?: Method | null;
  orderToEditPayment?: EditablePaymentOrder | null;
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

  const operationId = useRef<string | null>(null);
  const submitting = useRef(false);
  // Manager approval (discount over limit / below price floor / below cost)
  const approvalIdRef = useRef<string | null>(null);
  // latest callback for timers/effects (avoids stale closures without re-running the effects)
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  const [approvalNeeded, setApprovalNeeded] = useState<ApprovalNeeded | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState(false);
  const [step, setStep] = useState<Step>('METHOD');
  const [method, setMethod] = useState<Method | null>(null);
  
  // Cash & QR tracking
  const [cashReceived, setCashReceived] = useState<number>(0);
  /** the cash amount as typed in the "รับเงินสดมา" field (keyboard entry) */
  const [cashText, setCashText] = useState('');
  const [qrReceived, setQrReceived] = useState<number>(0);
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>('NONE');
  /** why the last confirm did not save (shown in the dialog, next to the buttons; a toast alone was easy to miss) */
  const [payError, setPayError] = useState<string | null>(null);
  const cashInputRef = useRef<HTMLInputElement | null>(null);
  /** when the cashier last went back to the method screen (a second click on "ย้อนกลับ" must not pick a method) */
  const backAtRef = useRef(0);

  // Bank accounts for QR payment & Split payment
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<BankAccount | null>(null);

  // PDF Receipt state
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [showReceiptPdf, setShowReceiptPdf] = useState(false);

  const triggerDirectPrint = (receipt: ReceiptData) => {
    printThermalReceiptDirect(receipt, loadStoreSettings());
  };

  const total = orderToEditPayment ? (orderToEditPayment.totalAmount || 0) : cart.getTotal();
  
  // Cash method logic
  const isCashSufficient = cashReceived >= total;
  const change = isCashSufficient ? cashReceived - total : 0;
  const cashHint = isCashSufficient
    ? null
    : cashReceived > 0
    ? `รับเงินยังไม่พอ ขาดอีก ${formatCurrency(Math.round((total - cashReceived) * 100) / 100)}`
    : 'พิมพ์จำนวนเงินที่รับมา หรือกดธนบัตร แล้วกด Enter';

  // PromptPay ID of the chosen account: QR generated with the amount locked (else the uploaded image)
  const selectedPromptPay = promptPayOf(selectedBank);

  // Split method logic
  const splitTotalReceived = cashReceived + qrReceived;
  const splitRemaining = Math.max(0, total - splitTotalReceived);
  const splitChange = Math.max(0, splitTotalReceived - total);
  const isSplitSufficient = splitTotalReceived >= total;
  const splitHint = isSplitSufficient ? null : `ยอดรับยังไม่ครบ ขาดอีก ${formatCurrency(splitRemaining)}`;

  // Auto-close countdown timer state for SUCCESS step
  const [countdown, setCountdown] = useState<number>(5);

  // Reset all state when closed
  const openChangedForClose = useHasChanged(open);
  if (openChangedForClose && !open) {
    setCashReceived(0);
    setCashText('');
    setPayError(null);
    setQrReceived(0);
    setNumpadTarget('NONE');
    setStep('METHOD');
    setMethod(null);
    setShowReceiptPdf(false);
    setReceiptData(null);
  }

  // The success screen counts down from 5 each time it is shown
  const countingDown = open && step === 'SUCCESS' && !showReceiptPdf;
  const countingDownChanged = useHasChanged(countingDown);
  if (countingDownChanged && countingDown) setCountdown(5);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    if (open && step === 'SUCCESS' && !showReceiptPdf) {
      interval = setInterval(() => {
        setCountdown((prev) => Math.max(0, prev - 1));
      }, 1000);

      timer = setTimeout(() => {
        operationId.current = null;
        useCartStore.getState().clearCart();
        onOpenChangeRef.current(false);
      }, 5000);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [open, step, showReceiptPdf]);

  const handleOpenChange = (isOpen: boolean) => {
    if (submitting.current) return;
    if (!isOpen) {
      if (step === 'SUCCESS' || orderToEditPayment) {
        operationId.current = null;
        cart.clearCart();
      }
    }
    onOpenChange(isOpen);
  };

  /** cash received as a number (buttons / numpad) and the text of the typing field together */
  const setCash = (amount: number) => {
    const n = Math.max(0, Math.round(amount * 100) / 100);
    setCashReceived(n);
    setCashText(n > 0 ? String(n) : '');
    setPayError(null);
  };

  /** typing in the "รับเงินสดมา" field: digits and at most 2 decimals */
  const onCashTyped = (raw: string) => {
    const text = raw.replace(/,/g, '').replace(/[^\d.]/g, '');
    if (!/^\d{0,9}(\.\d{0,2})?$/.test(text)) return;
    setCashText(text);
    setCashReceived(text === '' || text === '.' ? 0 : Number(text));
    setPayError(null);
  };

  const focusCashInput = () => {
    // after a banknote button the keyboard goes back to the amount field: Enter confirms, digits type
    setTimeout(() => cashInputRef.current?.focus({ preventScroll: true }), 0);
  };

  const goBackToMethods = () => {
    backAtRef.current = Date.now();
    setPayError(null);
    setStep('METHOD');
  };

  const handleSelectMethod = (m: Method) => {
    // the method cards sit where "ย้อนกลับ" was: a double click on "ย้อนกลับ" used to open the card under the
    // pointer (e.g. แบ่งชำระ) by itself
    if (Date.now() - backAtRef.current < 600) return;
    setMethod(m);
    setStep('PROCESS');
    setPayError(null);
    if (m === 'CASH') setCash(0);
    if (m === 'SPLIT') {
      setCash(0);
      setQrReceived(0);
    }
  };

  const addCash = (amount: number) => {
    setCash(cashReceived + amount);
    focusCashInput();
  };

  const exactCash = () => {
    setCash(total);
    focusCashInput();
  };

  /** Enter in the amount field */
  const confirmCashByKeyboard = () => {
    if (isSubmitting) return;
    if (!isCashSufficient) {
      setPayError(cashHint);
      return;
    }
    void handleConfirmPayment();
  };

  const handleConfirmPayment = async () => {
    if (submitting.current || step === 'SUCCESS') return;
    submitting.current = true;
    setIsSubmitting(true);
    try {
    const payments: PosPaymentLine[] = [];
    let recordedCashReceived = 0;
    let recordedChangeAmount = 0;
    const attachedClaim = cart.attachedClaim;
    const claimDiscountAmt = cart.getClaimDiscountAmount();
    const claimFaceValue = attachedClaim
      ? Number(attachedClaim.discountAmount ?? attachedClaim.totalClaimValue ?? (attachedClaim.quantity || 1) * (attachedClaim.unitPrice || 0))
      : 0;

    setPayError(null);
    if (attachedClaim && claimFaceValue > claimDiscountAmt) {
      const msg = `ยอดบิลยังไม่พอใช้ส่วนลดเคลม ${formatCurrency(claimFaceValue)} ได้ครบ กรุณาเพิ่มสินค้าอีก ${formatCurrency(claimFaceValue - claimDiscountAmt)} หรือยกเลิกส่วนลดเคลมก่อนชำระ`;
      setPayError(msg);
      toast.error(msg);
      return;
    }
    if (!orderToEditPayment && !shiftStore.currentShift?.id) {
      const msg = 'ยังไม่ได้เปิดกะของเครื่องนี้ จึงบันทึกการขายไม่ได้ — ปิดหน้านี้แล้วกดปุ่ม "เปิดกะ" ก่อนขาย';
      setPayError(msg);
      toast.error(msg);
      return;
    }
    
    if (total === 0) {
      payments.push({ method: 'CASH' as const, amount: 0 });
      recordedCashReceived = 0;
      recordedChangeAmount = 0;
    } else if (method === 'CASH') {
      payments.push({ method: 'CASH' as const, amount: total });
      recordedCashReceived = cashReceived;
      recordedChangeAmount = change;
    } else if (method === 'QR') {
      payments.push({ 
        method: 'QR_PROMPTPAY' as const, 
        amount: total, 
        referenceNo: selectedBank ? `${selectedBank.bankName} (${selectedBank.accountNumber})` : undefined,
        bankAccountId: selectedBank?.id 
      });
      recordedCashReceived = total;
    } else if (method === 'SPLIT') {
      if (qrReceived > 0) {
        payments.push({ 
          method: 'QR_PROMPTPAY' as const, 
          amount: qrReceived,
          referenceNo: selectedBank ? `${selectedBank.bankName} (${selectedBank.accountNumber})` : undefined,
        bankAccountId: selectedBank?.id 
        });
      }
      if (cashReceived > 0) {
        payments.push({ method: 'CASH' as const, amount: total - qrReceived });
      }
      recordedCashReceived = cashReceived;
      recordedChangeAmount = splitChange;
    } else if (method === 'CREDIT') {
      payments.push({ method: 'CREDIT_DEBT' as const, amount: total });
    }

    // Direct Payment Method Edit for existing order (without touching cart!)
    if (orderToEditPayment) {
      const orderId = orderToEditPayment.orderNumber || orderToEditPayment.id;
      const primaryNewMethod = payments.length > 1 ? 'SPLIT' : (payments[0]?.method || 'CASH');

      await apiFetch(`/orders/${orderToEditPayment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentMethod: primaryNewMethod, payments: payments })
      });

      void shiftStore.fetchCurrentShift();

      // same mapping as every other reprint; only the payments changed
      const completedReceipt: ReceiptData = orderToReceiptData(
        { ...orderToEditPayment, orderNumber: orderId, userName: orderToEditPayment.userName || shiftStore.currentShift?.userName },
        {
          isReprint: true,
          payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) || 0, referenceNo: p.referenceNo })),
          cashReceived: recordedCashReceived || undefined,
          changeAmount: recordedChangeAmount || undefined,
        },
      );

      setReceiptData(completedReceipt);
      operationId.current = null;
      setStep('SUCCESS');
      setShowReceiptPdf(false);
      triggerDirectPrint(completedReceipt);

      // Kick cash drawer ONLY if CASH is involved!
      const hasCash = method === 'CASH' || (method === 'SPLIT' && recordedCashReceived > 0);
      if (hasCash) {
        kickCashDrawer({ reason: 'แก้ไขบิล - ชำระเงินสด' });
      }

      onPaymentEditSuccess?.();
      toast.success(`✅ อัปเดตวิธีชำระเงินบิล #${orderId} เรียบร้อยแล้ว!`);
      return;
    }

    let isSynced = false;
    let backendOrder: CheckoutResult | null = null;
    try {
      operationId.current ||= newOperationId();
      const checkedOut: CheckoutResult = await api.orders.checkout({
        clientOrderId: operationId.current,
        approvalId: approvalIdRef.current || undefined,
        terminalId: getTerminalId(),
        claimDiscountAmount: claimDiscountAmt,
        // lets the server check the claim credit against the real claim / purchase records
        claimRefs: {
          claimId: attachedClaim?.id,
          pending: (cart.pendingClaims || []).filter((c) => c.resolutionType === 'STORE_DISCOUNT').map((c) => ({ orderId: c.orderId, productId: c.productId, quantity: c.quantity })),
        },
        customerId: cart.customerId,
        // online order opened from the held-bills sheet: the server marks it paid by this bill
        onlineOrderId: cart.onlineOrderId || undefined,
        shiftId: shiftStore.currentShift?.id,
        createdAt: new Date().toISOString(),
        discountAmount: Math.min(
          cart.getBillDiscountAmount() + cart.getPointsDiscountAmount() + claimDiscountAmt,
          cart.getSubtotal()
        ),
        pointsUsed: cart.pointsUsed,
        pointsDiscountAmount: cart.getPointsDiscountAmount(),
        totalAmount: total,
        note: cart.note || undefined,
        items: cart.items.map(i => {
          const effectivePrice = cart.getEffectivePrice(i);
          const lineTotal = cart.getItemLineTotal(i);
          const lineDiscount = Math.max(0, (i.quantity * effectivePrice) - lineTotal);
          return {
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: effectivePrice,
            unitId: i.unitId,
            unitName: i.unitName,
            conversionFactor: i.conversionFactor || 1,
            discountAmount: lineDiscount,
            isClaimReplacement: (i.claimQuantity || 0) > 0,
            claimQuantity: i.claimQuantity || 0,
          };
        }),
        payments,
      });
      backendOrder = checkedOut;
      approvalIdRef.current = null;
      isSynced = !checkedOut.isOfflineSaved;
      setPendingReceipt(!isSynced);
      const finalOrderNumber = checkedOut.orderNumber;
      const finalOrderId = checkedOut.id;

      const previousEditingId = cart.editingOrderId;
      if (previousEditingId) {
        void shiftStore.fetchCurrentShift();
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
        outboxVersion: 2,
        shiftId: shiftStore.currentShift?.id || 'shift_default',
        orderNumber: finalOrderNumber,
        customerId: cart.customerId,
        customerName: cart.customerName,
        items: cart.items.map(i => {
          const effectivePrice = cart.getEffectivePrice(i);
          const lineTotal = cart.getItemLineTotal(i);
          const lineDiscount = Math.max(0, (i.quantity * effectivePrice) - lineTotal);
          return {
            productId: i.productId,
            name: i.name,
            sku: i.sku,
            quantity: i.quantity,
            unitName: i.unitName,
            unitId: i.unitId,
            conversionFactor: i.conversionFactor || 1,
            unitPrice: effectivePrice,
            originalPrice: i.originalPrice,
            discountType: i.discountType,
            discountValue: i.discountValue,
            discountAmount: lineDiscount,
            lineTotal: lineTotal,
            hasVat: i.hasVat,
          };
        }),
        subtotal: cart.getSubtotal(),
        billDiscountType: cart.billDiscountType,
        billDiscountValue: cart.billDiscountValue,
        billDiscountAmount: cart.getBillDiscountAmount(),
        pointsDiscountAmount: cart.getPointsDiscountAmount(),
        pointsUsed: cart.pointsUsed,
        claimDiscountAmount: claimDiscountAmt,
        claimInfo: claimInfoObj,
        vatAmount: cart.getVatAmount(),
        vatEnabled: cart.isVatEnabled,
        totalAmount: total,
        payments: payments as OrderPayment[],
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

      // Commit pending claim items (Store Discount claims)
      if (cart.pendingClaims && cart.pendingClaims.length > 0) {
        for (const pending of cart.pendingClaims) {
          try {
            await processClaim({
              item: {
                orderId: pending.orderId,
                orderNumber: pending.orderNumber,
                orderDate: pending.orderDate,
                customerId: pending.customerId,
                customerName: pending.customerName,
                customerPhone: pending.customerPhone,
                productId: pending.productId,
                productName: pending.productName,
                sku: pending.sku,
                unitName: pending.unitName,
                boughtQuantity: pending.quantity,
                alreadyClaimedQuantity: 0,
                availableClaimQuantity: pending.quantity,
                unitPrice: pending.unitPrice,
                isReplacementWarranty: false,
              },
              quantity: pending.quantity,
              defectReason: pending.defectReason,
              resolutionType: 'STORE_DISCOUNT',
              cashierName: shiftStore.currentShift?.userName || 'พนักงาน POS',
              discountAmount: pending.discountAmount ?? (pending.quantity * pending.unitPrice),
              note: `ใช้เป็นส่วนลดในบิล #${finalOrderNumber}`,
            });
          } catch (err) {
            console.error('Failed to commit pending claim:', err);
          }
        }
      }

      // Commit in-cart replacement claims (item.claimQuantity > 0)
      for (const it of cart.items) {
        if (it.claimQuantity && it.claimQuantity > 0) {
          try {
            await processClaim({
              item: {
                orderId: it.claimSourceOrderId || finalOrderId,
                orderNumber: it.claimSourceOrderId || finalOrderNumber,
                orderDate: new Date().toISOString(),
                customerId: cart.customerId,
                customerName: cart.customerName || 'ลูกค้าทั่วไป',
                productId: it.productId,
                productName: it.name,
                sku: it.sku,
                unitName: it.unitName,
                boughtQuantity: it.quantity,
                alreadyClaimedQuantity: 0,
                availableClaimQuantity: it.claimQuantity,
                unitPrice: cart.getEffectivePrice(it),
                isReplacementWarranty: false,
              },
              quantity: it.claimQuantity,
              defectReason: it.claimDefectReason || 'สินค้าชำรุด/เปลี่ยนสินค้าใหม่ฟรีในบิล',
              resolutionType: 'REPLACE_ITEM',
              cashierName: shiftStore.currentShift?.userName || 'พนักงาน POS',
              note: `เปลี่ยนสินค้าฟรีในบิล #${finalOrderNumber}`,
              skipStockDeduction: true,
              fulfilledInOrderNumber: finalOrderNumber,
              fulfilledInOrderId: finalOrderId,
            });
          } catch (err) {
            console.error('Failed to commit in-cart claim replacement:', err);
          }
        }
      }

      // Stock is deducted by the server when it records the bill (also for outbox replays);
      // refresh the product list so the POS shows the server's stock.
      if (isSynced) void useProductStore.getState().fetchProducts({ offlineCache: true });

      const custSaleRes = {
        earnedPoints: isSynced ? Number(checkedOut.pointsEarned || 0) : 0,
        pointsUsed: isSynced ? Number(checkedOut.pointsUsed || 0) : 0,
        newTotalPoints: isSynced ? Number((typeof checkedOut.customer === 'object' ? checkedOut.customer?.points : 0) || 0) : 0,
      };

      // Automatically kick cash drawer open if cash payment was received (and total > 0)!
      const hasCash = ((method === 'CASH' || (method === 'SPLIT' && cashReceived > 0) || recordedCashReceived > 0)) && total > 0;
      if (hasCash) {
        kickCashDrawer({ reason: 'รับชำระเงินสด' }).catch(() => {});
      }

      const completedReceipt: ReceiptData = {
        orderNumber: finalOrderNumber,
        createdAt: backendOrder?.createdAt ? new Date(backendOrder.createdAt).toISOString() : new Date().toISOString(),
        customerName: cart.customerName,
        userName: shiftStore.currentShift?.userName || 'พนักงาน POS',
        note: cart.note?.trim() || undefined,
        items: cart.items.map(i => {
          const effectivePrice = cart.getEffectivePrice(i);
          const lineTotal = cart.getItemLineTotal(i);
          const lineDiscount = Math.max(0, (i.quantity * effectivePrice) - lineTotal);
          return {
            name: i.name,
            quantity: i.quantity,
            unitName: i.unitName,
            unitPrice: effectivePrice,
            lineTotal: lineTotal,
            discountAmount: lineDiscount,
            claimQuantity: i.claimQuantity,
            claimDefectReason: i.claimDefectReason,
            itemNote: i.itemNote,
          };
        }),
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
        paymentMethod: total === 0 ? 'เคลมสินค้า / ฟรี (฿0.00)' : summarizePaymentMethods(payments),
        outstandingAmount: payments
          .filter((p) => isCreditMethod(p.method))
          .reduce((sum: number, p) => sum + Number(p.amount || 0), 0) || undefined,
        payments: payments,
        cashReceived: recordedCashReceived,
        changeAmount: recordedChangeAmount
      };

      setReceiptData(completedReceipt);
      operationId.current = null;
      setStep('SUCCESS');
      setShowReceiptPdf(false);
      triggerDirectPrint(completedReceipt);
      // optional (Settings > รูปแบบใบเสร็จ, off by default): the picking slip of this sale, after the receipt
      if (getReceiptOptions(loadStoreSettings()).slip.autoPickingSlip) {
        const picking = cartToPickingSlip(cart, { source: 'bill', docNo: finalOrderNumber, createdAt: completedReceipt.createdAt, unitOf: productUnitLookup() });
        if (picking.lines.length) {
          setTimeout(() => {
            void import('./PickingSlipView').then((m) => m.printPickingSlip(picking, loadStoreSettings()));
          }, 1500);
        }
      }
    } catch (error) {
      if (!backendOrder && error instanceof ApiError && error.data?.code === 'APPROVAL_REQUIRED') {
        // ask a manager to approve with their PIN, then submit the same bill again
        approvalIdRef.current = null;
        setApprovalNeeded({ ticket: error.data.ticket, reasons: error.data.reasons || [], total });
        return;
      }
      approvalIdRef.current = null;
      if (!backendOrder && error instanceof ApiError && !isRetryableError(error)) operationId.current = null;
      const msg = 'บันทึกการชำระเงินไม่ได้: ' + (error instanceof Error ? error.message : String(error));
      setPayError(msg);
      toast.error(msg);
    }
    } catch (error) {
      const msg = 'บันทึกไม่ได้: ' + (error instanceof Error ? error.message : String(error));
      setPayError(msg);
      toast.error(msg);
    } finally { submitting.current = false; setIsSubmitting(false); }
  };

  // Opening (or a new total / start method / bill to edit while open) starts the payment from scratch
  const cartItemCount = cart.items.length;
  const emptyCart = !orderToEditPayment && cartItemCount === 0;
  const startKeyChanged = useHasChanged(`${open}|${initialMethod}|${total}`);
  const editOrderChanged = useHasChanged(orderToEditPayment);
  if ((startKeyChanged || editOrderChanged) && open && !emptyCart) {
    setPendingReceipt(false);
    const accs = loadBankAccounts();
    setBankAccounts(accs);
    setSelectedBank(accs.find(a => a.isDefault) || accs[0] || null);

    setCashReceived(0);
    setCashText('');
    setPayError(null);
    setQrReceived(0);
    setNumpadTarget('NONE');

    if (total === 0 && cartItemCount > 0 && !orderToEditPayment) {
      // ฿0 bill (claim replacement / 100% discount): never saved automatically - the
      // cashier must confirm it explicitly on the next screen.
      setMethod('CASH');
      setStep('PROCESS');
    } else if (initialMethod) {
      setMethod(initialMethod);
      setStep('PROCESS');
    } else {
      setStep('METHOD');
      setMethod(null);
    }
  }

  // An empty cart cannot be paid: warn and close. Otherwise refresh the bank accounts from the server.
  useEffect(() => {
    if (!open) return;
    if (!orderToEditPayment && useCartStore.getState().items.length === 0) {
      toast.warning('ไม่มีสินค้าในตะกร้า ไม่สามารถชำระเงินได้');
      onOpenChangeRef.current(false);
      return;
    }
    void api.bankAccounts.getAll().then(accs => {
      setBankAccounts(accs);
      setSelectedBank(accs.find((a: BankAccount) => a.isDefault) || accs[0] || null);
    }).catch(() => toast.warning('โหลดบัญชีธนาคารจากเซิร์ฟเวอร์ไม่ได้'));
  }, [open, initialMethod, total, orderToEditPayment]);

  const handleFinish = () => {
    operationId.current = null;
    cart.clearCart();
    onOpenChange(false);
  };

  const handleNumpadConfirm = (val: number) => {
    if (numpadTarget === 'CASH') { setCash(val); focusCashInput(); }
    if (numpadTarget === 'QR') setQrReceived(val);
    if (numpadTarget === 'SPLIT_CASH') setCash(val);
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
        <DialogContent aria-busy={isSubmitting} className="w-[calc(100vw-1rem)] sm:w-[90vw] max-w-6xl h-[90dvh] max-h-[850px] flex flex-col p-3 pb-0 sm:p-8 sm:pb-0 overflow-y-auto bg-white border-slate-200 text-slate-900 shadow-2xl rounded-3xl">
          <DialogHeader className="shrink-0 pb-3 border-b border-slate-100 mb-4">
            <DialogTitle className="text-2xl font-bold flex items-center gap-3">
              <CreditCard className="w-8 h-8 text-sky-500" />
              <span>
                {step === 'METHOD' && 'เลือกช่องทางการชำระเงิน'}
                {step === 'PROCESS' && total === 0 && 'ประมวลผลบิลเคลมสินค้า / ฟรี (฿0.00)'}
                {step === 'PROCESS' && total > 0 && method === 'CASH' && 'รับชำระด้วยเงินสด (Cash)'}
                {step === 'PROCESS' && method === 'QR' && 'รับชำระผ่าน QR PromptPay / โอนเงิน'}
                {step === 'PROCESS' && method === 'SPLIT' && 'รับชำระแบบแบ่งจ่าย (Split Payment)'}
                {step === 'PROCESS' && method === 'CREDIT' && 'บันทึกเป็นเงินเชื่อ (ค้างชำระ)'}
                {step === 'SUCCESS' && (pendingReceipt ? 'เก็บบิลในเครื่อง — รอส่งฐานข้อมูล' : 'บันทึกฐานข้อมูลสำเร็จ!')}
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

          {/* STEP 2: PROCESS (0-Baht Auto Checkout) */}
          {step === 'PROCESS' && total === 0 && (
            <div className="py-20 flex-1 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-inner">
                <ShieldCheck className="w-12 h-12" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-slate-800">ยอดชำระบิลนี้ ฿0.00</h3>
                <p className="text-sm text-slate-500 mt-1">
                  บิลเคลมสินค้า / ส่วนลดเต็มจำนวน — ตรวจสอบรายการก่อน แล้วกดยืนยันเพื่อบันทึกบิล ตัดสต็อก และพิมพ์สลิป
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => handleOpenChange(false)}
                  className="h-12 px-6 rounded-2xl font-bold"
                >
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleConfirmPayment()}
                  className="h-12 px-6 rounded-2xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันบันทึกบิล ฿0.00'}
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (CASH) */}
          {step === 'PROCESS' && total > 0 && method === 'CASH' && (
            <div
              className="py-2 flex-1 flex flex-col justify-between"
              onKeyDownCapture={(e) => {
                // Enter anywhere on the cash screen confirms (a focused banknote button must not add its note again);
                // only "ย้อนกลับ" keeps its own Enter
                if (e.key !== 'Enter' || (e.target as HTMLElement).closest('[data-own-enter]')) return;
                e.preventDefault();
                e.stopPropagation();
                confirmCashByKeyboard();
              }}
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Left side: Received Cash & Calculator */}
                <div className="border-b border-slate-200 pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-8 space-y-6">
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">ยอดรวมที่ต้องชำระ</p>
                    <div className="text-4xl font-extrabold text-slate-900">{formatCurrency(total)}</div>
                  </div>
                  
                  <div className="p-5 bg-sky-50 border-2 border-sky-300 rounded-3xl relative group shadow-sm">
                    <label htmlFor="pos-cash-received" className="text-sm text-sky-800 font-bold mb-1 block">รับเงินสดมา (พิมพ์ตัวเลขได้เลย · Enter = ยืนยัน)</label>
                    <div className="flex items-baseline gap-1 pr-12 font-mono">
                      <span className="text-4xl font-extrabold text-sky-600">฿</span>
                      <input
                        id="pos-cash-received"
                        ref={cashInputRef}
                        data-testid="cash-received-input"
                        autoFocus
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        value={cashText}
                        onChange={(e) => onCashTyped(e.target.value)}
                        className="w-full min-w-0 bg-transparent py-2 text-5xl font-extrabold text-sky-600 outline-none placeholder:text-sky-300"
                      />
                    </div>
                    <Button 
                      size="icon" 
                      variant="outline" 
                      className="absolute top-4 right-4 h-10 w-10 border-sky-300 bg-white text-sky-600 hover:bg-sky-100 shadow-sm"
                      onClick={() => setNumpadTarget('CASH')}
                      title="กดเพื่อเปิด Numpad"
                      aria-label="เปิด Numpad"
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
                  <Button variant="ghost" className="w-full text-slate-500 hover:text-red-600 font-semibold" onClick={() => { setCash(0); focusCashInput(); }}>
                    ล้างยอดเงินสด
                  </Button>
                </div>
              </div>

              {/* Always on screen: sticks to the bottom of the dialog when the content is taller than a short
                  window (Windows display scaling / small screens used to push it under the dialog edge). */}
              <div data-testid="payment-footer" className="sticky bottom-0 z-10 -mx-3 sm:-mx-8 mt-6 border-t border-slate-200 bg-white px-3 sm:px-8 pt-3 pb-3 sm:pb-6">
                <PaymentFooterMessage error={payError} hint={cashHint} />
                <div className="flex gap-4">
                  <Button data-own-enter variant="outline" className="w-36 sm:w-44 h-14 text-base border-slate-300 rounded-2xl font-semibold" onClick={goBackToMethods}>
                    ย้อนกลับ
                  </Button>
                  <Button
                    className="flex-1 h-14 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xl rounded-2xl shadow-lg"
                    disabled={isSubmitting || !isCashSufficient}
                    onClick={handleConfirmPayment}
                  >
                    {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันรับเงินสด (Enter)'}
                  </Button>
                </div>
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

                  {/* XL QR: generated PromptPay QR for the amount (follows the numpad), else the uploaded image */}
                  {selectedPromptPay && selectedBank ? (
                    <div className="w-full max-w-80 border-2 border-slate-200 rounded-3xl bg-white p-3 shadow-md">
                      <PromptPayQr
                        type={selectedPromptPay.type}
                        id={selectedPromptPay.id}
                        amount={qrReceived > 0 ? qrReceived : total}
                        accountName={selectedBank.accountName}
                        size={260}
                      />
                    </div>
                  ) : (
                  <div className="w-full max-w-72 aspect-square border-2 border-slate-200 rounded-3xl overflow-hidden bg-white p-4 shadow-md flex items-center justify-center mb-4">
                    {selectedBank?.qrImageUrl ? (
                      <img src={selectedBank.qrImageUrl} alt="QR PromptPay" className="w-full h-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-400 gap-3">
                        <QrCode className="w-32 h-32 text-slate-300" />
                        <span className="text-sm text-slate-500 font-semibold">สแกนชำระผ่าน PromptPay</span>
                      </div>
                    )}
                  </div>
                  )}

                  {!selectedPromptPay && (
                  <div className="space-y-1">
                    <p className="text-sm text-slate-600">ชื่อบัญชี: <b className="text-slate-900 text-base">{selectedBank?.accountName || 'ร้านปุริม'}</b></p>
                    <p className="text-sm text-slate-600">เลขที่บัญชี / พร้อมเพย์: <b className="font-mono text-slate-900 text-xl font-bold">{selectedBank?.accountNumber || '081-234-5678'}</b></p>
                  </div>
                  )}
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
                    <Button variant="outline" className="h-12 border-slate-300 text-slate-600 rounded-2xl font-semibold" onClick={goBackToMethods}>
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
                    {selectedBank && selectedPromptPay ? (
                      <div className="rounded-2xl border border-sky-200 bg-white p-3">
                        <p className="text-xs font-bold text-sky-900 mb-1 text-center">QR พร้อมเพย์ สำหรับยอดโอน ({selectedBank.bankName})</p>
                        <PromptPayQr
                          type={selectedPromptPay.type}
                          id={selectedPromptPay.id}
                          amount={qrReceived}
                          accountName={selectedBank.accountName}
                          size={200}
                        />
                      </div>
                    ) : selectedBank && qrReceived > 0 && (
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

                  <div data-testid="payment-footer" className="sticky bottom-0 z-10 -mx-3 sm:mx-0 border-t border-slate-100 bg-white px-3 sm:px-0 pt-3 pb-3 sm:pb-6">
                    <PaymentFooterMessage error={payError} hint={splitHint} />
                    <div className="flex gap-4">
                      <Button variant="outline" className="w-36 h-14 border-slate-300 rounded-2xl font-semibold text-base" onClick={goBackToMethods}>
                        ย้อนกลับ
                      </Button>
                      <Button
                        className="flex-1 h-14 bg-sky-500 hover:bg-sky-600 text-white font-bold text-lg rounded-2xl shadow-lg"
                        disabled={isSubmitting || !isSplitSufficient}
                        onClick={handleConfirmPayment}
                      >
                        {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันรับเงิน'}
                      </Button>
                    </div>
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
                <Button variant="outline" className="w-40 h-14 text-base border-slate-300 rounded-2xl font-semibold" onClick={goBackToMethods}>
                  ย้อนกลับ
                </Button>
                <Button className="w-56 h-14 bg-sky-500 hover:bg-sky-600 text-white font-bold text-lg rounded-2xl shadow-lg" onClick={handleConfirmPayment} disabled={isSubmitting}>
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
                <h2 className="text-4xl font-extrabold text-slate-900">
                  {total === 0 ? 'บันทึกบิลเคลม / ชำระ ฿0 สำเร็จ!' : (pendingReceipt ? 'รอส่งฐานข้อมูล' : 'ชำระเงินสำเร็จ!')}
                </h2>
                <p className="text-slate-500 text-base mt-1">
                  {pendingReceipt ? 'บิลนี้ยังไม่อยู่ในฐานข้อมูล กรุณาตรวจแถบสถานะจนส่งสำเร็จ' : 'ฐานข้อมูลยืนยันรายการเรียบร้อยแล้ว'}
                </p>
                <div className="pt-2 flex flex-col items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold text-sm px-4 py-1.5 rounded-full shadow-xs">
                    กรุณาตรวจสอบใบเสร็จจากเครื่องพิมพ์หรือหน้าต่างพิมพ์
                  </span>
                  <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-300 font-extrabold text-xs px-3 py-1 rounded-full shadow-xs">
                    ⏳ หน้าต่างจะปิดอัตโนมัติและล้างตะกร้าใน {countdown} วินาที...
                  </span>
                </div>
              </div>

              {method === 'CASH' && change > 0 && (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-3xl p-6 inline-block mx-auto w-full max-w-sm shadow-sm">
                  <span className="text-emerald-800 text-base block font-bold">เงินทอนลูกค้า</span>
                  <span className="text-5xl font-extrabold text-emerald-600 font-mono">{formatCurrency(change)}</span>
                </div>
              )}

              {method === 'SPLIT' && splitChange > 0 && (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-3xl p-6 inline-block mx-auto w-full max-w-sm shadow-sm">
                  <span className="text-emerald-800 text-base block font-bold">เงินทอนลูกค้า (จากเงินสด)</span>
                  <span className="text-5xl font-extrabold text-emerald-600 font-mono">{formatCurrency(splitChange)}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                <Button 
                  className="h-14 px-7 bg-black hover:bg-slate-800 text-white font-bold text-base rounded-2xl shadow-md transition-all flex items-center gap-2 cursor-pointer" 
                  onClick={() => {
                    if (receiptData) {
                      triggerDirectPrint(receiptData);
                      toast.success('สั่งพิมพ์ใบเสร็จซ้ำอีกครั้งแล้ว');
                    }
                  }}
                >
                  <Printer className="w-5 h-5 text-white" />
                  พิมพ์ใบเสร็จอีกครั้ง (Re-print)
                </Button>

                <Button 
                  variant="outline"
                  className="h-14 px-5 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-bold text-base rounded-2xl shadow-xs transition-all flex items-center gap-2" 
                  onClick={() => setShowReceiptPdf(true)}
                >
                  <FileText className="w-5 h-5 text-slate-600" />
                  ดูตัวอย่าง / PDF
                </Button>

                <Button className="h-14 px-8 bg-sky-600 hover:bg-sky-700 text-white font-bold text-lg rounded-2xl shadow-lg cursor-pointer" onClick={handleFinish}>
                  ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)
                </Button>
              </div>
            </div>
          )}
          {/* bottom padding of the dialog (the sticky cash / split footers bring their own) */}
          {!(step === 'PROCESS' && total > 0 && (method === 'CASH' || method === 'SPLIT')) && <div aria-hidden className="h-3 shrink-0 sm:h-8" />}
        </DialogContent>
      </Dialog>

      {/* Optional PDF Receipt Preview Modal */}
      <ReceiptPdfModal
        open={showReceiptPdf}
        onOpenChange={(isOpen) => {
          setShowReceiptPdf(isOpen);
          if (!isOpen && step === 'SUCCESS') {
            handleFinish();
          }
        }}
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
      <ApprovalDialog
        request={approvalNeeded}
        onCancel={() => setApprovalNeeded(null)}
        onApproved={(approvalId) => {
          approvalIdRef.current = approvalId;
          setApprovalNeeded(null);
          void handleConfirmPayment();
        }}
      />
    </>
  );
}

/** Why the confirm button cannot save right now (error of the last try, else what is missing). */
function PaymentFooterMessage({ error, hint }: { error: string | null; hint: string | null }) {
  if (!error && !hint) return null;
  return (
    <p
      role={error ? 'alert' : 'status'}
      data-testid="payment-message"
      className={`mb-2 text-sm font-bold ${error ? 'rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700' : 'text-slate-500'}`}
    >
      {error || hint}
    </p>
  );
}
