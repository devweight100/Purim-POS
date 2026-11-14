import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Customer list rows (GET /customers): the profile JSON spread under the columns (as the screens read them),
 * phone '' when missing and currentDebt = remaining amount of the customer's debts.
 * Rows come in creation order (the old unordered findMany followed the table order, which edits reshuffle).
 */

export const CUSTOMER_TYPES = ['all', 'INDIVIDUAL', 'COMPANY', 'credit', 'hasDebt'] as const;
export type CustomerTypeFilter = (typeof CUSTOMER_TYPES)[number];

export interface CustomerPageQuery {
  page: number;
  limit: number;
  search?: string;
  type?: CustomerTypeFilter;
  priceLevel?: number | null;
}

export function parseCustomerPageQuery(q: Record<string, unknown>): CustomerPageQuery {
  for (const k of ['search', 'type', 'priceLevel', 'page', 'limit']) {
    if (q[k] !== undefined && typeof q[k] !== 'string') throw new BadRequestException('เงื่อนไขค้นหาไม่ถูกต้อง');
  }
  const page = Math.max(1, Math.min(1_000_000, parseInt(String(q.page), 10) || 1));
  const limit = Math.max(1, Math.min(500, parseInt(String(q.limit ?? ''), 10) || 20));
  const type = (q.type as string | undefined) || 'all';
  if (!(CUSTOMER_TYPES as readonly string[]).includes(type)) throw new BadRequestException('ประเภทลูกค้าไม่ถูกต้อง');
  let priceLevel: number | null = null;
  if (q.priceLevel !== undefined && q.priceLevel !== '' && q.priceLevel !== 'all') {
    priceLevel = Number(q.priceLevel);
    if (![1, 2, 3, 4, 5].includes(priceLevel)) throw new BadRequestException('ระดับราคาไม่ถูกต้อง');
  }
  return { page, limit, search: typeof q.search === 'string' ? q.search.trim() : '', type: type as CustomerTypeFilter, priceLevel };
}

/** `%text%` for ILIKE with % _ \ taken literally. */
export const likePattern = (text: string) => '%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// Same normalisation as the screens (normalizeCustomerRow): type COMPANY or INDIVIDUAL, credit limit Number(… ?? 0),
// price level 1-5 else 1, points = the column.
const NUM = (expr: string) => `CASE WHEN (${expr}) ~ '^\\s*[-+]?[0-9]+(\\.[0-9]+)?\\s*$' THEN (${expr})::numeric ELSE 0 END`;
const TYPE_SQL = `CASE WHEN cu.profile->>'type' = 'COMPANY' THEN 'COMPANY' ELSE 'INDIVIDUAL' END`;
const CREDIT_SQL = NUM(`cu.profile->>'creditLimit'`);
const LEVEL_SQL = `CASE WHEN cu.profile->>'priceLevel' IN ('1','2','3','4','5') THEN (cu.profile->>'priceLevel')::int ELSE 1 END`;

/**
 * Ids of one page (creation order), the filtered count, the cards over every customer and the next free
 * CUST-#### code. `listIndex` = position in the whole list (the screens' fallback code for rows without one).
 */
export async function customerPageIds(db: { $queryRaw: (...a: any[]) => Promise<any> }, q: CustomerPageQuery) {
  const conds: Prisma.Sql[] = [];
  if (q.search) {
    const p = likePattern(q.search);
    conds.push(Prisma.sql`(c.name ILIKE ${p} OR c.phone ILIKE ${p} OR c.profile->>'code' ILIKE ${p}
      OR c.profile->>'companyName' ILIKE ${p} OR c.profile->>'taxId' ILIKE ${p} OR c.profile->>'contactPerson' ILIKE ${p})`);
  }
  if (q.type === 'INDIVIDUAL' || q.type === 'COMPANY') conds.push(Prisma.sql`c.ctype = ${q.type}`);
  else if (q.type === 'credit') conds.push(Prisma.sql`c.credit_limit > 0`);
  else if (q.type === 'hasDebt') conds.push(Prisma.sql`c.current_debt > 0`);
  if (q.priceLevel) conds.push(Prisma.sql`c.price_level = ${q.priceLevel}`);
  const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
  const base = Prisma.sql`
    WITH d AS (SELECT customer_id, sum(remaining_amount) AS debt FROM customer_debts GROUP BY customer_id),
    c AS (
      SELECT cu.id, cu.name, cu.phone, cu.profile, cu.points,
        (row_number() OVER (ORDER BY cu.created_at, cu.id) - 1)::int AS list_index,
        ${Prisma.raw(TYPE_SQL)} AS ctype, ${Prisma.raw(CREDIT_SQL)} AS credit_limit, ${Prisma.raw(LEVEL_SQL)} AS price_level,
        COALESCE(d.debt, 0) AS current_debt
      FROM customers cu LEFT JOIN d ON d.customer_id = cu.id
    )`;
  const offset = (q.page - 1) * q.limit;
  const [rows, [stats]] = await Promise.all([
    db.$queryRaw`${base}
      SELECT id, list_index AS "listIndex", count(*) OVER ()::int AS total FROM c ${where}
      ORDER BY list_index LIMIT ${q.limit} OFFSET ${offset}`,
    db.$queryRaw`${base}
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE ctype = 'COMPANY')::int AS "companyCount",
        count(*) FILTER (WHERE credit_limit > 0)::int AS "totalCreditCustomers",
        COALESCE(sum(current_debt), 0)::text AS "totalDebt",
        COALESCE(sum(points), 0)::text AS "totalPoints",
        GREATEST(
          COALESCE(max(substring(profile->>'code' from '(?i)CUST-([0-9]+)')::numeric), 0),
          COALESCE(max(list_index + 1) FILTER (WHERE COALESCE(profile->>'code', '') = ''), 0)
        )::text AS "maxCode"
      FROM c`,
  ]);
  let total = rows.length ? Number(rows[0].total) : 0;
  if (!rows.length && offset > 0) {
    const [c] = await db.$queryRaw`${base} SELECT count(*)::int AS total FROM c ${where}`;
    total = Number(c.total);
  }
  const maxCode = Number(stats.maxCode) || 0;
  return {
    ids: rows.map((r: { id: string; listIndex: number }) => ({ id: r.id, listIndex: Number(r.listIndex) })),
    total,
    stats: {
      total: Number(stats.total),
      individualCount: Number(stats.total) - Number(stats.companyCount),
      companyCount: Number(stats.companyCount),
      totalCreditCustomers: Number(stats.totalCreditCustomers),
      totalDebt: Number(stats.totalDebt),
      totalPoints: Number(stats.totalPoints),
      nextCode: `CUST-${String(maxCode + 1).padStart(4, '0')}`,
    },
  };
}
