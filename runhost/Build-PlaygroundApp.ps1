# Rebuilds the Tauri desktop Playground (Small Basic Playground) and archives its
# installers, following ../docs/design/10-Playground与Tauri本地应用.md (§18.5 / §19.1):
#
#   1. npm run build                      -> visual_studio_code_plugin\packages\smallbasic-vscode\dist
#                                            (runhost.js, debug\adapter.js, web-runhost.js)
#   2. npm run build:playground           -> ...\playground-dist (Monaco page + workers)
#   3. scripts\stage-playground.mjs       -> runhost\playground\{app,resources,bin} + manifest.json
#   4. per target: tauri build / tauri android build / WSL cargo tauri build
#   5. portable exe copied to runhost\playground\SmallBasic.Playground.exe
#         (runs in place: on Windows the resource dir is the exe's directory, so
#          bin\ sidecars and resources\ resolve next to it)
#   6. installers copied to runhost\playground\bundles\
#        SmallBasic.Playground-<version>-<triple>.msi / -setup.exe / .deb / .rpm
#        / .AppImage / .apk / .aab
#
# <version> is read from version.json, the single source shared with the Visual
# Studio and VS Code extensions; tools\sync-version.mjs keeps tauri.conf.json,
# the npm package and Cargo.toml in step (Build-All.ps1 runs it automatically).
#
# Package shapes:
#   default        stage + compile + installers + archive into bundles\
#   -StageOnly     run package only: stage + compile the portable executable,
#                  no installer bundling and no bundles\ archive
#   -SkipArchive   installers are produced but stay under src-tauri\target
#
# -BundleTargets builds and archives several platforms in one run. The staging
# root holds ONE target's payloads at a time, so the last target of the list
# also determines what runhost\playground\ (portable exe, bin\, resources\) is
# left holding; the bundles\ folder accumulates every target.
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
#   android targets   need the Android SDK (platform-tools, platforms;android-34,
#                     build-tools;34.0.0, an NDK) and a JDK 17+; see
#                     -AndroidSdkHome / -JavaHome. No sidecar is bundled.
#   apple targets     cannot be bundled from Windows (Xcode); stage them for a
#                     macOS CI runner with -StageOnly instead.
#
# Usage examples (from the repository root):
#   .\runhost\Build-PlaygroundApp.ps1                     # full Release rebuild + installers (host target)
#   .\runhost\Build-PlaygroundApp.ps1 -SkipSidecars       # reuse bin\ sidecars (front-end change only)
#   .\runhost\Build-PlaygroundApp.ps1 -StageOnly          # run package only: stage + portable exe, no installers
#   .\runhost\Build-PlaygroundApp.ps1 -Target aarch64-pc-windows-msvc
#   .\runhost\Build-PlaygroundApp.ps1 -BundleTargets win-x64,win-arm64
#   .\runhost\Build-PlaygroundApp.ps1 -BundleTargets win-x64,linux-x64,android-arm64
#   .\runhost\Build-PlaygroundApp.ps1 -BundleTargets linux-x64 -WslDistro Ubuntu-22.04
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    # Rust target triple (or one of the -BundleTargets aliases). Defaults to
    # the host triple; the staged sidecars in runhost\playground\bin must match
    # it (see -SkipSidecars). Ignored when -BundleTargets is given.
    [string]$Target,

    # Reuse runhost\playground\bin sidecars instead of re-publishing the .NET
    # sidecars. Only safe when the target sidecars are already staged.
    [switch]$SkipSidecars,

    # Skip 'npm run build' (the workspace bundles in packages\smallbasic-vscode\dist).
    [switch]$SkipJavaScript,

    # Skip 'npm run build:playground' (the Monaco page bundle).
    [switch]$SkipPlaygroundBundle,

    # Run package only: assemble runhost\playground\ and compile the portable
    # executable, but do not produce or archive installers. On Android and on
    # Linux-from-Windows this stops after staging.
    [switch]$StageOnly,

    # Keep the fresh installers in src-tauri\target only (no runhost\playground\bundles copy).
    [switch]$SkipArchive,

    # One or more bundle platforms to build and archive in sequence. Accepts
    # aliases (win-x64, win-arm64, linux-x64, linux-arm64, android-arm64,
    # macos-x64, macos-arm64) or full Rust triples. Overrides -Target.
    [string[]]$BundleTargets,

    # WSL distribution used for Linux bundles when the host is Windows.
    [string]$WslDistro = "Ubuntu",

    # Android toolchain overrides; each defaults to the corresponding
    # environment variable and then to the common local installation paths.
    [string]$AndroidSdkHome,
    [string]$JavaHome,
    [string]$AndroidNdkVersion = "27.0.12077973"
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

$targetAliases = @{
    "win-x64"       = "x86_64-pc-windows-msvc"
    "win-arm64"     = "aarch64-pc-windows-msvc"
    "linux-x64"     = "x86_64-unknown-linux-gnu"
    "linux-arm64"   = "aarch64-unknown-linux-gnu"
    "android-arm64" = "aarch64-linux-android"
    "macos-x64"     = "x86_64-apple-darwin"
    "macos-arm64"   = "aarch64-apple-darwin"
}

function Resolve-TargetTriple {
    param([Parameter(Mandatory)][string]$Value)

    $alias = $targetAliases[$Value.ToLowerInvariant()]
    if ($alias) { return $alias }
    if ($Value -match '^[a-z0-9_]+-[a-z0-9_]+-[a-z0-9_]+$') { return $Value }

    throw "Unknown target '$Value'. Use an alias ($($targetAliases.Keys -join ', ')) or a full Rust triple."
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

    $home_ = [string](wsl.exe -d $Distro --exec sh -c "cd; pwd")
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

$tripleList = @()
if ($BundleTargets) {
    foreach ($entry in $BundleTargets) {
        foreach ($part in ($entry -split "[,;]")) {
            if ($part.Trim()) { $tripleList += Resolve-TargetTriple $part.Trim() }
        }
    }
} else {
    $tripleList = @(if ($Target) { Resolve-TargetTriple $Target } else { Get-HostTriple })
}
$hostTriple = Get-HostTriple
$hostIsWindows = $hostTriple -like "*windows*"

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
Write-Host "  package shape : $(if ($StageOnly) { 'run package (-StageOnly)' } elseif ($SkipArchive) { 'installers without archive (-SkipArchive)' } else { 'installers + bundles archive' })"

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
    if ($StageOnly) { $tauriArgs += "--no-bundle" }
    if ($Configuration -eq "Debug") { $tauriArgs += "--debug" }

    Invoke-Step -Name "tauri build ($TargetTriple, $Configuration)" -WorkingDirectory $desktopPackage -Action { npx @tauriArgs }.GetNewClosure()
}

function Build-LinuxViaWsl {
    # Linux bundles from a Windows host: the sidecar is cross-published on the
    # Windows side by the staging step, the GTK/webkit build happens in WSL.
    param([Parameter(Mandatory)][string]$TargetTriple)

    if (-not $hostIsWindows) {
        throw "Use the native path for Linux builds on a Linux host (this branch is Windows+WSL only)."
    }

    wsl.exe -d $WslDistro -e true 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "WSL distribution '$WslDistro' is not available. Install it or pass -WslDistro."
    }

    $toolchainCheck = 'test -x ~/.cargo/bin/cargo-tauri && test -x ~/.cargo/bin/cargo'
    wsl.exe -d $WslDistro -- bash -lc $toolchainCheck
    if ($LASTEXITCODE -ne 0) {
        throw "The WSL distro '$WslDistro' lacks the Rust toolchain or cargo-tauri. See the header of this script for setup."
    }

    $srcTauriWsl = Convert-ToWslPath (Join-Path $desktopPackage "src-tauri")
    # The compile cache stays on the ext4 filesystem: building tauri over the
    # 9p /mnt bridge is an order of magnitude slower.
    $wslCommand = "source ~/.cargo/env && export CARGO_TARGET_DIR=~/tauri-target APPIMAGE_EXTRACT_AND_RUN=1 && cd '$srcTauriWsl' && cargo tauri build"
    if ($Configuration -eq "Debug") { $wslCommand += " --debug" }

    if ($StageOnly) {
        Write-Host "  (-StageOnly) Linux run package is the staged tree; skipping the WSL compile." -ForegroundColor DarkGray
        return
    }

    # AppImage tooling: the bundler caches its copies under ~/.cache/tauri once
    # a build succeeded there, and GitHub drops connections on this network -
    # so the pre-fetch below is best effort (local cache first, warn on
    # failure) and only matters for a first-ever build.
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
    wsl.exe -d $WslDistro --exec mkdir -p $buildCache $tauriCache
    foreach ($tool in $appImageTools) {
        $cached = Join-Path $cacheDir $tool.Name
        if (Test-Path $cached) {
            wsl.exe -d $WslDistro --exec cp (Convert-ToWslPath $cached) "$tauriCache/$($tool.Name)"
            if ($tool.Name -eq "AppRun-x86_64") {
                wsl.exe -d $WslDistro --exec cp (Convert-ToWslPath $cached) "$buildCache/AppRun"
            }
        }
    }

    # The linuxdeploy/plugin downloads inside WSL still fail occasionally even
    # when pre-cached under a different name; one retry rides out the flake.
    $attempt = 0
    $maxAttempts = 2
    while ($true) {
        $attempt++
        try {
            Invoke-Step -Name "cargo tauri build in WSL ($WslDistro, attempt $attempt)" -Action {
                wsl.exe -d $WslDistro -- bash -lc $wslCommand
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

    if ($StageOnly) {
        Write-Host "  (-StageOnly) Android has no portable run package; stopping after staging." -ForegroundColor DarkGray
        return
    }

    Invoke-Step -Name "tauri android build ($TargetTriple, $Configuration)" -WorkingDirectory $desktopPackage -Action {
        npx tauri android build --target $cliTarget --apk --aab
    }.GetNewClosure()
}

# ---------------------------------------------------------------------------
# Shared front matter done, now the per-target pipeline.
# ---------------------------------------------------------------------------

$archivedAny = $false
$finalPortable = $null

foreach ($current in $tripleList) {
    $isAndroid = $current -like "*-android"
    $isLinuxOnWindows = (-not $isAndroid) -and ($current -like "*linux-gnu") -and $hostIsWindows
    $isCrossDesktop = (-not $isAndroid) -and (-not $isLinuxOnWindows) -and ($current -ne $hostTriple)

    Stage-Target -TargetTriple $current

    $toolchain = $null
    if ($isAndroid) { $toolchain = Get-AndroidToolchain }

    if ($isAndroid) {
        Build-AndroidTarget -TargetTriple $current -Toolchain $toolchain
    } elseif ($isLinuxOnWindows) {
        Build-LinuxViaWsl -TargetTriple $current
    } else {
        Build-DesktopTarget -TargetTriple $current -IsCrossBuild $isCrossDesktop
    }

    # Tauri writes the bundles under target\<triple>\<profile>\bundle\ for a
    # cross build and target\<profile>\bundle\ otherwise; the cargo profile
    # directory is lower case.
    $profile = if ($Configuration -eq "Debug") { "debug" } else { "release" }
    $targetDir = if ($isCrossDesktop) { "src-tauri\target\$current\$profile" } else { "src-tauri\target\$profile" }
    $bundleOutput = Join-Path $desktopPackage "$targetDir\bundle"

    # Portable executable in the staging root, next to the sidecars (bin\) and
    # the resource payload (resources\) it resolves at runtime. On Windows the
    # Tauri resource directory is the directory of the executable (tauri-utils
    # platform.rs) and resolve_sidecar probes <resource_dir>\bin, so this copy
    # runs in place - no installer and no environment variable required.
    if (-not $isAndroid -and -not $isLinuxOnWindows) {
        $exeSuffix = if ($current -like "*windows*") { ".exe" } else { "" }
        $appBinary = Join-Path $desktopPackage "$targetDir\smallbasic-playground-desktop$exeSuffix"
        if (-not (Test-Path $appBinary)) {
            throw "The desktop application binary was not produced: $appBinary"
        }

        $portableBinary = Join-Path $stageRoot "SmallBasic.Playground$exeSuffix"
        Invoke-Step -Name "Copy the portable executable into runhost\playground ($current)" -Action {
            Copy-Item -LiteralPath $appBinary -Destination $portableBinary -Force
        }
        $finalPortable = $portableBinary
    }

    if ($StageOnly) {
        Write-Host ""
        Write-Host "Run package ready for $current (-StageOnly); no installers were bundled." -ForegroundColor Green
        continue
    }

    # --- Collect + archive the installers of this target ---------------------
    $installers = @()

    if ($isAndroid) {
        $outputs = Join-Path $desktopPackage "src-tauri\gen\android\app\build\outputs"
        $androidArtifacts = @(
            @{ Path = Join-Path $outputs "apk\universal\release\app-universal-release.apk"; Extension = ".apk" },
            @{ Path = Join-Path $outputs "bundle\universalRelease\app-universal-release.aab"; Extension = ".aab" }
        )
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
        $wslHome = Get-WslHome -Distro $WslDistro
        $wslBundleDir = "$wslHome/tauri-target/release/bundle"
        $linuxArtifacts = @(
            @{ Wsl = "$wslBundleDir/deb/Small Basic Playground_$($version)_amd64.deb"; Extension = ".deb" },
            @{ Wsl = "$wslBundleDir/rpm/Small Basic Playground-$version-1.x86_64.rpm"; Extension = ".rpm" },
            @{ Wsl = "$wslBundleDir/appimage/Small Basic Playground_$($version)_amd64.AppImage"; Extension = ".AppImage" }
        )
        foreach ($artifact in $linuxArtifacts) {
            wsl.exe -d $WslDistro --exec test -f $artifact.Wsl
            if ($LASTEXITCODE -ne 0) {
                throw "The Linux $($artifact.Extension) bundle was not produced: $($artifact.Wsl)"
            }

            $windowsPath = Join-Path $env:TEMP ("smallbasic-linux-bundle" + $artifact.Extension)
            wsl.exe -d $WslDistro --exec cp $artifact.Wsl (Convert-ToWslPath $windowsPath)
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to copy the Linux $($artifact.Extension) bundle out of WSL: $($artifact.Wsl)"
            }

            $installers += @{
                Source   = $windowsPath
                FileName = "SmallBasic.Playground-$version-$current$($artifact.Extension)"
            }
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
            $matches = @(
                Get-ChildItem -LiteralPath $directory -File -Filter "*$($entry.Extension)" |
                    Where-Object { $_.Name -like "*_$version*" }
            )
            if ($matches.Count -ne 1) {
                throw "Expected exactly one '$($entry.Extension)' installer for version $version in '$directory', found $($matches.Count). Remove the stale files from that folder and build again."
            }

            $installers += @{
                Source   = $matches[0].FullName
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
        foreach ($installer in $installers) {
            Copy-Item -LiteralPath $installer.Source -Destination (Join-Path $bundleRoot $installer.FileName) -Force
        }
    }
    $archivedAny = $true
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
if ($archivedAny) {
    Write-Host "  bundles      : $bundleRoot"
    Get-ChildItem -LiteralPath $bundleRoot -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First $tripleList.Count |
        ForEach-Object { Write-Host "    $($_.Name)" }
}
if ($finalPortable) {
    Write-Host "  portable exe : $finalPortable (last target: $($tripleList[-1]))"
}
