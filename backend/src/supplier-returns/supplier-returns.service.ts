import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReturnNoteStatus } from '@prisma/client';

@Injectable()
export class SupplierReturnsService {
  constructor(private prisma: PrismaService) {}

  async getAllReturnNotes(page = 1, limit = 20, supplierId?: string, status?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (supplierId && supplierId !== 'ALL') {
      where.supplierId = supplierId;
    }
    if (status && status !== 'ALL') {
      where.status = status as ReturnNoteStatus;
    }

    const [notes, total] = await Promise.all([
      this.prisma.supplierReturnNote.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.supplierReturnNote.count({ where }),
    ]);

    return {
      data: notes,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getReturnNoteDetails(id: string) {
    const note = await this.prisma.supplierReturnNote.findUnique({
      where: { id },
      include: {
        supplier: true,
        voucherDebits: {
          include: { voucher: true },
        },
      },
    });
    if (!note) throw new NotFoundException('ไม่พบใบลดหนี้นี้');
    return note;
  }

  async createReturnNote(dto: {
    supplierId: string;
    totalQuantity: number;
    totalAmount: number;
    note?: string;
  }) {
    const year = new Date().getFullYear();
    const count = await this.prisma.supplierReturnNote.count();
    const returnNumber = `DN-${year}-${String(count + 1).padStart(4, '0')}`;

    const newNote = await this.prisma.supplierReturnNote.create({
      data: {
        returnNumber,
        supplierId: dto.supplierId,
        totalQuantity: dto.totalQuantity || 0,
        totalAmount: dto.totalAmount,
        remainingCreditAmount: dto.totalAmount,
        status: ReturnNoteStatus.PENDING,
        note: dto.note,
      },
      include: {
        supplier: true,
      },
    });

    return newNote;
  }
}
