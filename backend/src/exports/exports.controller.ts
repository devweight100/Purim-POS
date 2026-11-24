import { Body, Controller, Headers, Post, Req, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { clientIp } from '../auth/login-throttle';
import { EXPORT_HEADER, ExportsService } from './exports.service';

/** Data exports: a manager / owner PIN every time (exports.service.ts). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /** { kind: products | report | profit-loss, filters, pin } -> { approvalId, approvedBy, expiresAt } */
  @Post('approve')
  approve(@Body() body: any, @Request() req: any, @Req() raw: any) {
    return this.exportsService.approve(body, req.user, clientIp(raw));
  }

  /** { filters: { categoryIds, stock, status, supplierId } } */
  @RequirePermissions('MANAGE_INVENTORY')
  @Post('products')
  products(@Body() body: any, @Headers(EXPORT_HEADER) approval: string, @Request() req: any) {
    return this.exportsService.exportProducts(approval, body?.filters, req.user);
  }

  /** { tab, params: { range, start, end } } */
  @RequirePermissions('VIEW_REPORTS')
  @Post('report')
  report(@Body() body: any, @Headers(EXPORT_HEADER) approval: string, @Request() req: any) {
    return this.exportsService.exportReport(approval, body, req.user);
  }

  /** { from, to } (YYYY-MM-DD, Bangkok days) */
  @RequirePermissions('MANAGE_FINANCE')
  @Post('profit-loss')
  profitLoss(@Body() body: any, @Headers(EXPORT_HEADER) approval: string, @Request() req: any) {
    return this.exportsService.exportProfitLoss(approval, body, req.user);
  }
}
