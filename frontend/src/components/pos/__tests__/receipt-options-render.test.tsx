import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThermalReceiptView, SAMPLE_RECEIPT_DATA, type ReceiptData } from '../ThermalReceiptView';
import { ReceiptA4Document, type ReceiptA4Data } from '../ReceiptA4PdfModal';
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from '@/lib/store-settings-storage';
import { getReceiptOptions, normalizeReceiptOptions } from '@/lib/receipt-options';

const SHOP: StoreSettings = {
  ...DEFAULT_STORE_SETTINGS,
  storeName: 'ร้านทดสอบวัสดุ',
  branchName: 'สาขาบางนา',
  storeAddress: '99/1 ถนนบางนา-ตราด กรุงเทพฯ 10260',
  storePhone: '02-111-2222',
  storeEmail: 'shop@example.com',
  taxId: '0105551234567',
  receiptHeader: 'ยินดีต้อนรับ',
  receiptFooter: 'ขอบคุณครับ',
  vatEnabled: false,
  vatRate: 7,
};

const SLIP: ReceiptData = { ...SAMPLE_RECEIPT_DATA, createdAt: '2026-11-13T03:00:00.000Z', note: 'ส่งของบ่ายนี้' };

const A4: ReceiptA4Data = {
  orderNumber: 'ORD-20261113-0001',
  createdAt: '2026-11-13T03:00:00.000Z',
  customerName: 'บริษัท ลูกค้า จำกัด',
  customerAddress: '1 ถนนสุขุมวิท',
  customerTaxId: '0105559999999',
  customerPhone: '081-000-0000',
  userName: 'แคชเชียร์ 1',
  items: [{ name: 'ปูนซีเมนต์', quantity: 2, unitName: 'ถุง', unitPrice: 150, lineTotal: 300 }],
  subtotal: 300,
  billDiscountAmount: 0,
  vatAmount: 19.63,
  totalAmount: 300,
  paymentMethod: 'เงินสด',
  payments: [{ method: 'CASH', amount: 300 }],
  cashReceived: 500,
  changeAmount: 200,
};

/** visible text only (attributes and class names may contain "tax"-like words) */
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
const slipText = (s: StoreSettings, d: ReceiptData = SLIP) => text(renderToStaticMarkup(<ThermalReceiptView data={d} settings={s} />));
const a4Text = (s: StoreSettings, d: ReceiptA4Data = A4) => text(renderToStaticMarkup(<ReceiptA4Document data={d} settings={s} />));
const TAX_WORDS = /ภาษี|VAT|TAX|อย่างย่อ/i;

describe('getReceiptOptions', () => {
  it('defaults: short slip, full A4', () => {
    const o = getReceiptOptions({ vatEnabled: false });
    expect(o.slip).toMatchObject({
      showLogo: false, showBranch: true, showAddress: false, showPhone: true, showEmail: false,
      showHeaderText: true, showFooterText: true, showCashier: true, showCustomer: true, showNote: true, showPoints: true,
    });
    expect(Object.entries(o.a4).filter(([k]) => k !== 'showTaxId').every(([, v]) => v === true)).toBe(true);
  });

  it('merges a partial stored value and ignores junk', () => {
    const o = getReceiptOptions({
      vatEnabled: false,
      receiptOptions: normalizeReceiptOptions({ slip: { showAddress: true, showPhone: 'no', bogus: true }, a4: null }),
    });
    expect(o.slip.showAddress).toBe(true);
    expect(o.slip.showPhone).toBe(true);
    expect('bogus' in o.slip).toBe(false);
    expect(o.a4.showSignatures).toBe(true);
  });

  it('seller tax id is shown exactly when the shop has VAT', () => {
    const off = normalizeReceiptOptions({ slip: { showTaxId: false }, a4: { showTaxId: false } });
    expect(getReceiptOptions({ vatEnabled: true, receiptOptions: off }).slip.showTaxId).toBe(true);
    expect(getReceiptOptions({ vatEnabled: true, receiptOptions: off }).a4.showTaxId).toBe(true);
    const on = normalizeReceiptOptions({ slip: { showTaxId: true } });
    expect(getReceiptOptions({ vatEnabled: false, receiptOptions: on }).slip.showTaxId).toBe(false);
  });
});

describe('80 mm slip', () => {
  it('VAT off: no tax wording at all, amounts unchanged', () => {
    const t = slipText(SHOP);
    expect(t).not.toMatch(TAX_WORDS);
    expect(t).not.toContain(SHOP.taxId);
    expect(t).toContain('ใบเสร็จรับเงิน');
    expect(t).toContain('105.00');
  });

  it('VAT on: abbreviated tax invoice with seller tax id and VAT lines', () => {
    const t = slipText({ ...SHOP, vatEnabled: true });
    expect(t).toContain('ใบกำกับภาษีอย่างย่อ');
    expect(t).toContain(SHOP.taxId);
    expect(t).toContain('ภาษีมูลค่าเพิ่ม 7%');
  });

  it('default options: no address / e-mail; name, branch, phone, header, footer, cashier, note shown', () => {
    const t = slipText(SHOP);
    expect(t).not.toContain(SHOP.storeAddress);
    expect(t).not.toContain(SHOP.storeEmail);
    for (const s of [SHOP.storeName, SHOP.branchName, SHOP.storePhone, 'ยินดีต้อนรับ', 'ขอบคุณครับ', 'ส่งของบ่ายนี้', 'พนักงาน', 'เงินทอน', 'แต้มคงเหลือ']) {
      expect(t).toContain(s);
    }
  });

  it('custom options are applied (store name always stays)', () => {
    const allOff = normalizeReceiptOptions({
      slip: Object.fromEntries(Object.keys(normalizeReceiptOptions(null).slip).map((k) => [k, false])),
    });
    const t = slipText({ ...SHOP, receiptOptions: allOff });
    expect(t).toContain(SHOP.storeName);
    for (const s of [SHOP.branchName, SHOP.storePhone, 'ยินดีต้อนรับ', 'ขอบคุณครับ', 'ส่งของบ่ายนี้', 'พนักงาน', 'เงินทอน', 'แต้มคงเหลือ', SAMPLE_RECEIPT_DATA.customerName as string]) {
      expect(t).not.toContain(s);
    }
    const withAddress = slipText({ ...SHOP, receiptOptions: normalizeReceiptOptions({ slip: { showAddress: true, showEmail: true } }) });
    expect(withAddress).toContain(SHOP.storeAddress);
    expect(withAddress).toContain(SHOP.storeEmail);
  });
});

describe('A4 receipt', () => {
  it('VAT off: plain receipt, no seller / buyer tax id, no VAT lines', () => {
    const t = a4Text(SHOP);
    expect(t).not.toMatch(TAX_WORDS);
    expect(t).not.toContain(SHOP.taxId);
    expect(t).not.toContain(A4.customerTaxId);
    expect(t).toContain('ใบเสร็จรับเงิน');
    expect(t).toContain('300.00');
  });

  it('VAT on: full tax invoice with both tax ids and the VAT breakdown', () => {
    const t = a4Text({ ...SHOP, vatEnabled: true });
    expect(t).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    expect(t).toContain('TAX INVOICE');
    expect(t).toContain(SHOP.taxId);
    expect(t).toContain(A4.customerTaxId);
    expect(t).toContain('ภาษีมูลค่าเพิ่ม 7%');
  });

  it('defaults show everything; options hide blocks', () => {
    const t = a4Text(SHOP);
    for (const s of [SHOP.storeAddress, SHOP.storeEmail, SHOP.storePhone, 'จำนวนเงินตัวอักษร', 'ผู้รับเงิน', 'เงินทอน', A4.customerAddress as string]) {
      expect(t).toContain(s);
    }
    const off = normalizeReceiptOptions({
      a4: { showAddress: false, showEmail: false, showAmountInWords: false, showSignatures: false, showPaymentDetails: false, showCustomerDetails: false },
    });
    const t2 = a4Text({ ...SHOP, receiptOptions: off });
    for (const s of [SHOP.storeAddress, SHOP.storeEmail, 'จำนวนเงินตัวอักษร', 'ผู้มีอำนาจลงนาม', 'เงินทอน', A4.customerAddress as string]) {
      expect(t2).not.toContain(s);
    }
    expect(t2).toContain(SHOP.storeName);
  });
});
