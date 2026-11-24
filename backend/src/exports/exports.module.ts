import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ReportsModule } from '../reports/reports.module';
import { FinanceModule } from '../finance/finance.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [ProductsModule, ReportsModule, FinanceModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
