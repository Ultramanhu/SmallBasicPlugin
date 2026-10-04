# Builds the SmallBasic RunHost distribution into this folder, one directory per platform:
#
#   net48/           - .NET Framework 4.8 host (Windows, WPF graphics supported)
#   net8.0-windows/  - .NET 8 host (Windows, WPF graphics supported)
#   net8.0/          - .NET 8 portable host (Windows/Linux/macOS, text-only)
#   javascript/      - Node.js host (any platform with Node >= 20, text-only)
#   blazor/           - .NET 8 + Blazor WASM host (CLI text, browser graphics)
#   web/             - static site: JavaScript + Blazor WASM backends in the browser
#
# Usage examples:
#   .\Build-RunHost.ps1                                # all platforms
#   .\Build-RunHost.ps1 -DotNetPlatforms net8.0        # portable .NET 8 host only
#   .\Build-RunHost.ps1 -SkipJavaScript                # .NET hosts only
#   .\Build-RunHost.ps1 -SkipWeb                       # skip the static web distribution
#   .\Build-RunHost.ps1 -Configuration Debug
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [ValidateSet("net48", "net8.0-windows", "net8.0")]
    [string[]]$DotNetPlatforms = @("net48", "net8.0-windows", "net8.0"),

    [switch]$SkipJavaScript,

    [switch]$SkipWeb,

    [switch]$Clean
)

$ErrorActionPreference = "Stop"

# This script lives inside the RunHost distribution folder it produces.
$outputRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent $PSScriptRoot

# Shared build helpers (version handling, the web site's required-file list).
Import-Module (Join-Path $repoRoot "tools\common.psm1") -Force
$projectPath = Join-Path $repoRoot "visual_studio_plugin\src\SmallBasic.RunHost\SmallBasic.RunHost.csproj"
$blazorProjectPath = Join-Path $repoRoot "visual_studio_plugin\src\SmallBasic.Blazor.RunHost\SmallBasic.Blazor.RunHost.csproj"
$vscodeRoot = Join-Path $repoRoot "visual_studio_code_plugin"
$vscodePackage = Join-Path $vscodeRoot "packages\smallbasic-vscode"
$playgroundDist = Join-Path $vscodePackage "playground-dist"

if (-not (Test-Path $projectPath)) {
    throw "RunHost project not found: $projectPath"
}

if (-not (Test-Path $blazorProjectPath)) {
    throw "Blazor RunHost project not found: $blazorProjectPath"
}

if ($Clean) {
    # Only remove generated platform folders, never the folder itself (this
    # script and future support files live here too).
    $generatedFolders = @($DotNetPlatforms) + @("javascript", "blazor")
    if (-not $SkipWeb) {
        $generatedFolders += "web"
    }

    foreach ($name in $generatedFolders) {
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

if (-not $SkipJavaScript -or -not $SkipWeb) {
    Write-Host "==> Building VS Code browser assets" -ForegroundColor Cyan
    Push-Location $vscodeRoot
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed"
        }

        if (-not $SkipWeb) {
            npm run build:playground --workspace smallbasic-tools-vsc
            if ($LASTEXITCODE -ne 0) {
                throw "npm run build:playground failed"
            }
        }
    }
    finally {
        Pop-Location
    }
}

if (-not $SkipJavaScript) {
    $bundleSource = Join-Path $vscodePackage "dist\runhost.js"
    if (-not (Test-Path $bundleSource)) {
        throw "JavaScript bundle not found: $bundleSource"
    }

    $jsDestination = Join-Path $outputRoot "javascript"
    New-Item -ItemType Directory -Force -Path $jsDestination | Out-Null
    Copy-Item $bundleSource (Join-Path $jsDestination "smallbasic-runhost.js") -Force
    Write-Host "==> JavaScript run host staged to $jsDestination" -ForegroundColor Cyan
}

if (-not $SkipWeb) {
    # The web RunHost is the Blazor client's published wwwroot - shell page, SVG
    # rendering, WebAssembly runtime - plus the browser bundle of the JavaScript
    # backend. Whole site, no server component: any static file host works, and
    # 'node serve.mjs' is included for local use.
    $webDestination = Join-Path $outputRoot "web"
    if (Test-Path $webDestination) {
        Remove-Item $webDestination -Recurse -Force
    }

    $blazorWebRoot = Join-Path $blazorDestination "wwwroot"
    if (-not (Test-Path $blazorWebRoot)) {
        throw "Blazor publish output is missing its wwwroot folder: $blazorWebRoot"
    }

    foreach ($forbidden in @("index.html", "playground.html", "editor", "editor\onig.wasm")) {
        if (Test-Path (Join-Path $blazorWebRoot $forbidden)) {
            throw "The Blazor payload must stay a pure run-host surface, but '$forbidden' was found in $blazorWebRoot. Playground assets may only be staged into runhost/web."
        }
    }

    New-Item -ItemType Directory -Force -Path $webDestination | Out-Null
    Copy-Item (Join-Path $blazorWebRoot "*") $webDestination -Recurse -Force

    $webBundleSource = Join-Path $vscodePackage "dist\web-runhost.js"
    if (-not (Test-Path $webBundleSource)) {
        throw "SmallBasic browser JavaScript backend not found: $webBundleSource"
    }

    if (-not (Test-Path $playgroundDist)) {
        throw "Playground browser assets not found: $playgroundDist"
    }

    Copy-Item $webBundleSource (Join-Path $webDestination "smallbasic-js.js") -Force
    Copy-Item (Join-Path $playgroundDist "*") $webDestination -Recurse -Force

    # Stage the repository samples so the page can offer them in its program list
    # (samples/index.json). tools\stage-samples.mjs is the single implementation,
    # shared with the staged desktop playground.
    & node (Join-Path $repoRoot "tools\stage-samples.mjs") $webDestination
    if ($LASTEXITCODE -ne 0) {
        throw "Sample staging failed with exit code $LASTEXITCODE."
    }

    # A process that serves the previous copy (for example a running
    # 'node web\serve.mjs') keeps the old directory alive and makes the copy
    # silently land in a deleted folder; fail loudly instead. The list is the
    # shared tools\web-site-files.json (also asserted by Build-Plugin.ps1).
    foreach ($required in (Read-RequiredWebSiteFiles -RepositoryRoot $repoRoot)) {
        if (-not (Test-Path (Join-Path $webDestination $required))) {
            throw "The web RunHost is incomplete: '$required' is missing from $webDestination. Stop anything serving that folder (for example 'node serve.mjs') and build again."
        }
    }

    Write-Host "==> Web run host staged to $webDestination" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "RunHost distribution ready under $outputRoot" -ForegroundColor Green
Write-Host "  net48            : SmallBasic.RunHost.exe (.NET Framework 4.8, Windows graphics)"
Write-Host "  net8.0-windows   : SmallBasic.RunHost.exe (.NET 8, Windows graphics)"
Write-Host "  net8.0           : SmallBasic.RunHost.dll  (.NET 8 portable: 'dotnet SmallBasic.RunHost.dll', text-only)"
Write-Host "  javascript       : smallbasic-runhost.js    ('node smallbasic-runhost.js', text-only)"
Write-Host "  blazor           : SmallBasic.Blazor.RunHost.dll ('dotnet ...', CLI text + browser graphics)"
Write-Host "  web              : static site ('web\run.bat' or 'node web\serve.mjs', JavaScript + Blazor WASM backends)"
