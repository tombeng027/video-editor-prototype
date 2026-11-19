function Read-LogPolicy {
  $path = Join-Path $logs "log-settings.json"
  $defaults = @{ enabled = $true; retentionDays = 14; maxTotalMB = 250; keepRecentSessions = 3; minFreeDiskMB = 1024 }
  try {
    if (-not (Test-Path $path)) {
      $defaults | ConvertTo-Json | Set-Content $path -Encoding UTF8 -ErrorAction Stop
    }
    $policy = Get-Content $path -Raw -ErrorAction Stop | ConvertFrom-Json
    if ($policy.enabled -isnot [bool]) { throw "enabled must be true or false" }
    foreach ($name in @("retentionDays", "maxTotalMB", "keepRecentSessions", "minFreeDiskMB")) {
      if ($policy.$name -isnot [int] -and $policy.$name -isnot [long]) { throw "$name must be an integer" }
      if ($policy.$name -lt 0 -or ($name -in @("retentionDays", "maxTotalMB") -and $policy.$name -eq 0)) {
        throw "$name is outside its valid range"
      }
      if ($policy.retentionDays -gt 36500) { throw "retentionDays must not exceed 36500" }
    }
    return $policy
  } catch { Fail-Launcher "LOG_CONFIG_INVALID" "Invalid $path; no logs were deleted. $($_.Exception.Message)" }
}

function Measure-LogStorage([string]$Path) {
  $bytes = 0L
  $complete = $true
  $pending = @($Path)
  while ($pending.Count) {
    $next = @()
    foreach ($itemPath in $pending) {
      try {
        $item = Get-Item -LiteralPath $itemPath -Force -ErrorAction Stop
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $complete = $false; continue }
        if ($item.PSIsContainer) {
          $next += @(Get-ChildItem -LiteralPath $itemPath -Force -ErrorAction Stop | ForEach-Object { $_.FullName })
        } else { $bytes += $item.Length }
      } catch { $complete = $false }
    }
    $pending = $next
  }
  return [pscustomobject]@{ bytes = $bytes; complete = $complete }
}

function Write-AtomicSessionMetadata([string]$Path, $Metadata) {
  $suffix = [guid]::NewGuid().ToString("N")
  $directory = Split-Path -Parent $Path
  $temporary = Join-Path $directory (".session-" + $suffix + ".tmp")
  $backup = Join-Path $directory (".session-" + $suffix + ".bak")
  $stream = $null
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Metadata | ConvertTo-Json -Depth 16))
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
    $stream.Dispose()
    $stream = $null
    [IO.File]::Replace($temporary, $Path, $backup)
    Remove-Item -LiteralPath $backup -Force -ErrorAction Stop
  } finally {
    if ($stream) { $stream.Dispose() }
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Get-LogStorageUsage([string]$SessionsPath) {
  $sessionUsage = if (Test-Path $SessionsPath) { Measure-LogStorage $SessionsPath } else { [pscustomobject]@{ bytes = 0L; complete = $true } }
  $legacyBytes = 0L
  $complete = $sessionUsage.complete
  foreach ($file in @(Get-ChildItem -LiteralPath $logs -Force -File -ErrorAction Stop | Where-Object { $_.Extension -in @(".log", ".err", ".jsonl") })) {
    $usage = Measure-LogStorage $file.FullName
    $legacyBytes += $usage.bytes
    if (-not $usage.complete) { $complete = $false }
  }
  return [pscustomobject]@{ bytes = [long]($sessionUsage.bytes + $legacyBytes); legacyBytes = $legacyBytes; complete = $complete }
}

function Invoke-LogCleanup([switch]$DryRun) {
  $policy = Read-LogPolicy
  $sessions = Join-Path $logs "sessions"
  if ((Test-Path $sessions) -and ((Get-Item $sessions).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    Fail-Launcher "LOG_CLEANUP_SKIPPED" "Sessions directory is a link; cleanup will not follow it."
  }
  $entries = @()
  $warnings = @()
  $usageComplete = $true
  $allowed = @("session.json", "errors.jsonl", "client.log", "client.err", "desktop.log", "desktop.err", "ollama.log", "ollama.err")
  $directories = if (Test-Path $sessions) { @(Get-ChildItem $sessions -Directory -Force -ErrorAction Stop) } else { @() }
  foreach ($directory in $directories) {
    try {
      if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "directory link" }
      $files = @(Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop)
      if (@($files | Where-Object {
        $_.PSIsContainer -or
        ($_.Name -notin $allowed -and $_.Name -notmatch '^\.session-[0-9a-f]{32}\.(tmp|bak)$') -or
        ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
      }).Count) {
        throw "unexpected file, directory or link"
      }
      $meta = Get-Content (Join-Path $directory.FullName "session.json") -Raw -ErrorAction Stop | ConvertFrom-Json
      if ($meta.id -ne $directory.Name -or $meta.root -ne $root -or $meta.preserved -isnot [bool] -or -not $meta.writers) {
        throw "invalid session metadata"
      }
      $active = $false
      foreach ($writer in @($meta.writers)) {
        Assert-Identity $writer
        if (Test-OwnedTree $writer) { $active = $true }
      }
      $closed = $null
      if (-not $active) {
        if ($meta.closedAt) { $closed = [datetime]::Parse($meta.closedAt).ToUniversalTime() }
        else {
          $closed = [datetime]::UtcNow
          if (-not $DryRun) {
            $meta.closedAt = $closed.ToString("o")
            Write-AtomicSessionMetadata (Join-Path $directory.FullName "session.json") $meta
          }
        }
      }
      $bytes = (Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop | Measure-Object Length -Sum).Sum
      $entries += [pscustomobject]@{ directory = $directory.FullName; files = $files; bytes = [long]$bytes; closed = $closed; protected = ($active -or $meta.preserved) }
    } catch {
      $warnings += "[LOG_CLEANUP_SKIPPED] Preserving $($directory.FullName): $($_.Exception.Message)"
      $usage = Measure-LogStorage $directory.FullName
      if (-not $usage.complete) { $usageComplete = $false }
      $entries += [pscustomobject]@{ directory = $directory.FullName; files = @(); bytes = $usage.bytes; closed = $null; protected = $true }
    }
  }
  $recent = @($entries | Where-Object { $_.closed } | Sort-Object closed -Descending | Select-Object -First $policy.keepRecentSessions)
  $initialUsage = Get-LogStorageUsage $sessions
  if (-not $initialUsage.complete) { $usageComplete = $false }
  $legacyBytes = $initialUsage.legacyBytes
  $total = $initialUsage.bytes
  $eligible = @($entries | Where-Object { -not $_.protected -and $_.closed -and $_ -notin $recent })
  $eligibleBytes = [long](($eligible | Measure-Object bytes -Sum).Sum)
  $protectedBytes = $total - $eligibleBytes
  $deleted = @()
  $failed = @()
  foreach ($entry in @($eligible | Sort-Object closed)) {
    if (-not $policy.enabled) { break }
    if ($entry.closed -gt [datetime]::UtcNow.AddDays(-$policy.retentionDays) -and $total -le $policy.maxTotalMB * 1MB) { continue }
    if ($DryRun) {
      $deleted += $entry.directory
      $total -= $entry.bytes
      continue
    }
    # The caller holds the launcher lock; closed sessions have no recorded live writers.
    $handles = @()
    try {
      foreach ($file in $entry.files) {
        $handles += [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Delete)
      }
      foreach ($file in @($entry.files | Where-Object { $_.Name -ne "session.json" })) {
        Remove-Item -LiteralPath $file.FullName -ErrorAction Stop
      }
      $metadata = @($entry.files | Where-Object { $_.Name -eq "session.json" })
      if ($metadata.Count -ne 1) { throw "Session metadata is missing or ambiguous." }
      Remove-Item -LiteralPath $metadata[0].FullName -ErrorAction Stop
      Remove-Item -LiteralPath $entry.directory -ErrorAction Stop
      $deleted += $entry.directory
    } catch {
      $failed += $entry.directory
      $warnings += "[LOG_CLEANUP_INCOMPLETE] Could not remove $($entry.directory): $($_.Exception.Message)"
    } finally {
      foreach ($handle in $handles) { $handle.Dispose() }
    }
  }
  $actualUsage = Get-LogStorageUsage $sessions
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($logs).Substring(0, 1))
  if (-not $usageComplete -or -not $actualUsage.complete) { $warnings += "[LOG_CLEANUP_SKIPPED] Some storage could not be measured without following links or reading inaccessible paths; usage is a lower bound." }
  if ($actualUsage.bytes -gt $policy.maxTotalMB * 1MB) {
    $warnings += "[LOG_STORAGE_LIMIT_EXCEEDED] Logs use at least $([math]::Round($actualUsage.bytes / 1MB, 1)) MB; target is $($policy.maxTotalMB) MB. Active, preserved, unknown and recent sessions are not deleted. Review logs or change retention."
  }
  if ($drive.Free -lt $policy.minFreeDiskMB * 1MB) {
    $warnings += "[DISK_SPACE_LOW] Log-storage drive has $([math]::Round($drive.Free / 1MB)) MB free. Free disk space; log cleanup alone may not suffice."
  }
  foreach ($warning in $warnings) {
    $separator = $warning.IndexOf("]")
    Write-LauncherWarning $warning.Substring(1, $separator - 1) $warning.Substring($separator + 2)
  }
  $actualUsage = Get-LogStorageUsage $sessions
  if (-not $actualUsage.complete -and @($warnings | Where-Object { $_.StartsWith("[LOG_CLEANUP_SKIPPED] Some storage could not be measured") }).Count -eq 0) {
    $warning = "[LOG_CLEANUP_SKIPPED] Some storage could not be measured without following links or reading inaccessible paths; usage is a lower bound."
    $warnings += $warning
    Write-LauncherWarning "LOG_CLEANUP_SKIPPED" $warning.Substring($warning.IndexOf("]") + 2)
    $actualUsage = Get-LogStorageUsage $sessions
  }
  if ($actualUsage.bytes -gt $policy.maxTotalMB * 1MB -and @($warnings | Where-Object { $_.StartsWith("[LOG_STORAGE_LIMIT_EXCEEDED]") }).Count -eq 0) {
    $warning = "[LOG_STORAGE_LIMIT_EXCEEDED] Logs use at least $([math]::Round($actualUsage.bytes / 1MB, 1)) MB; target is $($policy.maxTotalMB) MB. Active, preserved, unknown and recent sessions are not deleted. Review logs or change retention."
    $warnings += $warning
    Write-LauncherWarning "LOG_STORAGE_LIMIT_EXCEEDED" $warning.Substring($warning.IndexOf("]") + 2)
    $actualUsage = Get-LogStorageUsage $sessions
  }
  $usageComplete = $usageComplete -and $actualUsage.complete
  $reportedLegacyBytes = $actualUsage.legacyBytes
  if ($DryRun) {
    $selectedBytes = [long](($eligible | Where-Object { $_.directory -in $deleted } | Measure-Object bytes -Sum).Sum)
    $remainingBytes = $actualUsage.bytes - $selectedBytes
    $protectedBytes = $actualUsage.bytes - $eligibleBytes
  } else {
    $remainingBytes = $actualUsage.bytes
    $eligibleRemainingBytes = 0L
    foreach ($entry in $eligible) {
      if (Test-Path -LiteralPath $entry.directory) {
        $usage = Measure-LogStorage $entry.directory
        $eligibleRemainingBytes += $usage.bytes
        if (-not $usage.complete) { $usageComplete = $false }
      }
    }
    $protectedBytes = $remainingBytes - $eligibleRemainingBytes
  }
  $incomplete = -not $usageComplete -or @($warnings | Where-Object {
    $_.StartsWith("[LOG_CLEANUP_INCOMPLETE]") -or $_.StartsWith("[LOG_CLEANUP_SKIPPED]")
  }).Count -gt 0
  $status = if ($failed.Count -gt 0 -and $deleted.Count -eq 0) { "failed" } elseif ($incomplete) { "partial" } else { "completed" }
  $exitCode = if ($status -eq "completed") { 0 } elseif ($status -eq "failed") { 1 } else { 2 }
  return [pscustomobject]@{
    status = $status
    exitCode = $exitCode
    dryRun = [bool]$DryRun
    remainingBytes = $remainingBytes
    protectedBytes = $protectedBytes
    legacyBytes = $reportedLegacyBytes
    usageComplete = $usageComplete
    selectedSessions = $deleted
    failedSessions = $failed
    warnings = $warnings
  }
}

function Initialize-LogSession {
  $sessionId = [datetime]::UtcNow.ToString("yyyyMMddTHHmmssfff") + "-" + [guid]::NewGuid().ToString("N")
  $script:logFiles = Join-Path $logs "sessions\$sessionId"
  New-Item -ItemType Directory $logFiles -Force | Out-Null
  $script:logSession = [pscustomobject]@{
    id = $sessionId; root = $root; preserved = $false; closedAt = $null
    writers = @((Get-Identity (Get-Process -Id $PID)))
  }
  Save-LogSession
}

function Save-LogSession {
  if ($logSession) {
    $logSession | ConvertTo-Json -Depth 16 | Set-Content (Join-Path $logFiles "session.json") -Encoding UTF8
  }
}
