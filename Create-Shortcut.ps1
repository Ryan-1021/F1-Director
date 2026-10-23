# Creates Windows shortcuts that use F1-Director.ico.
# .lnk files store absolute paths, so they are not committed; run this after clone.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ico = Join-Path $root "F1-Director.ico"
$cmd = Join-Path $root "Start-Director.cmd"
if (-not (Test-Path $ico)) { throw "Missing F1-Director.ico in $root" }
if (-not (Test-Path $cmd)) { throw "Missing Start-Director.cmd in $root" }

# 启动导播台.lnk / F1 导播台.lnk via codepoints (script stays ASCII-safe)
$rootLnkName = ([string]::Concat([char]0x542F, [char]0x52A8, [char]0x5BFC, [char]0x64AD, [char]0x53F0, ".lnk"))
$deskLnkName = ([string]::Concat("F1 ", [char]0x5BFC, [char]0x64AD, [char]0x53F0, ".lnk"))

$wsh = New-Object -ComObject WScript.Shell
function New-DirectorShortcut([string]$path) {
  if (-not $path.EndsWith(".lnk")) { throw "Shortcut path must end with .lnk: $path" }
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
Write-Host "Done. Double-click the shortcut to launch with the race-car icon."