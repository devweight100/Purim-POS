'use client';

import { forwardRef, useEffect, useState } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { storeSettings } from '@/lib/mock-data';
import { formatCurrency, formatDate } from '@/lib/utils';
import html2canvas from 'html2canvas';

export const PaymentCard = forwardRef<HTMLDivElement, {}>((props, ref) => {
  const cart = useCartStore();
  const [orderNumber, setOrderNumber] = useState('');
  
  useEffect(() => {
    setOrderNumber(`ORD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*1000)}`);
  }, []);

  // Listen for download event
  useEffect(() => {
    const handleDownload = async () => {
      const element = document.getElementById('payment-card-capture');
      if (element) {
        const canvas = await html2canvas(element, { scale: 2 });
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `${orderNumber}.png`;
        link.href = dataUrl;
        link.click();
      }
    };
    window.addEventListener('download-payment-card', handleDownload);
    return () => window.removeEventListener('download-payment-card', handleDownload);
  }, [orderNumber]);

  return (
    <div
      id="payment-card-capture"
      ref={ref}
      className="w-[400px] bg-white text-slate-900 p-8 rounded-xl shadow-sm mx-auto"
      style={{ fontFamily: "'Sarabun', sans-serif" }}
    >
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">{storeSettings.storeName}</h2>
        <p className="text-sm text-slate-600">{storeSettings.storeAddress}</p>
        <p className="text-sm text-slate-600">โทร: {storeSettings.storePhone}</p>
        {storeSettings.taxId && (
          <p className="text-sm text-slate-600">เลขประจำตัวผู้เสียภาษี: {storeSettings.taxId}</p>
        )}
      </div>

      <div className="border-b-2 border-dashed border-slate-300 pb-4 mb-4">
        <h3 className="text-lg font-semibold text-center mb-2">ใบเรียกเก็บเงิน</h3>
        <div className="flex justify-between text-sm">
          <span>เลขที่:</span>
          <span className="font-medium">{orderNumber}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span>วันที่:</span>
          <span>{formatDate(new Date())}</span>
        </div>
        {cart.customerName && (
          <div className="flex justify-between text-sm mt-1">
            <span>ลูกค้า:</span>
            <span>{cart.customerName}</span>
          </div>
        )}
      </div>

      <div className="mb-6">
        <div className="flex justify-between font-semibold mb-2 border-b border-slate-200 pb-1">
          <span>รายการ</span>
          <span>จำนวนเงิน</span>
        </div>
        <div className="space-y-2">
          {cart.items.map((item, i) => {
            const lineTotal = cart.getItemLineTotal(item);
            return (
              <div key={i} className="flex justify-between text-sm">
                <span className="flex-1">
                  {i + 1}. {item.name} <br/>
                  <span className="text-slate-500 ml-3">{item.quantity} {item.unitName} @ {formatCurrency(cart.getEffectivePrice(item))}</span>
                </span>
                <span className="w-24 text-right">
                  {formatCurrency(lineTotal)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t-2 border-dashed border-slate-300 pt-4 mb-6 space-y-1">
        <div className="flex justify-between items-center text-sm">
          <span>ยอดรวม</span>
          <span>{formatCurrency(cart.getSubtotal())}</span>
        </div>
        {cart.getBillDiscountAmount() > 0 && (
          <div className="flex justify-between items-center text-sm text-red-600">
            <span>ส่วนลด</span>
            <span>-{formatCurrency(cart.getBillDiscountAmount())}</span>
          </div>
        )}
        <div className="flex justify-between items-center text-sm text-slate-600">
          <span>ราคารวมภาษีมูลค่าเพิ่ม (VAT 7%)</span>
          <span>{formatCurrency(cart.getVatAmount())}</span>
        </div>
        <div className="flex justify-between items-center font-bold text-lg pt-2 border-t border-slate-200 mt-2">
          <span>ยอดสุทธิ</span>
          <span>{formatCurrency(cart.getTotal())}</span>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-4 text-center bg-slate-50">
        {storeSettings.qrImageUrl ? (
          <img
            src={storeSettings.qrImageUrl}
            alt="QR Code"
            className="w-48 h-48 mx-auto mb-3 object-contain"
          />
        ) : (
          <div className="w-48 h-48 mx-auto mb-3 bg-slate-200 flex items-center justify-center rounded-lg">
            <span className="text-slate-500 font-medium">ไม่มีรูป QR Code</span>
          </div>
        )}
        <p className="font-medium text-lg">{storeSettings.qrLabel || "PromptPay"}</p>
        <p className="text-sm font-bold mt-2">ยอดโอน: {formatCurrency(cart.getTotal())}</p>
      </div>

      <div className="text-center mt-6 text-sm text-slate-600">
        <p>กรุณาโอนเงินและส่งสลิป</p>
        <p className="mt-1 whitespace-pre-line">{storeSettings.receiptFooter}</p>
      </div>
    </div>
  );
});
PaymentCard.displayName = "PaymentCard";
