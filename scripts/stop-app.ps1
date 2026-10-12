param([switch]$Ollama)

. "$PSScriptRoot\launcher-common.ps1"
trap {
  if (Get-Command Write-LauncherError -ErrorAction SilentlyContinue) { Write-LauncherError $_ }
  else { [Console]::Error.WriteLine("[LAUNCHER_FAILED] $($_.Exception.Message) Check permissions for the local launcher directory.") }
  exit 1
}
$mutex = Enter-LauncherLock
try {
  $state = Read-LauncherState
  $failed = $false
  $names = @("desktop", "client")
  if ($Ollama) { $names += "ollama" }
  foreach ($name in $names) {
    try {
      Stop-OwnedTree $state.$name -Graceful -PersistState $state
      if (-not (Test-OwnedTree $state.$name)) { $state.$name = $null }
    } catch {
      $failed = $true
      Write-LauncherWarning "STOP_INCOMPLETE" "$name cleanup failed: $($_.Exception.Message)"
    }
  }
  Save-LauncherState $state
  if ($failed -or (Test-OwnedTree $state.desktop) -or (Test-OwnedTree $state.client) -or ($Ollama -and (Test-OwnedTree $state.ollama))) {
    Fail-Launcher "STOP_INCOMPLETE" "Some owned processes could not be stopped. Their identities were retained; see warnings and retry."
  }
  Write-Host "Stopped only processes owned by this launcher. Manually started services were left alone."
  try { $null = Invoke-LogCleanup }
  catch {
    $code = $_.Exception.Data["code"]
    if (-not $code) { $code = "LOG_CLEANUP_SKIPPED" }
    Write-LauncherWarning $code "Log cleanup skipped: $($_.Exception.Message)"
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
