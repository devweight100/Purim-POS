import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * "Update from GitHub" for the server machine, driven from the store monitor page.
 * Runs Installer/Server/setup/update-from-github.ps1 (Windows installs made by the server installer).
 */
@Injectable()
export class ServerUpdateService {
  private readonly logger = new Logger(ServerUpdateService.name);

  /** Install folder = parent of backend/ (or PURIM_INSTALL_DIR). */
  private installDir(): string {
    return process.env.PURIM_INSTALL_DIR || path.resolve(process.cwd(), '..');
  }

  private scriptPath(): string {
    return path.join(
      this.installDir(),
      'Installer',
      'Server',
      'setup',
      'update-from-github.ps1',
    );
  }

  private powershell(): string {
    const winDir = process.env.WINDIR || 'C:\\Windows';
    return path.join(
      winDir,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
  }

  private readJson(file: string): any {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
  }

  private ensureSupported() {
    if (process.platform !== 'win32') {
      throw new BadRequestException(
        'อัปเดตจาก GitHub ใช้ได้เฉพาะเครื่องแม่ที่ติดตั้งด้วยตัวติดตั้ง Windows',
      );
    }
    if (!fs.existsSync(this.scriptPath())) {
      throw new BadRequestException(
        'ไม่พบสคริปต์อัปเดต — ติดตั้งเครื่องแม่ด้วย Purim-POS-Server-Setup.exe ตัวล่าสุดก่อน',
      );
    }
  }

  private statusFile() {
    return path.join(this.installDir(), 'logs', 'update-status.json');
  }

  private isRunning(status: any): boolean {
    if (!status || status.state !== 'running') return false;
    // a run that has not reported for 40 minutes is treated as dead
    const at = Date.parse(status.at || '');
    return Number.isFinite(at) && Date.now() - at < 40 * 60 * 1000;
  }

  status() {
    const dir = this.installDir();
    const status = this.readJson(this.statusFile());
    return {
      supported:
        process.platform === 'win32' && fs.existsSync(this.scriptPath()),
      installed: this.readJson(path.join(dir, 'VERSION.json')),
      tokenConfigured: fs.existsSync(path.join(dir, 'update-token.dat')),
      status,
      running: this.isRunning(status),
    };
  }

  private runScript(
    mode: 'check' | 'set-token',
    extraEnv: Record<string, string> = {},
  ): Promise<any> {
    const out = path.join(
      os.tmpdir(),
      `purim-update-${mode}-${Date.now()}.json`,
    );
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this.scriptPath(),
      '-InstallDir',
      this.installDir(),
      '-Mode',
      mode,
      '-JsonFile',
      out,
    ];
    return new Promise((resolve) => {
      execFile(
        this.powershell(),
        args,
        {
          windowsHide: true,
          timeout: 60000,
          env: { ...process.env, ...extraEnv },
        },
        (err, _stdout, stderr) => {
          const result = this.readJson(out);
          try {
            fs.unlinkSync(out);
          } catch {}
          if (result) return resolve(result);
          resolve({
            ok: false,
            message: String(stderr || err?.message || 'ตรวจสอบไม่สำเร็จ')
              .trim()
              .slice(0, 500),
          });
        },
      );
    });
  }

  async check() {
    this.ensureSupported();
    return this.runScript('check');
  }

  async setToken(token: string) {
    this.ensureSupported();
    const t = String(token || '').trim();
    if (t.length < 20 || /\s/.test(t))
      throw new BadRequestException('รูปแบบ token ไม่ถูกต้อง');
    const res = await this.runScript('set-token', { PURIM_GH_TOKEN: t });
    if (!res?.ok)
      throw new BadRequestException(res?.message || 'บันทึก token ไม่สำเร็จ');
    return res;
  }

  start(actor: string) {
    this.ensureSupported();
    const current = this.readJson(this.statusFile());
    if (this.isRunning(current))
      throw new ConflictException('กำลังอัปเดตอยู่แล้ว');
    fs.mkdirSync(path.dirname(this.statusFile()), { recursive: true });
    fs.writeFileSync(
      this.statusFile(),
      JSON.stringify({
        state: 'running',
        step: 'start',
        message: 'กำลังเริ่มอัปเดต',
        at: new Date().toISOString(),
        requestedBy: actor,
      }),
    );
    // Start through "cmd /c start" so the updater is not a child of this server:
    // the updater stops the server (taskkill /T) and must survive that.
    const ps = this.powershell();
    const cmdLine = `start "Purim POS Update" /min "${ps}" -NoProfile -ExecutionPolicy Bypass -File "${this.scriptPath()}" -InstallDir "${this.installDir()}" -Mode run`;
    const child = spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `"${cmdLine}"`],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
    child.unref();
    this.logger.warn(`Server update started by ${actor}`);
    return { started: true };
  }
}
