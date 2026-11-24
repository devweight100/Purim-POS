import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { ObligationsService } from './obligations.service';

/** Dashboard figures that are not sales (Round B item 8). Same right as the dashboard page (VIEW_REPORTS). */
@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('VIEW_REPORTS')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly obligations: ObligationsService) {}

  /** creditors (supplier bills owed, overdue, per supplier) + upcoming expenses within ?days= (default: setting, 7) */
  @Get('obligations')
  obligationsSummary(@Query('days') days?: string) {
    return this.obligations.summary({ days });
  }
}
