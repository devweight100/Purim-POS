import { BadRequestException, Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req } from '@nestjs/common';
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

  /**
   * Products management table: ?page&limit(<=500)&q&categoryId&supplierId&stock=all|low|out&sort&dir=asc|desc.
   * Rows are GET /products catalogue rows (cost fields only for VIEW_COST), meta has total / allCount.
   */
  @Get('page')
  async pageList(@Query() query: Record<string, unknown>, @Req() req?: any) {
    for (const k of ['page', 'limit', 'q', 'categoryId', 'supplierId', 'stock', 'sort', 'dir']) {
      if (query[k] !== undefined && typeof query[k] !== 'string') throw new BadRequestException('เงื่อนไขค้นหาไม่ถูกต้อง');
    }
    const str = (k: string) => (query[k] as string | undefined) || undefined;
    const result = await this.productsService.page({
      page: parseInt(String(query.page ?? ''), 10) || 1,
      limit: parseInt(String(query.limit ?? ''), 10) || 50,
      q: str('q'), categoryId: str('categoryId'), supplierId: str('supplierId'), stock: str('stock'), sort: str('sort'), dir: str('dir'),
    });
    return { ...result, data: costFilterFor(req?.user)(result.data) };
  }

  /**
   * Mobile summary page (/m): read-only search with stock, packs and prices, paged.
   * ?q=&filter=all|low|out&page=&limit= (max 50). VIEW_REPORTS (ADMIN / MANAGER always); cost only with VIEW_COST.
   */
  @Get('lookup')
  @RequirePermissions('VIEW_REPORTS')
  async lookup(
    @Query('q') q?: string,
    @Query('filter') filter?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    if (q !== undefined && typeof q !== 'string') throw new BadRequestException('คำค้นหาไม่ถูกต้อง');
    const result = await this.productsService.lookup({ q, filter, page: parseInt(String(page ?? ''), 10) || 1, limit: parseInt(String(limit ?? ''), 10) || 20 });
    return { ...result, data: costFilterFor(req?.user)(result.data), canViewCost: canViewCost(req?.user) };
  }

  /**
   * POS catalogue delta sync. No / old cursor: every product (`full: true`); else the products changed since the
   * cursor plus the ids of deleted ones. Always returns the cursor for the next call. Cost fields as GET /products.
   */
  @Get('sync')
  async sync(@Query('since') since?: string, @Req() req?: any) {
    const result = await this.productsService.sync(typeof since === 'string' ? since : undefined);
    return { ...result, products: costFilterFor(req?.user)(result.products) };
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
