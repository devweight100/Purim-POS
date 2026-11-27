import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { PurchaseOrdersService, withDocNames } from './purchase-orders.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('MANAGE_PURCHASES')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.purchaseOrdersService.findAll(query);
  }

  /**
   * GET /purchase-orders/product-suppliers?ids=a,b: supplier of the newest PO (any status) that contains each
   * product (supplier-returns page: who to return a claimed product to when the product has no supplier).
   */
  @Get('product-suppliers')
  productSuppliers(@Query('ids') ids?: string) {
    return this.purchaseOrdersService.latestSupplierByProduct(ids);
  }

  /**
   * GET /purchase-orders/match-line?supplierId=&text=&poId=&limit=: candidate products of that supplier for one
   * free-text supplier-invoice line (code or name), best first (supplier code exact, barcode / SKU exact, then
   * pg_trgm name similarity). Groundwork for invoice-photo matching (docs/product-names.md); no OCR here.
   */
  @Get('match-line')
  matchLine(@Query('supplierId') supplierId?: string, @Query('text') text?: string, @Query('poId') poId?: string, @Query('limit') limit?: string) {
    return this.purchaseOrdersService.matchLine({ supplierId: String(supplierId ?? ''), text: String(text ?? ''), purchaseOrderId: poId || null, limit: Number(limit) || undefined });
  }

  /**
   * GET /purchase-orders/last-prices?productId=&supplierId=&excludePoId=: newest price paid to this supplier for the
   * product per unit (newest first) + the product's cost: the grid's default unit price (shared defaultPoUnitPrice).
   */
  @Get('last-prices')
  lastPrices(@Query() query: Record<string, unknown>) {
    return this.purchaseOrdersService.lastPrices(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrdersService.findOne(id);
  }

  @Post()
  create(@Body() createPurchaseOrderDto: any) {
    return this.purchaseOrdersService.create(createPurchaseOrderDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePurchaseOrderDto: any) {
    return this.purchaseOrdersService.update(id, updatePurchaseOrderDto).then(withDocNames);
  }

  /** "ใช้ชื่อร้าน / ใช้ชื่อผู้ผลิต" of this PO (any status; reprints keep it). Body { mode: 'SHOP' | 'SUPPLIER' }. */
  @Patch(':id/doc-name-mode')
  setDocNameMode(@Param('id') id: string, @Body() body: { mode?: string }) {
    return this.purchaseOrdersService.setDocNameMode(id, body?.mode);
  }

  @Post(':id/issue')
  issue(@Param('id') id: string) {
    return this.purchaseOrdersService.issue(id).then((po: any) => withDocNames(po));
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() data: { reason?: string }) {
    return this.purchaseOrdersService.cancel(id, data?.reason).then((po: any) => withDocNames(po));
  }

  @Post(':id/receive')
  receive(
    @Param('id') id: string,
    @Body() data: { clientReceiptId?: string; adjustAndComplete?: boolean; supplierInvoiceNo?: string; items: { purchaseOrderItemId: string; receivedQty: number; unitCost: number }[] }
  ) {
    return this.purchaseOrdersService.receive(id, data).then((po: any) => withDocNames(po));
  }
}
