# Launches the Linux portable Playground inside WSL and pins its window to the
# center of the primary screen.
#
# Why a launcher: under WSLg the app renders on the GTK Wayland backend, which
# gives the correct DPI scaling (the X11 backend would be stretched by the
# Windows DPI factor and look blurry). Wayland forbids clients from
# positioning their own toplevels, and Windows places each new RAIL window by
# cascading it from the previous one - so consecutive runs drift and can end
# up off-screen. This launcher starts the app and then moves the window to the
# screen center from the Windows side (Win32 SetWindowPos works on RAIL
# windows).
#
# Usage (from the repository root):
#   .\runhost\playground\Start-Playground-Linux.ps1
#   .\runhost\playground\Start-Playground-Linux.ps1 -Distro Ubuntu-22.04
#   .\runhost\playground\Start-Playground-Linux.ps1 -NoCenter   # plain launch, no move
[CmdletBinding()]
param(
    [string]$Distro = "Ubuntu",

    # The Linux portable build produced by Build-PlaygroundApp.ps1.
    # NOTE: defaulted in the body - $PSScriptRoot is not reliably set inside
    # param() default values under Windows PowerShell 5.1.
    [string]$Binary,

    # Skip the centering step (plain launch; Windows cascade placement).
    [switch]$NoCenter
)

$ErrorActionPreference = "Stop"

if (-not $Binary) {
    $Binary = Join-Path $PSScriptRoot "SmallBasic.Playground"
}

if (-not (Test-Path $Binary)) {
    throw "The Linux portable build was not found: $Binary. Build it with runhost\Build-PlaygroundApp.ps1 -LinuxTargets x64, or just run Build-All.ps1."
}

function Convert-ToWslPath {
    param([Parameter(Mandatory)][string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $drive = $full.Substring(0, 1).ToLowerInvariant()
    "/mnt/$drive" + $full.Substring(2).Replace("\", "/")
}

$wslBinary = Convert-ToWslPath $Binary
# The launch command travels as a script file: Start-Process's argument
# quoting mangles the inline `sh -c` form silently. The trailing sleep keeps
# the WSL session alive long enough for the app to detach (setsid); an
# immediately-exiting client takes the app down with it.
$launchScript = Join-Path ([System.IO.Path]::GetTempPath()) "smallbasic-playground-launch.sh"
[System.IO.File]::WriteAllText($launchScript, "setsid '$wslBinary' >/dev/null 2>&1 < /dev/null & sleep 6")
Start-Process -FilePath "wsl.exe" -ArgumentList @(
    "-d", $Distro, "--exec", "sh", (Convert-ToWslPath $launchScript)
) -WindowStyle Hidden

if ($NoCenter) {
    Write-Host "Small Basic Playground launched on $Distro (placement left to Windows)."
    return
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RailWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr hWnd, [MarshalAs(UnmanagedType.LPWStr)] StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
}
'@
[RailWindow]::SetProcessDPIAware() | Out-Null

# The RAIL window appears once WSLg has started the app (up to a cold-start VM
# boot, hence the generous deadline).
$deadline = (Get-Date).AddSeconds(45)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $script:found = [IntPtr]::Zero
    $cb = [RailWindow+EnumWindowsProc]{ param($h, $l)
        $sb = New-Object System.Text.StringBuilder 256
        [void][RailWindow]::GetWindowTextW($h, $sb, 256)
        if ($sb.ToString() -match 'Small Basic Playground') { $script:found = $h; return $false }
        return $true
    }
    [void][RailWindow]::EnumWindows($cb, [IntPtr]::Zero)
    if ($script:found -ne [IntPtr]::Zero) { $hwnd = $script:found; break }
}

if ($hwnd -eq [IntPtr]::Zero) {
    throw "The Playground window did not appear within 45s; check that WSLg is running (the app log is under runhost\playground)."
}

Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$r = New-Object 'RailWindow+RECT'

# WSLg delivers the Wayland output scale late and as an integer (a Windows
# 150% display becomes GDK scale 2): the window can grow past the physical
# screen a few seconds after it appears. Give it that time to settle, then
# decide once: center when it fits, maximize when it does not (a maximized
# RAIL window always fits the work area, and the maximized layout ends up at
# the correct DPI density).
Start-Sleep -Seconds 12
[void][RailWindow]::GetWindowRect($hwnd, [ref]$r)
$width = $r.R - $r.L
$height = $r.B - $r.T

if ($width -ge $screen.Width -or $height -ge $screen.Height) {
    [void][RailWindow]::ShowWindow($hwnd, 3)  # SW_MAXIMIZE
    Write-Host "Small Basic Playground is running on $Distro (maximized: the WSLg window scale renders it larger than the screen)."
} else {
    $x = [Math]::Max(0, [int](($screen.Width - $width) / 2))
    $y = [Math]::Max(0, [int](($screen.Height - $height) / 2))
    # SWP_NOSIZE (0x1) | SWP_NOZORDER (0x4)
    [void][RailWindow]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, 0, 0, 0x0005)
    Write-Host "Small Basic Playground is running on $Distro; window centered at ($x, $y)."
}
Write-Host "Stop it with: wsl -d $Distro --exec pkill -f SmallBasic.Playground"
