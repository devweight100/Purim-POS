import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { canViewCost, costFilterFor } from './cost-visibility';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('bulk-upsert')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  bulkUpsert(@Body() body: { products: any[] }, @Req() req?: any) {
    return this.productsService.bulkUpsert(body?.products || [], req?.user);
  }

  // Creating / editing products (incl. prices and cost) needs MANAGE_INVENTORY (owner decision).
  @Post()
  @RequirePermissions('MANAGE_INVENTORY')
  async create(@Body() createProductDto: CreateProductDto, @Req() req?: any) {
    const rawBody = req?.body || {};
    const product = await this.productsService.create({
      ...createProductDto,
      ...(rawBody.supplierEntries !== undefined ? { supplierEntries: rawBody.supplierEntries } : {}),
      ...(rawBody.suppliers !== undefined ? { suppliers: rawBody.suppliers } : {}),
      ...(rawBody.supplierId !== undefined ? { supplierId: rawBody.supplierId } : {}),
    } as any);
    return costFilterFor(req?.user)(product);
  }

  // Cost fields (costPrice, batch / supplier unitCost) are returned only to ADMIN or VIEW_COST holders.
  @Get()
  async findAll(@Query('search') search?: string, @Query('categoryId') categoryId?: string, @Req() req?: any) {
    return costFilterFor(req?.user)(await this.productsService.findAll(search, categoryId));
  }

  @Get('barcode/:code')
  async findByBarcode(@Param('code') code: string, @Req() req?: any) {
    return costFilterFor(req?.user)(await this.productsService.findByBarcode(code));
  }

  @Get(':id/stock')
  getStock(@Param('id') id: string) {
    return this.productsService.getStock(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req?: any) {
    return costFilterFor(req?.user)(await this.productsService.findOne(id));
  }

  @Patch(':id')
  @RequirePermissions('MANAGE_INVENTORY')
  async update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto, @Req() req?: any) {
    const rawBody = req?.body || {};
    const product = await this.productsService.update(
      id,
      {
        ...updateProductDto,
        ...(rawBody.supplierEntries !== undefined ? { supplierEntries: rawBody.supplierEntries } : {}),
        ...(rawBody.suppliers !== undefined ? { suppliers: rawBody.suppliers } : {}),
        ...(rawBody.supplierId !== undefined ? { supplierId: rawBody.supplierId } : {}),
      } as any,
      { canViewCost: canViewCost(req?.user) },
    );
    return costFilterFor(req?.user)(product);
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
  async getSuppliers(@Param('id') id: string, @Req() req?: any) {
    return costFilterFor(req?.user)(await this.productsService.getProductSuppliers(id));
  }
}
