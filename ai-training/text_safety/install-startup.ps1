[CmdletBinding()]
param(
    [switch]$PrepareOnly,
    [switch]$ReplaceManualInstance
)
$ErrorActionPreference = 'Stop'
$aiRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = Split-Path -Parent $aiRoot
$pythonPath = Join-Path $aiRoot '.venv\Scripts\python.exe'
$lockPath = Join-Path $aiRoot 'school_violence\query_v13_candidate.lock.json'
$backendEnvPath = Join-Path $workspaceRoot 'child-monitor-backend\.env'
$runtimeRoot = Join-Path $workspaceRoot '.runtime\text-safety'
$configPath = Join-Path $runtimeRoot 'runtime.json'
$taskName = 'ChildMonitor-TextSafety-v13'
$taskDescription = "Child Monitor pinned text safety: $workspaceRoot"
$lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$config = [ordered]@{
    lock_path = $lockPath
    lock_sha256 = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant()
    model_version = $lock.model_version
    model_sha256 = $lock.model_sha256
    backend_env_path = $backendEnvPath
    port = 8100
    log_dir = (Join-Path $runtimeRoot 'logs')
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
Push-Location $aiRoot
try {
    & $pythonPath -B -m text_safety.run_pinned --config $configPath --check
    if ($LASTEXITCODE -ne 0) { throw 'Pinned service preflight failed; existing service was not stopped.' }
    if ($PrepareOnly) { Write-Output "Prepared: $configPath"; return }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $admin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { throw 'Open PowerShell as Administrator to register the startup task. No running service was changed.' }
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing -and $existing.Description -ne $taskDescription) {
        throw 'A task with this name belongs to another configuration; refusing to overwrite it.'
    }
    $listeners = @(Get-NetTCPConnection -LocalPort 8100 -State Listen -ErrorAction SilentlyContinue)
    $ownedProcessIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($ownedProcessIds.Count -gt 0) {
        & $pythonPath -B -m text_safety.run_pinned --config $configPath --probe
        if ($LASTEXITCODE -ne 0) { throw 'Port 8100 is occupied by an unverified service; it was not stopped.' }
        if (-not $ReplaceManualInstance) { throw 'A verified service is running. Use -ReplaceManualInstance to hand over to the startup task.' }
        foreach ($serviceProcessId in $ownedProcessIds) {
            $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceProcessId"
            if ($serviceProcess.Name -notin @('python.exe','pythonw.exe') -or
                $serviceProcess.CommandLine -notmatch 'text_safety[.]main:app|text_safety[.]run_pinned') {
                throw 'Listener is not a recognized text-safety process; it was not stopped.'
            }
        }
    }
    $arguments = '-B -m text_safety.run_pinned --config "' + $configPath + '"'
    $action = New-ScheduledTaskAction -Execute $pythonPath -Argument $arguments -WorkingDirectory $aiRoot
    $bootTrigger = New-ScheduledTaskTrigger -AtStartup
    # Repetition also recovers unexpected exits that Windows does not classify as failure.
    $recoveryTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $trigger = @($bootTrigger, $recoveryTrigger)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    # S4U runs without an interactive window or a saved password; no admin token.
    $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Description $taskDescription -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    # Registration must succeed before handing over the manually started service.
    if ($existing -and $existing.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName }
    foreach ($serviceProcessId in $ownedProcessIds) {
        Stop-Process -Id $serviceProcessId -Force -ErrorAction SilentlyContinue
    }
    $releaseDeadline = (Get-Date).AddSeconds(10)
    while (Get-NetTCPConnection -LocalPort 8100 -State Listen -ErrorAction SilentlyContinue) {
        if ((Get-Date) -ge $releaseDeadline) { throw 'Port 8100 did not become available.' }
        Start-Sleep -Milliseconds 250
    }
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddSeconds(30)
    $healthy = $false
    do {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8100/health' -TimeoutSec 2
            $healthy = $health.model -eq $lock.model_version -and $health.modelSha256 -eq $lock.model_sha256
        } catch { $healthy = $false }
        if (-not $healthy) { Start-Sleep -Milliseconds 500 }
    } while (-not $healthy -and (Get-Date) -lt $deadline)
    if (-not $healthy) { throw "Task registered but service did not become healthy. Check $runtimeRoot\logs\service.log" }
    & $pythonPath -B -m text_safety.run_pinned --config $configPath --probe
    if ($LASTEXITCODE -ne 0) { throw 'Service started but authenticated probe failed.' }
    Write-Output "Installed and running: $taskName. Startup and 1-minute recovery triggers enabled; active instances are not duplicated."
} finally { Pop-Location }
