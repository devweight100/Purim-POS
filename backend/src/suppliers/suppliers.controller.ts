import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll() {
    return this.suppliersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Post()
  create(@Body() createSupplierDto: any) {
    return this.suppliersService.create(createSupplierDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSupplierDto: any) {
    return this.suppliersService.update(id, updateSupplierDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }

  @Get(':id/products')
  getSupplierProducts(@Param('id') id: string) {
    return this.suppliersService.getSupplierProducts(id);
  }

  @Post(':id/products')
  linkProduct(@Param('id') id: string, @Body() body: { productId: string, supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.suppliersService.linkProduct(id, body);
  }

  @Delete(':id/products/:productId')
  unlinkProduct(@Param('id') id: string, @Param('productId') productId: string) {
    return this.suppliersService.unlinkProduct(id, productId);
  }

  @Patch(':id/products/:productId')
  updateProductLink(@Param('id') id: string, @Param('productId') productId: string, @Body() body: { supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.suppliersService.updateProductLink(id, productId, body);
  }
}
