import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('VIEW_REPORTS')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** ?range=today|7days|30days|month|all (default today) or startDate/endDate (YYYY-MM-DD = Bangkok day) */
  @Get('dashboard')
  async getDashboard(
    @Query('range') range?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getDashboard({ range, startDate, endDate });
  }

  @Get('sales-summary')
  async getSalesSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getSalesSummary(startDate, endDate);
  }

  /**
   * Every figure of the Reports page for a period, computed on the server.
   * ?range=today|yesterday|7days|30days|thisMonth|lastMonth|thisYear|all|custom (default 30days)
   * &start=YYYY-MM-DD&end=YYYY-MM-DD (custom; Bangkok days, end inclusive)
   * &tab=sales|bestsellers|inventory|payments|customers|purchases (omit for all)
   */
  @Get('tabs')
  async getReportTabs(
    @Request() req: any,
    @Query('range') range?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('tab') tab?: string,
  ) {
    return this.reportsService.getReportTabs({ range, start, end, tab }, req?.user);
  }

  @Get('analytics')
  async getFullAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getFullAnalytics(startDate, endDate);
  }
}
