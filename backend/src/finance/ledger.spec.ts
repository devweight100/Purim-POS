import { CORE_ACCOUNT_IDS, drawerAccount, ensureCoreAccounts, post, removeUnusedDuplicateCoreAccounts } from './ledger';

/** Tiny in-memory money_accounts table with a unique id / bankAccountId / terminalId, like Postgres. */
function fakeDb() {
  const rows: any[] = [];
  const unique = (r: any) => rows.some((x) => x.id === r.id || (r.bankAccountId && x.bankAccountId === r.bankAccountId) || (r.terminalId && x.terminalId === r.terminalId));
  let n = 0;
  const tick = () => new Promise((res) => setImmediate(res));
  return {
    rows,
    moneyAccount: {
      findFirst: async ({ where }: any) => { await tick(); return rows.find((r) => r.type === where.type) || null; },
      findUnique: async ({ where }: any) => rows.find((r) => (where.id && r.id === where.id) || (where.terminalId && r.terminalId === where.terminalId)) || null,
      findMany: async ({ where }: any) => rows.filter((r) => r.type === where.type && r.name === where.name),
      createMany: async ({ data, skipDuplicates }: any) => {
        await tick();
        let count = 0;
        for (const d of data) {
          const r = { id: d.id || `gen-${++n}`, ...d };
          if (unique(r)) { if (!skipDuplicates) throw Object.assign(new Error('P2002'), { code: 'P2002' }); continue; }
          rows.push(r); count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        const ids = new Set(where.id.in);
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i].id) && !rows[i].used) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
    bankAccount: { findMany: async () => [{ id: 'bank-1', bankName: 'KBANK', accountNumber: '1', moneyAccount: rows.find((r) => r.bankAccountId === 'bank-1') || null }] },
  };
}

describe('ledger core accounts', () => {
  it('parallel first loads create exactly one account per type and never throw', async () => {
    const db = fakeDb();
    await Promise.all(Array.from({ length: 8 }, () => ensureCoreAccounts(db)));
    expect(db.rows.filter((r) => r.type === 'CARD_CLEARING')).toHaveLength(1);
    expect(db.rows.filter((r) => r.type === 'CASH_SAFE')).toHaveLength(1);
    expect(db.rows.filter((r) => r.type === 'BANK')).toHaveLength(1);
    expect(db.rows.find((r) => r.type === 'CARD_CLEARING').id).toBe(CORE_ACCOUNT_IDS.CARD_CLEARING);
  });

  it('parallel first sales on a new terminal share one drawer', async () => {
    const db = fakeDb();
    const res = await Promise.all(Array.from({ length: 5 }, () => drawerAccount(db, 'T1')));
    expect(new Set(res.map((r: any) => r.id)).size).toBe(1);
    expect(db.rows).toHaveLength(1);
  });

  it('removes unused duplicates left by the old race, keeps the oldest and any account with money', async () => {
    const db = fakeDb();
    db.rows.push(
      { id: 'a', type: 'CARD_CLEARING', name: 'ยอดบัตรเครดิตรอเงินเข้า' },
      { id: 'b', type: 'CARD_CLEARING', name: 'ยอดบัตรเครดิตรอเงินเข้า' },
      { id: 'c', type: 'CARD_CLEARING', name: 'ยอดบัตรเครดิตรอเงินเข้า', used: true },
    );
    expect(await removeUnusedDuplicateCoreAccounts(db)).toBe(1);
    expect(db.rows.map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('ledger sale date', () => {
  const tx = (createdAt: Date, earlier: any = null) => {
    const created: any[] = [];
    return {
      created,
      order: { findUnique: async () => ({ createdAt }) },
      moneyTransaction: { findFirst: async () => earlier, create: async ({ data }: any) => (created.push(data), data) },
    };
  };
  const input = { accountId: 'acc', direction: 'IN' as const, amount: 25, type: 'SALE', refType: 'ORDER', refId: 'o1' };

  it('back-dated (offline) order: ledger row is dated at the bill date', async () => {
    const d = new Date('2026-11-04T05:00:00Z');
    const t = tx(d);
    await post(t, input);
    expect(t.created[0].occurredAt.toISOString()).toBe(d.toISOString());
  });
  it('re-posting after a payment change stays at now', async () => {
    const t = tx(new Date('2026-11-04T05:00:00Z'), { id: 'old' });
    await post(t, input);
    expect(Date.now() - t.created[0].occurredAt.getTime()).toBeLessThan(5000);
  });
});
