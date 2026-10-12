param([switch]$DryRun)
. "$PSScriptRoot\launcher-common.ps1"
trap {
  if (Get-Command Write-LauncherError -ErrorAction SilentlyContinue) { Write-LauncherError $_ }
  else { [Console]::Error.WriteLine("[LAUNCHER_FAILED] $($_.Exception.Message)") }
  exit 1
}
$mutex = Enter-LauncherLock
try { Invoke-LogCleanup -DryRun:$DryRun | ConvertTo-Json -Depth 4 }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
