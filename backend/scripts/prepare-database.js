#!/usr/bin/env node
/**
 * Prepare the database for this version of Purim POS.
 *
 * Used by the server installer (and safe to run by hand any time):
 *   node scripts/prepare-database.js
 *
 * 1. Clears migrations that failed half-way (P3009/P3018 left-overs).
 * 2. A database that was created before migrations existed (prisma db push)
 *    gets its history "baselined": every migration whose objects already exist
 *    is marked as applied instead of being run again.
 * 3. Runs `prisma migrate deploy`.
 * 4. Seeds a brand-new, empty database (default admin / cashier accounts).
 * 5. Reports schema drift, if any, without changing anything.
 *
 * Reads DATABASE_URL from the environment or backend/.env.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const backendDir = path.resolve(__dirname, '..');
process.chdir(backendDir);

function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  const envFile = path.join(backendDir, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadDotEnv();
if (!process.env.DATABASE_URL) {
  console.error('[db] DATABASE_URL is not set (backend/.env)');
  process.exit(1);
}

const prismaCli = path.join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');

function prisma(args, { allowFail = false } = {}) {
  console.log(`[db] prisma ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [prismaCli, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`prisma ${args[0]} ${args[1] || ''} failed (exit ${r.status})`);
  }
  return r.status === 0;
}

// Migrations that cannot run twice, with an object that proves they are
// already in the database. Migrations not listed here are idempotent
// (IF NOT EXISTS / UPDATE ... WHERE) and are simply run by migrate deploy.
const MARKERS = [
  ['20260901000000_baseline', { table: 'users' }],
  ['20260902000000_product_persistence', { table: 'product_packaging_units' }],
  ['20260902002000_cash_movements', { table: 'cash_movements' }],
  ['20260907000000_reliable_pos', { column: ['shifts', 'terminal_id'] }],
  ['20261106000000_password_cash_category_vat', { column: ['users', 'must_change_password'] }],
  ['20261107000000_finance_ledger', { table: 'money_accounts' }],
  ['20261108000000_finance_phase3', { table: 'recurring_expenses' }],
  ['20261109000000_returns_debt_cancel_backup', { table: 'order_returns' }],
  ['20261110000000_approvals', { table: 'approval_requests' }],
];

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const tableExists = async (name) => {
      const rows = await db.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
        name,
      );
      return rows.length > 0;
    };
    const columnExists = async (table, column) => {
      const rows = await db.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        table,
        column,
      );
      return rows.length > 0;
    };

    const hasHistory = await tableExists('_prisma_migrations');
    let applied = new Set();
    if (hasHistory) {
      const failed = await db.$queryRawUnsafe(
        `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
      );
      for (const { migration_name } of failed) {
        console.log(`[db] clearing failed migration record: ${migration_name}`);
        prisma(['migrate', 'resolve', '--rolled-back', migration_name]);
      }
      const done = await db.$queryRawUnsafe(
        `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      );
      applied = new Set(done.map((r) => r.migration_name));
    }

    const freshDatabase = !(await tableExists('users'));

    if (!freshDatabase && !applied.has('20260901000000_baseline')) {
      console.log('[db] existing database without migration history -> baselining');
      for (const [name, marker] of MARKERS) {
        if (applied.has(name)) continue;
        const present = marker.table
          ? await tableExists(marker.table)
          : await columnExists(marker.column[0], marker.column[1]);
        if (present) {
          console.log(`[db]   already present: ${name}`);
          prisma(['migrate', 'resolve', '--applied', name]);
        }
      }
    }

    prisma(['migrate', 'deploy']);

    const users = await db.user.count();
    if (users === 0) {
      console.log('[db] empty database -> seeding default accounts');
      prisma(['db', 'seed']);
    }

    // Report (never apply) differences between the database and the schema.
    const diff = spawnSync(
      process.execPath,
      [
        prismaCli,
        'migrate',
        'diff',
        '--from-url',
        process.env.DATABASE_URL,
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { encoding: 'utf8', env: process.env },
    );
    if (diff.status === 2) {
      console.warn('[db] WARNING: database differs from schema.prisma:');
      console.warn(diff.stdout);
    } else if (diff.status === 0) {
      console.log('[db] database matches schema.prisma');
    }
    console.log('[db] database ready');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('[db] FAILED:', err.message || err);
  process.exit(1);
});
