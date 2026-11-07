const { exec } = require('child_process');

console.log('\x1b[31m%s\x1b[0m', '==============================================================================');
console.log('\x1b[33m%s\x1b[0m', '             🛑 กำลังหยุดการทำงานของเซิร์ฟเวอร์ ร้านปุริม POS...');
console.log('\x1b[31m%s\x1b[0m', '==============================================================================\n');

// Kill ports 3000 and 3001
exec('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"', (err) => {
  console.log('\x1b[32m%s\x1b[0m', '==============================================================================');
  console.log('\x1b[32m%s\x1b[0m', '             ✅ ปิดการทำงานของเซิร์ฟเวอร์เรียบร้อยแล้ว!');
  console.log('\x1b[32m%s\x1b[0m', '==============================================================================\n');
  setTimeout(() => process.exit(0), 1500);
});
