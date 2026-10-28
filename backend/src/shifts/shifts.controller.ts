import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @RequirePermissions('POS_SELL')
  @Get('current')
  getCurrentShift(@Request() req: any, @Query('terminalId') terminalId?: string) {
    return this.shiftsService.getCurrentShift(req.user.id, terminalId);
  }

  @RequirePermissions('POS_SELL', 'VIEW_REPORTS')
  @Get('history')
  getHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.shiftsService.getShiftHistory(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  @RequirePermissions('POS_SELL', 'VIEW_REPORTS')
  @Get(':id/summary')
  getSummary(@Param('id') id: string) {
    return this.shiftsService.getShiftSummary(id);
  }

  @RequirePermissions('POS_SELL')
  @Post('open')
  openShift(
    @Request() req: any,
    @Body('startingCash') startingCash: number,
    @Body('terminalId') terminalId: string,
    @Body('note') note?: string,
  ) {
    return this.shiftsService.openShift(req.user.id, Number(startingCash) || 0, note, terminalId);
  }

  @RequirePermissions('POS_SELL')
  @Post(':id/close')
  closeShift(
    @Param('id') id: string,
    @Body('actualCash') actualCash: number,
    @Body('note') note?: string,
  ) {
    return this.shiftsService.closeShift(id, Number(actualCash) || 0, note);
  }

  @RequirePermissions('POS_SELL')
  @Post(':id/cash-movements')
  addCashMovement(
    @Param('id') id: string,
    @Body('type') type: 'in' | 'out',
    @Body('amount') amount: number,
    @Body('reason') reason: string,
    @Body('clientMovementId') clientMovementId?: string,
  ) {
    return this.shiftsService.addCashMovement(id, type, Number(amount) || 0, reason, clientMovementId);
  }
}
