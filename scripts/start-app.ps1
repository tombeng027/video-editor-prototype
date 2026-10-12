param([switch]$Ollama)

. "$PSScriptRoot\launcher-common.ps1"
trap {
  if (Get-Command Write-LauncherError -ErrorAction SilentlyContinue) { Write-LauncherError $_ }
  else { [Console]::Error.WriteLine("[LAUNCHER_FAILED] $($_.Exception.Message) Check permissions for the local launcher directory.") }
  exit 1
}
$mutex = Enter-LauncherLock
$started = @()
try {
  try { $null = Invoke-LogCleanup }
  catch {
    $code = $_.Exception.Data["code"]
    if (-not $code) { $code = "LOG_CLEANUP_SKIPPED" }
    Write-LauncherWarning $code "Log cleanup skipped: $($_.Exception.Message)"
  }
  $state = Read-LauncherState
  if ((Test-OwnedTree $state.client) -or (Test-OwnedTree $state.desktop)) {
    Fail-Launcher "ALREADY_RUNNING" "This app or a recorded child is already running. Run scripts\stop-app.ps1 before restarting."
  }
  if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
    Fail-Launcher "CLIENT_PORT_BUSY" "Port 5173 is occupied. Stop its owner yourself; this launcher will not stop unrelated processes."
  }
  if ($env:VE_CLIENT_URL -and $env:VE_CLIENT_URL -ne "http://127.0.0.1:5173") {
    Fail-Launcher "CONFIG_INVALID" "Unset VE_CLIENT_URL for the quick-start scripts, or use the manual launch instructions."
  }
  $env:Path = $env:Path + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $ffmpeg = if ($env:FFMPEG_PATH) { $env:FFMPEG_PATH } else { "ffmpeg" }
  foreach ($name in @("FFMPEG_PATH", "FFPROBE_PATH")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value -and ($value.Contains("\") -or $value.Contains("/")) -and -not [IO.Path]::IsPathRooted($value)) {
      Fail-Launcher "CONFIG_INVALID" "$name must be an absolute executable path or a command name on PATH."
    }
  }
  $ffprobe = if ($env:FFPROBE_PATH) { $env:FFPROBE_PATH } elseif ($env:FFMPEG_PATH) {
    $directory = Split-Path $ffmpeg
    if ($directory) { Join-Path $directory ("ffprobe" + [IO.Path]::GetExtension($ffmpeg)) } else { "ffprobe" }
  } else { "ffprobe" }
  foreach ($tool in @("node", "pnpm", $ffmpeg, $ffprobe)) {
    try { $null = Get-Command $tool -ErrorAction Stop }
    catch { Fail-Launcher "TOOL_MISSING" "Cannot find $tool. Check PATH or the configured executable path." }
  }
  $dependencies = Get-LauncherDependencies
  $vite = $dependencies.vite
  $electron = $dependencies.electron
  Push-Location $root
  try {
    & pnpm --filter @ve/desktop build
    if ($LASTEXITCODE -ne 0) { Fail-Launcher "BUILD_FAILED" "Desktop build failed; nothing was launched. Review the build output." }
  } finally {
    Pop-Location
  }
  $state.client = $null
  $state.desktop = $null
  Save-LauncherState $state
  if ($Ollama) {
    $ollamaUrl = if ($env:OLLAMA_URL) { $env:OLLAMA_URL.TrimEnd("/") } else { "http://127.0.0.1:11434" }
    $canStart = $ollamaUrl -eq "http://127.0.0.1:11434" -and (-not $env:OLLAMA_HOST -or $env:OLLAMA_HOST -eq "127.0.0.1:11434")
    $existing = if ($canStart) { Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue } else { $true }
    if ($existing) {
      try { $null = Invoke-RestMethod "$ollamaUrl/api/tags" -TimeoutSec 2 }
      catch { Fail-Launcher "OLLAMA_UNREACHABLE" "Ollama did not respond at $ollamaUrl. Start your configured service manually or launch without -Ollama. $($_.Exception.Message)" }
      Write-Host "Using existing Ollama; the stop script will not take ownership of it."
    } else {
      $null = Get-Command ollama -ErrorAction Stop
      $p = Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logFiles\ollama.log" -RedirectStandardError "$logFiles\ollama.err"
      $state.ollama = Get-Identity $p
      $started += $state.ollama
      Save-LauncherState $state
      Wait-Ready {
        try { $null = Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 1; return $true }
        catch [System.Net.WebException] { return $false }
      } $state.ollama "Ollama"
    }
  }
  $p = Start-Process node -ArgumentList "`"$vite`"" -WorkingDirectory "$root\apps\client" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$logFiles\client.log" -RedirectStandardError "$logFiles\client.err"
  $state.client = Get-Identity $p
  $started += $state.client
  Save-LauncherState $state
  Wait-Ready {
    $listener = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if (-not ($listener | Where-Object { $_.OwningProcess -eq $state.client.id })) { return $false }
    try {
      $response = Invoke-WebRequest "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 1
      return $response.Content.Contains("<title>Video Editor Prototype</title>")
    } catch [System.Net.WebException] { return $false }
  } $state.client "Client"
  $p = Start-Process $electron -ArgumentList "." -WorkingDirectory "$root\apps\desktop" -PassThru `
    -RedirectStandardOutput "$logFiles\desktop.log" -RedirectStandardError "$logFiles\desktop.err"
  $state.desktop = Get-Identity $p
  $started += $state.desktop
  Save-LauncherState $state
  Wait-Ready {
    $desktop = Find-OwnedProcess $state.desktop
    return $desktop.MainWindowTitle -eq "Video Editor Prototype"
  } $state.desktop "Desktop"
  Write-Host "App launched (client responding and window open). Check component status in the app. Logs: $logs."
} catch {
  $failure = $_
  [array]::Reverse($started)
  foreach ($identity in $started) {
    try { Stop-OwnedTree $identity -Graceful -PersistState $state }
    catch { Write-Warning "Startup cleanup failed: $($_.Exception.Message)" }
  }
  throw $failure
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
