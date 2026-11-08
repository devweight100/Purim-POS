import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { parsePaymentDate, PayablesService, SUPPLIER_PAYMENT_METHODS } from './payables.service';
import { summarizeReturnItems, resolveCreditAmount, statusForRemaining } from '../supplier-returns/supplier-returns.service';
import { checkCreditFields } from '../customers/customers.controller';
import { cleanSupplierInput } from '../suppliers/suppliers.service';
import { cleanBankInput } from '../bank-accounts/bank-accounts.service';

describe('supplier payment checks', () => {
  it('only real money methods', () => {
    expect(SUPPLIER_PAYMENT_METHODS).toEqual(['CASH', 'TRANSFER', 'QR_PROMPTPAY']);
  });
  it('payment date: valid, not in the future', () => {
    const now = new Date('2026-11-07T10:00:00Z');
    expect(parsePaymentDate(undefined, now)).toBe(now);
    expect(parsePaymentDate('2026-11-07', now).toISOString()).toBe('2026-11-07T00:00:00.000Z');
    expect(() => parsePaymentDate('2030-01-01', now)).toThrow(BadRequestException);
    expect(() => parsePaymentDate('garbage', now)).toThrow(BadRequestException);
    expect(() => parsePaymentDate(12345, now)).toThrow(BadRequestException);
  });
});

describe('supplier return credit note maths', () => {
  it('totals come from items', () => {
    expect(summarizeReturnItems([
      { itemType: 'OVERSTOCK', quantity: 5, unitCost: 50 },
      { itemType: 'DEFECTIVE', quantity: 2, unitCost: 10.005 },
    ])).toEqual({ totalQuantity: 7, defectiveTotalCost: 20.01, overstockTotalCost: 250, itemsTotal: 270.01 });
  });
  it('credit may be lower than the items, never higher or negative', () => {
    expect(resolveCreditAmount(undefined, 250)).toBe(250);
    expect(resolveCreditAmount(200, 250)).toBe(200);
    expect(() => resolveCreditAmount(99999, 250)).toThrow(BadRequestException);
    expect(() => resolveCreditAmount(-500, 250)).toThrow(BadRequestException);
    expect(() => resolveCreditAmount('abc', 250)).toThrow(BadRequestException);
  });
  it('status follows remaining credit', () => {
    expect(statusForRemaining(250, 250)).toBe('PENDING');
    expect(statusForRemaining(150, 250)).toBe('PARTIALLY_USED');
    expect(statusForRemaining(0, 250)).toBe('USED');
  });
});

describe('cancelVoucher', () => {
  it('does not revive a CANCELLED credit note', async () => {
    const updates: any[] = [];
    const tx: any = {
      $executeRaw: jest.fn(),
      paymentVoucher: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', voucherNumber: 'PV1', status: 'ACTIVE', items: [], debitNotes: [{ returnNoteId: 'n1', amountDeducted: 100 }] }),
        update: jest.fn().mockResolvedValue({ id: 'v1' }),
      },
      supplierReturnNote: {
        findUnique: jest.fn().mockResolvedValue({ id: 'n1', status: 'CANCELLED', remainingCreditAmount: 0, totalAmount: 250 }),
        update: jest.fn((a) => updates.push(a)),
      },
      moneyTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    await new PayablesService(prisma).cancelVoucher('v1', 'x');
    expect(updates).toHaveLength(0);
  });
});

describe('customer credit fields', () => {
  const cashier = { role: 'CASHIER', permissions: ['POS_SELL', 'MANAGE_CLAIMS'] };
  const manager = { role: 'CASHIER', permissions: ['MANAGE_DEBTS'] };
  it('cashier cannot change credit, may resend the same values', () => {
    expect(() => checkCreditFields({ creditLimit: 999999 }, { creditLimit: 500 }, cashier)).toThrow(ForbiddenException);
    expect(() => checkCreditFields({ isCreditBlocked: false }, { isCreditBlocked: true }, cashier)).toThrow(ForbiddenException);
    expect(checkCreditFields({ creditLimit: 500, isCreditBlocked: true }, { creditLimit: 500, isCreditBlocked: true }, cashier)).toEqual({ creditLimit: 500, isCreditBlocked: true });
  });
  it('MANAGE_DEBTS may change; values validated', () => {
    expect(checkCreditFields({ creditLimit: '1000' }, {}, manager)).toEqual({ creditLimit: 1000 });
    expect(() => checkCreditFields({ creditLimit: -1 }, {}, manager)).toThrow(BadRequestException);
    expect(() => checkCreditFields({ creditLimit: 'abc' }, {}, manager)).toThrow(BadRequestException);
  });
});

describe('supplier / bank input', () => {
  it('supplier validation', () => {
    expect(() => cleanSupplierInput({}, false)).toThrow(BadRequestException);
    expect(() => cleanSupplierInput({ name: 'a', email: 'not-an-email' }, false)).toThrow(BadRequestException);
    expect(() => cleanSupplierInput({ name: 'a', phone: 'abc' }, false)).toThrow(BadRequestException);
    expect(() => cleanSupplierInput({ name: 'a', creditTerms: -30 }, false)).toThrow(BadRequestException);
    expect(cleanSupplierInput({ name: ' a ', phone: '+66 2-123', creditTerms: '30', id: 'x' }, false)).toEqual({ name: 'a', phone: '+66 2-123', creditTerms: 30 });
  });
  it('bank validation', () => {
    expect(() => cleanBankInput({}, false)).toThrow(BadRequestException);
    expect(() => cleanBankInput({}, true)).toThrow(BadRequestException);
    expect(cleanBankInput({ bankName: 'K', accountName: 'A', accountNumber: '123-4', isDefault: true }, false)).toEqual({ bankName: 'K', accountName: 'A', accountNumber: '123-4', isDefault: true });
  });
});
