import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CashMovementType, ShiftStatus, PaymentMethod } from '@prisma/client';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

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

    return this.getShiftSummary(shift.id, tx);
    });
  }

  async getShiftSummary(shiftId: string, db: any = this.prisma) {
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      include: {
        user: { select: { id: true, fullName: true } },
        orders: {
          include: { payments: true },
        },
        cashMovements: true,
      },
    });

    if (!shift) throw new NotFoundException('ไม่พบข้อมูลกะนี้');

    let cashSales = 0;
    let qrSales = 0;
    let transferSales = 0;
    let creditCardSales = 0;
    let debtSales = 0;
    let totalSales = 0;
    let cashIn = 0;
    let cashOut = 0;
    let cashRefunds = 0;
    let claimRefundCount = 0;

    for (const order of shift.orders) {
      const wasCompletedAtShiftClose =
        shift.status === ShiftStatus.CLOSED &&
        shift.closedAt &&
        order.status === 'VOIDED' &&
        order.updatedAt &&
        new Date(order.updatedAt) >= new Date(shift.closedAt);

      if (order.status !== 'COMPLETED' && !wasCompletedAtShiftClose) continue;
      for (const p of order.payments) {
        const amt = Number(p.amount) || 0;
        if (p.method === PaymentMethod.CASH) cashSales += amt;
        else if (p.method === PaymentMethod.QR_PROMPTPAY) qrSales += amt;
        else if (p.method === PaymentMethod.TRANSFER) transferSales += amt;
        else if (p.method === PaymentMethod.CREDIT_CARD) creditCardSales += amt;
        else if (p.method === PaymentMethod.CREDIT_DEBT || p.method === PaymentMethod.CREDIT_NOTE) debtSales += amt;
        totalSales += amt;
      }
    }

    const promptpaySales = qrSales + transferSales;
    const voidCount = shift.orders.filter((o: any) => o.status === 'VOIDED').length;

    for (const movement of shift.cashMovements) {
      const amount = Number(movement.amount) || 0;
      if (movement.type === CashMovementType.IN) {
        cashIn += amount;
      } else if (movement.type === CashMovementType.OUT) {
        const reasonText = (movement.reason || '').trim();
        if (
          reasonText.startsWith('คืนเงินสดเคลมสินค้า') ||
          reasonText.startsWith('คืนเงินสดยกเลิกบิล')
        ) {
          cashRefunds += amount;
          claimRefundCount += 1;
        } else {
          cashOut += amount;
        }
      }
    }

    const startingCash = Number(shift.startingCash) || 0;
    const expectedCash = startingCash + cashSales + cashIn - cashOut - cashRefunds;

    return {
      shift,
      startingCash,
      cashSales,
      qrSales,
      transferSales,
      promptpaySales,
      creditCardSales,
      cardSales: creditCardSales,
      debtSales,
      creditSales: debtSales,
      cashIn,
      cashOut,
      cashRefunds,
      claimRefundCount,
      totalSales,
      expectedCash,
      orderCount: shift.orders.length,
      voidCount,
    };
  }

  async closeShift(shiftId: string, actualCash: number, note?: string) {
    if (!Number.isFinite(actualCash) || actualCash < 0) throw new BadRequestException('ยอดนับเงินไม่ถูกต้อง');
    return businessTransaction(this.prisma, async tx => {

    const summary = await this.getShiftSummary(shiftId, tx);
    if (summary.shift.status === ShiftStatus.CLOSED) {
      return summary.shift;
    }

    const expectedCash = summary.expectedCash;
    const cashDifference = actualCash - expectedCash;

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

  async addCashMovement(shiftId: string, type: 'in' | 'out', amount: number, reason: string, clientMovementId?: string) {
    if (!clientMovementId || clientMovementId.length > 100) throw new BadRequestException('ต้องระบุรหัสรายการเงินสด');
    return businessTransaction(this.prisma, async tx => {
      const existing = await tx.cashMovement.findUnique({ where: { id: clientMovementId } });
      if (existing) {
        if (existing.shiftId !== shiftId || Number(existing.amount) !== amount || existing.type !== (type === 'in' ? CashMovementType.IN : CashMovementType.OUT)) throw new BadRequestException('รายการนี้ถูกบันทึกแล้วด้วยข้อมูลต่างกัน กรุณาตรวจประวัติก่อนทำรายการใหม่');
        return existing;
      }
      const shift = await tx.shift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.status !== ShiftStatus.OPEN) throw new BadRequestException('ไม่พบกะที่เปิดอยู่');
      if (!Number.isFinite(amount) || amount <= 0 || !['in','out'].includes(type)) throw new BadRequestException('รายการเงินสดไม่ถูกต้อง');
      if (type === 'out' && amount > (await this.getShiftSummary(shiftId, tx)).expectedCash) throw new BadRequestException('ยอดนำออกมากกว่าเงินสดคงเหลือในฐานข้อมูล');
      return tx.cashMovement.create({ data: { id: clientMovementId, shiftId, type: type === 'in' ? CashMovementType.IN : CashMovementType.OUT, amount, reason: reason?.trim() || (type === 'in' ? 'เติมเงินสด' : 'นำเงินสดออก') } });
    });
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
          orders: {
            include: { payments: true },
          },
          cashMovements: true,
        },
      }),
      this.prisma.shift.count({ where }),
    ]);

    const formatted = shifts.map((shift) => {
      let cashSales = 0;
      let transferSales = 0;
      let qrSales = 0;
      let cardSales = 0;
      let creditSales = 0;
      let otherSales = 0;
      let totalSales = 0;
      let cashInAmount = 0;
      let cashOutAmount = 0;
      let cashRefundAmount = 0;
      let claimRefundCount = 0;

      for (const order of shift.orders) {
        const wasCompletedAtShiftClose =
          shift.status === ShiftStatus.CLOSED &&
          shift.closedAt &&
          order.status === 'VOIDED' &&
          order.updatedAt &&
          new Date(order.updatedAt) >= new Date(shift.closedAt);

        if (order.status !== 'COMPLETED' && !wasCompletedAtShiftClose) continue;
        for (const p of order.payments) {
          const amt = Number(p.amount) || 0;
          if (p.method === PaymentMethod.CASH) cashSales += amt;
          else if (p.method === PaymentMethod.QR_PROMPTPAY) qrSales += amt;
          else if (p.method === PaymentMethod.TRANSFER) transferSales += amt;
          else if (p.method === PaymentMethod.CREDIT_CARD) cardSales += amt;
          else if (p.method === PaymentMethod.CREDIT_DEBT || p.method === PaymentMethod.CREDIT_NOTE) creditSales += amt;
          else otherSales += amt;
          totalSales += amt;
        }
      }

      const voidCount = shift.orders.filter((o: any) => o.status === 'VOIDED').length;

      for (const m of shift.cashMovements) {
        const amt = Number(m.amount) || 0;
        if (m.type === CashMovementType.IN) {
          cashInAmount += amt;
        } else if (m.type === CashMovementType.OUT) {
          const reasonText = (m.reason || '').trim();
          if (
            reasonText.startsWith('คืนเงินสดเคลมสินค้า') ||
            reasonText.startsWith('คืนเงินสดยกเลิกบิล')
          ) {
            cashRefundAmount += amt;
            claimRefundCount += 1;
          } else {
            cashOutAmount += amt;
          }
        }
      }

      const startingCash = Number(shift.startingCash) || 0;
      const expectedCash = startingCash + cashSales + cashInAmount - cashOutAmount - cashRefundAmount;
      const actualCash = shift.actualCash !== null ? Number(shift.actualCash) : expectedCash;
      const difference = actualCash - expectedCash;

      return {
        id: shift.id,
        shiftNumber: shift.shiftNumber,
        shiftId: shift.shiftNumber || shift.id,
        userId: shift.userId,
        openedAt: shift.openedAt.toISOString(),
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : new Date().toISOString(),
        userName: shift.user?.fullName || (shift.user as any)?.username || 'พนักงาน',
        startingCash,
        openingCash: startingCash,
        actualCash,
        expectedCash,
        difference,
        ordersCount: shift.orders.length,
        orderCount: shift.orders.length,
        voidCount,
        totalSales,
        cashSales,
        transferSales,
        qrSales,
        cardSales,
        creditCardSales: cardSales,
        creditSales,
        debtSales: creditSales,
        otherSales,
        cashIn: cashInAmount,
        cashInAmount,
        cashOut: cashOutAmount,
        cashOutAmount,
        cashRefunds: cashRefundAmount,
        cashRefundAmount,
        claimRefundCount,
        status: difference === 0 ? 'BALANCED' : difference < 0 ? 'SHORT' : 'OVER',
        note: shift.note || '',
      };
    });

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
