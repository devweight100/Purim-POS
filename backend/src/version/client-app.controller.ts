import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Newest desktop app installer kept on the server machine, for the "update app" button of
 * the client machines (desktop/app-updater.js). Public: LAN clients download it before login.
 *   <install dir>/Installer/Client/Purim-POS-Client-Setup.exe
 *   <install dir>/Installer/Client/client-version.json   { version, sha256, size, file }
 */
@Controller('client-app')
export class ClientAppController {
  private dir() {
    return path.resolve(
      process.env.PURIM_INSTALL_DIR || path.resolve(process.cwd(), '..'),
      'Installer',
      'Client',
    );
  }

  private info(): {
    version: string;
    sha256?: string;
    size?: number;
    file: string;
  } {
    try {
      const raw = fs
        .readFileSync(path.join(this.dir(), 'client-version.json'), 'utf8')
        .replace(/^﻿/, '');
      const v = JSON.parse(raw) as {
        version?: string;
        sha256?: string;
        size?: number;
        file?: string;
      };
      const file = path.basename(v.file || 'Purim-POS-Client-Setup.exe');
      if (!v.version || !fs.existsSync(path.join(this.dir(), file)))
        throw new Error('missing');
      return { version: v.version, sha256: v.sha256, size: v.size, file };
    } catch {
      throw new NotFoundException('ไม่มีไฟล์ติดตั้งแอปเครื่องลูกบนเครื่องแม่');
    }
  }

  @Get('latest')
  latest() {
    const { version, sha256, size } = this.info();
    return { version, sha256, size };
  }

  @Get('download')
  download(@Res() res: any) {
    const { file } = this.info();
    return res.download(path.join(this.dir(), file), file);
  }
}
