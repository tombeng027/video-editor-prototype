$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$hash = [System.Security.Cryptography.SHA256]::Create()
try {
  $key = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace("-", "").Substring(0, 16)
} finally {
  $hash.Dispose()
}
$logs = Join-Path $env:LOCALAPPDATA "VideoEditorPrototype\launcher\$key"
$statePath = Join-Path $logs "processes.json"
New-Item -ItemType Directory -Force $logs | Out-Null

function Fail-Launcher([string]$Code, [string]$Message) {
  $exception = New-Object System.Exception($Message)
  $exception.Data["code"] = $Code
  throw $exception
}

function Write-LauncherError($record) {
  $code = $record.Exception.Data["code"]
  if (-not $code) { $code = "LAUNCHER_FAILED" }
  $message = "[$code] $($record.Exception.Message)"
  try {
    @{ time = (Get-Date).ToUniversalTime().ToString("o"); code = $code; message = $record.Exception.Message; location = $record.ScriptStackTrace } |
      ConvertTo-Json -Compress | Add-Content (Join-Path $logFiles "errors.jsonl") -Encoding UTF8
  } catch { Write-Warning "Could not write diagnostic log: $($_.Exception.Message)" }
  [Console]::Error.WriteLine("$message`nLogs: $logs`nRecovery guide: $root\docs\13-run-and-manual-testing.md")
}

function Write-LauncherWarning([string]$Code, [string]$Message) {
  try {
    @{ time = (Get-Date).ToUniversalTime().ToString("o"); code = $Code; message = $Message; severity = "warning" } |
      ConvertTo-Json -Compress | Add-Content (Join-Path $logFiles "errors.jsonl") -Encoding UTF8
  } catch { Write-Warning "Could not write diagnostic log: $($_.Exception.Message)" }
  Write-Warning "[$Code] $Message Logs: $logs"
}

function Get-Identity($process) {
  return @{ id = $process.Id; started = $process.StartTime.ToUniversalTime().Ticks.ToString() }
}

function Find-OwnedProcess($identity) {
  if (-not $identity) { return $null }
  $process = Get-Process -Id $identity.id -ErrorAction SilentlyContinue
  if ($process) {
    try {
      if ($process.StartTime.ToUniversalTime().Ticks.ToString() -eq $identity.started) { return $process }
    } catch {
      if (Get-Process -Id $identity.id -ErrorAction SilentlyContinue) {
        Write-LauncherWarning "PROCESS_INSPECTION_FAILED" "Cannot verify PID $($identity.id): $($_.Exception.Message)"
        throw
      }
    }
  }
  return $null
}

function Read-LauncherState {
  if (Test-Path $statePath) {
    try {
      $state = Get-Content $statePath -Raw | ConvertFrom-Json
      foreach ($name in @("root", "client", "desktop", "ollama")) {
        if (-not ($state.PSObject.Properties.Name -contains $name)) { throw "Missing $name" }
      }
      foreach ($name in @("client", "desktop", "ollama")) {
        $item = $state.$name
        if ($null -ne $item) { Assert-Identity $item }
      }
    } catch {
      Fail-Launcher "STATE_INVALID" "Invalid launcher state at $statePath. Close this app's processes manually, then rename that state file and retry. Details: $($_.Exception.Message)"
    }
    if ($state.root -ne $root) { throw "Launcher state belongs to another project: $statePath" }
    return $state
  }
  return [pscustomobject]@{ root = $root; client = $null; desktop = $null; ollama = $null }
}

function Assert-Identity($item) {
  if ($item -isnot [pscustomobject] -and $item -isnot [System.Collections.IDictionary]) { throw "Process identity must be an object." }
  if ($item.id -notmatch '^[1-9]\d*$' -or $item.started -notmatch '^[1-9]\d*$') { throw "Invalid process identity." }
  $null = [int]$item.id
  $null = [long]$item.started
  foreach ($child in @($item.children)) { if ($null -ne $child) { Assert-Identity $child } }
}

function Test-OwnedTree($identity) {
  if ($null -eq $identity) { return $false }
  if (Find-OwnedProcess $identity) { return $true }
  foreach ($child in @($identity.children)) { if (Test-OwnedTree $child) { return $true } }
  return $false
}

function Save-LauncherState($state) {
  if ($logSession) {
    $writers = @{}
    $pending = @($logSession.writers) + @($state.client, $state.desktop, $state.ollama)
    while ($pending.Count) {
      $next = @()
      foreach ($writer in $pending) {
        if ($null -eq $writer) { continue }
        Assert-Identity $writer
        $writers["$($writer.id):$($writer.started)"] = @{ id = $writer.id; started = $writer.started }
        $next += @($writer.children | Where-Object { $null -ne $_ })
      }
      $pending = $next
    }
    $logSession.writers = @($writers.Values)
    Save-LogSession
  }
  $state | ConvertTo-Json -Depth 16 | Set-Content "$statePath.tmp" -Encoding UTF8
  Move-Item "$statePath.tmp" $statePath -Force
}

function Stop-OwnedTree($identity, [switch]$Graceful, $PersistState = $null) {
  if ($null -eq $identity) { return }
  $process = Find-OwnedProcess $identity
  $identities = @($identity) + @($identity.children | Where-Object { $null -ne $_ })
  $pending = @($identities | Where-Object { Find-OwnedProcess $_ })
  $all = @()
  $inspectionFailed = $false
  try { $all = @(Get-CimInstance Win32_Process) }
  catch {
    $inspectionFailed = $true
    Write-LauncherWarning "PROCESS_INSPECTION_FAILED" "Descendant discovery failed; stopping recorded identities only: $($_.Exception.Message)"
  }
  while ($pending.Count -gt 0) {
    $parents = $pending
    $pending = @()
    foreach ($parent in $parents) {
      $parentSnapshot = $all | Where-Object { $_.ProcessId -eq $parent.id } | Select-Object -First 1
      if (-not $parentSnapshot -or
          [math]::Floor($parentSnapshot.CreationDate.ToUniversalTime().Ticks / 10000) -ne [math]::Floor([long]$parent.started / 10000)) {
        continue
      }
      foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $parent.id })) {
        $p = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        if ($p) {
          try {
            $childIdentity = Get-Identity $p
            if ([long]$childIdentity.started -ge [long]$parent.started -and
              [math]::Floor($p.StartTime.ToUniversalTime().Ticks / 10000) -eq [math]::Floor($child.CreationDate.ToUniversalTime().Ticks / 10000)) {
              if ($childIdentity.id -notin @($identities | ForEach-Object { $_.id })) {
                $identities += $childIdentity
                $pending += $childIdentity
              }
            }
          } catch {
            if (Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue) {
              $inspectionFailed = $true
              Write-LauncherWarning "PROCESS_INSPECTION_FAILED" "Skipping unverifiable PID $($child.ProcessId): $($_.Exception.Message)"
            }
          }
        }
      }
    }
  }
  $children = @($identities | Where-Object { $_.id -ne $identity.id })
  if ($identity -is [System.Collections.IDictionary]) { $identity.children = $children }
  else { $identity | Add-Member -NotePropertyName children -NotePropertyValue $children -Force }
  if ($PersistState) { Save-LauncherState $PersistState }
  try {
    if ($Graceful -and $process -and $process.CloseMainWindow()) { $null = $process.WaitForExit(5000) }
  } catch {
    Write-LauncherWarning "PROCESS_STOP_FAILED" "Graceful close failed for PID $($identity.id): $($_.Exception.Message)"
  }
  [array]::Reverse($identities)
  foreach ($item in $identities) {
    try {
      $p = Find-OwnedProcess $item
      if ($p) {
        Stop-Process -Id $p.Id -Force
        if (-not $p.WaitForExit(5000)) { Write-LauncherWarning "PROCESS_STOP_FAILED" "PID $($p.Id) has not exited yet; retry shutdown." }
      }
    } catch {
      Write-LauncherWarning "PROCESS_STOP_FAILED" "Could not verify/stop PID $($item.id): $($_.Exception.Message)"
    }
  }
  if ($inspectionFailed) { Fail-Launcher "PROCESS_INSPECTION_FAILED" "Some descendants could not be inspected. Recorded processes were handled; inspect this app's remaining processes manually before retrying." }
}

function Wait-Ready([scriptblock]$check, $identity, [string]$label, [int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Find-OwnedProcess $identity)) { Fail-Launcher "STARTUP_EXITED" "$label exited during startup. See $logs." }
    if (& $check) { return }
    Start-Sleep -Milliseconds 500
  }
  Fail-Launcher "STARTUP_TIMEOUT" "$label did not become ready within $TimeoutSeconds seconds. See $logs."
}

function Assert-TestAccess {
  $gate = New-Object System.Threading.Mutex($false, "Local\VideoEditorLauncher-$key-tests")
  try {
    try { $free = $gate.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $free = $true }
    if ($free) { $gate.ReleaseMutex() }
    elseif (-not $env:VE_LAUNCHER_TEST_TOKEN -or
            -not (Test-Path "$logs\test-token") -or
            (Get-Content "$logs\test-token" -Raw).Trim() -ne $env:VE_LAUNCHER_TEST_TOKEN) {
      Fail-Launcher "TESTS_RUNNING" "Launcher tests are running. Wait until they finish before starting or stopping the app."
    }
  } finally { $gate.Dispose() }
}

function Enter-LauncherLock([string]$Suffix = "") {
  if ($Suffix -eq "") { Assert-TestAccess }
  $mutex = New-Object System.Threading.Mutex($false, "Local\VideoEditorLauncher-$key$Suffix")
  try {
    $acquired = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $acquired = $true
  }
  if (-not $acquired) {
    $mutex.Dispose()
    Fail-Launcher "LAUNCHER_BUSY" "Another launcher operation is in progress."
  }
  if ($Suffix -eq "") {
    try { Assert-TestAccess }
    catch { $mutex.ReleaseMutex(); $mutex.Dispose(); throw }
  }
  return $mutex
}

. "$PSScriptRoot\log-retention.ps1"
Initialize-LogSession
