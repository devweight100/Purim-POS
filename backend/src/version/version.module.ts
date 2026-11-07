import { Module } from '@nestjs/common';
import { VersionController } from './version.controller';
import { ClientAppController } from './client-app.controller';

@Module({ controllers: [VersionController, ClientAppController] })
export class VersionModule {}
