import { describe, expect, it } from 'vitest';
import { orderCustomerName } from '../order-customer';

describe('orderCustomerName (POS history / bills list customer column)', () => {
  it('a member bill from GET /orders: the member relation name (the bill has no customerName)', () => {
    expect(orderCustomerName({ customer: { name: 'คุณสมหญิง ใจดี' } })).toBe('คุณสมหญิง ใจดี');
  });
  it('the member name wins over a stale name kept on the bill', () => {
    expect(orderCustomerName({ customer: { name: 'ชื่อใหม่' }, customerName: 'ชื่อเก่า' })).toBe('ชื่อใหม่');
  });
  it('a bill object of the POS itself (customerName only) keeps its name', () => {
    expect(orderCustomerName({ customer: null, customerName: 'ร้านช่างแดง' })).toBe('ร้านช่างแดง');
  });
  it('legacy string customer', () => {
    expect(orderCustomerName({ customer: 'คุณเอ' })).toBe('คุณเอ');
  });
  it('walk-in: null (the screen shows ลูกค้าทั่วไป)', () => {
    expect(orderCustomerName({ customer: null })).toBeNull();
    expect(orderCustomerName({ customer: { name: '  ' }, customerName: '' })).toBeNull();
    expect(orderCustomerName(null)).toBeNull();
  });
});
