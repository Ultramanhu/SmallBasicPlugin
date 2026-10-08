# Packages the VS Code extension into build/SmallBasic.VSCode-<version>.vsix.
#
# The build configuration is forwarded to the packaging pipeline
# (scripts/package-vsix.mjs -> scripts/stage-runhost.mjs) so the RunHost payload
# staged into the VSIX comes from the same configuration as the rest of the build.
#
# The RunHost distribution (runhost\Build-RunHost.ps1) is built first, because
# stage-runhost.mjs reads the per-configuration output under
# visual_studio_plugin/src/SmallBasic.RunHost/bin. Use -SkipRunHost when the
# distribution is already up to date (Build-All.ps1 does) to avoid building it twice.
#
# The packaged VSIX is validated against the payload boundary afterwards: every
# required RunHost entry is present, and no self-contained runtime folder, browser
# debug proxy, debug symbol or oversized payload slipped into the package.
#
# Usage examples:
#   .\Package-Vsix.ps1                     # Release package
#   .\Package-Vsix.ps1 -Configuration Debug
#   .\Package-Vsix.ps1 -SkipRunHost        # reuse the existing RunHost distribution
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [switch]$SkipRunHost
)

$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $pluginRoot

# Size budget of the packaged VSIX (extension bundles + the framework-dependent
# RunHost payload, roughly 12 MB in Release). It is a regression guard: staging a
# self-contained .NET runtime per architecture used to add ~230 MB. Raise it
# deliberately when a feature legitimately grows the package.
$maximumPackageBytes = 64MB

# The two C# hosts are framework-dependent, so `dotnet publish` without a RID
# emits them as a flat folder with nothing nested below it.
$flatHostEntryPattern = '^extension/runhost/(?:windows|portable)/.+/'

# Shared build helpers (version.json handling).
Import-Module (Join-Path $repositoryRoot "tools\common.psm1") -Force

# version.json is the single source of truth shared with the Visual Studio
# extension; refresh the derived files before building and packaging.
Sync-RepoVersion -RepositoryRoot $repositoryRoot

# scripts/stage-runhost.mjs copies the RunHost payload out of
# visual_studio_plugin/src/SmallBasic.RunHost/bin/<Configuration>, so the
# distribution has to be published for this configuration first. Build-All.ps1
# already does that as its first step and therefore passes -SkipRunHost so the
# payload is not built twice.
if (-not $SkipRunHost) {
    $runHostBuildScript = Join-Path $repositoryRoot "runhost\Build-RunHost.ps1"
    if (-not (Test-Path -LiteralPath $runHostBuildScript)) {
        throw "RunHost build script not found: $runHostBuildScript"
    }

    # -SkipJavaScript: package:vsix rebuilds dist\runhost.js and
    # dist\debug\adapter.js itself through tsup.
    Write-Host "Building RunHost distribution ($Configuration)..." -ForegroundColor Yellow
    & $runHostBuildScript -Configuration $Configuration -SkipJavaScript
    if ($LASTEXITCODE -ne 0) {
        throw "RunHost build failed with exit code $LASTEXITCODE."
    }
}

Push-Location $pluginRoot
try {
    # npm drops shell arguments when one `npm run` script invokes another, so the
    # configuration travels to package-vsix.mjs through the environment instead.
    $previousConfiguration = $env:SMALLBASIC_CONFIGURATION
    $env:SMALLBASIC_CONFIGURATION = $Configuration
    try {
        # package:vsix bundles the extension, stages the run host and runs vsce.
        npm run package:vsix
        if ($LASTEXITCODE -ne 0) {
            throw "npm run package:vsix failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        if ($null -eq $previousConfiguration) {
            Remove-Item Env:\SMALLBASIC_CONFIGURATION -ErrorAction SilentlyContinue
        }
        else {
            $env:SMALLBASIC_CONFIGURATION = $previousConfiguration
        }
    }
}
finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# Payload validation
# ---------------------------------------------------------------------------
# The final package is the only place that knows what vsce really packed, so the
# payload boundary is asserted here: everything under extension/runhost/ is
# staged by scripts/stage-runhost.mjs, and anything beyond the
# framework-dependent hosts plus the Blazor payload means a build step wrote into
# the shared bin folder - which used to add hundreds of megabytes per run.
$version = Get-RepoVersion -RepositoryRoot $repositoryRoot
$packagePath = Join-Path $PSScriptRoot "SmallBasic.VSCode-$version.vsix"
if (-not (Test-Path -LiteralPath $packagePath)) {
    throw "Packaged VSIX not found: $packagePath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName })

    foreach ($requiredEntry in @(
        'extension/package.json',
        'extension/dist/extension.js',
        'extension/dist/runhost.js',
        'extension/dist/debug/adapter.js',
        'extension/dist/web/extension.js',
        'extension/dist/web-runhost.js',
        'extension/runhost/windows/SmallBasic.RunHost.exe',
        'extension/runhost/portable/SmallBasic.RunHost.dll',
        'extension/runhost/blazor/SmallBasic.Blazor.RunHost.dll',
        'extension/runhost/blazor/wwwroot/_framework/blazor.webassembly.js'
    )) {
        if ($entries -notcontains $requiredEntry) {
            throw "VSIX '$([IO.Path]::GetFileName($packagePath))' is missing required payload: $requiredEntry"
        }
    }

    # The C# hosts are framework-dependent: `dotnet publish -f <tfm>` (no RID)
    # emits a flat folder, and that is everything the extension launches. A nested
    # entry therefore means a self-contained `dotnet publish -r <rid>` - or any
    # other publish variant - wrote into the shared bin folder
    # scripts/stage-runhost.mjs reads. That used to add a complete .NET runtime
    # per architecture (~230 MB) to the VSIX.
    $nestedHostEntries = @($entries | Where-Object { $_ -match $flatHostEntryPattern })
    if ($nestedHostEntries.Count -ne 0) {
        $sample = ($nestedHostEntries | Select-Object -First 5) -join ', '
        throw "extension/runhost/windows and extension/runhost/portable must stay flat, but the VSIX " +
            "carries $($nestedHostEntries.Count) nested entry/entries (for example $sample). Check the " +
            "publish steps writing into visual_studio_plugin/src/SmallBasic.RunHost/bin."
    }

    $debugProxy = @($entries | Where-Object { $_ -like '*BlazorDebugProxy/*' })
    if ($debugProxy.Count -ne 0) {
        throw "The VSIX carries Blazor's browser debug proxy ($($debugProxy.Count) file(s)); the extension never launches it."
    }

    if ($Configuration -eq 'Release') {
        $debugSymbols = @($entries | Where-Object { $_.EndsWith('.pdb', [System.StringComparison]::OrdinalIgnoreCase) })
        if ($debugSymbols.Count -ne 0) {
            $sample = ($debugSymbols | Select-Object -First 5) -join ', '
            throw "The Release VSIX unexpectedly contains debug symbols ($sample)."
        }
    }

    $runHostBytes = ($archive.Entries |
        Where-Object { $_.FullName -like 'extension/runhost/*' } |
        Measure-Object -Property Length -Sum).Sum
}
finally {
    $archive.Dispose()
}

$packageBytes = (Get-Item -LiteralPath $packagePath).Length
if ($packageBytes -gt $maximumPackageBytes) {
    $packageMb = [math]::Round($packageBytes / 1MB, 1)
    $budgetMb = $maximumPackageBytes / 1MB
    throw "VSIX is $packageMb MB, above the $budgetMb MB budget. Check what was staged into " +
        "extension/runhost (scripts/stage-runhost.mjs) instead of raising the budget."
}

$packageMb = [math]::Round($packageBytes / 1MB, 1)
$runHostMb = [math]::Round($runHostBytes / 1MB, 1)
Write-Host "Packaged VSIX: $packageMb MB (unpacked RunHost payload $runHostMb MB)" -ForegroundColor Green
Write-Host "Validated VS Code VSIX package: $packagePath"
