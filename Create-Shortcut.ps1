# Creates Windows shortcuts that use F1-Director.ico.
# .lnk files store absolute paths, so they are not committed; run this after clone.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ico = Join-Path $root "F1-Director.ico"
$cmd = Join-Path $root "Start-Director.cmd"
if (-not (Test-Path $ico)) { throw "Missing F1-Director.ico in $root" }
if (-not (Test-Path $cmd)) { throw "Missing Start-Director.cmd in $root" }

$rootLnkName = ([string]::Concat([char]0x542F, [char]0x52A8, [char]0x5BFC, [char]0x64AD, [char]0x53F0, ".lnk"))
$deskLnkName = ([string]::Concat("F1 ", [char]0x5BFC, [char]0x64AD, [char]0x53F0, ".lnk"))

$wsh = New-Object -ComObject WScript.Shell
function New-DirectorShortcut([string]$path) {
  if (-not $path.EndsWith(".lnk")) { throw "Shortcut path must end with .lnk: $path" }
  if (Test-Path $path) { Remove-Item -LiteralPath $path -Force }
  $lnk = $wsh.CreateShortcut($path)
  $lnk.TargetPath = $env:ComSpec
  $lnk.Arguments = "/c `"`"$cmd`"`""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$ico,0"
  $lnk.WindowStyle = 7
  $lnk.Description = "F1 Director"
  $lnk.Save()
  Write-Host "Created $path"
}

New-DirectorShortcut (Join-Path $root $rootLnkName)
New-DirectorShortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) $deskLnkName)

# Ask Explorer to refresh icons
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ShellNotify2 {
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
  [ShellNotify2]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {}

Write-Host "Done. If the icon still looks old: F5 the folder, or sign out/in once (Windows icon cache)."