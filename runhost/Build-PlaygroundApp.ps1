# Rebuilds the Tauri desktop Playground (Small Basic Playground) and, when
# requested, archives its installers, following ../docs/design/10-Playground与Tauri本地应用.md (§18.5 / §19.1):
#
#   1. npm run build                      -> visual_studio_code_plugin\packages\smallbasic-vscode\dist
#                                            (runhost.js, debug\adapter.js, web-runhost.js)
#   2. npm run build:playground           -> ...\playground-dist (Monaco page + workers)
#   3. scripts\stage-playground.mjs       -> runhost\playground\{app,resources,bin} + manifest.json
#   4. per target: tauri build / tauri android build / WSL cargo tauri build
#   5. portable exe copied to runhost\playground\SmallBasic.Playground.exe
#         (runs in place: on Windows the resource dir is the exe's directory, so
#          bin\ sidecars and resources\ resolve next to it; the Linux build
#          copies the WSL ELF as SmallBasic.Playground - see the linux notes)
#   6. installers copied to runhost\playground\bundles\
#        SmallBasic.Playground-<version>-<triple>.msi / -setup.exe / .deb / .rpm
#        / .AppImage / .apk / .aab / .dmg / .ipa
#        (archiving also removes SmallBasic.Playground-* packages of older
#         versions; same-version packages of other targets are kept)
#
# <version> is read from version.json, the single source shared with the Visual
# Studio and VS Code extensions; tools\sync-version.mjs keeps tauri.conf.json,
# the npm package and Cargo.toml in step (Build-All.ps1 runs it automatically).
#
# Every target is compiled only when its toolchain is actually installed: the
# Rust toolchain plus the Tauri CLI for desktop targets, WSL plus cargo-tauri and
# the WebKit/GTK development packages inside the distro for Linux-from-Windows
# (see -WslDistro), the Android SDK/NDK/JDK for Android and Xcode for iOS. A
# missing environment skips that target with a warning and the remaining targets
# still build; the skipped targets are listed again at the end of the run.
#
# Package shapes:
#   default        stage + compile the selected local binaries only
#                  (default targets: linux-x64 + win-x64, no installers)
#   -BuildBundles  also produce installers and archive them into bundles\
#   -StageOnly     force local-binary-only mode even when bundle targets or
#                  installer options were selected
#   -SkipArchive   installers are produced but stay under src-tauri\target
#
# -BundleTargets builds and archives several platforms in one run. The staging
# root holds ONE target's payloads at a time, so the last target of the list
# also determines what runhost\playground\ (portable exe, bin\, resources\) is
# left holding; the bundles\ folder accumulates every target, and archiving
# prunes SmallBasic.Playground-* packages whose version is no longer current.
#
# Platform notes:
#   windows targets   native `npx tauri build` (cross builds need the matching
#                     rust target: `rustup target add <triple>`)
#   linux targets     built inside WSL (see -WslDistro); requires rustup and
#                     cargo-tauri in the distro plus the webkit2gtk dev
#                     packages, e.g. on Ubuntu:
#                       sudo apt install build-essential pkg-config libssl-dev \
#                         libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
#                         librsvg2-dev libxdo-dev file curl
#                       curl ... | sh -s -- -y   # rustup
#                       cargo install tauri-cli --locked
#                     The bare ELF is copied out as runhost\playground\
#                     SmallBasic.Playground; the resolver probes <exe>/bin and
#                     <exe>/<relative> directly, so it runs from WSL with the
#                     same zero-configuration portable behavior as Windows:
#                       wsl -d <distro> --exec \
#                         <wsl path of runhost\playground\SmallBasic.Playground>
#                     GUI apps need WSLg (default on Windows 11).
#   android targets   need the Android SDK (platform-tools, platforms;android-34,
#                     build-tools;34.0.0, an NDK) and a JDK 17+; see
#                     -AndroidSdkHome / -JavaHome. No sidecar is bundled.
#                     -AndroidApkOnly builds the universal APK alone (directly
#                     installable) and skips the Play Store .aab.
#   macos targets     need a macOS host (Xcode command line tools produce the
#                     .app + .dmg; cross-arch builds there need
#                     `rustup target add <triple>`). On Windows/Linux hosts
#                     they stop after staging: the staged runhost\playground
#                     tree is the hand-off for a macOS CI runner, which
#                     finishes the bundle with this same script.
#   ios targets       need a macOS host with Xcode (`tauri ios init` on first
#                     use, then `tauri ios build`; the default `debugging`
#                     export method signs with the local development team,
#                     store/TestFlight exports need their own signing - see
#                     -IosExportMethod). No sidecar is bundled; the shell
#                     ships the two Web backends only.
#
# Usage examples (from the repository root):
#   .\runhost\Build-PlaygroundApp.ps1
#                                      # default Release rebuild: linux-x64 + win-x64 binaries only
#   .\runhost\Build-PlaygroundApp.ps1 -SkipSidecars
#                                      # reuse bin\ sidecars (front-end change only)
#   .\runhost\Build-PlaygroundApp.ps1 -StageOnly -WindowsTargets x64,arm64
#                                      # force binary-only mode for the selected Windows targets
#   .\runhost\Build-PlaygroundApp.ps1 -BuildBundles -WindowsTargets x64,arm64 -LinuxTargets x64
#   .\runhost\Build-PlaygroundApp.ps1 -BuildBundles -AndroidTargets x64,arm64 -AndroidApkOnly
#   .\runhost\Build-PlaygroundApp.ps1 -BuildBundles -MacOSTargets x64,arm64 -IOSTargets arm64,sim-arm64
#                                      # macOS host only; elsewhere stages runhost\playground and stops
#   .\runhost\Build-PlaygroundApp.ps1 -BundleTargets win-x64,linux-x64,android-arm64
#                                      # explicit triple/alias list (implies installer generation)
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    # Rust target triple (or one of the -BundleTargets aliases). When omitted,
    # the script defaults to the local Linux/Windows x64 binary pair unless
    # the platform selector parameters below were used instead. The staged
    # sidecars in runhost\playground\bin must match the targets (see
    # -SkipSidecars). Ignored when -BundleTargets is given.
    [string]$Target,

    # Reuse runhost\playground\bin sidecars instead of re-publishing the .NET
    # sidecars. Only safe when the target sidecars are already staged.
    [switch]$SkipSidecars,

    # Skip 'npm run build' (the workspace bundles in packages\smallbasic-vscode\dist).
    [switch]$SkipJavaScript,

    # Skip 'npm run build:playground' (the Monaco page bundle).
    [switch]$SkipPlaygroundBundle,

    # Force local-binary-only mode: assemble runhost\playground\ and compile
    # the selected app binaries, but do not produce or archive installers. On
    # Android/iOS this stops after staging; on Linux-from-Windows it compiles
    # in WSL with --no-bundle so the portable ELF is produced.
    [switch]$StageOnly,

    # Opt in to installer generation. Without this switch (and without
    # -BundleTargets / -SkipArchive), the script compiles binaries only.
    [switch]$BuildBundles,

    # Keep the fresh installers in src-tauri\target only (no
    # runhost\playground\bundles copy). Implies installer generation.
    [switch]$SkipArchive,

    # One or more bundle platforms to build and archive in sequence. Accepts
    # aliases (win-x64, win-arm64, linux-x64, linux-arm64, android-arm64,
    # android-x64, macos-x64, macos-arm64, ios-arm64, ios-sim-arm64,
    # ios-sim-x64) or full Rust triples. Overrides -Target and the platform
    # selector parameters below, and implies installer generation unless
    # -StageOnly is also passed.
    [string[]]$BundleTargets,

    # Higher-level platform selectors. Each accepts one or more architectures;
    # use them when you want to toggle whole platforms instead of spelling the
    # Rust triples yourself. Ignored when -BundleTargets is given.
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

    # Android toolchain overrides; each defaults to the corresponding
    # environment variable and then to the common local installation paths.
    [string]$AndroidSdkHome,
    [string]$JavaHome,
    [string]$AndroidNdkVersion = "27.0.12077973",

    # Android only: build the universal APK without the .aab. The APK is the
    # complete, directly installable package; the .aab is only for Play Store
    # upload. Default builds both.
    [switch]$AndroidApkOnly,

    # iOS only: passed to `tauri ios build --export-method`. The Tauri default
    # (`debugging`) signs with the local development team for ad-hoc devices;
    # release-testing / app-store-connect exports need the matching signing
    # setup in Xcode.
    [ValidateSet("", "debugging", "release-testing", "app-store-connect", "enterprise", "developer-id")]
    [string]$IosExportMethod
)

$ErrorActionPreference = "Stop"

# wsl.exe emits its own notices (distro lists, the NAT localhost-proxy hint) as
# UTF-16 unless told otherwise; ask for UTF-8 so the build log stays readable.
$env:WSL_UTF8 = "1"

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

# Shared build helpers (toolchain detection).
Import-Module (Join-Path $repoRoot "tools\common.psm1") -Force

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

function Invoke-ProbeCommand {
    # Runs a native probe and returns its output lines. cargo/rustup write
    # progress to stderr, which would become a terminating NativeCommandError
    # under $ErrorActionPreference = "Stop", so the preference is relaxed for the
    # duration of the call.
    param(
        [Parameter(Mandatory)][string]$Command,
        [string[]]$Arguments = @()
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        return @(& $Command @Arguments 2>$null)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-DesktopToolchainGap {
    # What a native or cross desktop build is missing, as a list of readable
    # items (empty when the environment is complete). The per-target pipeline
    # compiles a target only when this list is empty - see the target loop.
    param(
        [Parameter(Mandatory)][string]$TargetTriple,
        [Parameter(Mandatory)][bool]$IsCrossBuild
    )

    $missing = @()
    if (-not (Test-ToolchainCommand -Name @("cargo"))) {
        $missing += "cargo (https://rustup.rs)"
    }
    if (-not (Test-TauriCliAvailable -WorkingDirectory $desktopPackage)) {
        $missing += "the Tauri CLI ('npm install' in visual_studio_code_plugin)"
    }
    if ($IsCrossBuild -and (Test-ToolchainCommand -Name @("rustup"))) {
        # A cross build needs the target's std library; without it the bundler
        # fails late with a cryptic linker error.
        $installedTargets = Invoke-ProbeCommand -Command "rustup" -Arguments @("target", "list", "--installed")
        if ($installedTargets -notcontains $TargetTriple) {
            $missing += "the Rust target $TargetTriple ('rustup target add $TargetTriple')"
        }
    }

    return $missing
}

$targetAliases = @{
    "win-x64"       = "x86_64-pc-windows-msvc"
    "win-arm64"     = "aarch64-pc-windows-msvc"
    "linux-x64"     = "x86_64-unknown-linux-gnu"
    "linux-arm64"   = "aarch64-unknown-linux-gnu"
    "android-arm64" = "aarch64-linux-android"
    "android-x64"   = "x86_64-linux-android"
    "macos-x64"     = "x86_64-apple-darwin"
    "macos-arm64"   = "aarch64-apple-darwin"
    "ios-arm64"     = "aarch64-apple-ios"
    "ios-sim-arm64" = "aarch64-apple-ios-sim"
    "ios-sim-x64"   = "x86_64-apple-ios"
}

function Resolve-TargetTriple {
    param([Parameter(Mandatory)][string]$Value)

    $alias = $targetAliases[$Value.ToLowerInvariant()]
    if ($alias) { return $alias }
    # 3 or 4 dash-separated segments: aarch64-apple-ios as well as
    # x86_64-pc-windows-msvc and aarch64-apple-ios-sim.
    if ($Value -match '^[a-z0-9_]+(-[a-z0-9_]+){2,3}$') { return $Value }

    throw "Unknown target '$Value'. Use an alias ($($targetAliases.Keys -join ', ')) or a full Rust triple."
}

function Add-PlatformTargets {
    param(
        [Parameter(Mandatory)]$Targets,
        [Parameter(Mandatory)][string]$AliasPrefix,
        [string[]]$Architectures
    )

    foreach ($architecture in @($Architectures)) {
        if (-not $architecture) { continue }
        $Targets.Add((Resolve-TargetTriple "$AliasPrefix-$architecture"))
    }
}

function Add-IosTargets {
    param(
        [Parameter(Mandatory)]$Targets,
        [string[]]$Architectures
    )

    foreach ($architecture in @($Architectures)) {
        if (-not $architecture) { continue }
        $alias = switch ($architecture.ToLowerInvariant()) {
            "arm64" { "ios-arm64" }
            "sim-arm64" { "ios-sim-arm64" }
            "sim-x64" { "ios-sim-x64" }
            default { throw "Unknown iOS target '$architecture'. Use arm64, sim-arm64 or sim-x64." }
        }

        $Targets.Add((Resolve-TargetTriple $alias))
    }
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

function Invoke-Wsl {
    # Runs wsl.exe with the given arguments; callers judge $LASTEXITCODE. wsl.exe
    # prints a stderr notice on every invocation (for example the localhost-proxy
    # hint under NAT mode), and under Windows PowerShell 5.1 a redirected
    # native-stderr line becomes a terminating NativeCommandError when
    # $ErrorActionPreference is "Stop" - which used to kill the WSL steps before
    # they ran. Keep stderr unredirected (it flows straight to the console) and
    # relax the preference only for the duration of the call.
    param([Parameter(Mandatory)][string[]]$WslArgs)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & wsl.exe @WslArgs
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Convert-ToWslPath {
    param([Parameter(Mandatory)][string]$Path)

    $full = [System.IO.Path]::GetFullPath($Path)
    $drive = $full.Substring(0, 1).ToLowerInvariant()
    "/mnt/$drive" + $full.Substring(2).Replace("\", "/")
}

function Get-WslHome {
    # The WSL home directory as a real path; every later file operation goes
    # through `wsl --exec` (no shell), so quoting never becomes an issue.
    param([Parameter(Mandatory)][string]$Distro)

    $home_ = [string](Invoke-Wsl @("-d", $Distro, "--exec", "sh", "-c", "cd; pwd"))
    if (-not $home_ -or -not $home_.StartsWith("/")) {
        throw "Could not resolve the home directory inside WSL distro '$Distro'."
    }

    $home_.Trim()
}

# Downloads $Url into $Destination with resume retries; GitHub release assets
# over this network tend to drop mid-transfer, and the Tauri AppImage tooling
# assets are the usual victims.
function Save-FileWithResume {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination,
        [int]$Attempts = 8
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        & curl.exe -sSL -C - -o $Destination $Url
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 2
    }

    throw "Failed to download $Url after $Attempts attempts."
}

$hostTriple = Get-HostTriple
$hostIsWindows = $hostTriple -like "*windows*"
$platformSelectionPassed =
    $PSBoundParameters.ContainsKey("WindowsTargets") -or
    $PSBoundParameters.ContainsKey("LinuxTargets") -or
    $PSBoundParameters.ContainsKey("AndroidTargets") -or
    $PSBoundParameters.ContainsKey("MacOSTargets") -or
    $PSBoundParameters.ContainsKey("IOSTargets")

if ($Target -and ($BundleTargets -or $platformSelectionPassed)) {
    throw "Use -Target by itself, or use -BundleTargets / the platform selector parameters, but not both."
}
if ($BundleTargets -and $platformSelectionPassed) {
    throw "Use either -BundleTargets or the platform selector parameters, not both."
}

$buildInstallers = (-not $StageOnly) -and ($BuildBundles -or [bool]$BundleTargets -or $SkipArchive)
$portableOnly = $StageOnly -or (-not $buildInstallers)
if ($StageOnly -and ($BuildBundles -or $BundleTargets -or $SkipArchive)) {
    Write-Warning "-StageOnly forces binary-only mode; installer-related options are ignored."
}

$tripleList = @()
if ($BundleTargets) {
    foreach ($entry in $BundleTargets) {
        foreach ($part in ($entry -split "[,;]")) {
            if ($part.Trim()) { $tripleList += Resolve-TargetTriple $part.Trim() }
        }
    }
} elseif ($platformSelectionPassed) {
    $selectedTargets = [System.Collections.Generic.List[string]]::new()
    Add-PlatformTargets -Targets $selectedTargets -AliasPrefix "android" -Architectures $AndroidTargets
    Add-PlatformTargets -Targets $selectedTargets -AliasPrefix "macos" -Architectures $MacOSTargets
    Add-IosTargets -Targets $selectedTargets -Architectures $IOSTargets
    Add-PlatformTargets -Targets $selectedTargets -AliasPrefix "linux" -Architectures $LinuxTargets
    Add-PlatformTargets -Targets $selectedTargets -AliasPrefix "win" -Architectures $WindowsTargets
    $tripleList = @($selectedTargets | Select-Object -Unique)
} else {
    # Default: build the local Windows/Linux x64 binaries only. Linux stages
    # first so the root keeps both the portable ELF and the Windows exe.
    $tripleList = if ($Target) { @(Resolve-TargetTriple $Target) }
        else { @("x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc") }
}

if ($tripleList.Count -eq 0) {
    throw "No Playground target was selected. Pass -Target, -BundleTargets or one of the platform selector parameters."
}

# version.json is the single source of truth shared with both extensions; the
# Tauri bundle metadata must have been synced from it before packaging.
$version = [string]((Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json).version)
$tauriVersion = [string]((Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json).version)
if ($tauriVersion -ne $version) {
    throw "tauri.conf.json declares version $tauriVersion but version.json declares $version. Run 'node tools\sync-version.mjs' and build again."
}

if ($SkipSidecars -and ($tripleList | Where-Object { $_ -ne $hostTriple })) {
    Write-Warning "-SkipSidecars keeps the existing bin\ sidecars; verify they match the requested targets before shipping."
}

Write-Host "Small Basic Playground $version" -ForegroundColor Green
Write-Host "  configuration : $Configuration"
Write-Host "  targets       : $($tripleList -join ', ')"
Write-Host "  staging root  : $stageRoot"
Write-Host "  package shape : $(if ($portableOnly) { if ($StageOnly) { 'local binaries only (-StageOnly)' } else { 'local binaries only (default)' } } elseif ($SkipArchive) { 'installers without archive (-SkipArchive)' } else { 'installers + bundles archive' })"

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

# ---------------------------------------------------------------------------
# Per-target builders. Each stages runhost\playground for its triple, compiles
# the matching app shape and (unless -StageOnly) archives the installers.
# ---------------------------------------------------------------------------

function Stage-Target {
    param([Parameter(Mandatory)][string]$TargetTriple)

    $stageArgs = @($stageScript, "--target", $TargetTriple, "--configuration", $Configuration)
    if ($SkipSidecars) { $stageArgs += "--skip-sidecars" }

    # GetNewClosure captures this function's locals; a plain scriptblock would
    # resolve variables in Invoke-Step's scope chain and find nothing.
    Invoke-Step -Name "Stage runhost\playground ($TargetTriple)" -Action { node @stageArgs }.GetNewClosure()
}

function Build-DesktopTarget {
    # Host builds and Windows cross builds: npx tauri build [--target].
    param(
        [Parameter(Mandatory)][string]$TargetTriple,
        [Parameter(Mandatory)][bool]$IsCrossBuild
    )

    $tauriArgs = @("tauri", "build")
    if ($IsCrossBuild) { $tauriArgs += @("--target", $TargetTriple) }
    if ($portableOnly) { $tauriArgs += "--no-bundle" }
    if ($Configuration -eq "Debug") { $tauriArgs += "--debug" }

    Invoke-Step -Name "tauri build ($TargetTriple, $Configuration)" -WorkingDirectory $desktopPackage -Action { npx @tauriArgs }.GetNewClosure()
}

function Get-WslToolchainGap {
    # What the WSL distro is missing to build a Linux target, as a list of
    # readable items (empty when it can build). These are the checks the build
    # steps used to raise as hard failures: a machine without WSL - or without
    # the distro's toolchain - now skips the target instead of failing the build.
    param([Parameter(Mandatory)][string]$TargetTriple)

    if (-not (Test-ToolchainCommand -Name @("wsl"))) {
        return @("WSL (wsl.exe)")
    }

    Invoke-Wsl @("-d", $WslDistro, "-e", "true")
    if ($LASTEXITCODE -ne 0) {
        return @("the WSL distribution '$WslDistro' (install it or pass -WslDistro)")
    }

    Invoke-Wsl @("-d", $WslDistro, "--", "bash", "-lc", 'test -x ~/.cargo/bin/cargo-tauri && test -x ~/.cargo/bin/cargo')
    if ($LASTEXITCODE -ne 0) {
        return @("the Rust toolchain and cargo-tauri inside WSL (see the header of this script)")
    }

    # x86_64 builds natively in the distro; other triples (aarch64) cross
    # compile with the distro's GNU cross toolchain.
    if ($TargetTriple -eq "x86_64-unknown-linux-gnu") {
        $nativeCheck = "pkg-config --exists webkit2gtk-4.1 libsoup-3.0 && dpkg -s libayatana-appindicator3-dev >/dev/null 2>&1 && dpkg -s librsvg2-dev >/dev/null 2>&1 && dpkg -s libxdo-dev >/dev/null 2>&1"
        Invoke-Wsl @("-d", $WslDistro, "--", "bash", "-lc", $nativeCheck)
        if ($LASTEXITCODE -ne 0) {
            return @("the WebKit/GTK development packages inside WSL (sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev)")
        }
    }
    elseif ($TargetTriple -like "aarch64*") {
        $arm64PkgConfigLibDir = "/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/lib/aarch64-linux-gnu/share/pkgconfig:/usr/share/pkgconfig"
        $crossCheck = "rustup target list --installed | grep -q '^$TargetTriple$' && command -v aarch64-linux-gnu-gcc >/dev/null && PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_LIBDIR=$arm64PkgConfigLibDir pkg-config --exists webkit2gtk-4.1 libsoup-3.0"
        Invoke-Wsl @("-d", $WslDistro, "--", "bash", "-lc", $crossCheck)
        if ($LASTEXITCODE -ne 0) {
            return @("the arm64 cross toolchain inside WSL (rustup target add $TargetTriple plus the :arm64 development packages; see the header of this script)")
        }
    }
    else {
        return @("a WSL cross-build recipe for $TargetTriple (build it on a native $TargetTriple host)")
    }

    return @()
}

function Build-LinuxViaWsl {
    # Linux bundles from a Windows host: the sidecar is cross-published on the
    # Windows side by the staging step, the GTK/webkit build happens in WSL.
    # Get-WslToolchainGap has already verified that the distro can build this
    # target.
    param([Parameter(Mandatory)][string]$TargetTriple)

    if (-not $hostIsWindows) {
        throw "Use the native path for Linux builds on a Linux host (this branch is Windows+WSL only)."
    }

    # x86_64 builds natively in the distro; other triples (aarch64) cross
    # compile with the distro's GNU cross toolchain and emit their binary
    # under target/<triple>/.
    $isWslHostTriple = $TargetTriple -eq "x86_64-unknown-linux-gnu"

    $srcTauriWsl = Convert-ToWslPath (Join-Path $desktopPackage "src-tauri")
    # The compile cache stays on the ext4 filesystem: building tauri over the
    # 9p /mnt bridge is an order of magnitude slower.
    $wslCommand = "source ~/.cargo/env && export CARGO_TARGET_DIR=~/tauri-target APPIMAGE_EXTRACT_AND_RUN=1 && cd '$srcTauriWsl' && cargo tauri build"
    if (-not $isWslHostTriple) {
        $wslCommand += " --target $TargetTriple"
        # AppImage is skipped for cross builds: its bundler executes the
        # architecture-matching linuxdeploy tool, which cannot run under the
        # foreign host (Exec format error). deb/rpm bundle fine.
        $wslCommand += " --bundles deb,rpm"
        if ($TargetTriple -like "aarch64*") {
            # Multiarch pkg-config: point pkg-config at the :arm64 .pc files
            # (installed via `sudo apt install libwebkit2gtk-4.1-dev:arm64 ...`).
            $wslCommand = "export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/lib/aarch64-linux-gnu/share/pkgconfig:/usr/share/pkgconfig && " + $wslCommand
        }
    }
    if ($Configuration -eq "Debug") { $wslCommand += " --debug" }

    # Portable-only mode still compiles: the bare ELF binary is the portable
    # Linux executable (copied out below); --no-bundle just skips the
    # installers.
    if ($portableOnly) {
        $wslCommand += " --no-bundle"
    } elseif ($isWslHostTriple) {
        # AppImage tooling: the bundler caches its copies under ~/.cache/tauri once
        # a build succeeded there, and GitHub drops connections on this network -
        # so the pre-fetch below is best effort (local cache first, warn on
        # failure) and only matters for a first-ever build. Arm64 has no
        # linuxdeploy AppImage, so it is skipped for cross builds (deb/rpm
        # bundle without it).
        $cacheDir = Join-Path $desktopPackage "obj\appimage-cache"
        New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
        $appImageTools = @(
            @{ Url = "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64"; Name = "AppRun-x86_64" },
            @{ Url = "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-x86_64.AppImage"; Name = "linuxdeploy-x86_64.AppImage" }
        )
        foreach ($tool in $appImageTools) {
            $cached = Join-Path $cacheDir $tool.Name
            if (-not (Test-Path $cached)) {
                try {
                    Save-FileWithResume -Url $tool.Url -Destination $cached
                } catch {
                    Write-Warning "Could not pre-fetch $($tool.Name); continuing with the WSL bundler cache."
                }
            }
        }

        $wslHome = Get-WslHome -Distro $WslDistro
        $buildCache = "$wslHome/tauri-target/release/bundle/appimage/build"
        $tauriCache = "$wslHome/.cache/tauri"
        Invoke-Wsl @("-d", $WslDistro, "--exec", "mkdir", "-p", $buildCache, $tauriCache)
        foreach ($tool in $appImageTools) {
            $cached = Join-Path $cacheDir $tool.Name
            if (Test-Path $cached) {
                Invoke-Wsl @("-d", $WslDistro, "--exec", "cp", (Convert-ToWslPath $cached), "$tauriCache/$($tool.Name)")
                if ($tool.Name -eq "AppRun-x86_64") {
                    Invoke-Wsl @("-d", $WslDistro, "--exec", "cp", (Convert-ToWslPath $cached), "$buildCache/AppRun")
                }
            }
        }
    }

    # GetNewClosure captures this function's locals only, so the script-scope
    # -WslDistro parameter has to be copied into a local first: referencing it
    # directly inside the closure passes an empty distro name to wsl.exe
    # (WSL_E_DISTRO_NOT_FOUND).
    $distro = $WslDistro
    # The retry action runs inside a GetNewClosure()-backed dynamic module.
    # Windows PowerShell 5.1 does not resolve script-scope functions there,
    # so capture Invoke-Wsl explicitly instead of calling it by name.
    $invokeWsl = (Get-Command Invoke-Wsl -CommandType Function).ScriptBlock

    # The linuxdeploy/plugin downloads inside WSL still fail occasionally even
    # when pre-cached under a different name; one retry rides out the flake.
    $attempt = 0
    $maxAttempts = 2
    while ($true) {
        $attempt++
        try {
            Invoke-Step -Name "cargo tauri build in WSL ($WslDistro, attempt $attempt)" -Action {
                & $invokeWsl @("-d", $distro, "--", "bash", "-lc", $wslCommand)
            }.GetNewClosure()
            break
        } catch {
            if ($attempt -ge $maxAttempts) { throw }
            Write-Host "  transient WSL build failure, retrying: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    }
}

function Get-JdkMajorVersion {
    param([Parameter(Mandatory)][string]$JdkHome)

    $releaseFile = Join-Path $JdkHome "release"
    if (-not (Test-Path $releaseFile)) { return 0 }

    $line = Get-Content -LiteralPath $releaseFile |
        Where-Object { $_ -like 'JAVA_VERSION=*' } |
        Select-Object -First 1
    if ($line -match '"(\d+)') { return [int]$Matches[1] }

    return 0
}

function Get-AndroidToolchain {
    # Resolves the Android SDK / NDK / JDK locations from the parameters, the
    # environment and the common local installation paths. Gradle rejects
    # anything below JDK 17, so an old JAVA_HOME (e.g. a system JDK 11) is
    # skipped in favour of the next candidate.
    $sdk = if ($AndroidSdkHome) { $AndroidSdkHome }
        elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME }
        else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
    if (-not (Test-Path (Join-Path $sdk "cmdline-tools"))) {
        throw "Android SDK not found at '$sdk'. Install the cmdline-tools or pass -AndroidSdkHome."
    }

    $ndkRoot = Join-Path $sdk "ndk"
    $ndk = if (Test-Path (Join-Path $ndkRoot $AndroidNdkVersion)) {
        Join-Path $ndkRoot $AndroidNdkVersion
    } elseif (Test-Path $ndkRoot) {
        Get-ChildItem -LiteralPath $ndkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
    } else {
        throw "No Android NDK under '$ndkRoot'. Install one via 'sdkmanager ""ndk;$AndroidNdkVersion""'."
    }

    $jdkCandidates = @(
        $JavaHome,
        $env:JAVA_HOME,
        (Join-Path $env:USERPROFILE "tools\jdk17")
    ) + @(
        if (Test-Path "C:\Program Files\Microsoft") {
            Get-ChildItem -LiteralPath "C:\Program Files\Microsoft" -Directory -Filter "jdk-*" |
                Sort-Object Name -Descending |
                Select-Object -ExpandProperty FullName
        }
    )

    $jdk = $null
    foreach ($candidate in $jdkCandidates) {
        if (-not $candidate -or -not (Test-Path (Join-Path $candidate "bin\java.exe"))) { continue }
        if ((Get-JdkMajorVersion $candidate) -ge 17) {
            $jdk = $candidate
            break
        }
    }
    if (-not $jdk) {
        throw "No JDK 17+ was found (candidates: $($jdkCandidates | Where-Object { $_ } -join ', ')). Install one or pass -JavaHome."
    }

    return @{
        Sdk = (Resolve-Path $sdk).Path
        Ndk = (Resolve-Path $ndk).Path
        Jdk = (Resolve-Path $jdk).Path
    }
}

function Build-AndroidTarget {
    # Android has no sidecar (tauri.android.conf.json empties bundle.externalBin);
    # the shell ships the two Web backends only, signed with the dev keystore.
    param(
        [Parameter(Mandatory)][string]$TargetTriple,
        [Parameter(Mandatory)]$Toolchain
    )

    $cliTarget = $TargetTriple.Split("-")[0]  # aarch64-linux-android -> aarch64

    $env:ANDROID_HOME = $Toolchain.Sdk
    $env:NDK_HOME = $Toolchain.Ndk
    $env:JAVA_HOME = $Toolchain.Jdk
    $env:PATH = "$($Toolchain.Jdk)\bin;$env:PATH"

    $androidProject = Join-Path $desktopPackage "src-tauri\gen\android"
    if (-not (Test-Path $androidProject)) {
        Invoke-Step -Name "tauri android init" -WorkingDirectory $desktopPackage -Action {
            npx tauri android init
        }
    }

    if ($portableOnly) {
        Write-Host "  (portable-only mode) Android has no local binary package; stopping after staging." -ForegroundColor DarkGray
        return
    }

    $androidArgs = @("android", "build", "--target", $cliTarget, "--apk")
    if (-not $AndroidApkOnly) { $androidArgs += "--aab" }

    Invoke-Step -Name "tauri android build ($TargetTriple, $Configuration)" -WorkingDirectory $desktopPackage -Action { npx tauri @androidArgs }.GetNewClosure()
}

function Build-iOSTarget {
    # iOS has no sidecar (tauri.ios.conf.json empties bundle.externalBin);
    # the shell ships the two Web backends only. macOS host + Xcode required;
    # the Xcode project under gen\apple is generated on first use.
    param([Parameter(Mandatory)][string]$TargetTriple)

    if ($portableOnly) {
        Write-Host "  (portable-only mode) iOS has no local binary package; stopping after staging." -ForegroundColor DarkGray
        return
    }

    $appleProject = Join-Path $desktopPackage "src-tauri\gen\apple"
    if (-not (Test-Path $appleProject)) {
        Invoke-Step -Name "tauri ios init" -WorkingDirectory $desktopPackage -Action {
            npx tauri ios init
        }
    }

    $iosArgs = @("ios", "build", "--target", $TargetTriple)
    if ($IosExportMethod) { $iosArgs += @("--export-method", $IosExportMethod) }
    if ($Configuration -eq "Debug") { $iosArgs += "--debug" }

    Invoke-Step -Name "tauri ios build ($TargetTriple, $Configuration)" -WorkingDirectory $desktopPackage -Action { npx tauri @iosArgs }.GetNewClosure()
}

# ---------------------------------------------------------------------------
# Shared front matter done, now the per-target pipeline.
# ---------------------------------------------------------------------------

$archivedAny = $false
$finalPortable = $null
$finalPortableTriple = $null
$skippedTargets = [System.Collections.Generic.List[string]]::new()

foreach ($current in $tripleList) {
    $isAndroid = $current -like "*-android"
    $isIOS = $current -like "*apple-ios*"     # device (aarch64-apple-ios) + simulator triples
    $isDarwin = $current -like "*-darwin"
    $isApple = $isIOS -or $isDarwin
    $isMobile = $isAndroid -or $isIOS
    # $IsMacOS is pwsh-only; Windows PowerShell 5.1 leaves it undefined, which
    # correctly reads as "not a macOS host".
    $isMacOSHost = [bool]$IsMacOS
    $isLinuxOnWindows = (-not $isAndroid) -and ($current -like "*linux-gnu") -and $hostIsWindows
    $isCrossDesktop = (-not $isMobile) -and (-not $isLinuxOnWindows) -and ($current -ne $hostTriple)

    # Toolchain detection before anything is staged or compiled for the target,
    # so an uninstalled environment skips the target instead of failing the run.
    $toolchain = $null
    $gap = @()
    if ($isApple -and -not $isMacOSHost) {
        # Hand-off: the staged tree is the deliverable and no local toolchain is
        # involved (see below).
    }
    elseif ($isIOS) {
        if (-not (Test-ToolchainCommand -Name @("xcodebuild"))) {
            $gap = @("Xcode (xcodebuild)")
        }
    }
    elseif ($isAndroid) {
        # Get-AndroidToolchain names the first missing piece in its message.
        try { $toolchain = Get-AndroidToolchain } catch { $gap = @($_.Exception.Message) }
    }
    elseif ($isLinuxOnWindows) {
        $gap = Get-WslToolchainGap -TargetTriple $current
    }
    else {
        $gap = Get-DesktopToolchainGap -TargetTriple $current -IsCrossBuild $isCrossDesktop
    }

    if ($gap.Count -gt 0) {
        Write-Host ""
        Write-Warning "Skipping ${current}: $($gap -join '; ')."
        $skippedTargets.Add($current)
        continue
    }

    Stage-Target -TargetTriple $current

    # Apple bundles need macOS tooling (Xcode, hdiutil); from any other host
    # the staged tree is the deliverable, handed off to a macOS runner.
    if ($isApple -and -not $isMacOSHost) {
        Write-Host ""
        Write-Host "runhost\playground is staged for $current. Apple bundles need a macOS host" -ForegroundColor Green
        Write-Host "(Xcode): finish there with this same script (-BundleTargets ...) or run" -ForegroundColor Green
        Write-Host "'npx tauri build' / 'npx tauri ios build' in the package directory." -ForegroundColor Green
        continue
    }

    if ($isIOS) {
        Build-iOSTarget -TargetTriple $current
    } elseif ($isAndroid) {
        Build-AndroidTarget -TargetTriple $current -Toolchain $toolchain
    } elseif ($isLinuxOnWindows) {
        Build-LinuxViaWsl -TargetTriple $current
    } else {
        Build-DesktopTarget -TargetTriple $current -IsCrossBuild $isCrossDesktop
    }

    # Tauri writes the bundles under target\<triple>\<profile>\bundle\ for a
    # cross build and target\<profile>\bundle\ otherwise; the cargo profile
    # directory is lower case.
    $buildProfile = if ($Configuration -eq "Debug") { "debug" } else { "release" }
    $targetDir = if ($isCrossDesktop) { "src-tauri\target\$current\$buildProfile" } else { "src-tauri\target\$buildProfile" }
    $bundleOutput = Join-Path $desktopPackage "$targetDir\bundle"

    # Portable executable in the staging root, next to the sidecars (bin\) and
    # the resource payload (resources\) it resolves at runtime. On Windows the
    # Tauri resource directory is the directory of the executable (tauri-utils
    # platform.rs) and resolve_sidecar probes <resource_dir>\bin, so this copy
    # runs in place - no installer and no environment variable required.
    # The Linux binary built in WSL is portable too: the resolver probes
    # <exe>/bin and <exe>/<relative> directly (Linux has no exe-relative
    # resource fallback), so it runs from WSL exactly like the Windows
    # portable. macOS has no equivalent portable shape (the .app/.dmg is the
    # deliverable), and mobile has no sidecar payload to run.
    if (-not $isMobile -and -not $isDarwin) {
        if ($isLinuxOnWindows) {
            $wslHome = Get-WslHome -Distro $WslDistro
            # Host builds emit target/<profile>/, cross builds target/<triple>/<profile>/.
            $wslBinary = if ($current -eq "x86_64-unknown-linux-gnu") {
                "$wslHome/tauri-target/$buildProfile/smallbasic-playground-desktop"
            } else {
                "$wslHome/tauri-target/$current/$buildProfile/smallbasic-playground-desktop"
            }
            Invoke-Wsl @("-d", $WslDistro, "--exec", "test", "-f", $wslBinary)
            if ($LASTEXITCODE -ne 0) {
                throw "The Linux application binary was not produced in WSL: $wslBinary"
            }

            $windowsPath = Join-Path $env:TEMP "smallbasic-linux-portable"
            Invoke-Wsl @("-d", $WslDistro, "--exec", "cp", $wslBinary, (Convert-ToWslPath $windowsPath))
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to copy the Linux application binary out of WSL: $wslBinary"
            }

            $portableBinary = Join-Path $stageRoot "SmallBasic.Playground"
            Invoke-Step -Name "Copy the portable executable into runhost\playground ($current)" -Action {
                Move-Item -LiteralPath $windowsPath -Destination $portableBinary -Force
            }
            # drvfs mounts without metadata report 0777 anyway; with metadata
            # enabled the exec bit must be set explicitly.
            Invoke-Wsl @("-d", $WslDistro, "--exec", "chmod", "+x", (Convert-ToWslPath $portableBinary))
            # Self-contained portable: place the Linux sidecar next to the ELF
            # (resolve_sidecar probes <exe>/<name> first). The staging root
            # holds ONE target's bin\ at a time, so a later win-x64 re-stage
            # would otherwise leave the Linux binary without its CLI backend.
            $linuxSidecar = Join-Path $stageRoot "bin\smallbasic-csharp-net8-$current"
            if (Test-Path $linuxSidecar) {
                Invoke-Step -Name "Copy the Linux sidecar next to the portable executable ($current)" -Action {
                    Copy-Item -LiteralPath $linuxSidecar -Destination (Join-Path $stageRoot "smallbasic-csharp-net8-$current") -Force
                }.GetNewClosure()
            } else {
                Write-Warning "No Linux sidecar staged (bin\smallbasic-csharp-net8-$current); the portable binary will offer the Web backends only."
            }
        } else {
            $exeSuffix = if ($current -like "*windows*") { ".exe" } else { "" }
            $appBinary = Join-Path $desktopPackage "$targetDir\smallbasic-playground-desktop$exeSuffix"
            if (-not (Test-Path $appBinary)) {
                throw "The desktop application binary was not produced: $appBinary"
            }

            $portableBinary = Join-Path $stageRoot "SmallBasic.Playground$exeSuffix"
            Invoke-Step -Name "Copy the portable executable into runhost\playground ($current)" -Action {
                Copy-Item -LiteralPath $appBinary -Destination $portableBinary -Force
            }
        }
        $finalPortable = $portableBinary
        $finalPortableTriple = $current
    }

    if ($portableOnly) {
        Write-Host ""
        if (-not $isMobile -and -not $isDarwin) {
            $modeLabel = if ($StageOnly) { "-StageOnly" } else { "default portable-only mode" }
            Write-Host "Local binary ready for $current ($modeLabel); no installers were bundled." -ForegroundColor Green
        } elseif ($isDarwin) {
            Write-Host "Local macOS app build ready for $current; no installers were bundled." -ForegroundColor Green
        } else {
            Write-Host "Staging ready for $current; no installers were bundled." -ForegroundColor Green
        }
        continue
    }

    # --- Collect + archive the installers of this target ---------------------
    $installers = @()

    if ($isAndroid) {
        $outputs = Join-Path $desktopPackage "src-tauri\gen\android\app\build\outputs"
        $androidArtifacts = @(
            @{ Path = Join-Path $outputs "apk\universal\release\app-universal-release.apk"; Extension = ".apk" }
        )
        if (-not $AndroidApkOnly) {
            $androidArtifacts += @{ Path = Join-Path $outputs "bundle\universalRelease\app-universal-release.aab"; Extension = ".aab" }
        }
        foreach ($artifact in $androidArtifacts) {
            if (-not (Test-Path $artifact.Path)) {
                throw "The Android $($artifact.Extension) artifact was not produced: $($artifact.Path)"
            }

            $installers += @{
                Source   = $artifact.Path
                FileName = "SmallBasic.Playground-$version-$current$($artifact.Extension)"
            }
        }
    } elseif ($isLinuxOnWindows) {
        # Real WSL paths (resolved via Get-WslHome) passed through `wsl --exec`,
        # which hands each argument to exec directly - no shell, no quoting.
        # Host builds bundle under target/release/, cross builds under
        # target/<triple>/release/.
        $wslHome = Get-WslHome -Distro $WslDistro
        $wslBundleDir = if ($current -eq "x86_64-unknown-linux-gnu") {
            "$wslHome/tauri-target/release/bundle"
        } else {
            "$wslHome/tauri-target/$current/release/bundle"
        }
        # deb/rpm encode the architecture in their file names.
        $debArch = if ($current -like "aarch64*") { "arm64" } else { "amd64" }
        $rpmArch = if ($current -like "aarch64*") { "aarch64" } else { "x86_64" }
        # AppImage bundling needs the architecture-matching linuxdeploy tool,
        # which only exists for x86_64; arm64 keeps deb/rpm only.
        $linuxArtifacts = @(
            @{ Wsl = "$wslBundleDir/deb/Small Basic Playground_$($version)_$debArch.deb"; Extension = ".deb" },
            @{ Wsl = "$wslBundleDir/rpm/Small Basic Playground-$version-1.$rpmArch.rpm"; Extension = ".rpm" }
        )
        if ($current -eq "x86_64-unknown-linux-gnu") {
            $linuxArtifacts += @{ Wsl = "$wslBundleDir/appimage/Small Basic Playground_$($version)_amd64.AppImage"; Extension = ".AppImage" }
        }
        foreach ($artifact in $linuxArtifacts) {
            Invoke-Wsl @("-d", $WslDistro, "--exec", "test", "-f", $artifact.Wsl)
            if ($LASTEXITCODE -ne 0) {
                throw "The Linux $($artifact.Extension) bundle was not produced: $($artifact.Wsl)"
            }

            $windowsPath = Join-Path $env:TEMP ("smallbasic-linux-bundle" + $artifact.Extension)
            Invoke-Wsl @("-d", $WslDistro, "--exec", "cp", $artifact.Wsl, (Convert-ToWslPath $windowsPath))
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to copy the Linux $($artifact.Extension) bundle out of WSL: $($artifact.Wsl)"
            }

            $installers += @{
                Source   = $windowsPath
                FileName = "SmallBasic.Playground-$version-$current$($artifact.Extension)"
            }
        }
    } elseif ($isDarwin) {
        $dmgDir = Join-Path $bundleOutput "dmg"
        if (-not (Test-Path $dmgDir)) {
            throw "The macOS dmg bundle directory was not produced: $dmgDir"
        }

        $dmgs = @(
            Get-ChildItem -LiteralPath $dmgDir -File -Filter "*.dmg" |
                Where-Object { $_.Name -like "*$version*" }
        )
        if ($dmgs.Count -ne 1) {
            throw "Expected exactly one '.dmg' installer for version $version in '$dmgDir', found $($dmgs.Count). Remove the stale files from that folder and build again."
        }

        $installers += @{
            Source   = $dmgs[0].FullName
            FileName = "SmallBasic.Playground-$version-$current.dmg"
        }
    } elseif ($isIOS) {
        # Simulator triples (aarch64-apple-ios-sim, x86_64-apple-ios) build an
        # .app for the simulator but export no .ipa; only the device triple
        # archives.
        if ($current -ne "aarch64-apple-ios") {
            Write-Host "  ($current) simulator builds export no .ipa; skipping the archive." -ForegroundColor DarkGray
            continue
        }

        $ipaDir = Join-Path $desktopPackage "src-tauri\gen\apple\build"
        $ipas = @()
        if (Test-Path $ipaDir) {
            $ipas = @(
                Get-ChildItem -LiteralPath $ipaDir -Recurse -File -Filter "*.ipa" |
                    Sort-Object LastWriteTime -Descending
            )
        }
        if ($ipas.Count -eq 0) {
            throw "No .ipa was produced under '$ipaDir'. Exporting an .ipa requires iOS signing (Xcode: select a development team; see -IosExportMethod)."
        }
        if ($ipas.Count -gt 1) {
            Write-Warning "Multiple .ipa files under '$ipaDir'; archiving the newest ($($ipas[0].Name))."
        }

        $installers += @{
            Source   = $ipas[0].FullName
            FileName = "SmallBasic.Playground-$version-$current.ipa"
        }
    } else {
        foreach ($entry in @(
            @{ Dir = "msi";  Suffix = "";       Extension = ".msi" },
            @{ Dir = "nsis"; Suffix = "-setup"; Extension = ".exe" }
        )) {
            $directory = Join-Path $bundleOutput $entry.Dir
            if (-not (Test-Path $directory)) { continue }

            # Only this version's installer: an earlier build leaves its own file
            # in the same folder, and archiving that one would ship a stale
            # package under the new name.
            $installerMatches = @(
                Get-ChildItem -LiteralPath $directory -File -Filter "*$($entry.Extension)" |
                    Where-Object { $_.Name -like "*_$version*" }
            )
            if ($installerMatches.Count -ne 1) {
                throw "Expected exactly one '$($entry.Extension)' installer for version $version in '$directory', found $($installerMatches.Count). Remove the stale files from that folder and build again."
            }

            $installers += @{
                Source   = $installerMatches[0].FullName
                FileName = "SmallBasic.Playground-$version-$current$($entry.Suffix)$($entry.Extension)"
            }
        }
    }

    if ($installers.Count -eq 0) {
        throw "No installers were produced for $current. Check the build output above."
    }

    if ($SkipArchive) {
        Write-Host ""
        Write-Host "Installers produced for $current (-SkipArchive, nothing copied):" -ForegroundColor Green
        foreach ($installer in $installers) {
            Write-Host "  $($installer.Source)"
        }
        continue
    }

    Invoke-Step -Name "Archive installers into runhost\playground\bundles ($current)" -Action {
        New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null

        # bundles\ accumulates every target of a release (see -BundleTargets), so
        # the cleanup matches on the version segment only: packages of older
        # versions are removed, while same-version packages of other targets and
        # any unrelated files are kept.
        $stalePackages = @(
            Get-ChildItem -LiteralPath $bundleRoot -File |
                Where-Object { $_.Name -like "SmallBasic.Playground-*" -and $_.Name -notlike "SmallBasic.Playground-$version-*" }
        )
        foreach ($stalePackage in $stalePackages) {
            Write-Host "Removing stale package: $($stalePackage.Name)"
            Remove-Item -LiteralPath $stalePackage.FullName -Force
        }

        foreach ($installer in $installers) {
            Copy-Item -LiteralPath $installer.Source -Destination (Join-Path $bundleRoot $installer.FileName) -Force
        }
    }
    $archivedAny = $true
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
if ($skippedTargets.Count -gt 0) {
    Write-Host "  skipped      : $($skippedTargets -join ', ') (toolchain not installed; see the warnings above)" -ForegroundColor DarkYellow
}
if ($archivedAny) {
    Write-Host "  bundles      : $bundleRoot"
    Get-ChildItem -LiteralPath $bundleRoot -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First $tripleList.Count |
        ForEach-Object { Write-Host "    $($_.Name)" }
}
if ($finalPortable) {
    Write-Host "  portable exe : $finalPortable (target: $finalPortableTriple)"
    if ($hostIsWindows -and $finalPortableTriple -like "*linux-gnu*") {
        Write-Host "    run it via WSL:"
        Write-Host "      wsl -d $WslDistro --exec $(Convert-ToWslPath $finalPortable)"
        Write-Host "    (this centers the window on screen every run:"
        Write-Host "      runhost\playground\Start-Playground-Linux.ps1 - WSLg compositor, not the app, places Wayland toplevels)"
    }
}
