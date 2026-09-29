# Builds every release artifact of this repository in dependency order:
#
#   1. runhost\Build-RunHost.ps1                 -> runhost\<platform>\ + runhost\javascript\ + runhost\blazor\
#   2. visual_studio_code_plugin\build\Package-Vsix.ps1
#                                                -> visual_studio_code_plugin\build\SmallBasic.VSCode-<version>.vsix
#                                                   (also refreshes dist\debug\adapter.js used by the VS side)
#   3. visual_studio_plugin\src\SmallBasic.Vsix    -> VSIX project build (builds RunHost net48 automatically)
#   4. visual_studio_plugin\build\Package-Vsix.ps1 -> visual_studio_plugin\build\SmallBasic.Vsix.<version>.vsix
#   5. visual_studio_plugin\src\SmallBasic.Ext     -> VisualStudio.Extensibility project build
#   6. visual_studio_plugin\build\Package-Ext-Vsix.ps1 -> visual_studio_plugin\build\SmallBasic.Ext.<version>.vsix
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

# Visual Studio extension project. Its CopyRunHostOutput target builds
# SmallBasic.RunHost (net48) and stages it next to the VSIX payload. The shared
# SmallBasic.VsCommon library is pulled in through a project reference, so it does
# not need a separate step here.
Write-Host ""
Write-Host "=== Build: SmallBasic.Vsix ($Configuration) ===" -ForegroundColor Yellow
$vsixProject = Join-Path $repoRoot "visual_studio_plugin\src\SmallBasic.Vsix\SmallBasic.Vsix.csproj"
dotnet build $vsixProject -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet build failed for SmallBasic.Vsix"
}

# Visual Studio extension VSIX. -SkipRunHost reuses the RunHost distribution
# built above; the project itself still stages RunHost net48 / Blazor for the VSIX.
Write-Host ""
Write-Host "=== Package-Vsix: visual_studio_plugin ===" -ForegroundColor Yellow
& (Join-Path $repoRoot "visual_studio_plugin\build\Package-Vsix.ps1") -Configuration $Configuration -SkipRunHost

# VisualStudio.Extensibility-based Visual Studio extension. It shares the same
# RunHost payloads but uses the new SDK for commands/tool windows. Its project
# references pull in SmallBasic.VsCommon (shared VS integration) and
# SmallBasic.LanguageServices (LSP + outline layer).
Write-Host ""
Write-Host "=== Build: SmallBasic.Ext ($Configuration) ===" -ForegroundColor Yellow
$extProject = Join-Path $repoRoot "visual_studio_plugin\src\SmallBasic.Ext\SmallBasic.Ext.csproj"
dotnet build $extProject -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet build failed for SmallBasic.Ext"
}

Write-Host ""
Write-Host "=== Package-Vsix: visual_studio_plugin (Extensibility) ===" -ForegroundColor Yellow
& (Join-Path $repoRoot "visual_studio_plugin\build\Package-Ext-Vsix.ps1") -Configuration $Configuration -SkipRunHost

Write-Host ""
Write-Host "Build-All completed:" -ForegroundColor Green
Write-Host "  runhost\net48, net8.0, net8.0-windows, javascript, blazor"
Write-Host "  visual_studio_code_plugin\build\SmallBasic.VSCode-$version.vsix"
Write-Host "  visual_studio_plugin\build\SmallBasic.Vsix.$version.vsix"
Write-Host "  visual_studio_plugin\build\SmallBasic.Ext.$version.vsix"
