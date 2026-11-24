import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { loginThrottle } from '../auth/login-throttle';
import { ProductsService } from '../products/products.service';
import { canViewCost, costFilterFor } from '../products/cost-visibility';
import { ReportsService } from '../reports/reports.service';
import { PlanningService } from '../finance/planning.service';

/**
 * Data exports (owner, Round B): EVERY export needs a manager / owner PIN, every time, checked here.
 *  1. POST /exports/approve { kind, filters, pin } -> a single-use approval (approval_requests row, type DATA_EXPORT)
 *     bound to the requester, the kind and the exact filters, valid EXPORT_TTL_MS.
 *  2. POST /exports/<kind> with header `x-export-approval: <id>` and the same filters -> the rows; the approval is
 *     consumed (USED) and an audit_logs row DATA_EXPORT records who, the approver, what, the filters and the row count.
 * The export endpoints refuse (403 EXPORT_APPROVAL_REQUIRED) without a valid approval.
 */
export const EXPORT_TTL_MS = 2 * 60 * 1000;
export const EXPORT_HEADER = 'x-export-approval';

export const EXPORT_KINDS = {
  products: { label: 'สินค้า (Excel)', permission: 'MANAGE_INVENTORY' },
  report: { label: 'รายงาน', permission: 'VIEW_REPORTS' },
  'profit-loss': { label: 'กำไรขาดทุน (CSV)', permission: 'MANAGE_FINANCE' },
} as const;
export type ExportKind = keyof typeof EXPORT_KINDS;

const PIN_INVALID = 'PIN ไม่ถูกต้อง หรือไม่ใช่ PIN ของผู้จัดการ / เจ้าของร้าน';
export const REPORT_TABS = ['sales', 'bestsellers', 'inventory', 'payments', 'customers', 'purchases'] as const;
const REPORT_LIST_KEY: Record<string, string> = { bestsellers: 'allProducts', inventory: 'items', customers: 'allCustomers' };

/** JSON with sorted keys (the filters hash must not depend on key order). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
export const exportHash = (kind: string, filters: unknown) => createHash('sha256').update(`export|${kind}|${stableJson(filters ?? {})}`).digest('hex');

/** Same rule as RolesGuard for a permission (ADMIN / MANAGER / ALL / the permission). */
export function hasPermission(user: any, perm: string): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions.map(String) : [];
  return perms.includes('ALL') || perms.includes(perm);
}

export interface ProductExportFilters {
  categoryIds?: string[];
  /** all | instock | low | nostock */
  stock?: string;
  /** all | active | inactive */
  status?: string;
  supplierId?: string;
}

@Injectable()
export class ExportsService {
  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
    private reports: ReportsService,
    private planning: PlanningService,
  ) {}

  private kindOf(raw: unknown): ExportKind {
    const k = String(raw || '') as ExportKind;
    if (!(k in EXPORT_KINDS)) throw new BadRequestException('ประเภทการส่งออกไม่ถูกต้อง');
    return k;
  }

  /** Step 1: a manager / owner PIN approves this exact export. */
  async approve(body: { kind?: unknown; filters?: unknown; pin?: unknown }, user: any, ip = 'unknown') {
    const kind = this.kindOf(body?.kind);
    if (!hasPermission(user, EXPORT_KINDS[kind].permission)) throw new ForbiddenException('คุณไม่มีสิทธิ์ส่งออกข้อมูลนี้');
    const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {};
    const key = `export-pin:${ip}`;
    loginThrottle.assertAllowed(key);
    const pin = typeof body?.pin === 'string' ? body.pin : '';
    const candidates = /^\d{4,6}$/.test(pin)
      ? await this.prisma.user.findMany({ where: { isActive: true, pinCode: { not: null }, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true, fullName: true, username: true, role: true, pinCode: true } })
      : [];
    let approver: (typeof candidates)[number] | undefined;
    for (const u of candidates) if (u.pinCode && (await bcrypt.compare(pin, u.pinCode))) { approver = u; break; }
    if (!approver) {
      loginThrottle.fail(key);
      throw new ForbiddenException(PIN_INVALID); // 403, never 401 (a 401 logs the user out)
    }
    const row = await this.prisma.approvalRequest.create({
      data: {
        type: 'DATA_EXPORT', status: 'APPROVED', channel: 'PIN', requestedById: user.id, approvedById: approver.id,
        contextHash: exportHash(kind, filters), amount: 0,
        reasons: [{ code: 'DATA_EXPORT', message: `ส่งออกข้อมูล: ${EXPORT_KINDS[kind].label}` }] as any,
        summary: { kind, filters } as any,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS), decidedAt: new Date(),
      },
    });
    return { approvalId: row.id, approvedBy: approver.fullName || approver.username, expiresAt: row.expiresAt };
  }

  /** Step 2 guard: consume the approval (single use, same user / kind / filters, not expired). */
  private async consume(approvalId: unknown, kind: ExportKind, filters: unknown, user: any) {
    const id = typeof approvalId === 'string' ? approvalId.trim() : '';
    const refuse = () => new ForbiddenException({ statusCode: 403, code: 'EXPORT_APPROVAL_REQUIRED', message: 'การส่งออกข้อมูลต้องให้ผู้จัดการ / เจ้าของร้านใส่ PIN ทุกครั้ง' });
    if (!id || !user?.id) throw refuse();
    const now = new Date();
    const res = await this.prisma.approvalRequest.updateMany({
      where: { id, type: 'DATA_EXPORT', status: 'APPROVED', requestedById: user.id, contextHash: exportHash(kind, filters ?? {}), expiresAt: { gt: now } },
      data: { status: 'USED', usedAt: now, usedRef: kind },
    });
    if (res.count !== 1) throw refuse();
    return this.prisma.approvalRequest.findUnique({ where: { id }, select: { id: true, approvedById: true } });
  }

  private async audit(user: any, approval: { id: string; approvedById: string | null } | null, kind: ExportKind, filters: unknown, rowCount: number, extra: Record<string, unknown> = {}) {
    const approver = approval?.approvedById ? await this.prisma.user.findUnique({ where: { id: approval.approvedById }, select: { fullName: true, username: true } }) : null;
    await this.prisma.auditLog.create({
      data: {
        userId: user?.id ?? null, action: 'DATA_EXPORT', entity: 'Export', entityId: approval?.id ?? null,
        details: {
          kind, label: EXPORT_KINDS[kind].label, filters: (filters ?? {}) as any, rowCount, ...extra,
          userName: user?.fullName || user?.username || null,
          approvedById: approval?.approvedById ?? null, approvedBy: approver?.fullName || approver?.username || null,
        },
      },
    });
  }

  /** Normalized product filters (what the hash and the query use). */
  static productFilters(raw: any): ProductExportFilters {
    const f = raw && typeof raw === 'object' ? raw : {};
    const stock = ['all', 'instock', 'low', 'nostock'].includes(f.stock) ? f.stock : 'all';
    const status = ['all', 'active', 'inactive'].includes(f.status) ? f.status : 'all';
    const categoryIds = Array.isArray(f.categoryIds) ? [...new Set(f.categoryIds.filter((c: unknown) => typeof c === 'string').map((c: string) => c.slice(0, 64)))].sort() as string[] : [];
    const supplierId = typeof f.supplierId === 'string' && f.supplierId ? f.supplierId.slice(0, 64) : undefined;
    return { categoryIds, stock, status, ...(supplierId ? { supplierId } : {}) };
  }

  async exportProducts(approvalId: unknown, rawFilters: unknown, user: any) {
    const filters = ExportsService.productFilters(rawFilters);
    const approval = await this.consume(approvalId, 'products', rawFilters ?? {}, user);
    const rows: any[] = [];
    for (let page = 1; page < 10_000; page++) {
      const r = await this.products.page({
        page, limit: 500, categoryIds: filters.categoryIds?.length ? filters.categoryIds : undefined, supplierId: filters.supplierId,
        stock: filters.stock, status: filters.status, canViewCost: canViewCost(user),
      });
      rows.push(...r.data);
      if (r.data.length < 500 || rows.length >= r.meta.total) break;
    }
    const data = costFilterFor(user)(rows);
    await this.audit(user, approval, 'products', filters, data.length);
    return { data, total: data.length, filters };
  }

  async exportReport(approvalId: unknown, body: any, user: any) {
    const tab = String(body?.tab || '');
    if (!(REPORT_TABS as readonly string[]).includes(tab)) throw new BadRequestException('รายงานที่ส่งออกไม่ถูกต้อง');
    const params = body?.params && typeof body.params === 'object' ? body.params : {};
    const pick = (k: string) => (typeof params[k] === 'string' ? params[k] : undefined);
    const q = { range: pick('range'), start: pick('start'), end: pick('end') };
    const filters = { tab, params: body?.params ?? {} };
    const approval = await this.consume(approvalId, 'report', filters, user);
    const listKey = REPORT_LIST_KEY[tab];
    let data: any;
    if (!listKey) {
      data = (await this.reports.getReportTabs({ ...q, tab }, user) as any)[tab];
    } else {
      const rows: any[] = [];
      for (let page = 1; page < 10_000; page++) {
        const r = (await this.reports.getReportTabs({ ...q, tab, page: String(page), limit: '500' }, user) as any)[tab];
        if (!data) data = r;
        const chunk = (r?.[listKey] || []) as any[];
        rows.push(...chunk);
        if (chunk.length < 500 || rows.length >= Number(r?.total || 0)) break;
      }
      data = { ...data, [listKey]: rows, total: rows.length, page: 1, limit: rows.length };
    }
    const rowCount = listKey ? data[listKey].length
      : tab === 'sales' ? (data?.dailyBreakdown || []).length
      : tab === 'payments' ? (data?.channels || []).length + 2
      : (data?.supplierBreakdown || []).length;
    await this.audit(user, approval, 'report', filters, rowCount, { tab });
    return { tab, data, rowCount };
  }

  async exportProfitLoss(approvalId: unknown, body: any, user: any) {
    const from = typeof body?.from === 'string' ? body.from : undefined;
    const to = typeof body?.to === 'string' ? body.to : undefined;
    const filters = { from: from ?? null, to: to ?? null };
    const approval = await this.consume(approvalId, 'profit-loss', filters, user);
    const data: any = await this.planning.profitAndLoss({ from, to });
    await this.audit(user, approval, 'profit-loss', filters, 12 + Object.keys(data?.expenses || {}).length);
    return { data };
  }
}
