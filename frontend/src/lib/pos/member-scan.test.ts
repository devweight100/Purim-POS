import { describe, expect, it } from 'vitest';
import { memberAddress, memberForCode, memberSearchText } from './member-scan';

const list = [
  { id: 'a', code: 'CUST-0001', phone: '081-200-0000' },
  { id: 'b', code: 'CUST-0002', phone: '0812000001' },
  { id: 'c', code: 'CUST-0003', phone: '0899999999' },
  { id: 'd', code: 'CUST-0004', phone: '089-999-9999' },
];

describe('memberForCode', () => {
  it('member code, any case', () => {
    expect(memberForCode(list, 'cust-0002')?.id).toBe('b');
    expect(memberForCode(list, ' CUST-0001 ')?.id).toBe('a');
  });
  it('phone digits (dashes ignored on both sides)', () => {
    expect(memberForCode(list, '0812000000')?.id).toBe('a');
    expect(memberForCode(list, '081-200-0001')?.id).toBe('b');
  });
  it('two members with the same phone: nobody', () => {
    expect(memberForCode(list, '0899999999')).toBeNull();
  });
  it('a product barcode / short or mixed text is not a phone', () => {
    expect(memberForCode(list, '8850001112223')).toBeNull();
    expect(memberForCode(list, '0812')).toBeNull();
    expect(memberForCode(list, 'A0812000000')).toBeNull();
    expect(memberForCode(list, '')).toBeNull();
  });
});

describe('memberSearchText / memberAddress', () => {
  it('search covers the address', () => {
    expect(memberSearchText({ name: 'คุณเอ', address: '45 ถ.มิตรภาพ นครราชสีมา' })).toContain('นครราชสีมา');
  });
  it('address falls back to the tax address', () => {
    expect(memberAddress({ address: '  ', taxAddress: 'ที่อยู่ใบกำกับ' })).toBe('ที่อยู่ใบกำกับ');
    expect(memberAddress({ address: 'บ้าน', taxAddress: 'x' })).toBe('บ้าน');
    expect(memberAddress({})).toBe('');
  });
});
