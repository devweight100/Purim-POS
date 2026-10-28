// Additive schema upgrade with a verified database backup. No reset/db push.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('This backup script only supports the local POS database');
  const database = decodeURIComponent(url.pathname.slice(1));
  const directory = path.join(__dirname, '../backups');
  fs.mkdirSync(directory, { recursive: true });
  const backup = path.join(directory, 'before-reliability-' + Date.now() + '.dump');
  const file = fs.openSync(backup, 'wx');
  let result;
  try {
    result = spawnSync('docker', ['exec', 'pos-purim-db', 'pg_dump', '-U', decodeURIComponent(url.username), '-d', database, '-Fc'], { stdio: ['ignore', file, 'pipe'] });
  } finally { fs.closeSync(file); }
  if (result.status !== 0 || fs.statSync(backup).size < 100) throw new Error('Backup failed; database was NOT changed');
  const verify = spawnSync('docker', ['exec', '-i', 'pos-purim-db', 'pg_restore', '--list'], { input: fs.readFileSync(backup), encoding: 'utf8' });
  if (verify.status !== 0) throw new Error('Backup verification failed; database was NOT changed');
  const source = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260907000000_reliable_pos/migration.sql'), 'utf8');
  const sql = source.replaceAll('ADD COLUMN ', 'ADD COLUMN IF NOT EXISTS ').replaceAll('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 1)`;
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
  });
  console.log('Verified backup:', backup);
  console.log('Additive reliability schema upgrade completed. Existing data preserved.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
