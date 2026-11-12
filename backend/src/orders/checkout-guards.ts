import { BadRequestException } from '@nestjs/common';
import { hasMax2Decimals, qn } from '../common/qty';
import { roundSatang } from '../../../shared/src/money';

// Bill arithmetic is shared with the POS cart preview (shared/src/pricing.ts)
export { lineAmounts } from '../../../shared/src/pricing';

/** Upper bounds that keep every amount inside the Decimal columns (unit price Decimal(10,2), totals Decimal(12,2)). */
export const MAX_ITEM_QTY = 100000;
export const MAX_UNIT_PRICE = 10_000_000;
export const MAX_BILL_AMOUNT = 1_000_000_000;
const ORDER_NUMBER = /^[A-Za-z0-9_-]{1,40}$/;

export const round2 = roundSatang;

const isPlainObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const optString = (v: unknown, max = 100) => v === undefined || v === null || v === '' || (typeof v === 'string' && v.length <= max);
const optMoney = (v: unknown, max = MAX_BILL_AMOUNT) => {
  if (v === undefined || v === null || v === '') return true;
  const n = Number(v);
  return (typeof v === 'number' || typeof v === 'string') && Number.isFinite(n) && n >= 0 && n <= max;
};

/**
 * Shape / range checks of a checkout payload, done before anything touches the database so that
 * malformed input is a 400 with a Thai message instead of a Prisma / numeric-overflow 500.
 */
export function validateCheckoutInput(data: any): void {
  if (!isPlainObject(data)) throw new BadRequestException('ข้อมูลบิลไม่ถูกต้อง');
  if (!data.clientOrderId || typeof data.clientOrderId !== 'string' || data.clientOrderId.length > 100) {
    throw new BadRequestException('ต้องระบุรหัสธุรกรรมสำหรับป้องกันบิลซ้ำ');
  }
  if (!Array.isArray(data.items) || data.items.length === 0) throw new BadRequestException('บิลต้องมีสินค้า');
  if (data.items.length > 500) throw new BadRequestException('รายการสินค้าในบิลมากเกินไป');
  for (const it of data.items) {
    if (!isPlainObject(it)) throw new BadRequestException('รายการสินค้าในบิลไม่ถูกต้อง');
    if (typeof it.productId !== 'string' || !it.productId || it.productId.length > 100) throw new BadRequestException('รายการสินค้าไม่ระบุรหัสสินค้า');
    if (typeof it.quantity !== 'number' || !hasMax2Decimals(it.quantity) || it.quantity <= 0 || it.quantity > MAX_ITEM_QTY) {
      throw new BadRequestException(`จำนวนสินค้าไม่ถูกต้อง (มากกว่า 0 ไม่เกิน ${MAX_ITEM_QTY.toLocaleString()} ต่อรายการ ทศนิยมไม่เกิน 2 ตำแหน่ง)`);
    }
    const price = Number(it.unitPrice);
    if (it.unitPrice === null || it.unitPrice === '' || !Number.isFinite(price) || price < 0 || price > MAX_UNIT_PRICE) {
      throw new BadRequestException('จำนวนสินค้าหรือราคาไม่ถูกต้อง');
    }
    if (it.quantity * price > MAX_BILL_AMOUNT) throw new BadRequestException('ยอดรายการสินค้าสูงเกินกว่าที่ระบบรองรับ');
    if (!optMoney(it.discountAmount)) throw new BadRequestException('ส่วนลดสินค้าไม่ถูกต้อง');
    if (it.conversionFactor !== undefined && it.conversionFactor !== null && (!Number.isSafeInteger(Number(it.conversionFactor)) || Number(it.conversionFactor) <= 0 || Number(it.conversionFactor) > MAX_ITEM_QTY)) {
      throw new BadRequestException('หน่วยสินค้าไม่ถูกต้อง');
    }
    if (it.claimQuantity !== undefined && it.claimQuantity !== null && (typeof it.claimQuantity !== 'number' || !hasMax2Decimals(it.claimQuantity) || it.claimQuantity < 0 || it.claimQuantity > it.quantity)) {
      throw new BadRequestException('จำนวนสินค้าเคลมไม่ถูกต้อง');
    }
    if (!optString(it.unitId) || !optString(it.unitName, 200)) throw new BadRequestException('หน่วยสินค้าไม่ถูกต้อง');
  }
  if (!Array.isArray(data.payments) || !data.payments.length) throw new BadRequestException('ต้องระบุการชำระเงิน');
  if (data.payments.length > 20 || data.payments.some((p: any) => !isPlainObject(p) || !optMoney(p.amount) || p.amount === undefined || p.amount === null || !optString(p.bankAccountId) || !optString(p.referenceNo, 200))) {
    throw new BadRequestException('วิธีชำระเงินหรือจำนวนเงินไม่ถูกต้อง');
  }
  if (data.orderNumber !== undefined && data.orderNumber !== null && data.orderNumber !== '' && (typeof data.orderNumber !== 'string' || !ORDER_NUMBER.test(data.orderNumber))) {
    throw new BadRequestException('เลขที่บิลไม่ถูกต้อง');
  }
  for (const k of ['discountAmount', 'claimDiscountAmount', 'pointsDiscountAmount', 'totalAmount']) {
    if (!optMoney(data[k])) throw new BadRequestException('ยอดเงินหรือส่วนลดของบิลไม่ถูกต้อง');
  }
  if (data.pointsUsed !== undefined && data.pointsUsed !== null && (!Number.isSafeInteger(Number(data.pointsUsed)) || Number(data.pointsUsed) < 0)) {
    throw new BadRequestException('จำนวนแต้มไม่ถูกต้อง');
  }
  for (const k of ['customerId', 'shiftId', 'approvalId', 'terminalId']) {
    if (!optString(data[k])) throw new BadRequestException('ข้อมูลบิลไม่ถูกต้อง');
  }
  if (data.createdAt !== undefined && data.createdAt !== null && typeof data.createdAt !== 'string') throw new BadRequestException('วันเวลาขายไม่ถูกต้อง');
  if (data.note !== undefined && data.note !== null && typeof data.note !== 'string') throw new BadRequestException('หมายเหตุไม่ถูกต้อง');
}

/**
 * Points redemption must follow the store / customer rate exactly: pointsUsed is a whole multiple
 * of the redeem rate and the discount equals pointsUsed / rate * baht-per-step (it may only be lower
 * when the bill is fully paid by points).
 */
export function checkPointsDiscount(pointsUsed: number, pointsDiscount: number, redeemRate: number, redeemBaht: number, billFullyCovered: boolean): void {
  if (pointsUsed === 0) {
    if (pointsDiscount > 0.001) throw new BadRequestException('ส่วนลดคะแนนไม่ถูกต้อง (ไม่ได้ใช้แต้ม)');
    return;
  }
  if (!(redeemRate > 0) || pointsUsed % redeemRate !== 0) {
    throw new BadRequestException(`จำนวนแต้มที่ใช้ต้องเป็นทวีคูณของ ${redeemRate} แต้ม`);
  }
  const expected = round2((pointsUsed / redeemRate) * redeemBaht);
  if (Math.abs(pointsDiscount - expected) <= 0.01) return;
  if (pointsDiscount < expected && billFullyCovered) return;
  throw new BadRequestException(`ส่วนลดคะแนนไม่ถูกต้อง (${pointsUsed} แต้ม = ฿${expected.toFixed(2)})`);
}

/**
 * How many base units of a product the customer may still claim: bought in completed bills,
 * minus what was returned, minus what was already claimed (claims that were not rejected).
 */
export async function claimableBaseQty(tx: any, customerId: string, productId: string): Promise<number> {
  const bought = await tx.orderItem.findMany({
    where: { productId, order: { customerId, status: 'COMPLETED' } },
    select: { id: true, quantity: true, baseQuantity: true },
  });
  if (!bought.length) return 0;
  const boughtQty = bought.reduce((s: number, i: any) => s + Math.round(qn(i.baseQuantity ?? i.quantity) * 100), 0) / 100;
  const returned = await tx.orderReturnItem.aggregate({ where: { orderItemId: { in: bought.map((i: any) => i.id) } }, _sum: { baseQuantity: true } });
  const claimed = await tx.customerClaim.aggregate({ where: { customerId, productId, status: { not: 'REJECTED' } }, _sum: { baseQuantity: true } });
  return Math.max(0, Math.round((boughtQty - qn(returned._sum.baseQuantity) - qn(claimed._sum.baseQuantity)) * 100) / 100);
}

/** Highest net price per base unit the customer paid for this product (caps a claim's value). */
export async function paidPerBaseUnit(tx: any, customerId: string, productId: string): Promise<number> {
  const rows = await tx.orderItem.findMany({
    where: { productId, order: { customerId, status: 'COMPLETED' } },
    select: { quantity: true, baseQuantity: true, total: true, order: { select: { subtotal: true, totalAmount: true } } },
  });
  let best = 0;
  for (const r of rows) {
    const base = Number(r.baseQuantity ?? r.quantity) || 1;
    const factor = Number(r.order.subtotal) > 0 ? Number(r.order.totalAmount) / Number(r.order.subtotal) : 1;
    best = Math.max(best, (Number(r.total) * factor) / base);
  }
  return round2(best);
}
