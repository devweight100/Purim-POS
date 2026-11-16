import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Subject } from 'rxjs';

/** Online orders paid in the POS (OnlineShopService sends the LINE "done" message after the commit). */
export const onlineOrderPaid$ = new Subject<{ onlineOrderId: string; done: boolean }>();

const PAYABLE = ['ACCEPTED', 'PREPARING', 'DELIVERING'] as const;

/**
 * Inside the checkout transaction: the POS bill pays an accepted online order. Pickup orders are finished by
 * the payment (the customer is at the counter); delivery orders stay open until staff mark them done.
 */
export async function linkOnlineOrder(tx: Prisma.TransactionClient, onlineOrderId: string, posOrderId: string) {
  const oo = await tx.onlineOrder.findUnique({ where: { id: onlineOrderId } });
  if (!oo) throw new BadRequestException('ไม่พบออเดอร์ออนไลน์');
  if (oo.posOrderId) throw new BadRequestException(`ออเดอร์ออนไลน์ ${oo.orderNo} ชำระเงินไปแล้ว`);
  if (!(PAYABLE as readonly string[]).includes(oo.status)) throw new BadRequestException(`ออเดอร์ออนไลน์ ${oo.orderNo} ยังไม่ได้รับหรือถูกยกเลิกแล้ว`);
  const now = new Date();
  const done = oo.fulfillment === 'PICKUP';
  await tx.onlineOrder.update({
    where: { id: oo.id },
    data: { posOrderId, paidAt: now, ...(done ? { status: 'DONE', doneAt: now } : {}) },
  });
  // after the commit (the transaction may still fail): a short delay is enough, the notice is best effort
  setTimeout(() => onlineOrderPaid$.next({ onlineOrderId: oo.id, done }), 1500);
}

/** Voiding the POS bill: the online order is unpaid again (a pickup order closed by the payment reopens). */
export async function unlinkOnlineOrder(tx: Prisma.TransactionClient, posOrderId: string) {
  const oo = await tx.onlineOrder.findUnique({ where: { posOrderId } });
  if (!oo) return;
  await tx.onlineOrder.update({
    where: { id: oo.id },
    data: { posOrderId: null, paidAt: null, ...(oo.status === 'DONE' ? { status: 'ACCEPTED', doneAt: null } : {}) },
  });
}
