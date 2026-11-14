/**
 * The Reports page figures computed IN PostgreSQL (GROUP BY / SUM), so a period of any length costs a
 * few aggregate queries and a bounded number of rows in Node - never "load every bill and add it up".
 *
 * The rules are the ones of report-tabs.ts (the readable JS specification, still used by the parity
 * tests through test/legacy) and sales-math.ts:
 * - a bill counts when it is not VOIDED / REFUNDED and its createdAt is in the period
 * - a partial return reduces sales, VAT, COGS, quantities and payment channels in the period the
 *   RETURN was made (whatever the bill date); returns of voided bills are ignored
 * - gross = qty x unit price before discounts; discounts = gross - bill total (line + bill discounts)
 * - best sellers: revenue of a line = line total x (bill total / bill subtotal) = bill-discount share
 * - COGS = the cost recorded on the bill (orders.total_cogs, order_items.unit_cost)
 * - payments: CREDIT_DEBT / DEBT_REDUCTION -> credit channel, CREDIT_NOTE -> store credit,
 *   QR_PROMPTPAY + TRANSFER -> one channel; a bill without payment rows counts as cash
 * - days are Bangkok calendar days (`AT TIME ZONE 'Asia/Bangkok'`)
 *
 * Arithmetic on money columns that the JS version did in floating point (qty x price, total x factor)
 * is done in float8 here too, so a figure is rounded from the same value.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2n as round2 } from '../../../shared/src/money';
import { DateRange, sqlRange } from './sales-math';

type Db = { $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T> };

// ─── safety net ───
/** Most rows one report query may bring into Node (REPORT_MAX_ROWS to override). */
export const REPORT_MAX_ROWS = (() => {
  const n = parseInt(process.env.REPORT_MAX_ROWS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 50000;
})();
/** Most bills (with lines, payments, returns) the legacy /reports/analytics download may load. */
export const ANALYTICS_MAX_ORDERS = 5000;

export function assertRowLimit(count: number, what: string, max = REPORT_MAX_ROWS) {
  if (count > max) {
    throw new BadRequestException(`ข้อมูล${what}มีมากเกินไป (เกิน ${max.toLocaleString('en-US')} แถว) กรุณาเลือกช่วงเวลาให้สั้นลง`);
  }
}

// ─── paging of the long lists ───
export const REPORT_PAGE_DEFAULT = 50;
export const REPORT_PAGE_MAX = 500;
export interface ListQuery { page: number; limit: number; q: string; sort: string; list: string }

export function parseListQuery(q: { page?: string; limit?: string; q?: string; sort?: string; list?: string }): ListQuery {
  const int = (v: string | undefined, name: string, def: number, max: number) => {
    if (v === undefined || v === '') return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${name} ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`);
    return Math.min(n, max);
  };
  return {
    page: int(q.page, 'page', 1, 1_000_000),
    limit: int(q.limit, 'limit', REPORT_PAGE_DEFAULT, REPORT_PAGE_MAX),
    q: String(q.q ?? '').trim().slice(0, 100),
    sort: String(q.sort ?? '').trim(),
    list: String(q.list ?? '').trim(),
  };
}

const NOT_VOID = Prisma.sql`o.status NOT IN ('VOIDED', 'REFUNDED')`;
/** YYYY-MM-DD of the Bangkok day of a UTC `timestamp` column. */
const bkkDay = (col: Prisma.Sql) => Prisma.sql`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')`;
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const num = (v: unknown) => Number(v) || 0;
const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
/** A JSON value read as JS `Number(v) || 0` would (numbers and numeric strings; anything else 0). */
const jsonNum = (v: Prisma.Sql) => Prisma.sql`(CASE
  WHEN jsonb_typeof(${v}) = 'number' THEN (${v} #>> '{}')::float8
  WHEN jsonb_typeof(${v}) = 'string' AND btrim(${v} #>> '{}') ~ '^[-+]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][-+]?[0-9]+)?$' THEN btrim(${v} #>> '{}')::float8
  ELSE 0 END)`;

// ─── 1. Sales & gross profit per Bangkok day + output VAT card ───
export async function salesTabSql(db: Db, range: DateRange) {
  const [orderDays, returnDays] = await Promise.all([
    db.$queryRaw<{ d: string; n: number; gross: number; disc: number; net: number; cogs: number; vat: number; vat_sales: number }[]>(Prisma.sql`
      SELECT x.d, COUNT(*)::int AS n, SUM(x.gross)::float8 AS gross, SUM(x.gross - x.total)::float8 AS disc,
             SUM(x.total)::float8 AS net, SUM(x.cogs)::float8 AS cogs, SUM(x.vat)::float8 AS vat,
             COALESCE(SUM(x.total) FILTER (WHERE x.vat > 0), 0)::float8 AS vat_sales
      FROM (
        SELECT ${bkkDay(Prisma.sql`o.created_at`)} AS d, o.total_amount::float8 AS total, o.total_cogs::float8 AS cogs, o.vat_amount::float8 AS vat,
               CASE WHEN COALESCE(l.list, 0) > 0 THEN l.list ELSE o.total_amount::float8 + o.discount_amount::float8 END AS gross
        FROM orders o
        LEFT JOIN (
          SELECT oi.order_id, SUM(oi.quantity::float8 * oi.unit_price::float8) AS list
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE ${NOT_VOID} ${sqlRange(Prisma.sql`o.created_at`, range)}
          GROUP BY oi.order_id) l ON l.order_id = o.id
        WHERE ${NOT_VOID} ${sqlRange(Prisma.sql`o.created_at`, range)}) x
      GROUP BY x.d
      LIMIT ${REPORT_MAX_ROWS + 1}`),
    db.$queryRaw<{ d: string; amount: number; cogs: number; list_back: number; vat: number; vat_sales: number }[]>(Prisma.sql`
      SELECT ${bkkDay(Prisma.sql`r.created_at`)} AS d, SUM(r.refund_amount)::float8 AS amount, SUM(r.cogs_returned)::float8 AS cogs,
             SUM(CASE WHEN ri.n = 0 THEN r.refund_amount::float8 ELSE ri.list END)::float8 AS list_back,
             COALESCE(SUM(r.vat_amount) FILTER (WHERE o.vat_amount > 0 OR r.vat_amount > 0), 0)::float8 AS vat,
             COALESCE(SUM(r.refund_amount) FILTER (WHERE o.vat_amount > 0 OR r.vat_amount > 0), 0)::float8 AS vat_sales
      FROM order_returns r
      JOIN orders o ON o.id = r.order_id AND ${NOT_VOID}
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS n, COALESCE(SUM(i.quantity::float8 * COALESCE(oi.unit_price::float8, 0)), 0) AS list
        FROM order_return_items i LEFT JOIN order_items oi ON oi.id = i.order_item_id AND oi.order_id = r.order_id
        WHERE i.return_id = r.id) ri
      WHERE true ${sqlRange(Prisma.sql`r.created_at`, range)}
      GROUP BY 1
      LIMIT ${REPORT_MAX_ROWS + 1}`),
  ]);
  assertRowLimit(Math.max(orderDays.length, returnDays.length), 'ยอดขายรายวัน');

  const days = new Map<string, { date: string; orderCount: number; grossSales: number; discounts: number; netSales: number; cogs: number; grossProfit: number; profitMarginPercent: number }>();
  const day = (key: string) => {
    let row = days.get(key);
    if (!row) days.set(key, (row = { date: key, orderCount: 0, grossSales: 0, discounts: 0, netSales: 0, cogs: 0, grossProfit: 0, profitMarginPercent: 0 }));
    return row;
  };
  let totalOrders = 0;
  let vatAmount = 0;
  let vatSales = 0;
  for (const o of orderDays) {
    const row = day(o.d);
    row.orderCount += num(o.n);
    row.grossSales += num(o.gross);
    row.discounts += num(o.disc);
    row.netSales += num(o.net);
    row.cogs += num(o.cogs);
    totalOrders += num(o.n);
    vatAmount += num(o.vat);
    vatSales += num(o.vat_sales);
  }
  let totalReturns = 0;
  for (const r of returnDays) {
    const row = day(r.d);
    row.grossSales -= num(r.list_back);
    row.discounts -= num(r.list_back) - num(r.amount);
    row.netSales -= num(r.amount);
    row.cogs -= num(r.cogs);
    totalReturns += num(r.amount);
    vatAmount -= num(r.vat);
    vatSales -= num(r.vat_sales);
  }
  let totalGrossSales = 0;
  let totalDiscounts = 0;
  let totalNetSales = 0;
  let totalCogs = 0;
  for (const row of days.values()) {
    row.grossSales = round2(row.grossSales);
    row.discounts = round2(row.discounts);
    row.netSales = round2(row.netSales);
    row.cogs = round2(row.cogs);
    row.grossProfit = round2(row.netSales - row.cogs);
    row.profitMarginPercent = pct1(row.grossProfit, row.netSales);
    totalGrossSales += row.grossSales;
    totalDiscounts += row.discounts;
    totalNetSales += row.netSales;
    totalCogs += row.cogs;
  }
  totalNetSales = round2(totalNetSales);
  totalCogs = round2(totalCogs);
  const totalGrossProfit = round2(totalNetSales - totalCogs);
  vatAmount = round2(vatAmount);
  vatSales = round2(vatSales);
  return {
    sales: {
      totalOrders,
      totalGrossSales: round2(totalGrossSales),
      totalDiscounts: round2(totalDiscounts),
      totalNetSales,
      totalReturns: round2(totalReturns),
      totalCogs,
      totalGrossProfit,
      overallMargin: pct1(totalGrossProfit, totalNetSales),
      dailyBreakdown: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
    },
    vat: { vatAmount, vatSales, vatBase: round2(vatSales - vatAmount) },
  };
}

// ─── claim accounting (Sales tab card and P&L) ───
/**
 * Replacement goods handed out + refunds paid for claims created in the period, and the value recovered
 * from suppliers (DEFECTIVE lines of return notes that are not cancelled). `eventsOnly`: the Reports
 * page only counts claims with a positive replacement cost or refund (the P&L adds every claim).
 */
export async function claimAccountingSql(db: Db, range: DateRange, eventsOnly: boolean) {
  const rc = jsonNum(Prisma.sql`(c.metadata::jsonb #> '{accounting,replacementCost}')`);
  const rp = jsonNum(Prisma.sql`(c.metadata::jsonb #> '{accounting,refundPaid}')`);
  const [claims, recovered] = await Promise.all([
    db.$queryRaw<{ rc: number; rp: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM(x.rc), 0)::float8 AS rc, COALESCE(SUM(x.rp), 0)::float8 AS rp
      FROM (SELECT ${rc} AS rc, ${rp} AS rp FROM customer_claims c WHERE true ${sqlRange(Prisma.sql`c.created_at`, range)}) x
      ${eventsOnly ? Prisma.sql`WHERE x.rc > 0 OR x.rp > 0` : Prisma.empty}`),
    db.$queryRaw<{ amount: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM(i.total), 0)::float8 AS amount
      FROM supplier_return_note_items i JOIN supplier_return_notes n ON n.id = i.note_id
      WHERE i.item_type = 'DEFECTIVE' AND n.status::text <> 'CANCELLED' ${sqlRange(Prisma.sql`n.created_at`, range)}`),
  ]);
  return { replacementCost: num(claims[0]?.rc), refundsPaid: num(claims[0]?.rp), supplierRecovery: num(recovered[0]?.amount) };
}

// ─── 2. Best sellers ───
const BEST_SORTS: Record<string, Prisma.Sql> = {
  quantity: Prisma.sql`qty DESC`,
  revenue: Prisma.sql`rev2 DESC`,
  profit: Prisma.sql`(rev2 - cost2) DESC`,
};

export async function bestSellersSql(db: Db, range: DateRange, lq: ListQuery) {
  const sort = lq.sort || 'quantity';
  if (!BEST_SORTS[sort]) throw new BadRequestException(`sort ไม่ถูกต้อง (${Object.keys(BEST_SORTS).join(', ')})`);
  const tie = Prisma.sql`last_at DESC NULLS LAST, name, id`;
  const search = lq.q
    ? Prisma.sql`WHERE (name ILIKE ${likePattern(lq.q)} OR sku ILIKE ${likePattern(lq.q)} OR category ILIKE ${likePattern(lq.q)})`
    : Prisma.empty;
  const cols = Prisma.sql`id, name, sku, category, unit, qty, revenue, cost, last_at, rev2, cost2`;
  const rows = await db.$queryRaw<any[]>(Prisma.sql`
    WITH sold AS MATERIALIZED (
      SELECT oi.product_id, SUM(COALESCE(oi.base_quantity, oi.quantity)) AS qty,
             SUM(oi.total::float8 * CASE WHEN o.subtotal > 0 THEN o.total_amount::float8 / o.subtotal::float8 ELSE 1 END) AS revenue,
             SUM(oi.unit_cost::float8 * COALESCE(oi.base_quantity, oi.quantity)::float8) AS cost,
             MAX(o.created_at) AS last_at
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${NOT_VOID} ${sqlRange(Prisma.sql`o.created_at`, range)}
      GROUP BY oi.product_id),
    back AS MATERIALIZED (
      SELECT ri.product_id, SUM(ri.base_quantity) AS qty, SUM(ri.refund_amount) AS revenue,
             SUM(CASE WHEN ri.restock THEN ri.unit_cost::float8 * ri.base_quantity::float8 ELSE 0 END) AS cost
      FROM order_return_items ri
      JOIN order_returns r ON r.id = ri.return_id
      JOIN orders o ON o.id = r.order_id AND ${NOT_VOID}
      WHERE true ${sqlRange(Prisma.sql`r.created_at`, range)}
      GROUP BY ri.product_id),
    r AS MATERIALIZED (
      -- FULL JOIN (not a UNION of ids + 2 LEFT JOINs): keeps the row estimate right, so PostgreSQL does not
      -- pick JIT compilation (which alone cost ~1.5 s here)
      SELECT COALESCE(s.product_id, b.product_id) AS id, COALESCE(NULLIF(p.name, ''), 'สินค้า') AS name, COALESCE(NULLIF(p.sku, ''), 'SKU') AS sku,
             COALESCE(NULLIF(c.name, ''), 'ทั่วไป') AS category, NULLIF(p.unit, '') AS unit,
             (COALESCE(s.qty, 0) - COALESCE(b.qty, 0))::float8 AS qty,
             (COALESCE(s.revenue, 0) - COALESCE(b.revenue, 0)::float8)::float8 AS revenue,
             (COALESCE(s.cost, 0) - COALESCE(b.cost, 0))::float8 AS cost,
             s.last_at
      FROM sold s
      FULL JOIN back b ON b.product_id = s.product_id
      LEFT JOIN products p ON p.id = COALESCE(s.product_id, b.product_id)
      LEFT JOIN categories c ON c.id = p.category_id),
    r2 AS MATERIALIZED (SELECT r.*, round(r.revenue::numeric, 2) AS rev2, round(r.cost::numeric, 2) AS cost2 FROM r)
    SELECT x.*, u.unit_name
    FROM (
      (SELECT 'page' AS k, row_number() OVER (ORDER BY ${BEST_SORTS[sort]}, ${tie}) AS ord, 0::bigint AS n, ${cols} FROM r2 ${search}
        ORDER BY ord LIMIT ${lq.limit} OFFSET ${(lq.page - 1) * lq.limit})
      UNION ALL (SELECT 'quantity', row_number() OVER (ORDER BY ${BEST_SORTS.quantity}, ${tie}) AS ord, 0, ${cols} FROM r2 ORDER BY ord LIMIT 15)
      UNION ALL (SELECT 'profit', row_number() OVER (ORDER BY ${BEST_SORTS.profit}, ${tie}) AS ord, 0, ${cols} FROM r2 ORDER BY ord LIMIT 15)
      UNION ALL (SELECT 'revenue', row_number() OVER (ORDER BY ${BEST_SORTS.revenue}, ${tie}) AS ord, 0, ${cols} FROM r2 ORDER BY ord LIMIT 15)
      UNION ALL (SELECT 'totals', 0, COUNT(*), NULL, NULL, NULL, NULL, NULL, COALESCE(SUM(qty), 0), COALESCE(SUM(rev2), 0)::float8, COALESCE(SUM(cost2), 0)::float8, NULL, NULL, NULL FROM r2)
      UNION ALL (SELECT 'matched', 0, COUNT(*), NULL, NULL, NULL, NULL, NULL, 0, 0, 0, NULL, NULL, NULL FROM r2 ${search})
    ) x
    LEFT JOIN LATERAL (
      SELECT NULLIF(oi.unit_name, '') AS unit_name
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = x.id AND ${NOT_VOID} ${sqlRange(Prisma.sql`o.created_at`, range)}
      ORDER BY o.created_at DESC, oi.id LIMIT 1) u ON x.id IS NOT NULL`);

  const toRow = (r: any) => {
    const totalRevenue = round2(r.revenue);
    const totalCost = round2(r.cost);
    const totalProfit = round2(totalRevenue - totalCost);
    return {
      id: r.id, name: r.name, sku: r.sku, category: r.category, unitName: r.unit_name || r.unit || 'ชิ้น',
      quantitySold: num(r.qty), totalRevenue, totalCost, totalProfit, profitMarginPercent: pct1(totalProfit, totalRevenue),
    };
  };
  const pick = (k: string) => rows.filter((r) => r.k === k).sort((a, b) => Number(a.ord) - Number(b.ord)).map(toRow);
  const totals = rows.find((r) => r.k === 'totals');
  const revenue = round2(totals?.revenue);
  const cost = round2(totals?.cost);
  return {
    // the page of the list asked for (sort, q, page, limit); totals cover every product of the period
    allProducts: pick('page'),
    total: num(rows.find((r) => r.k === 'matched')?.n),
    page: lq.page,
    limit: lq.limit,
    sort,
    productCount: num(totals?.n),
    totals: { quantity: num(totals?.qty), revenue, cost, profit: round2(revenue - cost) },
    topByQuantity: pick('quantity'),
    topByProfit: pick('profit'),
    topByRevenue: pick('revenue'),
  };
}

// ─── 3. Inventory valuation, low stock, deadstock ───
export const DEADSTOCK_DAYS = 30;
const INVENTORY_LISTS = ['all', 'deadstock', 'lowstock'] as const;

/** Per product (bundles excluded): stock, FIFO cost value, retail value, days since last sale / receipt. */
function inventoryCte(nowIso: string, threshold: number, canSeeCost: boolean) {
  const days = (col: Prisma.Sql) =>
    Prisma.sql`CASE WHEN ${col} IS NULL THEN 999 ELSE floor(extract(epoch FROM (${nowIso}::timestamp - ${col})) / 86400)::int END`;
  return Prisma.sql`
    st AS (
      SELECT b.product_id, SUM(b.quantity_remaining) AS net,
             SUM(b.quantity_remaining::float8) FILTER (WHERE b.quantity_remaining > 0) AS pos_qty,
             SUM(b.quantity_remaining::float8 * b.unit_cost::float8) FILTER (WHERE b.quantity_remaining > 0) AS pos_val
      FROM stock_batches b WHERE b.quantity_remaining <> 0 GROUP BY b.product_id),
    recv AS (SELECT b.product_id, MAX(b.received_at) AS last FROM stock_batches b WHERE b.quantity_received > 0 GROUP BY b.product_id),
    sale AS (
      SELECT oi.product_id, MAX(o.created_at) AS last
      FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${NOT_VOID} GROUP BY oi.product_id),
    base AS (
      SELECT p.id, COALESCE(NULLIF(p.name, ''), 'สินค้า') AS name, COALESCE(NULLIF(p.sku, ''), 'SKU') AS sku,
             COALESCE(NULLIF(c.name, ''), 'ทั่วไป') AS category, COALESCE(NULLIF(p.unit, ''), 'ชิ้น') AS unit,
             GREATEST(0, COALESCE(st.net, 0))::float8 AS stock,
             ${canSeeCost ? Prisma.sql`p.cost_price::float8` : Prisma.sql`0::float8`} AS fallback,
             -- price level 1 when set (also when 0: the old code read the Decimal / string, which is truthy), else base price
             COALESCE(p.price_level_1, p.base_price, 0)::float8 AS retail,
             CASE WHEN COALESCE(st.pos_qty, 0) > 0 THEN st.pos_val / st.pos_qty ELSE 0 END AS avg_cost,
             ${days(Prisma.sql`sale.last`)} AS days_sale, ${days(Prisma.sql`recv.last`)} AS days_recv
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN st ON st.product_id = p.id
      LEFT JOIN recv ON recv.product_id = p.id
      LEFT JOIN sale ON sale.product_id = p.id
      WHERE NOT p.is_bundle),
    costed AS (
      SELECT b.*, CASE WHEN b.stock > 0 THEN (CASE WHEN b.stock * b.avg_cost > 0 THEN b.stock * b.avg_cost ELSE b.stock * b.fallback END) ELSE 0 END AS cost_val
      FROM base b),
    inv AS MATERIALIZED (
      SELECT c.*, c.stock * c.retail AS retail_val,
             CASE WHEN c.stock > 0 THEN c.cost_val / c.stock ELSE c.fallback END AS cost,
             (c.stock > 0 AND c.days_sale >= ${DEADSTOCK_DAYS} AND c.days_recv >= ${DEADSTOCK_DAYS}) AS dead,
             (c.stock <= ${threshold}::float8) AS low
      FROM costed c)`;
}

export async function inventoryTabSql(db: Db, opts: { threshold: number; canSeeCost: boolean; now: number }, lq: ListQuery) {
  const list = (lq.list || 'all') as (typeof INVENTORY_LISTS)[number];
  if (!INVENTORY_LISTS.includes(list)) throw new BadRequestException(`list ไม่ถูกต้อง (${INVENTORY_LISTS.join(', ')})`);
  const conds: Prisma.Sql[] = [];
  if (list === 'deadstock') conds.push(Prisma.sql`dead`);
  if (list === 'lowstock') conds.push(Prisma.sql`low`);
  // every row's supplier column reads 'ทั่วไป' (as before), so a search inside that word matches all rows
  if (lq.q && !'ทั่วไป'.includes(lq.q.toLowerCase())) {
    conds.push(Prisma.sql`(name ILIKE ${likePattern(lq.q)} OR sku ILIKE ${likePattern(lq.q)} OR category ILIKE ${likePattern(lq.q)})`);
  }
  const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
  const order = list === 'lowstock' ? Prisma.sql`stock ASC, name, id` : Prisma.sql`cost_val DESC, name, id`;
  const rows = await db.$queryRaw<any[]>(Prisma.sql`
    WITH ${inventoryCte(new Date(opts.now).toISOString(), opts.threshold, opts.canSeeCost)}
    (SELECT 'page' AS k, row_number() OVER (ORDER BY ${order}) AS ord, id, name, sku, category, unit, stock, cost, retail, cost_val, retail_val, days_sale, days_recv, dead, low,
            0::bigint AS n, 0::bigint AS n_dead, 0::bigint AS n_low, 0::float8 AS dead_stock, 0::float8 AS dead_cost
     FROM inv ${where} ORDER BY ord LIMIT ${lq.limit} OFFSET ${(lq.page - 1) * lq.limit})
    UNION ALL
    (SELECT 'totals', 0, NULL, NULL, NULL, NULL, NULL, COALESCE(SUM(stock), 0), NULL, NULL, COALESCE(SUM(cost_val), 0), COALESCE(SUM(retail_val), 0), NULL, NULL, NULL, NULL,
            COUNT(*), COUNT(*) FILTER (WHERE dead), COUNT(*) FILTER (WHERE low),
            COALESCE(SUM(stock) FILTER (WHERE dead), 0), COALESCE(SUM(cost_val) FILTER (WHERE dead), 0)
     FROM inv)
    UNION ALL
    (SELECT 'matched', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, COUNT(*), 0, 0, 0, 0 FROM inv ${where})`);
  const t = rows.find((r) => r.k === 'totals') || {};
  const items = rows
    .filter((r) => r.k === 'page')
    .sort((a, b) => Number(a.ord) - Number(b.ord))
    .map((r) => ({
      id: r.id, name: r.name, sku: r.sku, category: r.category, supplierName: 'ทั่วไป',
      stock: num(r.stock), unitName: r.unit, costPrice: num(r.cost), retailPrice: num(r.retail),
      totalCostValue: num(r.cost_val), totalRetailValue: num(r.retail_val), potentialProfit: num(r.retail_val) - num(r.cost_val),
      daysSinceLastSale: num(r.days_sale), daysSinceLastReceipt: num(r.days_recv), isDeadstock: !!r.dead, isLowStock: !!r.low,
    }));
  const totalCostVal = num(t.cost_val);
  const totalRetailVal = num(t.retail_val);
  return {
    totalProducts: num(t.n),
    totalStockPieces: num(t.stock),
    totalCostVal,
    totalRetailVal,
    totalPotentialProfit: totalRetailVal - totalCostVal,
    deadstockPieces: num(t.dead_stock),
    deadstockCostVal: num(t.dead_cost),
    lowStockCount: num(t.n_low),
    lowStockThreshold: opts.threshold,
    // one page of the list asked for (list = all | deadstock | lowstock, q, page, limit)
    list,
    listCounts: { all: num(t.n), deadstock: num(t.n_dead), lowstock: num(t.n_low) },
    items,
    total: num(rows.find((r) => r.k === 'matched')?.n),
    page: lq.page,
    limit: lq.limit,
  };
}

/** Dashboard stock position: active products, cost value (FIFO batches, catalog cost as fallback) and retail value. */
export async function inventorySnapshotSql(db: Db, threshold: number) {
  const rows = await db.$queryRaw<any[]>(Prisma.sql`
    WITH st AS (
      SELECT b.product_id, SUM(b.quantity_remaining) AS net,
             SUM(b.quantity_remaining::float8) FILTER (WHERE b.quantity_remaining > 0) AS pos_qty,
             SUM(b.quantity_remaining::float8 * b.unit_cost::float8) FILTER (WHERE b.quantity_remaining > 0) AS pos_val
      FROM stock_batches b WHERE b.quantity_remaining <> 0 GROUP BY b.product_id),
    x AS (
      SELECT p.is_bundle, GREATEST(0, COALESCE(st.net, 0))::float8 AS qty, p.cost_price::float8 AS cost,
             COALESCE(p.price_level_1, p.base_price, 0)::float8 AS retail,
             CASE WHEN COALESCE(st.pos_qty, 0) > 0 THEN st.pos_val / st.pos_qty ELSE 0 END AS avg_cost
      FROM products p LEFT JOIN st ON st.product_id = p.id
      WHERE p.is_active)
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE NOT is_bundle AND qty <= 0)::int AS out_count,
           COUNT(*) FILTER (WHERE NOT is_bundle AND qty > 0 AND qty <= ${threshold}::float8)::int AS low_count,
           COALESCE(SUM(CASE WHEN qty > 0 THEN (CASE WHEN qty * avg_cost > 0 THEN qty * avg_cost ELSE qty * cost END) ELSE 0 END) FILTER (WHERE NOT is_bundle), 0)::float8 AS cost_value,
           COALESCE(SUM(qty * retail) FILTER (WHERE NOT is_bundle), 0)::float8 AS retail_value
    FROM x`);
  const r = rows[0] || {};
  return {
    lowStockThreshold: threshold,
    totalProducts: num(r.total),
    lowStockCount: num(r.low_count), // 0 < stock <= threshold
    outOfStockCount: num(r.out_count), // stock <= 0
    stockCostValue: round2(r.cost_value),
    stockRetailValue: round2(r.retail_value),
  };
}

// ─── 4. Payment channels & shift reconciliation ───
const CHANNEL_LABELS: [string, string][] = [
  ['CASH', 'เงินสด (Cash)'],
  ['QR_PROMPTPAY', 'สแกน QR PromptPay / โอนเงิน'],
  ['CREDIT_CARD', 'บัตรเครดิต / เดบิต'],
  ['CREDIT', 'ขายเชื่อ (ยังไม่ได้รับเงิน)'],
  ['STORE_CREDIT', 'ใบลดหนี้ / เครดิตร้าน'],
  ['OTHER', 'ช่องทางอื่นๆ'],
];
/** Report channel of a payment / refund method (same mapping as report-tabs.ts). */
export function reportChannelOf(m: string) {
  if (m === 'CREDIT_DEBT' || m === 'CREDIT' || m === 'DEBT_REDUCTION') return 'CREDIT';
  if (m === 'CREDIT_NOTE') return 'STORE_CREDIT';
  if (m === 'TRANSFER' || m === 'QR_PROMPTPAY') return 'QR_PROMPTPAY';
  if (m === 'CASH' || m === 'CREDIT_CARD') return m;
  return 'OTHER';
}

export async function paymentsTabSql(db: Db, range: DateRange) {
  const shiftWhen = range
    ? Prisma.sql`AND ((s.closed_at IS NOT NULL ${sqlRange(Prisma.sql`s.closed_at`, range)}) OR (s.closed_at IS NULL ${sqlRange(Prisma.sql`s.opened_at`, range)}))`
    : Prisma.empty;
  const [pays, unpaid, rets, debt, shiftRows] = await Promise.all([
    db.$queryRaw<{ m: string; n: number; amount: number }[]>(Prisma.sql`
      SELECT p.method::text AS m, COUNT(*)::int AS n, SUM(p.amount)::float8 AS amount
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE ${NOT_VOID} ${sqlRange(Prisma.sql`o.created_at`, range)} GROUP BY 1`),
    // bills without any payment row count as cash
    db.$queryRaw<{ n: number; amount: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(o.total_amount), 0)::float8 AS amount
      FROM orders o
      WHERE ${NOT_VOID} ${sqlRange(Prisma.sql`o.created_at`, range)} AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)`),
    db.$queryRaw<{ m: string; amount: number }[]>(Prisma.sql`
      SELECT r.refund_method AS m, SUM(r.refund_amount)::float8 AS amount
      FROM order_returns r JOIN orders o ON o.id = r.order_id AND ${NOT_VOID}
      WHERE true ${sqlRange(Prisma.sql`r.created_at`, range)} GROUP BY 1`),
    db.$queryRaw<{ n: number; amount: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(d.amount), 0)::float8 AS amount
      FROM debt_payments d WHERE d.cancelled_at IS NULL ${sqlRange(Prisma.sql`d.payment_date`, range)}`),
    // expected cash per shift as the shift history computes it (shiftFigures): float + cash sales of
    // completed bills (and bills voided after the shift closed) + cash in - cash out
    db.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(t.exp), 0)::float8 AS expected, COALESCE(SUM(t.act), 0)::float8 AS actual,
             COALESCE(SUM(t.act - t.exp), 0)::float8 AS diff,
             COUNT(*) FILTER (WHERE abs(t.act - t.exp) < 0.005)::int AS balanced,
             COUNT(*) FILTER (WHERE t.act - t.exp <= -0.005)::int AS short,
             COUNT(*) FILTER (WHERE t.act - t.exp >= 0.005)::int AS over
      FROM (
        SELECT e.exp, CASE WHEN e.status::text <> 'OPEN' AND e.actual_cash IS NOT NULL THEN e.actual_cash ELSE e.exp END AS act
        FROM (
          SELECT s.status, s.actual_cash, s.starting_cash + COALESCE(cs.amount, 0) + COALESCE(cm.net, 0) AS exp
          FROM shifts s
          LEFT JOIN LATERAL (
            SELECT SUM(p.amount) AS amount
            FROM orders o JOIN payments p ON p.order_id = o.id
            WHERE o.shift_id = s.id AND p.method = 'CASH'
              AND (o.status = 'COMPLETED' OR (s.status::text = 'CLOSED' AND s.closed_at IS NOT NULL AND o.status = 'VOIDED' AND o.updated_at >= s.closed_at))) cs ON true
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN m.type::text = 'IN' THEN m.amount WHEN m.type::text = 'OUT' THEN -m.amount ELSE 0 END) AS net
            FROM cash_movements m WHERE m.shift_id = s.id) cm ON true
          WHERE true ${shiftWhen}) e) t`),
  ]);

  const channel = new Map(CHANNEL_LABELS.map(([k, label]) => [k, { label, count: 0, amount: 0 }]));
  const add = (m: string, amount: number, count: number) => {
    const e = channel.get(reportChannelOf(m))!;
    e.count += count;
    e.amount += amount;
  };
  for (const p of pays) add(p.m, num(p.amount), num(p.n));
  add('CASH', num(unpaid[0]?.amount), num(unpaid[0]?.n));
  let refunds = 0;
  for (const r of rets) {
    add(r.m, -num(r.amount), 0);
    if (r.m !== 'DEBT_REDUCTION') refunds += num(r.amount);
  }
  const debtReceived = round2(debt[0]?.amount);
  const amountOf = (k: string) => round2(channel.get(k)?.amount || 0);
  const salesCollected = round2(amountOf('CASH') + amountOf('QR_PROMPTPAY') + amountOf('CREDIT_CARD') + amountOf('OTHER'));
  const totalSales = round2([...channel.values()].reduce((s, e) => s + e.amount, 0));
  const channels = [...channel.entries()]
    .map(([method, e]) => ({ method, label: e.label, orderCount: e.count, totalAmount: round2(e.amount), percentage: pct1(e.amount, totalSales) }))
    .filter((c) => Math.abs(c.totalAmount) >= 0.005);
  if (debtReceived > 0) {
    channels.push({ method: 'DEBT_RECEIPT', label: 'รับชำระหนี้ลูกค้า (เงินเข้า ไม่ใช่ยอดขาย)', orderCount: num(debt[0]?.n), totalAmount: debtReceived, percentage: 0 });
  }
  const s = shiftRows[0] || {};
  return {
    totalCollected: round2(salesCollected + debtReceived),
    salesCollected,
    debtReceived,
    creditSales: amountOf('CREDIT'),
    refunds: round2(refunds),
    channels,
    shifts: {
      totalShiftsCount: num(s.n),
      totalExpectedCash: round2(s.expected),
      totalActualCash: round2(s.actual),
      totalCashDiscrepancy: round2(s.diff),
      balancedShifts: num(s.balanced),
      shortShifts: num(s.short),
      overShifts: num(s.over),
    },
  };
}

// ─── 5. Customers & debt aging ───
const CUSTOMER_SORTS: Record<string, Prisma.Sql> = {
  spent: Prisma.sql`spent DESC`,
  debt: Prisma.sql`debt DESC`,
  orders: Prisma.sql`order_count DESC`,
  name: Prisma.sql`name ASC`,
};

export async function customersTabSql(db: Db, range: DateRange, now: number, lq: ListQuery) {
  const sort = lq.sort || 'spent';
  if (!CUSTOMER_SORTS[sort]) throw new BadRequestException(`sort ไม่ถูกต้อง (${Object.keys(CUSTOMER_SORTS).join(', ')})`);
  const tie = Prisma.sql`last_at DESC NULLS LAST, name, id`;
  const search = lq.q
    ? Prisma.sql`WHERE (name ILIKE ${likePattern(lq.q)} OR code ILIKE ${likePattern(lq.q)} OR phone ILIKE ${likePattern(lq.q)})`
    : Prisma.empty;
  const code = Prisma.sql`COALESCE(NULLIF(c.profile::jsonb ->> 'code', ''), NULLIF(c.profile::jsonb ->> 'customerCode', ''), upper(right(c.id, 6)))`;
  const profSpent = jsonNum(Prisma.sql`(c.profile::jsonb -> 'totalSpent')`);
  const profOrders = jsonNum(Prisma.sql`(c.profile::jsonb -> 'totalOrders')`);
  const cols = Prisma.sql`id, code, name, phone, points, order_count, spent, debt, last_at, last_text, catalog`;
  const nowIso = new Date(now).toISOString();
  const [rows, aging] = await Promise.all([
    db.$queryRaw<any[]>(Prisma.sql`
      WITH ord AS MATERIALIZED (
        -- spending of the period: each bill net of ALL its partial returns
        SELECT o.customer_id, COUNT(*)::int AS n, SUM(o.total_amount - COALESCE(rt.amount, o.returned_amount)) AS spent, MAX(o.created_at) AS last_at
        FROM orders o
        LEFT JOIN (SELECT r.order_id, SUM(r.refund_amount) AS amount FROM order_returns r GROUP BY r.order_id) rt ON rt.order_id = o.id
        WHERE ${NOT_VOID} ${sqlRange(Prisma.sql`o.created_at`, range)}
        GROUP BY o.customer_id),
      debt_c AS MATERIALIZED (
        SELECT d.customer_id, SUM(d.remaining_amount) AS amount
        FROM customer_debts d WHERE d.remaining_amount > 0 AND d.status::text <> 'PAID' GROUP BY d.customer_id),
      debt_n AS MATERIALIZED (SELECT c.name, SUM(dc.amount) AS amount FROM debt_c dc JOIN customers c ON c.id = dc.customer_id GROUP BY c.name),
      list AS MATERIALIZED (
        SELECT COALESCE(ord.customer_id, 'GENERAL') AS id,
               CASE WHEN c.id IS NULL THEN '-' ELSE ${code} END AS code,
               COALESCE(NULLIF(c.name, ''), 'ลูกค้าทั่วไป') AS name, COALESCE(NULLIF(c.phone, ''), '-') AS phone, COALESCE(c.points, 0) AS points,
               ord.n::float8 AS order_count, ord.spent::float8 AS spent, COALESCE(dc.amount, dn.amount, 0)::float8 AS debt,
               ord.last_at, NULL::text AS last_text, false AS catalog
        FROM ord
        LEFT JOIN customers c ON c.id = ord.customer_id
        LEFT JOIN debt_c dc ON dc.customer_id = ord.customer_id
        LEFT JOIN debt_n dn ON dn.name = COALESCE(NULLIF(c.name, ''), 'ลูกค้าทั่วไป')
        UNION ALL
        -- members without a bill in the period who owe money (or carry an imported spending figure)
        SELECT c.id, ${code}, COALESCE(NULLIF(c.name, ''), 'สมาชิก'), COALESCE(NULLIF(c.phone, ''), '-'), c.points,
               ${profOrders}, ${profSpent}, COALESCE(dc.amount, dn.amount, 0)::float8,
               NULL::timestamp, COALESCE(c.profile::jsonb ->> 'lastPurchaseDate', ''), true
        FROM customers c
        LEFT JOIN debt_c dc ON dc.customer_id = c.id
        LEFT JOIN debt_n dn ON dn.name = c.name
        WHERE NOT EXISTS (SELECT 1 FROM ord WHERE ord.customer_id = c.id)
          AND (COALESCE(dc.amount, dn.amount, 0) > 0 OR ${profSpent} > 0))
      (SELECT 'page' AS k, row_number() OVER (ORDER BY ${CUSTOMER_SORTS[sort]}, ${tie}) AS ord, 0::bigint AS n, ${cols} FROM list ${search}
        ORDER BY ord LIMIT ${lq.limit} OFFSET ${(lq.page - 1) * lq.limit})
      UNION ALL (SELECT 'top', row_number() OVER (ORDER BY ${CUSTOMER_SORTS.spent}, ${tie}) AS ord, 0, ${cols} FROM list ORDER BY ord LIMIT 15)
      UNION ALL (SELECT 'totals', 0, COUNT(*), NULL, NULL, NULL, NULL, NULL, NULL, COALESCE(SUM(spent), 0), NULL, NULL, NULL, NULL FROM list)
      UNION ALL (SELECT 'matched', 0, COUNT(*), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM list ${search})`),
    // unpaid bills by BILL AGE (days since the bill date)
    db.$queryRaw<{ b: number; n: number; amount: number }[]>(Prisma.sql`
      SELECT x.b, COUNT(*)::int AS n, SUM(x.remaining)::float8 AS amount
      FROM (
        SELECT d.remaining_amount AS remaining,
               CASE WHEN a.days <= 15 THEN 0 WHEN a.days <= 30 THEN 1 WHEN a.days <= 60 THEN 2 ELSE 3 END AS b
        FROM customer_debts d JOIN orders o ON o.id = d.order_id
        CROSS JOIN LATERAL (SELECT GREATEST(0, floor(extract(epoch FROM (${nowIso}::timestamp - o.created_at)) / 86400)) AS days) a
        WHERE d.remaining_amount > 0 AND d.status::text <> 'PAID') x
      GROUP BY x.b`),
  ]);

  const toRow = (r: any) => {
    const orderCount = num(r.order_count);
    const totalSpent = r.catalog ? num(r.spent) : round2(r.spent);
    return {
      id: r.id, code: r.code, name: r.name, phone: r.phone, points: num(r.points), orderCount, totalSpent,
      // as before: one bill = its amount; more = rounded to the baht
      averageTicket: r.catalog ? (orderCount && totalSpent ? Math.round(totalSpent / orderCount) : 0) : orderCount === 1 ? totalSpent : Math.round(totalSpent / orderCount),
      outstandingDebt: num(r.debt),
      lastOrderDate: r.catalog ? r.last_text || '' : r.last_at ? new Date(r.last_at).toISOString() : '',
    };
  };
  const pick = (k: string) => rows.filter((r) => r.k === k).sort((a, b) => Number(a.ord) - Number(b.ord)).map(toRow);
  const agingBuckets = [
    { bucketName: 'อายุบิล 0 - 15 วัน', rangeDays: '0-15', billCount: 0, totalAmount: 0 },
    { bucketName: 'อายุบิล 16 - 30 วัน', rangeDays: '16-30', billCount: 0, totalAmount: 0 },
    { bucketName: 'อายุบิล 31 - 60 วัน', rangeDays: '31-60', billCount: 0, totalAmount: 0 },
    { bucketName: 'อายุบิลเกิน 60 วัน', rangeDays: '60+', billCount: 0, totalAmount: 0 },
  ];
  let totalOutstandingDebt = 0;
  let unpaidBillsCount = 0;
  for (const a of [...aging].sort((x, y) => Number(x.b) - Number(y.b))) {
    const b = agingBuckets[Number(a.b)];
    if (!b) continue;
    b.billCount = num(a.n);
    b.totalAmount = num(a.amount);
    totalOutstandingDebt += num(a.amount);
    unpaidBillsCount += num(a.n);
  }
  const totals = rows.find((r) => r.k === 'totals');
  return {
    totalOutstandingDebt,
    unpaidBillsCount,
    agingBuckets,
    // the page of the list asked for (sort, q, page, limit); the counts cover every customer of the period
    allCustomers: pick('page'),
    total: num(rows.find((r) => r.k === 'matched')?.n),
    page: lq.page,
    limit: lq.limit,
    sort,
    customerCount: num(totals?.n),
    totalSpentAll: round2(totals?.spent),
    topCustomers: pick('top'),
  };
}

// ─── P&L: stock write-offs and the ledger part ───
/** Cost value of stock-reducing adjustments in the period (positive number). */
export async function stockWriteOffSql(db: Db, range: DateRange) {
  const v = jsonNum(Prisma.sql`(a.details::jsonb -> 'costValue')`);
  const rows = await db.$queryRaw<{ amount: number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(GREATEST(0, -${v})), 0)::float8 AS amount
    FROM audit_logs a WHERE a.action = 'STOCK_ADJUST_SUB' ${sqlRange(Prisma.sql`a.created_at`, range)}`);
  return num(rows[0]?.amount);
}

/**
 * Ledger rows of the period that enter the P&L, summed per kind (a REVERSAL counts with the kind of
 * the row it reverses), expense category and direction. signed: + money in, - money out.
 */
export async function ledgerProfitRowsSql(db: Db, range: DateRange) {
  const rows = await db.$queryRaw<{ kind: string | null; category: string | null; drawer: boolean; signed: number }[]>(Prisma.sql`
    SELECT CASE WHEN t.type = 'REVERSAL' THEN orig.type ELSE t.type END AS kind, c.name AS category, (a.type::text = 'CASH_DRAWER') AS drawer,
           SUM(CASE WHEN t.direction::text = 'IN' THEN t.amount ELSE -t.amount END)::float8 AS signed
    FROM money_transactions t
    JOIN money_accounts a ON a.id = t.account_id
    LEFT JOIN expense_categories c ON c.id = t.category_id
    LEFT JOIN money_transactions orig ON orig.id = t.reversal_of_id
    WHERE t.type IN ('EXPENSE', 'OTHER_INCOME', 'SHIFT_OVER_SHORT', 'ADJUSTMENT', 'REVERSAL') ${sqlRange(Prisma.sql`t.occurred_at`, range)}
    GROUP BY 1, 2, 3
    ORDER BY MIN(t.occurred_at)`);
  return rows.map((r) => ({ kind: r.kind, category: r.category, drawer: !!r.drawer, signed: num(r.signed) }));
}
