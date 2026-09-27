# Packages the VS Code extension into build/SmallBasic.VSCode-<version>.vsix.
#
# The build configuration is forwarded to the packaging pipeline
# (scripts/package-vsix.mjs -> scripts/stage-runhost.mjs) so the RunHost payload
# staged into the VSIX comes from the same configuration as the rest of the build.
#
# Usage examples:
#   .\Package-Vsix.ps1                     # Release package
#   .\Package-Vsix.ps1 -Configuration Debug
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
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
