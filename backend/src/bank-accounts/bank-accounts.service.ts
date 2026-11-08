import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type BankInput = { bankName?: string; accountName?: string; accountNumber?: string; branch?: string | null; qrCodeUrl?: string | null; isDefault?: boolean };

/** Validate a bank account body. `partial` = PATCH (only the given fields, but at least one). */
export function cleanBankInput(body: any, partial: boolean): BankInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('ข้อมูลบัญชีธนาคารไม่ถูกต้อง');
  const out: BankInput = {};
  const required: [keyof BankInput, string][] = [
    ['bankName', 'กรุณาระบุชื่อธนาคาร'],
    ['accountName', 'กรุณาระบุชื่อบัญชี'],
    ['accountNumber', 'กรุณาระบุเลขที่บัญชี'],
  ];
  for (const [key, message] of required) {
    if (partial && body[key] === undefined) continue;
    const v = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!v) throw new BadRequestException(message);
    (out as any)[key] = v;
  }
  if (out.accountNumber !== undefined && !/^[0-9\- ]{4,30}$/.test(out.accountNumber)) {
    throw new BadRequestException('เลขที่บัญชีต้องเป็นตัวเลข (ใส่ - หรือช่องว่างได้)');
  }
  for (const key of ['branch', 'qrCodeUrl'] as const) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') throw new BadRequestException('ข้อมูลบัญชีธนาคารไม่ถูกต้อง');
    out[key] = body[key] === null ? null : body[key].trim() || null;
  }
  if (body.isDefault !== undefined) {
    if (typeof body.isDefault !== 'boolean') throw new BadRequestException('ค่าบัญชีหลักไม่ถูกต้อง');
    out.isDefault = body.isDefault;
  }
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('ไม่มีข้อมูลที่ต้องการแก้ไข');
  return out;
}

function rethrow(e: any): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new ConflictException('เลขที่บัญชีนี้มีอยู่ในระบบแล้ว');
    if (e.code === 'P2025') throw new NotFoundException('ไม่พบบัญชีธนาคารนี้');
    if (e.code === 'P2003') throw new ConflictException('ลบบัญชีนี้ไม่ได้ เพราะมีรายการเงินผูกอยู่');
  }
  throw e;
}

@Injectable()
export class BankAccountsService {
  constructor(private prisma: PrismaService) {}

  async getAll() {
    return this.prisma.bankAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(body: any) {
    const data = cleanBankInput(body, false);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await tx.bankAccount.findUnique({ where: { accountNumber: data.accountNumber! } })) throw new ConflictException('เลขที่บัญชีนี้มีอยู่ในระบบแล้ว');
        if (data.isDefault) await tx.bankAccount.updateMany({ data: { isDefault: false } });
        return tx.bankAccount.create({ data: data as Prisma.BankAccountCreateInput });
      });
    } catch (e) {
      rethrow(e);
    }
  }

  async update(id: string, body: any) {
    const data = cleanBankInput(body, true);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await tx.bankAccount.findUnique({ where: { id } }))) throw new NotFoundException('ไม่พบบัญชีธนาคารนี้');
        if (data.accountNumber && (await tx.bankAccount.findFirst({ where: { accountNumber: data.accountNumber, id: { not: id } } }))) {
          throw new ConflictException('เลขที่บัญชีนี้มีอยู่ในระบบแล้ว');
        }
        if (data.isDefault) await tx.bankAccount.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
        return tx.bankAccount.update({ where: { id }, data });
      });
    } catch (e) {
      rethrow(e);
    }
  }

  async setDefault(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await tx.bankAccount.findUnique({ where: { id } }))) throw new NotFoundException('ไม่พบบัญชีธนาคารนี้');
        await tx.bankAccount.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
        return tx.bankAccount.update({ where: { id }, data: { isDefault: true } });
      });
    } catch (e) {
      rethrow(e);
    }
  }

  /**
   * A bank account that already has money movements in the ledger cannot be deleted (the books
   * would lose where that money is). Its ledger account is deactivated instead only when empty.
   */
  async remove(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const bank = await tx.bankAccount.findUnique({ where: { id }, include: { moneyAccount: { include: { _count: { select: { transactions: true, expenses: true, recurring: true, reconciliations: true } } } } } });
        if (!bank) throw new NotFoundException('ไม่พบบัญชีธนาคารนี้');
        const c = bank.moneyAccount?._count;
        if (c && (c.transactions > 0 || c.expenses > 0 || c.recurring > 0 || c.reconciliations > 0)) {
          throw new ConflictException('ลบบัญชีนี้ไม่ได้ เพราะมีรายการรับ-จ่ายเงินผูกอยู่ (ยกเลิกการเป็นบัญชีหลักแทนได้)');
        }
        if (bank.moneyAccount) await tx.moneyAccount.delete({ where: { id: bank.moneyAccount.id } });
        return tx.bankAccount.delete({ where: { id } });
      });
    } catch (e) {
      rethrow(e);
    }
  }
}
