import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import * as os from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { realtimeBus } from '../events/events.service';
import { LineService } from './line.service';
import { round2 } from '../../../shared/src/money';

/**
 * LINE staff-group notifications for new online orders (owner, Round B item 10; docs/round-b.md):
 *  - the bot is invited to the staff LINE group; the webhook (POST /api/public/line/webhook, the only extra path the
 *    3080 gateway lets through) records the group from join / message events, after checking X-Line-Signature with
 *    the channel secret;
 *  - ตั้งค่า > ร้านออนไลน์: pick the group, "ส่งข้อความทดสอบ";
 *  - a new online order is pushed to the group at once; while it is still NEW and nobody claimed it, a reminder goes
 *    every 10 minutes, at most 6 reminders. The schedule lives in online_orders (staff_alert_next_at / _count), so a
 *    restart continues it; every send is logged in online_order_line_logs (shown on the order).
 */
export const STAFF_REMIND_EVERY_MS = 10 * 60 * 1000;
export const STAFF_MAX_REMINDERS = 6;
export { LINE_WEBHOOK_PATH } from '../../../shared/src/public-exposure';
import { LINE_WEBHOOK_PATH } from '../../../shared/src/public-exposure';

/** X-Line-Signature = base64(HMAC-SHA256(channel secret, raw body)). */
export function lineSignatureOk(raw: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('base64'));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** express.json verify hook: keeps the exact bytes of the LINE webhook body for the signature check. */
export function captureLineRawBody(req: any, _res: unknown, buf: Buffer) {
  if (String(req.originalUrl || req.url || '').split('?')[0] === LINE_WEBHOOK_PATH) req.rawBody = Buffer.from(buf);
}

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function lanBackOfficeUrl(): string {
  const port = process.env.POS_PORT || 3000;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return `http://${n.address}:${port}`;
  }
  return `http://localhost:${port}`;
}

@Injectable()
export class LineStaffService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('LineStaff');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private quotaCache: { at: number; full: boolean } | null = null;

  constructor(private readonly prisma: PrismaService, private readonly line: LineService) {}

  onModuleInit() {
    // LINE_ALERT_TICK_MS=0 turns the timer off (tests drive runDue themselves)
    const tick = Number(process.env.LINE_ALERT_TICK_MS ?? 60_000);
    if (!Number.isFinite(tick) || tick <= 0) return;
    this.timer = setInterval(() => void this.runDue().catch((e) => this.log.warn(`staff alerts: ${e?.message || e}`)), tick);
    this.timer.unref?.();
    // catch up after a restart (orders whose reminder fell due while the server was off)
    setTimeout(() => void this.runDue().catch(() => undefined), 5_000).unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ───────────────────────── webhook ─────────────────────────

  async webhook(raw: Buffer | undefined, signature: string | undefined, body: any) {
    const c = await this.line.config();
    if (!c.channelSecret) throw new UnauthorizedException('ยังไม่ได้ตั้ง Channel secret');
    if (!raw || !lineSignatureOk(raw, signature, c.channelSecret)) throw new UnauthorizedException('ลายเซ็น LINE ไม่ถูกต้อง');
    const events: any[] = Array.isArray(body?.events) ? body.events.slice(0, 100) : [];
    for (const e of events) {
      const src = e?.source;
      if (src?.type !== 'group' || typeof src.groupId !== 'string' || !/^C[0-9a-f]{32}$/i.test(src.groupId)) continue;
      const groupId: string = src.groupId;
      if (e.type === 'leave') {
        await this.prisma.lineGroup.updateMany({ where: { groupId }, data: { leftAt: new Date(), lastEventAt: new Date() } });
        continue;
      }
      const known = await this.prisma.lineGroup.findUnique({ where: { groupId } });
      const name = !known?.name || e.type === 'join' ? await this.line.groupName(groupId) : known.name;
      await this.prisma.lineGroup.upsert({
        where: { groupId },
        create: { groupId, name, joinedAt: new Date(), lastEventAt: new Date() },
        update: { name: name ?? known?.name ?? null, leftAt: null, lastEventAt: new Date(), ...(e.type === 'join' ? { joinedAt: new Date() } : {}) },
      });
    }
    return { ok: true };
  }

  // ───────────────────────── settings ─────────────────────────

  async groups() {
    const c = await this.line.config();
    const rows = await this.prisma.lineGroup.findMany({ orderBy: [{ leftAt: { sort: 'asc', nulls: 'first' } }, { lastEventAt: 'desc' }], take: 50 });
    return {
      staffGroupId: c.staffGroupId,
      hasChannelSecret: !!c.channelSecret,
      webhookPath: LINE_WEBHOOK_PATH,
      webhookUrl: c.publicBaseUrl ? `${c.publicBaseUrl.replace(/\/+$/, '')}${LINE_WEBHOOK_PATH}` : null,
      backOfficeUrl: c.backOfficeUrl || lanBackOfficeUrl(),
      groups: rows.map((g) => ({ groupId: g.groupId, name: g.name, joinedAt: g.joinedAt, lastEventAt: g.lastEventAt, left: !!g.leftAt, selected: g.groupId === c.staffGroupId })),
    };
  }

  async testGroup(groupId: string) {
    const g = await this.prisma.lineGroup.findUnique({ where: { groupId } });
    if (!g) throw new NotFoundException('ไม่พบกลุ่มนี้ (ให้เชิญบอทเข้ากลุ่มก่อน)');
    const store = (await this.prisma.storeSettings.findFirst({ select: { storeName: true } }))?.storeName || 'ร้าน';
    const r = await this.line.pushResult(groupId, [{ type: 'text', text: `ทดสอบจาก ${store}: กลุ่มนี้จะได้รับแจ้งเตือนออเดอร์ออนไลน์ใหม่ และเตือนซ้ำทุก 10 นาทีจนกว่าจะมีคนรับออเดอร์` }]);
    return { ok: r.ok, message: r.ok ? `ส่งข้อความทดสอบไปที่กลุ่ม "${g.name || groupId}" แล้ว` : r.text };
  }

  // ───────────────────────── alerts ─────────────────────────

  /** A new online order: the first alert is due now (sent by runDue). */
  async orderPlaced(orderId: string) {
    await this.prisma.onlineOrder.update({ where: { id: orderId }, data: { staffAlertNextAt: new Date(), staffAlertCount: 0 } });
    void this.runDue().catch((e) => this.log.warn(`staff alert: ${e?.message || e}`));
  }

  /** Sends every alert that is due (one run at a time). Returns how many orders were handled. */
  runDue(now = new Date()): Promise<number> {
    if (this.running) return this.running.then(() => this.runDue(now));
    this.running = this.runDueOnce(now).finally(() => { this.running = null; });
    return this.running;
  }

  private async monthlyQuotaFull(): Promise<boolean> {
    if (this.quotaCache && Date.now() - this.quotaCache.at < 10 * 60 * 1000) return this.quotaCache.full;
    const q = await this.line.quota();
    const full = !!(q && q.limited && q.limit !== null && q.used >= q.limit);
    this.quotaCache = { at: Date.now(), full };
    return full;
  }

  private async log_(orderId: string, kind: string, target: string | null, ok: boolean, result: string) {
    await this.prisma.onlineOrderLineLog.create({ data: { onlineOrderId: orderId, kind, target, ok, result: result.slice(0, 300) } });
    realtimeBus.next({ entity: 'onlineOrder', at: new Date().toISOString(), ids: [orderId] });
  }

  private async runDueOnce(now: Date): Promise<number> {
    const due = await this.prisma.onlineOrder.findMany({
      where: { staffAlertNextAt: { lte: now } },
      orderBy: { staffAlertNextAt: 'asc' },
      take: 50,
      include: { items: { select: { id: true } } },
    });
    if (!due.length) return 0;
    const c = await this.line.config();
    const store = (await this.prisma.storeSettings.findFirst({ select: { storeName: true } }))?.storeName || 'ร้าน';
    const base = (c.backOfficeUrl || lanBackOfficeUrl()).replace(/\/+$/, '');
    let handled = 0;
    for (const o of due) {
      // accepted / claimed / cancelled since: nothing more to send
      if (o.status !== 'NEW' || o.claimedById) {
        await this.prisma.onlineOrder.updateMany({ where: { id: o.id, staffAlertNextAt: o.staffAlertNextAt }, data: { staffAlertNextAt: null } });
        continue;
      }
      const count = o.staffAlertCount + 1; // 1 = the new-order alert, 2..7 = reminders 1..6
      const next = count >= 1 + STAFF_MAX_REMINDERS ? null : new Date(now.getTime() + STAFF_REMIND_EVERY_MS);
      // take this send (conditional: two runs never send the same alert twice)
      const took = await this.prisma.onlineOrder.updateMany({
        where: { id: o.id, staffAlertNextAt: o.staffAlertNextAt, staffAlertCount: o.staffAlertCount },
        data: { staffAlertNextAt: next, staffAlertCount: count },
      });
      if (took.count !== 1) continue;
      handled++;
      const kind = count === 1 ? 'NEW' : 'REMINDER';
      if (!c.messagingToken || !c.staffGroupId) {
        await this.prisma.onlineOrder.update({ where: { id: o.id }, data: { staffAlertNextAt: null } });
        await this.log_(o.id, kind, null, false, !c.messagingToken ? 'ไม่ได้แจ้งกลุ่มพนักงาน (ยังไม่ได้ตั้งค่า Messaging API)' : 'ไม่ได้แจ้งกลุ่มพนักงาน (ยังไม่ได้เลือกกลุ่ม LINE)');
        continue;
      }
      if (await this.monthlyQuotaFull()) {
        await this.prisma.onlineOrder.update({ where: { id: o.id }, data: { staffAlertNextAt: null } });
        await this.log_(o.id, kind, c.staffGroupId, false, 'ไม่ได้แจ้งกลุ่มพนักงาน (โควตาข้อความ LINE เดือนนี้หมดแล้ว)');
        continue;
      }
      const how = o.fulfillment === 'PICKUP' ? 'รับเองที่ร้าน' : 'ร้านไปส่ง';
      const minutes = Math.max(1, Math.round((now.getTime() - o.createdAt.getTime()) / 60000));
      const head = kind === 'NEW'
        ? `${store}: ออเดอร์ออนไลน์ใหม่ ${o.orderNo}`
        : `เตือนครั้งที่ ${count - 1}/${STAFF_MAX_REMINDERS}: ออเดอร์ ${o.orderNo} ยังไม่มีคนรับ (รอมา ${minutes} นาที)`;
      const text = [
        head,
        `ลูกค้า: ${o.contactName} ${o.contactPhone}`,
        `${o.items.length} รายการ ยอด ฿${fmt(round2(Number(o.totalAmount)))}`,
        how,
        `เปิดในหลังบ้าน: ${base}/online-orders?id=${o.id}`,
      ].join('\n');
      const r = await this.line.pushResult(c.staffGroupId, [{ type: 'text', text }]);
      if (r.status === 429) this.quotaCache = null; // ask LINE again next time
      await this.log_(o.id, kind, c.staffGroupId, r.ok, kind === 'NEW' ? `แจ้งกลุ่มพนักงาน: ${r.text}` : `เตือนครั้งที่ ${count - 1}: ${r.text}`);
    }
    return handled;
  }

  /** Send log of one order (newest first). */
  logs(orderId: string) {
    return this.prisma.onlineOrderLineLog.findMany({ where: { onlineOrderId: orderId }, orderBy: { createdAt: 'desc' }, take: 20, select: { kind: true, ok: true, result: true, createdAt: true } });
  }

  static validateGroupId(v: unknown): string | null {
    if (v === null || v === '' || v === undefined) return null;
    if (typeof v !== 'string' || !/^C[0-9a-f]{32}$/i.test(v)) throw new BadRequestException('รหัสกลุ่ม LINE ไม่ถูกต้อง');
    return v;
  }
}
