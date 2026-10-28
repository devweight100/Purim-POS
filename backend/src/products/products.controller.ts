import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('bulk-upsert')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  bulkUpsert(@Body() body: { products: any[] }) {
    return this.productsService.bulkUpsert(body.products || []);
  }

  @Post()
  create(@Body() createProductDto: CreateProductDto, @Req() req?: any) {
    const rawBody = req?.body || {};
    return this.productsService.create({
      ...createProductDto,
      ...(rawBody.supplierEntries !== undefined ? { supplierEntries: rawBody.supplierEntries } : {}),
      ...(rawBody.suppliers !== undefined ? { suppliers: rawBody.suppliers } : {}),
      ...(rawBody.supplierId !== undefined ? { supplierId: rawBody.supplierId } : {}),
    } as any);
  }

  @Get()
  findAll(@Query('search') search?: string, @Query('categoryId') categoryId?: string) {
    return this.productsService.findAll(search, categoryId);
  }

  @Get('barcode/:code')
  findByBarcode(@Param('code') code: string) {
    return this.productsService.findByBarcode(code);
  }

  @Get(':id/stock')
  getStock(@Param('id') id: string) {
    return this.productsService.getStock(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto, @Req() req?: any) {
    const rawBody = req?.body || {};
    return this.productsService.update(id, {
      ...updateProductDto,
      ...(rawBody.supplierEntries !== undefined ? { supplierEntries: rawBody.supplierEntries } : {}),
      ...(rawBody.suppliers !== undefined ? { suppliers: rawBody.suppliers } : {}),
      ...(rawBody.supplierId !== undefined ? { supplierId: rawBody.supplierId } : {}),
    } as any);
  }

  @Delete()
  @Roles('ADMIN')
  removeAll() {
    return this.productsService.removeAll();
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Get(':id/suppliers')
  getSuppliers(@Param('id') id: string) {
    return this.productsService.getProductSuppliers(id);
  }
}
