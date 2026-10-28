import { Controller, Get, Post, Patch, Put, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

const storageOptions = {
  storage: diskStorage({
    destination: './uploads',
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`);
    }
  })
};

@Controller('settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getSettings() {
    try {
      let settings = await this.prisma.storeSettings.findFirst();
      if (!settings) {
        settings = await this.prisma.storeSettings.create({ data: {} });
      }
      return settings;
    } catch (err) {
      return {
        storeName: 'ร้านปุริม POS',
        branchName: 'สำนักงานใหญ่',
        vatRate: 7,
        pointsPerBaht: 0.01,
        pointValue: 1,
      };
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Patch()
  async updateSettings(@Body() data: any) {
    let settings = await this.prisma.storeSettings.findFirst();
    if (!settings) {
      return this.prisma.storeSettings.create({ data });
    }
    return this.prisma.storeSettings.update({ where: { id: settings.id }, data });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Put()
  async putSettings(@Body() data: any) {
    return this.updateSettings(data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Post('upload-qr')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadQr(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = `/uploads/${file.filename}`;
    await this.updateSettings({ qrImageUrl: url });
    return { url };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Post('upload-logo')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = `/uploads/${file.filename}`;
    await this.updateSettings({ logoUrl: url });
    return { url };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('reset-database')
  async resetDatabase() {
    return this.prisma.$transaction(async (tx) => {
      // 1. Payables & Vouchers
      await tx.paymentVoucherDebit.deleteMany({});
      await tx.paymentVoucherItem.deleteMany({});
      await tx.paymentVoucher.deleteMany({});
      await tx.supplierReturnNote.deleteMany({});

      // 2. Purchase Orders
      await tx.purchaseOrderItem.deleteMany({});
      await tx.purchaseOrder.deleteMany({});

      // 3. Claims
      await tx.customerClaim.deleteMany({});
      await tx.claimInventory.deleteMany({});

      // 4. Debts
      await tx.debtPayment.deleteMany({});
      await tx.customerDebt.deleteMany({});

      // 5. Customers
      await tx.customer.deleteMany({});

      // 6. Orders & Payments
      await tx.payment.deleteMany({});
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});

      // 7. Shifts & Cash Movements
      await tx.cashMovement.deleteMany({});
      await tx.shift.deleteMany({});

      // 8. Products, Batches, Barcodes, Packaging, Suppliers
      await tx.productSupplier.deleteMany({});
      await tx.supplier.deleteMany({});
      await tx.stockBatch.deleteMany({});
      await tx.productBarcode.deleteMany({});
      await tx.productPackagingUnit.deleteMany({});
      await tx.productImage.deleteMany({});
      await tx.productWholesalePrice.deleteMany({});
      await tx.product.deleteMany({});
      await tx.category.deleteMany({});

      // 9. Logs & Bank Accounts
      await tx.auditLog.deleteMany({});
      await tx.bankAccount.deleteMany({});

      // 10. Delete all users except admin
      await tx.user.deleteMany({
        where: {
          username: { not: 'admin' },
        },
      });

      return {
        success: true,
        message: 'ล้างข้อมูลทั้งหมดในฐานข้อมูลเรียบร้อยแล้ว คงเหลือเฉพาะผู้ใช้งาน admin',
      };
    });
  }
}
