/**
 * Member (customer) import from Excel / CSV (docs/round-shift-today-bundle-replace.md section 5b).
 * Columns of the template, how a header of the file maps to them, and the per-row check shared by the browser (preview
 * of the file) and the server (the import itself checks every row again).
 */

export type MemberImportKey =
  | 'code' | 'name' | 'phone' | 'priceLevel' | 'points' | 'creditLimit' | 'creditTerms' | 'address' | 'taxId' | 'email'
  | 'note' | 'deliveryFee' | 'pointEarnRateBaht' | 'pointEarnUnits' | 'pointRedeemRatePoints' | 'pointRedeemDiscountBaht';

export const MEMBER_IMPORT_COLUMNS: { key: MemberImportKey; header: string; aliases: string[]; hint: string; example: string }[] = [
  { key: 'code', header: 'รหัสสมาชิก', aliases: ['รหัสลูกค้า', 'code'], hint: 'ใช้จับคู่สมาชิกเดิม ว่าง = จับคู่ด้วยเบอร์โทร (สมาชิกใหม่ได้รหัส CUST-xxxx อัตโนมัติ)', example: 'CUST-0001' },
  { key: 'name', header: 'ชื่อ', aliases: ['ชื่อลูกค้า', 'ชื่อสมาชิก', 'name'], hint: 'จำเป็น', example: 'ร้านช่างสมชาย วัสดุก่อสร้าง' },
  { key: 'phone', header: 'เบอร์โทร', aliases: ['เบอร์โทรศัพท์', 'โทรศัพท์', 'phone'], hint: 'จัดรูปแบบเซลล์เป็นข้อความเพื่อเก็บเลข 0 ข้างหน้า (ระบบเติม 0 ให้เบอร์ 9 หลักที่เลข 0 หายไป)', example: '0812345678' },
  { key: 'priceLevel', header: 'ระดับราคา', aliases: ['ราคาระดับ', 'priceLevel'], hint: '1-5 ว่าง = 1 (สมาชิกใหม่) / ไม่เปลี่ยน (สมาชิกเดิม)', example: '2' },
  { key: 'points', header: 'คะแนนสะสม', aliases: ['แต้มสะสม', 'คะแนน', 'แต้ม', 'points'], hint: 'ยอดคะแนนคงเหลือที่ต้องการ (จำนวนเต็ม) บันทึกประวัติ "นำเข้าคะแนน" ว่าง = ไม่เปลี่ยน', example: '150' },
  { key: 'creditLimit', header: 'วงเงินเครดิต', aliases: ['วงเงิน', 'creditLimit'], hint: 'บาท 0 = ไม่มีเครดิต (ต้องมีสิทธิ์จัดการลูกหนี้)', example: '5000' },
  { key: 'creditTerms', header: 'เครดิต (วัน)', aliases: ['เครดิตเทอม', 'จำนวนวันเครดิต', 'creditTerms'], hint: 'จำนวนวัน', example: '30' },
  { key: 'address', header: 'ที่อยู่', aliases: ['address'], hint: '', example: '99 ม.1 ต.บางพลี อ.บางพลี จ.สมุทรปราการ' },
  { key: 'taxId', header: 'เลขผู้เสียภาษี', aliases: ['เลขประจำตัวผู้เสียภาษี', 'taxId'], hint: '13 หลัก (ข้อความ)', example: '0105555000000' },
  { key: 'email', header: 'อีเมล', aliases: ['email'], hint: '', example: '' },
  { key: 'note', header: 'หมายเหตุ', aliases: ['note'], hint: '', example: 'ลูกค้าประจำ' },
  { key: 'deliveryFee', header: 'ค่าส่ง', aliases: ['deliveryFee'], hint: 'ค่าส่งร้านออนไลน์ (บาท) ว่าง = ร้านแจ้งทุกครั้ง', example: '' },
  { key: 'pointEarnRateBaht', header: 'ซื้อทุกกี่บาท (เรทเฉพาะ)', aliases: ['ซื้อทุกกี่บาท'], hint: 'เว้นว่าง = ใช้เรทกลางของร้าน', example: '' },
  { key: 'pointEarnUnits', header: 'ได้กี่คะแนน (เรทเฉพาะ)', aliases: ['ได้กี่คะแนน'], hint: 'เว้นว่าง = ใช้เรทกลางของร้าน', example: '' },
  { key: 'pointRedeemRatePoints', header: 'ใช้กี่คะแนน (เรทเฉพาะ)', aliases: ['ใช้กี่คะแนน'], hint: 'เว้นว่าง = ใช้เรทกลางของร้าน', example: '' },
  { key: 'pointRedeemDiscountBaht', header: 'ลดกี่บาท (เรทเฉพาะ)', aliases: ['ลดกี่บาท'], hint: 'เว้นว่าง = ใช้เรทกลางของร้าน', example: '' },
];

const norm = (h: string) => String(h ?? '').replace(/^﻿/, '').replace(/\*/g, '').replace(/\s+/g, '').toLowerCase();

/** Header of the file -> column key (exact header or an alias, ignoring spaces / * / case); null when unknown. */
export function memberColumnOf(header: string): MemberImportKey | null {
  const h = norm(header);
  if (!h) return null;
  for (const c of MEMBER_IMPORT_COLUMNS) {
    if (norm(c.header) === h || c.aliases.some((a) => norm(a) === h)) return c.key;
  }
  return null;
}

/** A row of the file as sent to the server: cell texts by column key (blank cells left out). */
export interface MemberImportRow {
  rowNo: number;
  values: Partial<Record<MemberImportKey, string>>;
}

/** Field values a row sets (only the filled cells), after the per-row check. */
export interface MemberRowData {
  code?: string;
  name?: string;
  phone?: string;
  priceLevel?: number;
  points?: number;
  creditLimit?: number;
  creditTerms?: number;
  address?: string;
  taxId?: string;
  email?: string;
  note?: string;
  deliveryFee?: number;
  pointEarnRateBaht?: number;
  pointEarnUnits?: number;
  pointRedeemRatePoints?: number;
  pointRedeemDiscountBaht?: number;
}

/** Phone as text: digits / + - ( ) spaces kept; a 9-digit mobile / landline whose leading 0 Excel dropped gets it back. */
export function normalizeImportPhone(v: string): string {
  let s = String(v ?? '').trim().replace(/^'/, '');
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ''); // 812345678.0 from a number cell
  if (/^[689]\d{8}$/.test(s)) s = '0' + s; // mobile 06/08/09 that lost its 0
  return s;
}

const num = (v: string) => Number(String(v).replace(/,/g, '').trim());

/** Check one row; `errors` in Thai. Blank cells are not in `data` (= keep the member's current value). */
export function parseMemberRow(row: MemberImportRow): { data: MemberRowData; errors: string[] } {
  const v = row.values || {};
  const data: MemberRowData = {};
  const errors: string[] = [];
  const text = (k: MemberImportKey, max: number) => {
    const t = String(v[k] ?? '').trim();
    if (!t) return undefined;
    if (t.length > max) errors.push(`${MEMBER_IMPORT_COLUMNS.find((c) => c.key === k)!.header} ยาวเกิน ${max} ตัวอักษร`);
    return t.slice(0, max);
  };
  data.code = text('code', 50);
  data.name = text('name', 200);
  if (!data.name) errors.push('ไม่มีชื่อ');
  const phone = String(v.phone ?? '').trim();
  if (phone) {
    const p = normalizeImportPhone(phone);
    if (!/^[0-9+\-\s()]{3,20}$/.test(p)) errors.push(`เบอร์โทร "${phone}" ไม่ถูกต้อง`);
    else data.phone = p;
  }
  const level = String(v.priceLevel ?? '').trim();
  if (level) {
    const n = num(level);
    if (![1, 2, 3, 4, 5].includes(n)) errors.push(`ระดับราคา "${level}" ต้องเป็น 1-5`);
    else data.priceLevel = n;
  }
  const points = String(v.points ?? '').trim();
  if (points) {
    const n = num(points);
    if (!Number.isInteger(n) || n < 0 || n > 100_000_000) errors.push(`คะแนนสะสม "${points}" ต้องเป็นจำนวนเต็มตั้งแต่ 0`);
    else data.points = n;
  }
  const money = (k: 'creditLimit' | 'deliveryFee', label: string, max: number) => {
    const t = String(v[k] ?? '').trim();
    if (!t) return;
    const n = num(t);
    if (!Number.isFinite(n) || n < 0 || n > max || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) errors.push(`${label} "${t}" ไม่ถูกต้อง`);
    else data[k] = n;
  };
  money('creditLimit', 'วงเงินเครดิต', 100_000_000);
  money('deliveryFee', 'ค่าส่ง', 10_000);
  const terms = String(v.creditTerms ?? '').trim();
  if (terms) {
    const n = num(terms);
    if (!Number.isInteger(n) || n < 0 || n > 3650) errors.push(`เครดิต (วัน) "${terms}" ต้องเป็นจำนวนวันเต็ม`);
    else data.creditTerms = n;
  }
  data.address = text('address', 500);
  data.taxId = text('taxId', 20);
  data.email = text('email', 200);
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push(`อีเมล "${data.email}" ไม่ถูกต้อง`);
  data.note = text('note', 1000);
  for (const k of ['pointEarnRateBaht', 'pointEarnUnits', 'pointRedeemRatePoints', 'pointRedeemDiscountBaht'] as const) {
    const t = String(v[k] ?? '').trim();
    if (!t) continue;
    const n = num(t);
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) errors.push(`${MEMBER_IMPORT_COLUMNS.find((c) => c.key === k)!.header} "${t}" ต้องมากกว่า 0 (ว่าง = เรทกลางของร้าน)`);
    else data[k] = n;
  }
  for (const k of Object.keys(data) as (keyof MemberRowData)[]) if (data[k] === undefined) delete data[k];
  return { data, errors };
}
