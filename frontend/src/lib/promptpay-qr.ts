import qrcode from 'qrcode-generator';
import {
  buildPromptPayPayload,
  isValidPromptPayAmount,
  maskPromptPayId,
  normalizePromptPayId,
  PROMPTPAY_ID_TYPES,
  type PromptPayIdType,
} from '@shared/promptpay';

/** The PromptPay part of a bank account (null when the account has no valid PromptPay ID). */
export function promptPayOf(acc: { promptpayType?: string | null; promptpayId?: string | null } | null | undefined): { type: PromptPayIdType; id: string } | null {
  const type = acc?.promptpayType as PromptPayIdType | undefined;
  if (!type || !PROMPTPAY_ID_TYPES.includes(type) || !acc?.promptpayId) return null;
  const n = normalizePromptPayId(type, acc.promptpayId);
  return n.ok ? { type, id: n.id } : null;
}

export type PromptPayQrData = { payload: string; modules: boolean[][]; masked: string };

/**
 * Payload + QR modules for an amount, or null when the amount cannot be locked (0, negative, too
 * big). Error correction M: the payload is ~80 characters, so the code stays version 4-5 (33-37
 * modules), easy to scan from a phone across the counter.
 */
export function promptPayQr(type: PromptPayIdType, id: string, amount: number): PromptPayQrData | null {
  if (!isValidPromptPayAmount(amount)) return null;
  let payload: string;
  try {
    payload = buildPromptPayPayload(type, id, amount);
  } catch {
    return null;
  }
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const modules: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    modules.push(row);
  }
  return { payload, modules, masked: maskPromptPayId(type, id) };
}

/** One SVG path ("M x y h1 v1 h-1 z" per dark module, runs merged) for a module matrix. */
export function qrPath(modules: boolean[][], quiet = 4): string {
  let d = '';
  modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      let end = c;
      while (end < row.length && row[end]) end++;
      d += `M${c + quiet} ${r + quiet}h${end - c}v1h${c - end}z`;
      c = end;
    }
  });
  return d;
}
