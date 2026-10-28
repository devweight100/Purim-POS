import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus, VoucherStatus, PaymentMethod, ReturnNoteStatus } from '@prisma/client';

import { IsString, IsNotEmpty, IsArray, IsOptional, IsNumber, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SettleBillItemDto {
  @IsString()
  @IsNotEmpty()
  poId!: string;

  @IsNumber()
  amountToPay!: number;
}

export class MatchedDebitNoteDto {
  @IsString()
  @IsNotEmpty()
  returnNoteId!: string;

  @IsNumber()
  amountToDeduct!: number;
}

export class SettleMultipleBillsDto {
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettleBillItemDto)
  billsToSettle!: SettleBillItemDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MatchedDebitNoteDto)
  matchedDebitNotes?: MatchedDebitNoteDto[];

  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsString()
  @IsOptional()
  bankAccountLabel?: string;

  @IsString()
  @IsOptional()
  referenceNo?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  cashierName?: string;

  @IsString()
  @IsOptional()
  paymentDate?: string;
}

@Injectable()
export class PayablesService {
  constructor(private prisma: PrismaService) {}

  async getPayableBills(page = 1, limit = 50, supplierId?: string, paymentStatus?: string, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {
      status: { not: 'CANCELLED' },
    };

    if (supplierId && supplierId !== 'ALL') {
      where.supplierId = supplierId;
    }

    if (paymentStatus && paymentStatus !== 'ALL') {
      where.paymentStatus = paymentStatus as PaymentStatus;
    }

    if (search && search.trim()) {
      where.OR = [
        { poNumber: { contains: search.trim(), mode: 'insensitive' } },
        { supplierInvoiceNo: { contains: search.trim(), mode: 'insensitive' } },
        { supplier: { name: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [bills, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { billDate: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, contactName: true, phone: true } },
          items: { include: { product: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    // Aggregate summary
    const summaryAgg = await this.prisma.purchaseOrder.aggregate({
      where: { status: { not: 'CANCELLED' } },
      _sum: {
        totalAmount: true,
        paidAmount: true,
        remainingPayable: true,
      },
    });

    return {
      data: bills,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalAmount: Number(summaryAgg._sum.totalAmount) || 0,
        paidAmount: Number(summaryAgg._sum.paidAmount) || 0,
        remainingPayable: Number(summaryAgg._sum.remainingPayable) || 0,
      },
    };
  }

  async getSupplierSummaries() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      include: {
        purchaseOrders: {
          where: { status: { not: 'CANCELLED' }, remainingPayable: { gt: 0 } },
          select: { id: true, totalAmount: true, remainingPayable: true },
        },
        returnNotes: {
          where: { status: { not: 'CANCELLED' }, remainingCreditAmount: { gt: 0 } },
          select: { id: true, remainingCreditAmount: true },
        },
      },
    });

    return suppliers.map((s) => {
      const unpaidCount = s.purchaseOrders.length;
      const totalUnpaid = s.purchaseOrders.reduce((sum, po) => sum + Number(po.remainingPayable), 0);
      const totalCredit = s.returnNotes.reduce((sum, rn) => sum + Number(rn.remainingCreditAmount), 0);

      return {
        id: s.id,
        name: s.name,
        contactName: s.contactName,
        phone: s.phone,
        unpaidCount,
        totalUnpaid,
        availableCredit: totalCredit,
      };
    });
  }

  async settleMultipleBills(dto: SettleMultipleBillsDto) {
    return businessTransaction(this.prisma, async (tx) => {
      const {
        supplierId,
        billsToSettle,
        matchedDebitNotes = [],
        discountAmount = 0,
        paymentMethod,
        bankAccountLabel,
        referenceNo,
        note,
        cashierName,
        paymentDate,
      } = dto;

      if (!billsToSettle || billsToSettle.length === 0) {
        throw new BadRequestException('กรุณาเลือกบิลอย่างน้อย 1 ใบเพื่อชำระ');
      }

      const validMoney = (value: number, positive = true) => Number.isFinite(value) && (positive ? value > 0 : value >= 0) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
      if (!Array.isArray(billsToSettle) || !Array.isArray(matchedDebitNotes) || billsToSettle.some(item => !validMoney(item.amountToPay)) || matchedDebitNotes.some(item => !validMoney(item.amountToDeduct)) || !validMoney(discountAmount, false)) throw new BadRequestException('จำนวนเงินต้องถูกต้องและมีทศนิยมไม่เกินสองตำแหน่ง');
      if (new Set(billsToSettle.map(item => item.poId)).size !== billsToSettle.length || new Set(matchedDebitNotes.map(item => item.returnNoteId)).size !== matchedDebitNotes.length) throw new BadRequestException('มีบิลหรือใบลดหนี้ซ้ำในรายการ');
      for (const item of billsToSettle) {
        const po = await tx.purchaseOrder.findUnique({where:{id:item.poId}});
        if (!po || po.supplierId !== supplierId || po.status === 'CANCELLED' || po.status === 'DRAFT') throw new BadRequestException('บิลไม่ถูกต้อง ไม่ใช่ผู้จำหน่ายรายนี้ หรือยังไม่พร้อมชำระ');
        if (item.amountToPay > Number(po.remainingPayable)) throw new BadRequestException('ยอดชำระเกินยอดค้างของบิล กรุณาโหลดข้อมูลล่าสุด');
      }
      for (const item of matchedDebitNotes) {
        const credit = await tx.supplierReturnNote.findUnique({where:{id:item.returnNoteId}});
        if (!credit || credit.supplierId !== supplierId || credit.status === ReturnNoteStatus.CANCELLED || item.amountToDeduct > Number(credit.remainingCreditAmount)) throw new BadRequestException('ใบลดหนี้ไม่ถูกต้องหรือยอดหักเกินวงเงินคงเหลือ');
      }

      // Calculate totals
      let totalBillsAmount = 0;
      for (const item of billsToSettle) {
        totalBillsAmount += Math.max(0, Number(item.amountToPay) || 0);
      }

      let totalDebitDeducted = 0;
      for (const dn of matchedDebitNotes) {
        totalDebitDeducted += Math.max(0, Number(dn.amountToDeduct) || 0);
      }

      const disc = Math.max(0, Number(discountAmount) || 0);
      if (Math.round((totalDebitDeducted + disc - totalBillsAmount) * 100) > 0) throw new BadRequestException('ยอดใบลดหนี้และส่วนลดรวมเกินยอดบิล');
      const netPaidAmount = Math.max(0, Math.round((totalBillsAmount - totalDebitDeducted - disc) * 100) / 100);

      // Generate voucher number (Format: PV-YYMMxxxxx e.g. PV-260900001)
      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const prefix = `PV-${yy}${mm}`;
      const countToday = await tx.paymentVoucher.count({
        where: { voucherNumber: { startsWith: prefix } },
      });
      const voucherNumber = `${prefix}${String(countToday + 1).padStart(5, '0')}`;

      // 1. Create PaymentVoucher
      const voucher = await tx.paymentVoucher.create({
        data: {
          voucherNumber,
          supplierId,
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          totalBillsAmount,
          debitDeducted: totalDebitDeducted,
          discountAmount: disc,
          netPaidAmount,
          paymentMethod,
          bankAccountLabel: paymentMethod === PaymentMethod.TRANSFER ? bankAccountLabel : null,
          referenceNo: referenceNo?.trim() || null,
          note: note?.trim() || null,
          cashierName: cashierName || 'เจ้าหน้าที่การเงิน',
          status: VoucherStatus.ACTIVE,
        },
      });

      // 2. Process each settled PO
      for (const item of billsToSettle) {
        const payAmt = Math.max(0, Number(item.amountToPay) || 0);
        if (payAmt <= 0) continue;

        const po = await tx.purchaseOrder.findUnique({ where: { id: item.poId } });
        if (!po) continue;

        const currentPaid = Number(po.paidAmount);
        const total = Number(po.totalAmount);
        const newPaid = currentPaid + payAmt;
        const newRemaining = Math.max(0, total - newPaid);
        const newStatus = newRemaining <= 0 ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID;

        // Create voucher item
        await tx.paymentVoucherItem.create({
          data: {
            voucherId: voucher.id,
            purchaseOrderId: po.id,
            amountPaid: payAmt,
          },
        });

        // Update purchase order
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            paidAmount: newPaid,
            remainingPayable: newRemaining,
            paymentStatus: newStatus,
          },
        });
      }

      // 3. Process each deducted debit note
      for (const dn of matchedDebitNotes) {
        const deductAmt = Math.max(0, Number(dn.amountToDeduct) || 0);
        if (deductAmt <= 0) continue;

        const noteRec = await tx.supplierReturnNote.findUnique({ where: { id: dn.returnNoteId } });
        if (!noteRec) continue;

        const curCredit = Number(noteRec.remainingCreditAmount);
        const newCredit = Math.max(0, curCredit - deductAmt);
        const newStatus = newCredit <= 0 ? ReturnNoteStatus.USED : ReturnNoteStatus.PARTIALLY_USED;

        await tx.paymentVoucherDebit.create({
          data: {
            voucherId: voucher.id,
            returnNoteId: noteRec.id,
            amountDeducted: deductAmt,
          },
        });

        await tx.supplierReturnNote.update({
          where: { id: noteRec.id },
          data: {
            remainingCreditAmount: newCredit,
            status: newStatus,
          },
        });
      }

      // Return full voucher details
      const fullVoucher = await tx.paymentVoucher.findUnique({
        where: { id: voucher.id },
        include: {
          supplier: true,
          items: { include: { purchaseOrder: true } },
          debitNotes: { include: { returnNote: true } },
        },
      });

      return {
        success: true,
        message: `บันทึกชำระหนี้สำเร็จ ออกใบสำคัญจ่ายเลขที่ ${voucherNumber}`,
        voucher: fullVoucher,
      };
    });
  }

  async getVouchers(page = 1, limit = 20, search?: string, status?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status as VoucherStatus;
    }

    if (search && search.trim()) {
      where.OR = [
        { voucherNumber: { contains: search.trim(), mode: 'insensitive' } },
        { referenceNo: { contains: search.trim(), mode: 'insensitive' } },
        { cashierName: { contains: search.trim(), mode: 'insensitive' } },
        { supplier: { name: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [vouchers, total] = await Promise.all([
      this.prisma.paymentVoucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paymentDate: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, phone: true } },
          items: { include: { purchaseOrder: { select: { id: true, poNumber: true, supplierInvoiceNo: true, totalAmount: true } } } },
          debitNotes: { include: { returnNote: true } },
        },
      }),
      this.prisma.paymentVoucher.count({ where }),
    ]);

    return {
      data: vouchers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getVoucherDetails(id: string) {
    const voucher = await this.prisma.paymentVoucher.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            purchaseOrder: {
              include: { items: { include: { product: true } } },
            },
          },
        },
        debitNotes: { include: { returnNote: true } },
      },
    });

    if (!voucher) throw new NotFoundException('ไม่พบใบสำคัญจ่ายนี้');
    return voucher;
  }

  async cancelVoucher(voucherId: string, cancelReason: string) {
    return businessTransaction(this.prisma, async (tx) => {
      const voucher = await tx.paymentVoucher.findUnique({
        where: { id: voucherId },
        include: { items: true, debitNotes: true },
      });

      if (!voucher) throw new NotFoundException('ไม่พบใบสำคัญจ่ายนี้');
      if (voucher.status === VoucherStatus.CANCELLED) {
        throw new BadRequestException('ใบสำคัญจ่ายนี้ถูกยกเลิกไปแล้ว');
      }

      // 1. Rollback all POs: restore remainingPayable, decrease paidAmount
      for (const item of voucher.items) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: item.purchaseOrderId } });
        if (po) {
          const newPaid = Math.max(0, Number(po.paidAmount) - Number(item.amountPaid));
          const newRemaining = Math.max(0, Number(po.totalAmount) - newPaid);
          const newStatus = newRemaining === Number(po.totalAmount) ? PaymentStatus.UNPAID : PaymentStatus.PARTIALLY_PAID;

          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              paidAmount: newPaid,
              remainingPayable: newRemaining,
              paymentStatus: newStatus,
            },
          });
        }
      }

      // 2. Rollback all debit notes: restore remainingCreditAmount
      for (const dn of voucher.debitNotes) {
        const note = await tx.supplierReturnNote.findUnique({ where: { id: dn.returnNoteId } });
        if (note) {
          const restoredCredit = Number(note.remainingCreditAmount) + Number(dn.amountDeducted);
          const restoredStatus = restoredCredit >= Number(note.totalAmount) ? ReturnNoteStatus.PENDING : ReturnNoteStatus.PARTIALLY_USED;

          await tx.supplierReturnNote.update({
            where: { id: note.id },
            data: {
              remainingCreditAmount: restoredCredit,
              status: restoredStatus,
            },
          });
        }
      }

      // 3. Mark voucher as CANCELLED
      const cancelledVoucher = await tx.paymentVoucher.update({
        where: { id: voucherId },
        data: {
          status: VoucherStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: cancelReason?.trim() || 'ยกเลิกรายการจ่ายเงิน',
        },
        include: {
          supplier: true,
          items: { include: { purchaseOrder: true } },
          debitNotes: { include: { returnNote: true } },
        },
      });

      return {
        success: true,
        message: `ยกเลิกใบสำคัญจ่าย ${voucher.voucherNumber} สำเร็จ และคืนยอดหนี้เรียบร้อยแล้ว`,
        voucher: cancelledVoucher,
      };
    });
  }
}
