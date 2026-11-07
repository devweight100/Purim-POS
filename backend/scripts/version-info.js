#!/usr/bin/env node
/**
 * Which code version is this?
 *
 *   getSourceVersion(rootDir)  -> version of the code on disk right now
 *                                 (git checkout: HEAD + "modified" flag; installed copy: VERSION.json)
 *   node scripts/version-info.js --write dist/build-info.json
 *                              -> stamps a build with the source version and build time
 *                                 (run after `nest build`; see package.json "build")
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
}

function label(commit, isoDate) {
  const d = isoDate ? new Date(isoDate) : null;
  const day = d && !isNaN(d.getTime())
    ? `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
    : '';
  const short = commit ? String(commit).slice(0, 7) : 'unknown';
  return day ? `${day} · ${short}` : short;
}

/** dd/MM/yyyy HH:mm (VERSION.json written by the Windows scripts) -> ISO */
function parseThaiDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(text || ''));
  if (!m) return null;
  let year = Number(m[3]);
  if (year > 2400) year -= 543; // Buddhist era
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function getSourceVersion(rootDir) {
  const root = path.resolve(rootDir || path.join(__dirname, '..', '..'));
  if (fs.existsSync(path.join(root, '.git'))) {
    try {
      const commit = git(root, ['rev-parse', 'HEAD']);
      const committedAt = git(root, ['log', '-1', '--format=%cI']);
      const message = git(root, ['log', '-1', '--format=%s']);
      let branch = '';
      try {
        branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      } catch {}
      let modified = false;
      try {
        modified = git(root, ['status', '--porcelain', '--untracked-files=no', '--', 'backend', 'frontend']).length > 0;
      } catch {}
      return { source: 'git', commit, committedAt, message, branch, modified, label: label(commit, committedAt) };
    } catch {
      // not usable as a git checkout: fall through
    }
  }
  const versionFile = path.join(root, 'VERSION.json');
  if (fs.existsSync(versionFile)) {
    try {
      const v = JSON.parse(fs.readFileSync(versionFile, 'utf8').replace(/^﻿/, ''));
      const committedAt = v.committedAtIso || parseThaiDate(v.committedAt) || null;
      return {
        source: v.source || 'installer',
        commit: v.commit || null,
        committedAt,
        message: v.message || '',
        branch: v.branch || '',
        modified: v.modified === true,
        installedAt: v.installedAt || '',
        label: label(v.commit, committedAt),
      };
    } catch {}
  }
  return { source: 'unknown', commit: null, committedAt: null, message: '', branch: '', modified: false, label: 'unknown' };
}

module.exports = { getSourceVersion, label };

if (require.main === module) {
  const i = process.argv.indexOf('--write');
  const out = i > 0 ? process.argv[i + 1] : null;
  const info = { ...getSourceVersion(path.join(__dirname, '..', '..')), builtAt: new Date().toISOString() };
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(info, null, 2));
    console.log(`[version] build ${info.label}${info.modified ? ' (+modified)' : ''} -> ${out}`);
  } else {
    console.log(JSON.stringify(info, null, 2));
  }
}
