import { Module } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { DebtsController } from './debts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerControlModule } from '../server-control/server-control.module';

@Module({
  imports: [PrismaModule, ServerControlModule],
  controllers: [DebtsController],
  providers: [DebtsService],
  exports: [DebtsService],
})
export class DebtsModule {}
