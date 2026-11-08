import { BadRequestException } from '@nestjs/common';
import { MoneyAccountType, MoneyDirection, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Money ledger helpers. Every function takes the caller's transaction client so the money
 * posting commits (or rolls back) together with the sale / payment / expense that caused it.
 *
 * Balance of an account = sum(IN) - sum(OUT) of its rows. Rows are never edited: a mistake is
 * undone with a REVERSAL row pointing at the original (reversalOfId).
 */
type Tx = Prisma.TransactionClient | any;

export const UNASSIGNED_TERMINAL = 'UNASSIGNED';

export interface PostInput {
  accountId: string;
  direction: MoneyDirection | 'IN' | 'OUT';
  amount: number;
  type: string;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  userId?: string | null;
  categoryId?: string | null;
  transferGroupId?: string | null;
  occurredAt?: Date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Date of a sale's ledger rows = the bill date. Offline bills synced later (back-dated createdAt) are
 * then on the same day in Finance as in the P&L. Only the first posting of an order is back-dated;
 * re-postings after a payment change (old rows reversed today) stay at "now".
 */
async function saleDate(tx: Tx, input: PostInput): Promise<Date | undefined> {
  if (input.occurredAt || input.type !== 'SALE' || input.refType !== 'ORDER' || !input.refId) return input.occurredAt;
  if (!tx?.order?.findUnique || !tx?.moneyTransaction?.findFirst) return undefined;
  const order = await tx.order.findUnique({ where: { id: input.refId }, select: { createdAt: true } });
  if (!order?.createdAt || Date.now() - new Date(order.createdAt).getTime() < 60_000) return undefined;
  const earlier = await tx.moneyTransaction.findFirst({ where: { refType: 'ORDER', refId: input.refId }, select: { id: true } });
  return earlier ? undefined : new Date(order.createdAt);
}

export async function post(tx: Tx, input: PostInput) {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return null; // nothing to record
  const occurredAt = await saleDate(tx, input);
  return tx.moneyTransaction.create({
    data: {
      accountId: input.accountId,
      direction: input.direction as MoneyDirection,
      amount,
      type: input.type,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      note: input.note ?? null,
      userId: input.userId ?? null,
      categoryId: input.categoryId ?? null,
      transferGroupId: input.transferGroupId ?? null,
      occurredAt: occurredAt ?? new Date(),
    },
  });
}

/** Create opposite rows for every not-yet-reversed row with this reference. */
export async function reverseByRef(
  tx: Tx,
  refType: string,
  refId: string,
  note: string,
  userId?: string | null,
  options: { skipAccountTypes?: MoneyAccountType[] } = {},
) {
  const rows = await tx.moneyTransaction.findMany({
    where: { refType, refId, type: { not: 'REVERSAL' } },
    include: { account: { select: { type: true } } },
  });
  const reversed = await tx.moneyTransaction.findMany({
    where: { reversalOfId: { in: rows.map((r: any) => r.id) } },
    select: { reversalOfId: true },
  });
  const done = new Set(reversed.map((r: any) => r.reversalOfId));
  const created: any[] = [];
  for (const row of rows) {
    if (done.has(row.id)) continue;
    if (options.skipAccountTypes?.includes(row.account.type)) continue;
    created.push(
      await tx.moneyTransaction.create({
        data: {
          accountId: row.accountId,
          direction: row.direction === 'IN' ? 'OUT' : 'IN',
          amount: row.amount,
          type: 'REVERSAL',
          refType: row.refType,
          refId: row.refId,
          categoryId: row.categoryId,
          transferGroupId: row.transferGroupId,
          reversalOfId: row.id,
          note,
          userId: userId ?? null,
        },
      }),
    );
  }
  return created;
}

export async function balanceOf(tx: Tx, accountId: string): Promise<number> {
  const rows = await tx.moneyTransaction.groupBy({
    by: ['direction'],
    where: { accountId },
    _sum: { amount: true },
  });
  let bal = 0;
  for (const r of rows) bal += (r.direction === 'IN' ? 1 : -1) * Number(r._sum.amount || 0);
  return round2(bal);
}

export async function balances(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx.moneyTransaction.groupBy({
    by: ['accountId', 'direction'],
    _sum: { amount: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.accountId, round2((map.get(r.accountId) || 0) + (r.direction === 'IN' ? 1 : -1) * Number(r._sum.amount || 0)));
  }
  return map;
}

/**
 * Fixed ids for the automatically created core accounts. Creation is INSERT ... ON CONFLICT DO NOTHING
 * on these ids (and on the unique bankAccountId / terminalId), so parallel first loads can never
 * create duplicates or fail with a unique-constraint 500.
 */
export const CORE_ACCOUNT_IDS = {
  CASH_SAFE: '00000000-0000-4000-8000-00000000c0a1',
  CARD_CLEARING: '00000000-0000-4000-8000-00000000c0a2',
  BANK_UNASSIGNED: '00000000-0000-4000-8000-00000000c0a3',
} as const;
export const CORE_ACCOUNT_DEFAULTS = {
  CASH_SAFE: { name: 'เงินสดในเซฟ / สำนักงาน', sortOrder: 10 },
  CARD_CLEARING: { name: 'ยอดบัตรเครดิตรอเงินเข้า', sortOrder: 90 },
} as const;

/** Make sure the safe, the card clearing account and one account per bank account exist (idempotent, race-safe). */
export async function ensureCoreAccounts(tx: Tx) {
  const create: any[] = [];
  for (const type of ['CASH_SAFE', 'CARD_CLEARING'] as const) {
    if (!(await tx.moneyAccount.findFirst({ where: { type }, select: { id: true } }))) {
      create.push({ id: CORE_ACCOUNT_IDS[type], type, ...CORE_ACCOUNT_DEFAULTS[type] });
    }
  }
  const banks = await tx.bankAccount.findMany({ include: { moneyAccount: true } });
  for (const b of banks) {
    if (!b.moneyAccount) create.push({ name: `${b.bankName} ${b.accountNumber}`, type: 'BANK', bankAccountId: b.id, sortOrder: 20 });
  }
  if (create.length) await tx.moneyAccount.createMany({ data: create, skipDuplicates: true });
}

/**
 * Clean up duplicates left by the old (racy) ensureCoreAccounts: extra auto-created safe / card
 * clearing accounts with the default name that were never used (no ledger row, expense, recurring
 * rule or reconciliation). The oldest one of each type is kept. Accounts with money are never touched.
 */
export async function removeUnusedDuplicateCoreAccounts(tx: Tx) {
  let removed = 0;
  for (const type of ['CASH_SAFE', 'CARD_CLEARING'] as const) {
    const rows = await tx.moneyAccount.findMany({ where: { type, name: CORE_ACCOUNT_DEFAULTS[type].name }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (rows.length < 2) continue;
    const res = await tx.moneyAccount.deleteMany({
      where: {
        id: { in: rows.slice(1).map((r: any) => r.id) },
        transactions: { none: {} }, expenses: { none: {} }, recurring: { none: {} }, reconciliations: { none: {} },
      },
    });
    removed += res.count;
  }
  return removed;
}

export async function safeAccount(tx: Tx) {
  await ensureCoreAccounts(tx);
  return tx.moneyAccount.findFirst({ where: { type: 'CASH_SAFE', isActive: true }, orderBy: { createdAt: 'asc' } });
}

export async function cardAccount(tx: Tx) {
  await ensureCoreAccounts(tx);
  return tx.moneyAccount.findFirst({ where: { type: 'CARD_CLEARING' }, orderBy: { createdAt: 'asc' } });
}

/** Cash drawer of a POS terminal (created on first use). */
export async function drawerAccount(tx: Tx, terminalId?: string | null) {
  const key = terminalId || UNASSIGNED_TERMINAL;
  const existing = await tx.moneyAccount.findUnique({ where: { terminalId: key } });
  if (existing) return existing;
  const name = key === UNASSIGNED_TERMINAL ? 'ลิ้นชักเงินสด (ไม่ระบุเครื่อง)' : `ลิ้นชักเงินสด เครื่อง ${key.slice(0, 6).toUpperCase()}`;
  // ON CONFLICT DO NOTHING on the unique terminalId: two first sales at once never fail
  await tx.moneyAccount.createMany({ data: [{ name, type: 'CASH_DRAWER', terminalId: key, sortOrder: 1 }], skipDuplicates: true });
  return tx.moneyAccount.findUnique({ where: { terminalId: key } });
}

/**
 * Money account of the bank that received a QR / transfer. Falls back to the default bank
 * account, then to a generic "unspecified bank" account so money is never lost from the books.
 */
export async function bankMoneyAccount(tx: Tx, bankAccountId?: string | null) {
  await ensureCoreAccounts(tx);
  if (bankAccountId) {
    const acc = await tx.moneyAccount.findUnique({ where: { bankAccountId } });
    if (acc) return acc;
  }
  const def = await tx.bankAccount.findFirst({ where: { isDefault: true }, include: { moneyAccount: true } });
  if (def?.moneyAccount) return def.moneyAccount;
  const anyBank = await tx.moneyAccount.findFirst({ where: { type: 'BANK', isActive: true }, orderBy: { createdAt: 'asc' } });
  if (anyBank) return anyBank;
  await tx.moneyAccount.createMany({ data: [{ id: CORE_ACCOUNT_IDS.BANK_UNASSIGNED, name: 'บัญชีธนาคาร (ยังไม่ระบุ)', type: 'BANK', sortOrder: 29 }], skipDuplicates: true });
  return tx.moneyAccount.findUnique({ where: { id: CORE_ACCOUNT_IDS.BANK_UNASSIGNED } });
}

/** Account where a payment method's money lands. Null = no money moves (credit sale, credit note). */
export async function accountForPaymentMethod(tx: Tx, method: string, opts: { terminalId?: string | null; bankAccountId?: string | null; cashTo?: 'DRAWER' | 'SAFE' }) {
  if (method === 'CASH') return opts.cashTo === 'SAFE' ? safeAccount(tx) : drawerAccount(tx, opts.terminalId);
  if (method === 'QR_PROMPTPAY' || method === 'TRANSFER') return bankMoneyAccount(tx, opts.bankAccountId);
  if (method === 'CREDIT_CARD') return cardAccount(tx);
  return null;
}

/** Move money between two accounts as one transfer (two linked rows). */
export async function transfer(
  tx: Tx,
  input: { fromAccountId: string; toAccountId: string; amount: number; note?: string | null; userId?: string | null; refType?: string | null; refId?: string | null; checkBalance?: boolean; occurredAt?: Date },
) {
  if (input.fromAccountId === input.toAccountId) throw new BadRequestException('บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน');
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
  if (input.checkBalance) {
    const bal = await balanceOf(tx, input.fromAccountId);
    if (bal + 0.001 < amount) throw new BadRequestException(`ยอดเงินในบัญชีต้นทางไม่พอ (คงเหลือ ฿${bal.toFixed(2)})`);
  }
  const groupId = randomUUID();
  const base = { amount, type: 'TRANSFER', note: input.note ?? null, userId: input.userId ?? null, transferGroupId: groupId, refType: input.refType ?? null, refId: input.refId ?? null, occurredAt: input.occurredAt };
  const out = await post(tx, { ...base, accountId: input.fromAccountId, direction: 'OUT' });
  const inn = await post(tx, { ...base, accountId: input.toAccountId, direction: 'IN' });
  return { transferGroupId: groupId, out, in: inn };
}

/** Create an expense document and its ledger row (caller handles drawer/shift bookkeeping). */
export async function recordExpense(
  tx: Tx,
  input: { categoryId: string; accountId: string; amount: number; description: string; vendor?: string | null; receiptImage?: string | null; paidAt?: Date; userId?: string | null },
) {
  const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || !category.isActive) throw new BadRequestException('กรุณาเลือกหมวดค่าใช้จ่าย');
  const description = String(input.description || '').trim();
  if (!description) throw new BadRequestException('กรุณาระบุรายละเอียดค่าใช้จ่าย');
  const now = new Date();
  const prefix = `EXP-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const last = await tx.expense.findFirst({ where: { expenseNumber: { startsWith: prefix } }, orderBy: { expenseNumber: 'desc' } });
  const expenseNumber = prefix + String((Number(last?.expenseNumber.slice(prefix.length)) || 0) + 1).padStart(5, '0');
  const amount = round2(Number(input.amount));
  const expense = await tx.expense.create({
    data: {
      expenseNumber, categoryId: category.id, accountId: input.accountId, amount, description,
      vendor: input.vendor?.trim() || null, receiptImage: input.receiptImage || null,
      paidAt: input.paidAt ?? now, userId: input.userId ?? null,
    },
  });
  await post(tx, {
    accountId: input.accountId, direction: 'OUT', amount, type: 'EXPENSE', categoryId: category.id,
    refType: 'EXPENSE', refId: expense.id, note: `${category.name}: ${description}`, userId: input.userId, occurredAt: expense.paidAt,
  });
  return { expense, category };
}
