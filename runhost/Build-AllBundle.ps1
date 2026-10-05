# Builds every "bundle" of this repository in dependency order:
#
#   1. front-end JS/TS bundles (visual_studio_code_plugin, npm monorepo):
#        npm run build                     -> packages\smallbasic-vscode\dist\
#                                             extension.js, debug\adapter.js, runhost.js,
#                                             web\extension.js, web-runhost.js
#                                             and packages\smallbasic-playground-desktop\dist\desktop.js
#        npm run build:playground          -> packages\smallbasic-vscode\playground-dist\
#                                             (Monaco page, editor/language workers, onig.wasm)
#
#   2. desktop installer bundles:
#        Build-PlaygroundApp.ps1 -BuildBundles
#                                          -> runhost\playground\bundles\*.msi / *-setup.exe
#                                             / *.deb / *.rpm / *.AppImage / *.apk / *.aab / *.dmg / *.ipa
#
# Step 2 consumes the bundles staged by step 1, so step 1 runs first and step 2 is
# told to reuse them (-SkipJavaScript / -SkipPlaygroundBundle) instead of running
# tsup/esbuild a second time. Pass -SkipFrontEnd to skip step 1 entirely and reuse
# whatever bundles are already on disk (for example right after a code-only change
# to the Tauri shell).
#
# <version> is read from version.json through tools\common.psm1; the installers
# carry the version of packages\smallbasic-playground-desktop instead (synced from
# the same version.json).
#
# Usage examples:
#   .\runhost\Build-AllBundle.ps1
#                                     # all front-end bundles + default Win/Linux x64 installers
#   .\runhost\Build-AllBundle.ps1 -SkipFrontEnd
#                                     # installer bundles only, reusing the current bundles
#   .\runhost\Build-AllBundle.ps1 -SkipPlaygroundBundle
#                                     # reuse the Monaco page bundle, rebuild the rest
#   .\runhost\Build-AllBundle.ps1 -WindowsTargets x64,arm64 -LinuxTargets x64
#   .\runhost\Build-AllBundle.ps1 -BundleTargets win-x64,linux-x64,android-arm64
#                                     # explicit triple/alias list for step 2
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    # Skip step 1 (every front-end JS/TS bundle) and reuse what is on disk.
    [switch]$SkipFrontEnd,

    # Granular skips inside step 1. Ignored when -SkipFrontEnd is set.
    # -SkipJavaScript skips 'npm run build' (the workspace bundles in dist\).
    [switch]$SkipJavaScript,

    # -SkipPlaygroundBundle skips 'npm run build:playground' (the Monaco page bundle).
    [switch]$SkipPlaygroundBundle,

    # ---------------------------------------------------------------------
    # Forwarded to step 2 (runhost\Build-PlaygroundApp.ps1).
    # ---------------------------------------------------------------------

    # Installer platforms to build and archive in sequence. Accepts aliases
    # (win-x64, win-arm64, linux-x64, linux-arm64, android-arm64, android-x64,
    # macos-x64, macos-arm64, ios-arm64, ios-sim-arm64, ios-sim-x64) or full
    # Rust triples. Overrides the platform selectors below.
    [string[]]$BundleTargets,

    [ValidateSet("x64", "arm64")]
    [string[]]$WindowsTargets,

    [ValidateSet("x64", "arm64")]
    [string[]]$LinuxTargets,

    [ValidateSet("x64", "arm64")]
    [string[]]$AndroidTargets,

    [ValidateSet("x64", "arm64")]
    [string[]]$MacOSTargets,

    [ValidateSet("arm64", "sim-arm64", "sim-x64")]
    [string[]]$IOSTargets,

    # WSL distribution used for Linux bundles when the host is Windows.
    [string]$WslDistro = "Ubuntu",

    # Android only: build the universal APK without the .aab.
    [switch]$AndroidApkOnly,

    # Reuse the staged runhost\playground\bin sidecars instead of re-publishing
    # the .NET sidecars.
    [switch]$SkipSidecars,

    # Keep the fresh installers under src-tauri\target only (no
    # runhost\playground\bundles copy).
    [switch]$SkipArchive
)

$ErrorActionPreference = "Stop"

# This script lives in runhost\, so the repository root is one level up.
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $repoRoot "visual_studio_code_plugin"
$vscodePackage = Join-Path $pluginRoot "packages\smallbasic-vscode"
$desktopPackage = Join-Path $pluginRoot "packages\smallbasic-playground-desktop"
$playgroundScript = Join-Path $PSScriptRoot "Build-PlaygroundApp.ps1"

# Shared build helpers (version.json handling).
Import-Module (Join-Path $repoRoot "tools\common.psm1") -Force

if (-not (Test-Path $playgroundScript)) {
    throw "Desktop Playground build script not found: $playgroundScript"
}

function Invoke-Step {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Action,
        [string]$WorkingDirectory
    )

    Write-Host ""
    Write-Host "=== $Name ===" -ForegroundColor Yellow

    $pushed = $false
    if ($WorkingDirectory) {
        Push-Location $WorkingDirectory
        $pushed = $true
    }

    try {
        & $Action
        if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE."
        }
    } finally {
        if ($pushed) { Pop-Location }
    }
}

# Propagate version.json before anything is built so the installer metadata and
# the extension manifests stay in sync.
Write-Host "=== Sync version (version.json) ===" -ForegroundColor Yellow
Sync-RepoVersion -RepositoryRoot $repoRoot
$version = Get-RepoVersion -RepositoryRoot $repoRoot

$buildJavaScript = -not ($SkipFrontEnd -or $SkipJavaScript)
$buildPlaygroundBundle = -not ($SkipFrontEnd -or $SkipPlaygroundBundle)

# ---------------------------------------------------------------------------
# Step 1: front-end JS/TS bundles.
# ---------------------------------------------------------------------------
if ($SkipFrontEnd) {
    Write-Host ""
    Write-Host "=== Step 1 skipped (-SkipFrontEnd): reusing existing front-end bundles ===" -ForegroundColor Yellow
}
else {
    if (-not (Test-Path (Join-Path $pluginRoot "node_modules"))) {
        Invoke-Step -Name "npm install ($pluginRoot)" -WorkingDirectory $pluginRoot -Action { npm install }
    }

    if ($buildJavaScript) {
        Invoke-Step -Name "npm run build (VS Code workspace bundles)" -WorkingDirectory $pluginRoot -Action { npm run build }
    }

    if ($buildPlaygroundBundle) {
        Invoke-Step -Name "npm run build:playground" -WorkingDirectory $pluginRoot -Action {
            npm run build:playground --workspace smallbasic-tools-vsc
        }
    }

    # Hard-check the bundles this run produced so a partial build cannot be
    # mistaken for a successful one.
    $expected = @()
    if ($buildJavaScript) {
        $expected += @(
            (Join-Path $vscodePackage "dist\extension.js"),
            (Join-Path $vscodePackage "dist\debug\adapter.js"),
            (Join-Path $vscodePackage "dist\runhost.js"),
            (Join-Path $vscodePackage "dist\web\extension.js"),
            (Join-Path $vscodePackage "dist\web-runhost.js"),
            (Join-Path $desktopPackage "dist\desktop.js")
        )
    }
    if ($buildPlaygroundBundle) {
        $expected += @(
            (Join-Path $vscodePackage "playground-dist\index.html"),
            (Join-Path $vscodePackage "playground-dist\playground.html"),
            (Join-Path $vscodePackage "playground-dist\playground.js"),
            (Join-Path $vscodePackage "playground-dist\editor\editor.worker.js"),
            (Join-Path $vscodePackage "playground-dist\editor\language.worker.js"),
            (Join-Path $vscodePackage "playground-dist\editor\onig.wasm")
        )
    }

    foreach ($produced in $expected) {
        if (-not (Test-Path $produced)) {
            throw "Front-end bundle missing after the build: $produced"
        }
    }
}

# ---------------------------------------------------------------------------
# Step 2: desktop installer bundles.
# ---------------------------------------------------------------------------
$playgroundArgs = @{
    Configuration = $Configuration
    BuildBundles = $true
}

# Selector forwarding. BundleTargets overrides the platform selectors in the
# desktop script, so only forward whichever the caller actually used.
if ($BundleTargets) { $playgroundArgs.BundleTargets = $BundleTargets }
if ($PSBoundParameters.ContainsKey("WindowsTargets")) { $playgroundArgs.WindowsTargets = $WindowsTargets }
if ($PSBoundParameters.ContainsKey("LinuxTargets")) { $playgroundArgs.LinuxTargets = $LinuxTargets }
if ($PSBoundParameters.ContainsKey("AndroidTargets")) { $playgroundArgs.AndroidTargets = $AndroidTargets }
if ($PSBoundParameters.ContainsKey("MacOSTargets")) { $playgroundArgs.MacOSTargets = $MacOSTargets }
if ($PSBoundParameters.ContainsKey("IOSTargets")) { $playgroundArgs.IOSTargets = $IOSTargets }
if ($PSBoundParameters.ContainsKey("WslDistro")) { $playgroundArgs.WslDistro = $WslDistro }
if ($AndroidApkOnly) { $playgroundArgs.AndroidApkOnly = $true }
if ($SkipSidecars) { $playgroundArgs.SkipSidecars = $true }
if ($SkipArchive) { $playgroundArgs.SkipArchive = $true }

# Step 1 already (re)built these bundles, so tell the desktop script to reuse
# them instead of running tsup/esbuild again.
if ($buildJavaScript) { $playgroundArgs.SkipJavaScript = $true }
if ($buildPlaygroundBundle) { $playgroundArgs.SkipPlaygroundBundle = $true }

Write-Host ""
Write-Host "=== Build-PlaygroundApp: runhost\playground installers ($Configuration) ===" -ForegroundColor Yellow
& $playgroundScript @playgroundArgs

Write-Host ""
Write-Host "Build-AllBundle $version completed:" -ForegroundColor Green
if (-not $SkipFrontEnd) {
    Write-Host "  visual_studio_code_plugin\packages\smallbasic-vscode\dist\            (extension, debug\adapter, runhost, web\extension, web-runhost)"
    Write-Host "  visual_studio_code_plugin\packages\smallbasic-playground-desktop\dist\desktop.js"
    if ($buildPlaygroundBundle) {
        Write-Host "  visual_studio_code_plugin\packages\smallbasic-vscode\playground-dist\ (Monaco page + workers)"
    }
}
Write-Host "  runhost\playground\bundles\                 (installer packages, unless -SkipArchive)"
