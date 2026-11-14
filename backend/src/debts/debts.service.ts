import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DebtStatus, PaymentMethod } from '@prisma/client';
import * as ledger from '../finance/ledger';

/**
 * Money account of the bank that receives a QR / transfer debt payment.
 * A given bankAccountId must exist and be active (400 otherwise); without one the default bank
 * account is used, and if there is no default the user must choose.
 */
export async function resolveReceivingBank(tx: any, bankAccountId?: string | null) {
  await ledger.ensureCoreAccounts(tx);
  const id = typeof bankAccountId === 'string' ? bankAccountId.trim() : '';
  const bank = id
    ? await tx.bankAccount.findUnique({ where: { id }, include: { moneyAccount: true } })
    : await tx.bankAccount.findFirst({ where: { isDefault: true }, include: { moneyAccount: true } });
  if (!bank) {
    throw new BadRequestException(id ? 'ไม่พบบัญชีธนาคารที่เลือก กรุณาเลือกบัญชีรับเงินใหม่' : 'กรุณาเลือกบัญชีธนาคารที่รับเงิน (ยังไม่ได้ตั้งบัญชีหลัก)');
  }
  if (!bank.moneyAccount || !bank.moneyAccount.isActive) throw new BadRequestException('บัญชีธนาคารที่เลือกถูกปิดใช้งานแล้ว กรุณาเลือกบัญชีอื่น');
  return bank.moneyAccount;
}

@Injectable()
export class DebtsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Debt list (GET /debts), paged. `status` = a DebtStatus; the receivables page uses `statusGroup`
   * (unpaid = money still owed, overdue = owed and past the due date, paid = settled), `customerId`,
   * `customerType` (INDIVIDUAL / COMPANY from the customer profile) and `stats` (cards over every debt).
   * Search matches bill number, customer name / phone / code / company name / tax id.
   */
  async getAllDebts(
    page = 1,
    limit = 20,
    search?: string,
    status?: string,
    opts: { statusGroup?: string; customerId?: string; customerType?: string; orderIds?: string; stats?: boolean } = {},
  ) {
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 500);
    const skip = (page - 1) * limit;
    await this.markOverdueDebts();
    const now = new Date();

    const where: any = {};
    const and: any[] = [];
    if (status && status !== 'ALL') {
      where.status = status as DebtStatus;
    }
    const owed = { AND: [{ status: { not: DebtStatus.PAID } }, { remainingAmount: { gt: 0 } }] };
    if (opts.statusGroup && opts.statusGroup !== 'all') {
      if (opts.statusGroup === 'unpaid') and.push(owed);
      // owing: something left to pay (the POS debt picker's rule: remaining > 0, whatever the stored status)
      else if (opts.statusGroup === 'owing') and.push({ remainingAmount: { gt: 0 } });
      else if (opts.statusGroup === 'overdue') and.push(owed, { dueDate: { lt: now } });
      else if (opts.statusGroup === 'paid') and.push({ OR: [{ status: DebtStatus.PAID }, { remainingAmount: { lte: 0 } }] });
      else throw new BadRequestException('สถานะหนี้ที่ค้นหาไม่ถูกต้อง');
    }
    if (opts.customerId) and.push({ customerId: opts.customerId });
    // orderIds=a,b: the debts of these bills (orders page: credit bills on the current page)
    if (opts.orderIds !== undefined) {
      const ids = [...new Set(opts.orderIds.split(',').map((x) => x.trim()).filter(Boolean))];
      if (ids.length > 500) throw new BadRequestException('ขอได้ครั้งละไม่เกิน 500 บิล');
      and.push({ orderId: { in: ids } });
    }
    if (opts.customerType && opts.customerType !== 'all') {
      if (opts.customerType !== 'INDIVIDUAL' && opts.customerType !== 'COMPANY') throw new BadRequestException('ประเภทลูกค้าไม่ถูกต้อง');
      // same rule as the page: no type in the profile = INDIVIDUAL
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM customers WHERE COALESCE(NULLIF(profile->>'type', ''), 'INDIVIDUAL') = ${opts.customerType}`;
      and.push({ customerId: { in: ids.map((r) => r.id) } });
    }

    if (search && search.trim()) {
      const q = search.trim();
      const pattern = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      const customerIds = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM customers
        WHERE name ILIKE ${pattern} OR phone ILIKE ${pattern} OR profile->>'code' ILIKE ${pattern}
          OR profile->>'companyName' ILIKE ${pattern} OR profile->>'taxId' ILIKE ${pattern}`;
      and.push({
        OR: [
          { customerId: { in: customerIds.map((r) => r.id) } },
          { order: { orderNumber: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    if (and.length) where.AND = and;

    const [debts, total] = await Promise.all([
      this.prisma.customerDebt.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          customer: { select: { id: true, name: true, phone: true, address: true, profile: true } },
          order: { select: { id: true, orderNumber: true, totalAmount: true, createdAt: true } },
          payments: { orderBy: { paymentDate: 'desc' } },
        },
      }),
      this.prisma.customerDebt.count({ where }),
    ]);

    // Totals follow the same filters as the list
    const aggregates = await this.prisma.customerDebt.aggregate({
      where,
      _sum: {
        totalDebt: true,
        paidAmount: true,
        remainingAmount: true,
      },
    });

    let stats: Record<string, number> | undefined;
    if (opts.stats) {
      // cards of the receivables page: every debt, whatever the filters (old page: sums of the full download)
      const [row] = await this.prisma.$queryRaw<Record<string, string>[]>`
        SELECT count(*)::text AS "totalBills",
          COALESCE(sum(total_debt), 0)::text AS "totalDebtValue",
          COALESCE(sum(paid_amount), 0)::text AS "totalCollected",
          COALESCE(sum(remaining_amount), 0)::text AS "totalOutstanding",
          count(*) FILTER (WHERE status = 'PAID' OR remaining_amount <= 0)::text AS "paidCount",
          count(*) FILTER (WHERE NOT (status = 'PAID' OR remaining_amount <= 0))::text AS "unpaidCount",
          count(*) FILTER (WHERE NOT (status = 'PAID' OR remaining_amount <= 0) AND due_date < ${now})::text AS "overdueCount"
        FROM customer_debts`;
      stats = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v) || 0]));
    }

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
      ...(stats ? { stats } : {}),
    };
  }

  /** Debts past their due date with money still owed become OVERDUE. */
  async markOverdueDebts() {
    await this.prisma.customerDebt.updateMany({
      where: {
        dueDate: { lt: new Date() },
        remainingAmount: { gt: 0 },
        status: { in: [DebtStatus.PENDING, DebtStatus.PARTIALLY_PAID] },
      },
      data: { status: DebtStatus.OVERDUE },
    });
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
    bankAccountId?: string,
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
      // QR / transfer: the receiving bank must be a real, active account (never silently replaced)
      const receivingBank = paymentMethod === PaymentMethod.CASH ? null : await resolveReceivingBank(tx, bankAccountId);
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
      const isPastDue = debt.dueDate ? new Date(debt.dueDate).getTime() < Date.now() : false;
      const newStatus = newRemaining <= 0 ? DebtStatus.PAID : isPastDue ? DebtStatus.OVERDUE : DebtStatus.PARTIALLY_PAID;

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

      if (paymentMethod === PaymentMethod.CASH) await tx.cashMovement.create({ data: { id: 'debt-' + clientPaymentId, shiftId: shiftId!, type: 'IN', category: 'DEBT_PAYMENT', amount: payAmt, reason: 'รับชำระหนี้ ' + receiptNo } });
      // Money ledger: cash into the receiving shift's drawer, QR / transfer into the bank
      const shiftRow = paymentMethod === PaymentMethod.CASH && shiftId ? await tx.shift.findUnique({ where: { id: shiftId } }) : null;
      const moneyAccount = paymentMethod === PaymentMethod.CASH
        ? await ledger.accountForPaymentMethod(tx, paymentMethod, { terminalId: shiftRow?.terminalId })
        : receivingBank;
      if (moneyAccount) {
        await ledger.post(tx, {
          accountId: moneyAccount.id, direction: 'IN', amount: payAmt, type: 'DEBT_RECEIPT',
          refType: 'DEBT_PAYMENT', refId: payment.id, note: 'รับชำระหนี้ ' + receiptNo, userId,
        });
      }
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

  /**
   * Cancel a debt receipt recorded by mistake: the debt goes back up and the money leaves the
   * account it went into (cash from the same drawer if that shift is still open, otherwise from
   * the safe where the drawer was emptied at shift close).
   */
  async cancelPayment(paymentId: string, reason: string, actor?: { id?: string; fullName?: string; username?: string }) {
    const why = String(reason || '').trim();
    if (!why) throw new BadRequestException('กรุณาระบุเหตุผลการยกเลิก');
    return businessTransaction(this.prisma, async (tx) => {
      const payment = await tx.debtPayment.findUnique({ where: { id: paymentId }, include: { debt: true } });
      if (!payment) throw new NotFoundException('ไม่พบใบรับชำระนี้');
      if (payment.cancelledAt) throw new BadRequestException('ใบรับชำระนี้ถูกยกเลิกไปแล้ว');
      const amount = Number(payment.amount);
      const debt = payment.debt;
      const newPaid = Math.max(0, Math.round((Number(debt.paidAmount) - amount) * 100) / 100);
      const remaining = Math.round((Number(debt.totalDebt) - newPaid) * 100) / 100;
      const pastDue = debt.dueDate ? new Date(debt.dueDate).getTime() < Date.now() : false;
      const status = remaining <= 0 ? DebtStatus.PAID : pastDue ? DebtStatus.OVERDUE : newPaid > 0 ? DebtStatus.PARTIALLY_PAID : DebtStatus.PENDING;
      const note = `ยกเลิกรับชำระหนี้ ${payment.receiptNo || ''}: ${why}`.trim();

      if (payment.paymentMethod === PaymentMethod.CASH) {
        const movement = await tx.cashMovement.findUnique({ where: { id: 'debt-' + payment.id }, include: { shift: true } });
        if (movement?.shift?.status === 'OPEN') {
          // still in the drawer: take it out of the same shift
          await tx.cashMovement.create({ data: { shiftId: movement.shiftId, type: 'OUT', category: 'GENERAL', amount, reason: note } });
          await ledger.reverseByRef(tx, 'DEBT_PAYMENT', payment.id, note, actor?.id);
        } else {
          // shift closed: the cash was handed to the safe
          await ledger.reverseByRef(tx, 'DEBT_PAYMENT', payment.id, note, actor?.id, { skipAccountTypes: ['CASH_DRAWER'] });
          const safe = await ledger.safeAccount(tx);
          const original = await tx.moneyTransaction.findFirst({ where: { refType: 'DEBT_PAYMENT', refId: payment.id, type: 'DEBT_RECEIPT' } });
          // linked to the original receipt row so reports net it out, but taken from the safe
          await tx.moneyTransaction.create({
            data: { accountId: safe.id, direction: 'OUT', amount, type: 'REVERSAL', refType: 'DEBT_PAYMENT', refId: payment.id, reversalOfId: original?.id ?? null, note, userId: actor?.id ?? null },
          });
        }
      } else {
        await ledger.reverseByRef(tx, 'DEBT_PAYMENT', payment.id, note, actor?.id);
      }

      await tx.debtPayment.update({
        where: { id: payment.id },
        data: { cancelledAt: new Date(), cancelReason: why, cancelledBy: actor?.fullName || actor?.username || actor?.id || null },
      });
      const updated = await tx.customerDebt.update({
        where: { id: debt.id },
        data: { paidAmount: newPaid, remainingAmount: remaining, status },
        include: { customer: true, order: true, payments: { orderBy: { paymentDate: 'desc' } } },
      });
      await tx.auditLog.create({ data: { action: 'CANCEL_DEBT_PAYMENT', entity: 'DebtPayment', entityId: payment.id, userId: actor?.id ?? null, details: { amount, reason: why, receiptNo: payment.receiptNo } } });
      return { success: true, message: 'ยกเลิกใบรับชำระแล้ว ยอดหนี้กลับมาค้างชำระ', debt: updated };
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
