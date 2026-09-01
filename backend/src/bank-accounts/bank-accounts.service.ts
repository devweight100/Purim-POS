import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BankAccountsService {
  constructor(private prisma: PrismaService) {}

  async getAll() {
    return this.prisma.bankAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(data: { bankName: string; accountName: string; accountNumber: string; branch?: string; qrCodeUrl?: string; isDefault?: boolean }) {
    if (data.isDefault) {
      await this.prisma.bankAccount.updateMany({ data: { isDefault: false } });
    }
    return this.prisma.bankAccount.create({ data });
  }

  async update(id: string, data: { bankName?: string; accountName?: string; accountNumber?: string; branch?: string; qrCodeUrl?: string; isDefault?: boolean }) {
    if (data.isDefault) {
      await this.prisma.bankAccount.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    return this.prisma.bankAccount.update({ where: { id }, data });
  }

  async setDefault(id: string) {
    await this.prisma.bankAccount.updateMany({ data: { isDefault: false } });
    return this.prisma.bankAccount.update({ where: { id }, data: { isDefault: true } });
  }

  async remove(id: string) {
    return this.prisma.bankAccount.delete({ where: { id } });
  }
}
