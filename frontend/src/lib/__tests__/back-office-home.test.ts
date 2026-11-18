import { describe, expect, it } from 'vitest';
import { backOfficeHomeFor, BACK_OFFICE_HOMES } from '../permissions';

// POS "เมนูหลัก" opens the first back-office page the user may use, in the sidebar's group order
// (ภาพรวม & รายงาน -> สินค้า & คลังสินค้า -> งานขาย & ลูกค้า).
describe('backOfficeHomeFor', () => {
  it('follows the sidebar group order', () => {
    expect(BACK_OFFICE_HOMES).toEqual(['/dashboard', '/products', '/orders', '/customers', '/claims', '/shifts']);
  });

  it('admin and report users land on the dashboard', () => {
    expect(backOfficeHomeFor({ role: 'ADMIN', permissions: [] })).toBe('/dashboard');
    expect(backOfficeHomeFor({ role: 'MANAGER', permissions: ['ALL'] })).toBe('/dashboard');
    expect(backOfficeHomeFor({ role: 'CASHIER', permissions: ['VIEW_REPORTS', 'POS_SELL'] })).toBe('/dashboard');
  });

  it('a cashier without reports lands on the bills (seed cashier1 permissions)', () => {
    expect(backOfficeHomeFor({ role: 'CASHIER', permissions: ['POS_SELL', 'POS_DISCOUNT', 'MANAGE_CLAIMS'] })).toBe('/orders');
  });

  it('stock staff land on products, others on the first page they may open', () => {
    expect(backOfficeHomeFor({ role: 'CASHIER', permissions: ['POS_SELL', 'MANAGE_INVENTORY'] })).toBe('/products');
    expect(backOfficeHomeFor({ role: 'CASHIER', permissions: ['MANAGE_DEBTS'] })).toBe('/customers');
    expect(backOfficeHomeFor({ role: 'CASHIER', permissions: ['MANAGE_CLAIMS'] })).toBe('/claims');
  });

  it('no back-office page -> no button', () => {
    expect(backOfficeHomeFor({ role: 'CASHIER', permissions: [] })).toBeNull();
  });
});
