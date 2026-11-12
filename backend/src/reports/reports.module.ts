import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { DebtsModule } from '../debts/debts.module';
import { ClaimsModule } from '../claims/claims.module';

@Module({
  imports: [PrismaModule, ProductsModule, ShiftsModule, DebtsModule, ClaimsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
