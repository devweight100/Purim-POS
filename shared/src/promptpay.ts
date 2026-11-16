/**
 * PromptPay QR (Thai QR Payment, EMVCo merchant-presented mode) built offline: no bank API, no
 * package. Used by the bank-account form (preview), the POS payment dialog, split payment and the
 * debt payment dialog (frontend), and by the server to validate the PromptPay ID it stores.
 *
 * Payload (each field = 2-digit id + 2-digit length + value):
 *   00 02 "01"                     payload format
 *   01 02 "12" (amount) / "11"     point of initiation: dynamic (amount locked) / static
 *   29 ..                          merchant account: 00 = AID A000000677010111,
 *                                  01 = mobile (0066 + number without the leading 0, 13 chars),
 *                                  02 = national ID / tax ID (13), 03 = e-wallet ID (15)
 *   53 03 "764"                    currency THB
 *   54 .. "123.45"                 amount, 2 decimals (only with an amount)
 *   58 02 "TH"                     country
 *   63 04 CRC16-CCITT (poly 0x1021, init 0xFFFF) over everything before it including "6304",
 *                                  uppercase hex
 */

export type PromptPayIdType = 'MOBILE' | 'NATIONAL_ID' | 'EWALLET';
export const PROMPTPAY_ID_TYPES: readonly PromptPayIdType[] = ['MOBILE', 'NATIONAL_ID', 'EWALLET'];

export const PROMPTPAY_TYPE_LABELS: Record<PromptPayIdType, string> = {
  MOBILE: 'เบอร์มือถือ',
  NATIONAL_ID: 'เลขประจำตัวประชาชน / เลขผู้เสียภาษี (13 หลัก)',
  EWALLET: 'e-Wallet ID (15 หลัก)',
};

export const PROMPTPAY_AID = 'A000000677010111';
/** Largest amount tag 54 can carry (13 characters: 10 digits + "." + 2 decimals). */
export const PROMPTPAY_MAX_AMOUNT = 9_999_999_999.99;

/** Digits only ("081-234-5678" -> "0812345678"). */
export const promptPayDigits = (raw: unknown): string => String(raw ?? '').replace(/\D/g, '');

/** 13-digit Thai national ID / tax ID checksum (the 13th digit). */
export function isValidThaiId13(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

/**
 * Normalises a PromptPay ID for storage. Mobile numbers are kept as 10 digits starting with 0
 * (+66 / 66 prefixes are converted). Returns the digits, or an error message in Thai.
 */
export function normalizePromptPayId(type: unknown, raw: unknown): { ok: true; id: string } | { ok: false; error: string } {
  if (!PROMPTPAY_ID_TYPES.includes(type as PromptPayIdType)) return { ok: false, error: 'ประเภทพร้อมเพย์ไม่ถูกต้อง' };
  const s = String(raw ?? '').trim();
  if (!/^[0-9+\-\s]*$/.test(s)) return { ok: false, error: 'หมายเลขพร้อมเพย์ต้องเป็นตัวเลขเท่านั้น' };
  let d = promptPayDigits(s);
  if (!d) return { ok: false, error: 'กรุณาระบุหมายเลขพร้อมเพย์' };
  if (type === 'MOBILE') {
    if (/^66\d{9}$/.test(d)) d = `0${d.slice(2)}`;
    if (!/^0[689]\d{8}$/.test(d)) return { ok: false, error: 'เบอร์มือถือพร้อมเพย์ต้องมี 10 หลัก ขึ้นต้นด้วย 06, 08 หรือ 09' };
    return { ok: true, id: d };
  }
  if (type === 'NATIONAL_ID') {
    if (!/^\d{13}$/.test(d)) return { ok: false, error: 'เลขประจำตัวประชาชน / เลขผู้เสียภาษีต้องมี 13 หลัก' };
    if (!isValidThaiId13(d)) return { ok: false, error: 'เลขประจำตัวประชาชน / เลขผู้เสียภาษีไม่ถูกต้อง (หลักตรวจสอบไม่ตรง)' };
    return { ok: true, id: d };
  }
  if (!/^\d{15}$/.test(d)) return { ok: false, error: 'e-Wallet ID ต้องมี 15 หลัก' };
  return { ok: true, id: d };
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final xor) of an ASCII string. */
export function crc16Ccitt(text: string): number {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= (text.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const crcHex = (text: string): string => crc16Ccitt(text).toString(16).toUpperCase().padStart(4, '0');

function field(id: string, value: string): string {
  if (value.length > 99) throw new Error(`PromptPay field ${id} too long`);
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Amount as tag 54 wants it ("1", 1.005 float noise -> "1.00" / "1.01"), from whole satang. */
export function formatPromptPayAmount(amount: number): string {
  const satang = Math.round(amount * 100 + (amount >= 0 ? 1e-7 : -1e-7));
  return `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, '0')}`;
}

/** The value of sub-tag 01/02/03 inside tag 29. */
function merchantTarget(type: PromptPayIdType, id: string): string {
  if (type === 'MOBILE') return `0066${id.replace(/^0/, '')}`.padStart(13, '0').slice(-13);
  return id;
}

const SUB_TAG: Record<PromptPayIdType, string> = { MOBILE: '01', NATIONAL_ID: '02', EWALLET: '03' };

/**
 * PromptPay payload for an ID and an amount in baht. Without an amount (undefined) the QR is
 * static (the payer types the amount). Throws on an invalid ID or amount: callers check with
 * normalizePromptPayId / isValidPromptPayAmount first.
 */
export function buildPromptPayPayload(type: PromptPayIdType, rawId: string, amount?: number): string {
  const n = normalizePromptPayId(type, rawId);
  if (!n.ok) throw new Error(n.error);
  const hasAmount = amount !== undefined;
  if (hasAmount && !isValidPromptPayAmount(amount)) throw new Error('ยอดเงินสำหรับ QR ไม่ถูกต้อง');
  const body =
    field('00', '01') +
    field('01', hasAmount ? '12' : '11') +
    field('29', field('00', PROMPTPAY_AID) + field(SUB_TAG[type], merchantTarget(type, n.id))) +
    field('53', '764') +
    (hasAmount ? field('54', formatPromptPayAmount(amount)) : '') +
    field('58', 'TH') +
    '6304';
  return body + crcHex(body);
}

/** An amount a dynamic PromptPay QR can lock: > 0, at most 2 decimals' worth, fits tag 54. */
export function isValidPromptPayAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount) && Math.round(amount * 100) >= 1 && amount <= PROMPTPAY_MAX_AMOUNT;
}

/** True when the payload's last 4 characters are the CRC of the rest. */
export function hasValidPromptPayCrc(payload: string): boolean {
  if (payload.length < 8 || payload.slice(-8, -4) !== '6304') return false;
  return crcHex(payload.slice(0, -4)) === payload.slice(-4);
}

/** ID shown under the QR: enough to recognise the account, not the whole number. */
export function maskPromptPayId(type: PromptPayIdType, id: string): string {
  const d = promptPayDigits(id);
  if (type === 'MOBILE' && d.length === 10) return `${d.slice(0, 3)}-xxx-${d.slice(6)}`;
  if (type === 'NATIONAL_ID' && d.length === 13) return `x-xxxx-xxxx${d.slice(9, 10)}-${d.slice(10, 12)}-${d.slice(12)}`;
  if (d.length > 4) return `${'x'.repeat(d.length - 4)}${d.slice(-4)}`;
  return d;
}
