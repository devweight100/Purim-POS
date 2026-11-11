import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addQty } from '../common/qty';
import { PAYABLE_PO_STATUSES } from '../payables/payables.service';


/** Validate and normalise a supplier body. `partial` = PATCH (only given fields). */
export function cleanSupplierInput(body: any, partial: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('ข้อมูลผู้จำหน่ายไม่ถูกต้อง');
  const data: Record<string, any> = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new BadRequestException('กรุณาระบุชื่อผู้จำหน่าย');
    data.name = name;
  }
  for (const key of ['contactName', 'address'] as const) {
    if (body[key] !== undefined) data[key] = body[key] === null ? null : String(body[key]).trim() || null;
  }
  if (body.phone !== undefined) {
    const phone = body.phone === null ? '' : String(body.phone).trim();
    if (phone && !/^[0-9+\-\s()]{3,30}$/.test(phone)) throw new BadRequestException('เบอร์โทรศัพท์ไม่ถูกต้อง (ใช้ได้เฉพาะตัวเลข - + และช่องว่าง)');
    data.phone = phone || null;
  }
  if (body.email !== undefined) {
    const email = body.email === null ? '' : String(body.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('รูปแบบอีเมลไม่ถูกต้อง');
    data.email = email || null;
  }
  if (body.creditTerms !== undefined) {
    if (body.creditTerms === null || body.creditTerms === '') data.creditTerms = null;
    else {
      const n = Number(body.creditTerms);
      if (typeof body.creditTerms === 'boolean' || !Number.isInteger(n) || n < 0 || n > 3650) throw new BadRequestException('เครดิตเทอมต้องเป็นจำนวนวันเต็ม ตั้งแต่ 0 ขึ้นไป');
      data.creditTerms = n;
    }
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw new BadRequestException('สถานะการใช้งานไม่ถูกต้อง');
    data.isActive = body.isActive;
  }
  return data;
}

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.supplier.findMany({ where: { isActive: true } });
  }

  async findOne(id: string) {
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  async create(body: any) {
    const data = cleanSupplierInput(body, false);
    return this.prisma.supplier.create({ data: data as Prisma.SupplierCreateInput });
  }

  async update(id: string, body: any) {
    const data = cleanSupplierInput(body, true);
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ไม่พบผู้จำหน่ายนี้');
    if (data.isActive === false && existing.isActive) await this.assertNoOpenBalance(id);
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ไม่พบผู้จำหน่ายนี้');
    await this.assertNoOpenBalance(id);
    return this.prisma.supplier.update({ where: { id }, data: { isActive: false } });
  }

  /** Owner decision: a supplier we still owe money to cannot be deactivated. */
  private async assertNoOpenBalance(id: string) {
    const unpaid = await this.prisma.purchaseOrder.aggregate({
      where: { supplierId: id, status: { in: PAYABLE_PO_STATUSES }, remainingPayable: { gt: 0 } },
      _sum: { remainingPayable: true },
      _count: true,
    });
    if (unpaid._count > 0) {
      throw new ConflictException(`ปิดการใช้งานผู้จำหน่ายไม่ได้ ยังมีบิลค้างชำระ ${unpaid._count} ใบ (฿${Number(unpaid._sum.remainingPayable || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}) กรุณาชำระให้ครบก่อน`);
    }
  }

  async getSupplierProducts(supplierId: string) {
    const links = await this.prisma.productSupplier.findMany({
      where: { supplierId },
      include: {
        product: {
          include: {
            stockBatches: { select: { quantityRemaining: true } }
          }
        }
      }
    });
    return links.map(link => ({
      id: link.product.id,
      name: link.product.name,
      sku: link.product.sku,
      basePrice: link.product.basePrice,
      supplierSku: link.supplierSku,
      unitCost: link.unitCost,
      isPreferred: link.isPreferred,
      stock: addQty(...link.product.stockBatches.map((b) => b.quantityRemaining))
    }));
  }

  async linkProduct(supplierId: string, data: { productId: string, supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.prisma.productSupplier.create({
      data: {
        supplierId,
        productId: data.productId,
        supplierSku: data.supplierSku,
        unitCost: data.unitCost,
        isPreferred: data.isPreferred,
      }
    });
  }

  async unlinkProduct(supplierId: string, productId: string) {
    return this.prisma.productSupplier.delete({
      where: {
        productId_supplierId: {
          productId,
          supplierId,
        }
      }
    });
  }

  async updateProductLink(supplierId: string, productId: string, data: { supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.prisma.productSupplier.update({
      where: {
        productId_supplierId: {
          productId,
          supplierId,
        }
      },
      data
    });
  }
}
