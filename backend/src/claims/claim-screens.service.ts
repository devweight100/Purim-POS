import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { userHasPermission } from '../auth/permissions';
import { canViewCost } from '../products/cost-visibility';

/**
 * The claims screens computed in PostgreSQL over EVERY claim (they read the newest 500 claims in the browser).
 * Claim fields come from the view claim_records (= the frontend's mapServerClaim of a GET /claims row, see
 * migration 20261129000000_claim_records). Numbers are double precision like the JS they replace; Math.round(x)
 * is floor(x + 0.5). The rules of the old browser code are quoted where they are not obvious.
 */

type User = { id?: string; role?: string; permissions?: unknown } | null | undefined;

/** Math.round(x * 100) / 100 */
const round2 = (x: Prisma.Sql) => Prisma.sql`(floor((${x}) * 100 + 0.5) / 100)`;
/** toHund of shared/qty (addQty adds these): Math.round(n * 100 + (n >= 0 ? 1e-7 : -1e-7)), NaN -> 0 */
const hund = (x: Prisma.Sql) =>
  Prisma.sql`(CASE WHEN (${x}) IS NULL OR (${x}) = 'NaN'::float8 OR (${x}) IN ('Infinity'::float8, '-Infinity'::float8) THEN 0
    ELSE floor((${x}) * 100 + CASE WHEN (${x}) >= 0 THEN 1e-7 ELSE -1e-7 END + 0.5) END)`;
/** strpos(lower(text), q) > 0 with q already lower-cased */
const has = (col: Prisma.Sql, q: string) => Prisma.sql`strpos(lower(COALESCE(${col}, '')), ${q}) > 0`;

export const CLAIM_LIST_SORTS = ['newest', 'oldest', 'value_desc', 'value_asc'] as const;
export const RESOLUTION_FILTERS = ['ALL', 'REPLACE_ITEM', 'REFUND_CASH', 'REFUND_TRANSFER', 'STORE_DISCOUNT', 'SUPPLIER_RMA'] as const;

export interface EnrichOptions {
  /** supplier-returns rule: the supplier of the newest PO with the product (asked only with purchase rights) */
  poStep: boolean;
  /** the product cost is known to the user (VIEW_COST): the catalogue sends it */
  costVisible: boolean;
  /** cost of a claim without cost when the product gives none: Number(c.unitPrice || fallback) */
  unitPriceFallback: number;
  /** which claims (SQL over claim_records r) */
  where: Prisma.Sql;
}

@Injectable()
export class ClaimScreensService {
  constructor(private prisma: PrismaService) {}

  /**
   * Runs a read without JIT compilation: the planner's estimates for these functions-heavy statements
   * cross jit_above_cost, and compiling then costs more than the whole query (0.5 s of 1 s on 20k claims).
   */
  private async q<T>(sql: Prisma.Sql): Promise<T> {
    const [, rows] = await this.prisma.$transaction([this.prisma.$executeRaw`SET LOCAL jit = off`, this.prisma.$queryRaw<T>(sql)]);
    return rows;
  }

  /** Active suppliers in the order GET /suppliers returns them (the pages' supplier list). */
  private activeSuppliers() {
    return this.prisma.supplier.findMany({ where: { isActive: true } });
  }

  /**
   * Claims with the supplier / cost the pages resolved in the browser (supplier-return-service
   * getEligibleClaimsForReturn step 1 / claim-inventory loadData, with resolveProductSupplierAndCost):
   *   supplier: the claim's own (CLAIM_META supplierId), else the product's first supplier entry (preferred
   *   first, as the catalogue lists them) when it is an active supplier, else [poStep] the supplier of the newest
   *   PO with the product (by id, else by name), else the first active supplier, else UNKNOWN;
   *   cost: the claim's costPrice when > 0, else the product's (cost when visible, else its price level 1 /
   *   base price, else the first entry's cost when visible; rounded to 2 decimals) when > 0, else
   *   Number(c.unitPrice || fallback); per base unit (cost / conversion factor when the factor > 1).
   * Columns: the claim_records columns, ord (claim list order: newest first), e_sup_id, e_sup_name (NULL when
   * the claim named its supplier without a name), base_cost, total_cost, base_unit, base_qty, category.
   */
  enrichedSql(o: EnrichOptions, suppliers: { id: string; name: string }[]) {
    const ids = suppliers.map((s) => s.id);
    const names = suppliers.map((s) => s.name);
    return Prisma.sql`
      sup AS (SELECT s.id, s.name, s.ord FROM unnest(${ids}::text[], ${names}::text[]) WITH ORDINALITY AS s(id, name, ord)),
      base AS (
        SELECT r.*, row_number() OVER (ORDER BY r.received_date DESC, r.claim_id DESC) AS ord
          FROM claim_records r WHERE ${o.where}
      ),
      prods AS (SELECT DISTINCT product_id FROM base),
      entry AS (
        SELECT DISTINCT ON (ps.product_id) ps.product_id, ps.supplier_id, ps.unit_cost
          FROM product_suppliers ps WHERE ps.product_id IN (SELECT product_id FROM prods)
         ORDER BY ps.product_id, ps.is_preferred DESC, ps.created_at ASC
      ),
      lastpo AS (
        SELECT DISTINCT ON (i.product_id) i.product_id, po.supplier_id, s.name AS supplier_name
          FROM purchase_order_items i
          JOIN purchase_orders po ON po.id = i.purchase_order_id
          LEFT JOIN suppliers s ON s.id = po.supplier_id
         WHERE ${o.poStep} AND i.product_id IN (SELECT DISTINCT product_id FROM base WHERE supplier_id IS NULL)
         ORDER BY i.product_id, po.created_at DESC, po.id DESC
      ),
      pres AS (
        SELECT d.product_id,
          COALESCE(s1.id, s2.id, s3.id, (SELECT id FROM sup ORDER BY ord LIMIT 1), 'UNKNOWN') AS sup_id,
          COALESCE(s1.name, s2.name, s3.name, (SELECT name FROM sup ORDER BY ord LIMIT 1), 'ไม่ระบุผู้จำหน่าย') AS sup_name,
          ${round2(Prisma.sql`claim_js_or(CASE WHEN ${o.costVisible} THEN p.cost_price::float8 END,
             claim_js_or(COALESCE(p.price_level_1, p.base_price)::float8,
             claim_js_or(CASE WHEN ${o.costVisible} AND e.product_id IS NOT NULL THEN COALESCE(e.unit_cost, p.cost_price)::float8 END, 0)))`)} AS cost
        FROM prods d
        JOIN products p ON p.id = d.product_id
        LEFT JOIN entry e ON e.product_id = d.product_id
        LEFT JOIN sup s1 ON s1.id = e.supplier_id
        LEFT JOIN lastpo lp ON lp.product_id = d.product_id
        LEFT JOIN sup s2 ON s2.id = lp.supplier_id
        LEFT JOIN LATERAL (
          SELECT sx.id, sx.name FROM sup sx
           WHERE s2.id IS NULL AND lp.supplier_name IS NOT NULL
             AND lower(btrim(sx.name, E' \\t\\n\\r\\f\\v')) = lower(btrim(lp.supplier_name, E' \\t\\n\\r\\f\\v'))
           ORDER BY sx.ord LIMIT 1
        ) s3 ON true
      ),
      e1 AS (
        SELECT b.*,
          CASE WHEN b.supplier_id IS NULL THEN pr.sup_id ELSE b.supplier_id END AS e_sup_id,
          CASE WHEN b.supplier_id IS NULL THEN pr.sup_name ELSE b.supplier_name END AS e_sup_name,
          CASE WHEN claim_js_or(b.cost_price, 0) > 0 THEN claim_js_or(b.cost_price, 0)
               WHEN pr.cost > 0 THEN pr.cost
               ELSE claim_js_or(b.unit_price, ${o.unitPriceFallback}::float8) END AS cost,
          claim_js_or(b.conversion_factor, 1) AS factor,
          COALESCE(NULLIF(cat.name, ''), 'ทั่วไป') AS category
        FROM base b
        JOIN pres pr ON pr.product_id = b.product_id
        JOIN products p ON p.id = b.product_id
        LEFT JOIN categories cat ON cat.id = p.category_id
      ),
      e AS (
        SELECT e1.*,
          e1.base_quantity AS base_qty,
          CASE WHEN e1.factor > 1 THEN COALESCE(e1.replacement_unit_name, 'ชิ้น') ELSE e1.unit_name END AS base_unit,
          CASE WHEN e1.factor > 1 AND e1.cost > 0 THEN e1.cost / e1.factor ELSE e1.cost END AS base_cost,
          ${round2(Prisma.sql`(CASE WHEN e1.factor > 1 AND e1.cost > 0 THEN e1.cost / e1.factor ELSE e1.cost END) * e1.base_quantity`)} AS total_cost
        FROM e1
      )`;
  }

  // ─── Claims page ──────────────────────────────────────────────────────────────────────────────────────────

  /**
   * GET /claims/list: the claims page over every claim. Filters / search / date range as the page applied them
   * in the browser; summary cards (getClaimStockSummary) over every claim; the page's rows have the GET /claims
   * shape (merged by `loadRows`). Default order = GET /claims (received date, newest first).
   */
  async list(q: { page: number; limit: number; search?: string; resolutionType?: string; startDate?: string; endDate?: string; sort?: string },
    loadRows: (ids: string[]) => Promise<any[]>) {
    const conds: Prisma.Sql[] = [Prisma.sql`true`];
    if (q.resolutionType && q.resolutionType !== 'ALL') conds.push(Prisma.sql`r.res_type = ${q.resolutionType}`);
    // new Date(startDate).getTime(): claims before it are left out; endDate: + 24 h, claims after it are left out
    // (a claim date that is not a date is never left out, like NaN comparisons)
    if (q.startDate) {
      const from = new Date(q.startDate).getTime();
      if (Number.isFinite(from)) conds.push(Prisma.sql`NOT (r.claim_date IS NOT NULL AND extract(epoch FROM r.claim_date) * 1000 < ${from})`);
    }
    if (q.endDate) {
      const to = new Date(q.endDate).getTime() + 24 * 60 * 60 * 1000;
      if (Number.isFinite(to)) conds.push(Prisma.sql`NOT (r.claim_date IS NOT NULL AND extract(epoch FROM r.claim_date) * 1000 > ${to})`);
    }
    const s = (q.search || '').toLowerCase().trim();
    if (s) {
      conds.push(Prisma.sql`(${has(Prisma.sql`r.claim_key`, s)} OR ${has(Prisma.sql`r.order_number`, s)} OR ${has(Prisma.sql`r.customer_name`, s)}
        OR ${has(Prisma.sql`r.product_name`, s)} OR ${has(Prisma.sql`r.sku`, s)} OR ${has(Prisma.sql`r.defect_reason`, s)})`);
    }
    const where = Prisma.join(conds, ' AND ');
    const order =
      q.sort === 'oldest' ? Prisma.sql`r.received_date ASC, r.claim_id ASC`
      : q.sort === 'value_desc' ? Prisma.sql`r.total_claim_value DESC NULLS LAST, r.received_date DESC, r.claim_id DESC`
      : q.sort === 'value_asc' ? Prisma.sql`r.total_claim_value ASC NULLS LAST, r.received_date DESC, r.claim_id DESC`
      : Prisma.sql`r.received_date DESC, r.claim_id DESC`;
    const offset = (q.page - 1) * q.limit;
    const [pageRows, [sum]] = await Promise.all([
      this.q<{ claim_id: string; total: bigint }[]>(Prisma.sql`
        SELECT r.claim_id, count(*) OVER () AS total FROM claim_records r WHERE ${where}
         ORDER BY ${order} LIMIT ${q.limit} OFFSET ${offset}`),
      this.q<any[]>(Prisma.sql`
        SELECT count(*)::int AS "totalClaims",
          COALESCE(sum(claim_js_or(r.total_claim_value, 0)), 0)::float8 AS "totalClaimValue",
          (count(*) FILTER (WHERE r.status IN ('PENDING_SUPPLIER', 'SENT_TO_SUPPLIER')))::int AS "pendingSupplierCount",
          (count(*) FILTER (WHERE r.status IN ('COMPLETED', 'SUPPLIER_REPLACED')))::int AS "completedCount",
          (count(*) FILTER (WHERE r.status = 'SCRAPPED'))::int AS "scrappedCount",
          COALESCE(sum(claim_js_or(r.quantity, 1)) FILTER (WHERE r.res_type = 'REPLACE_ITEM'), 0)::float8 AS "replacedItemCount",
          COALESCE(sum(claim_js_or(r.quantity, 1)) FILTER (WHERE r.res_type IN ('REFUND_CASH', 'REFUND_TRANSFER')), 0)::float8 AS "refundedCount",
          COALESCE(sum(claim_js_or(r.quantity, 1)) FILTER (WHERE r.res_type = 'STORE_DISCOUNT'), 0)::float8 AS "discountedCount"
        FROM claim_records r`),
    ]);
    let total = pageRows.length ? Number(pageRows[0].total) : 0;
    if (!pageRows.length && offset > 0) {
      const [c] = await this.q<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM claim_records r WHERE ${where}`);
      total = c.n;
    }
    return {
      data: await loadRows(pageRows.map((r) => r.claim_id)),
      meta: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
      summary: sum,
    };
  }

  /**
   * GET /claims/refund-summary?from=<ms>: claim refunds shown on the dashboard (claims resolved as cash / transfer
   * refunds whose claim date is not before `from`; a claim date that is not a date counts, like the page's
   * `if (!claimTime) return true`). Amount per claim: Number(totalClaimValue || refundAmount || 0).
   */
  async refundSummary(from?: number) {
    const [row] = await this.q<{ count: number; amount: number }[]>(Prisma.sql`
      SELECT count(*)::int AS count,
        COALESCE(sum(CASE WHEN claim_js_or(r.total_claim_value, 0) <> 0 THEN r.total_claim_value
                          WHEN claim_js_truthy(r.refund_amount) THEN claim_js_number(r.refund_amount) ELSE 0 END), 0)::float8 AS amount
      FROM claim_records r
      WHERE r.res_type IN ('REFUND_CASH', 'REFUND_TRANSFER')
        AND (${from === undefined} OR r.claim_date IS NULL OR r.claim_date = 'epoch'::timestamptz
             OR extract(epoch FROM r.claim_date) * 1000 >= ${from ?? 0})`);
    return row;
  }

  /**
   * GET /claims/by-orders?orderIds=: every claim of these bills (by order id, or by bill number = the bill's
   * number, else its id), GET /claims rows. The claim-eligibility check computes already-claimed quantities from
   * them (it read the newest 500 claims).
   */
  async claimIdsOfOrders(orderIds: string[]): Promise<string[]> {
    const orders = await this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } });
    if (!orders.length) return [];
    const ids = orders.map((o) => o.id);
    const numbers = [...new Set(orders.flatMap((o) => [o.orderNumber || o.id, o.id]))];
    const rows = await this.q<{ claim_id: string }[]>(Prisma.sql`
      SELECT r.claim_id FROM claim_records r
       WHERE r.order_id = ANY(${ids}::text[]) OR r.order_number = ANY(${numbers}::text[])
       ORDER BY r.received_date DESC, r.claim_id DESC`);
    return rows.map((r) => r.claim_id);
  }

  // ─── Supplier returns ─────────────────────────────────────────────────────────────────────────────────────

  private returnOptions(user: User): Omit<EnrichOptions, 'where'> {
    // the page asked GET /purchase-orders/product-suppliers (MANAGE_PURCHASES) and the catalogue (cost: VIEW_COST)
    return { poStep: userHasPermission(user, 'MANAGE_PURCHASES'), costVisible: canViewCost(user), unitPriceFallback: 50 };
  }

  /** returnable = not on a return note, not scrapped (getEligibleClaimsForReturn step 1) */
  private static RETURNABLE = Prisma.sql`NOT r.has_return_doc AND r.status <> 'SCRAPPED'`;

  /**
   * GET /claims/returnable/summary: the supplier returns page (cards over every returnable claim): count and
   * value (Number(totalCostValue || (costPrice || 50) * (quantity || 1)) per claim) in total and per resolved
   * supplier, with the first three claims of each supplier (claim list order).
   */
  async returnableSummary(user: User) {
    const suppliers = await this.activeSuppliers();
    const val = Prisma.sql`claim_js_or(e.total_cost, claim_js_or(e.base_cost, 50) * claim_js_or(e.base_qty, 1))`;
    const groups = await this.q<any[]>(Prisma.sql`
      WITH ${this.enrichedSql({ ...this.returnOptions(user), where: ClaimScreensService.RETURNABLE }, suppliers)}
      SELECT e.e_sup_id AS "supplierId", count(*)::int AS count, sum(${val})::float8 AS "totalCostValue",
        (array_agg(json_build_object('id', e.claim_key, 'productName', e.product_name, 'quantity', e.base_qty) ORDER BY e.ord))[1:3] AS top,
        min(e.ord) AS first, (sum(sum(${val})) OVER ())::float8 AS all_value
      FROM e GROUP BY e.e_sup_id ORDER BY first`);
    return {
      total: groups.reduce((n, g) => n + g.count, 0),
      totalCostValue: groups.length ? groups[0].all_value : 0,
      suppliers: groups.map(({ first: _first, all_value: _all, ...g }) => g),
    };
  }

  /**
   * GET /claims/returnable/groups?supplierId=&scope=supplier|other&search=&page=&limit=: the create-return dialog.
   * scope=supplier: the returnable claims of the supplier (isClaimBelongingToSupplier: resolved supplier, its
   * name, a supplier entry of the product, a PO of the supplier with the product / same product name);
   * scope=other: every other returnable claim. Grouped by product (groupClaimsByProduct; groups in claim order),
   * paged; `search` keeps the groups with a claim matching product name / SKU / claim number / bill number.
   * totals: groups, claims and pieces (addQty of the claims' quantities) of the scope (before search / paging).
   */
  async returnableGroups(user: User, q: { supplierId: string; scope: 'supplier' | 'other'; search?: string; page: number; limit: number }) {
    const suppliers = await this.activeSuppliers();
    const target = suppliers.find((s) => s.id === q.supplierId);
    const tName = target ? target.name.trim().toLowerCase() : null;
    const belongs = Prisma.sql`(
      e.e_sup_id = ${q.supplierId}
      OR (${tName}::text IS NOT NULL AND e.e_sup_name IS NOT NULL AND lower(btrim(e.e_sup_name, E' \\t\\n\\r\\f\\v')) = ${tName})
      OR e.product_id IN (SELECT ps.product_id FROM product_suppliers ps WHERE ps.supplier_id = ${q.supplierId})
      OR e.product_id IN (SELECT tp.id FROM tpo tp)
      OR e.sku IN (SELECT tp.sku FROM tpo tp)
      OR e.product_name IN (SELECT tp.name FROM tpo tp)
    )`;
    // products on the supplier's POs (the dialog loaded every PO of the supplier; needs purchase rights)
    const tpo = Prisma.sql`tpo AS (
      SELECT DISTINCT ip.id, ip.sku, ip.name FROM purchase_orders po
        JOIN purchase_order_items i ON i.purchase_order_id = po.id JOIN products ip ON ip.id = i.product_id
       WHERE ${this.returnOptions(user).poStep} AND po.supplier_id = ${q.supplierId})`;
    const scope = q.scope === 'other' ? Prisma.sql`NOT ${belongs}` : belongs;
    const s = (q.search || '').toLowerCase().trim();
    const searchCond = s
      ? Prisma.sql`bool_or(${has(Prisma.sql`c.product_name`, s)} OR ${has(Prisma.sql`c.sku`, s)} OR ${has(Prisma.sql`c.claim_key`, s)} OR ${has(Prisma.sql`c.order_number`, s)})`
      : Prisma.sql`true`;
    const offset = (q.page - 1) * q.limit;
    const rows = await this.q<any[]>(Prisma.sql`
      WITH ${this.enrichedSql({ ...this.returnOptions(user), where: ClaimScreensService.RETURNABLE }, suppliers)}, ${tpo},
      c AS (
        SELECT e.*,
          CASE WHEN e.factor > 1 AND claim_js_or(e.base_cost, 0) > 0 THEN e.base_cost / e.factor ELSE claim_js_or(e.base_cost, 0) END AS g_cost
        FROM e WHERE ${scope}
      ),
      g AS (
        SELECT c.product_id,
          min(c.ord) AS first,
          count(*)::int AS claim_count,
          sum(c.base_qty)::float8 AS total_quantity,
          sum(${hund(Prisma.sql`claim_js_or(c.base_qty, 1)`)}) AS pieces_hund,
          (array_agg(c.g_cost ORDER BY c.ord))[1] AS first_cost,
          (array_agg(c.g_cost ORDER BY c.ord) FILTER (WHERE c.g_cost > 0))[1] AS first_positive_cost,
          array_agg(c.claim_key ORDER BY c.ord) AS claim_ids,
          array_agg(c.defect_reason ORDER BY c.ord) AS reasons,
          array_agg(c.order_number ORDER BY c.ord) AS order_numbers,
          ${searchCond} AS matches
        FROM c GROUP BY c.product_id
      )
      , t AS (
        SELECT g.*, count(*) FILTER (WHERE g.matches) OVER () AS match_total,
          count(*) OVER () AS group_total, sum(g.claim_count) OVER () AS claim_total, sum(g.pieces_hund) OVER () AS pieces_total
        FROM g
      )
      SELECT 1 AS head, NULL AS product_id, NULL::bigint AS first, NULL::int AS claim_count, NULL::float8 AS total_quantity,
        NULL::float8 AS first_cost, NULL::float8 AS first_positive_cost, NULL::text[] AS claim_ids, NULL::text[] AS reasons,
        NULL::text[] AS order_numbers, NULL AS product_name, NULL AS sku, NULL AS base_unit, NULL AS e_sup_id, NULL AS e_sup_name,
        (SELECT max(match_total) FROM t)::int AS match_total, (SELECT max(group_total) FROM t)::int AS group_total,
        (SELECT max(claim_total) FROM t)::int AS claim_total, (SELECT max(pieces_total) FROM t)::float8 AS pieces_total
      UNION ALL
      SELECT * FROM (
        SELECT 0, t.product_id, t.first, t.claim_count, t.total_quantity, t.first_cost, t.first_positive_cost, t.claim_ids,
          t.reasons, t.order_numbers, f.product_name, f.sku, f.base_unit, f.e_sup_id, f.e_sup_name, NULL::int, NULL::int, NULL::int, NULL::float8
        FROM t JOIN c f ON f.product_id = t.product_id AND f.ord = t.first
        WHERE t.matches ORDER BY t.first LIMIT ${q.limit} OFFSET ${offset}
      ) pg`);
    const head = rows.find((r) => r.head === 1) || {};
    const totals = {
      groups: Number(head.group_total || 0),
      claims: Number(head.claim_total || 0),
      pieces: Number(head.pieces_total || 0) / 100,
    };
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    const data = rows.filter((r) => r.head === 0).sort((a, b) => Number(a.first) - Number(b.first)).map((r) => ({
      groupKey: `PID_${r.product_id}`,
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      unitName: r.base_unit,
      totalQuantity: r.total_quantity,
      // groupClaimsByProduct: the first claim's cost per base unit, replaced by the first one > 0 when it is <= 0
      costPrice: !(r.first_cost <= 0) ? r.first_cost : (r.first_positive_cost ?? r.first_cost),
      claimCount: r.claim_count,
      claimIds: uniq(r.claim_ids),
      defectReasons: uniq(r.reasons),
      orderNumbers: uniq(r.order_numbers),
      supplierId: r.e_sup_id,
      supplierName: r.e_sup_name ?? undefined,
    }));
    return { data, meta: { total: Number(head.match_total || 0), page: q.page, limit: q.limit }, totals };
  }

  // ─── Claim stock (claim-inventory page) ───────────────────────────────────────────────────────────────────

  private static IN_STOCK = Prisma.sql`(NOT e.has_return_doc AND e.status NOT IN ('SCRAPPED', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED'))`;

  private stockFilter(q: { status?: string; supplierId?: string; category?: string; search?: string }) {
    const conds: Prisma.Sql[] = [Prisma.sql`true`];
    if (q.status === 'IN_STOCK') conds.push(ClaimScreensService.IN_STOCK);
    else if (q.status === 'RETURNED') conds.push(Prisma.sql`(e.has_return_doc OR e.status IN ('SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED'))`);
    if (q.supplierId && q.supplierId !== 'ALL') conds.push(Prisma.sql`e.e_sup_id = ${q.supplierId}`);
    if (q.category && q.category !== 'ALL') conds.push(Prisma.sql`e.category = ${q.category}`);
    const s = (q.search || '').trim().toLowerCase();
    if (s) {
      conds.push(Prisma.sql`(${has(Prisma.sql`e.product_name`, s)} OR ${has(Prisma.sql`e.sku`, s)} OR ${has(Prisma.sql`e.sup_name`, s)}
        OR ${has(Prisma.sql`e.claim_key`, s)} OR ${has(Prisma.sql`e.order_number`, s)})`);
    }
    return Prisma.join(conds, ' AND ');
  }

  private stockOptions(user: User): EnrichOptions {
    // the page did not ask the PO suppliers (only the supplier returns page did); cost fallback: unit price or 0
    return { poStep: false, costVisible: canViewCost(user), unitPriceFallback: 0, where: Prisma.sql`true` };
  }

  private stockEnriched(user: User, suppliers: { id: string; name: string }[]) {
    // claim inventory names a claim without supplier name 'ไม่ระบุผู้จำหน่าย'
    return Prisma.sql`${this.enrichedSql(this.stockOptions(user), suppliers)},
      s AS (SELECT e.*, COALESCE(e.e_sup_name, 'ไม่ระบุผู้จำหน่าย') AS sup_name FROM e)`;
  }

  /** a claim row of the claim-stock page (ClaimStockItem) */
  private static STOCK_ITEM = Prisma.sql`
    json_build_object('id', s.claim_key, 'claimId', s.claim_key, 'claimDate', s.claim_date, 'orderNumber', s.order_number,
      'customerName', s.customer_name, 'customerPhone', s.customer_phone, 'productId', s.product_id, 'productName', s.product_name,
      'sku', s.sku, 'category', s.category, 'supplierId', s.e_sup_id, 'supplierName', s.sup_name, 'defectReason', s.defect_reason,
      'quantity', s.base_qty, 'unitName', s.base_unit, 'costPrice', s.base_cost, 'unitPrice', claim_js_or(s.unit_price, 0),
      'totalCostValue', s.total_cost, 'totalClaimValue', claim_js_or(s.total_claim_value, 0), 'status', s.status,
      'returnDocId', s.return_doc_id)`;

  /**
   * GET /claims/claim-stock: the claim-inventory page over every claim. stats / categories over every claim;
   * products (per product + SKU + supplier, sorted by in-stock cost) and suppliers (from those, same order rule)
   * and the claim records over the filtered claims; products and records paged.
   */
  async claimStock(user: User, q: { status?: string; supplierId?: string; category?: string; search?: string; page: number; limit: number; recordsPage: number; recordsLimit: number }) {
    const suppliers = await this.activeSuppliers();
    const filter = this.stockFilter(q);
    const inStockStats = Prisma.sql`(NOT s.has_return_doc AND s.status NOT IN ('SCRAPPED', 'SENT_TO_SUPPLIER', 'COMPLETED', 'SUPPLIER_REPLACED'))`;
    const inStock = Prisma.sql`(NOT e.has_return_doc AND e.status NOT IN ('SCRAPPED', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED'))`;
    const [res] = await this.q<any[]>(Prisma.sql`
      WITH ${this.stockEnriched(user, suppliers)},
      f AS (SELECT e.* FROM s e WHERE ${filter}),
      prod AS (
        SELECT e.product_id, e.sku, e.e_sup_id,
          min(e.ord) AS first,
          sum(e.base_qty)::float8 AS total_pieces,
          COALESCE(sum(e.base_qty) FILTER (WHERE ${inStock}), 0)::float8 AS in_stock_pieces,
          sum(e.total_cost)::float8 AS total_cost,
          COALESCE(sum(e.total_cost) FILTER (WHERE ${inStock}), 0)::float8 AS in_stock_cost,
          sum(claim_js_or(e.total_claim_value, 0))::float8 AS total_claim_value,
          max(e.claim_date) AS latest,
          count(*)::int AS claim_count
        FROM f e GROUP BY e.product_id, e.sku, e.e_sup_id
      ),
      prod_rows AS (
        SELECT p.*, row_number() OVER (ORDER BY p.in_stock_cost DESC, p.first) AS pos, x.sup_name
        FROM prod p JOIN f x ON x.ord = p.first
      ),
      prod_page AS (
        SELECT p.pos, json_build_object('productId', p.product_id, 'productName', x.product_name, 'sku', p.sku, 'category', x.category,
            'supplierId', p.e_sup_id, 'supplierName', x.sup_name, 'unitName', x.base_unit, 'costPrice', x.base_cost,
            'unitPrice', claim_js_or(x.unit_price, 0), 'totalPieces', p.total_pieces, 'inStockPieces', p.in_stock_pieces,
            'totalCostValue', p.total_cost, 'inStockCostValue', p.in_stock_cost, 'totalClaimValue', p.total_claim_value,
            'latestClaimDate', COALESCE(p.latest, x.claim_date), 'claimCount', p.claim_count) AS j
        FROM prod_rows p JOIN f x ON x.ord = p.first
        WHERE p.pos > ${(q.page - 1) * q.limit} AND p.pos <= ${q.page * q.limit}
      ),
      supp AS (
        SELECT pr.e_sup_id, min(pr.pos) AS first, count(*)::int AS product_count,
          sum(pr.total_pieces)::float8 AS total_pieces, sum(pr.in_stock_pieces)::float8 AS in_stock_pieces,
          sum(pr.total_cost)::float8 AS total_cost, sum(pr.in_stock_cost)::float8 AS in_stock_cost,
          sum(pr.total_claim_value)::float8 AS total_claim_value, max(pr.latest) AS latest,
          (array_agg(pr.sup_name ORDER BY pr.pos))[1] AS sup_name
        FROM prod_rows pr GROUP BY pr.e_sup_id
      )
      SELECT
        (SELECT json_build_object(
           'uniqueProducts', count(DISTINCT s.product_id || '_' || s.sku) FILTER (WHERE ${inStockStats}),
           'pieces', COALESCE(sum(${hund(Prisma.sql`s.base_qty`)}) FILTER (WHERE ${inStockStats}), 0) / 100.0,
           'costValue', COALESCE(sum(s.total_cost) FILTER (WHERE ${inStockStats}), 0),
           'suppliersCount', count(DISTINCT s.e_sup_id) FILTER (WHERE ${inStockStats})) FROM s) AS stats,
        (SELECT COALESCE(json_agg(c.category ORDER BY c.first), '[]') FROM (SELECT s.category, min(s.ord) AS first FROM s GROUP BY s.category) c) AS categories,
        (SELECT count(*)::int FROM f) AS filtered_count,
        (SELECT count(*)::int FROM prod) AS product_total,
        (SELECT COALESCE(json_agg(pr.j ORDER BY pr.pos), '[]') FROM prod_page pr) AS products,
        (SELECT COALESCE(json_agg(json_build_object(
            'supplierId', sp.e_sup_id, 'supplierName', sp.sup_name,
            'productCount', sp.product_count, 'totalPieces', sp.total_pieces, 'inStockPieces', sp.in_stock_pieces,
            'totalCostValue', sp.total_cost, 'inStockCostValue', sp.in_stock_cost, 'totalClaimValue', sp.total_claim_value,
            'latestClaimDate', sp.latest) ORDER BY sp.in_stock_cost DESC, sp.first), '[]') FROM supp sp) AS suppliers,
        (SELECT COALESCE(json_agg(${ClaimScreensService.STOCK_ITEM} ORDER BY s.ord), '[]') FROM (
           SELECT * FROM f ORDER BY f.ord LIMIT ${q.recordsLimit} OFFSET ${(q.recordsPage - 1) * q.recordsLimit}) s) AS records`);
    const phones = new Map(suppliers.map((s) => [s.id, s.phone]));
    return {
      stats: res.stats,
      categories: res.categories,
      filteredCount: res.filtered_count,
      products: { data: res.products, total: res.product_total },
      suppliers: (res.suppliers as any[]).map((s) => ({ ...s, supplierPhone: phones.get(s.supplierId) ?? undefined })),
      records: { data: res.records, total: res.filtered_count },
    };
  }

  /** GET /claims/claim-stock/claims: the claims of one product row of the claim-stock page (same filters). */
  async claimStockClaims(user: User, q: { status?: string; supplierId?: string; category?: string; search?: string; productId: string; sku: string; rowSupplierId: string }) {
    const suppliers = await this.activeSuppliers();
    const filter = this.stockFilter(q);
    const rows = await this.q<{ j: any }[]>(Prisma.sql`
      WITH ${this.stockEnriched(user, suppliers)}
      SELECT ${ClaimScreensService.STOCK_ITEM} AS j FROM s
       WHERE s.claim_id IN (SELECT e.claim_id FROM s e WHERE ${filter})
         AND s.product_id = ${q.productId} AND s.sku = ${q.sku} AND s.e_sup_id = ${q.rowSupplierId}
       ORDER BY s.ord`);
    return rows.map((r) => r.j);
  }
}

export function parsePageParam(raw: unknown, fallback: number, max: number, label: string) {
  if (raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new BadRequestException(`${label} ต้องเป็นจำนวนเต็ม`);
  const n = Number(raw);
  if (n < 1 || n > max) throw new BadRequestException(`${label} ต้องอยู่ระหว่าง 1-${max}`);
  return n;
}
