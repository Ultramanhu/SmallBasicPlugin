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

# version.json is the single source of truth shared with the Visual Studio
# extension; refresh the derived files before building and packaging.
& node (Join-Path $repositoryRoot "tools\sync-version.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Version synchronization failed with exit code $LASTEXITCODE."
}

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
