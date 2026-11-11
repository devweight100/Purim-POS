import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  ADMIN,
  BACKEND_DIR,
  BACKEND_MAIN,
  BACKEND_PORT,
  BACKEND_URL,
  FRONTEND_DIR,
  FRONTEND_PORT,
  FRONTEND_URL,
} from './env';

/**
 * 1. Prepares a fresh test database (migrate deploy + seed via backend/scripts/prepare-database.js).
 * 2. Starts the built backend and `next start`, waits until both answer.
 * 3. Changes admin's default password through the API (cashier1 keeps it for the login spec).
 * Returns the teardown that stops both servers.
 */
export default async function globalSetup() {
  const databaseUrl = process.env.DATABASE_URL || '';
  const dbName = (() => {
    try {
      return new URL(databaseUrl).pathname.slice(1);
    } catch {
      return '';
    }
  })();
  if (!/test/i.test(dbName)) {
    throw new Error(`DATABASE_URL must point to a test database whose name contains "test" (got "${dbName || 'nothing'}")`);
  }
  if (!fs.existsSync(BACKEND_MAIN)) throw new Error(`Backend is not built: ${BACKEND_MAIN} (run npm run build in backend/)`);

  const logDir = path.join(FRONTEND_DIR, 'test-results');
  fs.mkdirSync(logDir, { recursive: true });

  await refuseUsedDatabase(databaseUrl, dbName);

  const prep = spawnSync(process.execPath, [path.join(BACKEND_DIR, 'scripts', 'prepare-database.js')], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (prep.status !== 0) throw new Error(`prepare-database.js failed:\n${prep.stdout}\n${prep.stderr}`);

  const children: ChildProcess[] = [];
  const stop = async () => {
    stopping = true;
    for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  };

  try {
    children.push(
      start('backend', process.execPath, [BACKEND_MAIN], BACKEND_DIR, logDir, {
        PORT: String(BACKEND_PORT),
        DATABASE_URL: databaseUrl,
        JWT_SECRET: process.env.JWT_SECRET || 'e2e-only-secret-that-is-long-enough-for-the-check',
        BACKUP_AUTO: 'false',
        TZ: 'Asia/Bangkok',
      }),
    );
    await waitFor(`${BACKEND_URL}/api/auth/default-pin`, 'backend');

    const nextBin = path.join(FRONTEND_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
    children.push(
      start('frontend', process.execPath, [nextBin, 'start', '-H', '127.0.0.1', '-p', String(FRONTEND_PORT)], FRONTEND_DIR, logDir, {}),
    );
    await waitFor(`${FRONTEND_URL}/login`, 'frontend');
    // The browser calls same-origin /api, rewritten to the backend: make sure the build points at ours.
    await waitFor(`${FRONTEND_URL}/api/auth/default-pin`, 'frontend -> backend rewrite (build with API_INTERNAL_URL?)', 20_000);

    await changeDefaultPassword(ADMIN);
  } catch (err) {
    await stop();
    throw err;
  }
  return stop;
}

let stopping = false;

function start(name: string, cmd: string, args: string[], cwd: string, logDir: string, env: Record<string, string>) {
  const log = fs.openSync(path.join(logDir, `${name}.log`), 'w');
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', log, log] });
  child.on('exit', (code) => {
    if (!stopping && code !== null && code !== 0) console.error(`[e2e] ${name} exited with ${code}, see test-results/${name}.log`);
  });
  return child;
}

async function waitFor(url: string, label: string, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not answer at ${url} (${last})`);
}

async function refuseUsedDatabase(databaseUrl: string, dbName: string) {
  // Use the backend's Prisma client; a database without tables yet is fine.
  const req = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const { PrismaClient } = req('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows: { n: number }[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders'`,
    );
    if (rows[0]?.n) {
      const orders: { n: number }[] = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM orders');
      if (orders[0]?.n) throw new Error(`Test database "${dbName}" already has sales: use a new, empty database for e2e tests`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function changeDefaultPassword(acc: { username: string; defaultPassword: string; password: string; pin: string }) {
  const post = (p: string, body: unknown, token?: string) =>
    fetch(`${BACKEND_URL}/api${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  const login = await post('/auth/login', { username: acc.username, password: acc.defaultPassword });
  if (!login.ok) throw new Error(`login ${acc.username} with the default password failed: ${login.status}`);
  const { access_token } = await login.json();
  const r = await post('/auth/change-password', { currentPassword: acc.defaultPassword, newPassword: acc.password, newPin: acc.pin }, access_token);
  if (!r.ok) throw new Error(`change-password ${acc.username} failed: ${r.status} ${await r.text()}`);
}
