import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { costFilterFor } from '../products/cost-visibility';
import { clampInt } from '../products/prisma-errors';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private prisma: PrismaService
  ) {}

  private async stockList() {
    const products = await this.prisma.product.findMany({
      include: { stockBatches: true }
    });
    return products.map(p => ({
      ...p,
      computedStock: p.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0)
    }));
  }

  // costPrice / batch unitCost only for ADMIN or VIEW_COST
  @Get('stock')
  async getStock(@Request() req: any) {
    return costFilterFor(req?.user)(await this.stockList());
  }

  // Adds stock through the audited adjustment path (STOCK_ADJUST_ADD log entry).
  @RequirePermissions('MANAGE_INVENTORY')
  @Post('stock-batch')
  addStockBatch(@Body() data: any, @Request() req: any) {
    return this.inventoryService.addStockBatch(data, req.user);
  }

  @RequirePermissions('MANAGE_INVENTORY')
  @Post('adjust')
  adjustStock(@Body() data: any, @Request() req: any) {
    return this.inventoryService.adjustStock({ ...data, userId: req.user?.id, userName: data.userName || req.user?.fullName || req.user?.username });
  }

  @RequirePermissions('MANAGE_INVENTORY', 'VIEW_REPORTS')
  @Get('movements')
  getMovements(@Query('productId') productId?: string, @Query('limit') limitStr?: string) {
    const limit = clampInt(limitStr, 100, 1, 1000);
    return this.inventoryService.getMovements(productId, limit);
  }

  @RequirePermissions('MANAGE_INVENTORY', 'VIEW_REPORTS')
  @Get('low-stock')
  async getLowStock(@Query('threshold') thresholdStr: string, @Request() req: any) {
    // one store-wide threshold (StoreSettings.lowStockThreshold, default 5) unless the caller asks for another
    const settings = await this.prisma.storeSettings.findFirst({ select: { lowStockThreshold: true } });
    const threshold = Number(thresholdStr) > 0 ? Number(thresholdStr) : (settings?.lowStockThreshold ?? 5);
    const products = await this.stockList();
    return costFilterFor(req?.user)(products.filter(p => p.computedStock <= threshold));
  }
}
