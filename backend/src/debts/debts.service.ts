import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DebtStatus, PaymentMethod } from '@prisma/client';

@Injectable()
export class DebtsService {
  constructor(private prisma: PrismaService) {}

  async getAllDebts(page = 1, limit = 20, search?: string, status?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status as DebtStatus;
    }

    if (search && search.trim()) {
      where.OR = [
        { customer: { name: { contains: search.trim(), mode: 'insensitive' } } },
        { customer: { phone: { contains: search.trim() } } },
        { order: { orderNumber: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [debts, total] = await Promise.all([
      this.prisma.customerDebt.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true, address: true } },
          order: { select: { id: true, orderNumber: true, totalAmount: true, createdAt: true } },
          payments: { orderBy: { paymentDate: 'desc' } },
        },
      }),
      this.prisma.customerDebt.count({ where }),
    ]);

    // Calculate aggregated totals
    const aggregates = await this.prisma.customerDebt.aggregate({
      _sum: {
        totalDebt: true,
        paidAmount: true,
        remainingAmount: true,
      },
    });

    return {
      data: debts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalDebt: Number(aggregates._sum.totalDebt) || 0,
        totalPaid: Number(aggregates._sum.paidAmount) || 0,
        totalRemaining: Number(aggregates._sum.remainingAmount) || 0,
      },
    };
  }

  async getDebtDetails(id: string) {
    const debt = await this.prisma.customerDebt.findUnique({
      where: { id },
      include: {
        customer: true,
        order: {
          include: {
            items: { include: { product: true } },
            payments: true,
          },
        },
        payments: { orderBy: { paymentDate: 'desc' } },
      },
    });

    if (!debt) throw new NotFoundException('ไม่พบข้อมูลหนี้สินนี้');
    return debt;
  }

  async payDebt(
    debtId: string,
    amount: number,
    paymentMethod: PaymentMethod = PaymentMethod.CASH,
    referenceNo?: string,
    cashierName = 'เจ้าหน้าที่',
    note?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const debt = await tx.customerDebt.findUnique({ where: { id: debtId } });
      if (!debt) throw new NotFoundException('ไม่พบข้อมูลหนี้สินนี้');

      const remaining = Number(debt.remainingAmount);
      if (remaining <= 0) {
        throw new BadRequestException('หนี้ก้อนนี้ชำระครบเต็มจำนวนแล้ว');
      }

      const payAmt = Math.min(remaining, Math.max(0, amount));
      if (payAmt <= 0) {
        throw new BadRequestException('ยอดชำระต้องมากกว่า 0 บาท');
      }

      // Generate receipt number
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await tx.debtPayment.count({
        where: { receiptNo: { startsWith: `REC-${dateStr}` } },
      });
      const receiptNo = `REC-${dateStr}-${String(count + 1).padStart(4, '0')}`;

      // 1. Create debt payment entry
      const payment = await tx.debtPayment.create({
        data: {
          debtId,
          amount: payAmt,
          paymentMethod,
          referenceNo: referenceNo?.trim() || null,
          cashierName,
          receiptNo,
          note: note?.trim() || null,
        },
      });

      // 2. Update debt record
      const newPaid = Number(debt.paidAmount) + payAmt;
      const newRemaining = Math.max(0, Number(debt.totalDebt) - newPaid);
      const newStatus = newRemaining <= 0 ? DebtStatus.PAID : DebtStatus.PARTIALLY_PAID;

      const updatedDebt = await tx.customerDebt.update({
        where: { id: debtId },
        data: {
          paidAmount: newPaid,
          remainingAmount: newRemaining,
          status: newStatus,
        },
        include: {
          customer: true,
          payments: { orderBy: { paymentDate: 'desc' } },
        },
      });

      return {
        success: true,
        message: 'บันทึกรับชำระหนี้สำเร็จ',
        payment,
        debt: updatedDebt,
      };
    });
  }

  async getDebtPaymentsHistory(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search && search.trim()) {
      where.OR = [
        { receiptNo: { contains: search.trim(), mode: 'insensitive' } },
        { referenceNo: { contains: search.trim(), mode: 'insensitive' } },
        { cashierName: { contains: search.trim(), mode: 'insensitive' } },
        { debt: { customer: { name: { contains: search.trim(), mode: 'insensitive' } } } },
      ];
    }

    const [payments, total] = await Promise.all([
      this.prisma.debtPayment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paymentDate: 'desc' },
        include: {
          debt: {
            include: {
              customer: { select: { id: true, name: true, phone: true } },
              order: { select: { id: true, orderNumber: true } },
            },
          },
        },
      }),
      this.prisma.debtPayment.count({ where }),
    ]);

    return {
      data: payments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
