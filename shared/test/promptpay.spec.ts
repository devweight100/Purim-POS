/**
 * PromptPay payload generator. Runs under backend jest and frontend vitest.
 *
 * Vectors:
 * - CRC-16/CCITT-FALSE check value: crc("123456789") = 0x29B1 (the catalogue value of the CRC
 *   used by EMVCo QR, poly 0x1021, init 0xFFFF).
 * - REFERENCE: payloads printed by the `promptpay-qr` npm package 0.5.0 (MIT, dtinth, the widely
 *   used implementation; its documented examples are 0812345678 without / with amount 4.22). That
 *   package writes tag 58 before 53, so only its CRCs and its tag 29 are compared here.
 * - OURS: our payloads (tag order 00 01 29 53 54 58 63 as in EMVCo / Thai QR Payment) with CRCs
 *   computed independently by Python `binascii.crc_hqx(payload, 0xFFFF)`.
 */
import {
  buildPromptPayPayload,
  crc16Ccitt,
  formatPromptPayAmount,
  hasValidPromptPayCrc,
  isValidPromptPayAmount,
  isValidThaiId13,
  maskPromptPayId,
  normalizePromptPayId,
} from '../src/promptpay';

const REFERENCE = [
  '00020101021129370016A000000677010111011300668123456785802TH530376463045D82', // 0812345678
  '00020101021229370016A000000677010111011300668123456785802TH530376454044.2263045D49', // 0812345678, 4.22
  '00020101021129370016A000000677010111021311111111111115802TH530376463047B5A', // 1111111111111
  '00020101021229370016A000000677010111021311111111111115802TH53037645406100.0063046B52', // 1111111111111, 100
  '00020101021129390016A00000067701011103150123456789012345802TH530376463049781', // 012345678901234
  '00020101021229390016A00000067701011103150123456789012345802TH530376454041.0063040268', // 012345678901234, 1
  '00020101021229370016A000000677010111011300668912345675802TH530376454041.006304603B', // 0891234567, 1
];

/** Tag 29 (merchant account) of a payload: "29" + length + value. */
function tag29(payload: string): string {
  const i = payload.indexOf('29', 12); // after 000201 + 0102xx
  const len = Number(payload.slice(i + 2, i + 4));
  return payload.slice(i, i + 4 + len);
}

describe('PromptPay CRC16-CCITT', () => {
  it('matches the catalogue check value', () => {
    expect(crc16Ccitt('123456789')).toBe(0x29b1);
    expect(crc16Ccitt('')).toBe(0xffff);
  });

  it('reproduces the CRC of every reference payload', () => {
    for (const p of REFERENCE) {
      expect(hasValidPromptPayCrc(p)).toBe(true);
      expect(crc16Ccitt(p.slice(0, -4)).toString(16).toUpperCase().padStart(4, '0')).toBe(p.slice(-4));
    }
  });

  it('rejects a payload with a changed digit', () => {
    const p = REFERENCE[1].replace('4.22', '5.22');
    expect(hasValidPromptPayCrc(p)).toBe(false);
  });
});

describe('PromptPay payload', () => {
  it('builds the documented phone examples (merchant account as the reference package)', () => {
    expect(buildPromptPayPayload('MOBILE', '0812345678', 4.22)).toBe(
      '00020101021229370016A00000067701011101130066812345678530376454044.225802TH63042352',
    );
    expect(buildPromptPayPayload('MOBILE', '081-234-5678')).toBe(
      '00020101021129370016A0000006770101110113006681234567853037645802TH6304823E',
    );
    expect(tag29(buildPromptPayPayload('MOBILE', '0812345678', 4.22))).toBe(tag29(REFERENCE[1]));
    expect(tag29(buildPromptPayPayload('MOBILE', '0891234567', 1))).toBe(tag29(REFERENCE[6]));
    expect(buildPromptPayPayload('MOBILE', '0891234567', 1)).toBe(
      '00020101021229370016A00000067701011101130066891234567530376454041.005802TH6304B9C0',
    );
  });

  it('accepts +66 / 66 mobile prefixes', () => {
    const want = buildPromptPayPayload('MOBILE', '0812345678', 10);
    expect(buildPromptPayPayload('MOBILE', '+66 81 234 5678', 10)).toBe(want);
    expect(buildPromptPayPayload('MOBILE', '66812345678', 10)).toBe(want);
  });

  it('national / tax ID (sub-tag 02) and e-wallet (sub-tag 03)', () => {
    expect(buildPromptPayPayload('NATIONAL_ID', '1-2345-67890-12-1', 100)).toBe(
      '00020101021229370016A0000006770101110213123456789012153037645406100.005802TH6304B88C',
    );
    expect(buildPromptPayPayload('EWALLET', '012345678901234', 1)).toBe(
      '00020101021229390016A0000006770101110315012345678901234530376454041.005802TH6304DB93',
    );
    expect(tag29(buildPromptPayPayload('EWALLET', '012345678901234', 1))).toBe(tag29(REFERENCE[5]));
  });

  it('locks large amounts with 2 decimals and fixes float noise', () => {
    expect(buildPromptPayPayload('MOBILE', '0812345678', 1234567.89)).toBe(
      '00020101021229370016A00000067701011101130066812345678530376454101234567.895802TH6304F38E',
    );
    expect(formatPromptPayAmount(0.1 + 0.2)).toBe('0.30');
    expect(formatPromptPayAmount(1.005)).toBe('1.01');
    expect(formatPromptPayAmount(1)).toBe('1.00');
    expect(formatPromptPayAmount(9_999_999_999.99)).toBe('9999999999.99');
    for (const a of [0.01, 1, 99.5, 1499.25, 250000]) {
      const p = buildPromptPayPayload('MOBILE', '0812345678', a);
      expect(p).toContain(`54${String(formatPromptPayAmount(a).length).padStart(2, '0')}${formatPromptPayAmount(a)}`);
      expect(p.slice(6, 12)).toBe('010212');
      expect(hasValidPromptPayCrc(p)).toBe(true);
    }
  });

  it('refuses invalid amounts and IDs', () => {
    for (const a of [0, -1, 0.004, NaN, Infinity, 10_000_000_000]) expect(isValidPromptPayAmount(a)).toBe(false);
    expect(() => buildPromptPayPayload('MOBILE', '0812345678', 0)).toThrow();
    expect(() => buildPromptPayPayload('NATIONAL_ID', '1111111111111', 1)).toThrow();
    expect(() => buildPromptPayPayload('MOBILE', '021234567', 1)).toThrow();
  });
});

describe('PromptPay ID validation', () => {
  it('13-digit checksum', () => {
    expect(isValidThaiId13('1234567890121')).toBe(true);
    expect(isValidThaiId13('0105536092641')).toBe(true); // juristic tax ID format (leading 0)
    expect(isValidThaiId13('3100100123451')).toBe(true);
    expect(isValidThaiId13('1234567890122')).toBe(false);
    expect(isValidThaiId13('1111111111111')).toBe(false);
    expect(isValidThaiId13('123456789012')).toBe(false);
  });

  it('normalises and explains', () => {
    expect(normalizePromptPayId('MOBILE', '081-234-5678')).toEqual({ ok: true, id: '0812345678' });
    expect(normalizePromptPayId('MOBILE', '+66812345678')).toEqual({ ok: true, id: '0812345678' });
    expect(normalizePromptPayId('MOBILE', '0612345678')).toEqual({ ok: true, id: '0612345678' });
    expect(normalizePromptPayId('MOBILE', '0212345678').ok).toBe(false); // landline
    expect(normalizePromptPayId('MOBILE', '081234567').ok).toBe(false);
    expect(normalizePromptPayId('MOBILE', '08l2345678').ok).toBe(false); // letter
    expect(normalizePromptPayId('NATIONAL_ID', '1 2345 67890 12 1')).toEqual({ ok: true, id: '1234567890121' });
    const bad = normalizePromptPayId('NATIONAL_ID', '1234567890122');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('หลักตรวจสอบ');
    expect(normalizePromptPayId('EWALLET', '012345678901234')).toEqual({ ok: true, id: '012345678901234' });
    expect(normalizePromptPayId('EWALLET', '01234567890123').ok).toBe(false);
    expect(normalizePromptPayId('BANK', '0812345678').ok).toBe(false);
    expect(normalizePromptPayId('MOBILE', '').ok).toBe(false);
  });

  it('masks the ID shown to the customer', () => {
    expect(maskPromptPayId('MOBILE', '0812345678')).toBe('081-xxx-5678');
    expect(maskPromptPayId('NATIONAL_ID', '1234567890121')).toBe('x-xxxx-xxxx0-12-1');
    expect(maskPromptPayId('EWALLET', '012345678901234')).toBe('xxxxxxxxxxx1234');
  });
});
