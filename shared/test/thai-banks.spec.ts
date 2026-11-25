/** Receiving bank list, badge data, old-name matching and logo checks. Runs under backend jest and frontend vitest. */
import { accountBankCode, bankByCode, bankLogoError, inferBankCode, isThaiBankCode, THAI_BANKS, BANK_LOGO_MAX_BYTES } from '../src/thai-banks';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('Thai receiving banks', () => {
  it('has the owner list (KBank ... ICBC, PromptPay, other) with distinct codes and a colour each', () => {
    expect(THAI_BANKS.map((b) => b.code)).toEqual(['KBANK', 'SCB', 'KTB', 'BBL', 'BAY', 'TTB', 'GSB', 'BAAC', 'GHB', 'UOB', 'CIMB', 'KKP', 'LHB', 'TISCO', 'ICBC', 'PROMPTPAY', 'OTHER']);
    for (const b of THAI_BANKS) {
      expect(b.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(b.abbr.length).toBeGreaterThan(0);
      expect(b.abbr.length).toBeLessThanOrEqual(5);
    }
    expect(isThaiBankCode('SCB')).toBe(true);
    expect(isThaiBankCode('scb')).toBe(false);
    expect(bankByCode('nope').code).toBe('OTHER');
  });
  it('old accounts: the bank is found from the free-text name (presets and typed names)', () => {
    expect(inferBankCode('ธนาคารกสิกรไทย (KBank)')).toBe('KBANK');
    expect(inferBankCode('ธนาคารกรุงศรีอยุธยา (BAY)')).toBe('BAY');
    expect(inferBankCode('ธนาคารกรุงเทพ (BBL)')).toBe('BBL');
    expect(inferBankCode('กรุงไทย')).toBe('KTB');
    expect(inferBankCode('TMB Thanachart')).toBe('TTB');
    expect(inferBankCode('พร้อมเพย์ (PromptPay)')).toBe('PROMPTPAY');
    expect(inferBankCode('ธนาคารออมสิน (GSB)')).toBe('GSB');
    expect(inferBankCode('บัญชีร้าน')).toBeNull();
    expect(accountBankCode({ bankCode: 'UOB', bankName: 'ธนาคารกสิกรไทย' })).toBe('UOB');
    expect(accountBankCode({ bankName: 'ธนาคารไทยพาณิชย์ (SCB)' })).toBe('SCB');
    expect(accountBankCode({ bankName: 'xyz' })).toBe('OTHER');
  });
  it('uploaded logo: PNG / JPEG / WebP by type and first bytes, size-limited, never SVG', () => {
    expect(bankLogoError(`data:image/png;base64,${PNG_1PX}`)).toBeNull();
    expect(bankLogoError(`data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+`)).toMatch(/SVG/);
    expect(bankLogoError('data:image/png;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+')).toMatch(/ไม่ตรง/); // an SVG renamed .png
    expect(bankLogoError(`data:image/jpeg;base64,${PNG_1PX}`)).toMatch(/ไม่ตรง/);
    expect(bankLogoError('https://example.com/logo.png')).toMatch(/PNG/);
    const big = 'iVBORw0KGgo' + 'A'.repeat(Math.ceil((BANK_LOGO_MAX_BYTES * 4) / 3) + 8);
    expect(bankLogoError(`data:image/png;base64,${big}`)).toMatch(/ใหญ่เกินไป/);
  });
});
