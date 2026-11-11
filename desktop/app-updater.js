/**
 * Update the Purim POS desktop app from the server (no internet needed).
 *
 * The server machine keeps the newest client installer (<install dir>/downloads/Purim-POS-Client-Setup.exe
 * + client-version.json, taken from the GitHub Release by the server installer / "อัปเดตระบบ (GitHub)";
 * installers are never committed to git), and serves it at
 *   GET /api/client-app/latest    { version, sha256, size }
 *   GET /api/client-app/download  the installer
 * This module compares versions, downloads, verifies the SHA-256 and runs the installer silently,
 * then starts the app again.
 */
const { app } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function client(url) {
  return url.startsWith('https:') ? https : http;
}

function getJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = client(url).get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          // the server explains in Thai (e.g. 404: no client installer on the server yet)
          let msg = '';
          try {
            msg = JSON.parse(body).message || '';
          } catch {}
          return reject(new Error(typeof msg === 'string' && msg ? msg : `HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function checkForUpdate(serverUrl) {
  const current = app.getVersion();
  const base = String(serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
  try {
    const latest = await getJson(`${base}/api/client-app/latest`);
    return { current, latest, available: compareVersions(latest.version, current) > 0 };
  } catch (err) {
    return { current, available: false, error: err.message };
  }
}

function download(url, file, expectedSize, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const hash = crypto.createHash('sha256');
    let received = 0;
    const req = client(url).get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = Number(res.headers['content-length']) || expectedSize || 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (onProgress && total) onProgress(Math.min(1, received / total));
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ size: received, sha256: hash.digest('hex') })));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Download + verify + run the installer silently, then restart the app. */
async function downloadAndInstall(serverUrl, { onProgress } = {}) {
  if (process.platform !== 'win32') throw new Error('อัปเดตแอปได้เฉพาะบน Windows');
  const info = await checkForUpdate(serverUrl);
  if (!info.latest) throw new Error('ไม่พบไฟล์ติดตั้งบนเครื่องแม่: ' + (info.error || ''));
  const base = String(serverUrl).replace(/\/+$/, '');
  const dir = path.join(os.tmpdir(), 'purim-pos-update');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `Purim-POS-Client-Setup-${info.latest.version}.exe`);
  const got = await download(`${base}/api/client-app/download`, file, info.latest.size, onProgress);
  if (info.latest.sha256 && got.sha256.toLowerCase() !== String(info.latest.sha256).toLowerCase()) {
    fs.rmSync(file, { force: true });
    throw new Error('ไฟล์ที่ดาวน์โหลดไม่สมบูรณ์ (checksum ไม่ตรง) — ลองใหม่อีกครั้ง');
  }
  // "start" uses ShellExecute, so Windows can ask for admin rights (per-machine install);
  // /wait keeps the order: install silently, then open the new app.
  const exe = process.execPath;
  const cmd = `start "" /wait "${file}" /S & start "" "${exe}"`;
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  child.unref();
  setTimeout(() => app.quit(), 800);
  return { started: true, version: info.latest.version };
}

module.exports = { checkForUpdate, downloadAndInstall, compareVersions };
