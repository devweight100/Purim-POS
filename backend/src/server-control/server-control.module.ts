import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerControlController } from './server-control.controller';
import { ServerControlService } from './server-control.service';
import { BackupScheduler } from './backup.scheduler';

@Module({
  imports: [PrismaModule],
  controllers: [ServerControlController],
  providers: [ServerControlService, BackupScheduler],
  exports: [ServerControlService],
})
export class ServerControlModule {}
