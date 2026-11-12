import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashMovementType, ShiftStatus, PaymentMethod } from '@prisma/client';
import * as ledger from '../finance/ledger';
import { roundSatang as round2 } from '../../../shared/src/money';

const CASH_CATEGORIES = ['GENERAL', 'REFUND', 'DEBT_PAYMENT'];
/**
 * Why cash goes in / out of a drawer (chosen by the cashier):
 *  OUT: EXPENSE (store expense, needs a category) | TO_SAFE (cash drop) | TO_BANK (deposit) | REFUND | OTHER
 *  IN : FROM_SAFE (change float) | FROM_BANK (withdrawal / coin exchange) | OTHER_INCOME | OTHER
 */
const OUT_PURPOSES = ['EXPENSE', 'TO_SAFE', 'TO_BANK', 'REFUND', 'OTHER'];
const IN_PURPOSES = ['FROM_SAFE', 'FROM_BANK', 'OTHER_INCOME', 'OTHER'];

/** Only the shift owner (or ADMIN / MANAGER) may close it or move cash in/out of its drawer. */
function assertShiftActor(shift: { userId: string }, actor?: { id?: string; role?: string }) {
  if (!actor) return;
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return;
  if (shift.userId !== actor.id) throw new ForbiddenException('ทำรายการได้เฉพาะกะของตัวเอง (หรือผู้จัดการ)');
}

const SHIFT_ORDER_INCLUDE = {
  payments: true,
  items: { select: { discountAmount: true } },
  returns: { select: { refundAmount: true, refundMethod: true } },
} as const;

/** Kind of a REFUND drawer movement, from the text the system writes on it. */
export function refundKind(reason: string): 'RETURN' | 'VOID' | 'CLAIM' {
  const r = String(reason || '');
  if (r.startsWith('คืนเงินสดคืนสินค้า')) return 'RETURN';
  if (r.includes('ยกเลิกบิล')) return 'VOID';
  return 'CLAIM';
}

/**
 * Figures of one shift, shared by the live summary and the history list / slip.
 * Sales count completed bills (and bills voided after the shift closed, whose money was counted then).
 * Returns of those bills are subtracted in netSales whatever the refund method; the drawer only
 * moves for cash refunds, which are split into return / void / claim refunds.
 */
export function shiftFigures(shift: any) {
  let cashSales = 0, qrSales = 0, transferSales = 0, cardSales = 0, creditSales = 0, creditNoteSales = 0, otherSales = 0, totalSales = 0;
  let orderCount = 0, itemDiscountTotal = 0, billDiscountTotal = 0;
  let returnsTotal = 0, returnCount = 0, returnsCash = 0, returnsTransfer = 0, returnsDebt = 0;
  for (const order of shift.orders || []) {
    const voidedAfterClose =
      shift.status === ShiftStatus.CLOSED && shift.closedAt && order.status === 'VOIDED' &&
      order.updatedAt && new Date(order.updatedAt) >= new Date(shift.closedAt);
    if (order.status !== 'COMPLETED' && !voidedAfterClose) continue;
    orderCount += 1;
    billDiscountTotal += Number(order.discountAmount) || 0;
    for (const it of order.items || []) itemDiscountTotal += Number(it.discountAmount) || 0;
    for (const p of order.payments || []) {
      const amt = Number(p.amount) || 0;
      if (p.method === PaymentMethod.CASH) cashSales += amt;
      else if (p.method === PaymentMethod.QR_PROMPTPAY) qrSales += amt;
      else if (p.method === PaymentMethod.TRANSFER) transferSales += amt;
      else if (p.method === PaymentMethod.CREDIT_CARD) cardSales += amt;
      else if (p.method === PaymentMethod.CREDIT_DEBT) creditSales += amt;
      else if (p.method === PaymentMethod.CREDIT_NOTE) creditNoteSales += amt;
      else otherSales += amt;
      totalSales += amt;
    }
    for (const r of order.returns || []) {
      const amt = Number(r.refundAmount) || 0;
      returnsTotal += amt;
      returnCount += 1;
      if (r.refundMethod === 'CASH') returnsCash += amt;
      else if (r.refundMethod === 'TRANSFER') returnsTransfer += amt;
      else returnsDebt += amt;
    }
  }
  const voidCount = (shift.orders || []).filter((o: any) => o.status === 'VOIDED').length;

  let cashIn = 0, cashOut = 0, debtCollections = 0, debtCollectionCount = 0;
  let cashRefunds = 0, returnRefundAmount = 0, returnRefundCount = 0, voidRefundAmount = 0, voidRefundCount = 0, claimRefundAmount = 0, claimRefundCount = 0;
  for (const m of shift.cashMovements || []) {
    const amt = Number(m.amount) || 0;
    if (m.type === CashMovementType.IN) {
      if (m.category === 'DEBT_PAYMENT') { debtCollections += amt; debtCollectionCount += 1; }
      else cashIn += amt;
    } else if (m.type === CashMovementType.OUT) {
      if (m.category === 'REFUND') {
        cashRefunds += amt;
        const kind = refundKind(m.reason);
        if (kind === 'RETURN') { returnRefundAmount += amt; returnRefundCount += 1; }
        else if (kind === 'VOID') { voidRefundAmount += amt; voidRefundCount += 1; }
        else { claimRefundAmount += amt; claimRefundCount += 1; }
      } else cashOut += amt;
    }
  }
  const startingCash = Number(shift.startingCash) || 0;
  const expectedCash = round2(startingCash + cashSales + cashIn + debtCollections - cashOut - cashRefunds);
  const discountTotal = round2(itemDiscountTotal + billDiscountTotal);
  return {
    startingCash,
    cashSales: round2(cashSales), qrSales: round2(qrSales), transferSales: round2(transferSales),
    promptpaySales: round2(qrSales + transferSales), creditCardSales: round2(cardSales), cardSales: round2(cardSales),
    debtSales: round2(creditSales), creditSales: round2(creditSales), creditNoteSales: round2(creditNoteSales), otherSales: round2(otherSales),
    totalSales: round2(totalSales),
    // net of every return of this shift's bills (cash, transfer and debt reduction)
    returnsTotal: round2(returnsTotal), returnCount, returnsCash: round2(returnsCash), returnsTransfer: round2(returnsTransfer), returnsDebt: round2(returnsDebt),
    netSales: round2(totalSales - returnsTotal),
    discountTotal, totalDiscount: discountTotal, itemDiscountTotal: round2(itemDiscountTotal), billDiscountTotal: round2(billDiscountTotal),
    // cashIn = every cash put in the drawer (kept for older screens); otherCashIn excludes debt collections,
    // which are listed on their own (debtCollectionCash / debtCollectionCount)
    cashIn: round2(cashIn + debtCollections), otherCashIn: round2(cashIn), cashOut: round2(cashOut),
    debtCollectionCash: round2(debtCollections), debtCollectionCount, debtCollectionQrTransfer: 0, debtCollectionTotal: round2(debtCollections),
    cashRefunds: round2(cashRefunds),
    returnRefundAmount: round2(returnRefundAmount), returnRefundCount,
    voidRefundAmount: round2(voidRefundAmount), voidRefundCount,
    claimRefundAmount: round2(claimRefundAmount), claimRefundCount,
    expectedCash,
    orderCount, completedOrderCount: orderCount, voidCount,
  };
}

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService, @Optional() private approvals?: ApprovalsService) {}

  async getCurrentShift(userId?: string, terminalId?: string, db: any = this.prisma) {
    if (db === this.prisma && terminalId) return businessTransaction(this.prisma, tx => this.getCurrentShift(userId, terminalId, tx));
    let shift = await db.shift.findFirst({
      where: { status: ShiftStatus.OPEN, userId, terminalId: terminalId || null },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift && userId && terminalId) {
      const legacy = await db.shift.findFirst({ where: { status: ShiftStatus.OPEN, userId, terminalId: null }, orderBy: { openedAt: 'desc' } });
      if (legacy) shift = await db.shift.update({ where: { id: legacy.id }, data: { terminalId } });
    }
    return shift ? this.getShiftSummary(shift.id, db) : null;
  }

  async openShift(userId: string, startingCash: number, note?: string, terminalId?: string) {
    if (!terminalId || terminalId.length > 100) throw new BadRequestException('ไม่พบรหัสเครื่องขาย');
    if (!Number.isFinite(startingCash) || startingCash < 0) throw new BadRequestException('เงินตั้งต้นไม่ถูกต้อง');
    return businessTransaction(this.prisma, async tx => {
    const other = await tx.shift.findFirst({ where: { terminalId, status: ShiftStatus.OPEN } });
    if (other && other.userId !== userId) throw new BadRequestException('เครื่องนี้มีกะของพนักงานอื่นเปิดอยู่ กรุณาปิดกะก่อน');

    // 1. Check if there is an active open shift
    const current = await this.getCurrentShift(userId, terminalId, tx);
    if (current && current.shift && current.shift.status === ShiftStatus.OPEN) {
      // Shift is already open today! Update startingCash if needed and return
      if (startingCash > 0 && Number(current.startingCash) === 0) {
        await tx.shift.update({
          where: { id: current.shift.id },
          data: { startingCash, expectedCash: startingCash },
        });
        await this.moveFloatIntoDrawer(tx, current.shift.id, current.shift.terminalId, startingCash, userId);
        return this.getShiftSummary(current.shift.id, tx);
      }
      return current;
    }

    // 2. Generate shift number (Format: SHF-YYMMxxxxx e.g. SHF-260900001)
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `SHF-${yy}${mm}`;
    const countToday = await tx.shift.count({
      where: { shiftNumber: { startsWith: prefix } },
    });
    const shiftNumber = `${prefix}${String(countToday + 1).padStart(5, '0')}`;

    const shift = await tx.shift.create({
      data: {
        shiftNumber,
        userId,
        terminalId,
        startingCash,
        expectedCash: startingCash,
        status: ShiftStatus.OPEN,
        note,
      },
      include: {
        user: { select: { id: true, fullName: true, role: true } },
      },
    });

    await this.moveFloatIntoDrawer(tx, shift.id, terminalId, startingCash, userId);
    return this.getShiftSummary(shift.id, tx);
    });
  }

  /** Starting cash (float) comes out of the safe into this terminal's drawer. */
  private async moveFloatIntoDrawer(tx: any, shiftId: string, terminalId: string | null, amount: number, userId?: string) {
    if (!(amount > 0)) return;
    const safe = await ledger.safeAccount(tx);
    const drawer = await ledger.drawerAccount(tx, terminalId);
    await ledger.transfer(tx, {
      fromAccountId: safe.id, toAccountId: drawer.id, amount,
      note: 'เงินทอนตั้งต้นเปิดกะ', userId, refType: 'SHIFT', refId: shiftId,
    });
  }

  async getShiftSummary(shiftId: string, db: any = this.prisma) {
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      include: {
        user: { select: { id: true, fullName: true } },
        orders: { include: SHIFT_ORDER_INCLUDE },
        cashMovements: true,
      },
    });

    if (!shift) throw new NotFoundException('ไม่พบข้อมูลกะนี้');

    const f = { ...shiftFigures(shift), ...(await this.nonCashDebtCollections(db, shift, shiftFigures(shift))) };
    return {
      shift,
      shiftCode: shift.shiftNumber,
      ...f,
    };
  }

  /** QR / transfer debt receipts taken by the shift's cashier while the shift was open (not reversed). */
  private async nonCashDebtCollections(db: any, shift: any, f: { debtCollectionCash: number; debtCollectionCount: number }) {
    const rows: { id: string; amount: any }[] = await db.moneyTransaction.findMany({
      where: {
        type: 'DEBT_RECEIPT', userId: shift.userId,
        occurredAt: { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) },
        account: { type: { not: 'CASH_DRAWER' } },
      },
      select: { id: true, amount: true },
    });
    let qr = 0;
    let count = 0;
    if (rows.length) {
      const reversed = new Set((await db.moneyTransaction.findMany({ where: { reversalOfId: { in: rows.map((r) => r.id) } }, select: { reversalOfId: true } })).map((r: any) => r.reversalOfId));
      for (const r of rows) if (!reversed.has(r.id)) { qr += Number(r.amount) || 0; count += 1; }
    }
    return {
      debtCollectionQrTransfer: round2(qr),
      debtCollectionCount: f.debtCollectionCount + count,
      debtCollectionTotal: round2(f.debtCollectionCash + qr),
    };
  }

  async closeShift(shiftId: string, actualCash: number, note?: string, actor?: { id?: string; role?: string }) {
    if (!Number.isFinite(actualCash) || actualCash < 0) throw new BadRequestException('ยอดนับเงินไม่ถูกต้อง');
    return businessTransaction(this.prisma, async tx => {

    const summary = await this.getShiftSummary(shiftId, tx);
    assertShiftActor(summary.shift, actor);
    if (summary.shift.status === ShiftStatus.CLOSED) {
      return summary.shift;
    }

    const expectedCash = summary.expectedCash;
    const cashDifference = actualCash - expectedCash;

    // Money ledger: record shortage / overage, then hand the counted cash over to the safe
    const drawer = await ledger.drawerAccount(tx, summary.shift.terminalId);
    if (Math.abs(cashDifference) >= 0.01) {
      await ledger.post(tx, {
        accountId: drawer.id, direction: cashDifference > 0 ? 'IN' : 'OUT', amount: Math.abs(cashDifference),
        type: 'SHIFT_OVER_SHORT', refType: 'SHIFT', refId: shiftId,
        note: (cashDifference > 0 ? 'เงินเกินตอนปิดกะ ' : 'เงินขาดตอนปิดกะ ') + summary.shift.shiftNumber, userId: actor?.id,
      });
    }
    if (actualCash > 0) {
      const safe = await ledger.safeAccount(tx);
      await ledger.transfer(tx, {
        fromAccountId: drawer.id, toAccountId: safe.id, amount: actualCash,
        note: 'ส่งเงินสดปิดกะ ' + summary.shift.shiftNumber, userId: actor?.id, refType: 'SHIFT', refId: shiftId,
      });
    }

    const closed = await tx.shift.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        status: ShiftStatus.CLOSED,
        cashSales: summary.cashSales,
        promptpaySales: summary.promptpaySales,
        creditCardSales: summary.creditCardSales,
        debtSales: summary.debtSales,
        totalSales: summary.totalSales,
        expectedCash,
        actualCash,
        cashDifference,
        note: note || summary.shift.note,
      },
      include: {
        user: { select: { id: true, fullName: true } },
      },
    });

    return closed;
    });
  }

  async addCashMovement(
    shiftId: string, type: 'in' | 'out', amount: number, reason: string, clientMovementId?: string,
    actor?: { id?: string; role?: string }, category = 'GENERAL',
    purposeInput?: { purpose?: string; expenseCategoryId?: string; bankAccountId?: string; approvalId?: string },
  ) {
    if (!clientMovementId || typeof clientMovementId !== 'string' || clientMovementId.length > 100) throw new BadRequestException('ต้องระบุรหัสรายการเงินสด');
    if (!['in', 'out'].includes(type)) throw new BadRequestException('ประเภทรายการเงินสดต้องเป็น in หรือ out');
    amount = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0.01) throw new BadRequestException('จำนวนเงินต้องไม่น้อยกว่า 0.01 บาท');
    if (amount > 1_000_000_000) throw new BadRequestException('จำนวนเงินสูงเกินกว่าที่ระบบรองรับ');
    if (reason !== undefined && reason !== null && typeof reason !== 'string') throw new BadRequestException('เหตุผลไม่ถูกต้อง');
    const cat = String(category || 'GENERAL').toUpperCase();
    if (!CASH_CATEGORIES.includes(cat) || (cat === 'REFUND' && type !== 'out') || cat === 'DEBT_PAYMENT') throw new BadRequestException('ประเภทรายการเงินสดไม่ถูกต้อง');
    return businessTransaction(this.prisma, async tx => {
      const existing = await tx.cashMovement.findUnique({ where: { id: clientMovementId } });
      if (existing) {
        // a replay returns the movement only to the person who recorded it
        const log = await tx.auditLog.findFirst({ where: { action: 'CASH_MOVEMENT', entityId: existing.id }, select: { userId: true } });
        const ledgerRow = log ? null : await tx.moneyTransaction.findFirst({ where: { refType: 'CASH_MOVEMENT', refId: existing.id }, select: { userId: true } });
        const creator = log?.userId ?? ledgerRow?.userId ?? null;
        if (creator ? creator !== actor?.id : !!actor && (await tx.shift.findUnique({ where: { id: existing.shiftId } }))?.userId !== actor.id) {
          throw new ForbiddenException('รหัสรายการเงินสดนี้เป็นของผู้ใช้อื่น');
        }
        if (existing.shiftId !== shiftId || Number(existing.amount) !== amount || existing.type !== (type === 'in' ? CashMovementType.IN : CashMovementType.OUT)) throw new BadRequestException('รายการนี้ถูกบันทึกแล้วด้วยข้อมูลต่างกัน กรุณาตรวจประวัติก่อนทำรายการใหม่');
        return existing;
      }
      const shift = await tx.shift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.status !== ShiftStatus.OPEN) throw new BadRequestException('ไม่พบกะที่เปิดอยู่');
      assertShiftActor(shift, actor);
      if (type === 'out' && amount > (await this.getShiftSummary(shiftId, tx)).expectedCash) throw new BadRequestException('ยอดนำออกมากกว่าเงินสดคงเหลือในฐานข้อมูล');
      const purpose = String(purposeInput?.purpose || (cat === 'REFUND' ? 'REFUND' : 'OTHER')).toUpperCase();
      if (!(type === 'in' ? IN_PURPOSES : OUT_PURPOSES).includes(purpose)) throw new BadRequestException('วัตถุประสงค์ของรายการเงินสดไม่ถูกต้อง');
      if (purpose === 'EXPENSE' && !purposeInput?.expenseCategoryId) throw new BadRequestException('กรุณาเลือกหมวดค่าใช้จ่าย');
      const baseReason = reason?.trim() || (type === 'in' ? 'เติมเงินสด' : 'นำเงินสดออก');
      const expenseCategory = purpose === 'EXPENSE'
        ? await tx.expenseCategory.findUnique({ where: { id: purposeInput!.expenseCategoryId! } })
        : null;
      if (purpose === 'EXPENSE' && (!expenseCategory || !expenseCategory.isActive)) throw new BadRequestException('กรุณาเลือกหมวดค่าใช้จ่าย');
      // shift record shows the category; the expense itself keeps the plain description
      const movementReason = expenseCategory ? `${expenseCategory.name}: ${baseReason}` : baseReason;

      // Manager approval (PIN) for drawer cash in / out above the store limit (0 = every movement)
      const approval = await this.cashApprovalCheck(tx, { shiftId, type, amount, purpose, reason: movementReason, clientMovementId, terminalId: shift.terminalId, actor, approvalId: purposeInput?.approvalId });

      const movement = await tx.cashMovement.create({ data: { id: clientMovementId, shiftId, type: type === 'in' ? CashMovementType.IN : CashMovementType.OUT, amount, category: purpose === 'REFUND' ? 'REFUND' : cat, reason: movementReason } });
      if (approval) await this.approvals!.consume(tx, approval.approvalId, approval.hash, actor!.id!, movement.id);
      await tx.auditLog.create({
        data: { userId: actor?.id ?? null, action: 'CASH_MOVEMENT', entity: 'CashMovement', entityId: movement.id, details: { shiftId, type, amount, purpose, reason: movementReason, approvalId: approval?.approvalId ?? null } },
      });
      const drawer = await ledger.drawerAccount(tx, shift.terminalId);
      const ref = { refType: 'CASH_MOVEMENT', refId: movement.id, userId: actor?.id };
      switch (purpose) {
        case 'EXPENSE':
          await ledger.recordExpense(tx, { categoryId: expenseCategory!.id, accountId: drawer.id, amount, description: baseReason, userId: actor?.id });
          break;
        case 'TO_SAFE':
        case 'FROM_SAFE': {
          const safe = await ledger.safeAccount(tx);
          await ledger.transfer(tx, purpose === 'TO_SAFE'
            ? { fromAccountId: drawer.id, toAccountId: safe.id, amount, note: 'นำเงินจากลิ้นชักเก็บเข้าเซฟ: ' + movement.reason, ...ref }
            : { fromAccountId: safe.id, toAccountId: drawer.id, amount, note: 'นำเงินทอนจากเซฟเข้าลิ้นชัก: ' + movement.reason, ...ref });
          break;
        }
        case 'TO_BANK':
        case 'FROM_BANK': {
          const bank = await ledger.bankMoneyAccount(tx, purposeInput?.bankAccountId);
          await ledger.transfer(tx, purpose === 'TO_BANK'
            ? { fromAccountId: drawer.id, toAccountId: bank.id, amount, note: 'นำเงินจากลิ้นชักฝากธนาคาร: ' + movement.reason, ...ref }
            : { fromAccountId: bank.id, toAccountId: drawer.id, amount, note: 'ถอน/แลกเงินจากธนาคารเข้าลิ้นชัก: ' + movement.reason, ...ref });
          break;
        }
        default:
          await ledger.post(tx, {
            accountId: drawer.id, direction: type === 'in' ? 'IN' : 'OUT', amount,
            type: purpose === 'REFUND' ? 'CLAIM_REFUND' : purpose === 'OTHER_INCOME' ? 'OTHER_INCOME' : type === 'in' ? 'DRAWER_IN' : 'DRAWER_OUT',
            note: movement.reason, ...ref,
          });
      }
      return movement;
    });
  }

  /**
   * Returns null when no approval is needed (or the actor may approve themselves: ADMIN / MANAGER).
   * Without an approvalId it throws 409 APPROVAL_REQUIRED with a signed ticket for the PIN dialog;
   * with one, it returns what must be consumed together with the movement.
   */
  private async cashApprovalCheck(tx: any, p: { shiftId: string; type: string; amount: number; purpose: string; reason: string; clientMovementId: string; terminalId: string | null; actor?: { id?: string; role?: string }; approvalId?: string }) {
    if (!this.approvals || !p.actor?.id) return null;
    if (p.actor.role === 'ADMIN' || p.actor.role === 'MANAGER') return null;
    const settings = await tx.storeSettings.findFirst({ select: { cashMovementApprovalLimit: true } });
    const limit = settings ? Number(settings.cashMovementApprovalLimit) : 1000;
    if (limit > 0 && p.amount <= limit) return null;
    const hash = createHash('sha256').update(JSON.stringify({ k: 'CASH', u: p.actor.id, s: p.shiftId, t: p.type, a: p.amount, p: p.purpose, m: p.clientMovementId })).digest('hex');
    if (p.approvalId && typeof p.approvalId === 'string') return { approvalId: p.approvalId, hash };
    const label = p.type === 'in' ? 'นำเงินเข้าลิ้นชัก' : 'นำเงินออกจากลิ้นชัก';
    const message = limit > 0
      ? `${label} ฿${p.amount.toFixed(2)} เกินวงเงิน ฿${limit.toFixed(2)} ต้องให้ผู้จัดการอนุมัติ`
      : `${label} ต้องให้ผู้จัดการอนุมัติทุกครั้ง`;
    const reasons = [{ code: 'CASH_MOVEMENT_LIMIT', message }];
    const ticket = this.approvals.issueTicket({
      t: 'CASH_MOVEMENT', h: hash, r: reasons, a: p.amount, u: p.actor.id, term: p.terminalId,
      s: { total: p.amount, type: p.type, purpose: p.purpose, reason: p.reason, items: [{ name: `${label}: ${p.reason}`, qty: 1, unitPrice: p.amount, discount: 0 }] },
    });
    throw new ConflictException({ statusCode: 409, code: 'APPROVAL_REQUIRED', message: 'รายการนี้ต้องให้ผู้จัดการอนุมัติ: ' + message, reasons, ticket });
  }

  async getShiftHistory(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search && search.trim()) {
      where.OR = [
        { shiftNumber: { contains: search.trim(), mode: 'insensitive' } },
        { user: { fullName: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [shifts, total] = await Promise.all([
      this.prisma.shift.findMany({
        where,
        skip,
        take: limit,
        orderBy: { openedAt: 'desc' },
        include: {
          user: { select: { id: true, fullName: true, role: true } },
          orders: { include: SHIFT_ORDER_INCLUDE },
          cashMovements: true,
        },
      }),
      this.prisma.shift.count({ where }),
    ]);

    const formatted = await Promise.all(shifts.map(async (shift) => {
      const base = shiftFigures(shift);
      const f = { ...base, ...(await this.nonCashDebtCollections(this.prisma, shift, base)) };
      const isOpen = shift.status === ShiftStatus.OPEN;
      // an open shift has not been counted yet: no closing time, no counted cash, no difference
      const actualCash = !isOpen && shift.actualCash !== null ? Number(shift.actualCash) : null;
      const difference = actualCash === null ? null : round2(actualCash - f.expectedCash);
      return {
        id: shift.id,
        shiftNumber: shift.shiftNumber,
        shiftCode: shift.shiftNumber,
        shiftId: shift.shiftNumber || shift.id,
        userId: shift.userId,
        openedAt: shift.openedAt.toISOString(),
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
        isOpen,
        shiftStatus: shift.status,
        userName: shift.user?.fullName || (shift.user as any)?.username || 'พนักงาน',
        openingCash: f.startingCash,
        ...f,
        actualCash,
        difference,
        ordersCount: f.orderCount,
        creditCardSales: f.cardSales,
        debtSales: f.creditSales,
        cashInAmount: f.cashIn,
        cashOutAmount: f.cashOut,
        cashRefundAmount: f.cashRefunds,
        status: isOpen ? 'OPEN' : difference === 0 || difference === null ? 'BALANCED' : difference < 0 ? 'SHORT' : 'OVER',
        note: shift.note || '',
      };
    }));

    return {
      data: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
