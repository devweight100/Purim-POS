import { realtimeBus, RealtimeEvent } from '../events/events.service';
import { PrismaService } from './prisma.service';

/** Change events (round 2 follow-up): only writes that commit are announced, read-only commits announce nothing. */
describe('PrismaService change events', () => {
  let svc: PrismaService;
  let events: string[];
  let sub: { unsubscribe(): void };
  let logMax: bigint | null;
  const sql = (q: string) => (svc as unknown as { observeSql(q: string): void }).observeSql(q);
  const settle = () => new Promise((r) => setTimeout(r, 200));

  beforeEach(() => {
    svc = new PrismaService();
    logMax = null;
    (svc as unknown as { $queryRawUnsafe: () => Promise<unknown> }).$queryRawUnsafe = async () => [{ max: logMax }];
    events = [];
    sub = realtimeBus.subscribe((e: RealtimeEvent) => events.push(e.entity));
  });
  afterEach(() => sub.unsubscribe());

  it('a read-only transaction commits without any event', async () => {
    sql('BEGIN');
    sql('SELECT "public"."shifts"."id" FROM "public"."shifts"');
    sql('COMMIT');
    await settle();
    expect(events).toEqual([]);
  });

  it('writes in a transaction are announced once, at COMMIT; a later read-only commit sends nothing again', async () => {
    sql('BEGIN');
    sql('UPDATE "public"."customers" SET "name" = $1 WHERE "id" = $2');
    sql('INSERT INTO "public"."cash_movements" ("id") VALUES ($1)');
    await settle();
    expect(events).toEqual([]); // not before the commit
    sql('COMMIT');
    await settle();
    expect(events.sort()).toEqual(['customer', 'shift']);
    sql('BEGIN');
    sql('SELECT 1');
    sql('COMMIT');
    await settle();
    expect(events.length).toBe(2);
  });

  it('a rolled back transaction announces nothing', async () => {
    sql('BEGIN');
    sql('DELETE FROM "public"."customers" WHERE "id" = $1');
    sql('ROLLBACK');
    await settle();
    expect(events).toEqual([]);
  });

  it('a write outside a transaction is announced after a short debounce', async () => {
    sql('UPDATE "public"."suppliers" SET "name" = $1');
    await settle();
    expect(events).toEqual(['supplier']);
  });

  it('product events only when the change log (product_changes) got rows', async () => {
    logMax = 10n;
    sql('BEGIN');
    sql('UPDATE "public"."products" SET "name" = $1');
    sql('COMMIT');
    await settle();
    expect(events).toEqual(['product']);
    // same change-log head: e.g. a stock batch UPDATE that changed no quantity (trigger wrote nothing)
    sql('BEGIN');
    sql('UPDATE "public"."stock_batches" SET "unit_cost" = $1');
    sql('COMMIT');
    await settle();
    expect(events).toEqual(['product']);
  });

  it('TRUNCATE (reset database) announces the truncated entities', async () => {
    logMax = 5n;
    sql('BEGIN');
    sql('TRUNCATE TABLE "products", "customers", "audit_logs", "product_changes" RESTART IDENTITY CASCADE');
    logMax = null; // ids restart
    sql('COMMIT');
    await settle();
    expect(events.sort()).toEqual(['customer', 'product']);
  });
});
