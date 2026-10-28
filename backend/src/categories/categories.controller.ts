import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions('MANAGE_INVENTORY')
  @Post()
  create(@Body() data: any) {
    return this.prisma.category.create({ data });
  }

  @Get()
  findAll() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  @RequirePermissions('MANAGE_INVENTORY')
  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.prisma.category.update({ where: { id }, data });
  }

  @RequirePermissions('MANAGE_INVENTORY')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}
