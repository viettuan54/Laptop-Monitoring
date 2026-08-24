[CmdletBinding()]
param(
    [string]$Version = "1.0.14",
    [string]$PythonExe,
    [string]$InnoSetupCompiler,
    [string]$EyeDistanceProfilePath,
    [string]$PostureModelPath,
    [string]$PostureProfilePath,
    [string]$AppContentModelPath,
    [string]$WebContentModelPath,
    [string]$AppExactLookupPath,
    [string]$WebExactLookupPath,
    [switch]$SkipDependencyInstall,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$BuildRoot = $PSScriptRoot
$AgentRoot = Split-Path -Parent $BuildRoot
$WorkRoot = Join-Path $BuildRoot "work"
$DistRoot = Join-Path $BuildRoot "dist"
$ReleaseRoot = Join-Path $BuildRoot "release\ChildMonitorAgent-$Version"
$OutputRoot = Join-Path $BuildRoot "output"

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

function Remove-BuildDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    $resolvedBuildRoot = [IO.Path]::GetFullPath($BuildRoot).TrimEnd('\') + '\'
    $resolvedTarget = [IO.Path]::GetFullPath($Path)
    if (-not ($resolvedTarget + '\').StartsWith(
        $resolvedBuildRoot,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to clean a path outside the Agent build directory: $resolvedTarget"
    }
    if (Test-Path -LiteralPath $resolvedTarget) {
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    }
}

function Copy-JsonAssetWithHash {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationName,
        [switch]$RequireDeploymentApproval
    )
    $resolvedSource = (Resolve-Path -LiteralPath $SourcePath -ErrorAction Stop).Path
    if ([IO.Path]::GetExtension($resolvedSource) -ne ".json") {
        throw "Edge AI asset must be JSON: $resolvedSource"
    }
    $payload = Get-Content -Raw -LiteralPath $resolvedSource -Encoding UTF8 |
        ConvertFrom-Json -ErrorAction Stop
    if ($RequireDeploymentApproval -and $payload.deployment_approved -ne $true) {
        throw "Content model did not pass its deployment gate: $resolvedSource"
    }
    $destination = Join-Path "$ReleaseRoot\models" $DestinationName
    Copy-Item -Force -LiteralPath $resolvedSource -Destination $destination
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$destination.sha256", "$hash`n", [Text.Encoding]::ASCII)
}

if ($Version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
    throw "Version must contain three or four numeric components."
}

if (-not $PythonExe) {
    $candidates = @(
        "$AgentRoot\.venv-build\Scripts\python.exe",
        "$AgentRoot\.venv-edge\Scripts\python.exe"
    )
    $PythonExe = $candidates | Where-Object {
        Test-Path -LiteralPath $_ -PathType Leaf
    } | Select-Object -First 1
    if (-not $PythonExe) {
        $pythonCommand = Get-Command python.exe -ErrorAction Stop
        $PythonExe = $pythonCommand.Source
    }
}
$PythonExe = (Resolve-Path -LiteralPath $PythonExe -ErrorAction Stop).Path
$pythonVersion = & $PythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0 -or $pythonVersion -ne "3.11") {
    throw "Release builds require 64-bit Python 3.11."
}
$pythonBits = & $PythonExe -c "import struct; print(struct.calcsize('P') * 8)"
if ($LASTEXITCODE -ne 0 -or $pythonBits -ne "64") {
    throw "Release builds require 64-bit Python."
}

$env:PYINSTALLER_CONFIG_DIR = Join-Path $WorkRoot "pyinstaller-cache"
$env:MPLCONFIGDIR = Join-Path $WorkRoot "matplotlib-cache"

if (-not $SkipDependencyInstall) {
    Invoke-Checked $PythonExe "-m" "pip" "install" "-r" "$AgentRoot\requirements-build.txt"
}
Invoke-Checked $PythonExe "-c" (
    "import PyInstaller, cv2, mediapipe, win32serviceutil; " +
    "assert mediapipe.__version__ == '0.10.33'"
)

foreach ($directory in @($WorkRoot, $DistRoot, $ReleaseRoot)) {
    Remove-BuildDirectory $directory
}
foreach ($directory in @(
    $WorkRoot,
    $DistRoot,
    "$ReleaseRoot\service",
    "$ReleaseRoot\companion",
    "$ReleaseRoot\installer",
    "$ReleaseRoot\models",
    "$ReleaseRoot\config",
    "$ReleaseRoot\db",
    "$ReleaseRoot\logs",
    "$ReleaseRoot\temp",
    $OutputRoot
)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

foreach ($spec in @("service.spec", "companion.spec", "provision.spec")) {
    $name = [IO.Path]::GetFileNameWithoutExtension($spec)
    Invoke-Checked $PythonExe "-m" "PyInstaller" "--noconfirm" "--clean" `
        "--distpath" $DistRoot "--workpath" "$WorkRoot\$name" "$BuildRoot\$spec"
}

Copy-Item -Path "$DistRoot\ChildMonitorService\*" `
    -Destination "$ReleaseRoot\service" -Recurse -Force
Copy-Item -Path "$DistRoot\ChildMonitorCompanion\*" `
    -Destination "$ReleaseRoot\companion" -Recurse -Force
Copy-Item -LiteralPath "$DistRoot\ChildMonitorProvision.exe" `
    -Destination "$ReleaseRoot\installer\ChildMonitorProvision.exe" -Force
Copy-Item -LiteralPath "$AgentRoot\installer\provision.ps1" `
    -Destination "$ReleaseRoot\installer\provision.ps1" -Force
Copy-Item -LiteralPath "$AgentRoot\installer\uninstall.ps1" `
    -Destination "$ReleaseRoot\installer\uninstall.ps1" -Force
Copy-Item -Path "$AgentRoot\models\*" -Destination "$ReleaseRoot\models" -Force

$WorkspaceRoot = Split-Path -Parent $AgentRoot
if (-not $AppContentModelPath) {
    $AppContentModelPath = Join-Path $WorkspaceRoot "ai-training\artifacts\content_classification\app_content_model_v1.json"
}
if (-not $WebContentModelPath) {
    $WebContentModelPath = Join-Path $WorkspaceRoot "ai-training\artifacts\content_classification\web_content_model_v1.json"
}
if (-not $AppExactLookupPath) {
    $AppExactLookupPath = Join-Path $WorkspaceRoot "ai-training\artifacts\content_classification\app_exact_lookup_v1.json"
}
if (-not $WebExactLookupPath) {
    $WebExactLookupPath = Join-Path $WorkspaceRoot "ai-training\artifacts\content_classification\web_exact_lookup_v1.json"
}
Copy-JsonAssetWithHash $AppContentModelPath "app_content_model_v1.json" -RequireDeploymentApproval
Copy-JsonAssetWithHash $WebContentModelPath "web_content_model_v1.json" -RequireDeploymentApproval
Copy-JsonAssetWithHash $AppExactLookupPath "app_exact_lookup_v1.json"
Copy-JsonAssetWithHash $WebExactLookupPath "web_exact_lookup_v1.json"

$requiredModels = @{
    "face_landmarker.task" = "64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF"
    "pose_landmarker_lite.task" = "59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A"
}
foreach ($entry in $requiredModels.GetEnumerator()) {
    $modelPath = Join-Path "$ReleaseRoot\models" $entry.Key
    if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf)) {
        throw "Required Edge AI model is missing: $modelPath"
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $modelPath).Hash
    if ($actualHash -ne $entry.Value) {
        throw "Edge AI model integrity check failed: $modelPath"
    }
}

foreach ($contentAsset in @(
    "app_content_model_v1.json",
    "web_content_model_v1.json",
    "app_exact_lookup_v1.json",
    "web_exact_lookup_v1.json"
)) {
    $contentPath = Join-Path "$ReleaseRoot\models" $contentAsset
    if (-not (Test-Path -LiteralPath $contentPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath "$contentPath.sha256" -PathType Leaf)) {
        throw "Required content model asset is missing: $contentAsset"
    }
}

if ($EyeDistanceProfilePath) {
    Copy-JsonAssetWithHash $EyeDistanceProfilePath "eye_distance_profile_v3.json"
}
if ($PostureModelPath) {
    Copy-JsonAssetWithHash $PostureModelPath "posture_baseline_v1.json"
}
if ($PostureProfilePath) {
    if (-not $PostureModelPath -and
        -not (Test-Path -LiteralPath "$ReleaseRoot\models\posture_baseline_v1.json")) {
        throw "PostureProfilePath requires a posture baseline model."
    }
    Copy-JsonAssetWithHash $PostureProfilePath "posture_profile_v1.json"
}

Invoke-Checked "$ReleaseRoot\service\ChildMonitorService.exe" "--self-test"
Invoke-Checked "$ReleaseRoot\companion\ChildMonitorCompanion.exe" "--self-test"

if (-not $SkipInstaller) {
    if (-not $InnoSetupCompiler) {
        $innoCandidates = @(
            "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
            "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
            "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
        )
        $InnoSetupCompiler = $innoCandidates | Where-Object {
            $_ -and (Test-Path -LiteralPath $_ -PathType Leaf)
        } | Select-Object -First 1
    }
    if (-not $InnoSetupCompiler) {
        throw "Inno Setup 6 was not found. Install it or use -SkipInstaller."
    }
    $InnoSetupCompiler = (
        Resolve-Path -LiteralPath $InnoSetupCompiler -ErrorAction Stop
    ).Path
    Invoke-Checked $InnoSetupCompiler "/DMyAppVersion=$Version" `
        "/DReleaseRoot=$ReleaseRoot" "/DOutputRoot=$OutputRoot" `
        "$BuildRoot\child-monitor-agent.iss"
    $installerPath = "$OutputRoot\ChildMonitorSetup-$Version.exe"
    $installerHash = (
        Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath
    ).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(
        "$installerPath.sha256",
        "$installerHash  ChildMonitorSetup-$Version.exe`n",
        [Text.Encoding]::ASCII
    )
    Write-Host "Installer created: $installerPath"
    Write-Host "SHA-256: $installerHash"
} else {
    Write-Host "Portable release staged at: $ReleaseRoot"
}
