import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ClaimType } from '@prisma/client';
import { ClaimsService, FRONTEND_STATUSES } from './claims.service';
import { ClaimScreensService, CLAIM_LIST_SORTS, RESOLUTION_FILTERS, parsePageParam } from './claim-screens.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('MANAGE_CLAIMS', 'POS_SELL')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService, private readonly screens: ClaimScreensService) {}

  @Get()
  getAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    const intParam = (raw: string | undefined, fallback: number, min: number, max: number, label: string) => {
      if (raw === undefined || raw === '') return fallback;
      if (!/^\d+$/.test(String(raw))) throw new BadRequestException(`${label} ต้องเป็นจำนวนเต็ม`);
      const n = Number(raw);
      if (n < min || n > max) throw new BadRequestException(`${label} ต้องอยู่ระหว่าง ${min}-${max}`);
      return n;
    };
    const knownStatuses = ['ALL', 'PENDING', 'IN_PROGRESS', ...FRONTEND_STATUSES];
    if (status !== undefined && status !== '' && (typeof status !== 'string' || !knownStatuses.includes(status))) {
      throw new BadRequestException('สถานะเคลมไม่ถูกต้อง');
    }
    if (type !== undefined && type !== '' && (typeof type !== 'string' || !['ALL', ...Object.values(ClaimType)].includes(type as any))) {
      throw new BadRequestException('ประเภทเคลมไม่ถูกต้อง');
    }
    if (search !== undefined && (typeof search !== 'string' || search.length > 200)) throw new BadRequestException('คำค้นหาไม่ถูกต้อง');
    return this.claimsService.getAllClaims(
      intParam(page, 1, 1, 100000, 'page'),
      intParam(limit, 20, 1, 10000, 'limit'), // the reports page loads all claims (limit=5000)
      status || undefined,
      type || undefined,
      search,
    );
  }

  /**
   * Claims page over every claim: ?page&limit&search&resolutionType&startDate&endDate&sort -> GET /claims rows of
   * the page + meta + summary cards (over every claim).
   */
  @Get('list')
  list(@Query() q: Record<string, unknown>) {
    const text = (v: unknown, label: string, max = 200) => {
      if (v === undefined) return undefined;
      if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${label}ไม่ถูกต้อง`);
      return v;
    };
    const resolutionType = text(q.resolutionType, 'ประเภทการรับเคลม', 40);
    if (resolutionType && !(RESOLUTION_FILTERS as readonly string[]).includes(resolutionType)) throw new BadRequestException('ประเภทการรับเคลมไม่ถูกต้อง');
    const sort = text(q.sort, 'การเรียงลำดับ', 40);
    if (sort && !(CLAIM_LIST_SORTS as readonly string[]).includes(sort)) throw new BadRequestException('การเรียงลำดับไม่ถูกต้อง');
    return this.screens.list(
      {
        page: parsePageParam(q.page, 1, 1_000_000, 'page'),
        limit: parsePageParam(q.limit, 15, 500, 'limit'),
        search: text(q.search, 'คำค้นหา'),
        resolutionType,
        startDate: text(q.startDate, 'วันที่เริ่มต้น', 40),
        endDate: text(q.endDate, 'วันที่สิ้นสุด', 40),
        sort,
      },
      (ids) => this.claimsService.mergedClaimsByIds(ids),
    );
  }

  /** Dashboard: claim refunds (count, amount) with a claim date from ?from=<ms> on (every claim without it). */
  @Get('refund-summary')
  refundSummary(@Query('from') from?: string) {
    if (from !== undefined && (typeof from !== 'string' || !/^-?\d{1,16}$/.test(from))) throw new BadRequestException('from ไม่ถูกต้อง');
    return this.screens.refundSummary(from === undefined ? undefined : Number(from));
  }

  /** ?orderIds=a,b (<= 500): every claim of these bills (GET /claims rows): the claim eligibility check. */
  @Get('by-orders')
  async byOrders(@Query('orderIds') orderIds?: string) {
    if (orderIds !== undefined && typeof orderIds !== 'string') throw new BadRequestException('รายการบิลไม่ถูกต้อง');
    const ids = [...new Set(String(orderIds || '').split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length > 500) throw new BadRequestException('ขอได้ครั้งละไม่เกิน 500 บิล');
    if (!ids.length) return { data: [], meta: { total: 0 } };
    const data = await this.claimsService.mergedClaimsByIds(await this.screens.claimIdsOfOrders(ids));
    return { data, meta: { total: data.length } };
  }

  /** Supplier returns page: returnable claims per resolved supplier (counts, values, first three claims). */
  @Get('returnable/summary')
  returnableSummary(@Request() req: any) {
    return this.screens.returnableSummary(req.user);
  }

  /** Create-return dialog: ?supplierId&scope=supplier|other&search&page&limit -> returnable claims grouped by product. */
  @Get('returnable/groups')
  returnableGroups(@Request() req: any, @Query() q: Record<string, unknown>) {
    if (typeof q.supplierId !== 'string' || !q.supplierId || q.supplierId.length > 100) throw new BadRequestException('กรุณาเลือกผู้จำหน่าย');
    if (q.scope !== undefined && q.scope !== 'supplier' && q.scope !== 'other') throw new BadRequestException('scope ไม่ถูกต้อง');
    if (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 200)) throw new BadRequestException('คำค้นหาไม่ถูกต้อง');
    return this.screens.returnableGroups(req.user, {
      supplierId: q.supplierId,
      scope: q.scope === 'other' ? 'other' : 'supplier',
      search: q.search as string | undefined,
      page: parsePageParam(q.page, 1, 1_000_000, 'page'),
      limit: parsePageParam(q.limit, 50, 500, 'limit'),
    });
  }

  /** Claim-stock page: ?status=IN_STOCK|RETURNED|ALL&supplierId&category&search&page&limit&recordsPage&recordsLimit. */
  @Get('claim-stock')
  claimStock(@Request() req: any, @Query() q: Record<string, unknown>) {
    return this.screens.claimStock(req.user, {
      ...this.stockFilters(q),
      page: parsePageParam(q.page, 1, 1_000_000, 'page'),
      limit: parsePageParam(q.limit, 15, 500, 'limit'),
      recordsPage: parsePageParam(q.recordsPage, 1, 1_000_000, 'recordsPage'),
      recordsLimit: parsePageParam(q.recordsLimit, 50, 500, 'recordsLimit'),
    });
  }

  /** Claims of one product row of the claim-stock page: same filters + ?productId&sku&rowSupplierId. */
  @Get('claim-stock/claims')
  claimStockClaims(@Request() req: any, @Query() q: Record<string, unknown>) {
    for (const k of ['productId', 'sku', 'rowSupplierId']) {
      if (typeof q[k] !== 'string' || (q[k] as string).length > 200) throw new BadRequestException(`${k} ไม่ถูกต้อง`);
    }
    return this.screens.claimStockClaims(req.user, {
      ...this.stockFilters(q),
      productId: q.productId as string,
      sku: q.sku as string,
      rowSupplierId: q.rowSupplierId as string,
    });
  }

  private stockFilters(q: Record<string, unknown>) {
    for (const k of ['status', 'supplierId', 'category', 'search']) {
      if (q[k] !== undefined && (typeof q[k] !== 'string' || (q[k] as string).length > 200)) throw new BadRequestException(`${k} ไม่ถูกต้อง`);
    }
    if (q.status !== undefined && !['IN_STOCK', 'RETURNED', 'ALL'].includes(q.status as string)) throw new BadRequestException('สถานะไม่ถูกต้อง');
    return { status: q.status as string | undefined, supplierId: q.supplierId as string | undefined, category: q.category as string | undefined, search: q.search as string | undefined };
  }

  /** ?orderIds=a,b (<= 500): ids of these bills that have a claim (by order id or by bill number). */
  @Get('claimed-orders')
  getClaimedOrders(@Query('orderIds') orderIds?: string) {
    if (orderIds !== undefined && typeof orderIds !== 'string') throw new BadRequestException('รายการบิลไม่ถูกต้อง');
    const ids = [...new Set(String(orderIds || '').split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length > 500) throw new BadRequestException('ขอได้ครั้งละไม่เกิน 500 บิล');
    return ids.length ? this.claimsService.getClaimedOrderIds(ids) : [];
  }

  /** Every claim that can still go back to a supplier (supplier returns page). */
  @Get('returnable')
  getReturnable() {
    return this.claimsService.getReturnableClaims();
  }

  @Get('warranties/list')
  getWarrantiesList() {
    return this.claimsService.getReplacementWarranties();
  }

  @Get('warranties')
  getWarranties() {
    return this.claimsService.getReplacementWarranties();
  }

  @Post('warranties')
  createWarranty(@Body() body: any) {
    return this.claimsService.saveReplacementWarranty(body);
  }

  @Patch('warranties/:id')
  updateWarranty(@Param('id') id: string, @Body() body: any) {
    return this.claimsService.updateReplacementWarranty(id, body);
  }

  @Get('inventory/list')
  getClaimInventoryList() {
    return this.claimsService.getClaimInventory();
  }

  @Get('inventory')
  getClaimInventory() {
    return this.claimsService.getClaimInventory();
  }

  @RequirePermissions('MANAGE_CLAIMS', 'MANAGE_INVENTORY')
  @Post('inventory')
  createClaimInventory(@Body() body: any) {
    return this.claimsService.createClaimInventory(body);
  }

  @RequirePermissions('MANAGE_CLAIMS', 'MANAGE_INVENTORY')
  @Patch('inventory/:id')
  updateClaimInventory(@Param('id') id: string, @Body() body: any) {
    return this.claimsService.updateClaimInventory(id, body);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.claimsService.getClaimDetails(id);
  }

  @Post()
  create(@Body() body: any, @Request() req: any) {
    return this.claimsService.createClaim(body, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.claimsService.updateClaim(id, body, req.user);
  }
}
