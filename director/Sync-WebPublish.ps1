# Incremental publish: copy repo web sources into share/web only when content differs.
# director.html: compare SHA256 against the SOURCE file (sidecar), not the stamped dest copy.
# Other files: skip copy when SHA256(source) == SHA256(dest).
# Unchanged trees (especially circuits/) add no copy work on restart. layouts.json in the
# web dir is never overwritten when it already exists (Start seeds once).
# Prune dest files under mapped trees that no longer have a source path.
# Emits NEEDS_STAMP=1 when director.html or VERSION was copied, or dest title is not current.
# Emits PUBLISH_CHANGED=1 when any file was copied or pruned.
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

function Get-PublishHashDir([string]$Root) {
    return Join-Path $Root '.publish-hash'
}

function Get-SourceSidecarPath([string]$Root, [string]$DstRel) {
    $safe = $DstRel -replace '[\\/]', '_'
    return Join-Path (Get-PublishHashDir $Root) ($safe + '.sha256')
}

function Read-SourceSidecarHash([string]$Root, [string]$DstRel) {
    $path = Get-SourceSidecarPath $Root $DstRel
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    return (Get-Content -LiteralPath $path -Raw).Trim()
}

function Write-SourceSidecarHash([string]$Root, [string]$DstRel, [string]$Hash) {
    $dir = Get-PublishHashDir $Root
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $path = Get-SourceSidecarPath $Root $DstRel
    [System.IO.File]::WriteAllText($path, $Hash, [System.Text.UTF8Encoding]::new($false))
}

function Test-SameFile([string]$Src, [string]$Dst) {
    if (-not (Test-Path -LiteralPath $Dst)) { return $false }
    $hSrc = Get-FileSha256 $Src
    $hDst = Get-FileSha256 $Dst
    if (-not $hSrc -or -not $hDst) { return $false }
    return $hSrc -eq $hDst
}

function Test-SamePublishedSource([string]$Src, [string]$DstRel, [string]$Dst) {
    $hSrc = Get-FileSha256 $Src
    if (-not $hSrc) { return $false }
    $stored = Read-SourceSidecarHash $WebDir $DstRel
    if ($stored -and ($stored -eq $hSrc)) { return $true }
    if (Test-SameFile $Src $Dst) {
        Write-SourceSidecarHash $WebDir $DstRel $hSrc
        return $true
    }
    return $false
}

function Get-DirectorShortVersion([string]$Raw) {
    if ($null -eq $Raw) { return '' }
    $s = $Raw.Trim().Trim([char]0xFEFF)
    $plus = $s.IndexOf([char]43) # '+'
    if ($plus -ge 0) { $s = $s.Substring(0, $plus) }
    $s = $s.Trim()
    if ($s.Length -eq 0) { return '' }
    if ($s.StartsWith('v') -or $s.StartsWith('V')) { $s = $s.Substring(1) }
    return $s
}

function Test-DirectorTitleNeedsStamp([string]$HtmlPath, [string]$VersionFile) {
    if (-not (Test-Path -LiteralPath $VersionFile)) { return $false }
    if (-not (Test-Path -LiteralPath $HtmlPath)) { return $true }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $raw = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $VersionFile), $utf8)
    $short = Get-DirectorShortVersion $raw
    if (-not $short) { return $false }
    $html = [System.IO.File]::ReadAllText($HtmlPath, $utf8)
    $open = '<title>'
    $close = '</title>'
    $start = $html.IndexOf($open)
    $end = $html.IndexOf($close)
    if ($start -lt 0 -or $end -le $start) { return $true }
    $cur = $html.Substring($start + $open.Length, $end - ($start + $open.Length))
    $suffix = ' · v' + $short
    $keep = $cur
    $marker = ' · v'
    $idx = $cur.LastIndexOf($marker)
    if ($idx -ge 0) {
        $after = $cur.Substring($idx + $marker.Length)
        if ($after.Length -gt 0 -and [char]::IsDigit($after[0])) {
            $keep = $cur.Substring(0, $idx)
        }
    }
    $expected = $keep + $suffix
    return ($cur -ne $expected)
}

$script:AnyChanged = $false
$script:DirectorHtmlChanged = $false
$script:VersionChanged = $false

function Sync-OneFile([string]$Src, [string]$DstRel, [switch]$TrackDirectorHtml, [switch]$TrackVersion, [switch]$UseSourceSidecar) {
  if (-not (Test-Path -LiteralPath $Src)) { return }
  $dst = Join-Path $WebDir $DstRel
  $dir = Split-Path -Parent $dst
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $same = $false
  if ($UseSourceSidecar) {
    $same = Test-SamePublishedSource $Src $DstRel $dst
  } else {
    $same = Test-SameFile $Src $dst
  }
  if ($same) { return }
  Copy-Item -LiteralPath $Src -Destination $dst -Force
  if ($UseSourceSidecar) {
    $hSrc = Get-FileSha256 $Src
    if ($hSrc) { Write-SourceSidecarHash $WebDir $DstRel $hSrc }
  }
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

function Remove-EmptyDirsUnder([string]$RootDir) {
  if (-not (Test-Path -LiteralPath $RootDir)) { return }
  Get-ChildItem -LiteralPath $RootDir -Directory -Recurse |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object {
      $left = Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      if (-not $left) {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      }
    }
}

function Prune-MappedDest([string]$DstRel, [string]$Src) {
  $dst = Join-Path $WebDir $DstRel
  if (-not (Test-Path -LiteralPath $dst)) { return }
  if (Test-Path -LiteralPath $Src) { return }
  Write-Host ("Prune publish: removing {0}" -f $dst)
  Remove-Item -LiteralPath $dst -Force
  if ($DstRel -ieq 'director.html') {
    $sidecar = Get-SourceSidecarPath $WebDir $DstRel
    if (Test-Path -LiteralPath $sidecar) { Remove-Item -LiteralPath $sidecar -Force }
  }
  $script:AnyChanged = $true
}

function Prune-MappedTree([string]$SrcDir, [string]$DstRelDir) {
  $dstRoot = Join-Path $WebDir $DstRelDir
  if (-not (Test-Path -LiteralPath $dstRoot)) { return }
  Get-ChildItem -LiteralPath $dstRoot -File -Recurse | ForEach-Object {
    $rel = $_.FullName.Substring($dstRoot.Length).TrimStart('\', '/')
    $relCombined = if ($DstRelDir) { Join-Path $DstRelDir $rel } else { $rel }
    $srcFile = if ($SrcDir) { Join-Path $SrcDir $rel } else { $null }
    if (-not $srcFile -or -not (Test-Path -LiteralPath $srcFile)) {
      Write-Host ("Prune publish: removing {0}" -f $_.FullName)
      Remove-Item -LiteralPath $_.FullName -Force
      $script:AnyChanged = $true
    }
  }
  Remove-EmptyDirsUnder $dstRoot
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
$pruneRootFiles = @(
  @{ Src = (Join-Path $wo 'fonts-boot.js'); Dst = 'fonts-boot.js' }
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
  Sync-OneFile -Src $directorHtml -DstRel 'director.html' -TrackDirectorHtml -UseSourceSidecar
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

foreach ($pair in ($rootFiles + $pruneRootFiles)) {
  Prune-MappedDest $pair.Dst $pair.Src
}
$pruneFaviconIco = (Join-Path $wo 'favicon.ico')
$pruneFaviconPng = (Join-Path $wo 'favicon-32.png')
Prune-MappedDest 'favicon.ico' $pruneFaviconIco
Prune-MappedDest 'favicon-32.png' $pruneFaviconPng
Prune-MappedDest 'director.html' $directorHtml
if (Test-Path -LiteralPath $versionFile) {
  Prune-MappedDest 'VERSION' $versionFile
}

Prune-MappedTree (Join-Path $wo 'circuits') 'circuits'
Prune-MappedTree (Join-Path $wo 'icons') 'icons'
Prune-MappedTree $assets 'assets'

$directorDst = Join-Path $WebDir 'director.html'
$titleNeedsStamp = Test-DirectorTitleNeedsStamp $directorDst $versionFile
$needsStamp = ($script:DirectorHtmlChanged -or $script:VersionChanged -or $titleNeedsStamp)
Write-Output ("PUBLISH_CHANGED={0}" -f ([int]$script:AnyChanged))
Write-Output ("NEEDS_STAMP={0}" -f ([int]$needsStamp))