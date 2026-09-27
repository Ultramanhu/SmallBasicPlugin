param(
    [string]$Configuration = "Release",
    [string]$Framework = "net48",
    [string]$PackageName = "SmallBasic.Vsix.0.1.1.vsix"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Join-Path $repoRoot "src\SmallBasic.Vsix"
$project = Join-Path $projectRoot "SmallBasic.Vsix.csproj"
$generatedPackage = Join-Path $projectRoot (Join-Path "bin\$Configuration" (Join-Path $Framework "SmallBasic.Vsix.vsix"))
$packagePath = Join-Path $PSScriptRoot $PackageName

# Always (re)build first so the generated VSIX is fresh; dotnet build is
# incremental and the target also stages RunHost + JS payloads into the VSIX.
Write-Host "Building $project ($Configuration)..."
& dotnet build $project -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet build failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $generatedPackage)) {
    throw "VSSDK-generated VSIX not found: $generatedPackage. Build SmallBasic.Vsix first."
}

# VS 18 expects a complete VSIX v3 declaration. Never recreate these files by
# hand: VSSDK's VsixUtil owns extensionDir, catalog metadata, file hashes and
# dependency projection.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($generatedPackage)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName })
    foreach ($requiredEntry in @("extension.vsixmanifest", "manifest.json", "catalog.json", "[Content_Types].xml")) {
        if ($entries -notcontains $requiredEntry) {
            throw "VSSDK-generated VSIX is missing required v3 entry: $requiredEntry"
        }
    }

    foreach ($payloadEntry in @(
        "SmallBasic.Vsix.dll",
        "SmallBasic.Vsix.pkgdef",
        "debugadapter/adapter.js",
        "runhost/SmallBasic.RunHost.exe",
        "runhost/javascript/smallbasic-runhost.js"
    )) {
        if ($entries -notcontains $payloadEntry) {
            throw "VSSDK-generated VSIX is missing required extension payload: $payloadEntry"
        }
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
        throw "VSSDK-generated manifest.json is not a complete VSIX v3 declaration."
    }

    $bundledNode = @($entries | Where-Object { $_ -match '(^|/)(node\.exe|node_modules)(/|$)' })
    if ($bundledNode.Count -ne 0) {
        throw "The VSIX unexpectedly contains a bundled Node.js runtime: $($bundledNode -join ', ')"
    }
}
finally {
    $archive.Dispose()
}

Copy-Item -LiteralPath $generatedPackage -Destination $packagePath -Force
Write-Host "Validated VSIX v3 package created by VSSDK: $packagePath"
