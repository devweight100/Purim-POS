import { businessTransaction } from '../prisma/business-transaction';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimStatus, ReturnNoteStatus } from '@prisma/client';

const round2 = (n: number) => Math.round(n * 100) / 100;
const isMoney = (n: number) => Number.isFinite(n) && n >= 0 && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001;

export interface NormalizedReturnItem {
  productId: string;
  itemType: 'DEFECTIVE' | 'OVERSTOCK';
  quantity: number;
  unitCost: number;
  totalCost: number;
  total: number;
  [key: string]: any;
}

/** Item totals, always computed on the server from quantity x unit cost. */
export function summarizeReturnItems(items: { itemType: string; quantity: number; unitCost: number }[]) {
  let totalQuantity = 0;
  let defective = 0;
  let overstock = 0;
  for (const i of items) {
    const line = round2(Number(i.quantity) * Number(i.unitCost));
    totalQuantity += Number(i.quantity);
    if (i.itemType === 'OVERSTOCK') overstock += line;
    else defective += line;
  }
  return { totalQuantity, defectiveTotalCost: round2(defective), overstockTotalCost: round2(overstock), itemsTotal: round2(defective + overstock) };
}

/**
 * Credit amount of a note: defaults to the items total; a client may only give a LOWER credit
 * (supplier credits less than cost), never more and never negative.
 */
export function resolveCreditAmount(requested: any, itemsTotal: number): number {
  if (requested === undefined || requested === null || requested === '') return itemsTotal;
  const n = Number(requested);
  if (typeof requested === 'boolean' || !isMoney(n)) throw new BadRequestException('ยอดเครดิตต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
  if (n > itemsTotal + 0.001) throw new BadRequestException(`ยอดเครดิต (฿${n.toFixed(2)}) ต้องไม่เกินมูลค่าสินค้าที่ส่งคืน (฿${itemsTotal.toFixed(2)})`);
  return round2(n);
}

/** Status that matches the remaining credit of a (not cancelled) note. */
export function statusForRemaining(remaining: number, total: number): ReturnNoteStatus {
  if (remaining <= 0.001 && total > 0) return ReturnNoteStatus.USED;
  if (remaining < total - 0.001) return ReturnNoteStatus.PARTIALLY_USED;
  return ReturnNoteStatus.PENDING;
}

@Injectable()
export class SupplierReturnsService {
  constructor(private prisma: PrismaService) {}

  /** Validate items: qty > 0 (integer), unit cost >= 0, product must exist. */
  private async normalizeItems(tx: any, raw: any): Promise<NormalizedReturnItem[]> {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('กรุณาเลือกสินค้าที่ส่งคืนอย่างน้อย 1 รายการ');
    const out: NormalizedReturnItem[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') throw new BadRequestException('รายการสินค้าไม่ถูกต้อง');
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty <= 0) throw new BadRequestException('จำนวนสินค้าที่ส่งคืนต้องเป็นจำนวนเต็มมากกว่า 0');
      const unitCost = Number(item.unitCost ?? 0);
      if (typeof item.unitCost === 'boolean' || !isMoney(unitCost)) throw new BadRequestException('ราคาต้นทุนต่อหน่วยต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      const ref = item.productId || item.sku;
      const prod = ref
        ? await tx.product.findFirst({
            where: { OR: [...(item.productId ? [{ id: String(item.productId) }, { sku: String(item.productId) }] : []), ...(item.sku ? [{ sku: String(item.sku) }] : [])] },
          })
        : null;
      if (!prod) throw new BadRequestException(item.productName ? `ไม่พบสินค้า "${item.productName}" ในระบบ` : 'ไม่พบสินค้าที่ส่งคืนในระบบ');
      const itemType = item.itemType === 'OVERSTOCK' ? 'OVERSTOCK' : 'DEFECTIVE';
      const total = round2(qty * unitCost);
      out.push({ ...item, productId: prod.id, sku: item.sku || prod.sku, productName: item.productName || prod.name, unitName: item.unitName || prod.unit || 'ชิ้น', itemType, quantity: qty, unitCost, totalCost: total, total });
    }
    return out;
  }

  /** Overstock quantity per product id. */
  private overstockByProduct(items: any[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const i of items || []) {
      const qty = Number(i?.quantity || 0);
      if (i?.itemType === 'OVERSTOCK' && i.productId && qty > 0) map.set(i.productId, (map.get(i.productId) || 0) + qty);
    }
    return map;
  }

  /** Take returned goods out of stock (FIFO); refuses when stock is not enough (never clamps). */
  private async deductStock(tx: any, productId: string, qty: number, ref: string, userName: string, reason: string) {
    const prod = await tx.product.findFirst({ where: { OR: [{ id: productId }, { sku: productId }] } });
    if (!prod) throw new BadRequestException('ไม่พบสินค้าที่ส่งคืนในระบบ');
    const batches = await tx.stockBatch.findMany({ where: { productId: prod.id }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
    const previousStock = batches.reduce((sum: number, b: any) => sum + b.quantityRemaining, 0);
    const available = batches.reduce((sum: number, b: any) => sum + Math.max(0, b.quantityRemaining), 0);
    if (qty > available) throw new BadRequestException(`สต็อก "${prod.name}" ไม่พอส่งคืน (คงเหลือ ${available} ต้องการ ${qty})`);
    let left = qty;
    for (const batch of batches) {
      if (left <= 0) break;
      if (batch.quantityRemaining <= 0) continue;
      const take = Math.min(batch.quantityRemaining, left);
      await tx.stockBatch.update({ where: { id: batch.id }, data: { quantityRemaining: { decrement: take } } });
      left -= take;
    }
    await tx.auditLog.create({
      data: {
        action: 'STOCK_ADJUST_SUB', entity: 'Product', entityId: prod.id,
        details: {
          productId: prod.id, sku: prod.sku, productName: prod.name, unitName: prod.unit || 'ชิ้น', type: 'ADJUST_SUB',
          quantityChange: -qty, previousStock, currentStock: previousStock - qty,
          referenceType: 'SUPPLIER_RETURN', referenceNo: ref, reason, userName,
        },
      },
    });
  }

  /** Put returned goods back into stock (cancel / edit of a return). */
  private async addStock(tx: any, productId: string, qty: number, unitCost: number | undefined, ref: string, reason: string) {
    const prod = await tx.product.findFirst({ where: { OR: [{ id: productId }, { sku: productId }] }, include: { stockBatches: true } });
    if (!prod) return;
    const previousStock = prod.stockBatches.reduce((sum: number, b: any) => sum + b.quantityRemaining, 0);
    await tx.stockBatch.create({ data: { productId: prod.id, quantityReceived: qty, quantityRemaining: qty, unitCost: Number(unitCost ?? prod.costPrice ?? 0), note: reason } });
    await tx.auditLog.create({
      data: {
        action: 'STOCK_ADJUST_ADD', entity: 'Product', entityId: prod.id,
        details: {
          productId: prod.id, sku: prod.sku, productName: prod.name, unitName: prod.unit || 'ชิ้น', type: 'ADJUST_ADD',
          quantityChange: qty, previousStock, currentStock: previousStock + qty,
          referenceType: 'SUPPLIER_RETURN_CANCEL', referenceNo: ref, reason, userName: 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม',
        },
      },
    });
  }

  private unitCostOf(items: any[], productId: string): number | undefined {
    const it = (items || []).find((i: any) => i?.itemType === 'OVERSTOCK' && i.productId === productId);
    return it ? Number(it.unitCost) : undefined;
  }

  /** Credit of this note already used by active payment vouchers. */
  private usedCredit(note: any): number {
    return round2((note.voucherDebits || []).filter((vd: any) => !vd.voucher || vd.voucher.status !== 'CANCELLED').reduce((s: number, vd: any) => s + Number(vd.amountDeducted || 0), 0));
  }

  /** Whether the overstock items of this note are currently taken out of stock. */
  private stockApplied(meta: any, status: ReturnNoteStatus): boolean {
    if (typeof meta?.stockApplied === 'boolean') return meta.stockApplied;
    // legacy notes: stock was deducted on create and given back on cancel
    return meta?.deductStock !== false && status !== ReturnNoteStatus.CANCELLED;
  }

  private mapToPrismaReturnNoteStatus(rawStatus?: string): ReturnNoteStatus {
    const s = String(rawStatus || '').toUpperCase();
    if (s === 'DEDUCTED' || s === 'USED') return ReturnNoteStatus.USED;
    if (s === 'PARTIALLY_DEDUCTED' || s === 'PARTIALLY_USED') return ReturnNoteStatus.PARTIALLY_USED;
    if (s === 'CANCELLED') return ReturnNoteStatus.CANCELLED;
    return ReturnNoteStatus.PENDING;
  }

  private formatReturnNote(note: any, metaDetails: any = {}) {
    const manualDeductions: any[] = Array.isArray(metaDetails?.deductions)
      ? [...metaDetails.deductions]
      : [];
    const voucherDeductions: any[] = Array.isArray(note.voucherDebits)
      ? note.voucherDebits
          .filter((vd: any) => !vd.voucher || vd.voucher.status !== 'CANCELLED')
          .map((vd: any) => ({
            billNumber: vd.voucher?.voucherNumber || vd.voucherId,
            deductedAmount: Number(vd.amountDeducted || 0),
            deductedAt: vd.voucher?.paymentDate
              ? new Date(vd.voucher.paymentDate).toISOString()
              : note.updatedAt
                ? new Date(note.updatedAt).toISOString()
                : new Date().toISOString(),
            netPaid: Number(vd.voucher?.netPaidAmount || 0),
            note: `ประกบหักในใบสำคัญจ่าย ${vd.voucher?.voucherNumber || vd.voucherId}`,
          }))
      : [];

    const existingBills = new Set(manualDeductions.map((d: any) => d.billNumber));
    for (const vd of voucherDeductions) {
      if (!existingBills.has(vd.billNumber)) {
        manualDeductions.push(vd);
      }
    }

    return {
      ...metaDetails,
      ...note,
      id: note.id,
      returnNumber: note.returnNumber,
      noteNumber: note.returnNumber,
      returnDate: metaDetails?.returnDate || (note.createdAt ? new Date(note.createdAt).toISOString() : new Date().toISOString()),
      supplierId: note.supplierId,
      supplier: note.supplier,
      supplierName: metaDetails?.supplierName || note.supplier?.name || 'ไม่ระบุผู้จำหน่าย',
      supplierPhone: metaDetails?.supplierPhone || note.supplier?.phone || '',
      supplierContact: metaDetails?.supplierContact || note.supplier?.contactName || '',
      supplierAddress: metaDetails?.supplierAddress || note.supplier?.address || '',
      linkedPoId: metaDetails?.linkedPoId || undefined,
      linkedPoNumber: metaDetails?.linkedPoNumber || undefined,
      items: Array.isArray(metaDetails?.items) ? metaDetails.items : [],
      totalQuantity: Number(note.totalQuantity ?? metaDetails?.totalQuantity ?? 0),
      defectiveTotalCost: Number(metaDetails?.defectiveTotalCost ?? 0),
      overstockTotalCost: Number(metaDetails?.overstockTotalCost ?? 0),
      totalAmount: Number(note.totalAmount),
      totalCreditAmount: Number(metaDetails?.totalCreditAmount ?? note.totalAmount ?? 0),
      remainingCreditAmount: Number(note.remainingCreditAmount),
      status: note.status,
      frontendStatus:
        note.status === ReturnNoteStatus.PENDING
          ? 'PENDING_DEDUCTION'
          : note.status === ReturnNoteStatus.PARTIALLY_USED
            ? 'PARTIALLY_DEDUCTED'
            : note.status === ReturnNoteStatus.USED
              ? 'DEDUCTED'
              : 'CANCELLED',
      note: note.note,
      notes: metaDetails?.notes ?? note.note ?? '',
      deductions: manualDeductions,
      createdBy: metaDetails?.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม',
    };
  }

  private async upsertClaimMetaForReturn(
    tx: any,
    claimIdOrNum: string,
    updates: {
      returnDocId?: string | null;
      frontendStatus?: string;
      prismaStatus?: ClaimStatus;
      supplierId?: string;
      supplierName?: string;
      costPrice?: number;
      totalCostValue?: number;
      settledInBillNumber?: string;
    },
  ) {
    const claim = await tx.customerClaim.findFirst({
      where: { OR: [{ id: claimIdOrNum }, { claimNumber: claimIdOrNum }] },
    });
    if (!claim) return;

    if (updates.prismaStatus) {
      await tx.customerClaim.update({
        where: { id: claim.id },
        data: {
          status: updates.prismaStatus,
          ...(updates.prismaStatus === ClaimStatus.COMPLETED ? { completedDate: new Date() } : {}),
        },
      });
    }

    const existingMetaLog = await tx.auditLog.findFirst({
      where: {
        entity: 'CustomerClaim',
        entityId: claim.id,
        action: 'CLAIM_META',
      },
      orderBy: { createdAt: 'desc' },
    });

    const prevMeta = (existingMetaLog?.details as any) || {};
    const mergedMeta: any = {
      ...prevMeta,
      id: claim.claimNumber,
      claimId: claim.id,
      claimNumber: claim.claimNumber,
    };

    if (updates.returnDocId !== undefined) {
      if (updates.returnDocId === null) {
        delete mergedMeta.returnDocId;
      } else {
        mergedMeta.returnDocId = updates.returnDocId;
      }
    }
    if (updates.frontendStatus) {
      mergedMeta.status = updates.frontendStatus;
      mergedMeta.frontendStatus = updates.frontendStatus;
    }
    if (updates.supplierId !== undefined) mergedMeta.supplierId = updates.supplierId;
    if (updates.supplierName !== undefined) mergedMeta.supplierName = updates.supplierName;
    if (updates.costPrice !== undefined) mergedMeta.costPrice = updates.costPrice;
    if (updates.totalCostValue !== undefined) mergedMeta.totalCostValue = updates.totalCostValue;
    if (updates.settledInBillNumber !== undefined) mergedMeta.settledInBillNumber = updates.settledInBillNumber;
    if (updates.prismaStatus === ClaimStatus.COMPLETED) {
      mergedMeta.completedDate = new Date().toISOString();
    }

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
  }

  async getAllReturnNotes(page = 1, limit = 20, supplierId?: string, status?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (supplierId && supplierId !== 'ALL') {
      where.supplierId = supplierId;
    }
    if (status && status !== 'ALL') {
      where.status = this.mapToPrismaReturnNoteStatus(status);
    }

    const [notes, total] = await Promise.all([
      this.prisma.supplierReturnNote.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: true,
          voucherDebits: {
            include: { voucher: true },
          },
        },
      }),
      this.prisma.supplierReturnNote.count({ where }),
    ]);

    const noteIds = notes.flatMap((n) => [n.id, n.returnNumber]).filter(Boolean);
    const metaLogs = noteIds.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entity: 'SupplierReturnNote',
            entityId: { in: noteIds },
            action: 'RETURN_META',
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    const metaMap = new Map<string, any>();
    for (const log of metaLogs) {
      if (log.entityId && log.details) {
        metaMap.set(log.entityId, { ...(metaMap.get(log.entityId) || {}), ...(log.details as any) });
      }
    }

    return {
      data: notes.map((note) =>
        this.formatReturnNote(note, metaMap.get(note.id) || metaMap.get(note.returnNumber) || {}),
      ),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getReturnNoteDetails(id: string) {
    const note = await this.prisma.supplierReturnNote.findFirst({
      where: {
        OR: [{ id }, { returnNumber: id }],
      },
      include: {
        supplier: true,
        voucherDebits: {
          include: { voucher: true },
        },
      },
    });
    if (!note) throw new NotFoundException('ไม่พบใบลดหนี้นี้');

    const metaLogs = await this.prisma.auditLog.findMany({
      where: {
        entity: 'SupplierReturnNote',
        entityId: { in: [note.id, note.returnNumber] },
        action: 'RETURN_META',
      },
      orderBy: { createdAt: 'asc' },
    });

    let metaDetails: any = {};
    for (const log of metaLogs) {
      if (log.details) {
        metaDetails = { ...metaDetails, ...(log.details as any) };
      }
    }

    return this.formatReturnNote(note, metaDetails);
  }

  async createReturnNote(dto: any) {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('ข้อมูลใบส่งคืนไม่ถูกต้อง');
    return businessTransaction(this.prisma, async (tx) => {
      const supplier = dto.supplierId ? await tx.supplier.findUnique({ where: { id: String(dto.supplierId) } }) : null;
      if (!supplier) throw new BadRequestException('ไม่พบผู้จำหน่ายที่เลือก');
      const items = await this.normalizeItems(tx, dto.items);
      const sums = summarizeReturnItems(items);
      const totalAmount = resolveCreditAmount(dto.totalCreditAmount ?? dto.totalAmount, sums.itemsTotal);
      // a new note's whole credit is available; client remaining / status are not trusted
      const remainingCreditAmount = totalAmount;
      const deductStock = dto.deductStock !== false;

      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const prefix = `SRN-${yy}${mm}`;
      let seq = (await tx.supplierReturnNote.count({ where: { returnNumber: { startsWith: prefix } } })) + 1;
      const requested = dto.returnNumber || dto.noteNumber;
      let returnNumber = typeof requested === 'string' && requested.trim() ? requested.trim().slice(0, 60) : `${prefix}${String(seq).padStart(5, '0')}`;
      while (await tx.supplierReturnNote.findFirst({ where: { OR: [{ id: returnNumber }, { returnNumber }] } })) {
        seq++;
        returnNumber = `${prefix}${String(seq).padStart(5, '0')}`;
      }

      const newNote = await tx.supplierReturnNote.create({
        data: {
          id: returnNumber,
          returnNumber,
          supplierId: supplier.id,
          totalQuantity: sums.totalQuantity,
          totalAmount,
          remainingCreditAmount,
          status: ReturnNoteStatus.PENDING,
          note: dto.notes ?? dto.note ?? dto.reason ?? null,
        },
        include: { supplier: true, voucherDebits: { include: { voucher: true } } },
      });

      const userName = dto.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม';
      if (deductStock) {
        for (const [productId, qty] of this.overstockByProduct(items)) {
          await this.deductStock(tx, productId, qty, returnNumber, userName, 'ส่งคืนสินค้าปกติ (Overstock) ใบ #' + returnNumber);
        }
      }
      for (const item of items) {
        if (item.itemType === 'OVERSTOCK') continue;
        if (item.claimId) {
          for (const cid of String(item.claimId).split(',').map((x) => x.trim()).filter(Boolean)) {
            await this.upsertClaimMetaForReturn(tx, cid, {
              returnDocId: returnNumber,
              frontendStatus: 'SENT_TO_SUPPLIER',
              prismaStatus: ClaimStatus.IN_PROGRESS,
              supplierId: supplier.id,
              supplierName: dto.supplierName || supplier.name,
              costPrice: item.unitCost,
              totalCostValue: item.total,
            });
          }
        }
        const inv = await tx.claimInventory.findFirst({ where: { productId: item.productId } });
        if (inv && inv.quantity > 0) {
          await tx.claimInventory.update({ where: { id: inv.id }, data: { quantity: Math.max(0, inv.quantity - item.quantity) } });
        }
      }

      const metaDetails = {
        id: newNote.id,
        returnNumber,
        noteNumber: returnNumber,
        returnDate: dto.returnDate || newNote.createdAt.toISOString(),
        supplierId: supplier.id,
        supplierName: dto.supplierName || supplier.name || 'ไม่ระบุผู้จำหน่าย',
        supplierPhone: dto.supplierPhone || supplier.phone || '',
        supplierContact: dto.supplierContact || supplier.contactName || '',
        supplierAddress: dto.supplierAddress || supplier.address || '',
        linkedPoId: dto.linkedPoId || undefined,
        linkedPoNumber: dto.linkedPoNumber || undefined,
        items,
        totalQuantity: sums.totalQuantity,
        defectiveTotalCost: sums.defectiveTotalCost,
        overstockTotalCost: sums.overstockTotalCost,
        totalCreditAmount: totalAmount,
        remainingCreditAmount,
        deductStock,
        stockApplied: deductStock,
        deductions: [],
        notes: dto.notes ?? dto.note ?? dto.reason ?? '',
        createdBy: userName,
      };

      await tx.auditLog.create({
        data: { action: 'RETURN_META', entity: 'SupplierReturnNote', entityId: newNote.id, details: JSON.parse(JSON.stringify(metaDetails)) },
      });

      return this.formatReturnNote(newNote, metaDetails);
    });
  }

  private async loadNoteWithMeta(tx: any, id: string) {
    const note = await tx.supplierReturnNote.findFirst({
      where: { OR: [{ id }, { returnNumber: id }] },
      include: { supplier: true, voucherDebits: { include: { voucher: true } } },
    });
    if (!note) throw new NotFoundException('ไม่พบใบลดหนี้นี้');
    const metaLogs = await tx.auditLog.findMany({
      where: { entity: 'SupplierReturnNote', entityId: { in: [note.id, note.returnNumber] }, action: 'RETURN_META' },
      orderBy: { createdAt: 'asc' },
    });
    let prevMeta: any = {};
    for (const log of metaLogs) if (log.details) prevMeta = { ...prevMeta, ...(log.details as any) };
    const existingMetaLog = metaLogs.length ? metaLogs[metaLogs.length - 1] : null;
    return { note, prevMeta, existingMetaLog };
  }

  private async saveMeta(tx: any, noteId: string, existingMetaLog: any, meta: any) {
    const details = JSON.parse(JSON.stringify(meta));
    if (existingMetaLog) await tx.auditLog.update({ where: { id: existingMetaLog.id }, data: { details } });
    else await tx.auditLog.create({ data: { action: 'RETURN_META', entity: 'SupplierReturnNote', entityId: noteId, details } });
  }

  private async relinkClaims(tx: any, items: any[], note: any, supplierName?: string) {
    for (const item of items || []) {
      if (item?.itemType === 'OVERSTOCK' || !item?.claimId) continue;
      for (const cid of String(item.claimId).split(',').map((x: string) => x.trim()).filter(Boolean)) {
        await this.upsertClaimMetaForReturn(tx, cid, {
          returnDocId: note.returnNumber,
          frontendStatus: 'SENT_TO_SUPPLIER',
          prismaStatus: ClaimStatus.IN_PROGRESS,
          supplierId: note.supplierId,
          supplierName: supplierName || note.supplier?.name,
          costPrice: Number(item.unitCost || 0),
          totalCostValue: Number(item.totalCost ?? item.total ?? Number(item.unitCost || 0) * Number(item.quantity || 1)),
        });
      }
    }
  }

  private async unlinkClaims(tx: any, items: any[]) {
    for (const item of items || []) {
      if (item?.itemType === 'OVERSTOCK' || !item?.claimId) continue;
      for (const cid of String(item.claimId).split(',').map((x: string) => x.trim()).filter(Boolean)) {
        await this.upsertClaimMetaForReturn(tx, cid, { returnDocId: null, frontendStatus: 'PENDING_SUPPLIER', prismaStatus: ClaimStatus.PENDING });
      }
    }
  }

  async updateReturnNote(id: string, dto: any) {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('ข้อมูลใบส่งคืนไม่ถูกต้อง');
    return businessTransaction(this.prisma, async (tx) => {
      const { note, prevMeta, existingMetaLog } = await this.loadNoteWithMeta(tx, id);
      const targetStatus = dto.status ? this.mapToPrismaReturnNoteStatus(dto.status) : undefined;

      // cancelling goes through the same checks as POST /:id/cancel
      if (targetStatus === ReturnNoteStatus.CANCELLED && note.status !== ReturnNoteStatus.CANCELLED) {
        return this.cancelInTx(tx, note, prevMeta, existingMetaLog, dto.cancelReason || dto.reason);
      }

      const itemsGiven = dto.items !== undefined;
      const totalGiven = dto.totalCreditAmount !== undefined || dto.totalAmount !== undefined;
      const supplierChanged = dto.supplierId !== undefined && dto.supplierId !== note.supplierId;
      const used = this.usedCredit(note);
      const updateData: any = {};
      const meta: any = { ...prevMeta };

      if (note.status === ReturnNoteStatus.CANCELLED) {
        if (targetStatus && targetStatus !== ReturnNoteStatus.CANCELLED) {
          if (itemsGiven || supplierChanged) throw new BadRequestException('กรุณากู้คืนใบส่งคืนก่อน แล้วจึงแก้ไขรายการ');
          // Restore: the goods leave stock again (refused when stock is not enough), claims re-linked
          const items = Array.isArray(prevMeta.items) ? prevMeta.items : [];
          if (prevMeta.deductStock !== false && !this.stockApplied(prevMeta, note.status)) {
            for (const [productId, qty] of this.overstockByProduct(items)) {
              await this.deductStock(tx, productId, qty, note.returnNumber, 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม', `กู้คืนใบส่งคืนสินค้า #${note.returnNumber}`);
            }
            meta.stockApplied = true;
          }
          await this.relinkClaims(tx, items, note, prevMeta.supplierName);
          const total = Number(note.totalAmount);
          const remaining = round2(Math.max(0, total - used));
          updateData.remainingCreditAmount = remaining;
          updateData.status = statusForRemaining(remaining, total);
          meta.remainingCreditAmount = remaining;
          delete meta.cancelledAt;
        } else if (itemsGiven || totalGiven || supplierChanged || dto.remainingCreditAmount !== undefined) {
          throw new BadRequestException('ใบส่งคืนนี้ถูกยกเลิกแล้ว แก้ไขยอดหรือรายการไม่ได้');
        }
      } else {
        let total = Number(note.totalAmount);
        if (supplierChanged) {
          if (used > 0) throw new BadRequestException('เปลี่ยนผู้จำหน่ายไม่ได้ เพราะใบลดหนี้นี้ถูกใช้หักในใบสำคัญจ่ายแล้ว');
          const sup = await tx.supplier.findUnique({ where: { id: String(dto.supplierId) } });
          if (!sup) throw new BadRequestException('ไม่พบผู้จำหน่ายที่เลือก');
          updateData.supplierId = sup.id;
          meta.supplierId = sup.id;
        }
        if (itemsGiven || totalGiven) {
          const oldItems = Array.isArray(prevMeta.items) ? prevMeta.items : [];
          const items = await this.normalizeItems(tx, itemsGiven ? dto.items : oldItems);
          const sums = summarizeReturnItems(items);
          total = resolveCreditAmount(dto.totalCreditAmount ?? dto.totalAmount, sums.itemsTotal);
          if (total + 0.001 < used) throw new BadRequestException(`ยอดเครดิตต้องไม่น้อยกว่ายอดที่ถูกใช้หักไปแล้ว (฿${used.toFixed(2)})`);
          if (itemsGiven) {
            // stock follows the difference between the old and the new overstock quantities
            if (this.stockApplied(prevMeta, note.status)) {
              const before = this.overstockByProduct(oldItems);
              const after = this.overstockByProduct(items);
              for (const productId of new Set([...before.keys(), ...after.keys()])) {
                const delta = (after.get(productId) || 0) - (before.get(productId) || 0);
                if (delta > 0) await this.deductStock(tx, productId, delta, note.returnNumber, 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม', `แก้ไขใบส่งคืนสินค้า #${note.returnNumber}`);
                else if (delta < 0) await this.addStock(tx, productId, -delta, this.unitCostOf(oldItems, productId), note.returnNumber, `แก้ไขใบส่งคืนสินค้า #${note.returnNumber} (คืนสต็อก)`);
              }
              meta.stockApplied = true;
            }
            await this.unlinkClaims(tx, oldItems);
            await this.relinkClaims(tx, items, { ...note, supplierId: updateData.supplierId || note.supplierId }, dto.supplierName || prevMeta.supplierName);
            meta.items = items;
          }
          updateData.totalQuantity = sums.totalQuantity;
          updateData.totalAmount = total;
          meta.totalQuantity = sums.totalQuantity;
          meta.defectiveTotalCost = sums.defectiveTotalCost;
          meta.overstockTotalCost = sums.overstockTotalCost;
          meta.totalCreditAmount = total;
          const remaining = round2(Math.max(0, total - used));
          updateData.remainingCreditAmount = remaining;
          updateData.status = statusForRemaining(remaining, total);
          meta.remainingCreditAmount = remaining;
        } else if (dto.remainingCreditAmount !== undefined || targetStatus) {
          // manual status change: credit can only be written down, never above what is left
          const max = round2(Math.max(0, total - used));
          let remaining = dto.remainingCreditAmount !== undefined ? Number(dto.remainingCreditAmount) : targetStatus === ReturnNoteStatus.USED ? 0 : Number(note.remainingCreditAmount);
          if (typeof dto.remainingCreditAmount === 'boolean' || !isMoney(remaining)) throw new BadRequestException('ยอดเครดิตคงเหลือไม่ถูกต้อง');
          if (remaining > max + 0.001) throw new BadRequestException(`ยอดเครดิตคงเหลือต้องไม่เกิน ฿${max.toFixed(2)} (ยอดเครดิตหักยอดที่ใช้ไปแล้ว)`);
          remaining = round2(remaining);
          updateData.remainingCreditAmount = remaining;
          updateData.status = statusForRemaining(remaining, total);
          meta.remainingCreditAmount = remaining;
        }
      }

      if (dto.notes !== undefined || dto.note !== undefined) {
        updateData.note = dto.notes ?? dto.note;
        meta.notes = dto.notes ?? dto.note;
      }
      for (const key of ['supplierName', 'supplierContact', 'supplierPhone', 'supplierAddress', 'linkedPoId', 'linkedPoNumber', 'deductions']) {
        if (dto[key] !== undefined) meta[key] = dto[key];
      }

      const updatedNote = await tx.supplierReturnNote.update({
        where: { id: note.id },
        data: updateData,
        include: { supplier: true, voucherDebits: { include: { voucher: true } } },
      });
      await this.saveMeta(tx, note.id, existingMetaLog, meta);
      return this.formatReturnNote(updatedNote, meta);
    });
  }

  async cancelReturnNote(id: string, reason?: string) {
    return businessTransaction(this.prisma, async (tx) => {
      const { note, prevMeta, existingMetaLog } = await this.loadNoteWithMeta(tx, id);
      if (note.status === ReturnNoteStatus.CANCELLED) throw new BadRequestException('ใบส่งคืนนี้ถูกยกเลิกไปแล้ว');
      return this.cancelInTx(tx, note, prevMeta, existingMetaLog, reason);
    });
  }

  /** Cancel: blocked once the credit was used in a payment voucher; otherwise goods go back to stock. */
  private async cancelInTx(tx: any, note: any, prevMeta: any, existingMetaLog: any, reason?: string) {
    const activeUse = (note.voucherDebits || []).filter((vd: any) => vd.voucher && vd.voucher.status !== 'CANCELLED' && Number(vd.amountDeducted) > 0);
    if (activeUse.length > 0) {
      const numbers = activeUse.map((vd: any) => vd.voucher.voucherNumber).join(', ');
      throw new BadRequestException(`ยกเลิกไม่ได้ ใบลดหนี้นี้ถูกใช้หักในใบสำคัญจ่าย ${numbers} แล้ว กรุณายกเลิกใบสำคัญจ่ายก่อน`);
    }
    const items = Array.isArray(prevMeta.items) ? prevMeta.items : [];
    const meta: any = { ...prevMeta };
    if (this.stockApplied(prevMeta, note.status)) {
      for (const [productId, qty] of this.overstockByProduct(items)) {
        await this.addStock(tx, productId, qty, this.unitCostOf(items, productId), note.returnNumber, `คืนสต็อกจากยกเลิกใบส่งคืน #${note.returnNumber}`);
      }
    }
    meta.stockApplied = false;
    await this.unlinkClaims(tx, items);
    for (const item of items) {
      const qty = Number(item?.quantity || 0);
      if (item?.itemType === 'OVERSTOCK' || !item?.claimId || !item?.productId || qty <= 0) continue;
      const inv = await tx.claimInventory.findFirst({ where: { productId: item.productId } });
      if (inv) await tx.claimInventory.update({ where: { id: inv.id }, data: { quantity: { increment: qty } } });
    }

    const updatedNote = await tx.supplierReturnNote.update({
      where: { id: note.id },
      data: {
        status: ReturnNoteStatus.CANCELLED,
        remainingCreditAmount: 0,
        note: reason ? `${note.note || ''} (ยกเลิก: ${reason})` : note.note,
      },
      include: { supplier: true, voucherDebits: { include: { voucher: true } } },
    });
    meta.remainingCreditAmount = 0;
    meta.cancelledAt = new Date().toISOString();
    await this.saveMeta(tx, note.id, existingMetaLog, meta);
    return this.formatReturnNote(updatedNote, meta);
  }
}
