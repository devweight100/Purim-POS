import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
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
    return this.purchaseOrdersService.update(id, updatePurchaseOrderDto);
  }

  @Post(':id/issue')
  issue(@Param('id') id: string) {
    return this.purchaseOrdersService.issue(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() data: { reason?: string }) {
    return this.purchaseOrdersService.cancel(id, data?.reason);
  }

  @Post(':id/receive')
  receive(
    @Param('id') id: string,
    @Body() data: { clientReceiptId?: string; adjustAndComplete?: boolean; supplierInvoiceNo?: string; items: { purchaseOrderItemId: string; receivedQty: number; unitCost: number }[] }
  ) {
    return this.purchaseOrdersService.receive(id, data);
  }
}
