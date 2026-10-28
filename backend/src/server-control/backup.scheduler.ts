import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ServerControlService } from './server-control.service';

/**
 * Tiny in-process scheduler (no @nestjs/schedule dependency).
 * - Daily backup at BACKUP_TIME (HH:MM local, default 23:30)
 * - At startup: backup if the newest backup is older than 24h (or none exists)
 * - BACKUP_AUTO=false disables everything.
 */
@Injectable()
export class BackupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('BackupScheduler');
  private timer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;
  private lastRunDay = '';
  private running = false;

  constructor(private readonly service: ServerControlService) {}

  private target(): { h: number; m: number } {
    const m = /^(\d{1,2}):(\d{2})$/.exec(process.env.BACKUP_TIME || '23:30');
    const h = m ? Math.min(23, +m[1]) : 23;
    const min = m ? Math.min(59, +m[2]) : 30;
    return { h, m: min };
  }

  private nextRun(): Date {
    const { h, m } = this.target();
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }

  private async run(reason: string) {
    if (this.running) return;
    this.running = true;
    this.logger.log(`Starting automatic backup (${reason})`);
    try {
      await this.service.runScheduledBackup();
    } finally {
      this.running = false;
      this.service.setNextBackupRunAt(this.nextRun().toISOString());
    }
  }

  onModuleInit() {
    if ((process.env.BACKUP_AUTO || 'true').toLowerCase() === 'false') {
      this.logger.log('Automatic backup disabled (BACKUP_AUTO=false)');
      return;
    }
    const { h, m } = this.target();
    this.service.setNextBackupRunAt(this.nextRun().toISOString());
    this.logger.log(`Automatic backup scheduled daily at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

    this.startupTimer = setTimeout(async () => {
      try {
        const newest = await this.service.getNewestBackupTime();
        if (!newest || Date.now() - newest.getTime() > 24 * 3600 * 1000) {
          await this.run('startup: last backup older than 24h');
        }
      } catch (e) {
        this.logger.warn(`Startup backup check failed: ${e instanceof Error ? e.message : e}`);
      }
    }, 30_000);

    this.timer = setInterval(() => {
      const now = new Date();
      const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
      if (now.getHours() === h && now.getMinutes() === m && this.lastRunDay !== day) {
        this.lastRunDay = day;
        void this.run('daily schedule');
      }
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }
}
