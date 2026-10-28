import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('POS_SELL', 'MANAGE_DEBTS', 'VIEW_REPORTS')
@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@Body() data: any) {
    const { name, phone, email, address, note, id, points, createdAt, updatedAt, currentDebt, ...profile } = data;
    const saved = await this.prisma.customer.create({ data: { name, phone: phone || null, email, address, note, profile } });
    return { ...profile, ...saved };
  }

  @Get()
  async findAll(@Query('search') search?: string) {
    const where = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as any } },
        { phone: { contains: search, mode: 'insensitive' as any } }
      ]
    } : {};
    const rows = await this.prisma.customer.findMany({ where, include: { debts: true } });
    return rows.map(row => ({ ...(row.profile as any || {}), ...row, phone: row.phone || '', currentDebt: row.debts.reduce((sum, d) => sum + Number(d.remainingAmount), 0) }));
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
  async update(@Param('id') id: string, @Body() data: any) {
    const existing = await this.prisma.customer.findUniqueOrThrow({ where: { id } });
    const { name, phone, email, address, note, id: ignoredId, points, createdAt, updatedAt, currentDebt, profile: ignoredProfile, ...details } = data;
    const profile = { ...(existing.profile as any || {}), ...details };
    const saved = await this.prisma.customer.update({ where: { id }, data: { name, phone: phone === undefined ? undefined : phone || null, email, address, note, profile } });
    return { ...profile, ...saved };
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_DEBTS')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.customer.delete({ where: { id } });
  }
}
