import { assertMoveBarcodes } from './product-replace';
import { BadRequestException, NotFoundException, Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { canViewCost, costFilterFor } from './cost-visibility';
import { ServerControlService } from '../server-control/server-control.service';

/** Product ids of a bulk request: 1-500 non-empty strings (400 otherwise). */
function idList(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500 || raw.some((x) => typeof x !== 'string' || !x || x.length > 100)) {
    throw new BadRequestException('รายการสินค้าไม่ถูกต้อง (1-500 รายการ)');
  }
  return raw as string[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly serverControl: ServerControlService,
  ) {}

  @Post('bulk-upsert')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  bulkUpsert(@Body() body: { products: any[] }, @Req() req?: any) {
    return this.productsService.bulkUpsert(body?.products || [], req?.user);
  }

  @Post('supplier-import/preview')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  previewSupplierImport(@Body() body: { rows?: unknown; costMode?: unknown }, @Req() req?: any) {
    return this.productsService.previewSupplierImport(body || {}, req?.user);
  }

  @Post('supplier-import')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  importSuppliers(@Body() body: { rows?: unknown; costMode?: unknown; fileName?: unknown }, @Req() req?: any) {
    return this.productsService.importSuppliers(body || {}, req?.user);
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
    } as any, req?.user);
    return costFilterFor(req?.user)(product);
  }

  // Cost fields (costPrice, batch / supplier unitCost) are returned only to ADMIN or VIEW_COST holders.
  @Get()
  async findAll(@Query('search') search?: string, @Query('categoryId') categoryId?: string, @Req() req?: any) {
    return costFilterFor(req?.user)(await this.productsService.findAll(search, categoryId));
  }

  /**
   * Products / inventory tables: ?page&limit(<=500)&q&categoryId&supplierId&stock=all|low|out|normal|negative|reorder
   * &sort&dir=asc|desc&stats=1 (inventory cards over every product)&status=active|inactive|all (default all)
   * &exact=1: q is a whole code - SKU (any case), barcode or pack barcode - not a part of a name (PO grid code cell).
   * Rows are GET /products catalogue rows (cost fields only for VIEW_COST), meta has total / allCount.
   */
  @Get('page')
  async pageList(@Query() query: Record<string, unknown>, @Req() req?: any) {
    for (const k of ['page', 'limit', 'q', 'categoryId', 'supplierId', 'stock', 'sort', 'dir', 'stats', 'status', 'exact']) {
      if (query[k] !== undefined && typeof query[k] !== 'string') throw new BadRequestException('เงื่อนไขค้นหาไม่ถูกต้อง');
    }
    const str = (k: string) => (query[k] as string | undefined) || undefined;
    const result = await this.productsService.page({
      page: parseInt(String(query.page ?? ''), 10) || 1,
      limit: parseInt(String(query.limit ?? ''), 10) || 50,
      q: str('q'), categoryId: str('categoryId'), supplierId: str('supplierId'), stock: str('stock'), sort: str('sort'), dir: str('dir'),
      status: str('status'),
      exact: query.exact === '1' || query.exact === 'true',
      stats: query.stats === '1' || query.stats === 'true', canViewCost: canViewCost(req?.user),
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
      { canViewCost: canViewCost(req?.user), actor: req?.user },
    );
    return costFilterFor(req?.user)(product);
  }

  /** ตั้งค่า > ระบบ > ลบสินค้าทั้งหมด. A backup is taken first; no backup -> nothing is deleted (same as the full reset). */
  @Delete()
  @Roles('ADMIN')
  async removeAll() {
    const backupFile = await this.serverControl.backupBeforeWipe();
    if (!backupFile) {
      throw new BadRequestException('สำรองข้อมูลก่อนลบไม่สำเร็จ จึงยังไม่ได้ลบสินค้าใด ๆ กรุณาตรวจสอบหน้า "สำรองข้อมูล" แล้วลองใหม่');
    }
    const result = await this.productsService.removeAll();
    return { ...result, backupFile };
  }

  /**
   * Delete check (docs/product-delete.md): per product the business documents that keep it from being deleted
   * (`blockers`, `canDelete`) and the stock it still holds (`stock`; `stockValue` only for VIEW_COST).
   */
  @Get(':id/delete-check')
  @RequirePermissions('MANAGE_INVENTORY')
  async deleteCheckOne(@Param('id') id: string, @Req() req?: any) {
    const [row] = await this.productsService.deleteCheck([id]);
    if (!row) throw new NotFoundException('ไม่พบสินค้านี้');
    return this.withoutCost(row, req?.user);
  }

  @Post('delete-check')
  @RequirePermissions('MANAGE_INVENTORY')
  async deleteCheckMany(@Body() body: { ids?: unknown }, @Req() req?: any) {
    const rows = await this.productsService.deleteCheck(idList(body?.ids));
    return rows.map((r) => this.withoutCost(r, req?.user));
  }

  /**
   * Delete for good: only products no document names (else 409 PRODUCT_IN_USE with `blockers`: disable instead);
   * stock still on hand needs ?confirmStock=1 (else 409 STOCK_CONFIRM_REQUIRED).
   */
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  async remove(@Param('id') id: string, @Query('confirmStock') confirmStock?: string, @Req() req?: any) {
    const r = await this.productsService.remove(id, { confirmStock: confirmStock === '1' || confirmStock === 'true', actor: req?.user });
    return canViewCost(req?.user) ? r : { ...r, stockValue: undefined };
  }

  /**
   * Delete a used product with a replacement (docs/round-shift-today-bundle-replace.md): counts of what moves and the
   * problems (stock not 0, same product, kind, inactive, bundle cycle). ?replacementId= optional.
   */
  @Get(':id/replace-check')
  @RequirePermissions('MANAGE_INVENTORY')
  replaceCheck(@Param('id') id: string, @Query('replacementId') replacementId?: string) {
    return this.productsService.replaceCheck(id, typeof replacementId === 'string' ? replacementId : undefined);
  }

  /** Delete + move history to the replacement: { replacementId, moveBarcodes (default true) }. Same rights as delete. */
  @Post(':id/replace')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  replace(@Param('id') id: string, @Body() body: { replacementId?: unknown; moveBarcodes?: unknown }, @Req() req?: any) {
    return this.productsService.replace(id, typeof body?.replacementId === 'string' ? body.replacementId : '', {
      moveBarcodes: assertMoveBarcodes(body?.moveBarcodes),
      actor: req?.user,
    });
  }

  /** "ลบที่เลือก": deletes what may be deleted; reports `blocked` / `needsStockConfirm` / `notFound` per product. */
  @Post('bulk-delete')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_INVENTORY')
  async bulkRemove(@Body() body: { ids?: unknown; confirmStock?: unknown }, @Req() req?: any) {
    const r = await this.productsService.bulkRemove(idList(body?.ids), { confirmStock: body?.confirmStock === true, actor: req?.user });
    return canViewCost(req?.user) ? r : { ...r, deleted: r.deleted.map((d) => ({ ...d, stockValue: undefined })) };
  }

  /** ปิดการใช้งาน / เปิดใช้งาน: { ids, isActive }. */
  @Post('set-active')
  @RequirePermissions('MANAGE_INVENTORY')
  setActive(@Body() body: { ids?: unknown; isActive?: unknown }, @Req() req?: any) {
    if (typeof body?.isActive !== 'boolean') throw new BadRequestException('สถานะการใช้งานไม่ถูกต้อง');
    return this.productsService.setActive(idList(body?.ids), body.isActive, req?.user);
  }

  private withoutCost<T extends { stockValue?: number }>(row: T, user: any): T {
    return canViewCost(user) ? row : { ...row, stockValue: undefined };
  }

  @Get(':id/suppliers')
  async getSuppliers(@Param('id') id: string, @Req() req?: any) {
    return costFilterFor(req?.user)(await this.productsService.getProductSuppliers(id));
  }
}
