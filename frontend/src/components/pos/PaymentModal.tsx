'use client';

import { useState, useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { formatCurrency } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CreditCard, QrCode, Banknote, Edit3, CheckCircle2, SplitSquareHorizontal, UserCheck } from 'lucide-react';
import { NumpadPopup } from './NumpadPopup';
import { PaymentCard } from './PaymentCard';

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
    }
  }, [open]);

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  };

  const handleSelectMethod = (m: Method) => {
    setMethod(m);
    
    // Credit is instant success (no process step) if we wanted, but let's show process for confirmation
    if (m === 'CREDIT') {
      setStep('PROCESS');
      setCashReceived(0);
      setQrReceived(0);
    } else {
      setStep('PROCESS');
      if (m === 'CASH') setCashReceived(0);
      if (m === 'SPLIT') {
        setCashReceived(0);
        setQrReceived(0);
      }
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
      payments.push({ method: 'QR_PROMPTPAY' as const, amount: total });
      recordedCashReceived = total;
    } else if (method === 'SPLIT') {
      const actualCashKept = Math.max(0, cashReceived - splitChange);
      if (actualCashKept > 0) payments.push({ method: 'CASH' as const, amount: actualCashKept });
      if (qrReceived > 0) payments.push({ method: 'QR_PROMPTPAY' as const, amount: Math.min(qrReceived, total) });
      
      recordedCashReceived = cashReceived;
      recordedChangeAmount = splitChange;
    } else if (method === 'CREDIT') {
      payments.push({ method: 'CREDIT_NOTE' as const, amount: total });
    }

    try {
      // 1. Call real backend checkout API
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

      // 2. Mock shift recording for local state (can be moved to backend later)
      shiftStore.recordSale({
        id: Date.now().toString(),
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
        shiftId: shiftStore.currentShift?.id || 'unknown',
        createdAt: new Date().toISOString()
      });

      setStep('SUCCESS');
    } catch (err: any) {
      alert(`Error during checkout: ${err.message}`);
    }
  };

  const handleFinish = () => {
    cart.clearCart();
    onOpenChange(false);
  };

  const handleNumpadConfirm = (val: number) => {
    if (numpadTarget === 'CASH') setCashReceived(val);
    else if (numpadTarget === 'SPLIT_CASH') setCashReceived(val);
    else if (numpadTarget === 'SPLIT_QR') setQrReceived(val);
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
        <DialogContent className="max-h-[92dvh] overflow-y-auto bg-white border-slate-200 text-slate-900 sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">
              {step === 'METHOD' && 'เลือกวิธีชำระเงิน'}
              {step === 'PROCESS' && method === 'CASH' && 'รับเงินสด'}
              {step === 'PROCESS' && method === 'QR' && 'QR PromptPay'}
              {step === 'PROCESS' && method === 'SPLIT' && 'แบ่งชำระ (Split Payment)'}
              {step === 'PROCESS' && method === 'CREDIT' && 'บันทึกเงินเชื่อ'}
              {step === 'SUCCESS' && 'ทำรายการสำเร็จ'}
            </DialogTitle>
          </DialogHeader>

          {/* STEP 1: METHOD SELECTION */}
          {step === 'METHOD' && (
            <div className="py-6">
              <div className="text-center mb-8">
                <p className="text-slate-500 mb-2">ยอดที่ต้องชำระ</p>
                <div className="text-5xl font-bold text-slate-900">{formatCurrency(total)}</div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <Button 
                  variant="outline" 
                  className="h-20 flex flex-col gap-2 border-slate-300 bg-slate-50 hover:bg-primary hover:text-white hover:border-primary sm:h-24"
                  onClick={() => handleSelectMethod('CASH')}
                >
                  <Banknote className="w-8 h-8 text-emerald-600" />
                  <span className="text-lg">เงินสด</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-20 flex flex-col gap-2 border-slate-300 bg-slate-50 hover:bg-primary hover:text-white hover:border-primary sm:h-24"
                  onClick={() => handleSelectMethod('QR')}
                >
                  <QrCode className="w-8 h-8 text-sky-600" />
                  <span className="text-lg">QR PromptPay</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-20 flex flex-col gap-2 border-slate-300 bg-slate-50 hover:bg-primary hover:text-white hover:border-primary sm:h-24"
                  onClick={() => handleSelectMethod('SPLIT')}
                >
                  <SplitSquareHorizontal className="w-8 h-8 text-orange-400" />
                  <span className="text-lg">แบ่งชำระ (Split)</span>
                </Button>

                {cart.customerId ? (
                  <Button 
                    variant="outline" 
                    className="h-20 flex flex-col gap-2 border-slate-300 bg-slate-50 hover:bg-primary hover:text-white hover:border-primary sm:h-24"
                    onClick={() => handleSelectMethod('CREDIT')}
                  >
                    <UserCheck className="w-8 h-8 text-indigo-400" />
                    <span className="text-lg">เงินเชื่อ (ค้างชำระ)</span>
                  </Button>
                ) : (
                  <Button 
                    variant="outline" 
                    className="h-20 flex flex-col gap-2 border-slate-300 bg-slate-50 hover:bg-primary hover:text-white opacity-50 cursor-not-allowed sm:h-24"
                    title="ต้องเลือกลูกค้าก่อนถึงจะใช้งานได้"
                  >
                    <UserCheck className="w-8 h-8 text-slate-500" />
                    <span className="text-lg text-slate-500">เงินเชื่อ (ต้องเลือกลูกค้า)</span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (CASH) */}
          {step === 'PROCESS' && method === 'CASH' && (
            <div className="py-4">
              <div className="flex flex-col gap-6 sm:flex-row">
                {/* Left side: Calculator */}
                <div className="w-full shrink-0 border-b border-slate-200 pb-5 sm:w-[300px] sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
                  <div className="mb-4">
                    <p className="text-sm text-slate-500 mb-1">ยอดที่ต้องชำระ</p>
                    <div className="text-3xl font-bold">{formatCurrency(total)}</div>
                  </div>
                  
                  <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl relative group">
                    <p className="text-sm text-slate-500 mb-1">รับเงินมา</p>
                    <div className="text-4xl font-bold text-primary">{formatCurrency(cashReceived)}</div>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="absolute top-4 right-4 h-8 w-8 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setNumpadTarget('CASH')}
                    >
                      <Edit3 className="w-5 h-5" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">เงินทอน</span>
                      <span className={`font-bold text-lg ${change > 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                        {formatCurrency(change)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right side: Banknotes */}
                <div className="flex-1">
                  <p className="text-sm text-slate-500 mb-3">กดเพื่อนับจำนวนเงินที่รับ (กดซ้ำเพื่อเพิ่ม)</p>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <Button variant="outline" className="h-14 text-xl border-slate-300 bg-slate-50 hover:bg-primary hover:text-white sm:h-16" onClick={() => addCash(20)}>
                      ฿20
                    </Button>
                    <Button variant="outline" className="h-14 text-xl border-slate-300 bg-slate-50 hover:bg-primary hover:text-white sm:h-16" onClick={() => addCash(50)}>
                      ฿50
                    </Button>
                    <Button variant="outline" className="h-14 text-xl border-slate-300 bg-slate-50 hover:bg-primary hover:text-white sm:h-16" onClick={() => addCash(100)}>
                      ฿100
                    </Button>
                    <Button variant="outline" className="h-14 text-xl border-slate-300 bg-slate-50 hover:bg-primary hover:text-white sm:h-16" onClick={() => addCash(500)}>
                      ฿500
                    </Button>
                    <Button variant="outline" className="h-14 text-xl border-slate-300 bg-slate-50 hover:bg-primary hover:text-white sm:h-16" onClick={() => addCash(1000)}>
                      ฿1,000
                    </Button>
                    <Button variant="outline" className="h-16 text-xl border-primary/20 bg-primary/10 text-primary hover:bg-primary/20" onClick={exactCash}>
                      พอดี (฿{total.toFixed(0)})
                    </Button>
                  </div>
                  <Button variant="ghost" className="w-full text-slate-500" onClick={() => setCashReceived(0)}>
                    ล้างใหม่ทั้งหมด
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-8 pt-4 border-t border-slate-200 sm:flex-row sm:gap-4">
                <Button variant="outline" className="flex-1 h-12 border-slate-300" onClick={() => setStep('METHOD')}>
                  ย้อนกลับ
                </Button>
                <Button 
                  className="flex-1 h-12 bg-primary hover:bg-primary/90 text-white font-bold text-lg" 
                  disabled={!isCashSufficient}
                  onClick={handleConfirmPayment}
                >
                  ยืนยันรับเงิน
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (QR) */}
          {step === 'PROCESS' && method === 'QR' && (
            <div className="py-4">
              <div className="flex flex-col gap-6 sm:h-[400px] sm:flex-row">
                {/* Left: Preview Card */}
                <div className="min-h-[280px] flex-1 overflow-hidden border-b border-slate-200 pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
                  <div className="h-full overflow-y-auto pr-2 no-scrollbar border border-slate-200 rounded-lg">
                    {/* Render the payment card preview inside modal */}
                    <div className="scale-[0.8] origin-top">
                      <PaymentCard />
                    </div>
                  </div>
                </div>
                {/* Right: Actions */}
                <div className="w-full shrink-0 flex flex-col sm:w-[250px]">
                  <div className="text-center mb-6">
                    <p className="text-slate-500 mb-1">ยอดที่ต้องชำระ</p>
                    <div className="text-3xl font-bold text-primary">{formatCurrency(total)}</div>
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-center gap-3">
                    <Button variant="outline" className="h-12 border-slate-300 bg-slate-50 hover:text-slate-900" onClick={() => {
                        const evt = new CustomEvent('download-payment-card');
                        window.dispatchEvent(evt);
                      }}>
                      ดาวน์โหลดรูปภาพ
                    </Button>
                    <Button variant="outline" className="h-12 border-slate-300 bg-[#00B900]/10 text-[#00B900] hover:bg-[#00B900]/20 hover:text-[#00B900] border-[#00B900]/20">
                      แชร์ทาง LINE
                    </Button>
                  </div>

                  <div className="mt-auto flex flex-col gap-3">
                    <Button 
                      className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-bold text-lg"
                      onClick={handleConfirmPayment}
                    >
                      ลูกค้าชำระเงินแล้ว
                    </Button>
                    <Button variant="ghost" className="text-slate-500" onClick={() => setStep('METHOD')}>
                      ย้อนกลับ
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (SPLIT) */}
          {step === 'PROCESS' && method === 'SPLIT' && (
            <div className="py-4">
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="w-full shrink-0 border-b border-slate-200 pb-5 sm:w-[300px] sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
                  <div className="mb-4">
                    <p className="text-sm text-slate-500 mb-1">ยอดที่ต้องชำระ</p>
                    <div className="text-3xl font-bold">{formatCurrency(total)}</div>
                  </div>
                  
                  <div className="space-y-4 mb-6">
                    <div>
                      <label className="text-sm text-slate-500">1. ยอดโอนเงิน (QR PromptPay)</label>
                      <div className="flex gap-2 mt-1">
                        <Input 
                          type="number"
                          placeholder="0.00"
                          className="bg-slate-50 border-slate-300 text-lg font-semibold"
                          value={qrReceived || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setQrReceived(val);
                          }}
                        />
                        <Button 
                          variant="outline" 
                          className="w-12 h-10 shrink-0 border-slate-300 bg-slate-50 hover:text-primary"
                          onClick={() => setNumpadTarget('SPLIT_QR')}
                        >
                          <Edit3 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm text-slate-500">2. ยอดเงินสดที่รับมา</label>
                      <div className="flex gap-2 mt-1">
                        <Input 
                          type="number"
                          placeholder="0.00"
                          className="bg-slate-50 border-slate-300 text-lg font-semibold"
                          value={cashReceived || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setCashReceived(val);
                          }}
                        />
                        <Button 
                          variant="outline" 
                          className="w-12 h-10 shrink-0 border-slate-300 bg-slate-50 hover:text-primary"
                          onClick={() => setNumpadTarget('SPLIT_CASH')}
                        >
                          <Edit3 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 relative">
                    <p className="text-sm text-slate-500 mb-1">ยอดรวมที่รับแล้ว</p>
                    <p className="text-2xl font-bold text-primary">
                      {formatCurrency(splitTotalReceived)}
                    </p>
                    {splitRemaining > 0 && (
                      <p className="text-red-600 text-sm mt-2">ยังขาดอีก: {formatCurrency(splitRemaining)}</p>
                    )}
                    {splitChange > 0 && (
                      <p className="text-emerald-600 text-sm mt-2 font-bold">ทอนเงินสด: {formatCurrency(splitChange)}</p>
                    )}
                    {splitRemaining === 0 && splitChange === 0 && splitTotalReceived > 0 && (
                      <p className="text-emerald-600 text-sm mt-2 font-bold">รับพอดี</p>
                    )}
                  </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="text-center text-slate-500 space-y-4">
                    <SplitSquareHorizontal className="w-16 h-16 mx-auto opacity-20" />
                    <p>รับชำระแบบผสม (เงินสด + โอนเงิน)</p>
                    <p className="text-sm max-w-xs mx-auto">
                      กรอกยอดโอนเงินตามสลิป และกรอกเงินสดที่รับมาจากลูกค้า <br/><br/>
                      ระบบจะคำนวณเงินทอนให้อัตโนมัติและบันทึกแยกประเภทรายได้ให้ถูกต้อง
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-8 pt-4 border-t border-slate-200 sm:flex-row sm:gap-4">
                <Button variant="outline" className="flex-1 h-12 border-slate-300" onClick={() => setStep('METHOD')}>
                  ย้อนกลับ
                </Button>
                <Button 
                  className="flex-1 h-12 bg-primary hover:bg-primary/90 text-white font-bold text-lg" 
                  disabled={!isSplitSufficient}
                  onClick={handleConfirmPayment}
                >
                  ยืนยันรับเงิน (แบ่งชำระ)
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESS (CREDIT) */}
          {step === 'PROCESS' && method === 'CREDIT' && (
            <div className="py-6 text-center">
              <div className="w-20 h-20 bg-indigo-500/10 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-6">
                <UserCheck className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">บันทึกเป็นเงินเชื่อ</h2>
              <p className="text-slate-500 mb-6">
                ลูกหนี้: <span className="font-bold text-primary">{cart.customerName}</span><br/>
                ยอดหนี้: <span className="font-bold text-primary">{formatCurrency(total)}</span>
              </p>
              
              <div className="flex flex-col gap-3 mt-8 pt-4 border-t border-slate-200 justify-center sm:flex-row sm:gap-4">
                <Button variant="outline" className="w-32 h-12 border-slate-300" onClick={() => setStep('METHOD')}>
                  ย้อนกลับ
                </Button>
                <Button 
                  className="w-48 h-12 bg-primary hover:bg-primary/90 text-white font-bold text-lg" 
                  onClick={handleConfirmPayment}
                >
                  ยืนยันบันทึกหนี้
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: SUCCESS */}
          {step === 'SUCCESS' && (
            <div className="py-12 text-center">
              <div className="w-24 h-24 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">ทำรายการสำเร็จ!</h2>
              
              {method === 'CASH' && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 inline-block mx-auto mb-8">
                  <span className="text-slate-500 mr-4">เงินทอน</span>
                  <span className="text-2xl font-bold text-emerald-600">{formatCurrency(change)}</span>
                </div>
              )}

              {method === 'SPLIT' && splitChange > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 inline-block mx-auto mb-8">
                  <span className="text-slate-500 mr-4">เงินทอน (จากเงินสด)</span>
                  <span className="text-2xl font-bold text-emerald-600">{formatCurrency(splitChange)}</span>
                </div>
              )}

              {method === 'CREDIT' && (
                <p className="text-slate-500 mb-8 mt-2">ยอดนี้ถูกบันทึกเข้าประวัติหนี้ของลูกค้าเรียบร้อยแล้ว</p>
              )}
              
              <div className="flex flex-col gap-3 justify-center mt-6 sm:flex-row sm:gap-4">
                <Button variant="outline" className="h-12 px-8 border-slate-300">
                  พิมพ์ใบเสร็จซ้ำ
                </Button>
                <Button className="h-12 px-8 bg-primary hover:bg-primary/90 text-white" onClick={handleFinish}>
                  ปิดหน้าต่าง (New Sale)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Numpad Popup for manual cash/qr entry */}
      <NumpadPopup 
        open={numpadTarget !== 'NONE'}
        onOpenChange={(isOpen) => !isOpen && setNumpadTarget('NONE')}
        onConfirm={handleNumpadConfirm}
        title={numpadTarget === 'SPLIT_QR' ? 'ระบุยอดโอนเงิน' : 'ระบุจำนวนเงินที่รับ'}
        initialValue={getNumpadInitialValue()}
      />
    </>
  );
}
