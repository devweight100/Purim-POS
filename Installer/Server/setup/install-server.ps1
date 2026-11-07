# Purim POS - server install / update / repair script (Windows 10/11, run as Administrator).
# Called by Purim-POS-Server-Setup.exe; safe to run again any time (shortcut "ติดตั้งหรือซ่อมระบบ Purim POS").
# Exit codes: 0 = ready, 3010 = restart Windows then run again, other = failed (see logs\install-*.log)
param(
  [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [switch]$NoStart,
  [switch]$Pause
)

# Relaunch elevated when started without Administrator rights (e.g. from the Start menu shortcut)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-InstallDir', "`"$InstallDir`"", '-Pause')
  if ($NoStart) { $argsList += '-NoStart' }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $argsList
  exit 0
}
if ($env:ProgramW6432) { $env:ProgramFiles = $env:ProgramW6432 }

# 'Continue': in Windows PowerShell 5.1 stderr from native tools (docker/npm) would otherwise abort the script
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Host.UI.RawUI.WindowTitle = 'ติดตั้งเซิร์ฟเวอร์ ร้านปุริม POS'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Backend   = Join-Path $InstallDir 'backend'
$Frontend  = Join-Path $InstallDir 'frontend'
$SetupDir  = Join-Path $InstallDir 'Installer\Server\setup'
$LogDir    = Join-Path $InstallDir 'logs'
$Container = 'pos-purim-db'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Start-Transcript -Path (Join-Path $LogDir "install-$Stamp.log") -Append | Out-Null

function Step($n, $text) { Write-Host ''; Write-Host "[$n] $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }
function Fail($text) {
  Write-Host ''
  Write-Host "ติดตั้งไม่สำเร็จ: $text" -ForegroundColor Red
  Write-Host "ดูรายละเอียดใน $LogDir" -ForegroundColor Red
  Finish 1
}
function Finish($code) {
  Stop-Transcript | Out-Null
  if ($Pause) { Write-Host ''; Read-Host 'กด Enter เพื่อปิดหน้าต่างนี้' | Out-Null }
  exit $code
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Has-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Run($exe, [string[]]$argList, $cwd, $what) {
  Push-Location $cwd
  try {
    & $exe @argList
    if ($LASTEXITCODE -ne 0) { Fail "$what (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
}
function Write-Utf8NoBom($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}
function New-Shortcut($path, $target, $arguments, $workDir, $icon, $minimized) {
  # WScript.Shell cannot save a .lnk whose name has Thai characters (ANSI code page),
  # so save under an ASCII temp name and rename it.
  try {
    $dir = Split-Path $path -Parent
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $tmp = Join-Path $dir ("purim-tmp-" + [guid]::NewGuid().ToString('N') + '.lnk')
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($tmp)
    $lnk.TargetPath = $target
    $lnk.Arguments = $arguments
    $lnk.WorkingDirectory = $workDir
    if ($icon) { $lnk.IconLocation = $icon }
    if ($minimized) { $lnk.WindowStyle = 7 }
    $lnk.Save()
    Move-Item -LiteralPath $tmp -Destination $path -Force -ErrorAction Stop
  } catch {
    Warn "สร้างทางลัดไม่ได้: $path ($($_.Exception.Message))"
  }
}

Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host '        ติดตั้ง / อัปเดต เซิร์ฟเวอร์ ร้านปุริม POS' -ForegroundColor Cyan
Write-Host "        โฟลเดอร์: $InstallDir" -ForegroundColor Cyan
Write-Host '=================================================================' -ForegroundColor Cyan


# ---------------------------------------------------------------- shortcuts first (so "repair" exists even if a step fails)
$NodeExeGuess = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$Desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$StartMenu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Purim POS Server'
New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
$PsExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$RepairArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$SetupDir\install-server.ps1`" -InstallDir `"$InstallDir`" -Pause"
New-Shortcut (Join-Path $StartMenu 'ติดตั้งหรือซ่อมระบบ Purim POS.lnk') $PsExe $RepairArgs $SetupDir $null $false

# ---------------------------------------------------------------- 1. Node.js
Step '1/8' 'ตรวจสอบ Node.js'
Refresh-Path
$needNode = $true
if (Has-Command 'node') {
  $v = (& node -v) -replace '^v', ''
  if ([int]($v.Split('.')[0]) -ge 20) { $needNode = $false; Ok "Node.js v$v" } else { Warn "Node.js v$v เก่าเกินไป จะติดตั้งรุ่นใหม่" }
}
if ($needNode) {
  $installed = $false
  try {
    $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing -ErrorAction Stop
    $ver = ($index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version
  } catch { $ver = 'v22.23.4' }
  if (-not $ver) { $ver = 'v22.23.4' }
  $msi = Join-Path $env:TEMP "node-$ver-x64.msi"
  Write-Host "    กำลังดาวน์โหลด Node.js $ver ..."
  try {
    Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-x64.msi" -OutFile $msi -UseBasicParsing -ErrorAction Stop
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
    if ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010) { $installed = $true }
  } catch { Warn "ดาวน์โหลดไม่สำเร็จ: $($_.Exception.Message)" }
  if (-not $installed -and (Has-Command 'winget')) {
    & winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  }
  Refresh-Path
  if (-not (Has-Command 'node')) { Fail 'ติดตั้ง Node.js ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต หรือติดตั้งเองจาก nodejs.org แล้วรันซ่อมระบบ)' }
  Ok "Node.js $(& node -v)"
}
$NodeExe = (Get-Command node).Source

# ---------------------------------------------------------------- 2. Docker Desktop
Step '2/8' 'ตรวจสอบ Docker Desktop (ฐานข้อมูล)'
$DockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
if (-not (Test-Path $DockerExe) -and -not (Has-Command 'docker')) {
  Write-Host '    ยังไม่มี Docker Desktop กำลังติดตั้ง (ไฟล์ใหญ่ ~500MB ใช้เวลาสักครู่) ...'
  $ok = $false
  if (Has-Command 'winget') {
    & winget install -e --id Docker.DockerDesktop --silent --accept-source-agreements --accept-package-agreements
    $ok = ($LASTEXITCODE -eq 0) -or (Test-Path $DockerExe)
  }
  if (-not $ok) {
    try {
      $dd = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
      Invoke-WebRequest 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe' -OutFile $dd -UseBasicParsing -ErrorAction Stop
      $p = Start-Process $dd -ArgumentList 'install --quiet --accept-license' -Wait -PassThru
      $ok = ($p.ExitCode -eq 0) -or (Test-Path $DockerExe)
    } catch { Warn "ดาวน์โหลด Docker Desktop ไม่สำเร็จ: $($_.Exception.Message)" }
  }
  if (-not $ok) { Fail 'ติดตั้ง Docker Desktop ไม่สำเร็จ (ติดตั้งเองจาก docker.com แล้วรันซ่อมระบบ)' }
  Write-Host ''
  Write-Host '=================================================================' -ForegroundColor Yellow
  Write-Host ' ติดตั้ง Docker Desktop แล้ว — ต้อง "รีสตาร์ทเครื่อง" 1 ครั้ง' -ForegroundColor Yellow
  Write-Host ' หลังรีสตาร์ท: เปิด Docker Desktop กด Accept ให้เรียบร้อย' -ForegroundColor Yellow
  Write-Host ' แล้วเปิดเมนู Start > Purim POS Server > "ติดตั้งหรือซ่อมระบบ Purim POS"' -ForegroundColor Yellow
  Write-Host '=================================================================' -ForegroundColor Yellow
  Finish 3010
}
Refresh-Path
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  if (Test-Path $DockerExe) { Start-Process $DockerExe | Out-Null }
  Write-Host '    กำลังรอ Docker เริ่มทำงาน (สูงสุด 4 นาที) ...'
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Seconds 3
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
  }
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker ยังไม่ทำงาน — เปิด Docker Desktop ให้ขึ้นสถานะ Running แล้วรันซ่อมระบบอีกครั้ง' }
Ok 'Docker พร้อม'

# ---------------------------------------------------------------- 3. Database container + carry over files from an old install
Step '3/8' 'เตรียมฐานข้อมูล PostgreSQL'
$existing = (& docker ps -a --filter "name=^/$Container$" --format '{{.Names}}') 2>$null
if ($existing -eq $Container) {
  $oldDir = (& docker inspect $Container --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}') 2>$null
  & docker start $Container | Out-Null
  Ok "ใช้ฐานข้อมูลเดิม ($Container) — ข้อมูลเดิมยังอยู่ครบ"
  if ($oldDir -and (Test-Path $oldDir) -and ((Resolve-Path $oldDir).Path.TrimEnd('\') -ne $InstallDir.TrimEnd('\'))) {
    $oldBackend = Join-Path $oldDir 'backend'
    Write-Host "    พบโปรแกรมชุดเก่าที่ $oldDir — คัดลอกไฟล์ที่จำเป็นมาด้วย"
    foreach ($f in @('.env', '.jwt-secret')) {
      $src = Join-Path $oldBackend $f
      if ((Test-Path $src) -and -not (Test-Path (Join-Path $Backend $f))) { Copy-Item $src $Backend; Ok "คัดลอก backend\$f" }
    }
    foreach ($d in @('uploads', 'backups')) {
      $src = Join-Path $oldBackend $d
      if (Test-Path $src) {
        & robocopy $src (Join-Path $Backend $d) /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP | Out-Null
        Ok "คัดลอก backend\$d"
      }
    }
  }
} else {
  Run 'docker' @('compose', '-p', 'purim-pos', '-f', (Join-Path $InstallDir 'docker-compose.yml'), 'up', '-d', 'postgres') $InstallDir 'สร้างฐานข้อมูล'
  Ok 'สร้างฐานข้อมูลใหม่แล้ว'
}
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  & docker exec $Container pg_isready -U pos_admin -d pos_purim *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { Fail 'ฐานข้อมูลไม่ตอบสนอง' }
Ok 'ฐานข้อมูลพร้อม'

# backend\.env
$EnvFile = Join-Path $Backend '.env'
if (-not (Test-Path $EnvFile)) {
  Write-Utf8NoBom $EnvFile ("DATABASE_URL=`"postgresql://pos_admin:pos_secret_2024@localhost:5433/pos_purim?schema=public`"`r`nPORT=3001`r`nTZ=Asia/Bangkok`r`n")
  Ok 'สร้าง backend\.env'
}

# ---------------------------------------------------------------- 4. Backup before touching the database
Step '4/8' 'สำรองข้อมูลก่อนอัปเดต'
$hasData = (& docker exec $Container psql -U pos_admin -d pos_purim -tAc "SELECT to_regclass('public.users') IS NOT NULL") 2>$null
if ("$hasData".Trim() -eq 't') {
  $BackupDir = Join-Path $Backend 'backups'
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $dumpName = "pre-update-$Stamp.dump"
  & docker exec $Container pg_dump -U pos_admin -d pos_purim -Fc -f "/tmp/$dumpName"
  if ($LASTEXITCODE -ne 0) { Fail 'สำรองข้อมูลไม่สำเร็จ — หยุดการอัปเดตเพื่อความปลอดภัยของข้อมูล' }
  & docker cp "${Container}:/tmp/$dumpName" (Join-Path $BackupDir $dumpName) | Out-Null
  & docker exec $Container rm -f "/tmp/$dumpName" | Out-Null
  if (-not (Test-Path (Join-Path $BackupDir $dumpName))) { Fail 'คัดลอกไฟล์สำรองไม่สำเร็จ' }
  Ok "สำรองแล้ว: backend\backups\$dumpName"
} else {
  Ok 'ฐานข้อมูลใหม่ ไม่ต้องสำรอง'
}

# ---------------------------------------------------------------- 5. Stop a running server (old dev servers included)
Step '5/8' 'หยุดเซิร์ฟเวอร์ที่ทำงานอยู่'
& $NodeExe (Join-Path $SetupDir 'purim-server.js') --stop
Ok 'หยุดแล้ว'

# ---------------------------------------------------------------- 6. Install packages + database migration
Step '6/8' 'ติดตั้งแพ็กเกจ backend และอัปเดตโครงสร้างฐานข้อมูล (ครั้งแรกใช้เวลา 3-10 นาที)'
$env:NODE_ENV = ''
Run 'npm.cmd' @('ci', '--no-audit', '--no-fund', '--loglevel=error') $Backend 'npm ci (backend)'
Run 'npx.cmd' @('prisma', 'generate') $Backend 'prisma generate'
Run $NodeExe @('scripts\prepare-database.js') $Backend 'อัปเดตฐานข้อมูล'
Run 'npm.cmd' @('run', 'build') $Backend 'build backend'
Ok 'backend พร้อม'

Step '7/8' 'ติดตั้งแพ็กเกจ frontend และ build หน้าจอ (ใช้เวลา 3-10 นาที)'
Run 'npm.cmd' @('ci', '--no-audit', '--no-fund', '--loglevel=error') $Frontend 'npm ci (frontend)'
$env:NEXT_TELEMETRY_DISABLED = '1'
Run 'npm.cmd' @('run', 'build') $Frontend 'build frontend'
Ok 'frontend พร้อม'

# ---------------------------------------------------------------- 8. Firewall, auto start, shortcuts
Step '8/8' 'ตั้งค่า Firewall, เปิดอัตโนมัติ และทางลัด'
Get-NetFirewallRule -DisplayName 'Purim POS Server*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Purim POS Server (TCP 3000)' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any -RemoteAddress LocalSubnet | Out-Null
Ok 'เปิดพอร์ต 3000 ให้เครื่องลูกในวง LAN'

$StartCmd = Join-Path $SetupDir 'start-server.cmd'
$StopCmd  = Join-Path $SetupDir 'stop-server.cmd'
Write-Utf8NoBom $StartCmd ("@echo off`r`nchcp 65001 >nul`r`ntitle Purim POS Server`r`n`"$NodeExe`" `"$SetupDir\purim-server.js`"`r`n")
Write-Utf8NoBom $StopCmd  ("@echo off`r`nchcp 65001 >nul`r`n`"$NodeExe`" `"$SetupDir\purim-server.js`" --stop`r`ntimeout /t 3 >nul`r`n")

$Startup = [Environment]::GetFolderPath('CommonStartup')
New-Shortcut (Join-Path $Startup 'Purim POS Server.lnk') $StartCmd '' $SetupDir $null $true
New-Shortcut (Join-Path $Desktop 'เปิดเซิร์ฟเวอร์ Purim POS.lnk') $StartCmd '' $SetupDir $null $true
New-Shortcut (Join-Path $Desktop 'หยุดเซิร์ฟเวอร์ Purim POS.lnk') $StopCmd '' $SetupDir $null $false
New-Shortcut (Join-Path $StartMenu 'เปิดเซิร์ฟเวอร์ Purim POS.lnk') $StartCmd '' $SetupDir $null $true
New-Shortcut (Join-Path $StartMenu 'หยุดเซิร์ฟเวอร์ Purim POS.lnk') $StopCmd '' $SetupDir $null $false
New-Shortcut (Join-Path $StartMenu 'โฟลเดอร์ Log และไฟล์สำรอง.lnk') $InstallDir '' $InstallDir $null $false
$UpdateArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$SetupDir\update-from-github.ps1`" -InstallDir `"$InstallDir`""
New-Shortcut (Join-Path $Desktop 'อัปเดต Purim POS จาก GitHub.lnk') $PsExe $UpdateArgs $SetupDir $null $false
New-Shortcut (Join-Path $StartMenu 'อัปเดต Purim POS จาก GitHub.lnk') $PsExe $UpdateArgs $SetupDir $null $false
$UrlFile = Join-Path $Desktop 'หน้าร้าน Purim POS.url'
Write-Utf8NoBom $UrlFile "[InternetShortcut]`r`nURL=http://localhost:3000/pos`r`n"
Ok 'สร้างทางลัดบนหน้าจอ และตั้งให้เปิดเองเมื่อเข้าสู่ Windows'

# Docker Desktop must also start with Windows (database lives there)
try {
  $ds = Join-Path $env:APPDATA 'Docker\settings-store.json'
  if (Test-Path $ds) {
    $json = Get-Content $ds -Raw | ConvertFrom-Json
    $json | Add-Member -NotePropertyName 'AutoStart' -NotePropertyValue $true -Force
    Write-Utf8NoBom $ds ($json | ConvertTo-Json -Depth 20)
  }
} catch { Warn 'ตั้งค่า Docker ให้เปิดอัตโนมัติไม่ได้ — เปิด Docker Desktop > Settings > ติ๊ก Start Docker Desktop when you sign in' }

if (-not $NoStart) {
  Start-Process -FilePath $StartCmd -WorkingDirectory $SetupDir -WindowStyle Minimized
  Write-Host '    กำลังเปิดเซิร์ฟเวอร์ ...'
  $up = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try { $r = Invoke-WebRequest 'http://127.0.0.1:3000/login' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -lt 500) { $up = $true; break } } catch {}
  }
  if ($up) { Ok 'เซิร์ฟเวอร์ทำงานแล้ว' } else { Warn 'เซิร์ฟเวอร์ยังไม่ตอบ — ดู logs\backend.log / logs\frontend.log' }
}

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|VirtualBox|VMware|Bluetooth' } |
  Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host '=================================================================' -ForegroundColor Green
Write-Host ' ติดตั้งเสร็จเรียบร้อย' -ForegroundColor Green
Write-Host '   เครื่องนี้เปิด:  http://localhost:3000/pos' -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "   เครื่องลูกใช้:   http://${ip}:3000" -ForegroundColor Green }
Write-Host '   (แอปเครื่องลูกจะค้นหาเซิร์ฟเวอร์ในวง LAN ให้อัตโนมัติ)' -ForegroundColor Green
Write-Host '   ไฟล์สำรองข้อมูล: backend\backups   บันทึกการทำงาน: logs' -ForegroundColor Green
Write-Host '=================================================================' -ForegroundColor Green
Finish 0
