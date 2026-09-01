import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftStatus, PaymentMethod } from '@prisma/client';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async getCurrentShift(userId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { userId, status: ShiftStatus.OPEN },
      include: {
        user: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { openedAt: 'desc' },
    });
    return shift;
  }

  async openShift(userId: string, startingCash: number, note?: string) {
    const existing = await this.getCurrentShift(userId);
    if (existing) {
      throw new BadRequestException('พนักงานท่านนี้มีกะที่เปิดค้างอยู่แล้ว กรุณาปิดกะเดิมก่อน');
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await this.prisma.shift.count({
      where: { shiftNumber: { startsWith: `SHF-${dateStr}` } },
    });
    const shiftNumber = `SHF-${dateStr}-${String(countToday + 1).padStart(4, '0')}`;

    const shift = await this.prisma.shift.create({
      data: {
        shiftNumber,
        userId,
        startingCash,
        expectedCash: startingCash,
        status: ShiftStatus.OPEN,
        note,
      },
      include: {
        user: { select: { id: true, fullName: true, role: true } },
      },
    });

    return shift;
  }

  async getShiftSummary(shiftId: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        user: { select: { id: true, fullName: true } },
        orders: {
          include: { payments: true },
        },
      },
    });

    if (!shift) throw new NotFoundException('ไม่พบข้อมูลกะนี้');

    let cashSales = 0;
    let promptpaySales = 0;
    let creditCardSales = 0;
    let debtSales = 0;
    let totalSales = 0;

    for (const order of shift.orders) {
      if (order.status !== 'COMPLETED') continue;
      for (const p of order.payments) {
        const amt = Number(p.amount) || 0;
        if (p.method === PaymentMethod.CASH) cashSales += amt;
        else if (p.method === PaymentMethod.QR_PROMPTPAY || p.method === PaymentMethod.TRANSFER) promptpaySales += amt;
        else if (p.method === PaymentMethod.CREDIT_CARD) creditCardSales += amt;
        else if (p.method === PaymentMethod.CREDIT_DEBT) debtSales += amt;
        totalSales += amt;
      }
    }

    const startingCash = Number(shift.startingCash) || 0;
    const expectedCash = startingCash + cashSales;

    return {
      shift,
      startingCash,
      cashSales,
      promptpaySales,
      creditCardSales,
      debtSales,
      totalSales,
      expectedCash,
      orderCount: shift.orders.length,
    };
  }

  async closeShift(shiftId: string, actualCash: number, note?: string) {
    const summary = await this.getShiftSummary(shiftId);
    if (summary.shift.status === ShiftStatus.CLOSED) {
      throw new BadRequestException('กะนี้ถูกปิดเรียบร้อยแล้ว');
    }

    const expectedCash = summary.expectedCash;
    const cashDifference = actualCash - expectedCash;

    const closed = await this.prisma.shift.update({
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
        },
      }),
      this.prisma.shift.count({ where }),
    ]);

    return {
      data: shifts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
