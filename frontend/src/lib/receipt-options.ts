import {
  effectiveReceiptOptions,
  type A4OptionKey,
  type A4ReceiptOptions,
  type ReceiptOptions,
  type SlipOptionKey,
  type SlipReceiptOptions,
} from '@shared/receipt-options';
import type { StoreSettings } from './store-settings-storage';

export type { A4OptionKey, A4ReceiptOptions, ReceiptOptions, SlipOptionKey, SlipReceiptOptions };
export { normalizeReceiptOptions, DEFAULT_A4_OPTIONS, DEFAULT_SLIP_OPTIONS } from '@shared/receipt-options';

/**
 * THE way every slip / A4 document reads what to show: the shop's choice (Settings > รูปแบบใบเสร็จ)
 * with the defaults filled in and the tax rule applied (seller tax id shown exactly when the shop
 * charges VAT).
 */
export function getReceiptOptions(settings: Pick<StoreSettings, 'receiptOptions' | 'vatEnabled'> | null | undefined): ReceiptOptions {
  return effectiveReceiptOptions(settings?.receiptOptions, settings?.vatEnabled === true);
}

/** The shop charges VAT: documents may say ใบกำกับภาษี / VAT. Off = no tax wording anywhere. */
export const isVatShop = (settings: Pick<StoreSettings, 'vatEnabled'> | null | undefined) => settings?.vatEnabled === true;

/** Thai labels of the settings page (same order as on screen). */
export const STORE_INFO_LABELS: Array<[SlipOptionKey & A4OptionKey, string]> = [
  ['showLogo', 'โลโก้ร้าน'],
  ['showBranch', 'สาขา'],
  ['showAddress', 'ที่อยู่ร้าน'],
  ['showPhone', 'เบอร์โทร'],
  ['showEmail', 'อีเมล / ช่องทางติดต่อ'],
  ['showTaxId', 'เลขประจำตัวผู้เสียภาษีของร้าน'],
  ['showHeaderText', 'ข้อความส่วนบน (สโลแกน)'],
  ['showFooterText', 'ข้อความส่วนท้าย (คำขอบคุณ / เงื่อนไข)'],
];

export const SLIP_ONLY_LABELS: Array<[SlipOptionKey, string]> = [
  ['showCashier', 'ชื่อพนักงาน'],
  ['showCustomer', 'ชื่อลูกค้า (เมื่อเลือกลูกค้า)'],
  ['showNote', 'หมายเหตุของบิล'],
  ['showPaymentDetails', 'รับเงิน / เงินทอน'],
  ['showPoints', 'แต้มสะสม'],
];

export const A4_ONLY_LABELS: Array<[A4OptionKey, string]> = [
  ['showCashier', 'ชื่อพนักงาน'],
  ['showCustomerDetails', 'ที่อยู่ / เลขผู้เสียภาษี / เบอร์โทรลูกค้า'],
  ['showPaymentDetails', 'รายละเอียดการชำระเงิน (รับเงิน / เงินทอน)'],
  ['showPoints', 'แต้มสะสม'],
  ['showAmountInWords', 'จำนวนเงินตัวอักษร'],
  ['showSignatures', 'ช่องลงชื่อผู้รับ / ผู้จ่ายเงิน'],
];
