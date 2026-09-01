import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { PayablesService, SettleMultipleBillsDto } from './payables.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('payables')
export class PayablesController {
  constructor(private readonly payablesService: PayablesService) {}

  @Get('bills')
  getPayableBills(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('supplierId') supplierId?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('search') search?: string,
  ) {
    return this.payablesService.getPayableBills(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
      supplierId,
      paymentStatus,
      search,
    );
  }

  @Get('suppliers-summary')
  getSupplierSummaries() {
    return this.payablesService.getSupplierSummaries();
  }

  @Post('settle-multiple')
  settleMultiple(@Request() req: any, @Body() dto: SettleMultipleBillsDto) {
    if (!dto.cashierName) {
      dto.cashierName = req.user?.fullName || 'เจ้าหน้าที่การเงิน';
    }
    return this.payablesService.settleMultipleBills(dto);
  }

  @Get('vouchers')
  getVouchers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.payablesService.getVouchers(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
      status,
    );
  }

  @Get('vouchers/:id')
  getVoucherDetails(@Param('id') id: string) {
    return this.payablesService.getVoucherDetails(id);
  }

  @Post('vouchers/:id/cancel')
  cancelVoucher(@Param('id') id: string, @Body('reason') reason: string) {
    return this.payablesService.cancelVoucher(id, reason);
  }
}
