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
import * as legacyPayables from './legacy/payables-client-legacy';
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
      sk.child = (await mk({ name: 'SYNC ลูก', sku: 'SYNC-CHILD', barcodes: ['SYNC-BC-1'] })).id;
      sk.x = (await mk({
        name: 'SYNC รูป', sku: 'SYNC-X', categoryId: sk.cat,
        images: [{ dataUrl: `data:image/png;base64,${PNG}`, thumbDataUrl: `data:image/png;base64,${THUMB}`, name: 'a.png', isCover: true }],
      })).id;
      sk.bundle = (await mk({ name: 'SYNC ชุด', sku: 'SYNC-BUNDLE', isBundle: true, bundleItems: [{ childProductId: sk.child, quantity: 2 }] })).id;
      await api('post', '/inventory/adjust', A, { productId: sk.child, type: 'SET', amount: 9, reason: 'e2e' }).expect(201);
      const b = await pull();
      expect(b.full).toBe(false);
      expect(ids(b)).toEqual([sk.bundle, sk.child, sk.x].sort());
      expect(client.get(sk.child).stock).toBe(9);
      expect(client.get(sk.bundle).stock).toBe(4); // floor(9 / 2) sets
      expect(client.get(sk.bundle).bundleItems[0].childProduct).toMatchObject({ id: sk.child, name: 'SYNC ลูก', sku: 'SYNC-CHILD' });
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
      sk.gone = (await api('post', '/products', A, { name: 'SYNC ลบ', sku: 'SYNC-GONE', basePrice: 1 }).expect(201)).body.id;
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
      for (const bad of ['', 'nope', 'v1.1-2.0.' + Buffer.from('1:2:').toString('base64url'), cursor.replace(/^v1\.\d+-\d+\./, 'v1.1-2.'), cursor.replace(/^(v1\.\d+-\d+\.)\d+/, '$1' + (Date.now() - 8 * 86400_000))]) {
        expect((await sync(bad)).full).toBe(true);
      }
      expect((await sync(cursor)).full).toBe(false);
      const asCashier = await sync(undefined, C);
      const row = asCashier.products.find((p: any) => p.id === sk.child);
      expect(row.costPrice).toBeUndefined();
      expect(row.stock).toBe(10);
      expect(JSON.stringify(asCashier.products)).not.toMatch(/"(costPrice|unitCost|lastCost)"/);
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
      const html = (await api('post', '/products', A, { name: 'SYNC html', sku: 'SYNC-HTML', basePrice: 1, images: [{ dataUrl: 'data:text/html;base64,PGgxPng8L2gxPg==' }] }).expect(201)).body;
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
      const other = (await api('post', '/products', A, { name: 'SYNC other', sku: 'SYNC-OTHER', basePrice: 1, images: [{ dataUrl: `data:image/png;base64,${PNG}` }] }).expect(201)).body;
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
        name: 'SYNC ครบ', sku: 'SYNC-FULL', basePrice: 12.5, priceLevel1: 12.5, priceLevel2: 11, costPrice: 7.25, unit: 'ขวด', categoryId: sk.cat,
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
        expect(row.suppliers).toEqual(d.suppliers.map((x: any) => ({ ...pick(x, ['id', 'supplierId', 'supplierSku', 'unitCost', 'isPreferred']), supplier: pick(x.supplier, ['id', 'name']) })));
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
      expect(norm(p2.data)).toEqual(norm(bills.slice(3, 6).map((x: any) => ({ ...x, items: [] }))));
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
      const mk = async (body: any) => (await api('post', '/products', A, { basePrice: 20, unit: 'ชิ้น', ...body }).expect(201)).body;
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
      expect(one).toEqual(catalog.find((p) => p.sku === 'LIST-A_1'));
      // inventory cards over every product
      const st = (await api('get', '/products/page?page=1&limit=1&stats=1', A).expect(200)).body.stats;
      const val = rows.reduce((s, p) => s + Math.max(0, p.stock) * (p.basePrice || Number(catalog.find((x) => x.id === p.id).costPrice) || 0), 0);
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
});
