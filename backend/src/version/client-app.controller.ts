import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface ClientAppInfo {
  dir: string;
  version: string;
  sha256?: string;
  size?: number;
  file: string;
}

export const CLIENT_APP_MISSING =
  'ยังไม่มีไฟล์ติดตั้งแอปเครื่องลูกบนเครื่องแม่ — กด "อัปเดตระบบ (GitHub)" ที่หน้ามอนิเตอร์ร้าน หรือติดตั้งเครื่องแม่ด้วย Purim-POS-Server-Setup.exe จาก GitHub Releases';

/**
 * Folders that may hold the newest client installer + client-version.json, in order:
 *   PURIM_CLIENT_APP_DIR             explicit override
 *   <install dir>/downloads          server installer / "อัปเดตระบบ (GitHub)" (from the GitHub Release)
 *   <install dir>/Installer/dist     local build output (Installer/build-installers.*)
 *   <install dir>/Installer/Client   installs made before v1.5
 * None of them is tracked by git: installers are GitHub Release assets.
 */
export function clientAppDirs(
  installDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dirs = [
    path.join(installDir, 'downloads'),
    path.join(installDir, 'Installer', 'dist'),
    path.join(installDir, 'Installer', 'Client'),
  ];
  if (env.PURIM_CLIENT_APP_DIR) dirs.unshift(path.resolve(env.PURIM_CLIENT_APP_DIR));
  return dirs;
}

/** First folder with a valid client-version.json whose installer file exists, else null. */
export function findClientApp(dirs: string[]): ClientAppInfo | null {
  for (const dir of dirs) {
    try {
      const raw = fs
        .readFileSync(path.join(dir, 'client-version.json'), 'utf8')
        .replace(/^﻿/, '');
      const v = JSON.parse(raw) as {
        version?: string;
        sha256?: string;
        size?: number;
        file?: string;
      };
      const file = path.basename(v.file || 'Purim-POS-Client-Setup.exe');
      if (!v.version || !fs.existsSync(path.join(dir, file))) continue;
      return { dir, version: v.version, sha256: v.sha256, size: v.size, file };
    } catch {
      // missing or unreadable: try the next folder
    }
  }
  return null;
}

/**
 * Newest desktop app installer kept on the server machine, for the "update app" button of
 * the client machines (desktop/app-updater.js). Public: LAN clients download it before login.
 * Files: Purim-POS-Client-Setup.exe + client-version.json { version, sha256, size, file }.
 */
@Controller('client-app')
export class ClientAppController {
  private info(): ClientAppInfo {
    const installDir = path.resolve(
      process.env.PURIM_INSTALL_DIR || path.resolve(process.cwd(), '..'),
    );
    const found = findClientApp(clientAppDirs(installDir));
    if (!found) throw new NotFoundException(CLIENT_APP_MISSING);
    return found;
  }

  @Get('latest')
  latest() {
    const { version, sha256, size } = this.info();
    return { version, sha256, size };
  }

  @Get('download')
  download(@Res() res: any) {
    const { dir, file } = this.info();
    return res.download(path.join(dir, file), file);
  }
}
