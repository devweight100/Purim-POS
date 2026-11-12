# Purim POS - build the Windows release files on Windows (GitHub Actions: .github/workflows/release.yml,
# or locally in PowerShell). Linux + wine: Installer/build-installers.sh does the same.
#
#   pwsh Installer/build-installers.ps1 [-What all|client|control|server] [-Version 1.5.0] [-OutDir Installer/dist]
#
# Output (git-ignored, never committed; published as GitHub Release assets):
#   Purim-POS-Server-Setup.exe     server machine installer (code + control panel + client installer)
#   Purim-POS-Client-Setup.exe     cashier machines (Electron app)
#   client-version.json            { version, file, size, sha256 } served by the server to client machines
#   Purim-POS-Server-Payload.zip   the server program files (no client app) used by "อัปเดตระบบ (GitHub)"
#   SHA256SUMS.txt                 sha256 of the files above
#   Purim POS Server.exe           control panel (also inside the server installer)
# Needs: Node.js 22 + npm, git, NSIS (makensis), .NET Framework 4.x csc (always present on Windows).
param(
  [ValidateSet('all', 'client', 'control', 'server')]
  [string]$What = 'all',
  [string]$Version = '',
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Version) { $Version = (Get-Content (Join-Path $Root 'desktop\package.json') -Raw | ConvertFrom-Json).version }
$Version = $Version.Trim().TrimStart('v')
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.5.0 (got '$Version')" }
if (-not $OutDir) { $OutDir = Join-Path $Root 'Installer\dist' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$ClientExe = Join-Path $OutDir 'Purim-POS-Client-Setup.exe'
$ClientJson = Join-Path $OutDir 'client-version.json'
$ControlExe = Join-Path $OutDir 'Purim POS Server.exe'
$ServerExe = Join-Path $OutDir 'Purim-POS-Server-Setup.exe'
$PayloadZip = Join-Path $OutDir 'Purim-POS-Server-Payload.zip'

function Invoke-Native($exe, [string[]]$argList, $what) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}
function Get-Sha256($file) { return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }

function Build-Client {
  Write-Host "== client app $Version" -ForegroundColor Cyan
  $desktop = Join-Path $Root 'desktop'
  Push-Location $desktop
  try {
    if (-not (Test-Path 'node_modules')) { Invoke-Native 'npm.cmd' @('ci', '--no-audit', '--no-fund') 'npm ci (desktop)' }
    Remove-Item 'release-bin' -Recurse -Force -ErrorAction SilentlyContinue
    # version from the tag, without editing package.json
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    Invoke-Native 'npx.cmd' @('electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', "-c.extraMetadata.version=$Version") 'electron-builder'
  } finally { Pop-Location }
  Copy-Item -LiteralPath (Join-Path $desktop 'release-bin\Purim-POS-Client-Setup.exe') -Destination $ClientExe -Force
  $info = [ordered]@{ version = $Version; file = 'Purim-POS-Client-Setup.exe'; size = (Get-Item -LiteralPath $ClientExe).Length; sha256 = (Get-Sha256 $ClientExe) }
  [IO.File]::WriteAllText($ClientJson, ($info | ConvertTo-Json), $Utf8)
  Get-Item -LiteralPath $ClientExe, $ClientJson | Format-Table Name, Length -AutoSize | Out-String | Write-Host
}

function Build-Control {
  Write-Host '== control panel (Purim POS Server.exe)' -ForegroundColor Cyan
  # .NET Framework 4.x compiler (C# 5): ServerControl.cs must stay C# 5 compatible
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
  if (-not (Test-Path $csc)) { throw 'csc.exe (.NET Framework 4.x) not found' }
  $dir = Join-Path $Root 'Installer\Server\control'
  Invoke-Native $csc @('/nologo', '/target:winexe', '/optimize+', '/nowarn:219,414', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    "/win32icon:$(Join-Path $dir 'server.ico')", "/out:$ControlExe", (Join-Path $dir 'ServerControl.cs')) 'csc'
  Get-Item -LiteralPath $ControlExe | Format-Table Name, Length -AutoSize | Out-String | Write-Host
}

function Find-Makensis {
  $cmd = Get-Command 'makensis' -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  throw 'makensis not found (choco install nsis)'
}

function Format-ThaiDate([datetime]$utc) {
  $tz = $null
  foreach ($id in @('Asia/Bangkok', 'SE Asia Standard Time')) {
    try { $tz = [TimeZoneInfo]::FindSystemTimeZoneById($id); break } catch {}
  }
  $d = if ($tz) { [TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz) } else { $utc.ToLocalTime() }
  return $d.ToString('dd/MM/yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture)
}

function Build-Server {
  Write-Host "== server installer $Version" -ForegroundColor Cyan
  foreach ($f in @($ClientExe, $ClientJson, $ControlExe)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "missing $f (build 'client' and 'control' first, or use -What all)" }
  }
  $makensis = Find-Makensis
  $stage = Join-Path ([IO.Path]::GetTempPath()) ('purim-stage-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Push-Location $Root
  try {
    # Tracked + new (not git-ignored) source files only: no node_modules, .env, builds or backups.
    # quotepath=off: non-ASCII (Thai) names come out as plain UTF-8, one per line
    $files = & git -c core.quotepath=off ls-files -co --exclude-standard -- backend frontend shared docker-compose.yml Installer/Server/setup Installer/Server/control
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
    $files = @($files | Where-Object { $_ -and $_ -notmatch '\.nsi$' -and $_ -notmatch '\.exe$' })
    foreach ($f in $files) {
      $src = Join-Path $Root $f
      if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue }
      $dst = Join-Path $stage $f
      New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
    Get-ChildItem -LiteralPath (Join-Path $Root 'Installer\Server') -Filter '*.txt' -File | Copy-Item -Destination $stage -Force
    Copy-Item -LiteralPath $ControlExe -Destination (Join-Path $stage 'Purim POS Server.exe') -Force
    Copy-Item -LiteralPath $ControlExe -Destination (Join-Path $stage 'Installer\Server\control\Purim POS Server.exe') -Force

    # Version of the code inside (read by the version screen, the monitor page and the updater)
    $modified = [bool](& git status --porcelain --untracked-files=no -- backend frontend shared desktop Installer/Server/setup)
    if ($modified) { Write-Warning 'uncommitted changes are included; the version will show as modified' }
    $iso = ([datetime]::Parse((& git log -1 --format=%cI), [Globalization.CultureInfo]::InvariantCulture)).ToUniversalTime()
    $ver = [ordered]@{
      version = $Version; tag = "v$Version"
      commit = (& git rev-parse HEAD).Trim(); branch = 'release'; message = (& git log -1 --format=%s).Trim()
      committedAt = (Format-ThaiDate $iso); committedAtIso = $iso.ToString('o')
      modified = $modified; installedAt = ''; source = 'installer'
    }
    [IO.File]::WriteAllText((Join-Path $stage 'VERSION.json'), ($ver | ConvertTo-Json), $Utf8)
  } finally { Pop-Location }

  # update payload for "อัปเดตระบบ (GitHub)": program files without the client app (that is its own asset)
  Remove-Item -LiteralPath $PayloadZip -Force -ErrorAction SilentlyContinue
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $PayloadZip, [IO.Compression.CompressionLevel]::Optimal, $false)

  # the server installer also carries the client app: installs it on the server machine and serves it to clients
  $dl = Join-Path $stage 'downloads'
  New-Item -ItemType Directory -Force -Path $dl | Out-Null
  Copy-Item -LiteralPath $ClientExe, $ClientJson -Destination $dl -Force
  $count = (Get-ChildItem $stage -Recurse -File).Count
  Write-Host "payload: $count files"
  Invoke-Native $makensis @('-V2', '-INPUTCHARSET', 'UTF8', "-DVERSION=$Version", "-DPAYLOAD=$stage", "-DOUTFILE=$ServerExe",
    (Join-Path $Root 'Installer\Server\setup\server-installer.nsi')) 'makensis'
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Get-Item -LiteralPath $ServerExe, $PayloadZip | Format-Table Name, Length -AutoSize | Out-String | Write-Host
}

function Write-Sums {
  $names = @('Purim-POS-Server-Setup.exe', 'Purim-POS-Client-Setup.exe', 'client-version.json', 'Purim-POS-Server-Payload.zip')
  $lines = foreach ($n in $names) {
    $p = Join-Path $OutDir $n
    if (Test-Path -LiteralPath $p) { "$(Get-Sha256 $p)  $n" }
  }
  [IO.File]::WriteAllText((Join-Path $OutDir 'SHA256SUMS.txt'), (($lines -join "`n") + "`n"), $Utf8)
  Get-Content (Join-Path $OutDir 'SHA256SUMS.txt') | Write-Host
}

switch ($What) {
  'client' { Build-Client; Write-Sums }
  'control' { Build-Control }
  'server' { Build-Server; Write-Sums }
  'all' { Build-Client; Build-Control; Build-Server; Write-Sums }
}
Write-Host "output: $OutDir" -ForegroundColor Green
