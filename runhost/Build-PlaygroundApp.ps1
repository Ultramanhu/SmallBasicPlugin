# Rebuilds the Tauri desktop Playground (Small Basic Playground) and archives its
# installers, following ../docs/design/10-Playground与Tauri本地应用.md (§18.5 / §19.1):
#
#   1. npm run build                      -> visual_studio_code_plugin\packages\smallbasic-vscode\dist
#                                            (runhost.js, debug\adapter.js, web-runhost.js)
#   2. npm run build:playground           -> ...\playground-dist (Monaco page + workers)
#   3. scripts\stage-playground.mjs       -> runhost\playground\{app,resources,bin} + manifest.json
#   4. tauri build --target <triple>      -> src-tauri\target\<triple>\release\bundle\{msi,nsis}
#   5. portable exe copied to runhost\playground\SmallBasic.Playground.exe
#         (runs in place: on Windows the resource dir is the exe's directory, so
#          bin\ sidecars and resources\ resolve next to it)
#   6. installers copied to runhost\playground\bundles\
#        SmallBasic.Playground-<version>-<triple>.msi
#        SmallBasic.Playground-<version>-<triple>-setup.exe
#
# <version> is read from version.json, the single source shared with the Visual
# Studio and VS Code extensions; tools\sync-version.mjs keeps tauri.conf.json,
# the npm package and Cargo.toml in step (Build-All.ps1 runs it automatically).
#
# Like Build-RunHost.ps1 in this folder, this is the entry point for one desktop
# distribution. Use it after any change that reaches the Playground page (the
# Monaco entry, the shared shell, the language worker or the desktop bridge in
# desktop.js): the Tauri release build embeds runhost\playground\app into the
# executable, so an existing installer keeps serving the old page until it is
# repackaged.
#
# Usage examples (from the repository root):
#   .\runhost\Build-PlaygroundApp.ps1                     # full Release rebuild + installers
#   .\runhost\Build-PlaygroundApp.ps1 -SkipSidecars       # reuse bin\ sidecars (front-end change only)
#   .\runhost\Build-PlaygroundApp.ps1 -StageOnly          # stage + compile, no installer bundling
#   .\runhost\Build-PlaygroundApp.ps1 -Target aarch64-pc-windows-msvc
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    # Rust target triple. Defaults to the host triple; the staged sidecars in
    # runhost\playground\bin must match it (see -SkipSidecars).
    [string]$Target,

    # Reuse runhost\playground\bin sidecars instead of re-publishing the .NET
    # sidecars. Only safe when the target sidecars are already staged.
    [switch]$SkipSidecars,

    # Skip 'npm run build' (the workspace bundles in packages\smallbasic-vscode\dist).
    [switch]$SkipJavaScript,

    # Skip 'npm run build:playground' (the Monaco page bundle).
    [switch]$SkipPlaygroundBundle,

    # Assemble runhost\playground\ and compile the app, but do not produce or
    # archive installers.
    [switch]$StageOnly,

    # Keep the fresh installers in src-tauri\target only (no runhost\playground\bundles copy).
    [switch]$SkipArchive
)

$ErrorActionPreference = "Stop"

# This script lives in runhost\, so the repository root is one level up.
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $repoRoot "visual_studio_code_plugin"
$desktopPackage = Join-Path $pluginRoot "packages\smallbasic-playground-desktop"
$stageScript = Join-Path $desktopPackage "scripts\stage-playground.mjs"
$tauriConfigPath = Join-Path $desktopPackage "src-tauri\tauri.conf.json"
$versionFile = Join-Path $repoRoot "version.json"
$stageRoot = Join-Path $repoRoot "runhost\playground"
$bundleRoot = Join-Path $stageRoot "bundles"

foreach ($required in @($stageScript, $tauriConfigPath, $versionFile)) {
    if (-not (Test-Path $required)) {
        throw "Expected file not found: $required"
    }
}

function Get-HostTriple {
    $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
        "aarch64"
    } else {
        "x86_64"
    }

    if ($IsWindows -or $env:OS -eq "Windows_NT") { return "$arch-pc-windows-msvc" }
    if ($IsMacOS) { return "$arch-apple-darwin" }
    if ($IsLinux) { return "$arch-unknown-linux-gnu" }
    throw "Unsupported host platform; pass -Target explicitly."
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

$triple = if ($Target) { $Target } else { Get-HostTriple }
$hostTriple = Get-HostTriple

# version.json is the single source of truth shared with both extensions; the
# Tauri bundle metadata must have been synced from it before packaging.
$version = [string]((Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json).version)
$tauriVersion = [string]((Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json).version)
if ($tauriVersion -ne $version) {
    throw "tauri.conf.json declares version $tauriVersion but version.json declares $version. Run 'node tools\sync-version.mjs' and build again."
}

if ($SkipSidecars -and $triple -ne $hostTriple) {
    Write-Warning "-SkipSidecars keeps the existing bin\ sidecars; verify they match '$triple' before shipping."
}

Write-Host "Small Basic Playground $version" -ForegroundColor Green
Write-Host "  configuration : $Configuration"
Write-Host "  target        : $triple"
Write-Host "  staging root  : $stageRoot"

if (-not (Test-Path (Join-Path $pluginRoot "node_modules"))) {
    Invoke-Step -Name "npm install ($pluginRoot)" -WorkingDirectory $pluginRoot -Action { npm install }
}

if (-not $SkipJavaScript) {
    Invoke-Step -Name "npm run build (VS Code workspace bundles)" -WorkingDirectory $pluginRoot -Action { npm run build }
}

if (-not $SkipPlaygroundBundle) {
    Invoke-Step -Name "npm run build:playground" -WorkingDirectory $pluginRoot -Action {
        npm run build:playground --workspace smallbasic-tools-vsc
    }
}

$stageArgs = @($stageScript, "--target", $triple, "--configuration", $Configuration)
if ($SkipSidecars) { $stageArgs += "--skip-sidecars" }

Invoke-Step -Name "Stage runhost\playground ($triple)" -Action { node @stageArgs }

# Only pass --target for a genuine cross build: cargo keeps a separate directory
# per target triple, so forcing it for the host would throw away the warm cache.
$crossBuild = $triple -ne $hostTriple
$tauriArgs = @("tauri", "build")
if ($crossBuild) { $tauriArgs += @("--target", $triple) }
if ($StageOnly) { $tauriArgs += "--no-bundle" }
if ($Configuration -eq "Debug") { $tauriArgs += "--debug" }

Invoke-Step -Name "tauri build ($triple, $Configuration)" -WorkingDirectory $desktopPackage -Action { npx @tauriArgs }

# Tauri writes the bundles under target\<triple>\<profile>\bundle\ for a cross
# build and target\<profile>\bundle\ otherwise; the cargo profile directory is
# lower case.
$profile = if ($Configuration -eq "Debug") { "debug" } else { "release" }
$targetDir = if ($crossBuild) { "src-tauri\target\$triple\$profile" } else { "src-tauri\target\$profile" }
$bundleOutput = Join-Path $desktopPackage "$targetDir\bundle"

# Portable executable in the staging root, next to the sidecars (bin\) and the
# resource payload (resources\) it resolves at runtime. On Windows the Tauri
# resource directory is the directory of the executable (tauri-utils
# platform.rs) and resolve_sidecar probes <resource_dir>\bin, so this copy runs
# in place - no installer and no environment variable required.
$exeSuffix = if ($triple -like "*windows*") { ".exe" } else { "" }
$appBinary = Join-Path $desktopPackage "$targetDir\smallbasic-playground-desktop$exeSuffix"
if (-not (Test-Path $appBinary)) {
    throw "The desktop application binary was not produced: $appBinary"
}

$portableBinary = Join-Path $stageRoot "SmallBasic.Playground$exeSuffix"
Invoke-Step -Name "Copy the portable executable into runhost\playground" -Action {
    Copy-Item -LiteralPath $appBinary -Destination $portableBinary -Force
}

if ($StageOnly) {
    Write-Host ""
    Write-Host "Staged and compiled (-StageOnly); no installers were bundled." -ForegroundColor Green
    Write-Host "  app : $(Join-Path $stageRoot "app")"
    Write-Host "  exe : $portableBinary"
    return
}

$installers = @()
if (Test-Path $bundleOutput) {
    foreach ($entry in @(
        @{ Dir = "msi";  Suffix = "";       Extension = ".msi" },
        @{ Dir = "nsis"; Suffix = "-setup"; Extension = ".exe" }
    )) {
        $directory = Join-Path $bundleOutput $entry.Dir
        if (-not (Test-Path $directory)) { continue }

        # Only this version's installer: an earlier build leaves its own file in
        # the same folder, and archiving that one would ship a stale package
        # under the new name.
        $matches = @(
            Get-ChildItem -LiteralPath $directory -File -Filter "*$($entry.Extension)" |
                Where-Object { $_.Name -like "*_$version*" }
        )
        if ($matches.Count -ne 1) {
            throw "Expected exactly one '$($entry.Extension)' installer for version $version in '$directory', found $($matches.Count). Remove the stale files from that folder and build again."
        }

        $installers += @{
            Source   = $matches[0].FullName
            FileName = "SmallBasic.Playground-$version-$triple$($entry.Suffix)$($entry.Extension)"
        }
    }
}

if ($installers.Count -eq 0) {
    throw "No installers were produced under $bundleOutput. Check the tauri build output above."
}

if ($SkipArchive) {
    Write-Host ""
    Write-Host "Installers produced (-SkipArchive, nothing copied):" -ForegroundColor Green
    foreach ($installer in $installers) {
        Write-Host "  $($installer.Source)"
    }
    return
}

Invoke-Step -Name "Archive installers into runhost\playground\bundles" -Action {
    New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null
    foreach ($installer in $installers) {
        Copy-Item -LiteralPath $installer.Source -Destination (Join-Path $bundleRoot $installer.FileName) -Force
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  portable exe : $portableBinary"
Write-Host "  installers   :"
foreach ($installer in $installers) {
    Write-Host "    $(Join-Path $bundleRoot $installer.FileName)"
}
