import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ClaimType } from '@prisma/client';
import { ClaimsService, FRONTEND_STATUSES } from './claims.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('MANAGE_CLAIMS', 'POS_SELL')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

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
      intParam(limit, 20, 1, 500, 'limit'),
      status || undefined,
      type || undefined,
      search,
    );
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
