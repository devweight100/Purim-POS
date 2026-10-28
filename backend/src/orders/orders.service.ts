import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderStatus, PaymentMethod, DebtStatus, ShiftStatus, CashMovementType } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService
  ) {}

  async checkout(data: any, userId: string) {
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
        ? await tx.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } })
        : null;
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

        const itemTotal = Math.round((item.quantity * Number(item.unitPrice) - lineDiscount) * 100) / 100;
        subtotal += itemTotal;
        totalCogs += itemCogs;

        const unitCost = baseQuantity > 0 ? itemCogs / baseQuantity : 0;

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          baseQuantity,
          unitName,
          discountAmount: lineDiscount,
          unitPrice: item.unitPrice,
          unitCost: unitCost,
          total: itemTotal,
          bundleData: bundleSnapshot,
        });
      }

      const discountAmount = Number(data.discountAmount) || 0;
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
      const allowedDiscount = Math.floor(pointsUsed / redeemRate) * redeemBaht;
      if (Number(data.pointsDiscountAmount || 0) > allowedDiscount || (config.isLoyaltyEnabled === false && pointsUsed > 0)) throw new BadRequestException('ส่วนลดคะแนนไม่ถูกต้อง');
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
            })),
          },
        },
        include: { items: true, payments: true, customer: true, user: true },
      });

      // 5. Check for Debt payment method (CREDIT_DEBT)
      const debtPayment = (data.payments || []).find((p: any) => p.method === PaymentMethod.CREDIT_DEBT);
      if (debtPayment && data.customerId) {
        const debtAmount = Number(debtPayment.amount) || totalAmount;
        await tx.customerDebt.create({
          data: {
            customerId: data.customerId,
            orderId: order.id,
            totalDebt: debtAmount,
            paidAmount: 0,
            remainingAmount: debtAmount,
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            status: DebtStatus.PENDING,
            note: data.debtNote || `หนี้จากการขายบิล ${orderNumber}`,
          },
        });
      }

      return order;
    });
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

      if (order.debt && Number(order.debt.paidAmount) > 0) throw new BadRequestException('บิลมีการรับชำระหนี้แล้ว ต้องจัดการคืนเงินก่อนยกเลิก');
      if (order.debt) await tx.customerDebt.delete({ where: { id: order.debt.id } });
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
        let activeShift = userId
          ? await tx.shift.findFirst({
              where: { userId, status: ShiftStatus.OPEN },
              orderBy: { openedAt: 'desc' },
            })
          : null;
        if (!activeShift) {
          activeShift = await tx.shift.findFirst({
            where: { status: ShiftStatus.OPEN },
            orderBy: { openedAt: 'desc' },
          });
        }
        if (!activeShift) {
          throw new BadRequestException('บิลเงินสดนี้อยู่ในกะที่ปิดไปแล้ว กรุณาเปิดกะปัจจุบันก่อนเพื่อบันทึกการจ่ายเงินสดคืนลูกค้า');
        }
        await tx.cashMovement.create({
          data: {
            shiftId: activeShift.id,
            type: CashMovementType.OUT,
            amount: cashPaid,
            reason: 'คืนเงินสดยกเลิกบิลข้ามกะ #' + order.orderNumber,
          },
        });
      }

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
      const order = await tx.order.findUnique({ where: { id }, include: { payments: true, debt: true, shift: true } });
      if (!order) throw new NotFoundException('ไม่พบบิลนี้');
      if (order.status !== OrderStatus.COMPLETED) throw new BadRequestException('แก้ไขได้เฉพาะบิลที่สำเร็จแล้ว');
      if (Object.prototype.hasOwnProperty.call(data, 'note')) {
        await tx.order.update({ where: { id }, data: { note: data.note?.trim() || null } });
      }
      const payments = Array.isArray(data.payments) ? data.payments : data.paymentMethod ? [{ method: data.paymentMethod, amount: Number(order.totalAmount) }] : null;
      if (payments) {
        if (order.shift && order.shift.status === ShiftStatus.CLOSED) {
          throw new BadRequestException('ไม่สามารถเปลี่ยนวิธีชำระเงินของบิลในกะที่ปิดไปแล้วได้');
        }
        if (!payments.length || payments.some((p: any) => !Object.values(PaymentMethod).includes(p.method) || !Number.isFinite(Number(p.amount)) || Number(p.amount) < 0)) throw new BadRequestException('วิธีหรือยอดชำระไม่ถูกต้อง');
        const total = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        if (Math.abs(total - Number(order.totalAmount)) > 0.01) throw new BadRequestException('ยอดชำระไม่ตรงกับยอดบิล');
        const credit = payments.filter((p: any) => p.method === PaymentMethod.CREDIT_DEBT).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        if (credit && !order.customerId) throw new BadRequestException('ขายเชื่อต้องระบุลูกค้า');
        if (order.debt && Number(order.debt.paidAmount) > 0) throw new BadRequestException('บิลมีการรับชำระหนี้แล้ว ไม่สามารถเปลี่ยนวิธีชำระได้');
        if (credit) {
          await tx.customerDebt.upsert({ where: { orderId: id }, create: { orderId: id, customerId: order.customerId!, totalDebt: credit, remainingAmount: credit }, update: { totalDebt: credit, remainingAmount: credit, status: DebtStatus.PENDING } });
        } else if (order.debt) await tx.customerDebt.delete({ where: { id: order.debt.id } });
        await tx.payment.deleteMany({ where: { orderId: id } });
        await tx.payment.createMany({ data: payments.map((p: any) => ({ orderId: id, method: p.method, amount: Number(p.amount), referenceNo: p.referenceNo || null })) });
      }
      return tx.order.findUnique({ where: { id }, include: { items: { include: { product: true } }, payments: true, customer: true, user: true, debt: true } });
    });
  }

  async findAll(query: any) {
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.status = query.status as OrderStatus;
    }

    if (query.startDate && query.endDate) {
      where.createdAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    if (query.search && query.search.trim()) {
      where.OR = [
        { orderNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { customer: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
        { customer: { phone: { contains: query.search.trim() } } },
      ];
    }

    const [orders, total, aggregate] = await Promise.all([
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
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.aggregate({
        where: { ...where, status: OrderStatus.COMPLETED },
        _sum: { totalAmount: true, totalCogs: true },
      }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalSales: Number(aggregate._sum.totalAmount) || 0,
        totalCogs: Number(aggregate._sum.totalCogs) || 0,
        grossProfit: (Number(aggregate._sum.totalAmount) || 0) - (Number(aggregate._sum.totalCogs) || 0),
        orderCount: total,
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
      },
    });
    if (!order) throw new NotFoundException('ไม่พบบิลนี้');
    return order;
  }
}
