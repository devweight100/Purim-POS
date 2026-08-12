import { Controller, Get, Post, Patch, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
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

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getSettings() {
    let settings = await this.prisma.storeSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.storeSettings.create({ data: {} });
    }
    return settings;
  }

  @Patch()
  async updateSettings(@Body() data: any) {
    let settings = await this.prisma.storeSettings.findFirst();
    if (!settings) {
      return this.prisma.storeSettings.create({ data });
    }
    return this.prisma.storeSettings.update({ where: { id: settings.id }, data });
  }

  @Post('upload-qr')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadQr(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = `/uploads/${file.filename}`;
    await this.updateSettings({ qrImageUrl: url });
    return { url };
  }

  @Post('upload-logo')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = `/uploads/${file.filename}`;
    await this.updateSettings({ logoUrl: url });
    return { url };
  }
}
