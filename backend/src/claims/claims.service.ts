import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimStatus, ClaimType } from '@prisma/client';

@Injectable()
export class ClaimsService {
  constructor(private prisma: PrismaService) {}

  async getAllClaims(page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status as ClaimStatus;
    }
    if (type && type !== 'ALL') {
      where.claimType = type as ClaimType;
    }
    if (search && search.trim()) {
      where.OR = [
        { claimNumber: { contains: search.trim(), mode: 'insensitive' } },
        { serialNo: { contains: search.trim(), mode: 'insensitive' } },
        { product: { name: { contains: search.trim(), mode: 'insensitive' } } },
        { customer: { name: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [claims, total] = await Promise.all([
      this.prisma.customerClaim.findMany({
        where,
        skip,
        take: limit,
        orderBy: { receivedDate: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          customer: { select: { id: true, name: true, phone: true } },
          order: { select: { id: true, orderNumber: true } },
        },
      }),
      this.prisma.customerClaim.count({ where }),
    ]);

    return {
      data: claims,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getClaimDetails(id: string) {
    const claim = await this.prisma.customerClaim.findUnique({
      where: { id },
      include: {
        product: true,
        customer: true,
        order: { include: { items: true } },
      },
    });
    if (!claim) throw new NotFoundException('ไม่พบข้อมูลการเคลมนี้');
    return claim;
  }

  async createClaim(dto: {
    orderId?: string;
    customerId?: string;
    productId: string;
    serialNo?: string;
    claimType: ClaimType;
    problemDescription: string;
    note?: string;
  }) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await this.prisma.customerClaim.count({
      where: { claimNumber: { startsWith: `CLM-${dateStr}` } },
    });
    const claimNumber = `CLM-${dateStr}-${String(countToday + 1).padStart(4, '0')}`;

    const claim = await this.prisma.customerClaim.create({
      data: {
        claimNumber,
        orderId: dto.orderId || null,
        customerId: dto.customerId || null,
        productId: dto.productId,
        serialNo: dto.serialNo || null,
        claimType: dto.claimType,
        problemDescription: dto.problemDescription,
        status: ClaimStatus.PENDING,
        resolutionNote: dto.note || null,
      },
      include: {
        product: true,
        customer: true,
      },
    });

    // Also track in Claim Inventory if not present
    const existingInv = await this.prisma.claimInventory.findFirst({
      where: { productId: dto.productId },
    });
    if (existingInv) {
      await this.prisma.claimInventory.update({
        where: { id: existingInv.id },
        data: { quantity: existingInv.quantity + 1 },
      });
    } else {
      await this.prisma.claimInventory.create({
        data: {
          productId: dto.productId,
          quantity: 1,
          condition: 'รอตรวจสอบ / ส่งเคลม',
          location: 'คลังสินค้าเคลม',
        },
      });
    }

    return claim;
  }

  async updateClaim(id: string, dto: { status?: ClaimStatus; resolutionNote?: string; completedDate?: string }) {
    const claim = await this.prisma.customerClaim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('ไม่พบข้อมูลการเคลมนี้');

    const updatePayload: any = {};
    if (dto.status) updatePayload.status = dto.status;
    if (dto.resolutionNote !== undefined) updatePayload.resolutionNote = dto.resolutionNote;
    if (dto.status === ClaimStatus.COMPLETED) {
      updatePayload.completedDate = new Date();
    }

    const updated = await this.prisma.customerClaim.update({
      where: { id },
      data: updatePayload,
      include: { product: true, customer: true },
    });

    return updated;
  }

  // Claim Inventory endpoints
  async getClaimInventory() {
    return this.prisma.claimInventory.findMany({
      include: {
        product: { select: { id: true, name: true, sku: true, basePrice: true, costPrice: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async updateClaimInventory(id: string, data: { quantity?: number; condition?: string; location?: string; note?: string }) {
    return this.prisma.claimInventory.update({
      where: { id },
      data,
      include: { product: true },
    });
  }
}
