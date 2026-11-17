import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Subject } from 'rxjs';
import { ONLINE_PAYABLE_STATUSES } from '../../../shared/src/online-shop';

/** Online orders paid in the POS (OnlineShopService sends the LINE "done" message after the commit). */
export const onlineOrderPaid$ = new Subject<{ onlineOrderId: string; done: boolean }>();

const PAYABLE = ONLINE_PAYABLE_STATUSES as readonly string[];

export interface LinkContext {
  userId: string;
  /** terminal of the paying shift */
  terminalId: string | null;
}

/**
 * Inside the checkout transaction: the POS bill pays an accepted online order. Pickup orders are finished by
 * the payment (the customer is at the counter); delivery orders stay open until staff mark them done.
 *
 * One POS bill per online order: the link is ONE conditional UPDATE (`pos_order_id IS NULL`), so when two
 * terminals pay the same order at the same moment the second UPDATE (re-checked by PostgreSQL after the first
 * commits) changes no row and that checkout is rolled back (409). A retry of the SAME bill never gets here
 * (checkout returns the existing order for its clientOrderId). Also refused: an order that was moved to another
 * terminal ("เปิดบิล" there). The claim lock does NOT apply: picking is for the picker, any cashier may take the
 * payment (picked or not; the POS only warns "ยังไม่ได้จัดของ"). The payment never claims the order.
 */
export async function linkOnlineOrder(tx: Prisma.TransactionClient, onlineOrderId: string, posOrderId: string, ctx: LinkContext) {
  const oo = await tx.onlineOrder.findUnique({ where: { id: onlineOrderId } });
  if (!oo) throw new BadRequestException('ไม่พบออเดอร์ออนไลน์');
  if (oo.posOrderId) throw new ConflictException(`ออเดอร์ออนไลน์ ${oo.orderNo} ชำระเงินไปแล้ว (บิลอื่น) — ล้างตะกร้านี้`);
  if (!PAYABLE.includes(oo.status)) throw new BadRequestException(`ออเดอร์ออนไลน์ ${oo.orderNo} ยังไม่ได้รับหรือถูกยกเลิกแล้ว`);
  if (oo.posTerminalId && ctx.terminalId && oo.posTerminalId !== ctx.terminalId) {
    throw new ConflictException(`ออเดอร์ออนไลน์ ${oo.orderNo} ถูกย้ายไปเปิดบิลที่เครื่อง ${oo.posTerminalId} แล้ว — ล้างตะกร้านี้`);
  }
  const now = new Date();
  const done = oo.fulfillment === 'PICKUP';
  const n = done
    ? await tx.$executeRaw`UPDATE "online_orders" SET "pos_order_id" = ${posOrderId}, "paid_at" = ${now}, "status" = 'DONE', "done_at" = ${now},
        "claimed_by_id" = NULL, "claimed_at" = NULL, "pos_terminal_id" = NULL, "pos_opened_at" = NULL, "updated_at" = ${now}
        WHERE "id" = ${oo.id} AND "pos_order_id" IS NULL AND "status"::text IN (${Prisma.join(PAYABLE)})`
    : await tx.$executeRaw`UPDATE "online_orders" SET "pos_order_id" = ${posOrderId}, "paid_at" = ${now}, "updated_at" = ${now}
        WHERE "id" = ${oo.id} AND "pos_order_id" IS NULL AND "status"::text IN (${Prisma.join(PAYABLE)})`;
  if (!n) throw new ConflictException(`ออเดอร์ออนไลน์ ${oo.orderNo} เพิ่งถูกชำระที่เครื่องอื่น — บิลนี้ไม่ถูกบันทึก`);
  // after the commit (the transaction may still fail): a short delay is enough, the notice is best effort
  setTimeout(() => onlineOrderPaid$.next({ onlineOrderId: oo.id, done }), 1500);
}

/** Voiding the POS bill: the online order is unpaid again (a pickup order closed by the payment reopens). */
export async function unlinkOnlineOrder(tx: Prisma.TransactionClient, posOrderId: string) {
  const oo = await tx.onlineOrder.findUnique({ where: { posOrderId } });
  if (!oo) return;
  await tx.onlineOrder.update({
    where: { id: oo.id },
    data: { posOrderId: null, paidAt: null, posTerminalId: null, posOpenedAt: null, ...(oo.status === 'DONE' ? { status: 'ACCEPTED', doneAt: null } : {}) },
  });
}
