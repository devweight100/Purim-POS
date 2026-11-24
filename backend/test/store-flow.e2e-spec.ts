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
import * as httpModule from 'http';
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';
import * as legacy from './legacy/reports-client-legacy';
import * as legacyPayables from './legacy/payables-client-legacy';
import * as legacyClaims from './legacy/claims-client-legacy';
import * as legacyScreens from './legacy/claims-screens-legacy';
import { valueStock } from '../src/reports/reports.service';
import { ServerControlService } from '../src/server-control/server-control.service';
import { ProductsService } from '../src/products/products.service';
import { docPeriod, nextDocNumber } from '../src/common/doc-number';
import { realtimeBus, RealtimeEvent } from '../src/events/events.service';
import { LineStaffService, lineSignatureOk } from '../src/online-shop/line-staff.service';
import { LineService } from '../src/online-shop/line.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createHmac } from 'crypto';

// staff-alert timer off: the LINE group tests drive LineStaffService.runDue with their own clock
process.env.LINE_ALERT_TICK_MS = '0';
const dbName = (() => { try { return new URL(process.env.DATABASE_URL || '').pathname.slice(1); } catch { return ''; } })();
const enabled = /test/i.test(dbName);
const d = enabled ? describe : describe.skip;
jest.setTimeout(120000);

d('store flow (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let A = ''; // admin token
  let C = ''; // cashier token
  const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token?: string, body?: any) => {
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
    app = mod.createNestApplication({ rawBody: true }); // raw bytes for the LINE webhook signature (main.ts: captureLineRawBody)
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
    it('VAT on sales follows the store setting, not the terminal', async () => {
      const sell = async () => (await api('post', '/orders/checkout', C, { clientOrderId: randomUUID(), shiftId: state.shift.id, vatEnabled: true, items: [{ productId: state.p.id, quantity: 1, unitPrice: state.price }], payments: [{ method: 'CASH', amount: state.price }] }).expect(201)).body;
      const off = await sell();
      expect(Number(off.vatAmount)).toBe(0);
      expect(Number(off.vatRate)).toBe(0);
      await api('patch', '/settings', A, { vatEnabled: true }).expect(200);
      const on = await sell();
      expect(Number(on.vatRate)).toBe(7);
      expect(Number(on.vatAmount)).toBeCloseTo(Math.round((state.price * 7 / 107) * 100) / 100, 2);
      await api('patch', '/settings', A, { vatEnabled: false }).expect(200);
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
      const pay = (await api('post', `/debts/${o.id}/pay`, C, { amount: state.price, paymentMethod: 'CASH', clientPaymentId: randomUUID(), shiftId: state.shift.id, shiftChoice: 'POS' }).expect(201)).body;
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
    it('BUG-03: a device whose terminal id was lost finds its open shift and can continue it (not a live device elsewhere)', async () => {
      // the restarted device has a new id: no current shift there, but the shift is listed with its float
      expect((await api('get', '/shifts/current?terminalId=e2e-term-new', C).expect(200)).body).toEqual({});
      const rows = (await api('get', '/shifts/mine-elsewhere?terminalId=e2e-term-new', C).expect(200)).body;
      const row = rows.find((r: any) => r.id === state.shift2.id);
      expect(row).toMatchObject({ terminalId: 'e2e-term-2', startingCash: 500, canContinueHere: true, activeSecondsAgo: null });
      // only the caller's own shifts, never the asking terminal's own shift
      expect((await api('get', '/shifts/mine-elsewhere?terminalId=e2e-term-2', C).expect(200)).body.some((r: any) => r.id === state.shift2.id)).toBe(false);
      expect((await api('get', '/shifts/mine-elsewhere?terminalId=e2e-term-new', A).expect(200)).body.some((r: any) => r.id === state.shift2.id)).toBe(false);
      // heard from the same address a moment ago: that was this machine before its restart -> may continue
      await api('post', '/server-control/ping', C, { terminalId: 'e2e-term-2', terminalName: 'x' }).expect(201);
      expect((await api('get', '/shifts/mine-elsewhere?terminalId=e2e-term-new', C)).body.find((r: any) => r.id === state.shift2.id).canContinueHere).toBe(true);
      // alive at another address: another device uses it -> cannot be taken over
      await api('post', '/server-control/ping', C, { terminalId: 'e2e-term-2', terminalName: 'x' }).set('X-Forwarded-For', '10.9.9.9').expect(201);
      const live = (await api('get', '/shifts/mine-elsewhere?terminalId=e2e-term-new', C)).body.find((r: any) => r.id === state.shift2.id);
      expect(live).toMatchObject({ canContinueHere: false });
      expect(live.activeSecondsAgo).toBeLessThanOrEqual(5);
      // continuing = asking with the old id: the same shift, same float
      const cur = (await api('get', '/shifts/current?terminalId=e2e-term-2', C).expect(200)).body;
      expect(cur.shift.id).toBe(state.shift2.id);
      expect(Number(cur.startingCash ?? cur.shift.startingCash)).toBe(500);
      await api('post', '/server-control/ping', C, { terminalId: 'e2e-term-2', terminalName: 'x' }).expect(201); // back to this address
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
    it('BUG-06: supplier rows of the product form are saved on create and on update (were dropped by the whitelist)', async () => {
      const sup = (await api('post', '/suppliers', A, { name: 'บริษัททดสอบ จำกัด E2E' }).expect(201)).body;
      const made = (await api('post', '/products', A, { name: 'น้ำดื่มทดสอบ BUG06', basePrice: 20, priceLevel1: 20, costPrice: 12, unit: 'ขวด',
        supplierEntries: [{ supplierId: sup.id, unitCost: 12, supplierSku: 'S-1', isPreferred: true }] }).expect(201)).body;
      const sku = made.sku; // generated by the server; sending it back unchanged is fine
      const read = async () => (await api('get', `/products/${made.id}`, A).expect(200)).body;
      let p = await read();
      expect(p.supplierEntries.map((e: any) => [e.supplierId, Number(e.unitCost), e.supplierSku])).toEqual([[sup.id, 12, 'S-1']]);
      await api('patch', `/products/${made.id}`, A, { name: 'น้ำดื่มทดสอบ BUG06', sku, basePrice: 20, supplierEntries: [{ supplierId: sup.id, unitCost: 11 }] }).expect(200);
      p = await read();
      expect(p.supplierEntries.map((e: any) => Number(e.unitCost))).toEqual([11]);
      // omitted = kept
      await api('patch', `/products/${made.id}`, A, { name: 'น้ำดื่มทดสอบ BUG06', sku, basePrice: 20 }).expect(200);
      expect((await read()).supplierEntries).toHaveLength(1);
      // an unknown field inside a row is still refused like any bad input
      await api('patch', `/products/${made.id}`, A, { name: 'x', sku, basePrice: 20, supplierEntries: [{ supplierId: 5 }] }).expect(400);
    });
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

    it('purchase VAT per line: totals, stock cost incl. VAT, amount owed', async () => {
      const sup = (await api('post', '/suppliers', A, { name: 'E2E VAT Supplier', creditTerms: 30 })).body;
      const po = (await api('post', '/purchase-orders', A, {
        supplierId: sup.id,
        status: 'ISSUED',
        billDiscountType: 'baht',
        billDiscountValue: 10,
        items: [
          { productId: state.p.id, quantity: 10, unitCost: 10, vatType: 'EXCLUDED', vatRate: 7 }, // 100 (-5 bill disc) +VAT
          { productId: state.p.id, quantity: 10, unitCost: 10, vatType: 'NONE' }, // 100 (-5)
        ],
      }).expect(201)).body;
      expect(Number(po.subtotalAmount)).toBe(190);
      expect(Number(po.vatAmount)).toBe(6.65);
      expect(Number(po.totalAmount)).toBe(196.65);
      await api('post', `/purchase-orders/${po.id}/receive`, A, {
        clientReceiptId: randomUUID(),
        items: po.items.map((i: any) => ({ purchaseOrderItemId: i.id, receivedQty: 10, unitCost: 10 })),
      }).expect(201);
      const detail = (await api('get', `/purchase-orders/${po.id}`, A)).body;
      const costs = detail.stockBatches.map((b: any) => Number(b.unitCost)).sort((a: number, b: number) => a - b);
      // shop is not VAT-registered: VAT is part of the stock cost; bill discount lowers it
      expect(costs).toEqual([9.5, 10.165]);
      const bills = (await api('get', `/payables/bills?supplierId=${sup.id}`, A)).body;
      const bill = (bills.data || bills).find((b: any) => b.poId === po.id);
      expect(Number(bill.remainingPayable)).toBe(196.65);
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
  describe('reports: GET /reports/tabs equals what the Reports page computed in the browser', () => {
    const day = 86400000;
    const bkkDay = (t: number) => new Date(t + 7 * 3600000).toISOString().slice(0, 10);
    it('adds back-dated and discounted bills, a transfer sale and a return in another period', async () => {
      state.shift3 = (await api('post', '/shifts/open', A, { startingCash: 0, terminalId: 'e2e-term-3' }).expect(201)).body.shift;
      const sell = (createdAt: string, qty: number, extra: any, method = 'CASH') =>
        api('post', '/orders/checkout', A, {
          clientOrderId: randomUUID(), shiftId: state.shift3.id, createdAt,
          items: [{ productId: state.p.id, quantity: qty, unitPrice: state.price, ...(extra.line || {}) }],
          payments: [{ method, amount: Math.round((state.price * qty - (extra.line?.discountAmount || 0) - (extra.discountAmount || 0)) * 100) / 100 }],
          ...(extra.discountAmount ? { discountAmount: extra.discountAmount } : {}),
        }).expect(201);
      const old = (await sell(new Date(Date.now() - 40 * day).toISOString(), 3, { discountAmount: 2.5, line: { discountAmount: 1.25 } }, 'TRANSFER')).body;
      await sell(new Date(Date.now() - 400 * day).toISOString(), 1, {});
      await sell(new Date(Date.now() - 3 * day).toISOString(), 2, { discountAmount: 1 }, 'QR_PROMPTPAY');
      // returned today, sold 40 days ago: counts in today's period, not the bill's
      await api('post', `/orders/${old.id}/returns`, A, { clientReturnId: randomUUID(), items: [{ orderItemId: old.items[0].id, quantity: 1 }], refundMethod: 'CASH', shiftId: state.shift3.id, reason: 'e2e parity' }).expect(201);
    });

    /**
     * The old page's figures (frozen client code fed with what the page downloaded) against GET /reports/tabs.
     * Long lists are paged on the server now: every page is fetched (small pages, to cross page borders)
     * and compared with the old full list. Rows with the same sort value may come in another order
     * (the old order was the database's heap order), so a ranked list is checked as: the same sequence
     * of sort values + the same rows.
     */
    const expectParity = async () => {
      const unwrap = (b: any) => (Array.isArray(b?.data) ? b.data : Array.isArray(b) ? b : []);
      // what the old page downloaded
      const analytics = (await api('get', '/reports/analytics', A).expect(200)).body;
      const [claims, debts, customers, shifts, suppliers, rawProducts] = await Promise.all(
        ['/claims?limit=5000', '/debts?limit=5000', '/customers?limit=5000', '/shifts/history?limit=1000', '/suppliers', '/products'].map(async (p) => unwrap((await api('get', p, A).expect(200)).body)),
      );
      const products = legacy.legacyFormatProducts(rawProducts);
      const rawOrders = analytics.orders;
      const json = (v: any) => JSON.parse(JSON.stringify(v));
      // totals the old code left unrounded (sum of floats): their last bits depended on the row order of
      // the database (heap order), so they are compared to 1e-6
      const fuzz = (v: any): any => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : Array.isArray(v) ? v.map(fuzz) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fuzz(x)])) : v);
      const byId = (rows: any[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const ranked = (label: string, got: any[], exp: any[], key: string) => {
        expect({ label, values: got.map((r) => r[key]) }).toEqual({ label, values: exp.map((r) => r[key]) });
        expect({ label, rows: byId(got) }).toEqual({ label, rows: byId(json(exp)) });
      };
      // a top-N list: same sort values; each row equals the old row of that product
      const top = (label: string, got: any[], exp: any[], key: string, all: any[]) => {
        expect({ label, values: got.map((r) => r[key]) }).toEqual({ label, values: exp.map((r) => r[key]) });
        const old = new Map(json(all).map((r: any) => [r.id, r]));
        for (const r of got) expect({ label, row: r }).toEqual({ label, row: old.get(r.id) });
      };
      const pages = async (q: URLSearchParams, tab: string, key: string, extra: Record<string, string> = {}) => {
        const rows: any[] = [];
        let first: any;
        for (let page = 1; page < 1000; page++) {
          const p = new URLSearchParams({ ...Object.fromEntries(q), tab, limit: '3', page: String(page), ...extra });
          const b = (await api('get', `/reports/tabs?${p}`, A).expect(200)).body[tab];
          first ||= b;
          expect(b.page).toBe(page);
          rows.push(...b[key]);
          if (b[key].length < 3) break;
        }
        expect(rows.length).toBe(first.total);
        return { first, rows };
      };

      const periods: [string, string?, string?][] = [
        ['today'], ['yesterday'], ['7days'], ['30days'], ['thisMonth'], ['lastMonth'], ['thisYear'], ['all'],
        ['custom', bkkDay(Date.now() - 45 * day), bkkDay(Date.now() - day)],
        ['custom', bkkDay(Date.now() - 45 * day)],
      ];
      for (const [timeRange, customStart, customEnd] of periods) {
        const tr = timeRange as any;
        // ReportsView.tsx (before): the same memo chain
        const filteredOrders = legacy.filterOrdersByDateRange(rawOrders, tr, customStart, customEnd);
        const rangeReturns = legacy.returnsInRange(rawOrders, tr, customStart, customEnd);
        const { start, end } = legacy.reportRangeBounds(tr, customStart, customEnd);
        const inRange = (iso: string) => { const t = new Date(iso).getTime(); return isNaN(t) || (t >= start && t < end); };
        const events = legacy.filterOrdersByDateRange(analytics.claimAccounting.events, tr, customStart, customEnd);
        const recoveries = legacy.filterOrdersByDateRange(analytics.claimAccounting.supplierRecoveries, tr, customStart, customEnd);
        const replacementCost = events.reduce((sum: number, e: any) => sum + (Number(e.replacementCost) || 0), 0);
        const refundsPaid = events.reduce((sum: number, e: any) => sum + (Number(e.refundPaid) || 0), 0);
        const supplierRecovery = recoveries.reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
        const expected: Record<string, any> = json({
          sales: legacy.calculateSalesAndProfitReport(filteredOrders, products, rangeReturns),
          claimsAndVat: { replacementCost, refundsPaid, supplierRecovery, claimNetCost: replacementCost + refundsPaid - supplierRecovery, ...legacy.calculateVatSummary(filteredOrders, rangeReturns) },
          bestsellers: legacy.calculateBestSellingProducts(filteredOrders, products, rangeReturns),
          inventory: legacy.calculateInventoryValuationReport(products, rawOrders, analytics.stockBatchValuation.byProductId, { lowStockThreshold: analytics.lowStockThreshold, lastReceivedAtByProduct: analytics.lastReceivedAtByProduct }),
          payments: legacy.calculatePaymentsAndShiftsReport(filteredOrders, shifts, { returns: rangeReturns, debtReceipts: analytics.debtReceipts, inRange }),
          customers: legacy.calculateCustomerAndDebtsReport(filteredOrders, debts, customers),
          purchases: legacy.calculatePurchasesAndClaimsReport(analytics.purchases, legacy.filterOrdersByDateRange(claims, tr, customStart, customEnd), suppliers, inRange),
        });
        const q = new URLSearchParams({ range: timeRange, ...(customStart ? { start: customStart } : {}), ...(customEnd ? { end: customEnd } : {}) });
        const got = (await api('get', `/reports/tabs?${q}`, A).expect(200)).body;
        const label = `${timeRange} ${customStart || ''} ${customEnd || ''}`;
        const without = (o: any, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

        for (const k of ['sales', 'claimsAndVat', 'purchases']) {
          expect({ label, tab: k, value: got[k] }).toEqual({ label, tab: k, value: expected[k] });
        }
        // payments: the per-shift list is no longer sent (the page never showed it)
        delete expected.payments.shifts.list;
        expect({ label, tab: 'payments', value: got.payments }).toEqual({ label, tab: 'payments', value: expected.payments });

        // best sellers: totals over every product + one page per sort
        const eb = expected.bestsellers;
        const gb = got.bestsellers;
        expect(gb.productCount).toBe(eb.allProducts.length);
        const sum = (rows: any[], k: string) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
        expect(gb.totals.quantity).toBeCloseTo(eb.allProducts.reduce((s: number, r: any) => s + r.quantitySold, 0), 6);
        expect(gb.totals.revenue).toBe(sum(eb.allProducts, 'totalRevenue'));
        expect(gb.totals.cost).toBe(sum(eb.allProducts, 'totalCost'));
        top(`${label} topByQuantity`, gb.topByQuantity, eb.topByQuantity, 'quantitySold', eb.allProducts);
        top(`${label} topByProfit`, gb.topByProfit, eb.topByProfit, 'totalProfit', eb.allProducts);
        top(`${label} topByRevenue`, gb.topByRevenue, eb.topByRevenue, 'totalRevenue', eb.allProducts);
        const sorts: [string, string][] = [['quantity', 'quantitySold'], ['revenue', 'totalRevenue'], ['profit', 'totalProfit']];
        for (const [sort, key] of sorts) {
          const { rows } = await pages(q, 'bestsellers', 'allProducts', { sort });
          ranked(`${label} bestsellers ${sort}`, rows, [...eb.allProducts].sort((a: any, b: any) => b[key] - a[key]), key);
        }

        // inventory: totals as before; items / deadstock / low stock come as paged lists
        const ei = expected.inventory;
        expect({ label, inv: fuzz(without(got.inventory, 'items', 'list', 'listCounts', 'total', 'page', 'limit')) })
          .toEqual({ label, inv: fuzz(without(ei, 'items', 'deadstockList', 'lowStockList')) });
        expect(got.inventory.listCounts).toEqual({ all: ei.items.length, deadstock: ei.deadstockList.length, lowstock: ei.lowStockList.length });
        ranked(`${label} inventory all`, (await pages(q, 'inventory', 'items')).rows, ei.items, 'totalCostValue');
        ranked(`${label} inventory deadstock`, (await pages(q, 'inventory', 'items', { list: 'deadstock' })).rows, ei.deadstockList, 'totalCostValue');
        ranked(`${label} inventory lowstock`, (await pages(q, 'inventory', 'items', { list: 'lowstock' })).rows, ei.lowStockList, 'stock');

        // customers: aging and totals as before; the unpaid-bill list is no longer sent
        const ec = expected.customers;
        const gc = got.customers;
        expect({ label, aging: fuzz([gc.totalOutstandingDebt, gc.unpaidBillsCount, gc.agingBuckets]) }).toEqual({ label, aging: fuzz([ec.totalOutstandingDebt, ec.unpaidBillsCount, ec.agingBuckets]) });
        expect(gc.customerCount).toBe(ec.allCustomers.length);
        expect(gc.totalSpentAll).toBe(sum(ec.allCustomers, 'totalSpent'));
        top(`${label} topCustomers`, gc.topCustomers, ec.topCustomers, 'totalSpent', ec.allCustomers);
        ranked(`${label} customers`, (await pages(q, 'customers', 'allCustomers')).rows, ec.allCustomers, 'totalSpent');

        // one tab at a time (what the page asks for) gives the same figures
        const one = (await api('get', `/reports/tabs?${q}&tab=payments`, A).expect(200)).body;
        expect(one.payments).toEqual(got.payments);
        expect(one.sales).toBeUndefined();
      }
      return rawOrders.length;
    };

    state.expectParity = expectParity;
    it('every tab, every period: same numbers as the old client-side functions', async () => {
      expect(await expectParity()).toBeGreaterThan(5);
      // the data really exercised the netting rules
      const all = (await api('get', '/reports/tabs?range=all', A)).body;
      expect(all.sales.totalReturns).toBeGreaterThan(0);
      expect(all.sales.totalDiscounts).toBeGreaterThan(0);
      expect(all.purchases.totalPurchasesOverall).toBeGreaterThan(0);
      expect(all.customers.totalOutstandingDebt).toBeGreaterThan(0);
      expect(all.payments.shifts.totalShiftsCount).toBeGreaterThan(0);
    });

    it('rejects bad parameters with 400', async () => {
      await api('get', '/reports/tabs?range=week', A).expect(400);
      await api('get', '/reports/tabs?range=custom&start=2026-02-30', A).expect(400);
      await api('get', '/reports/tabs?tab=nope', A).expect(400);
    });
  });

  describe('mobile summary (/m): read-only endpoints', () => {
    it('product lookup: stock, packs, prices; VIEW_REPORTS needed; cost only with VIEW_COST', async () => {
      const r = (await api('get', `/products/lookup?q=${encodeURIComponent(state.p.sku)}`, A).expect(200)).body;
      const hit = r.data.find((x: any) => x.id === state.p.id);
      expect(hit).toBeDefined();
      expect(hit.stock).toBe(Number((await api('get', `/products/${state.p.id}/stock`, A)).body.computedStock));
      expect(hit.prices[0]).toBe(state.price);
      expect(typeof hit.costPrice).toBe('number');
      expect(r.canViewCost).toBe(true);
      expect(r.meta.counts.all).toBeGreaterThanOrEqual(1);
      // filters agree with the dashboard's low / out counts
      const dash = (await api('get', '/reports/dashboard?range=today', A)).body;
      const low = (await api('get', '/products/lookup?filter=low&limit=1', A)).body;
      expect(low.meta.total).toBe(dash.inventory.lowStockCount);
      expect((await api('get', '/products/lookup?filter=out&limit=1', A)).body.meta.total).toBe(dash.inventory.outOfStockCount);
      await api('get', '/products/lookup?filter=nope', A).expect(400);
      // the seeded cashier has no VIEW_REPORTS
      await api('get', '/products/lookup', C).expect(403);
      // a viewer with VIEW_REPORTS but not VIEW_COST gets no cost
      await api('post', '/auth/register', A, { username: 'viewer1', password: 'View@test99', fullName: 'ผู้ดู', role: 'CASHIER', permissions: ['VIEW_REPORTS'] }).expect(201);
      const V = (await api('post', '/auth/login', undefined, { username: 'viewer1', password: 'View@test99' }).expect(201)).body.access_token;
      const v = (await api('get', `/products/lookup?q=${encodeURIComponent(state.p.sku)}`, V).expect(200)).body;
      expect(v.canViewCost).toBe(false);
      expect(JSON.stringify(v.data)).not.toMatch(/costPrice|unitCost/);
    });

    it('dashboard: top N, previous period and hours of a one-day period', async () => {
      const today = (await api('get', '/reports/dashboard?range=today&top=10&compare=1', A).expect(200)).body;
      expect(today.hourly).toHaveLength(24);
      const hourSum = today.hourly.reduce((s: number, h: any) => s + h.netSales, 0);
      expect(Math.round(hourSum * 100) / 100).toBe(today.sales.netSales);
      expect(today.hourly.reduce((s: number, h: any) => s + h.orders, 0)).toBe(today.sales.completedCount);
      expect(today.previous).toMatchObject({ netSales: expect.any(Number), completedCount: expect.any(Number) });
      expect(today.topProducts.length).toBeLessThanOrEqual(10);
      const plain = (await api('get', '/reports/dashboard?range=today', A)).body;
      expect(plain.previous).toBeNull();
      expect(plain.sales.netSales).toBe(today.sales.netSales);
      expect((await api('get', '/reports/dashboard?range=7days', A)).body.hourly).toBeNull();
    });

    it('bill detail never carries the password / PIN hashes', async () => {
      const list = (await api('get', '/orders?limit=1', A)).body;
      const o = (await api('get', `/orders/${list.data[0].id}`, A).expect(200)).body;
      expect(o.user.fullName).toBeTruthy();
      expect(o.user.password).toBeUndefined();
      expect(o.user.pinCode).toBeUndefined();
    });
  });

  /**
   * Edge cases written straight into the database (shapes the POS rarely makes but old data has):
   * Bangkok midnight borders, PENDING / payment-less / zero-subtotal / voided bills, packs (base qty),
   * returns without lines, DEBT_REDUCTION / TRANSFER refunds, return-only products, equal best
   * sellers, same-name customers (debt by name), imported customer figures as strings, debts of every
   * age, oversold / zero-cost / inactive / bundle products, open + closed shifts, claims with string
   * figures, cancelled return notes, expense reversals, drawer vs bank adjustments, write-offs.
   * Then the parity check runs again, and the P&L parts moved to SQL are checked against the old loops.
   */
  describe('reports: tricky dataset (old JS == new SQL)', () => {
    const day = 86400000;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    it('adds edge-case rows straight into the database', async () => {
      const db = new PrismaClient();
      try {
        const now = Date.now();
        const bkkToday = new Date(now + 7 * 3600000).toISOString().slice(0, 10);
        const todayStart = Date.parse(`${bkkToday}T00:00:00+07:00`);
        const monthStart = Date.parse(`${bkkToday.slice(0, 8)}01T00:00:00+07:00`);
        const admin = await db.user.findFirstOrThrow({ where: { username: 'admin' } });
        const cat = await db.category.create({ data: { name: 'E2E หมวดพิเศษ' } });
        const mk = (sku: string, data: any = {}) => db.product.create({ data: { name: `E2E ${sku}`, sku, basePrice: 100, costPrice: 40, categoryId: cat.id, ...data } });
        const pA = await mk('TRK-A');
        const pB = await mk('TRK-B');
        const pPack = await mk('TRK-PACK', { unit: '', priceLevel1: 0, basePrice: 55.5 });
        const pRet = await mk('TRK-RET', { categoryId: null });
        const pDead = await mk('TRK-DEAD');
        const pNew = await mk('TRK-NEW', { priceLevel1: 77.77 });
        const pOver = await mk('TRK-OVER');
        const pZero = await mk('TRK-ZERO', { costPrice: 12.34 });
        const pOff = await mk('TRK-OFF', { isActive: false });
        await mk('TRK-BUNDLE', { isBundle: true });
        const batch = (p: any, qty: number, cost: number, daysAgo: number, rem = qty) =>
          db.stockBatch.create({ data: { productId: p.id, quantityReceived: qty, quantityRemaining: rem, unitCost: cost, receivedAt: new Date(now - daysAgo * day) } });
        await batch(pA, 100, 33.3333, 60);
        await batch(pB, 100, 33.3333, 60);
        await batch(pPack, 240, 3.5, 50);
        await batch(pDead, 10, 30, 40);
        await batch(pNew, 3, 20, 2);
        await batch(pOver, 2, 10, 45);
        await batch(pOver, 0, 10, 44, -5);
        await batch(pZero, 4, 0, 45);
        await batch(pOff, 6, 9.99, 45);

        const sup = await db.supplier.create({ data: { name: 'E2E Tricky Supplier' } });
        const mkCustomer = (name: string, phone: string | null, profile: any = null) => db.customer.create({ data: { name, phone, profile } });
        const cCode = await mkCustomer('E2E รหัส', '0811111111', { code: 'VIP-1', totalSpent: '1234.5', totalOrders: 3, lastPurchaseDate: '2026-01-02' });
        const cDup1 = await mkCustomer('E2E ซ้ำ', '0822222222');
        const cDup2 = await mkCustomer('E2E ซ้ำ', null, { customerCode: 'DUP-2' });
        await mkCustomer('E2E แคตตาล็อก', '0833333333', { totalSpent: 500, totalOrders: '2', customerCode: 'C-9' });

        const shiftOpen = await db.shift.create({ data: { shiftNumber: 'TRK-S1', userId: admin.id, terminalId: 'trk-1', startingCash: 200, openedAt: new Date(todayStart + 3600000) } });
        const shiftClosed = await db.shift.create({ data: {
          shiftNumber: 'TRK-S2', userId: admin.id, terminalId: 'trk-2', startingCash: 500, status: 'CLOSED', actualCash: 632.55,
          openedAt: new Date(now - 3 * day), closedAt: new Date(now - 2 * day),
        } });
        await db.cashMovement.createMany({ data: [
          { shiftId: shiftOpen.id, type: 'IN', amount: 100, reason: 'เงินทอน' },
          { shiftId: shiftOpen.id, type: 'OUT', amount: 30, category: 'REFUND', reason: 'คืนเงิน' },
        ] });

        let n = 0;
        const order = async (o: { at: number; status?: any; customerId?: string; shiftId?: string; discount?: number; vat?: number; cogs?: number; subtotal?: number;
          items: { p: any; qty: number; price: number; base?: number; unitName?: string; disc?: number; cost?: number }[]; pays?: { method: any; amount: number }[] }) => {
          const lines = o.items.map((i) => ({ productId: i.p.id, quantity: i.qty, baseQuantity: i.base ?? null, unitName: i.unitName ?? null, unitPrice: i.price, discountAmount: i.disc ?? 0, unitCost: i.cost ?? 40, total: r2(i.qty * i.price - (i.disc ?? 0)) }));
          const subtotal = o.subtotal ?? r2(lines.reduce((s, l) => s + l.total, 0));
          return db.order.create({
            data: {
              orderNumber: `TRK-${++n}`, userId: admin.id, customerId: o.customerId, shiftId: o.shiftId, status: o.status ?? 'COMPLETED',
              subtotal, discountAmount: o.discount ?? 0, totalAmount: r2(subtotal - (o.discount ?? 0)), totalCogs: o.cogs ?? 0, vatAmount: o.vat ?? 0, vatRate: o.vat ? 7 : 0,
              createdAt: new Date(o.at), items: { create: lines }, payments: { create: o.pays ?? [] },
            },
            include: { items: true },
          });
        };
        const ret = (o: any, at: number, method: string, amount: number, extra: { vat?: number; cogs?: number; items?: any[] } = {}) =>
          db.orderReturn.create({ data: {
            returnNumber: `TRK-R${++n}`, orderId: o.id, refundMethod: method, refundAmount: amount, vatAmount: extra.vat ?? 0, cogsReturned: extra.cogs ?? 0,
            reason: 'tricky', createdAt: new Date(at), items: { create: extra.items ?? [] },
          } });

        // midnight borders: exactly 00:00 Bangkok today, 1 ms before (yesterday); start of the month and 1 ms before
        const o1 = await order({ at: todayStart, shiftId: shiftOpen.id, discount: 10.55, vat: 18.61, cogs: 120,
          items: [{ p: pA, qty: 3, price: 100, disc: 5 }], pays: [{ method: 'CASH', amount: 100 }, { method: 'CREDIT_CARD', amount: 184.45 }] });
        await order({ at: todayStart - 1, discount: 10.55, cogs: 120, items: [{ p: pB, qty: 3, price: 100, disc: 5 }], pays: [{ method: 'CREDIT_NOTE', amount: 284.45 }] });
        await order({ at: monthStart, cogs: 12.34, items: [{ p: pZero, qty: 1, price: 19.5, cost: 12.34 }], pays: [{ method: 'QR_PROMPTPAY', amount: 19.5 }] });
        await order({ at: monthStart - 1, cogs: 12.34, items: [{ p: pZero, qty: 1, price: 19.5, cost: 12.34 }], pays: [{ method: 'TRANSFER', amount: 19.5 }] });
        // PENDING bill of packs (12 per pack) without any payment row: counts as a cash sale
        await order({ at: now - 3600000, status: 'PENDING', customerId: cDup1.id, cogs: 84, items: [{ p: pPack, qty: 2, base: 24, unitName: 'โหล', price: 600, cost: 3.5 }] });
        // zero subtotal (free goods) and a voided bill (with a return that must be ignored) from the closed shift
        await order({ at: now - 2 * 3600000, subtotal: 0, items: [{ p: pA, qty: 1, price: 0 }] });
        const o5 = await order({ at: now - 2.5 * day, status: 'VOIDED', shiftId: shiftClosed.id, cogs: 40, items: [{ p: pA, qty: 1, price: 77 }], pays: [{ method: 'CASH', amount: 77 }] });
        await ret(o5, now - 2 * 3600000, 'CASH', 77, { items: [{ orderItemId: o5.items[0].id, productId: pA.id, quantity: 1, baseQuantity: 1, refundAmount: 77, unitCost: 40 }] });
        // credit sales of every age; same-name customers; a debt that is PAID
        const o6 = await order({ at: now - 40 * day, customerId: cCode.id, cogs: 80, items: [{ p: pRet, qty: 2, price: 50 }], pays: [{ method: 'CREDIT_DEBT', amount: 100 }] });
        const o7 = await order({ at: now - 20 * day, customerId: cDup2.id, cogs: 40, items: [{ p: pB, qty: 1, price: 99.99 }], pays: [{ method: 'CREDIT_DEBT', amount: 50 }, { method: 'TRANSFER', amount: 49.99 }] });
        const o8 = await order({ at: now - 90 * day, customerId: cDup1.id, cogs: 40, items: [{ p: pA, qty: 1, price: 70 }], pays: [{ method: 'CREDIT_DEBT', amount: 70 }] });
        const o9 = await order({ at: now - 100 * day, customerId: cDup1.id, cogs: 40, items: [{ p: pB, qty: 1, price: 70 }], pays: [{ method: 'CREDIT_DEBT', amount: 70 }] });
        const debt = (o: any, customerId: string, total: number, remaining: number, status: any) =>
          db.customerDebt.create({ data: { customerId, orderId: o.id, totalDebt: total, paidAmount: total - remaining, remainingAmount: remaining, status, createdAt: o.createdAt } });
        const d6 = await debt(o6, cCode.id, 100, 50, 'PARTIALLY_PAID');
        await debt(o7, cDup2.id, 50, 50, 'PENDING');
        await debt(o8, cDup1.id, 70, 70, 'PAID');
        await debt(o9, cDup1.id, 70, 70, 'OVERDUE');
        await db.debtPayment.createMany({ data: [
          { debtId: d6.id, amount: 10, paymentMethod: 'CASH', cashierName: 'e2e', paymentDate: new Date(now - 3600000) },
          { debtId: d6.id, amount: 15, paymentMethod: 'TRANSFER', cashierName: 'e2e', paymentDate: new Date(now - 3600000), cancelledAt: new Date() },
        ] });
        // returns made today: of a 40-day-old bill (debt reduction, not restocked: return-only product of the period),
        // a refund without lines (VAT bill), and yesterday a transfer refund of a restocked line
        await ret(o6, now - 60000, 'DEBT_REDUCTION', 50, { items: [{ orderItemId: o6.items[0].id, productId: pRet.id, quantity: 1, baseQuantity: 1, refundAmount: 50, unitCost: 40, restock: false }] });
        await ret(o1, now - 30000, 'CASH', 10, { vat: 0.65 });
        await ret(o7, todayStart - 1000, 'TRANSFER', 99.99, { cogs: 40, items: [{ orderItemId: o7.items[0].id, productId: pB.id, quantity: 1, baseQuantity: 1, refundAmount: 99.99, unitCost: 40 }] });
        await db.order.update({ where: { id: o6.id }, data: { returnedAmount: 50 } });
        await db.order.update({ where: { id: o1.id }, data: { returnedAmount: 10 } });
        await db.order.update({ where: { id: o7.id }, data: { returnedAmount: 99.99 } });

        // claims (string figures, zero figures, no metadata) and supplier return notes (one cancelled)
        const claim = (no: string, at: number, metadata: any) =>
          db.customerClaim.create({ data: { claimNumber: no, productId: pA.id, claimType: 'EXCHANGE', problemDescription: 'tricky', supplierId: sup.id, createdAt: new Date(at), metadata } });
        await claim('TRK-C1', now - 60000, { accounting: { replacementCost: '12.5', refundPaid: 3 } });
        await claim('TRK-C2', todayStart - 60000, { accounting: { replacementCost: 0, refundPaid: 0 } });
        await claim('TRK-C3', now - 10 * day, null);
        await claim('TRK-C4', now - 5 * day, { accounting: { replacementCost: 40.25, refundPaid: '0' } });
        const note = (no: string, status: any, total: number) =>
          db.supplierReturnNote.create({ data: { returnNumber: no, supplierId: sup.id, totalAmount: total, remainingCreditAmount: total, status, items: { create: [{ itemType: 'DEFECTIVE', quantity: 1, unitCost: total, total }, { itemType: 'OVERSTOCK', quantity: 1, unitCost: 3, total: 3 }] } } });
        await note('TRK-N1', 'PENDING', 7.25);
        await note('TRK-N2', 'CANCELLED', 100);

        // ledger rows of the P&L
        const accounts = await db.moneyAccount.findMany();
        const safe = accounts.find((a) => a.type === 'CASH_SAFE')!;
        const bank = accounts.find((a) => a.type === 'BANK')!;
        const drawer = accounts.find((a) => a.type === 'CASH_DRAWER')!;
        const cats = await db.expenseCategory.findMany({ take: 2, orderBy: { sortOrder: 'asc' } });
        const tx = (data: any) => db.moneyTransaction.create({ data: { occurredAt: new Date(now - 60000), ...data } });
        const exp = await tx({ accountId: safe.id, direction: 'OUT', amount: 120, type: 'EXPENSE', categoryId: cats[0].id });
        await tx({ accountId: safe.id, direction: 'IN', amount: 120, type: 'REVERSAL', reversalOfId: exp.id, categoryId: cats[0].id });
        await tx({ accountId: safe.id, direction: 'OUT', amount: 45.5, type: 'EXPENSE', categoryId: cats[1].id });
        await tx({ accountId: bank.id, direction: 'OUT', amount: 10, type: 'EXPENSE' });
        await tx({ accountId: bank.id, direction: 'IN', amount: 33, type: 'OTHER_INCOME' });
        await tx({ accountId: drawer.id, direction: 'OUT', amount: 2.5, type: 'SHIFT_OVER_SHORT' });
        await tx({ accountId: bank.id, direction: 'IN', amount: 7, type: 'ADJUSTMENT' });
        await tx({ accountId: drawer.id, direction: 'OUT', amount: 5, type: 'ADJUSTMENT' });
        await tx({ accountId: bank.id, direction: 'OUT', amount: 8, type: 'EXPENSE', categoryId: cats[1].id, occurredAt: new Date(now - 50 * day) });
        await db.auditLog.createMany({ data: [
          { action: 'STOCK_ADJUST_SUB', entity: 'Product', details: { costValue: -25.5 }, createdAt: new Date(now - 60000) },
          { action: 'STOCK_ADJUST_SUB', entity: 'Product', details: { costValue: '-4.5' }, createdAt: new Date(now - 60000) },
          { action: 'STOCK_ADJUST_SUB', entity: 'Product', details: { costValue: 3 }, createdAt: new Date(now - 60000) },
          { action: 'STOCK_ADJUST_SUB', entity: 'Product', details: { costValue: -9 }, createdAt: new Date(now - 50 * day) },
        ] });
      } finally {
        await db.$disconnect();
      }
    });

    it('every tab, every period: still the same numbers as the old client-side functions', async () => {
      await state.expectParity();
    });

    it('P&L claims / write-offs / ledger: same as the old row-by-row sums', async () => {
      const db = new PrismaClient();
      try {
        const bkk = (t: number) => new Date(t + 7 * 3600000).toISOString().slice(0, 10);
        for (const [from, to] of [[bkk(Date.now()), bkk(Date.now())], [bkk(Date.now() - 60 * day), bkk(Date.now())], ['2020-01-01', '2030-01-01']]) {
          const pl = (await api('get', `/finance/profit-loss?from=${from}&to=${to}`, A).expect(200)).body;
          const period = { gte: new Date(`${from}T00:00:00+07:00`), lt: new Date(Date.parse(`${to}T00:00:00+07:00`) + day) };
          // the loops /finance/profit-loss ran before (planning.service.ts at c60c929)
          let replacementCost = 0, refundsPaid = 0;
          for (const c of await db.customerClaim.findMany({ where: { createdAt: period }, select: { metadata: true } })) {
            const acc = ((c.metadata as any) || {}).accounting || {};
            replacementCost += Number(acc.replacementCost) || 0;
            refundsPaid += Number(acc.refundPaid) || 0;
          }
          const rec = await db.supplierReturnNoteItem.aggregate({ where: { itemType: 'DEFECTIVE', note: { status: { not: 'CANCELLED' }, createdAt: period } }, _sum: { total: true } });
          const supplierRecovery = Number(rec._sum.total || 0);
          const adj = await db.auditLog.findMany({ where: { action: 'STOCK_ADJUST_SUB', createdAt: period }, select: { details: true } });
          const stockWriteOff = r2(adj.reduce((s, a) => s + Math.max(0, -Number((a.details as any)?.costValue || 0)), 0));
          const rows = await db.moneyTransaction.findMany({
            where: { occurredAt: period, type: { in: ['EXPENSE', 'OTHER_INCOME', 'SHIFT_OVER_SHORT', 'ADJUSTMENT', 'REVERSAL'] } },
            select: { type: true, direction: true, amount: true, reversalOfId: true, category: { select: { name: true } }, account: { select: { type: true } } },
          });
          const originals = new Map((await db.moneyTransaction.findMany({ where: { id: { in: rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId!) } } })).map((o) => [o.id, o.type]));
          const expenses: Record<string, number> = {};
          let otherIncome = 0, overShort = 0, adjustments = 0;
          for (const r of rows) {
            const kind = r.type === 'REVERSAL' ? originals.get(r.reversalOfId || '') : r.type;
            const signed = (r.direction === 'IN' ? 1 : -1) * Number(r.amount);
            if (kind === 'EXPENSE') { const k = r.category?.name || 'อื่นๆ'; expenses[k] = r2((expenses[k] || 0) - signed); }
            else if (kind === 'OTHER_INCOME') otherIncome += signed;
            else if (kind === 'SHIFT_OVER_SHORT') overShort += signed;
            else if (kind === 'ADJUSTMENT' && r.account.type !== 'CASH_DRAWER') adjustments += signed;
          }
          for (const k of Object.keys(expenses)) if (Math.abs(expenses[k]) < 0.005) delete expenses[k];
          expect({ from, to, claims: pl.claims, stockWriteOff: pl.stockWriteOff, expenses: pl.expenses, otherIncome: pl.otherIncome, cashOverShort: pl.cashOverShort, accountAdjustments: pl.accountAdjustments }).toEqual({
            from, to,
            claims: { replacementCost: r2(replacementCost), refundsPaid: r2(refundsPaid), supplierRecovery: r2(supplierRecovery), net: r2(replacementCost + refundsPaid - supplierRecovery) },
            stockWriteOff, expenses, otherIncome: r2(otherIncome), cashOverShort: r2(overShort), accountAdjustments: r2(adjustments),
          });
        }
        // the data really has these cases
        const today = (await api('get', '/finance/profit-loss', A)).body;
        expect(today.claims.replacementCost).toBeGreaterThan(0);
        expect(today.stockWriteOff).toBeGreaterThan(0);
        expect(Object.keys(today.expenses).length).toBeGreaterThan(0);
      } finally {
        await db.$disconnect();
      }
    });

    it('dashboard stock position: same as the old loop over batches', async () => {
      const db = new PrismaClient();
      try {
        const [threshold, products, batches] = await Promise.all([
          db.storeSettings.findFirst().then((s: any) => (Number.isFinite(Number(s?.lowStockThreshold)) ? Number(s.lowStockThreshold) : 5)),
          db.product.findMany({ where: { isActive: true }, select: { id: true, isBundle: true, costPrice: true, basePrice: true, priceLevel1: true } }),
          db.stockBatch.findMany({ where: { quantityRemaining: { not: 0 } }, select: { productId: true, quantityRemaining: true, unitCost: true } }),
        ]);
        const val = valueStock(batches);
        let stockCostValue = 0, stockRetailValue = 0, lowStockCount = 0, outOfStockCount = 0;
        for (const p of products) {
          if (p.isBundle) continue;
          const v = val[p.id];
          const qty = v?.quantityRemaining || 0;
          stockCostValue += qty > 0 ? (v!.totalCostValue > 0 ? v!.totalCostValue : qty * Number(p.costPrice || 0)) : 0;
          stockRetailValue += qty * Number(p.priceLevel1 || p.basePrice || 0);
          if (qty <= 0) outOfStockCount++;
          else if (qty <= threshold) lowStockCount++;
        }
        const dash = (await api('get', '/reports/dashboard?range=today', A).expect(200)).body;
        expect(dash.inventory).toEqual({ lowStockThreshold: threshold, totalProducts: products.length, lowStockCount, outOfStockCount, stockCostValue: r2(stockCostValue), stockRetailValue: r2(stockRetailValue) });
      } finally {
        await db.$disconnect();
      }
    });

    it('paging, search and sort parameters', async () => {
      const get = async (q: string) => (await api('get', `/reports/tabs?range=all&${q}`, A).expect(200)).body;
      const b = (await get('tab=bestsellers&q=TRK-&limit=2&sort=revenue')).bestsellers;
      expect(b.allProducts).toHaveLength(2);
      expect(b.total).toBeGreaterThan(2);
      expect(b.allProducts.every((p: any) => p.sku.startsWith('TRK-'))).toBe(true);
      expect(b.allProducts[0].totalRevenue).toBeGreaterThanOrEqual(b.allProducts[1].totalRevenue);
      expect(b.productCount).toBeGreaterThan(b.total);
      const c = (await get('tab=customers&q=ซ้ำ&sort=debt')).customers;
      expect(c.allCustomers.length).toBeGreaterThan(0);
      expect(c.allCustomers.every((x: any) => x.name.includes('ซ้ำ'))).toBe(true);
      expect(c.total).toBe(c.allCustomers.length);
      const i = (await get('tab=inventory&list=deadstock&q=TRK-DEAD')).inventory;
      expect(i.items.map((x: any) => x.sku)).toEqual(['TRK-DEAD']);
      expect((await get('tab=inventory&limit=100000')).inventory.limit).toBe(500);
      await api('get', '/reports/tabs?tab=bestsellers&sort=nope', A).expect(400);
      await api('get', '/reports/tabs?tab=inventory&list=nope', A).expect(400);
      await api('get', '/reports/tabs?tab=customers&page=0', A).expect(400);
      await api('get', '/reports/tabs?tab=customers&limit=abc', A).expect(400);
    });
  });

  describe('POS catalogue: delta sync and photos by URL', () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const THUMB = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const sync = async (since?: string, token = A) =>
      (await api('get', `/products/sync${since !== undefined ? `?since=${encodeURIComponent(since)}` : ''}`, token).expect(200)).body;
    /** the client side: full load, then deltas merged by id */
    const client = new Map<string, any>();
    let cursor = '';
    const pull = async () => {
      const b = await sync(cursor);
      if (b.full) client.clear();
      for (const p of b.products) client.set(p.id, p);
      for (const id of b.deleted) client.delete(id);
      cursor = b.cursor;
      return b;
    };
    const ids = (b: any) => b.products.map((p: any) => p.id).sort();
    const sk = { child: '', bundle: '', x: '', gone: '', cat: '', sup: '' };

    it('first call: every product (same rows as GET /products) and a cursor; then an empty delta', async () => {
      const b = await pull();
      expect(b.full).toBe(true);
      expect(typeof b.cursor).toBe('string');
      const list = (await api('get', '/products', A).expect(200)).body;
      expect(b.products).toEqual(list);
      expect(b.products.every((p: any) => !('stockBatches' in p))).toBe(true);
      const again = await pull();
      expect(again).toMatchObject({ full: false, products: [], deleted: [] });
    });

    it('new products, photos, bundles and stock show up in the delta', async () => {
      sk.cat = (await api('post', '/categories', A, { name: 'SYNC หมวด' }).expect(201)).body.id;
      const mk = async (body: any) => (await api('post', '/products', A, { basePrice: 20, priceLevel1: 20, costPrice: 8, unit: 'ชิ้น', ...body }).expect(201)).body;
      const child = await mk({ name: 'SYNC ลูก', barcodes: ['SYNC-BC-1'] });
      sk.child = child.id;
      sk.x = (await mk({
        name: 'SYNC รูป', categoryId: sk.cat,
        images: [{ dataUrl: `data:image/png;base64,${PNG}`, thumbDataUrl: `data:image/png;base64,${THUMB}`, name: 'a.png', isCover: true }],
      })).id;
      sk.bundle = (await mk({ name: 'SYNC ชุด', isBundle: true, bundleItems: [{ childProductId: sk.child, quantity: 2 }] })).id;
      await api('post', '/inventory/adjust', A, { productId: sk.child, type: 'SET', amount: 9, reason: 'e2e' }).expect(201);
      const b = await pull();
      expect(b.full).toBe(false);
      expect(ids(b)).toEqual([sk.bundle, sk.child, sk.x].sort());
      expect(client.get(sk.child).stock).toBe(9);
      expect(client.get(sk.bundle).stock).toBe(4); // floor(9 / 2) sets
      expect(client.get(sk.bundle).bundleItems[0].childProduct).toMatchObject({ id: sk.child, name: 'SYNC ลูก', sku: child.sku });
      const img = client.get(sk.x).images[0];
      expect(img).toMatchObject({ name: 'a.png', isCover: true, url: `/api/product-images/${img.id}`, thumbUrl: `/api/product-images/${img.id}?size=thumb` });
      expect(img.dataUrl).toBeUndefined();
      expect(client.get(sk.x).category.name).toBe('SYNC หมวด');
    });

    it('a sale changes the product and the bundles it is part of', async () => {
      await api('post', '/orders/checkout', C, { clientOrderId: randomUUID(), shiftId: state.shift2.id, items: [{ productId: sk.child, quantity: 3, unitPrice: 20 }], payments: [{ method: 'CASH', amount: 60 }] }).expect(201);
      const b = await pull();
      expect(ids(b)).toEqual([sk.bundle, sk.child].sort());
      expect(client.get(sk.child).stock).toBe(6);
      expect(client.get(sk.bundle).stock).toBe(3);
    });

    it('price, barcode, category rename, deactivation, receiving and deletes all bump the cursor', async () => {
      await api('patch', `/products/${sk.x}`, A, { basePrice: 25, priceLevel1: 25 }).expect(200);
      expect(ids(await pull())).toEqual([sk.x]);
      expect(client.get(sk.x).priceLevel1).toBe('25');
      await api('patch', `/products/${sk.child}`, A, { barcodes: ['SYNC-BC-2'] }).expect(200);
      expect(ids(await pull())).toEqual([sk.bundle, sk.child].sort());
      expect(client.get(sk.child).barcodes.map((x: any) => x.barcode)).toEqual(['SYNC-BC-2']);
      await api('patch', `/categories/${sk.cat}`, A, { name: 'SYNC หมวดใหม่' }).expect(200);
      expect(ids(await pull())).toEqual([sk.x]);
      expect(client.get(sk.x).category.name).toBe('SYNC หมวดใหม่');
      await api('patch', `/products/${sk.x}`, A, { isActive: false }).expect(200);
      expect(ids(await pull())).toEqual([sk.x]);
      expect(client.get(sk.x).isActive).toBe(false);
      const sup = (await api('post', '/suppliers', A, { name: 'SYNC Supplier', creditTerms: 0 })).body;
      const po = (await api('post', '/purchase-orders', A, { supplierId: sup.id, status: 'ISSUED', items: [{ productId: sk.child, quantity: 4, unitCost: 7 }] }).expect(201)).body;
      await api('post', `/purchase-orders/${po.id}/receive`, A, { clientReceiptId: randomUUID(), items: [{ purchaseOrderItemId: po.items[0].id, receivedQty: 4, unitCost: 7 }] }).expect(201);
      const r = await pull();
      expect(ids(r)).toEqual(expect.arrayContaining([sk.bundle, sk.child]));
      expect(client.get(sk.child).stock).toBe(10);
      sk.gone = (await api('post', '/products', A, { name: 'SYNC ลบ', basePrice: 1 }).expect(201)).body.id;
      expect(ids(await pull())).toEqual([sk.gone]);
      await api('delete' as any, `/products/${sk.gone}`, A).expect(200);
      const d = await pull();
      expect(d).toMatchObject({ full: false, products: [], deleted: [sk.gone] });
      expect(client.has(sk.gone)).toBe(false);
    });

    it('full load + deltas == a fresh full load', async () => {
      const fresh = await sync();
      expect(fresh.full).toBe(true);
      expect(client.size).toBe(fresh.products.length);
      for (const p of fresh.products) expect(client.get(p.id)).toEqual(p);
    });

    it('bad, foreign or very old cursors give a full reload; cost fields only with VIEW_COST', async () => {
      for (const bad of ['', 'nope', 'v1.1-2.0.' + Buffer.from('1:2:').toString('base64url'), cursor.replace(/^v1\.\d+-\d+(-\d+)?\./, 'v1.1-2.'), cursor.replace(/^v1\.(\d+-\d+)-\d+\./, 'v1.$1.'), cursor.replace(/^(v1\.\d+-\d+(?:-\d+)?\.)\d+/, '$1' + (Date.now() - 8 * 86400_000))]) {
        expect((await sync(bad)).full).toBe(true);
      }
      expect((await sync(cursor)).full).toBe(false);
      const asCashier = await sync(undefined, C);
      const row = asCashier.products.find((p: any) => p.id === sk.child);
      expect(row.costPrice).toBeUndefined();
      expect(row.stock).toBe(10);
      expect(JSON.stringify(asCashier.products)).not.toMatch(/"(costPrice|unitCost|lastCost)"/);
    });

    it('round 2: after the change log is emptied (reset database = TRUNCATE) an old cursor gets a full catalogue', async () => {
      const before = await sync();
      expect((await sync(before.cursor)).full).toBe(false);
      const db = new PrismaClient();
      try {
        await db.$executeRawUnsafe('TRUNCATE TABLE product_changes RESTART IDENTITY');
      } finally {
        await db.$disconnect();
      }
      expect((await sync(before.cursor)).full).toBe(true);
    });

    it('GET /product-images/:id serves the photo without login, cacheable; ?size=thumb the small copy', async () => {
      const img = client.get(sk.x).images[0];
      const r = await http.get(img.url).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
      expect(r.headers['content-type']).toBe('image/png');
      expect(r.headers['cache-control']).toContain('immutable');
      expect(Buffer.compare(r.body, Buffer.from(PNG, 'base64'))).toBe(0);
      await http.get(img.url).set('If-None-Match', r.headers.etag).expect(304);
      const t = await http.get(img.thumbUrl).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
      expect(Buffer.compare(t.body, Buffer.from(THUMB, 'base64'))).toBe(0);
      await http.get('/api/product-images/does-not-exist').expect(404);
      // only image data URLs are served
      const html = (await api('post', '/products', A, { name: 'SYNC html', basePrice: 1, images: [{ dataUrl: 'data:text/html;base64,PGgxPng8L2gxPg==' }] }).expect(201)).body;
      await http.get(`/api/product-images/${html.images[0].id}`).expect(404);
    });

    it('saving the photo list by id keeps the photo data; new photos are added; an old-style list replaces', async () => {
      const before = (await api('get', `/products/${sk.x}`, A).expect(200)).body.images;
      expect(before).toHaveLength(1);
      await api('patch', `/products/${sk.x}`, A, {
        images: [{ id: before[0].id, name: 'a.png', isCover: false }, { dataUrl: `data:image/png;base64,${THUMB}`, name: 'b.png', isCover: true }],
      }).expect(200);
      const after = (await api('get', `/products/${sk.x}`, A).expect(200)).body.images;
      expect(after.map((i: any) => [i.name, i.isCover, i.sortOrder])).toEqual([['a.png', false, 0], ['b.png', true, 1]]);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0].dataUrl).toBe(`data:image/png;base64,${PNG}`);
      expect(after[0].thumbDataUrl).toBe(`data:image/png;base64,${THUMB}`);
      expect(ids(await pull())).toContain(sk.x);
      // an unknown id (another product's photo) is not taken over
      const other = (await api('post', '/products', A, { name: 'SYNC other', basePrice: 1, images: [{ dataUrl: `data:image/png;base64,${PNG}` }] }).expect(201)).body;
      await api('patch', `/products/${sk.x}`, A, { images: [{ id: other.images[0].id }, { id: after[1].id }] }).expect(200);
      expect((await api('get', `/products/${sk.x}`, A)).body.images.map((i: any) => i.id)).toEqual([after[1].id]);
      expect((await api('get', `/products/${other.id}`, A)).body.images).toHaveLength(1);
      // clients that send every photo as data (older frontends) still replace the list
      await api('patch', `/products/${sk.x}`, A, { images: [{ dataUrl: `data:image/png;base64,${PNG}`, name: 'c.png' }] }).expect(200);
      const c = (await api('get', `/products/${sk.x}`, A)).body.images;
      expect(c.map((i: any) => i.name)).toEqual(['c.png']);
      expect(c[0].thumbDataUrl).toBeNull();
      expect(client.size).toBeGreaterThan(0);
    });

    it('catalogue rows carry the same data as the full product (GET /products/:id), minus batches and photo data', async () => {
      const sup = (await api('post', '/suppliers', A, { name: 'SYNC ผู้ขาย', creditTerms: 0 })).body;
      const full = (await api('post', '/products', A, {
        name: 'SYNC ครบ', basePrice: 12.5, priceLevel1: 12.5, priceLevel2: 11, costPrice: 7.25, unit: 'ขวด', categoryId: sk.cat,
        barcodes: ['SYNC-FULL-1', 'SYNC-FULL-2'],
        packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, barcode: 'SYNC-FULL-P', priceLevel1: 70.5 }, { name: 'ลัง', qtyPerPrev: 4, priceLevel1: 270, priceLevel3: 260 }],
        wholesalePrices: [{ minQuantity: 10, unitPrice: 12 }, { minQuantity: 50.5, unitPrice: 11.75 }],
        supplierEntries: [{ supplierId: sup.id, supplierSku: 'S-1', lastCost: 6.5, isPreferred: true }],
        images: [{ dataUrl: `data:image/png;base64,${PNG}`, name: 'z.png', isCover: true }],
      }).expect(201)).body;
      await api('post', '/inventory/adjust', A, { productId: full.id, type: 'SET', amount: 7, reason: 'e2e' }).expect(201);
      const list = (await api('get', '/products', A).expect(200)).body;
      const pick = (x: any, ks: string[]) => Object.fromEntries(ks.map((k) => [k, x?.[k]]));
      for (const id of [full.id, sk.child, sk.bundle, sk.x]) {
        const row = list.find((p: any) => p.id === id);
        const d = (await api('get', `/products/${id}`, A).expect(200)).body;
        for (const k of Object.keys(d)) {
          if (['barcodes', 'images', 'stockBatches', 'suppliers', 'bundleItems', 'supplierEntries'].includes(k)) continue;
          expect([k, row[k]]).toEqual([k, d[k]]);
        }
        const byCode = (a: any[]) => [...a].sort((x, y) => x.barcode.localeCompare(y.barcode));
        expect(byCode(row.barcodes)).toEqual(byCode(d.barcodes.map((b: any) => pick(b, ['barcode', 'label']))));
        expect(row.images.map((i: any) => pick(i, ['id', 'name', 'isCover', 'sortOrder']))).toEqual(d.images.map((i: any) => pick(i, ['id', 'name', 'isCover', 'sortOrder'])));
        const slim = (e: any) => ({ ...e, supplier: e.supplier ? pick(e.supplier, ['id', 'name']) : null });
        expect(row.supplierEntries.map(slim)).toEqual(d.supplierEntries.map(slim));
        expect(row.suppliers).toEqual(d.suppliers.map((x: any) => ({ ...pick(x, ['id', 'supplierId', 'supplierSku', 'supplierProductName', 'unitCost', 'isPreferred']), supplier: pick(x.supplier, ['id', 'name']) })));
        expect(row.bundleItems).toEqual(d.bundleItems.map((b: any) => ({ ...pick(b, ['id', 'childProductId', 'quantity']), childProduct: pick(b.childProduct, ['id', 'name', 'sku', 'unit', 'basePrice', 'priceLevel1']) })));
      }
      const fullRow = list.find((p: any) => p.id === full.id);
      expect(fullRow).toMatchObject({ stock: 7, priceLevel1: '12.5', costPrice: '7.25', supplierId: sup.id });
      expect(fullRow.wholesalePrices.map((w: any) => [w.minQuantity, w.unitPrice])).toEqual([[10, '12'], [50.5, '11.75']]);
      expect(fullRow.packagingUnits.map((u: any) => [u.name, u.qtyPerPrev, u.priceLevel1, u.priceLevel3])).toEqual([['แพ็ค', 6, '70.5', null], ['ลัง', 4, '270', '260']]);
      expect((await pull()).products.map((p: any) => p.id)).toContain(full.id);
      expect(client.get(full.id)).toEqual(fullRow);
    });

    it('/inventory/stock: stock per product without the batch rows', async () => {
      const rows = (await api('get', '/inventory/stock', A).expect(200)).body;
      const child = rows.find((p: any) => p.id === sk.child);
      expect(child.computedStock).toBe(10);
      expect(child.stockBatches).toBeUndefined();
      expect(rows.find((p: any) => p.id === sk.bundle).computedStock).toBe(0); // own batches only (as before)
    });
  });
  describe('payables: GET /payables/bills equals the bills the page built in the browser', () => {
    const allBills = async (query = '') => {
      const out: any[] = [];
      let first: any;
      for (let page = 1; page < 1000; page++) {
        const body = (await api('get', `/payables/bills?page=${page}&limit=3${query}`, A).expect(200)).body;
        if (page === 1) first = body;
        out.push(...body.data);
        if (body.data.length < 3) break;
      }
      return { rows: out, first };
    };
    /** numbers rounded (float summing order may differ), undefined dropped (JSON) */
    const norm = (v: any) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x)));
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      const s1 = (await api('post', '/suppliers', A, { name: 'AP ผู้ขาย หนึ่ง', contactName: 'คุณเอ', phone: '021112222', creditTerms: 30 }).expect(201)).body;
      const s2 = (await api('post', '/suppliers', A, { name: 'AP Supplier Two', creditTerms: 0 }).expect(201)).body;
      ids.s1 = s1.id; ids.s2 = s2.id;
      const mkPo = async (supplierId: string, items: any[], receive: number[] | null, invoice?: string) => {
        const po = (await api('post', '/purchase-orders', A, { supplierId, status: 'ISSUED', items: items.map((i) => ({ productId: state.p.id, ...i })) }).expect(201)).body;
        if (receive) {
          await api('post', `/purchase-orders/${po.id}/receive`, A, {
            clientReceiptId: randomUUID(), ...(invoice ? { supplierInvoiceNo: invoice } : {}),
            items: po.items.map((i: any, k: number) => ({ purchaseOrderItemId: i.id, receivedQty: receive[k], unitCost: Number(i.unitCost) })),
          }).expect(201);
        }
        return po.id as string;
      };
      ids.a = await mkPo(s1.id, [{ quantity: 10, unitCost: 20 }], [10]);
      ids.b = await mkPo(s1.id, [{ quantity: 10, unitCost: 30 }], [4]); // partially received
      ids.c = await mkPo(s2.id, [{ quantity: 10, unitCost: 10, vatType: 'EXCLUDED', vatRate: 7 }], [10]); // 107 incl. VAT
      ids.d = await mkPo(s2.id, [{ quantity: 5, unitCost: 40 }], null); // not received: not a bill
      ids.e = await mkPo(s1.id, [{ quantity: 3, unitCost: 50 }], [3], 'INV-ภาษี-77');
      await api('post', '/supplier-returns', A, { supplierId: s1.id, items: [{ productId: state.p.id, itemType: 'OVERSTOCK', quantity: 1, unitCost: 10, total: 10 }], totalCreditAmount: 10, deductStock: true }).expect(201);
      await api('post', '/supplier-returns', A, { supplierId: s1.id, items: [{ productId: state.p.id, itemType: 'OVERSTOCK', quantity: 1, unitCost: 15, total: 15 }], totalCreditAmount: 15, deductStock: true }).expect(201);
      const notes = (await api('get', `/supplier-returns?supplierId=${s1.id}&limit=50`, A)).body.data;
      const note10 = notes.find((n: any) => Number(n.totalAmount) === 10).id;
      const pay = (body: any) => api('post', '/payables/settle-multiple', A, { clientVoucherId: randomUUID(), paymentMethod: 'TRANSFER', moneyAccountId: state.bank.id, ...body }).expect(201);
      // full payment with a discount and a credit note; a partial payment; a multi-bill voucher with a discount
      await pay({ supplierId: s1.id, billsToSettle: [{ poId: ids.a, amountToPay: 200 }], matchedDebitNotes: [{ returnNoteId: note10, amountToDeduct: 10 }], discountAmount: 5 });
      await pay({ supplierId: s1.id, billsToSettle: [{ poId: ids.b, amountToPay: 50 }] });
      await pay({ supplierId: s1.id, billsToSettle: [{ poId: ids.e, amountToPay: 100 }, { poId: ids.b, amountToPay: 20 }], discountAmount: 3 });
      // the VAT bill can be paid in full (107): the payable cap counts VAT; then a cancelled voucher
      const v4 = (await pay({ supplierId: s2.id, billsToSettle: [{ poId: ids.c, amountToPay: 107 }] })).body.voucher;
      await api('post', `/payables/vouchers/${v4.id}/cancel`, A, { reason: 'e2e' }).expect(201);
    });

    /** what the old page computed from its downloads (POs with each line's gross per unit as unitCost = the one intended change) */
    const oldPage = async () => {
      const pos = (await api('get', '/purchase-orders?limit=1000', A).expect(200)).body.data as any[];
      const suppliers = (await api('get', '/suppliers', A).expect(200)).body;
      const vouchers = ((await api('get', '/payables/vouchers?limit=200', A).expect(200)).body.data as any[]).map(legacyPayables.normalizeVoucherRow);
      const notes = ((await api('get', '/supplier-returns?limit=200', A).expect(200)).body.data as any[]).map((n) => ({ status: n.frontendStatus || n.status, remainingCreditAmount: Number(n.remainingCreditAmount ?? n.totalAmount ?? 0), supplierId: n.supplierId }));
      const original = legacyPayables.mapPosToPayableBills(pos, suppliers, vouchers);
      const grossPos = pos.map((po) => ({ ...po, items: po.items.map((i: any) => ({ ...i, unitCost: Number(i.quantity) ? Number(i.total) / Number(i.quantity) : Number(i.unitCost) })) }));
      const bills = legacyPayables.mapPosToPayableBills(grossPos, suppliers, vouchers).map((b: any, k: number) => ({ ...b, items: original[k].items }));
      return { original, bills, notes };
    };

    it('every bill, its figures, payments and order', async () => {
      const { original, bills } = await oldPage();
      const { rows } = await allBills();
      expect(rows.map((b) => b.poNumber)).toEqual(bills.map((b: any) => b.poNumber));
      expect(norm(rows)).toEqual(norm(bills));
      expect(rows.find((b) => b.poId === ids.d)).toBeUndefined();
      // the one intended difference: the VAT bill counted quantity x unitCost (100) in the browser
      const oldC = original.find((b: any) => b.poId === ids.c);
      const newC = rows.find((b) => b.poId === ids.c);
      expect([oldC.receivedAmount, oldC.remainingPayable]).toEqual([100, 100]);
      expect([newC.receivedAmount, newC.remainingPayable, newC.paymentStatus]).toEqual([107, 107, 'UNPAID']);
      const a = rows.find((b) => b.poId === ids.a);
      expect([a.paymentStatus, a.remainingPayable, a.alreadyPaidAmount, a.alreadyDiscountAmount, a.payments.length]).toEqual(['PAID', 0, 200, 5, 1]);
      const b = rows.find((x) => x.poId === ids.b);
      expect([b.paymentStatus, b.remainingPayable, b.alreadyPaidAmount, b.payments.length]).toEqual(['PARTIALLY_PAID', 50, 70, 2]);
      expect(b.payments[0].discountAmount).toBe(3);
      expect(b.payments[0].netCashOrTransferPaid).toBe(20);
      // a page of 3 and slim rows
      const p2 = (await api('get', '/payables/bills?page=2&limit=3&slim=1', A).expect(200)).body;
      expect(norm(p2.data)).toEqual(norm(bills.slice(3, 6).map((x: any) => ({ ...x, items: [], payments: [] }))));
      expect(p2.meta).toMatchObject({ total: bills.length, page: 2, limit: 3, totalPages: Math.ceil(bills.length / 3) });
    });

    it('cards and per-supplier summary over every bill; filters equal the page filter', async () => {
      const { bills, notes } = await oldPage();
      const { first } = await allBills('&search=zzz-none');
      const cards = legacyPayables.pageCards(bills, notes);
      expect(first.summary.billCount).toBe(bills.length);
      expect(first.summary.unpaidCount).toBe(cards.unpaidBillsCount);
      expect(first.summary.totalOutstanding).toBeCloseTo(cards.totalOutstandingDebt, 6);
      expect(first.summary.totalPaid).toBeCloseTo(cards.totalPaidAmount, 6);
      expect(first.summary.availableCredit).toBeCloseTo(cards.totalAvailableDebitCredit, 6);
      expect(first.summary.availableCreditCount).toBe(cards.availableCreditCount);
      for (const sid of [ids.s1, ids.s2]) {
        const open = bills.filter((b: any) => b.supplierId === sid && b.remainingPayable > 0);
        const credit = notes.filter((n) => n.supplierId === sid && n.status !== 'CANCELLED' && n.remainingCreditAmount > 0);
        const row = first.summary.suppliers.find((x: any) => x.supplierId === sid) || { openCount: 0, debt: 0, creditCount: 0, creditTotal: 0 };
        expect(row.openCount).toBe(open.length);
        expect(row.debt).toBeCloseTo(open.reduce((s: number, b: any) => s + b.remainingPayable, 0), 6);
        expect(row.creditCount).toBe(credit.length);
        expect(row.creditTotal).toBeCloseTo(credit.reduce((s, n) => s + n.remainingCreditAmount, 0), 6);
      }
      expect(first.summary.suppliers.find((x: any) => x.supplierId === ids.s1).creditTotal).toBe(15);
      const cases: [string, string, string][] = [
        ['', 'ALL', 'UNPAID'], ['', 'ALL', 'PARTIALLY_PAID'], ['', 'ALL', 'PAID'], ['', ids.s1, 'ALL'], ['', ids.s2, 'PAID'],
        ['ap ผู้ขาย', 'ALL', 'ALL'], ['ap supplier', 'ALL', 'ALL'], ['PO', ids.s1, 'UNPAID'],
      ];
      for (const [search, sup, status] of cases) {
        const q = `&search=${encodeURIComponent(search)}&supplierId=${sup}&paymentStatus=${status}`;
        const { rows, first: f } = await allBills(q);
        const expected = legacyPayables.pageFilter(bills, search, sup, status);
        expect({ search, sup, status, ids: rows.map((b) => b.poId) }).toEqual({ search, sup, status, ids: expected.map((b: any) => b.poId) });
        expect(f.meta.total).toBe(expected.length);
      }
      // the supplier's invoice number is searchable too (new); open=1 = something payable now
      const inv = await allBills('&search=' + encodeURIComponent('ภาษี-77'));
      expect(inv.rows.map((b) => b.poId)).toEqual([ids.e]);
      const open = await allBills('&open=1');
      expect(open.rows.map((b) => b.poId)).toEqual(bills.filter((b: any) => b.remainingPayable > 0).map((b: any) => b.poId));
      await api('get', '/payables/bills?paymentStatus=bad', A).expect(400);
      expect((await api('get', '/payables/bills?limit=5000&slim=1', A).expect(200)).body.meta.limit).toBe(5000);
      expect((await api('get', '/payables/bills?limit=5000', A).expect(200)).body.meta.limit).toBe(500);
    });

    it('SQL figures (slim rows, filters, cards) equal billFigures (full rows) on edge-case bills', async () => {
      const db = new PrismaClient();
      try {
        const sup = await db.supplier.create({ data: { name: '' } }); // empty name -> "ไม่ระบุผู้จำหน่าย"
        const p = await db.product.findFirstOrThrow({ where: { id: state.p.id } });
        let at = Date.now() + 60000;
        const mk = async (no: string, po: any, items: any[]) => db.purchaseOrder.create({
          data: { poNumber: no, supplierId: sup.id, status: 'RECEIVED', createdAt: new Date((at += 1000)), ...po, items: { create: items.map((i) => ({ productId: p.id, ...i })) } },
        });
        await mk('EDGE-THIRDS', { totalAmount: 100, remainingPayable: 100 }, [{ quantity: 3, unitCost: 33.33, total: 100, receivedQty: 1 }]);
        await mk('EDGE-NOITEMS', { totalAmount: 55.55, remainingPayable: 55.55 }, []);
        await mk('EDGE-ZEROQTY', { totalAmount: 10, remainingPayable: 10 }, [{ quantity: 0, unitCost: 10, total: 0, receivedQty: 1 }]);
        await mk('EDGE-OVERPAID', { status: 'PARTIALLY_RECEIVED', totalAmount: 200, paidAmount: 150, remainingPayable: 50 }, [{ quantity: 10, unitCost: 20, total: 200, receivedQty: 5 }]);
        await mk('EDGE-NEGREM', { totalAmount: 30, paidAmount: 40, remainingPayable: -10, paymentStatus: 'PAID' }, [{ quantity: 1, unitCost: 30, total: 30, receivedQty: 1 }]);
        await mk('EDGE-DBSTATUS', { totalAmount: 0, remainingPayable: 0, paymentStatus: 'PARTIALLY_PAID' }, [{ quantity: 1, unitCost: 0, total: 0, receivedQty: 1 }]);
        await mk('EDGE-HALF', { totalAmount: 1.25, remainingPayable: 1.25 }, [{ quantity: 8, unitCost: 0.16, total: 1, receivedQty: 1 }, { quantity: 2, unitCost: 0.13, total: 0.25, receivedQty: 2 }]);
      } finally {
        await db.$disconnect();
      }
      const { rows: full } = await allBills();
      const slim: any[] = (await api('get', '/payables/bills?limit=5000&slim=1', A).expect(200)).body.data;
      const figures = (b: any) => ({ poId: b.poId, supplierName: b.supplierName, billDate: b.billDate, status: b.status, paymentStatus: b.paymentStatus, totalAmount: b.totalAmount, receivedAmount: b.receivedAmount, alreadyPaidAmount: b.alreadyPaidAmount, alreadyDiscountAmount: b.alreadyDiscountAmount, remainingPayable: b.remainingPayable, itemsCount: b.itemsCount });
      expect(norm(slim.map(figures))).toEqual(norm(full.map(figures)));
      const edge = full.filter((b) => String(b.poNumber).startsWith('EDGE-'));
      expect(edge.map((b) => [b.poNumber, b.supplierName, b.receivedAmount, b.remainingPayable, b.paymentStatus])).toEqual([
        ['EDGE-HALF', 'ไม่ระบุผู้จำหน่าย', 0.38, 0.38, 'UNPAID'],
        ['EDGE-DBSTATUS', 'ไม่ระบุผู้จำหน่าย', 0, 0, 'PARTIALLY_PAID'],
        ['EDGE-NEGREM', 'ไม่ระบุผู้จำหน่าย', 30, 0, 'PAID'],
        ['EDGE-OVERPAID', 'ไม่ระบุผู้จำหน่าย', 100, 0, 'PARTIALLY_PAID'],
        ['EDGE-ZEROQTY', 'ไม่ระบุผู้จำหน่าย', 10, 10, 'UNPAID'],
        ['EDGE-NOITEMS', 'ไม่ระบุผู้จำหน่าย', 55.55, 55.55, 'UNPAID'],
        ['EDGE-THIRDS', 'ไม่ระบุผู้จำหน่าย', 33.33, 33.33, 'UNPAID'],
      ]);
      // filters / cards over the SQL figures = the same rules applied to the full rows
      for (const st of ['UNPAID', 'PARTIALLY_PAID', 'PAID']) {
        expect((await allBills(`&paymentStatus=${st}`)).rows.map((b) => b.poId)).toEqual(full.filter((b) => b.paymentStatus === st).map((b) => b.poId));
      }
      expect((await allBills('&search=' + encodeURIComponent('ไม่ระบุ'))).rows.map((b) => b.poNumber)).toEqual(edge.map((b) => b.poNumber));
      const { first } = await allBills('&open=1');
      expect(first.summary.billCount).toBe(full.length);
      expect(first.summary.unpaidCount).toBe(full.filter((b) => b.paymentStatus !== 'PAID').length);
      expect(first.summary.totalOutstanding).toBeCloseTo(full.reduce((s, b) => s + b.remainingPayable, 0), 6);
      expect(first.summary.totalPaid).toBeCloseTo(full.reduce((s, b) => s + b.alreadyPaidAmount, 0), 6);
      const supRow = first.summary.suppliers.find((x: any) => x.supplierId === edge[0].supplierId);
      expect([supRow.openCount, supRow.debt]).toEqual([4, 99.26]);
      // purchase_order_item_totals (trigger-kept) == the sums over the current lines, after every write of the suite
      // plus an update, a move, a delete and a PO deletion here
      const db2 = new PrismaClient();
      try {
        const lines = await db2.purchaseOrderItem.findMany({ where: { purchaseOrder: { poNumber: { startsWith: 'EDGE-' } } }, include: { purchaseOrder: true }, orderBy: { id: 'asc' } });
        const half = lines.filter((l) => l.purchaseOrder.poNumber === 'EDGE-HALF');
        const thirds = lines.find((l) => l.purchaseOrder.poNumber === 'EDGE-THIRDS')!;
        await db2.purchaseOrderItem.updateMany({ where: { purchaseOrderId: half[0].purchaseOrderId }, data: { receivedQty: { increment: 1 } } });
        const eighths = half.find((l) => Number(l.quantity) === 8)!; // received 2 of 8 for 1.00 -> 0.25
        await db2.purchaseOrderItem.update({ where: { id: eighths.id }, data: { purchaseOrderId: thirds.purchaseOrderId } });
        await db2.purchaseOrderItem.delete({ where: { id: half.find((l) => l.id !== eighths.id)!.id } }); // EDGE-HALF has no lines left -> bill amount = total
        await db2.purchaseOrder.delete({ where: { id: lines.find((l) => l.purchaseOrder.poNumber === 'EDGE-ZEROQTY')!.purchaseOrderId } });
        const diff = await db2.$queryRaw<any[]>`
          SELECT COALESCE(t.purchase_order_id, x.purchase_order_id) AS po, t.item_count, x.n, t.received_value::text AS kept, x.v::text AS fresh
            FROM purchase_order_item_totals t
            FULL JOIN (SELECT purchase_order_id, COUNT(*)::int AS n, SUM(received_qty * CASE WHEN quantity > 0 THEN total / quantity ELSE unit_cost END) AS v
                         FROM purchase_order_items GROUP BY 1) x ON x.purchase_order_id = t.purchase_order_id
           WHERE t.item_count IS DISTINCT FROM COALESCE(x.n, 0) OR (x.n IS NOT NULL AND t.received_value IS DISTINCT FROM x.v)`;
        expect(diff).toEqual([]);
        expect(await db2.purchaseOrderItemTotal.count()).toBeGreaterThan(5);
      } finally {
        await db2.$disconnect();
      }
      const after = (await allBills('&search=EDGE-')).rows;
      expect(after.map((b) => [b.poNumber, b.itemsCount, b.receivedAmount, b.remainingPayable])).toEqual([
        ['EDGE-HALF', 0, 1.25, 1.25],
        ['EDGE-DBSTATUS', 1, 0, 0],
        ['EDGE-NEGREM', 1, 30, 0],
        ['EDGE-OVERPAID', 1, 100, 0],
        ['EDGE-NOITEMS', 0, 55.55, 55.55],
        ['EDGE-THIRDS', 2, 33.58, 33.58],
      ]);
      const slimAfter: any[] = (await api('get', '/payables/bills?limit=5000&slim=1&search=EDGE-', A).expect(200)).body.data;
      expect(norm(slimAfter.map(figures))).toEqual(norm(after.map(figures)));
    });

    it('credit notes with credit left (?available=1) and the newest PO supplier per product', async () => {
      const all = (await api('get', '/supplier-returns?limit=500', A).expect(200)).body.data as any[];
      const avail = (await api('get', '/supplier-returns?available=1&limit=500', A).expect(200)).body.data as any[];
      expect(avail.map((n) => n.id)).toEqual(all.filter((n) => n.status !== 'CANCELLED' && Number(n.remainingCreditAmount) > 0).map((n) => n.id));
      const pos = (await api('get', '/purchase-orders?limit=500', A).expect(200)).body.data as any[];
      const newest = pos.find((po) => po.items.some((i: any) => i.productId === state.p.id));
      const rows = (await api('get', `/purchase-orders/product-suppliers?ids=${state.p.id},nope`, A).expect(200)).body;
      expect(rows).toEqual([{ productId: state.p.id, supplierId: newest.supplierId, supplierName: newest.supplier.name }]);
      expect((await api('get', '/purchase-orders/product-suppliers', A).expect(200)).body).toEqual([]);
      // a supplier's POs, all pages
      const s1 = (await api('get', `/purchase-orders?supplierId=${ids.s1}&limit=2&page=2`, A).expect(200)).body;
      expect(s1.meta.total).toBe(3);
      expect(s1.data.map((p: any) => p.id)).toEqual(pos.filter((p) => p.supplierId === ids.s1).slice(2).map((p) => p.id));
    });
  });

  describe('management lists: server paging / search / sort equal the old in-browser lists', () => {
    /** every page of a paged endpoint, concatenated */
    const allPages = async (path: string, limit: number) => {
      const out: any[] = [];
      let first: any;
      for (let page = 1; page < 1000; page++) {
        const body = (await api('get', `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=${limit}`, A).expect(200)).body;
        if (page === 1) first = body;
        out.push(...body.data);
        if (body.data.length < limit) break;
      }
      return { rows: out, first };
    };

    beforeAll(async () => {
      // Thai names / barcodes / pack barcodes / suppliers / customers with profiles
      const sup = (await api('post', '/suppliers', A, { name: 'LIST ผู้ขาย', creditTerms: 0 })).body;
      state.listSup = sup.id;
      const cat = (await api('post', '/categories', A, { name: 'LIST หมวด' }).expect(201)).body.id;
      state.listCat = cat;
      // the SKU is generated by the server; these rows stand for older / imported products with hand-made codes
      // (search must still find them by code, including "_" and "%"), so the code is set directly in the DB
      const mk = async ({ sku, ...body }: any) => {
        const made = (await api('post', '/products', A, { basePrice: 20, unit: 'ชิ้น', ...body }).expect(201)).body;
        const pdb = new PrismaClient();
        try { await pdb.product.update({ where: { id: made.id }, data: { sku } }); } finally { await pdb.$disconnect(); }
        return { ...made, sku };
      };
      const a = await mk({ name: 'เอ ปากกาลูกลื่น 50%', sku: 'LIST-A_1', priceLevel1: 15, priceLevel2: 14, categoryId: cat, barcodes: ['8850001112223'] });
      await mk({ name: 'ไม้บรรทัด รุ่น ก', sku: 'LIST-B', priceLevel1: 0, categoryId: cat, packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 12, barcode: 'PACK-LIST-777' }] });
      await mk({ name: 'ยางลบ', sku: 'list-c', basePrice: 7, supplierEntries: [{ supplierId: sup.id, supplierSku: 'S-LIST', lastCost: 3, isPreferred: true }] });
      await api('post', '/inventory/adjust', A, { productId: a.id, type: 'SET', amount: 3, reason: 'e2e' }).expect(201);
      const custs = [
        { name: 'LIST บริษัท ก', phone: '0811110001', type: 'COMPANY', companyName: 'บจก. ทดสอบรายการ', taxId: '0105551234567', creditLimit: 5000, priceLevel: 3, code: 'CUST-0042' },
        { name: 'LIST คุณ ข', phone: '0811110002', creditLimit: '100', priceLevel: 2, contactPerson: 'สมศรี' },
        { name: 'LIST คุณ ค', phone: '0811110003' },
      ];
      for (const c of custs) await api('post', '/customers', A, c).expect(201);
    });

    it('products: every filter / sort / search gives the same rows in the same order as the old table', async () => {
      const catalog = (await api('get', '/products', A).expect(200)).body as any[];
      const meta = (await api('get', '/products/page?page=1&limit=5', A).expect(200)).body.meta;
      expect(meta.allCount).toBe(catalog.length);
      const threshold = meta.lowStockThreshold;
      // the store mapping (toStoreProduct) and the old useProductFilters
      const rows = catalog.map((p) => {
        const basePrice = Number(p.priceLevel1 || p.basePrice || 0);
        return {
          id: p.id, name: p.name, sku: p.sku, categoryId: p.categoryId, stock: Number(p.computedStock),
          basePrice, priceLevel1: p.priceLevel1 != null ? Number(p.priceLevel1) : basePrice,
          priceLevel2: p.priceLevel2 != null ? Number(p.priceLevel2) : null, priceLevel3: p.priceLevel3 != null ? Number(p.priceLevel3) : null,
          priceLevel4: p.priceLevel4 != null ? Number(p.priceLevel4) : null, priceLevel5: p.priceLevel5 != null ? Number(p.priceLevel5) : null,
          barcodes: [...p.barcodes.map((b: any) => b.barcode), ...p.packagingUnits.map((u: any) => u.barcode).filter(Boolean)],
          suppliers: p.supplierEntries.map((e: any) => e.supplierId),
        };
      });
      const old = (o: { q?: string; cat?: string; sup?: string; stock?: string; sort?: string; dir?: string }) => {
        const q = (o.q || '').toLowerCase();
        let list = rows.filter((p) => {
          const matchSearch = p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcodes.some((b: string) => b.trim().toLowerCase().includes(q));
          const matchStock = !o.stock ? true : o.stock === 'out' ? p.stock === 0 : o.stock === 'low' ? p.stock > 0 && p.stock <= threshold
            : o.stock === 'normal' ? p.stock > threshold : o.stock === 'negative' ? p.stock < 0 : p.stock <= threshold;
          return matchSearch && (!o.cat || p.categoryId === o.cat) && (!o.sup || p.suppliers.includes(o.sup)) && matchStock;
        });
        if (o.sort) {
          const k = o.sort as keyof (typeof rows)[number];
          list = [...list].sort((a, b) => {
            const av = a[k] ?? 0, bv = b[k] ?? 0;
            if (typeof av === 'string') return o.dir === 'asc' ? av.localeCompare(String(bv), 'th') : String(bv).localeCompare(av, 'th');
            return o.dir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av);
          });
        }
        return list.map((p) => p.id);
      };
      const cases: { q?: string; cat?: string; sup?: string; stock?: string; sort?: string; dir?: string }[] = [
        {}, { q: 'ปากกา' }, { q: 'list-' }, { q: '50%' }, { q: 'a_1' }, { q: '1112' }, { q: 'pack-list' }, { q: 'ไม่มีสินค้านี้' },
        { cat: state.listCat }, { sup: state.listSup }, { stock: 'out' }, { stock: 'low' }, { stock: 'normal' }, { stock: 'negative' }, { stock: 'reorder' },
        { sort: 'name', dir: 'asc' }, { sort: 'name', dir: 'desc' }, { sort: 'stock', dir: 'asc' }, { sort: 'stock', dir: 'desc' },
        { sort: 'basePrice', dir: 'desc' }, { sort: 'priceLevel1', dir: 'asc' }, { sort: 'priceLevel2', dir: 'desc' }, { sort: 'priceLevel5', dir: 'asc' },
        { q: 'list', sort: 'name', dir: 'asc', stock: 'out' },
      ];
      for (const c of cases) {
        const qs = new URLSearchParams();
        if (c.q) qs.set('q', c.q);
        if (c.cat) qs.set('categoryId', c.cat);
        if (c.sup) qs.set('supplierId', c.sup);
        if (c.stock) qs.set('stock', c.stock);
        if (c.sort) { qs.set('sort', c.sort); qs.set('dir', c.dir!); }
        const { rows: got, first } = await allPages(`/products/page?${qs.toString()}`, 7);
        expect({ c, ids: got.map((p) => p.id) }).toEqual({ c, ids: old(c) });
        expect(first.meta.total).toBe(old(c).length);
      }
      // rows are the catalogue rows
      const one = (await api('get', '/products/page?page=1&limit=1&q=LIST-A_1', A).expect(200)).body.data[0];
      const { unitCost: oneCost, ...oneRow } = one;
      expect(oneRow).toEqual(catalog.find((p) => p.sku === 'LIST-A_1'));
      expect(typeof oneCost === 'number' || oneCost === null).toBe(true);
      // inventory cards over every product
      const st = (await api('get', '/products/page?page=1&limit=1&stats=1', A).expect(200)).body.stats;
      // BUG-05 v1.5.3: valued at cost (FIFO pool of the stock on hand, else the reference cost), never the selling price
      const pdb = new PrismaClient();
      const batches = await pdb.stockBatch.findMany({ select: { productId: true, quantityRemaining: true, unitCost: true } });
      const prods = await pdb.product.findMany({ select: { id: true, isBundle: true, costPrice: true } });
      await pdb.$disconnect();
      const val = prods.reduce((sum, p) => {
        if (p.isBundle) return sum;
        const mine = batches.filter((b) => b.productId === p.id);
        const stockQ = mine.reduce((t, b) => t + Number(b.quantityRemaining), 0);
        if (stockQ <= 0) return sum;
        const pos = mine.filter((b) => Number(b.quantityRemaining) > 0);
        const posQ = pos.reduce((t, b) => t + Number(b.quantityRemaining), 0);
        const posV = pos.reduce((t, b) => t + Number(b.quantityRemaining) * Number(b.unitCost), 0);
        const unit = posQ > 0 && posV > 0 ? posV / posQ : Number(p.costPrice ?? 0);
        return sum + stockQ * unit;
      }, 0);
      expect(st.totalItems).toBe(rows.length);
      expect(st.totalBaseUnits).toBeCloseTo(rows.reduce((s, p) => s + p.stock, 0), 6);
      expect(st.totalValuation).toBeCloseTo(val, 6);
      expect(st.outOfStockCount).toBe(rows.filter((p) => p.stock === 0).length);
      expect(st.lowStockCount).toBe(rows.filter((p) => p.stock > 0 && p.stock <= threshold).length);
      expect(st.negativeStockCount).toBe(rows.filter((p) => p.stock < 0).length);
      await api('get', '/products/page?stock=bad', A).expect(400);
      await api('get', '/products/page?sort=costPrice', A).expect(400);
      // cashier: no cost fields
      const cRow = (await api('get', '/products/page?page=1&limit=1&q=LIST-A_1', C).expect(200)).body.data[0];
      expect(cRow.costPrice).toBeUndefined();
      // past the last page: empty rows, real total
      const past = (await api('get', '/products/page?page=999&limit=50&q=LIST', A).expect(200)).body;
      expect(past.data).toEqual([]);
      expect(past.meta.total).toBe(old({ q: 'list' }).length);
    });

    it('customers: paged list == old page filters over the full list; cards + next code over every customer', async () => {
      const full = (await api('get', '/customers', A).expect(200)).body as any[];
      expect(full.every((c) => c.debts === undefined && typeof c.currentDebt === 'number')).toBe(true);
      const norm = full.map((c, idx) => ({
        ...c, type: c.type === 'COMPANY' ? 'COMPANY' : 'INDIVIDUAL', code: c.code || `CUST-${String(idx + 1).padStart(4, '0')}`,
        creditLimit: Number(c.creditLimit ?? 0), priceLevel: [1, 2, 3, 4, 5].includes(Number(c.priceLevel)) ? Number(c.priceLevel) : 1,
      }));
      const old = (search: string, type: string, level: string) => norm.filter((c) => {
        const q = search.toLowerCase();
        const m = c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.code && c.code.toLowerCase().includes(q))
          || (c.companyName && c.companyName.toLowerCase().includes(q)) || (c.taxId && c.taxId.includes(q)) || (c.contactPerson && c.contactPerson.toLowerCase().includes(q));
        const t = type === 'all' || (type === 'credit' ? c.creditLimit > 0 : type === 'hasDebt' ? c.currentDebt > 0 : c.type === type);
        return m && t && (level === 'all' || c.priceLevel === Number(level));
      }).map((c) => c.id);
      for (const [search, type, level] of [['', 'all', 'all'], ['list', 'all', 'all'], ['บจก', 'all', 'all'], ['0105551', 'all', 'all'], ['สมศรี', 'all', 'all'],
        ['cust-0042', 'all', 'all'], ['', 'COMPANY', 'all'], ['', 'INDIVIDUAL', 'all'], ['', 'credit', 'all'], ['', 'hasDebt', 'all'], ['', 'all', '2'], ['list', 'credit', '3']]) {
        const qs = new URLSearchParams({ type, priceLevel: level });
        if (search) qs.set('search', search);
        const { rows, first } = await allPages(`/customers?${qs.toString()}`, 2);
        expect({ search, type, level, ids: rows.map((c) => c.id) }).toEqual({ search, type, level, ids: old(search, type, level) });
        expect(rows.map((c) => c.currentDebt)).toEqual(rows.map((c) => full.find((f) => f.id === c.id).currentDebt));
        const stats = first.stats;
        expect(stats).toMatchObject({
          total: norm.length, companyCount: norm.filter((c) => c.type === 'COMPANY').length,
          totalCreditCustomers: norm.filter((c) => c.creditLimit > 0).length,
          totalPoints: norm.reduce((s, c) => s + Number(c.points || 0), 0),
        });
        expect(stats.totalDebt).toBeCloseTo(norm.reduce((s, c) => s + c.currentDebt, 0), 6);
        const maxCode = Math.max(0, ...norm.map((c) => Number((/CUST-(\d+)/i.exec(c.code) || [])[1] || 0)));
        expect(stats.nextCode).toBe(`CUST-${String(maxCode + 1).padStart(4, '0')}`);
      }
      await api('get', '/customers?page=1&type=bad', A).expect(400);
    });

    it('orders: pages, status tab, search and range counts', async () => {
      const all = (await api('get', '/orders?limit=1000', A).expect(200)).body.data as any[];
      const { rows, first } = await allPages('/orders?counts=1', 3);
      expect(rows.map((o) => o.id)).toEqual(all.map((o) => o.id));
      const nonVoid = all.filter((o) => o.status !== 'VOIDED');
      expect(first.meta.counts).toEqual({
        all: all.length, completed: nonVoid.length, voided: all.length - nonVoid.length,
        revenue: Math.round(nonVoid.reduce((s, o) => s + Number(o.totalAmount), 0) * 100) / 100,
      });
      const voided = await allPages('/orders?statusGroup=voided', 3);
      expect(voided.rows.map((o) => o.id)).toEqual(all.filter((o) => o.status === 'VOIDED').map((o) => o.id));
      const done = await allPages('/orders?statusGroup=completed', 3);
      expect(done.rows.map((o) => o.id)).toEqual(nonVoid.map((o) => o.id));
      // search by a product name on the bill (the old page searched item names)
      const withItem = all.find((o) => o.items.length > 0);
      const name = withItem.items[0].product.name;
      const found = await allPages(`/orders?search=${encodeURIComponent(name)}`, 50);
      expect(found.rows.map((o) => o.id)).toEqual(all.filter((o) => o.items.some((i: any) => i.product.name.toLowerCase().includes(name.toLowerCase()))
        || o.orderNumber.toLowerCase().includes(name.toLowerCase()) || (o.note || '').toLowerCase().includes(name.toLowerCase())
        || (o.customer?.name || '').toLowerCase().includes(name.toLowerCase())).map((o) => o.id));
      expect((await api('get', `/orders?search=${encodeURIComponent(withItem.orderNumber)}`, A).expect(200)).body.data.map((o: any) => o.id)).toEqual([withItem.id]);
      await api('get', '/orders?statusGroup=bad', A).expect(400);
    });

    it('debts: status groups / customer filter / stats == old page logic over every debt', async () => {
      const all = (await api('get', '/debts?limit=500', A).expect(200)).body.data as any[];
      const now = Date.now();
      const paid = (d: any) => d.status === 'PAID' || Number(d.remainingAmount) <= 0;
      const groups: Record<string, (d: any) => boolean> = {
        all: () => true, unpaid: (d) => !paid(d), paid,
        overdue: (d) => !paid(d) && !!d.dueDate && new Date(d.dueDate).getTime() < now,
      };
      for (const [g, f] of Object.entries(groups)) {
        const { rows, first } = await allPages(`/debts?statusGroup=${g}&stats=1`, 2);
        expect({ g, ids: rows.map((d) => d.id) }).toEqual({ g, ids: all.filter(f).map((d) => d.id) });
        expect(first.stats).toMatchObject({
          totalBills: all.length, paidCount: all.filter(paid).length, unpaidCount: all.filter((d) => !paid(d)).length,
          overdueCount: all.filter(groups.overdue).length,
        });
        expect(first.stats.totalOutstanding).toBeCloseTo(all.reduce((s, d) => s + Number(d.remainingAmount), 0), 6);
      }
      if (all.length) {
        const d0 = all[0];
        const byCust = await allPages(`/debts?customerId=${d0.customerId}`, 50);
        expect(byCust.rows.map((d) => d.id)).toEqual(all.filter((d) => d.customerId === d0.customerId).map((d) => d.id));
        const byName = await allPages(`/debts?search=${encodeURIComponent(d0.customer.name)}`, 50);
        expect(byName.rows.map((d) => d.id)).toContain(d0.id);
        expect(byName.rows[0].customer).toHaveProperty('profile');
      }
      // POS debt picker: owing (remaining > 0) for a customer; orders page: the debts of given bills
      const owing = await allPages('/debts?statusGroup=owing', 50);
      expect(owing.rows.map((d) => d.id)).toEqual(all.filter((d) => Number(d.remainingAmount) > 0).map((d) => d.id));
      if (all.length) {
        const some = all.slice(0, 2).map((d) => d.orderId);
        const byOrders = (await api('get', `/debts?limit=500&orderIds=${some.join(',')},missing-id`, A).expect(200)).body.data as any[];
        expect(byOrders.map((d) => d.orderId).sort()).toEqual([...some].sort());
      }
      expect((await api('get', '/debts?orderIds=', A).expect(200)).body.data).toEqual([]);
      const company = await allPages('/debts?customerType=COMPANY', 50);
      expect(company.rows.every((d) => d.customer?.profile?.type === 'COMPANY')).toBe(true);
      await api('get', '/debts?statusGroup=bad', A).expect(400);
    });

    it('purchase orders: pages and status counts', async () => {
      const all = (await api('get', '/purchase-orders?limit=500', A).expect(200)).body.data as any[];
      const { rows, first } = await allPages('/purchase-orders?counts=1', 2);
      expect(rows.map((p) => p.id)).toEqual(all.map((p) => p.id));
      const expected: Record<string, number> = { ALL: all.length };
      for (const p of all) expected[p.status] = (expected[p.status] || 0) + 1;
      expect(first.meta.counts).toEqual(expected);
    });
  });
  describe('customer list: delta sync', () => {
    const sync = async (since?: string) =>
      (await api('get', `/customers/sync${since !== undefined ? `?since=${encodeURIComponent(since)}` : ''}`, A).expect(200)).body;
    const client = new Map<string, any>();
    let cursor = '';
    const pull = async () => {
      const b = await sync(cursor);
      if (b.full) client.clear();
      for (const c of b.customers) client.set(c.id, c);
      cursor = b.cursor;
      return b;
    };
    /** a delta row = the full-list row + its position in the full list */
    const strip = (rows: any[]) => rows.map(({ listIndex: _l, ...r }) => r);

    it('full list = GET /customers; deltas: new / edited customers, points, debts; deletion = full reload', async () => {
      const first = await pull();
      expect(first.full).toBe(true);
      expect(first.customers).toEqual((await api('get', '/customers', A).expect(200)).body);
      expect(await pull()).toMatchObject({ full: false, customers: [], deleted: [] });

      const created = (await api('post', '/customers', A, { name: 'SYNC ลูกค้า', phone: '0899990001' }).expect(201)).body;
      let d = await pull();
      expect(d.full).toBe(false);
      expect(d.customers.map((c: any) => c.id)).toEqual([created.id]);
      const list = (await api('get', '/customers', A).expect(200)).body as any[];
      expect(d.customers[0].listIndex).toBe(list.findIndex((c) => c.id === created.id));
      expect(strip(d.customers)).toEqual([list.find((c) => c.id === created.id)]);

      await api('patch', `/customers/${created.id}`, A, { name: 'SYNC ลูกค้า แก้ไข' }).expect(200);
      d = await pull();
      expect(d.customers.map((c: any) => c.name)).toEqual(['SYNC ลูกค้า แก้ไข']);

      // points (sale / redeem) and a debt's remaining amount (credit sale / receipt) change the row too
      const prisma = new PrismaClient();
      try {
        await prisma.customer.update({ where: { id: created.id }, data: { points: 42 } });
        const debt = await prisma.customerDebt.findFirst({ where: { remainingAmount: { gt: 0 } } });
        expect(debt).toBeTruthy();
        await prisma.customerDebt.update({ where: { id: debt!.id }, data: { remainingAmount: { decrement: 1 } } });
        d = await pull();
        expect(d.customers.map((c: any) => c.id).sort()).toEqual([created.id, debt!.customerId].sort());
        await prisma.customerDebt.update({ where: { id: debt!.id }, data: { remainingAmount: { increment: 1 }, status: debt!.status } });
        await pull();
        // a status-only debt update (overdue marking) is not a change of the list row
        await prisma.customerDebt.update({ where: { id: debt!.id }, data: { note: 'x' } });
        expect((await pull()).customers).toEqual([]);
      } finally {
        await prisma.$disconnect();
      }

      await api('delete', `/customers/${created.id}`, A).expect(200);
      d = await pull();
      expect(d.full).toBe(true);
      expect(d.customers.some((c: any) => c.id === created.id)).toBe(false);
      // client copy == a fresh full list; bad cursors give a full reload
      expect(strip([...client.values()])).toEqual((await api('get', '/customers', A).expect(200)).body);
      for (const bad of ['garbage', 'v1.1-2.0.AAAA', cursor.replace(/^v1\.\d+-\d+/, 'v1.1-1')]) expect((await sync(bad)).full).toBe(true);
    });
  });
  // ─── claims screens over every claim (task 6): the server endpoints == the old page logic over the list ───
  const screens = {
    /** every page of a paged endpoint (`data` rows) */
    pages: async (path: string, limit: number, token = A) => {
      const out: any[] = [];
      let first: any;
      for (let page = 1; page < 10000; page++) {
        const body = (await api('get', `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=${limit}`, token).expect(200)).body;
        first = first || body;
        const rows = Array.isArray(body.data) ? body.data : body.products.data;
        out.push(...rows);
        if (rows.length < limit) break;
      }
      return { rows: out, first };
    },
    /** what the pages had loaded: store products, suppliers, product-suppliers of the returnable claims */
    state: async (returnableMapped: any[] | null) => {
      const catalog = (await api('get', '/products/sync', A).expect(200)).body.products as any[];
      const storeProducts = catalog.map(legacyScreens.toStoreProduct);
      const suppliers = (await api('get', '/suppliers', A).expect(200)).body as any[];
      const productPoSupplier = new Map<string, any>();
      if (returnableMapped) {
        const ids = [...new Set(returnableMapped.filter((c) => !c.returnDocId && c.status !== 'SCRAPPED').map((c) => c.productId).filter(Boolean))];
        for (let i = 0; i < ids.length; i += 200) {
          const rows = (await api('get', `/purchase-orders/product-suppliers?ids=${ids.slice(i, i + 200).join(',')}`, A).expect(200)).body;
          for (const r of rows) productPoSupplier.set(r.productId, { supplierId: r.supplierId, supplierName: r.supplierName });
        }
      }
      return { storeProducts, suppliers, productPoSupplier, purchaseOrders: [] as any[] };
    },
    near: (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)),
    /** every screen: server == legacy logic over `claimRows` (GET /claims rows the page would have had) */
    compare: async (claimRows: any[]) => {
      const near = screens.near;
      const expectNear = (a: number, b: number, what: string) => { if (!near(Number(a), Number(b))) throw new Error(`${what}: ${a} != ${b}`); };
      const st0 = await screens.state(null);
      // a CLAIM_META bill number that is not text (12345) is text on the server; the old pages threw on it when searching
      const mapped = claimRows.map((c) => legacyScreens.mapServerClaim(c, st0.storeProducts))
        .map((c) => (typeof c.orderNumber === 'number' ? { ...c, orderNumber: String(c.orderNumber) } : c));

      // claims page: rows of every filter, cards over every claim
      const filters = [
        { resolutionFilter: 'ALL', startDate: '', endDate: '', search: '' },
        { resolutionFilter: 'REFUND_CASH', startDate: '', endDate: '', search: '' },
        { resolutionFilter: 'ALL', startDate: '', endDate: '', search: 'scr' },
        { resolutionFilter: 'ALL', startDate: '', endDate: '', search: '  CLM-SCR-0  ' },
        { resolutionFilter: 'SUPPLIER_RMA', startDate: '2026-01-01', endDate: '2026-12-31', search: 'สินค้า' },
        { resolutionFilter: 'ALL', startDate: '2020-01-01', endDate: '2020-01-05', search: '' },
      ];
      const byNo = new Map(claimRows.map((c) => [c.claimNumber, c]));
      for (const f of filters) {
        const qs = new URLSearchParams({ resolutionType: f.resolutionFilter, ...(f.startDate ? { startDate: f.startDate, endDate: f.endDate } : {}), ...(f.search ? { search: f.search } : {}) });
        const { rows, first } = await screens.pages(`/claims/list?${qs}`, 7);
        const expected = legacyScreens.claimsPageFilter(mapped, f).map((c) => c.id);
        expect(rows.map((r: any) => r.claimNumber)).toEqual(expected);
        expect(first.meta.total).toBe(expected.length);
        expect(rows).toEqual(expected.map((no) => byNo.get(no)));
        const sum = legacyScreens.getClaimStockSummary(mapped);
        for (const k of Object.keys(sum) as (keyof typeof sum)[]) expectNear(first.summary[k], sum[k], `summary ${k}`);
      }
      const oldest = (await api('get', '/claims/list?sort=oldest&limit=500', A).expect(200)).body.data;
      expect(oldest.map((r: any) => r.claimNumber)).toEqual([...mapped].reverse().slice(0, 500).map((c) => c.id));

      // dashboard claim refunds
      for (const from of [undefined, Date.parse('2026-01-01T00:00:00+07:00'), Date.now() - 86400000, Date.now() + 86400000]) {
        const body = (await api('get', `/claims/refund-summary${from === undefined ? '' : `?from=${from}`}`, A).expect(200)).body;
        const old = legacyScreens.dashboardClaimRefunds(mapped, from === undefined ? -Infinity : from);
        expect(body.count).toBe(old.count);
        expectNear(body.amount, old.amount, 'refund amount');
      }

      // claims of bills (eligibility check): every claim matching a bill by id / number
      const orders = (await api('get', '/orders?limit=100', A).expect(200)).body.data as any[];
      const ids = orders.map((o) => o.id);
      const got = (await api('get', `/claims/by-orders?orderIds=${ids.join(',')}`, A).expect(200)).body.data as any[];
      const gotMapped = got.map((c) => legacyScreens.mapServerClaim(c, st0.storeProducts));
      const matches = (c: any) => orders.some((o) => c.orderId === o.id || c.orderNumber === (o.orderNumber || o.id));
      expect(gotMapped.filter(matches).map((c) => c.id).sort()).toEqual(mapped.filter(matches).map((c) => c.id).sort());

      // supplier returns page: cards
      const returnable = mapped.filter((c) => !c.returnDocId && c.status !== 'SCRAPPED');
      const st = await screens.state(returnable);
      const pending = legacyScreens.getEligibleClaimsForReturn(st, mapped);
      const cards = legacyScreens.supplierReturnsCards(pending, st.suppliers);
      expect(pending.length).toBeGreaterThan(8);
      expect(cards.cards.length).toBeGreaterThan(1);
      const summary = (await api('get', '/claims/returnable/summary', A).expect(200)).body;
      expect(summary.total).toBe(cards.count);
      expectNear(summary.totalCostValue, cards.totalPendingClaimsCost, 'pending cost');
      const groupsBySupplier = new Map(summary.suppliers.map((g: any) => [g.supplierId, g]));
      const shown = st.suppliers.filter((s: any) => groupsBySupplier.has(s.id)).map((s: any) => s.id);
      expect(shown).toEqual(cards.cards.map((c) => c.supplierId));
      for (const card of cards.cards) {
        const g: any = groupsBySupplier.get(card.supplierId);
        expect(g.count).toBe(card.count);
        expectNear(g.totalCostValue, card.totalVal, `card ${card.supplierId}`);
        expect(g.top.map((t: any) => [t.id, t.productName])).toEqual(card.top.map((t) => [t.id, t.productName]));
        g.top.forEach((t: any, k: number) => expectNear(t.quantity, card.top[k].quantity, 'top qty'));
      }

      // create-return dialog for each supplier: its claims and the other claims, grouped by product
      const all = pending;
      for (const supp of st.suppliers.slice(0, 12)) {
        const pos: any[] = [];
        for (let page = 1; page < 100; page++) {
          const list = (await api('get', `/purchase-orders?supplierId=${supp.id}&limit=500&page=${page}`, A).expect(200)).body.data;
          pos.push(...list);
          if (list.length < 500) break;
        }
        const dst = { ...st, purchaseOrders: pos };
        const available = legacyScreens.getEligibleClaimsForReturn(dst, mapped, supp.id);
        const other = legacyScreens.getEligibleClaimsForReturn(dst, mapped).filter((c) => !available.some((ac) => ac.id === c.id));
        void all;
        for (const [scope, claims] of [['supplier', available], ['other', other]] as const) {
          const expectedGroups = legacyScreens.groupClaimsByProduct(claims as any[]);
          const { rows, first } = await screens.pages(`/claims/returnable/groups?supplierId=${supp.id}&scope=${scope}`, 3);
          expect(first.totals.groups).toBe(expectedGroups.length);
          expect(first.totals.claims).toBe((claims as any[]).length);
          const hund = (v: any) => { const n = Number(v); const q = Number.isFinite(n) ? n : 0; return Math.round(q * 100 + (q >= 0 ? 1e-7 : -1e-7)); };
          expectNear(first.totals.pieces, (claims as any[]).reduce((s, c) => s + hund(c.quantity || 1), 0) / 100, 'pieces');
          expect(rows.map((g: any) => g.groupKey)).toEqual(expectedGroups.map((g) => g.groupKey));
          rows.forEach((g: any, k: number) => {
            const e = expectedGroups[k];
            for (const f of ['productId', 'productName', 'sku', 'unitName', 'claimCount', 'claimIds', 'defectReasons', 'orderNumbers', 'supplierId']) expect([f, g[f]]).toEqual([f, e[f]]);
            expect(g.supplierName ?? null).toEqual(e.supplierName ?? null);
            expectNear(g.totalQuantity, e.totalQuantity, 'group qty');
            expectNear(g.costPrice, e.costPrice, 'group cost');
          });
          if (expectedGroups.length) {
            const term = String(expectedGroups[expectedGroups.length - 1].sku).toLowerCase();
            const hit = (await api('get', `/claims/returnable/groups?supplierId=${supp.id}&scope=${scope}&search=${encodeURIComponent(term.toUpperCase())}&limit=500`, A).expect(200)).body;
            const want = expectedGroups.filter((eg) => (claims as any[]).some((c) => `PID_${c.productId}` === eg.groupKey && [c.productName, c.sku, c.id, c.orderNumber].some((x) => String(x || '').toLowerCase().includes(term))));
            expect(hit.data.map((g: any) => g.groupKey)).toEqual(want.map((g) => g.groupKey));
          }
        }
      }

      // claim stock page (fresh page: no PO suppliers asked, no POs loaded)
      const items = legacyScreens.claimInventoryItems(st0, mapped);
      const cats = [...new Set(items.map((i) => i.category))];
      const views = [
        { statusFilter: 'IN_STOCK', selectedSupplierId: 'ALL', categoryFilter: 'ALL', search: '' },
        { statusFilter: 'ALL', selectedSupplierId: 'ALL', categoryFilter: 'ALL', search: '' },
        { statusFilter: 'RETURNED', selectedSupplierId: 'ALL', categoryFilter: 'ALL', search: '' },
        { statusFilter: 'ALL', selectedSupplierId: items[0]?.supplierId || 'ALL', categoryFilter: 'ALL', search: '' },
        { statusFilter: 'ALL', selectedSupplierId: 'ALL', categoryFilter: cats[cats.length - 1] || 'ALL', search: '' },
        { statusFilter: 'IN_STOCK', selectedSupplierId: 'ALL', categoryFilter: 'ALL', search: 'scr' },
      ];
      const sameDate = (a: any, b: any) => expect(new Date(a).getTime()).toBe(new Date(b).getTime());
      const sameItem = (g: any, e: any) => {
        for (const f of ['id', 'claimId', 'orderNumber', 'customerName', 'customerPhone', 'productId', 'productName', 'sku', 'category', 'supplierId', 'supplierName', 'defectReason', 'unitName', 'status']) expect([f, g[f]]).toEqual([f, e[f]]);
        for (const f of ['quantity', 'costPrice', 'unitPrice', 'totalCostValue', 'totalClaimValue']) expectNear(g[f], e[f], f);
        expect(!!g.returnDocId).toBe(!!e.returnDocId);
        sameDate(g.claimDate, e.claimDate);
      };
      for (const v of views) {
        const old = legacyScreens.claimInventoryView(items, st0.suppliers, v);
        const qs = new URLSearchParams({ status: v.statusFilter, supplierId: v.selectedSupplierId, category: v.categoryFilter, ...(v.search ? { search: v.search } : {}) });
        const { rows: products, first } = await screens.pages(`/claims/claim-stock?${qs}&recordsLimit=500`, 4);
        expect(first.categories).toEqual(old.categoryOptions);
        expect(first.filteredCount).toBe(old.filteredClaims.length);
        expect(first.stats.uniqueProducts).toBe(old.stats.uniqueProducts);
        expect(first.stats.suppliersCount).toBe(old.stats.suppliersCount);
        expectNear(first.stats.pieces, old.stats.pieces, 'pieces');
        expectNear(first.stats.costValue, old.stats.costValue, 'cost');
        expect(products.map((p: any) => `${p.productId}_${p.sku}_${p.supplierId}`)).toEqual(old.productSummaries.map((p) => `${p.productId}_${p.sku}_${p.supplierId}`));
        expect(first.products.total).toBe(old.productSummaries.length);
        products.forEach((p: any, k: number) => {
          const e = old.productSummaries[k];
          for (const f of ['productName', 'category', 'supplierName', 'unitName']) expect([f, p[f]]).toEqual([f, e[f]]);
          for (const f of ['costPrice', 'unitPrice', 'totalPieces', 'inStockPieces', 'totalCostValue', 'inStockCostValue', 'totalClaimValue']) expectNear(p[f], e[f], f);
          expect(p.claimCount).toBe(e.claims.length);
          sameDate(p.latestClaimDate, e.latestClaimDate);
        });
        expect(first.suppliers.map((s: any) => s.supplierId)).toEqual(old.supplierSummaries.map((s) => s.supplierId));
        first.suppliers.forEach((s: any, k: number) => {
          const e = old.supplierSummaries[k];
          expect([s.supplierName, s.supplierPhone ?? null, s.productCount]).toEqual([e.supplierName, e.supplierPhone ?? null, e.productCount]);
          for (const f of ['totalPieces', 'inStockPieces', 'totalCostValue', 'inStockCostValue', 'totalClaimValue']) expectNear(s[f], e[f], f);
          sameDate(s.latestClaimDate, e.latestClaimDate);
        });
        expect(first.records.total).toBe(old.filteredClaims.length);
        expect(first.records.data.map((r: any) => r.id)).toEqual(old.filteredClaims.slice(0, 500).map((r) => r.id));
        first.records.data.forEach((r: any, k: number) => sameItem(r, old.filteredClaims[k]));
        for (const p of old.productSummaries.slice(0, 3)) {
          const pq = new URLSearchParams({ productId: p.productId, sku: p.sku, rowSupplierId: p.supplierId });
          const list = (await api('get', `/claims/claim-stock/claims?${qs}&${pq}`, A).expect(200)).body;
          expect(list.map((r: any) => r.id)).toEqual(p.claims.map((c: any) => c.id));
          list.forEach((r: any, k: number) => sameItem(r, p.claims[k]));
        }
      }
      return { mapped, pending };
    },
    seed: async () => {
      const db = new PrismaClient();
      try {
        const admin = await db.user.findFirstOrThrow({ where: { username: 'admin' } });
        const cat = await db.category.create({ data: { name: 'SCR หมวดเคลม' } });
        const sup = async (name: string, isActive = true) => db.supplier.create({ data: { name, isActive } });
        const s1 = await sup('SCR ผู้จำหน่าย หนึ่ง');
        const s2 = await sup('  scr ผู้จำหน่าย สอง ');
        const s3 = await sup('SCR ผู้จำหน่าย ปิด', false);
        const s4 = await sup('SCR ผู้จำหน่าย สี่');
        const prod = (k: string, data: any = {}) => db.product.create({ data: { name: `SCR สินค้า ${k}`, sku: `SCR-${k}`, basePrice: 120, costPrice: 70, priceLevel1: 110, ...data } });
        const pA = await prod('A', { categoryId: cat.id, unit: 'กล่อง' });
        const pB = await prod('B', { costPrice: 0 });
        const pC = await prod('C', { costPrice: 0, priceLevel1: null, basePrice: 0 });
        const pD = await prod('D', { name: 'SCR ชื่อซ้ำ' });
        const pE = await prod('E', { name: 'SCR ชื่อซ้ำ', priceLevel1: 0 });
        const pF = await prod('F', { unit: '' });
        await db.productSupplier.create({ data: { productId: pA.id, supplierId: s1.id, isPreferred: true, unitCost: 65 } });
        await db.productSupplier.create({ data: { productId: pA.id, supplierId: s4.id } });
        await db.productSupplier.create({ data: { productId: pB.id, supplierId: s3.id } }); // inactive supplier
        await db.productSupplier.create({ data: { productId: pC.id, supplierId: s4.id, unitCost: null } });
        // POs: newest PO of pB is from s2; pD on an s4 PO (pE shares its name)
        const po = async (supplierId: string, items: any[], ago: number) => db.purchaseOrder.create({ data: {
          poNumber: `SCR-PO-${supplierId.slice(0, 6)}-${ago}`, supplierId, status: 'COMPLETED', totalAmount: 100, createdAt: new Date(Date.now() - ago * 1000),
          items: { create: items.map((p) => ({ productId: p.id, quantity: 1, unitCost: 50, receivedQty: 1, total: 50 })) },
        } });
        await po(s4.id, [pB], 50);
        await po(s2.id, [pB, pF], 10);
        await po(s4.id, [pD], 20);
        await po(s3.id, [pF], 5); // newest PO of pF: inactive supplier -> by name: none -> next rule
        const cust = await db.customer.create({ data: { name: 'SCR ลูกค้า', phone: '0890000001' } });
        const ord = await db.order.create({ data: { orderNumber: 'SCR-ORD-1', userId: admin.id, customerId: cust.id, subtotal: 100, totalAmount: 100, status: 'COMPLETED' } });
        let t = Date.parse('2026-06-01T00:00:00Z');
        let n = 0;
        const claim = async (p: any, data: any, metas: any[], exch?: any) => {
          const no = `CLM-SCR-${String(++n).padStart(3, '0')}`;
          const c = await db.customerClaim.create({ data: { claimNumber: no, productId: p.id, claimType: 'WARRANTY', problemDescription: 'scr e2e', receivedDate: new Date((t -= 3600000)), ...data } });
          for (const [k, details] of metas.entries()) {
            await db.auditLog.create({ data: { action: 'CLAIM_META', entity: 'CustomerClaim', entityId: c.id, details, createdAt: new Date(t + k * 1000) } });
          }
          if (exch) await db.auditLog.create({ data: { action: 'EXCHANGE', entity: 'CustomerClaim', entityId: c.id, details: { result: exch }, createdAt: new Date(t - 1000) } });
          return c;
        };
        const m = (x: any) => ({ frontendStatus: 'PENDING_SUPPLIER', resolutionType: 'SUPPLIER_RMA', quantity: 1, unitPrice: 100, totalClaimValue: 100, ...x });
        await claim(pA, {}, [m({ supplierId: s1.id, supplierName: s1.name, costPrice: 60 })]);
        await claim(pA, {}, [m({ quantity: 2, baseQuantity: 24, conversionFactor: 12, unitName: 'โหล', replacementUnitName: 'ชิ้น', totalClaimValue: 2400 })]);
        await claim(pB, {}, [m({ costPrice: '45.5' })]); // entry supplier inactive -> newest PO s2
        await claim(pC, {}, [m({ unitPrice: undefined, totalClaimValue: undefined, costPrice: 0 })]); // entry s4, cost 0 everywhere
        await claim(pD, {}, [m({ supplierName: ' scr ผู้จำหน่าย สอง', supplierId: 'not-a-supplier' })]);
        await claim(pE, {}, [m({ costPrice: null, unitPrice: null })]); // PO name match for s4
        await claim(pF, {}, [m({ quantity: 1.5, baseQuantity: 1.5 })]); // newest PO supplier inactive -> first supplier
        await claim(pA, { orderId: ord.id, customerId: cust.id }, [m({ resolutionType: 'REFUND_CASH', frontendStatus: 'COMPLETED', refundAmount: 90, totalClaimValue: 0 })]);
        await claim(pB, {}, [m({ resolutionType: 'REFUND_TRANSFER', frontendStatus: 'COMPLETED', totalClaimValue: null, refundAmount: '77.25', claimDate: '2025-12-31T23:00:00.000Z' })]);
        await claim(pA, {}, [m({ returnDocId: 'SRN-SCR-1', frontendStatus: 'SENT_TO_SUPPLIER' })]);
        await claim(pA, {}, [m({ frontendStatus: 'SCRAPPED' })]);
        await claim(pC, { status: 'IN_PROGRESS' }, [{ orderNumber: 'SCR-ORD-1', supplierId: s4.id }]); // meta without status
        await claim(pD, { status: 'PENDING', claimType: 'REFUND' }, []); // no meta at all
        await claim(pE, {}, [m({ resolutionType: 'STORE_DISCOUNT', frontendStatus: 'PENDING_CHECKOUT', discountAmount: 30 })]);
        await claim(pF, {}, [m({ quantity: '3', unitPrice: '12.5', totalClaimValue: undefined, defectReason: 'จอแตก' })]);
        await claim(pA, { claimType: 'EXCHANGE' }, [m({ resolutionType: undefined, quantity: undefined, unitPrice: undefined, totalClaimValue: undefined })], { quantity: 4, unitPrice: 33, baseQuantity: 4 });
        await claim(pB, {}, [m({ frontendStatus: 'SUPPLIER_REPLACED' }), { note: 'later', supplierId: s2.id }]);
        await claim(pC, {}, [m({ frontendStatus: 'COMPLETED', resolutionType: 'REPLACE_ITEM', customerName: 'SCR คนเดินผ่าน', orderNumber: 'SCR-NO-BILL' })]);
        await claim(pD, { receivedDate: new Date('2020-01-03T10:00:00Z') }, [m({ costPrice: 12 })]);
        await claim(pE, {}, [m({ frontendStatus: 'REJECTED' })]);
      } finally {
        await db.$disconnect();
      }
    },
  };

  describe('claims screens under the cap: every server figure == the old page logic (task 6)', () => {
    beforeAll(async () => { await screens.seed(); });

    it('claims page, dashboard refunds, claims of bills, supplier returns cards + dialog, claim stock', async () => {
      const capped = (await api('get', '/claims?limit=500', A).expect(200)).body.data as any[];
      expect(capped.length).toBeLessThan(500);
      expect(capped.length).toBeGreaterThan(15);
      await screens.compare(capped);
    });

    it('claim numbers come from the database: unique and in sequence under concurrent creates', async () => {
      const p = (await api('get', '/products/sync', A).expect(200)).body.products.find((x: any) => x.sku === 'SCR-A');
      const made = await Promise.all(Array.from({ length: 6 }, () =>
        api('post', '/claims', A, { productId: p.id, quantity: 1, claimType: 'WARRANTY', resolutionType: 'SUPPLIER_RMA', problemDescription: 'scr seq' }).expect(201)));
      const nos = made.map((r) => r.body.claimNumber as string).sort();
      expect(new Set(nos).size).toBe(6);
      const seqs = nos.map((no) => Number(no.slice(-4)));
      expect(seqs.slice(1).map((s, k) => s - seqs[k])).toEqual([1, 1, 1, 1, 1]);
      expect(nos[0]).toMatch(/^CL\d{4}-\d{4}$/); // round 4: CL<YYMM>-<NNNN>
      // the new claims are in the facts at once (trigger), with the status the server gave them
      const list = (await api('get', '/claims/list?search=scr%20seq&limit=50', A).expect(200)).body;
      expect(list.meta.total).toBe(6);
    });

    it('rejects bad parameters with 400', async () => {
      await api('get', '/claims/list?limit=0', A).expect(400);
      await api('get', '/claims/list?resolutionType=NOPE', A).expect(400);
      await api('get', '/claims/list?sort=x', A).expect(400);
      await api('get', '/claims/refund-summary?from=abc', A).expect(400);
      await api('get', '/claims/returnable/groups', A).expect(400);
      await api('get', '/claims/returnable/groups?supplierId=x&scope=all', A).expect(400);
      await api('get', '/claims/claim-stock?status=x', A).expect(400);
      await api('get', '/claims/claim-stock/claims?productId=x', A).expect(400);
      await api('get', `/claims/by-orders?orderIds=${Array.from({ length: 501 }, (_, k) => `x${k}`).join(',')}`, A).expect(400);
    });
  });

  describe('claims: claimed bills and returnable claims over every claim (was the newest 500)', () => {
    const o: any[] = [];
    const claimNo: Record<string, string> = {};
    const allOrders = async () => {
      const out: any[] = [];
      for (let page = 1; page < 1000; page++) {
        const body = (await api('get', `/orders?page=${page}&limit=100`, A).expect(200)).body;
        out.push(...body.data);
        if (body.data.length < 100) break;
      }
      return out;
    };
    const claimedIds = async (ids: string[]) => {
      const out = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        for (const id of (await api('get', `/claims/claimed-orders?orderIds=${ids.slice(i, i + 500).join(',')}`, A).expect(200)).body) out.add(id);
      }
      return out;
    };
    /** new page logic: linked claims come with the order, the server adds bills claimed by number */
    const newHasClaims = (row: any, claimed: Set<string>) => (Array.isArray(row.claims) && row.claims.length > 0) || claimed.has(row.id);
    const compare = async (claimRows: any[]) => {
      const orders = await allOrders();
      const keys = legacyClaims.claimedKeys(claimRows);
      const claimed = await claimedIds(orders.map((x) => x.id));
      const expected = orders.filter((x) => legacyClaims.orderHasClaims(x, keys)).map((x) => x.id);
      expect(orders.filter((x) => newHasClaims(x, claimed)).map((x) => x.id)).toEqual(expected);
      const returnable = (await api('get', '/claims/returnable', A).expect(200)).body;
      const eligible = legacyClaims.eligibleClaimIds(claimRows);
      expect(returnable.data.map((c: any) => c.claimNumber)).toEqual(eligible);
      expect(returnable.meta.total).toBe(eligible.length);
      const byNo = new Map(claimRows.map((c) => [c.claimNumber, c]));
      expect(returnable.data).toEqual(eligible.map((no) => byNo.get(no)));
      return { orders, claimed, eligible };
    };

    beforeAll(async () => {
      const db = new PrismaClient();
      try {
        const admin = await db.user.findFirstOrThrow({ where: { username: 'admin' } });
        const p = await db.product.create({ data: { name: 'CLM สินค้าเคลม', sku: 'CLM-E2E-P', basePrice: 100, costPrice: 40 } });
        for (let k = 1; k <= 10; k++) {
          o.push(await db.order.create({ data: { orderNumber: `CLM-E2E-ORD-${k}`, userId: admin.id, subtotal: 100, totalAmount: 100, status: 'COMPLETED', createdAt: new Date(Date.now() - k * 1000) } }));
        }
        let t = Date.now() - 3600000;
        const claim = async (key: string, data: any, metas: any[]) => {
          const no = `CLM-E2E-${key}`;
          claimNo[key] = no;
          const c = await db.customerClaim.create({ data: { claimNumber: no, productId: p.id, claimType: 'EXCHANGE', problemDescription: 'e2e', receivedDate: new Date((t -= 1000)), ...data } });
          for (const [k, details] of metas.entries()) {
            await db.auditLog.create({ data: { action: 'CLAIM_META', entity: 'CustomerClaim', entityId: c.id, details, createdAt: new Date(t + k) } });
          }
          return c;
        };
        const meta = (extra: any) => ({ frontendStatus: 'PENDING_SUPPLIER', status: 'PENDING_SUPPLIER', ...extra });
        await claim('c1', { orderId: o[0].id }, [meta({ orderNumber: o[0].orderNumber })]); // linked
        await claim('c2', {}, [meta({ orderNumber: o[1].orderNumber })]); // by bill number only
        await claim('c3', {}, [meta({ orderNumber: o[2].id })]); // "bill number" = the order id
        await claim('c4', {}, [meta({ orderNumber: o[3].orderNumber }), meta({ orderNumber: o[4].orderNumber })]); // later log wins: o[4]
        await claim('c5', {}, [meta({ orderNumber: o[5].orderNumber, returnDocId: 'SRN-E2E-1' })]); // on a return note
        await claim('c6', {}, [meta({ returnDocId: '', frontendStatus: 'SCRAPPED' })]);
        await claim('c7', { status: 'REJECTED' }, []); // no metadata, rejected
        await claim('c8', { status: 'PENDING' }, []); // no metadata: bill number "-"
        await claim('c9', {}, [{ status: 'SCRAPPED' }]); // status only
        await claim('c10', {}, [meta({ returnDocId: null })]);
        await claim('c11', {}, [meta({ returnDocId: 'SRN-E2E-2' }), { note: 'later log without returnDocId' }]);
        await claim('c12', {}, [meta({ frontendStatus: 'REJECTED' })]);
        await claim('c13', { orderId: o[6].id }, [meta({ orderNumber: o[7].orderNumber })]); // linked order wins over metadata
        await claim('c14', { status: 'IN_PROGRESS' }, [{ orderNumber: 12345 }]); // non-string bill number
      } finally {
        await db.$disconnect();
      }
    });

    it('under the cap: same claimed bills and returnable claims as the old page logic', async () => {
      const claimRows = (await api('get', '/claims?limit=500', A).expect(200)).body.data as any[];
      expect(claimRows.length).toBeLessThan(500);
      const { claimed, eligible } = await compare(claimRows);
      expect([1, 2, 4].map((k) => claimed.has(o[k].id))).toEqual([true, true, true]);
      expect([3, 5, 7, 8].map((k) => claimed.has(o[k].id))).toEqual([false, true, false, false]);
      for (const k of ['c2', 'c3', 'c8', 'c10', 'c14']) expect(eligible).toContain(claimNo[k]);
      for (const k of ['c5', 'c6', 'c7', 'c9', 'c11', 'c12']) expect(eligible).not.toContain(claimNo[k]);
      expect((await api('get', '/claims/claimed-orders', A).expect(200)).body).toEqual([]);
      expect((await api('get', `/claims/claimed-orders?orderIds=${o[1].id},nope,${o[1].id}`, A).expect(200)).body).toEqual([o[1].id]);
      await api('get', `/claims/claimed-orders?orderIds=${Array.from({ length: 501 }, (_, k) => `x${k}`).join(',')}`, A).expect(400);
    });

    it('above the cap: older claims are found (the old 500-claim list missed them)', async () => {
      const db = new PrismaClient();
      try {
        const p = await db.product.findFirstOrThrow({ where: { sku: 'CLM-E2E-P' } });
        const old = new Date('2020-01-01T00:00:00Z');
        await db.customerClaim.createMany({
          data: Array.from({ length: 600 }, (_, k) => ({ id: `clm-bulk-${k}`, claimNumber: `CLM-BULK-${k}`, productId: p.id, claimType: 'REFUND' as const, problemDescription: 'bulk', receivedDate: new Date(old.getTime() + k * 60000) })),
        });
        await db.auditLog.createMany({
          data: Array.from({ length: 600 }, (_, k) => ({
            action: 'CLAIM_META', entity: 'CustomerClaim', entityId: `clm-bulk-${k}`,
            details: k === 0 ? { orderNumber: o[8].orderNumber, frontendStatus: 'PENDING_SUPPLIER' } : { orderNumber: 'NONE', frontendStatus: k % 2 ? 'SCRAPPED' : 'PENDING_SUPPLIER', ...(k % 4 === 0 ? { returnDocId: 'SRN-B' } : {}) },
          })),
        });
      } finally {
        await db.$disconnect();
      }
      const capped = (await api('get', '/claims?limit=500', A).expect(200)).body.data as any[];
      const every = (await api('get', '/claims?limit=5000', A).expect(200)).body.data as any[];
      expect(every.length).toBeGreaterThan(600);
      // the old page (newest 500) did not see the oldest claim on bill o[8], nor the oldest returnable claim
      expect(legacyClaims.orderHasClaims({ id: o[8].id, orderNumber: o[8].orderNumber, claims: [] }, legacyClaims.claimedKeys(capped))).toBe(false);
      expect(legacyClaims.eligibleClaimIds(capped)).not.toContain('CLM-BULK-0');
      // the new queries see every claim: equal to the old rules over the complete list
      const { claimed, eligible } = await compare(every);
      expect(claimed.has(o[8].id)).toBe(true);
      expect(eligible).toContain('CLM-BULK-0');
      expect(eligible.filter((no) => no.startsWith('CLM-BULK-')).length).toBe(151);
    });
  });

  describe('claims screens above the cap: complete over every claim (task 6)', () => {
    it('the old pages (newest 500) missed claims; the server figures == the old logic over every claim', async () => {
      const db = new PrismaClient();
      try {
        const ps = await db.product.findMany({ where: { sku: { startsWith: 'SCR-' } }, orderBy: { sku: 'asc' } });
        const sups = await db.supplier.findMany({ where: { name: { contains: 'SCR' } }, orderBy: { name: 'asc' } });
        const old = Date.parse('2019-06-01T00:00:00Z');
        await db.customerClaim.createMany({
          data: Array.from({ length: 700 }, (_, k) => ({ id: `scr-bulk-${k}`, claimNumber: `CLM-SCRB-${String(k).padStart(4, '0')}`, productId: ps[k % ps.length].id,
            claimType: (k % 3 === 0 ? 'REFUND' : k % 3 === 1 ? 'EXCHANGE' : 'WARRANTY') as any, problemDescription: k % 7 ? 'bulk' : 'scr bulk', receivedDate: new Date(old + k * 60000) })),
        });
        await db.auditLog.createMany({
          data: Array.from({ length: 700 }, (_, k) => ({
            action: 'CLAIM_META', entity: 'CustomerClaim', entityId: `scr-bulk-${k}`, createdAt: new Date(old + k * 60000),
            details: {
              frontendStatus: ['PENDING_SUPPLIER', 'COMPLETED', 'SCRAPPED', 'SENT_TO_SUPPLIER'][k % 4], quantity: 1 + (k % 3), unitPrice: 10 + (k % 11),
              totalClaimValue: (1 + (k % 3)) * (10 + (k % 11)), resolutionType: ['SUPPLIER_RMA', 'REFUND_CASH', 'REPLACE_ITEM', 'REFUND_TRANSFER', 'STORE_DISCOUNT'][k % 5],
              ...(k % 5 === 0 ? { supplierId: sups[k % sups.length].id, supplierName: sups[k % sups.length].name } : {}),
              ...(k % 6 === 0 ? { costPrice: 5 + (k % 4) } : {}), ...(k % 9 === 0 ? { returnDocId: 'SRN-SCRB' } : {}),
              ...(k % 8 === 0 ? { conversionFactor: 6, baseQuantity: 6 * (1 + (k % 3)), replacementUnitName: 'ชิ้น' } : {}),
            },
          })),
        });
      } finally {
        await db.$disconnect();
      }
      const capped = (await api('get', '/claims?limit=500', A).expect(200)).body.data as any[];
      const every = (await api('get', '/claims?limit=5000', A).expect(200)).body.data as any[];
      expect(every.length).toBeGreaterThan(1300);
      const st = await screens.state(null);
      const sumOld = legacyScreens.getClaimStockSummary(capped.map((c) => legacyScreens.mapServerClaim(c, st.storeProducts)));
      const sumAll = legacyScreens.getClaimStockSummary(every.map((c) => legacyScreens.mapServerClaim(c, st.storeProducts)));
      expect(sumOld.totalClaims).toBe(500);
      expect(sumAll.totalClaims).toBe(every.length);
      const list = (await api('get', '/claims/list?limit=1', A).expect(200)).body;
      expect(list.summary.totalClaims).toBe(every.length);
      expect(list.meta.total).toBe(every.length);
      await screens.compare(every);
    });
  });

  describe('claim search over every bill (was the newest 500 bills)', () => {
    it('GET /orders?scope=claim finds a bill older than the newest 500 by bill number, phone, name, product, bundle part, customer', async () => {
      const db = new PrismaClient();
      const tag = `CLS${Date.now()}`;
      let oldId = '';
      let voidId = '';
      let customerId = '';
      try {
        const admin = await db.user.findFirstOrThrow({ where: { username: 'admin' } });
        const product = await db.product.create({ data: { name: `สินค้าเก่า ${tag}`, sku: `${tag}-P`, basePrice: 50, costPrice: 20, unit: 'ชิ้น' } });
        const customer = await db.customer.create({ data: { name: `ลูกค้าเก่า ${tag}`, phone: `09${String(Date.now()).slice(-8)}` } });
        customerId = customer.id;
        const old = new Date('2018-03-01T03:00:00Z');
        const line = { productId: product.id, quantity: 1, unitPrice: 50, total: 50, bundleData: [{ productId: product.id, productName: `ชิ้นส่วน ${tag}`, sku: `${tag}-PART`, quantityPerBundle: 1, totalQuantity: 1, unitPrice: 50 }] };
        const o1 = await db.order.create({ data: { orderNumber: `${tag}-OLD`, userId: admin.id, customerId: customer.id, subtotal: 50, totalAmount: 50, createdAt: old, items: { create: [line] } } });
        const o2 = await db.order.create({ data: { orderNumber: `${tag}-VOID`, userId: admin.id, customerId: customer.id, status: 'VOIDED', subtotal: 50, totalAmount: 50, createdAt: old, items: { create: [{ ...line, bundleData: undefined }] } } });
        oldId = o1.id;
        voidId = o2.id;
        const newer = new Date();
        await db.order.createMany({
          data: Array.from({ length: 520 }, (_, k) => ({ orderNumber: `${tag}-N${k}`, userId: admin.id, subtotal: 1, totalAmount: 1, createdAt: new Date(newer.getTime() - k * 1000) })),
        });
      } finally {
        await db.$disconnect();
      }
      // the old claim screen read only these
      const capped = (await api('get', '/orders?limit=500', A).expect(200)).body.data as any[];
      expect(capped.some((o) => o.id === oldId)).toBe(false);
      const ids = async (q: string, token = A) => ((await api('get', `/orders?scope=claim&statusGroup=completed&limit=500&${q}`, token).expect(200)).body.data as any[]).map((o) => o.id);
      const phone = (await api('get', `/orders/${oldId}`, A).expect(200)).body.customer.phone;
      for (const q of [`${tag}-OLD`, phone, `ลูกค้าเก่า ${tag}`, `สินค้าเก่า ${tag}`, `${tag}-P`, `ชิ้นส่วน ${tag}`, `${tag}-PART`]) {
        const found = await ids('search=' + encodeURIComponent(q));
        expect(found).toContain(oldId);
        expect(found).not.toContain(voidId); // voided bills are never claimable
      }
      expect(await ids(`customerId=${customerId}`)).toEqual([oldId]);
      // bundle snapshot only in claim scope; the orders page search is unchanged
      expect(((await api('get', `/orders?search=${encodeURIComponent(`ชิ้นส่วน ${tag}`)}`, A).expect(200)).body.data as any[]).length).toBe(0);
      // the walk-in name matches bills without a customer (as the claim screen's rule does)
      const walkIn = await ids('search=' + encodeURIComponent('ลูกค้าทั่วไป'));
      expect(walkIn.length).toBe(500);
      // a cashier (POS_SELL) can search too
      expect(await ids('search=' + encodeURIComponent(`${tag}-OLD`), C)).toEqual([oldId]);
    });
  });

  describe('backups: ADMIN and MANAGER (owner 2026-11-15)', () => {
    it('a manager lists / creates backups; download and the off-site folder stay ADMIN; a cashier gets 403', async () => {
      const tag = String(Date.now()).slice(-6);
      await api('post', '/auth/register', A, {
        username: `bkmgr${tag}`, password: `Mgr#Bk${tag}`, fullName: `ผู้จัดการ ${tag}`, role: 'MANAGER',
        pinCode: String(5000 + (Number(tag) % 4000)), permissions: ['MANAGE_SETTINGS'],
      }).expect(201);
      let login = await api('post', '/auth/login', undefined, { username: `bkmgr${tag}`, password: `Mgr#Bk${tag}` }).expect(201);
      if (login.body.user.mustChangePassword) {
        await api('post', '/auth/change-password', login.body.access_token, { currentPassword: `Mgr#Bk${tag}`, newPassword: `Mgr#Bk2${tag}`, newPin: String(1000 + (Number(tag) % 4000)) }).expect(201);
        login = await api('post', '/auth/login', undefined, { username: `bkmgr${tag}`, password: `Mgr#Bk2${tag}` }).expect(201);
      }
      const M = login.body.access_token;
      const made = (await api('post', '/server-control/backup', M).expect(201)).body;
      expect(made.fileName).toMatch(/^backup-/);
      const list = (await api('get', '/server-control/backups', M).expect(200)).body.map((f: any) => f.fileName);
      expect(list).toContain(made.fileName);
      await api('get', '/server-control/backup-status', M).expect(200);
      await api('get', `/server-control/backups/${encodeURIComponent(made.fileName)}/download`, M).expect(403);
      await api('put', '/server-control/backup-settings', M, { offsiteDir: '' }).expect(403);
      await api('post', '/server-control/backup', C).expect(403);
      await api('get', '/server-control/backups', C).expect(403);
      await api('delete', '/products', M).expect(403);
    });
  });

  describe('delete all products: backup first, like the full reset (owner 2026-11-15)', () => {
    it('no backup -> 400 and nothing deleted; only ADMIN; with a backup the delete runs after it', async () => {
      const svc = app.get(ServerControlService);
      const products = app.get(ProductsService);
      const db = new PrismaClient();
      try {
        const before = await db.product.count();
        expect(before).toBeGreaterThan(0);
        await api('delete', '/products', C).expect(403);

        // backup fails -> nothing is deleted
        const failing = jest.spyOn(svc, 'createBackup').mockRejectedValueOnce(new Error('disk full'));
        const removeSpy = jest.spyOn(products, 'removeAll');
        const r = await api('delete', '/products', A).expect(400);
        expect(String(r.body.message)).toContain('สำรองข้อมูลก่อนลบไม่สำเร็จ');
        expect(failing).toHaveBeenCalledTimes(1);
        expect(removeSpy).not.toHaveBeenCalled();
        expect(await db.product.count()).toBe(before);
        failing.mockRestore();
        removeSpy.mockRestore();

        // a real backup is written first, then the delete runs (stubbed: this database has sales,
        // whose products cannot be deleted) and the answer names the backup file
        const backup = jest.spyOn(svc, 'createBackup');
        const remove = jest.spyOn(products, 'removeAll').mockResolvedValueOnce({ deleted: 0 });
        const ok = await api('delete', '/products', A).expect(200);
        expect(backup).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(backup.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
        expect(ok.body.backupFile).toMatch(/^backup-/);
        const files = (await api('get', '/server-control/backups', A).expect(200)).body.map((f: any) => f.fileName);
        expect(files).toContain(ok.body.backupFile);
        backup.mockRestore();
        remove.mockRestore();
      } finally {
        await db.$disconnect();
      }
    });
  });

  describe('online shop (LINE LIFF): tunnel isolation, catalogue, orders, links, POS payment', () => {
    const shop: Record<string, any> = {};
    const pub = (method: 'get' | 'post', path: string, token?: string, body?: any, headers: Record<string, string> = {}) => {
      const r = (http as any)[method]('/api/public/shop' + path);
      if (token) r.set('Authorization', 'Bearer ' + token);
      for (const [k, v] of Object.entries(headers)) r.set(k, v);
      return body ? r.send(body) : r;
    };
    const lineCalls: { path: string; auth?: string; body: string }[] = [];
    let lineServer: httpModule.Server;

    beforeAll(async () => {
      // mock of api.line.me: ID-token verify ("good-token" -> U123...) and message push
      lineServer = httpModule.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          lineCalls.push({ path: req.url || '', auth: req.headers.authorization, body });
          res.setHeader('content-type', 'application/json');
          if (req.url === '/oauth2/v2.1/verify') {
            const q = new URLSearchParams(body);
            if (q.get('id_token') === 'good-token' && q.get('client_id') === '1650000000') {
              res.end(JSON.stringify({ iss: 'https://access.line.me', sub: 'U1234567890abcdef', aud: '1650000000', exp: 9999999999, name: 'คุณสมชาย LINE' }));
            } else {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Invalid IdToken.' }));
            }
          } else if (req.url === '/v2/bot/message/push') {
            res.end('{}');
          } else if (req.url === '/v2/bot/info') {
            res.end(JSON.stringify({ displayName: 'ร้านทดสอบ OA' }));
          } else {
            res.statusCode = 404;
            res.end('{}');
          }
        });
      });
      await new Promise<void>((r) => lineServer.listen(0, '127.0.0.1', () => r()));
      process.env.LINE_API_BASE = `http://127.0.0.1:${(lineServer.address() as any).port}`;

      shop.cat = (await api('post', '/categories', A, { name: 'ร้านออนไลน์ หมวดปูน' }).expect(201)).body.id;
      const mk = async (body: any) => (await api('post', '/products', A, { costPrice: 40, unit: 'ถุง', categoryId: shop.cat, ...body }).expect(201)).body;
      const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      shop.p1 = await mk({
        name: 'ปูนซีเมนต์ออนไลน์', basePrice: 100, priceLevel1: 100, priceLevel2: 90, priceLevel3: 85,
        packagingUnits: [{ name: 'แพค', qtyPerPrev: 6, priceLevel1: 570, priceLevel3: 480 }, { name: 'ลัง', qtyPerPrev: 4, priceLevel2: 2000 }],
        images: [{ dataUrl: `data:image/png;base64,${PNG1}`, thumbDataUrl: `data:image/png;base64,${PNG1}`, name: 'c.png', isCover: true }],
      });
      shop.p2 = await mk({ name: 'ทรายออนไลน์ (หมด)', basePrice: 50, priceLevel1: 50 });
      shop.p3 = await mk({ name: 'สินค้าออนไลน์ปิดขาย', basePrice: 10, priceLevel1: 10 });
      await api('patch', `/products/${shop.p3.id}`, A, { isActive: false }).expect(200);
      await api('post', '/inventory/adjust', A, { productId: shop.p1.id, type: 'SET', amount: 50, reason: 'e2e online' }).expect(201);
      const full = (await api('get', `/products/${shop.p1.id}`, A).expect(200)).body;
      shop.pack = full.packagingUnits.find((u: any) => u.name === 'แพค').id;
      shop.case = full.packagingUnits.find((u: any) => u.name === 'ลัง').id;
    });
    afterAll(async () => {
      delete process.env.LINE_API_BASE;
      await new Promise((r) => lineServer?.close(r));
    });

    it('tunnel isolation: requests that came through Cloudflare / the gateway reach only /api/public/shop/*', async () => {
      const tunnel: Record<string, string>[] = [{ 'cf-ray': '8f00aa-SIN' }, { 'cf-connecting-ip': '203.0.113.9' }, { 'x-purim-public': '1' }, { 'cdn-loop': 'cloudflare' }, { 'cf-visitor': '{"scheme":"https"}' }];
      for (const h of tunnel) {
        for (const path of ['/products', '/auth/me', '/settings', '/orders', '/online-shop/orders', '/events/stream', '/product-images/x', '/auth/default-pin']) {
          const r = (http as any).get('/api' + path).set('Authorization', 'Bearer ' + A);
          for (const [k, v] of Object.entries(h)) r.set(k, v);
          await r.expect(404);
        }
        await (http as any).post('/api/auth/login').set(h).send({ username: 'admin', password: 'Admin@test99' }).expect(404);
        await (http as any).get('/api/public/shopx').set(h).expect(404);
        await (http as any).get('/api/public/shop/..%2F..%2Fproducts').set(h).expect(404);
        await pub('get', '/config', undefined, undefined, h).expect(200);
      }
      // the shop's own host name (SHOP_PUBLIC_HOST) is public too, whatever the headers
      process.env.SHOP_PUBLIC_HOST = 'shop.example.com';
      try {
        await (http as any).get('/api/products').set('Host', 'shop.example.com').set('Authorization', 'Bearer ' + A).expect(404);
        await (http as any).get('/api/products').set('X-Forwarded-Host', 'SHOP.example.com:443').set('Authorization', 'Bearer ' + A).expect(404);
        await pub('get', '/config', undefined, undefined, { Host: 'shop.example.com' }).expect(200);
      } finally {
        delete process.env.SHOP_PUBLIC_HOST;
      }
      // the LAN back office is unchanged
      await api('get', '/products?limit=1', A).expect(200);
    });

    it('closed until an admin turns it on; LINE settings are ADMIN only and the token is never returned', async () => {
      expect((await pub('get', '/config').expect(200)).body).toMatchObject({ open: false, liffId: null, devLogin: true });
      await pub('get', '/products').expect(403);
      await api('get', '/online-shop/config', C).expect(403);
      await api('put', '/online-shop/config', C, { enabled: true }).expect(403);
      await api('put', '/online-shop/config', A, { liffId: 'bad id' }).expect(400);
      await api('put', '/online-shop/config', A, { publicBaseUrl: 'http://shop.example.com' }).expect(400);
      const saved = (await api('put', '/online-shop/config', A, { enabled: true, messagingToken: 'tok-' + 'x'.repeat(40) + 'WXYZ', publicBaseUrl: 'https://shop.example.com/', levelNames: { 3: 'ส่งพิเศษช่าง' } }).expect(200)).body;
      expect(saved).toMatchObject({ enabled: true, hasMessagingToken: true, messagingTokenHint: '••••WXYZ', publicBaseUrl: 'https://shop.example.com' });
      expect(JSON.stringify(saved)).not.toContain('xxxxxxxx');
      expect(JSON.stringify((await api('get', '/online-shop/config', A).expect(200)).body)).not.toContain('xxxxxxxx');
      expect((await api('post', '/online-shop/config/test-line', A).expect(201)).body).toEqual({ ok: true, name: 'ร้านทดสอบ OA' });
      const cfg = (await pub('get', '/config').expect(200)).body;
      expect(cfg).toMatchObject({ open: true, devLogin: true, allowPickup: true, allowDelivery: true });
      expect(cfg.levelNames[3]).toBe('ส่งพิเศษช่าง');
      expect(JSON.stringify(cfg)).not.toMatch(/tok-|messaging/i);
    });

    it('test profile only from the LAN while LINE login is not configured', async () => {
      await pub('post', '/session', undefined, { dev: { id: 'guest1', name: 'ลูกค้าทดสอบ' } }, { 'cf-ray': 'x' }).expect(403);
      await pub('post', '/session', undefined, {}).expect(400);
      const s = (await pub('post', '/session', undefined, { dev: { id: 'guest1', name: 'ลูกค้าทดสอบ' } }).expect(201)).body;
      expect(s.token).toBeTruthy();
      expect(s.member).toBeNull();
      expect(s.profile).toMatchObject({ name: 'ลูกค้าทดสอบ', test: true });
      shop.guest = s.token;
      await pub('get', '/me', s.token, undefined, { 'cf-ray': 'x' }).expect(401); // a test profile is LAN only
      await pub('get', '/me', 'garbage.token').expect(401);
      await pub('get', '/me', s.token.slice(0, -2) + 'xx').expect(401);
    });

    it('catalogue: retail prices for guests, units, in-stock flag only; no cost / stock / inactive / service products', async () => {
      const r = (await pub('get', '/products?q=ออนไลน์').expect(200)).body;
      const names = r.items.map((i: any) => i.name);
      expect(names).toEqual(expect.arrayContaining(['ปูนซีเมนต์ออนไลน์', 'ทรายออนไลน์ (หมด)']));
      expect(names).not.toContain('สินค้าออนไลน์ปิดขาย');
      const cement = r.items.find((i: any) => i.name === 'ปูนซีเมนต์ออนไลน์');
      expect(Object.keys(cement).sort()).toEqual(['categoryId', 'id', 'imageUrl', 'inStock', 'name', 'units']);
      expect(cement.units).toEqual([
        { id: null, name: 'ถุง', price: 100, inStock: true },
        { id: shop.pack, name: 'แพค', price: 570, inStock: true },
        { id: shop.case, name: 'ลัง', price: 2400, inStock: true }, // 24 per case, 50 in stock
      ]);
      expect(cement.inStock).toBe(true);
      const json = JSON.stringify(r);
      for (const banned of ['cost', 'stock"', 'supplier', 'sku', 'barcode']) expect(json).not.toContain(banned);
      expect(json).not.toMatch(/"50(\.0+)?"/); // the stock quantity as a decimal string (a uuid may start with 50)
      expect(r.items.find((i: any) => i.name === 'ทรายออนไลน์ (หมด)').inStock).toBe(false);
      // photo through the public prefix (thumbnail)
      expect(cement.imageUrl).toMatch(/^\/api\/public\/shop\/images\/[0-9a-f-]{36}$/);
      const img = await (http as any).get(cement.imageUrl).set('cf-ray', 'x').expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      // category tiles and category filter
      const cats = (await pub('get', '/categories').expect(200)).body;
      expect(cats.find((c: any) => c.id === shop.cat)).toMatchObject({ name: 'ร้านออนไลน์ หมวดปูน', count: 2, imageUrl: cement.imageUrl });
      const inCat = (await pub('get', `/products?categoryId=${shop.cat}`).expect(200)).body;
      expect(inCat.items.map((i: any) => i.name).sort()).toEqual(['ทรายออนไลน์ (หมด)', 'ปูนซีเมนต์ออนไลน์']);
      // paging
      const p1 = (await pub('get', `/products?categoryId=${shop.cat}&limit=1`).expect(200)).body;
      expect(p1).toMatchObject({ total: 2, hasMore: true, page: 1 });
    });

    it('orders: server prices (client prices ignored), stock / unit / size checks, pickup = 0, guest delivery = shop will tell', async () => {
      await pub('post', '/orders', undefined, { items: [] }).expect(401);
      const base = { contactName: 'คุณแขก', contactPhone: '081-111-2222', fulfillment: 'PICKUP' };
      await pub('post', '/orders', shop.guest, { ...base, items: [{ productId: shop.p2.id, unitId: null, quantity: 1 }] }).expect(400); // out of stock
      await pub('post', '/orders', shop.guest, { ...base, items: [{ productId: shop.p3.id, unitId: null, quantity: 1 }] }).expect(400); // inactive
      await pub('post', '/orders', shop.guest, { ...base, items: [{ productId: shop.p1.id, unitId: 'nope', quantity: 1 }] }).expect(400);
      await pub('post', '/orders', shop.guest, { ...base, items: [{ productId: shop.p1.id, unitId: null, quantity: 1.5 }] }).expect(400);
      await pub('post', '/orders', shop.guest, { ...base, items: Array.from({ length: 61 }, () => ({ productId: shop.p1.id, unitId: null, quantity: 1 })) }).expect(400);
      await pub('post', '/orders', shop.guest, { ...base, contactPhone: '12', items: [{ productId: shop.p1.id, unitId: null, quantity: 1 }] }).expect(400);
      await pub('post', '/orders', shop.guest, { ...base, fulfillment: 'DELIVERY', address: '', items: [{ productId: shop.p1.id, unitId: null, quantity: 1 }] }).expect(400);
      const o = (await pub('post', '/orders', shop.guest, { ...base, items: [{ productId: shop.p1.id, unitId: null, quantity: 2, unitPrice: 1 }, { productId: shop.p1.id, unitId: shop.pack, quantity: 1, price: 1 }] }).expect(201)).body;
      expect(o).toMatchObject({ status: 'NEW', fulfillment: 'PICKUP', subtotal: 770, deliveryFee: 0, feePending: false, totalAmount: 770 });
      expect(o.orderNo).toMatch(/^WB\d{4}-\d{4}$/); // round 4: WB<YYMM>-<NNNN>
      expect(o.items.map((i: any) => [i.name, i.unitName, i.quantity, i.unitPrice])).toEqual([['ปูนซีเมนต์ออนไลน์', 'ถุง', 2, 100], ['ปูนซีเมนต์ออนไลน์', 'แพค', 1, 570]]);
      shop.pickup = o;
      const d = (await pub('post', '/orders', shop.guest, { ...base, fulfillment: 'DELIVERY', address: '99 หมู่ 1 ต.ทดสอบ', items: [{ productId: shop.p1.id, unitId: shop.case, quantity: 1 }] }).expect(201)).body;
      expect(d).toMatchObject({ deliveryFee: null, feePending: true, subtotal: 2400, totalAmount: 2400 });
      shop.guestDelivery = d;
      // contact remembered for next time
      expect((await pub('get', '/me', shop.guest).expect(200)).body.contact).toEqual({ name: 'คุณแขก', phone: '0811112222', address: '99 หมู่ 1 ต.ทดสอบ' });
      // only the owner sees an order
      const other = (await pub('post', '/session', undefined, { dev: { id: 'other' } }).expect(201)).body.token;
      await pub('get', `/orders/${o.id}`, other).expect(404);
      expect((await pub('get', '/orders', other).expect(200)).body).toEqual([]);
      expect((await pub('get', '/orders', shop.guest).expect(200)).body).toHaveLength(2);
      // the realtime badge count
      expect((await api('get', '/online-shop/counts', C).expect(200)).body).toMatchObject({ new: 2 });
    });

    it('link request -> staff approval (managers / discount rights only) -> member prices and the member delivery fee', async () => {
      const member = (await api('post', '/customers', A, { name: 'ช่างสมศักดิ์ ออนไลน์', phone: '089-555-0001', priceLevel: 3, deliveryFee: 'abc' }).expect(400));
      expect(String(member.body.message)).toContain('ค่าส่ง');
      shop.member = (await api('post', '/customers', A, { name: 'ช่างสมศักดิ์ ออนไลน์', phone: '089-555-0001', priceLevel: 3, deliveryFee: 80 }).expect(201)).body;
      expect(shop.member.deliveryFee).toBe(80);
      expect((await api('patch', `/customers/${shop.member.id}`, A, { deliveryFee: 10001 }).expect(400)).body.message).toContain('ค่าส่ง');
      const s = (await pub('post', '/session', undefined, { dev: { id: 'member1', name: 'สมศักดิ์' } }).expect(201)).body;
      shop.memberToken = s.token;
      await pub('post', '/link', s.token, { phone: '12' }).expect(400);
      const me = (await pub('post', '/link', s.token, { phone: '0895550001' }).expect(201)).body;
      expect(me.linkRequest).toMatchObject({ status: 'PENDING', phone: '0895550001' });
      expect(me.member).toBeNull(); // never linked by phone alone
      const reqs = (await api('get', '/online-shop/link-requests', C).expect(200)).body;
      const r = reqs.find((x: any) => x.lineUserId === 'dev-member1');
      // the member's level (and its shop name) is shown to the staff approving
      expect(r.matches).toEqual([{ id: shop.member.id, name: 'ช่างสมศักดิ์ ออนไลน์', phone: '089-555-0001', priceLevel: 3, levelName: 'ส่งพิเศษช่าง' }]);
      // a seller without discount rights may see the request but not approve it (approval grants member prices)
      await api('post', '/auth/register', A, { username: 'seller1', password: 'Sell@test99', fullName: 'พนักงานขายล้วน', role: 'CASHIER', permissions: ['POS_SELL'] }).expect(201);
      const S = (await api('post', '/auth/login', undefined, { username: 'seller1', password: 'Sell@test99' }).expect(201)).body.access_token;
      expect((await api('get', '/online-shop/link-requests', S).expect(200)).body.length).toBeGreaterThan(0);
      await api('post', `/online-shop/link-requests/${r.id}/decide`, S, { approve: true, customerId: shop.member.id }).expect(403);
      await api('get', '/online-shop/config', S).expect(403);
      await api('post', `/online-shop/link-requests/${r.id}/decide`, A, { approve: true }).expect(400);
      await api('post', `/online-shop/link-requests/${r.id}/decide`, A, { approve: true, customerId: shop.member.id }).expect(201);
      await api('post', `/online-shop/link-requests/${r.id}/decide`, A, { approve: true, customerId: shop.member.id }).expect(400);
      const me2 = (await pub('get', '/me', s.token).expect(200)).body;
      expect(me2.member).toEqual({ name: 'ช่างสมศักดิ์ ออนไลน์', level: 3, levelName: 'ส่งพิเศษช่าง', deliveryFee: 80 });
      expect((await api('get', `/online-shop/customers/${shop.member.id}/line`, C).expect(200)).body.map((v: any) => v.lineUserId)).toEqual(['dev-member1']);
      // level 3 prices: base 85, pack own 480, case = 85 x 24
      const cement = (await pub('get', '/products?q=ปูนซีเมนต์ออนไลน์', s.token).expect(200)).body.items[0];
      expect(cement.units.map((u: any) => u.price)).toEqual([85, 480, 2040]);
      // guests still see retail
      expect((await pub('get', '/products?q=ปูนซีเมนต์ออนไลน์', shop.guest).expect(200)).body.items[0].units[0].price).toBe(100);
      const o = (await pub('post', '/orders', s.token, { contactName: 'สมศักดิ์', contactPhone: '0895550001', fulfillment: 'DELIVERY', address: 'ไซต์งาน ซอย 5', items: [{ productId: shop.p1.id, unitId: null, quantity: 4 }] }).expect(201)).body;
      expect(o).toMatchObject({ subtotal: 340, deliveryFee: 80, totalAmount: 420, feePending: false });
      shop.memberOrder = o;
      // a rejected request can be made again; a linked account cannot ask again
      await pub('post', '/link', s.token, { phone: '0895550001' }).expect(400);
    });

    it('member price follows the member level at once, same session; answers never cached; level shown (owner 2026-11-18)', async () => {
      const tok = shop.memberToken;
      const cementQ = '/products?q=ปูนซีเมนต์ออนไลน์';
      // shop answers depend on the session: never stored by a browser / proxy / Cloudflare
      for (const path of [cementQ, '/me', '/categories', '/config']) {
        const res = await pub('get', path, tok).expect(200);
        expect(res.headers['cache-control']).toContain('no-store');
        expect(res.headers.vary).toContain('Authorization');
      }
      const q = await pub('post', '/quote', tok, { items: [{ productId: shop.p1.id, unitId: null, quantity: 1 }] }).expect(201);
      expect(q.headers['cache-control']).toContain('no-store');
      expect(q.body).toMatchObject({ level: 3, subtotal: 85 });
      // photos stay cacheable for everyone
      const cement = (await pub('get', cementQ, tok).expect(200)).body.items[0];
      const img = await (http as any).get(cement.imageUrl).expect(200);
      expect(img.headers['cache-control']).toContain('public');
      expect(String(img.headers.vary || '')).not.toContain('Authorization');
      // levelPrice (members only): which units carry the member's own price; guests get no such field
      expect(cement.units.map((u: any) => [u.price, u.levelPrice])).toEqual([[85, true], [480, true], [2040, true]]);
      const sand = (await pub('get', '/products?q=ทรายออนไลน์', tok).expect(200)).body.items[0];
      expect(sand.units).toEqual([{ id: null, name: 'ถุง', price: 50, inStock: false, levelPrice: false }]); // no ราคา 3 -> retail
      expect((await pub('get', cementQ, shop.guest).expect(200)).body.items[0].units.every((u: any) => !('levelPrice' in u))).toBe(true);
      // staff change the level on the customers page: the SAME session sees it on the next request
      await api('patch', `/customers/${shop.member.id}`, A, { name: 'ช่างสมศักดิ์ ออนไลน์', priceLevel: 2 }).expect(200);
      expect((await pub('get', '/me', tok).expect(200)).body.member).toMatchObject({ level: 2, levelName: 'ราคาส่ง' });
      const lv2 = (await pub('get', cementQ, tok).expect(200)).body;
      expect(lv2.level).toBe(2);
      expect(lv2.items[0].units.map((u: any) => u.price)).toEqual([90, 540, 2000]);
      expect((await pub('post', '/quote', tok, { items: [{ productId: shop.p1.id, unitId: shop.case, quantity: 1 }] }).expect(201)).body).toMatchObject({ level: 2, subtotal: 2000 });
      // a string level from an old client is read the same way
      await api('patch', `/customers/${shop.member.id}`, A, { name: 'ช่างสมศักดิ์ ออนไลน์', priceLevel: '2' }).expect(200);
      expect((await pub('get', cementQ, tok).expect(200)).body.level).toBe(2);
      await api('patch', `/customers/${shop.member.id}`, A, { name: 'ช่างสมศักดิ์ ออนไลน์', priceLevel: 3 }).expect(200);
      expect((await pub('get', cementQ, tok).expect(200)).body.items[0].units[0].price).toBe(85);
      // customers page note: products without a price at each member level (any staff, counts only)
      const cov = (await api('get', '/online-shop/level-coverage', C).expect(200)).body;
      expect(cov.levelNames).toMatchObject({ 1: 'ราคาปลีก', 2: 'ราคาส่ง', 3: 'ส่งพิเศษช่าง' });
      expect(cov.total).toBeGreaterThan(0);
      await api('patch', `/products/${shop.p2.id}`, A, { priceLevel2: 45 }).expect(200);
      const cov2 = (await api('get', '/online-shop/level-coverage', C).expect(200)).body;
      expect(cov2.missing[2]).toBe(cov.missing[2] - 1);
      expect(cov2.missing[3]).toBe(cov.missing[3]);
      await api('patch', `/products/${shop.p2.id}`, A, { priceLevel2: null }).expect(200);
      await (http as any).get('/api/online-shop/level-coverage').expect(401);
    });

    it('staff: guest delivery needs a fee before accepting; edits re-price on the server; LINE messages are pushed', async () => {
      const id = shop.guestDelivery.id;
      await api('post', `/online-shop/orders/${id}/accept`, C, {}).expect(400); // fee unknown
      await api('post', `/online-shop/orders/${id}/accept`, C, { deliveryFee: -5 }).expect(400);
      // staff changes the quantity, sets a price and the fee, picks the member (customer level kept unless asked)
      const upd = (await api('patch', `/online-shop/orders/${id}`, C, { items: [{ productId: shop.p1.id, unitId: shop.case, quantity: 2, unitPrice: 2300 }, { productId: shop.p1.id, unitId: null, quantity: 1 }], deliveryFee: 120 }).expect(200)).body;
      expect(upd).toMatchObject({ subtotal: 4700, deliveryFee: 120, totalAmount: 4820, status: 'NEW' });
      const before = lineCalls.length;
      const acc = (await api('post', `/online-shop/orders/${id}/accept`, C, {}).expect(201)).body;
      expect(acc.status).toBe('ACCEPTED');
      expect(acc.nextStatuses).toEqual(['PREPARING', 'DELIVERING', 'DONE', 'CANCELLED']);
      await api('post', `/online-shop/orders/${id}/accept`, C, {}).expect(400);
      // dev profiles are never pushed to LINE
      await new Promise((r) => setTimeout(r, 300));
      expect(lineCalls.slice(before).filter((c) => c.path === '/v2/bot/message/push')).toHaveLength(0);
      expect((await api('get', `/online-shop/orders/${id}`, C).expect(200)).body.lineNotice).toContain('โปรไฟล์ทดสอบ');
      // the customer sees the total and a PromptPay QR (default bank with a PromptPay ID) with the amount locked
      await api('post', '/bank-accounts', A, { bankName: 'กสิกรไทย', accountName: 'ร้าน Online E2E', accountNumber: '777-0-00001-1', promptpayType: 'MOBILE', promptpayId: '0812345678', isDefault: true }).expect(201);
      const mine = (await pub('get', `/orders/${id}`, shop.guest).expect(200)).body;
      expect(mine).toMatchObject({ status: 'ACCEPTED', totalAmount: 4820, deliveryFee: 120 });
      expect(mine.payment).toMatchObject({ amount: 4820, accountName: 'ร้าน Online E2E', maskedId: expect.stringContaining('5678') });
      expect(mine.payment.payload).toContain('54074820.00');
      // pickup order rejected with a reason -> customer sees it
      await api('post', `/online-shop/orders/${shop.pickup.id}/reject`, C, { reason: '' }).expect(400);
      await api('post', `/online-shop/orders/${shop.pickup.id}/reject`, C, { reason: 'ของหมดชั่วคราว' }).expect(201);
      expect((await pub('get', `/orders/${shop.pickup.id}`, shop.guest).expect(200)).body).toMatchObject({ status: 'CANCELLED', rejectReason: 'ของหมดชั่วคราว' });
      await api('patch', `/online-shop/orders/${shop.pickup.id}`, C, { deliveryFee: 10 }).expect(400);
    });

    it('accepted order -> POS bill with a ค่าส่ง service line (no stock) -> paid once; void reopens it', async () => {
      const id = shop.memberOrder.id;
      await api('post', `/online-shop/orders/${id}/pos`, C, {}).expect(400); // not accepted yet
      await api('post', `/online-shop/orders/${id}/accept`, C, {}).expect(201);
      const pos = (await api('post', `/online-shop/orders/${id}/pos`, C, {}).expect(201)).body;
      expect(pos.customer).toMatchObject({ id: shop.member.id });
      expect(pos.lines.map((l: any) => [l.name, l.quantity, l.unitPrice])).toEqual([['ปูนซีเมนต์ออนไลน์', 4, 85], ['ค่าส่ง', 1, 80]]);
      const fee = pos.lines[1];
      const db = new PrismaClient();
      try {
        const svc = await db.product.findUnique({ where: { id: fee.productId } });
        expect(svc).toMatchObject({ sku: 'SYS-DELIVERY-FEE', isService: true });
        // not in the shop catalogue, not in stock filters
        expect((await pub('get', '/products?q=ค่าส่ง', shop.guest).expect(200)).body.items).toEqual([]);
        const outIds = (await api('get', '/products/page?stock=out&limit=500', A).expect(200)).body.data.map((p: any) => p.id);
        expect(outIds).not.toContain(fee.productId);
        let open = await db.shift.findFirst({ where: { status: 'OPEN', user: { username: 'cashier1' } } });
        if (!open) open = (await api('post', '/shifts/open', C, { startingCash: 500, terminalId: 'e2e-online' }).expect(201)).body.shift;
        const stockBefore = Number((await api('get', `/products/${shop.p1.id}/stock`, A)).body.computedStock);
        const sale = {
          clientOrderId: randomUUID(), shiftId: open!.id, customerId: shop.member.id, onlineOrderId: id,
          items: pos.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, unitId: l.unitId, unitName: l.unitName, conversionFactor: l.factor })),
          payments: [{ method: 'CASH', amount: 420 }],
        };
        const bill = (await api('post', '/orders/checkout', C, sale).expect(201)).body;
        expect(Number(bill.totalAmount)).toBe(420);
        expect(Number((await api('get', `/products/${shop.p1.id}/stock`, A)).body.computedStock)).toBe(stockBefore - 4);
        expect(await db.stockBatch.count({ where: { productId: fee.productId } })).toBe(0);
        expect(await db.auditLog.count({ where: { entityId: fee.productId, action: { startsWith: 'STOCK' } } })).toBe(0);
        const paid = (await api('get', `/online-shop/orders/${id}`, C).expect(200)).body;
        expect(paid).toMatchObject({ status: 'ACCEPTED', posOrder: { id: bill.id, totalAmount: 420 } }); // delivery: staff closes it
        expect((await pub('get', `/orders/${id}`, shop.memberToken).expect(200)).body).toMatchObject({ paid: true, payment: null });
        await api('post', '/orders/checkout', C, { ...sale, clientOrderId: randomUUID() }).expect(409); // paid once
        await api('patch', `/online-shop/orders/${id}`, C, { deliveryFee: 10 }).expect(400); // paid: no edits
        // voiding the POS bill: stock back for the cement only, the online order is payable again
        await api('post', `/orders/${bill.id}/void`, A, { reason: 'e2e online void' }).expect(201);
        expect(await db.stockBatch.count({ where: { productId: fee.productId } })).toBe(0);
        expect((await api('get', `/online-shop/orders/${id}`, C).expect(200)).body.posOrder).toBeNull();
        // pay again, then the status flow to done
        await api('post', '/orders/checkout', C, { ...sale, clientOrderId: randomUUID() }).expect(201);
        await api('post', `/online-shop/orders/${id}/status`, C, { status: 'NEW' }).expect(400);
        expect((await api('post', `/online-shop/orders/${id}/status`, C, { status: 'DELIVERING' }).expect(201)).body.status).toBe('DELIVERING');
        expect((await api('post', `/online-shop/orders/${id}/status`, C, { status: 'DONE' }).expect(201)).body.status).toBe('DONE');
        // the guest's accepted order is unpaid: closing it needs a confirmation
        await api('post', `/online-shop/orders/${shop.guestDelivery.id}/status`, C, { status: 'DONE' }).expect(409);
      } finally {
        await db.$disconnect();
      }
    });

    it('LIFF ID token verified with LINE; the test profile is off once LINE login is configured; pushes go to LINE with the token', async () => {
      await api('put', '/online-shop/config', A, { liffId: '1650000000-AbCdEfGh', loginChannelId: '1650000000' }).expect(200);
      expect((await pub('get', '/config').expect(200)).body).toMatchObject({ open: true, liffId: '1650000000-AbCdEfGh', devLogin: false });
      await pub('post', '/session', undefined, { dev: { id: 'x' } }).expect(403);
      await pub('post', '/session', undefined, { idToken: 'forged' }).expect(401);
      const s = (await pub('post', '/session', undefined, { idToken: 'good-token' }, { 'cf-ray': 'abc', 'cf-connecting-ip': '198.51.100.7' }).expect(201)).body;
      expect(s.profile).toMatchObject({ name: 'คุณสมชาย LINE', test: false });
      const before = lineCalls.length;
      const o = (await pub('post', '/orders', s.token, { contactName: 'สมชาย', contactPhone: '0899999999', fulfillment: 'PICKUP', items: [{ productId: shop.p1.id, unitId: null, quantity: 1 }] }, { 'cf-ray': 'abc' }).expect(201)).body;
      await api('post', `/online-shop/orders/${o.id}/accept`, C, {}).expect(201);
      await new Promise((r) => setTimeout(r, 500));
      const pushes = lineCalls.slice(before).filter((c) => c.path === '/v2/bot/message/push');
      expect(pushes).toHaveLength(2);
      expect(pushes[0].auth).toBe('Bearer tok-' + 'x'.repeat(40) + 'WXYZ');
      const accepted = JSON.parse(pushes[1].body);
      expect(accepted.to).toBe('U1234567890abcdef');
      expect(accepted.messages[0].text).toContain('ยืนยันออเดอร์');
      expect(accepted.messages[0].text).toContain('100.00');
      const image = accepted.messages[1];
      expect(image.type).toBe('image');
      expect(image.originalContentUrl).toMatch(new RegExp(`^https://shop.example.com/api/public/shop/qr/${o.id}.png\\?a=100.00&s=`));
      // the QR image link works through the tunnel; a changed amount or signature does not
      const path = image.originalContentUrl.replace('https://shop.example.com', '');
      const png = await (http as any).get(path).set('cf-ray', 'x').buffer(true).parse((res: any, cb: any) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
      expect(png.headers['content-type']).toBe('image/png');
      expect((png.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
      await (http as any).get(path.replace('a=100.00', 'a=1.00')).expect(404);
      await (http as any).get(path.slice(0, -3) + 'xyz').expect(404);
      expect((await api('get', `/online-shop/orders/${o.id}`, C).expect(200)).body.lineNotice).toContain('ส่ง LINE แล้ว');
      // link approved -> LINE message with the member's price level name (owner 2026-11-18)
      await pub('post', '/link', s.token, { phone: '0895550001' }, { 'cf-ray': 'abc' }).expect(201);
      const req = (await api('get', '/online-shop/link-requests', A).expect(200)).body.find((x: any) => x.lineUserId === 'U1234567890abcdef');
      const beforeLink = lineCalls.length;
      await api('post', `/online-shop/link-requests/${req.id}/decide`, A, { approve: true, customerId: shop.member.id }).expect(201);
      await new Promise((r) => setTimeout(r, 500));
      const linkPush = lineCalls.slice(beforeLink).filter((c) => c.path === '/v2/bot/message/push').map((c) => JSON.parse(c.body));
      expect(linkPush).toHaveLength(1);
      expect(linkPush[0].to).toBe('U1234567890abcdef');
      expect(linkPush[0].messages[0].text).toContain('ช่างสมศักดิ์ ออนไลน์');
      expect(linkPush[0].messages[0].text).toContain('ส่งพิเศษช่าง');
      expect(linkPush[0].messages[0].text).toContain('https://shop.example.com/shop');
      expect((await pub('get', '/me', s.token, undefined, { 'cf-ray': 'abc' }).expect(200)).body.member).toMatchObject({ level: 3 });
      await api('delete', '/online-shop/line/U1234567890abcdef', A).expect(200);
      // put the shop back in test mode for the rest of the suite
      await api('put', '/online-shop/config', A, { liffId: '', loginChannelId: '' }).expect(200);
    });

    describe('claim lock + one POS bill per online order (owner 2026-11-16)', () => {
      const staff: Record<string, { token: string; id: string; name: string }> = {};
      const mkUser = async (key: string, role: 'CASHIER' | 'MANAGER', perms: string[]) => {
        const tag = String(Date.now()).slice(-6) + key.length;
        const username = `cl${key}${tag}`;
        const fullName = `${role === 'MANAGER' ? 'ผู้จัดการ' : 'แคชเชียร์'} ${key}`;
        await api('post', '/auth/register', A, { username, password: `Cl#Pw${tag}`, fullName, role, pinCode: String(2000 + ((Number(tag) + key.length * 977) % 7000)), permissions: perms }).expect(201);
        let login = await api('post', '/auth/login', undefined, { username, password: `Cl#Pw${tag}` }).expect(201);
        if (login.body.user.mustChangePassword) {
          await api('post', '/auth/change-password', login.body.access_token, { currentPassword: `Cl#Pw${tag}`, newPassword: `Cl#Pw2${tag}`, newPin: String(1000 + ((Number(tag) + key.length * 311) % 8000)) }).expect(201);
          login = await api('post', '/auth/login', undefined, { username, password: `Cl#Pw2${tag}` }).expect(201);
        }
        staff[key] = { token: login.body.access_token, id: login.body.user.id, name: fullName };
      };
      const place = async (who: string, fulfillment: 'PICKUP' | 'DELIVERY' = 'PICKUP') => {
        const t = (await pub('post', '/session', undefined, { dev: { id: who } }).expect(201)).body.token;
        return (await pub('post', '/orders', t, { contactName: `ลูกค้า ${who}`, contactPhone: '0822222222', fulfillment, address: fulfillment === 'DELIVERY' ? '99 ถนนทดสอบ' : undefined, items: [{ productId: shop.p1.id, unitId: null, quantity: 1 }] }).expect(201)).body;
      };
      let me = '';

      beforeAll(async () => {
        await mkUser('two', 'CASHIER', ['POS_SELL']);
        await mkUser('mgr', 'MANAGER', ['POS_SELL']);
        me = (await api('get', '/auth/me', C).expect(200)).body.id;
      });

      it('two cashiers claim at the same moment: one wins, the other gets 409 with the holder and is refused everything', async () => {
        const o = await place('claim-race');
        const C2 = staff.two.token;
        const [r1, r2] = await Promise.all([api('post', `/online-shop/orders/${o.id}/claim`, C, {}), api('post', `/online-shop/orders/${o.id}/claim`, C2, {})]);
        expect([r1.status, r2.status].sort()).toEqual([201, 409]);
        const [winner, loser, loserToken] = r1.status === 201 ? [me, r2, C2] : [staff.two.id, r1, C];
        const winnerToken = loserToken === C ? C2 : C;
        expect(loser.body).toMatchObject({ code: 'ONLINE_ORDER_CLAIMED', canTakeOver: false, claimedBy: { id: winner } });
        expect(loser.body.message).toContain('กำลังจัดโดย');
        // claiming again by the holder is fine (same claim time)
        const d1 = (await api('post', `/online-shop/orders/${o.id}/claim`, winnerToken, {}).expect(201)).body;
        expect(d1.claim).toMatchObject({ userId: winner });
        const d2 = (await api('get', `/online-shop/orders/${o.id}`, loserToken).expect(200)).body;
        expect(d2.claim.at).toBe(d1.claim.at);
        const row = (await api('get', '/online-shop/orders?status=open&limit=100', loserToken).expect(200)).body.data.find((r: any) => r.id === o.id);
        expect(row.claim).toMatchObject({ userId: winner });
        // everything else is refused for the other cashier
        await api('patch', `/online-shop/orders/${o.id}`, loserToken, { note: 'x' }).expect(409);
        await api('post', `/online-shop/orders/${o.id}/accept`, loserToken, {}).expect(409);
        await api('post', `/online-shop/orders/${o.id}/reject`, loserToken, { reason: 'ไม่' }).expect(409);
        await api('post', `/online-shop/orders/${o.id}/picking-slip`, loserToken).expect(409);
        await api('post', `/online-shop/orders/${o.id}/release`, loserToken).expect(409);
        await api('post', `/online-shop/orders/${o.id}/claim`, loserToken, { takeover: true }).expect(403);
        // the holder accepts; "เตรียมของ" / "จัดของเสร็จ" are picking steps: refused for the other cashier
        await api('post', `/online-shop/orders/${o.id}/accept`, winnerToken, {}).expect(201);
        await api('post', `/online-shop/orders/${o.id}/status`, loserToken, { status: 'PREPARING' }).expect(409);
        await api('post', `/online-shop/orders/${o.id}/picked`, loserToken).expect(409);
        // ... but opening it as a POS bill is not (owner 2026-11-17: payment is for every cashier); the claim stays
        const posOther = (await api('post', `/online-shop/orders/${o.id}/pos`, loserToken, {}).expect(201)).body;
        expect(posOther).toMatchObject({ id: o.id, picked: null, claim: { userId: winner } });
        // the customer cannot cancel an order the shop is preparing
        const t = (await pub('post', '/session', undefined, { dev: { id: 'claim-race' } }).expect(201)).body.token;
        await pub('post', `/orders/${o.id}/cancel`, t).expect(400);
        // the holder releases ("ปล่อยงาน"); the other may now take it
        expect((await api('post', `/online-shop/orders/${o.id}/release`, winnerToken).expect(201)).body.claim).toBeNull();
        expect((await api('post', `/online-shop/orders/${o.id}/status`, loserToken, { status: 'PREPARING' }).expect(201)).body.claim).toMatchObject({ userId: loserToken === C ? me : staff.two.id });
        // reject releases the claim
        const rej = (await api('post', `/online-shop/orders/${o.id}/reject`, loserToken, { reason: 'ทดสอบ' }).expect(201)).body;
        expect(rej).toMatchObject({ status: 'CANCELLED', claim: null });
        await api('post', `/online-shop/orders/${o.id}/claim`, C, {}).expect(400); // closed
      });

      it('accept / picking slip claim automatically; slip has no prices and counts reprints; manager takeover is audited', async () => {
        const o = await place('claim-slip', 'DELIVERY');
        const slip = (await api('post', `/online-shop/orders/${o.id}/picking-slip`, C).expect(201)).body;
        expect(slip).toMatchObject({ orderNo: o.orderNo, fulfillment: 'DELIVERY', address: '99 ถนนทดสอบ', phone: '0822222222', reprint: false, printCount: 1 });
        expect(slip.items).toEqual([{ name: 'ปูนซีเมนต์ออนไลน์', unitName: 'ถุง', quantity: 1, parts: [] }]);
        expect(JSON.stringify(slip)).not.toMatch(/price|total|amount|subtotal|fee/i);
        expect((await api('post', `/online-shop/orders/${o.id}/picking-slip`, C).expect(201)).body).toMatchObject({ reprint: true, printCount: 2 });
        expect((await api('get', `/online-shop/orders/${o.id}`, staff.two.token).expect(200)).body).toMatchObject({ claim: { userId: me }, pickingPrintCount: 2 });
        // a manager is told who holds it, then takes it over explicitly
        const M = staff.mgr.token;
        const refused = (await api('post', `/online-shop/orders/${o.id}/accept`, M, { deliveryFee: 50 }).expect(409)).body;
        expect(refused).toMatchObject({ code: 'ONLINE_ORDER_CLAIMED', canTakeOver: true });
        const took = (await api('post', `/online-shop/orders/${o.id}/claim`, M, { takeover: true }).expect(201)).body;
        expect(took.claim).toMatchObject({ userId: staff.mgr.id, name: staff.mgr.name });
        const db = new PrismaClient();
        try {
          const log = await db.auditLog.findFirst({ where: { action: 'ONLINE_ORDER_TAKEOVER', entityId: o.id } });
          expect(log?.userId).toBe(staff.mgr.id);
          expect(log?.details).toMatchObject({ orderNo: o.orderNo, fromUserId: me, toUserId: staff.mgr.id });
        } finally {
          await db.$disconnect();
        }
        await api('post', `/online-shop/orders/${o.id}/accept`, C, { deliveryFee: 50 }).expect(409);
        expect((await api('post', `/online-shop/orders/${o.id}/accept`, M, { deliveryFee: 50 }).expect(201)).body).toMatchObject({ status: 'ACCEPTED', claim: { userId: staff.mgr.id } });
        // done releases
        const done = (await api('post', `/online-shop/orders/${o.id}/status`, M, { status: 'DONE', unpaidOk: true }).expect(201)).body;
        expect(done).toMatchObject({ status: 'DONE', claim: null });
        await api('post', `/online-shop/orders/${o.id}/picking-slip`, M).expect(400);
      });

      it('one POS bill per online order: other terminal refused at open and at checkout; concurrent checkouts -> one bill', async () => {
        const o = await place('claim-pos');
        await api('post', `/online-shop/orders/${o.id}/accept`, C, {}).expect(201);
        const db = new PrismaClient();
        try {
          let open = await db.shift.findFirst({ where: { status: 'OPEN', user: { username: 'cashier1' } } });
          if (!open) open = (await api('post', '/shifts/open', C, { startingCash: 500, terminalId: 'e2e-online' }).expect(201)).body.shift;
          const here = open!.terminalId || 'e2e-online';
          const pos = (await api('post', `/online-shop/orders/${o.id}/pos`, C, { terminalId: here }).expect(201)).body;
          const other = (await api('post', `/online-shop/orders/${o.id}/pos`, C, { terminalId: 'e2e-other-terminal' }).expect(409)).body;
          expect(other).toMatchObject({ code: 'ONLINE_ORDER_OPEN_ELSEWHERE', terminalId: here });
          // another cashier may open it on the same terminal (no claim on payment)
          await api('post', `/online-shop/orders/${o.id}/pos`, staff.two.token, { terminalId: here }).expect(201);
          // moved to another terminal: this terminal's checkout is refused
          await api('post', `/online-shop/orders/${o.id}/pos`, C, { terminalId: 'e2e-other-terminal', force: true }).expect(201);
          // own bill numbers: the refusal must come from the online-order link, not a bill-number clash
          const sale = (clientOrderId: string) => ({
            clientOrderId, orderNumber: `ORD-E2E${clientOrderId.slice(0, 8)}`, shiftId: open!.id, onlineOrderId: o.id,
            items: pos.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, unitId: l.unitId, unitName: l.unitName, conversionFactor: l.factor })),
            payments: [{ method: 'CASH', amount: 100 }],
          });
          if (open!.terminalId) await api('post', '/orders/checkout', C, sale(randomUUID())).expect(409);
          await api('post', `/online-shop/orders/${o.id}/pos`, C, { terminalId: here, force: true }).expect(201);
          // two checkouts of the same online order at the same moment: one bill, the other refused
          const ids = [randomUUID(), randomUUID()];
          const rs = await Promise.all(ids.map((id) => api('post', '/orders/checkout', C, sale(id))));
          expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
          const ok = rs.find((r) => r.status === 201)!;
          expect(rs.find((r) => r.status === 409)!.body.message).toContain(o.orderNo);
          const bills = await db.order.count({ where: { clientOrderId: { in: ids } } });
          expect(bills).toBe(1);
          const after = (await api('get', `/online-shop/orders/${o.id}`, C).expect(200)).body;
          expect(after).toMatchObject({ status: 'DONE', posOrder: { id: ok.body.id }, claim: null });
          // a retry of the SAME bill returns it (idempotent), a new bill is refused
          expect((await api('post', '/orders/checkout', C, sale(ids[rs.indexOf(ok)])).expect(201)).body.id).toBe(ok.body.id);
          await api('post', '/orders/checkout', C, sale(randomUUID())).expect(409);
        } finally {
          await db.$disconnect();
        }
      });

      describe('picking is for the picker, payment for every cashier (owner 2026-11-17)', () => {
        it('A claims and picks; B cannot edit / print / mark picked but CAN open the bill and pay; double checkout -> one bill', async () => {
          const A1 = staff.two;
          const B = C; // cashier1
          const t = (await pub('post', '/session', undefined, { dev: { id: 'pick-pay' } }).expect(201)).body.token;
          const o = (await pub('post', '/orders', t, { contactName: 'ลูกค้า pick-pay', contactPhone: '0833333333', fulfillment: 'DELIVERY', address: '1 ถนนจัดของ', items: [{ productId: shop.p1.id, unitId: null, quantity: 2 }] }).expect(201)).body;
          // NEW: "จัดของเสร็จ" needs an accepted order
          await api('post', `/online-shop/orders/${o.id}/picked`, A1.token).expect(400);
          expect((await api('post', `/online-shop/orders/${o.id}/accept`, A1.token, { deliveryFee: 40 }).expect(201)).body).toMatchObject({ status: 'ACCEPTED', claim: { userId: A1.id }, picked: null });
          await api('post', `/online-shop/orders/${o.id}/picking-slip`, A1.token).expect(201);
          // B: picking actions refused
          await api('patch', `/online-shop/orders/${o.id}`, B, { items: [{ productId: shop.p1.id, unitId: null, quantity: 3 }] }).expect(409);
          await api('patch', `/online-shop/orders/${o.id}`, B, { deliveryFee: 10 }).expect(409);
          await api('post', `/online-shop/orders/${o.id}/picking-slip`, B).expect(409);
          await api('post', `/online-shop/orders/${o.id}/picked`, B).expect(409);
          await api('post', `/online-shop/orders/${o.id}/reject`, B, { reason: 'ไม่' }).expect(409);
          // B: the payable list shows the order (not picked yet, held by A)
          const row = (await api('get', '/online-shop/orders?status=payable&limit=100', B).expect(200)).body.data.find((r: any) => r.id === o.id);
          expect(row).toMatchObject({ claim: { userId: A1.id }, picked: null });
          // A: "จัดของเสร็จ" -> READY, picker recorded, claim ended
          const picked = (await api('post', `/online-shop/orders/${o.id}/picked`, A1.token).expect(201)).body;
          expect(picked).toMatchObject({ status: 'READY', claim: null, picked: { userId: A1.id, name: A1.name }, nextStatuses: ['DELIVERING', 'DONE', 'CANCELLED'] });
          expect(new Date(picked.picked.at).getTime()).toBeGreaterThan(Date.now() - 60000);
          await api('post', `/online-shop/orders/${o.id}/picked`, A1.token).expect(400); // already READY
          const listed = (await api('get', '/online-shop/orders?status=READY&limit=100', B).expect(200)).body.data.find((r: any) => r.id === o.id);
          expect(listed).toMatchObject({ status: 'READY', picked: { name: A1.name } });

          // B opens it as a bill and pays (twice at once: one bill)
          const db = new PrismaClient();
          try {
            let open = await db.shift.findFirst({ where: { status: 'OPEN', user: { username: 'cashier1' } } });
            if (!open) open = (await api('post', '/shifts/open', B, { startingCash: 500, terminalId: 'e2e-online' }).expect(201)).body.shift;
            const here = open!.terminalId || 'e2e-online';
            const pos = (await api('post', `/online-shop/orders/${o.id}/pos`, B, { terminalId: here }).expect(201)).body;
            expect(pos).toMatchObject({ fulfillment: 'DELIVERY', picked: { userId: A1.id }, claim: null });
            expect(pos.lines.map((l: any) => l.unitPrice * l.quantity).reduce((a: number, b: number) => a + b, 0)).toBe(o.subtotal + 40);
            const sale = (clientOrderId: string) => ({
              clientOrderId, orderNumber: `ORD-E2P${clientOrderId.slice(0, 8)}`, shiftId: open!.id, onlineOrderId: o.id,
              items: pos.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, unitId: l.unitId, unitName: l.unitName, conversionFactor: l.factor })),
              payments: [{ method: 'CASH', amount: o.subtotal + 40 }],
            });
            const ids = [randomUUID(), randomUUID()];
            const rs = await Promise.all(ids.map((id) => api('post', '/orders/checkout', B, sale(id))));
            expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
            const ok = rs.find((r) => r.status === 201)!;
            expect(await db.order.count({ where: { clientOrderId: { in: ids } } })).toBe(1);
            // a delivery order stays open (READY, paid); the payment does not claim it
            const paid = (await api('get', `/online-shop/orders/${o.id}`, A1.token).expect(200)).body;
            expect(paid).toMatchObject({ status: 'READY', posOrder: { id: ok.body.id }, claim: null, picked: { userId: A1.id } });
            expect(paid.paidAt).toBeTruthy();
            // edits after payment stay impossible, for everyone
            await api('patch', `/online-shop/orders/${o.id}`, A1.token, { note: 'x' }).expect(400);
            await api('patch', `/online-shop/orders/${o.id}`, B, { note: 'x' }).expect(400);
            // idempotent retry returns the bill
            expect((await api('post', '/orders/checkout', B, sale(ids[rs.indexOf(ok)])).expect(201)).body.id).toBe(ok.body.id);
            // delivery steps after payment: any cashier, no claim (A claims it again first: B is still allowed)
            await api('post', `/online-shop/orders/${o.id}/claim`, A1.token, {}).expect(201);
            expect((await api('post', `/online-shop/orders/${o.id}/status`, B, { status: 'DELIVERING' }).expect(201)).body).toMatchObject({ status: 'DELIVERING', claim: null });
            expect((await api('post', `/online-shop/orders/${o.id}/status`, B, { status: 'DONE' }).expect(201)).body).toMatchObject({ status: 'DONE', claim: null, picked: { userId: A1.id } });
          } finally {
            await db.$disconnect();
          }
        });

        it('B may pay before picking (QR right after acceptance); the pickup order is then done; READY item edits send it back to picking', async () => {
          const A1 = staff.two;
          const t = (await pub('post', '/session', undefined, { dev: { id: 'pay-first' } }).expect(201)).body.token;
          const place2 = async () => (await pub('post', '/orders', t, { contactName: 'ลูกค้า pay-first', contactPhone: '0844444444', fulfillment: 'PICKUP', items: [{ productId: shop.p1.id, unitId: null, quantity: 1 }] }).expect(201)).body;
          const o = await place2();
          await api('post', `/online-shop/orders/${o.id}/accept`, A1.token, {}).expect(201);
          const db = new PrismaClient();
          try {
            let open = await db.shift.findFirst({ where: { status: 'OPEN', user: { username: 'cashier1' } } });
            if (!open) open = (await api('post', '/shifts/open', C, { startingCash: 500, terminalId: 'e2e-online' }).expect(201)).body.shift;
            const pos = (await api('post', `/online-shop/orders/${o.id}/pos`, C, { terminalId: open!.terminalId || 'e2e-online' }).expect(201)).body;
            expect(pos).toMatchObject({ picked: null, claim: { userId: A1.id } });
            await api('post', '/orders/checkout', C, {
              clientOrderId: randomUUID(), shiftId: open!.id, onlineOrderId: o.id,
              items: pos.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, unitId: l.unitId, unitName: l.unitName, conversionFactor: l.factor })),
              payments: [{ method: 'CASH', amount: o.subtotal }],
            }).expect(201);
            expect((await api('get', `/online-shop/orders/${o.id}`, C).expect(200)).body).toMatchObject({ status: 'DONE', claim: null, picked: null });
          } finally {
            await db.$disconnect();
          }
          // READY + items edited: back to picking (ACCEPTED, picker cleared, the editor holds it)
          const o2 = await place2();
          await api('post', `/online-shop/orders/${o2.id}/accept`, A1.token, {}).expect(201);
          await api('post', `/online-shop/orders/${o2.id}/picked`, A1.token).expect(201);
          expect((await api('patch', `/online-shop/orders/${o2.id}`, C, { note: 'โทรก่อน' }).expect(200)).body).toMatchObject({ status: 'READY', claim: { userId: me } });
          await api('post', `/online-shop/orders/${o2.id}/release`, C).expect(201);
          const edited = (await api('patch', `/online-shop/orders/${o2.id}`, A1.token, { items: [{ productId: shop.p1.id, unitId: null, quantity: 2 }] }).expect(200)).body;
          expect(edited).toMatchObject({ status: 'ACCEPTED', picked: null, claim: { userId: A1.id } });
          await api('post', `/online-shop/orders/${o2.id}/reject`, A1.token, { reason: 'ทดสอบ' }).expect(201);
        });
      });
    });

    it('customer may cancel only while new; open-order limit', async () => {
      const t = (await pub('post', '/session', undefined, { dev: { id: 'canceller' } }).expect(201)).body.token;
      const body = { contactName: 'ยกเลิก', contactPhone: '0811111111', fulfillment: 'PICKUP', items: [{ productId: shop.p1.id, unitId: null, quantity: 1 }] };
      const o = (await pub('post', '/orders', t, body).expect(201)).body;
      expect((await pub('post', `/orders/${o.id}/cancel`, t).expect(201)).body.status).toBe('CANCELLED');
      await pub('post', `/orders/${o.id}/cancel`, t).expect(400);
      for (let i = 0; i < 5; i++) await pub('post', '/orders', t, body).expect(201);
      await pub('post', '/orders', t, body).expect(429); // 6 per 10 minutes per LINE account
    });
  });

  describe('bank account PromptPay ID (QR with the amount locked)', () => {
    it('stores a validated ID, rejects bad ones, clears it, cashier cannot set it', async () => {
      const created = (await api('post', '/bank-accounts', A, { bankName: 'พร้อมเพย์ (PromptPay)', accountName: 'ร้าน E2E', accountNumber: '999-0-00001-1', promptpayType: 'MOBILE', promptpayId: '081-234-5678' }).expect(201)).body;
      expect(created.promptpayType).toBe('MOBILE');
      expect(created.promptpayId).toBe('0812345678');
      const listed = (await api('get', '/bank-accounts', C).expect(200)).body.find((b: any) => b.id === created.id);
      expect(listed).toMatchObject({ promptpayType: 'MOBILE', promptpayId: '0812345678' });

      // 13-digit ID with a wrong check digit, wrong length, unknown type, half a pair
      await api('patch', `/bank-accounts/${created.id}`, A, { promptpayType: 'NATIONAL_ID', promptpayId: '1234567890122' }).expect(400);
      await api('patch', `/bank-accounts/${created.id}`, A, { promptpayType: 'EWALLET', promptpayId: '12345' }).expect(400);
      await api('patch', `/bank-accounts/${created.id}`, A, { promptpayType: 'BANK', promptpayId: '0812345678' }).expect(400);
      await api('patch', `/bank-accounts/${created.id}`, A, { promptpayId: '0812345678' }).expect(400);
      await api('patch', `/bank-accounts/${created.id}`, A, { promptpayType: 'MOBILE', promptpayId: '0212345678' }).expect(400);
      expect((await api('get', '/bank-accounts', A)).body.find((b: any) => b.id === created.id).promptpayId).toBe('0812345678');

      const tax = (await api('patch', `/bank-accounts/${created.id}`, A, { promptpayType: 'NATIONAL_ID', promptpayId: '0-1055-36092-64-1' }).expect(200)).body;
      expect(tax).toMatchObject({ promptpayType: 'NATIONAL_ID', promptpayId: '0105536092641' });
      // other fields can change without touching the ID
      expect((await api('patch', `/bank-accounts/${created.id}`, A, { accountName: 'ร้าน E2E 2' }).expect(200)).body.promptpayId).toBe('0105536092641');

      await api('patch', `/bank-accounts/${created.id}`, C, { promptpayType: 'MOBILE', promptpayId: '0812345678' }).expect(403);

      const cleared = (await api('patch', `/bank-accounts/${created.id}`, A, { promptpayType: null, promptpayId: '' }).expect(200)).body;
      expect(cleared.promptpayType).toBeNull();
      expect(cleared.promptpayId).toBeNull();

      // the table keeps the pair together even outside the API
      const db = new PrismaClient();
      try {
        await expect(db.$executeRawUnsafe(`UPDATE bank_accounts SET promptpay_id = '0812345678' WHERE id = $1`, created.id)).rejects.toThrow();
      } finally {
        await db.$disconnect();
      }
      await api('delete', `/bank-accounts/${created.id}`, A).expect(200);
    });
  });

  describe('product code (SKU): typed by the user on create / edit, blank = generated (owner, Round B)', () => {
    const EAN = /^200\d{10}$/;
    const get = async (id: string) => (await api('get', `/products/${id}`, A).expect(200)).body;

    it('create keeps a typed SKU (trimmed); blank / missing -> generated internal EAN-13; duplicates of any SKU / barcode = 409', async () => {
      const a = (await api('post', '/products', A, { name: 'SKU ระบบ ก', sku: '  MY-OWN-CODE  ', basePrice: 10, priceLevel1: 10, unit: 'ชิ้น' }).expect(201)).body;
      expect(a.sku).toBe('MY-OWN-CODE');
      const b = (await api('post', '/products', A, { name: 'SKU ระบบ ข', basePrice: 10, priceLevel1: 10, unit: 'ชิ้น', barcodes: ['8859999000035'], packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, barcode: 'PACK-SKU-B' }] }).expect(201)).body;
      const c = (await api('post', '/products', A, { name: 'SKU ระบบ ค', sku: '   ', basePrice: 1 }).expect(201)).body;
      for (const p of [b, c]) expect(p.sku).toMatch(EAN);
      expect(b.sku).not.toBe(c.sku);
      const digits = b.sku.split('').map(Number);
      const sum = digits.slice(0, 12).reduce((t: number, d: number, i: number) => t + d * (i % 2 === 0 ? 1 : 3), 0);
      expect((10 - (sum % 10)) % 10).toBe(digits[12]);
      // unique against another product's SKU, barcode and pack barcode
      for (const sku of ['MY-OWN-CODE', '8859999000035', 'PACK-SKU-B']) {
        const r = await api('post', '/products', A, { name: 'SKU ซ้ำ', sku, basePrice: 1 }).expect(409);
        expect(String(r.body.message)).toContain(sku);
      }
      // nor one of its own barcodes
      await api('post', '/products', A, { name: 'SKU ซ้ำตัวเอง', sku: '8859999000042', basePrice: 1, barcodes: ['8859999000042'] }).expect(409);
      await api('post', '/products', A, { name: 'SKU ยาว', sku: 'X'.repeat(65), basePrice: 1 }).expect(400);
      state.skuA = a;
      state.skuB = b;
    });

    it('PATCH renames to a free SKU; blank keeps the stored one; a taken one = 409 and nothing is saved', async () => {
      const a = state.skuA;
      const b = state.skuB;
      for (const sku of [b.sku, '8859999000035', 'PACK-SKU-B']) {
        await api('patch', `/products/${a.id}`, A, { name: 'SKU ระบบ ก (แก้)', sku }).expect(409);
      }
      expect(await get(a.id)).toMatchObject({ sku: 'MY-OWN-CODE', name: 'SKU ระบบ ก' }); // refused request saved nothing
      await api('patch', `/products/${a.id}`, A, { name: 'SKU ระบบ ก (แก้)', sku: '' }).expect(200);
      expect(await get(a.id)).toMatchObject({ sku: 'MY-OWN-CODE', name: 'SKU ระบบ ก (แก้)' });
      await api('patch', `/products/${a.id}`, A, { sku: ' NEW-CODE-A ' }).expect(200);
      await api('patch', `/products/${a.id}`, A, { priceLevel1: 12 }).expect(200);
      expect(await get(a.id)).toMatchObject({ sku: 'NEW-CODE-A', priceLevel1: '12' });
      // the old code is free again; the scan lookup follows the new code
      expect((await api('get', '/products/barcode/NEW-CODE-A', A).expect(200)).body.id).toBe(a.id);
      // a cashier cannot edit products at all
      await api('patch', `/products/${a.id}`, C, { sku: 'X' }).expect(403);
      state.skuA = await get(a.id);
    });

    it('import: match id -> SKU -> barcode; a row matched by id renames the SKU, one matched by barcode keeps it', async () => {
      const a = state.skuA;
      const withBc = (await api('post', '/products', A, { name: 'SKU นำเข้า บาร์โค้ด', basePrice: 5, priceLevel1: 5, unit: 'ชิ้น', barcodes: ['8859999000011'] }).expect(201)).body;
      const before = (await api('get', '/products', A).expect(200)).body.length;
      const res = (await api('post', '/products/bulk-upsert', A, { products: [
        { id: a.id, sku: 'RENAMED-BY-ID', name: 'SKU ระบบ ก (ไฟล์)', priceLevel1: 13 }, // matched by id, other SKU -> renamed
        { sku: 'RENAMED-BY-BC', barcode: '8859999000011', priceLevel1: 6 }, // matched by barcode, other SKU -> kept
        { sku: 'RENAMED-BY-ID', priceLevel2: 11 }, // matched by the (new) SKU
        { sku: 'FILE-NEW-1', name: 'SKU ใหม่จากไฟล์', priceLevel1: 20 }, // new, file SKU kept
        { barcode: '8859999000028', name: 'SKU ใหม่ไม่มีรหัส', priceLevel1: 30 }, // new, no SKU -> generated
      ] }).expect(201)).body;
      expect(res).toMatchObject({ created: 2, updated: 3, skuKept: 1, skuRenamed: 1 });
      expect(await get(a.id)).toMatchObject({ sku: 'RENAMED-BY-ID', name: 'SKU ระบบ ก (ไฟล์)', priceLevel1: '13', priceLevel2: '11' });
      expect(await get(withBc.id)).toMatchObject({ sku: withBc.sku, priceLevel1: '6' });
      const list = (await api('get', '/products', A).expect(200)).body as any[];
      expect(list).toHaveLength(before + 2);
      expect(list.some((p) => p.sku === 'RENAMED-BY-BC')).toBe(false);
      expect(list.find((p) => p.name === 'SKU ใหม่จากไฟล์').sku).toBe('FILE-NEW-1');
      expect(list.find((p) => p.name === 'SKU ใหม่ไม่มีรหัส').sku).toMatch(EAN);
      // a rename by id onto another product's code is refused (whole file, nothing saved)
      await api('post', '/products/bulk-upsert', A, { products: [{ id: a.id, sku: 'FILE-NEW-1', priceLevel1: 99 }] }).expect(409);
      expect((await get(a.id)).priceLevel1).toBe('13');
      // round trip: the exported rows (id + SKU) import back as updates, nothing new
      const exported = list.filter((p) => p.name.startsWith('SKU ')).map((p) => ({ id: p.id, sku: p.sku, name: p.name, priceLevel1: p.priceLevel1 }));
      const again = (await api('post', '/products/bulk-upsert', A, { products: exported }).expect(201)).body;
      expect(again).toMatchObject({ created: 0, updated: exported.length, skuKept: 0, skuRenamed: 0 });
      // the same file without the id column matches by SKU
      const bySku = (await api('post', '/products/bulk-upsert', A, { products: exported.map(({ id: _id, ...r }) => r) }).expect(201)).body;
      expect(bySku).toMatchObject({ created: 0, updated: exported.length });
      expect((await api('get', '/products', A).expect(200)).body).toHaveLength(before + 2);
    });

    it('search by SKU still finds the product (list page, lookup)', async () => {
      const a = state.skuB; // generated EAN-13 (skuA was renamed above)
      const page = (await api('get', `/products/page?page=1&limit=5&q=${a.sku}`, A).expect(200)).body;
      expect(page.data.map((p: any) => p.id)).toEqual([a.id]);
      const part = (await api('get', `/products/page?page=1&limit=5&q=${a.sku.slice(3, 10)}`, A).expect(200)).body;
      expect(part.data.map((p: any) => p.id)).toContain(a.id);
      const lk = (await api('get', `/products/lookup?q=${encodeURIComponent(a.sku)}`, A).expect(200)).body;
      expect(lk.data[0].id).toBe(a.id);
    });
  });
  describe('document numbers <PP><YYMM>-<NNNN> (round 4, docs/document-numbers.md)', () => {
    const db = new PrismaClient();
    const period = docPeriod(new Date());
    const shape = (prefix: string) => new RegExp(`^${prefix}${period}-\\d{4,}$`);
    let shiftId = '';
    let product: any;
    const sell = (extra: Record<string, unknown> = {}) => api('post', '/orders/checkout', A, {
      clientOrderId: randomUUID(), shiftId, items: [{ productId: product.id, quantity: 1, unitPrice: Number(product.priceLevel1 ?? product.basePrice) }],
      payments: [{ method: 'CASH', amount: Number(product.priceLevel1 ?? product.basePrice) }], ...extra,
    });
    beforeAll(async () => {
      const cur = (await api('get', '/shifts/current', A)).body;
      shiftId = cur?.id || cur?.shift?.id || (await api('post', '/shifts/open', A, { startingCash: 0, terminalId: 'e2e-docno' }).expect(201)).body.shift.id;
      const list = (await api('get', '/products?limit=100', A)).body;
      product = (Array.isArray(list) ? list : list.data).find((p: any) => !p.isBundle && Number(p.priceLevel1 ?? p.basePrice) > 0);
      await api('post', '/inventory/adjust', A, { productId: product.id, type: 'ADD', amount: 500, reason: 'e2e เลขเอกสาร' }).expect(201);
    });
    afterAll(async () => { await db.$disconnect(); });

    it('every document type created by the suite in this month uses its 2-letter prefix + CE YYMM + 4 digits', async () => {
      // documents numbered by the server (fixtures written straight into the database use names like "TRK-R13")
      const newest = async (rows: Promise<any[]>, key: string) => (await rows).map((r) => r[key]).filter((n: string | null) => n && !/^[A-Z]+-/.test(n));
      const checks: [string, Promise<any[]>, string][] = [
        ['IN', db.order.findMany({ where: { orderNumber: { startsWith: 'IN' } }, take: 5 }), 'orderNumber'],
        ['CN', db.orderReturn.findMany({ take: 50, orderBy: { createdAt: 'desc' } }), 'returnNumber'],
        ['RC', db.debtPayment.findMany({ take: 50, orderBy: { createdAt: 'desc' } }), 'receiptNo'],
        ['PV', db.paymentVoucher.findMany({ take: 50, orderBy: { createdAt: 'desc' } }), 'voucherNumber'],
        ['SH', db.shift.findMany({ take: 50, orderBy: { createdAt: 'desc' } }), 'shiftNumber'],
        ['CL', db.customerClaim.findMany({ where: { claimNumber: { startsWith: 'CL2' } }, take: 5 }), 'claimNumber'],
        ['WB', db.onlineOrder.findMany({ take: 50, orderBy: { createdAt: 'desc' } }), 'orderNo'],
      ];
      for (const [prefix, rows, key] of checks) {
        const nos = await newest(rows, key);
        expect({ prefix, any: nos.length > 0 }).toEqual({ prefix, any: true });
        // (some suite sales are dated in earlier months: any YYMM, but this month's form)
        for (const n of nos) expect(n).toMatch(new RegExp(`^${prefix}\\d{4}-\\d{4,}$`));
      }
      // purchase order (generated; a typed number is kept), supplier return, expense
      const sup = (await api('post', '/suppliers', A, { name: 'ผู้จำหน่าย เลขเอกสาร' }).expect(201)).body;
      const po = (await api('post', '/purchase-orders', A, { supplierId: sup.id, items: [{ productId: product.id, quantity: 2, unitCost: 10 }] }).expect(201)).body;
      expect(po.poNumber).toMatch(shape('PO'));
      const typed = (await api('post', '/purchase-orders', A, { supplierId: sup.id, poNumber: 'PO-มือ-001', items: [{ productId: product.id, quantity: 1, unitCost: 10 }] }).expect(201)).body;
      expect(typed.poNumber).toBe('PO-มือ-001');
      const sr = (await api('post', '/supplier-returns', A, { supplierId: sup.id, items: [{ productId: product.id, quantity: 1, unitCost: 10, reason: 'ชำรุด' }], deductStock: false }));
      expect([200, 201]).toContain(sr.status);
      expect(sr.body.returnNumber || sr.body.data?.returnNumber).toMatch(shape('SR'));
      const cat = (await api('get', '/finance/expense-categories', A).expect(200)).body[0];
      const safe = (await api('get', '/finance/accounts', A).expect(200)).body.find((a: any) => a.type === 'CASH_SAFE');
      const ex = await api('post', '/finance/expenses', A, { clientId: randomUUID(), categoryId: cat.id, accountId: safe.id, amount: 1, description: 'e2e เลขเอกสาร' });
      expect([200, 201]).toContain(ex.status);
      expect(ex.body.expenseNumber || ex.body.expense?.expenseNumber).toMatch(shape('EX'));
    });

    it('parallel creates get unique, consecutive numbers (counter row lock)', async () => {
      const made = await Promise.all(Array.from({ length: 12 }, () => sell().expect(201)));
      const nos = made.map((r) => r.body.orderNumber as string).sort();
      expect(new Set(nos).size).toBe(12);
      for (const n of nos) expect(n).toMatch(shape('IN'));
      const seqs = nos.map((n) => Number(n.split('-')[1]));
      expect(seqs.slice(1).map((v, k) => v - seqs[k])).toEqual(Array(11).fill(1));
      // the counter equals the last number given
      const row = await db.documentCounter.findUnique({ where: { docType_period: { docType: 'SALE', period } } });
      expect(row?.lastValue).toBe(Math.max(...seqs));
    });

    it('monthly reset: each month starts at 0001 (helper and a sale dated in an earlier month)', async () => {
      const a = await db.$transaction((tx) => nextDocNumber(tx, 'EXPENSE', { at: '2031-01-31T16:59:00Z' })); // 23:59 31 Jan Bangkok
      const b = await db.$transaction((tx) => nextDocNumber(tx, 'EXPENSE', { at: '2031-01-15T03:00:00Z' }));
      const c = await db.$transaction((tx) => nextDocNumber(tx, 'EXPENSE', { at: '2031-01-31T17:00:00Z' })); // 00:00 1 Feb Bangkok
      expect([a, b, c]).toEqual(['EX3101-0001', 'EX3101-0002', 'EX3102-0001']);
      // a rolled back create gives its number back
      await db.$transaction(async (tx) => { await nextDocNumber(tx, 'EXPENSE', { at: '2031-03-01T05:00:00Z' }); throw new Error('rollback'); }).catch(() => undefined);
      expect(await db.$transaction((tx) => nextDocNumber(tx, 'EXPENSE', { at: '2031-03-01T05:00:00Z' }))).toBe('EX3103-0001');
    });

    it('offline sync: the server gives the number (sale month), ignores a number sent by the terminal, a retry returns the same bill', async () => {
      const clientOrderId = randomUUID();
      const soldAt = '2026-09-30T16:30:00Z'; // 23:30 30 Sep Bangkok, synced later
      // what the outbox sends (order-sync-service payload(): the local "OFFLINE-..." reference is left out)
      const body = { clientOrderId, createdAt: soldAt };
      const first = (await sell(body).expect(201)).body;
      expect(first.orderNumber).toBe('IN2609-0001');
      const again = (await sell(body).expect(201)).body; // terminal resends after a lost answer
      expect(again).toMatchObject({ id: first.id, orderNumber: 'IN2609-0001' });
      // a terminal cannot choose (or duplicate) a number
      const forged = (await sell({ clientOrderId: randomUUID(), createdAt: soldAt, orderNumber: 'IN2609-0001' }).expect(201)).body;
      expect(forged.orderNumber).toBe('IN2609-0002');
      expect(await db.order.count({ where: { orderNumber: 'IN2609-0001' } })).toBe(1);
      // the offline slip's reference (part of clientOrderId) still finds the synced bill
      const found = (await api('get', `/documents/search?q=${clientOrderId.slice(0, 8)}`, A).expect(200)).body;
      expect(found.map((d: any) => d.docNumber)).toContain('IN2609-0001');
    });

    it('old-format numbers stay searchable and sortable next to new ones', async () => {
      const u = await db.user.findFirstOrThrow({ where: { username: 'admin' } });
      await db.order.create({ data: { orderNumber: 'ORD-261000077', userId: u.id, subtotal: 50, totalAmount: 50, status: 'COMPLETED', createdAt: new Date('2026-10-20T05:00:00Z') } });
      for (const q of ['ORD-261000077', '261000077', 'ORD-2610']) {
        const docs = (await api('get', `/documents/search?q=${encodeURIComponent(q)}`, A).expect(200)).body;
        expect({ q, hit: docs.some((d: any) => d.docNumber === 'ORD-261000077') }).toEqual({ q, hit: true });
      }
      const list = (await api('get', '/orders?search=ORD-261000077&limit=5', A).expect(200)).body;
      expect((list.data ?? list).map((o: any) => o.orderNumber)).toContain('ORD-261000077');
      const newOne = (await api('get', '/orders?search=IN2609-0002&limit=5', A).expect(200)).body;
      expect((newOne.data ?? newOne).map((o: any) => o.orderNumber)).toEqual(['IN2609-0002']);
    });
  });

  describe('product names: ชื่อผู้ผลิต, supplier product names / codes, document name mode (docs/product-names.md)', () => {
    const db = new PrismaClient();
    afterAll(async () => { await db.$disconnect(); });
    const pn: Record<string, any> = {};

    it('create + edit save the manufacturer name and the supplier name / code (trimmed, limits)', async () => {
      pn.s1 = (await api('post', '/suppliers', A, { name: 'บริษัท ท่อไทย ซัพพลาย จำกัด' }).expect(201)).body;
      pn.s2 = (await api('post', '/suppliers', A, { name: 'หจก. วัสดุก่อสร้างรุ่งเรือง' }).expect(201)).body;
      const created = (await api('post', '/products', A, {
        name: 'ท่อพีวีซี ชั้น 8.5 ขนาด 1 นิ้ว ตราช้าง', basePrice: 120, priceLevel1: 120, costPrice: 80, unit: 'เส้น',
        manufacturerName: '  SCG   PVC Pipe Class 8.5  1"  ',
        supplierEntries: [
          { supplierId: pn.s1.id, unitCost: 80, supplierProductName: '  ท่อ PVC 8.5 1นิ้ว (ฟ้า) ', supplierSku: ' TT-PV0185 ' },
          { supplierId: pn.s2.id, unitCost: 82, supplierSku: 'RR-5521' },
        ],
      }).expect(201)).body;
      pn.pipe = created;
      const full = (await api('get', `/products/${created.id}`, A).expect(200)).body;
      expect(full.manufacturerName).toBe('SCG PVC Pipe Class 8.5 1"');
      const bySupplier = Object.fromEntries(full.supplierEntries.map((e: any) => [e.supplierId, e]));
      expect(bySupplier[pn.s1.id]).toMatchObject({ supplierProductName: 'ท่อ PVC 8.5 1นิ้ว (ฟ้า)', supplierSku: 'TT-PV0185' });
      expect(bySupplier[pn.s2.id]).toMatchObject({ supplierProductName: '', supplierSku: 'RR-5521' });
      // the catalogue row (POS / product page / export) carries the same names
      const rows = (await api('get', `/products?search=${encodeURIComponent('ท่อพีวีซี ชั้น 8.5')}`, A).expect(200)).body;
      const row = rows.find((r: any) => r.id === created.id);
      expect(row.manufacturerName).toBe('SCG PVC Pipe Class 8.5 1"');
      expect(row.supplierEntries.find((e: any) => e.supplierId === pn.s1.id).supplierProductName).toBe('ท่อ PVC 8.5 1นิ้ว (ฟ้า)');
      // edit: change, then clear (null / blank)
      await api('patch', `/products/${created.id}`, A, { manufacturerName: 'SCG PVC Pipe 8.5 1in' }).expect(200);
      expect((await api('get', `/products/${created.id}`, A)).body.manufacturerName).toBe('SCG PVC Pipe 8.5 1in');
      await api('patch', `/products/${created.id}`, A, { manufacturerName: null }).expect(200);
      expect((await api('get', `/products/${created.id}`, A)).body.manufacturerName).toBeNull();
      await api('patch', `/products/${created.id}`, A, {
        manufacturerName: 'SCG PVC Pipe Class 8.5 1"',
        supplierEntries: [
          { supplierId: pn.s1.id, unitCost: 80, supplierProductName: 'ท่อ PVC 8.5 1นิ้ว (ฟ้า)', supplierSku: 'TT-PV0185' },
          { supplierId: pn.s2.id, unitCost: 82, supplierSku: 'RR-5521', supplierProductName: '   ' },
        ],
      }).expect(200);
      const again = (await api('get', `/products/${created.id}`, A)).body;
      expect(again.supplierEntries.find((e: any) => e.supplierId === pn.s2.id).supplierProductName).toBe('');
      // limits: 200 / 200 / 100 characters
      await api('patch', `/products/${created.id}`, A, { manufacturerName: 'ก'.repeat(201) }).expect(400);
      await api('patch', `/products/${created.id}`, A, { supplierEntries: [{ supplierId: pn.s1.id, supplierSku: 'X'.repeat(101) }] }).expect(400);
      await api('post', '/products', A, { name: 'ยาวเกิน', basePrice: 1, supplierEntries: [{ supplierId: pn.s1.id, supplierProductName: 'ข'.repeat(201) }] }).expect(400);
      expect((await api('get', `/products/${created.id}`, A)).body.manufacturerName).toBe('SCG PVC Pipe Class 8.5 1"');
      // a product with only a manufacturer name, and a plain one, both from supplier 1
      pn.cement = (await api('post', '/products', A, { name: 'ปูนซีเมนต์ผสม ตราเสือ 50 กก.', basePrice: 150, costPrice: 120, manufacturerName: 'TPI Mortar M200 50kg', supplierEntries: [{ supplierId: pn.s1.id, unitCost: 120 }] }).expect(201)).body;
      pn.plain = (await api('post', '/products', A, { name: 'ข้อต่อตรง PVC 1 นิ้ว', basePrice: 15, costPrice: 9, supplierEntries: [{ supplierId: pn.s1.id, unitCost: 9, supplierSku: 'TT-CN01' }] }).expect(201)).body;
    });

    it('import: ชื่อผู้ผลิต column updates / creates; blank keeps it; export -> import round trip changes nothing', async () => {
      const r = (await api('post', '/products/bulk-upsert', A, { products: [
        { rowNo: 2, id: pn.plain.id, name: pn.plain.name, manufacturerName: '  Thai Pipe Coupling 1"  ' },
        { rowNo: 3, sku: 'PN-IMPORT-001', name: 'สายไฟ THW 1x2.5 ตร.มม. ม้วน 100 ม.', unit: 'ม้วน', priceLevel1: 1590, manufacturerName: 'Yazaki THW 1x2.5 sq.mm 100m' },
        { rowNo: 4, id: pn.cement.id, name: pn.cement.name },
      ] }).expect(201)).body;
      expect(r).toMatchObject({ created: 1, updated: 2 });
      expect((await api('get', `/products/${pn.plain.id}`, A)).body.manufacturerName).toBe('Thai Pipe Coupling 1"');
      expect((await api('get', `/products/${pn.cement.id}`, A)).body.manufacturerName).toBe('TPI Mortar M200 50kg'); // blank = unchanged
      const wire = await db.product.findUniqueOrThrow({ where: { sku: 'PN-IMPORT-001' } });
      expect(wire.manufacturerName).toBe('Yazaki THW 1x2.5 sq.mm 100m');
      pn.wire = wire;
      // round trip: what the export reads (catalogue rows) imported back = the same values
      const rows = (await api('get', '/products', A)).body.filter((x: any) => [pn.plain.id, pn.cement.id, wire.id].includes(x.id));
      const before = await db.product.findMany({ where: { id: { in: rows.map((x: any) => x.id) } }, select: { id: true, manufacturerName: true, updatedAt: true } });
      await api('post', '/products/bulk-upsert', A, { products: rows.map((x: any, i: number) => ({ rowNo: i + 2, id: x.id, sku: x.sku, name: x.name, manufacturerName: x.manufacturerName })) }).expect(201);
      const after = await db.product.findMany({ where: { id: { in: rows.map((x: any) => x.id) } }, select: { id: true, manufacturerName: true } });
      expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.map(({ id, manufacturerName }) => ({ id, manufacturerName })).sort((a, b) => a.id.localeCompare(b.id)));
      // a too-long name names the row, nothing saved
      const bad = await api('post', '/products/bulk-upsert', A, { products: [{ rowNo: 7, sku: 'PN-IMPORT-002', name: 'x', manufacturerName: 'ก'.repeat(201) }] }).expect(400);
      expect(bad.body.message).toContain('แถวที่ 7');
      expect(await db.product.count({ where: { sku: 'PN-IMPORT-002' } })).toBe(0);
    });

    it('every search finds by manufacturer name and by supplier product name / code (any case)', async () => {
      const ids = (body: any) => (Array.isArray(body) ? body : body.data).map((x: any) => x.id);
      for (const q of ['scg pvc pipe', 'TT-PV0185', 'tt-pv0185', '1นิ้ว (ฟ้า)', 'RR-5521']) {
        expect({ q, page: ids((await api('get', `/products/page?q=${encodeURIComponent(q)}`, A).expect(200)).body) }).toEqual({ q, page: [pn.pipe.id] });
        expect({ q, list: ids((await api('get', `/products?search=${encodeURIComponent(q)}`, A).expect(200)).body) }).toEqual({ q, list: [pn.pipe.id] });
        expect({ q, m: ids((await api('get', `/products/lookup?q=${encodeURIComponent(q)}`, A).expect(200)).body) }).toEqual({ q, m: [pn.pipe.id] });
      }
      // mobile lookup carries the other names for the "ผู้ผลิต: … / รหัสผู้ขาย: …" hint
      const m = (await api('get', `/products/lookup?q=${encodeURIComponent('yazaki')}`, A).expect(200)).body.data[0];
      expect(m).toMatchObject({ id: pn.wire.id, name: pn.wire.name, manufacturerName: 'Yazaki THW 1x2.5 sq.mm 100m' });
      expect(ids((await api('get', '/products/page?q=TT-CN01', A)).body)).toEqual([pn.plain.id]);
      // the new columns have trigram indexes (pg_trgm installed on the test server)
      const idx = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE indexname IN ('products_manufacturer_name_trgm_idx', 'product_suppliers_supplier_sku_trgm_idx', 'product_suppliers_supplier_product_name_trgm_idx') ORDER BY 1`;
      expect(idx.map((i) => i.indexname)).toEqual(['product_suppliers_supplier_product_name_trgm_idx', 'product_suppliers_supplier_sku_trgm_idx', 'products_manufacturer_name_trgm_idx']);
    });

    it('PO name mode: default from settings, stored, per-line names (supplier -> manufacturer -> shop), switchable, reprint stays', async () => {
      expect((await api('get', '/settings', A)).body.supplierDocNameMode).toBe('SHOP');
      await api('patch', '/settings', A, { supplierDocNameMode: 'BOGUS' }).expect(400);
      await api('patch', '/settings', A, { supplierDocNameMode: 'SUPPLIER' }).expect(200);
      const items = [
        { productId: pn.pipe.id, quantity: 10, unitCost: 80 },
        { productId: pn.cement.id, quantity: 5, unitCost: 120 },
        { productId: pn.plain.id, quantity: 20, unitCost: 9 },
      ];
      const po = (await api('post', '/purchase-orders', A, { supplierId: pn.s1.id, status: 'ISSUED', items }).expect(201)).body;
      expect(po.docNameMode).toBe('SUPPLIER');
      const lines = (p: any) => p.items.map((i: any) => [i.productId, i.docName, i.docCode]).sort((a: any, b: any) => a[0].localeCompare(b[0]));
      const supplierNames = [
        [pn.pipe.id, 'ท่อ PVC 8.5 1นิ้ว (ฟ้า)', 'TT-PV0185'],
        [pn.cement.id, 'TPI Mortar M200 50kg', null],
        [pn.plain.id, 'Thai Pipe Coupling 1"', 'TT-CN01'],
      ].sort((a: any, b: any) => a[0].localeCompare(b[0]));
      expect(lines(po)).toEqual(supplierNames);
      // the same lines from the other supplier: its code, no name of its own -> manufacturer name
      const po2 = (await api('post', '/purchase-orders', A, { supplierId: pn.s2.id, docNameMode: 'SUPPLIER', items: [{ productId: pn.pipe.id, quantity: 1, unitCost: 82 }] }).expect(201)).body;
      expect(lines(po2)).toEqual([[pn.pipe.id, 'SCG PVC Pipe Class 8.5 1"', 'RR-5521']]);
      // the stored mode wins over a later settings change (reprints are consistent)
      await api('patch', '/settings', A, { supplierDocNameMode: 'SHOP' }).expect(200);
      expect(lines((await api('get', `/purchase-orders/${po.id}`, A).expect(200)).body)).toEqual(supplierNames);
      // switch this PO to the shop names, any status; then back
      await api('patch', `/purchase-orders/${po.id}/doc-name-mode`, A, { mode: 'NOPE' }).expect(400);
      const shop = (await api('patch', `/purchase-orders/${po.id}/doc-name-mode`, A, { mode: 'SHOP' }).expect(200)).body;
      expect(shop.docNameMode).toBe('SHOP');
      expect(lines(shop)).toEqual([[pn.pipe.id, pn.pipe.name, null], [pn.cement.id, pn.cement.name, null], [pn.plain.id, pn.plain.name, null]].sort((a: any, b: any) => a[0].localeCompare(b[0])));
      expect((await api('get', `/purchase-orders?search=${po.poNumber}`, A)).body.data[0].items.every((i: any) => [pn.pipe.name, pn.cement.name, pn.plain.name].includes(i.docName))).toBe(true);
      await api('patch', `/purchase-orders/${po.id}/doc-name-mode`, A, { mode: 'SUPPLIER' }).expect(200);
      // receiving answers with the same names; the PO PDF opened from the document search too
      const full = (await api('get', `/purchase-orders/${po.id}`, A)).body;
      const rec = (await api('post', `/purchase-orders/${po.id}/receive`, A, { clientReceiptId: randomUUID(), items: full.items.map((i: any) => ({ purchaseOrderItemId: i.id, receivedQty: Number(i.quantity), unitCost: Number(i.unitCost) })) }).expect(201)).body;
      expect(lines(rec)).toEqual(supplierNames);
      const found = (await api('get', `/documents/search?q=${po.poNumber}`, A)).body.find((d: any) => d.docNumber === po.poNumber);
      expect(lines(found.rawData)).toEqual(supplierNames);
      // a new PO without a mode now takes the SHOP default; customer documents are untouched (receipt = shop name)
      const po3 = (await api('post', '/purchase-orders', A, { supplierId: pn.s1.id, items: [{ productId: pn.pipe.id, quantity: 1, unitCost: 80 }] }).expect(201)).body;
      expect(po3.docNameMode).toBe('SHOP');
      expect(po3.items[0].docName).toBe(pn.pipe.name);
      pn.po = po;
    });

    it('supplier return note: name mode stored, lines named like the PO, switchable', async () => {
      const note = (await api('post', '/supplier-returns', A, {
        supplierId: pn.s1.id, docNameMode: 'SUPPLIER',
        items: [{ productId: pn.pipe.id, productName: pn.pipe.name, quantity: 2, unitCost: 80, itemType: 'OVERSTOCK' }, { productId: pn.cement.id, productName: pn.cement.name, quantity: 1, unitCost: 120, itemType: 'OVERSTOCK' }],
      }).expect(201)).body;
      expect(note.docNameMode).toBe('SUPPLIER');
      const names = (n: any) => n.items.map((i: any) => [i.docName, i.docCode]);
      expect(names(note)).toEqual([['ท่อ PVC 8.5 1นิ้ว (ฟ้า)', 'TT-PV0185'], ['TPI Mortar M200 50kg', null]]);
      expect(names((await api('get', `/supplier-returns/${note.returnNumber}`, A)).body)).toEqual(names(note));
      const shop = (await api('patch', `/supplier-returns/${note.returnNumber}/doc-name-mode`, A, { mode: 'SHOP' }).expect(200)).body;
      expect(names(shop)).toEqual([[pn.pipe.name, null], [pn.cement.name, null]]);
      const listed = (await api('get', `/supplier-returns?supplierId=${pn.s1.id}`, A)).body.data.find((n: any) => n.returnNumber === note.returnNumber);
      expect(names(listed)).toEqual([[pn.pipe.name, null], [pn.cement.name, null]]);
    });

    it('invoice-line matching helper: supplier code exact, then name similarity; limited to the supplier / PO', async () => {
      const match = async (q: string) => (await api('get', `/purchase-orders/match-line?${q}`, A).expect(200)).body;
      const byCode = await match(`supplierId=${pn.s1.id}&text=${encodeURIComponent(' tt-pv0185 ')}`);
      expect(byCode[0]).toMatchObject({ productId: pn.pipe.id, matchedBy: 'supplierCode', score: 1 });
      // the name as printed on the supplier's invoice, slightly different
      const byName = await match(`supplierId=${pn.s1.id}&text=${encodeURIComponent('ท่อ PVC 8.5 1 นิ้ว ฟ้า')}`);
      expect(byName[0]).toMatchObject({ productId: pn.pipe.id, matchedBy: 'supplierName' });
      expect(byName[0].score).toBeGreaterThan(0.3);
      const byMaker = await match(`supplierId=${pn.s1.id}&text=${encodeURIComponent('TPI MORTAR M200')}`);
      expect(byMaker[0]).toMatchObject({ productId: pn.cement.id, matchedBy: 'manufacturerName' });
      const byBarcode = await match(`supplierId=${pn.s1.id}&text=${pn.plain.sku}`);
      expect(byBarcode[0]).toMatchObject({ productId: pn.plain.id, matchedBy: 'barcode' });
      // another supplier's code is not a match for this supplier; the wire is not this supplier's product
      expect((await match(`supplierId=${pn.s1.id}&text=RR-5521`)).find((m: any) => m.matchedBy === 'supplierCode')).toBeUndefined();
      expect((await match(`supplierId=${pn.s1.id}&text=${encodeURIComponent('Yazaki THW 1x2.5')}`)).map((m: any) => m.productId)).not.toContain(pn.wire.id);
      // limited to one PO's lines, with the line id
      const onPo = await match(`supplierId=${pn.s1.id}&poId=${pn.po.id}&text=TT-CN01`);
      expect(onPo[0]).toMatchObject({ productId: pn.plain.id, matchedBy: 'supplierCode' });
      expect(onPo[0].purchaseOrderItemId).toBe(pn.po.items.find((i: any) => i.productId === pn.plain.id).id);
      await api('get', `/purchase-orders/match-line?text=x`, A).expect(400);
      await api('get', `/purchase-orders/match-line?supplierId=${pn.s1.id}&text=x`, C).expect(403);
    });
  });

  describe('product delete / disable (owner 2026-11-19, docs/product-delete.md)', () => {
    const pd: Record<string, any> = {};
    const check = async (id: string, token = A) => (await api('get', `/products/${id}/delete-check`, token).expect(200)).body;
    const sync = async (since: string) => (await api('get', `/products/sync?since=${encodeURIComponent(since)}`, A).expect(200)).body;
    const make = async (name: string, extra: Record<string, unknown> = {}) =>
      (await api('post', '/products', A, { name, basePrice: 20, costPrice: 12, priceLevel1: 20, ...extra }).expect(201)).body;

    it('never-sold product with an opening stock adjustment and a supplier: hard delete removes its own data', async () => {
      const sup = (await api('post', '/suppliers', A, { name: 'ผู้ขายลบสินค้า e2e' }).expect(201)).body;
      const p = await make('สินค้าไม่เคยขาย e2e ลบได้', {
        supplierEntries: [{ supplierId: sup.id, unitCost: 12, supplierSku: 'DEL-01' }],
        barcodes: ['8850000990011'],
        packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, barcode: '8850000990028', priceLevel1: 110 }],
        wholesalePrices: [{ minQuantity: 10, unitPrice: 18 }],
      });
      await api('post', '/inventory/adjust', A, { productId: p.id, type: 'SET', amount: 24, reason: 'ยอดยกมา' }).expect(201);
      const before = (await sync('')).cursor;

      const c = await check(p.id);
      expect(c).toMatchObject({ canDelete: true, blockers: [], stock: 24, stockValue: 288, unit: 'ชิ้น', isActive: true });
      // stock on hand must be confirmed; nothing is deleted without it
      const r409 = await api('delete', `/products/${p.id}`, A).expect(409);
      expect(r409.body).toMatchObject({ code: 'STOCK_CONFIRM_REQUIRED', stock: 24 });
      expect(r409.body.message).toContain('ยังมีสต็อก 24 ชิ้น');
      await api('delete', `/products/${p.id}?confirmStock=1`, C).expect(403); // cashier
      const ok = (await api('delete', `/products/${p.id}?confirmStock=1`, A).expect(200)).body;
      expect(ok).toMatchObject({ deleted: true, id: p.id, stock: 24, stockValue: 288 });

      const db = new PrismaClient();
      try {
        expect(await db.product.count({ where: { id: p.id } })).toBe(0);
        expect(await db.stockBatch.count({ where: { productId: p.id } })).toBe(0);
        expect(await db.productSupplier.count({ where: { productId: p.id } })).toBe(0);
        expect(await db.productBarcode.count({ where: { productId: p.id } })).toBe(0);
        expect(await db.productPackagingUnit.count({ where: { productId: p.id } })).toBe(0);
        expect(await db.productWholesalePrice.count({ where: { productId: p.id } })).toBe(0);
        expect(await db.supplier.count({ where: { id: sup.id } })).toBe(1); // the supplier stays
        const logs = await db.auditLog.findMany({ where: { entityId: p.id }, orderBy: { createdAt: 'asc' } });
        const del = logs.find((l) => l.action === 'PRODUCT_DELETE');
        expect(del?.details).toMatchObject({ productName: p.name, stock: 24, stockValue: 288, removed: { stockBatches: 1, suppliers: 1, barcodes: 1, packs: 1, wholesalePrices: 1 } });
        // the stock card keeps its history and shows the stock leaving with the product
        expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['STOCK_ADJUST_ADD', 'STOCK_PRODUCT_DELETE']));
      } finally {
        await db.$disconnect();
      }
      // POS terminals drop it on their next delta sync; barcode lookup no longer finds it
      const delta = await sync(before);
      expect(delta.deleted).toContain(p.id);
      await api('get', `/products/${p.id}/delete-check`, A).expect(404);
      await api('delete', `/products/${p.id}?confirmStock=1`, A).expect(404);
    });

    it('a sold product is refused with the documents named, and stays', async () => {
      const c = await check(state.p.id);
      expect(c.canDelete).toBe(false);
      expect(c.blockers.map((b: any) => b.code)).toContain('SALE');
      const sale = c.blockers.find((b: any) => b.code === 'SALE');
      expect(sale.text).toBe(`บิลขาย ${sale.count} ใบ`);
      const r = await api('delete', `/products/${state.p.id}?confirmStock=1`, A).expect(409);
      expect(r.body.code).toBe('PRODUCT_IN_USE');
      expect(r.body.message).toContain(`มีบิลขาย ${sale.count} ใบ`);
      expect(r.body.message).toContain('ปิดการใช้งาน');
      expect(r.body.blockers.length).toBeGreaterThan(0);
      await api('get', `/products/${state.p.id}`, A).expect(200);
      // a PO line alone blocks too; a product that is part of a bundle as well
      const onPo = await make('สินค้าอยู่ในใบสั่งซื้อ e2e');
      const sup = (await api('post', '/suppliers', A, { name: 'ผู้ขาย PO ลบ e2e' }).expect(201)).body;
      await api('post', '/purchase-orders', A, { supplierId: sup.id, items: [{ productId: onPo.id, quantity: 2, unitCost: 10 }] }).expect(201);
      expect((await check(onPo.id)).blockers.map((b: any) => b.text)).toEqual(['ใบสั่งซื้อ 1 ใบ']);
      const child = await make('สินค้าส่วนประกอบชุด e2e');
      await make('ชุดสินค้า e2e ลบ', { isBundle: true, bundleItems: [{ childProductId: child.id, quantity: 2 }] });
      expect((await check(child.id)).blockers.map((b: any) => b.code)).toEqual(['BUNDLE']);
      pd.onPo = onPo;
      await api('get', `/products/${onPo.id}/delete-check`, C).expect(403); // MANAGE_INVENTORY
    });

    it('disable hides a product from the POS catalogue, checkout, the mobile lookup and the active list; enable brings it back', async () => {
      const p = await make('สินค้าปิดใช้งาน e2e');
      await api('post', '/inventory/adjust', A, { productId: p.id, type: 'SET', amount: 5, reason: 'e2e' }).expect(201);
      const cursor = (await sync('')).cursor;
      await api('post', '/products/set-active', C, { ids: [p.id], isActive: false }).expect(403);
      await api('post', '/products/set-active', A, { ids: [p.id], isActive: 'no' }).expect(400);
      const off = (await api('post', '/products/set-active', A, { ids: [p.id, 'missing-id'], isActive: false }).expect(201)).body;
      expect(off).toMatchObject({ updated: 1, notFound: ['missing-id'], isActive: false });
      // delta sync carries the row with isActive false: terminals take it off sale
      const d1 = await sync(cursor);
      expect(d1.products.find((x: any) => x.id === p.id)?.isActive).toBe(false);
      const active = (await api('get', `/products/page?status=active&q=${encodeURIComponent(p.name)}`, A).expect(200)).body;
      expect(active.data.map((x: any) => x.id)).not.toContain(p.id);
      const inactive = (await api('get', `/products/page?status=inactive&q=${encodeURIComponent(p.name)}`, A).expect(200)).body;
      expect(inactive.data.map((x: any) => x.id)).toEqual([p.id]);
      expect(inactive.meta.inactiveCount).toBeGreaterThanOrEqual(1);
      const all = (await api('get', `/products/page?q=${encodeURIComponent(p.name)}`, A).expect(200)).body;
      expect(all.data.map((x: any) => x.id)).toEqual([p.id]); // default: every product (inventory page)
      await api('get', '/products/page?status=x', A).expect(400);
      expect((await api('get', `/products/lookup?q=${encodeURIComponent(p.name)}`, A).expect(200)).body.data).toEqual([]);
      const shift = (await api('post', '/shifts/open', C, { startingCash: 0, terminalId: 'e2e-del' }).expect(201)).body.shift;
      const sell = () => api('post', '/orders/checkout', C, { clientOrderId: randomUUID(), shiftId: shift.id, items: [{ productId: p.id, quantity: 1, unitPrice: 20 }], payments: [{ method: 'CASH', amount: 20 }] });
      expect((await sell().expect(400)).body.message).toContain('ปิดใช้งาน');
      const db = new PrismaClient();
      try {
        expect((await db.auditLog.findFirst({ where: { entityId: p.id, action: 'PRODUCT_DISABLE' } }))).toBeTruthy();
      } finally {
        await db.$disconnect();
      }

      const c2 = (await sync('')).cursor;
      const on = (await api('post', '/products/set-active', A, { ids: [p.id], isActive: true }).expect(201)).body;
      expect(on.updated).toBe(1);
      expect((await sync(c2)).products.find((x: any) => x.id === p.id)?.isActive).toBe(true);
      expect((await api('get', `/products/lookup?q=${encodeURIComponent(p.name)}`, A).expect(200)).body.data.map((x: any) => x.id)).toEqual([p.id]);
      await sell().expect(201);
      // the product now has a sale: it can only be disabled
      expect((await check(p.id)).canDelete).toBe(false);
      const sum = (await api('get', `/shifts/${shift.id}/summary`, C)).body;
      await api('post', `/shifts/${shift.id}/close`, C, { actualCash: sum.expectedCash }).expect(201);
    });

    it('bulk delete: deletes the allowed ones, reports the rest per product, then disables them', async () => {
      const free = await make('ลบหลายรายการ ไม่มีสต็อก e2e');
      const stocked = await make('ลบหลายรายการ มีสต็อก e2e');
      await api('post', '/inventory/adjust', A, { productId: stocked.id, type: 'SET', amount: 3, reason: 'e2e' }).expect(201);
      const ids = [free.id, stocked.id, state.p.id, pd.onPo.id, 'missing-id'];
      const checks = (await api('post', '/products/delete-check', A, { ids }).expect(201)).body;
      expect(checks.map((c: any) => [c.id, c.canDelete])).toEqual([[free.id, true], [stocked.id, true], [state.p.id, false], [pd.onPo.id, false]]);
      await api('post', '/products/bulk-delete', A, { ids: [] }).expect(400);
      await api('post', '/products/bulk-delete', C, { ids }).expect(403);

      const r1 = (await api('post', '/products/bulk-delete', A, { ids }).expect(201)).body;
      expect(r1.deleted.map((d: any) => d.id)).toEqual([free.id]);
      expect(r1.needsStockConfirm).toEqual([{ id: stocked.id, name: stocked.name, stock: 3, unit: 'ชิ้น' }]);
      expect(r1.blocked.map((b: any) => b.id)).toEqual([state.p.id, pd.onPo.id]);
      expect(r1.blocked[1].message).toContain('ใบสั่งซื้อ 1 ใบ');
      expect(r1.notFound).toEqual(['missing-id']);

      const r2 = (await api('post', '/products/bulk-delete', A, { ids: [stocked.id, pd.onPo.id], confirmStock: true }).expect(201)).body;
      expect(r2.deleted.map((d: any) => d.id)).toEqual([stocked.id]);
      expect(r2.blocked.map((b: any) => b.id)).toEqual([pd.onPo.id]);

      const off = (await api('post', '/products/set-active', A, { ids: r1.blocked.map((b: any) => b.id), isActive: false }).expect(201)).body;
      expect(off.updated).toBe(2);
      // sold product: still in its bill and in the reports
      expect((await api('get', `/orders/${state.order.id}`, A).expect(200)).body.items[0].productId).toBe(state.p.id);
      await api('post', '/products/set-active', A, { ids: r1.blocked.map((b: any) => b.id), isActive: true }).expect(201);
    });
  });
  describe('debt payment into a chosen cashier shift / no shift; dashboard credit summary (round start, docs/round-start-dashboard.md)', () => {
    const rs: Record<string, any> = {};
    let db: PrismaClient;
    beforeAll(() => { db = new PrismaClient(); });
    afterAll(async () => { await db?.$disconnect(); });
    const balance = async (id: string) => Number((await api('get', '/finance/accounts', A)).body.find((a: any) => a.id === id).balance);
    const summary = async (shiftId: string) => (await api('get', `/shifts/${shiftId}/summary`, A).expect(200)).body;
    const pay = (token: string, orderId: string, body: Record<string, unknown>) =>
      api('post', `/debts/${orderId}/pay`, token, { clientPaymentId: randomUUID(), ...body });

    it('setup: cashier shift, two customers with credit bills', async () => {
      rs.p = (await api('post', '/products', A, { name: 'สินค้าเงินเชื่อ e2e', basePrice: 400, priceLevel1: 400, unit: 'ชิ้น' }).expect(201)).body;
      rs.shift = (await api('post', '/shifts/open', C, { startingCash: 500, terminalId: 'rs-term-1' }).expect(201)).body.shift;
      rs.cust1 = (await api('post', '/customers', A, { name: 'ลูกค้าเงินเชื่อกะ e2e', phone: '0810000001' }).expect(201)).body;
      rs.cust2 = (await api('post', '/customers', A, { name: 'ลูกค้าเงินเชื่อไม่เข้ากะ e2e', phone: '0810000002' }).expect(201)).body;
      const credit = async (customerId: string, qty: number) => (await api('post', '/orders/checkout', C, {
        clientOrderId: randomUUID(), shiftId: rs.shift.id, customerId,
        items: [{ productId: rs.p.id, quantity: qty, unitPrice: 400 }], payments: [{ method: 'CREDIT_DEBT', amount: 400 * qty }],
      }).expect(201)).body;
      rs.o1 = await credit(rs.cust1.id, 3);
      rs.o2 = await credit(rs.cust2.id, 2);
      rs.safe = (await api('get', '/finance/accounts', A)).body.find((a: any) => a.type === 'CASH_SAFE');
      rs.bank = (await api('get', '/finance/accounts', A)).body.find((a: any) => a.type === 'BANK' && a.bankAccountId);
    });

    it('lists the OPEN shifts with cashier, terminal and opening time (debts permission)', async () => {
      const list = (await api('get', '/debts/open-shifts', A).expect(200)).body;
      const row = list.find((x: any) => x.id === rs.shift.id);
      expect(row).toMatchObject({ shiftNumber: rs.shift.shiftNumber, terminalId: 'rs-term-1', cashierName: expect.any(String) });
      expect(new Date(row.openedAt).getTime()).toBe(new Date(rs.shift.openedAt).getTime());
      expect(list.every((x: any) => typeof x.terminalName === 'string')).toBe(true);
      await api('get', '/debts/open-shifts', C).expect(403); // cashier1 has no MANAGE_DEBTS
    });

    it('back office: cash + QR into a chosen open shift count in that shift exactly like a POS receipt, close matches', async () => {
      const s0 = await summary(rs.shift.id);
      const cash = (await pay(A, rs.o1.id, { amount: 150, paymentMethod: 'CASH', shiftChoice: rs.shift.id }).expect(201)).body;
      expect(cash.payment.shiftId).toBe(rs.shift.id);
      expect(cash.payment.shift.shiftNumber).toBe(rs.shift.shiftNumber);
      const qr = (await pay(A, rs.o1.id, { amount: 60, paymentMethod: 'QR_PROMPTPAY', shiftChoice: rs.shift.id, bankAccountId: rs.bank.bankAccountId }).expect(201)).body;
      expect(qr.payment.shiftId).toBe(rs.shift.id);
      // the same as the cashier taking it at the POS
      const posCash = (await pay(C, rs.o1.id, { amount: 40, paymentMethod: 'CASH', shiftId: rs.shift.id, shiftChoice: 'POS' }).expect(201)).body;
      expect(posCash.payment.shiftId).toBe(rs.shift.id);
      const s1 = await summary(rs.shift.id);
      expect(s1.debtCollectionCash).toBeCloseTo(s0.debtCollectionCash + 190, 2);
      expect(s1.debtCollectionQrTransfer).toBeCloseTo(s0.debtCollectionQrTransfer + 60, 2);
      expect(s1.debtCollectionCount).toBe(s0.debtCollectionCount + 3);
      expect(s1.expectedCash).toBeCloseTo(s0.expectedCash + 190, 2);
      // cash ledger went into this terminal's drawer
      const drawer = (await api('get', '/finance/accounts', A)).body.find((a: any) => a.terminalId === 'rs-term-1');
      expect(Number(drawer.balance)).toBeCloseTo(500 + 190, 2);
      rs.expected = s1.expectedCash;
    });

    it('back office: no shift -> ledger entry (cash to the safe, transfer to the bank), no shift changes', async () => {
      const adminShift = (await api('post', '/shifts/open', A, { startingCash: 0, terminalId: 'rs-term-admin' }).expect(201)).body.shift;
      const before = { c: await summary(rs.shift.id), a: await summary(adminShift.id), safe: await balance(rs.safe.id), bank: await balance(rs.bank.id) };
      const cash = (await pay(A, rs.o2.id, { amount: 70, paymentMethod: 'CASH', shiftChoice: 'NONE' }).expect(201)).body;
      const tr = (await pay(A, rs.o2.id, { amount: 30, paymentMethod: 'TRANSFER', shiftChoice: 'NONE', bankAccountId: rs.bank.bankAccountId }).expect(201)).body;
      expect(cash.payment.shiftId).toBeNull();
      expect(tr.payment.shiftId).toBeNull();
      expect(cash.payment.receiptNo).toMatch(/^RC\d{4}-\d{4,}$/);
      expect(await balance(rs.safe.id)).toBeCloseTo(before.safe + 70, 2);
      expect(await balance(rs.bank.id)).toBeCloseTo(before.bank + 30, 2);
      const rows = await db.moneyTransaction.findMany({ where: { refType: 'DEBT_PAYMENT', refId: { in: [cash.payment.id, tr.payment.id] } }, include: { account: true } });
      expect(rows.map((r) => [r.type, r.account.type, Number(r.amount)]).sort()).toEqual([['DEBT_RECEIPT', 'BANK', 30], ['DEBT_RECEIPT', 'CASH_SAFE', 70]]);
      expect(await db.cashMovement.count({ where: { id: { in: ['debt-' + cash.payment.id, 'debt-' + tr.payment.id] } } })).toBe(0);
      for (const [id, prev] of [[rs.shift.id, before.c], [adminShift.id, before.a]] as const) {
        const now = await summary(id);
        expect([now.expectedCash, now.debtCollectionCash, now.debtCollectionQrTransfer, now.debtCollectionCount])
          .toEqual([prev.expectedCash, prev.debtCollectionCash, prev.debtCollectionQrTransfer, prev.debtCollectionCount]);
      }
      // cancelling the no-shift cash receipt takes it back out of the safe (not twice)
      await api('post', `/debts/payments/${cash.payment.id}/cancel`, A, { reason: 'e2e ไม่เข้ากะ' }).expect(201);
      expect(await balance(rs.safe.id)).toBeCloseTo(before.safe, 2);
      await api('post', `/shifts/${adminShift.id}/close`, A, { actualCash: 0 }).expect(201);
    });

    it('no explicit shift choice -> 400 SHIFT_CHOICE_REQUIRED, nothing written (owner 2026-11-20: no default)', async () => {
      const before = await db.customerDebt.findUnique({ where: { orderId: rs.o2.id } });
      const payments = await db.debtPayment.count();
      for (const body of [
        { amount: 10, paymentMethod: 'CASH' },
        { amount: 10, paymentMethod: 'CASH', shiftId: rs.shift.id }, // a shift id alone is not a choice
        { amount: 10, paymentMethod: 'TRANSFER', bankAccountId: rs.bank.bankAccountId },
        { amount: 10, paymentMethod: 'CASH', noShift: true }, // the old field is not a choice either
        { amount: 10, paymentMethod: 'CASH', shiftChoice: '  ' },
        { amount: 10, paymentMethod: 'CASH', shiftChoice: 5 },
      ]) {
        const r = await pay(A, rs.o2.id, body).expect(400);
        expect(r.body.code).toBe('SHIFT_CHOICE_REQUIRED');
      }
      // an explicit shift id that disagrees with shiftId
      await pay(A, rs.o2.id, { amount: 10, paymentMethod: 'CASH', shiftId: rs.shift.id, shiftChoice: randomUUID() }).expect(400);
      // a card is still refused
      await pay(A, rs.o2.id, { amount: 10, paymentMethod: 'CREDIT_CARD', shiftChoice: 'NONE' }).expect(400);
      expect(await db.debtPayment.count()).toBe(payments);
      expect(Number((await db.customerDebt.findUnique({ where: { orderId: rs.o2.id } }))!.remainingAmount)).toBe(Number(before!.remainingAmount));
    });

    it('rights: a cashier cannot pay into another shift or into no shift; POS keeps its own shift', async () => {
      await pay(C, rs.o2.id, { amount: 10, paymentMethod: 'CASH', shiftChoice: 'NONE' }).expect(403);
      const other = (await api('post', '/shifts/open', A, { startingCash: 0, terminalId: 'rs-term-admin2' }).expect(201)).body.shift;
      await pay(C, rs.o2.id, { amount: 10, paymentMethod: 'CASH', shiftChoice: other.id }).expect(403);
      await pay(A, rs.o2.id, { amount: 10, paymentMethod: 'CASH', shiftId: rs.shift.id, shiftChoice: 'NONE' }).expect(400);
      await api('post', `/shifts/${other.id}/close`, A, { actualCash: 0 }).expect(201);
      // the POS with no current shift on the device for a QR receipt: the cashier's own open shift (old summary rule)
      const legacy = (await pay(C, rs.o2.id, { amount: 5, paymentMethod: 'QR_PROMPTPAY', shiftChoice: 'POS', bankAccountId: rs.bank.bankAccountId }).expect(201)).body;
      expect(legacy.payment.shiftId).toBe(rs.shift.id);
      rs.expectedQr = (await summary(rs.shift.id)).debtCollectionQrTransfer;
    });

    it('the chosen shift closed in the meantime -> refused (409 SHIFT_NOT_OPEN), nothing recorded', async () => {
      const s = await summary(rs.shift.id);
      expect(s.expectedCash).toBeCloseTo(rs.expected, 2);
      const closed = (await api('post', `/shifts/${rs.shift.id}/close`, C, { actualCash: s.expectedCash }).expect(201)).body;
      expect(Number(closed.expectedCash)).toBeCloseTo(rs.expected, 2);
      expect(Number(closed.cashDifference)).toBeCloseTo(0, 2);
      const debtBefore = await db.customerDebt.findUnique({ where: { orderId: rs.o2.id } });
      const r = await pay(A, rs.o2.id, { amount: 20, paymentMethod: 'CASH', shiftChoice: rs.shift.id }).expect(409);
      expect(r.body.code).toBe('SHIFT_NOT_OPEN');
      expect(r.body.message).toContain(rs.shift.shiftNumber);
      expect(Number((await db.customerDebt.findUnique({ where: { orderId: rs.o2.id } }))!.remainingAmount)).toBe(Number(debtBefore!.remainingAmount));
      expect((await api('get', '/debts/open-shifts', A)).body.some((x: any) => x.id === rs.shift.id)).toBe(false);
      // closed shift history keeps the QR receipts
      expect((await summary(rs.shift.id)).debtCollectionQrTransfer).toBeCloseTo(rs.expectedQr, 2);
    });

    it('dashboard credit summary == the debts page totals (same rule), owing list adds up', async () => {
      await db.customerDebt.update({ where: { orderId: rs.o1.id }, data: { dueDate: new Date(Date.now() - 5 * 86400000) } });
      const sum = (await api('get', '/debts/credit-summary', A).expect(200)).body;
      const page = (await api('get', '/debts?stats=1&limit=1', A).expect(200)).body;
      const unpaid = (await api('get', '/debts?statusGroup=unpaid&limit=500', A).expect(200)).body;
      const overdue = (await api('get', '/debts?statusGroup=overdue&limit=500', A).expect(200)).body;
      expect(sum.billCount).toBe(page.stats.unpaidCount);
      expect(sum.overdueBillCount).toBe(page.stats.overdueCount);
      expect(sum.totalOutstanding).toBeCloseTo(unpaid.summary.totalRemaining, 2);
      // (page.stats.totalOutstanding also sums the remaining of a debt stored as PAID with money left, which the
      // tricky dataset above creates on purpose; the card / tab counts and the unpaid tab exclude it, like the card)
      expect(sum.overdueAmount).toBeCloseTo(overdue.summary.totalRemaining, 2);
      expect(sum.customerCount).toBe(new Set(unpaid.data.map((d: any) => d.customerId)).size);
      expect(sum.overdueCustomerCount).toBe(new Set(overdue.data.map((d: any) => d.customerId)).size);
      expect(sum.overdueBillCount).toBeGreaterThan(0);
      // VIEW_REPORTS-only users (dashboard) may read it as well
      const list = (await api('get', '/debts/owing-customers?limit=200', A).expect(200)).body;
      expect(list.meta.total).toBe(sum.customerCount);
      expect(list.data.reduce((t: number, r: any) => t + r.owed, 0)).toBeCloseTo(sum.totalOutstanding, 2);
      const mine = list.data.find((r: any) => r.customerId === rs.cust1.id);
      const d1 = (await api('get', `/debts?customerId=${rs.cust1.id}&statusGroup=unpaid`, A)).body;
      expect(mine).toMatchObject({ name: 'ลูกค้าเงินเชื่อกะ e2e', phone: '0810000001', bills: d1.data.length, overdueBills: 1 });
      expect(mine.owed).toBeCloseTo(d1.summary.totalRemaining, 2);
      expect(mine.overdueAmount).toBeCloseTo(d1.summary.totalRemaining, 2);
      const sorted = list.data.map((r: any) => r.owed);
      expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
      const od = (await api('get', '/debts/owing-customers?overdue=1&limit=200', A)).body;
      expect(od.meta.total).toBe(sum.overdueCustomerCount);
      expect((await api('get', '/debts/owing-customers?search=0810000001', A)).body.data.map((r: any) => r.customerId)).toEqual([rs.cust1.id]);
    });
  });
  describe('stock card paging (style pass 2026-11-22): GET /inventory/movements/page', () => {
    it('total / allCount agree with the rows, filters by type / search / from / product, newest first', async () => {
      const tag = randomUUID().slice(0, 6);
      const prod = (await api('post', '/products', A, { name: `สินค้าสต็อกการ์ด ${tag}`, basePrice: 10, priceLevel1: 10, unit: 'ชิ้น' }).expect(201)).body;
      await api('post', '/inventory/adjust', A, { productId: prod.id, type: 'SET', amount: 20, reason: 'ยอดยกมา' }).expect(201);
      for (let i = 0; i < 3; i++) await api('post', '/inventory/adjust', A, { productId: prod.id, type: 'ADD', amount: 1 + i, reason: `รับเพิ่ม ${i}` }).expect(201);
      await api('post', '/inventory/adjust', A, { productId: prod.id, type: 'SUB', amount: 2, reason: 'ชำรุด' }).expect(201);

      // everything: allCount = total = every STOCK_* audit row; pages cover it without overlap
      const all = (await api('get', '/inventory/movements/page?page=1&limit=500', A).expect(200)).body;
      const prisma = new PrismaClient();
      const dbCount = await prisma.auditLog.count({ where: { action: { startsWith: 'STOCK_' } } });
      await prisma.$disconnect();
      expect(all.meta).toMatchObject({ page: 1, limit: 500, total: dbCount, allCount: dbCount });
      expect(all.data).toHaveLength(Math.min(dbCount, 500));
      const times = all.data.map((m: any) => new Date(m.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      const p1 = (await api('get', '/inventory/movements/page?page=1&limit=3', A)).body;
      const p2 = (await api('get', '/inventory/movements/page?page=2&limit=3', A)).body;
      expect([...p1.data, ...p2.data].map((m: any) => m.id)).toEqual(all.data.slice(0, 6).map((m: any) => m.id));

      // search (product name), type, product id: total = the filtered rows, allCount unchanged
      const mine = (await api('get', `/inventory/movements/page?q=${encodeURIComponent(tag)}&limit=50`, A)).body;
      expect(mine.meta).toMatchObject({ total: 5, allCount: dbCount });
      // the opening count (SET from 0) is logged as ADJUST_ADD
      expect(mine.data.map((m: any) => m.type)).toEqual(['ADJUST_SUB', 'ADJUST_ADD', 'ADJUST_ADD', 'ADJUST_ADD', 'ADJUST_ADD']);
      const adds = (await api('get', `/inventory/movements/page?q=${encodeURIComponent(tag)}&type=ADJUST_ADD`, A)).body;
      expect(adds.meta.total).toBe(4);
      expect(adds.data.every((m: any) => m.type === 'ADJUST_ADD' && m.productId === prod.id)).toBe(true);
      const byProduct = (await api('get', `/inventory/movements/page?productId=${prod.id}`, A)).body;
      expect(byProduct.meta).toMatchObject({ total: 5, allCount: 5 });
      // the reason is searchable too; the same rows as the old list endpoint for the product
      expect((await api('get', `/inventory/movements/page?productId=${prod.id}&q=${encodeURIComponent('ชำรุด')}`, A)).body.meta.total).toBe(1);
      const old = (await api('get', `/inventory/movements?productId=${prod.id}`, A)).body;
      expect(old.map((m: any) => m.id)).toEqual(byProduct.data.map((m: any) => m.id));
      // from: in the future -> nothing; a bad type is ignored (no SQL from the query string)
      const future = new Date(Date.now() + 3600_000).toISOString();
      expect((await api('get', `/inventory/movements/page?productId=${prod.id}&from=${encodeURIComponent(future)}`, A)).body.meta.total).toBe(0);
      expect((await api('get', `/inventory/movements/page?productId=${prod.id}&type=${encodeURIComponent("X' OR 1=1")}`, A)).body.meta.total).toBe(5);
      // like % / _ in the search are literal
      expect((await api('get', '/inventory/movements/page?q=%25%25%25', A)).body.meta.total).toBe(0);
      // cashier without MANAGE_INVENTORY / VIEW_REPORTS: refused
      await api('get', '/inventory/movements/page', C).expect(403);
    });
  });

  describe('POS price level: checkout validates the level price (owner bug 2026-11-23, docs/pos-price-level.md)', () => {
    const lv: Record<string, any> = {};
    const sell = (token: string, items: any[], extra: any = {}) => {
      const total = Math.round(items.reduce((t, i) => t + i.quantity * i.unitPrice, 0) * 100) / 100;
      return api('post', '/orders/checkout', token, {
        clientOrderId: randomUUID(), shiftId: token === A ? lv.shiftA.id : lv.shift.id, items, payments: [{ method: 'CASH', amount: total }], ...extra,
      });
    };
    beforeAll(async () => {
      await api('post', '/auth/register', A, { username: 'levelseller', password: 'Level@test99', fullName: 'แคชเชียร์ไม่มีสิทธิ์ลด', role: 'CASHIER', pinCode: '5813', permissions: ['POS_SELL'] }).expect(201);
      lv.S = (await api('post', '/auth/login', undefined, { username: 'levelseller', password: 'Level@test99' }).expect(201)).body.access_token;
      lv.shift = (await api('post', '/shifts/open', lv.S, { startingCash: 0, terminalId: 'e2e-level' }).expect(201)).body.shift;
      lv.shiftA = (await api('get', '/shifts/current?terminalId=e2e-term-admin', A).expect(200)).body.shift
        || (await api('post', '/shifts/open', A, { startingCash: 0, terminalId: 'e2e-level-admin' }).expect(201)).body.shift;
      const mk = async (body: any) => {
        const p = (await api('post', '/products', A, { unit: 'ชิ้น', costPrice: 5, ...body }).expect(201)).body;
        await api('post', '/inventory/adjust', A, { productId: p.id, type: 'ADD', amount: 200, reason: 'ปรับยอดเริ่มต้น' }).expect(201);
        return (await api('get', `/products/${p.id}`, A).expect(200)).body;
      };
      lv.dish = await mk({
        name: 'น้ำยาล้างจานระดับราคา e2e', basePrice: 20, priceLevel1: 20, priceLevel2: 18, priceLevel3: 16,
        packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, priceLevel1: 110, priceLevel2: 100 }],
      });
      lv.pack = lv.dish.packagingUnits[0];
      lv.tape = await mk({ name: 'เทปมีแต่ราคา 3 e2e', basePrice: 0, priceLevel1: 0, priceLevel3: 30 });
      lv.zero = await mk({ name: 'สินค้ายังไม่ตั้งราคา e2e', basePrice: 0, priceLevel1: 0 });
      lv.m2 = (await api('post', '/customers', A, { name: 'สมาชิกราคาส่ง e2e', phone: '0899990002', priceLevel: 2 }).expect(201)).body;
      lv.m3 = (await api('post', '/customers', A, { name: 'สมาชิกส่งพิเศษ e2e', phone: '0899990003', priceLevel: 3 }).expect(201)).body;
    });
    const base = (unitPrice: number, quantity = 1) => ({ productId: lv.dish.id, quantity, unitPrice });
    const pack = (unitPrice: number) => ({ productId: lv.dish.id, quantity: 1, unitPrice, unitId: lv.pack.id, unitName: 'แพ็ค', conversionFactor: 6 });

    it('member level 2: ราคา 2 accepted and stored on the order; ราคา 3 needs approval', async () => {
      const o = (await sell(lv.S, [base(18, 2), pack(100)], { customerId: lv.m2.id, priceLevel: 2 }).expect(201)).body;
      expect(o.priceLevel).toBe(2);
      expect(Number(o.totalAmount)).toBe(136);
      // the client claims level 3 for a level-2 member: the server uses the member's own level
      const r = await sell(lv.S, [base(16)], { customerId: lv.m2.id, priceLevel: 3 }).expect(409);
      expect(r.body.code).toBe('APPROVAL_REQUIRED');
      expect(r.body.reasons.map((x: any) => x.code)).toEqual(['BELOW_PRICE_FLOOR']);
      expect(r.body.message).toContain('ราคาระดับ 2');
      await sell(lv.S, [pack(96)], { customerId: lv.m2.id }).expect(409);
      // a level-3 member: pack without its own ราคา 3 = 16 x 6
      expect((await sell(lv.S, [base(16), pack(96)], { customerId: lv.m3.id }).expect(201)).body.priceLevel).toBe(3);
    });
    it('walk-in level: accepted at the chosen level, stored; level 1 (or an old client without a level) rejects lower prices', async () => {
      const o = (await sell(lv.S, [base(16)], { priceLevel: 3 }).expect(201)).body;
      expect(o.priceLevel).toBe(3);
      expect((await api('get', `/orders/${o.id}`, A).expect(200)).body.priceLevel).toBe(3);
      await sell(lv.S, [base(16)], { priceLevel: 1 }).expect(409);
      await sell(lv.S, [base(16)]).expect(409);
      expect((await sell(lv.S, [base(20)]).expect(201)).body.priceLevel).toBe(1);
      // missing price at the level: ราคา 1; only ราคา 3: everyone pays 30 (never 0)
      await sell(lv.S, [{ productId: lv.tape.id, quantity: 1, unitPrice: 30 }], { priceLevel: 2 }).expect(201);
      await sell(lv.S, [{ productId: lv.tape.id, quantity: 1, unitPrice: 0 }], { priceLevel: 1 }).expect(409);
      // a higher price than the level is not a discount
      await sell(lv.S, [base(20)], { customerId: lv.m3.id }).expect(201);
    });
    it('setting "walk-in ราคา 2-5 needs the discount right": a seller without it is checked at ราคา 1; members too', async () => {
      await api('patch', '/settings', A, { walkInLevelNeedsDiscount: true }).expect(200);
      expect((await api('get', '/settings').expect(200)).body).toMatchObject({ walkInLevelNeedsDiscount: true });
      await sell(lv.S, [base(16)], { priceLevel: 3 }).expect(409);
      expect((await sell(A, [base(16)], { priceLevel: 3 }).expect(201)).body.priceLevel).toBe(3);
      await api('post', '/customers', lv.S, { name: 'สมาชิกใหม่ระดับ 3', phone: '0899990004', priceLevel: 3 }).expect(403);
      await api('post', '/customers', lv.S, { name: 'สมาชิกใหม่ระดับ 1', phone: '0899990005', priceLevel: 1 }).expect(201);
      await api('patch', '/settings', A, { walkInLevelNeedsDiscount: false }).expect(200);
      const q = (await api('post', '/customers', lv.S, { name: 'สมาชิกด่วนระดับ 3', phone: '0899990006', priceLevel: '3' }).expect(201)).body;
      expect(q.priceLevel).toBe(3);
      expect((await sell(lv.S, [base(16)], { customerId: q.id }).expect(201)).body.priceLevel).toBe(3);
    });
    it('a product without any price: 0 rejected; a manual price needs the right or an approval (then accepted)', async () => {
      const r0 = await sell(lv.S, [{ productId: lv.zero.id, quantity: 1, unitPrice: 0 }]).expect(409);
      expect(r0.body.message).toContain('ยังไม่ได้ตั้งราคา');
      const r = await sell(lv.S, [{ productId: lv.zero.id, quantity: 1, unitPrice: 25 }]).expect(409);
      expect(r.body.reasons.map((x: any) => x.code)).toEqual(['BELOW_PRICE_FLOOR']);
      const ok = await api('post', '/approvals/pin', lv.S, { ticket: r.body.ticket, pin: '7391' }).expect(201);
      const o = (await sell(lv.S, [{ productId: lv.zero.id, quantity: 1, unitPrice: 25 }], { approvalId: ok.body.approvalId }).expect(201)).body;
      expect((await api('get', `/orders/${o.id}`, A).expect(200)).body.approvalId).toBe(ok.body.approvalId);
      // the owner / a user with POS_DISCOUNT may type the price
      await sell(A, [{ productId: lv.zero.id, quantity: 1, unitPrice: 25 }]).expect(201);
      // with the approval rule off, a 0 for an unpriced product is still refused
      await api('put', '/approvals/rules/current', A, { belowPriceFloorNeedsApproval: false }).expect((res: any) => expect([200, 201]).toContain(res.status));
      await sell(lv.S, [{ productId: lv.zero.id, quantity: 1, unitPrice: 0 }]).expect(400);
      await api('put', '/approvals/rules/current', A, { belowPriceFloorNeedsApproval: true }).expect((res: any) => expect([200, 201]).toContain(res.status));
    });
    it('settings: start-of-bill dialog flag, level names and the levels in use (offline mirror for the POS)', async () => {
      await api('patch', '/settings', A, { posAskCustomerAtStart: true }).expect(200);
      const st = (await api('get', '/settings').expect(200)).body;
      expect(st.posAskCustomerAtStart).toBe(true);
      expect(st.levelNames[2]).toBeTruthy();
      expect(st.usedLevels).toEqual(expect.arrayContaining([1, 2, 3]));
      await api('patch', '/settings', lv.S, { posAskCustomerAtStart: false }).expect(403);
      await api('patch', '/settings', A, { posAskCustomerAtStart: false }).expect(200);
    });
  });
  describe('POS live data: every back-office edit reaches the delta syncs (docs/pos-keys-refresh.md)', () => {
    const db = new PrismaClient();
    afterAll(async () => { await db.$disconnect(); });
    const events: RealtimeEvent[] = [];
    const sub = realtimeBus.subscribe((e) => events.push(e));
    afterAll(() => sub.unsubscribe());
    let pCursor = '';
    let cCursor = '';
    const pull = async () => {
      const b = (await api('get', `/products/sync${pCursor ? `?since=${encodeURIComponent(pCursor)}` : ''}`, C).expect(200)).body;
      pCursor = b.cursor;
      return b;
    };
    const pullCustomers = async () => {
      const b = (await api('get', `/customers/sync${cCursor ? `?since=${encodeURIComponent(cCursor)}` : ''}`, C).expect(200)).body;
      cCursor = b.cursor;
      return b;
    };
    const logRows = async (table: 'product_changes' | 'customer_changes', col: string, id: string) =>
      Number((await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col} = $1`, id))[0].n);
    /** one edit: a new change-log row for the product and the product (as the POS reads it) in the next delta */
    const productEdit = async (id: string, edit: () => Promise<unknown>, check: (row: any) => void) => {
      const before = await logRows('product_changes', 'product_id', id);
      await edit();
      expect(await logRows('product_changes', 'product_id', id)).toBeGreaterThan(before);
      const d = await pull();
      expect(d.full).toBe(false);
      const row = d.products.find((p: any) => p.id === id);
      expect(row).toBeDefined();
      check(row);
    };
    const tag = String(Date.now()).slice(-6);
    const ids = { p: '', cat: '', cust: '' };

    it('setup: a product with ราคา 1-5, a pack, barcode, stock; a member; first full loads', async () => {
      ids.cat = (await api('post', '/categories', A, { name: `LIVE หมวด ${tag}` }).expect(201)).body.id;
      ids.p = (await api('post', '/products', A, {
        name: `LIVE น้ำยาล้างจาน ${tag}`, unit: 'ขวด', barcodes: [`LIVE${tag}1`], basePrice: 20, priceLevel1: 20, priceLevel2: 18, priceLevel3: 16, costPrice: 8,
        packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, barcode: `LIVE${tag}6`, priceLevel1: 110, priceLevel2: 100 }],
      }).expect(201)).body.id;
      ids.cust = (await api('post', '/customers', A, { name: `LIVE ร้านส่ง ${tag}`, phone: `07${tag}12`, priceLevel: 1 }).expect(201)).body.id;
      expect((await pull()).full).toBe(true);
      expect((await pullCustomers()).full).toBe(true);
      expect(await pull()).toMatchObject({ full: false, products: [], deleted: [] });
    });

    it('ราคา 1-5 and pack prices', async () => {
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { basePrice: 25, priceLevel1: 25, priceLevel2: 22, priceLevel3: 19, priceLevel4: 17, priceLevel5: 15 }).expect(200),
        (r) => expect([r.priceLevel1, r.priceLevel2, r.priceLevel3, r.priceLevel4, r.priceLevel5].map(Number)).toEqual([25, 22, 19, 17, 15]));
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, barcode: `LIVE${tag}6`, priceLevel1: 125, priceLevel2: 105 }] }).expect(200),
        (r) => expect([Number(r.packagingUnits[0].priceLevel1), Number(r.packagingUnits[0].priceLevel2)]).toEqual([125, 105]));
    });

    it('name, manufacturer name, barcode added / changed', async () => {
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { name: `LIVE ชื่อใหม่ ${tag}`, manufacturerName: 'ผู้ผลิต LIVE' }).expect(200),
        (r) => expect([r.name, r.manufacturerName]).toEqual([`LIVE ชื่อใหม่ ${tag}`, 'ผู้ผลิต LIVE']));
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { barcodes: [`LIVE${tag}1`, `LIVE${tag}2`] }).expect(200),
        (r) => expect(r.barcodes.map((b: any) => b.barcode).sort()).toEqual([`LIVE${tag}1`, `LIVE${tag}2`]));
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { barcodes: [`LIVE${tag}3`] }).expect(200),
        (r) => expect(r.barcodes.map((b: any) => b.barcode)).toEqual([`LIVE${tag}3`]));
    });

    it('category, active / inactive, stock adjustment', async () => {
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { categoryId: ids.cat }).expect(200), (r) => expect(r.categoryId).toBe(ids.cat));
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { isActive: false }).expect(200), (r) => expect(r.isActive).toBe(false));
      await productEdit(ids.p, () => api('patch', `/products/${ids.p}`, A, { isActive: true }).expect(200), (r) => expect(r.isActive).toBe(true));
      await productEdit(ids.p, () => api('post', '/inventory/adjust', A, { productId: ids.p, type: 'SET', amount: 42, reason: 'นับสต็อก' }).expect(201), (r) => expect(Number(r.stock)).toBe(42));
    });

    it('new product and deleted product', async () => {
      const id = (await api('post', '/products', A, { name: `LIVE ใหม่ ${tag}`, unit: 'ชิ้น', basePrice: 9, priceLevel1: 9 }).expect(201)).body.id;
      expect(await logRows('product_changes', 'product_id', id)).toBeGreaterThan(0);
      expect((await pull()).products.map((p: any) => p.id)).toEqual([id]);
      await api('delete', `/products/${id}`, A).expect(200);
      expect(await pull()).toMatchObject({ full: false, products: [], deleted: [id] });
    });

    it('member price level and customer edits: customer_changes + the customer delta', async () => {
      const edit = async (body: any, check: (row: any) => void) => {
        const before = await logRows('customer_changes', 'customer_id', ids.cust);
        await api('patch', `/customers/${ids.cust}`, A, body).expect(200);
        expect(await logRows('customer_changes', 'customer_id', ids.cust)).toBeGreaterThan(before);
        const d = await pullCustomers();
        expect(d.full).toBe(false);
        const row = d.customers.find((c: any) => c.id === ids.cust);
        expect(row).toBeDefined();
        check(row);
      };
      await edit({ priceLevel: 3 }, (r) => expect(Number(r.priceLevel ?? r.profile?.priceLevel)).toBe(3));
      await edit({ name: `LIVE ร้านส่ง แก้ชื่อ ${tag}`, phone: `07${tag}13` }, (r) => expect([r.name, r.phone]).toEqual([`LIVE ร้านส่ง แก้ชื่อ ${tag}`, `07${tag}13`]));
    });

    it('settings (VAT, receipt options, price level names): settingsVersion changes and a realtime "settings" event is sent', async () => {
      const version = async () => (await api('get', '/settings', C).expect(200)).body;
      const settingsEvent = async (edit: () => Promise<unknown>) => {
        const before = (await version()).settingsVersion;
        expect(typeof before).toBe('string');
        events.length = 0;
        await new Promise((r) => setTimeout(r, 5)); // updated_at has millisecond precision
        await edit();
        await new Promise((r) => setTimeout(r, 400)); // debounce of the announcement
        expect(events.some((e) => e.entity === 'settings')).toBe(true);
        const after = await version();
        expect(after.settingsVersion).not.toBe(before);
        return after;
      };
      expect((await settingsEvent(() => api('patch', '/settings', A, { vatEnabled: true }).expect(200))).vatEnabled).toBe(true);
      expect((await settingsEvent(() => api('patch', '/settings', A, { receiptOptions: { slip: { showAddress: false } } }).expect(200))).receiptOptions.slip.showAddress).toBe(false);
      const names = { 1: 'ปลีก LIVE', 2: 'ส่ง LIVE', 3: 'ส่งพิเศษ LIVE', 4: 'ราคา 4', 5: 'ราคา 5' };
      expect((await settingsEvent(() => api('put', '/online-shop/config', A, { levelNames: names }).expect(200))).levelNames[2]).toBe('ส่ง LIVE');
      await api('patch', '/settings', A, { vatEnabled: false, receiptOptions: null }).expect(200);
    });
  });
  describe('data exports: manager PIN every time, server-enforced, audited (Round B item 6)', () => {
    const db = new PrismaClient();
    afterAll(() => db.$disconnect());
    const approve = (tok: string, kind: string, filters: unknown, pin: string) => api('post', '/exports/approve', tok, { kind, filters, pin });
    const exp = (tok: string, path: string, body: unknown, approval?: string) => {
      const r = request(app.getHttpServer()).post(`/api${path}`).set('Authorization', `Bearer ${tok}`).send(body as object);
      return approval ? r.set('x-export-approval', approval) : r;
    };

    it('products: no / wrong / reused / other-filter approval = 403; filters applied by the server; audit row', async () => {
      const tag = String(Date.now()).slice(-6);
      const cat1 = (await api('post', '/categories', A, { name: `EXP หมวด1 ${tag}` }).expect(201)).body;
      const cat2 = (await api('post', '/categories', A, { name: `EXP หมวด2 ${tag}` }).expect(201)).body;
      const mk = async (name: string, categoryId: string, stock: number, isActive = true) => {
        const p = (await api('post', '/products', A, { name: `EXP ${name} ${tag}`, categoryId, basePrice: 10, priceLevel1: 10, unit: 'ชิ้น' }).expect(201)).body;
        if (stock) await api('post', '/inventory/adjust', A, { productId: p.id, type: 'ADD', amount: stock, reason: 'e2e export' }).expect(201);
        if (!isActive) await api('post', '/products/set-active', A, { ids: [p.id], isActive: false }).expect(201);
        return p;
      };
      const a = await mk('มีของ', cat1.id, 50);
      const b = await mk('ใกล้หมด', cat1.id, 2);
      const c = await mk('หมด', cat2.id, 0);
      const d2 = await mk('ปิดใช้', cat2.id, 30, false);
      const filters = { categoryIds: [cat1.id, cat2.id].sort(), stock: 'all', status: 'all' };

      await exp(A, '/exports/products', { filters }).expect(403);
      await exp(A, '/exports/products', { filters }, randomUUID()).expect(403);
      await approve(A, 'products', filters, '0000').expect(403);
      await approve(C, 'products', filters, '7391').expect(403); // cashier: no MANAGE_INVENTORY
      await approve(A, 'nope', filters, '7391').expect(400);
      // the cashier's PIN is not a manager PIN
      await approve(A, 'products', filters, '8264').expect(403);
      const ok = (await approve(A, 'products', filters, '7391').expect(201)).body;
      expect(ok).toMatchObject({ approvedBy: expect.any(String), approvalId: expect.any(String) });
      // another filter set with this approval: refused, and it is not used up by that
      await exp(A, '/exports/products', { filters: { ...filters, stock: 'low' } }, ok.approvalId).expect(403);
      const all = (await exp(A, '/exports/products', { filters }, ok.approvalId).expect(201)).body;
      expect(all.data.map((p: any) => p.id).sort()).toEqual([a.id, b.id, c.id, d2.id].sort());
      expect(all.data.find((p: any) => p.id === a.id)).toMatchObject({ sku: a.sku, name: a.name });
      await exp(A, '/exports/products', { filters }, ok.approvalId).expect(403); // single use

      const run = async (f: any) => {
        const t = (await approve(A, 'products', f, '7391').expect(201)).body.approvalId;
        return ((await exp(A, '/exports/products', { filters: f }, t).expect(201)).body.data as any[]).map((p) => p.id).sort();
      };
      expect(await run({ categoryIds: [cat1.id], stock: 'all', status: 'all' })).toEqual([a.id, b.id].sort());
      expect(await run({ ...filters, stock: 'instock' })).toEqual([a.id, b.id, d2.id].sort());
      expect(await run({ ...filters, stock: 'low' })).toEqual([b.id]);
      expect(await run({ ...filters, stock: 'nostock' })).toEqual([c.id]);
      expect(await run({ ...filters, status: 'inactive' })).toEqual([d2.id]);
      expect(await run({ ...filters, status: 'active', stock: 'instock' })).toEqual([a.id, b.id].sort());

      const log = await db.auditLog.findFirst({ where: { action: 'DATA_EXPORT', entityId: ok.approvalId } });
      expect(log?.details).toMatchObject({ kind: 'products', rowCount: 4, filters, approvedBy: ok.approvedBy });
      const reqRow = await db.approvalRequest.findUnique({ where: { id: ok.approvalId } });
      expect(reqRow).toMatchObject({ type: 'DATA_EXPORT', status: 'USED', channel: 'PIN' });
    });

    it('an expired approval is refused', async () => {
      const f = { categoryIds: [], stock: 'all', status: 'all' };
      const ok = (await approve(A, 'products', f, '7391').expect(201)).body;
      await db.approvalRequest.update({ where: { id: ok.approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await exp(A, '/exports/products', { filters: f }, ok.approvalId).expect(403);
    });

    it('reports: every row of a list tab in one export (not one page), equal to the paged report; P&L', async () => {
      const params = { range: 'all', start: '', end: '' };
      for (const tab of ['bestsellers', 'inventory', 'customers', 'sales', 'payments', 'purchases']) {
        const filters = { tab, params };
        await exp(A, '/exports/report', filters).expect(403);
        const t = (await approve(A, 'report', filters, '7391').expect(201)).body.approvalId;
        const r = (await exp(A, '/exports/report', filters, t).expect(201)).body;
        const key = ({ bestsellers: 'allProducts', inventory: 'items', customers: 'allCustomers' } as Record<string, string>)[tab];
        if (key) {
          const one = (await api('get', `/reports/tabs?range=all&tab=${tab}&page=1&limit=500`, A).expect(200)).body[tab];
          expect(r.data[key]).toHaveLength(one.total);
          expect(r.rowCount).toBe(one.total);
        }
      }
      const filters = { from: '2020-01-01', to: '2099-12-31' };
      const t = (await approve(A, 'profit-loss', filters, '7391').expect(201)).body.approvalId;
      const pl = (await exp(A, '/exports/profit-loss', filters, t).expect(201)).body.data;
      const direct = (await api('get', '/finance/profit-loss?from=2020-01-01&to=2099-12-31', A).expect(200)).body;
      expect(pl.netProfit).toBe(direct.netProfit);
    });
  });
  describe('dashboard creditors / upcoming expenses (Round B item 8): server numbers equal the payables page', () => {
    it('creditors total = payables card; overdue / due soon by the due date; window from the setting or ?days', async () => {
      const tag = String(Date.now()).slice(-6);
      const sup = (await api('post', '/suppliers', A, { name: `เจ้าหนี้แดชบอร์ด ${tag}`, creditTerms: 30 }).expect(201)).body;
      const prod = (await api('post', '/products', A, { name: `OBL สินค้า ${tag}`, basePrice: 20, priceLevel1: 20, unit: 'ชิ้น' }).expect(201)).body;
      const day = 86400000;
      const ymd = (t: number) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
      const mkPo = async (qty: number, cost: number, dueDate: string) => {
        const po = (await api('post', '/purchase-orders', A, { supplierId: sup.id, status: 'ISSUED', dueDate, items: [{ productId: prod.id, quantity: qty, unitCost: cost }] }).expect(201)).body;
        await api('post', `/purchase-orders/${po.id}/receive`, A, { clientReceiptId: randomUUID(), items: [{ purchaseOrderItemId: po.items[0].id, receivedQty: qty, unitCost: cost }] }).expect(201);
        return po;
      };
      const late = await mkPo(2, 100, ymd(Date.now() - 3 * day)); // overdue 200
      const soon = await mkPo(3, 50, ymd(Date.now() + 2 * day)); // due in 2 days 150
      const later = await mkPo(1, 70, ymd(Date.now() + 20 * day)); // outside 7 days 70
      const cats = (await api('get', '/finance/expense-categories', A).expect(200)).body;
      await api('post', '/finance/recurring', A, { name: `ค่าเช่า ${tag}`, categoryId: cats[0].id, amount: 5000, frequency: 'MONTHLY', dayOfMonth: 1, firstDueDate: ymd(Date.now() + 3 * day) }).expect(201);
      await api('post', '/finance/recurring', A, { name: `ค่าเน็ต ${tag}`, categoryId: cats[0].id, amount: 600, frequency: 'MONTHLY', dayOfMonth: 1, firstDueDate: ymd(Date.now() - 3 * day) }).expect(201);

      const o = (await api('get', '/dashboard/obligations', A).expect(200)).body;
      const pay = (await api('get', '/payables/bills?limit=1', A).expect(200)).body;
      expect(o.days).toBe(7);
      expect(o.creditors.total).toBeCloseTo(pay.summary.totalOutstanding, 2);
      const mine = o.creditors.suppliers.find((r: any) => r.supplierId === sup.id);
      expect(mine).toMatchObject({ billCount: 3, owed: 420, overdueCount: 1, overdueAmount: 200 });
      expect(o.creditors.overdueAmount).toBeGreaterThanOrEqual(200);
      const ids = o.upcoming.items.map((i: any) => i.id);
      expect(ids).toContain(late.id);
      expect(ids).toContain(soon.id);
      expect(ids).not.toContain(later.id);
      expect(o.upcoming.items.find((i: any) => i.id === late.id)).toMatchObject({ overdue: true, amount: 200, link: `/payables?search=${encodeURIComponent(late.poNumber)}` });
      const rent = o.upcoming.items.find((i: any) => i.label === `ค่าเช่า ${tag}`);
      expect(rent).toMatchObject({ kind: 'RECURRING', overdue: false, amount: 5000, link: '/finance?view=recurring' });
      expect(o.upcoming.items.find((i: any) => i.label === `ค่าเน็ต ${tag}`)).toMatchObject({ overdue: true, amount: 600 });
      expect(o.upcoming.overdueAmount).toBeCloseTo(o.upcoming.items.filter((i: any) => i.overdue).reduce((t: number, i: any) => t + i.amount, 0), 2);
      // a wider window from ?days and from the setting
      expect((await api('get', '/dashboard/obligations?days=30', A).expect(200)).body.upcoming.items.map((i: any) => i.id)).toContain(later.id);
      await api('patch', '/settings', A, { dashboardDueDays: 30 }).expect(200);
      expect((await api('get', '/dashboard/obligations', A).expect(200)).body.days).toBe(30);
      await api('patch', '/settings', A, { dashboardDueDays: 0 }).expect(400);
      await api('patch', '/settings', A, { dashboardDueDays: 7 }).expect(200);
      // the dashboard right (VIEW_REPORTS); a plain cashier is refused
      await api('get', '/dashboard/obligations', C).expect(403);
    });
  });
  describe('LINE staff group: webhook (signature), group pick, test message, new-order alert + reminders (Round B item 10)', () => {
    const db = new PrismaClient();
    const SECRET = '0123456789abcdef0123456789abcdef';
    const GROUP = 'C' + 'a1'.repeat(16);
    const pushes: { to: string; text: string }[] = [];
    const quota = { type: 'limited', value: 200, used: 10 };
    let lineServer: httpModule.Server;
    let staff: LineStaffService;
    const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('base64');
    const hook = (raw: string, sig?: string, headers: Record<string, string> = {}) => {
      const r = request(app.getHttpServer()).post('/api/public/line/webhook').set('content-type', 'application/json');
      if (sig !== undefined) r.set('x-line-signature', sig);
      for (const [k, v] of Object.entries(headers)) r.set(k, v);
      return r.send(raw);
    };
    const mkOrder = async (n: number) => db.onlineOrder.create({
      data: {
        orderNo: `WBTEST-${Date.now()}-${n}`, lineUserId: 'U' + 'b2'.repeat(16), fulfillment: 'PICKUP', contactName: `ลูกค้ากลุ่ม ${n}`, contactPhone: '0812345678',
        subtotal: 300, deliveryFee: 0, totalAmount: 300,
      },
    });

    beforeAll(async () => {
      lineServer = httpModule.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          if (req.url === '/v2/bot/message/push') {
            const b = JSON.parse(body);
            pushes.push({ to: b.to, text: b.messages?.[0]?.text || '' });
            res.end('{}');
          } else if (req.url === `/v2/bot/group/${GROUP}/summary`) {
            res.end(JSON.stringify({ groupId: GROUP, groupName: 'พนักงานร้าน ทดสอบ' }));
          } else if (req.url === '/v2/bot/message/quota') {
            res.end(JSON.stringify({ type: quota.type, value: quota.value }));
          } else if (req.url === '/v2/bot/message/quota/consumption') {
            res.end(JSON.stringify({ totalUsage: quota.used }));
          } else {
            res.statusCode = 404;
            res.end('{}');
          }
        });
      });
      await new Promise<void>((r) => lineServer.listen(0, '127.0.0.1', () => r()));
      process.env.LINE_API_BASE = `http://127.0.0.1:${(lineServer.address() as any).port}`;
      staff = app.get(LineStaffService);
    });
    afterAll(async () => {
      delete process.env.LINE_API_BASE;
      await new Promise((r) => lineServer?.close(r));
      await db.$disconnect();
    });

    it('webhook: no secret / bad signature = 401; a signed join records the group (also through the tunnel); other paths stay closed', async () => {
      const raw = JSON.stringify({ destination: 'Uxx', events: [{ type: 'join', source: { type: 'group', groupId: GROUP }, timestamp: Date.now() }] });
      await api('put', '/online-shop/config', A, { channelSecret: '' }).expect(200);
      await hook(raw, sign(raw)).expect(401); // no secret configured yet
      await api('put', '/online-shop/config', A, { channelSecret: 'not-a-secret' }).expect(400);
      await api('put', '/online-shop/config', A, { channelSecret: SECRET, messagingToken: 'x'.repeat(40) }).expect(200);
      await hook(raw).expect(401);
      await hook(raw, 'AAAA').expect(401);
      await hook(raw, sign(raw + ' ')).expect(401);
      expect(await db.lineGroup.count()).toBe(0);
      // LINE's "Verify" button: empty events, signed
      const verify = JSON.stringify({ destination: 'Uxx', events: [] });
      expect((await hook(verify, sign(verify)).expect(200)).body).toEqual({ ok: true });
      // through the Cloudflare tunnel (cf-ray): this exact path is open
      await hook(raw, sign(raw), { 'cf-ray': '8f00aa-SIN' }).expect(200);
      expect(await db.lineGroup.findUnique({ where: { groupId: GROUP } })).toMatchObject({ name: 'พนักงานร้าน ทดสอบ', leftAt: null });
      expect(lineSignatureOk(raw, sign(raw), SECRET)).toBe(true);
      // the rest of the API stays closed to the tunnel
      await request(app.getHttpServer()).post('/api/public/line/other').set('cf-ray', 'x').send({}).expect(404);
      await request(app.getHttpServer()).get('/api/online-shop/line/groups').set('cf-ray', 'x').set('Authorization', `Bearer ${A}`).expect(404);
      // the admin sees the group; the secret is never sent back
      const g = (await api('get', '/online-shop/line/groups', A).expect(200)).body;
      expect(g).toMatchObject({ hasChannelSecret: true, staffGroupId: null, webhookPath: '/api/public/line/webhook' });
      expect(g.groups).toEqual([expect.objectContaining({ groupId: GROUP, name: 'พนักงานร้าน ทดสอบ', left: false, selected: false })]);
      const cfg = (await api('get', '/online-shop/config', A).expect(200)).body;
      expect(cfg.hasChannelSecret).toBe(true);
      expect(JSON.stringify(cfg)).not.toContain(SECRET);
      await api('get', '/online-shop/line/groups', C).expect(403);
    });

    it('pick the group (only a known one), send a test message', async () => {
      await api('put', '/online-shop/config', A, { staffGroupId: 'C' + 'ff'.repeat(16) }).expect(400);
      await api('put', '/online-shop/config', A, { staffGroupId: 'bad' }).expect(400);
      await api('put', '/online-shop/config', A, { staffGroupId: GROUP, backOfficeUrl: 'http://192.168.1.10:3000' }).expect(200);
      expect((await api('get', '/online-shop/line/groups', A).expect(200)).body).toMatchObject({ staffGroupId: GROUP, backOfficeUrl: 'http://192.168.1.10:3000' });
      pushes.length = 0;
      const r = (await api('post', `/online-shop/line/groups/${GROUP}/test`, A).expect(201)).body;
      expect(r.ok).toBe(true);
      expect(pushes).toEqual([expect.objectContaining({ to: GROUP, text: expect.stringContaining('ทดสอบ') })]);
    });

    it('new order: alert at once, then a reminder every 10 min while NEW and unclaimed, max 6; logged on the order; survives a restart', async () => {
      pushes.length = 0;
      const o = await mkOrder(1);
      await staff.orderPlaced(o.id);
      await staff.runDue(new Date());
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ to: GROUP });
      expect(pushes[0].text).toContain(`ออเดอร์ออนไลน์ใหม่ ${o.orderNo}`);
      expect(pushes[0].text).toContain('ลูกค้ากลุ่ม 1');
      expect(pushes[0].text).toContain('฿300.00');
      expect(pushes[0].text).toContain('รับเองที่ร้าน');
      expect(pushes[0].text).toContain(`http://192.168.1.10:3000/online-orders?id=${o.id}`);
      const t0 = Date.now();
      await staff.runDue(new Date(t0 + 5 * 60_000));
      expect(pushes).toHaveLength(1); // not yet
      // a "restart": a fresh service instance reads the schedule from the database
      const fresh = new LineStaffService(app.get(PrismaService), app.get(LineService));
      for (let i = 1; i <= 8; i++) await fresh.runDue(new Date(t0 + i * 10 * 60_000 + 1000));
      expect(pushes).toHaveLength(7); // 1 alert + 6 reminders, then it stops
      expect(pushes[1].text).toContain('เตือนครั้งที่ 1/6');
      expect(pushes[6].text).toContain('เตือนครั้งที่ 6/6');
      const row = await db.onlineOrder.findUniqueOrThrow({ where: { id: o.id } });
      expect(row).toMatchObject({ staffAlertCount: 7, staffAlertNextAt: null });
      const d = (await api('get', `/online-shop/orders/${o.id}`, A).expect(200)).body;
      expect(d.staffAlerts.log).toHaveLength(7);
      expect(d.staffAlerts.log.every((l: any) => l.ok)).toBe(true);
      expect(d.staffAlerts.log[0].result).toContain('เตือนครั้งที่ 6');
    });

    it('claimed or accepted: no more reminders; quota used up: nothing sent, logged', async () => {
      pushes.length = 0;
      const o = await mkOrder(2);
      await staff.orderPlaced(o.id);
      await staff.runDue(new Date());
      expect(pushes).toHaveLength(1);
      await api('post', `/online-shop/orders/${o.id}/claim`, A, {}).expect(201);
      await staff.runDue(new Date(Date.now() + 11 * 60_000));
      expect(pushes).toHaveLength(1);
      expect((await db.onlineOrder.findUniqueOrThrow({ where: { id: o.id } })).staffAlertNextAt).toBeNull();

      quota.used = 200; // this month's quota is used up
      const q = await mkOrder(3);
      const fresh = new LineStaffService(app.get(PrismaService), app.get(LineService)); // no cached quota
      await fresh.orderPlaced(q.id);
      await fresh.runDue(new Date());
      expect(pushes).toHaveLength(1);
      const logs = await db.onlineOrderLineLog.findMany({ where: { onlineOrderId: q.id } });
      expect(logs).toEqual([expect.objectContaining({ ok: false, result: expect.stringContaining('โควตา') })]);
      quota.used = 10;
      // no group chosen: nothing sent, logged, schedule stopped
      await api('put', '/online-shop/config', A, { staffGroupId: '' }).expect(200);
      const r = await mkOrder(4);
      await staff.orderPlaced(r.id);
      await staff.runDue(new Date());
      expect(pushes).toHaveLength(1);
      expect((await db.onlineOrderLineLog.findFirstOrThrow({ where: { onlineOrderId: r.id } })).result).toContain('ยังไม่ได้เลือกกลุ่ม');
      await api('put', '/online-shop/config', A, { messagingToken: '', channelSecret: '' }).expect(200);
    });
  });
});
