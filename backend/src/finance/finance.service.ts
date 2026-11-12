import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { grossPerUnit } from '../../../shared/src/po-calc';
import { MoneyAccountType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { businessTransaction } from '../prisma/business-transaction';
import * as ledger from './ledger';
import { PlanningService } from './planning.service';
import { addDays, bangkokDayKey, bangkokStartOfDay, dateRangeFilter, DAY_MS, parseDateParam } from '../common/bangkok-date';

type Actor = { id?: string; fullName?: string; username?: string } | undefined;
const round2 = (n: number) => Math.round(n * 100) / 100;
const CLIENT_ID = /^[a-zA-Z0-9-]{16,80}$/;

function money(value: unknown, field = 'จำนวนเงิน'): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new BadRequestException(`${field}ต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
  }
  return round2(n);
}

const TYPE_LABELS: Record<string, string> = {
  SALE: 'ขายสินค้า',
  SALE_REFUND: 'คืนเงินลูกค้า (ยกเลิก/คืนสินค้า)',
  DEBT_RECEIPT: 'รับชำระหนี้ลูกค้า',
  SUPPLIER_PAYMENT: 'จ่ายเจ้าหนี้การค้า',
  CLAIM_REFUND: 'คืนเงินเคลม',
  EXPENSE: 'ค่าใช้จ่าย',
  TRANSFER: 'ย้ายเงินระหว่างบัญชี',
  OPENING: 'ยอดยกมา',
  ADJUSTMENT: 'ปรับยอดตามจริง',
  OWNER_CAPITAL: 'เจ้าของนำเงินเข้า',
  OWNER_DRAW: 'เจ้าของถอนใช้',
  DRAWER_IN: 'เติมเงินเข้าลิ้นชัก',
  OTHER_INCOME: 'รายรับอื่น',
  DRAWER_OUT: 'นำเงินออกจากลิ้นชัก',
  SHIFT_OVER_SHORT: 'เงินขาด/เกินตอนปิดกะ',
  REVERSAL: 'รายการกลับ (ยกเลิก)',
};

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService, private planning: PlanningService) {}

  // ─── idempotency: one client id = one money action ───
  private async once<T>(tx: any, clientId: string | undefined, fingerprint: unknown, run: () => Promise<T>): Promise<T> {
    if (!clientId || !CLIENT_ID.test(clientId)) throw new BadRequestException('ต้องระบุรหัสรายการ (clientId) เพื่อป้องกันการบันทึกซ้ำ');
    const key = 'finance-' + clientId;
    const fp = JSON.stringify(fingerprint);
    const prev = await tx.auditLog.findUnique({ where: { id: key } });
    if (prev) {
      const details = prev.details as any;
      if (details?.fingerprint !== fp) throw new BadRequestException('รหัสรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว');
      return details.result as T;
    }
    const result = await run();
    await tx.auditLog.create({ data: { id: key, action: 'FINANCE', entity: 'MoneyTransaction', details: { fingerprint: fp, result: JSON.parse(JSON.stringify(result)) } } });
    return result;
  }

  private async account(tx: any, id: string) {
    const acc = await tx.moneyAccount.findUnique({ where: { id } });
    if (!acc || !acc.isActive) throw new NotFoundException('ไม่พบบัญชีเงิน หรือบัญชีถูกปิดใช้งาน');
    return acc;
  }

  /** Cash moved in/out of a drawer outside the POS must also appear in that shift's cash count. */
  private async mirrorDrawer(tx: any, acc: any, direction: 'IN' | 'OUT', amount: number, reason: string) {
    if (acc.type !== 'CASH_DRAWER') return;
    const shift = await tx.shift.findFirst({ where: { status: 'OPEN', terminalId: acc.terminalId === ledger.UNASSIGNED_TERMINAL ? null : acc.terminalId } });
    if (!shift) throw new BadRequestException(`${acc.name} ไม่มีกะที่เปิดอยู่ ทำรายการกับลิ้นชักได้เฉพาะตอนเปิดกะ`);
    await tx.cashMovement.create({ data: { id: randomUUID(), shiftId: shift.id, type: direction, category: 'GENERAL', amount, reason } });
  }

  // ─── accounts ───
  async listAccounts() {
    await ledger.ensureCoreAccounts(this.prisma);
    await ledger.removeUnusedDuplicateCoreAccounts(this.prisma);
    const [accounts, bal, openShifts] = await Promise.all([
      this.prisma.moneyAccount.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { bankAccount: true } }),
      ledger.balances(this.prisma),
      this.prisma.shift.findMany({ where: { status: 'OPEN' }, select: { terminalId: true, shiftNumber: true, user: { select: { fullName: true } } } }),
    ]);
    const openings = await this.prisma.moneyTransaction.findMany({ where: { type: 'OPENING' }, select: { accountId: true } });
    const hasOpening = new Set(openings.map((o) => o.accountId));
    return accounts.map((a) => {
      const shift = a.type === 'CASH_DRAWER' ? openShifts.find((s) => (s.terminalId || ledger.UNASSIGNED_TERMINAL) === a.terminalId) : undefined;
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        isActive: a.isActive,
        balance: bal.get(a.id) || 0,
        hasOpeningBalance: hasOpening.has(a.id),
        bankAccountId: a.bankAccountId,
        bank: a.bankAccount ? { bankName: a.bankAccount.bankName, accountName: a.bankAccount.accountName, accountNumber: a.bankAccount.accountNumber } : null,
        terminalId: a.terminalId,
        openShift: shift ? { shiftNumber: shift.shiftNumber, cashier: shift.user?.fullName } : null,
      };
    });
  }

  async createAccount(body: { name?: string; type?: string }) {
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('กรุณาตั้งชื่อบัญชี');
    if (!['CASH_SAFE', 'CARD_CLEARING'].includes(String(body.type))) {
      throw new BadRequestException('สร้างได้เฉพาะบัญชีเงินสด (เซฟ) หรือบัญชีพักยอดบัตร — บัญชีธนาคารให้เพิ่มที่เมนูบัญชีธนาคาร ระบบจะสร้างให้อัตโนมัติ');
    }
    return this.prisma.moneyAccount.create({ data: { name, type: body.type as MoneyAccountType, sortOrder: body.type === 'CASH_SAFE' ? 11 : 91 } });
  }

  async updateAccount(id: string, body: { name?: string; isActive?: boolean }) {
    const acc = await this.prisma.moneyAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('ไม่พบบัญชีเงิน');
    if (body.isActive === false) {
      const bal = await ledger.balanceOf(this.prisma, id);
      if (Math.abs(bal) >= 0.01) throw new BadRequestException(`ปิดบัญชีไม่ได้ ยังมียอดคงเหลือ ฿${bal.toFixed(2)} กรุณาย้ายเงินออกก่อน`);
    }
    return this.prisma.moneyAccount.update({
      where: { id },
      data: { ...(body.name?.trim() ? { name: body.name.trim() } : {}), ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}) },
    });
  }

  /** Opening balance: once per account, entered on the day the store starts using the ledger. */
  async setOpening(id: string, body: { amount?: number; note?: string; clientId?: string; occurredAt?: string }, actor: Actor) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('ยอดยกมาต้องไม่ติดลบ');
    return businessTransaction(this.prisma, (tx) =>
      this.once(tx, body.clientId, { op: 'opening', id, amount }, async () => {
        const acc = await this.account(tx, id);
        if (acc.type === 'CASH_DRAWER') throw new BadRequestException('ลิ้นชักไม่ต้องตั้งยอดยกมา เงินตั้งต้นมาจากการเปิดกะ');
        if (await tx.moneyTransaction.findFirst({ where: { accountId: id, type: 'OPENING' } })) {
          throw new BadRequestException('บัญชีนี้ตั้งยอดยกมาแล้ว หากยอดไม่ตรงให้ใช้ "ปรับยอดตามจริง"');
        }
        const row = await ledger.post(tx, {
          accountId: id, direction: 'IN', amount: amount || 0.0, type: 'OPENING',
          note: body.note?.trim() || 'ยอดยกมา', userId: actor?.id,
          occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
        });
        if (!row) {
          // zero opening balance: still mark the account as started
          await tx.moneyTransaction.create({ data: { accountId: id, direction: 'IN', amount: 0, type: 'OPENING', note: 'ยอดยกมา 0 บาท', userId: actor?.id ?? null } });
        }
        return { success: true, balance: await ledger.balanceOf(tx, id) };
      }),
    );
  }

  /** Reconcile with reality (bank statement / counted cash): posts the difference as ADJUSTMENT. */
  async adjustToActual(id: string, body: { actualBalance?: number; reason?: string; clientId?: string }, actor: Actor) {
    const actual = Number(body.actualBalance);
    if (!Number.isFinite(actual)) throw new BadRequestException('กรุณาระบุยอดเงินจริง');
    const reason = String(body.reason || '').trim();
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลการปรับยอด');
    return businessTransaction(this.prisma, (tx) =>
      this.once(tx, body.clientId, { op: 'adjust', id, actual, reason }, async () => {
        const acc = await this.account(tx, id);
        if (acc.type === 'CASH_DRAWER') throw new BadRequestException('ยอดลิ้นชักปรับตอนปิดกะ (นับเงินจริง) เท่านั้น');
        const current = await ledger.balanceOf(tx, id);
        const diff = round2(actual - current);
        if (Math.abs(diff) >= 0.01) {
          await ledger.post(tx, { accountId: id, direction: diff > 0 ? 'IN' : 'OUT', amount: Math.abs(diff), type: 'ADJUSTMENT', note: reason, userId: actor?.id });
        }
        return { success: true, previousBalance: current, balance: actual, difference: diff };
      }),
    );
  }

  // ─── transfers: deposit cash, withdraw cash, exchange money, card payout ───
  async createTransfer(body: { clientId?: string; fromAccountId?: string; toAccountId?: string; amount?: number; note?: string; occurredAt?: string }, actor: Actor) {
    const amount = money(body.amount);
    return businessTransaction(this.prisma, (tx) =>
      this.once(tx, body.clientId, { op: 'transfer', from: body.fromAccountId, to: body.toAccountId, amount }, async () => {
        const from = await this.account(tx, String(body.fromAccountId));
        const to = await this.account(tx, String(body.toAccountId));
        const label = `${from.name} → ${to.name}`;
        const note = body.note?.trim() ? `${body.note.trim()} (${label})` : label;
        await this.mirrorDrawer(tx, from, 'OUT', amount, 'ย้ายเงินออก: ' + note);
        await this.mirrorDrawer(tx, to, 'IN', amount, 'ย้ายเงินเข้า: ' + note);
        const res = await ledger.transfer(tx, {
          fromAccountId: from.id, toAccountId: to.id, amount, note, userId: actor?.id, checkBalance: true,
          occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
        });
        return { success: true, transferGroupId: res.transferGroupId, amount, from: from.name, to: to.name };
      }),
    );
  }

  async cancelTransfer(groupId: string, body: { reason?: string }, actor: Actor) {
    return businessTransaction(this.prisma, async (tx) => {
      const rows = await tx.moneyTransaction.findMany({ where: { transferGroupId: groupId, type: 'TRANSFER' }, include: { account: true } });
      if (rows.length !== 2) throw new NotFoundException('ไม่พบรายการย้ายเงินนี้');
      if (rows.some((r) => r.refType)) throw new BadRequestException('รายการนี้ระบบสร้างจากการเปิด/ปิดกะ ยกเลิกเองไม่ได้');
      if (await tx.moneyTransaction.findFirst({ where: { reversalOfId: { in: rows.map((r) => r.id) } } })) throw new BadRequestException('รายการนี้ถูกยกเลิกไปแล้ว');
      const reason = 'ยกเลิกการย้ายเงิน' + (body.reason?.trim() ? `: ${body.reason.trim()}` : '');
      for (const r of rows) {
        // undoing an IN takes money out of that account again: it must still be there
        if (r.direction === 'IN') {
          const bal = await ledger.balanceOf(tx, r.accountId);
          if (bal + 0.001 < Number(r.amount)) throw new BadRequestException(`${r.account.name} มีเงินไม่พอให้ยกเลิก (คงเหลือ ฿${bal.toFixed(2)})`);
        }
        await this.mirrorDrawer(tx, r.account, r.direction === 'IN' ? 'OUT' : 'IN', Number(r.amount), reason);
        await tx.moneyTransaction.create({
          data: {
            accountId: r.accountId, direction: r.direction === 'IN' ? 'OUT' : 'IN', amount: r.amount, type: 'REVERSAL',
            transferGroupId: groupId, reversalOfId: r.id, note: reason, userId: actor?.id ?? null,
          },
        });
      }
      return { success: true };
    });
  }

  // ─── owner capital / drawings ───
  async ownerMoney(body: { clientId?: string; accountId?: string; kind?: string; amount?: number; note?: string }, actor: Actor) {
    const amount = money(body.amount);
    if (!['CAPITAL', 'DRAW'].includes(String(body.kind))) throw new BadRequestException('ประเภทต้องเป็น CAPITAL (นำเงินเข้า) หรือ DRAW (ถอนใช้)');
    return businessTransaction(this.prisma, (tx) =>
      this.once(tx, body.clientId, { op: 'owner', acc: body.accountId, kind: body.kind, amount }, async () => {
        const acc = await this.account(tx, String(body.accountId));
        const isDraw = body.kind === 'DRAW';
        if (isDraw) {
          const bal = await ledger.balanceOf(tx, acc.id);
          if (bal + 0.001 < amount) throw new BadRequestException(`ยอดเงินในบัญชีไม่พอ (คงเหลือ ฿${bal.toFixed(2)})`);
        }
        const note = body.note?.trim() || (isDraw ? 'เจ้าของถอนเงินใช้ส่วนตัว' : 'เจ้าของนำเงินเข้าร้าน');
        await this.mirrorDrawer(tx, acc, isDraw ? 'OUT' : 'IN', amount, note);
        const row = await ledger.post(tx, { accountId: acc.id, direction: isDraw ? 'OUT' : 'IN', amount, type: isDraw ? 'OWNER_DRAW' : 'OWNER_CAPITAL', note, userId: actor?.id });
        return { success: true, id: row!.id };
      }),
    );
  }

  // ─── expenses ───
  listCategories() {
    return this.prisma.expenseCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async createCategory(body: { name?: string }) {
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('กรุณาตั้งชื่อหมวด');
    if (await this.prisma.expenseCategory.findUnique({ where: { name } })) throw new BadRequestException('มีหมวดนี้อยู่แล้ว');
    const max = await this.prisma.expenseCategory.aggregate({ _max: { sortOrder: true } });
    return this.prisma.expenseCategory.create({ data: { name, sortOrder: (max._max.sortOrder || 0) + 1 } });
  }

  updateCategory(id: string, body: { name?: string; isActive?: boolean }) {
    return this.prisma.expenseCategory.update({
      where: { id },
      data: { ...(body.name?.trim() ? { name: body.name.trim() } : {}), ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}) },
    });
  }

  async listExpenses(q: { from?: string; to?: string; categoryId?: string; page?: string; limit?: string; includeCancelled?: string }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
    const where: any = {};
    if (q.includeCancelled !== 'true') where.status = 'ACTIVE';
    if (q.categoryId) where.categoryId = q.categoryId;
    const range = dateRangeFilter(q.from, q.to); // YYYY-MM-DD = whole Bangkok day
    if (range) where.paidAt = range;
    const [rows, total, sum] = await Promise.all([
      this.prisma.expense.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { paidAt: 'desc' },
        select: { id: true, expenseNumber: true, amount: true, paidAt: true, description: true, vendor: true, status: true, cancelReason: true, createdAt: true, category: { select: { id: true, name: true } }, account: { select: { id: true, name: true, type: true } }, receiptImage: false },
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { amount: true } }),
    ]);
    return { data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) }, summary: { totalAmount: Number(sum._sum.amount || 0) } };
  }

  async getExpense(id: string) {
    const row = await this.prisma.expense.findUnique({ where: { id }, include: { category: true, account: true } });
    if (!row) throw new NotFoundException('ไม่พบรายการค่าใช้จ่าย');
    return row;
  }

  async createExpense(body: { clientId?: string; categoryId?: string; accountId?: string; amount?: number; paidAt?: string; description?: string; vendor?: string; receiptImage?: string }, actor: Actor) {
    const amount = money(body.amount);
    const description = String(body.description || '').trim();
    if (!description) throw new BadRequestException('กรุณาระบุรายละเอียดค่าใช้จ่าย');
    if (body.receiptImage && body.receiptImage.length > 3_000_000) throw new BadRequestException('รูปใบเสร็จใหญ่เกินไป (ไม่เกินประมาณ 2MB)');
    const paidAt = body.paidAt ? parseDateParam(String(body.paidAt)) : undefined;
    // money leaves the account now, so the expense cannot be dated in the future (5 min clock tolerance)
    if (paidAt && paidAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('วันที่จ่ายค่าใช้จ่ายต้องไม่เป็นวันในอนาคต');
    return businessTransaction(this.prisma, (tx) =>
      this.once(tx, body.clientId, { op: 'expense', cat: body.categoryId, acc: body.accountId, amount, description }, async () => {
        const acc = await this.account(tx, String(body.accountId));
        const bal = await ledger.balanceOf(tx, acc.id);
        if (acc.type !== 'CARD_CLEARING' && bal + 0.001 < amount) {
          throw new BadRequestException(`ยอดเงินใน ${acc.name} ไม่พอ (คงเหลือ ฿${bal.toFixed(2)}) — ถ้ายังไม่ได้ตั้งยอดยกมา ให้ตั้งก่อน`);
        }
        const { expense } = await ledger.recordExpense(tx, {
          categoryId: String(body.categoryId), accountId: acc.id, amount, description,
          vendor: body.vendor, receiptImage: body.receiptImage, paidAt, userId: actor?.id,
        });
        const expenseNumber = expense.expenseNumber;
        await this.mirrorDrawer(tx, acc, 'OUT', amount, `ค่าใช้จ่าย ${expenseNumber}: ${description}`);
        return { success: true, id: expense.id, expenseNumber };
      }),
    );
  }

  async cancelExpense(id: string, body: { reason?: string }, actor: Actor) {
    const reason = String(body.reason || '').trim();
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลการยกเลิก');
    return businessTransaction(this.prisma, async (tx) => {
      const exp = await tx.expense.findUnique({ where: { id }, include: { account: true } });
      if (!exp) throw new NotFoundException('ไม่พบรายการค่าใช้จ่าย');
      if (exp.status === 'CANCELLED') return { success: true };
      await this.mirrorDrawer(tx, exp.account, 'IN', Number(exp.amount), `ยกเลิกค่าใช้จ่าย ${exp.expenseNumber}`);
      await ledger.reverseByRef(tx, 'EXPENSE', id, `ยกเลิกค่าใช้จ่าย ${exp.expenseNumber}: ${reason}`, actor?.id);
      await tx.expense.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      return { success: true };
    });
  }

  // ─── ledger listing & summary ───
  async listTransactions(q: { accountId?: string; type?: string; from?: string; to?: string; page?: string; limit?: string }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
    const where: any = {};
    if (q.accountId) where.accountId = q.accountId;
    if (q.type) where.type = q.type;
    const range = dateRangeFilter(q.from, q.to); // YYYY-MM-DD = whole Bangkok day
    if (range) where.occurredAt = range;
    const [rows, total] = await Promise.all([
      this.prisma.moneyTransaction.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        include: { account: { select: { id: true, name: true, type: true } }, category: { select: { id: true, name: true } } },
      }),
      this.prisma.moneyTransaction.count({ where }),
    ]);
    const reversedIds = new Set(
      (await this.prisma.moneyTransaction.findMany({ where: { reversalOfId: { in: rows.map((r) => r.id) } }, select: { reversalOfId: true } })).map((r) => r.reversalOfId),
    );
    return {
      data: rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        typeLabel: TYPE_LABELS[r.type] || r.type,
        isReversed: reversedIds.has(r.id),
        canCancel: !reversedIds.has(r.id) && ((r.type === 'TRANSFER' && !r.refType) || r.type === 'EXPENSE'),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Balances now + money in / out in a period, grouped by kind and expense category. */
  async summary(q: { from?: string; to?: string }) {
    const accounts = await this.listAccounts();
    // default: today (Bangkok); YYYY-MM-DD params cover the whole Bangkok day
    const range = dateRangeFilter(q.from || bangkokDayKey(new Date()), q.to) || {};
    const from = range.gte!;
    const toFilter = range.lt ? { lt: range.lt } : { lte: range.lte ?? new Date() };
    const to = range.lt ? new Date(range.lt.getTime() - 1) : toFilter.lte!;
    const rows = await this.prisma.moneyTransaction.findMany({
      where: { occurredAt: { gte: from, ...toFilter } },
      select: { direction: true, amount: true, type: true, occurredAt: true, transferGroupId: true, reversalOfId: true, category: { select: { name: true } }, account: { select: { type: true } } },
    });
    const inByType: Record<string, number> = {};
    const outByType: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};
    let totalIn = 0;
    let totalOut = 0;
    // A reversal cancels its original: net it against the original's kind instead of listing it separately
    const originals = await this.prisma.moneyTransaction.findMany({
      where: { id: { in: rows.filter((r) => r.type === 'REVERSAL' && r.reversalOfId).map((r) => r.reversalOfId as string) } },
      select: { id: true, type: true },
    });
    const originalType = new Map(originals.map((o) => [o.id, o.type]));
    const add = (bucket: Record<string, number>, key: string, v: number) => { bucket[key] = round2((bucket[key] || 0) + v); };
    const dayIn: Record<string, number> = {};
    const dayOut: Record<string, number> = {};
    const dayKey = (d: Date) => bangkokDayKey(d);
    for (const r of rows) {
      const amt = Number(r.amount);
      const kind = r.type === 'REVERSAL' ? originalType.get(r.reversalOfId || '') || 'REVERSAL' : r.type;
      // own-account moves and opening balances are neither income nor spending
      if (kind === 'TRANSFER' || kind === 'OPENING') continue;
      const label = TYPE_LABELS[kind] || kind;
      if (r.type === 'REVERSAL') {
        // reversal of an IN takes money out again -> reduce that income line (and vice versa)
        if (r.direction === 'OUT') { add(inByType, label, -amt); totalIn -= amt; add(dayIn, dayKey(r.occurredAt), -amt); }
        else { add(outByType, label, -amt); totalOut -= amt; add(dayOut, dayKey(r.occurredAt), -amt); }
        if (kind === 'EXPENSE') add(expenseByCategory, r.category?.name || 'อื่นๆ', -amt);
        continue;
      }
      if (r.direction === 'IN') { add(inByType, label, amt); totalIn += amt; add(dayIn, dayKey(r.occurredAt), amt); }
      else { add(outByType, label, amt); totalOut += amt; add(dayOut, dayKey(r.occurredAt), amt); }
      if (r.type === 'EXPENSE') add(expenseByCategory, r.category?.name || 'อื่นๆ', amt);
    }
    for (const bucket of [inByType, outByType, expenseByCategory]) {
      for (const k of Object.keys(bucket)) if (Math.abs(bucket[k]) < 0.005) delete bucket[k];
    }
    const sum = (types: string[]) => round2(accounts.filter((a) => types.includes(a.type) && a.isActive).reduce((s, a) => s + a.balance, 0));
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      balances: {
        cashInDrawers: sum(['CASH_DRAWER']),
        cashInSafe: sum(['CASH_SAFE']),
        bank: sum(['BANK']),
        cardPending: sum(['CARD_CLEARING']),
        total: sum(['CASH_DRAWER', 'CASH_SAFE', 'BANK', 'CARD_CLEARING']),
      },
      accounts,
      flow: { totalIn: round2(totalIn), totalOut: round2(totalOut), net: round2(totalIn - totalOut), inByType, outByType, expenseByCategory },
      daily: (() => {
        const days: { date: string; in: number; out: number; net: number }[] = [];
        let d = bangkokStartOfDay(from);
        while (d <= to && days.length < 92) {
          const k = dayKey(d);
          days.push({ date: k, in: dayIn[k] || 0, out: dayOut[k] || 0, net: round2((dayIn[k] || 0) - (dayOut[k] || 0)) });
          d = addDays(d, 1);
        }
        return days;
      })(),
    };
  }

  /**
   * What the store owes (received supplier bills, by due date) and is owed (customer debts, by aging).
   * Due date of a supplier bill: PO due date, else bill date + supplier credit terms (30 days default).
   */
  async overview() {
    const DAY = DAY_MS;
    const today = bangkokStartOfDay(); // Bangkok calendar, whatever the server TZ
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { status: { in: ['PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED'] }, remainingPayable: { gt: 0 } },
      select: {
        id: true, poNumber: true, supplierInvoiceNo: true, billDate: true, dueDate: true, totalAmount: true, paidAmount: true, remainingPayable: true,
        supplier: { select: { id: true, name: true, creditTerms: true } },
        items: { select: { receivedQty: true, unitCost: true, quantity: true, total: true } },
      },
    });
    const payItems = pos
      .map((po) => {
        const received = po.items.reduce((sum, i) => sum + Number(i.receivedQty) * grossPerUnit(i), 0);
        const amount = round2(Math.max(0, Math.min(Number(po.remainingPayable), received - Number(po.paidAmount))));
        const due = po.dueDate ?? new Date(po.billDate.getTime() + (po.supplier.creditTerms ?? 30) * DAY);
        const daysToDue = Math.floor((bangkokStartOfDay(due).getTime() - today.getTime()) / DAY);
        return { poId: po.id, poNumber: po.poNumber, invoiceNo: po.supplierInvoiceNo, supplierId: po.supplier.id, supplierName: po.supplier.name, amount, dueDate: due.toISOString(), daysToDue, dueDateSet: !!po.dueDate };
      })
      .filter((p) => p.amount > 0)
      .sort((a, b) => a.daysToDue - b.daysToDue);
    const sumWhere = (fn: (p: (typeof payItems)[number]) => boolean) => round2(payItems.filter(fn).reduce((s, p) => s + p.amount, 0));
    const payables = {
      total: sumWhere(() => true),
      overdue: sumWhere((p) => p.daysToDue < 0),
      dueToday: sumWhere((p) => p.daysToDue === 0),
      due7: sumWhere((p) => p.daysToDue >= 0 && p.daysToDue <= 7),
      due30: sumWhere((p) => p.daysToDue >= 0 && p.daysToDue <= 30),
      later: sumWhere((p) => p.daysToDue > 30),
      billCount: payItems.length,
      items: payItems.slice(0, 50),
    };

    const debts = await this.prisma.customerDebt.findMany({
      where: { remainingAmount: { gt: 0 } },
      select: { id: true, remainingAmount: true, dueDate: true, createdAt: true, customer: { select: { id: true, name: true, phone: true } }, order: { select: { orderNumber: true } } },
    });
    const buckets = { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    const byCustomer = new Map<string, { customerId: string; name: string; phone: string | null; total: number; overdue: number; bills: number; oldestDaysOverdue: number }>();
    for (const d of debts) {
      const amt = Number(d.remainingAmount);
      const due = d.dueDate ?? new Date(d.createdAt.getTime() + 30 * DAY);
      const overdueDays = Math.floor((today.getTime() - bangkokStartOfDay(due).getTime()) / DAY);
      if (overdueDays <= 0) buckets.notDue += amt;
      else if (overdueDays <= 30) buckets.d1_30 += amt;
      else if (overdueDays <= 60) buckets.d31_60 += amt;
      else if (overdueDays <= 90) buckets.d61_90 += amt;
      else buckets.d90plus += amt;
      const c = byCustomer.get(d.customer.id) || { customerId: d.customer.id, name: d.customer.name, phone: d.customer.phone, total: 0, overdue: 0, bills: 0, oldestDaysOverdue: 0 };
      c.total = round2(c.total + amt);
      if (overdueDays > 0) c.overdue = round2(c.overdue + amt);
      c.bills += 1;
      c.oldestDaysOverdue = Math.max(c.oldestDaysOverdue, overdueDays);
      byCustomer.set(d.customer.id, c);
    }
    for (const k of Object.keys(buckets) as (keyof typeof buckets)[]) buckets[k] = round2(buckets[k]);
    const customers = [...byCustomer.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
    const receivables = {
      total: round2(customers.reduce((s, c) => s + c.total, 0)),
      overdue: round2(customers.reduce((s, c) => s + c.overdue, 0)),
      debtorCount: customers.length,
      overdueDebtorCount: customers.filter((c) => c.overdue > 0).length,
      buckets,
      // buckets are by days OVERDUE (past the due date; no due date = bill date + 30 days),
      // not by bill age like the Reports "customers" tab
      agingBasis: 'DAYS_OVERDUE',
      agingBasisLabel: 'นับจากวันเลยกำหนดชำระ (ไม่มีกำหนด = 30 วันหลังวันบิล)',
      topDebtors: customers.slice(0, 20),
    };

    const accounts = await this.listAccounts();
    const cash = round2(accounts.filter((a) => a.isActive).reduce((s, a) => s + a.balance, 0));
    const recurring = await this.planning.recurringDueSummary(30);
    return {
      asOf: new Date().toISOString(),
      cash,
      payables,
      receivables,
      recurring,
      // money now + what customers owe - supplier bills and recurring expenses due within 30 days (incl. overdue)
      position30: round2(cash + receivables.total - payables.overdue - payables.due30 - recurring.overdue - recurring.dueWithin),
    };
  }
}
