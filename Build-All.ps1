# Builds every release artifact of this repository in dependency order:
#
#   1. runhost\Build-RunHost.ps1                 -> runhost\<platform>\ + runhost\javascript\ + runhost\blazor\
#   2. visual_studio_code_plugin\build\Package-Vsix.ps1
#                                                -> visual_studio_code_plugin\build\SmallBasic.VSCode-<version>.vsix
#                                                   (also refreshes dist\debug\adapter.js used by the VS side)
#   3. visual_studio_plugin\build\Package-Vsix.ps1 -> builds src\SmallBasic.Vsix
#                                                -> visual_studio_plugin\build\SmallBasic.Vsix.<version>.vsix
#   4. runhost\Build-PlaygroundApp.ps1            -> runhost\playground\ (portable Windows/Linux x64 + staged app + sidecars)
#
# The packaging scripts in steps 2-3 depend on the RunHost distribution built in
# step 1 and accept -SkipRunHost for exactly that reason: running them standalone
# builds the distribution themselves, while this script never builds it twice.
# Step 4 consumes the VS Code dist bundles and the playground bundle produced in
# steps 1-2, so it runs last and reuses them instead of rebuilding them.
#
# <version> is read from version.json, the single version shared by the Visual
# Studio and Visual Studio Code extensions. The desktop installers carry the
# version of packages\smallbasic-playground-desktop instead (see step 4).
#
# Usage examples:
#   .\Build-All.ps1                    # full Release build (RunHost + VSIX + Playground Win/Linux x64 binaries)
#   .\Build-All.ps1 -Configuration Debug
#   .\Build-All.ps1 -SkipVsix          # RunHost distribution + desktop Playground only
#   .\Build-All.ps1 -SkipJavaScript    # skip the JS run host bundle step of Build-RunHost
#   .\Build-All.ps1 -SkipWeb           # skip the runhost\web static site assembly
#   .\Build-All.ps1 -SkipPlayground    # skip the Tauri desktop Playground binaries
#   .\Build-All.ps1 -SkipPlaygroundSidecars
#                                      # reuse the staged runhost\playground\bin sidecars
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [switch]$SkipJavaScript,

    [switch]$SkipWeb,

    [switch]$SkipVsix,

    # Skip step 4 entirely (the Tauri desktop Playground and its installers).
    [switch]$SkipPlayground,

    # Forward -SkipSidecars to step 4: reuse the already staged sidecar binaries
    # instead of re-publishing the two self-contained .NET sidecars.
    [switch]$SkipPlaygroundSidecars
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot

# Shared build helpers (version.json handling).
Import-Module (Join-Path $repoRoot "tools\common.psm1") -Force

# Propagate version.json into every generated file (extension manifests,
# generated C# constant and README) before any artifact is built.
Write-Host "=== Sync version (version.json) ===" -ForegroundColor Yellow
Sync-RepoVersion -RepositoryRoot $repoRoot

$version = Get-RepoVersion -RepositoryRoot $repoRoot

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

if (-not $SkipVsix) {
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
}

# Tauri desktop Playground (step 4). It stages runhost\playground\ with exactly
# one platform's payloads, embeds the Playground page into the app and writes the
# installers to runhost\playground\bundles.
#
# Steps 1-3 already produced the VS Code dist bundles (and, unless -SkipWeb, the
# playground bundle), so tell the desktop script to reuse them: rebuild only what
# the earlier steps actually skipped. This keeps the "never build the same
# artifact twice" rule of this script and avoids a second tsup run over dist\.
if (-not $SkipPlayground) {
    $playgroundScript = Join-Path $repoRoot "runhost\Build-PlaygroundApp.ps1"
    if (-not (Test-Path $playgroundScript)) {
        throw "Desktop Playground build script not found: $playgroundScript"
    }

    $playgroundArgs = @{
        Configuration = $Configuration
        WindowsTargets = @("x64")
        LinuxTargets = @("x64")
    }
    # Build-RunHost runs 'npm run build' unless -SkipJavaScript and -SkipWeb are combined.
    if (-not ($SkipWeb -and $SkipJavaScript)) { $playgroundArgs.SkipJavaScript = $true }
    # Build-RunHost runs 'npm run build:playground' unless -SkipWeb.
    if (-not $SkipWeb) { $playgroundArgs.SkipPlaygroundBundle = $true }
    if ($SkipPlaygroundSidecars) { $playgroundArgs.SkipSidecars = $true }

    Write-Host ""
    Write-Host "=== Build-PlaygroundApp: runhost\playground ($Configuration) ===" -ForegroundColor Yellow
    & $playgroundScript @playgroundArgs
}

Write-Host ""
Write-Host "Build-All completed:" -ForegroundColor Green
Write-Host "  runhost\net48, net8.0, net8.0-windows, javascript, blazor"
if (-not $SkipVsix) {
    Write-Host "  visual_studio_code_plugin\build\SmallBasic.VSCode-$version.vsix"
    Write-Host "  visual_studio_plugin\build\SmallBasic.Vsix.$version.vsix"
}
if (-not $SkipPlayground) {
    Write-Host "  runhost\playground\SmallBasic.Playground.exe (portable, Windows)"
    Write-Host "  runhost\playground\SmallBasic.Playground (portable ELF, Linux - run via WSL/WSLg)"
}
