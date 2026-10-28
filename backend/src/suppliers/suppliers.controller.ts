import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @RequirePermissions('MANAGE_PURCHASES', 'MANAGE_PAYABLES', 'MANAGE_INVENTORY')
  @Get()
  findAll() {
    return this.suppliersService.findAll();
  }

  @RequirePermissions('MANAGE_PURCHASES', 'MANAGE_PAYABLES', 'MANAGE_INVENTORY')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @RequirePermissions('MANAGE_PURCHASES')
  @Post()
  create(@Body() createSupplierDto: any) {
    return this.suppliersService.create(createSupplierDto);
  }

  @RequirePermissions('MANAGE_PURCHASES')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSupplierDto: any) {
    return this.suppliersService.update(id, updateSupplierDto);
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_PURCHASES')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }

  @RequirePermissions('MANAGE_PURCHASES', 'MANAGE_PAYABLES', 'MANAGE_INVENTORY')
  @Get(':id/products')
  getSupplierProducts(@Param('id') id: string) {
    return this.suppliersService.getSupplierProducts(id);
  }

  @RequirePermissions('MANAGE_PURCHASES')
  @Post(':id/products')
  linkProduct(@Param('id') id: string, @Body() body: { productId: string, supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.suppliersService.linkProduct(id, body);
  }

  @RequirePermissions('MANAGE_PURCHASES')
  @Delete(':id/products/:productId')
  unlinkProduct(@Param('id') id: string, @Param('productId') productId: string) {
    return this.suppliersService.unlinkProduct(id, productId);
  }

  @RequirePermissions('MANAGE_PURCHASES')
  @Patch(':id/products/:productId')
  updateProductLink(@Param('id') id: string, @Param('productId') productId: string, @Body() body: { supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.suppliersService.updateProductLink(id, productId, body);
  }
}
