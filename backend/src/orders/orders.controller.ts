import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  checkout(@Body() data: any, @Request() req: any) {
    return this.ordersService.checkout(data, req.user.id);
  }

  @Post(':id/void')
  voidOrder(@Param('id') id: string, @Body() data: { reason: string }) {
    return this.ordersService.voidOrder(id, data.reason);
  }

  @Get()
  findAll(@Query() query: any) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
