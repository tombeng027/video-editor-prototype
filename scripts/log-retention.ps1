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
      if (@($files | Where-Object { $_.PSIsContainer -or $_.Name -notin $allowed -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }).Count) {
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
            $meta | ConvertTo-Json -Depth 16 | Set-Content (Join-Path $directory.FullName "session.json") -Encoding UTF8
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
  $sessionUsage = if (Test-Path $sessions) { Measure-LogStorage $sessions } else { [pscustomobject]@{ bytes = 0L; complete = $true } }
  if (-not $sessionUsage.complete) { $usageComplete = $false }
  $legacyBytes = 0L
  foreach ($file in @(Get-ChildItem -LiteralPath $logs -Force -File -ErrorAction Stop | Where-Object { $_.Extension -in @(".log", ".err", ".jsonl") })) {
    $usage = Measure-LogStorage $file.FullName
    $legacyBytes += $usage.bytes
    if (-not $usage.complete) { $usageComplete = $false }
  }
  $total = $legacyBytes + $sessionUsage.bytes
  $eligibleBytes = [long](($entries | Where-Object { -not $_.protected -and $_.closed -and $_ -notin $recent } | Measure-Object bytes -Sum).Sum)
  $protectedBytes = $total - $eligibleBytes
  $deleted = @()
  foreach ($entry in @($entries | Where-Object { -not $_.protected -and $_.closed -and $_ -notin $recent } | Sort-Object closed)) {
    if (-not $policy.enabled) { break }
    if ($entry.closed -gt [datetime]::UtcNow.AddDays(-$policy.retentionDays) -and $total -le $policy.maxTotalMB * 1MB) { continue }
    if ($DryRun) {
      $deleted += $entry.directory
      $total -= $entry.bytes
      continue
    }
    # The caller holds the launcher lock; closed sessions have no recorded live writers.
    try {
      foreach ($file in $entry.files) {
        $handle = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        $handle.Dispose()
      }
      foreach ($file in $entry.files) { Remove-Item -LiteralPath $file.FullName -ErrorAction Stop }
      Remove-Item -LiteralPath $entry.directory -ErrorAction Stop
      $deleted += $entry.directory
      $total -= $entry.bytes
    } catch { $warnings += "[LOG_CLEANUP_INCOMPLETE] Could not remove $($entry.directory): $($_.Exception.Message)" }
  }
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($logs).Substring(0, 1))
  if (-not $usageComplete) { $warnings += "[LOG_CLEANUP_SKIPPED] Some storage could not be measured without following links or reading inaccessible paths; usage is a lower bound." }
  if ($total -gt $policy.maxTotalMB * 1MB) {
    $warnings += "[LOG_STORAGE_LIMIT_EXCEEDED] Logs use at least $([math]::Round($total / 1MB, 1)) MB; target is $($policy.maxTotalMB) MB. Active, preserved, unknown and recent sessions are not deleted. Review logs or change retention."
  }
  if ($drive.Free -lt $policy.minFreeDiskMB * 1MB) {
    $warnings += "[DISK_SPACE_LOW] Log-storage drive has $([math]::Round($drive.Free / 1MB)) MB free. Free disk space; log cleanup alone may not suffice."
  }
  foreach ($warning in $warnings) {
    $separator = $warning.IndexOf("]")
    Write-LauncherWarning $warning.Substring(1, $separator - 1) $warning.Substring($separator + 2)
  }
  return [pscustomobject]@{ dryRun = [bool]$DryRun; remainingBytes = $total; protectedBytes = $protectedBytes; legacyBytes = $legacyBytes; usageComplete = $usageComplete; selectedSessions = $deleted; warnings = $warnings }
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
