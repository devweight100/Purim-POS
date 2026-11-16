import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { promptPayOf, promptPayQr, qrPath } from './promptpay-qr';
import { hasValidPromptPayCrc } from '@shared/promptpay';

/** Rasterise the module matrix (scale px per module, 4-module quiet zone) and decode it with jsQR. */
function decode(modules: boolean[][], scale = 4): string | null {
  const n = modules.length + 8;
  const w = n * scale;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < modules.length; r++) {
    for (let c = 0; c < modules.length; c++) {
      if (!modules[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + 4) * scale + y) * w + (c + 4) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, w, w)?.data ?? null;
}

describe('PromptPay QR rendering', () => {
  it('encodes the payload so a scanner reads it back', () => {
    for (const [type, id, amount] of [
      ['MOBILE', '0812345678', 4.22],
      ['NATIONAL_ID', '1234567890121', 1499.5],
      ['EWALLET', '012345678901234', 0.01],
      ['MOBILE', '0899999999', 9_999_999.99],
    ] as const) {
      const qr = promptPayQr(type, id, amount)!;
      expect(qr).not.toBeNull();
      expect(hasValidPromptPayCrc(qr.payload)).toBe(true);
      expect(decode(qr.modules)).toBe(qr.payload);
    }
  });

  it('no QR for an amount that cannot be locked or a bad ID', () => {
    expect(promptPayQr('MOBILE', '0812345678', 0)).toBeNull();
    expect(promptPayQr('MOBILE', '0812345678', -5)).toBeNull();
    expect(promptPayQr('NATIONAL_ID', '1234567890122', 10)).toBeNull();
  });

  it('reads the PromptPay ID of a bank account', () => {
    expect(promptPayOf({ promptpayType: 'MOBILE', promptpayId: '0812345678' })).toEqual({ type: 'MOBILE', id: '0812345678' });
    expect(promptPayOf({ promptpayType: null, promptpayId: null })).toBeNull();
    expect(promptPayOf({ promptpayType: 'MOBILE', promptpayId: '' })).toBeNull();
    expect(promptPayOf({ promptpayType: 'OTHER', promptpayId: '0812345678' })).toBeNull();
    expect(promptPayOf(null)).toBeNull();
  });

  it('SVG path covers each dark module once', () => {
    const d = qrPath([[true, true, false], [false, true, false], [false, false, false]], 0);
    expect(d).toBe('M0 0h2v1h-2zM1 1h1v1h-1z');
  });
});
