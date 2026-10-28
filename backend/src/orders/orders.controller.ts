import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @RequirePermissions('POS_SELL')
  @Post('checkout')
  checkout(@Body() data: any, @Request() req: any) {
    return this.ordersService.checkout(data, req.user.id);
  }

  @RequirePermissions('POS_SELL')
  @Post('sync-offline')
  syncOffline(@Body('orders') orders: any[], @Request() req: any) {
    return this.ordersService.syncOfflineOrders(orders || [], req.user.id);
  }

  @Roles('MANAGER')
  @RequirePermissions('POS_VOID')
  @Post(':id/void')
  voidOrder(@Param('id') id: string, @Body() data: { reason: string }, @Request() req: any) {
    return this.ordersService.voidOrder(id, data.reason, req.user?.id);
  }

  @Roles('MANAGER')
  @RequirePermissions('POS_VOID')
  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.ordersService.update(id, data);
  }

  @RequirePermissions('POS_SELL', 'VIEW_REPORTS')
  @Get()
  findAll(@Query() query: any) {
    return this.ordersService.findAll(query);
  }

  @RequirePermissions('POS_SELL', 'VIEW_REPORTS')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
