import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
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

  @RequirePermissions('MANAGE_INVENTORY')
  @Post('adjust')
  adjustStock(@Body() data: any) {
    return this.inventoryService.adjustStock(data);
  }

  @RequirePermissions('MANAGE_INVENTORY', 'VIEW_REPORTS')
  @Get('movements')
  getMovements(@Query('productId') productId?: string, @Query('limit') limitStr?: string) {
    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    return this.inventoryService.getMovements(productId, limit);
  }

  @RequirePermissions('MANAGE_INVENTORY', 'VIEW_REPORTS')
  @Get('low-stock')
  async getLowStock(@Query('threshold') thresholdStr: string) {
    const threshold = Number(thresholdStr) || 10;
    const products = await this.getStock();
    return products.filter(p => p.computedStock < threshold);
  }
}
