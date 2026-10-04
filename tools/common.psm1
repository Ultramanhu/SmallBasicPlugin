# Shared helpers of the repository build scripts. Dot-source it:
#
#   . (Join-Path $repoRoot "tools\common.psm1")
#
# version.json is the single version source of this repository (see
# tools\version.mjs); every packaging script reads it through the helpers below
# so the parsing and the sync error handling live in exactly one place.

function Get-RepoVersion {
    <# .SYNOPSIS
    Reads the repository version from version.json.#>
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    return [string]((Get-Content -LiteralPath (Join-Path $RepositoryRoot "version.json") -Raw | ConvertFrom-Json).version)
}

function Sync-RepoVersion {
    <# .SYNOPSIS
    Propagates version.json into every generated file (extension manifests,
    generated C# constant, README) via tools\sync-version.mjs.#>
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    & node (Join-Path $RepositoryRoot "tools\sync-version.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Version synchronization failed with exit code $LASTEXITCODE."
    }
}

function Read-RequiredWebSiteFiles {
    <# .SYNOPSIS
    The required files of the runhost\web static site (tools\web-site-files.json):
    written by runhost\Build-RunHost.ps1 and asserted by Build-Plugin.ps1 from
    the same list so the two cannot drift.#>
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    $manifest = Get-Content -LiteralPath (Join-Path $RepositoryRoot "tools\web-site-files.json") -Raw | ConvertFrom-Json
    return @($manifest.required)
}

Export-ModuleMember -Function @(
    "Get-RepoVersion",
    "Sync-RepoVersion",
    "Read-RequiredWebSiteFiles"
)
