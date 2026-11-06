/**
 * End-to-end store flow against a real PostgreSQL test database.
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:5433/pos_test npm run test:e2e
 *
 * Use a NEW, EMPTY database (e.g. `createdb pos_test`): the suite runs `prisma migrate deploy`
 * and the seed itself. SAFETY: the database name must contain "test" (otherwise the suite is
 * skipped) and it refuses to run when the database already has sales.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';

const dbName = (() => { try { return new URL(process.env.DATABASE_URL || '').pathname.slice(1); } catch { return ''; } })();
const enabled = /test/i.test(dbName);
const d = enabled ? describe : describe.skip;
jest.setTimeout(120000);

d('store flow (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let A = ''; // admin token
  let C = ''; // cashier token
  const api = (method: 'get' | 'post' | 'patch' | 'put', path: string, token?: string, body?: any) => {
    const r = (http as any)[method]('/api' + path);
    if (token) r.set('Authorization', 'Bearer ' + token);
    return body ? r.send(body) : r;
  };
  const state: Record<string, any> = {};

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore', env: process.env });
    const prisma = new PrismaClient();
    const existing = await prisma.order.count();
    await prisma.$disconnect();
    if (existing > 0) throw new Error(`Test database "${dbName}" already has data — create a fresh empty database for e2e tests`);
    execSync('npx prisma db seed', { stdio: 'ignore', env: process.env });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(async () => { await app?.close(); });

  describe('security', () => {
    it('blocks public registration', async () => {
      await api('post', '/auth/register', undefined, { username: 'x', password: 'x', fullName: 'x', role: 'ADMIN' }).expect(401);
    });
    it('forces a password change after logging in with the default password', async () => {
      const r = await api('post', '/auth/login', undefined, { username: 'admin', password: 'admin123' }).expect(201);
      expect(r.body.user.mustChangePassword).toBe(true);
      await api('get', '/products', r.body.access_token).expect(403);
      await api('post', '/auth/change-password', r.body.access_token, { currentPassword: 'admin123', newPassword: 'Admin@test99', newPin: '7391' }).expect(201);
      A = (await api('post', '/auth/login', undefined, { username: 'admin', password: 'Admin@test99' }).expect(201)).body.access_token;
      const c = await api('post', '/auth/login', undefined, { username: 'cashier1', password: 'cashier123' });
      await api('post', '/auth/change-password', c.body.access_token, { currentPassword: 'cashier123', newPassword: 'Cash@test99', newPin: '8264' }).expect(201);
      C = (await api('post', '/auth/login', undefined, { username: 'cashier1', password: 'Cash@test99' })).body.access_token;
    });
    it('cashier cannot change roles', async () => {
      const me = (await api('get', '/auth/me', C)).body;
      await api('patch', `/auth/users/${me.id}`, C, { role: 'ADMIN' }).expect(403);
    });
    it('locks PIN login after 5 wrong attempts', async () => {
      for (let i = 0; i < 5; i++) await api('post', '/auth/login-pin', undefined, { pin: String(9990 + i) }).expect(401);
      await api('post', '/auth/login-pin', undefined, { pin: '8264' }).expect(429);
    });
  });

  describe('selling', () => {
    it('opens a shift and sets opening balances', async () => {
      const accounts = (await api('get', '/finance/accounts', A).expect(200)).body;
      for (const a of accounts.filter((x: any) => x.type !== 'CASH_DRAWER')) {
        await api('post', `/finance/accounts/${a.id}/opening`, A, { clientId: randomUUID(), amount: a.type === 'CASH_SAFE' ? 3000 : a.type === 'BANK' ? 50000 : 0 }).expect(201);
      }
      state.safe = accounts.find((a: any) => a.type === 'CASH_SAFE');
      state.bank = accounts.find((a: any) => a.type === 'BANK');
      state.shift = (await api('post', '/shifts/open', C, { startingCash: 1000, terminalId: 'e2e-term' }).expect(201)).body.shift;
      const products = (await api('get', '/products?limit=100', A)).body;
      state.p = (Array.isArray(products) ? products : products.data)[0];
      state.price = Number(state.p.priceLevel1 ?? state.p.basePrice);
    });
    const stock = async () => Number((await api('get', `/products/${state.p.id}/stock`, A)).body.computedStock);
    it('cash sale deducts FIFO stock and records cost', async () => {
      const before = await stock();
      const r = await api('post', '/orders/checkout', C, { clientOrderId: randomUUID(), shiftId: state.shift.id, items: [{ productId: state.p.id, quantity: 3, unitPrice: state.price }], payments: [{ method: 'CASH', amount: state.price * 3 }] }).expect(201);
      expect(Number(r.body.totalCogs)).toBeGreaterThan(0);
      expect(await stock()).toBe(before - 3);
      state.order = r.body;
    });
    it('rejects a 0-baht credit line', async () => {
      await api('post', '/orders/checkout', C, { clientOrderId: randomUUID(), shiftId: state.shift.id, items: [{ productId: state.p.id, quantity: 1, unitPrice: state.price }], payments: [{ method: 'CASH', amount: state.price }, { method: 'CREDIT_DEBT', amount: 0 }] }).expect(400);
    });
    it('partial return: 1 of 3 back to stock, cash refunded from the drawer', async () => {
      const before = await stock();
      const item = state.order.items[0];
      const r = await api('post', `/orders/${state.order.id}/returns`, A, { clientReturnId: randomUUID(), items: [{ orderItemId: item.id, quantity: 1 }], refundMethod: 'CASH', shiftId: state.shift.id, reason: 'e2e' }).expect(201);
      expect(r.body.refundAmount).toBeCloseTo(state.price, 2);
      expect(await stock()).toBe(before + 1);
      await api('post', `/orders/${state.order.id}/returns`, A, { clientReturnId: randomUUID(), items: [{ orderItemId: item.id, quantity: 3 }], refundMethod: 'CASH', shiftId: state.shift.id, reason: 'too many' }).expect(400);
      await api('post', `/orders/${state.order.id}/void`, A, { reason: 'x' }).expect(400); // partially returned bills cannot be voided
    });
    it('credit sale, debt receipt and cancelling the receipt', async () => {
      const cust = (await api('post', '/customers', A, { name: 'E2E ลูกค้า', phone: '0800000001' })).body;
      const o = (await api('post', '/orders/checkout', C, { clientOrderId: randomUUID(), shiftId: state.shift.id, customerId: cust.id, items: [{ productId: state.p.id, quantity: 2, unitPrice: state.price }], payments: [{ method: 'CREDIT_DEBT', amount: state.price * 2 }] }).expect(201)).body;
      const pay = (await api('post', `/debts/${o.id}/pay`, C, { amount: state.price, paymentMethod: 'CASH', clientPaymentId: randomUUID(), shiftId: state.shift.id }).expect(201)).body;
      expect(Number(pay.debt.remainingAmount)).toBeCloseTo(state.price, 2);
      await api('post', `/debts/payments/${pay.payment.id}/cancel`, C, { reason: 'x' }).expect(403); // cashier may not cancel
      const cancelled = (await api('post', `/debts/payments/${pay.payment.id}/cancel`, A, { reason: 'รับผิดบิล' }).expect(201)).body;
      expect(Number(cancelled.debt.remainingAmount)).toBeCloseTo(state.price * 2, 2);
      await api('post', `/debts/payments/${pay.payment.id}/cancel`, A, { reason: 'again' }).expect(400);
    });
    it('closing the shift empties the drawer into the safe', async () => {
      const sum = (await api('get', `/shifts/${state.shift.id}/summary`, C)).body;
      await api('post', `/shifts/${state.shift.id}/close`, C, { actualCash: sum.expectedCash }).expect(201);
      const accounts = (await api('get', '/finance/accounts', A)).body;
      expect(accounts.find((a: any) => a.terminalId === 'e2e-term').balance).toBe(0);
      expect(accounts.find((a: any) => a.id === state.safe.id).balance).toBeCloseTo(3000 - 1000 + sum.expectedCash, 2);
    });
  });

  describe('manager approval', () => {
    const sale = (token: string, unitPrice: number, extra: any = {}, qty = 2) =>
      api('post', '/orders/checkout', token, {
        clientOrderId: randomUUID(), shiftId: state.shift2.id,
        items: [{ productId: state.p.id, quantity: qty, unitPrice }],
        payments: [{ method: 'CASH', amount: Math.round((unitPrice * qty - (extra.discountAmount || 0)) * 100) / 100 }], ...extra,
      });
    it('opens a second shift', async () => {
      state.shift2 = (await api('post', '/shifts/open', C, { startingCash: 500, terminalId: 'e2e-term-2' }).expect(201)).body.shift;
    });
    it('a 20% bill discount by a cashier needs approval (limit 10%)', async () => {
      const r = await sale(C, state.price, { discountAmount: Math.round(state.price * 2 * 0.2 * 100) / 100 }).expect(409);
      expect(r.body.code).toBe('APPROVAL_REQUIRED');
      expect(r.body.reasons.map((x: any) => x.code)).toContain('DISCOUNT_LIMIT');
      state.ticket = r.body.ticket;
    });
    it('the cashier cannot approve with their own PIN; the owner can', async () => {
      await api('post', '/approvals/pin', C, { ticket: state.ticket, pin: '8264' }).expect(403);
      const ok = await api('post', '/approvals/pin', C, { ticket: state.ticket, pin: '7391' }).expect(201);
      state.approvalId = ok.body.approvalId;
    });
    it('the approval works once, only for the same bill', async () => {
      const disc = Math.round(state.price * 2 * 0.2 * 100) / 100;
      await sale(C, state.price, { discountAmount: disc + 1, approvalId: state.approvalId }).expect(400); // bill changed
      const done = await sale(C, state.price, { discountAmount: disc, approvalId: state.approvalId }).expect(201);
      expect(done.body.id).toBeTruthy();
      await sale(C, state.price, { discountAmount: disc, approvalId: state.approvalId }).expect(400); // already used
    });
    it('selling below cost needs approval even with discount rights', async () => {
      const r = await sale(C, 0.5).expect(409);
      expect(r.body.reasons.map((x: any) => x.code)).toContain('BELOW_COST');
      state.ticket2 = r.body.ticket;
    });
    it('remote request: pending until a manager decides, then usable', async () => {
      const req = (await api('post', '/approvals/requests', C, { ticket: state.ticket2 }).expect(201)).body;
      expect(req.status).toBe('PENDING');
      await sale(C, 0.5, { approvalId: req.approvalId }).expect(400); // not approved yet
      await api('post', `/approvals/${req.approvalId}/decide`, C, { approve: true }).expect(403); // cashier cannot decide
      await api('post', `/approvals/${req.approvalId}/decide`, A, { approve: true, note: 'ล้างสต็อก' }).expect(201);
      expect((await api('get', `/approvals/${req.approvalId}`, C)).body.status).toBe('APPROVED');
      await sale(C, 0.5, { approvalId: req.approvalId }).expect(201);
    });
    it('the owner selling with a big discount needs no approval', async () => {
      const shiftA = (await api('post', '/shifts/open', A, { startingCash: 0, terminalId: 'e2e-term-admin' }).expect(201)).body.shift;
      await api('post', '/orders/checkout', A, { clientOrderId: randomUUID(), shiftId: shiftA.id, items: [{ productId: state.p.id, quantity: 1, unitPrice: state.price }], payments: [{ method: 'CASH', amount: state.price / 2 }], discountAmount: state.price / 2 }).expect(201);
    });
    it('lists approvals with requester and approver', async () => {
      const list = (await api('get', '/approvals', A).expect(200)).body.data;
      expect(list.filter((x: any) => x.status === 'USED').length).toBe(2);
    });
  });

  describe('purchasing', () => {
    it('PO → receive → supplier return note → pay with the credit deducted', async () => {
      const sup = (await api('post', '/suppliers', A, { name: 'E2E Supplier', creditTerms: 30 })).body;
      const po = (await api('post', '/purchase-orders', A, { supplierId: sup.id, status: 'ISSUED', items: [{ productId: state.p.id, quantity: 10, unitCost: 5 }] }).expect(201)).body;
      await api('post', `/payables/settle-multiple`, A, { clientVoucherId: randomUUID(), supplierId: sup.id, billsToSettle: [{ poId: po.id, amountToPay: 10 }], paymentMethod: 'TRANSFER' }).expect(400); // not received yet
      await api('post', `/purchase-orders/${po.id}/receive`, A, { clientReceiptId: randomUUID(), items: [{ purchaseOrderItemId: po.items[0].id, receivedQty: 10, unitCost: 5 }] }).expect(201);
      const note = (await api('post', '/supplier-returns', A, { supplierId: sup.id, linkedPoId: po.id, items: [{ productId: state.p.id, itemType: 'OVERSTOCK', quantity: 2, unitCost: 5, total: 10 }], totalCreditAmount: 10, deductStock: true })).body;
      expect(note.id || note.returnNumber).toBeTruthy();
      const notes = (await api('get', `/supplier-returns?supplierId=${sup.id}`, A)).body;
      const noteId = (notes.data || notes)[0].id;
      const v = await api('post', '/payables/settle-multiple', A, { clientVoucherId: randomUUID(), supplierId: sup.id, billsToSettle: [{ poId: po.id, amountToPay: 50 }], matchedDebitNotes: [{ returnNoteId: noteId, amountToDeduct: 10 }], paymentMethod: 'TRANSFER', moneyAccountId: state.bank.id }).expect(201);
      expect(Number(v.body.voucher.netPaidAmount)).toBe(40);
    });
  });

  describe('finance', () => {
    it('total money equals the sum of all accounts', async () => {
      const sum = (await api('get', '/finance/summary', A)).body;
      const accounts = (await api('get', '/finance/accounts', A)).body;
      expect(sum.balances.total).toBeCloseTo(accounts.reduce((s: number, a: any) => s + a.balance, 0), 2);
    });
    it('profit & loss adds up', async () => {
      const pl = (await api('get', '/finance/profit-loss', A)).body;
      const recomputed = pl.grossProfit - pl.claims.net - pl.stockWriteOff - pl.totalExpenses + pl.otherIncome + pl.cashOverShort + pl.accountAdjustments;
      expect(pl.netProfit).toBeCloseTo(recomputed, 2);
      expect(pl.returnsInclVat).toBeGreaterThan(0);
    });
    it('cash forecast ends at start + in - out', async () => {
      const fc = (await api('get', '/finance/forecast?days=30', A)).body;
      expect(fc.endCash).toBeCloseTo(fc.startCash + fc.totals.in - fc.totals.out, 2);
    });
  });
});
