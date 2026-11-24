<#
  Purim POS - online shop through a Cloudflare Tunnel (run as Administrator on the server PC).

    setup-cloudflare-tunnel.ps1 -Token <tunnel token> -Hostname shop.example.com
    setup-cloudflare-tunnel.ps1 -Uninstall

  The tunnel itself is created in the Cloudflare Zero Trust dashboard (Networks > Tunnels) with ONE public
  hostname whose service is http://localhost:3080 - the backend's online-shop gateway, which serves only /shop,
  /api/public/shop/*, the LINE webhook /api/public/line/webhook (signed by LINE) and the page's static files
  (everything else 404). This script:
    1. installs cloudflared (winget) when missing
    2. installs it as a Windows service with the token (starts with Windows)
    3. writes SHOP_PUBLIC_HOST=<hostname> to backend\.env (requests for that host name are treated as internet
       traffic by the backend and the web server too)
    4. checks that the gateway port answers /shop and refuses the back office
  Guide (Thai): Installer\Server\คู่มือร้านออนไลน์ LINE (Cloudflare Tunnel).txt
#>
param(
  [string]$Token = '',
  [string]$Hostname = '',
  [switch]$Uninstall,
  [string]$InstallDir = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Say($m) { Write-Host "  $m" }
function Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [X] $m" -ForegroundColor Red; exit 1 }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'กรุณาเปิด PowerShell แบบ Run as administrator' }

if (-not $InstallDir) { $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
$EnvFile = Join-Path $InstallDir 'backend\.env'

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Set-EnvLine([string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $EnvFile) { $lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -notmatch "^\s*$Key\s*=" }) }
  if ($Value) { $lines += "$Key=$Value" }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($EnvFile, (($lines -join "`r`n") + "`r`n"), $utf8)
}

function Invoke-Cf([string[]]$CfArgs) {
  # cloudflared logs to stderr; under ErrorActionPreference=Stop Windows PowerShell 5.1 turns that into a
  # terminating NativeCommandError, so run it with Continue and judge by the exit code only
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $cf @CfArgs 2>&1 | ForEach-Object { "$_" }; return @{ Code = $LASTEXITCODE; Out = ($out -join "`n") } }
  finally { $ErrorActionPreference = $old }
}

if ($Uninstall) {
  $cf = Find-Cloudflared
  if ($cf) {
    $null = Invoke-Cf @('service', 'uninstall')
    Ok 'ถอน service cloudflared แล้ว (ร้านออนไลน์เข้าจากอินเทอร์เน็ตไม่ได้แล้ว)'
  } else { Warn 'ไม่พบ cloudflared' }
  Set-EnvLine 'SHOP_PUBLIC_HOST' ''
  Say 'รีสตาร์ทเซิร์ฟเวอร์จากโปรแกรม Purim POS Server 1 ครั้ง'
  exit 0
}

if (-not $Token) { Fail 'ต้องใส่ -Token (คัดลอกจาก Zero Trust > Networks > Tunnels > Install connector)' }
$Token = $Token.Trim()
if ($Token -match '\s') { Fail 'token ต้องเป็นข้อความยาวบรรทัดเดียว ไม่มีช่องว่าง (คัดลอกเฉพาะ token ไม่ต้องเอาคำสั่งข้างหน้า)' }
if ($Hostname -and $Hostname -notmatch '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') { Fail 'Hostname ไม่ถูกต้อง ตัวอย่าง: shop.purimshop.com (ไม่ต้องมี https://)' }

Write-Host ''
Write-Host '== Purim POS : ร้านออนไลน์ผ่าน Cloudflare Tunnel ==' -ForegroundColor Cyan

# 1. cloudflared
$cf = Find-Cloudflared
if (-not $cf) {
  Say 'กำลังติดตั้ง cloudflared ...'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail 'ไม่พบ winget: ดาวน์โหลด cloudflared-windows-amd64.msi จาก https://github.com/cloudflare/cloudflared/releases/latest แล้วติดตั้ง จากนั้นรันสคริปต์นี้อีกครั้ง' }
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Host
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $cf = Find-Cloudflared
  if (-not $cf) { Fail 'ติดตั้ง cloudflared ไม่สำเร็จ' }
}
Ok "cloudflared: $cf"

# 2. service with the token (re-install replaces an older token)
$null = Invoke-Cf @('service', 'uninstall')
Start-Sleep -Seconds 2
$inst = Invoke-Cf @('service', 'install', $Token)
if ($inst.Code -ne 0) { Write-Host $inst.Out; Fail 'ติดตั้ง service cloudflared ไม่สำเร็จ (ดูข้อความด้านบน: token ถูกต้องไหม?)' }
Start-Sleep -Seconds 3
$svc = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') { Ok 'service Cloudflared ทำงานแล้ว (เปิดเองทุกครั้งที่เปิดเครื่อง)' } else { Warn 'service Cloudflared ยังไม่ทำงาน: เปิด services.msc แล้ว Start "Cloudflared agent"' }

# 3. public host name for the server
if ($Hostname) {
  Set-EnvLine 'SHOP_PUBLIC_HOST' $Hostname.ToLower()
  Ok "บันทึก SHOP_PUBLIC_HOST=$($Hostname.ToLower()) ใน backend\.env"
}

# 4. the gateway answers only the shop
$port = 3080
try {
  $shop = Invoke-WebRequest "http://127.0.0.1:$port/shop" -UseBasicParsing -TimeoutSec 8
  if ($shop.StatusCode -eq 200) { Ok "พอร์ต $port เปิดหน้าร้านออนไลน์ได้" }
} catch { Warn "พอร์ต $port ยังไม่ตอบ (เซิร์ฟเวอร์ปิดอยู่?) — เปิดเซิร์ฟเวอร์แล้วตรวจใหม่" }
foreach ($p in @('/pos', '/login', '/api/products')) {
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$port$p" -UseBasicParsing -TimeoutSec 8
    Fail "พอร์ต $port เปิด $p ได้ (ต้องไม่ได้!) — อย่าเปิด tunnel จนกว่าจะแก้"
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 404) { Ok "$p ถูกปิดจากอินเทอร์เน็ต (404)" } else { Warn "$p ตอบ $code" }
  }
}

Write-Host ''
Say 'ต่อไป:'
Say '  1) ใน Zero Trust > Tunnels > Public Hostname ต้องชี้ไปที่  HTTP  localhost:3080  เท่านั้น'
Say '  2) รีสตาร์ทเซิร์ฟเวอร์จากโปรแกรม Purim POS Server 1 ครั้ง'
if ($Hostname) {
  Say "  3) ใช้เน็ตมือถือเปิด https://$Hostname/shop (ต้องเปิดได้) และ https://$Hostname/pos (ต้อง Not Found)"
}
