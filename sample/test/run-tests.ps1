# Runs the self-checking unit tests in this folder on the available RunHost
# backends.
#
# Every test_*.sb file prints one "FAIL ..." line per mismatch and a final
#
#     RESULT <suite> passed=<n> failed=<n>
#
# summary line; the suite ends with Program.End() where the trailing
# "UNREACHABLE" line must never be printed. A file counts as passing when the
# process exits with 0, the summary reports "failed=0", and neither a "FAIL"
# nor an "UNREACHABLE" line shows up.
#
# Usage examples:
#   .\sample\test\run-tests.ps1                                # every detected backend
#   .\sample\test\run-tests.ps1 -Backend javascript,csharp     # pick backends
#   .\sample\test\run-tests.ps1 -Filter test_loops.sb          # a single file
#   .\sample\test\run-tests.ps1 -List                          # show what would run
#
# Backends whose tool or RunHost payload is missing are reported as SKIP, so the
# script works on a machine that only built one platform.
[CmdletBinding()]
param(
    # One or more of: javascript, csharp, blazor, windows, net48.
    [string[]]$Backend,

    [string]$Filter = "test_*.sb",

    [switch]$List
)

$ErrorActionPreference = "Stop"

$testRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $testRoot)
$runHostRoot = Join-Path $repoRoot "runhost"

function New-Backend([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$RequiredPath) {
    return [pscustomobject]@{
        Name       = $Name
        Executable = $Executable
        Arguments  = $Arguments
        Required   = $RequiredPath
    }
}

function Get-BackendDefinitions {
    $all = @(
        New-Backend "javascript" "node" @(
            (Join-Path $runHostRoot "javascript\smallbasic-runhost.js"), "run", "--file"
        ) (Join-Path $runHostRoot "javascript\smallbasic-runhost.js")
        New-Backend "csharp" "dotnet" @(
            (Join-Path $runHostRoot "net8.0\SmallBasic.RunHost.dll"), "run", "--file"
        ) (Join-Path $runHostRoot "net8.0\SmallBasic.RunHost.dll")
        New-Backend "blazor" "dotnet" @(
            (Join-Path $runHostRoot "blazor\SmallBasic.Blazor.RunHost.dll"), "run", "--file"
        ) (Join-Path $runHostRoot "blazor\SmallBasic.Blazor.RunHost.dll")
    )

    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        $all += New-Backend "windows" (Join-Path $runHostRoot "net8.0-windows\SmallBasic.RunHost.exe") @(
            "run", "--file"
        ) (Join-Path $runHostRoot "net8.0-windows\SmallBasic.RunHost.exe")
        $all += New-Backend "net48" (Join-Path $runHostRoot "net48\SmallBasic.RunHost.exe") @(
            "run", "--file"
        ) (Join-Path $runHostRoot "net48\SmallBasic.RunHost.exe")
    }

    if ($Backend) {
        $unknown = @($Backend | Where-Object { @($all.Name) -notcontains $_ })
        if ($unknown.Count -gt 0) {
            Write-Host "Unknown backend(s): $($unknown -join ', '). Known: $(@($all.Name) -join ', ')." -ForegroundColor Red
            exit 1
        }

        return @($all | Where-Object { $Backend -contains $_.Name })
    }

    # Default: every backend whose executable and payload are both present.
    return @($all | Where-Object {
            (Test-Path -LiteralPath $_.Required) -and (Get-Command $_.Executable -ErrorAction SilentlyContinue)
        })
}

function Invoke-Test([object]$Runner, [string]$File) {
    $arguments = @($Runner.Arguments) + @($File)
    $output = & $Runner.Executable @arguments 2>&1
    $exitCode = $LASTEXITCODE
    $lines = @($output | ForEach-Object { "$_" })

    $summary = $null
    $passed = 0
    $failed = 0
    foreach ($line in $lines) {
        if ($line -match '^RESULT (\S+) passed=(\d+) failed=(\d+)$') {
            $summary = $Matches[1]
            $passed = [int]$Matches[2]
            $failed = [int]$Matches[3]
        }
    }

    $problems = [System.Collections.Generic.List[string]]::new()
    if ($exitCode -ne 0) {
        $problems.Add("exit code $exitCode")
    }

    foreach ($line in $lines) {
        if ($line -like "FAIL *") {
            $problems.Add($line)
        }
        elseif ($line -like "UNREACHABLE*") {
            $problems.Add("Program.End() did not stop the program")
        }
    }

    if (-not $summary) {
        $problems.Add("no RESULT line")
    }
    elseif ($failed -ne 0) {
        $problems.Add("$failed assertion(s) failed")
    }

    return [pscustomobject]@{
        Suite   = $summary
        Passed  = $passed
        Failed  = $failed
        Output  = $lines
        Success = ($problems.Count -eq 0)
        Problems = @($problems)
    }
}

$files = @(Get-ChildItem -LiteralPath $testRoot -Filter $Filter -File | Sort-Object Name)
if ($files.Count -eq 0) {
    Write-Host "No test files match '$Filter' in $testRoot" -ForegroundColor Yellow
    exit 1
}

$runners = [object[]](Get-BackendDefinitions)

if ($List) {
    Write-Host "Test files:" -ForegroundColor Cyan
    $files | ForEach-Object { Write-Host "  $($_.Name)" }
    Write-Host "Backends:" -ForegroundColor Cyan
    $runners | ForEach-Object { Write-Host "  $($_.Name) -> $($_.Required)" }
    exit 0
}

if ($runners.Count -eq 0) {
    Write-Host "No RunHost backend is available (build runhost\ with Build-RunHost.ps1 first)." -ForegroundColor Yellow
    exit 1
}

Write-Host "SmallBasic sample unit tests ($($files.Count) file(s), $($runners.Count) backend(s))" -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"

$failures = 0
foreach ($runner in $runners) {
    Write-Host ""
    Write-Host "=== $($runner.Name) ===" -ForegroundColor Yellow
    foreach ($file in $files) {
        $result = Invoke-Test $runner $file.FullName
        if ($result.Success) {
            Write-Host ("  [PASS] {0} ({1} checks)" -f $file.Name, $result.Passed) -ForegroundColor Green
        }
        else {
            $failures++
            Write-Host ("  [FAIL] {0}" -f $file.Name) -ForegroundColor Red
            foreach ($problem in $result.Problems) {
                Write-Host ("         {0}" -f $problem) -ForegroundColor Red
            }
            if (-not $result.Suite) {
                $result.Output | Select-Object -First 10 | ForEach-Object { Write-Host ("         | {0}" -f $_) -ForegroundColor DarkGray }
            }
        }
    }
}

Write-Host ""
if ($failures -gt 0) {
    Write-Host "FAILED: $failures run(s) reported problems." -ForegroundColor Red
    exit 1
}

Write-Host "All sample unit tests passed." -ForegroundColor Green
exit 0
