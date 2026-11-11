import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addQty, DECIMAL_QTY_DISABLED, mulQty, parseQty, quantitiesToNumbers, roundQty, subQty, toHund } from './qty';

describe('quantity helpers', () => {
  it('adds and subtracts in hundredths without float residue', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addQty(0.1, 0.2)).toBe(0.3);
    expect(subQty(10.5, 1.25)).toBe(9.25);
    expect(subQty(subQty(subQty(10.5, 1.25), 2.5), 6.75)).toBe(0);
    expect(addQty(new Prisma.Decimal('1.15'), '2.2', 3)).toBe(6.35);
    expect(toHund(new Prisma.Decimal('-0.07'))).toBe(-7);
  });

  it('converts units and rounds to 2 decimals', () => {
    expect(mulQty(1.25, 12)).toBe(15);
    expect(mulQty(0.33, 12)).toBe(3.96);
    expect(mulQty(1.1, 3)).toBe(3.3); // 3.3000000000000003 in plain float
    expect(roundQty(2.675)).toBe(2.68);
  });

  it('parseQty accepts up to 2 decimals when the store allows it', () => {
    expect(parseQty(1.5, { allowDecimal: true })).toBe(1.5);
    expect(parseQty('2.25', { allowDecimal: true })).toBe(2.25);
    expect(parseQty(0.01, { allowDecimal: true })).toBe(0.01);
    expect(() => parseQty(1.555, { allowDecimal: true })).toThrow(BadRequestException);
    expect(() => parseQty(-1, { allowDecimal: true })).toThrow(BadRequestException);
    expect(() => parseQty(0, { allowDecimal: true })).toThrow(BadRequestException);
    expect(parseQty(0, { allowDecimal: true, min: 'nonneg' })).toBe(0);
    expect(() => parseQty(10_000_001, { allowDecimal: true })).toThrow(BadRequestException);
    expect(() => parseQty('abc', { allowDecimal: true })).toThrow(BadRequestException);
    expect(() => parseQty(true, { allowDecimal: true })).toThrow(BadRequestException);
  });

  it('parseQty rejects non-integers when the setting is off (behaviour unchanged for those shops)', () => {
    expect(parseQty(3, { allowDecimal: false })).toBe(3);
    expect(() => parseQty(1.5, { allowDecimal: false })).toThrow(DECIMAL_QTY_DISABLED);
    expect(() => parseQty('0.5', { allowDecimal: false })).toThrow(DECIMAL_QTY_DISABLED);
  });

  it('sends Decimal quantities as numbers and leaves money Decimals alone', () => {
    const body = quantitiesToNumbers({
      data: [{ quantity: new Prisma.Decimal('1.50'), unitPrice: new Prisma.Decimal('10.00'), items: [{ baseQuantity: new Prisma.Decimal('18') }] }],
      replay: { receivedQty: '10.50', note: '12' },
      when: new Date(0),
    });
    expect(body.data[0].quantity).toBe(1.5);
    expect(Prisma.Decimal.isDecimal(body.data[0].unitPrice)).toBe(true);
    expect(body.data[0].items[0].baseQuantity).toBe(18);
    expect(body.replay.receivedQty).toBe(10.5);
    expect(body.replay.note).toBe('12');
    expect(body.when).toBeInstanceOf(Date);
  });
});
