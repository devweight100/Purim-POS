import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SupplierReturnsService } from './supplier-returns.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('MANAGE_CLAIMS', 'MANAGE_PURCHASES')
@Controller('supplier-returns')
export class SupplierReturnsController {
  constructor(private readonly returnsService: SupplierReturnsService) {}

  @Get()
  getAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('available') available?: string,
  ) {
    return this.returnsService.getAllReturnNotes(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      supplierId,
      status,
      available === '1' || available === 'true',
    ).then((r) => this.returnsService.withDocNames(r));
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.returnsService.getReturnNoteDetails(id).then((r) => this.returnsService.withDocNames(r));
  }

  // credit notes change what we owe suppliers: purchasing / payables staff only (not claims alone)
  @RequirePermissions('MANAGE_PURCHASES', 'MANAGE_PAYABLES')
  @Post()
  create(@Body() body: any) {
    return this.returnsService.createReturnNote(body).then((r) => this.returnsService.withDocNames(r));
  }

  // credit notes change what we owe suppliers: purchasing / payables staff only (not claims alone)
  @RequirePermissions('MANAGE_PURCHASES', 'MANAGE_PAYABLES')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.returnsService.updateReturnNote(id, body).then((r) => this.returnsService.withDocNames(r));
  }

  /** "ใช้ชื่อร้าน / ใช้ชื่อผู้ผลิต" of this note (any status; reprints keep it). Body { mode: 'SHOP' | 'SUPPLIER' }. */
  @RequirePermissions('MANAGE_PURCHASES', 'MANAGE_PAYABLES')
  @Patch(':id/doc-name-mode')
  setDocNameMode(@Param('id') id: string, @Body() body: { mode?: string }) {
    return this.returnsService.setDocNameMode(id, body?.mode).then((r) => this.returnsService.withDocNames(r));
  }

  // Credit notes are applied to supplier bills only through payment vouchers (/payables/settle-multiple),
  // so the old stand-alone POST /supplier-returns/:id/deduct endpoint was removed.

  // credit notes change what we owe suppliers: purchasing / payables staff only (not claims alone)
  @RequirePermissions('MANAGE_PURCHASES', 'MANAGE_PAYABLES')
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.returnsService.cancelReturnNote(id, reason).then((r) => this.returnsService.withDocNames(r));
  }
}
