import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  create(@Body() data: any) {
    return this.prisma.customer.create({ data });
  }

  @Get()
  findAll(@Query('search') search?: string) {
    const where = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as any } },
        { phone: { contains: search, mode: 'insensitive' as any } }
      ]
    } : {};
    return this.prisma.customer.findMany({ where });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  @Get(':id/orders')
  getOrders(@Param('id') id: string) {
    return this.prisma.order.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' } });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.prisma.customer.update({ where: { id }, data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.customer.delete({ where: { id } });
  }
}
