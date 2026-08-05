[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [Parameter(Mandatory = $true)]
    [string]$DeviceSecret,

    [string]$InstallDir = "$env:ProgramFiles\ChildMonitorAgent",
    [string]$SubjectId,
    [switch]$SkipValidation
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Provisioning must be run from an elevated Administrator PowerShell."
}

$python = "$InstallDir\venv\Scripts\python.exe"
$provisioner = "$InstallDir\installer\provision_agent.py"
$config = "$InstallDir\config\local_config.json"
if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $provisioner)) {
    throw "Agent is not installed at $InstallDir."
}

$arguments = @(
    $provisioner,
    "--server-url", $ServerUrl,
    "--device-secret", $DeviceSecret,
    "--config-path", $config
)
if ($SkipValidation) {
    $arguments += "--skip-validation"
}
if ($SubjectId) {
    if ($SubjectId -notmatch '^subject-[A-Za-z0-9_-]+$') {
        throw "SubjectId must use the form subject-<safe-id>."
    }
    $arguments += @("--vision-subject-id", $SubjectId)
}

& $python @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Provisioning failed with exit code $LASTEXITCODE."
}

$service = Get-Service -Name "ChildMonitorService" -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
    Restart-Service -Name "ChildMonitorService" -Force
    $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
}
