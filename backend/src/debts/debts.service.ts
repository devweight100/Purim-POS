import { businessTransaction } from '../prisma/business-transaction';
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
    clientPaymentId?: string,
    shiftId?: string,
    userId?: string,
  ) {
    if (!clientPaymentId || !/^[a-zA-Z0-9-]{16,80}$/.test(clientPaymentId)) throw new BadRequestException('กรุณาระบุรหัสรับชำระเพื่อป้องกันรายการซ้ำ');
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new BadRequestException('จำนวนเงินไม่ถูกต้อง');
    if (![PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.QR_PROMPTPAY].includes(paymentMethod as any)) throw new BadRequestException('วิธีรับชำระไม่ถูกต้อง');
    const fingerprint = JSON.stringify({ debtId, amount, paymentMethod, referenceNo: referenceNo || '', note: note || '', shiftId: shiftId || '', userId: userId || '' });
    return businessTransaction(this.prisma, async (tx) => {
      const receiptId = 'debt-pay-' + clientPaymentId;
      const previous = await tx.auditLog.findUnique({ where: { id: receiptId } });
      if (previous) {
        const details = previous.details as any;
        if (details?.fingerprint !== fingerprint) throw new BadRequestException('รหัสรับชำระนี้ถูกใช้กับข้อมูลอื่นแล้ว');
        return details.result;
      }
      const debt = await tx.customerDebt.findFirst({ where: { OR: [{ id: debtId }, { orderId: debtId }] } });
      if (!debt) throw new NotFoundException('ไม่พบข้อมูลหนี้สินนี้');

      const remaining = Number(debt.remainingAmount);
      if (remaining <= 0) {
        throw new BadRequestException('หนี้ก้อนนี้ชำระครบเต็มจำนวนแล้ว');
      }

      if (amount > remaining) throw new BadRequestException('ยอดชำระเกินหนี้คงเหลือ กรุณาโหลดข้อมูลล่าสุด');
      if (paymentMethod === PaymentMethod.CASH) {
        const shift = shiftId ? await tx.shift.findUnique({where:{id:shiftId}}) : null;
        if (!shift || shift.status !== 'OPEN' || shift.userId !== userId) throw new BadRequestException('กรุณาเปิดกะของผู้รับเงินก่อนรับชำระเงินสด');
      }
      const payAmt = amount;
      if (payAmt <= 0) {
        throw new BadRequestException('ยอดชำระต้องมากกว่า 0 บาท');
      }

      // Generate receipt number (Format: REC-YYMMxxxxx e.g. REC-260900001)
      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const prefix = `REC-${yy}${mm}`;
      const count = await tx.debtPayment.count({
        where: { receiptNo: { startsWith: prefix } },
      });
      const receiptNo = `${prefix}${String(count + 1).padStart(5, '0')}`;

      // 1. Create debt payment entry
      const payment = await tx.debtPayment.create({
        data: {
          id: clientPaymentId,
          debtId: debt.id,
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
        where: { id: debt.id },
        data: {
          paidAmount: newPaid,
          remainingAmount: newRemaining,
          status: newStatus,
        },
        include: {
          customer: true,
          order: true,
          payments: { orderBy: { paymentDate: 'desc' } },
        },
      });

      if (paymentMethod === PaymentMethod.CASH) await tx.cashMovement.create({ data: { id: 'debt-' + clientPaymentId, shiftId: shiftId!, type: 'IN', amount: payAmt, reason: 'รับชำระหนี้ ' + receiptNo } });
      const result = {
        success: true,
        message: 'บันทึกรับชำระหนี้สำเร็จ',
        payment,
        debt: updatedDebt,
      };
      await tx.auditLog.create({data:{id:receiptId,action:'PAY_DEBT',entity:'CustomerDebt',entityId:debt.id,userId,details:{fingerprint,result:JSON.parse(JSON.stringify(result))}}});
      return result;
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
