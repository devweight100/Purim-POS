import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private prisma: PrismaService
  ) {}

  @Get('stock')
  async getStock() {
    const products = await this.prisma.product.findMany({
      include: { stockBatches: true }
    });
    return products.map(p => ({
      ...p,
      computedStock: p.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0)
    }));
  }

  @Post('stock-batch')
  addStockBatch(@Body() data: any) {
    return this.inventoryService.addStockBatch(data);
  }

  @Get('low-stock')
  async getLowStock(@Query('threshold') thresholdStr: string) {
    const threshold = Number(thresholdStr) || 10;
    const products = await this.getStock();
    return products.filter(p => p.computedStock < threshold);
  }
}
