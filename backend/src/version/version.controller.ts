import { Controller, Get, Req } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { userFromRequest } from '../auth/optional-user';
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
    // dist/backend/src/version -> dist/build-info.json (written by `npm run build`)
    path.join(__dirname, '..', '..', '..', 'build-info.json'),
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

/** Only what identifies the version: no commit hash, branch, message or paths. */
function publicInfo(v: VersionInfo | null) {
  if (!v) return null;
  return {
    label: v.label,
    modified: Boolean(v.modified),
    committedAt: v.committedAt ?? null,
    builtAt: v.builtAt,
    installedAt: v.installedAt,
  };
}

/**
 * Public: which version is running, and is the code on disk newer than what runs?
 * Commit / branch / message / Node version are shown to an authenticated ADMIN only.
 */
@Controller('version')
export class VersionController {
  private readonly build = loadBuildInfo();

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Req() req: any) {
    const source = sourceVersion();
    const running = this.build;
    const sameCode =
      !running || !source || !running.commit || !source.commit
        ? null
        : running.commit === source.commit &&
          running.modified === source.modified;
    const viewer = await userFromRequest(req, this.prisma);
    if (viewer?.role === 'ADMIN') {
      return {
        running,
        source,
        // false = code was updated on disk (git pull / copy) but the server still runs the old build
        upToDateWithSource: sameCode,
        startedAt,
        node: process.version,
      };
    }
    return {
      running: publicInfo(running),
      source: publicInfo(source),
      upToDateWithSource: sameCode,
      startedAt,
    };
  }
}
