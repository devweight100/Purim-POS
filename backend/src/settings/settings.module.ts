import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { ServerControlModule } from '../server-control/server-control.module';

@Module({
  imports: [ServerControlModule], // reset takes a backup first
  controllers: [SettingsController],
})
export class SettingsModule {}
