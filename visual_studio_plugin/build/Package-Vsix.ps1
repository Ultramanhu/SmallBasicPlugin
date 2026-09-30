# Builds src\SmallBasic.Vsix and copies the generated VSIX v3 package into this
# folder as SmallBasic.Vsix.<version>.vsix.
#
# The RunHost distribution (runhost\Build-RunHost.ps1) is built first, because the
# VSIX bundles its payloads (C# RunHost, Blazor host, JavaScript run host and debug
# adapter). Use -SkipRunHost when the distribution is already up to date
# (Build-All.ps1 does) to avoid building it twice.
#
# Usage examples:
#   .\Package-Vsix.ps1                     # Release package
#   .\Package-Vsix.ps1 -Configuration Debug
#   .\Package-Vsix.ps1 -SkipRunHost        # reuse the existing RunHost distribution
param(
    [string]$Configuration = "Release",
    [string]$Framework = "net48",
    [string]$PackageName,
    [switch]$SkipRunHost
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $repoRoot
$projectRoot = Join-Path $repoRoot "src\SmallBasic.Vsix"

# version.json is the single source of truth shared with the VS Code extension.
# Regenerate the VSIX manifest and VersionInfo.g.cs before building.
& node (Join-Path $repositoryRoot "tools\sync-version.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Version synchronization failed with exit code $LASTEXITCODE."
}

if (-not $SkipRunHost) {
    $runHostBuildScript = Join-Path $repositoryRoot "runhost\Build-RunHost.ps1"
    if (-not (Test-Path -LiteralPath $runHostBuildScript)) {
        throw "RunHost build script not found: $runHostBuildScript"
    }

    Write-Host "Building RunHost distribution ($Configuration)..." -ForegroundColor Yellow
    & $runHostBuildScript -Configuration $Configuration
    if ($LASTEXITCODE -ne 0) {
        throw "RunHost build failed with exit code $LASTEXITCODE."
    }
}

$version = [string]((Get-Content -LiteralPath (Join-Path $repositoryRoot "version.json") -Raw | ConvertFrom-Json).version)
if ([string]::IsNullOrWhiteSpace($PackageName)) {
    $PackageName = "SmallBasic.Vsix.$version.vsix"
}

$project = Join-Path $projectRoot "SmallBasic.Vsix.csproj"
$generatedPackage = Join-Path $projectRoot (Join-Path "bin\$Configuration" (Join-Path $Framework "SmallBasic.Vsix.vsix"))
$packagePath = Join-Path $PSScriptRoot $PackageName

Write-Host "Building $project ($Configuration)..."
& dotnet build $project -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet build failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $generatedPackage)) {
    throw "Generated VSIX not found: $generatedPackage. Build SmallBasic.Vsix first."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($generatedPackage)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName })
    foreach ($requiredEntry in @("extension.vsixmanifest", "manifest.json", "catalog.json", "[Content_Types].xml")) {
        if ($entries -notcontains $requiredEntry) {
            throw "Generated VSIX is missing required v3 entry: $requiredEntry"
        }
    }

    foreach ($payloadEntry in @(
        "SmallBasic.Vsix.dll",
        "SmallBasic.Vsix.pkgdef",
        "SmallBasic.LanguageServices.dll",
        "debugadapter/adapter.js",
        "runhost/csharp/SmallBasic.RunHost.exe",
        "runhost/javascript/smallbasic-runhost.js"
    )) {
        if ($entries -notcontains $payloadEntry) {
            throw "Generated VSIX is missing required extension payload: $payloadEntry"
        }
    }

    # The in-proc compatibility parts (classifier, outlining tagger, navigation bar,
    # debug inline values and Open Folder debug target) are MEF exports compiled into
    # the extension assembly itself, which must therefore be declared as a MEF
    # component.
    $vsixManifestEntry = $archive.GetEntry("extension.vsixmanifest")
    $manifestReader = [System.IO.StreamReader]::new($vsixManifestEntry.Open())
    try {
        $vsixManifest = $manifestReader.ReadToEnd()
    }
    finally {
        $manifestReader.Dispose()
    }

    if ($vsixManifest -notmatch 'MefComponent[^>]*Path="SmallBasic\.Vsix\.dll"') {
        throw "extension.vsixmanifest does not declare SmallBasic.Vsix.dll as a MefComponent."
    }

    $manifestEntry = $archive.GetEntry("manifest.json")
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try {
        $setupManifest = $reader.ReadToEnd() | ConvertFrom-Json
    }
    finally {
        $reader.Dispose()
    }

    if ([string]::IsNullOrWhiteSpace([string]$setupManifest.vsixId) -or
        [string]::IsNullOrWhiteSpace([string]$setupManifest.extensionDir) -or
        @($setupManifest.files).Count -eq 0) {
        throw "Generated manifest.json is not a complete VSIX v3 declaration."
    }

    $bundledNode = @($entries | Where-Object { $_ -match '(^|/)(node\.exe|node_modules)(/|$)' })
    if ($bundledNode.Count -ne 0) {
        throw "The VSIX unexpectedly contains a bundled Node.js runtime: $($bundledNode -join ', ')"
    }

    if ($Configuration -eq "Release") {
        $debugSymbols = @($entries | Where-Object { $_.EndsWith(".pdb", [System.StringComparison]::OrdinalIgnoreCase) })
        if ($debugSymbols.Count -ne 0) {
            throw "The Release VSIX unexpectedly contains debug symbols: $($debugSymbols -join ', ')"
        }
    }
}
finally {
    $archive.Dispose()
}

$stalePackages = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter "SmallBasic.Vsix.*.vsix" -File)
$targetPath = [System.IO.Path]::GetFullPath($packagePath)

Copy-Item -LiteralPath $generatedPackage -Destination $packagePath -Force

if (-not (Test-Path -LiteralPath $packagePath)) {
    throw "VSIX package was not produced: $packagePath"
}

foreach ($stale in $stalePackages) {
    if ([System.IO.Path]::GetFullPath($stale.FullName) -eq $targetPath) {
        continue
    }

    Write-Host "Removing stale package: $($stale.Name)"
    Remove-Item -LiteralPath $stale.FullName -Force
}

Write-Host "Validated Visual Studio VSIX package: $packagePath"
