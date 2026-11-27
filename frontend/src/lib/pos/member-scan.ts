import { convertThaiToEnBarcode } from '@/lib/thai-barcode-converter';

/** window event: a scanner burst that is not a product code arrived while the member picker is open (detail: code) */
export const MEMBER_PICKER_SCAN_EVENT = 'pos-member-picker-scan';
/** id of the member picker's search box */
export const MEMBER_SEARCH_ID = 'pos-member-search';

/**
 * A code scanned / typed while the member picker is open (docs/pos-member-picker.md): the member whose member code
 * equals it (case-insensitive), or whose phone has exactly its digits (at least 9). Only a single match counts
 * (two members with one phone: nobody, the cashier picks by hand).
 */
export interface MemberLike {
  id: string;
  code?: string | null;
  phone?: string | null;
}

const digits = (s: string) => s.replace(/\D/g, '');

export function memberForCode<T extends MemberLike>(customers: readonly T[], raw: string): T | null {
  const code = raw.trim().toLowerCase();
  if (!code) return null;
  const byCode = customers.filter((c) => (c.code || '').trim().toLowerCase() === code);
  if (byCode.length === 1) return byCode[0];
  if (byCode.length > 1) return null;
  const d = digits(code);
  if (d.length < 9 || d.length !== code.replace(/[\s-]/g, '').length) return null;
  const byPhone = customers.filter((c) => digits(c.phone || '') === d);
  return byPhone.length === 1 ? byPhone[0] : null;
}

/** Text of a member row that the picker's search looks in (name, phone, code, tax id, company, address). */
export function memberSearchText(c: {
  name?: string; phone?: string; code?: string; taxId?: string; companyName?: string; address?: string; taxAddress?: string;
}): string {
  return [c.name, c.phone, c.code, c.taxId, c.companyName, c.address, c.taxAddress].filter(Boolean).join('\n').toLowerCase();
}

/** The address shown in the picker: the member's address, else the tax-invoice address. */
export function memberAddress(c: { address?: string | null; taxAddress?: string | null }): string {
  return (c.address || '').trim() || (c.taxAddress || '').trim();
}

/** memberForCode for a scanner burst: as typed, else with the Thai keyboard layout converted (like product scans). */
export function memberForScan<T extends MemberLike>(customers: readonly T[], raw: string): T | null {
  const m = memberForCode(customers, raw);
  if (m) return m;
  const converted = convertThaiToEnBarcode(raw);
  return converted !== raw ? memberForCode(customers, converted) : null;
}
