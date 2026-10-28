import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimStatus, ReturnNoteStatus } from '@prisma/client';

@Injectable()
export class SupplierReturnsService {
  constructor(private prisma: PrismaService) {}

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
    return businessTransaction(this.prisma, async (tx) => {
      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const prefix = `SRN-${yy}${mm}`;
      let seq =
        (await tx.supplierReturnNote.count({
          where: { returnNumber: { startsWith: prefix } },
        })) + 1;
      let returnNumber = dto.returnNumber || dto.noteNumber || `${prefix}${String(seq).padStart(5, '0')}`;
      while (
        await tx.supplierReturnNote.findFirst({
          where: { OR: [{ id: returnNumber }, { returnNumber }] },
        })
      ) {
        seq++;
        returnNumber = `${prefix}${String(seq).padStart(5, '0')}`;
      }

      const items: any[] = Array.isArray(dto.items) ? dto.items : [];
      let calcTotalQty = 0;
      let calcDefectiveCost = 0;
      let calcOverstockCost = 0;

      for (const item of items) {
        const qty = Number(item.quantity || 0);
        const unitCost = Number(item.unitCost || 0);
        const itemCost = Number(item.totalCost ?? Math.round(qty * unitCost * 100) / 100);
        calcTotalQty += qty;
        if (item.itemType === 'OVERSTOCK') {
          calcOverstockCost += itemCost;
        } else {
          calcDefectiveCost += itemCost;
        }
      }

      const totalQuantity = Number(dto.totalQuantity ?? calcTotalQty ?? 0);
      const defectiveTotalCost = Number(dto.defectiveTotalCost ?? Math.round(calcDefectiveCost * 100) / 100);
      const overstockTotalCost = Number(dto.overstockTotalCost ?? Math.round(calcOverstockCost * 100) / 100);
      const totalAmount = Number(
        dto.totalCreditAmount ?? dto.totalAmount ?? Math.round((defectiveTotalCost + overstockTotalCost) * 100) / 100,
      );
      const remainingCreditAmount = Number(dto.remainingCreditAmount ?? totalAmount);
      const prismaStatus = dto.status
        ? this.mapToPrismaReturnNoteStatus(dto.status)
        : remainingCreditAmount <= 0 && totalAmount > 0
          ? ReturnNoteStatus.USED
          : remainingCreditAmount < totalAmount
            ? ReturnNoteStatus.PARTIALLY_USED
            : ReturnNoteStatus.PENDING;

      const newNote = await tx.supplierReturnNote.create({
        data: {
          id: returnNumber,
          returnNumber,
          supplierId: dto.supplierId,
          totalQuantity,
          totalAmount,
          remainingCreditAmount,
          status: prismaStatus,
          note: dto.notes ?? dto.note ?? dto.reason ?? null,
        },
        include: {
          supplier: true,
          voucherDebits: {
            include: { voucher: true },
          },
        },
      });

      // Process item stock and claim links
      for (const item of items) {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;

        if (item.itemType === 'OVERSTOCK' && dto.deductStock !== false) {
          const prod = await tx.product.findFirst({
            where: {
              OR: [
                ...(item.productId ? [{ id: item.productId }, { sku: item.productId }] : []),
                ...(item.sku ? [{ sku: item.sku }] : []),
              ],
            },
          });

          if (prod) {
            const batches = await tx.stockBatch.findMany({
              where: { productId: prod.id },
              orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
            });
            const previousStock = batches.reduce((sum, b) => sum + b.quantityRemaining, 0);

            let remainingToDeduct = qty;
            for (const batch of batches) {
              if (remainingToDeduct <= 0) break;
              if (batch.quantityRemaining <= 0) continue;
              const deduct = Math.min(batch.quantityRemaining, remainingToDeduct);
              await tx.stockBatch.update({
                where: { id: batch.id },
                data: { quantityRemaining: { decrement: deduct } },
              });
              remainingToDeduct -= deduct;
            }

            await tx.auditLog.create({
              data: {
                action: 'STOCK_ADJUST_SUB',
                entity: 'Product',
                entityId: prod.id,
                details: {
                  productId: prod.id,
                  sku: prod.sku,
                  productName: prod.name,
                  unitName: item.unitName || prod.unit || 'ชิ้น',
                  type: 'ADJUST_SUB',
                  quantityChange: -qty,
                  previousStock,
                  currentStock: Math.max(0, previousStock - qty),
                  referenceType: 'SUPPLIER_RETURN',
                  referenceNo: returnNumber,
                  reason: 'ส่งคืนสินค้าปกติ (Overstock) ใบ #' + returnNumber,
                  userName: dto.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม',
                },
              },
            });
          }
        } else {
          // Defective / Claim item
          if (item.claimId) {
            const claimIds = String(item.claimId)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            for (const cid of claimIds) {
              await this.upsertClaimMetaForReturn(tx, cid, {
                returnDocId: returnNumber,
                frontendStatus: 'SENT_TO_SUPPLIER',
                prismaStatus: ClaimStatus.IN_PROGRESS,
                supplierId: dto.supplierId,
                supplierName: dto.supplierName || newNote.supplier?.name,
                costPrice: Number(item.unitCost || 0),
                totalCostValue: Number(item.totalCost ?? Math.round(Number(item.unitCost || 0) * qty * 100) / 100),
              });
            }
          }

          if (item.productId) {
            const inv = await tx.claimInventory.findFirst({
              where: { productId: item.productId },
            });
            if (inv && inv.quantity > 0) {
              await tx.claimInventory.update({
                where: { id: inv.id },
                data: { quantity: Math.max(0, inv.quantity - qty) },
              });
            }
          }
        }
      }

      const metaDetails = {
        id: newNote.id,
        returnNumber,
        noteNumber: returnNumber,
        returnDate: dto.returnDate || newNote.createdAt.toISOString(),
        supplierId: dto.supplierId,
        supplierName: dto.supplierName || newNote.supplier?.name || 'ไม่ระบุผู้จำหน่าย',
        supplierPhone: dto.supplierPhone || newNote.supplier?.phone || '',
        supplierContact: dto.supplierContact || newNote.supplier?.contactName || '',
        supplierAddress: dto.supplierAddress || newNote.supplier?.address || '',
        linkedPoId: dto.linkedPoId || undefined,
        linkedPoNumber: dto.linkedPoNumber || undefined,
        items,
        totalQuantity,
        defectiveTotalCost,
        overstockTotalCost,
        totalCreditAmount: totalAmount,
        remainingCreditAmount,
        deductions: Array.isArray(dto.deductions) ? dto.deductions : [],
        notes: dto.notes ?? dto.note ?? dto.reason ?? '',
        createdBy: dto.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม',
      };

      await tx.auditLog.create({
        data: {
          action: 'RETURN_META',
          entity: 'SupplierReturnNote',
          entityId: newNote.id,
          details: JSON.parse(JSON.stringify(metaDetails)),
        },
      });

      return this.formatReturnNote(newNote, metaDetails);
    });
  }

  async updateReturnNote(id: string, dto: any) {
    return businessTransaction(this.prisma, async (tx) => {
      const note = await tx.supplierReturnNote.findFirst({
        where: { OR: [{ id }, { returnNumber: id }] },
        include: {
          supplier: true,
          voucherDebits: { include: { voucher: true } },
        },
      });
      if (!note) throw new NotFoundException('ไม่พบใบลดหนี้นี้');

      const existingMetaLog = await tx.auditLog.findFirst({
        where: {
          entity: 'SupplierReturnNote',
          entityId: { in: [note.id, note.returnNumber] },
          action: 'RETURN_META',
        },
        orderBy: { createdAt: 'desc' },
      });
      const prevMeta = (existingMetaLog?.details as any) || {};

      // If items are being replaced, unlink old defective claims first
      if (Array.isArray(dto.items) && Array.isArray(prevMeta.items)) {
        for (const oldItem of prevMeta.items) {
          if (oldItem.claimId) {
            const oldClaimIds = String(oldItem.claimId)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            for (const cid of oldClaimIds) {
              await this.upsertClaimMetaForReturn(tx, cid, {
                returnDocId: null,
                frontendStatus: 'PENDING_SUPPLIER',
                prismaStatus: ClaimStatus.PENDING,
              });
            }
          }
        }
      }

      const nextItems = Array.isArray(dto.items) ? dto.items : (prevMeta.items || []);

      // If items were passed or note is restored from CANCELLED to PENDING_DEDUCTION, link defective claims
      const isRestoringFromCancelled =
        note.status === ReturnNoteStatus.CANCELLED &&
        dto.status &&
        this.mapToPrismaReturnNoteStatus(dto.status) !== ReturnNoteStatus.CANCELLED;

      if (Array.isArray(dto.items) || isRestoringFromCancelled) {
        for (const item of nextItems) {
          if (item.claimId) {
            const claimIds = String(item.claimId)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            for (const cid of claimIds) {
              await this.upsertClaimMetaForReturn(tx, cid, {
                returnDocId: note.returnNumber,
                frontendStatus: 'SENT_TO_SUPPLIER',
                prismaStatus: ClaimStatus.IN_PROGRESS,
                supplierId: dto.supplierId || note.supplierId,
                supplierName: dto.supplierName || prevMeta.supplierName || note.supplier?.name,
                costPrice: Number(item.unitCost || 0),
                totalCostValue: Number(item.totalCost ?? Number(item.unitCost || 0) * Number(item.quantity || 1)),
              });
            }
          }
        }
      }

      const updateData: any = {};
      if (dto.supplierId) updateData.supplierId = dto.supplierId;
      if (dto.totalQuantity !== undefined) updateData.totalQuantity = Number(dto.totalQuantity);
      if (dto.totalCreditAmount !== undefined || dto.totalAmount !== undefined) {
        updateData.totalAmount = Number(dto.totalCreditAmount ?? dto.totalAmount);
      }
      if (dto.remainingCreditAmount !== undefined) {
        updateData.remainingCreditAmount = Number(dto.remainingCreditAmount);
      }
      if (dto.status) {
        updateData.status = this.mapToPrismaReturnNoteStatus(dto.status);
      }
      if (dto.notes !== undefined || dto.note !== undefined) {
        updateData.note = dto.notes ?? dto.note;
      }

      const updatedNote = await tx.supplierReturnNote.update({
        where: { id: note.id },
        data: updateData,
        include: {
          supplier: true,
          voucherDebits: { include: { voucher: true } },
        },
      });

      const mergedMeta = {
        ...prevMeta,
        ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName } : {}),
        ...(dto.supplierContact !== undefined ? { supplierContact: dto.supplierContact } : {}),
        ...(dto.supplierPhone !== undefined ? { supplierPhone: dto.supplierPhone } : {}),
        ...(dto.supplierAddress !== undefined ? { supplierAddress: dto.supplierAddress } : {}),
        ...(dto.linkedPoId !== undefined ? { linkedPoId: dto.linkedPoId } : {}),
        ...(dto.linkedPoNumber !== undefined ? { linkedPoNumber: dto.linkedPoNumber } : {}),
        ...(dto.items !== undefined ? { items: dto.items } : {}),
        ...(dto.totalQuantity !== undefined ? { totalQuantity: Number(dto.totalQuantity) } : {}),
        ...(dto.defectiveTotalCost !== undefined ? { defectiveTotalCost: Number(dto.defectiveTotalCost) } : {}),
        ...(dto.overstockTotalCost !== undefined ? { overstockTotalCost: Number(dto.overstockTotalCost) } : {}),
        ...(dto.totalCreditAmount !== undefined ? { totalCreditAmount: Number(dto.totalCreditAmount) } : {}),
        ...(dto.remainingCreditAmount !== undefined ? { remainingCreditAmount: Number(dto.remainingCreditAmount) } : {}),
        ...(dto.deductions !== undefined ? { deductions: dto.deductions } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      };

      if (existingMetaLog) {
        await tx.auditLog.update({
          where: { id: existingMetaLog.id },
          data: { details: JSON.parse(JSON.stringify(mergedMeta)) },
        });
      } else {
        await tx.auditLog.create({
          data: {
            action: 'RETURN_META',
            entity: 'SupplierReturnNote',
            entityId: note.id,
            details: JSON.parse(JSON.stringify(mergedMeta)),
          },
        });
      }

      return this.formatReturnNote(updatedNote, mergedMeta);
    });
  }

  async deductCredit(id: string, dto: { billNumber: string; amountToDeduct: number; billTotal?: number; note?: string }) {
    return businessTransaction(this.prisma, async (tx) => {
      const note = await tx.supplierReturnNote.findFirst({
        where: { OR: [{ id }, { returnNumber: id }] },
        include: {
          supplier: true,
          voucherDebits: { include: { voucher: true } },
        },
      });
      if (!note) throw new NotFoundException('ไม่พบใบลดหนี้นี้');

      const requested = Number(dto.amountToDeduct || 0);
      if (requested <= 0) throw new BadRequestException('จำนวนเงินที่หักต้องมากกว่า 0');

      const currentRemaining = Number(note.remainingCreditAmount || 0);
      const billTotal = dto.billTotal !== undefined ? Number(dto.billTotal) : Infinity;
      const actualDeduct = Math.min(requested, currentRemaining, billTotal);
      const nextRemaining = Math.max(0, Math.round((currentRemaining - actualDeduct) * 100) / 100);
      const nextStatus = nextRemaining <= 0 ? ReturnNoteStatus.USED : ReturnNoteStatus.PARTIALLY_USED;

      const updatedNote = await tx.supplierReturnNote.update({
        where: { id: note.id },
        data: {
          remainingCreditAmount: nextRemaining,
          status: nextStatus,
        },
        include: {
          supplier: true,
          voucherDebits: { include: { voucher: true } },
        },
      });

      const existingMetaLog = await tx.auditLog.findFirst({
        where: {
          entity: 'SupplierReturnNote',
          entityId: { in: [note.id, note.returnNumber] },
          action: 'RETURN_META',
        },
        orderBy: { createdAt: 'desc' },
      });
      const prevMeta = (existingMetaLog?.details as any) || {};
      const deductionEntry = {
        billNumber: dto.billNumber || '-',
        deductedAmount: actualDeduct,
        deductedAt: new Date().toISOString(),
        netPaid: Number.isFinite(billTotal) ? Math.max(0, billTotal - actualDeduct) : 0,
        note: dto.note,
      };
      const mergedMeta = {
        ...prevMeta,
        remainingCreditAmount: nextRemaining,
        deductions: [...(Array.isArray(prevMeta.deductions) ? prevMeta.deductions : []), deductionEntry],
      };

      if (existingMetaLog) {
        await tx.auditLog.update({
          where: { id: existingMetaLog.id },
          data: { details: JSON.parse(JSON.stringify(mergedMeta)) },
        });
      } else {
        await tx.auditLog.create({
          data: {
            action: 'RETURN_META',
            entity: 'SupplierReturnNote',
            entityId: note.id,
            details: JSON.parse(JSON.stringify(mergedMeta)),
          },
        });
      }

      // Update linked claims if fully deducted
      if (Array.isArray(mergedMeta.items)) {
        for (const item of mergedMeta.items) {
          if (item.claimId) {
            const claimIds = String(item.claimId)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            for (const cid of claimIds) {
              await this.upsertClaimMetaForReturn(tx, cid, {
                settledInBillNumber: dto.billNumber,
                ...(nextStatus === ReturnNoteStatus.USED
                  ? { frontendStatus: 'COMPLETED', prismaStatus: ClaimStatus.COMPLETED }
                  : {}),
              });
            }
          }
        }
      }

      return this.formatReturnNote(updatedNote, mergedMeta);
    });
  }

  async cancelReturnNote(id: string, reason?: string) {
    return businessTransaction(this.prisma, async (tx) => {
      const note = await tx.supplierReturnNote.findFirst({
        where: { OR: [{ id }, { returnNumber: id }] },
        include: {
          supplier: true,
          voucherDebits: { include: { voucher: true } },
        },
      });
      if (!note) throw new NotFoundException('ไม่พบใบลดหนี้นี้');

      const existingMetaLog = await tx.auditLog.findFirst({
        where: {
          entity: 'SupplierReturnNote',
          entityId: { in: [note.id, note.returnNumber] },
          action: 'RETURN_META',
        },
        orderBy: { createdAt: 'desc' },
      });
      const prevMeta = (existingMetaLog?.details as any) || {};

      if (note.status !== ReturnNoteStatus.CANCELLED && Array.isArray(prevMeta.items)) {
        for (const item of prevMeta.items) {
          const qty = Number(item.quantity || 0);
          if (item.itemType === 'OVERSTOCK' && qty > 0) {
            const prod = await tx.product.findFirst({
              where: {
                OR: [
                  ...(item.productId ? [{ id: item.productId }, { sku: item.productId }] : []),
                  ...(item.sku ? [{ sku: item.sku }] : []),
                ],
              },
              include: { stockBatches: true },
            });
            if (prod) {
              const previousStock = prod.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0);
              await tx.stockBatch.create({
                data: {
                  productId: prod.id,
                  quantityReceived: qty,
                  quantityRemaining: qty,
                  unitCost: Number(item.unitCost ?? prod.costPrice ?? 0),
                  note: `คืนสต็อกจากยกเลิกใบส่งคืน #${note.returnNumber}`,
                },
              });
              await tx.auditLog.create({
                data: {
                  action: 'STOCK_ADJUST_ADD',
                  entity: 'Product',
                  entityId: prod.id,
                  details: {
                    productId: prod.id,
                    sku: prod.sku,
                    productName: prod.name,
                    unitName: item.unitName || prod.unit || 'ชิ้น',
                    type: 'ADJUST_ADD',
                    quantityChange: qty,
                    previousStock,
                    currentStock: previousStock + qty,
                    referenceType: 'SUPPLIER_RETURN_CANCEL',
                    referenceNo: note.returnNumber,
                    reason: `ยกเลิกใบส่งคืนสินค้า #${note.returnNumber}`,
                    userName: 'เจ้าหน้าที่ฝ่ายส่งคืน/เคลม',
                  },
                },
              });
            }
          } else if (item.claimId) {
            const claimIds = String(item.claimId)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            for (const cid of claimIds) {
              await this.upsertClaimMetaForReturn(tx, cid, {
                returnDocId: null,
                frontendStatus: 'PENDING_SUPPLIER',
                prismaStatus: ClaimStatus.PENDING,
              });
            }
            if (item.productId && qty > 0) {
              const inv = await tx.claimInventory.findFirst({
                where: { productId: item.productId },
              });
              if (inv) {
                await tx.claimInventory.update({
                  where: { id: inv.id },
                  data: { quantity: { increment: qty } },
                });
              }
            }
          }
        }
      }

      const updatedNote = await tx.supplierReturnNote.update({
        where: { id: note.id },
        data: {
          status: ReturnNoteStatus.CANCELLED,
          remainingCreditAmount: 0,
          note: reason ? `${note.note || ''} (ยกเลิก: ${reason})` : note.note,
        },
        include: {
          supplier: true,
          voucherDebits: { include: { voucher: true } },
        },
      });

      const mergedMeta = {
        ...prevMeta,
        remainingCreditAmount: 0,
        cancelledAt: new Date().toISOString(),
      };

      if (existingMetaLog) {
        await tx.auditLog.update({
          where: { id: existingMetaLog.id },
          data: { details: JSON.parse(JSON.stringify(mergedMeta)) },
        });
      }

      return this.formatReturnNote(updatedNote, mergedMeta);
    });
  }
}
