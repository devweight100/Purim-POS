import { Controller, Get } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface VersionInfo {
  source: string;
  commit: string | null;
  committedAt: string | null;
  message: string;
  branch: string;
  modified: boolean;
  label: string;
  builtAt?: string;
  installedAt?: string;
}

const startedAt = new Date().toISOString();

function loadBuildInfo(): VersionInfo | null {
  for (const p of [
    path.join(__dirname, '..', 'build-info.json'),
    path.join(process.cwd(), 'dist', 'build-info.json'),
  ]) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as VersionInfo;
    } catch {
      // try next location
    }
  }
  return null;
}

function sourceVersion(): VersionInfo | null {
  try {
    // shared with the build step (backend/scripts/version-info.js)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(
      path.join(process.cwd(), 'scripts', 'version-info.js'),
    ) as { getSourceVersion: (root: string) => VersionInfo };
    return mod.getSourceVersion(path.resolve(process.cwd(), '..'));
  } catch {
    return null;
  }
}

/** Public: which version is running, and is the code on disk newer than what runs? */
@Controller('version')
export class VersionController {
  private readonly build = loadBuildInfo();

  @Get()
  get() {
    const source = sourceVersion();
    const running = this.build;
    const sameCode =
      !running || !source || !running.commit || !source.commit
        ? null
        : running.commit === source.commit &&
          running.modified === source.modified;
    return {
      running,
      source,
      // false = code was updated on disk (git pull / copy) but the server still runs the old build
      upToDateWithSource: sameCode,
      startedAt,
      node: process.version,
    };
  }
}
