# Creates Windows shortcuts that use F1-Director.ico.
# .lnk files store absolute paths, so they are not committed; run this after clone.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ico = Join-Path $root "F1-Director.ico"
$cmd = Join-Path $root "Start-Director.cmd"
if (-not (Test-Path $ico)) { throw "Missing F1-Director.ico in $root" }
if (-not (Test-Path $cmd)) { throw "Missing Start-Director.cmd in $root" }

$wsh = New-Object -ComObject WScript.Shell
function New-DirectorShortcut([string]$path) {
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

$rootLnk = Join-Path $root "启动导播台.lnk"
$deskLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "F1 导播台.lnk"
New-DirectorShortcut $rootLnk
New-DirectorShortcut $deskLnk
Write-Host "Done. Double-click the shortcut to launch with the race-car icon."