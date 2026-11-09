param([switch]$Install, [string]$Serial = '')
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$toolRoot = Join-Path (Split-Path $project -Parent) '.runtime/android-tools'
$jdk = Get-ChildItem (Join-Path $toolRoot 'jdk') -Directory | Select-Object -First 1
if (-not $jdk) { throw 'JDK missing. Install JDK 17 and use gradlew.bat, or provision .runtime/android-tools.' }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $toolRoot 'sdk'
$env:ANDROID_USER_HOME = Join-Path $toolRoot 'user'
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-cache'
Push-Location $project
try {
    & (Join-Path $toolRoot 'gradle-8.11.1/bin/gradle.bat') --no-daemon --console=plain :app:assembleDebug :app:testDebugUnitTest
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    if ($Install) {
        $adb = Join-Path $toolRoot 'platform-tools/adb.exe'
        $target = @()
        if ($Serial) { $target = @('-s', $Serial) }
        & $adb @target install -r (Join-Path $project 'app/build/outputs/apk/debug/app-debug.apk')
        if ($LASTEXITCODE -ne 0) { throw 'ADB installation failed. Check USB installation permission on the phone.' }
        & $adb @target shell am start -n vn.laptopchildren.parent/.MainActivity
    }
} finally { Pop-Location }
