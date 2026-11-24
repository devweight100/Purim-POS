import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PlanningService } from './planning.service';
import { ObligationsService } from './obligations.service';
import { DashboardController } from './dashboard.controller';

@Module({
  controllers: [FinanceController, DashboardController],
  providers: [FinanceService, PlanningService, ObligationsService],
  exports: [FinanceService, PlanningService, ObligationsService],
})
export class FinanceModule {}
