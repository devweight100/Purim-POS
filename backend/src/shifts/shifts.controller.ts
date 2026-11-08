import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

/** Money from the request body: a number (or numeric string) >= 0 with at most 2 decimals worth keeping. */
function parseMoney(v: unknown, label: string, optional = false): number {
  if ((v === undefined || v === null || v === '') && optional) return 0;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new BadRequestException(`${label}ไม่ถูกต้อง (ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป)`);
  return Math.round(n * 100) / 100;
}

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
    const p = parseInt(String(page ?? ''), 10);
    const l = parseInt(String(limit ?? ''), 10);
    return this.shiftsService.getShiftHistory(
      Number.isFinite(p) && p > 0 ? p : 1,
      Number.isFinite(l) && l > 0 ? Math.min(l, 200) : 20,
      typeof search === 'string' ? search : undefined,
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
    return this.shiftsService.openShift(req.user.id, parseMoney(startingCash, 'เงินทอนตั้งต้น', true), note, terminalId);
  }

  @RequirePermissions('POS_SELL')
  @Post(':id/close')
  closeShift(
    @Request() req: any,
    @Param('id') id: string,
    @Body('actualCash') actualCash: number,
    @Body('note') note?: string,
  ) {
    return this.shiftsService.closeShift(id, parseMoney(actualCash, 'ยอดเงินสดที่นับได้'), note, req.user);
  }

  @RequirePermissions('POS_SELL')
  @Post(':id/cash-movements')
  addCashMovement(
    @Request() req: any,
    @Param('id') id: string,
    @Body('type') type: 'in' | 'out',
    @Body('amount') amount: number,
    @Body('reason') reason: string,
    @Body('clientMovementId') clientMovementId?: string,
    @Body('category') category?: string,
    @Body('purpose') purpose?: string,
    @Body('expenseCategoryId') expenseCategoryId?: string,
    @Body('bankAccountId') bankAccountId?: string,
    @Body('approvalId') approvalId?: string,
  ) {
    return this.shiftsService.addCashMovement(id, type, parseMoney(amount, 'จำนวนเงิน'), reason, clientMovementId, req.user, category, { purpose, expenseCategoryId, bankAccountId, approvalId });
  }
}
