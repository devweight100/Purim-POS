import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
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
    return this.claimsService.getAllClaims(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      status,
      type,
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

  @Post('inventory')
  createClaimInventory(@Body() body: any) {
    return this.claimsService.createClaimInventory(body);
  }

  @Patch('inventory/:id')
  updateClaimInventory(@Param('id') id: string, @Body() body: any) {
    return this.claimsService.updateClaimInventory(id, body);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.claimsService.getClaimDetails(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.claimsService.createClaim(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.claimsService.updateClaim(id, body);
  }
}
