import { Controller, Get, Post, Patch, Put, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UpdateSettingsDto, SETTINGS_FIELDS } from './update-settings.dto';

/** Images only: checked by MIME type AND extension, 5 MB max (served same-origin from /uploads). */
export const IMAGE_TYPES: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
};
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function isAllowedImage(file: { mimetype?: string; originalname?: string }) {
  const ext = extname(String(file.originalname || '')).toLowerCase();
  const allowed = IMAGE_TYPES[String(file.mimetype || '').toLowerCase()];
  return Boolean(allowed && allowed.includes(ext));
}

const storageOptions = {
  storage: diskStorage({
    destination: './uploads',
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req: any, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    if (!isAllowedImage(file)) return cb(new BadRequestException('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP หรือ GIF เท่านั้น'), false);
    cb(null, true);
  },
};

/** Never published pre-login: server paths and approval policy. */
const PRIVATE_FIELDS = ['backupOffsiteDir', 'approvalRules'] as const;
function publicSettings<T extends Record<string, any>>(s: T) {
  const out: Record<string, any> = { ...s };
  for (const k of PRIVATE_FIELDS) delete out[k];
  return out;
}

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
      return publicSettings(settings);
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
  async updateSettings(@Body() body: UpdateSettingsDto) {
    return this.applySettings(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Put()
  async putSettings(@Body() body: UpdateSettingsDto) {
    return this.applySettings(body);
  }

  /** Only whitelisted, validated fields reach the database (no id/createdAt/approvalRules/backupOffsiteDir). */
  private async applySettings(body: Partial<UpdateSettingsDto>) {
    const data: Record<string, any> = {};
    for (const k of SETTINGS_FIELDS) {
      if ((body as any)?.[k] !== undefined) data[k] = (body as any)[k];
    }
    if (data.loyaltyConfig === null) data.loyaltyConfig = undefined;
    const settings = await this.prisma.storeSettings.findFirst();
    const saved = settings
      ? await this.prisma.storeSettings.update({ where: { id: settings.id }, data })
      : await this.prisma.storeSettings.create({ data });
    return publicSettings(saved);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Post('upload-qr')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadQr(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์รูปภาพ');
    const url = `/uploads/${file.filename}`;
    await this.applySettings({ qrImageUrl: url });
    return { url };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Post('upload-logo')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์รูปภาพ');
    const url = `/uploads/${file.filename}`;
    await this.applySettings({ logoUrl: url });
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
