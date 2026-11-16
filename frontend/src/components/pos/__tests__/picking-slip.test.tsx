import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PickingSlipView } from '../PickingSlipView';
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from '@/lib/store-settings-storage';
import { bundleParts, cartToPickingSlip, onlineToPickingSlip, orderToPickingSlip, type PickingSlipData } from '@/lib/picking-slip';
import type { CartItem } from '@/lib/types';

const SHOP: StoreSettings = { ...DEFAULT_STORE_SETTINGS, storeName: 'ร้านวัสดุทดสอบ', vatEnabled: true, vatRate: 7, taxId: '0105551234567', receiptFooter: 'ขอบคุณครับ' };

/** visible text of the slip markup */
const textOf = (data: PickingSlipData) =>
  renderToStaticMarkup(<PickingSlipView data={data} settings={SHOP} />)
    .replace(/<[^>]+>/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const cartItem = (over: Partial<CartItem>): CartItem => ({
  productId: 'p1', name: 'ปูนซีเมนต์ตราช้าง 50 กก.', sku: 'CEM-01', originalPrice: 165.5, customPrice: null, quantity: 3,
  unitId: 'u-p1-base', unitName: 'ถุง', conversionFactor: 1, discountType: 'none', discountValue: 0, hasVat: true, ...over,
});

/** anything that looks like money / tax on the paper */
const MONEY = /฿|บาท|ราคา|รวมเงิน|ยอด|ภาษี|VAT|ส่วนลด|\d+\.\d{2}\b|165|2,?400|80\b/;

describe('picking slip (ใบจัดของ)', () => {
  it('cart: names, units, quantities, customer, note, counts; no prices / totals / VAT; ค่าส่ง left out', () => {
    const data = cartToPickingSlip(
      {
        items: [
          cartItem({}),
          cartItem({ productId: 'p2', name: 'ท่อ PVC ฟ้า 4 หุน ชั้น 8.5 ยาว 4 เมตร (ตราช้าง) สำหรับงานประปาภายในอาคาร', sku: 'PVC-4', quantity: 12, unitName: 'เส้น', originalPrice: 2400, itemNote: 'ตัดครึ่ง' }),
          cartItem({ productId: 'fee', name: 'ค่าส่ง', sku: 'SYS-DELIVERY-FEE', quantity: 1, unitName: 'ครั้ง', originalPrice: 80 }),
        ],
        customerName: 'คุณสมชาย ใจดี',
        note: 'ลูกค้ารอหน้าร้าน',
      },
      { source: 'cart', createdAt: '2026-11-16T03:05:00.000Z' },
    );
    expect(data.lines.map((l) => l.name)).not.toContain('ค่าส่ง');
    const lines = textOf(data);
    expect(lines).toContain('ใบจัดของ');
    expect(lines).toContain('ร้านวัสดุทดสอบ');
    expect(lines).toContain('คุณสมชาย ใจดี');
    expect(lines).toContain('16/11/2569 10:05'); // Buddhist year, Bangkok time
    expect(lines).toContain('หมายเหตุ: ลูกค้ารอหน้าร้าน');
    expect(lines).toContain('ปูนซีเมนต์ตราช้าง 50 กก.');
    expect(lines).toContain('3 ถุง');
    expect(lines).toContain('12 เส้น');
    expect(lines).toContain('หมายเหตุ: ตัดครึ่ง');
    expect(lines).toContain('รวม 2 รายการ');
    expect(lines).toContain('ผู้จัด');
    expect(lines).toContain('ผู้ตรวจ');
    expect(lines.join(' ')).not.toMatch(MONEY);
    expect(lines.join(' ')).not.toContain('ค่าส่ง');
    expect(lines.join(' ')).not.toContain('0105551234567'); // no tax id
    expect(lines.join(' ')).not.toContain('พิมพ์ซ้ำ');
    // one tick box per line
    expect(renderToStaticMarkup(<PickingSlipView data={data} settings={SHOP} />).match(/data-tick=""/g)).toHaveLength(2);
  });

  it('bundle lines list their parts (quantity x bundles x unit factor), each with a tick box', () => {
    const data = cartToPickingSlip(
      {
        items: [
          cartItem({
            productId: 'b1', name: 'ชุดก๊อกน้ำ', sku: 'SET-1', quantity: 2, unitName: 'ชุด', isBundle: true,
            bundleData: [
              { productId: 'c1', productName: 'ก๊อกน้ำ', sku: 'C1', quantityPerBundle: 1, totalQuantity: 2, unitPrice: 0 },
              { productId: 'c2', productName: 'เทปพันเกลียว', sku: 'C2', quantityPerBundle: 3, totalQuantity: 6, unitPrice: 0 },
            ],
          }),
        ],
      },
      { source: 'held', docNo: 'บิลพัก #3', unitOf: (id) => (id === 'c2' ? 'ม้วน' : undefined) },
    );
    expect(data.lines[0].parts).toEqual([
      { name: 'ก๊อกน้ำ', unitName: 'ชิ้น', quantity: 2 },
      { name: 'เทปพันเกลียว', unitName: 'ม้วน', quantity: 6 },
    ]);
    const lines = textOf(data);
    expect(lines).toEqual(expect.arrayContaining(['บิลพัก', 'บิลพัก #3', 'ชุดก๊อกน้ำ', '2 ชุด', 'ก๊อกน้ำ', '2 ชิ้น', 'เทปพันเกลียว', '6 ม้วน', 'รวม 1 รายการ']));
    expect(renderToStaticMarkup(<PickingSlipView data={data} settings={SHOP} />).match(/data-tick=""/g)).toHaveLength(3);
    // receipt shape { bundleItems: [{ quantity per bundle }] }
    expect(bundleParts({ bundleItems: [{ productName: 'น็อต', quantity: 4, unitName: 'ตัว' }] }, 3)).toEqual([{ name: 'น็อต', unitName: 'ตัว', quantity: 12 }]);
  });

  it('completed bill: reprint marker, bill no., service product left out, no money', () => {
    const data = orderToPickingSlip(
      {
        orderNumber: 'ORD-261100042',
        createdAt: '2026-11-15T12:30:00.000Z',
        customer: { id: 'c', name: 'ร้านช่างเอก' },
        subtotal: 2480,
        totalAmount: 2480,
        vatAmount: 162.24,
        items: [
          { product: { name: 'สีน้ำอะครีลิค ขาว', sku: 'PAINT-W' }, unitName: 'แกลลอน', quantity: 2, unitPrice: 1200, total: 2400 },
          { product: { name: 'ค่าส่ง', sku: 'SYS-DELIVERY-FEE' }, unitName: 'ครั้ง', quantity: 1, unitPrice: 80, total: 80 },
        ],
      },
      { isReprint: true, reprintedAt: '2026-11-16T01:00:00.000Z' },
    );
    const lines = textOf(data);
    expect(lines).toEqual(expect.arrayContaining(['บิลขาย', 'ORD-261100042', 'ร้านช่างเอก', 'สีน้ำอะครีลิค ขาว', '2 แกลลอน', 'รวม 1 รายการ']));
    expect(lines).toContain('*** พิมพ์ซ้ำ 16/11/2569 08:00 ***');
    expect(lines.join(' ')).not.toMatch(MONEY);
  });

  it('online order: delivery shows ส่ง + phone + address; pickup shows รับเองที่ร้าน without address', () => {
    const base = { orderNo: 'WEB-261116-007', createdAt: '2026-11-16T02:00:00.000Z', customerName: 'คุณมานี', phone: '0812345678', address: '12/3 หมู่ 4 ต.บางพลี', note: 'โทรก่อนส่ง', reprint: false, items: [{ name: 'ทรายหยาบ', unitName: 'คิว', quantity: 1.5, parts: [] }] };
    const delivery = textOf(onlineToPickingSlip({ ...base, fulfillment: 'DELIVERY' }));
    expect(delivery).toEqual(expect.arrayContaining(['ออเดอร์ออนไลน์', 'WEB-261116-007', 'คุณมานี', 'ส่ง (ร้านไปส่ง)', '0812345678', 'ที่อยู่: 12/3 หมู่ 4 ต.บางพลี', 'หมายเหตุ: โทรก่อนส่ง', 'ทรายหยาบ', '1.5 คิว']));
    const pickup = textOf(onlineToPickingSlip({ ...base, fulfillment: 'PICKUP', reprint: true }));
    expect(pickup).toContain('รับเองที่ร้าน');
    expect(pickup.join(' ')).not.toContain('ที่อยู่');
    expect(pickup.some((l) => l.startsWith('*** พิมพ์ซ้ำ'))).toBe(true);
    expect([...delivery, ...pickup].join(' ')).not.toMatch(/฿|บาท|ราคา|ยอด|ภาษี|VAT/);
  });
});
