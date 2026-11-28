# Incremental publish: copy repo web sources into share/web only when content differs.
# Cheap source stamp (path + length + UTC mtime) under share/web/.publish-stamp skips the
# per-file SHA256 walk on unchanged trees; --force-publish (via Start.cmd) forces a full sync.
# director.html: compare SHA256 against the SOURCE file (sidecar), not the stamped dest copy.
# Other files: skip copy when SHA256(source) == SHA256(dest).
# Unchanged trees (especially circuits/) add no copy work on restart. layouts.json in the
# web dir is never overwritten when it already exists (Start seeds once).
# Prune dest files under mapped trees that no longer have a source path.
# Stamps share/web/director.html window title when repo VERSION exists (no-op if already current).
# Emits PUBLISH_CHANGED=1 when any file was copied or pruned.
# ASCII-only for Windows PowerShell 5.1.
param(
    [Parameter(Mandatory = $true)][string]$DirectorRoot,
    [Parameter(Mandatory = $true)][string]$WebDir,
    [switch]$SeedLayouts,
    [switch]$ForcePublish
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $WebDir)) {
    New-Item -ItemType Directory -Path $WebDir -Force | Out-Null
}
$WebDir = [System.IO.Path]::GetFullPath($WebDir)
$DirectorRoot = [System.IO.Path]::GetFullPath($DirectorRoot)

function Get-PublishStampPath([string]$Root) {
    return Join-Path $Root '.publish-stamp'
}

function Get-SourceStampLine([string]$Key, [string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $fi = Get-Item -LiteralPath $Path
    return ('{0}|{1}|{2}' -f $Key, $fi.Length, $fi.LastWriteTimeUtc.Ticks)
}

function Add-TreeStampLines {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [string]$SrcDir,
        [string]$KeyPrefix
    )
    if (-not (Test-Path -LiteralPath $SrcDir)) { return }
    $srcRoot = [System.IO.Path]::GetFullPath($SrcDir)
    Get-ChildItem -LiteralPath $srcRoot -File -Recurse | ForEach-Object {
        $rel = $_.FullName.Substring($srcRoot.Length).TrimStart('\', '/')
        $key = if ($KeyPrefix) { ($KeyPrefix + '/' + $rel) -replace '\\', '/' } else { $rel -replace '\\', '/' }
        $line = Get-SourceStampLine $key $_.FullName
        if ($line) { $Lines.Add($line) | Out-Null }
    }
}

function Get-PublishSourceStampText([string]$dir) {
    $wo = Join-Path $dir 'web-override'
    $lines = New-Object System.Collections.Generic.List[string]

    $rootPairs = @(
        @{ Key = 'app.js'; Src = (Join-Path $wo 'app.js') },
        @{ Key = 'trackmap-estimate.js'; Src = (Join-Path $wo 'trackmap-estimate.js') },
        @{ Key = 'rank-swap.js'; Src = (Join-Path $wo 'rank-swap.js') },
        @{ Key = 'board.html'; Src = (Join-Path $wo 'board.html') },
        @{ Key = 'index.html'; Src = (Join-Path $wo 'index.html') },
        @{ Key = 'style.css'; Src = (Join-Path $wo 'style.css') },
        @{ Key = 'director.css'; Src = (Join-Path $dir 'director.css') },
        @{ Key = 'director-app.js'; Src = (Join-Path $dir 'director-app.js') },
        @{ Key = 'director.html'; Src = (Join-Path $dir 'director.html') },
        @{ Key = 'layouts.json'; Src = (Join-Path $dir 'layouts.json') }
    )
    foreach ($pair in $rootPairs) {
        $line = Get-SourceStampLine $pair.Key $pair.Src
        if ($line) { $lines.Add($line) | Out-Null }
    }

    if (Test-Path -LiteralPath (Join-Path $wo 'favicon.ico')) {
        $line = Get-SourceStampLine 'favicon.ico' (Join-Path $wo 'favicon.ico')
        if ($line) { $lines.Add($line) | Out-Null }
    }
    if (Test-Path -LiteralPath (Join-Path $wo 'favicon-32.png')) {
        $line = Get-SourceStampLine 'favicon-32.png' (Join-Path $wo 'favicon-32.png')
        if ($line) { $lines.Add($line) | Out-Null }
    }

    Add-TreeStampLines $lines (Join-Path $wo 'circuits') 'circuits'
    Add-TreeStampLines $lines (Join-Path $wo 'icons') 'icons'
    Add-TreeStampLines $lines (Join-Path $dir 'assets') 'assets'

    $versionFile = [System.IO.Path]::GetFullPath((Join-Path $dir '..\VERSION'))
    if (Test-Path -LiteralPath $versionFile) {
        $line = Get-SourceStampLine 'VERSION' $versionFile
        if ($line) { $lines.Add($line) | Out-Null }
    }

    $sorted = $lines | Sort-Object
    return ($sorted -join "`n")
}

function Read-PublishSourceStamp([string]$WebRoot) {
    $path = Get-PublishStampPath $WebRoot
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    return ([System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))).Trim()
}

function Write-PublishSourceStamp([string]$WebRoot, [string]$Text) {
    $path = Get-PublishStampPath $WebRoot
    [System.IO.File]::WriteAllText($path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-SeedLayoutsOnce {
    param([string]$dir)
    $layoutsSrc = Join-Path $dir 'layouts.json'
    $layoutsDst = Join-Path $WebDir 'layouts.json'
    if ((Test-Path -LiteralPath $layoutsSrc) -and -not (Test-Path -LiteralPath $layoutsDst)) {
        Copy-Item -LiteralPath $layoutsSrc -Destination $layoutsDst -Force
        return $true
    }
    return $false
}

function Invoke-PublishWindowTitleStamp {
    param([string]$dir)
    $versionFile = Join-Path $dir '..\VERSION'
    $versionFile = [System.IO.Path]::GetFullPath($versionFile)
    $stampScript = Join-Path $dir 'Stamp-WindowTitle.ps1'
    if ((Test-Path -LiteralPath $versionFile) -and (Test-Path -LiteralPath $stampScript)) {
        & $stampScript -WebDir $WebDir -VersionFile $versionFile
    }
}

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

$script:AnyChanged = $false

function Sync-OneFile([string]$Src, [string]$DstRel, [switch]$UseSourceSidecar) {
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
}

function Sync-Tree([string]$SrcDir, [string]$DstRelDir) {
  if (-not (Test-Path -LiteralPath $SrcDir)) { return }
  $srcRoot = [System.IO.Path]::GetFullPath($SrcDir)
  $dstRoot = [System.IO.Path]::GetFullPath((Join-Path $WebDir $DstRelDir))
  if (-not (Test-Path -LiteralPath $dstRoot)) {
    New-Item -ItemType Directory -Path $dstRoot -Force | Out-Null
  }
  Get-ChildItem -LiteralPath $srcRoot -File -Recurse | ForEach-Object {
    $rel = $_.FullName.Substring($srcRoot.Length).TrimStart('\', '/')
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
  $dstRoot = [System.IO.Path]::GetFullPath((Join-Path $WebDir $DstRelDir))
  if (-not (Test-Path -LiteralPath $dstRoot)) { return }
  $srcRoot = $null
  if ($SrcDir -and (Test-Path -LiteralPath $SrcDir)) {
    $srcRoot = [System.IO.Path]::GetFullPath($SrcDir)
  }
  Get-ChildItem -LiteralPath $dstRoot -File -Recurse | ForEach-Object {
    $rel = $_.FullName.Substring($dstRoot.Length).TrimStart('\', '/')
    $relCombined = if ($DstRelDir) { Join-Path $DstRelDir $rel } else { $rel }
    $srcFile = if ($srcRoot) { Join-Path $srcRoot $rel } else { $null }
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

if (-not $ForcePublish) {
    $stampNow = Get-PublishSourceStampText $dir
    $stampWas = Read-PublishSourceStamp $WebDir
    if ($stampWas -and ($stampWas -eq $stampNow)) {
        $seeded = $false
        if ($SeedLayouts) {
            $seeded = Invoke-SeedLayoutsOnce $dir
        }
        Invoke-PublishWindowTitleStamp $dir
        $changed = [int]$seeded
        Write-Output ("PUBLISH_CHANGED={0}" -f $changed)
        Write-Output 'PUBLISH_SKIPPED=1'
        return
    }
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
  Sync-OneFile -Src $directorHtml -DstRel 'director.html' -UseSourceSidecar
}

$versionFile = Join-Path $dir '..\VERSION'
$versionFile = [System.IO.Path]::GetFullPath($versionFile)
if (Test-Path -LiteralPath $versionFile) {
  Sync-OneFile -Src $versionFile -DstRel 'VERSION'
}

if ($SeedLayouts) {
  if (Invoke-SeedLayoutsOnce $dir) { $script:AnyChanged = $true }
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

Invoke-PublishWindowTitleStamp $dir

Write-PublishSourceStamp $WebDir (Get-PublishSourceStampText $dir)

Write-Output ("PUBLISH_CHANGED={0}" -f ([int]$script:AnyChanged))