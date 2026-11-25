/**
 * Receiving banks of the shop's accounts (docs/product-form-bank-logos.md part 4): the bank field of a bank account
 * and the built-in badge shown for it (the bank's well-known colour, a short abbreviation; NOT the bank's logo
 * file, which is a trademark: the owner may upload their own logo image per account instead).
 * Pure data + functions, used by the server (validation) and the screens (dropdown, badge).
 */
export type ThaiBankCode =
  | 'KBANK' | 'SCB' | 'KTB' | 'BBL' | 'BAY' | 'TTB' | 'GSB' | 'BAAC' | 'GHB'
  | 'UOB' | 'CIMB' | 'KKP' | 'LHB' | 'TISCO' | 'ICBC' | 'PROMPTPAY' | 'OTHER';

export interface ThaiBank {
  code: ThaiBankCode;
  /** Thai name as shown in the dropdown and stored as the account's bank name */
  name: string;
  /** short text in the badge (2-5 characters) */
  abbr: string;
  /** badge colour */
  color: string;
  /** text colour on the badge */
  fg: string;
  /** extra words that identify the bank in an old free-text bank name */
  aliases: string[];
}

export const THAI_BANKS: readonly ThaiBank[] = [
  { code: 'KBANK', name: 'ธนาคารกสิกรไทย (KBank)', abbr: 'K', color: '#138F2D', fg: '#FFFFFF', aliases: ['กสิกร', 'kbank', 'kasikorn', 'k plus', 'kplus'] },
  { code: 'SCB', name: 'ธนาคารไทยพาณิชย์ (SCB)', abbr: 'SCB', color: '#4E2A84', fg: '#FFFFFF', aliases: ['ไทยพาณิชย์', 'scb', 'siam commercial'] },
  { code: 'KTB', name: 'ธนาคารกรุงไทย (KTB)', abbr: 'KTB', color: '#1BA5E1', fg: '#FFFFFF', aliases: ['กรุงไทย', 'ktb', 'krungthai', 'krung thai'] },
  { code: 'BBL', name: 'ธนาคารกรุงเทพ (BBL)', abbr: 'BBL', color: '#1E4598', fg: '#FFFFFF', aliases: ['กรุงเทพ', 'bbl', 'bangkok bank'] },
  { code: 'BAY', name: 'ธนาคารกรุงศรีอยุธยา (Krungsri)', abbr: 'BAY', color: '#FEC43B', fg: '#4B3B2A', aliases: ['กรุงศรี', 'bay', 'krungsri', 'ayudhya'] },
  { code: 'TTB', name: 'ธนาคารทหารไทยธนชาต (ttb)', abbr: 'ttb', color: '#0050F0', fg: '#FFFFFF', aliases: ['ทหารไทย', 'ธนชาต', 'ttb', 'tmb', 'thanachart'] },
  { code: 'GSB', name: 'ธนาคารออมสิน (GSB)', abbr: 'GSB', color: '#EB198D', fg: '#FFFFFF', aliases: ['ออมสิน', 'gsb', 'government savings'] },
  { code: 'BAAC', name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)', abbr: 'ธกส', color: '#4B9B2E', fg: '#FFFFFF', aliases: ['ธ.ก.ส', 'ธกส', 'baac', 'เพื่อการเกษตร'] },
  { code: 'GHB', name: 'ธนาคารอาคารสงเคราะห์ (ธอส.)', abbr: 'ธอส', color: '#F57D20', fg: '#FFFFFF', aliases: ['อาคารสงเคราะห์', 'ธอส', 'ghb', 'gh bank'] },
  { code: 'UOB', name: 'ธนาคารยูโอบี (UOB)', abbr: 'UOB', color: '#0B3B8C', fg: '#FFFFFF', aliases: ['ยูโอบี', 'uob'] },
  { code: 'CIMB', name: 'ธนาคารซีไอเอ็มบี ไทย (CIMB)', abbr: 'CIMB', color: '#EC1C24', fg: '#FFFFFF', aliases: ['ซีไอเอ็มบี', 'cimb'] },
  { code: 'KKP', name: 'ธนาคารเกียรตินาคินภัทร (KKP)', abbr: 'KKP', color: '#594F74', fg: '#FFFFFF', aliases: ['เกียรตินาคิน', 'kkp', 'kiatnakin'] },
  { code: 'LHB', name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH Bank)', abbr: 'LH', color: '#6A9E3A', fg: '#FFFFFF', aliases: ['แลนด์ แอนด์ เฮ้าส์', 'แลนด์แอนด์เฮ้าส์', 'lh bank', 'lhb'] },
  { code: 'TISCO', name: 'ธนาคารทิสโก้ (TISCO)', abbr: 'TISCO', color: '#12549B', fg: '#FFFFFF', aliases: ['ทิสโก้', 'tisco'] },
  { code: 'ICBC', name: 'ธนาคารไอซีบีซี (ไทย) (ICBC)', abbr: 'ICBC', color: '#C4161C', fg: '#FFFFFF', aliases: ['ไอซีบีซี', 'icbc'] },
  { code: 'PROMPTPAY', name: 'พร้อมเพย์ (PromptPay)', abbr: 'PP', color: '#1C3E7A', fg: '#FFFFFF', aliases: ['พร้อมเพย์', 'promptpay', 'prompt pay'] },
  { code: 'OTHER', name: 'อื่น ๆ', abbr: '฿', color: '#64748B', fg: '#FFFFFF', aliases: [] },
];

export const THAI_BANK_CODES: readonly ThaiBankCode[] = THAI_BANKS.map((b) => b.code);

export const isThaiBankCode = (v: unknown): v is ThaiBankCode => typeof v === 'string' && (THAI_BANK_CODES as readonly string[]).includes(v);

/** The bank of a code (unknown / empty -> OTHER). */
export function bankByCode(code: string | null | undefined): ThaiBank {
  return THAI_BANKS.find((b) => b.code === code) || THAI_BANKS[THAI_BANKS.length - 1];
}

/**
 * The bank of an account saved before the bank field existed (free-text bank name, e.g. the old presets
 * "ธนาคารกสิกรไทย (KBank)"): matched by its Thai / English names; nothing matches -> null.
 */
export function inferBankCode(bankName: string | null | undefined): ThaiBankCode | null {
  const n = String(bankName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return null;
  for (const b of THAI_BANKS) {
    if (b.code === 'OTHER') continue;
    // longer, more specific names first within a bank ("กรุงศรี" must not be taken as "กรุงเทพ")
    if (b.aliases.some((a) => n.includes(a.toLowerCase()))) return b.code;
  }
  return null;
}

/** The code to show for an account: its bank field, else inferred from its name, else OTHER. */
export function accountBankCode(acc: { bankCode?: string | null; bankName?: string | null } | null | undefined): ThaiBankCode {
  if (acc && isThaiBankCode(acc.bankCode)) return acc.bankCode;
  return inferBankCode(acc?.bankName) || 'OTHER';
}

/** Largest uploaded logo accepted by the server (decoded bytes). The screens shrink it to 128 px PNG first. */
export const BANK_LOGO_MAX_BYTES = 150 * 1024;

/**
 * Checks an uploaded logo (a data URL): PNG / JPEG / WebP only, by type AND by the file's first bytes, at most
 * BANK_LOGO_MAX_BYTES. SVG (it can carry scripts) and anything else are refused. Returns an error text or null.
 */
export function bankLogoError(dataUrl: string): string | null {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return 'โลโก้ต้องเป็นรูป PNG, JPG หรือ WebP (ไม่รับ SVG)';
  const b64 = m[2];
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (bytes > BANK_LOGO_MAX_BYTES) return `โลโก้ใหญ่เกินไป (สูงสุด ${Math.round(BANK_LOGO_MAX_BYTES / 1024)} KB)`;
  const head = decodeBase64Head(b64.slice(0, 24));
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  const ok = (m[1] === 'png' && isPng) || (m[1] === 'jpeg' && isJpeg) || (m[1] === 'webp' && isWebp);
  return ok ? null : 'ไฟล์โลโก้ไม่ตรงกับชนิดรูปภาพ';
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** The first bytes of base64 text (no Buffer / atob: runs on the server and in the browser alike). */
function decodeBase64Head(s: string): number[] {
  const out: number[] = [];
  let bits = 0;
  let val = 0;
  for (const ch of s) {
    const i = B64.indexOf(ch);
    if (i < 0) break;
    val = (val << 6) | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((val >> bits) & 0xff);
    }
  }
  return out;
}
