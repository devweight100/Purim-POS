import { Controller, Get, Post, Put, Body, Req, Res, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @Get('backup-status')
  backupStatus() {
    return this.service.getBackupStatus();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @Post('backup-verify')
  verifyBackup(@Query('file') file: string) {
    return this.service.verifyBackup(file);
  }

  /** Folder on another disk / cloud-synced folder that receives a copy of every backup. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Put('backup-settings')
  async backupSettings(@Body('offsiteDir') offsiteDir?: string) {
    try {
      return await this.service.setOffsiteDir(offsiteDir);
    } catch (err) {
      throw new BadRequestException(`ใช้โฟลเดอร์นี้ไม่ได้: ${err instanceof Error ? err.message : err}`);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('backups/:fileName/download')
  download(@Param('fileName') fileName: string, @Res() res: any) {
    let full: string;
    try {
      full = this.service.backupFilePath(fileName);
    } catch {
      throw new BadRequestException('ไม่พบไฟล์สำรองข้อมูล');
    }
    return res.download(full, fileName);
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
