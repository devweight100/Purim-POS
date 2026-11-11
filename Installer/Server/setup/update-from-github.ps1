# Purim POS - update the server from the latest GitHub Release (built by .github/workflows/release.yml).
# Used by the "อัปเดตระบบ (GitHub)" button on the store monitor page (/monitor), through the backend:
#   -Mode check     -> writes the installed version and the latest release to -JsonFile
#   -Mode run       -> downloads the release assets, replaces program files (keeps .env, uploads,
#                      backups, logs), puts the client app into downloads\ (served to cashier machines)
#                      and runs install-server.ps1 (backup, migrate, build, restart);
#                      progress goes to logs\update-status.json
#   -Mode set-token -> stores the token from $env:PURIM_GH_TOKEN (DPAPI, this Windows user only)
#   (no -Mode)      -> interactive console version of "run"
# Release assets used (private repo: downloaded through the API with the read-only token):
#   Purim-POS-Server-Payload.zip   program files (same as inside Purim-POS-Server-Setup.exe, without the client app)
#   Purim-POS-Client-Setup.exe + client-version.json   -> <install dir>\downloads\
#   SHA256SUMS.txt                 every download is checked against it
param(
  [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [string]$Repo = 'devweight100/Purim-POS',
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
$TokenFile    = Join-Path $InstallDir 'update-token.dat'
$VersionFile  = Join-Path $InstallDir 'VERSION.json'
$LogDir       = Join-Path $InstallDir 'logs'
$StatusFile   = Join-Path $LogDir 'update-status.json'
$DownloadsDir = Join-Path $InstallDir 'downloads'
$PayloadAsset    = 'Purim-POS-Server-Payload.zip'
$ClientAsset     = 'Purim-POS-Client-Setup.exe'
$ClientJsonAsset = 'client-version.json'
$SumsAsset       = 'SHA256SUMS.txt'
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
function Read-JsonFile($path) {
  if (Test-Path -LiteralPath $path) {
    try { return ((Get-Content -LiteralPath $path -Raw -Encoding UTF8).TrimStart([char]0xFEFF) | ConvertFrom-Json) } catch {}
  }
  return $null
}
function Get-Installed { return (Read-JsonFile $VersionFile) }
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
  Say '  Permissions: Contents = Read-only (ใช้ดาวน์โหลดไฟล์จาก Releases)   แล้วกด Generate และ copy มาวาง'
  $sec = Read-Host 'วาง token แล้วกด Enter' -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
function Get-HttpCode($err) {
  try { return [int]$err.Exception.Response.StatusCode } catch { return $null }
}
function Format-Local($iso) {
  try { return ([datetime]$iso).ToLocalTime().ToString('dd/MM/yyyy HH:mm') } catch { return '' }
}
# "1.5.0" newer than "1.4.2"? (a value that is not x.y.z counts as oldest)
function Test-Newer($a, $b) {
  $va = $null; $vb = $null
  if (-not [version]::TryParse("$a".TrimStart('v'), [ref]$va)) { return $false }
  if (-not [version]::TryParse("$b".TrimStart('v'), [ref]$vb)) { return $true }
  return $va -gt $vb
}
function Get-Latest($token) {
  $headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'purim-pos-updater'; Accept = 'application/vnd.github+json' }
  try {
    $rel = Invoke-RestMethod "$ApiBase/repos/$Repo/releases/latest" -Headers $headers -UseBasicParsing -ErrorAction Stop
  } catch {
    $code = Get-HttpCode $_
    if ($code -eq 404) {
      # 404 = no release yet, or the token cannot see the repository at all
      try {
        Invoke-RestMethod "$ApiBase/repos/$Repo" -Headers $headers -UseBasicParsing -ErrorAction Stop | Out-Null
        return @{ ok = $false; noRelease = $true; error = "ยังไม่มี Release บน GitHub ($Repo) — สร้างโดย push tag เช่น v1.5.0 แล้วรอ GitHub Actions build เสร็จ" }
      } catch {}
    }
    if ($code -eq 401 -or $code -eq 403 -or $code -eq 404) {
      return @{ ok = $false; badToken = $true; error = "token ใช้ไม่ได้หรือไม่มีสิทธิ์อ่าน $Repo (HTTP $code)" }
    }
    return @{ ok = $false; error = "เชื่อมต่อ GitHub ไม่ได้: $($_.Exception.Message)" }
  }
  $assets = @{}
  foreach ($a in @($rel.assets)) { $assets[$a.name] = $a }
  if (-not $assets.ContainsKey($PayloadAsset) -or -not $assets.ContainsKey($SumsAsset)) {
    return @{ ok = $false; error = "Release $($rel.tag_name) ยังไม่มีไฟล์ $PayloadAsset (GitHub Actions อาจยัง build ไม่เสร็จ — ลองใหม่ภายหลัง)" }
  }
  # commit of the tag: recognises an install made from the same code (optional)
  $sha = $null; $commitMsg = ''
  try {
    $c = Invoke-RestMethod "$ApiBase/repos/$Repo/commits/$($rel.tag_name)" -Headers $headers -UseBasicParsing -ErrorAction Stop
    $sha = "$($c.sha)"; $commitMsg = (($c.commit.message -split "`n")[0])
  } catch {}
  $title = if ($rel.name) { "$($rel.name)" } else { $commitMsg }
  $shortSha = if ($sha) { $sha.Substring(0, 7) } else { '' }
  return @{ ok = $true; headers = $headers; token = $token; tag = "$($rel.tag_name)"; version = "$($rel.tag_name)".TrimStart('v')
    sha = $sha; short = $shortSha; message = $title; date = (Format-Local $rel.published_at); iso = "$($rel.published_at)"
    url = "$($rel.html_url)"; assets = $assets }
}
# Release asset download. Private repo: GET the API asset URL with the token and
# Accept: application/octet-stream. GitHub answers 302 to a signed storage URL that must be
# fetched WITHOUT the Authorization header, so the redirect is followed by hand.
function Save-Asset($latest, $name, $outFile) {
  $asset = $latest.assets[$name]
  if (-not $asset) { throw "Release $($latest.tag) ไม่มีไฟล์ $name" }
  $req = [Net.HttpWebRequest]::Create("$ApiBase/repos/$Repo/releases/assets/$($asset.id)")
  $req.Accept = 'application/octet-stream'
  $req.UserAgent = 'purim-pos-updater'
  $req.Headers.Add('Authorization', "Bearer $($latest.token)")
  $req.AllowAutoRedirect = $false
  $req.Timeout = 60000
  $resp = $req.GetResponse()
  try {
    $code = [int]$resp.StatusCode
    if ($code -ge 300 -and $code -lt 400) {
      $location = $resp.Headers['Location']
      $resp.Close(); $resp = $null
      $wc = New-Object Net.WebClient
      $wc.Headers.Add('User-Agent', 'purim-pos-updater')
      try { $wc.DownloadFile($location, $outFile) } finally { $wc.Dispose() }
    } else {
      $fs = [IO.File]::Create($outFile)
      try { $resp.GetResponseStream().CopyTo($fs) } finally { $fs.Close() }
    }
  } finally { if ($resp) { $resp.Close() } }
  if ((Get-Item -LiteralPath $outFile).Length -ne [long]$asset.size) { throw "ดาวน์โหลด $name ไม่ครบ" }
}
function Get-Sums($file) {
  $map = @{}
  foreach ($line in (Get-Content -LiteralPath $file)) {
    $parts = "$line".Trim() -split '\s+', 2
    if ($parts.Count -eq 2) { $map[$parts[1].TrimStart('*')] = $parts[0].ToLowerInvariant() }
  }
  return $map
}
function Test-Sha($file, $expected) {
  if (-not $expected) { return $false }
  return ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq "$expected".ToLowerInvariant())
}

# ---------------------------------------------------------------- set-token
if ($Mode -eq 'set-token') {
  $plain = $env:PURIM_GH_TOKEN
  if (-not $plain) { Done 1 'ไม่ได้ใส่ token' }
  $l = Get-Latest $plain
  # "no release yet" still proves the token can read the repository
  if (-not $l.ok -and -not $l.noRelease) { Done 1 $l.error }
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

# Up to date = installed from the same release tag (or the same commit), or from something newer.
# Installs made before v1.5 have no "tag" in VERSION.json: they are offered the release once.
$upToDate = $false
if ($installed -and -not $installed.modified) {
  if ($installed.tag -and "$($installed.tag)" -eq $latest.tag) { $upToDate = $true }
  elseif ($latest.sha -and "$($installed.commit)" -eq $latest.sha) { $upToDate = $true }
  elseif ($installed.version -and (Test-Newer $installed.version $latest.version)) { $upToDate = $true }
}
$latestInfo = [ordered]@{ version = $latest.version; tag = $latest.tag; commit = $latest.sha; short = $latest.short
  message = $latest.message; committedAt = $latest.date; publishedAt = $latest.iso; url = $latest.url }

# ---------------------------------------------------------------- check
if ($Mode -eq 'check') {
  Done 0 ($(if ($upToDate) { 'เป็นเวอร์ชันล่าสุดแล้ว' } else { "มีเวอร์ชันใหม่ $($latest.tag)" })) 'Gray' @{ installed = $installed; latest = $latestInfo; upToDate = $upToDate; needToken = $false }
}

# ---------------------------------------------------------------- run / interactive
if ($Mode -eq 'run') {
  Start-Transcript -Path (Join-Path $LogDir ("update-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')) -Append | Out-Null
}
Set-Status 'running' 'check' "เวอร์ชันล่าสุด $($latest.tag): $($latest.message)" @{ target = $latestInfo }
Say "ล่าสุดบน GitHub: $($latest.tag)  $($latest.date)  $($latest.message)" 'Cyan'
if ($installed) {
  $installedLabel = if ($installed.tag) { "$($installed.tag)" } elseif ($installed.commit) { "$($installed.commit)".Substring(0, [Math]::Min(7, "$($installed.commit)".Length)) } else { '-' }
  Say "ที่ติดตั้งอยู่:    $installedLabel  $($installed.installedAt)"
}
if ($upToDate -and -not $Force) { Done 0 'เป็นเวอร์ชันล่าสุดอยู่แล้ว ไม่ต้องอัปเดต' 'Green' }
if ($Interactive) {
  $answer = Read-Host 'อัปเดตตอนนี้เลยไหม? ระหว่างอัปเดตเครื่องขายจะใช้งานไม่ได้ประมาณ 5-10 นาที (y/n)'
  if ($answer -notmatch '^(y|Y|yes|ใช่)$') { Done 0 'ยกเลิกการอัปเดต' 'Yellow' }
}

# Download and verify everything BEFORE stopping the server: a failed download changes nothing.
Set-Status 'running' 'download' "กำลังดาวน์โหลด $($latest.tag) จาก GitHub Releases"
Say "[1/3] ดาวน์โหลด $($latest.tag) จาก GitHub Releases" 'Cyan'
$work = Join-Path $env:TEMP "purim-update-$($latest.tag)"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null
$zip = Join-Path $work $PayloadAsset
$sumsFile = Join-Path $work $SumsAsset
$clientExe = Join-Path $work $ClientAsset
$clientJson = Join-Path $work $ClientJsonAsset
$withClient = $latest.assets.ContainsKey($ClientAsset) -and $latest.assets.ContainsKey($ClientJsonAsset)
try {
  Save-Asset $latest $SumsAsset $sumsFile
  $sums = Get-Sums $sumsFile
  Save-Asset $latest $PayloadAsset $zip
  if (-not (Test-Sha $zip $sums[$PayloadAsset])) { throw "$PayloadAsset ไม่ตรงกับ SHA256SUMS" }
  if ($withClient) {
    Set-Status 'running' 'download' 'กำลังดาวน์โหลดแอปเครื่องลูก (สำหรับอัปเดตเครื่องขาย)'
    Save-Asset $latest $ClientJsonAsset $clientJson
    Save-Asset $latest $ClientAsset $clientExe
    $cv = Read-JsonFile $clientJson
    if (-not (Test-Sha $clientExe $sums[$ClientAsset]) -or -not $cv -or -not (Test-Sha $clientExe $cv.sha256)) { throw "$ClientAsset ไม่ตรงกับ SHA256SUMS / client-version.json" }
  } else {
    Say "    !! Release นี้ไม่มี $ClientAsset — ข้ามการอัปเดตแอปเครื่องลูก" 'Yellow'
  }
} catch { Done 1 "ดาวน์โหลดไม่สำเร็จ: $($_.Exception.Message)" 'Red' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = Join-Path $work 'x'
try { [IO.Compression.ZipFile]::ExtractToDirectory($zip, $src) } catch { Done 1 "แตกไฟล์ไม่สำเร็จ: $($_.Exception.Message)" 'Red' }
foreach ($need in @('VERSION.json', 'backend\package.json', 'frontend\package.json', 'Installer\Server\setup\install-server.ps1')) {
  if (-not (Test-Path (Join-Path $src $need))) { Done 1 "ไฟล์ที่ดาวน์โหลดไม่ครบ (ไม่พบ $need)" 'Red' }
}
$newVersion = Read-JsonFile (Join-Path $src 'VERSION.json')

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
# control panel (source + exe); install-server.ps1 copies the exe next to the install folder
& robocopy (Join-Path $src 'Installer\Server\control') (Join-Path $InstallDir 'Installer\Server\control') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $src 'docker-compose.yml') $InstallDir -Force
Get-ChildItem $src -Filter '*.txt' -File | Copy-Item -Destination $InstallDir -Force
if ($withClient) {
  # served to cashier machines by GET /api/client-app/latest|download; json last so the
  # advertised version always has its installer next to it
  New-Item -ItemType Directory -Force -Path $DownloadsDir | Out-Null
  Remove-Item (Join-Path $DownloadsDir $ClientJsonAsset) -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $clientExe -Destination (Join-Path $DownloadsDir $ClientAsset) -Force
  Copy-Item -LiteralPath $clientJson -Destination (Join-Path $DownloadsDir $ClientJsonAsset) -Force
  # the old location (installs before v1.5) is no longer used
  Remove-Item (Join-Path $InstallDir 'Installer\Client') -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $InstallDir 'backend\src\main.ts'))) { Done 1 'คัดลอกไฟล์ไม่สำเร็จ — กดอัปเดตอีกครั้ง' 'Red' }

Set-Status 'running' 'install' 'กำลังสำรองข้อมูล อัปเดตฐานข้อมูล และ build ระบบ (5-10 นาที)'
Say '[3/3] สำรองข้อมูล > อัปเดตฐานข้อมูล > build > เปิดเซิร์ฟเวอร์' 'Cyan'
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'Installer\Server\setup\install-server.ps1') -InstallDir $InstallDir -NoElevate
$rc = $LASTEXITCODE
if ($rc -eq 0) {
  $info = [ordered]@{ version = $latest.version; tag = $latest.tag; commit = $latest.sha; branch = 'release'; message = $latest.message
    committedAt = $latest.date; committedAtIso = $latest.iso; modified = $false }
  if ($newVersion) {
    foreach ($k in @('version', 'tag', 'commit', 'branch', 'message', 'committedAt', 'committedAtIso')) {
      if ($newVersion.$k) { $info[$k] = $newVersion.$k }
    }
  }
  $info['installedAt'] = (Get-Date -Format 'dd/MM/yyyy HH:mm')
  $info['source'] = 'github-release'
  Write-Json $VersionFile $info
  Done 0 "อัปเดตเป็นเวอร์ชัน $($latest.tag) เรียบร้อย" 'Green' @{ installed = $info }
}
Done $rc "อัปเดตยังไม่สำเร็จ (รหัส $rc) — ดู logs\install-*.log" 'Red'
