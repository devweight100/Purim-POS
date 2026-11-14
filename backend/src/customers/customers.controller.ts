import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { customerPageIds, parseCustomerPageQuery } from './customer-list';
import { CHANGE_LOG_KEEP_MS, cursorUsable, decodeCursor, encodeCursor } from '../products/product-catalog';

/** Profile fields that control store credit: only debt managers may change them. */
export const CREDIT_FIELDS = ['creditLimit', 'creditTerms', 'isCreditBlocked'] as const;
const CREDIT_DEFAULTS: Record<string, any> = { creditLimit: 0, creditTerms: 30, isCreditBlocked: false };

export function canManageCredit(user: any): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  const perms: string[] = Array.isArray(user.permissions) ? user.permissions.map(String) : [];
  return perms.includes('ALL') || perms.includes('MANAGE_DEBTS');
}

const sameCreditValue = (field: string, a: any, b: any) =>
  field === 'isCreditBlocked' ? Boolean(a) === Boolean(b) : Number(a ?? CREDIT_DEFAULTS[field]) === Number(b ?? CREDIT_DEFAULTS[field]);

/**
 * Validate the credit fields present in `details` and return them normalised.
 * Throws 403 when a user without MANAGE_DEBTS tries to change them from `current`.
 */
export function checkCreditFields(details: Record<string, any>, current: Record<string, any>, user: any) {
  const out: Record<string, any> = {};
  for (const field of CREDIT_FIELDS) {
    if (details[field] === undefined) continue;
    let value = details[field];
    if (field === 'isCreditBlocked') {
      if (typeof value === 'string') value = value === 'true';
      value = Boolean(value);
    } else {
      if (value === null || value === '') value = CREDIT_DEFAULTS[field];
      const n = typeof value === 'number' ? value : Number(value);
      if (typeof value === 'boolean' || !Number.isFinite(n) || n < 0) {
        throw new BadRequestException(field === 'creditLimit' ? 'วงเงินเครดิตต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' : 'จำนวนวันเครดิตต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      }
      if (field === 'creditTerms' && !Number.isInteger(n)) throw new BadRequestException('จำนวนวันเครดิตต้องเป็นจำนวนเต็ม');
      if (field === 'creditLimit' && Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw new BadRequestException('วงเงินเครดิตมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
      value = n;
    }
    if (!sameCreditValue(field, value, current[field]) && !canManageCredit(user)) {
      throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขวงเงิน/เงื่อนไขเครดิตของลูกค้า (ต้องมีสิทธิ์จัดการลูกหนี้ หรือเป็นผู้จัดการ)');
    }
    out[field] = value;
  }
  return out;
}

function cleanName(name: any, required: boolean): string | undefined {
  if (name === undefined && !required) return undefined;
  const v = typeof name === 'string' ? name.trim() : '';
  if (!v) throw new BadRequestException('กรุณาระบุชื่อลูกค้า');
  return v;
}

function cleanPhone(phone: any): string | null | undefined {
  if (phone === undefined) return undefined;
  if (phone === null || phone === '') return null;
  const v = String(phone).trim();
  if (!v) return null;
  if (!/^[0-9+\-\s()]{3,20}$/.test(v)) throw new BadRequestException('เบอร์โทรศัพท์ไม่ถูกต้อง (ใช้ได้เฉพาะตัวเลข - + และช่องว่าง)');
  return v;
}

function cleanEmail(email: any): string | null | undefined {
  if (email === undefined) return undefined;
  if (email === null || String(email).trim() === '') return null;
  const v = String(email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new BadRequestException('รูปแบบอีเมลไม่ถูกต้อง');
  return v;
}

const optText = (v: any) => (v === undefined ? undefined : v === null ? null : String(v));

function rethrowCustomerError(e: any): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new ConflictException('เบอร์โทรศัพท์นี้มีลูกค้าใช้อยู่แล้ว');
    if (e.code === 'P2003') throw new ConflictException('ลบลูกค้าไม่ได้ เพราะมีประวัติการขาย/หนี้/เคลมผูกอยู่');
    if (e.code === 'P2025') throw new NotFoundException('ไม่พบลูกค้านี้');
  }
  throw e;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('POS_SELL', 'MANAGE_DEBTS', 'VIEW_REPORTS')
@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@Body() data: any, @Request() req: any) {
    if (!data || typeof data !== 'object') throw new BadRequestException('ข้อมูลลูกค้าไม่ถูกต้อง');
    const { name, phone, email, address, note, id, points, createdAt, updatedAt, currentDebt, profile: ignoredProfile, ...profile } = data;
    Object.assign(profile, checkCreditFields(profile, CREDIT_DEFAULTS, req?.user));
    const cleanPhoneValue = cleanPhone(phone);
    if (cleanPhoneValue && (await this.prisma.customer.findUnique({ where: { phone: cleanPhoneValue } }))) {
      throw new ConflictException('เบอร์โทรศัพท์นี้มีลูกค้าใช้อยู่แล้ว');
    }
    try {
      const saved = await this.prisma.customer.create({
        data: { name: cleanName(name, true)!, phone: cleanPhoneValue ?? null, email: cleanEmail(email) ?? null, address: optText(address), note: optText(note), profile },
      });
      return { ...profile, ...saved };
    } catch (e) {
      rethrowCustomerError(e);
    }
  }

  /**
   * Without `page`: every customer (POS customer picker / lookups; ?search= matches name or phone).
   * With `page`: one page for the customers screen: ?page&limit(<=500)&search&type(INDIVIDUAL|COMPANY|credit|hasDebt)
   * &priceLevel -> { data, meta, stats } (stats = cards over every customer + next free CUST code).
   * currentDebt is summed by the database (no debt rows in the response).
   */
  @Get()
  async findAll(@Query() query: Record<string, unknown>) {
    if (query.page !== undefined) {
      const q = parseCustomerPageQuery(query);
      const page = await customerPageIds(this.prisma, q);
      const rows = await this.customerRows({ id: { in: page.ids.map((r) => r.id) } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const data = page.ids.filter((r) => byId.has(r.id)).map((r) => ({ ...byId.get(r.id)!, listIndex: r.listIndex }));
      return { data, meta: { total: page.total, page: q.page, limit: q.limit, totalPages: Math.ceil(page.total / q.limit) }, stats: page.stats };
    }
    const search = query.search;
    if (search !== undefined && typeof search !== 'string') throw new BadRequestException('คำค้นหาไม่ถูกต้อง');
    const where = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as any } },
        { phone: { contains: search, mode: 'insensitive' as any } }
      ]
    } : {};
    return this.customerRows(where);
  }

  private lastChangeLogPrune = 0;

  /**
   * Customer list delta sync (GET /customers/sync?since=<cursor>), same design as GET /products/sync.
   * No / unusable cursor, or a customer was deleted since the cursor: every customer (`full: true`, rows = GET
   * /customers). Otherwise the customers changed since the cursor (rows of customer_changes written by transactions
   * not visible in the cursor's snapshot: the customer row or its debts) with `listIndex` (position in the full
   * list, for the fallback CUST code). Read in one REPEATABLE READ transaction so the cursor matches the data.
   */
  @Get('sync')
  async sync(@Query('since') since?: unknown) {
    const parsed = decodeCursor(since);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [head] = await tx.$queryRaw<{ snapshot: string; epoch: string }[]>`
          SELECT pg_current_snapshot()::text AS snapshot,
                 (SELECT oid FROM pg_database WHERE datname = current_database())::text || '-' || 'customer_changes'::regclass::oid::text AS epoch`;
        const now = Date.now();
        const cursor = encodeCursor({ epoch: head.epoch, at: now, snapshot: head.snapshot });
        let usable = cursorUsable(parsed, head.epoch, now);
        if (usable) {
          const [chk] = await tx.$queryRaw<{ ok: boolean }[]>`
            SELECT pg_snapshot_xmax(${parsed!.snapshot}::pg_snapshot) <= pg_snapshot_xmax(pg_current_snapshot()) AS ok`;
          usable = !!chk?.ok;
        }
        const full = async () => ({ cursor, full: true, customers: await this.customerRows({}, tx), deleted: [] as string[] });
        if (!usable) return full();
        const changed = await tx.$queryRaw<{ customer_id: string }[]>`
          SELECT DISTINCT c.customer_id FROM customer_changes c
          WHERE c.xid >= pg_snapshot_xmin(${parsed!.snapshot}::pg_snapshot)
            AND NOT pg_visible_in_snapshot(c.xid, ${parsed!.snapshot}::pg_snapshot)`;
        if (!changed.length) return { cursor, full: false, customers: [], deleted: [] as string[] };
        const ids = changed.map((r) => r.customer_id);
        const rows = await this.customerRows({ id: { in: ids } }, tx);
        // a deletion renumbers the fallback codes of the later rows: send the whole list then (rare)
        if (rows.length < ids.length) return full();
        const idx = await tx.$queryRaw<{ id: string; list_index: number }[]>`
          SELECT id, list_index::int AS list_index FROM (
            SELECT id, (row_number() OVER (ORDER BY created_at, id)) - 1 AS list_index FROM customers) t
          WHERE id = ANY(${ids}::text[])`;
        const indexOf = new Map(idx.map((r) => [r.id, r.list_index]));
        return { cursor, full: false, customers: rows.map((r) => ({ ...r, listIndex: indexOf.get(r.id) ?? 0 })), deleted: [] as string[] };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 120000 },
    );
    this.pruneChangeLog();
    return result;
  }

  /** Drop change-log rows older than any usable cursor (at most once an hour, in the background). */
  private pruneChangeLog() {
    const now = Date.now();
    if (now - this.lastChangeLogPrune < 3600_000) return;
    this.lastChangeLogPrune = now;
    const keepDays = Math.round(CHANGE_LOG_KEEP_MS / 86_400_000);
    void this.prisma.$executeRaw`DELETE FROM customer_changes WHERE changed_at < CURRENT_TIMESTAMP - make_interval(days => ${keepDays}::int)`.catch(() => {
      this.lastChangeLogPrune = 0;
    });
  }

  private async customerRows(where: Prisma.CustomerWhereInput, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const rows = await db.customer.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const debts = rows.length
      ? await db.customerDebt.groupBy({
          by: ['customerId'],
          where: Object.keys(where).length ? { customerId: { in: rows.map((r) => r.id) } } : {},
          _sum: { remainingAmount: true },
        })
      : [];
    const debtOf = new Map(debts.map((d) => [d.customerId, Number(d._sum.remainingAmount) || 0]));
    return rows.map((row) => ({ ...((row.profile as any) || {}), ...row, phone: row.phone || '', currentDebt: debtOf.get(row.id) || 0 }));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  @Get(':id/orders')
  getOrders(@Param('id') id: string) {
    return this.prisma.order.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' } });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    if (!data || typeof data !== 'object') throw new BadRequestException('ข้อมูลลูกค้าไม่ถูกต้อง');
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ไม่พบลูกค้านี้');
    const { name, phone, email, address, note, id: ignoredId, points, createdAt, updatedAt, currentDebt, debts, profile: ignoredProfile, ...details } = data;
    const current = (existing.profile as any) || {};
    Object.assign(details, checkCreditFields(details, current, req?.user));
    const profile = { ...current, ...details };
    const cleanPhoneValue = cleanPhone(phone);
    if (cleanPhoneValue && (await this.prisma.customer.findFirst({ where: { phone: cleanPhoneValue, id: { not: id } } }))) {
      throw new ConflictException('เบอร์โทรศัพท์นี้มีลูกค้าใช้อยู่แล้ว');
    }
    try {
      const saved = await this.prisma.customer.update({
        where: { id },
        data: { name: cleanName(name, false), phone: cleanPhoneValue, email: cleanEmail(email), address: optText(address), note: optText(note), profile },
      });
      return { ...profile, ...saved };
    } catch (e) {
      rethrowCustomerError(e);
    }
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_DEBTS')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, include: { _count: { select: { debts: true, orders: true, claims: true } } } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้านี้');
    if (customer._count.debts > 0) throw new ConflictException('ลบลูกค้าไม่ได้ เพราะมีประวัติหนี้/การขายเชื่อ');
    if (customer._count.orders > 0 || customer._count.claims > 0) throw new ConflictException('ลบลูกค้าไม่ได้ เพราะมีประวัติการขายหรือการเคลมผูกอยู่');
    try {
      return await this.prisma.customer.delete({ where: { id } });
    } catch (e) {
      rethrowCustomerError(e);
    }
  }
}
