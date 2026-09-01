import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get('current')
  getCurrentShift(@Request() req: any) {
    return this.shiftsService.getCurrentShift(req.user.id);
  }

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

  @Get(':id/summary')
  getSummary(@Param('id') id: string) {
    return this.shiftsService.getShiftSummary(id);
  }

  @Post('open')
  openShift(
    @Request() req: any,
    @Body('startingCash') startingCash: number,
    @Body('note') note?: string,
  ) {
    return this.shiftsService.openShift(req.user.id, Number(startingCash) || 0, note);
  }

  @Post(':id/close')
  closeShift(
    @Param('id') id: string,
    @Body('actualCash') actualCash: number,
    @Body('note') note?: string,
  ) {
    return this.shiftsService.closeShift(id, Number(actualCash) || 0, note);
  }
}
