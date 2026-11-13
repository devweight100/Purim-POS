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
import * as legacy from './legacy/reports-client-legacy';

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
      const bill = (bills.data || bills).find((b: any) => b.id === po.id);
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

    it('every tab, every period: same numbers as the old client-side functions', async () => {
      const unwrap = (b: any) => (Array.isArray(b?.data) ? b.data : Array.isArray(b) ? b : []);
      // what the old page downloaded
      const analytics = (await api('get', '/reports/analytics', A).expect(200)).body;
      const [claims, debts, customers, shifts, suppliers, rawProducts] = await Promise.all(
        ['/claims?limit=5000', '/debts?limit=5000', '/customers?limit=5000', '/shifts/history?limit=1000', '/suppliers', '/products'].map(async (p) => unwrap((await api('get', p, A).expect(200)).body)),
      );
      const products = legacy.legacyFormatProducts(rawProducts);
      const rawOrders = analytics.orders;
      expect(rawOrders.length).toBeGreaterThan(5);

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
        const expected = {
          sales: legacy.calculateSalesAndProfitReport(filteredOrders, products, rangeReturns),
          claimsAndVat: { replacementCost, refundsPaid, supplierRecovery, claimNetCost: replacementCost + refundsPaid - supplierRecovery, ...legacy.calculateVatSummary(filteredOrders, rangeReturns) },
          bestsellers: legacy.calculateBestSellingProducts(filteredOrders, products, rangeReturns),
          inventory: legacy.calculateInventoryValuationReport(products, rawOrders, analytics.stockBatchValuation.byProductId, { lowStockThreshold: analytics.lowStockThreshold, lastReceivedAtByProduct: analytics.lastReceivedAtByProduct }),
          payments: legacy.calculatePaymentsAndShiftsReport(filteredOrders, shifts, { returns: rangeReturns, debtReceipts: analytics.debtReceipts, inRange }),
          customers: legacy.calculateCustomerAndDebtsReport(filteredOrders, debts, customers),
          purchases: legacy.calculatePurchasesAndClaimsReport(analytics.purchases, legacy.filterOrdersByDateRange(claims, tr, customStart, customEnd), suppliers, inRange),
        };
        const q = new URLSearchParams({ range: timeRange, ...(customStart ? { start: customStart } : {}), ...(customEnd ? { end: customEnd } : {}) });
        const got = (await api('get', `/reports/tabs?${q}`, A).expect(200)).body;
        const label = `${timeRange} ${customStart || ''} ${customEnd || ''}`;
        for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
          expect({ label, tab: k, value: got[k] }).toEqual({ label, tab: k, value: JSON.parse(JSON.stringify(expected[k])) });
        }
        // one tab at a time (what the page asks for) gives the same figures
        const one = (await api('get', `/reports/tabs?${q}&tab=payments`, A).expect(200)).body;
        expect(one.payments).toEqual(got.payments);
        expect(one.sales).toBeUndefined();
      }
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
});
