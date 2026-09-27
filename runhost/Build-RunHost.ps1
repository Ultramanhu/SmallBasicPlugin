# Builds the SmallBasic RunHost distribution into this folder, one directory per platform:
#
#   net48/           - .NET Framework 4.8 host (Windows, WPF graphics supported)
#   net8.0-windows/  - .NET 8 host (Windows, WPF graphics supported)
#   net8.0/          - .NET 8 portable host (Windows/Linux/macOS, text-only)
#   javascript/      - Node.js host (any platform with Node >= 20, text-only)
#   blazor/           - .NET 8 + Blazor WASM host (CLI text, browser graphics)
#
# Usage examples:
#   .\Build-RunHost.ps1                                # all platforms
#   .\Build-RunHost.ps1 -DotNetPlatforms net8.0        # portable .NET 8 host only
#   .\Build-RunHost.ps1 -SkipJavaScript                # .NET hosts only
#   .\Build-RunHost.ps1 -Configuration Debug
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [ValidateSet("net48", "net8.0-windows", "net8.0")]
    [string[]]$DotNetPlatforms = @("net48", "net8.0-windows", "net8.0"),

    [switch]$SkipJavaScript,

    [switch]$Clean
)

$ErrorActionPreference = "Stop"

# This script lives inside the RunHost distribution folder it produces.
$outputRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $repoRoot "visual_studio_plugin\src\SmallBasic.RunHost\SmallBasic.RunHost.csproj"
$blazorProjectPath = Join-Path $repoRoot "visual_studio_plugin\src\SmallBasic.Blazor.RunHost\SmallBasic.Blazor.RunHost.csproj"
$vscodeRoot = Join-Path $repoRoot "visual_studio_code_plugin"
$vscodePackage = Join-Path $vscodeRoot "packages\smallbasic-vscode"

if (-not (Test-Path $projectPath)) {
    throw "RunHost project not found: $projectPath"
}

if (-not (Test-Path $blazorProjectPath)) {
    throw "Blazor RunHost project not found: $blazorProjectPath"
}

if ($Clean) {
    # Only remove generated platform folders, never the folder itself (this
    # script and future support files live here too).
    foreach ($name in @($DotNetPlatforms) + @("javascript", "blazor")) {
        $target = Join-Path $outputRoot $name
        if (Test-Path $target) {
            Remove-Item $target -Recurse -Force
        }
    }
}

$blazorDestination = Join-Path $outputRoot "blazor"
if (Test-Path $blazorDestination) {
    Remove-Item $blazorDestination -Recurse -Force
}
Write-Host "==> Publishing SmallBasic.Blazor.RunHost (net8.0, $Configuration) to $blazorDestination" -ForegroundColor Cyan
dotnet publish $blazorProjectPath -c $Configuration -f net8.0 -o $blazorDestination --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed for the Blazor RunHost"
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

foreach ($platform in $DotNetPlatforms) {
    $destination = Join-Path $outputRoot $platform
    Write-Host "==> Publishing SmallBasic.RunHost ($platform, $Configuration) to $destination" -ForegroundColor Cyan
    dotnet publish $projectPath -c $Configuration -f $platform -o $destination --nologo
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed for $platform"
    }
}

if (-not $SkipJavaScript) {
    Write-Host "==> Building JavaScript run host (tsup bundle)" -ForegroundColor Cyan
    Push-Location $vscodeRoot
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed"
        }
    }
    finally {
        Pop-Location
    }

    $bundleSource = Join-Path $vscodePackage "dist\runhost.js"
    if (-not (Test-Path $bundleSource)) {
        throw "JavaScript bundle not found: $bundleSource"
    }

    $jsDestination = Join-Path $outputRoot "javascript"
    New-Item -ItemType Directory -Force -Path $jsDestination | Out-Null
    Copy-Item $bundleSource (Join-Path $jsDestination "smallbasic-runhost.js") -Force
    Write-Host "==> JavaScript run host staged to $jsDestination" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "RunHost distribution ready under $outputRoot" -ForegroundColor Green
Write-Host "  net48            : SmallBasic.RunHost.exe (.NET Framework 4.8, Windows graphics)"
Write-Host "  net8.0-windows   : SmallBasic.RunHost.exe (.NET 8, Windows graphics)"
Write-Host "  net8.0           : SmallBasic.RunHost.dll  (.NET 8 portable: 'dotnet SmallBasic.RunHost.dll', text-only)"
Write-Host "  javascript       : smallbasic-runhost.js    ('node smallbasic-runhost.js', text-only)"
Write-Host "  blazor           : SmallBasic.Blazor.RunHost.dll ('dotnet ...', CLI text + browser graphics)"
