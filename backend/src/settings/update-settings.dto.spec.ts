import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSettingsDto, SETTINGS_FIELDS } from './update-settings.dto';
import { normalizeReceiptOptions, effectiveReceiptOptions } from '../../../shared/src/receipt-options';

/** Same options as the global pipe in main.ts. */
async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateSettingsDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors };
}

describe('UpdateSettingsDto.receiptOptions', () => {
  it('is a whitelisted settings field', () => {
    expect(SETTINGS_FIELDS).toContain('receiptOptions');
  });

  it('accepts booleans for known keys of slip and a4', async () => {
    const { dto, errors } = await check({
      receiptOptions: { slip: { showAddress: true, showLogo: false }, a4: { showSignatures: false } },
    });
    expect(errors).toHaveLength(0);
    expect(dto.receiptOptions).toEqual({ slip: { showAddress: true, showLogo: false }, a4: { showSignatures: false } });
  });

  it('accepts null (back to defaults) and leaving it out', async () => {
    expect((await check({ receiptOptions: null })).errors).toHaveLength(0);
    expect((await check({ storeName: 'ร้าน' })).errors).toHaveLength(0);
  });

  it.each([
    ['not an object', 'yes'],
    ['an array', [true]],
    ['an unknown layout', { thermal: { showLogo: true } }],
    ['an unknown key', { slip: { showSecret: true } }],
    ['an a4-only key on the slip', { slip: { showSignatures: true } }],
    ['a non-boolean value', { slip: { showAddress: 'true' } }],
    ['a number', { a4: { showLogo: 1 } }],
    ['a layout that is not an object', { slip: true }],
  ])('rejects %s', async (_label, value) => {
    const { errors } = await check({ receiptOptions: value });
    expect(errors.map((e) => e.property)).toContain('receiptOptions');
  });
});

describe('receipt options defaults and the VAT rule', () => {
  it('fills every key; the slip is short, A4 shows everything', () => {
    const o = normalizeReceiptOptions(null);
    expect(o.slip.showAddress).toBe(false);
    expect(o.slip.showEmail).toBe(false);
    expect(o.slip.showLogo).toBe(false);
    expect(o.slip.showPhone).toBe(true);
    expect(Object.values(o.a4).every(Boolean)).toBe(true);
  });

  it('seller tax id follows vatEnabled whatever was stored', () => {
    const stored = { slip: { showTaxId: false }, a4: { showTaxId: false } };
    expect(effectiveReceiptOptions(stored, true).slip.showTaxId).toBe(true);
    expect(effectiveReceiptOptions(stored, true).a4.showTaxId).toBe(true);
    expect(effectiveReceiptOptions({ slip: { showTaxId: true } }, false).slip.showTaxId).toBe(false);
  });
});
