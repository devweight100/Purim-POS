import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SupplierReturnsService } from './supplier-returns.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('supplier-returns')
export class SupplierReturnsController {
  constructor(private readonly returnsService: SupplierReturnsService) {}

  @Get()
  getAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
  ) {
    return this.returnsService.getAllReturnNotes(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      supplierId,
      status,
    );
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.returnsService.getReturnNoteDetails(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.returnsService.createReturnNote(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.returnsService.updateReturnNote(id, body);
  }

  // Credit notes are applied to supplier bills only through payment vouchers (/payables/settle-multiple),
  // so the old stand-alone POST /supplier-returns/:id/deduct endpoint was removed.

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.returnsService.cancelReturnNote(id, reason);
  }
}
