#!/usr/bin/env node
/**
 * Purim POS server launcher (production mode).
 *
 *   node purim-server.js          start database + backend + frontend, restart them if they crash
 *   node purim-server.js --stop   stop a running launcher
 *   node purim-server.js --status print status and exit
 *
 * Layout (installed or git checkout):
 *   <root>/backend   <root>/frontend   <root>/docker-compose.yml
 *   <root>/Installer/Server/setup/purim-server.js   (this file)
 */
const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname, '..', '..', '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const logDir = path.join(root, 'logs');
const pidFile = path.join(logDir, 'purim-server.pid');
const isWin = process.platform === 'win32';
const FRONT_PORT = Number(process.env.POS_PORT || 3000);
const BACK_PORT = 3001;
const DB_CONTAINER = process.env.POSTGRES_CONTAINER || 'pos-purim-db';

fs.mkdirSync(logDir, { recursive: true });

function stamp() {
  return new Date().toLocaleString('th-TH', { hour12: false });
}
function say(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(logDir, 'launcher.log'), line + os.EOL);
  } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    const virtual = /wsl|vethernet|docker|virtual|vmware|vbox|bluetooth|loopback/i.test(name);
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254')) {
        if (virtual) out.push(i.address);
        else out.unshift(i.address);
      }
    }
  }
  return out;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    return pid && pidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

/** Kill whatever is listening on a port (old dev servers left running). */
function freePort(port) {
  try {
    if (isWin) {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 5 && /LISTENING/i.test(cols[3]) && cols[1].endsWith(':' + port)) {
          pids.add(Number(cols[4]));
        }
      }
      for (const pid of pids) {
        if (pid && pid !== process.pid) {
          say(`ปิดโปรแกรมเก่าที่ใช้พอร์ต ${port} (PID ${pid})`);
          killTree(pid);
        }
      }
    } else {
      spawnSync('sh', ['-c', `fuser -k ${port}/tcp`], { stdio: 'ignore' });
    }
  } catch {}
}

function httpOk(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
}

async function ensureDatabase() {
  if (process.env.SKIP_DOCKER === '1') return;
  let info = docker(['info']);
  if (info.status !== 0 && isWin) {
    const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
    if (fs.existsSync(exe)) {
      say('กำลังเปิด Docker Desktop ...');
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    }
  }
  for (let i = 0; info.status !== 0 && i < 90; i++) {
    if (i % 10 === 0) say('รอ Docker พร้อมใช้งาน ...');
    await sleep(2000);
    info = docker(['info']);
  }
  if (info.status !== 0) {
    say('❌ Docker ยังไม่ทำงาน — กรุณาเปิดโปรแกรม Docker Desktop แล้วลองใหม่');
    return;
  }
  const exists = docker(['ps', '-a', '--filter', `name=^/${DB_CONTAINER}$`, '--format', '{{.Names}}']);
  if ((exists.stdout || '').trim() === DB_CONTAINER) {
    docker(['start', DB_CONTAINER]);
  } else {
    say('สร้างฐานข้อมูลใหม่ (PostgreSQL) ...');
    const r = spawnSync('docker', ['compose', '-p', 'purim-pos', '-f', path.join(root, 'docker-compose.yml'), 'up', '-d', 'postgres'], {
      stdio: 'inherit',
    });
    if (r.status !== 0) say('❌ สร้างฐานข้อมูลไม่สำเร็จ');
  }
  for (let i = 0; i < 60; i++) {
    const r = docker(['exec', DB_CONTAINER, 'pg_isready', '-U', 'pos_admin', '-d', 'pos_purim']);
    if (r.status === 0) {
      say('✅ ฐานข้อมูลพร้อม');
      return;
    }
    await sleep(2000);
  }
  say('⚠️ ฐานข้อมูลยังไม่ตอบสนอง — ระบบจะลองต่อไป');
}

function rotate(file) {
  try {
    if (fs.statSync(file).size > 20 * 1024 * 1024) fs.renameSync(file, file + '.old');
  } catch {}
}

const children = {};
let stopping = false;

function startService(name, cwd, args, env) {
  const logFile = path.join(logDir, `${name}.log`);
  rotate(logFile);
  const out = fs.openSync(logFile, 'a');
  let failures = 0;
  const run = () => {
    if (stopping) return;
    const started = Date.now();
    say(`เริ่ม ${name} ...`);
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', out, out],
      windowsHide: true,
      detached: !isWin,
    });
    children[name] = child;
    child.on('exit', (code) => {
      delete children[name];
      if (stopping) return;
      failures = Date.now() - started < 60000 ? failures + 1 : 0;
      const wait = Math.min(60, 3 * 2 ** Math.min(failures, 4));
      say(`⚠️ ${name} หยุดทำงาน (code ${code}) — เริ่มใหม่ใน ${wait} วินาที (ดู logs\\${name}.log)`);
      setTimeout(run, wait * 1000);
    });
  };
  run();
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  say('กำลังหยุดเซิร์ฟเวอร์ ...');
  for (const c of Object.values(children)) killTree(c.pid);
  try {
    fs.unlinkSync(pidFile);
  } catch {}
  setTimeout(() => process.exit(0), 1500);
}

async function main() {
  const arg = process.argv[2];
  const running = readPid();

  if (arg === '--stop') {
    if (running) {
      say(`หยุดเซิร์ฟเวอร์ (PID ${running})`);
      killTree(running);
    }
    freePort(FRONT_PORT);
    freePort(BACK_PORT);
    say('✅ หยุดเซิร์ฟเวอร์แล้ว (ฐานข้อมูลยังทำงานต่อเพื่อความปลอดภัยของข้อมูล)');
    return;
  }
  if (arg === '--status') {
    const front = await httpOk(`http://127.0.0.1:${FRONT_PORT}/login`);
    const back = await httpOk(`http://127.0.0.1:${BACK_PORT}/api`);
    console.log(`launcher: ${running ? 'running (PID ' + running + ')' : 'stopped'}`);
    console.log(`frontend :${FRONT_PORT} ${front ? 'OK' : 'DOWN'}`);
    console.log(`backend  :${BACK_PORT} ${back ? 'OK' : 'DOWN'}`);
    return;
  }
  if (running) {
    say(`เซิร์ฟเวอร์ทำงานอยู่แล้ว (PID ${running})`);
    return;
  }

  // dist/backend/src/main.js since the backend also compiles ../shared; dist/src/main.js before that
  const backendMain = [path.join('dist', 'backend', 'src', 'main.js'), path.join('dist', 'src', 'main.js')]
    .find((rel) => fs.existsSync(path.join(backendDir, rel)));
  if (!backendMain) {
    say('❌ ยังไม่ได้ติดตั้ง/build ระบบ — กรุณารัน "ติดตั้งหรือซ่อมระบบ Purim POS" ก่อน');
    process.exit(1);
  }

  fs.writeFileSync(pidFile, String(process.pid));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => {
    try {
      if (readPid() === process.pid) fs.unlinkSync(pidFile);
    } catch {}
  });

  say('==============================================');
  say('   ร้านปุริม POS — เซิร์ฟเวอร์ (โหมดใช้งานจริง)');
  say('==============================================');
  await ensureDatabase();
  freePort(BACK_PORT);
  freePort(FRONT_PORT);

  startService('backend', backendDir, [backendMain], {
    NODE_ENV: 'production',
    PORT: String(BACK_PORT),
    TZ: process.env.TZ || 'Asia/Bangkok',
  });
  startService(
    'frontend',
    frontendDir,
    [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '0.0.0.0', '-p', String(FRONT_PORT)],
    { NODE_ENV: 'production' },
  );

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    if (await httpOk(`http://127.0.0.1:${FRONT_PORT}/login`)) break;
  }
  say('✅ เซิร์ฟเวอร์พร้อมใช้งาน');
  say(`   เครื่องนี้:      http://localhost:${FRONT_PORT}/pos`);
  for (const ip of lanIps()) say(`   เครื่องลูก (LAN): http://${ip}:${FRONT_PORT}`);
  say('   เปิด/หยุด/ดูสถานะ: โปรแกรม "Purim POS Server" (ไอคอนมุมขวาล่าง หรือเมนู Start)');
}

main().catch((err) => {
  say('❌ ' + (err && err.message ? err.message : err));
  process.exit(1);
});
