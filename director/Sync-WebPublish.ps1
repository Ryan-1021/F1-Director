# Incremental publish: copy repo web sources into share/web only when content differs.
# Rule: destination file is replaced only when missing or SHA256(source) != SHA256(dest).
# Unchanged trees (especially circuits/) add no copy work on restart. layouts.json in the
# web dir is never overwritten when it already exists (Start seeds once).
# Emits NEEDS_STAMP=1 when director.html or VERSION was copied (Start.cmd / Publish-Web.cmd).
# Emits PUBLISH_CHANGED=1 when any file was copied.
# ASCII-only for Windows PowerShell 5.1.
param(
    [Parameter(Mandatory = $true)][string]$DirectorRoot,
    [Parameter(Mandatory = $true)][string]$WebDir,
    [switch]$SeedLayouts
)

$ErrorActionPreference = 'Stop'

function Get-FileSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Test-SameFile([string]$Src, [string]$Dst) {
    if (-not (Test-Path -LiteralPath $Dst)) { return $false }
    $hSrc = Get-FileSha256 $Src
    $hDst = Get-FileSha256 $Dst
    if (-not $hSrc -or -not $hDst) { return $false }
    return $hSrc -eq $hDst
}

$script:AnyChanged = $false
$script:DirectorHtmlChanged = $false
$script:VersionChanged = $false

function Sync-OneFile([string]$Src, [string]$DstRel, [switch]$TrackDirectorHtml, [switch]$TrackVersion) {
  if (-not (Test-Path -LiteralPath $Src)) { return }
  $dst = Join-Path $WebDir $DstRel
  $dir = Split-Path -Parent $dst
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  if (Test-SameFile $Src $dst) { return }
  Copy-Item -LiteralPath $Src -Destination $dst -Force
  $script:AnyChanged = $true
  if ($TrackDirectorHtml) { $script:DirectorHtmlChanged = $true }
  if ($TrackVersion) { $script:VersionChanged = $true }
}

function Sync-Tree([string]$SrcDir, [string]$DstRelDir) {
  if (-not (Test-Path -LiteralPath $SrcDir)) { return }
  $dstRoot = Join-Path $WebDir $DstRelDir
  if (-not (Test-Path -LiteralPath $dstRoot)) {
    New-Item -ItemType Directory -Path $dstRoot -Force | Out-Null
  }
  Get-ChildItem -LiteralPath $SrcDir -File -Recurse | ForEach-Object {
    $rel = $_.FullName.Substring($SrcDir.Length).TrimStart('\', '/')
    $relCombined = if ($DstRelDir) { Join-Path $DstRelDir $rel } else { $rel }
    Sync-OneFile -Src $_.FullName -DstRel $relCombined
  }
}

$dir = $DirectorRoot.TrimEnd('\', '/')
$wo = Join-Path $dir 'web-override'

if (-not (Test-Path -LiteralPath $WebDir)) {
  New-Item -ItemType Directory -Path $WebDir -Force | Out-Null
}

$rootFiles = @(
  @{ Src = (Join-Path $wo 'app.js'); Dst = 'app.js' },
  @{ Src = (Join-Path $wo 'trackmap-estimate.js'); Dst = 'trackmap-estimate.js' },
  @{ Src = (Join-Path $wo 'rank-swap.js'); Dst = 'rank-swap.js' },
  @{ Src = (Join-Path $wo 'board.html'); Dst = 'board.html' },
  @{ Src = (Join-Path $wo 'index.html'); Dst = 'index.html' },
  @{ Src = (Join-Path $wo 'style.css'); Dst = 'style.css' },
  @{ Src = (Join-Path $dir 'director.css'); Dst = 'director.css' },
  @{ Src = (Join-Path $dir 'director-app.js'); Dst = 'director-app.js' }
)
foreach ($pair in $rootFiles) {
  Sync-OneFile -Src $pair.Src -DstRel $pair.Dst
}

Sync-Tree (Join-Path $wo 'circuits') 'circuits'
Sync-Tree (Join-Path $wo 'icons') 'icons'

if (Test-Path -LiteralPath (Join-Path $wo 'favicon.ico')) {
  Sync-OneFile -Src (Join-Path $wo 'favicon.ico') -DstRel 'favicon.ico'
}
if (Test-Path -LiteralPath (Join-Path $wo 'favicon-32.png')) {
  Sync-OneFile -Src (Join-Path $wo 'favicon-32.png') -DstRel 'favicon-32.png'
}

$assets = Join-Path $dir 'assets'
Sync-Tree $assets 'assets'

$directorHtml = Join-Path $dir 'director.html'
if (Test-Path -LiteralPath $directorHtml) {
  Sync-OneFile -Src $directorHtml -DstRel 'director.html' -TrackDirectorHtml
}

$versionFile = Join-Path $dir '..\VERSION'
$versionFile = [System.IO.Path]::GetFullPath($versionFile)
if (Test-Path -LiteralPath $versionFile) {
  Sync-OneFile -Src $versionFile -DstRel 'VERSION' -TrackVersion
}

if ($SeedLayouts) {
  $layoutsSrc = Join-Path $dir 'layouts.json'
  $layoutsDst = Join-Path $WebDir 'layouts.json'
  if ((Test-Path -LiteralPath $layoutsSrc) -and -not (Test-Path -LiteralPath $layoutsDst)) {
    Copy-Item -LiteralPath $layoutsSrc -Destination $layoutsDst -Force
    $script:AnyChanged = $true
  }
}

$needsStamp = ($script:DirectorHtmlChanged -or $script:VersionChanged)
Write-Output ("PUBLISH_CHANGED={0}" -f ([int]$script:AnyChanged))
Write-Output ("NEEDS_STAMP={0}" -f ([int]$needsStamp))