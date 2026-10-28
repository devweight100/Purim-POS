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
};

const WRITE_RE = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"[^"]+"\.)?"([^"]+)"/i;
const FLUSH_DELAY_MS = 150;
// Longest interactive transaction (businessTransaction timeout is 5s).
const TX_WINDOW_MS = 6000;

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit
{
  private recentWrites = new Map<RealtimeEntity, number>();
  private pending = new Set<RealtimeEntity>();
  private flushTimer?: ReturnType<typeof setTimeout>;

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

  private observeSql(sql: string) {
    const m = WRITE_RE.exec(sql);
    if (m) {
      const entity = TABLE_ENTITY[m[1]];
      if (!entity) return;
      this.recentWrites.set(entity, Date.now());
      this.pending.add(entity);
      // Autocommit writes (and a safety net for tx) flush after a short debounce.
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
      return;
    }
    if (/^\s*COMMIT\b/i.test(sql)) {
      // Transaction committed: re-emit every entity written inside the window so
      // clients that refetched on the early debounce get the committed state.
      const now = Date.now();
      for (const [entity, t] of this.recentWrites) {
        if (now - t <= TX_WINDOW_MS) this.pending.add(entity);
        else this.recentWrites.delete(entity);
      }
      this.flush();
    }
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const at = new Date().toISOString();
    for (const entity of this.pending) realtimeBus.next({ entity, at });
    this.pending.clear();
  }
}
