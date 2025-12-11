<#
backup_unneeded.ps1

Preview and optionally move likely dev/log/test/backups into a timestamped BackupFolder.

Usage:
  # Preview what would be moved (no changes):
  powershell -ExecutionPolicy Bypass -File .\backup_unneeded.ps1

  # Actually perform the move (after you review):
  powershell -ExecutionPolicy Bypass -File .\backup_unneeded.ps1 -Execute

Notes:
- The script looks for common dev/log/backup/test filename patterns. Review the preview list carefully
  and edit the $patterns array in this file if you want to include/exclude other patterns.
- This script preserves relative paths under the new BackupFolder_<timestamp>.
- It will not touch node_modules or .git folders.
#>
[CmdletBinding()]
param(
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$timestamp = (Get-Date).ToString('yyyyMMdd_HHmmss')
$backupRoot = Join-Path $root ("BackupFolder_$timestamp")
Write-Host "Project root: $root"
Write-Host "Backup folder will be: $backupRoot"

# Patterns to consider for backup (edit as needed)
$patterns = @(
    '*.bak',
    '*.bak.bak',
    '*.download',
    '*_backup*',
    '*_BACKUP*',
    '*.log',
    '*server_*.txt',
    'server_*.txt',
    'server_logs*.txt',
    'server_output*.txt',
    '*_debug*.txt',
    '*_trace*.txt',
    '*_output*.txt',
    '*_test*.js',
    'test_*.js',
    '*test*.ps1',
    'test_*.ps1',
    '*.tmp',
    '*.old',
    '*.stack',
    '*.pid'
)

# Folders to exclude
$excludeFolders = @('.git', 'node_modules', 'BackupFolder*', 'Backup*')

Write-Host "Scanning for candidate files..." -ForegroundColor Cyan
$allFiles = Get-ChildItem -Path $root -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object {
        # skip files inside excluded folders
        $full = $_.FullName.ToLower()
        foreach ($ex in $excludeFolders) { if ($full -like "*\\$ex\\*" -or $full -like "*\\$ex") { return $false } }
        foreach ($p in $patterns) { if ($_.Name -like $p) { return $true } }
        return $false
    }

if (-not $allFiles) {
    Write-Host "No matching candidate files found. Edit patterns in the script if needed." -ForegroundColor Yellow
    exit 0
}

# Show preview
Write-Host "Found $($allFiles.Count) candidate files:" -ForegroundColor Green
$allFiles | ForEach-Object { Write-Host " - " $_.FullName }

if (-not $Execute) {
    Write-Host "\nPreview only. Run with -Execute to move these files into the backup folder." -ForegroundColor Cyan
    Write-Host "If OK, run:\n  powershell -ExecutionPolicy Bypass -File .\backup_unneeded.ps1 -Execute" -ForegroundColor White
    exit 0
}

# Perform move
Write-Host "\nCreating backup folder and moving files..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

foreach ($f in $allFiles) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/')
    $dest = Join-Path $backupRoot $rel
    $destDir = Split-Path -Path $dest -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    try {
        Move-Item -Path $f.FullName -Destination $dest -Force
        Write-Host "Moved: $rel" -ForegroundColor Green
    } catch {
        Write-Host "Failed to move: $rel -> $_" -ForegroundColor Red
    }
}

Write-Host "\nBackup complete. Files moved under: $backupRoot" -ForegroundColor Green
Write-Host "Please inspect the backup and restart your server as needed." -ForegroundColor Cyan
