import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Claim lock of online orders (docs/online-shop.md "Claim lock"): one staff member PICKS an order.
 * Owner (2026-11-17): "Picking is for the picker. Once picking is done, every cashier can take payment and hand
 * the goods to the customer."
 *
 * The claim is taken with ONE conditional UPDATE (only when nobody holds it, or the caller already does), so two
 * cashiers pressing at the same moment cannot both get it: PostgreSQL re-checks the WHERE after the first one
 * commits and the second UPDATE changes no row. Only the picking actions (edit items / qty / price / fee, accept,
 * reject, picking slip, "เตรียมของ", "จัดของเสร็จ") claim it first and are refused while someone else holds it.
 * Opening as a POS bill, payment and the delivery steps (กำลังส่ง / เสร็จ) are NOT claimed: any cashier may do
 * them. "จัดของเสร็จ" records the picker and ends the claim. ADMIN / MANAGER may take it over explicitly (audit log
 * ONLINE_ORDER_TAKEOVER).
 */

/** statuses in which an order can be claimed (open orders) */
export const CLAIMABLE = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'] as const;

export interface StaffUser {
  id: string;
  role?: string;
  fullName?: string;
  username?: string;
  permissions?: unknown;
}

type Db = Prisma.TransactionClient;

export const isManager = (u: { role?: string } | null | undefined) => u?.role === 'ADMIN' || u?.role === 'MANAGER';

/** HH:mm in the shop's time zone */
export const claimTime = (d: Date | null | undefined) =>
  d ? d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

/**
 * Atomic claim. true = the caller holds the order now (just claimed, or already held); false = someone else holds
 * it or the order is closed / missing. Keeps the original claim time when the caller already held it.
 */
export async function tryClaim(db: Db, orderId: string, userId: string): Promise<boolean> {
  const now = new Date();
  const n = await db.$executeRaw`UPDATE "online_orders"
    SET "claimed_by_id" = ${userId},
        "claimed_at" = CASE WHEN "claimed_by_id" = ${userId} THEN "claimed_at" ELSE ${now} END,
        "updated_at" = ${now}
    WHERE "id" = ${orderId}
      AND "status"::text IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING')
      AND ("claimed_by_id" IS NULL OR "claimed_by_id" = ${userId})`;
  return n > 0;
}

/** Why a claim failed, as the exception the API returns (404 / 400 closed / 409 held by someone else). */
export async function claimRefusal(db: Db, orderId: string, user: StaffUser): Promise<never> {
  const o = await db.onlineOrder.findUnique({ where: { id: orderId }, select: { orderNo: true, status: true, claimedById: true, claimedAt: true, claimedBy: { select: { fullName: true, username: true } } } });
  if (!o) throw new NotFoundException('ไม่พบออเดอร์ออนไลน์');
  if (!(CLAIMABLE as readonly string[]).includes(o.status)) throw new BadRequestException(`ออเดอร์ ${o.orderNo} ปิดแล้ว (เสร็จหรือยกเลิก)`);
  const name = o.claimedBy?.fullName || o.claimedBy?.username || 'พนักงานคนอื่น';
  throw new ConflictException({
    statusCode: 409,
    code: 'ONLINE_ORDER_CLAIMED',
    message: `ออเดอร์ ${o.orderNo} กำลังจัดโดย ${name}${o.claimedAt ? ` (ตั้งแต่ ${claimTime(o.claimedAt)} น.)` : ''} — ทำรายการนี้ไม่ได้${isManager(user) ? ' (ผู้จัดการกด "ปลดล็อก/โอนมาที่ฉัน" ได้)' : ''}`,
    claimedBy: { id: o.claimedById, name },
    claimedAt: o.claimedAt,
    canTakeOver: isManager(user),
  });
}

/** Claim or throw (used at the start of every action on the order, inside its transaction). */
export async function ensureClaim(db: Db, orderId: string, user: StaffUser): Promise<void> {
  if (!user?.id) throw new BadRequestException('ไม่ทราบผู้ใช้');
  if (await tryClaim(db, orderId, user.id)) return;
  await claimRefusal(db, orderId, user);
}

/** Fields that end a claim (reject / cancel / done). */
export const RELEASED = { claimedById: null, claimedAt: null, posTerminalId: null, posOpenedAt: null } as const;
/** Fields that end only the picking claim ("จัดของเสร็จ", กำลังส่ง): the POS bill terminal stays. */
export const UNCLAIMED = { claimedById: null, claimedAt: null } as const;
