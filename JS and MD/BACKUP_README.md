Backup script for production prep

Files:
- backup_unneeded.ps1: PowerShell script to preview and move likely dev/test/log/backup files into a timestamped BackupFolder.

How to use (Windows PowerShell):

1) Preview what the script will move (safe, no changes):

```powershell
powershell -ExecutionPolicy Bypass -File .\backup_unneeded.ps1
```

2) If the preview looks correct, run to actually move files:

```powershell
powershell -ExecutionPolicy Bypass -File .\backup_unneeded.ps1 -Execute
```

Notes:
- The script uses filename patterns defined near the top. Edit `backup_unneeded.ps1` to change included/excluded patterns.
- The script will create a folder `BackupFolder_<timestamp>` in the project root and preserve relative paths.
- It excludes `.git`, `node_modules`, and existing `BackupFolder*` folders by default.
- Review the preview output carefully before executing.
