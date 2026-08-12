import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  findAll() {
    return this.purchaseOrdersService.findAll();
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

  @Post(':id/receive')
  receive(
    @Param('id') id: string,
    @Body() data: { items: { purchaseOrderItemId: string; receivedQty: number; unitCost: number }[] }
  ) {
    return this.purchaseOrdersService.receive(id, data);
  }
}
