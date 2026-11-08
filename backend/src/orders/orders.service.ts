import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderStatus, PaymentMethod, DebtStatus, ShiftStatus, CashMovementType } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApprovalsService, ApprovalReason } from '../approvals/approvals.service';
import * as ledger from '../finance/ledger';
import { validateCheckoutInput, lineAmounts, checkPointsDiscount, claimableBaseQty, paidPerBaseUnit, round2 } from './checkout-guards';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
    private approvals?: ApprovalsService,
  ) {}

  async checkout(data: any, userId: string) {
    validateCheckoutInput(data);
    if (data.orderNumber) {
      const taken = await this.prisma.order.findUnique({ where: { orderNumber: data.orderNumber }, select: { clientOrderId: true } });
      if (taken && taken.clientOrderId !== data.clientOrderId) throw new ConflictException('เลขที่บิลนี้ถูกใช้แล้ว');
    }
    try {
      return await this.checkoutTx(data, userId);
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const target = JSON.stringify(e.meta?.target ?? '');
        if (target.includes('order_number') || target.includes('orderNumber')) throw new ConflictException('เลขที่บิลนี้ถูกใช้แล้ว');
        if (target.includes('client_order_id') || target.includes('clientOrderId')) throw new ConflictException('บิลนี้กำลังถูกบันทึกอยู่ กรุณาลองใหม่');
        throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
      }
      throw e;
    }
  }

  private async checkoutTx(data: any, userId: string) {
    return businessTransaction(this.prisma, async (tx) => {
      // 1. Idempotency check for offline sync (clientOrderId)
      if (data.clientOrderId) {
        const existing = await tx.order.findUnique({
          where: { clientOrderId: data.clientOrderId },
          include: { items: { include: { product: true } }, payments: true, customer: true, user: true },
        });
        if (existing) {
          // Already synced! Return existing order directly to avoid duplicate processing.
          if (existing.userId !== userId) throw new BadRequestException('รหัสธุรกรรมเป็นของผู้ขายอื่น');
          return existing;
        }
      }

      if (!data.clientOrderId || typeof data.clientOrderId !== 'string' || data.clientOrderId.length > 100) {
        throw new BadRequestException('ต้องระบุรหัสธุรกรรมสำหรับป้องกันบิลซ้ำ');
      }
      if (!Array.isArray(data.items) || data.items.length === 0) throw new BadRequestException('บิลต้องมีสินค้า');
      if (!Array.isArray(data.payments) || !data.payments.length) throw new BadRequestException('ต้องระบุการชำระเงิน');
      if (data.payments.some((p: any) => !Object.values(PaymentMethod).includes(p.method) || !Number.isFinite(Number(p.amount)) || Number(p.amount) < 0)) {
        throw new BadRequestException('วิธีชำระเงินหรือจำนวนเงินไม่ถูกต้อง');
      }
      if (data.payments.some((p: any) => p.method === PaymentMethod.CREDIT_DEBT && !(Number(p.amount) > 0))) {
        throw new BadRequestException('ยอดขายเชื่อต้องมากกว่า 0 บาท');
      }
      if (data.createdAt && (!Number.isFinite(Date.parse(data.createdAt)) || Date.parse(data.createdAt) > Date.now() + 300000)) {
        throw new BadRequestException('วันเวลาขายไม่ถูกต้อง');
      }
      // 2. Generate or use Order Number (Format: ORD-YYMMxxxxx e.g. ORD-260900001)
      let orderNumber = data.orderNumber;
      if (!orderNumber) {
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const prefix = `ORD-${yy}${mm}`;
        const last = await tx.order.findFirst({ where: { orderNumber: { startsWith: prefix } }, orderBy: { orderNumber: 'desc' } });
        const next = (Number(last?.orderNumber.slice(prefix.length)) || 0) + 1;
        orderNumber = prefix + String(next).padStart(5, '0');
      }

      let totalCogs = 0;
      const orderItems: any[] = [];
      let subtotal = 0;

      const cashierUser = userId
        ? await tx.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true, role: true, permissions: true } })
        : null;
      const userPerms: string[] = Array.isArray(cashierUser?.permissions) ? (cashierUser!.permissions as any[]).map(String) : [];
      const canOverridePrice = cashierUser?.role === 'ADMIN' || cashierUser?.role === 'MANAGER' || userPerms.includes('ALL') || userPerms.includes('POS_DISCOUNT');
      // Manager-approval rules (discount limit / below price floor / below cost); ADMIN & MANAGER are exempt
      const rules = this.approvals ? await this.approvals.getRules(tx) : null;
      const approvalExempt = !rules || cashierUser?.role === 'ADMIN' || cashierUser?.role === 'MANAGER';
      const approvalReasons: ApprovalReason[] = [];
      const approvalLines: { name: string; qty: number; unitPrice: number; lineDiscount: number; costPerBase: number; netPerBase: number; productId: string; factor: number; claimQty: number; verifiedClaimQty: number }[] = [];
      // Total base quantity per product in this bill (wholesale steps apply on the bill total)
      const billBaseQty = new Map<string, number>();
      for (const it of data.items) {
        const f = Number(it.conversionFactor) > 0 ? Number(it.conversionFactor) : 1;
        billBaseQty.set(it.productId, (billBaseQty.get(it.productId) || 0) + Number(it.quantity || 0) * f);
      }
      const cashierName = cashierUser?.fullName || cashierUser?.username || data.cashierName || 'พนักงานขาย';

      // 3. Deduct FIFO Inventory
      for (const item of data.items) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) {
          throw new BadRequestException('จำนวนสินค้าหรือราคาไม่ถูกต้อง');
        }
        // Check if product is a bundle
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          include: {
            packagingUnits: { orderBy: { sortOrder: 'asc' } },
            wholesalePrices: true,
            bundleItems: {
              include: {
                childProduct: true,
              },
            },
          },
        });

        if (!product || !product.isActive) throw new BadRequestException('ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน');
        let factor = 1;
        let unitName = product.unit;
        if (item.conversionFactor && item.conversionFactor !== 1) {
          let cumulative = 1;
          const unit = product.packagingUnits.find(u => {
            cumulative *= u.qtyPerPrev;
            if (u.id === item.unitId || u.name === item.unitName) { factor = cumulative; return true; }
            return false;
          });
          if (!unit || factor !== item.conversionFactor) throw new BadRequestException('หน่วยสินค้าเปลี่ยนแล้ว กรุณาตรวจสอบบิล');
          unitName = unit.name;
        }
        const baseQuantity = item.quantity * factor;
        // Price guard: the selling price may not go below the lowest price configured in the
        // system (price levels, unit prices, wholesale steps) unless the user may give discounts.
        if (!canOverridePrice) {
          const minAllowed = this.lowestAllowedUnitPrice(product, factor, item.unitId, item.unitName, billBaseQty.get(item.productId) || baseQuantity);
          if (minAllowed !== null && Number(item.unitPrice) + 0.01 < minAllowed) {
            const message = `ราคาขาย "${product.name}" ฿${Number(item.unitPrice).toFixed(2)} ต่ำกว่าราคาในระบบ (ขั้นต่ำ ฿${minAllowed.toFixed(2)})`;
            if (!rules) throw new BadRequestException(message + ' ต้องใช้สิทธิ์ให้ส่วนลด');
            if (rules.belowPriceFloorNeedsApproval) approvalReasons.push({ code: 'BELOW_PRICE_FLOOR', message });
          }
        }
        const lineDiscount = Number(item.discountAmount || 0);
        if (!Number.isFinite(lineDiscount) || lineDiscount < 0 || lineDiscount > item.quantity * Number(item.unitPrice)) throw new BadRequestException('ส่วนลดสินค้าไม่ถูกต้อง');
        let itemCogs = 0;
        let bundleSnapshot: any = null;

        if (product?.isBundle && product.bundleItems && product.bundleItems.length > 0) {
          // Bundle product: deduct each component item individually!
          bundleSnapshot = [];
          for (const bi of product.bundleItems) {
            const childDeductQty = bi.quantity * baseQuantity;
            const prevStockAgg = await tx.stockBatch.aggregate({
              where: { productId: bi.childProductId },
              _sum: { quantityRemaining: true },
            });
            const previousStock = Number(prevStockAgg._sum.quantityRemaining || 0);
            const currentStock = previousStock - childDeductQty;

            const childFifo = await this.inventory.deductFIFO(bi.childProductId, childDeductQty, tx);
            itemCogs += childFifo.totalCost;
            bundleSnapshot.push({
              productId: bi.childProductId,
              productName: bi.childProduct.name,
              sku: bi.childProduct.sku,
              quantityPerBundle: bi.quantity,
              totalQuantity: childDeductQty,
              unitPrice: Number(bi.childProduct.basePrice || bi.childProduct.priceLevel1 || 0),
              unitCost: childDeductQty > 0 ? childFifo.totalCost / childDeductQty : 0,
            });

            await tx.auditLog.create({
              data: {
                userId: userId || null,
                action: 'STOCK_OUT_POS',
                entity: 'Product',
                entityId: bi.childProductId,
                details: {
                  productId: bi.childProductId,
                  sku: bi.childProduct.sku || '-',
                  productName: bi.childProduct.name || 'สินค้า',
                  unitName: bi.childProduct.unit || 'ชิ้น',
                  type: 'OUT_POS',
                  quantityChange: -childDeductQty,
                  previousStock,
                  currentStock,
                  referenceType: 'POS',
                  referenceNo: orderNumber,
                  reason: 'ขายหน้าร้าน (บิล #' + orderNumber + ')',
                  userName: cashierName,
                },
              },
            });
          }
        } else {
          // Standard single product
          const prevStockAgg = await tx.stockBatch.aggregate({
            where: { productId: item.productId },
            _sum: { quantityRemaining: true },
          });
          const previousStock = Number(prevStockAgg._sum.quantityRemaining || 0);
          const currentStock = previousStock - baseQuantity;

          const fifoResult = await this.inventory.deductFIFO(item.productId, baseQuantity, tx);
          itemCogs = fifoResult.totalCost;

          await tx.auditLog.create({
            data: {
              userId: userId || null,
              action: 'STOCK_OUT_POS',
              entity: 'Product',
              entityId: product.id,
              details: {
                productId: product.id,
                sku: product.sku || '-',
                productName: product.name || 'สินค้า',
                unitName: product.unit || unitName || 'ชิ้น',
                type: 'OUT_POS',
                quantityChange: -baseQuantity,
                previousStock,
                currentStock,
                referenceType: 'POS',
                referenceNo: orderNumber,
                reason: 'ขายหน้าร้าน (บิล #' + orderNumber + ')',
                userName: cashierName,
              },
            },
          });
        }

        const { storedUnitPrice, total: itemTotal, storedDiscount } = lineAmounts(item.quantity, Number(item.unitPrice), lineDiscount);
        subtotal += itemTotal;
        totalCogs += itemCogs;

        const unitCost = baseQuantity > 0 ? itemCogs / baseQuantity : 0;
        // claim replacement (free units): the quantity is only trusted after it is checked against
        // the customer's claimable purchases below; otherwise the line is an ordinary discount.
        const price = Number(item.unitPrice);
        const claimQty = !item.isClaimReplacement || !(price > 0)
          ? 0
          : Number.isSafeInteger(item.claimQuantity) && item.claimQuantity > 0
            ? Math.min(item.claimQuantity, item.quantity)
            : Math.min(item.quantity, Math.floor(lineDiscount / price + 1e-9));
        approvalLines.push({
          name: product.name, qty: item.quantity, unitPrice: price, lineDiscount,
          costPerBase: unitCost, netPerBase: baseQuantity > 0 ? (item.quantity * price - lineDiscount) / baseQuantity : 0,
          productId: product.id, factor, claimQty, verifiedClaimQty: 0,
        });

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          baseQuantity,
          unitName,
          discountAmount: storedDiscount,
          unitPrice: storedUnitPrice,
          unitCost: unitCost,
          total: itemTotal,
          bundleData: bundleSnapshot,
        });
      }

      subtotal = round2(subtotal);
      if (subtotal > 1_000_000_000) throw new BadRequestException('ยอดบิลสูงเกินกว่าที่ระบบรองรับ');
      const discountAmount = round2(Number(data.discountAmount) || 0);
      if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) throw new BadRequestException('ส่วนลดบิลไม่ถูกต้อง');
      const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;
      const paid = data.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      if (Math.abs(paid - totalAmount) > 0.01 || (data.totalAmount != null && Math.abs(Number(data.totalAmount) - totalAmount) > 0.01)) throw new BadRequestException('ยอดชำระไม่ตรงกับยอดบิล');
      const creditAmount = data.payments.filter((p: any) => p.method === PaymentMethod.CREDIT_DEBT).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      if (creditAmount && !data.customerId) throw new BadRequestException('ขายเชื่อต้องระบุลูกค้า');
      const pointsUsed = Number(data.pointsUsed || 0);
      if (!Number.isSafeInteger(pointsUsed) || pointsUsed < 0) throw new BadRequestException('จำนวนแต้มไม่ถูกต้อง');
      const customer = data.customerId ? await tx.customer.findUnique({ where: { id: data.customerId } }) : null;
      if (data.customerId && !customer) throw new BadRequestException('ไม่พบลูกค้า');
      if (pointsUsed > (customer?.points || 0)) throw new BadRequestException('แต้มคงเหลือไม่เพียงพอ');
      const settings = await tx.storeSettings.findFirst();
      const config: any = settings?.loyaltyConfig || {};
      const profile: any = customer?.profile || {};
      const rate = Number(profile.pointEarnRateBaht || config.defaultPointEarnRateBaht || 500);
      const units = Number(profile.pointEarnUnits || config.defaultPointEarnUnits || 10);
      const redeemRate = Number(profile.pointRedeemRatePoints || config.defaultPointRedeemRatePoints || 100);
      const redeemBaht = Number(profile.pointRedeemDiscountBaht || config.defaultPointRedeemDiscountBaht || 1);
      const pointsDiscount = round2(Number(data.pointsDiscountAmount || 0));
      if (config.isLoyaltyEnabled === false && pointsUsed > 0) throw new BadRequestException('ร้านปิดระบบแต้มสะสม ใช้แต้มไม่ได้');
      if (pointsUsed > 0 && !customer) throw new BadRequestException('ใช้แต้มต้องระบุลูกค้า');
      checkPointsDiscount(pointsUsed, pointsDiscount, redeemRate, redeemBaht, totalAmount <= 0.01);
      if (pointsDiscount > discountAmount + 0.01) throw new BadRequestException('ส่วนลดคะแนนเกินส่วนลดบิล');

      // Claims: free replacement units and claim value used as a discount count only when backed by
      // the customer's real purchases (not yet returned / claimed) or an open claim record.
      let verifiedClaimCogs = 0;
      const requestedClaimDiscount = round2(Number(data.claimDiscountAmount || 0));
      let verifiedClaimDiscount = 0;
      const usedClaimIds: string[] = [];
      if (customer) {
        const quota = new Map<string, number>();
        const quotaOf = async (productId: string) => {
          if (!quota.has(productId)) quota.set(productId, await claimableBaseQty(tx, customer.id, productId));
          return quota.get(productId)!;
        };
        for (const l of approvalLines) {
          if (!l.claimQty) continue;
          const need = l.claimQty * l.factor;
          const left = await quotaOf(l.productId);
          if (need > left) continue; // not backed by a purchase: stays an ordinary discount (approval rules apply)
          quota.set(l.productId, left - need);
          l.verifiedClaimQty = l.claimQty;
          verifiedClaimCogs += need * l.costPerBase;
        }
        if (requestedClaimDiscount > 0) {
          let allowance = 0;
          const refs = data.claimRefs && typeof data.claimRefs === 'object' ? data.claimRefs : {};
          if (typeof refs.claimId === 'string' && refs.claimId) {
            const claim = await tx.customerClaim.findFirst({ where: { OR: [{ id: refs.claimId }, { claimNumber: refs.claimId }] } });
            if (claim && claim.status === 'PENDING' && claim.resolutionType === 'STORE_DISCOUNT' && (!claim.customerId || claim.customerId === customer.id)
              && !(await tx.auditLog.findFirst({ where: { action: 'CLAIM_DISCOUNT_USED', entityId: claim.id } }))) {
              // the claim's face value, capped by what the customer actually paid for those units
              const face = Number(claim.totalClaimValue ?? Number(claim.unitPrice || 0) * claim.quantity) || 0;
              allowance += Math.min(face, claim.baseQuantity * (await paidPerBaseUnit(tx, customer.id, claim.productId)));
              usedClaimIds.push(claim.id);
            }
          }
          for (const p of Array.isArray(refs.pending) ? refs.pending.slice(0, 50) : []) {
            const qty = Number(p?.quantity);
            if (typeof p?.productId !== 'string' || !Number.isSafeInteger(qty) || qty <= 0) continue;
            const left = await quotaOf(p.productId);
            if (qty > left) continue;
            quota.set(p.productId, left - qty);
            allowance += qty * (await paidPerBaseUnit(tx, customer.id, p.productId));
          }
          verifiedClaimDiscount = Math.min(requestedClaimDiscount, round2(allowance));
        }
      }
      const pointsEarned = customer && config.isLoyaltyEnabled !== false ? Math.floor(totalAmount / rate) * units : 0;
      if (customer) await tx.customer.update({ where: { id: customer.id }, data: { points: { increment: pointsEarned - pointsUsed } } });
      if (creditAmount > 0 && profile.isCreditBlocked) throw new BadRequestException('ลูกค้าถูกระงับเครดิต');
      if (creditAmount > 0 && Number(profile.creditLimit) > 0) {
        const debts = await tx.customerDebt.aggregate({ where: { customerId: data.customerId }, _sum: { remainingAmount: true } });
        if (Number(debts._sum.remainingAmount || 0) + creditAmount > Number(profile.creditLimit)) throw new BadRequestException('ยอดขายเกินวงเงินเครดิต');
      }

      const shiftId = data.shiftId;
      if (!shiftId) throw new BadRequestException('ต้องระบุกะของเครื่องขาย');
      const shift = await tx.shift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.userId !== userId) throw new BadRequestException('กะไม่ถูกต้องหรือเป็นของผู้ขายอื่น');
      if (shift.status !== ShiftStatus.OPEN) throw new BadRequestException('กะปิดแล้ว ต้องตรวจสอบบิลค้างก่อนบันทึก');

      // Approval check: discount above the role's limit, prices below floor or below cost
      if (rules && !approvalExempt) {
        // verified claim units are free by design: judge only the chargeable part of each line
        const sale = approvalLines
          .map((l) => {
            if (!l.verifiedClaimQty) return l;
            const qty = l.qty - l.verifiedClaimQty;
            const lineDiscount = Math.max(0, l.lineDiscount - l.verifiedClaimQty * l.unitPrice);
            return { ...l, qty, lineDiscount, netPerBase: qty > 0 ? (qty * l.unitPrice - lineDiscount) / (qty * l.factor) : 0 };
          })
          .filter((l) => l.qty > 0);
        if (rules.belowCostNeedsApproval) {
          for (const l of sale) {
            if (l.costPerBase > 0 && l.netPerBase + 0.005 < l.costPerBase) {
              approvalReasons.push({ code: 'BELOW_COST', message: `"${l.name}" ขายต่ำกว่าทุน (ขาย ฿${l.netPerBase.toFixed(2)} / ทุน ฿${l.costPerBase.toFixed(2)} ต่อหน่วย)` });
            }
          }
          if (totalAmount + verifiedClaimDiscount + 0.005 < totalCogs - verifiedClaimCogs && !approvalReasons.some((r) => r.code === 'BELOW_COST')) {
            approvalReasons.push({ code: 'BELOW_COST', message: `ยอดบิล ฿${totalAmount.toFixed(2)} ต่ำกว่าต้นทุนรวม ฿${totalCogs.toFixed(2)}` });
          }
        }
        const gross = sale.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
        const billDiscount = Math.max(0, discountAmount - pointsDiscount - verifiedClaimDiscount);
        const discountPct = gross > 0 ? ((sale.reduce((sum, l) => sum + l.lineDiscount, 0) + billDiscount) / gross) * 100 : 0;
        const limit = rules.maxDiscountPercent[cashierUser?.role || 'CASHIER'] ?? 0;
        if (discountPct > limit + 0.0001) {
          approvalReasons.push({ code: 'DISCOUNT_LIMIT', message: `ส่วนลด ${discountPct.toFixed(1)}% เกินที่ตำแหน่งนี้ให้ได้ (${limit}%)` });
        }
      }
      let approvalHash: string | null = null;
      if (approvalReasons.length) {
        // the approval is bound to exactly this bill: who sells, to whom, which items at which prices
        approvalHash = createHash('sha256').update(JSON.stringify({
          u: userId, c: data.customerId || null, d: discountAmount, t: totalAmount,
          i: data.items.map((it: any) => [it.productId, it.quantity, Number(it.unitPrice), Number(it.discountAmount || 0), it.conversionFactor || 1]),
        })).digest('hex');
        if (!data.approvalId) {
          const ticket = this.approvals!.issueTicket({
            t: 'SALE', h: approvalHash, r: approvalReasons, a: totalAmount, u: userId, term: data.terminalId || null,
            s: { total: totalAmount, cost: Math.round(totalCogs * 100) / 100, items: approvalLines.map((l) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, discount: l.lineDiscount })) },
          });
          throw new ConflictException({ statusCode: 409, code: 'APPROVAL_REQUIRED', message: 'รายการนี้ต้องให้ผู้จัดการอนุมัติ: ' + approvalReasons.map((r) => r.message).join(' / '), reasons: approvalReasons, ticket });
        }
      }

      // VAT (prices are VAT-inclusive). Store settings decide whether the shop charges VAT at all.
      const vatEnabled = (settings as { vatEnabled?: boolean } | null)?.vatEnabled === true;
      const vatRate = vatEnabled ? Number(settings?.vatRate ?? 7) : 0;
      const vatAmount = vatRate > 0 ? Math.round((totalAmount * vatRate / (100 + vatRate)) * 100) / 100 : 0;

      // Bank that received each QR / transfer payment (unknown ids are ignored -> default bank)
      const knownBankIds = new Set((await tx.bankAccount.findMany({ select: { id: true } })).map((b: { id: string }) => b.id));
      const bankIdOf = (p: any) => (p.bankAccountId && knownBankIds.has(p.bankAccountId) ? p.bankAccountId : null);

      // 4. Create Order
      const order = await tx.order.create({
        data: {
          clientOrderId: data.clientOrderId || null,
          orderNumber,
          userId,
          customerId: data.customerId || null,
          shiftId: shiftId || null,
          status: OrderStatus.COMPLETED,
          subtotal,
          discountAmount,
          totalAmount,
          totalCogs,
          vatRate,
          vatAmount,
          pointsUsed,
          pointsEarned,
          note: data.note || null,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          items: {
            create: orderItems,
          },
          payments: {
            create: (data.payments || []).map((p: any) => ({
              method: p.method,
              amount: Number(p.amount) || 0,
              referenceNo: p.referenceNo || null,
              bankAccountId: bankIdOf(p),
            })),
          },
        },
        include: { items: true, payments: true, customer: true, user: true },
      });

      // 5. Debt = sum of every CREDIT_DEBT line (never falls back to the bill total)
      if (creditAmount > 0 && data.customerId) {
        const debtAmount = Math.round(creditAmount * 100) / 100;
        await tx.customerDebt.create({
          data: {
            customerId: data.customerId,
            orderId: order.id,
            totalDebt: debtAmount,
            paidAmount: 0,
            remainingAmount: debtAmount,
            // Due date: explicit, else the customer's credit terms (days), default 30 days
            dueDate: data.dueDate
              ? new Date(data.dueDate)
              : new Date(order.createdAt.getTime() + (Number(profile.creditTerms) > 0 ? Number(profile.creditTerms) : 30) * 86400000),
            status: DebtStatus.PENDING,
            note: data.debtNote || `หนี้จากการขายบิล ${orderNumber}`,
          },
        });
      }

      // 5a. A claim credit can be used as a discount only once
      for (const claimId of usedClaimIds) {
        await tx.auditLog.create({ data: { userId: userId || null, action: 'CLAIM_DISCOUNT_USED', entity: 'CustomerClaim', entityId: claimId, details: { orderId: order.id, orderNumber, amount: verifiedClaimDiscount } } });
      }

      // 5b. Consume the manager approval for this exact bill (single use)
      if (approvalHash && data.approvalId) {
        await this.approvals!.consume(tx, data.approvalId, approvalHash, userId, order.id);
        await tx.order.update({ where: { id: order.id }, data: { approvalId: data.approvalId } });
      }

      // 6. Money ledger: where the money of this sale actually landed
      await this.postOrderPayments(tx, order.id, order.orderNumber, order.payments, shift.terminalId, userId);

      return order;
    });
  }

  /** Post each paid amount of an order to the account that received it (drawer / bank / card). */
  private async postOrderPayments(tx: any, orderId: string, orderNumber: string, payments: any[], terminalId: string | null, userId?: string | null) {
    for (const p of payments) {
      const account = await ledger.accountForPaymentMethod(tx, p.method, { terminalId, bankAccountId: p.bankAccountId });
      if (!account) continue; // credit sale / credit note: no money received now
      await ledger.post(tx, {
        accountId: account.id,
        direction: 'IN',
        amount: Number(p.amount),
        type: 'SALE',
        refType: 'ORDER',
        refId: orderId,
        note: `ขายบิล ${orderNumber}`,
        userId,
      });
    }
  }

  /** Lowest unit price the system itself would charge for this unit, or null when no price is configured. */
  private lowestAllowedUnitPrice(product: any, factor: number, unitId?: string, unitName?: string, totalBaseQty = 0): number | null {
    const positive = (vals: any[]) => vals.map(Number).filter((v) => Number.isFinite(v) && v > 0);
    const baseLevels = positive([product.basePrice, product.priceLevel1, product.priceLevel2, product.priceLevel3, product.priceLevel4, product.priceLevel5]);
    const candidates: number[] = baseLevels.map((v) => v * factor);
    if (factor !== 1) {
      const unit = (product.packagingUnits || []).find((u: any) => u.id === unitId || u.name === unitName);
      if (unit) candidates.push(...positive([unit.priceLevel1, unit.priceLevel2, unit.priceLevel3, unit.priceLevel4, unit.priceLevel5]));
    }
    for (const step of product.wholesalePrices || []) {
      if (totalBaseQty >= Number(step.minQuantity) && Number(step.unitPrice) > 0) candidates.push(Number(step.unitPrice) * factor);
    }
    if (!candidates.length) return null;
    return Math.round(Math.min(...candidates) * 100) / 100;
  }

  async syncOfflineOrders(orders: any[], userId: string) {
    const results: any[] = [];
    let syncedCount = 0;
    let failedCount = 0;

    for (const orderData of orders) {
      try {
        const syncedOrder = await this.checkout(orderData, userId);
        results.push({ clientOrderId: orderData.clientOrderId, success: true, orderNumber: syncedOrder.orderNumber });
        syncedCount++;
      } catch (err: any) {
        results.push({ clientOrderId: orderData.clientOrderId, success: false, error: err.message });
        failedCount++;
      }
    }

    return {
      success: true,
      syncedCount,
      failedCount,
      results,
    };
  }

  async voidOrder(id: string, reason: string, userId?: string) {
    return businessTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: { include: { product: true } }, payments: true, debt: true, shift: true, user: true },
      });

      if (!order) throw new NotFoundException('ไม่พบออเดอร์นี้');
      if (order.status !== OrderStatus.COMPLETED) throw new BadRequestException('สามารถยกเลิกได้เฉพาะออเดอร์ที่สำเร็จแล้วเท่านั้น');
      if (Number(order.returnedAmount) > 0) throw new BadRequestException('บิลนี้มีการคืนสินค้าบางส่วนแล้ว ยกเลิกทั้งบิลไม่ได้ ให้ทำรายการคืนสินค้าที่เหลือแทน');

      if (order.debt && Number(order.debt.paidAmount) > 0) throw new BadRequestException('บิลมีการรับชำระหนี้แล้ว ต้องจัดการคืนเงินก่อนยกเลิก');
      if (order.debt) await this.dropDebt(tx, order.debt, 'ยกเลิกบิล ' + order.orderNumber);
      if (order.customerId && (order.pointsUsed || order.pointsEarned)) {
        const customer = await tx.customer.findUnique({ where: { id: order.customerId } });
        if (!customer || customer.points + order.pointsUsed < order.pointsEarned) throw new BadRequestException('คะแนนจากบิลถูกใช้แล้ว ต้องตรวจสอบก่อนยกเลิก');
        await tx.customer.update({ where: { id: order.customerId }, data: { points: { increment: order.pointsUsed - order.pointsEarned } } });
      }

      // Check cash payment and shift status for cross-shift cash refund
      const cashPaid = (order.payments || [])
        .filter((p) => p.method === PaymentMethod.CASH)
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      if (cashPaid > 0 && order.shift && order.shift.status === ShiftStatus.CLOSED) {
        // the cash is paid back from the drawer of the person voiding (their own open shift only)
        const activeShift = userId
          ? await tx.shift.findFirst({
              where: { userId, status: ShiftStatus.OPEN },
              orderBy: { openedAt: 'desc' },
            })
          : null;
        if (!activeShift) {
          throw new BadRequestException('บิลเงินสดนี้อยู่ในกะที่ปิดไปแล้ว ผู้ยกเลิกต้องเปิดกะของตัวเองก่อนเพื่อจ่ายเงินสดคืนลูกค้าจากลิ้นชัก');
        }
        const voidDrawer = await ledger.drawerAccount(tx, activeShift.terminalId);
        const inVoidDrawer = await ledger.balanceOf(tx, voidDrawer.id);
        if (inVoidDrawer + 0.001 < cashPaid) throw new BadRequestException(`เงินสดในลิ้นชักไม่พอคืน (มี ฿${inVoidDrawer.toFixed(2)} ต้องคืน ฿${cashPaid.toFixed(2)})`);
        await tx.cashMovement.create({
          data: {
            shiftId: activeShift.id,
            type: CashMovementType.OUT,
            category: 'REFUND',
            amount: cashPaid,
            reason: 'คืนเงินสดยกเลิกบิลข้ามกะ #' + order.orderNumber,
          },
        });
        // The original cash already left that drawer at shift close: pay it back from today's drawer.
        const drawer = await ledger.drawerAccount(tx, activeShift.terminalId);
        await ledger.post(tx, {
          accountId: drawer.id, direction: 'OUT', amount: cashPaid, type: 'SALE_REFUND',
          refType: 'ORDER', refId: order.id, note: 'คืนเงินสดยกเลิกบิลข้ามกะ #' + order.orderNumber, userId,
        });
      }

      // Money ledger: undo what this bill brought in (bank / card / same-shift drawer)
      const crossShiftCash = cashPaid > 0 && order.shift?.status === ShiftStatus.CLOSED;
      await ledger.reverseByRef(tx, 'ORDER', order.id, 'ยกเลิกบิล #' + order.orderNumber + (reason ? ' (' + reason + ')' : ''), userId, {
        skipAccountTypes: crossShiftCash ? ['CASH_DRAWER'] : [],
      });

      const actorUser = userId
        ? await tx.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } })
        : null;
      const actorName = actorUser?.fullName || actorUser?.username || order.user?.fullName || 'พนักงานขาย';

      // Restore stock
      for (const item of order.items) {
        const bundleSnapshot = item.bundleData as any[];
        if (Array.isArray(bundleSnapshot) && bundleSnapshot.length > 0) {
          for (const child of bundleSnapshot) {
            const restoreQty = Number(child.totalQuantity) || 0;
            const prevStockAgg = await tx.stockBatch.aggregate({
              where: { productId: child.productId },
              _sum: { quantityRemaining: true },
            });
            const previousStock = Number(prevStockAgg._sum.quantityRemaining || 0);
            const currentStock = previousStock + restoreQty;
            const childProd = await tx.product.findUnique({
              where: { id: child.productId },
              select: { sku: true, name: true, unit: true },
            });

            await tx.stockBatch.create({
              data: {
                productId: child.productId,
                quantityReceived: restoreQty,
                quantityRemaining: restoreQty,
                unitCost: child.unitCost,
                note: `คืนสต็อกสินค้าชุดจากการยกเลิกบิล ${order.orderNumber}`,
              },
            });

            await tx.auditLog.create({
              data: {
                userId: userId || order.userId || null,
                action: 'STOCK_IN_VOID',
                entity: 'Product',
                entityId: child.productId,
                details: {
                  productId: child.productId,
                  sku: child.sku || childProd?.sku || '-',
                  productName: child.productName || childProd?.name || 'สินค้า',
                  unitName: childProd?.unit || 'ชิ้น',
                  type: 'IN_VOID',
                  quantityChange: restoreQty,
                  previousStock,
                  currentStock,
                  referenceType: 'VOID',
                  referenceNo: order.orderNumber,
                  reason: 'ยกเลิกบิล #' + order.orderNumber + (reason ? ' (' + reason + ')' : ''),
                  userName: actorName,
                },
              },
            });
          }
        } else {
          const restoreQty = Number(item.baseQuantity ?? item.quantity) || 0;
          const prevStockAgg = await tx.stockBatch.aggregate({
            where: { productId: item.productId },
            _sum: { quantityRemaining: true },
          });
          const previousStock = Number(prevStockAgg._sum.quantityRemaining || 0);
          const currentStock = previousStock + restoreQty;

          await tx.stockBatch.create({
            data: {
              productId: item.productId,
              quantityReceived: restoreQty,
              quantityRemaining: restoreQty,
              unitCost: item.unitCost,
              note: `คืนสต็อกจากการยกเลิกบิล ${order.orderNumber}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: userId || order.userId || null,
              action: 'STOCK_IN_VOID',
              entity: 'Product',
              entityId: item.productId,
              details: {
                productId: item.productId,
                sku: item.product?.sku || '-',
                productName: item.product?.name || 'สินค้า',
                unitName: item.product?.unit || item.unitName || 'ชิ้น',
                type: 'IN_VOID',
                quantityChange: restoreQty,
                previousStock,
                currentStock,
                referenceType: 'VOID',
                referenceNo: order.orderNumber,
                reason: 'ยกเลิกบิล #' + order.orderNumber + (reason ? ' (' + reason + ')' : ''),
                userName: actorName,
              },
            },
          });
        }
      }

      return tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.VOIDED,
          voidReason: reason,
        },
      });
    });
  }

  async update(id: string, data: any) {
    return businessTransaction(this.prisma, async tx => {
      const order = await tx.order.findUnique({ where: { id }, include: { payments: true, debt: true, shift: true, customer: true } });
      if (!order) throw new NotFoundException('ไม่พบบิลนี้');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('ข้อมูลไม่ถูกต้อง');
      if (data.note !== undefined && data.note !== null && typeof data.note !== 'string') throw new BadRequestException('หมายเหตุไม่ถูกต้อง');
      if (order.status !== OrderStatus.COMPLETED) throw new BadRequestException('แก้ไขได้เฉพาะบิลที่สำเร็จแล้ว');
      if (Object.prototype.hasOwnProperty.call(data, 'note')) {
        await tx.order.update({ where: { id }, data: { note: data.note?.trim() || null } });
      }
      const payments = Array.isArray(data.payments) ? data.payments : data.paymentMethod ? [{ method: data.paymentMethod, amount: Number(order.totalAmount) }] : null;
      if (payments) {
        if (order.shift && order.shift.status === ShiftStatus.CLOSED) {
          throw new BadRequestException('ไม่สามารถเปลี่ยนวิธีชำระเงินของบิลในกะที่ปิดไปแล้วได้');
        }
        if (!payments.length || payments.length > 20 || payments.some((p: any) => !p || typeof p !== 'object' || !Object.values(PaymentMethod).includes(p.method) || !Number.isFinite(Number(p.amount)) || Number(p.amount) < 0 || (p.bankAccountId != null && typeof p.bankAccountId !== 'string'))) throw new BadRequestException('วิธีหรือยอดชำระไม่ถูกต้อง');
        const total = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        if (Math.abs(total - Number(order.totalAmount)) > 0.01) throw new BadRequestException('ยอดชำระไม่ตรงกับยอดบิล');
        if (payments.some((p: any) => p.method === PaymentMethod.CREDIT_DEBT && !(Number(p.amount) > 0))) throw new BadRequestException('ยอดขายเชื่อต้องมากกว่า 0 บาท');
        const credit = payments.filter((p: any) => p.method === PaymentMethod.CREDIT_DEBT).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        if (credit && !order.customerId) throw new BadRequestException('ขายเชื่อต้องระบุลูกค้า');
        if (order.debt && Number(order.debt.paidAmount) > 0) throw new BadRequestException('บิลมีการรับชำระหนี้แล้ว ไม่สามารถเปลี่ยนวิธีชำระได้');
        if (Number(order.returnedAmount) > 0) throw new BadRequestException('บิลนี้มีการคืนสินค้าแล้ว เปลี่ยนวิธีชำระไม่ได้');
        if (credit) {
          // same credit rules as at checkout: blocked customers and the credit limit (other bills' debt + this one)
          const profile: any = order.customer?.profile || {};
          if (profile.isCreditBlocked) throw new BadRequestException('ลูกค้าถูกระงับเครดิต');
          if (Number(profile.creditLimit) > 0) {
            const debts = await tx.customerDebt.aggregate({ where: { customerId: order.customerId!, NOT: { orderId: id } }, _sum: { remainingAmount: true } });
            if (Number(debts._sum.remainingAmount || 0) + credit > Number(profile.creditLimit) + 0.001) throw new BadRequestException('ยอดขายเกินวงเงินเครดิต');
          }
          const dueDays = Number(profile.creditTerms) > 0 ? Number(profile.creditTerms) : 30;
          await tx.customerDebt.upsert({ where: { orderId: id }, create: { orderId: id, customerId: order.customerId!, totalDebt: credit, remainingAmount: credit, dueDate: new Date(order.createdAt.getTime() + dueDays * 86400000), note: `หนี้จากการขายบิล ${order.orderNumber}` }, update: { totalDebt: credit, paidAmount: 0, remainingAmount: credit, status: DebtStatus.PENDING } });
        } else if (order.debt) await this.dropDebt(tx, order.debt, 'เปลี่ยนวิธีชำระบิล ' + order.orderNumber);
        // QR / transfer must name a known bank account (unknown ids fall back to the default bank, as at checkout)
        const knownBankIds = new Set((await tx.bankAccount.findMany({ select: { id: true } })).map((b: { id: string }) => b.id));
        await tx.payment.deleteMany({ where: { orderId: id } });
        await tx.payment.createMany({ data: payments.map((p: any) => ({ orderId: id, method: p.method, amount: Number(p.amount), referenceNo: p.referenceNo ? String(p.referenceNo).slice(0, 200) : null, bankAccountId: p.bankAccountId && knownBankIds.has(p.bankAccountId) ? p.bankAccountId : null })) });
        // Money ledger: undo the old payment split and post the new one
        await ledger.reverseByRef(tx, 'ORDER', id, 'แก้ไขวิธีชำระเงินบิล #' + order.orderNumber);
        const fresh = await tx.payment.findMany({ where: { orderId: id } });
        await this.postOrderPayments(tx, id, order.orderNumber, fresh, order.shift?.terminalId ?? null);
      }
      return tx.order.findUnique({ where: { id }, include: { items: { include: { product: true } }, payments: true, customer: true, user: true, debt: true } });
    });
  }

  /**
   * The bill no longer creates a debt. A debt with payment history (all cancelled, since paid debts
   * cannot get here) is kept and closed at 0 so the cancelled receipts stay in the payment history;
   * a debt that never had a payment is simply removed.
   */
  private async dropDebt(tx: any, debt: { id: string; note?: string | null }, why: string) {
    const history = await tx.debtPayment.count({ where: { debtId: debt.id } });
    if (!history) {
      await tx.customerDebt.delete({ where: { id: debt.id } });
      return;
    }
    await tx.customerDebt.update({
      where: { id: debt.id },
      data: { totalDebt: 0, paidAmount: 0, remainingAmount: 0, status: DebtStatus.PAID, note: `[ยกเลิก] ${why}` + (debt.note ? ` | ${debt.note}` : '') },
    });
  }

  async findAll(query: any) {
    const pageNum = parseInt(query.page, 10);
    const limitNum = parseInt(query.limit, 10);
    const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
    const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, 1000) : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.status = query.status as OrderStatus;
    }

    if (query.startDate && query.endDate) {
      const from = new Date(query.startDate);
      const to = new Date(query.endDate);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('ช่วงวันที่ไม่ถูกต้อง');
      where.createdAt = { gte: from, lte: to };
    }

    if (query.search && query.search.trim()) {
      where.OR = [
        { orderNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { customer: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
        { customer: { phone: { contains: query.search.trim() } } },
      ];
    }

    if (query.search !== undefined && typeof query.search !== 'string') throw new BadRequestException('คำค้นหาไม่ถูกต้อง');
    const completedWhere = { ...where, status: OrderStatus.COMPLETED };
    const [orders, total, aggregate, completedCount, returnsAgg] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          payments: true,
          customer: { select: { id: true, name: true, phone: true } },
          user: { select: { id: true, fullName: true } },
          claims: true,
          returns: { select: { returnNumber: true, refundAmount: true, refundMethod: true, cogsReturned: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.aggregate({
        where: completedWhere,
        _sum: { totalAmount: true, totalCogs: true },
      }),
      this.prisma.order.count({ where: completedWhere }),
      this.prisma.orderReturn.aggregate({ where: { order: completedWhere }, _sum: { refundAmount: true, cogsReturned: true } }),
    ]);
    // completed bills, net of partial returns (refunds and the cost of goods that came back)
    const netSales = round2((Number(aggregate._sum.totalAmount) || 0) - (Number(returnsAgg._sum.refundAmount) || 0));
    const netCogs = round2((Number(aggregate._sum.totalCogs) || 0) - (Number(returnsAgg._sum.cogsReturned) || 0));

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalSales: netSales,
        totalCogs: netCogs,
        grossProfit: round2(netSales - netCogs),
        orderCount: completedCount,
        grossSales: Number(aggregate._sum.totalAmount) || 0,
        totalReturns: Number(returnsAgg._sum.refundAmount) || 0,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        payments: true,
        customer: true,
        user: true,
        debt: true,
        returns: { include: { items: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('ไม่พบบิลนี้');
    return order;
  }
}
