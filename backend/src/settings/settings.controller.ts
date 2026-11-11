import { Controller, Get, Post, Patch, Put, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ServerControlService } from '../server-control/server-control.service';
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

/** Default expense categories of a fresh install (same as the finance_ledger migration). */
const RESET_EXPENSE_CATEGORIES = [
  'ค่าเช่าที่',
  'ค่าไฟฟ้า / ค่าน้ำ',
  'เงินเดือน / ค่าแรง',
  'ค่าขนส่ง / น้ำมัน',
  'ค่าโทรศัพท์ / อินเทอร์เน็ต',
  'วัสดุสิ้นเปลือง / ถุง / บรรจุภัณฑ์',
  'ค่าซ่อมบำรุง',
  'ค่าธรรมเนียมธนาคาร / บัตร',
  'ภาษี / ค่าธรรมเนียมราชการ',
  'ค่าใช้จ่ายเบ็ดเตล็ด',
];

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serverControl: ServerControlService,
  ) {}

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
    // Empty EVERY table (read from the database, so a table added later can never be missed -
    // the old hand-written list left the cash ledger, expenses, returns and approvals behind).
    // Kept: users (admin only, below), store settings and the migration history.
    // A backup is taken first; no backup -> nothing is deleted.
    let backupFile: string | null = null;
    try {
      const backup: any = await this.serverControl.createBackup('manual');
      backupFile = backup?.fileName || null;
    } catch (err: any) {
      backupFile = null;
    }
    if (!backupFile) {
      throw new BadRequestException('สำรองข้อมูลก่อนล้างไม่สำเร็จ จึงยังไม่ได้ลบข้อมูลใด ๆ กรุณาตรวจสอบหน้า "สำรองข้อมูล" แล้วลองใหม่');
    }
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = current_schema()
          AND tablename NOT IN ('users', 'store_settings', '_prisma_migrations')`;
      const tables = rows.map((r) => r.tablename).filter((t) => /^[a-z0-9_]+$/.test(t));
      if (tables.length > 0) {
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
      }
      await tx.user.deleteMany({ where: { username: { not: 'admin' } } });
      // a fresh install comes with these expense categories (migration 20261107000000_finance_ledger)
      await tx.expenseCategory.createMany({
        data: RESET_EXPENSE_CATEGORIES.map((name, i) => ({ name, sortOrder: i + 1 })),
        skipDuplicates: true,
      });
      return {
        success: true,
        clearedTables: tables.length,
        backupFile,
        message: `ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว (รวมยอดเงินในการเงิน) คงเหลือเฉพาะผู้ใช้งาน admin และการตั้งค่าร้าน — สำรองข้อมูลก่อนล้างไว้ที่ ${backupFile}`,
      };
    }, { timeout: 60000 });
  }

}
