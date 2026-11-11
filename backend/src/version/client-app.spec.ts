import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import {
  CLIENT_APP_MISSING,
  ClientAppController,
  clientAppDirs,
  findClientApp,
} from './client-app.controller';

describe('client app downloads (served to cashier machines)', () => {
  let root: string;
  const put = (dir: string, version: string, withExe = true) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'client-version.json'),
      '﻿' +
        JSON.stringify({ version, file: 'Purim-POS-Client-Setup.exe', size: 3, sha256: 'ab' }),
    );
    if (withExe) fs.writeFileSync(path.join(dir, 'Purim-POS-Client-Setup.exe'), 'exe');
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'purim-client-app-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.PURIM_INSTALL_DIR;
  });

  it('looks in downloads/, then Installer/dist, then the pre-1.5 Installer/Client', () => {
    expect(clientAppDirs(root, {})).toEqual([
      path.join(root, 'downloads'),
      path.join(root, 'Installer', 'dist'),
      path.join(root, 'Installer', 'Client'),
    ]);
    expect(clientAppDirs(root, { PURIM_CLIENT_APP_DIR: '/x/y' })[0]).toBe(path.resolve('/x/y'));
  });

  it('prefers the release download over older locations and skips a json without its exe', () => {
    put(path.join(root, 'Installer', 'Client'), '1.4.2');
    put(path.join(root, 'downloads'), '1.5.0', false);
    expect(findClientApp(clientAppDirs(root, {}))?.version).toBe('1.4.2');
    put(path.join(root, 'downloads'), '1.5.0');
    const found = findClientApp(clientAppDirs(root, {}));
    expect(found).toMatchObject({
      dir: path.join(root, 'downloads'),
      version: '1.5.0',
      file: 'Purim-POS-Client-Setup.exe',
      size: 3,
    });
  });

  it('answers 404 with a Thai explanation when the server has no client installer', () => {
    process.env.PURIM_INSTALL_DIR = root;
    const c = new ClientAppController();
    expect(() => c.latest()).toThrow(NotFoundException);
    expect(() => c.latest()).toThrow(CLIENT_APP_MISSING);
    put(path.join(root, 'downloads'), '1.5.0');
    expect(c.latest()).toEqual({ version: '1.5.0', sha256: 'ab', size: 3 });
  });
});
