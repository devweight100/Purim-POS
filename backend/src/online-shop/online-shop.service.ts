import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { userHasPermission } from '../auth/permissions';
import { LineMessage, LineService, ShopConfigRow } from './line.service';
import { issueSession, RateLimiter, readSession, safeEqual, ShopSession, signValue } from './shop-session';
import { onlineOrderPaid$ } from './online-order-payment';
import { qrPng } from './qr-png';
import { CLAIMABLE, claimRefusal, claimTime, ensureClaim, isManager, RELEASED, StaffUser, tryClaim } from './online-order-claim';
import {
  deliveryFeeFor,
  Fulfillment,
  levelNames,
  nextStatuses,
  normalizeLevel,
  normalizeThaiPhone,
  ONLINE_LIMITS,
  ONLINE_STATUS_LABELS,
  onlineLineTotal,
  onlineOrderTotals,
  OnlineOrderStatus,
  parseDeliveryFee,
  PriceLevel,
  shopUnits,
} from '../../../shared/src/online-shop';
import { buildPromptPayPayload, isValidPromptPayAmount, maskPromptPayId, normalizePromptPayId, PromptPayIdType } from '../../../shared/src/promptpay';
import { round2 } from '../../../shared/src/money';

export const DELIVERY_SKU = 'SYS-DELIVERY-FEE';
// pg_advisory_xact_lock(742091, 7): online order numbers / edits (literal: a bound parameter makes the call ambiguous)
const PAYABLE: OnlineOrderStatus[] = ['ACCEPTED', 'PREPARING', 'DELIVERING'];

class TooMany extends HttpException {
  constructor(msg = 'ทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่') {
    super({ statusCode: 429, message: msg }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+\n/g, '\n').slice(0, max) : '');
const money = (v: unknown) => round2(Number(v) || 0);
const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export interface PublicCtx {
  ip: string;
  isPublic: boolean;
  session: ShopSession | null;
}

@Injectable()
export class OnlineShopService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OnlineShop');
  private readonly ipLimiter = new RateLimiter(240, 60_000);
  private readonly sessionLimiter = new RateLimiter(30, 60_000);
  private readonly orderUserLimiter = new RateLimiter(6, 10 * 60_000);
  private readonly orderIpLimiter = new RateLimiter(30, 10 * 60_000);
  private readonly linkLimiter = new RateLimiter(5, 60 * 60_000);
  private categoryCache: { at: number; rows: unknown[] } | null = null;
  private paidSub?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly line: LineService,
    private readonly products: ProductsService,
  ) {}

  onModuleInit() {
    this.paidSub = onlineOrderPaid$.subscribe(({ onlineOrderId, done }) => {
      if (done) void this.notify(onlineOrderId, 'DONE');
    });
  }

  onModuleDestroy() {
    this.paidSub?.unsubscribe();
  }

  // ───────────────────────── rate limits / identity ─────────────────────────

  hit(ctx: PublicCtx) {
    if (!this.ipLimiter.take(ctx.ip)) throw new TooMany();
  }

  private requireSession(ctx: PublicCtx): ShopSession {
    if (!ctx.session) throw new HttpException({ statusCode: 401, message: 'กรุณาเปิดร้านจาก LINE อีกครั้ง' }, HttpStatus.UNAUTHORIZED);
    return ctx.session;
  }

  private async requireOpen(): Promise<ShopConfigRow> {
    const c = await this.line.config();
    if (!c.enabled) throw new ForbiddenException('ร้านยังไม่เปิดรับออเดอร์ออนไลน์');
    return c;
  }

  /** Test profile allowed: LINE login not configured and the request did not come through the tunnel. */
  private devAllowed(c: ShopConfigRow, isPublic: boolean) {
    return !isPublic && !LineService.loginReady(c);
  }

  async publicConfig(ctx: PublicCtx) {
    this.hit(ctx);
    const c = await this.line.config();
    const s = await this.prisma.storeSettings.findFirst({ select: { storeName: true, branchName: true, storePhone: true, storeAddress: true } });
    const loginReady = LineService.loginReady(c);
    const dev = this.devAllowed(c, ctx.isPublic);
    return {
      // through the tunnel the shop is open only when LINE login works; on the LAN the test profile is enough
      open: c.enabled && (loginReady || dev),
      liffId: loginReady ? c.liffId : null,
      devLogin: dev,
      storeName: s?.storeName || 'ร้านค้า',
      branchName: s?.branchName || null,
      storePhone: s?.storePhone || null,
      storeAddress: s?.storeAddress || null,
      allowPickup: c.allowPickup,
      allowDelivery: c.allowDelivery,
      notice: c.notice,
      levelNames: levelNames(c.levelNames),
    };
  }

  /** LIFF ID token (or the test profile) -> our session token. */
  async createSession(ctx: PublicCtx, body: any) {
    if (!this.sessionLimiter.take(ctx.ip)) throw new TooMany();
    const c = await this.line.config();
    let sub: string;
    let name: string | undefined;
    let picture: string | undefined;
    let dev = false;
    if (typeof body?.idToken === 'string' && body.idToken) {
      if (!LineService.loginReady(c)) throw new BadRequestException('ร้านยังไม่ได้ตั้งค่า LINE');
      if (body.idToken.length > 4000) throw new BadRequestException('LINE token ไม่ถูกต้อง');
      const v = await this.line.verifyIdToken(body.idToken, c.loginChannelId!);
      if (!v.ok) throw new HttpException({ statusCode: 401, message: v.error }, HttpStatus.UNAUTHORIZED);
      sub = v.sub;
      name = v.name;
      picture = v.picture;
    } else if (body?.dev) {
      if (!this.devAllowed(c, ctx.isPublic)) throw new ForbiddenException('โหมดทดสอบใช้ได้เฉพาะในร้าน เมื่อยังไม่ได้ตั้งค่า LINE');
      const id = String(body.dev.id || 'tester').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'tester';
      sub = `dev-${id}`;
      name = text(body.dev.name, 60) || 'ลูกค้าทดสอบ';
      dev = true;
    } else {
      throw new BadRequestException('กรุณาเปิดร้านจาก LINE');
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sub)) throw new BadRequestException('บัญชี LINE ไม่ถูกต้อง');
    await this.prisma.shopVisitor.upsert({
      where: { lineUserId: sub },
      create: { lineUserId: sub, displayName: name || null, pictureUrl: picture || null },
      update: { displayName: name || undefined, pictureUrl: picture || undefined },
    });
    const session = issueSession({ sub, n: name, p: picture, ...(dev ? { dev: true } : {}) });
    return { ...session, ...(await this.me({ ...ctx, session: readSession(session.token) })) };
  }

  /** The visitor's view: profile, linked member (price level / fee), remembered contact, pending link request. */
  async me(ctx: PublicCtx) {
    const s = this.requireSession(ctx);
    const v = await this.prisma.shopVisitor.findUnique({ where: { lineUserId: s.sub }, include: { customer: true } });
    const c = await this.line.config();
    const names = levelNames(c.levelNames);
    const member = v?.customer
      ? (() => {
          const p: any = v.customer.profile || {};
          const level = normalizeLevel(p.priceLevel);
          const fee = parseDeliveryFee(p.deliveryFee);
          return { name: v.customer.name, level, levelName: names[level], deliveryFee: fee.ok ? fee.value : null };
        })()
      : null;
    const link = await this.prisma.lineLinkRequest.findFirst({ where: { lineUserId: s.sub }, orderBy: { createdAt: 'desc' }, select: { status: true, phone: true, note: true, createdAt: true } });
    return {
      profile: { name: v?.displayName || s.n || 'ลูกค้า', picture: v?.pictureUrl || s.p || null, test: !!s.dev },
      member,
      contact: { name: v?.contactName || v?.customer?.name || '', phone: v?.contactPhone || v?.customer?.phone || '', address: v?.address || v?.customer?.address || '' },
      linkRequest: link && !(link.status === 'APPROVED' && !member) ? { status: link.status, phone: link.phone, note: link.note, createdAt: link.createdAt } : null,
    };
  }

  private async levelOf(session: ShopSession | null): Promise<{ level: PriceLevel; customerId: string | null; fee: unknown }> {
    if (!session) return { level: 1, customerId: null, fee: null };
    const v = await this.prisma.shopVisitor.findUnique({ where: { lineUserId: session.sub }, include: { customer: { select: { id: true, profile: true } } } });
    if (!v?.customer) return { level: 1, customerId: null, fee: null };
    const p: any = v.customer.profile || {};
    return { level: normalizeLevel(p.priceLevel), customerId: v.customer.id, fee: p.deliveryFee };
  }

  // ───────────────────────── catalogue ─────────────────────────

  async categories(ctx: PublicCtx) {
    this.hit(ctx);
    await this.requireOpen();
    if (this.categoryCache && Date.now() - this.categoryCache.at < 60_000) return this.categoryCache.rows;
    const rows = await this.prisma.$queryRaw<{ id: string | null; name: string | null; count: number; image_id: string | null }[]>`
      WITH ap AS (SELECT id, category_id, name FROM products WHERE is_active AND NOT is_service),
      cnt AS (SELECT category_id, count(*)::int AS count FROM ap GROUP BY category_id),
      img AS (SELECT DISTINCT ON (ap.category_id) ap.category_id, i.id AS image_id
              FROM ap JOIN product_images i ON i.product_id = ap.id
              ORDER BY ap.category_id, i.is_cover DESC, ap.name, i.sort_order, i.id)
      SELECT c.id, c.name, cnt.count, img.image_id
      FROM cnt LEFT JOIN categories c ON c.id = cnt.category_id
      LEFT JOIN img ON img.category_id IS NOT DISTINCT FROM cnt.category_id
      WHERE cnt.category_id IS NULL OR c.is_active
      ORDER BY (cnt.category_id IS NULL), c.sort_order, c.name`;
    const out = rows.map((r) => ({
      id: r.id || 'none',
      name: r.name || 'สินค้าอื่น ๆ',
      count: Number(r.count),
      imageUrl: r.image_id ? `/api/public/shop/images/${r.image_id}` : null,
    }));
    this.categoryCache = { at: Date.now(), rows: out };
    return out;
  }

  /** Paged catalogue: name / SKU search (every word), category; price at the visitor's level; in-stock flag only. */
  async catalogue(ctx: PublicCtx, query: any) {
    this.hit(ctx);
    await this.requireOpen();
    const page = Math.max(1, Math.min(10_000, Math.floor(Number(query?.page) || 1)));
    const limit = Math.max(1, Math.min(40, Math.floor(Number(query?.limit) || 20)));
    const words = text(query?.q, 80).split(/\s+/).filter(Boolean).slice(0, 5);
    const categoryId = typeof query?.categoryId === 'string' ? query.categoryId.slice(0, 64) : '';
    const conds: Prisma.Sql[] = [Prisma.sql`p.is_active`, Prisma.sql`NOT p.is_service`];
    for (const w of words) {
      const like = '%' + escLike(w) + '%';
      conds.push(Prisma.sql`(p.name ILIKE ${like} OR p.sku ILIKE ${like})`);
    }
    if (categoryId === 'none') conds.push(Prisma.sql`p.category_id IS NULL`);
    else if (categoryId) conds.push(Prisma.sql`p.category_id = ${categoryId}`);
    const offset = (page - 1) * limit;
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT p.id, p.name, p.unit, p.category_id, p.base_price::text, p.price_level_1::text, p.price_level_2::text, p.price_level_3::text,
             p.price_level_4::text, p.price_level_5::text, p.is_bundle, count(*) OVER ()::int AS total
      FROM products p WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY p.name, p.id LIMIT ${limit} OFFSET ${offset}`;
    const { level } = await this.levelOf(ctx.session);
    const items = await this.decorate(rows, level);
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items, page, limit, total, hasMore: offset + rows.length < total, level };
  }

  /** Units + prices, cover photo and stock flags for product rows (raw SQL rows). */
  private async decorate(rows: any[], level: PriceLevel) {
    const ids = rows.map((r) => r.id as string);
    if (!ids.length) return [];
    const [packs, images, stock] = await Promise.all([
      this.prisma.productPackagingUnit.findMany({ where: { productId: { in: ids } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.$queryRaw<{ product_id: string; id: string }[]>`
        SELECT DISTINCT ON (product_id) product_id, id FROM product_images WHERE product_id = ANY(${ids}::text[])
        ORDER BY product_id, is_cover DESC, sort_order, created_at, id`,
      this.stockOf(ids, rows.filter((r) => r.is_bundle).map((r) => r.id)),
    ]);
    const packsOf = new Map<string, typeof packs>();
    for (const u of packs) packsOf.set(u.productId, [...(packsOf.get(u.productId) || []), u]);
    const imageOf = new Map(images.map((i) => [i.product_id, i.id]));
    return rows.map((r) => {
      const units = shopUnits(
        { basePrice: r.base_price, priceLevel1: r.price_level_1, priceLevel2: r.price_level_2, priceLevel3: r.price_level_3, priceLevel4: r.price_level_4, priceLevel5: r.price_level_5, unit: r.unit },
        (packsOf.get(r.id) || []).map((u) => ({ id: u.id, name: u.name, qtyPerPrev: u.qtyPerPrev, priceLevel1: u.priceLevel1, priceLevel2: u.priceLevel2, priceLevel3: u.priceLevel3, priceLevel4: u.priceLevel4, priceLevel5: u.priceLevel5 })),
        level,
      );
      const qty = stock.get(r.id) || 0;
      const img = imageOf.get(r.id);
      return {
        id: r.id as string,
        name: r.name as string,
        categoryId: (r.category_id as string | null) || 'none',
        imageUrl: img ? `/api/public/shop/images/${img}` : null,
        units: units.map((u) => ({ id: u.id, name: u.name, price: u.price, inStock: qty >= u.factor })),
        inStock: units.some((u) => qty >= u.factor),
      };
    });
  }

  /** Stock in base units (bundles: complete sets of their parts). Never sent to customers. */
  private async stockOf(ids: string[], bundleIds: string[]): Promise<Map<string, number>> {
    const parts = bundleIds.length
      ? await this.prisma.productBundleItem.findMany({ where: { bundleProductId: { in: bundleIds } }, select: { bundleProductId: true, childProductId: true, quantity: true } })
      : [];
    const all = [...new Set([...ids, ...parts.map((p) => p.childProductId)])];
    const sums = await this.prisma.$queryRaw<{ product_id: string; q: string }[]>`
      SELECT product_id, SUM(quantity_remaining)::text AS q FROM stock_batches WHERE product_id = ANY(${all}::text[]) GROUP BY product_id`;
    const of = new Map(sums.map((s) => [s.product_id, Number(s.q) || 0]));
    const out = new Map<string, number>();
    for (const id of ids) out.set(id, of.get(id) || 0);
    const byBundle = new Map<string, typeof parts>();
    for (const p of parts) byBundle.set(p.bundleProductId, [...(byBundle.get(p.bundleProductId) || []), p]);
    for (const [bid, list] of byBundle) {
      out.set(bid, Math.min(...list.map((p) => Math.floor((of.get(p.childProductId) || 0) / (Number(p.quantity) || 1) + 1e-9))));
    }
    return out;
  }

  async image(ctx: PublicCtx, id: string) {
    this.hit(ctx);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const owner = await this.prisma.productImage.findUnique({ where: { id }, select: { product: { select: { isActive: true, isService: true } } } });
    if (!owner?.product.isActive || owner.product.isService) return null;
    return this.products.getImage(id, 'thumb');
  }

  // ───────────────────────── customer orders ─────────────────────────

  /** Price every requested line on the server (client prices are never used). */
  private async priceLines(db: Prisma.TransactionClient | PrismaService, raw: unknown, level: PriceLevel, opts: { requireStock: boolean }) {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('ตะกร้าว่าง');
    if (raw.length > ONLINE_LIMITS.maxLines) throw new BadRequestException(`สั่งได้ไม่เกิน ${ONLINE_LIMITS.maxLines} รายการต่อครั้ง`);
    const wanted = raw.map((l: any) => {
      const qty = Number(l?.quantity);
      if (typeof l?.productId !== 'string' || !Number.isInteger(qty) || qty < 1 || qty > ONLINE_LIMITS.maxQtyPerLine) throw new BadRequestException('จำนวนสินค้าไม่ถูกต้อง');
      return { productId: l.productId.slice(0, 64), unitId: typeof l?.unitId === 'string' && l.unitId ? l.unitId.slice(0, 64) : null, quantity: qty };
    });
    const ids = [...new Set(wanted.map((w) => w.productId))];
    const rows = await db.$queryRaw<any[]>`
      SELECT p.id, p.name, p.unit, p.base_price::text, p.price_level_1::text, p.price_level_2::text, p.price_level_3::text,
             p.price_level_4::text, p.price_level_5::text, p.is_bundle, p.is_active, p.is_service
      FROM products p WHERE p.id = ANY(${ids}::text[])`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const packs = await db.productPackagingUnit.findMany({ where: { productId: { in: ids } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const stock = opts.requireStock ? await this.stockOf(ids, rows.filter((r) => r.is_bundle).map((r) => r.id)) : null;
    const merged = new Map<string, { productId: string; productName: string; unitId: string | null; unitName: string; factor: number; quantity: number; unitPrice: number }>();
    for (const w of wanted) {
      const p = byId.get(w.productId);
      if (!p || !p.is_active || p.is_service) throw new BadRequestException('มีสินค้าที่ร้านไม่ได้ขายแล้ว กรุณาลบออกจากตะกร้า');
      const units = shopUnits(
        { basePrice: p.base_price, priceLevel1: p.price_level_1, priceLevel2: p.price_level_2, priceLevel3: p.price_level_3, priceLevel4: p.price_level_4, priceLevel5: p.price_level_5, unit: p.unit },
        packs.filter((u) => u.productId === p.id).map((u) => ({ id: u.id, name: u.name, qtyPerPrev: u.qtyPerPrev, priceLevel1: u.priceLevel1, priceLevel2: u.priceLevel2, priceLevel3: u.priceLevel3, priceLevel4: u.priceLevel4, priceLevel5: u.priceLevel5 })),
        level,
      );
      const unit = units.find((u) => u.id === w.unitId);
      if (!unit) throw new BadRequestException(`หน่วยของ "${p.name}" เปลี่ยนแล้ว กรุณาเลือกใหม่`);
      if (stock && (stock.get(p.id) || 0) < unit.factor) throw new BadRequestException(`"${p.name}" (${unit.name}) หมดแล้ว กรุณาลบออกจากตะกร้า`);
      const key = `${p.id}|${unit.id ?? ''}`;
      const prev = merged.get(key);
      if (prev) prev.quantity = Math.min(ONLINE_LIMITS.maxQtyPerLine, prev.quantity + w.quantity);
      else merged.set(key, { productId: p.id, productName: p.name, unitId: unit.id, unitName: unit.name, factor: unit.factor, quantity: w.quantity, unitPrice: unit.price });
    }
    return [...merged.values()];
  }

  /**
   * Cart check before ordering: current prices at the visitor's level, unavailable lines flagged (no exception),
   * delivery fee for the chosen way. Same pricing as placeOrder.
   */
  async quote(ctx: PublicCtx, body: any) {
    this.hit(ctx);
    await this.requireOpen();
    const raw: any[] = Array.isArray(body?.items) ? body.items.slice(0, ONLINE_LIMITS.maxLines) : [];
    const who = await this.levelOf(ctx.session);
    const lines: { productId: string; unitId: string | null; ok: boolean; name?: string; unitName?: string; quantity: number; unitPrice: number; total: number; problem: string | null }[] = [];
    for (const it of raw) {
      try {
        const [l] = await this.priceLines(this.prisma, [it], who.level, { requireStock: true });
        lines.push({ productId: l.productId, unitId: l.unitId, ok: true, name: l.productName, unitName: l.unitName, quantity: l.quantity, unitPrice: l.unitPrice, total: onlineLineTotal(l), problem: null });
      } catch (e: any) {
        lines.push({ productId: String(it?.productId || ''), unitId: it?.unitId ?? null, ok: false, quantity: Number(it?.quantity) || 0, unitPrice: 0, total: 0, problem: String(e?.response?.message || e?.message || 'สั่งไม่ได้') });
      }
    }
    const fulfillment: Fulfillment = body?.fulfillment === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    const fee = deliveryFeeFor(fulfillment, who.fee);
    const totals = onlineOrderTotals(lines.filter((l) => l.ok), fee);
    return { lines, ...totals, fulfillment, level: who.level };
  }

  async placeOrder(ctx: PublicCtx, body: any) {
    const s = this.requireSession(ctx);
    // placed orders per LINE account / address (failed attempts only count towards the general limit)
    this.hit(ctx);
    if (!this.orderIpLimiter.allowed(ctx.ip) || !this.orderUserLimiter.allowed(s.sub)) throw new TooMany('สั่งบ่อยเกินไป กรุณารอสักครู่');
    const c = await this.requireOpen();
    const fulfillment: Fulfillment = body?.fulfillment === 'DELIVERY' ? 'DELIVERY' : body?.fulfillment === 'PICKUP' ? 'PICKUP' : (null as any);
    if (!fulfillment) throw new BadRequestException('กรุณาเลือกรับเองที่ร้าน หรือให้ร้านไปส่ง');
    if (fulfillment === 'PICKUP' && !c.allowPickup) throw new BadRequestException('ร้านไม่เปิดให้รับเองที่ร้าน');
    if (fulfillment === 'DELIVERY' && !c.allowDelivery) throw new BadRequestException('ร้านไม่เปิดบริการส่งของ');
    const contactName = text(body?.contactName, ONLINE_LIMITS.nameMax);
    if (!contactName) throw new BadRequestException('กรุณากรอกชื่อ');
    const contactPhone = normalizeThaiPhone(body?.contactPhone);
    if (!contactPhone) throw new BadRequestException('กรุณากรอกเบอร์โทรให้ถูกต้อง (ตัวเลข 9-10 หลัก)');
    const address = text(body?.address, ONLINE_LIMITS.addressMax);
    if (fulfillment === 'DELIVERY' && address.length < 5) throw new BadRequestException('กรุณากรอกที่อยู่สำหรับส่งของ');
    const note = text(body?.note, ONLINE_LIMITS.noteMax);
    const open = await this.prisma.onlineOrder.count({ where: { lineUserId: s.sub, status: 'NEW' } });
    if (open >= ONLINE_LIMITS.maxOpenOrders) throw new BadRequestException(`มีออเดอร์รอร้านยืนยันอยู่ ${open} รายการแล้ว กรุณารอร้านยืนยันก่อน`);
    const who = await this.levelOf(s);
    const order = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 7)`;
      const lines = await this.priceLines(tx, body?.items, who.level, { requireStock: true });
      const fee = deliveryFeeFor(fulfillment, who.fee);
      const totals = onlineOrderTotals(lines, fee);
      if (totals.total > ONLINE_LIMITS.maxTotal) throw new BadRequestException(`ยอดสั่งออนไลน์ต่อครั้งไม่เกิน ฿${ONLINE_LIMITS.maxTotal.toLocaleString('th-TH')} กรุณาติดต่อร้าน`);
      const orderNo = await this.nextOrderNo(tx);
      return tx.onlineOrder.create({
        data: {
          orderNo, lineUserId: s.sub, customerId: who.customerId, priceLevel: who.level, fulfillment,
          contactName, contactPhone, address: fulfillment === 'DELIVERY' ? address : address || null, note: note || null,
          subtotal: totals.subtotal, deliveryFee: totals.deliveryFee, totalAmount: totals.total,
          items: { create: lines.map((l, i) => ({ ...l, total: onlineLineTotal(l), sortOrder: i })) },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    }, { timeout: 15000 });
    this.orderIpLimiter.take(ctx.ip);
    this.orderUserLimiter.take(s.sub);
    // remember the contact for next time
    await this.prisma.shopVisitor.update({ where: { lineUserId: s.sub }, data: { contactName, contactPhone, address: address || undefined } }).catch(() => undefined);
    void this.notify(order.id, 'NEW');
    return this.customerView(order);
  }

  private async nextOrderNo(tx: Prisma.TransactionClient) {
    const d = new Date();
    const prefix = `WEB-${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-`;
    const last = await tx.onlineOrder.findFirst({ where: { orderNo: { startsWith: prefix } }, orderBy: { orderNo: 'desc' }, select: { orderNo: true } });
    return prefix + String((Number(last?.orderNo.slice(prefix.length)) || 0) + 1).padStart(3, '0');
  }

  /** What the customer may see of an order (no staff ids, no cost). */
  private async customerView(o: any, withPayment = false) {
    const fee = o.deliveryFee === null || o.deliveryFee === undefined ? null : money(o.deliveryFee);
    const status = o.status as OnlineOrderStatus;
    const base = {
      id: o.id, orderNo: o.orderNo, status, statusLabel: ONLINE_STATUS_LABELS[status], fulfillment: o.fulfillment,
      contactName: o.contactName, contactPhone: o.contactPhone, address: o.address, note: o.note,
      subtotal: money(o.subtotal), deliveryFee: fee, feePending: fee === null, totalAmount: money(o.totalAmount),
      rejectReason: o.rejectReason, paid: !!o.paidAt, createdAt: o.createdAt, updatedAt: o.updatedAt,
      items: (o.items || []).map((i: any) => ({ productId: i.productId, name: i.productName, unitName: i.unitName, quantity: Number(i.quantity), unitPrice: money(i.unitPrice), total: money(i.total) })),
    };
    if (!withPayment) return base;
    return { ...base, payment: PAYABLE.includes(status) && !o.paidAt && fee !== null ? await this.paymentFor(money(o.totalAmount)) : null };
  }

  /** PromptPay of the default (else first) bank account with an ID, for an amount; null when none. */
  private async paymentFor(amount: number) {
    if (!isValidPromptPayAmount(amount)) return null;
    const accs = await this.prisma.bankAccount.findMany({ where: { promptpayId: { not: null } }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], take: 1 });
    const a = accs[0];
    if (!a?.promptpayType || !a.promptpayId) return null;
    const n = normalizePromptPayId(a.promptpayType, a.promptpayId);
    if (!n.ok) return null;
    return {
      amount,
      payload: buildPromptPayPayload(a.promptpayType as PromptPayIdType, n.id, amount),
      accountName: a.accountName,
      bankName: a.bankName,
      maskedId: maskPromptPayId(a.promptpayType as PromptPayIdType, n.id),
    };
  }

  async myOrders(ctx: PublicCtx) {
    this.hit(ctx);
    const s = this.requireSession(ctx);
    const rows = await this.prisma.onlineOrder.findMany({ where: { lineUserId: s.sub }, orderBy: { createdAt: 'desc' }, take: 50, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    return Promise.all(rows.map((r) => this.customerView(r)));
  }

  async myOrder(ctx: PublicCtx, id: string) {
    this.hit(ctx);
    const s = this.requireSession(ctx);
    const o = await this.prisma.onlineOrder.findUnique({ where: { id: String(id).slice(0, 64) }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!o || o.lineUserId !== s.sub) throw new NotFoundException('ไม่พบออเดอร์');
    return this.customerView(o, true);
  }

  async cancelMine(ctx: PublicCtx, id: string) {
    this.hit(ctx);
    const s = this.requireSession(ctx);
    const r = await this.prisma.onlineOrder.updateMany({ where: { id: String(id).slice(0, 64), lineUserId: s.sub, status: 'NEW', claimedById: null }, data: { status: 'CANCELLED', cancelledAt: new Date(), rejectReason: 'ลูกค้ายกเลิกเอง' } });
    if (!r.count) throw new BadRequestException('ยกเลิกไม่ได้ ร้านรับออเดอร์หรือกำลังจัดของแล้ว กรุณาโทรหาร้าน');
    return this.myOrder(ctx, id);
  }

  async requestLink(ctx: PublicCtx, body: any) {
    const s = this.requireSession(ctx);
    if (!this.linkLimiter.take(s.sub) || !this.linkLimiter.take('ip:' + ctx.ip)) throw new TooMany();
    await this.requireOpen();
    const phone = normalizeThaiPhone(body?.phone);
    if (!phone) throw new BadRequestException('กรุณากรอกเบอร์โทรที่ให้ร้านไว้ (ตัวเลข 9-10 หลัก)');
    const v = await this.prisma.shopVisitor.findUnique({ where: { lineUserId: s.sub } });
    if (v?.customerId) throw new BadRequestException('บัญชี LINE นี้ผูกกับสมาชิกแล้ว');
    await this.prisma.$transaction([
      this.prisma.lineLinkRequest.updateMany({ where: { lineUserId: s.sub, status: 'PENDING' }, data: { status: 'REJECTED', note: 'ลูกค้าส่งคำขอใหม่', decidedAt: new Date() } }),
      this.prisma.lineLinkRequest.create({ data: { lineUserId: s.sub, displayName: v?.displayName || s.n || null, phone } }),
    ]);
    return this.me(ctx);
  }

  /** PromptPay QR PNG for LINE image messages (signed link: order id + amount). */
  async qrImage(orderId: string, amountText: string, sig: string): Promise<Buffer | null> {
    const amount = Number(amountText);
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !isValidPromptPayAmount(amount) || typeof sig !== 'string' || !safeEqual(sig, signValue(`qr|${orderId}|${amount.toFixed(2)}`))) return null;
    const o = await this.prisma.onlineOrder.findUnique({ where: { id: orderId }, select: { status: true, paidAt: true } });
    if (!o || !PAYABLE.includes(o.status as OnlineOrderStatus) || o.paidAt) return null;
    const p = await this.paymentFor(amount);
    return p ? qrPng(p.payload) : null;
  }

  // ───────────────────────── LINE notifications ─────────────────────────

  private async notify(orderId: string, kind: OnlineOrderStatus) {
    try {
      const o = await this.prisma.onlineOrder.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!o) return;
      if (kind === 'DONE' && o.status !== 'DONE') return; // the payment transaction did not commit
      const c = await this.line.config();
      const store = (await this.prisma.storeSettings.findFirst({ select: { storeName: true } }))?.storeName || 'ร้าน';
      const base = c.publicBaseUrl && /^https:\/\//.test(c.publicBaseUrl) ? c.publicBaseUrl.replace(/\/+$/, '') : null;
      const link = base ? `\nดูออเดอร์: ${base}/shop/orders/${o.id}` : '';
      const fee = o.deliveryFee === null ? null : money(o.deliveryFee);
      const how = o.fulfillment === 'PICKUP' ? 'รับเองที่ร้าน' : 'ร้านไปส่ง';
      const msgs: LineMessage[] = [];
      if (kind === 'NEW') {
        msgs.push({ type: 'text', text: `${store} ได้รับออเดอร์ ${o.orderNo} แล้ว\n${o.items.length} รายการ ยอดสินค้า ฿${fmt(money(o.subtotal))}\n${how}${o.fulfillment === 'DELIVERY' ? ` ค่าส่ง: ${fee === null ? 'ร้านจะแจ้ง' : '฿' + fmt(fee)}` : ''}\nร้านจะยืนยันให้เร็วที่สุด${link}` });
      } else if (kind === 'ACCEPTED') {
        const total = money(o.totalAmount);
        const pay = await this.paymentFor(total);
        msgs.push({ type: 'text', text: `${store} ยืนยันออเดอร์ ${o.orderNo} แล้ว\nยอดที่ต้องชำระ ฿${fmt(total)}${o.fulfillment === 'DELIVERY' ? ` (รวมค่าส่ง ฿${fmt(fee ?? 0)})` : ''}\n${how}${pay ? '\nโอนผ่านพร้อมเพย์ด้วย QR ด้านล่างได้เลย (ยอดเงินตั้งไว้แล้ว) หรือชำระที่ร้าน' : '\nชำระเงินที่ร้าน หรือตามที่ร้านแจ้ง'}${link}` });
        if (pay && base) {
          const url = `${base}/api/public/shop/qr/${o.id}.png?a=${total.toFixed(2)}&s=${signValue(`qr|${o.id}|${total.toFixed(2)}`)}`;
          msgs.push({ type: 'image', originalContentUrl: url, previewImageUrl: url });
        }
      } else if (kind === 'CANCELLED') {
        msgs.push({ type: 'text', text: `ขออภัย ${store} ยกเลิกออเดอร์ ${o.orderNo}${o.rejectReason ? `\nเหตุผล: ${o.rejectReason}` : ''}\nสอบถามร้านได้ทาง LINE นี้` });
      } else if (kind === 'PREPARING') {
        msgs.push({ type: 'text', text: `${store} กำลังจัดของ ออเดอร์ ${o.orderNo}${link}` });
      } else if (kind === 'DELIVERING') {
        msgs.push({ type: 'text', text: `${store} กำลังนำของไปส่ง ออเดอร์ ${o.orderNo}${link}` });
      } else if (kind === 'DONE') {
        msgs.push({ type: 'text', text: `ออเดอร์ ${o.orderNo} เรียบร้อยแล้ว ขอบคุณที่อุดหนุน ${store} ครับ/ค่ะ` });
      }
      if (!msgs.length) return;
      const result = await this.line.push(o.lineUserId, msgs);
      await this.prisma.onlineOrder.update({ where: { id: o.id }, data: { lineNotice: `${ONLINE_STATUS_LABELS[kind]}: ${result}` } });
    } catch (e: any) {
      this.log.warn(`LINE notice failed: ${e?.message || e}`);
    }
  }

  // ───────────────────────── staff ─────────────────────────

  async counts() {
    const [byStatus, links, payable] = await Promise.all([
      this.prisma.onlineOrder.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.lineLinkRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.onlineOrder.count({ where: { status: { in: PAYABLE }, paidAt: null, deliveryFee: { not: null } } }),
    ]);
    const statuses = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
    return { new: statuses.NEW || 0, statuses, linkRequests: links, payable };
  }

  async list(q: any) {
    const page = Math.max(1, Math.floor(Number(q?.page) || 1));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(q?.limit) || 30)));
    const where: Prisma.OnlineOrderWhereInput = {};
    const status = String(q?.status || 'open');
    if (status === 'open') where.status = { in: ['NEW', ...PAYABLE] };
    else if (status === 'payable') Object.assign(where, { status: { in: PAYABLE }, paidAt: null, deliveryFee: { not: null } });
    else if (status !== 'all') {
      if (!(Object.keys(ONLINE_STATUS_LABELS) as string[]).includes(status)) throw new BadRequestException('สถานะไม่ถูกต้อง');
      where.status = status as OnlineOrderStatus;
    }
    const search = text(q?.search, 60);
    if (search) where.OR = [{ orderNo: { contains: search, mode: 'insensitive' } }, { contactName: { contains: search, mode: 'insensitive' } }, { contactPhone: { contains: search.replace(/\D/g, '') || search } }];
    const [rows, total] = await Promise.all([
      this.prisma.onlineOrder.findMany({ where, orderBy: [{ createdAt: status === 'open' || status === 'NEW' ? 'asc' : 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit, include: { customer: { select: { id: true, name: true } }, claimedBy: { select: { id: true, fullName: true, username: true } }, _count: { select: { items: true } } } }),
      this.prisma.onlineOrder.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, orderNo: r.orderNo, status: r.status, fulfillment: r.fulfillment, contactName: r.contactName, contactPhone: r.contactPhone,
        customer: r.customer, itemCount: r._count.items, subtotal: money(r.subtotal), deliveryFee: r.deliveryFee === null ? null : money(r.deliveryFee),
        totalAmount: money(r.totalAmount), paid: !!r.paidAt, posOrderId: r.posOrderId, createdAt: r.createdAt,
        claim: claimOf(r), pickingPrintCount: r.pickingPrintCount,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async detail(id: string) {
    const o = await this.prisma.onlineOrder.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { sku: true, isActive: true } } } }, customer: { select: { id: true, name: true, phone: true, profile: true } }, claimedBy: { select: { id: true, fullName: true, username: true } } },
    });
    if (!o) throw new NotFoundException('ไม่พบออเดอร์ออนไลน์');
    const visitor = await this.prisma.shopVisitor.findUnique({ where: { lineUserId: o.lineUserId }, select: { displayName: true, customerId: true } });
    const pos = o.posOrderId ? await this.prisma.order.findUnique({ where: { id: o.posOrderId }, select: { id: true, orderNumber: true, totalAmount: true, status: true } }) : null;
    const c = await this.line.config();
    const p: any = o.customer?.profile || {};
    const memberFee = parseDeliveryFee(p.deliveryFee);
    return {
      id: o.id, orderNo: o.orderNo, status: o.status, fulfillment: o.fulfillment, priceLevel: o.priceLevel, levelName: levelNames(c.levelNames)[normalizeLevel(o.priceLevel)],
      contactName: o.contactName, contactPhone: o.contactPhone, address: o.address, note: o.note,
      subtotal: money(o.subtotal), deliveryFee: o.deliveryFee === null ? null : money(o.deliveryFee), totalAmount: money(o.totalAmount),
      rejectReason: o.rejectReason, paidAt: o.paidAt, acceptedAt: o.acceptedAt, doneAt: o.doneAt, cancelledAt: o.cancelledAt, createdAt: o.createdAt,
      lineNotice: o.lineNotice, lineName: visitor?.displayName || null, testProfile: o.lineUserId.startsWith('dev-'),
      customer: o.customer ? { id: o.customer.id, name: o.customer.name, phone: o.customer.phone, priceLevel: normalizeLevel(p.priceLevel), deliveryFee: memberFee.ok ? memberFee.value : null } : null,
      visitorLinkedTo: visitor?.customerId || null,
      posOrder: pos ? { id: pos.id, orderNumber: pos.orderNumber, totalAmount: money(pos.totalAmount), status: pos.status } : null,
      nextStatuses: nextStatuses(o.status as OnlineOrderStatus, o.fulfillment as Fulfillment),
      claim: claimOf(o), posTerminalId: o.posTerminalId, posOpenedAt: o.posOpenedAt, pickingPrintCount: o.pickingPrintCount, pickingPrintedAt: o.pickingPrintedAt,
      items: o.items.map((i) => ({ id: i.id, productId: i.productId, sku: i.product.sku, name: i.productName, unitId: i.unitId, unitName: i.unitName, factor: i.factor, quantity: Number(i.quantity), unitPrice: money(i.unitPrice), total: money(i.total), active: i.product.isActive })),
    };
  }

  /**
   * Staff edits of an order not yet paid: items (product + unit + qty, price typed by staff or the current
   * price at the order's level when omitted), delivery fee, member, contact. Price checks against the price floor
   * / approval rules happen at payment in the POS like any sale.
   */
  private async applyEdits(tx: Prisma.TransactionClient, o: { id: string; priceLevel: number; fulfillment: string; deliveryFee: Prisma.Decimal | null }, body: any) {
    const data: Prisma.OnlineOrderUpdateInput = {};
    let level = normalizeLevel(o.priceLevel);
    if (body?.customerId !== undefined) {
      if (body.customerId === null || body.customerId === '') data.customer = { disconnect: true };
      else {
        const cu = await tx.customer.findUnique({ where: { id: String(body.customerId) }, select: { id: true, profile: true } });
        if (!cu) throw new BadRequestException('ไม่พบลูกค้า');
        data.customer = { connect: { id: cu.id } };
        if (body.usePriceLevel !== false) level = normalizeLevel((cu.profile as any)?.priceLevel);
        data.priceLevel = level;
      }
    }
    if (body?.contactName !== undefined) {
      const n = text(body.contactName, ONLINE_LIMITS.nameMax);
      if (!n) throw new BadRequestException('กรุณากรอกชื่อลูกค้า');
      data.contactName = n;
    }
    if (body?.contactPhone !== undefined) {
      const ph = normalizeThaiPhone(body.contactPhone);
      if (!ph) throw new BadRequestException('เบอร์โทรไม่ถูกต้อง');
      data.contactPhone = ph;
    }
    if (body?.address !== undefined) data.address = text(body.address, ONLINE_LIMITS.addressMax) || null;
    let fulfillment = o.fulfillment;
    if (body?.fulfillment !== undefined) {
      if (body.fulfillment !== 'PICKUP' && body.fulfillment !== 'DELIVERY') throw new BadRequestException('วิธีรับของไม่ถูกต้อง');
      fulfillment = body.fulfillment;
      data.fulfillment = fulfillment as Fulfillment;
    }
    let fee: number | null = o.deliveryFee === null ? null : money(o.deliveryFee);
    if (body?.deliveryFee !== undefined) {
      const f = parseDeliveryFee(body.deliveryFee);
      if (!f.ok) throw new BadRequestException(f.error);
      fee = f.value;
    }
    if (fulfillment === 'PICKUP') fee = 0;
    let lines: { productId: string; productName: string; unitId: string | null; unitName: string; factor: number; quantity: number; unitPrice: number }[] | null = null;
    if (body?.items !== undefined) {
      const priced = await this.priceLines(tx, body.items, level, { requireStock: false });
      const typed = new Map<string, number>();
      for (const it of Array.isArray(body.items) ? body.items : []) {
        if (it?.unitPrice === undefined || it.unitPrice === null || it.unitPrice === '') continue;
        const pr = Number(it.unitPrice);
        if (!Number.isFinite(pr) || pr < 0 || pr > 1_000_000 || Math.abs(pr * 100 - Math.round(pr * 100)) > 1e-6) throw new BadRequestException('ราคาต่อหน่วยไม่ถูกต้อง');
        typed.set(`${it.productId}|${it.unitId || ''}`, pr);
      }
      lines = priced.map((l) => ({ ...l, unitPrice: typed.get(`${l.productId}|${l.unitId ?? ''}`) ?? l.unitPrice }));
      await tx.onlineOrderItem.deleteMany({ where: { onlineOrderId: o.id } });
      await tx.onlineOrderItem.createMany({ data: lines.map((l, i) => ({ ...l, onlineOrderId: o.id, total: onlineLineTotal(l), sortOrder: i })) });
    }
    const current = lines ?? (await tx.onlineOrderItem.findMany({ where: { onlineOrderId: o.id } })).map((i) => ({ quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }));
    const totals = onlineOrderTotals(current, fee);
    data.subtotal = totals.subtotal;
    data.deliveryFee = totals.deliveryFee;
    data.totalAmount = totals.total;
    if (body?.note !== undefined) data.note = text(body.note, ONLINE_LIMITS.noteMax) || null;
    await tx.onlineOrder.update({ where: { id: o.id }, data });
    return totals;
  }

  /** Order to change: status allowed, not paid, and claimed by the caller (claimed now when nobody holds it). */
  private async loadEditable(tx: Prisma.TransactionClient, id: string, allowed: OnlineOrderStatus[], user: StaffUser) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 7)`;
    const o = await tx.onlineOrder.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('ไม่พบออเดอร์ออนไลน์');
    if (!allowed.includes(o.status as OnlineOrderStatus)) throw new BadRequestException(`ออเดอร์นี้อยู่ในสถานะ "${ONLINE_STATUS_LABELS[o.status as OnlineOrderStatus]}" แก้ไขไม่ได้`);
    if (o.posOrderId) throw new BadRequestException('ออเดอร์นี้ชำระเงินแล้ว แก้ไขไม่ได้');
    await ensureClaim(tx, id, user);
    return o;
  }

  // ───────────────────────── claim lock (online-order-claim.ts) ─────────────────────────

  /** "รับจัดออเดอร์นี้": claim for the caller; ADMIN / MANAGER with takeover=true take it from someone else (audited). */
  async claim(id: string, body: any, user: StaffUser) {
    await this.prisma.$transaction(async (tx) => {
      if (await tryClaim(tx, id, user.id)) return;
      if (body?.takeover !== true) await claimRefusal(tx, id, user);
      if (!isManager(user)) throw new ForbiddenException('เฉพาะผู้ดูแลหรือผู้จัดการเท่านั้นที่ปลดล็อก/โอนออเดอร์ได้');
      const o = await tx.onlineOrder.findUnique({ where: { id }, include: { claimedBy: { select: { fullName: true, username: true } } } });
      if (!o) throw new NotFoundException('ไม่พบออเดอร์ออนไลน์');
      if (!(CLAIMABLE as readonly string[]).includes(o.status)) throw new BadRequestException(`ออเดอร์ ${o.orderNo} ปิดแล้ว`);
      const now = new Date();
      // conditional on the holder we saw: a release / another takeover in between makes this change nothing
      const n = await tx.$executeRaw`UPDATE "online_orders" SET "claimed_by_id" = ${user.id}, "claimed_at" = ${now}, "updated_at" = ${now}
        WHERE "id" = ${id} AND "claimed_by_id" IS NOT DISTINCT FROM ${o.claimedById}`;
      if (!n) throw new ConflictException('ออเดอร์นี้เพิ่งเปลี่ยนผู้จัด กรุณาลองใหม่');
      await tx.auditLog.create({
        data: {
          userId: user.id, action: 'ONLINE_ORDER_TAKEOVER', entity: 'OnlineOrder', entityId: id,
          details: { orderNo: o.orderNo, fromUserId: o.claimedById, fromName: o.claimedBy?.fullName || o.claimedBy?.username || null, fromSince: o.claimedAt, toUserId: user.id, toName: user.fullName || user.username || null },
        },
      });
    });
    return this.detail(id);
  }

  /** "ปล่อยงาน": the holder gives the order back (ADMIN / MANAGER may release anyone's, audited). */
  async release(id: string, user: StaffUser) {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.onlineOrder.findUnique({ where: { id }, include: { claimedBy: { select: { fullName: true, username: true } } } });
      if (!o) throw new NotFoundException('ไม่พบออเดอร์ออนไลน์');
      if (!o.claimedById) return;
      const mine = o.claimedById === user.id;
      if (!mine && !isManager(user)) await claimRefusal(tx, id, user);
      const now = new Date();
      await tx.$executeRaw`UPDATE "online_orders" SET "claimed_by_id" = NULL, "claimed_at" = NULL, "updated_at" = ${now}
        WHERE "id" = ${id} AND "claimed_by_id" = ${o.claimedById}`;
      if (!mine) {
        await tx.auditLog.create({
          data: { userId: user.id, action: 'ONLINE_ORDER_RELEASE', entity: 'OnlineOrder', entityId: id, details: { orderNo: o.orderNo, fromUserId: o.claimedById, fromName: o.claimedBy?.fullName || o.claimedBy?.username || null } },
        });
      }
    });
    return this.detail(id);
  }

  /**
   * Picking slip (ใบจัดของ) of an online order: claims it, counts the print (2nd+ = reprint) and returns what
   * the slip shows: names, units, quantities, bundle parts, customer / delivery. No prices.
   */
  async pickingSlip(id: string, user: StaffUser) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 7)`;
      await ensureClaim(tx, id, user);
      const o = await tx.onlineOrder.update({
        where: { id },
        data: { pickingPrintCount: { increment: 1 }, pickingPrintedAt: new Date() },
        include: {
          customer: { select: { name: true } },
          items: {
            orderBy: { sortOrder: 'asc' },
            include: { product: { select: { name: true, unit: true, isService: true, isBundle: true, bundleItems: { include: { childProduct: { select: { name: true, unit: true } } } } } } },
          },
        },
      });
      return {
        orderNo: o.orderNo,
        createdAt: o.createdAt,
        customerName: o.customer?.name || o.contactName,
        contactName: o.contactName,
        phone: o.contactPhone,
        address: o.fulfillment === 'DELIVERY' ? o.address : null,
        fulfillment: o.fulfillment,
        note: o.note,
        reprint: o.pickingPrintCount > 1,
        printCount: o.pickingPrintCount,
        items: o.items
          .filter((i) => !i.product.isService)
          .map((i) => ({
            name: i.productName,
            unitName: i.unitName,
            quantity: Number(i.quantity),
            parts: i.product.isBundle
              ? i.product.bundleItems.map((b) => ({ name: b.childProduct.name, unitName: b.childProduct.unit || 'ชิ้น', quantity: Number(b.quantity) * Number(i.quantity) * (i.factor || 1) }))
              : [],
          })),
      };
    }, { timeout: 15000 });
  }

  async update(id: string, body: any, user: StaffUser) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.loadEditable(tx, id, ['NEW', ...PAYABLE], user);
      await this.applyEdits(tx, o, body);
    }, { timeout: 15000 });
    return this.detail(id);
  }

  async accept(id: string, body: any, user: StaffUser) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.loadEditable(tx, id, ['NEW'], user);
      const totals = await this.applyEdits(tx, o, body || {});
      if (totals.feePending) throw new BadRequestException('กรุณาใส่ค่าส่งก่อนรับออเดอร์');
      if (totals.subtotal <= 0) throw new BadRequestException('ออเดอร์ต้องมีสินค้า');
      await tx.onlineOrder.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user?.id || null } });
    }, { timeout: 15000 });
    void this.notify(id, 'ACCEPTED');
    return this.detail(id);
  }

  async reject(id: string, body: any, user: StaffUser) {
    const reason = text(body?.reason, 300);
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลที่ยกเลิก (ลูกค้าจะเห็นข้อความนี้)');
    await this.prisma.$transaction(async (tx) => {
      await this.loadEditable(tx, id, ['NEW', ...PAYABLE], user);
      await tx.onlineOrder.update({ where: { id }, data: { status: 'CANCELLED', rejectReason: reason, cancelledAt: new Date(), ...RELEASED } });
    });
    void this.notify(id, 'CANCELLED');
    return this.detail(id);
  }

  async setStatus(id: string, body: any, user: StaffUser) {
    const to = String(body?.status || '') as OnlineOrderStatus;
    if (to === 'CANCELLED') return this.reject(id, body, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 7)`;
      const o = await tx.onlineOrder.findUnique({ where: { id } });
      if (!o) throw new NotFoundException('ไม่พบออเดอร์ออนไลน์');
      if (!nextStatuses(o.status as OnlineOrderStatus, o.fulfillment as Fulfillment).includes(to)) throw new BadRequestException('เปลี่ยนสถานะนี้ไม่ได้');
      await ensureClaim(tx, id, user);
      if (to === 'DONE' && !o.posOrderId && body?.unpaidOk !== true) throw new ConflictException({ statusCode: 409, code: 'NOT_PAID', message: 'ออเดอร์นี้ยังไม่ได้รับเงินในหน้าขาย ยืนยันปิดออเดอร์โดยไม่รับเงิน?' });
      await tx.onlineOrder.update({ where: { id }, data: { status: to, ...(to === 'DONE' ? { doneAt: new Date(), ...RELEASED } : {}) } });
    });
    void this.notify(id, to);
    return this.detail(id);
  }

  /** Cart lines for the POS (agreed prices; ค่าส่ง as a service line). */
  /**
   * Open as a POS bill: claims the order and records the terminal. Another terminal is refused (409
   * ONLINE_ORDER_OPEN_ELSEWHERE) unless `force` (the holder moves the bill here; the old terminal's checkout is then
   * refused, see linkOnlineOrder).
   */
  async posPayload(id: string, user: StaffUser, opts: { terminalId?: string; force?: boolean } = {}) {
    const terminalId = text(opts.terminalId, 100) || null;
    const o = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 7)`;
      const cur = await tx.onlineOrder.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException('ไม่พบออเดอร์ออนไลน์');
      if (!PAYABLE.includes(cur.status as OnlineOrderStatus)) throw new BadRequestException('ต้องกดรับออเดอร์ก่อนจึงจะเปิดบิลได้');
      if (cur.posOrderId) throw new BadRequestException('ออเดอร์นี้ชำระเงินแล้ว');
      if (cur.deliveryFee === null) throw new BadRequestException('กรุณาใส่ค่าส่งก่อน');
      await ensureClaim(tx, id, user);
      if (terminalId && cur.posTerminalId && cur.posTerminalId !== terminalId && !opts.force) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ONLINE_ORDER_OPEN_ELSEWHERE',
          message: `ออเดอร์ ${cur.orderNo} เปิดเป็นบิลอยู่ที่เครื่อง ${cur.posTerminalId}${cur.posOpenedAt ? ` (${claimTime(cur.posOpenedAt)} น.)` : ''} — ย้ายมาเปิดที่เครื่องนี้แทน? (เครื่องเดิมจะรับเงินบิลนี้ไม่ได้)`,
          terminalId: cur.posTerminalId,
        });
      }
      if (terminalId) await tx.onlineOrder.update({ where: { id }, data: { posTerminalId: terminalId, posOpenedAt: new Date() } });
      return tx.onlineOrder.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { id: true, sku: true, name: true, isBundle: true, isActive: true } } } }, customer: { select: { id: true, name: true } } },
      });
    }, { timeout: 15000 });
    const fee = money(o.deliveryFee);
    const lines = o.items.map((i) => ({ productId: i.productId, sku: i.product.sku, name: i.product.name, unitId: i.unitId, unitName: i.unitName, factor: i.factor, quantity: Number(i.quantity), unitPrice: money(i.unitPrice), isBundle: i.product.isBundle }));
    if (fee > 0) {
      const p = await this.ensureDeliveryProduct();
      lines.push({ productId: p.id, sku: p.sku, name: p.name, unitId: null, unitName: p.unit || 'ครั้ง', factor: 1, quantity: 1, unitPrice: fee, isBundle: false });
    }
    return { id: o.id, orderNo: o.orderNo, customer: o.customer, contactName: o.contactName, totalAmount: money(o.totalAmount), note: `ออเดอร์ออนไลน์ ${o.orderNo}${o.fulfillment === 'DELIVERY' ? ' (ส่งของ)' : ' (รับที่ร้าน)'}`, lines };
  }

  /** The system service product "ค่าส่ง" (created on first use; reactivated / kept a service). */
  async ensureDeliveryProduct() {
    const found = await this.prisma.product.findUnique({ where: { sku: DELIVERY_SKU } });
    if (found) {
      if (!found.isService || !found.isActive) return this.prisma.product.update({ where: { id: found.id }, data: { isService: true, isActive: true } });
      return found;
    }
    try {
      return await this.prisma.product.create({ data: { sku: DELIVERY_SKU, name: 'ค่าส่ง', unit: 'ครั้ง', basePrice: 0, costPrice: 0, isService: true, description: 'ค่าส่งสินค้า (บริการ ไม่ตัดสต็อก)' } });
    } catch {
      return this.prisma.product.findUniqueOrThrow({ where: { sku: DELIVERY_SKU } });
    }
  }

  // ───────────────────────── LINE link requests ─────────────────────────

  async linkRequests(q: any) {
    const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(q?.status) ? q.status : 'PENDING';
    const rows = await this.prisma.lineLinkRequest.findMany({ where: { status }, orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' }, take: 100 });
    // members whose phone matches (digits only), as suggestions for staff
    const phones = [...new Set(rows.map((r) => r.phone))];
    const matches = phones.length
      ? await this.prisma.$queryRaw<{ id: string; name: string; phone: string; digits: string }[]>`
          SELECT id, name, phone, regexp_replace(phone, '\\D', '', 'g') AS digits FROM customers
          WHERE regexp_replace(phone, '\\D', '', 'g') = ANY(${phones}::text[])`
      : [];
    const ids = [...new Set(rows.map((r) => r.customerId).filter(Boolean) as string[])];
    const chosen = ids.length ? await this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } }) : [];
    return rows.map((r) => ({
      ...r,
      matches: matches.filter((m) => m.digits === r.phone).map((m) => ({ id: m.id, name: m.name, phone: m.phone })),
      customer: chosen.find((c) => c.id === r.customerId) || null,
    }));
  }

  async decideLink(id: string, body: any, user: any) {
    if (!userHasPermission(user, 'POS_DISCOUNT')) throw new ForbiddenException('ต้องเป็นผู้จัดการ หรือมีสิทธิ์ให้ส่วนลด จึงจะอนุมัติการผูกสมาชิกได้ (ลูกค้าจะได้ราคาสมาชิก)');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.lineLinkRequest.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('ไม่พบคำขอ');
      if (r.status !== 'PENDING') throw new BadRequestException('คำขอนี้ตัดสินไปแล้ว');
      const now = new Date();
      if (body?.approve !== true) {
        return tx.lineLinkRequest.update({ where: { id }, data: { status: 'REJECTED', decidedAt: now, decidedById: user?.id || null, note: text(body?.note, 200) || null } });
      }
      let customerId = typeof body?.customerId === 'string' ? body.customerId : '';
      if (!customerId && body?.createCustomer) {
        const name = text(body.createCustomer.name, 80);
        if (!name) throw new BadRequestException('กรุณาระบุชื่อลูกค้า');
        const taken = await tx.customer.findFirst({ where: { phone: r.phone } });
        if (taken) throw new ConflictException('เบอร์นี้มีลูกค้าอยู่แล้ว ให้เลือกลูกค้าคนนั้นแทน');
        const level = normalizeLevel(body.createCustomer.priceLevel);
        const fee = parseDeliveryFee(body.createCustomer.deliveryFee);
        if (!fee.ok) throw new BadRequestException(fee.error);
        customerId = (await tx.customer.create({ data: { name, phone: r.phone, profile: { priceLevel: level, ...(fee.value !== null ? { deliveryFee: fee.value } : {}) } } })).id;
      }
      const cu = customerId ? await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } }) : null;
      if (!cu) throw new BadRequestException('กรุณาเลือกลูกค้าที่จะผูก');
      await tx.shopVisitor.upsert({ where: { lineUserId: r.lineUserId }, create: { lineUserId: r.lineUserId, displayName: r.displayName, customerId: cu.id, linkedAt: now }, update: { customerId: cu.id, linkedAt: now } });
      return tx.lineLinkRequest.update({ where: { id }, data: { status: 'APPROVED', customerId: cu.id, decidedAt: now, decidedById: user?.id || null, note: text(body?.note, 200) || null } });
    });
  }

  /** LINE accounts linked to a member (customer page) and unlinking. */
  async linkedAccounts(customerId: string) {
    return this.prisma.shopVisitor.findMany({ where: { customerId }, select: { lineUserId: true, displayName: true, linkedAt: true } });
  }

  async unlink(lineUserId: string, user: any) {
    if (!userHasPermission(user, 'POS_DISCOUNT')) throw new ForbiddenException('ไม่มีสิทธิ์ยกเลิกการผูกสมาชิก');
    const r = await this.prisma.shopVisitor.updateMany({ where: { lineUserId }, data: { customerId: null, linkedAt: null } });
    if (!r.count) throw new NotFoundException('ไม่พบบัญชี LINE');
    return { ok: true };
  }

  // ───────────────────────── settings (ADMIN) ─────────────────────────

  async adminConfig() {
    const c = await this.line.config();
    const t = c.messagingToken;
    return {
      enabled: c.enabled, liffId: c.liffId, loginChannelId: c.loginChannelId, publicBaseUrl: c.publicBaseUrl,
      allowPickup: c.allowPickup, allowDelivery: c.allowDelivery, notice: c.notice, levelNames: levelNames(c.levelNames),
      hasMessagingToken: !!t, messagingTokenHint: t ? `••••${t.slice(-4)}` : null,
      gatewayPort: Number(process.env.SHOP_GATEWAY_PORT || 3080) || null,
      publicHost: process.env.SHOP_PUBLIC_HOST || null,
    };
  }

  async saveConfig(body: any) {
    const data: Prisma.OnlineShopConfigUncheckedCreateInput = { id: 1 };
    const b = body || {};
    if (b.enabled !== undefined) data.enabled = b.enabled === true;
    if (b.allowPickup !== undefined) data.allowPickup = b.allowPickup === true;
    if (b.allowDelivery !== undefined) data.allowDelivery = b.allowDelivery === true;
    if (b.liffId !== undefined) {
      const v = text(b.liffId, 80);
      if (v && !/^\d{6,20}-[A-Za-z0-9]{4,20}$/.test(v)) throw new BadRequestException('LIFF ID ไม่ถูกต้อง (รูปแบบ 1234567890-AbCdEfGh)');
      data.liffId = v || null;
    }
    if (b.loginChannelId !== undefined) {
      const v = text(b.loginChannelId, 30);
      if (v && !/^\d{6,20}$/.test(v)) throw new BadRequestException('Channel ID ต้องเป็นตัวเลข');
      data.loginChannelId = v || null;
    }
    if (b.publicBaseUrl !== undefined) {
      const v = text(b.publicBaseUrl, 200).replace(/\/+$/, '');
      if (v && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v)) throw new BadRequestException('ที่อยู่เว็บร้านต้องขึ้นต้นด้วย https:// และเป็นชื่อโดเมนเท่านั้น เช่น https://shop.example.com');
      data.publicBaseUrl = v || null;
    }
    if (b.notice !== undefined) data.notice = text(b.notice, 300) || null;
    if (b.levelNames !== undefined) data.levelNames = levelNames(b.levelNames) as any;
    if (b.messagingToken !== undefined) {
      const v = typeof b.messagingToken === 'string' ? b.messagingToken.trim() : '';
      if (v && (v.length < 20 || v.length > 1000 || /\s/.test(v))) throw new BadRequestException('Channel access token ไม่ถูกต้อง');
      data.messagingToken = v || null;
    }
    const { id: _id, ...update } = data;
    await this.prisma.onlineShopConfig.upsert({ where: { id: 1 }, create: data, update });
    this.categoryCache = null;
    return this.adminConfig();
  }

  async testLine() {
    const c = await this.line.config();
    if (!c.messagingToken) return { ok: false, error: 'ยังไม่ได้ใส่ Channel access token' };
    return this.line.botInfo(c.messagingToken);
  }
}

/** Who is preparing the order (list / detail). */
function claimOf(o: { claimedById: string | null; claimedAt: Date | null; claimedBy?: { id: string; fullName: string; username: string } | null }) {
  if (!o.claimedById) return null;
  return { userId: o.claimedById, name: o.claimedBy?.fullName || o.claimedBy?.username || '-', at: o.claimedAt };
}

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
