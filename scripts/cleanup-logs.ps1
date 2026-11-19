param([switch]$DryRun)
. "$PSScriptRoot\launcher-common.ps1"
trap {
  if (Get-Command Write-LauncherError -ErrorAction SilentlyContinue) { Write-LauncherError $_ }
  else { [Console]::Error.WriteLine("[LAUNCHER_FAILED] $($_.Exception.Message)") }
  exit 1
}
$mutex = Enter-LauncherLock
try {
  $previousWarningPreference = $WarningPreference
  try {
    $WarningPreference = "SilentlyContinue"
    $result = Invoke-LogCleanup -DryRun:$DryRun
  } finally { $WarningPreference = $previousWarningPreference }
  $result | ConvertTo-Json -Depth 4
  foreach ($warning in $result.warnings) { [Console]::Error.WriteLine($warning) }
  if ($result.exitCode -ne 0) { exit $result.exitCode }
}
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
