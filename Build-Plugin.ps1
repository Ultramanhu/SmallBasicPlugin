# Compiles the Small Basic plugin artifacts and verifies them.
#
# This is the build+verify entry point next to Build-All.ps1:
#
#   1. Build  - reuses Build-All.ps1 (RunHost distribution -> VS Code VSIX ->
#               Visual Studio VSIX) so the build logic lives in exactly one place.
#   2. Verify - typecheck, unit tests, Rust sidecar tests, .NET language-service
#               tests, and artifact integrity (VSIX contents, RunHost payload,
#               runhost\web required files, staged desktop playground).
#
# Every check prints a PASS / FAIL / SKIP line and the script exits non-zero if
# any required step failed, so it can gate CI or a manual release.
#
# Usage examples:
#   .\Build-Plugin.ps1                       # Release build + full verification
#   .\Build-Plugin.ps1 -SkipBuild            # verify the current artifacts only
#   .\Build-Plugin.ps1 -Configuration Debug
#   .\Build-Plugin.ps1 -StopWebServers       # stop stale runhost\web launchers (run.bat/run.ps1/serve.mjs)
#   .\Build-Plugin.ps1 -VerifyE2E            # also run the Playwright page E2E (needs a browser)
#   .\Build-Plugin.ps1 -SkipJavaScript       # forwarded to Build-All.ps1
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    # Skip the build and verify the artifacts already on disk.
    [switch]$SkipBuild,

    # Skip every verification step (build only).
    [switch]$SkipVerify,

    # Also run the Playwright page-level E2E (needs an installed browser; see
    # visual_studio_code_plugin\playwright.config.ts, SB_WEB_BROWSER=msedge).
    [switch]$VerifyE2E,

    # Stop leftover runhost\web launchers before the build. Build-RunHost.ps1
    # deletes and recreates runhost\web; a running 'node serve.mjs' keeps a file
    # handle, and 'run.bat'/'run.ps1' keep the folder as their working directory,
    # which locks the directory itself on Windows either way.
    [switch]$StopWebServers,

    # Forwarded to Build-All.ps1.
    [switch]$SkipJavaScript,
    [switch]$SkipWeb,
    [switch]$SkipVsix
)

$ErrorActionPreference = 'Stop'

# Native tools (cargo/dotnet/npm) write progress and warnings to stderr; keep
# those non-terminating so only the checked exit code decides pass/fail.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = $PSScriptRoot
$vscodeRoot = Join-Path $repoRoot 'visual_studio_code_plugin'
$runHostRoot = Join-Path $repoRoot 'runhost'
$stagedPlayground = Join-Path $runHostRoot 'playground'

$version = [string]((Get-Content -LiteralPath (Join-Path $repoRoot 'version.json') -Raw | ConvertFrom-Json).version)

$results = [System.Collections.Generic.List[object]]::new()
$failures = [System.Collections.Generic.List[string]]::new()

function Write-Section([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ===" -ForegroundColor Yellow
}

function Add-Result([string]$Name, [string]$Status, [string]$Detail = '') {
    $results.Add([pscustomobject]@{ Step = $Name; Status = $Status; Detail = $Detail })
    $color = switch ($Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'SKIP' { 'DarkGray' }
        default { 'Gray' }
    }
    $suffix = if ($Detail) { " - $Detail" } else { '' }
    Write-Host ("  [{0}] {1}{2}" -f $Status, $Name, $suffix) -ForegroundColor $color
    if ($Status -eq 'FAIL') { $failures.Add($Name) }
}

function Test-Tool([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-External([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location -LiteralPath $WorkingDirectory
    try {
        # Stream to the console and return only the exit code; without Out-Host
        # the command output would join the function's return value.
        & $Command @Arguments 2>&1 | Out-Host
        return $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}

function Invoke-Check([string]$Name, [scriptblock]$Body) {
    try {
        & $Body
        Add-Result $Name 'PASS'
    }
    catch {
        Add-Result $Name 'FAIL' $_.Exception.Message
    }
}

function Assert-FileExists([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label not found: $Path"
    }
    if ((Get-Item -LiteralPath $Path).Length -le 0) {
        throw "$Label is empty: $Path"
    }
}

function Assert-Vsix([string]$Path, [string[]]$RequiredEntries) {
    Assert-FileExists $Path 'VSIX package'
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName })
        foreach ($entry in $RequiredEntries) {
            if ($names -notcontains $entry) {
                throw "VSIX '$([IO.Path]::GetFileName($Path))' is missing entry '$entry'"
            }
        }
    }
    finally {
        $zip.Dispose()
    }
}

function Assert-Files([string]$Root, [string[]]$RelativePaths, [string]$Label) {
    foreach ($relative in $RelativePaths) {
        $full = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $full)) {
            throw "$Label is incomplete: missing $relative"
        }
    }
}

function Get-RunHostWebHolders {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProcessId -ne $PID -and $_.CommandLine -and (
                    $_.CommandLine -match 'serve\.mjs' -or
                    $_.CommandLine -match 'runhost[\\/]web'
                )
            }
    )
}

# A process whose working directory is the folder (run.bat / run.ps1) locks the
# directory itself; a rename probe detects that without destroying anything.
function Test-DirectoryLocked([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $probe = "$Path.__lockprobe"
    try {
        [System.IO.Directory]::Move($Path, $probe)
        [System.IO.Directory]::Move($probe, $Path)
        return $false
    }
    catch {
        if (Test-Path -LiteralPath $probe) {
            try { [System.IO.Directory]::Move($probe, $Path) } catch { }
        }
        return $true
    }
}

Write-Host "SmallBasic plugin build + verify ($Configuration, version $version)" -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
if ($SkipBuild) {
    Write-Section 'Build'
    Add-Result 'Build (Build-All.ps1)' 'SKIP' '-SkipBuild'
}
else {
    Write-Section 'Build'

    if (-not $SkipWeb) {
        $webRoot = Join-Path $runHostRoot 'web'
        $holders = Get-RunHostWebHolders
        if ((Test-DirectoryLocked $webRoot) -or $holders.Count -gt 0) {
            $pids = ($holders | ForEach-Object { $_.ProcessId }) -join ', '
            if ($StopWebServers) {
                if ($holders.Count -gt 0) {
                    Write-Host "Stopping $($holders.Count) runhost\web holder(s): $pids" -ForegroundColor DarkYellow
                    $holders | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
                }
                Start-Sleep -Milliseconds 800
                if (Test-DirectoryLocked $webRoot) {
                    throw "runhost\web is still locked after stopping the launchers. Close any editor/browser holding it, then retry."
                }
            }
            else {
                Write-Warning "runhost\web is in use (PID: $pids). It cannot be rebuilt while a run.bat/run.ps1/serve.mjs session is open; pass -StopWebServers or -SkipWeb."
            }
        }
    }

    $buildScript = Join-Path $repoRoot 'Build-All.ps1'
    if (-not (Test-Path -LiteralPath $buildScript)) {
        throw "Build script not found: $buildScript"
    }

    & $buildScript -Configuration $Configuration `
        -SkipJavaScript:$SkipJavaScript -SkipWeb:$SkipWeb -SkipVsix:$SkipVsix
    if ($LASTEXITCODE -ne 0) {
        throw "Build-All.ps1 failed with exit code $LASTEXITCODE."
    }

    Add-Result 'Build (Build-All.ps1)' 'PASS'
}

if ($SkipVerify) {
    Write-Host ''
    Write-Host 'Verification skipped (-SkipVerify).' -ForegroundColor DarkGray
    exit 0
}

# ---------------------------------------------------------------------------
# 2. Source-level verification
# ---------------------------------------------------------------------------
Write-Section 'Verify: source'

if (Test-Tool 'npm') {
    Invoke-Check 'TypeScript typecheck (npm run typecheck)' {
        $code = Invoke-External 'npm' @('run', 'typecheck') $vscodeRoot
        if ($code -ne 0) { throw "npm run typecheck exited with code $code" }
    }

    Invoke-Check 'Unit tests (npm test)' {
        $code = Invoke-External 'npm' @('test', '--', '--reporter=dot') $vscodeRoot
        if ($code -ne 0) { throw "npm test exited with code $code" }
    }
}
else {
    Add-Result 'TypeScript typecheck / unit tests' 'SKIP' 'npm is not on PATH'
}

$desktopSrcTauri = Join-Path $vscodeRoot 'packages\smallbasic-playground-desktop\src-tauri'
if ((Test-Tool 'cargo') -and (Test-Path -LiteralPath (Join-Path $desktopSrcTauri 'Cargo.toml'))) {
    Invoke-Check 'Rust tests (cargo test --lib)' {
        $code = Invoke-External 'cargo' @('test', '--lib') $desktopSrcTauri
        if ($code -ne 0) { throw "cargo test exited with code $code" }
    }
}
else {
    Add-Result 'Rust tests (cargo test --lib)' 'SKIP' 'cargo not available'
}

$languageServicesTests = Join-Path $repoRoot 'visual_studio_plugin\tests\SmallBasic.LanguageServices.Tests\SmallBasic.LanguageServices.Tests.csproj'
if ((Test-Tool 'dotnet') -and (Test-Path -LiteralPath $languageServicesTests)) {
    Invoke-Check '.NET language-service tests (dotnet test)' {
        $code = Invoke-External 'dotnet' @('test', $languageServicesTests, '-c', $Configuration, '--nologo') $repoRoot
        if ($code -ne 0) { throw "dotnet test exited with code $code" }
    }
}
else {
    Add-Result '.NET language-service tests (dotnet test)' 'SKIP' 'dotnet not available'
}

# ---------------------------------------------------------------------------
# 3. Artifact integrity
# ---------------------------------------------------------------------------
Write-Section 'Verify: artifacts'

if (-not $SkipVsix) {
    Invoke-Check 'VS Code VSIX' {
        Assert-Vsix (Join-Path $vscodeRoot "build\SmallBasic.VSCode-$version.vsix") @(
            'extension/package.json',
            'extension/dist/extension.js'
        )
    }

    Invoke-Check 'Visual Studio VSIX' {
        Assert-Vsix (Join-Path $repoRoot "visual_studio_plugin\build\SmallBasic.Vsix.$version.vsix") @(
            'extension.vsixmanifest'
        )
    }
}
else {
    Add-Result 'VSIX packages' 'SKIP' '-SkipVsix'
}

$runHostEntries = [System.Collections.Generic.List[string]]::new()
$runHostEntries.Add('net48\SmallBasic.RunHost.exe')
$runHostEntries.Add('net8.0-windows\SmallBasic.RunHost.exe')
$runHostEntries.Add('net8.0\SmallBasic.RunHost.dll')
$runHostEntries.Add('blazor\SmallBasic.Blazor.RunHost.dll')
if (-not $SkipJavaScript) { $runHostEntries.Add('javascript\smallbasic-runhost.js') }

Invoke-Check 'RunHost distribution' {
    Assert-Files $runHostRoot @($runHostEntries) 'RunHost distribution'
}

if (-not $SkipWeb) {
    Invoke-Check 'runhost\web static site' {
        Assert-Files (Join-Path $runHostRoot 'web') @(
            'index.html',
            'runhost.html',
            'playground.html',
            'playground.js',
            'shell-core.js',
            'smallbasic-js.js',
            'samples\index.json',
            'editor\editor.worker.js',
            'editor\language.worker.js',
            'editor\onig.wasm',
            '_framework\blazor.webassembly.js'
        ) 'runhost\web'
    }
}
else {
    Add-Result 'runhost\web static site' 'SKIP' '-SkipWeb'
}

# The desktop (Tauri) playground is an optional artifact: it is staged by
# packages\smallbasic-playground-desktop and gitignored.
$stagedManifest = Join-Path $stagedPlayground 'manifest.json'
if (Test-Path -LiteralPath $stagedManifest) {
    Invoke-Check 'Staged desktop playground' {
        $manifest = Get-Content -LiteralPath $stagedManifest -Raw | ConvertFrom-Json
        $triple = [string]$manifest.targetTriple
        if (-not $triple) { throw 'manifest.json has no targetTriple' }
        Assert-FileExists (Join-Path $stagedPlayground 'app\desktop.js') 'staged desktop bridge'

        $suffix = if ($triple -like '*windows*') { '.exe' } else { '' }
        foreach ($base in @('smallbasic-node', 'smallbasic-csharp', 'smallbasic-blazor')) {
            $sidecar = Join-Path $stagedPlayground "bin\$base-$triple$suffix"
            if (-not (Test-Path -LiteralPath $sidecar)) {
                throw "staged sidecar missing for ${triple}: $base-$triple$suffix"
            }
        }
    }
}
else {
    Add-Result 'Staged desktop playground' 'SKIP' 'not staged (run npm run stage in smallbasic-playground-desktop)'
}

# ---------------------------------------------------------------------------
# 4. Optional page-level E2E
# ---------------------------------------------------------------------------
if ($VerifyE2E) {
    Write-Section 'Verify: end-to-end'
    Invoke-Check 'Playwright page E2E' {
        $code = Invoke-External 'npx' @('playwright', 'test', 'tests/webview/runhost-web.spec.ts', '--reporter=list') $vscodeRoot
        if ($code -ne 0) { throw "playwright exited with code $code" }
    }
}
else {
    Add-Result 'Playwright page E2E' 'SKIP' 'pass -VerifyE2E to include'
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Section 'Summary'
$results | Format-Table -AutoSize Step, Status, Detail | Out-String | Write-Host

if ($failures.Count -gt 0) {
    Write-Host "FAILED: $($failures.Count) step(s): $($failures -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host 'All checks passed.' -ForegroundColor Green
exit 0
