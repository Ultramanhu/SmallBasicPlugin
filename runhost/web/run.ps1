#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Serves the Small Basic web RunHost over HTTP and opens the browser.

.DESCRIPTION
    A browser refuses to load WebAssembly from file:// URLs, so the page has to be
    served over HTTP. This script starts the dependency-free server that ships with
    the distribution (serve.mjs), which also opens the default browser on Windows,
    macOS and Linux.

    Nothing about the RunHost itself needs a server: the compiler, the interpreter
    and the Blazor WebAssembly runtime all run inside the browser. The only reason
    for HTTP is that browsers refuse to load WebAssembly from file:// URLs.

    Works with PowerShell 7+ (pwsh) on Windows, Linux and macOS, and with Windows
    PowerShell 5.1 on Windows. Requires Node.js on PATH.

.PARAMETER NoOpen
    Starts the server without opening a browser.

.PARAMETER Port
    Preferred TCP port (default 8321); the next free port is used when it is busy.

.EXAMPLE
    .\run.ps1

.EXAMPLE
    .\run.ps1 -NoOpen -Port 9000
#>
[CmdletBinding()]
param(
    [switch]$NoOpen,

    [int]$Port = 0
)

$ErrorActionPreference = "Stop"

$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js is required to serve the web RunHost, but 'node' was not found on PATH." -ForegroundColor Red
    Write-Host "  Windows : winget install OpenJS.NodeJS.LTS"
    Write-Host "  macOS   : brew install node"
    Write-Host "  Linux   : install it with your package manager, or see https://nodejs.org"
    Write-Host ""
    Write-Host "Any other static file server works as well - publish this folder over HTTP."
    exit 1
}

# serve.mjs resolves its own folder, so the current directory does not matter.
$serverArguments = @((Join-Path $PSScriptRoot "serve.mjs"))
if ($NoOpen) {
    $serverArguments += "--no-open"
}

if ($Port -gt 0) {
    $serverArguments += @("--port", [string]$Port)
}

& $node.Source @serverArguments
exit $LASTEXITCODE
