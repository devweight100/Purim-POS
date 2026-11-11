# Purim POS - smoke checks of the built release files (GitHub Actions release.yml, or locally on Windows).
#   pwsh Installer/verify-release.ps1 -Version 1.5.0 [-Dist Installer/dist] [-InstallClient]
# Checks: SHA256SUMS, client-version.json, server installer payload (extracted with 7-Zip, nothing is
# installed), update payload zip, and with -InstallClient a silent install of the client app.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Dist = '',
  [switch]$InstallClient
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Dist) { $Dist = Join-Path $Root 'Installer\dist' }
$Dist = (Resolve-Path $Dist).Path
$Version = $Version.TrimStart('v')
$script:Failures = @()
function Check($ok, $text) {
  if ($ok) { Write-Host "  OK   $text" -ForegroundColor Green } else { Write-Host "  FAIL $text" -ForegroundColor Red; $script:Failures += $text }
}
function Sha($f) { return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() }
function Read-Json($f) { return (Get-Content -LiteralPath $f -Raw -Encoding UTF8).TrimStart([char]0xFEFF) | ConvertFrom-Json }

$ServerExe = Join-Path $Dist 'Purim-POS-Server-Setup.exe'
$ClientExe = Join-Path $Dist 'Purim-POS-Client-Setup.exe'
$ClientJson = Join-Path $Dist 'client-version.json'
$PayloadZip = Join-Path $Dist 'Purim-POS-Server-Payload.zip'
$Sums = Join-Path $Dist 'SHA256SUMS.txt'

Write-Host '== release files'
foreach ($f in @($ServerExe, $ClientExe, $ClientJson, $PayloadZip, $Sums)) { Check (Test-Path -LiteralPath $f) "exists: $(Split-Path $f -Leaf)" }
if ($script:Failures.Count) { exit 1 }
foreach ($line in (Get-Content -LiteralPath $Sums | Where-Object { $_.Trim() })) {
  $hash, $name = $line -split '\s+', 2
  Check ((Sha (Join-Path $Dist $name)) -eq $hash) "SHA256SUMS: $name"
}
$cv = Read-Json $ClientJson
Check ($cv.version -eq $Version) "client-version.json version $($cv.version)"
Check ($cv.sha256 -eq (Sha $ClientExe)) 'client-version.json sha256 matches the client installer'
Check ($cv.size -eq (Get-Item -LiteralPath $ClientExe).Length) 'client-version.json size matches'
Check ((Get-Item -LiteralPath $ServerExe).VersionInfo.ProductVersion -eq $Version) 'server installer ProductVersion'

$Required = @(
  'VERSION.json', 'docker-compose.yml', 'Purim POS Server.exe',
  'backend\package.json', 'backend\package-lock.json', 'backend\prisma\schema.prisma', 'backend\src\main.ts', 'backend\scripts\prepare-database.js',
  'frontend\package.json', 'frontend\package-lock.json', 'frontend\next.config.ts',
  'Installer\Server\setup\install-server.ps1', 'Installer\Server\setup\update-from-github.ps1', 'Installer\Server\setup\purim-server.js',
  'Installer\Server\control\Purim POS Server.exe'
)
$Forbidden = @('backend\node_modules', 'frontend\node_modules', 'frontend\.next', 'backend\dist', 'backend\.env', 'backend\.jwt-secret', 'backend\backups')

function Check-Payload($dir, $label, [bool]$withClient) {
  $v = Read-Json (Join-Path $dir 'VERSION.json')
  Check ($v.version -eq $Version) "${label}: VERSION.json version $($v.version)"
  Check ($v.tag -eq "v$Version") "${label}: VERSION.json tag $($v.tag)"
  Check ($v.commit -match '^[0-9a-f]{40}$') "${label}: VERSION.json commit $($v.commit)"
  Check ($v.modified -eq $false) "${label}: VERSION.json modified=false"
  foreach ($f in $Required) { Check (Test-Path -LiteralPath (Join-Path $dir $f)) "${label}: $f" }
  foreach ($f in $Forbidden) { Check (-not (Test-Path -LiteralPath (Join-Path $dir $f))) "${label}: no $f" }
  $dl = Join-Path $dir 'downloads'
  if ($withClient) {
    Check ((Test-Path -LiteralPath (Join-Path $dl 'Purim-POS-Client-Setup.exe')) -and (Sha (Join-Path $dl 'Purim-POS-Client-Setup.exe')) -eq $cv.sha256) "${label}: downloads\Purim-POS-Client-Setup.exe = released client"
    Check ((Test-Path -LiteralPath (Join-Path $dl 'client-version.json')) -and (Read-Json (Join-Path $dl 'client-version.json')).sha256 -eq $cv.sha256) "${label}: downloads\client-version.json"
  } else {
    Check (-not (Test-Path -LiteralPath $dl)) "${label}: no downloads\ (client comes as its own asset)"
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    & $node.Source --check (Join-Path $dir 'Installer\Server\setup\purim-server.js')
    Check ($LASTEXITCODE -eq 0) "${label}: purim-server.js syntax"
  }
  return $v
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('purim-verify-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  Write-Host '== server installer payload (7-Zip extract, nothing installed)'
  $sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
  $sevenZipExe = if ($sevenZip) { $sevenZip.Source } else { Join-Path $env:ProgramFiles '7-Zip\7z.exe' }
  $sx = Join-Path $work 'setup'
  & $sevenZipExe x -y "-o$sx" $ServerExe | Out-Null
  Check ($LASTEXITCODE -eq 0) '7-Zip extracted the server installer'
  $vf = Get-ChildItem -LiteralPath $sx -Recurse -Filter 'VERSION.json' -File | Sort-Object { $_.FullName.Length } | Select-Object -First 1
  Check ([bool]$vf) 'server installer contains VERSION.json'
  if ($vf) { $sv = Check-Payload $vf.DirectoryName 'setup' $true }

  Write-Host '== update payload zip'
  $zx = Join-Path $work 'zip'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($PayloadZip, $zx)
  $zv = Check-Payload $zx 'payload.zip' $false
  if ($sv) { Check ($zv.commit -eq $sv.commit) 'payload.zip and server installer have the same commit' }

  Write-Host '== PowerShell scripts parse'
  foreach ($ps in (Get-ChildItem -LiteralPath (Join-Path $Root 'Installer') -Recurse -Filter '*.ps1' -File)) {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($ps.FullName, [ref]$null, [ref]$errs)
    Check ($errs.Count -eq 0) "parse $($ps.Name) $(($errs | ForEach-Object { $_.Message + ' @' + $_.Extent.StartLineNumber }) -join '; ')"
  }

  if ($InstallClient) {
    Write-Host '== client app silent install'
    $p = Start-Process -FilePath $ClientExe -ArgumentList '/S' -Wait -PassThru
    Check ($p.ExitCode -eq 0) "client installer exit code $($p.ExitCode)"
    $app = Join-Path $env:ProgramFiles 'Purim POS\Purim POS.exe'
    for ($i = 0; $i -lt 60 -and -not (Test-Path -LiteralPath $app); $i++) { Start-Sleep -Seconds 2 }
    Check (Test-Path -LiteralPath $app) "installed: $app"
    if (Test-Path -LiteralPath $app) {
      $pv = (Get-Item -LiteralPath $app).VersionInfo.ProductVersion
      Check ($pv -like "$Version*") "installed app version $pv"
    }
  }
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

if ($script:Failures.Count) {
  Write-Host "$($script:Failures.Count) check(s) failed" -ForegroundColor Red
  exit 1
}
Write-Host 'all checks passed' -ForegroundColor Green
