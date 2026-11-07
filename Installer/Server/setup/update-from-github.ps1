# Purim POS - update the server from GitHub (shortcut "อัปเดต Purim POS จาก GitHub").
# Downloads the latest code of the branch, replaces the program files (keeps .env, uploads,
# backups, logs) and runs install-server.ps1 (backup -> migrate -> build -> restart).
param(
  [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [string]$Repo = 'devweight100/Purim-POS',
  [string]$Branch = 'main',
  [switch]$Force,
  [switch]$ResetToken
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-InstallDir', "`"$InstallDir`"", '-Repo', $Repo, '-Branch', $Branch)
  if ($Force) { $argsList += '-Force' }
  if ($ResetToken) { $argsList += '-ResetToken' }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $argsList
  exit 0
}

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Host.UI.RawUI.WindowTitle = 'อัปเดต ร้านปุริม POS จาก GitHub'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$TokenFile   = Join-Path $InstallDir 'update-token.dat'
$VersionFile = Join-Path $InstallDir 'VERSION.json'
$LogDir      = Join-Path $InstallDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Ok($t)   { Write-Host "    OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "    !!  $t" -ForegroundColor Yellow }
function Done($code, $text, $color) {
  Write-Host ''
  if ($text) { Write-Host $text -ForegroundColor $color }
  Write-Host ''
  Read-Host 'กด Enter เพื่อปิดหน้าต่างนี้' | Out-Null
  exit $code
}

Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host '        อัปเดต ร้านปุริม POS จาก GitHub' -ForegroundColor Cyan
Write-Host "        $Repo  (branch $Branch)" -ForegroundColor Cyan
Write-Host '=================================================================' -ForegroundColor Cyan

# ---------------------------------------------------------------- token (stored encrypted for this Windows user)
function Read-Token {
  if ((Test-Path $TokenFile) -and -not $ResetToken) {
    try {
      $sec = Get-Content $TokenFile -Raw | ConvertTo-SecureString -ErrorAction Stop
      return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    } catch { Warn 'อ่าน token เดิมไม่ได้ ต้องใส่ใหม่' }
  }
  Write-Host ''
  Write-Host 'ต้องใช้ GitHub token แบบอ่านอย่างเดียว (ใส่ครั้งเดียว เก็บแบบเข้ารหัสในเครื่องนี้)' -ForegroundColor Yellow
  Write-Host '  github.com > Settings > Developer settings > Fine-grained tokens > Generate new token'
  Write-Host "  Repository access: Only select repositories > $Repo"
  Write-Host '  Permissions: Contents = Read-only   แล้วกด Generate และ copy มาวาง'
  $sec = Read-Host 'วาง token แล้วกด Enter' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if (-not $plain) { Done 1 'ไม่ได้ใส่ token' 'Red' }
  return $plain
}

$token = Read-Token
$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'purim-pos-updater'; Accept = 'application/vnd.github+json' }

Write-Host ''
Write-Host '[1/4] ตรวจสอบเวอร์ชันล่าสุด' -ForegroundColor Cyan
try {
  $commit = Invoke-RestMethod "https://api-github-com.072103.xyz/repos/$Repo/commits/$Branch" -Headers $headers -UseBasicParsing -ErrorAction Stop
} catch {
  $code = $null
  try { $code = [int]$_.Exception.Response.StatusCode } catch {}
  if ($code -eq 401 -or $code -eq 403 -or $code -eq 404) {
    Remove-Item $TokenFile -ErrorAction SilentlyContinue
    Done 1 "token ใช้ไม่ได้หรือไม่มีสิทธิ์อ่าน $Repo (HTTP $code) — เปิดปุ่มอัปเดตใหม่แล้วใส่ token ใหม่" 'Red'
  }
  Done 1 "เชื่อมต่อ GitHub ไม่ได้: $($_.Exception.Message) — ตรวจสอบอินเทอร์เน็ต" 'Red'
}
# token works -> keep it (DPAPI, only this Windows user on this machine can read it)
$token | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $TokenFile

$sha = $commit.sha
$short = $sha.Substring(0, 7)
$msg = ($commit.commit.message -split "`n")[0]
$date = ([datetime]$commit.commit.committer.date).ToLocalTime().ToString('dd/MM/yyyy HH:mm')
$current = $null
if (Test-Path $VersionFile) { try { $current = Get-Content $VersionFile -Raw | ConvertFrom-Json } catch {} }
Write-Host "    ล่าสุดบน GitHub: $short  $date  $msg"
if ($current) { Write-Host "    ที่ติดตั้งอยู่:    $($current.commit.Substring(0,7))  $($current.installedAt)" }

if ($current -and $current.commit -eq $sha -and -not $Force) {
  Done 0 'เป็นเวอร์ชันล่าสุดอยู่แล้ว ไม่ต้องอัปเดต' 'Green'
}
$answer = Read-Host 'อัปเดตตอนนี้เลยไหม? ระหว่างอัปเดตเครื่องขายจะใช้งานไม่ได้ประมาณ 5-10 นาที (y/n)'
if ($answer -notmatch '^(y|Y|yes|ใช่)$') { Done 0 'ยกเลิกการอัปเดต' 'Yellow' }

Write-Host ''
Write-Host '[2/4] ดาวน์โหลดโค้ดเวอร์ชันใหม่' -ForegroundColor Cyan
$work = Join-Path $env:TEMP "purim-update-$short"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null
$zip = Join-Path $work 'src.zip'
try {
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest "https://api-github-com.072103.xyz/repos/$Repo/zipball/$sha" -Headers $headers -OutFile $zip -UseBasicParsing -ErrorAction Stop
  $ProgressPreference = 'Continue'
} catch { Done 1 "ดาวน์โหลดไม่สำเร็จ: $($_.Exception.Message)" 'Red' }
Ok ("ดาวน์โหลดแล้ว {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$extract = Join-Path $work 'x'
try { [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract) } catch { Done 1 "แตกไฟล์ไม่สำเร็จ: $($_.Exception.Message)" 'Red' }
$src = (Get-ChildItem $extract -Directory | Select-Object -First 1).FullName
foreach ($need in @('backend\package.json', 'frontend\package.json', 'Installer\Server\setup\install-server.ps1')) {
  if (-not (Test-Path (Join-Path $src $need))) { Done 1 "ไฟล์ที่ดาวน์โหลดไม่ครบ (ไม่พบ $need)" 'Red' }
}
Ok 'ตรวจไฟล์ครบ'

Write-Host ''
Write-Host '[3/4] หยุดเซิร์ฟเวอร์ และแทนที่ไฟล์โปรแกรม (ข้อมูลร้าน .env / รูปสินค้า / ไฟล์สำรอง ไม่ถูกแตะ)' -ForegroundColor Cyan
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$launcher = Join-Path $InstallDir 'Installer\Server\setup\purim-server.js'
if ($node -and (Test-Path $launcher)) { & $node $launcher --stop | Out-Null }
foreach ($d in @('backend\src', 'backend\prisma', 'backend\scripts', 'backend\test', 'backend\dist', 'frontend\src', 'frontend\public', 'frontend\.next', 'Installer\Server\setup')) {
  Remove-Item (Join-Path $InstallDir $d) -Recurse -Force -ErrorAction SilentlyContinue
}
& robocopy (Join-Path $src 'backend') (Join-Path $InstallDir 'backend') /E /NFL /NDL /NJH /NJS /NP | Out-Null
& robocopy (Join-Path $src 'frontend') (Join-Path $InstallDir 'frontend') /E /NFL /NDL /NJH /NJS /NP | Out-Null
& robocopy (Join-Path $src 'Installer\Server\setup') (Join-Path $InstallDir 'Installer\Server\setup') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $src 'docker-compose.yml') $InstallDir -Force
Get-ChildItem (Join-Path $src 'Installer\Server') -Filter '*.txt' -File | Copy-Item -Destination $InstallDir -Force
if (-not (Test-Path (Join-Path $InstallDir 'backend\src\main.ts'))) { Done 1 'คัดลอกไฟล์ไม่สำเร็จ — รันอัปเดตอีกครั้ง' 'Red' }
Ok 'แทนที่ไฟล์แล้ว'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '[4/4] ติดตั้ง: สำรองข้อมูล > อัปเดตฐานข้อมูล > build > เปิดเซิร์ฟเวอร์' -ForegroundColor Cyan
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'Installer\Server\setup\install-server.ps1') -InstallDir $InstallDir
$rc = $LASTEXITCODE
if ($rc -eq 0) {
  $info = [ordered]@{ commit = $sha; branch = $Branch; message = $msg; committedAt = $date; installedAt = (Get-Date -Format 'dd/MM/yyyy HH:mm'); source = 'github' }
  [IO.File]::WriteAllText($VersionFile, ($info | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Done 0 "อัปเดตเป็นเวอร์ชัน $short เรียบร้อย" 'Green'
}
Done $rc "อัปเดตยังไม่สำเร็จ (รหัส $rc) — ดู logs\install-*.log แล้วกดปุ่มอัปเดตอีกครั้ง (หรือ Start > Purim POS Server > ติดตั้งหรือซ่อมระบบ)" 'Red'
