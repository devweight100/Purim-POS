import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PlanningService } from './planning.service';

@Module({ controllers: [FinanceController], providers: [FinanceService, PlanningService], exports: [FinanceService, PlanningService] })
export class FinanceModule {}
