const { spawn, exec } = require('child_process');
const os = require('os');
const path = require('path');

const fs = require('fs');

// Detect LAN IPv4 (prioritizing physical Wi-Fi/Ethernet over WSL/Virtual adapters)
function getLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    const lower = name.toLowerCase();
    const isVirtual = lower.includes('wsl') || 
                      lower.includes('vethernet') || 
                      lower.includes('docker') || 
                      lower.includes('virtual') || 
                      lower.includes('vmware') || 
                      lower.includes('bluetooth');
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254')) {
        if (!isVirtual) {
          candidates.unshift(iface.address); // Prioritize physical LAN / Wi-Fi
        } else {
          candidates.push(iface.address);
        }
      }
    }
  }
  return candidates[0] || '127.0.0.1';
}

const lanIp = getLanIp();
let rootDir = __dirname;
if (!fs.existsSync(path.join(rootDir, 'backend')) && fs.existsSync(path.resolve(rootDir, '..', '..', 'backend'))) {
  rootDir = path.resolve(rootDir, '..', '..');
}
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');

console.log('\x1b[36m%s\x1b[0m', '==============================================================================');
console.log('\x1b[33m%s\x1b[0m', '             🚀 กำลังเริ่มต้นระบบเซิร์ฟเวอร์ ร้านปุริม POS...');
console.log('\x1b[36m%s\x1b[0m', '==============================================================================\n');

// 0. Ensure Docker Database is up
const { execSync } = require('child_process');
try {
  console.log('\x1b[32m%s\x1b[0m', '[0/2] กำลังตรวจสอบฐานข้อมูล Docker Database (PostgreSQL)...');
  execSync('docker compose up -d postgres redis', { cwd: rootDir, stdio: 'ignore' });
  console.log('\x1b[32m%s\x1b[0m', '✅ ฐานข้อมูล PostgreSQL พร้อมทำงานแล้ว\n');
} catch (e) {
  console.log('\x1b[33m%s\x1b[0m', '⚠️ ไม่สามารถสั่ง docker compose ได้อัตโนมัติ (กรุณาตรวจสอบว่าเปิด Docker Desktop แล้วหรือยัง)\n');
}

console.log('\x1b[32m%s\x1b[0m', '[1/2] กำลังเปิด Backend API Service (พอร์ต 3001)...');
const backend = spawn('npm.cmd', ['run', 'start:dev'], { 
  cwd: backendDir, 
  stdio: 'inherit', 
  shell: true 
});

console.log('\x1b[32m%s\x1b[0m', '[2/2] กำลังเปิด Frontend POS Service (พอร์ต 3000)...');
const frontend = spawn('npm.cmd', ['run', 'dev'], { 
  cwd: frontendDir, 
  stdio: 'inherit', 
  shell: true 
});

setTimeout(() => {
  console.log('\n\x1b[36m%s\x1b[0m', '==============================================================================');
  console.log('\x1b[33m%s\x1b[0m', '                     ✨ เซิร์ฟเวอร์พร้อมทำงานแล้ว ✨');
  console.log('\x1b[36m%s\x1b[0m', '==============================================================================\n');
  console.log('  📌 1. สำหรับเครื่องนี้ (Local Machine):');
  console.log('\x1b[36m%s\x1b[0m', '     👉 http://localhost:3000\n');
  console.log('  🛒 2. สำหรับเครื่องแคชเชียร์ POS เครื่องอื่น / แท็บเล็ตในร้าน (LAN / Wi-Fi):');
  console.log('\x1b[33m%s\x1b[0m', `     👉 http://${lanIp}:3000\n`);
  console.log('  🔌 3. Backend API Address:');
  console.log(`     👉 http://${lanIp}:3001/api\n`);
  console.log('\x1b[36m%s\x1b[0m', '==============================================================================\n');
  
  exec('start http://localhost:3000/pos');
}, 5000);

function handleExit() {
  console.log('\n🛑 กำลังปิดระบบเซิร์ฟเวอร์...');
  try { backend.kill(); } catch (e) {}
  try { frontend.kill(); } catch (e) {}
  process.exit();
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);
