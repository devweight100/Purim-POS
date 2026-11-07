# Purim POS - update the server from GitHub.
# Used by the "อัปเดตระบบ" button on the store monitor page (/monitor), through the backend:
#   -Mode check     -> writes the installed/latest version to -JsonFile
#   -Mode run       -> downloads the latest code, replaces program files (keeps .env, uploads,
#                      backups, logs) and runs install-server.ps1 (backup, migrate, build, restart);
#                      progress goes to logs\update-status.json
#   -Mode set-token -> stores the token from $env:PURIM_GH_TOKEN (DPAPI, this Windows user only)
#   (no -Mode)      -> interactive console version of "run"
param(
  [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [string]$Repo = 'devweight100/Purim-POS',
  [string]$Branch = 'main',
  [ValidateSet('interactive', 'check', 'run', 'set-token')]
  [string]$Mode = 'interactive',
  [string]$JsonFile = '',
  [switch]$Force
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Interactive = $Mode -eq 'interactive'
if ($Interactive) { try { $Host.UI.RawUI.WindowTitle = 'อัปเดต ร้านปุริม POS จาก GitHub' } catch {} }

# GitHub REST API base (built from parts on purpose)
$ApiBase = 'https://' + 'api' + '.' + 'github' + '.' + 'com'
$TokenFile   = Join-Path $InstallDir 'update-token.dat'
$VersionFile = Join-Path $InstallDir 'VERSION.json'
$LogDir      = Join-Path $InstallDir 'logs'
$StatusFile  = Join-Path $LogDir 'update-status.json'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Json($path, $obj) { [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 6), $Utf8) }
function Set-Status($state, $step, $message, $extra) {
  if ($Mode -ne 'run') { return }
  $o = [ordered]@{ state = $state; step = $step; message = $message; at = (Get-Date).ToString('o') }
  if ($extra) { foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] } }
  Write-Json $StatusFile $o
}
function Say($t, $color = 'Gray') { Write-Host $t -ForegroundColor $color }
function Done($code, $text, $color = 'Gray', $result) {
  if ($Mode -eq 'check' -or $Mode -eq 'set-token') {
    $r = [ordered]@{ ok = ($code -eq 0); message = $text }
    if ($result) { foreach ($k in $result.Keys) { $r[$k] = $result[$k] } }
    if ($JsonFile) { Write-Json $JsonFile $r } else { $r | ConvertTo-Json -Depth 6 }
  } elseif ($Mode -eq 'run') {
    Set-Status ($(if ($code -eq 0) { 'done' } else { 'failed' })) 'end' $text $result
    try { Stop-Transcript | Out-Null } catch {}
  } else {
    Say ''; if ($text) { Say $text $color }; Say ''
    Read-Host 'กด Enter เพื่อปิดหน้าต่างนี้' | Out-Null
  }
  exit $code
}
function Get-Installed {
  if (Test-Path $VersionFile) { try { return (Get-Content $VersionFile -Raw | ConvertFrom-Json) } catch {} }
  return $null
}
function Save-Token($plain) {
  $enc = $plain | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
  Set-Content -Path $TokenFile -Value $enc -NoNewline
}
function Read-Token {
  if (Test-Path $TokenFile) {
    try {
      # Trim: Set-Content adds a trailing newline, which ConvertTo-SecureString rejects
      $sec = (Get-Content $TokenFile -Raw).Trim() | ConvertTo-SecureString -ErrorAction Stop
      return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    } catch {}
  }
  if (-not $Interactive) { return $null }
  Say ''
  Say 'ต้องใช้ GitHub token แบบอ่านอย่างเดียว (ใส่ครั้งเดียว เก็บแบบเข้ารหัสในเครื่องนี้)' 'Yellow'
  Say '  github.com > Settings > Developer settings > Fine-grained tokens > Generate new token'
  Say "  Repository access: Only select repositories > $Repo"
  Say '  Permissions: Contents = Read-only   แล้วกด Generate และ copy มาวาง'
  $sec = Read-Host 'วาง token แล้วกด Enter' -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
function Get-Latest($token) {
  $headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'purim-pos-updater'; Accept = 'application/vnd.github+json' }
  try {
    $c = Invoke-RestMethod "$ApiBase/repos/$Repo/commits/$Branch" -Headers $headers -UseBasicParsing -ErrorAction Stop
    return @{ ok = $true; headers = $headers; sha = $c.sha; short = $c.sha.Substring(0, 7);
      message = (($c.commit.message -split "`n")[0]); date = ([datetime]$c.commit.committer.date).ToLocalTime().ToString('dd/MM/yyyy HH:mm');
      iso = ([datetime]$c.commit.committer.date).ToUniversalTime().ToString('o') }
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 401 -or $code -eq 403 -or $code -eq 404) {
      return @{ ok = $false; badToken = $true; error = "token ใช้ไม่ได้หรือไม่มีสิทธิ์อ่าน $Repo (HTTP $code)" }
    }
    return @{ ok = $false; error = "เชื่อมต่อ GitHub ไม่ได้: $($_.Exception.Message)" }
  }
}

# ---------------------------------------------------------------- set-token
if ($Mode -eq 'set-token') {
  $plain = $env:PURIM_GH_TOKEN
  if (-not $plain) { Done 1 'ไม่ได้ใส่ token' }
  $l = Get-Latest $plain
  if (-not $l.ok) { Done 1 $l.error }
  Save-Token $plain
  Done 0 'บันทึก token แล้ว'
}

$installed = Get-Installed
$token = Read-Token
if (-not $token) {
  if ($Mode -eq 'check') { Done 0 'ยังไม่ได้ตั้งค่า GitHub token' 'Gray' @{ needToken = $true; installed = $installed } }
  Done 1 'ยังไม่ได้ตั้งค่า GitHub token' 'Red' @{ needToken = $true }
}
$latest = Get-Latest $token
if (-not $latest.ok) {
  if ($latest.badToken) { Remove-Item $TokenFile -ErrorAction SilentlyContinue }
  Done 1 $latest.error 'Red' @{ needToken = [bool]$latest.badToken; installed = $installed }
}
if ($Interactive) { Save-Token $token }
$upToDate = [bool]($installed -and $installed.commit -eq $latest.sha)
# An installer is built from a code commit and then committed itself ("build: installer ..."),
# so the newest commit is often only the rebuilt .exe. Up to date when no newer commit touches program code.
if (-not $upToDate -and $installed -and $installed.commit -and -not $installed.modified) {
  try {
    $cmp = Invoke-RestMethod "$ApiBase/repos/$Repo/compare/$($installed.commit)...$($latest.sha)" -Headers $latest.headers -UseBasicParsing -ErrorAction Stop
    $files = @($cmp.files | ForEach-Object { $_.filename })
    if ($cmp.status -eq 'ahead' -and $files.Count -gt 0 -and $files.Count -lt 300) {
      $codeChanged = @($files | Where-Object {
        ($_ -match '^(backend|frontend|desktop)/' -or $_ -eq 'docker-compose.yml' -or $_ -match '^Installer/Server/setup/') -and $_ -notmatch '\.nsi$'
      })
      if ($codeChanged.Count -eq 0) { $upToDate = $true }
    }
  } catch {}
}
$latestInfo = [ordered]@{ commit = $latest.sha; short = $latest.short; message = $latest.message; committedAt = $latest.date }

# ---------------------------------------------------------------- check
if ($Mode -eq 'check') {
  Done 0 ($(if ($upToDate) { 'เป็นเวอร์ชันล่าสุดแล้ว' } else { 'มีเวอร์ชันใหม่' })) 'Gray' @{ installed = $installed; latest = $latestInfo; upToDate = $upToDate; needToken = $false }
}

# ---------------------------------------------------------------- run / interactive
if ($Mode -eq 'run') {
  Start-Transcript -Path (Join-Path $LogDir ("update-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')) -Append | Out-Null
}
Set-Status 'running' 'check' "เวอร์ชันล่าสุด $($latest.short): $($latest.message)" @{ target = $latestInfo }
Say "ล่าสุดบน GitHub: $($latest.short)  $($latest.date)  $($latest.message)" 'Cyan'
if ($installed) { Say "ที่ติดตั้งอยู่:    $($installed.commit.Substring(0,7))  $($installed.installedAt)" }
if ($upToDate -and -not $Force) { Done 0 'เป็นเวอร์ชันล่าสุดอยู่แล้ว ไม่ต้องอัปเดต' 'Green' }
if ($Interactive) {
  $answer = Read-Host 'อัปเดตตอนนี้เลยไหม? ระหว่างอัปเดตเครื่องขายจะใช้งานไม่ได้ประมาณ 5-10 นาที (y/n)'
  if ($answer -notmatch '^(y|Y|yes|ใช่)$') { Done 0 'ยกเลิกการอัปเดต' 'Yellow' }
}

Set-Status 'running' 'download' 'กำลังดาวน์โหลดโค้ดเวอร์ชันใหม่'
Say '[1/3] ดาวน์โหลดโค้ดเวอร์ชันใหม่' 'Cyan'
$work = Join-Path $env:TEMP "purim-update-$($latest.short)"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null
$zip = Join-Path $work 'src.zip'
try {
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest "$ApiBase/repos/$Repo/zipball/$($latest.sha)" -Headers $latest.headers -OutFile $zip -UseBasicParsing -ErrorAction Stop
} catch { Done 1 "ดาวน์โหลดไม่สำเร็จ: $($_.Exception.Message)" 'Red' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$extract = Join-Path $work 'x'
try { [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract) } catch { Done 1 "แตกไฟล์ไม่สำเร็จ: $($_.Exception.Message)" 'Red' }
$src = (Get-ChildItem $extract -Directory | Select-Object -First 1).FullName
foreach ($need in @('backend\package.json', 'frontend\package.json', 'Installer\Server\setup\install-server.ps1')) {
  if (-not (Test-Path (Join-Path $src $need))) { Done 1 "ไฟล์ที่ดาวน์โหลดไม่ครบ (ไม่พบ $need)" 'Red' }
}

Set-Status 'running' 'replace' 'กำลังหยุดเซิร์ฟเวอร์และแทนที่ไฟล์โปรแกรม'
Say '[2/3] หยุดเซิร์ฟเวอร์ และแทนที่ไฟล์โปรแกรม (ข้อมูลร้านไม่ถูกแตะ)' 'Cyan'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$launcher = Join-Path $InstallDir 'Installer\Server\setup\purim-server.js'
if ($node -and (Test-Path $launcher)) { & $node $launcher --stop | Out-Null }
foreach ($d in @('backend\src', 'backend\prisma', 'backend\scripts', 'backend\test', 'backend\dist', 'frontend\src', 'frontend\public', 'frontend\.next', 'Installer\Server\setup')) {
  Remove-Item (Join-Path $InstallDir $d) -Recurse -Force -ErrorAction SilentlyContinue
}
& robocopy (Join-Path $src 'backend') (Join-Path $InstallDir 'backend') /E /NFL /NDL /NJH /NJS /NP | Out-Null
& robocopy (Join-Path $src 'frontend') (Join-Path $InstallDir 'frontend') /E /NFL /NDL /NJH /NJS /NP | Out-Null
& robocopy (Join-Path $src 'Installer\Server\setup') (Join-Path $InstallDir 'Installer\Server\setup') /E /NFL /NDL /NJH /NJS /NP | Out-Null
$controlSrc = Join-Path $src 'Installer\Server\control'
if (Test-Path $controlSrc) {
  & robocopy $controlSrc (Join-Path $InstallDir 'Installer\Server\control') /E /NFL /NDL /NJH /NJS /NP | Out-Null
}
$clientSrc = Join-Path $src 'Installer\Client'
if (Test-Path $clientSrc) {
  & robocopy $clientSrc (Join-Path $InstallDir 'Installer\Client') 'Purim-POS-Client-Setup.exe' 'client-version.json' /NFL /NDL /NJH /NJS /NP | Out-Null
}
Copy-Item (Join-Path $src 'docker-compose.yml') $InstallDir -Force
Get-ChildItem (Join-Path $src 'Installer\Server') -Filter '*.txt' -File | Copy-Item -Destination $InstallDir -Force
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $InstallDir 'backend\src\main.ts'))) { Done 1 'คัดลอกไฟล์ไม่สำเร็จ — กดอัปเดตอีกครั้ง' 'Red' }

Set-Status 'running' 'install' 'กำลังสำรองข้อมูล อัปเดตฐานข้อมูล และ build ระบบ (5-10 นาที)'
Say '[3/3] สำรองข้อมูล > อัปเดตฐานข้อมูล > build > เปิดเซิร์ฟเวอร์' 'Cyan'
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'Installer\Server\setup\install-server.ps1') -InstallDir $InstallDir -NoElevate
$rc = $LASTEXITCODE
if ($rc -eq 0) {
  $info = [ordered]@{ commit = $latest.sha; branch = $Branch; message = $latest.message; committedAt = $latest.date; committedAtIso = $latest.iso; modified = $false; installedAt = (Get-Date -Format 'dd/MM/yyyy HH:mm'); source = 'github' }
  Write-Json $VersionFile $info
  Done 0 "อัปเดตเป็นเวอร์ชัน $($latest.short) เรียบร้อย" 'Green' @{ installed = $info }
}
Done $rc "อัปเดตยังไม่สำเร็จ (รหัส $rc) — ดู logs\install-*.log" 'Red'
