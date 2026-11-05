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

export async function post(tx: Tx, input: PostInput) {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return null; // nothing to record
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
      occurredAt: input.occurredAt ?? new Date(),
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

/** Make sure the safe, the card clearing account and one account per bank account exist. */
export async function ensureCoreAccounts(tx: Tx) {
  if (!(await tx.moneyAccount.findFirst({ where: { type: 'CASH_SAFE' } }))) {
    await tx.moneyAccount.create({ data: { name: 'เงินสดในเซฟ / สำนักงาน', type: 'CASH_SAFE', sortOrder: 10 } });
  }
  if (!(await tx.moneyAccount.findFirst({ where: { type: 'CARD_CLEARING' } }))) {
    await tx.moneyAccount.create({ data: { name: 'ยอดบัตรเครดิตรอเงินเข้า', type: 'CARD_CLEARING', sortOrder: 90 } });
  }
  const banks = await tx.bankAccount.findMany({ include: { moneyAccount: true } });
  for (const b of banks) {
    const label = `${b.bankName} ${b.accountNumber}`;
    if (!b.moneyAccount) {
      await tx.moneyAccount.create({ data: { name: label, type: 'BANK', bankAccountId: b.id, sortOrder: 20 } });
    }
  }
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
  return tx.moneyAccount.create({ data: { name, type: 'CASH_DRAWER', terminalId: key, sortOrder: 1 } });
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
  return tx.moneyAccount.create({ data: { name: 'บัญชีธนาคาร (ยังไม่ระบุ)', type: 'BANK', sortOrder: 29 } });
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
