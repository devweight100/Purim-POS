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

  /**
   * Every product with its remaining stock (sum of its own batches, summed in SQL). The batch rows themselves are
   * not sent (unbounded: every receipt adds one); GET /products/:id has them.
   */
  private async stockList() {
    const [products, sums] = await Promise.all([
      this.prisma.product.findMany(),
      this.prisma.$queryRaw<{ product_id: string; qty: string | null }[]>`
        SELECT product_id, SUM(quantity_remaining)::text AS qty FROM stock_batches GROUP BY product_id`,
    ]);
    const stockOf = new Map(sums.map((r) => [r.product_id, Number(r.qty || 0)]));
    return products.map((p) => ({ ...p, computedStock: stockOf.get(p.id) || 0 }));
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
    return this.inventoryService.adjustStock({ ...data, userId: req.user?.id, userName: req.user?.fullName || req.user?.username || data.userName });
  }

  /** Paged stock-card list: `{ data, meta: { page, limit, total, allCount } }` (see InventoryService.getMovementsPage). */
  @RequirePermissions('MANAGE_INVENTORY', 'VIEW_REPORTS')
  @Get('movements/page')
  getMovementsPage(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('productId') productId?: string,
  ) {
    const cleanType = type && /^[A-Z_]{2,40}$/.test(type) ? type : undefined;
    return this.inventoryService.getMovementsPage({
      page: clampInt(pageStr, 1, 1, 1_000_000),
      limit: clampInt(limitStr, 20, 1, 500),
      q: q ? String(q).slice(0, 200) : undefined,
      type: cleanType,
      from: from ? new Date(from) : undefined,
      productId: productId || undefined,
    });
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
    const threshold = Number(thresholdStr) > 0 ? Number(thresholdStr) : Number(settings?.lowStockThreshold ?? 5);
    const products = await this.stockList();
    return costFilterFor(req?.user)(products.filter(p => !p.isService && p.computedStock <= threshold));
  }
}
