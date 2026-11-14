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
import { valueStock } from '../src/reports/reports.service';

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
});
