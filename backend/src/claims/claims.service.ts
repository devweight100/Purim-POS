import { businessTransaction } from '../prisma/business-transaction';
import * as ledger from '../finance/ledger';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CashMovementType, ClaimStatus, ClaimType, OrderStatus, ShiftStatus } from '@prisma/client';
import { ShiftsService } from '../shifts/shifts.service';
import { userHasPermission } from '../auth/permissions';
import { addQty, assertQtyAllowed, decimalQtyAllowed, fromHund, hasMax2Decimals, mulQty, qn, roundQty, subQty, toHund } from '../common/qty';
import { round2 } from '../../../shared/src/money';

export interface ClaimActor {
  id: string;
  username?: string;
  fullName?: string | null;
  role?: string;
  permissions?: unknown;
}

export const RESOLUTION_TYPES = ['REPLACE_ITEM', 'REFUND_CASH', 'REFUND_TRANSFER', 'STORE_DISCOUNT', 'SUPPLIER_RMA'] as const;
export const FRONTEND_STATUSES = ['COMPLETED', 'PENDING_CHECKOUT', 'PENDING_SUPPLIER', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'SCRAPPED', 'REJECTED'] as const;
export type FrontendStatus = (typeof FRONTEND_STATUSES)[number];
/** Legacy / Prisma names accepted on input, mapped onto the frontend workflow statuses. */
const STATUS_ALIASES: Record<string, FrontendStatus> = { PENDING: 'PENDING_SUPPLIER', IN_PROGRESS: 'SENT_TO_SUPPLIER' };

/**
 * Claim workflow. COMPLETED -> SENT_TO_SUPPLIER/SCRAPPED is the defective unit (kept in the claim
 * stock) going to the supplier or being written off after the customer was already served.
 * SENT_TO_SUPPLIER -> PENDING_SUPPLIER is a cancelled supplier-return document.
 * SCRAPPED and REJECTED are final.
 */
export const CLAIM_TRANSITIONS: Record<FrontendStatus, FrontendStatus[]> = {
  PENDING_CHECKOUT: ['COMPLETED', 'REJECTED'],
  PENDING_SUPPLIER: ['SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'COMPLETED', 'SCRAPPED', 'REJECTED'],
  SENT_TO_SUPPLIER: ['SUPPLIER_REPLACED', 'PENDING_SUPPLIER', 'COMPLETED', 'SCRAPPED', 'REJECTED'],
  SUPPLIER_REPLACED: ['COMPLETED'],
  COMPLETED: ['SENT_TO_SUPPLIER', 'SCRAPPED', 'REJECTED'],
  SCRAPPED: [],
  REJECTED: [],
};

export function normalizeFrontendStatus(raw: unknown): FrontendStatus | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if ((FRONTEND_STATUSES as readonly string[]).includes(s)) return s as FrontendStatus;
  return STATUS_ALIASES[s] || null;
}

export function canTransition(from: FrontendStatus, to: FrontendStatus) {
  return from === to || CLAIM_TRANSITIONS[from].includes(to);
}


/** Claim stock quantity: never negative, at most 2 decimals (whole units unless the store allows decimals). */
export function parseClaimStockQuantity(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !hasMax2Decimals(n) || n < 0 || n > 1_000_000_000) throw new BadRequestException('จำนวนสต็อกสินค้าเคลมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
  return roundQty(n);
}

/** Claim stock unit cost: a money amount, never negative. */
export function parseClaimStockCost(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) throw new BadRequestException('ต้นทุนต่อหน่วยต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  return Math.round(n * 100) / 100;
}

function assertClaimStockText(data: any) {
  for (const k of ['condition', 'location', 'note']) {
    const v = data[k];
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 1000)) throw new BadRequestException('ข้อมูลสต็อกสินค้าเคลมไม่ถูกต้อง');
  }
}
const MAX_MONEY = 1e9;

@Injectable()
export class ClaimsService {
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly shifts?: ShiftsService,
  ) {}

  private actorName(actor?: ClaimActor | null) {
    return actor?.fullName || actor?.username || 'พนักงาน POS';
  }

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

  /** Rows of GET /claims (claim + product / customer / order, merged with its CLAIM_META / EXCHANGE logs) for these ids, newest first. */
  private async mergedClaimsByIds(ids: string[]) {
    if (!ids.length) return [];
    const [claims, logs] = await Promise.all([
      this.prisma.customerClaim.findMany({
        where: { id: { in: ids } },
        orderBy: { receivedDate: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true, basePrice: true, costPrice: true, priceLevel1: true } },
          customer: { select: { id: true, name: true, phone: true } },
          order: { select: { id: true, orderNumber: true, createdAt: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { entity: 'CustomerClaim', entityId: { in: ids }, action: { in: ['CLAIM_META', 'EXCHANGE'] } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const logsByClaimId = new Map<string, any[]>();
    for (const log of logs) {
      if (!log.entityId) continue;
      const arr = logsByClaimId.get(log.entityId) || [];
      arr.push(log);
      logsByClaimId.set(log.entityId, arr);
    }
    return claims.map((claim) => this.mergeClaimWithLogs(claim, logsByClaimId.get(claim.id) || []));
  }

  /**
   * GET /claims/claimed-orders?orderIds=a,b: the ids of these bills that have a claim, over EVERY claim.
   * Same rule as the orders page used on the claims list (newest 500 only): a claim marks the bill whose id or
   * number equals the claim's orderId or its bill number (the linked order's number, else the orderNumber kept in
   * its CLAIM_META audit log - claims recorded by bill number have no order id). Candidates come from indexed
   * lookups (customer_claims.order_id, the CLAIM_META orderNumber expression index); the bill number is then
   * resolved exactly as GET /claims does.
   */
  async getClaimedOrderIds(orderIds: string[]): Promise<string[]> {
    const orders = await this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } });
    if (!orders.length) return [];
    const keys = [...new Set(orders.flatMap((o) => [o.id, o.orderNumber]))];
    const [linked, metaRows] = await Promise.all([
      this.prisma.customerClaim.findMany({
        where: { OR: [{ orderId: { in: keys } }, { order: { orderNumber: { in: keys } } }] },
        select: { id: true, orderId: true, order: { select: { orderNumber: true } } },
      }),
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT entity_id AS id FROM audit_logs
         WHERE entity = 'CustomerClaim' AND action = 'CLAIM_META' AND (details ->> 'orderNumber') = ANY(${keys})`,
    ]);
    const claimed = new Set<string>();
    const resolveIds = new Set(metaRows.map((r) => r.id));
    for (const c of linked) {
      if (c.orderId) claimed.add(c.orderId);
      if (c.order?.orderNumber) claimed.add(c.order.orderNumber);
      else resolveIds.add(c.id); // bill number from CLAIM_META
    }
    for (const c of await this.mergedClaimsByIds([...resolveIds])) {
      if (c.orderId) claimed.add(c.orderId);
      if (c.orderNumber !== undefined && c.orderNumber !== null && c.orderNumber !== '') claimed.add(c.orderNumber);
    }
    return orders.filter((o) => claimed.has(o.id) || claimed.has(o.orderNumber)).map((o) => o.id);
  }

  /**
   * GET /claims/returnable: EVERY claim the supplier-returns page can still send back (not on a return note,
   * not scrapped) - the rule of the page's getEligibleClaimsForReturn, which ran on the newest 500 claims only.
   * SQL keeps the claims whose CLAIM_META may lack a returnDocId and may not be scrapped (a superset); the
   * merged rows are then filtered with the page's exact rule. Same row shape and order as GET /claims.
   */
  async getReturnableClaims() {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM customer_claims c
        LEFT JOIN (SELECT entity_id,
                          bool_or(NOT (COALESCE(jsonb_typeof(details -> 'returnDocId'), '') = 'string' AND details ->> 'returnDocId' <> '')) AS may_lack_doc,
                          bool_or(COALESCE(details ->> 'frontendStatus', '') NOT IN ('SCRAPPED', 'REJECTED')) AS may_be_open
                     FROM audit_logs WHERE entity = 'CustomerClaim' AND action = 'CLAIM_META' GROUP BY entity_id) m ON m.entity_id = c.id
       WHERE m.entity_id IS NULL OR (m.may_lack_doc AND m.may_be_open)`;
    const data = (await this.mergedClaimsByIds(rows.map((r) => r.id))).filter((c: any) => {
      const raw = c.frontendStatus || c.claimStatus || c.status;
      return !c.returnDocId && raw !== 'SCRAPPED' && raw !== 'REJECTED';
    });
    return { data, meta: { total: data.length } };
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

  async createClaim(dto: any, actor?: ClaimActor) {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('ข้อมูลการเคลมไม่ถูกต้อง');
    if (typeof dto.productId !== 'string' || !dto.productId.trim()) throw new BadRequestException('กรุณาระบุสินค้าที่เคลม');
    const quantity = dto.quantity === undefined ? 1 : Number(dto.quantity);
    if (!Number.isFinite(quantity) || !hasMax2Decimals(quantity) || quantity <= 0 || quantity > 100000) throw new BadRequestException('จำนวนสินค้าเคลมต้องมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
    if (dto.resolutionType !== undefined && dto.resolutionType !== null && !(RESOLUTION_TYPES as readonly string[]).includes(dto.resolutionType)) {
      throw new BadRequestException('รูปแบบการแก้ไขเคลมไม่ถูกต้อง');
    }
    for (const key of ['orderId', 'customerId', 'replacementProductId', 'fulfilledInOrderId', 'fulfilledInOrderNumber', 'refundAccountId', 'clientClaimId']) {
      if (dto[key] !== undefined && dto[key] !== null && typeof dto[key] !== 'string') throw new BadRequestException('ข้อมูลการเคลมไม่ถูกต้อง');
    }
    // The audit trail names the logged-in user, never a name typed by the client.
    dto = { ...dto, cashierName: this.actorName(actor) };
    return businessTransaction(this.prisma, async tx => {
      const exchange = /REPLACE|EXCHANGE/.test(String(dto.claimType || '').toUpperCase());
      const wantsSkip = exchange && (dto.skipStockDeduction === true || !!dto.fulfilledInOrderNumber || !!dto.fulfilledInOrderId);
      let fulfilledOrder: { id: string; orderNumber: string } | null = null;
      let skipStockDeduction = false;
      const clientClaimId = dto.clientClaimId || (wantsSkip ? `auto-claim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` : null);
      const receiptId = exchange && clientClaimId ? 'claim-exchange-' + clientClaimId : null;
      if (exchange && !wantsSkip && !/^[a-zA-Z0-9-]{16,80}$/.test(dto.clientClaimId || '')) throw new BadRequestException('กรุณาระบุรหัสเคลมเพื่อป้องกันตัดสต็อกซ้ำ');
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
      let linkedOrder: any = null;
      if (orderId) {
        linkedOrder = await tx.order.findFirst({
          where: {
            OR: [{ id: orderId }, { orderNumber: orderId }],
          },
          include: { items: true },
        });
        orderId = linkedOrder ? linkedOrder.id : null;
      }

      let customerId: string | null = dto.customerId || null;
      if (customerId) {
        const cust = await tx.customer.findFirst({
          where: { id: customerId },
        });
        customerId = cust ? cust.id : null;
      }

      let productId = dto.productId;
      const claimedProduct = await tx.product.findFirst({
        where: {
          OR: [{ id: productId }, { sku: productId }, { barcodes: { some: { barcode: productId } } }],
        },
      });
      if (!claimedProduct) throw new NotFoundException('ไม่พบสินค้าที่เคลม');
      productId = claimedProduct.id;
      assertQtyAllowed(quantity, await decimalQtyAllowed(tx));

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

      const baseQuantity = mulQty(quantity, await factorFor(productId, dto.conversionFactor));
      if (!(baseQuantity <= 1_000_000_000)) throw new BadRequestException('จำนวนสินค้าเคลมมากเกินไป');

      const requestedResolution = String(dto.resolutionType || dto.claimType || '').toUpperCase();
      const isRefund = requestedResolution.includes('REFUND');
      if (isRefund && !userHasPermission(actor, 'MANAGE_CLAIMS')) {
        throw new ForbiddenException('การคืนเงินเคลมต้องใช้สิทธิ์จัดการเคลม (MANAGE_CLAIMS)');
      }
      // Claimed quantity must exist in the referenced bill (earlier claims of that line count too).
      const orderLine = await this.checkAgainstOrder(tx, linkedOrder, dto, productId, baseQuantity, isRefund);

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
        replacementBaseQuantity = mulQty(quantity, await factorFor(replacement.id, dto.replacementConversionFactor ?? dto.conversionFactor));
        if (!(replacementBaseQuantity <= 1_000_000_000)) throw new BadRequestException('จำนวนของเปลี่ยนมากเกินไป');
        // "Replacement already rung up in sale X" is only believed when sale X really holds that line.
        fulfilledOrder = wantsSkip ? await this.verifiedFulfilmentOrder(tx, dto, actor, replacement.id, replacementBaseQuantity) : null;
        skipStockDeduction = !!fulfilledOrder;
        if (!skipStockDeduction && !/^[a-zA-Z0-9-]{16,80}$/.test(dto.clientClaimId || '')) throw new BadRequestException('กรุณาระบุรหัสเคลมเพื่อป้องกันตัดสต็อกซ้ำ');

        if (!skipStockDeduction) {
          const batches = await tx.stockBatch.findMany({ where: { productId: replacement.id }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
          replacementPreviousStock = addQty(...batches.map((batch) => batch.quantityRemaining));
          if (replacementPreviousStock < replacementBaseQuantity) {
            throw new BadRequestException(`สต็อกสินค้าที่นำไปเปลี่ยนไม่เพียงพอ (คงเหลือ ${replacementPreviousStock} ชิ้น, ต้องการ ${replacementBaseQuantity} ชิ้น)`);
          }
          let remainingH = toHund(replacementBaseQuantity);
          for (const batch of batches) {
            if (remainingH <= 0) break;
            const batchH = toHund(batch.quantityRemaining);
            const takeH = Math.min(Math.max(0, batchH), remainingH);
            if (!takeH) continue;
            await tx.stockBatch.update({ where: { id: batch.id }, data: { quantityRemaining: fromHund(batchH - takeH) } });
            stockMovements.push({ batchId: batch.id, quantity: fromHund(takeH), unitCost: Number(batch.unitCost) });
            remainingH -= takeH;
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

      // Initial status follows the resolution (the client cannot open a claim as e.g. SCRAPPED).
      const initialResolution =
        dto.resolutionType ||
        (claimType === ClaimType.EXCHANGE ? 'REPLACE_ITEM' : claimType === ClaimType.REFUND ? 'REFUND_CASH' : 'SUPPLIER_RMA');
      const initialFrontendStatus: FrontendStatus =
        initialResolution === 'SUPPLIER_RMA' ? 'PENDING_SUPPLIER' : initialResolution === 'STORE_DISCOUNT' ? 'PENDING_CHECKOUT' : 'COMPLETED';
      dto = { ...dto, frontendStatus: initialFrontendStatus, claimStatus: undefined, status: initialFrontendStatus };
      const prismaStatus = this.mapToPrismaClaimStatus(initialFrontendStatus);

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
          quantity,
          conversionFactor: Math.round(baseQuantity / quantity),
          baseQuantity,
          unitName: typeof dto.unitName === 'string' ? dto.unitName.slice(0, 40) : claimedProduct.unit,
          cashierName: dto.cashierName,
          frontendStatus: initialFrontendStatus,
          ...(replacementProductId ? { replacementProductId, replacementBaseQuantity: replacementBaseQuantity ?? null } : {}),
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
              currentStock: subQty(replacementPreviousStock, replacementBaseQuantity),
              referenceType: 'CLAIM',
              referenceNo: claimNumber,
              reason: 'เปลี่ยนสินค้าเคลมใบ #' + claimNumber,
              userName: dto.cashierName || 'เจ้าหน้าที่รับเคลม',
            },
          },
        });
      }

      const clientCost = dto.costPrice === undefined || dto.costPrice === null ? NaN : Number(dto.costPrice);
      const resolvedUnitCost = Number.isFinite(clientCost) && clientCost >= 0 && clientCost <= MAX_MONEY ? clientCost : Number(claim.product?.costPrice ?? 0);

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
      if (!Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice < 0 || resolvedUnitPrice > MAX_MONEY) throw new BadRequestException('ราคาสินค้าเคลมไม่ถูกต้อง');
      if (resolvedResolutionType.startsWith('REFUND')) {
        const refundAmount = this.validatedRefundAmount(dto, actor, orderLine, claimedProduct, baseQuantity);
        dto = { ...dto, refundAmount };
      } else if (dto.refundAmount !== undefined) {
        dto = { ...dto, refundAmount: undefined };
      }
      const resolvedTotalClaimValue = Number(dto.totalClaimValue ?? dto.refundAmount ?? resolvedUnitPrice * quantity);
      if (!Number.isFinite(resolvedTotalClaimValue) || resolvedTotalClaimValue < 0 || resolvedTotalClaimValue > MAX_MONEY) throw new BadRequestException('มูลค่าเคลมไม่ถูกต้อง');
      const clientTotalCost = dto.totalCostValue === undefined || dto.totalCostValue === null ? NaN : Number(dto.totalCostValue);
      const resolvedTotalCostValue = Number.isFinite(clientTotalCost) && clientTotalCost >= 0 && clientTotalCost <= MAX_MONEY ? clientTotalCost : Math.round(resolvedUnitCost * quantity * 100) / 100;

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
        conversionFactor: Math.round(baseQuantity / quantity),
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
          ? Math.round(replacementBaseQuantity / quantity)
          : dto.replacementConversionFactor
            ? Number(dto.replacementConversionFactor)
            : Math.round(baseQuantity / quantity),
        status: resolvedFrontendStatus,
        frontendStatus: resolvedFrontendStatus,
        cashierName: dto.cashierName || 'พนักงาน POS',
        note: dto.note || dto.resolutionNote || undefined,
        isReplacementItem: Boolean(dto.isReplacementItem),
        parentClaimId: dto.parentClaimId || dto.originalClaimId,
        claimedInOrderNumber: fulfilledOrder?.orderNumber || undefined,
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

      // Accounting facts for profit reports: cost of goods handed out as replacement here,
      // and money paid back to the customer (store-discount refunds already reduce a later bill).
      const replacementCost = Math.round(stockMovements.reduce((sum, m) => sum + m.quantity * m.unitCost, 0) * 100) / 100;
      const refundPaid = ['REFUND_CASH', 'REFUND_TRANSFER'].includes(resolvedResolutionType) ? Number(claimMeta.refundAmount || 0) : 0;
      await tx.customerClaim.update({
        where: { id: claim.id },
        data: {
          resolutionType: resolvedResolutionType,
          refundAmount: refundPaid > 0 ? refundPaid : null,
          unitPrice: resolvedUnitPrice,
          totalClaimValue: resolvedTotalClaimValue,
          metadata: {
            ...((claim as any).metadata || {}),
            accounting: { replacementCost, refundPaid, refundMethod: refundPaid > 0 ? resolvedResolutionType : null },
            ...(fulfilledOrder ? { fulfilledInOrderId: fulfilledOrder.id } : {}),
            createdByUserId: actor?.id ?? null,
          },
        },
      });
      // Money: both refund kinds are posted here, in the same transaction as the claim.
      // Cash refunds leave the drawer of the user's open shift (cash movement + ledger).
      if (refundPaid > 0 && resolvedResolutionType === 'REFUND_CASH') {
        await this.postCashRefund(tx, actor, claim.id, claimNumber, refundPaid, claimMeta.defectReason);
      }
      if (refundPaid > 0 && resolvedResolutionType === 'REFUND_TRANSFER') {
        const bank = await ledger.bankMoneyAccount(tx, dto.refundAccountId);
        await ledger.post(tx, {
          accountId: bank.id, direction: 'OUT', amount: refundPaid, type: 'CLAIM_REFUND',
          refType: 'CLAIM', refId: claim.id, note: 'โอนคืนเงินเคลม ' + claimNumber, userId: actor?.id,
        });
      }

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
        conversionFactor: Math.round(baseQuantity / quantity),
        replacementProductId: claimMeta.replacementProductId,
        replacementBaseQuantity,
        replacementConversionFactor: claimMeta.replacementConversionFactor,
        refundAmount: claimMeta.refundAmount,
        cashierName: claimMeta.cashierName,
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

  // ─── create-claim checks ───

  /**
   * A claim that names a bill must match it: the product must be on the bill and the total claimed
   * (all earlier, not rejected claims of that bill+product) may not exceed what was bought.
   * Returns the line value used to cap refunds.
   */
  private async checkAgainstOrder(tx: any, order: any, dto: any, productId: string, baseQuantity: number, isRefund: boolean) {
    if (!order) {
      if (dto.orderId && isRefund) throw new BadRequestException('ไม่พบบิลขายที่อ้างอิง จึงคืนเงินไม่ได้');
      return null;
    }
    if (isRefund && order.status !== OrderStatus.COMPLETED) throw new BadRequestException('บิลนี้ถูกยกเลิกหรือคืนเงินไปแล้ว คืนเงินซ้ำไม่ได้');
    const lines = (order.items || []).filter((i: any) => i.productId === productId);
    if (!lines.length) {
      // A replacement unit under warranty is not on the original bill (it came from an earlier claim).
      if (dto.isReplacementItem) return null;
      throw new BadRequestException('สินค้านี้ไม่อยู่ในบิลที่อ้างอิง');
    }
    const bought = addQty(...lines.map((i: any) => i.baseQuantity ?? i.quantity ?? 0));
    const prior = await tx.customerClaim.aggregate({
      where: { orderId: order.id, productId, status: { not: ClaimStatus.REJECTED } },
      _sum: { baseQuantity: true, refundAmount: true },
    });
    const priorQty = qn(prior._sum.baseQuantity);
    if (addQty(priorQty, baseQuantity) > bought) {
      throw new BadRequestException(`จำนวนเคลมเกินจำนวนที่ซื้อในบิล (ซื้อ ${bought} เคลมไปแล้ว ${priorQty} หน่วยฐาน)`);
    }
    // Bill-level discount is spread over the lines, so a refund never exceeds what was really paid.
    const itemsTotal = (order.items || []).reduce((sum: number, i: any) => sum + Number(i.total || 0), 0);
    const billFactor = itemsTotal > 0 ? Math.min(1, Number(order.totalAmount || 0) / itemsTotal) : 1;
    const lineValue = lines.reduce((sum: number, i: any) => sum + Number(i.total || 0), 0) * billFactor;
    return {
      bought,
      lineValue: round2(lineValue),
      perBase: bought > 0 ? lineValue / bought : 0,
      priorRefunded: Number(prior._sum.refundAmount || 0),
    };
  }

  /**
   * Refund amount: a positive number, capped by the paid value of the claimed units of the bill.
   * Without a bill line there is nothing to cap against, so only a manager/owner (or a user with
   * APPROVE_OVERRIDES) may refund, capped by the product's highest selling price.
   */
  private validatedRefundAmount(
    dto: any,
    actor: ClaimActor | undefined,
    orderLine: { lineValue: number; perBase: number; priorRefunded: number } | null,
    product: any,
    baseQuantity: number,
  ): number {
    let cap: number;
    if (orderLine) {
      cap = Math.min(round2(orderLine.perBase * baseQuantity), round2(orderLine.lineValue - orderLine.priorRefunded));
    } else {
      const manager = actor?.role === 'ADMIN' || actor?.role === 'MANAGER' || userHasPermission(actor ? { ...actor, role: undefined } : null, 'APPROVE_OVERRIDES');
      if (!manager) throw new ForbiddenException('คืนเงินโดยไม่อ้างอิงบิลขาย ต้องให้ผู้จัดการ/เจ้าของเป็นผู้ทำรายการ');
      const prices = ['basePrice', 'priceLevel1', 'priceLevel2', 'priceLevel3', 'priceLevel4', 'priceLevel5']
        .map((k) => Number(product?.[k] || 0))
        .filter((n) => Number.isFinite(n));
      cap = round2(Math.max(0, ...prices) * baseQuantity);
    }
    const raw = dto.refundAmount;
    const amount = raw === undefined || raw === null || raw === '' ? cap : typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('ยอดคืนเงินต้องเป็นตัวเลขมากกว่า 0');
    const rounded = round2(amount);
    if (rounded > cap + 0.005) {
      throw new BadRequestException(`ยอดคืนเงินเกินมูลค่าสินค้าที่เคลม (คืนได้สูงสุด ฿${Math.max(0, cap).toFixed(2)})`);
    }
    return rounded;
  }

  /** Cash refund leaves the drawer of the user's open shift: cash movement + money ledger, same transaction. */
  private async postCashRefund(tx: any, actor: ClaimActor | undefined, claimId: string, claimNumber: string, amount: number, reason?: string) {
    if (!actor?.id) throw new BadRequestException('ไม่พบผู้ทำรายการ');
    const shift = await tx.shift.findFirst({ where: { userId: actor.id, status: ShiftStatus.OPEN }, orderBy: { openedAt: 'desc' } });
    if (!shift) throw new BadRequestException('ต้องเปิดกะขายก่อนคืนเงินสด (หรือเลือกคืนเป็นเงินโอน)');
    if (this.shifts) {
      const expected = Number((await this.shifts.getShiftSummary(shift.id, tx)).expectedCash || 0);
      if (amount > expected + 0.005) throw new BadRequestException(`เงินสดในลิ้นชักไม่พอคืนเงิน (คงเหลือ ฿${expected.toFixed(2)})`);
    }
    const text = `คืนเงินสดเคลมสินค้า #${claimNumber}${reason && reason !== '-' ? `: ${reason}` : ''}`.slice(0, 500);
    const movement = await tx.cashMovement.create({
      data: { id: `claim-refund-${claimId}`, shiftId: shift.id, type: CashMovementType.OUT, amount, category: 'REFUND', reason: text },
    });
    const drawer = await ledger.drawerAccount(tx, shift.terminalId);
    await ledger.post(tx, {
      accountId: drawer.id, direction: 'OUT', amount, type: 'CLAIM_REFUND',
      refType: 'CASH_MOVEMENT', refId: movement.id, userId: actor.id, note: text,
    });
    return movement;
  }

  /**
   * In-bill replacement: stock was already deducted by sale X. Believed only when X is a completed
   * sale (by this user, or the actor is a manager) whose lines of the replacement product cover
   * this claim plus earlier claims fulfilled from the same sale.
   */
  private async verifiedFulfilmentOrder(tx: any, dto: any, actor: ClaimActor | undefined, replacementProductId: string, replacementBaseQuantity: number) {
    const ref = dto.fulfilledInOrderId || dto.fulfilledInOrderNumber;
    if (!ref || typeof ref !== 'string') return null;
    const order = await tx.order.findFirst({ where: { OR: [{ id: ref }, { orderNumber: ref }] }, include: { items: true } });
    if (!order || order.status !== OrderStatus.COMPLETED) return null;
    const manager = actor?.role === 'ADMIN' || actor?.role === 'MANAGER';
    if (!manager && order.userId !== actor?.id) return null;
    const sold = (order.items || [])
      .filter((i: any) => i.productId === replacementProductId)
      .reduce((sum: number, i: any) => addQty(sum, i.baseQuantity ?? i.quantity ?? 0), 0);
    if (sold <= 0) return null;
    const used = await tx.customerClaim.aggregate({
      where: {
        replacementProductId,
        status: { not: ClaimStatus.REJECTED },
        metadata: { path: ['fulfilledInOrderId'], equals: order.id },
      },
      _sum: { replacementBaseQuantity: true },
    });
    if (addQty(used._sum.replacementBaseQuantity, replacementBaseQuantity) > sold) return null;
    return { id: order.id as string, orderNumber: order.orderNumber as string };
  }

  private currentFrontendStatus(claim: any, meta: any): FrontendStatus {
    const fromMeta = normalizeFrontendStatus(claim.frontendStatus) || normalizeFrontendStatus(meta?.frontendStatus) || normalizeFrontendStatus(meta?.status);
    if (fromMeta) return fromMeta;
    if (claim.status === ClaimStatus.COMPLETED) return 'COMPLETED';
    if (claim.status === ClaimStatus.REJECTED) return 'REJECTED';
    if (claim.status === ClaimStatus.IN_PROGRESS) return 'SENT_TO_SUPPLIER';
    return 'PENDING_SUPPLIER';
  }

  /** Reject = the claim is void: replacement stock handed out comes back, the defective unit goes back to the customer. */
  private async reverseOnReject(tx: any, claim: any, actor?: ClaimActor) {
    const receipt = await tx.auditLog.findFirst({ where: { entity: 'CustomerClaim', entityId: claim.id, action: 'EXCHANGE' } });
    const movements: Array<{ batchId: string; quantity: number }> = ((receipt?.details as any)?.stockMovements || []) as any[];
    let restored = 0;
    for (const m of movements) {
      const qty = Number(m.quantity) || 0;
      if (!m.batchId || qty <= 0) continue;
      await tx.stockBatch.update({ where: { id: m.batchId }, data: { quantityRemaining: { increment: qty } } });
      restored = addQty(restored, qty);
    }
    if (restored > 0) {
      const productId = claim.replacementProductId || claim.productId;
      await tx.auditLog.create({
        data: {
          action: 'STOCK_IN_CLAIM_REVERSAL',
          entity: 'Product',
          entityId: productId,
          userId: actor?.id ?? null,
          details: {
            productId,
            type: 'IN_CLAIM_REVERSAL',
            quantityChange: restored,
            referenceType: 'CLAIM',
            referenceNo: claim.claimNumber,
            reason: 'ยกเลิกเคลม คืนสินค้าที่เปลี่ยนให้ลูกค้าเข้าสต็อก #' + claim.claimNumber,
            userName: this.actorName(actor),
          },
        },
      });
    }
    const inv = await tx.claimInventory.findFirst({ where: { productId: claim.productId } });
    if (inv) {
      const back = Math.min(Math.max(0, qn(inv.quantity)), qn(claim.baseQuantity));
      if (back > 0) await tx.claimInventory.update({ where: { id: inv.id }, data: { quantity: { decrement: back } } });
    }
    const meta: any = claim.metadata || {};
    await tx.customerClaim.update({
      where: { id: claim.id },
      data: {
        replacementBaseQuantity: restored > 0 ? 0 : claim.replacementBaseQuantity,
        metadata: { ...meta, accounting: { ...(meta.accounting || {}), replacementCost: 0 }, rejectedStockRestored: restored, rejectedAt: new Date().toISOString() },
      },
    });
  }

  async updateClaim(id: string, dto: any, actor?: ClaimActor) {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('ข้อมูลการแก้ไขเคลมไม่ถูกต้อง');
    const textFields = ['returnDocId', 'supplierId', 'supplierName', 'supplierTrackingNo', 'claimedInOrderNumber', 'settledInBillNumber', 'note', 'resolutionNote'];
    for (const k of textFields) {
      const v = dto[k];
      if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 2000)) throw new BadRequestException('ข้อมูลการแก้ไขเคลมไม่ถูกต้อง');
    }
    for (const k of ['costPrice', 'totalCostValue']) {
      if (dto[k] !== undefined && dto[k] !== null) {
        const n = Number(dto[k]);
        if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) throw new BadRequestException('ต้นทุนเคลมไม่ถูกต้อง');
      }
    }
    const requested = dto.frontendStatus ?? dto.status;
    const next = requested === undefined || requested === null ? null : normalizeFrontendStatus(requested);
    if (requested !== undefined && requested !== null && !next) throw new BadRequestException('สถานะเคลมไม่ถูกต้อง');

    return businessTransaction(this.prisma, async (tx) => {
      const claim = await tx.customerClaim.findFirst({
        where: {
          OR: [{ id }, { claimNumber: id }],
        },
      });
      if (!claim) throw new NotFoundException('ไม่พบข้อมูลการเคลมนี้');

      const existingMetaLog = await tx.auditLog.findFirst({
        where: { entity: 'CustomerClaim', entityId: claim.id, action: 'CLAIM_META' },
        orderBy: { createdAt: 'desc' },
      });
      const prevMeta = (existingMetaLog?.details as any) || {};
      const current = this.currentFrontendStatus(claim, prevMeta);

      if (!userHasPermission(actor, 'MANAGE_CLAIMS')) {
        // A cashier without claim rights may only settle a store-discount claim in a real sale.
        const settlesInSale =
          current === 'PENDING_CHECKOUT' && next === 'COMPLETED' && typeof dto.claimedInOrderNumber === 'string' &&
          !!(await tx.order.findFirst({ where: { orderNumber: dto.claimedInOrderNumber, status: OrderStatus.COMPLETED } }));
        if (!settlesInSale) throw new ForbiddenException('การเปลี่ยนสถานะเคลมต้องใช้สิทธิ์จัดการเคลม (MANAGE_CLAIMS)');
      }
      if (next && !canTransition(current, next)) {
        throw new BadRequestException(`เปลี่ยนสถานะเคลมจาก ${current} เป็น ${next} ไม่ได้`);
      }
      if (next === 'REJECTED' && current !== 'REJECTED' && Number(claim.refundAmount || 0) > 0) {
        throw new BadRequestException('เคลมนี้คืนเงินให้ลูกค้าแล้ว ยกเลิกเคลมไม่ได้');
      }

      const updatePayload: any = {};
      if (next) {
        const mappedStatus = this.mapToPrismaClaimStatus(next);
        updatePayload.status = mappedStatus;
        updatePayload.frontendStatus = next;
        if (mappedStatus === ClaimStatus.COMPLETED && claim.status !== ClaimStatus.COMPLETED) {
          const when = dto.completedDate ? new Date(dto.completedDate) : new Date();
          updatePayload.completedDate = isNaN(when.getTime()) ? new Date() : when;
        }
      }
      if (dto.resolutionNote !== undefined) {
        updatePayload.resolutionNote = dto.resolutionNote;
      } else if (dto.note !== undefined) {
        updatePayload.resolutionNote = dto.note;
      }

      if (next === 'REJECTED' && current !== 'REJECTED') {
        await this.reverseOnReject(tx, claim, actor);
      }

      const updated = await tx.customerClaim.update({
        where: { id: claim.id },
        data: updatePayload,
        include: { product: true, customer: true, order: true },
      });

      const nextFrontendStatus = next || current;
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
        ...(dto.costPrice !== undefined && dto.costPrice !== null ? { costPrice: Number(dto.costPrice) } : {}),
        ...(dto.totalCostValue !== undefined && dto.totalCostValue !== null ? { totalCostValue: Number(dto.totalCostValue) } : {}),
        ...(dto.claimedInOrderNumber !== undefined ? { claimedInOrderNumber: dto.claimedInOrderNumber } : {}),
        ...(dto.settledInBillNumber !== undefined ? { settledInBillNumber: dto.settledInBillNumber } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.resolutionNote !== undefined ? { note: dto.resolutionNote } : {}),
        ...(updated.completedDate ? { completedDate: updated.completedDate.toISOString() } : {}),
        ...(next && next !== current ? { lastStatusChangeBy: this.actorName(actor), lastStatusChangeAt: new Date().toISOString() } : {}),
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
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('ข้อมูลสต็อกสินค้าเคลมไม่ถูกต้อง');
    if (typeof data.productId !== 'string' || !data.productId.trim()) throw new BadRequestException('กรุณาระบุรหัสสินค้า');
    const qty = parseClaimStockQuantity(data.quantity ?? 0);
    const unitCost = parseClaimStockCost(data.unitCost ?? 0);
    assertClaimStockText(data);
    return businessTransaction(this.prisma, async (tx) => {
      assertQtyAllowed(qty, await decimalQtyAllowed(tx));
      const prod = await tx.product.findFirst({
        where: {
          OR: [{ id: data.productId }, { sku: data.productId }],
        },
      });
      if (!prod) throw new NotFoundException('ไม่พบสินค้านี้');
      const productId = prod.id;

      const existing = await tx.claimInventory.findFirst({
        where: { productId },
      });

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
          details: JSON.parse(JSON.stringify({ ...data, productId, quantity: qty, unitCost })),
        },
      });

      return inv;
    });
  }

  async updateClaimInventory(id: string, data: { quantity?: number; unitCost?: number; condition?: string; location?: string; note?: string; [key: string]: any }) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('ข้อมูลสต็อกสินค้าเคลมไม่ถูกต้อง');
    if (data.quantity !== undefined) data.quantity = parseClaimStockQuantity(data.quantity);
    if (data.unitCost !== undefined) data.unitCost = parseClaimStockCost(data.unitCost);
    assertClaimStockText(data);
    if (['quantity', 'unitCost', 'condition', 'location', 'note'].every((k) => data[k] === undefined)) {
      throw new BadRequestException('ไม่มีข้อมูลที่จะแก้ไข');
    }
    return businessTransaction(this.prisma, async (tx) => {
      const existing = await tx.claimInventory.findFirst({
        where: {
          OR: [{ id }, { productId: id }],
        },
      });
      if (!existing) throw new NotFoundException('ไม่พบข้อมูลสต็อกสินค้าเคลมนี้');
      if (data.quantity !== undefined) assertQtyAllowed(data.quantity, await decimalQtyAllowed(tx));

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
