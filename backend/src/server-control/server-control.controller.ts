import { Controller, Get, Post, Put, Body, Req, Res, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ServerControlService } from './server-control.service';
import { ServerUpdateService } from './server-update.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { parseLatency, parseLiveState, parseTerminalId, parseTerminalName, telemetryClientIp } from './telemetry-input';

@Controller('server-control')
export class ServerControlController {
  constructor(
    private readonly service: ServerControlService,
    private readonly updater: ServerUpdateService,
  ) {}

  // ---- Update the server from GitHub (store monitor page, ADMIN only) ----
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('update/status')
  updateStatus() {
    return this.updater.status();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('update/check')
  updateCheck() {
    return this.updater.check();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('update/token')
  updateToken(@Body('token') token: string) {
    return this.updater.setToken(token);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('update/run')
  updateRun(@Req() req: any) {
    return this.updater.start(req.user?.username || req.user?.sub || 'admin');
  }

  // Sales, carts and terminals of the whole store: staff with report access only.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequirePermissions('VIEW_REPORTS')
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

  /**
   * Heartbeat + live cart of a POS terminal. Requires a logged-in user (every POS screen sends
   * its JWT through apiFetch); input is whitelisted and size-capped, the user name comes from
   * the token, and the IP from the socket (X-Forwarded-For only behind a local proxy).
   */
  @UseGuards(JwtAuthGuard)
  @Post('ping')
  ping(
    @Req() req: any,
    @Body('terminalId') terminalId: unknown,
    @Body('terminalName') terminalName: unknown,
    @Body('latencyMs') latencyMs?: unknown,
    @Body('liveState') liveState?: unknown,
  ) {
    const id = parseTerminalId(terminalId);
    const state = parseLiveState(liveState);
    const userName = req.user?.fullName || req.user?.username || 'แคชเชียร์';
    this.service.recordPing(id, parseTerminalName(terminalName) as string, userName, telemetryClientIp(req), parseLatency(latencyMs), state);
    return { ok: true, timestamp: new Date().toISOString() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync-live-state')
  syncLiveState(
    @Req() req: any,
    @Body('terminalId') terminalId: unknown,
    @Body('liveState') liveState: unknown,
  ) {
    const id = parseTerminalId(terminalId);
    const state = parseLiveState(liveState);
    if (state) {
      this.service.recordLiveState(id, state, telemetryClientIp(req), req.user?.fullName || req.user?.username);
    }
    return { ok: true, timestamp: new Date().toISOString() };
  }
}
