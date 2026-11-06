import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from '../auth/jwt-secret';
import { loginThrottle } from '../auth/login-throttle';
import { realtimeBus } from '../events/events.service';

export interface ApprovalReason { code: 'DISCOUNT_LIMIT' | 'BELOW_PRICE_FLOOR' | 'BELOW_COST' | string; message: string }
export interface ApprovalTicketPayload {
  t: string; // type
  h: string; // context hash (exact bill)
  r: ApprovalReason[];
  a: number; // bill amount
  u: string; // requester user id
  term?: string | null;
  s?: unknown; // summary shown to the approver
  exp: number; // ms epoch
}
export interface ApprovalRules {
  maxDiscountPercent: Record<string, number>; // per role, % of the bill
  belowCostNeedsApproval: boolean;
  belowPriceFloorNeedsApproval: boolean;
}
export const DEFAULT_APPROVAL_RULES: ApprovalRules = {
  maxDiscountPercent: { CASHIER: 10, WAREHOUSE: 0, MANAGER: 100, ADMIN: 100 },
  belowCostNeedsApproval: true,
  belowPriceFloorNeedsApproval: true,
};

const TICKET_TTL_MS = 10 * 60 * 1000; // ticket and approval stay valid for 10 minutes
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (body: string) => createHmac('sha256', getJwtSecret()).update('approval:' + body).digest('base64url');

export function canApprove(user: { role?: string; permissions?: unknown } | null | undefined) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  const perms = Array.isArray(user.permissions) ? (user.permissions as unknown[]).map(String) : [];
  return perms.includes('ALL') || perms.includes('APPROVE_OVERRIDES');
}

@Injectable()
export class ApprovalsService {
  constructor(private prisma: PrismaService) {}

  // ─── rules ───
  async getRules(db: any = this.prisma): Promise<ApprovalRules> {
    const s = await db.storeSettings.findFirst({ select: { approvalRules: true } });
    const r = (s?.approvalRules || {}) as Partial<ApprovalRules>;
    return {
      maxDiscountPercent: { ...DEFAULT_APPROVAL_RULES.maxDiscountPercent, ...(r.maxDiscountPercent || {}) },
      belowCostNeedsApproval: r.belowCostNeedsApproval ?? DEFAULT_APPROVAL_RULES.belowCostNeedsApproval,
      belowPriceFloorNeedsApproval: r.belowPriceFloorNeedsApproval ?? DEFAULT_APPROVAL_RULES.belowPriceFloorNeedsApproval,
    };
  }

  async setRules(body: Partial<ApprovalRules>) {
    const cur = await this.getRules();
    const next: ApprovalRules = {
      maxDiscountPercent: { ...cur.maxDiscountPercent },
      belowCostNeedsApproval: typeof body.belowCostNeedsApproval === 'boolean' ? body.belowCostNeedsApproval : cur.belowCostNeedsApproval,
      belowPriceFloorNeedsApproval: typeof body.belowPriceFloorNeedsApproval === 'boolean' ? body.belowPriceFloorNeedsApproval : cur.belowPriceFloorNeedsApproval,
    };
    for (const [role, v] of Object.entries(body.maxDiscountPercent || {})) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new BadRequestException('เพดานส่วนลดต้องอยู่ระหว่าง 0-100%');
      next.maxDiscountPercent[role] = n;
    }
    const settings = await this.prisma.storeSettings.findFirst();
    if (settings) await this.prisma.storeSettings.update({ where: { id: settings.id }, data: { approvalRules: next as any } });
    else await this.prisma.storeSettings.create({ data: { approvalRules: next as any } });
    return next;
  }

  // ─── tickets: what needs approving, signed by the server so the reasons cannot be altered ───
  issueTicket(p: Omit<ApprovalTicketPayload, 'exp'>): string {
    const body = b64(JSON.stringify({ ...p, exp: Date.now() + TICKET_TTL_MS }));
    return `${body}.${sign(body)}`;
  }

  readTicket(ticket: string): ApprovalTicketPayload {
    const [body, sig] = String(ticket || '').split('.');
    if (!body || !sig) throw new BadRequestException('ข้อมูลคำขออนุมัติไม่ถูกต้อง');
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new BadRequestException('ข้อมูลคำขออนุมัติไม่ถูกต้อง');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ApprovalTicketPayload;
    if (payload.exp < Date.now()) throw new BadRequestException('คำขออนุมัติหมดเวลา กรุณากดชำระเงินใหม่');
    return payload;
  }

  private emit(ids: string[]) {
    realtimeBus.next({ entity: 'approval' as any, at: new Date().toISOString(), ids });
  }

  // ─── mode 1: approver types their PIN on the requester's terminal ───
  async approveWithPin(body: { ticket?: string; pin?: string; note?: string }, requester: { id: string }, ip = 'unknown') {
    const t = this.readTicket(String(body.ticket));
    if (t.u !== requester.id) throw new ForbiddenException('คำขออนุมัตินี้เป็นของผู้ใช้อื่น');
    const key = `approve-pin:${ip}`;
    loginThrottle.assertAllowed(key);
    const pin = String(body.pin || '');
    const candidates = /^\d{4,6}$/.test(pin)
      ? await this.prisma.user.findMany({ where: { isActive: true, pinCode: { not: null } }, select: { id: true, fullName: true, username: true, role: true, permissions: true, pinCode: true } })
      : [];
    let approver: (typeof candidates)[number] | undefined;
    for (const u of candidates) if (u.pinCode && (await bcrypt.compare(pin, u.pinCode))) { approver = u; break; }
    if (!approver) { loginThrottle.fail(key); throw new UnauthorizedException('PIN ไม่ถูกต้อง'); }
    loginThrottle.succeed(key);
    if (!canApprove(approver)) throw new ForbiddenException(`${approver.fullName} ไม่มีสิทธิ์อนุมัติ`);
    if (approver.id === requester.id) throw new ForbiddenException('อนุมัติรายการของตัวเองไม่ได้ ต้องเป็นผู้จัดการ/เจ้าของคนอื่น');
    const row = await this.prisma.approvalRequest.create({
      data: {
        type: t.t, status: 'APPROVED', channel: 'PIN', requestedById: t.u, approvedById: approver.id, terminalId: t.term ?? null,
        contextHash: t.h, amount: t.a, reasons: t.r as any, summary: (t.s ?? null) as any, decisionNote: body.note?.trim() || null,
        expiresAt: new Date(Date.now() + TICKET_TTL_MS), decidedAt: new Date(),
      },
    });
    this.emit([row.id]);
    return { approvalId: row.id, approvedBy: approver.fullName || approver.username, expiresAt: row.expiresAt };
  }

  // ─── mode 2 (structure ready): request waits for an approver on another device ───
  async createRemoteRequest(body: { ticket?: string }, requester: { id: string }) {
    const t = this.readTicket(String(body.ticket));
    if (t.u !== requester.id) throw new ForbiddenException('คำขออนุมัตินี้เป็นของผู้ใช้อื่น');
    const row = await this.prisma.approvalRequest.create({
      data: {
        type: t.t, status: 'PENDING', channel: 'REMOTE', requestedById: t.u, terminalId: t.term ?? null,
        contextHash: t.h, amount: t.a, reasons: t.r as any, summary: (t.s ?? null) as any, expiresAt: new Date(Date.now() + TICKET_TTL_MS),
      },
    });
    this.emit([row.id]);
    return { approvalId: row.id, status: row.status, expiresAt: row.expiresAt };
  }

  async decide(id: string, body: { approve?: boolean; note?: string }, approver: { id: string; role?: string; permissions?: unknown }) {
    if (!canApprove(approver)) throw new ForbiddenException('ไม่มีสิทธิ์อนุมัติ');
    const row = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ไม่พบคำขออนุมัติ');
    if (row.status !== 'PENDING') throw new BadRequestException('คำขอนี้ถูกตัดสินไปแล้ว');
    if (row.expiresAt < new Date()) {
      await this.prisma.approvalRequest.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('คำขอหมดเวลาแล้ว');
    }
    if (row.requestedById === approver.id) throw new ForbiddenException('อนุมัติรายการของตัวเองไม่ได้');
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: body.approve ? 'APPROVED' : 'REJECTED', approvedById: approver.id, decidedAt: new Date(), decisionNote: body.note?.trim() || null, expiresAt: new Date(Date.now() + TICKET_TTL_MS) },
    });
    this.emit([id]);
    return updated;
  }

  async get(id: string, viewer: { id: string; role?: string; permissions?: unknown }) {
    const row = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ไม่พบคำขออนุมัติ');
    if (row.requestedById !== viewer.id && !canApprove(viewer)) throw new ForbiddenException();
    return row;
  }

  async list(q: { status?: string; limit?: string; page?: string }) {
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const page = Math.max(1, Number(q.page) || 1);
    await this.prisma.approvalRequest.updateMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
    const where: any = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.approvedById].filter(Boolean) as string[]))];
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      data: rows.map((r) => ({ ...r, amount: Number(r.amount), requestedBy: users.get(r.requestedById) || '-', approvedBy: r.approvedById ? users.get(r.approvedById) || '-' : null })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Inside the sale transaction: the approval must be approved, unused, unexpired and for this exact bill. */
  async consume(tx: any, approvalId: string, contextHash: string, requesterId: string, usedRef: string) {
    const row = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!row || row.status !== 'APPROVED') throw new BadRequestException('ยังไม่ได้รับอนุมัติ หรือคำขอถูกปฏิเสธ');
    if (row.expiresAt < new Date()) throw new BadRequestException('การอนุมัติหมดเวลา กรุณาขออนุมัติใหม่');
    if (row.requestedById !== requesterId) throw new BadRequestException('การอนุมัตินี้เป็นของผู้ใช้อื่น');
    if (row.contextHash !== contextHash) throw new BadRequestException('รายการในบิลเปลี่ยนไปหลังได้รับอนุมัติ กรุณาขออนุมัติใหม่');
    const res = await tx.approvalRequest.updateMany({ where: { id: approvalId, status: 'APPROVED' }, data: { status: 'USED', usedAt: new Date(), usedRef } });
    if (res.count !== 1) throw new BadRequestException('การอนุมัตินี้ถูกใช้ไปแล้ว');
    return row;
  }
}
