# Builds every release artifact of this repository in dependency order:
#
#   1. runhost\Build-RunHost.ps1                 -> runhost\<platform>\ + runhost\javascript\ + runhost\blazor\
#   2. visual_studio_code_plugin\build\Package-Vsix.ps1
#                                                -> visual_studio_code_plugin\build\SmallBasic.VSCode-<version>.vsix
#                                                   (also refreshes dist\debug\adapter.js used by the VS side)
#   3. visual_studio_plugin\build\Package-Vsix.ps1 -> builds src\SmallBasic.Vsix
#                                                -> visual_studio_plugin\build\SmallBasic.Vsix.<version>.vsix
#
# Both packaging scripts depend on the RunHost distribution built in step 1 and
# accept -SkipRunHost for exactly that reason: running them standalone builds the
# distribution themselves, while this script never builds it twice.
#
# <version> is read from version.json, the single version shared by the Visual
# Studio and Visual Studio Code extensions.
#
# Usage examples:
#   .\Build-All.ps1                    # full Release build
#   .\Build-All.ps1 -Configuration Debug
#   .\Build-All.ps1 -SkipVsix          # RunHost distribution only
#   .\Build-All.ps1 -SkipJavaScript    # skip the JS run host bundle step of Build-RunHost
#   .\Build-All.ps1 -SkipWeb           # skip the runhost\web static site assembly
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [switch]$SkipJavaScript,

    [switch]$SkipWeb,

    [switch]$SkipVsix
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot

# Propagate version.json into every generated file (extension manifests,
# generated C# constant and README) before any artifact is built.
Write-Host "=== Sync version (version.json) ===" -ForegroundColor Yellow
& node (Join-Path $repoRoot "tools\sync-version.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Version synchronization failed with exit code $LASTEXITCODE."
}

$version = [string]((Get-Content -LiteralPath (Join-Path $repoRoot "version.json") -Raw | ConvertFrom-Json).version)

# Every RunHost distribution folder exposes its own Build-RunHost.ps1 script.
# Register new ones here when additional hosts are added.
$runHostBuildScripts = @(
    (Join-Path $repoRoot "runhost\Build-RunHost.ps1")
)

foreach ($scriptPath in $runHostBuildScripts) {
    if (-not (Test-Path $scriptPath)) {
        throw "RunHost build script not found: $scriptPath"
    }

    Write-Host ""
    Write-Host "=== Build-RunHost: $scriptPath ===" -ForegroundColor Yellow
    & $scriptPath -Configuration $Configuration -SkipJavaScript:$SkipJavaScript -SkipWeb:$SkipWeb
}

if ($SkipVsix) {
    Write-Host ""
    Write-Host "RunHost builds completed (-SkipVsix)." -ForegroundColor Green
    return
}

# VS Code extension VSIX. This also rebuilds dist\debug\adapter.js and
# dist\runhost.js, which the Visual Studio side consumes below. The configuration
# is forwarded so the staged RunHost payload matches this build; -SkipRunHost
# reuses the RunHost distribution built above.
Write-Host ""
Write-Host "=== Package-Vsix: visual_studio_code_plugin ($Configuration) ===" -ForegroundColor Yellow
& (Join-Path $repoRoot "visual_studio_code_plugin\build\Package-Vsix.ps1") -Configuration $Configuration -SkipRunHost

# Visual Studio extension. SmallBasic.Vsix is the only Visual Studio package: a
# VisualStudio.Extensibility hybrid extension whose in-proc compatibility layer
# carries the MEF editor parts, the F5 command filter and the Open Folder debug
# target provider. -SkipRunHost reuses the RunHost distribution built above; the
# project itself still stages RunHost net48 / Blazor for the VSIX.
Write-Host ""
Write-Host "=== Package-Vsix: visual_studio_plugin ($Configuration) ===" -ForegroundColor Yellow
& (Join-Path $repoRoot "visual_studio_plugin\build\Package-Vsix.ps1") -Configuration $Configuration -SkipRunHost

Write-Host ""
Write-Host "Build-All completed:" -ForegroundColor Green
Write-Host "  runhost\net48, net8.0, net8.0-windows, javascript, blazor"
Write-Host "  visual_studio_code_plugin\build\SmallBasic.VSCode-$version.vsix"
Write-Host "  visual_studio_plugin\build\SmallBasic.Vsix.$version.vsix"
