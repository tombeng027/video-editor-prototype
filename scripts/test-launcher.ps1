# Integration checks open the desktop briefly. Run only when the app is stopped.
param([switch]$OwnedOllama)
. "$PSScriptRoot\launcher-common.ps1"
trap {
  if (Get-Command Write-LauncherError -ErrorAction SilentlyContinue) { Write-LauncherError $_ }
  else { [Console]::Error.WriteLine("[LAUNCHER_FAILED] $($_.Exception.Message) Check permissions for the local launcher directory.") }
  exit 1
}
$setupMutex = Enter-LauncherLock
$suiteMutex = $null
try {
  $suiteMutex = Enter-LauncherLock "-tests"
  $oldToken = $env:VE_LAUNCHER_TEST_TOKEN
  $env:VE_LAUNCHER_TEST_TOKEN = [guid]::NewGuid().ToString()
  Set-Content "$logs\test-token" $env:VE_LAUNCHER_TEST_TOKEN -Encoding ASCII
$state = Read-LauncherState
if ((Test-OwnedTree $state.client) -or (Test-OwnedTree $state.desktop) -or (Test-OwnedTree $state.ollama)) {
  throw "Stop the launcher-owned app and Ollama before testing."
}
if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
  throw "Port 5173 must be free; existing services will not be stopped."
}
if ($OwnedOllama) {
  if (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue) {
    throw "Owned-Ollama test requires port 11434 free; an existing service will not be stopped."
  }
  if ($env:OLLAMA_URL -or $env:OLLAMA_HOST) { throw "Unset OLLAMA_URL and OLLAMA_HOST for the owned-Ollama test." }
  $null = Get-Command ollama -ErrorAction Stop
}
} catch {
  if ($suiteMutex) { $suiteMutex.ReleaseMutex(); $suiteMutex.Dispose() }
  $env:VE_LAUNCHER_TEST_TOKEN = $oldToken
  throw
} finally { $setupMutex.ReleaseMutex(); $setupMutex.Dispose() }
$fixture = Join-Path $logs "test-server.cjs"
$sentinel = $null
$ollamaFixture = $null
$createdOllamaFixture = $false
$testState = $null
$engineIdentity = $null
$invocation = $null
$testOwned = @()
$savedEnvironment = @{}
foreach ($name in @("VE_CLIENT_URL", "OLLAMA_URL", "OLLAMA_HOST", "PROJECTS_DIR", "ENGINE_DATA_DIR")) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
  [Environment]::SetEnvironmentVariable($name, $null)
}
$env:ENGINE_DATA_DIR = Join-Path $logs "test-engine-data"
function Assert-True($value, [string]$message) {
  if (-not $value) { throw "FAIL: $message" }
  Write-Host "PASS: $message"
}
function Run-Launcher([string]$name, [int]$expected, [switch]$WithOllama) {
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSScriptRoot\$name.ps1`"")
  if ($WithOllama) { $arguments += "-Ollama" }
  $run = Start-Process powershell -ArgumentList $arguments -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$logs\test-$name.log" -RedirectStandardError "$logs\test-$name.err"
  $null = $run.Handle
  $script:invocation = Get-Identity $run
  $script:testOwned += $script:invocation
  if (-not $run.WaitForExit(90000)) {
    Stop-OwnedTree $script:invocation -Graceful
    throw "$name test invocation did not finish. See $logs."
  }
  $script:invocation = $null
  if ($name -eq "start-app") {
    $captured = Read-LauncherState
    $script:testOwned += @($captured.desktop, $captured.client)
    if ($OwnedOllama) { $script:testOwned += $captured.ollama }
  }
  Assert-True ($run.ExitCode -eq $expected) "$name exits $expected (actual: $($run.ExitCode))"
}
try {
  $token = $env:VE_LAUNCHER_TEST_TOKEN
  try {
    $env:VE_LAUNCHER_TEST_TOKEN = $null
    Run-Launcher "start-app" 1
    Assert-True ((Get-Content "$logs\test-start-app.err" -Raw).Contains("[TESTS_RUNNING]")) "User launch is refused while the suite owns the gate"
  } finally { $env:VE_LAUNCHER_TEST_TOKEN = $token }
  $actualStatePath = $statePath
  $statePath = Join-Path $logs "test-invalid-state.json"
  try {
    @{ root = $root; client = $false; desktop = $null; ollama = $null } |
      ConvertTo-Json | Set-Content $statePath
    $invalid = $false
    try { $null = Read-LauncherState } catch { $invalid = $_.Exception.Data["code"] -eq "STATE_INVALID" }
    Assert-True $invalid "Boolean process identities are rejected with STATE_INVALID"
  } finally {
    Remove-Item $statePath -ErrorAction SilentlyContinue
    $statePath = $actualStatePath
  }
  'require("http").createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({models:[]}));}).listen(Number(process.argv[2]),"127.0.0.1");' |
    Set-Content $fixture -Encoding ASCII
  $p = Start-Process node -ArgumentList "`"$fixture`" 5173" -PassThru -WindowStyle Hidden
  $sentinel = Get-Identity $p
  Wait-Ready { return [bool](Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) } $sentinel "Test server"
  $timedOut = $false
  try { Wait-Ready { return $false } $sentinel "Unready fixture" 1 }
  catch { $timedOut = $_.Exception.Message -like "*did not become ready*" }
  Assert-True $timedOut "Readiness timeout reports failure"
  Run-Launcher "start-app" 1
  Run-Launcher "stop-app" 0
  Assert-True ([bool](Find-OwnedProcess $sentinel)) "Port conflict and stop leave an unrelated server alive"
  $orphan = @{ id = 2147483647; started = "1"; children = @($sentinel) }
  Assert-True (Test-OwnedTree $orphan) "Recorded child remains owned after its parent exits"
  $actualStatePath = $statePath
  $statePath = Join-Path $logs "test-retry-state.json"
  try {
    $retryState = [pscustomobject]@{ root = $root; desktop = $orphan; client = $null; ollama = $null }
    function Stop-Process { param($Id, [switch]$Force) throw "Simulated termination denial for $Id" }
    try { Stop-OwnedTree $orphan -PersistState $retryState }
    finally { Remove-Item Function:\Stop-Process }
    $recorded = Read-LauncherState
    Assert-True (Test-OwnedTree $recorded.desktop) "Failed termination retains a live child's identity"
    Assert-True ($recorded.desktop.children[0].id -eq $sentinel.id) "Child identity survives JSON persistence"
    Stop-OwnedTree $recorded.desktop
  } finally {
    Remove-Item $statePath -ErrorAction SilentlyContinue
    $statePath = $actualStatePath
  }
  Assert-True (-not (Test-OwnedTree $orphan)) "Retry stops a recorded child even without its parent"
  $exited = $false
  try { Wait-Ready { return $true } $sentinel "Exited fixture" 1 }
  catch { $exited = $_.Exception.Message -like "*exited during startup*" }
  Assert-True $exited "Exited process cannot report readiness"
  $sentinel = $null

  $existing = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue
  if ($OwnedOllama) {
    Write-Host "Testing a real launcher-owned Ollama server (no models are run)."
  } elseif ($existing) {
    $null = Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
    $ollamaFixture = Get-Identity (Get-Process -Id ($existing | Select-Object -First 1).OwningProcess)
  } else {
    $p = Start-Process node -ArgumentList "`"$fixture`" 11434" -PassThru -WindowStyle Hidden
    $ollamaFixture = Get-Identity $p
    $createdOllamaFixture = $true
    Wait-Ready { return [bool](Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue) } $ollamaFixture "Test Ollama API"
  }
  $oldFfmpeg = $env:FFMPEG_PATH
  $oldFfprobe = $env:FFPROBE_PATH
  try {
    $env:FFMPEG_PATH = "ffmpeg"
    $env:FFPROBE_PATH = $null
    Run-Launcher "start-app" 0 -WithOllama
  } finally {
    $env:FFMPEG_PATH = $oldFfmpeg
    $env:FFPROBE_PATH = $oldFfprobe
  }
  Assert-True $true "FFMPEG_PATH command-name inference succeeds"
  $testState = Read-LauncherState
  if ($OwnedOllama) { Assert-True ([bool](Find-OwnedProcess $testState.ollama)) "Launcher records its own Ollama server" }
  Assert-True ([bool](Find-OwnedProcess $testState.client)) "Owned client is running"
  Assert-True ([bool](Find-OwnedProcess $testState.desktop)) "Owned desktop is running"
  $engine = Get-CimInstance Win32_Process | Where-Object {
    $_.ParentProcessId -eq $testState.desktop.id -and $_.CommandLine -like "*--import*tsx*main.ts*"
  } | Select-Object -First 1
  Assert-True ([bool]$engine) "Desktop owns an engine child"
  $engineIdentity = Get-Identity (Get-Process -Id $engine.ProcessId)
  Assert-True ([bool](Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -eq $engine.ProcessId })) "Owned engine is listening"
  Assert-True ((Invoke-WebRequest "http://127.0.0.1:5173/" -UseBasicParsing).Content.Contains("<title>Video Editor Prototype</title>")) "Expected client responds"
  $wrong = @{ id = $testState.client.id; started = "0" }
  Assert-True (-not (Find-OwnedProcess $wrong)) "PID with mismatched creation time is not owned"
  Run-Launcher "start-app" 1
  Assert-True ([bool](Find-OwnedProcess $testState.desktop)) "Duplicate launch does not stop the original desktop"
  Run-Launcher "stop-app" 0 -WithOllama
  Assert-True (-not (Find-OwnedProcess $testState.client)) "Owned client stops"
  Assert-True (-not (Find-OwnedProcess $testState.desktop)) "Owned desktop stops"
  Assert-True (-not (Find-OwnedProcess $engineIdentity)) "Owned engine stops"
  if ($OwnedOllama) {
    Assert-True (-not (Find-OwnedProcess $testState.ollama)) "Launcher-owned Ollama stops"
  } else {
    Assert-True ([bool](Find-OwnedProcess $ollamaFixture)) "Pre-existing Ollama API survives stop -Ollama"
  }
  Run-Launcher "stop-app" 0
  $oldProjects = $env:PROJECTS_DIR
  try {
    $env:PROJECTS_DIR = "relative-test-folder"
    Run-Launcher "start-app" 1
    $failedState = Read-LauncherState
    Assert-True (-not (Find-OwnedProcess $failedState.client)) "Failed desktop startup rolls back the client"
    Assert-True (-not (Find-OwnedProcess $failedState.desktop)) "Failed desktop startup leaves no owned desktop"
    Assert-True ((Get-Content "$logs\test-start-app.err" -Raw) -match '\[STARTUP_(TIMEOUT|EXITED)\]') "Startup failure displays a stable error code"
    $errorRecords = @(Get-ChildItem "$logs\sessions" -Filter errors.jsonl -Recurse | ForEach-Object { Get-Content $_.FullName -Raw })
    Assert-True (($errorRecords -join "`n").Contains('"code":"STARTUP_')) "Startup failure is logged"
  } finally {
    $env:PROJECTS_DIR = $oldProjects
  }
  Write-Host "All launcher integration checks passed."
} finally {
  try {
    $cleanup = @($invocation) + $testOwned
    $cleanup += @($engineIdentity, $sentinel)
    if ($createdOllamaFixture) { $cleanup += $ollamaFixture }
    foreach ($identity in $cleanup) {
      try { Stop-OwnedTree $identity -Graceful }
      catch { Write-Warning "Test cleanup failed: $($_.Exception.Message)" }
    }
    Remove-Item $fixture -ErrorAction SilentlyContinue
  } finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name]) }
    $env:VE_LAUNCHER_TEST_TOKEN = $oldToken
    Remove-Item "$logs\test-token" -ErrorAction SilentlyContinue
    $suiteMutex.ReleaseMutex()
    $suiteMutex.Dispose()
  }
}
