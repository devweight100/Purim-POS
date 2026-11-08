import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { rethrowPrismaError } from '../products/prisma-errors';

const ALLOWED_FIELDS = ['name', 'color', 'icon', 'sortOrder', 'isActive'];

/**
 * Validate a category body (no DTO class on purpose: the global whitelist pipe would silently
 * drop unknown fields, but an unknown field here is a client bug and gets a 400).
 */
export function validateCategoryInput(body: any, partial: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('ข้อมูลหมวดหมู่ไม่ถูกต้อง');
  const extra = Object.keys(body).filter((k) => !ALLOWED_FIELDS.includes(k));
  if (extra.length) throw new BadRequestException(`ไม่รู้จักข้อมูล: ${extra.join(', ')}`);
  const data: Record<string, any> = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new BadRequestException('กรุณาระบุชื่อหมวดหมู่');
    if (name.length > 100) throw new BadRequestException('ชื่อหมวดหมู่ยาวเกิน 100 ตัวอักษร');
    data.name = name;
  }
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(body.color.trim())) throw new BadRequestException('รหัสสีไม่ถูกต้อง (เช่น #6366f1)');
    data.color = body.color.trim();
  }
  if (body.icon !== undefined) {
    if (body.icon !== null && typeof body.icon !== 'string') throw new BadRequestException('ไอคอนไม่ถูกต้อง');
    data.icon = body.icon;
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000) throw new BadRequestException('ลำดับการแสดงต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
    data.sortOrder = n;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw new BadRequestException('สถานะการใช้งานไม่ถูกต้อง');
    data.isActive = body.isActive;
  }
  if (partial && Object.keys(data).length === 0) throw new BadRequestException('ไม่มีข้อมูลที่จะแก้ไข');
  return data;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertNameFree(name: string | undefined, selfId?: string) {
    if (!name) return;
    const other = await this.prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (other && other.id !== selfId) throw new ConflictException(`มีหมวดหมู่ชื่อ "${name}" อยู่แล้ว`);
  }

  @RequirePermissions('MANAGE_INVENTORY')
  @Post()
  async create(@Body() body: any) {
    const data = validateCategoryInput(body, false);
    await this.assertNameFree(data.name);
    return this.prisma.category.create({ data: data as any }).catch((err) => rethrowPrismaError(err, { conflict: `มีหมวดหมู่ชื่อ "${data.name}" อยู่แล้ว` }));
  }

  @Get()
  findAll() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('ไม่พบหมวดหมู่นี้');
    return category;
  }

  @RequirePermissions('MANAGE_INVENTORY')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const data = validateCategoryInput(body, true);
    const existing = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('ไม่พบหมวดหมู่นี้');
    await this.assertNameFree(data.name, id);
    return this.prisma.category.update({ where: { id }, data }).catch((err) => rethrowPrismaError(err, { conflict: `มีหมวดหมู่ชื่อ "${data.name}" อยู่แล้ว`, notFound: 'ไม่พบหมวดหมู่นี้' }));
  }

  // Products in a deleted category become uncategorised (Product.categoryId is optional, ON DELETE SET NULL).
  @RequirePermissions('MANAGE_INVENTORY')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('ไม่พบหมวดหมู่นี้');
    return this.prisma.category.delete({ where: { id } }).catch((err) => rethrowPrismaError(err, { notFound: 'ไม่พบหมวดหมู่นี้', badRef: 'ไม่สามารถลบหมวดหมู่ที่ยังมีสินค้าอยู่ได้' }));
  }
}
