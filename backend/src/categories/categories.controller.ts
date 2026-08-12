import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.prisma.category.update({ where: { id }, data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}
