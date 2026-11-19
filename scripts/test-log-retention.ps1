. "$PSScriptRoot\launcher-common.ps1"
$realLogs = $logs
$realLogFiles = $logFiles
$testRoot = Join-Path $env:TEMP ("ve-retention-" + [guid]::NewGuid().ToString("N"))
$logs = $testRoot
New-Item -ItemType Directory "$logs\sessions" -Force | Out-Null
function Assert-Check($value, $message) {
  if (-not $value) { throw "FAIL: $message" }
  Write-Host "PASS: $message"
}
function New-TestSession($name, [bool]$active, [bool]$preserved, [int]$age) {
  $folder = Join-Path $logs "sessions\$name"
  New-Item -ItemType Directory $folder -Force | Out-Null
  $writer = if ($active) { Get-Identity (Get-Process -Id $PID) } else { @{ id = 2147483647; started = "1" } }
  @{ id = $name; root = $root; writers = @($writer); preserved = $preserved; closedAt = [datetime]::UtcNow.AddDays(-$age).ToString("o") } |
    ConvertTo-Json -Depth 16 | Set-Content "$folder\session.json"
  Set-Content "$folder\errors.jsonl" "synthetic"
  return (Get-Item $folder).FullName
}
try {
  @{ enabled = $true; retentionDays = 14; maxTotalMB = 250; keepRecentSessions = 1; minFreeDiskMB = 0 } |
    ConvertTo-Json | Set-Content "$logs\log-settings.json"
  $old = New-TestSession "old" $false $false 30
  $recent = New-TestSession "recent" $false $false 1
  $active = New-TestSession "active" $true $false 40
  $preserved = New-TestSession "preserved" $false $true 35
  $unknown = New-TestSession "unknown" $false $false 32
  $logFiles = $active
  Set-Content "$unknown\session.json" "not json"
  Set-Content "$logs\processes.json" "operational state"
  $preview = Invoke-LogCleanup -DryRun
  Assert-Check ($old -in $preview.selectedSessions -and (Test-Path $old)) "Dry run selects expired logs without deleting"
  Assert-Check ($preview.status -eq "partial" -and $preview.exitCode -eq 2) "Dry run reports protected unknown logs as partial"
  $status = Invoke-LogCleanup
  Assert-Check (-not (Test-Path $old)) "Expired closed logs are removed"
  Assert-Check ($status.status -eq "partial" -and $status.exitCode -eq 2) "Skipped unknown logs produce a partial cleanup result"
  Assert-Check ((Test-Path $active) -and (Test-Path $preserved) -and (Test-Path $unknown) -and (Test-Path $recent)) "Active, preserved, unknown and recent sessions survive"
  Assert-Check ((Get-Content "$logs\processes.json") -eq "operational state") "Operational state is untouched"
  Assert-Check ($preview.protectedBytes -gt 0 -and $preview.usageComplete) "Protected and corrupt sessions are included in usage"
  $unexpected = New-TestSession "unexpected" $false $false 40
  Set-Content "$unexpected\unrecognized.txt" "must preserve"
  $linkTarget = Join-Path $testRoot "link-target"
  New-Item -ItemType Directory $linkTarget | Out-Null
  Set-Content "$linkTarget\external.log" "must not follow or delete"
  $link = Join-Path $logs "sessions\linked"
  New-Item -ItemType Junction -Path $link -Value $linkTarget | Out-Null
  $status = Invoke-LogCleanup
  Assert-Check ((Test-Path "$unexpected\unrecognized.txt") -and (Test-Path "$linkTarget\external.log") -and -not $status.usageComplete) "Unexpected files and links are protected and incomplete usage is explicit"
  [IO.Directory]::Delete($link)
  $young = New-TestSession "young" $false $false 13
  $boundary = New-TestSession "boundary" $false $false 14
  $status = Invoke-LogCleanup
  Assert-Check ((Test-Path $young) -and -not (Test-Path $boundary)) "Age threshold is applied exactly without deleting younger sessions"
  Assert-Check ($status.remainingBytes -eq (Get-LogStorageUsage (Join-Path $logs "sessions")).bytes) "Successful cleanup reports measured remaining bytes"
  $locked = New-TestSession "locked" $false $false 31
  $partial = New-TestSession "partial" $false $false 32
  $handle = [IO.File]::Open("$locked\errors.jsonl", [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try {
    $status = Invoke-LogCleanup
    Assert-Check (Test-Path "$locked\session.json") "In-use log prevents deletion of the session"
    Assert-Check ($partial -in $status.selectedSessions -and $locked -in $status.failedSessions) "Partial cleanup identifies completed and failed sessions"
    Assert-Check ($status.status -eq "partial" -and $status.exitCode -eq 2) "Mixed deletion results report partial status"
    Assert-Check ($status.remainingBytes -eq (Get-LogStorageUsage (Join-Path $logs "sessions")).bytes) "Partial cleanup remeasures actual remaining storage"
  }
  finally { $handle.Dispose() }
  $status = Invoke-LogCleanup
  Assert-Check (-not (Test-Path $locked)) "Unlocked expired session can be removed"
  Assert-Check ($status.remainingBytes -eq (Get-LogStorageUsage (Join-Path $logs "sessions")).bytes) "Retry reports actual remaining storage"
  $failed = New-TestSession "failed" $false $false 31
  $handle = [IO.File]::Open("$failed\errors.jsonl", [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try {
    $status = Invoke-LogCleanup
    Assert-Check ($status.status -eq "failed" -and $status.exitCode -eq 1) "All failed deletion attempts report failed status"
    Assert-Check ($failed -in $status.failedSessions -and (Test-Path "$failed\session.json")) "Failed cleanup retains metadata for retry"
  } finally { $handle.Dispose() }
  $status = Invoke-LogCleanup
  Assert-Check (-not (Test-Path $failed) -and $status.remainingBytes -eq (Get-LogStorageUsage (Join-Path $logs "sessions")).bytes) "Retry removes the failed session and remeasures usage"
  $closing = New-TestSession "closing" $false $false 30
  $metadata = Get-Content "$closing\session.json" -Raw | ConvertFrom-Json
  $metadata.closedAt = $null
  $metadata | ConvertTo-Json -Depth 16 | Set-Content "$closing\session.json"
  $status = Invoke-LogCleanup
  $closedMetadata = Get-Content "$closing\session.json" -Raw | ConvertFrom-Json
  $closedAt = [datetime]::MinValue
  $validCloseTime = [datetime]::TryParse($closedMetadata.closedAt, [ref]$closedAt)
  Assert-Check $validCloseTime "Missing close time is saved atomically as valid metadata"
  Assert-Check (@(Get-ChildItem $closing -Filter ".session-*.tmp").Count -eq 0 -and
    @(Get-ChildItem $closing -Filter ".session-*.bak").Count -eq 0) "Atomic metadata update leaves no temporary files"
  $atomicArtifact = New-TestSession "atomic-artifact" $false $false 30
  Set-Content (Join-Path $atomicArtifact (".session-" + [guid]::NewGuid().ToString("N") + ".bak")) "previous metadata"
  $status = Invoke-LogCleanup
  Assert-Check (-not (Test-Path $atomicArtifact)) "Retry cleanup removes a leftover atomic metadata backup"
  $metadataFailure = New-TestSession "metadata-failure" $false $false 30
  $metadata = Get-Content "$metadataFailure\session.json" -Raw | ConvertFrom-Json
  $metadata.closedAt = $null
  $metadata | ConvertTo-Json -Depth 16 | Set-Content "$metadataFailure\session.json"
  $writer = (Get-Command Write-AtomicSessionMetadata -CommandType Function).ScriptBlock
  Set-Item Function:\Write-AtomicSessionMetadata -Value { param($Path, $Metadata) throw "Simulated atomic metadata replacement failure." }
  try { $status = Invoke-LogCleanup }
  finally { Set-Item Function:\Write-AtomicSessionMetadata -Value $writer }
  $unchangedMetadata = Get-Content "$metadataFailure\session.json" -Raw | ConvertFrom-Json
  Assert-Check ($null -eq $unchangedMetadata.closedAt -and $metadataFailure -notin $status.selectedSessions) "Failed metadata replacement preserves the original session file"
  Assert-Check ($status.status -eq "partial" -and $status.exitCode -eq 2) "Metadata write failure is surfaced as partial cleanup"
  [IO.File]::WriteAllBytes("$active\client.log", (New-Object byte[] (2MB)))
  @{ enabled = $false; retentionDays = 14; maxTotalMB = 1; keepRecentSessions = 1; minFreeDiskMB = 0 } |
    ConvertTo-Json | Set-Content "$logs\log-settings.json"
  $status = Invoke-LogCleanup
  Assert-Check (($status.warnings -join "").Contains("LOG_STORAGE_LIMIT_EXCEEDED")) "Protected storage above target produces a warning"
  Assert-Check (Test-Path $young) "Disabled cleanup preserves eligible logs"
  Set-Content "$logs\legacy.log" "legacy"
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($logs).Substring(0, 1))
  @{ enabled = $true; retentionDays = 14; maxTotalMB = 1; keepRecentSessions = 1; minFreeDiskMB = [long]([math]::Ceiling($drive.Free / 1MB) + 100) } |
    ConvertTo-Json | Set-Content "$logs\log-settings.json"
  $status = Invoke-LogCleanup
  Assert-Check (-not (Test-Path $young)) "Budget pressure removes eligible closed sessions before their age limit"
  Assert-Check ((Test-Path "$logs\legacy.log") -and $status.legacyBytes -gt 0) "Legacy logs count toward storage but are never deleted"
  Assert-Check (($status.warnings -join "").Contains("DISK_SPACE_LOW")) "Low disk warning uses the configured threshold"
  Set-Content "$logs\log-settings.json" '{"enabled":true,"retentionDays":-1}'
  $invalid = $false
  try { $null = Invoke-LogCleanup } catch { $invalid = $_.Exception.Data["code"] -eq "LOG_CONFIG_INVALID" }
  Assert-Check $invalid "Invalid configuration disables deletion with explicit error"
  Remove-Item -LiteralPath $unknown -Recurse -Force
  Remove-Item -LiteralPath $unexpected -Recurse -Force
  @{ enabled = $true; retentionDays = 14; maxTotalMB = 250; keepRecentSessions = 1; minFreeDiskMB = 0 } |
    ConvertTo-Json | Set-Content "$logs\log-settings.json"
  $complete = New-TestSession "complete" $false $false 30
  $status = Invoke-LogCleanup
  Assert-Check ($status.status -eq "completed" -and $status.exitCode -eq 0) "Complete cleanup reports a successful result"
  Assert-Check ($status.remainingBytes -eq (Get-LogStorageUsage (Join-Path $logs "sessions")).bytes) "Completed result reports actual storage"
  $cliLocalAppData = Join-Path $testRoot "cli-local"
  $cliSessions = Join-Path $cliLocalAppData "VideoEditorPrototype\launcher\$key\sessions"
  $cliUnknown = Join-Path $cliSessions "unknown"
  New-Item -ItemType Directory $cliUnknown -Force | Out-Null
  Set-Content (Join-Path $cliUnknown "session.json") "not json"
  $cliScript = Join-Path $root "scripts\cleanup-logs.ps1"
  $cliOut = Join-Path $testRoot "cleanup-cli.out"
  $cliErr = Join-Path $testRoot "cleanup-cli.err"
  $previousLocalAppData = $env:LOCALAPPDATA
  try {
    $env:LOCALAPPDATA = $cliLocalAppData
    $cliArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$cliScript`""
    $cliProcess = Start-Process powershell.exe -ArgumentList $cliArguments -PassThru -Wait -WindowStyle Hidden `
      -RedirectStandardOutput $cliOut -RedirectStandardError $cliErr
  } finally { $env:LOCALAPPDATA = $previousLocalAppData }
  $cliResult = Get-Content -LiteralPath $cliOut -Raw | ConvertFrom-Json
  Assert-Check ($cliProcess.ExitCode -eq 2 -and $cliResult.status -eq "partial" -and $cliResult.exitCode -eq 2) "Cleanup CLI returns nonzero with partial JSON results (exit=$($cliProcess.ExitCode), status=$($cliResult.status), result=$($cliResult.exitCode))"
  Remove-Item -LiteralPath $cliUnknown -Recurse -Force
  try {
    $env:LOCALAPPDATA = $cliLocalAppData
    $cliProcess = Start-Process powershell.exe -ArgumentList $cliArguments -PassThru -Wait -WindowStyle Hidden `
      -RedirectStandardOutput $cliOut -RedirectStandardError $cliErr
  } finally { $env:LOCALAPPDATA = $previousLocalAppData }
  $cliResult = Get-Content -LiteralPath $cliOut -Raw | ConvertFrom-Json
  Assert-Check ($cliProcess.ExitCode -eq 0 -and $cliResult.status -eq "completed" -and $cliResult.exitCode -eq 0) "Cleanup CLI returns success for completed cleanup"
} finally {
  # Delete only the exact synthetic paths created above, never a user log directory.
  $link = Join-Path $testRoot "sessions\linked"
  if (Test-Path $link) { [IO.Directory]::Delete($link) }
  $linkTarget = Join-Path $testRoot "link-target"
  if (Test-Path $linkTarget) {
    Remove-Item -LiteralPath "$linkTarget\external.log"
    Remove-Item -LiteralPath $linkTarget
  }
  foreach ($name in @("old", "recent", "active", "preserved", "unknown", "locked", "partial", "failed", "young", "boundary", "unexpected", "closing", "atomic-artifact", "metadata-failure", "complete")) {
    $folder = Join-Path $testRoot "sessions\$name"
    if (Test-Path $folder) {
      foreach ($file in @(Get-ChildItem $folder -File)) { Remove-Item -LiteralPath $file.FullName }
      Remove-Item -LiteralPath $folder
    }
    $cliLocalAppData = Join-Path $testRoot "cli-local"
    if (Test-Path -LiteralPath $cliLocalAppData) { Remove-Item -LiteralPath $cliLocalAppData -Recurse -Force }
    foreach ($name in @("cleanup-cli.out", "cleanup-cli.err")) {
      Remove-Item -LiteralPath (Join-Path $testRoot $name) -ErrorAction SilentlyContinue
    }
  }
  foreach ($name in @("log-settings.json", "processes.json", "legacy.log")) { Remove-Item -LiteralPath (Join-Path $testRoot $name) -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath "$testRoot\sessions"
  Remove-Item -LiteralPath $testRoot
  $logs = $realLogs
  $logFiles = $realLogFiles
}
