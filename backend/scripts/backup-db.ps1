# ==============================================================================
# Purim POS - Automated Database Backup Script (PostgreSQL to Google Drive)
# ==============================================================================

param (
    [string]$ContainerName = "pos-purim-db",
    [string]$DbUser = "pos_admin",
    [string]$DbName = "pos_purim",
    [string]$BackupDir = "D:\Purim-POS-Backups",
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Write-Host "[INFO] Created backup directory at: $BackupDir" -ForegroundColor Cyan
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFileName = "backup-" + $DbName + "-" + $Timestamp + ".sql"
$BackupFilePath = Join-Path -Path $BackupDir -ChildPath $BackupFileName

Write-Host "======================================================" -ForegroundColor Yellow
Write-Host "  Starting Purim POS Database Backup" -ForegroundColor Yellow
Write-Host "  Time: $(Get-Date)" -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Yellow

try {
    Write-Host "[1/3] Dumping database from container $ContainerName..." -ForegroundColor Cyan
    docker exec -t $ContainerName pg_dump -U $DbUser -d $DbName --clean --if-exists | Out-File -FilePath $BackupFilePath -Encoding utf8

    if (Test-Path $BackupFilePath) {
        $fileSize = (Get-Item $BackupFilePath).Length
        Write-Host "[2/3] Dump finished: $BackupFileName (Bytes: $fileSize)" -ForegroundColor Green
    } else {
        throw "Backup file was not created. Please check Docker container."
    }

    $ZipPath = $BackupFilePath + ".zip"
    Compress-Archive -Path $BackupFilePath -DestinationPath $ZipPath -Force
    Remove-Item -Path $BackupFilePath -Force
    Write-Host "[3/3] Compressed to ZIP: $ZipPath" -ForegroundColor Green

    # Rotate old backups
    Write-Host "[INFO] Cleaning up backups older than $RetentionDays days..." -ForegroundColor Gray
    Get-ChildItem -Path $BackupDir -Filter "backup-*.zip" | 
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } | 
        ForEach-Object {
            Remove-Item -Path $_.FullName -Force
            Write-Host "  - Removed old backup: $($_.Name)" -ForegroundColor DarkGray
        }

    Write-Host "`n[SUCCESS] Backup completed successfully! Ready for Google Drive sync." -ForegroundColor Green
} catch {
    Write-Host "`n[ERROR] Backup failed: $_" -ForegroundColor Red
    exit 1
}
