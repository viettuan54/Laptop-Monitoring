[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [Parameter(Mandatory = $true)]
    [string]$DeviceSecret,

    [string]$InstallDir = "$env:ProgramFiles\ChildMonitorAgent",
    [string]$Wheelhouse,

    [string]$PythonExe
)

$ErrorActionPreference = "Stop"
$ServiceName = "ChildMonitorService"
$AgentRoot = Split-Path -Parent $PSScriptRoot

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Installer must be run from an elevated Administrator PowerShell."
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
    }
}

Assert-Administrator

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

foreach ($directory in @(
    $resolvedInstallDir,
    "$resolvedInstallDir\service",
    "$resolvedInstallDir\companion",
    "$resolvedInstallDir\installer",
    "$resolvedInstallDir\models",
    "$resolvedInstallDir\config",
    "$resolvedInstallDir\db",
    "$resolvedInstallDir\logs",
    "$resolvedInstallDir\temp"
)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

Copy-Item -Force "$AgentRoot\service\*.py" "$resolvedInstallDir\service\"
Copy-Item -Force "$AgentRoot\companion\*.py" "$resolvedInstallDir\companion\"
Copy-Item -Force "$AgentRoot\installer\*.py" "$resolvedInstallDir\installer\"
Copy-Item -Force "$AgentRoot\installer\uninstall.ps1" "$resolvedInstallDir\installer\"
Copy-Item -Force "$AgentRoot\installer\provision.ps1" "$resolvedInstallDir\installer\"
Copy-Item -Force "$AgentRoot\requirements.txt" "$resolvedInstallDir\requirements.txt"

$requiredModels = @(
    @{
        Path = "$AgentRoot\models\face_landmarker.task"
        Sha256 = "64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF"
    },
    @{
        Path = "$AgentRoot\models\pose_landmarker_lite.task"
        Sha256 = "59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A"
    },
    @{
        Path = "$AgentRoot\models\eye_distance_profile_v3.json"
        Sha256 = "815FB3E281EB68D55FC45D513F215A53676519161C5A5CEA20A5EA7FEEB4B472"
    }
)
foreach ($model in $requiredModels) {
    $modelPath = $model.Path
    if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf)) {
        throw "Required Edge AI model is missing: $modelPath"
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $modelPath).Hash
    if ($actualHash -ne $model.Sha256) {
        throw "Edge AI model integrity check failed: $modelPath"
    }
    Copy-Item -Force -LiteralPath $modelPath -Destination "$resolvedInstallDir\models\"
}

$venvPython = "$resolvedInstallDir\venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
    $pythonCommand = $null
    $pythonPrefix = @()
    if ($PythonExe) {
        $pythonCommand = (Resolve-Path -LiteralPath $PythonExe -ErrorAction Stop).Path
    } else {
        $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($launcher) {
            $pythonCommand = $launcher.Source
            $pythonPrefix = @("-3.11")
        } else {
            $python = Get-Command python.exe -ErrorAction Stop
            $pythonCommand = $python.Source
        }
    }

    $pythonVersion = & $pythonCommand @pythonPrefix -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    if ($LASTEXITCODE -ne 0 -or $pythonVersion -notmatch '^3\.(9|10|11|12)$') {
        throw "Agent requires Python 3.9-3.12 (Python 3.11 is recommended)."
    }
    & $pythonCommand @pythonPrefix -m venv "$resolvedInstallDir\venv"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create Agent virtual environment."
    }
}

Invoke-Checked $venvPython "-m" "pip" "install" "--upgrade" "pip"
if ($Wheelhouse) {
    $resolvedWheelhouse = (Resolve-Path -LiteralPath $Wheelhouse).Path
    Invoke-Checked $venvPython "-m" "pip" "install" "--no-index" "--find-links" $resolvedWheelhouse "-r" "$resolvedInstallDir\requirements.txt"
} else {
    Invoke-Checked $venvPython "-m" "pip" "install" "-r" "$resolvedInstallDir\requirements.txt"
}

$provisioner = "$resolvedInstallDir\installer\provision_agent.py"
$configPath = "$resolvedInstallDir\config\local_config.json"
Invoke-Checked $venvPython $provisioner "--server-url" $ServerUrl "--device-secret" $DeviceSecret "--config-path" $configPath

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    if ($existingService.Status -ne "Stopped") {
        Stop-Service -Name $ServiceName -Force
        $existingService.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    Invoke-Checked $venvPython "$resolvedInstallDir\service\main_service.py" "remove"
}

Invoke-Checked $venvPython "$resolvedInstallDir\service\main_service.py" "--startup" "auto" "install"
Start-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))

Write-Host "Child Monitor Agent installed and running at: $resolvedInstallDir"
