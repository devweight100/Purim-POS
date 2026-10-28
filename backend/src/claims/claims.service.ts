import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimStatus, ClaimType } from '@prisma/client';

@Injectable()
export class ClaimsService {
  constructor(private prisma: PrismaService) {}

  private mapToPrismaClaimStatus(rawStatus?: string): ClaimStatus {
    const s = String(rawStatus || '').toUpperCase();
    if (s === 'COMPLETED' || s === 'SUPPLIER_REPLACED') return ClaimStatus.COMPLETED;
    if (s === 'SENT_TO_SUPPLIER' || s === 'IN_PROGRESS') return ClaimStatus.IN_PROGRESS;
    if (s === 'SCRAPPED' || s === 'REJECTED') return ClaimStatus.REJECTED;
    return ClaimStatus.PENDING;
  }

  private mergeClaimWithLogs(claim: any, logs: any[]) {
    let exchangeResult: any = {};
    let metaDetails: any = {};

    for (const log of logs) {
      if (log.action === 'EXCHANGE' && (log.details as any)?.result) {
        exchangeResult = { ...exchangeResult, ...(log.details as any).result };
      } else if (log.action === 'CLAIM_META' && log.details) {
        metaDetails = { ...metaDetails, ...(log.details as any) };
      }
    }

    const merged = {
      ...exchangeResult,
      ...metaDetails,
      ...claim,
      id: claim.id,
      claimNumber: claim.claimNumber,
      frontendStatus: metaDetails.frontendStatus || metaDetails.status || undefined,
      unitPrice: metaDetails.unitPrice ?? exchangeResult.unitPrice,
      totalClaimValue: metaDetails.totalClaimValue ?? exchangeResult.totalClaimValue,
      refundAmount: metaDetails.refundAmount ?? exchangeResult.refundAmount,
      refundAccountId: metaDetails.refundAccountId,
      refundAccountLabel: metaDetails.refundAccountLabel,
      refundAccountNumber: metaDetails.refundAccountNumber,
      discountAmount: metaDetails.discountAmount,
      quantity: metaDetails.quantity ?? exchangeResult.quantity ?? 1,
      unitName: metaDetails.unitName ?? exchangeResult.unitName ?? claim.product?.unit ?? 'ชิ้น',
      conversionFactor: metaDetails.conversionFactor ?? exchangeResult.conversionFactor ?? 1,
      baseQuantity: metaDetails.baseQuantity ?? exchangeResult.baseQuantity ?? (metaDetails.quantity ?? 1),
      defectReason: metaDetails.defectReason || claim.problemDescription,
      resolutionType:
        metaDetails.resolutionType ||
        (claim.claimType === ClaimType.REFUND
          ? 'REFUND_CASH'
          : claim.claimType === ClaimType.EXCHANGE
            ? 'REPLACE_ITEM'
            : 'SUPPLIER_RMA'),
      cashierName: metaDetails.cashierName || 'พนักงาน POS',
      supplierId: metaDetails.supplierId,
      supplierName: metaDetails.supplierName,
      supplierTrackingNo: metaDetails.supplierTrackingNo,
      costPrice: metaDetails.costPrice,
      totalCostValue: metaDetails.totalCostValue,
      returnDocId: metaDetails.returnDocId,
      settledInBillNumber: metaDetails.settledInBillNumber,
      claimedInOrderNumber: metaDetails.claimedInOrderNumber,
      replacementProductId: metaDetails.replacementProductId ?? exchangeResult.replacementProductId,
      replacementProductName: metaDetails.replacementProductName,
      replacementSku: metaDetails.replacementSku,
      replacementUnitName: metaDetails.replacementUnitName,
      replacementBaseQuantity: metaDetails.replacementBaseQuantity ?? exchangeResult.replacementBaseQuantity,
      replacementConversionFactor: metaDetails.replacementConversionFactor ?? exchangeResult.replacementConversionFactor,
      isReplacementItem: metaDetails.isReplacementItem,
      parentClaimId: metaDetails.parentClaimId,
      orderNumber: claim.order?.orderNumber || metaDetails.orderNumber,
      orderDate: claim.order?.createdAt || metaDetails.orderDate || claim.createdAt,
      customerName: claim.customer?.name || metaDetails.customerName,
      customerPhone: claim.customer?.phone || metaDetails.customerPhone,
      productName: claim.product?.name || metaDetails.productName,
      sku: claim.product?.sku || metaDetails.sku,
      note: metaDetails.note ?? claim.resolutionNote,
    };

    return merged;
  }

  async getAllClaims(page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && status !== 'ALL') {
      if (['PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'].includes(status)) {
        where.status = status as ClaimStatus;
      } else {
        where.status = this.mapToPrismaClaimStatus(status);
      }
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
          product: { select: { id: true, name: true, sku: true, unit: true, basePrice: true, costPrice: true, priceLevel1: true } },
          customer: { select: { id: true, name: true, phone: true } },
          order: { select: { id: true, orderNumber: true, createdAt: true } },
        },
      }),
      this.prisma.customerClaim.count({ where }),
    ]);

    const claimIds = claims.map((c) => c.id);
    const logs = claimIds.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entity: 'CustomerClaim',
            entityId: { in: claimIds },
            action: { in: ['CLAIM_META', 'EXCHANGE'] },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    const logsByClaimId = new Map<string, any[]>();
    for (const log of logs) {
      if (!log.entityId) continue;
      const arr = logsByClaimId.get(log.entityId) || [];
      arr.push(log);
      logsByClaimId.set(log.entityId, arr);
    }

    return {
      data: claims.map((claim) => this.mergeClaimWithLogs(claim, logsByClaimId.get(claim.id) || [])),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getClaimDetails(id: string) {
    const claim = await this.prisma.customerClaim.findFirst({
      where: {
        OR: [{ id }, { claimNumber: id }],
      },
      include: {
        product: true,
        customer: true,
        order: { include: { items: true } },
      },
    });
    if (!claim) throw new NotFoundException('ไม่พบข้อมูลการเคลมนี้');

    const logs = await this.prisma.auditLog.findMany({
      where: {
        entity: 'CustomerClaim',
        entityId: claim.id,
        action: { in: ['CLAIM_META', 'EXCHANGE'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    return this.mergeClaimWithLogs(claim, logs);
  }

  async createClaim(dto: any) {
    const quantity = dto.quantity === undefined ? 1 : Number(dto.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new BadRequestException('จำนวนสินค้าเคลมต้องเป็นจำนวนเต็มมากกว่า 0');
    return businessTransaction(this.prisma, async tx => {
      const skipStockDeduction = dto.skipStockDeduction === true || !!dto.fulfilledInOrderNumber || !!dto.fulfilledInOrderId;
      const exchange = /REPLACE|EXCHANGE/.test(String(dto.claimType || '').toUpperCase());
      const clientClaimId = dto.clientClaimId || (skipStockDeduction ? `auto-claim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` : null);
      const receiptId = exchange && clientClaimId ? 'claim-exchange-' + clientClaimId : null;
      if (exchange && !skipStockDeduction && !/^[a-zA-Z0-9-]{16,80}$/.test(dto.clientClaimId || '')) throw new BadRequestException('กรุณาระบุรหัสเคลมเพื่อป้องกันตัดสต็อกซ้ำ');
      const fingerprint = JSON.stringify({
        productId: dto.productId,
        orderId: dto.orderId || null,
        customerId: dto.customerId || null,
        quantity,
        conversionFactor: Number(dto.conversionFactor || 1),
        replacementProductId: dto.replacementProductId || dto.productId,
        replacementConversionFactor: Number(dto.replacementConversionFactor || dto.conversionFactor || 1),
        reason: dto.problemDescription || dto.defectReason || '',
        note: dto.note || '',
        status: dto.status || '',
      });
      if (receiptId) {
        const previous = await tx.auditLog.findUnique({ where: { id: receiptId } });
        if (previous) {
          const details = previous.details as any;
          if (details?.fingerprint !== fingerprint) throw new BadRequestException('รหัสเคลมนี้ถูกใช้กับรายการอื่นแล้ว');
          return details.result;
        }
      }

      let orderId: string | null = dto.orderId || null;
      if (orderId) {
        const ord = await tx.order.findFirst({
          where: {
            OR: [{ id: orderId }, { orderNumber: orderId }],
          },
        });
        orderId = ord ? ord.id : null;
      }

      let customerId: string | null = dto.customerId || null;
      if (customerId) {
        const cust = await tx.customer.findFirst({
          where: { id: customerId },
        });
        customerId = cust ? cust.id : null;
      }

      let productId = dto.productId;
      if (productId) {
        const prod = await tx.product.findFirst({
          where: {
            OR: [{ id: productId }, { sku: productId }, { barcodes: { some: { barcode: productId } } }],
          },
        });
        if (prod) productId = prod.id;
      }

      const factorFor = async (id: string, raw: any) => {
        const factor = Number(raw ?? 1);
        if (!Number.isSafeInteger(factor) || factor <= 0) throw new BadRequestException('หน่วยสินค้าไม่ถูกต้อง');
        const units = await tx.productPackagingUnit.findMany({ where: { productId: id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
        let cumulative = 1;
        const factors = [1];
        for (const unit of units) {
          cumulative *= unit.qtyPerPrev;
          factors.push(cumulative);
        }
        if (!factors.includes(factor)) throw new BadRequestException('จำนวนต่อแพ็กไม่ตรงกับข้อมูลสินค้า');
        return factor;
      };

      const baseQuantity = quantity * (await factorFor(productId, dto.conversionFactor));
      if (!Number.isSafeInteger(baseQuantity)) throw new BadRequestException('จำนวนสินค้าเคลมมากเกินไป');

      let stockMovements: any[] = [];
      let replacementProductId: string | undefined;
      let replacementBaseQuantity: number | undefined;
      let replacementProductObj: any = null;
      let replacementPreviousStock = 0;

      if (exchange) {
        const replacementKey = dto.replacementProductId || productId;
        const replacement = await tx.product.findFirst({
          where: { OR: [{ id: replacementKey }, { sku: replacementKey }, { barcodes: { some: { barcode: replacementKey } } }] },
        });
        if (!replacement) throw new NotFoundException('ไม่พบสินค้าที่นำไปเปลี่ยน');
        replacementProductObj = replacement;
        replacementProductId = replacement.id;
        replacementBaseQuantity = quantity * (await factorFor(replacement.id, dto.replacementConversionFactor ?? dto.conversionFactor));
        if (!Number.isSafeInteger(replacementBaseQuantity)) throw new BadRequestException('จำนวนของเปลี่ยนมากเกินไป');

        if (!skipStockDeduction) {
          const batches = await tx.stockBatch.findMany({ where: { productId: replacement.id }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
          replacementPreviousStock = batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0);
          if (replacementPreviousStock < replacementBaseQuantity) {
            throw new BadRequestException(`สต็อกสินค้าที่นำไปเปลี่ยนไม่เพียงพอ (คงเหลือ ${replacementPreviousStock} ชิ้น, ต้องการ ${replacementBaseQuantity} ชิ้น)`);
          }
          let remaining = replacementBaseQuantity;
          for (const batch of batches) {
            if (remaining <= 0) break;
            const amount = Math.min(Math.max(0, batch.quantityRemaining), remaining);
            if (!amount) continue;
            await tx.stockBatch.update({ where: { id: batch.id }, data: { quantityRemaining: { decrement: amount } } });
            stockMovements.push({ batchId: batch.id, quantity: amount, unitCost: Number(batch.unitCost) });
            remaining -= amount;
          }
        }
      }

      let claimType: ClaimType = ClaimType.WARRANTY;
      const rawType = String(dto.claimType || dto.resolutionType || '').toUpperCase();
      if (rawType.includes('REFUND')) claimType = ClaimType.REFUND;
      else if (rawType.includes('REPLACE') || rawType.includes('EXCHANGE')) claimType = ClaimType.EXCHANGE;

      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const prefix = `CLM-${yy}${mm}`;
      let seq = (await tx.customerClaim.count({
        where: { claimNumber: { startsWith: prefix } },
      })) + 1;
      let claimNumber = `${prefix}${String(seq).padStart(5, '0')}`;
      while (await tx.customerClaim.findUnique({ where: { claimNumber } })) {
        seq++;
        claimNumber = `${prefix}${String(seq).padStart(5, '0')}`;
      }

      const prismaStatus = this.mapToPrismaClaimStatus(dto.frontendStatus || dto.status);

      const claim = await tx.customerClaim.create({
        data: {
          claimNumber,
          orderId: orderId,
          customerId: customerId,
          productId: productId,
          serialNo: dto.serialNo || null,
          claimType: claimType,
          problemDescription: dto.problemDescription || dto.defectReason || 'เคลมสินค้า',
          status: prismaStatus,
          resolutionNote: dto.note || dto.resolutionNote || null,
          completedDate: prismaStatus === ClaimStatus.COMPLETED ? now : null,
        },
        include: {
          product: true,
          customer: true,
          order: true,
        },
      });

      // Record STOCK_OUT_CLAIM in AuditLog when replacement stock is deducted
      if (exchange && !skipStockDeduction && replacementProductObj && replacementBaseQuantity) {
        await tx.auditLog.create({
          data: {
            action: 'STOCK_OUT_CLAIM',
            entity: 'Product',
            entityId: replacementProductObj.id,
            details: {
              productId: replacementProductObj.id,
              sku: replacementProductObj.sku,
              productName: replacementProductObj.name,
              unitName: replacementProductObj.unit || 'ชิ้น',
              type: 'OUT_CLAIM',
              quantityChange: -replacementBaseQuantity,
              previousStock: replacementPreviousStock,
              currentStock: replacementPreviousStock - replacementBaseQuantity,
              referenceType: 'CLAIM',
              referenceNo: claimNumber,
              reason: 'เปลี่ยนสินค้าเคลมใบ #' + claimNumber,
              userName: dto.cashierName || 'เจ้าหน้าที่รับเคลม',
            },
          },
        });
      }

      const resolvedUnitCost = Number(dto.costPrice ?? claim.product?.costPrice ?? 0);

      // Track in Claim Inventory
      const existingInv = await tx.claimInventory.findFirst({
        where: { productId },
      });
      if (existingInv) {
        await tx.claimInventory.update({
          where: { id: existingInv.id },
          data: {
            quantity: { increment: baseQuantity },
            ...(resolvedUnitCost > 0 ? { unitCost: resolvedUnitCost } : {}),
          },
        });
      } else {
        await tx.claimInventory.create({
          data: {
            productId,
            quantity: baseQuantity,
            unitCost: resolvedUnitCost,
            condition: 'รอตรวจสอบ / ส่งเคลม',
            location: 'คลังสินค้าเคลม',
          },
        });
      }

      const resolvedResolutionType =
        dto.resolutionType ||
        (claimType === ClaimType.EXCHANGE
          ? 'REPLACE_ITEM'
          : claimType === ClaimType.REFUND
            ? 'REFUND_CASH'
            : 'SUPPLIER_RMA');

      const resolvedFrontendStatus =
        dto.frontendStatus ||
        dto.claimStatus ||
        (typeof dto.status === 'string' &&
        ['COMPLETED', 'PENDING_CHECKOUT', 'PENDING_SUPPLIER', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'SCRAPPED'].includes(dto.status)
          ? dto.status
          : prismaStatus === ClaimStatus.COMPLETED
            ? 'COMPLETED'
            : resolvedResolutionType === 'STORE_DISCOUNT'
              ? 'PENDING_CHECKOUT'
              : 'PENDING_SUPPLIER');

      const resolvedUnitPrice = Number(dto.unitPrice ?? claim.product?.priceLevel1 ?? claim.product?.basePrice ?? 0);
      const resolvedTotalClaimValue = Number(dto.totalClaimValue ?? dto.refundAmount ?? resolvedUnitPrice * quantity);
      const resolvedTotalCostValue = Number(dto.totalCostValue ?? Math.round(resolvedUnitCost * quantity * 100) / 100);

      const claimMeta = {
        id: claimNumber,
        claimId: claim.id,
        claimNumber,
        claimDate: claim.receivedDate.toISOString(),
        orderId: orderId || dto.orderId || '',
        orderNumber: claim.order?.orderNumber || dto.orderNumber || '-',
        orderDate: claim.order?.createdAt ? claim.order.createdAt.toISOString() : (dto.orderDate || claim.createdAt.toISOString()),
        customerId: claim.customerId || dto.customerId || null,
        customerName: claim.customer?.name || dto.customerName || 'ลูกค้าทั่วไป',
        customerPhone: claim.customer?.phone || dto.customerPhone || '-',
        productId,
        productName: claim.product?.name || dto.productName || 'สินค้า',
        sku: claim.product?.sku || dto.sku || '-',
        unitName: dto.unitName || claim.product?.unit || 'ชิ้น',
        quantity,
        conversionFactor: baseQuantity / quantity,
        baseQuantity,
        unitPrice: resolvedUnitPrice,
        totalClaimValue: resolvedTotalClaimValue,
        defectReason: dto.defectReason || dto.problemDescription || claim.problemDescription || '-',
        resolutionType: resolvedResolutionType,
        refundAmount:
          dto.refundAmount !== undefined
            ? Number(dto.refundAmount)
            : resolvedResolutionType.startsWith('REFUND')
              ? resolvedTotalClaimValue
              : undefined,
        refundAccountId: dto.refundAccountId,
        refundAccountLabel: dto.refundAccountLabel,
        refundAccountNumber: dto.refundAccountNumber,
        discountAmount:
          dto.discountAmount !== undefined
            ? Number(dto.discountAmount)
            : resolvedResolutionType === 'STORE_DISCOUNT'
              ? resolvedTotalClaimValue
              : undefined,
        replacementProductId: replacementProductId || dto.replacementProductId || productId,
        replacementProductName: dto.replacementProductName || replacementProductObj?.name || claim.product?.name,
        replacementSku: dto.replacementSku || replacementProductObj?.sku || claim.product?.sku,
        replacementUnitName: dto.replacementUnitName || dto.unitName || replacementProductObj?.unit || claim.product?.unit || 'ชิ้น',
        replacementBaseQuantity,
        replacementConversionFactor: replacementBaseQuantity
          ? replacementBaseQuantity / quantity
          : dto.replacementConversionFactor
            ? Number(dto.replacementConversionFactor)
            : baseQuantity / quantity,
        status: resolvedFrontendStatus,
        frontendStatus: resolvedFrontendStatus,
        cashierName: dto.cashierName || 'พนักงาน POS',
        note: dto.note || dto.resolutionNote || undefined,
        isReplacementItem: Boolean(dto.isReplacementItem),
        parentClaimId: dto.parentClaimId || dto.originalClaimId,
        claimedInOrderNumber: dto.claimedInOrderNumber || dto.fulfilledInOrderNumber,
        supplierId: dto.supplierId,
        supplierName: dto.supplierName,
        supplierTrackingNo: dto.supplierTrackingNo,
        costPrice: resolvedUnitCost,
        totalCostValue: resolvedTotalCostValue,
        returnDocId: dto.returnDocId,
        settledInBillNumber: dto.settledInBillNumber,
        completedDate: claim.completedDate ? claim.completedDate.toISOString() : undefined,
      };

      await tx.auditLog.create({
        data: {
          action: 'CLAIM_META',
          entity: 'CustomerClaim',
          entityId: claim.id,
          details: JSON.parse(JSON.stringify(claimMeta)),
        },
      });

      // Mark previous replacement warranty as claimed if this claim was for a replacement item
      if (dto.isReplacementItem && (dto.originalClaimId || dto.parentClaimId || dto.claimedWarrantyId)) {
        const targetRef = dto.claimedWarrantyId || dto.originalClaimId || dto.parentClaimId;
        const warrantyLogs = await tx.auditLog.findMany({
          where: {
            entity: 'ReplacementWarranty',
            action: 'WARRANTY_RECORD',
          },
        });
        for (const wLog of warrantyLogs) {
          const wDetails = (wLog.details as any) || {};
          if (
            wLog.entityId === targetRef ||
            wDetails.id === targetRef ||
            wDetails.originalClaimId === targetRef
          ) {
            await tx.auditLog.update({
              where: { id: wLog.id },
              data: {
                details: {
                  ...wDetails,
                  isClaimed: true,
                  claimId: claimNumber,
                },
              },
            });
          }
        }
      }

      // Create new ReplacementWarrantyRecord when exchange is true or replacementWarranty is passed
      if (dto.replacementWarranty || exchange) {
        const warrantyId = dto.replacementWarranty?.id || `RWM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const warrantyObj = {
          originalOrderId: claimMeta.orderId,
          originalOrderNumber: claimMeta.orderNumber,
          replacementDate: claim.receivedDate.toISOString(),
          customerId: claimMeta.customerId,
          customerName: claimMeta.customerName,
          customerPhone: claimMeta.customerPhone,
          productId: claimMeta.replacementProductId || productId,
          productName: claimMeta.replacementProductName || claimMeta.productName,
          sku: claimMeta.replacementSku || claimMeta.sku,
          unitName: claimMeta.replacementUnitName || claimMeta.unitName,
          unitPrice: claimMeta.unitPrice,
          isClaimed: false,
          ...(dto.replacementWarranty || {}),
          id: warrantyId,
          originalClaimId: claimNumber,
        };
        await tx.auditLog.create({
          data: {
            action: 'WARRANTY_RECORD',
            entity: 'ReplacementWarranty',
            entityId: warrantyId,
            details: JSON.parse(JSON.stringify(warrantyObj)),
          },
        });
      }

      const result = {
        ...claimMeta,
        ...claim,
        id: claim.id,
        claimNumber: claim.claimNumber,
        frontendStatus: claimMeta.frontendStatus,
        quantity,
        baseQuantity,
        conversionFactor: baseQuantity / quantity,
        replacementProductId: claimMeta.replacementProductId,
        replacementBaseQuantity,
        replacementConversionFactor: claimMeta.replacementConversionFactor,
      };
      if (receiptId) {
        await tx.auditLog.create({
          data: {
            id: receiptId,
            action: 'EXCHANGE',
            entity: 'CustomerClaim',
            entityId: claim.id,
            details: {
              fingerprint,
              stockMovements,
              result: JSON.parse(JSON.stringify(result)),
            },
          },
        });
      }
      return result;
    });
  }

  async updateClaim(id: string, dto: any) {
    return businessTransaction(this.prisma, async (tx) => {
      const claim = await tx.customerClaim.findFirst({
        where: {
          OR: [{ id }, { claimNumber: id }],
        },
      });
      if (!claim) throw new NotFoundException('ไม่พบข้อมูลการเคลมนี้');

      const updatePayload: any = {};
      if (dto.status || dto.frontendStatus) {
        const mappedStatus = this.mapToPrismaClaimStatus(dto.frontendStatus || dto.status);
        updatePayload.status = mappedStatus;
        if (mappedStatus === ClaimStatus.COMPLETED) {
          updatePayload.completedDate = dto.completedDate ? new Date(dto.completedDate) : new Date();
        }
      }
      if (dto.resolutionNote !== undefined) {
        updatePayload.resolutionNote = dto.resolutionNote;
      } else if (dto.note !== undefined) {
        updatePayload.resolutionNote = dto.note;
      }

      const updated = await tx.customerClaim.update({
        where: { id: claim.id },
        data: updatePayload,
        include: { product: true, customer: true, order: true },
      });

      const existingMetaLog = await tx.auditLog.findFirst({
        where: {
          entity: 'CustomerClaim',
          entityId: claim.id,
          action: 'CLAIM_META',
        },
        orderBy: { createdAt: 'desc' },
      });

      const prevMeta = (existingMetaLog?.details as any) || {};
      const nextFrontendStatus = dto.frontendStatus || dto.status || prevMeta.frontendStatus || prevMeta.status || updated.status;
      const mergedMeta = {
        ...prevMeta,
        id: updated.claimNumber,
        claimId: updated.id,
        claimNumber: updated.claimNumber,
        status: nextFrontendStatus,
        frontendStatus: nextFrontendStatus,
        ...(dto.returnDocId !== undefined ? { returnDocId: dto.returnDocId } : {}),
        ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
        ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName } : {}),
        ...(dto.supplierTrackingNo !== undefined ? { supplierTrackingNo: dto.supplierTrackingNo } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: Number(dto.costPrice) } : {}),
        ...(dto.totalCostValue !== undefined ? { totalCostValue: Number(dto.totalCostValue) } : {}),
        ...(dto.claimedInOrderNumber !== undefined ? { claimedInOrderNumber: dto.claimedInOrderNumber } : {}),
        ...(dto.settledInBillNumber !== undefined ? { settledInBillNumber: dto.settledInBillNumber } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.resolutionNote !== undefined ? { note: dto.resolutionNote } : {}),
        ...(updated.completedDate ? { completedDate: updated.completedDate.toISOString() } : {}),
      };

      if (existingMetaLog) {
        await tx.auditLog.update({
          where: { id: existingMetaLog.id },
          data: { details: JSON.parse(JSON.stringify(mergedMeta)) },
        });
      } else {
        await tx.auditLog.create({
          data: {
            action: 'CLAIM_META',
            entity: 'CustomerClaim',
            entityId: claim.id,
            details: JSON.parse(JSON.stringify(mergedMeta)),
          },
        });
      }

      const logs = await tx.auditLog.findMany({
        where: {
          entity: 'CustomerClaim',
          entityId: claim.id,
          action: { in: ['CLAIM_META', 'EXCHANGE'] },
        },
        orderBy: { createdAt: 'asc' },
      });

      return this.mergeClaimWithLogs(updated, logs);
    });
  }

  // ─── Replacement Warranties Endpoints ───
  async getReplacementWarranties() {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        entity: 'ReplacementWarranty',
        action: 'WARRANTY_RECORD',
      },
      orderBy: { createdAt: 'desc' },
    });

    const seen = new Set<string>();
    const results: any[] = [];
    for (const log of logs) {
      const details = (log.details as any) || {};
      const key = details.id || log.entityId || log.id;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        ...details,
        id: details.id || log.entityId || log.id,
      });
    }
    return results;
  }

  async saveReplacementWarranty(dto: any) {
    const warrantyId = dto.id || `RWM-${Date.now()}`;
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        entity: 'ReplacementWarranty',
        action: 'WARRANTY_RECORD',
        entityId: warrantyId,
      },
      orderBy: { createdAt: 'desc' },
    });

    const warrantyObj = {
      ...(existing ? ((existing.details as any) || {}) : {}),
      ...dto,
      id: warrantyId,
      isClaimed: Boolean(dto.isClaimed ?? (existing?.details as any)?.isClaimed ?? false),
    };

    if (existing) {
      await this.prisma.auditLog.update({
        where: { id: existing.id },
        data: { details: JSON.parse(JSON.stringify(warrantyObj)) },
      });
    } else {
      await this.prisma.auditLog.create({
        data: {
          action: 'WARRANTY_RECORD',
          entity: 'ReplacementWarranty',
          entityId: warrantyId,
          details: JSON.parse(JSON.stringify(warrantyObj)),
        },
      });
    }
    return warrantyObj;
  }

  async updateReplacementWarranty(id: string, dto: any) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        entity: 'ReplacementWarranty',
        action: 'WARRANTY_RECORD',
      },
      orderBy: { createdAt: 'desc' },
    });

    const matching = logs.find((l) => {
      const d = (l.details as any) || {};
      return l.entityId === id || d.id === id || d.originalClaimId === id;
    });

    if (!matching) {
      return this.saveReplacementWarranty({ ...dto, id });
    }

    const prevDetails = (matching.details as any) || {};
    const updatedDetails = {
      ...prevDetails,
      ...dto,
      isClaimed: dto.isClaimed !== undefined ? Boolean(dto.isClaimed) : true,
    };

    await this.prisma.auditLog.update({
      where: { id: matching.id },
      data: { details: JSON.parse(JSON.stringify(updatedDetails)) },
    });

    return updatedDetails;
  }

  // ─── Claim Inventory Endpoints ───
  async getClaimInventory() {
    const [items, metaLogs] = await Promise.all([
      this.prisma.claimInventory.findMany({
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true, basePrice: true, costPrice: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: {
          entity: 'ClaimInventory',
          action: 'CLAIM_INVENTORY_META',
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const metaMap = new Map<string, any>();
    for (const log of metaLogs) {
      if (log.entityId && log.details) {
        metaMap.set(log.entityId, { ...(metaMap.get(log.entityId) || {}), ...(log.details as any) });
      }
    }

    return items.map((item) => {
      const meta = metaMap.get(item.id) || {};
      return {
        ...meta,
        ...item,
        unitCost: Number(item.unitCost ?? meta.unitCost ?? item.product?.costPrice ?? 0),
        productName: item.product?.name || meta.productName || 'สินค้า',
        sku: item.product?.sku || meta.sku || '-',
        unitName: item.product?.unit || meta.unitName || 'ชิ้น',
      };
    });
  }

  async createClaimInventory(data: any) {
    return businessTransaction(this.prisma, async (tx) => {
      let productId = data.productId;
      if (productId) {
        const prod = await tx.product.findFirst({
          where: {
            OR: [{ id: productId }, { sku: productId }],
          },
        });
        if (prod) productId = prod.id;
      }
      if (!productId) throw new BadRequestException('กรุณาระบุรหัสสินค้า');

      const existing = await tx.claimInventory.findFirst({
        where: { productId },
      });

      const qty = Number(data.quantity ?? 0);
      const unitCost = Number(data.unitCost ?? 0);

      let inv: any;
      if (existing && data.increment) {
        inv = await tx.claimInventory.update({
          where: { id: existing.id },
          data: {
            quantity: { increment: qty },
            ...(unitCost > 0 ? { unitCost } : {}),
            ...(data.condition !== undefined ? { condition: data.condition } : {}),
            ...(data.location !== undefined ? { location: data.location } : {}),
            ...(data.note !== undefined ? { note: data.note } : {}),
          },
          include: { product: true },
        });
      } else if (existing && !data.forceCreate) {
        inv = await tx.claimInventory.update({
          where: { id: existing.id },
          data: {
            quantity: qty,
            ...(unitCost > 0 ? { unitCost } : {}),
            ...(data.condition !== undefined ? { condition: data.condition } : {}),
            ...(data.location !== undefined ? { location: data.location } : {}),
            ...(data.note !== undefined ? { note: data.note } : {}),
          },
          include: { product: true },
        });
      } else {
        inv = await tx.claimInventory.create({
          data: {
            productId,
            quantity: qty,
            unitCost,
            condition: data.condition || 'รอตรวจสอบ / ส่งเคลม',
            location: data.location || 'คลังสินค้าเคลม',
            note: data.note || null,
          },
          include: { product: true },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'CLAIM_INVENTORY_META',
          entity: 'ClaimInventory',
          entityId: inv.id,
          details: JSON.parse(JSON.stringify(data)),
        },
      });

      return inv;
    });
  }

  async updateClaimInventory(id: string, data: { quantity?: number; unitCost?: number; condition?: string; location?: string; note?: string; [key: string]: any }) {
    return businessTransaction(this.prisma, async (tx) => {
      const existing = await tx.claimInventory.findFirst({
        where: {
          OR: [{ id }, { productId: id }],
        },
      });
      if (!existing) throw new NotFoundException('ไม่พบข้อมูลสต็อกสินค้าเคลมนี้');

      const updateData: any = {};
      if (data.quantity !== undefined) updateData.quantity = Number(data.quantity);
      if (data.unitCost !== undefined) updateData.unitCost = Number(data.unitCost);
      if (data.condition !== undefined) updateData.condition = data.condition;
      if (data.location !== undefined) updateData.location = data.location;
      if (data.note !== undefined) updateData.note = data.note;

      const updated = await tx.claimInventory.update({
        where: { id: existing.id },
        data: updateData,
        include: { product: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'CLAIM_INVENTORY_META',
          entity: 'ClaimInventory',
          entityId: updated.id,
          details: JSON.parse(JSON.stringify(data)),
        },
      });

      return updated;
    });
  }
}
