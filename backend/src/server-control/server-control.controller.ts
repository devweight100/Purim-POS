import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ServerControlService } from './server-control.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@Controller('server-control')
export class ServerControlController {
  constructor(private readonly service: ServerControlService) {}

  @Get('telemetry')
  getTelemetry() {
    return this.service.getTelemetry();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('VIEW_REPORTS')
  @Get('backups')
  listBackups() {
    return this.service.listBackups();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('backup')
  createBackup() {
    return this.service.createBackup();
  }

  @Post('ping')
  ping(
    @Req() req: any,
    @Body('terminalId') terminalId: string,
    @Body('terminalName') terminalName: string,
    @Body('userName') userName: string,
    @Body('latencyMs') latencyMs?: number,
    @Body('liveState') liveState?: any,
  ) {
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const clientIp = typeof rawIp === 'string' ? rawIp.replace('::ffff:', '') : '127.0.0.1';
    this.service.recordPing(terminalId || 'UNKNOWN', terminalName, userName, clientIp, latencyMs || 5, liveState);
    return { ok: true, timestamp: new Date().toISOString() };
  }

  @Post('sync-live-state')
  syncLiveState(
    @Req() req: any,
    @Body('terminalId') terminalId: string,
    @Body('liveState') liveState: any,
  ) {
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const clientIp = typeof rawIp === 'string' ? rawIp.replace('::ffff:', '') : '127.0.0.1';
    if (terminalId && liveState) {
      this.service.recordLiveState(terminalId, liveState, clientIp);
    }
    return { ok: true, timestamp: new Date().toISOString() };
  }
}
