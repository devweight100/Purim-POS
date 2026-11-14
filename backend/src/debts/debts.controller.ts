import { BadRequestException, Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { PaymentMethod } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('MANAGE_DEBTS', 'POS_SELL', 'VIEW_REPORTS')
@Controller('debts')
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Get()
  getAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('statusGroup') statusGroup?: string,
    @Query('customerId') customerId?: string,
    @Query('customerType') customerType?: string,
    @Query('stats') stats?: string,
  ) {
    for (const v of [search, status, statusGroup, customerId, customerType]) {
      if (v !== undefined && typeof v !== 'string') throw new BadRequestException('เงื่อนไขค้นหาไม่ถูกต้อง');
    }
    return this.debtsService.getAllDebts(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
      status,
      { statusGroup, customerId, customerType, stats: stats === '1' || stats === 'true' },
    );
  }

  @Get('payments-history')
  getPaymentsHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.debtsService.getDebtPaymentsHistory(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.debtsService.getDebtDetails(id);
  }

  @Post(':id/pay')
  pay(
    @Request() req: any,
    @Param('id') id: string,
    @Body('amount') amount: number,
    @Body('paymentMethod') paymentMethod?: PaymentMethod,
    @Body('referenceNo') referenceNo?: string,
    @Body('cashierName') cashierName?: string,
    @Body('note') note?: string,
    @Body('clientPaymentId') clientPaymentId?: string,
    @Body('shiftId') shiftId?: string,
    @Body('bankAccountId') bankAccountId?: string,
  ) {
    const cashier = cashierName || req.user?.fullName || 'เจ้าหน้าที่';
    return this.debtsService.payDebt(id, Number(amount), paymentMethod, referenceNo, cashier, note, clientPaymentId, shiftId, req.user?.id || req.user?.sub, bankAccountId);
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_DEBTS')
  @Post('payments/:paymentId/cancel')
  cancelPayment(@Param('paymentId') paymentId: string, @Body('reason') reason: string, @Request() req: any) {
    return this.debtsService.cancelPayment(paymentId, reason, req.user);
  }
}
