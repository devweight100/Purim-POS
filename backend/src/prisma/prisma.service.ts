import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { realtimeBus, RealtimeEntity } from '../events/events.service';

// Table (@@map) name -> realtime entity. Unlisted tables (audit_logs) never emit.
const TABLE_ENTITY: Record<string, RealtimeEntity> = {
  users: 'user',
  shifts: 'shift',
  cash_movements: 'shift',
  categories: 'category',
  products: 'product',
  product_bundle_items: 'product',
  product_barcodes: 'product',
  product_packaging_units: 'product',
  product_images: 'product',
  product_wholesale_prices: 'product',
  product_suppliers: 'product',
  stock_batches: 'stock',
  suppliers: 'supplier',
  purchase_orders: 'purchaseOrder',
  purchase_order_items: 'purchaseOrder',
  payment_vouchers: 'payable',
  payment_voucher_items: 'payable',
  payment_voucher_debits: 'payable',
  supplier_return_notes: 'supplierReturn',
  customers: 'customer',
  customer_debts: 'debt',
  debt_payments: 'debt',
  orders: 'order',
  order_items: 'order',
  payments: 'order',
  customer_claims: 'claim',
  claim_inventory: 'claim',
  bank_accounts: 'bankAccount',
  store_settings: 'settings',
  // price level names (shown by the POS, docs/pos-keys-refresh.md)
  online_shop_config: 'settings',
  online_orders: 'onlineOrder',
  online_order_items: 'onlineOrder',
  line_link_requests: 'onlineOrder',
};

const WRITE_RE = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"[^"]+"\.)?"([^"]+)"/i;
const TRUNCATE_RE = /^\s*TRUNCATE\s+(?:TABLE\s+)?(.+)/i;
const FLUSH_DELAY_MS = 150;
// Longest interactive transaction (businessTransaction timeout is 5s): writes of a transaction whose COMMIT was
// never seen are sent after this anyway.
const TX_WINDOW_MS = 6000;
// Entities whose change log (product_changes, filled by database triggers) tells whether rows really changed.
const PRODUCT_LOGGED = new Set<RealtimeEntity>(['product', 'stock', 'category', 'supplier']);

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit
{
  /** open transactions (BEGIN seen, COMMIT / ROLLBACK not yet) */
  private openTx = 0;
  /** entities written inside the open transactions: sent when they commit */
  private txWrites = new Set<RealtimeEntity>();
  private txTimer?: ReturnType<typeof setTimeout>;
  private pending = new Set<RealtimeEntity>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  /** last product_changes id that was announced (null = not read yet) */
  private lastProductChange: bigint | null = null;
  /** a TRUNCATE emptied the change log: announce products whatever its head says */
  private truncated = false;

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    // Change detection: Prisma 6 has no $use; a client extension would replace
    // `this`. Instead observe the SQL actually executed (covers create/update/
    // delete/upsert/*Many, nested writes and interactive transactions).
    this.$on('query', (e) => this.observeSql(e.query));
  }

  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Writes outside a transaction are announced after a short debounce; writes inside one when it COMMITs
   * (round 2 follow-up: before, every COMMIT - also of read-only transactions such as GET /products/sync or
   * GET /shifts/current - re-announced everything written in the last 6 s, so clients that refresh on an
   * event kept refreshing). A ROLLBACK announces nothing.
   */
  private observeSql(sql: string) {
    if (/^\s*BEGIN\b/i.test(sql)) {
      this.openTx++;
      return;
    }
    if (/^\s*COMMIT\b/i.test(sql)) {
      this.openTx = Math.max(0, this.openTx - 1);
      for (const entity of this.txWrites) this.pending.add(entity);
      // other transactions still open may own some of these writes: they are sent again at their COMMIT
      if (this.openTx === 0) this.clearTxWrites();
      if (this.pending.size) void this.flush();
      return;
    }
    if (/^\s*ROLLBACK\b/i.test(sql)) {
      this.openTx = Math.max(0, this.openTx - 1);
      if (this.openTx === 0) this.clearTxWrites();
      return;
    }
    const entities: RealtimeEntity[] = [];
    const m = WRITE_RE.exec(sql);
    if (m) {
      const entity = TABLE_ENTITY[m[1]];
      if (entity) entities.push(entity);
    } else {
      // TRUNCATE (reset database): every listed table's entity changed
      const t = TRUNCATE_RE.exec(sql);
      if (t) {
        for (const name of t[1].matchAll(/"([^"]+)"/g)) {
          const entity = TABLE_ENTITY[name[1]];
          if (entity && !entities.includes(entity)) entities.push(entity);
        }
        if (entities.includes('product')) this.truncated = true;
      }
    }
    if (!entities.length) return;
    if (this.openTx > 0) {
      for (const entity of entities) this.txWrites.add(entity);
      // safety net: a COMMIT that never shows up (lost log line) must not hold the change back forever
      if (!this.txTimer) {
        this.txTimer = setTimeout(() => {
          this.txTimer = undefined;
          for (const entity of this.txWrites) this.pending.add(entity);
          this.txWrites.clear();
          this.openTx = 0;
          void this.flush();
        }, TX_WINDOW_MS);
      }
      return;
    }
    for (const entity of entities) this.pending.add(entity);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  private clearTxWrites() {
    this.txWrites.clear();
    if (this.txTimer) clearTimeout(this.txTimer);
    this.txTimer = undefined;
  }

  /** Has product_changes got new rows since the last announcement? (also true after a TRUNCATE: ids restart) */
  private async productLogMoved(): Promise<boolean> {
    if (this.truncated) {
      this.truncated = false;
      this.lastProductChange = null;
      return true;
    }
    try {
      const [row] = await this.$queryRawUnsafe<{ max: bigint | null }[]>('SELECT max(id) AS max FROM product_changes');
      const max = row?.max ?? null;
      const moved = max !== this.lastProductChange;
      this.lastProductChange = max;
      return moved;
    } catch {
      return true; // cannot tell: announce
    }
  }

  private async flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const entities = [...this.pending];
    this.pending.clear();
    if (!entities.length) return;
    // product rows: announced only when the database change log really got rows (an UPDATE that changed
    // nothing, a write to a product table that was rolled back by a trigger, etc. send nothing)
    const logged = entities.filter((e) => PRODUCT_LOGGED.has(e));
    const keepLogged = logged.length > 0 && (logged.some((e) => e !== 'product' && e !== 'stock') || (await this.productLogMoved()));
    const at = new Date().toISOString();
    for (const entity of entities) {
      if ((entity === 'product' || entity === 'stock') && !keepLogged) continue;
      realtimeBus.next({ entity, at });
    }
  }
}
