/**
 * Document numbers (round 4, owner; docs/document-numbers.md): `<PP><YYMM>-<NNNN>`
 *   PP   = 2-letter prefix of the document type (DOC_PREFIX)
 *   YYMM = Christian-era 2-digit year + month of the Bangkok calendar (November 2026 -> "2611")
 *   NNNN = running number per type and month, at least 4 digits, starts at 0001 every month
 * e.g. "IN2611-0001". The backend takes NNNN from the `document_counters` table (one row per type + month,
 * incremented inside the creating transaction, so parallel creates never get the same number).
 * Documents created before round 4 keep their old numbers (ORD-261100001, PO-261100001, WEB-261118-001 ...).
 */
import { BANGKOK_OFFSET_MS } from './bangkok-date';

export const DOC_PREFIX = {
  /** sales bill / receipt / tax invoice (orders) */
  SALE: 'IN',
  /** sales return / refund credit note (order_returns) */
  SALE_RETURN: 'CN',
  /** customer debt payment receipt (debt_payments.receipt_no) */
  DEBT_RECEIPT: 'RC',
  /** purchase order (purchase_orders) */
  PURCHASE_ORDER: 'PO',
  /** supplier payment voucher (payment_vouchers) */
  PAYMENT_VOUCHER: 'PV',
  /** supplier return / supplier credit note (supplier_return_notes) */
  SUPPLIER_RETURN: 'SR',
  /** customer claim (customer_claims) */
  CLAIM: 'CL',
  /** cashier shift (shifts) */
  SHIFT: 'SH',
  /** expense entry (expenses) */
  EXPENSE: 'EX',
  /** online shop order (online_orders.order_no) */
  ONLINE_ORDER: 'WB',
} as const;

export type DocType = keyof typeof DOC_PREFIX;

/** "2611" for an instant in November 2026 (Bangkok calendar) */
export function docPeriod(at: Date | number | string = Date.now()): string {
  const d = new Date(new Date(at).getTime() + BANGKOK_OFFSET_MS);
  return `${String(d.getUTCFullYear() % 100).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "IN2611-0001" */
export function formatDocNumber(type: DocType, period: string, seq: number): string {
  if (!/^\d{4}$/.test(period) || !Number.isInteger(seq) || seq < 1) throw new Error('bad document number parts');
  return `${DOC_PREFIX[type]}${period}-${String(seq).padStart(4, '0')}`;
}

/** New-format number -> its parts (null for any other text, e.g. an old-format number). */
export function parseDocNumber(value: string): { type: DocType; period: string; seq: number } | null {
  const m = /^([A-Z]{2,3})(\d{4})-(\d{4,})$/.exec(String(value || '').trim().toUpperCase());
  if (!m) return null;
  const type = (Object.keys(DOC_PREFIX) as DocType[]).find((k) => DOC_PREFIX[k] === m[1]);
  return type ? { type, period: m[2], seq: Number(m[3]) } : null;
}
