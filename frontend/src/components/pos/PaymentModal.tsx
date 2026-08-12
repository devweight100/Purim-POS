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
import { CreditCard, QrCode, Banknote, Edit3, CheckCircle2, SplitSquareHorizontal, UserCheck, Building2, ExternalLink, RefreshCw } from 'lucide-react';
import { NumpadPopup } from './NumpadPopup';
import { loadBankAccounts, BankAccount } from '@/lib/bank-account-storage';
import { toast } from 'sonner';
import useRouter from 'next/navigation';

type Step = 'METHOD' | 'PROCESS' | 'SUCCESS';
type Method = 'CASH' | 'QR' | 'CARD' | 'SPLIT' | 'CREDIT';
type NumpadTarget = 'NONE' | 'CASH' | 'SPLIT_CASH' | 'SPLIT_QR';

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentModal({ open, onOpenChange }: PaymentModalProps) {
  const cart = useCartStore();
  const shiftStore = useShiftStore();

  const [step, setStep] = useState<Step>('METHOD');
  const [method, setMethod] = useState<Method | null>(null);
  
  // Cash & QR tracking
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [qrReceived, setQrReceived] = useState<number>(0);
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>('NONE');

  // Bank accounts for QR payment
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<BankAccount | null>(null);

  const total = cart.getTotal();
  
  // Cash method logic
  const isCashSufficient = cashReceived >= total;
  const change = isCashSufficient ? cashReceived - total : 0;

  // Split method logic
  const splitTotalReceived = cashReceived + qrReceived;
  const splitRemaining = Math.max(0, total - splitTotalReceived);
  const splitChange = Math.max(0, splitTotalReceived - total);
  const isSplitSufficient = splitTotalReceived >= total;

  // Force reset when opened
  useEffect(() => {
    if (open) {
      setStep('METHOD');
      setMethod(null);
      setCashReceived(0);
      setQrReceived(0);
      setNumpadTarget('NONE');

      const accs = loadBankAccounts();
      setBankAccounts(accs);
      const def = accs.find(a => a.isDefault) || accs[0] || null;
      setSelectedBank(def);
    }
  }, [open]);

  const handleOpenChange = (isOpen: boolean) => {
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
    
    if (method === 'CASH') {
      payments.push({ method: 'CASH' as const, amount: total });
      recordedCashReceived = cashReceived;
      recordedChangeAmount = change;
    } else if (method === 'QR') {
      payments.push({ method: 'QR_PROMPTPAY' as const, amount: total, referenceNo: selectedBank?.accountNumber });
      recordedCashReceived = total;
    } else if (method === 'SPLIT') {
      if (qrReceived > 0) payments.push({ method: 'QR_PROMPTPAY' as const, amount: qrReceived });
      if (cashReceived > 0) payments.push({ method: 'CASH' as const, amount: total - qrReceived });
      recordedCashReceived = cashReceived;
      recordedChangeAmount = splitChange;
    } else if (method === 'CREDIT') {
      payments.push({ method: 'CREDIT_NOTE' as const, amount: total });
    }

    try {
      await apiFetch('/orders/checkout', {
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

      shiftStore.recordSale({
        id: Date.now().toString(),
        shiftId: shiftStore.currentShift?.id || 'shift_default',
        orderNumber: `ORD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*1000)}`,
        customerId: cart.customerId,
        customerName: cart.customerName,
        items: cart.items.map(i => ({
          productId: i.productId,
          name: i.name,
          sku: i.sku,
          quantity: i.quantity,
          unitName: i.unitName,
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
        vatAmount: cart.getVatAmount(),
        totalAmount: total,
        payments: payments as any,
        cashReceived: recordedCashReceived,
        changeAmount: recordedChangeAmount,
        status: 'COMPLETED',
        userId: shiftStore.currentShift?.userId || 'unknown',
        userName: shiftStore.currentShift?.userName || 'unknown',
        createdAt: new Date().toISOString()
      });

      setStep('SUCCESS');
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
    if (numpadTarget === 'SPLIT_CASH') setCashReceived(val);
    if (numpadTarget === 'SPLIT_QR') setQrReceived(val);
    setNumpadTarget('NONE');
  };

  const getNumpadInitialValue = () => {
    if (numpadTarget === 'CASH') return cashReceived;
    if (numpadTarget === 'SPLIT_CASH') return cashReceived;
    if (numpadTarget === 'SPLIT_QR') return qrReceived;
    return 0;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-[94vw] max-w-5xl max-h-[92vh] h-auto flex flex-col p-6 sm:p-8 overflow-y-auto bg-white border-slate-200 text-slate-900 shadow-2xl rounded-2xl">
          <DialogHeader className="shrink-0 pb-2 border-b border-slate-100 mb-4">
            <DialogTitle className="text-2xl font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-7 h-7 text-sky-500" />
                {step === 'METHOD' && 'เลือกช่องทางการชำระเงิน'}
                {step === 'PROCESS' && method === 'CASH' && 'รับชำระด้วยเงินสด (Cash)'}
                {step === 'PROCESS' && method === 'QR' && 'รับชำระผ่าน QR PromptPay / โอนเงิน'}
                {step === 'PROCESS' && method === 'SPLIT' && 'รับชำระแบบแบ่งจ่าย (Split Payment)'}
                {step === 'PROCESS' && method === 'CREDIT' && 'บันทึกเป็นเงินเชื่อ (ค้างชำระ)'}
                {step === 'SUCCESS' && 'ทำรายการชำระเงินสำเร็จ!'}
              </div>
              <a 
                href="/accounts" 
                target="_blank"
                className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1 bg-sky-50 px-3 py-1.5 rounded-lg border border-sky-200"
                title="จัดการรูป QR Code และ บัญชีธนาคาร"
              >
                <Building2 className="w-3.5 h-3.5" /> ตั้งค่าบัญชีการเงิน / QR Code <ExternalLink className="w-3 h-3 ml-0.5" />
              </a>
            </DialogTitle>
          </DialogHeader>

          {/* STEP 1: METHOD SELECTION */}
          {step === 'METHOD' && (
            <div className="py-4 space-y-6">
              <div className="text-center bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-inner">
                <p className="text-slate-500 text-sm font-bold uppercase tracking-wider mb-1">ยอดรวมสุทธิที่ต้องชำระ</p>
                <div className="text-5xl font-extrabold text-sky-600">{formatCurrency(total)}</div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Button 
                  variant="outline" 
                  className="h-28 flex flex-col gap-2 border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 hover:text-sky-700 transition-all rounded-2xl shadow-sm group"
                  onClick={() => handleSelectMethod('CASH')}
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Banknote className="w-7 h-7" />
                  </div>
                  <span className="text-xl font-bold">เงินสด (Cash)</span>
                </Button>

                <Button 
                  variant="outline" 
                  className="h-28 flex flex-col gap-2 border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 hover:text-sky-700 transition-all rounded-2xl shadow-sm group"
                  onClick={() => handleSelectMethod('QR')}
                >
                  <div className="w-12 h-12 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <QrCode className="w-7 h-7" />
                  </div>
                  <span className="text-xl font-bold">QR PromptPay / โอนเงิน</span>
                </Button>

                <Button 
                  variant="outline" 
                  className="h-28 flex flex-col gap-2 border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 hover:text-sky-700 transition-all rounded-2xl shadow-sm group"
                  onClick={() => handleSelectMethod('SPLIT')}
                >
                  <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <SplitSquareHorizontal className="w-7 h-7" />
                  </div>
                  <span className="text-xl font-bold">แบ่งชำระ (เงินสด + โอน)</span>
                </Button>

                {cart.customerId ? (
                  <Button 
                    variant="outline" 
                    className="h-28 flex flex-col gap-2 border-2 border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-500 hover:text-sky-700 transition-all rounded-2xl shadow-sm group"
                    onClick={() => handleSelectMethod('CREDIT')}
                  >
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <UserCheck className="w-7 h-7" />
                    </div>
                    <span className="text-xl font-bold">เงินเชื่อ ({cart.customerName})</span>
                  </Button>
                ) : (
                  <Button 
                    variant="outline" 
                    className="h-28 flex flex-col gap-2 border-2 border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed rounded-2xl"
                    title="ต้องเลือกลูกค้าก่อนถึงจะใช้งานได้"
                  >
                    <UserCheck className="w-8 h-8 text-slate-400" />
                    <span className="text-lg font-semibold text-slate-400">เงินเชื่อ (ต้องเลือกลูกค้า)</span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (CASH) */}
          {step === 'PROCESS' && method === 'CASH' && (
            <div className="py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left side: Received Cash & Calculator */}
                <div className="border-b border-slate-200 pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6 space-y-5">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <p className="text-xs text-slate-500 font-semibold mb-1">ยอดที่ต้องชำระ</p>
                    <div className="text-3xl font-bold text-slate-900">{formatCurrency(total)}</div>
                  </div>
                  
                  <div className="p-4 bg-sky-50 border-2 border-sky-300 rounded-2xl relative group">
                    <p className="text-xs text-sky-700 font-bold mb-1">รับเงินสดมา (กดช่องนี้เพื่อเปิด Numpad)</p>
                    <div 
                      className="text-4xl font-extrabold text-sky-600 cursor-pointer py-1"
                      onClick={() => setNumpadTarget('CASH')}
                    >
                      {formatCurrency(cashReceived)}
                    </div>
                    <Button 
                      size="icon" 
                      variant="outline" 
                      className="absolute top-3 right-3 h-9 w-9 border-sky-300 bg-white text-sky-600 hover:bg-sky-100"
                      onClick={() => setNumpadTarget('CASH')}
                      title="กดเพื่อเปิด Numpad"
                    >
                      <Edit3 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-slate-600">เงินทอน</span>
                      <span className={`font-bold text-3xl ${change > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {formatCurrency(change)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right side: Fast Banknotes */}
                <div>
                  <p className="text-xs font-bold text-slate-600 mb-3">กดธนบัตรเพื่อนับเงิน (กดซ้ำเพื่อบวกยอดเพิ่ม)</p>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <Button variant="outline" className="h-16 text-xl font-bold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-colors" onClick={() => addCash(20)}>
                      ฿20
                    </Button>
                    <Button variant="outline" className="h-16 text-xl font-bold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-colors" onClick={() => addCash(50)}>
                      ฿50
                    </Button>
                    <Button variant="outline" className="h-16 text-xl font-bold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-colors" onClick={() => addCash(100)}>
                      ฿100
                    </Button>
                    <Button variant="outline" className="h-16 text-xl font-bold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-colors" onClick={() => addCash(500)}>
                      ฿500
                    </Button>
                    <Button variant="outline" className="h-16 text-xl font-bold border-slate-300 bg-slate-50 hover:bg-sky-500 hover:text-white transition-colors" onClick={() => addCash(1000)}>
                      ฿1,000
                    </Button>
                    <Button variant="outline" className="h-16 text-xl font-bold border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-500 hover:text-white transition-colors" onClick={exactCash}>
                      พอดี (฿{total.toFixed(0)})
                    </Button>
                  </div>
                  <Button variant="ghost" className="w-full text-slate-500 hover:text-red-600" onClick={() => setCashReceived(0)}>
                    ล้างยอดเงินสด
                  </Button>
                </div>
              </div>

              <div className="flex gap-4 mt-8 pt-4 border-t border-slate-200">
                <Button variant="outline" className="flex-1 h-12 border-slate-300" onClick={() => setStep('METHOD')}>
                  ย้อนกลับ
                </Button>
                <Button 
                  className="flex-1 h-12 bg-sky-500 hover:bg-sky-600 text-white font-bold text-lg shadow-md" 
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
            <div className="py-2 space-y-6">
              {/* Account selection tabs if multiple exist */}
              <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2 border-b border-slate-200 no-scrollbar">
                <div className="flex gap-2">
                  {bankAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => setSelectedBank(acc)}
                      className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border flex items-center gap-2 ${
                        selectedBank?.id === acc.id
                          ? "bg-sky-500 text-white border-sky-500 shadow-md"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      <Building2 className="w-4 h-4" />
                      {acc.bankName}
                    </button>
                  ))}
                </div>
                <a
                  href="/accounts"
                  target="_blank"
                  className="text-xs text-sky-600 hover:underline shrink-0 font-semibold flex items-center gap-1"
                >
                  + เพิ่มบัญชี/QR <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                {/* Left: QR Code & Account Details */}
                <div className="flex flex-col items-center text-center p-6 bg-slate-50 border border-slate-200 rounded-2xl shadow-inner">
                  <Badge className="mb-3 bg-sky-100 text-sky-800 border-sky-200 text-xs px-3 py-1 font-bold">
                    {selectedBank?.bankName || 'QR PromptPay'}
                  </Badge>

                  {/* Large QR Image */}
                  <div className="w-64 h-64 border-2 border-slate-200 rounded-2xl overflow-hidden bg-white p-3 shadow-md flex items-center justify-center mb-4">
                    {selectedBank?.qrImageUrl ? (
                      <img src={selectedBank.qrImageUrl} alt="QR PromptPay" className="w-full h-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-400 gap-2">
                        <QrCode className="w-28 h-28 text-slate-300" />
                        <span className="text-xs text-slate-500 font-medium">ไม่มีรูปภาพ QR Code</span>
                        <a href="/accounts" target="_blank" className="text-xs text-sky-600 underline">อัปโหลดรูป QR Code ได้ที่นี่</a>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">ชื่อบัญชี: <b className="text-slate-900 text-sm">{selectedBank?.accountName || 'ร้านปุริม'}</b></p>
                    <p className="text-xs text-slate-500">เลขที่บัญชี / พร้อมเพย์: <b className="font-mono text-slate-900 text-lg font-bold">{selectedBank?.accountNumber || '081-234-5678'}</b></p>
                  </div>
                </div>

                {/* Right: Payment Details & Confirmation */}
                <div className="flex flex-col justify-between h-full p-6 bg-white border border-slate-200 rounded-2xl space-y-6">
                  <div>
                    <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block mb-1">ยอดรวมสุทธิที่ต้องสแกนโอน</span>
                    <div className="text-5xl font-extrabold text-sky-600">{formatCurrency(total)}</div>
                  </div>

                  <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800 space-y-1.5">
                    <p className="font-bold text-sm flex items-center gap-1.5 text-sky-900">
                      <CheckCircle2 className="w-4 h-4 text-sky-600" /> คำแนะนำการรับชำระ:
                    </p>
                    <p>• ให้ลูกค้าสแกน QR Code และตรวจสอบชื่อบัญชีผู้รับเงิน</p>
                    <p>• ตรวจสอบสลิปการโอนเงินจากมือถือของลูกค้าก่อนกดปุ่มยืนยัน</p>
                  </div>

                  <div className="flex flex-col gap-3 pt-2">
                    <Button 
                      className="h-14 bg-sky-500 hover:bg-sky-600 text-white font-bold text-lg shadow-lg"
                      onClick={handleConfirmPayment}
                    >
                      <CheckCircle2 className="w-6 h-6 mr-2" /> ลูกค้าชำระเงินเรียบร้อยแล้ว
                    </Button>
                    <Button variant="outline" className="h-10 border-slate-300 text-slate-600" onClick={() => setStep('METHOD')}>
                      ย้อนกลับ
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (SPLIT) */}
          {step === 'PROCESS' && method === 'SPLIT' && (
            <div className="py-4 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <p className="text-xs text-slate-500 font-semibold mb-1">ยอดที่ต้องชำระทั้งหมด</p>
                    <div className="text-3xl font-bold text-slate-900">{formatCurrency(total)}</div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">1. ยอดโอนเงิน (QR PromptPay)</label>
                      <div className="flex gap-2">
                        <Input 
                          type="number"
                          placeholder="0.00"
                          className="bg-white border-slate-300 h-11 text-lg font-bold text-sky-600"
                          value={qrReceived || ''}
                          onChange={(e) => setQrReceived(parseFloat(e.target.value) || 0)}
                          onClick={() => setNumpadTarget('SPLIT_QR')}
                        />
                        <Button 
                          variant="outline" 
                          className="h-11 px-3 border-slate-300 bg-slate-50 hover:bg-sky-50 hover:text-sky-600"
                          onClick={() => setNumpadTarget('SPLIT_QR')}
                        >
                          <Edit3 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">2. ยอดเงินสดที่รับมา</label>
                      <div className="flex gap-2">
                        <Input 
                          type="number"
                          placeholder="0.00"
                          className="bg-white border-slate-300 h-11 text-lg font-bold text-emerald-600"
                          value={cashReceived || ''}
                          onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
                          onClick={() => setNumpadTarget('SPLIT_CASH')}
                        />
                        <Button 
                          variant="outline" 
                          className="h-11 px-3 border-slate-300 bg-slate-50 hover:bg-sky-50 hover:text-sky-600"
                          onClick={() => setNumpadTarget('SPLIT_CASH')}
                        >
                          <Edit3 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 flex flex-col justify-between">
                  <div className="space-y-3">
                    <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">สรุปการรับชำระแบบผสม</h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">ยอดรวมรับแล้ว:</span>
                      <span className="font-bold text-slate-900 text-lg">{formatCurrency(splitTotalReceived)}</span>
                    </div>
                    {splitRemaining > 0 && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-bold">
                        ยังขาดอีก: {formatCurrency(splitRemaining)}
                      </div>
                    )}
                    {splitChange > 0 && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-bold">
                        เงินทอน (จากเงินสด): {formatCurrency(splitChange)}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" className="flex-1 h-12 border-slate-300" onClick={() => setStep('METHOD')}>
                      ย้อนกลับ
                    </Button>
                    <Button 
                      className="flex-1 h-12 bg-sky-500 hover:bg-sky-600 text-white font-bold text-base" 
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
            <div className="py-8 text-center space-y-6">
              <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <UserCheck className="w-10 h-10" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">บันทึกเป็นเงินเชื่อ (ค้างชำระ)</h2>
                <p className="text-slate-500 text-sm mt-1">
                  ลูกหนี้: <b className="text-slate-900">{cart.customerName}</b> · ยอดหนี้: <b className="text-sky-600">{formatCurrency(total)}</b>
                </p>
              </div>

              <div className="flex gap-4 justify-center pt-4">
                <Button variant="outline" className="w-32 h-12 border-slate-300" onClick={() => setStep('METHOD')}>
                  ย้อนกลับ
                </Button>
                <Button className="w-48 h-12 bg-sky-500 hover:bg-sky-600 text-white font-bold text-base" onClick={handleConfirmPayment}>
                  ยืนยันบันทึกหนี้
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: SUCCESS */}
          {step === 'SUCCESS' && (
            <div className="py-10 text-center space-y-6">
              <div className="w-24 h-24 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <div>
                <h2 className="text-3xl font-bold text-slate-900">ชำระเงินสำเร็จ!</h2>
                <p className="text-slate-500 text-sm mt-1">รับชำระเงินและบันทึกออเดอร์เข้าในระบบเรียบร้อยแล้ว</p>
              </div>

              {method === 'CASH' && change > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 inline-block mx-auto min-w-64">
                  <span className="text-emerald-700 text-sm block font-semibold">เงินทอนลูกค้า</span>
                  <span className="text-4xl font-bold text-emerald-600">{formatCurrency(change)}</span>
                </div>
              )}

              {method === 'SPLIT' && splitChange > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 inline-block mx-auto min-w-64">
                  <span className="text-emerald-700 text-sm block font-semibold">เงินทอนลูกค้า (จากเงินสด)</span>
                  <span className="text-4xl font-bold text-emerald-600">{formatCurrency(splitChange)}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                <Button variant="outline" className="h-12 px-8 border-slate-300 text-slate-700 font-semibold" onClick={handleFinish}>
                  ปิดหน้าต่าง (ออเดอร์ใหม่)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Numpad Popup */}
      <NumpadPopup 
        open={numpadTarget !== 'NONE'}
        onOpenChange={(isOpen) => !isOpen && setNumpadTarget('NONE')}
        onConfirm={handleNumpadConfirm}
        title={numpadTarget === 'SPLIT_QR' ? 'ระบุยอดโอนเงิน' : 'ระบุจำนวนเงินสดที่รับ'}
        initialValue={getNumpadInitialValue()}
      />
    </>
  );
}
