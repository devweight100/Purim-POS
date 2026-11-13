/**
 * What the shop chose to show on its receipts (StoreSettings.receiptOptions, one setting for every
 * terminal). Two layouts: `slip` (80 mm thermal: sale receipt, debt payment, shift summary, claim
 * slip) and `a4` (A4 receipt / tax invoice, claim, PO, payment voucher, supplier return).
 *
 * The store name is always shown (not an option). The seller tax id is not a free choice:
 * a VAT-registered shop must print it on its tax invoices, a shop without VAT prints nothing
 * tax-related, so the effective `showTaxId` always equals `vatEnabled` (see effectiveReceiptOptions).
 */

export const STORE_INFO_KEYS = [
  'showLogo',
  'showBranch',
  'showAddress',
  'showPhone',
  'showEmail',
  'showTaxId',
  'showHeaderText',
  'showFooterText',
] as const;

export const SLIP_OPTION_KEYS = [
  ...STORE_INFO_KEYS,
  'showCashier',
  'showCustomer',
  'showNote',
  'showPaymentDetails',
  'showPoints',
] as const;

export const A4_OPTION_KEYS = [
  ...STORE_INFO_KEYS,
  'showCashier',
  'showCustomerDetails',
  'showPaymentDetails',
  'showPoints',
  'showAmountInWords',
  'showSignatures',
] as const;

export type SlipOptionKey = (typeof SLIP_OPTION_KEYS)[number];
export type A4OptionKey = (typeof A4_OPTION_KEYS)[number];
export type SlipReceiptOptions = Record<SlipOptionKey, boolean>;
export type A4ReceiptOptions = Record<A4OptionKey, boolean>;
export interface ReceiptOptions {
  slip: SlipReceiptOptions;
  a4: A4ReceiptOptions;
}

/** Slip: short (name, branch, phone, header/footer text); no address, e-mail or logo. */
export const DEFAULT_SLIP_OPTIONS: SlipReceiptOptions = {
  showLogo: false,
  showBranch: true,
  showAddress: false,
  showPhone: true,
  showEmail: false,
  showTaxId: true,
  showHeaderText: true,
  showFooterText: true,
  showCashier: true,
  showCustomer: true,
  showNote: true,
  showPaymentDetails: true,
  showPoints: true,
};

/** A4: everything. */
export const DEFAULT_A4_OPTIONS: A4ReceiptOptions = {
  showLogo: true,
  showBranch: true,
  showAddress: true,
  showPhone: true,
  showEmail: true,
  showTaxId: true,
  showHeaderText: true,
  showFooterText: true,
  showCashier: true,
  showCustomerDetails: true,
  showPaymentDetails: true,
  showPoints: true,
  showAmountInWords: true,
  showSignatures: true,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function mergeLayout<K extends string>(keys: readonly K[], defaults: Record<K, boolean>, raw: unknown): Record<K, boolean> {
  const src = isPlainObject(raw) ? raw : {};
  const out = { ...defaults };
  for (const k of keys) if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  return out;
}

/** Stored value (null, partial, old) -> every key present; anything that is not a boolean is ignored. */
export function normalizeReceiptOptions(raw: unknown): ReceiptOptions {
  const src = isPlainObject(raw) ? raw : {};
  return {
    slip: mergeLayout(SLIP_OPTION_KEYS, DEFAULT_SLIP_OPTIONS, src.slip),
    a4: mergeLayout(A4_OPTION_KEYS, DEFAULT_A4_OPTIONS, src.a4),
  };
}

/** What is printed: the stored choice with the tax rule applied (showTaxId = vatEnabled). */
export function effectiveReceiptOptions(raw: unknown, vatEnabled: boolean): ReceiptOptions {
  const o = normalizeReceiptOptions(raw);
  return {
    slip: { ...o.slip, showTaxId: vatEnabled },
    a4: { ...o.a4, showTaxId: vatEnabled },
  };
}

/**
 * Server-side check of a PATCH /settings body: null (back to defaults) or
 * { slip?: { key: boolean }, a4?: { key: boolean } } with known keys only.
 * Returns a Thai error message, or null when valid.
 */
export function receiptOptionsInputError(value: unknown): string | null {
  if (value === null) return null;
  if (!isPlainObject(value)) return 'รูปแบบใบเสร็จไม่ถูกต้อง';
  const layouts: Record<string, readonly string[]> = { slip: SLIP_OPTION_KEYS, a4: A4_OPTION_KEYS };
  for (const [layout, opts] of Object.entries(value)) {
    const keys = layouts[layout];
    if (!keys) return `รูปแบบใบเสร็จไม่รู้จัก "${layout}"`;
    if (!isPlainObject(opts)) return `รูปแบบใบเสร็จ ${layout} ไม่ถูกต้อง`;
    for (const [k, v] of Object.entries(opts)) {
      if (!keys.includes(k)) return `ตัวเลือกใบเสร็จไม่รู้จัก "${layout}.${k}"`;
      if (typeof v !== 'boolean') return `ตัวเลือกใบเสร็จ "${layout}.${k}" ต้องเป็นจริง/เท็จ`;
    }
  }
  return null;
}
