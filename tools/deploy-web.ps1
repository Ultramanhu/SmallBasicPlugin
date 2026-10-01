# Packs runhost/web into a tar.gz, uploads it with scp and unpacks it on a
# Linux server.
#
# The repo stores no server address, username or password:
#   1. One-time: create an SSH key and install the public key on the server
#      (run these interactively, they are never stored in the repo):
#          ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_smallbasic"
#          Get-Content "$env:USERPROFILE\.ssh\id_ed25519_smallbasic.pub" | ssh <user>@<ip> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
#   2. One-time: add a host alias to your personal ~/.ssh/config (outside the
#      repo, so it can never be committed):
#          Host smallbasic-deploy
#              HostName <ip>
#              User <user>
#              IdentityFile ~/.ssh/id_ed25519_smallbasic
#   3. Deploy:  .\tools\deploy-web.ps1 -SshHost smallbasic-deploy
#
# Without key auth the script still works, ssh/scp will just prompt for the
# password on every run; the password is typed, never stored. Do not switch to
# tools like sshpass or plink -pw, they put the password on the command line.

param(
    # SSH host alias from ~/.ssh/config, or a user@host typed ad hoc.
    [Parameter(Mandatory = $true)]
    [string]$SshHost,
    # Directory on the server to deploy into.
    [string]$RemoteDir = "/opt/smallbasic/web",
    # Local directory to pack; defaults to ..\runhost\web (resolved in the
    # body: $PSScriptRoot is empty inside param defaults when run with -File).
    [string]$WebDir
)

$ErrorActionPreference = "Stop"

if (-not $WebDir) { $WebDir = Join-Path $PSScriptRoot "..\runhost\web" }
if (-not (Test-Path $WebDir)) { throw "Web directory not found: $WebDir" }
$WebDir = (Resolve-Path $WebDir).Path

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tarPath = Join-Path ([IO.Path]::GetTempPath()) "smallbasic-web-$stamp.tar.gz"
$remoteTar = "/tmp/smallbasic-web-$stamp.tar.gz"

# Pin Windows' bundled bsdtar: a GNU tar (e.g. Git Bash's on PATH) would
# misread the "C:\..." archive path as a remote host name.
$tar = Join-Path $env:WINDIR "System32\tar.exe"

Write-Host "Packing $WebDir ..."
& $tar -czf $tarPath -C $WebDir .
if ($LASTEXITCODE -ne 0) { throw "tar failed" }

try {
    Write-Host "Uploading to ${SshHost}:$remoteTar ..."
    & scp $tarPath "${SshHost}:$remoteTar"
    if ($LASTEXITCODE -ne 0) { throw "scp failed" }

    # Unpack into a fresh .new directory and swap it in, so a half-written
    # extraction never lands in the live directory and files removed from the
    # build do not linger on the server.
    Write-Host "Unpacking into $RemoteDir ..."
    & ssh $SshHost "set -e; mkdir -p `"`$(dirname '$RemoteDir')`"; rm -rf '$RemoteDir.new'; mkdir '$RemoteDir.new'; tar -xzf '$remoteTar' -C '$RemoteDir.new'; rm -f '$remoteTar'; if [ -d '$RemoteDir' ]; then mv '$RemoteDir' '$RemoteDir.old'; fi; mv '$RemoteDir.new' '$RemoteDir'; rm -rf '$RemoteDir.old'"
    if ($LASTEXITCODE -ne 0) { throw "ssh deploy failed" }
}
finally {
    Remove-Item $tarPath -ErrorAction SilentlyContinue
}

Write-Host "Deployed $WebDir -> ${SshHost}:$RemoteDir"
