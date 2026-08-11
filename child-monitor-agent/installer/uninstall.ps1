[CmdletBinding()]
param(
    [string]$InstallDir = "$env:ProgramFiles\ChildMonitorAgent",
    [switch]$PurgeData
)

$ErrorActionPreference = "Stop"
$ServiceName = "ChildMonitorService"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Uninstaller must be run from an elevated Administrator PowerShell."
}

$resolvedInstallDir = [IO.Path]::GetFullPath($InstallDir)
$programFilesBase = [IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd('\')
$programFilesRoot = $programFilesBase + '\'
if ($resolvedInstallDir.TrimEnd('\').Equals(
    $programFilesBase,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "InstallDir cannot be the Program Files root."
}
if (-not ($resolvedInstallDir + '\').StartsWith(
    $programFilesRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "InstallDir must be located under Program Files."
}

$python = "$resolvedInstallDir\venv\Scripts\python.exe"
$serviceScript = "$resolvedInstallDir\service\main_service.py"
$serviceExe = "$resolvedInstallDir\service\ChildMonitorService.exe"
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne "Stopped") {
        Stop-Service -Name $ServiceName -Force
        $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    if (Test-Path -LiteralPath $serviceExe -PathType Leaf) {
        & $serviceExe remove
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to remove bundled Windows Service."
        }
    } elseif (Test-Path -LiteralPath $python -PathType Leaf) {
        & $python $serviceScript remove
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to remove Windows Service."
        }
    } else {
        sc.exe delete $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to remove Windows Service with sc.exe."
        }
    }
}

if ($PurgeData) {
    if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf) -and
        -not (Test-Path -LiteralPath $serviceScript -PathType Leaf)) {
        throw "Refusing to purge: Agent installation marker was not found."
    }
    Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
    Write-Host "Agent service and all local data were permanently removed."
} else {
    Write-Host "Agent service removed. Local files were preserved at $resolvedInstallDir."
    Write-Host "Run again with -PurgeData to permanently remove configuration, logs and queue data."
}
