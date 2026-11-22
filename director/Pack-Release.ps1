# Pack F1-Director win64 release zips (with-jre / with-minijre).
# Runs on Windows PowerShell 5.1. Does NOT create a GitHub Release.
# ASCII-only source so 5.1 parses on any code page.
param(
    [string]$DirectorRoot = '',
    [string]$OutputDir = 'D:\Develop',
    [ValidateSet('Both', 'Jre', 'MiniJre')]
    [string]$Variant = 'Both',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$MiniJreModules = @(
    'java.base',
    'jdk.crypto.ec',
    'jdk.crypto.cryptoki',
    'jdk.crypto.mscapi',
    'jdk.httpserver'
)

function Resolve-DirectorRoot {
    param([string]$Hint)
    if ($Hint -and (Test-Path -LiteralPath $Hint)) {
        return [System.IO.Path]::GetFullPath($Hint)
    }
    $fromScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $develop = 'D:\Develop\F1-Director'
    if ((Test-Path -LiteralPath $develop) -and ($fromScript -ne $develop)) {
        return [System.IO.Path]::GetFullPath($develop)
    }
    return $fromScript
}

function Get-ShortVersion {
    param([string]$VersionPath)
    if (-not (Test-Path -LiteralPath $VersionPath)) {
        throw "VERSION not found: $VersionPath"
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $raw = [System.IO.File]::ReadAllText($VersionPath, $utf8).Trim().Trim([char]0xFEFF)
    $plus = $raw.IndexOf([char]43)
    if ($plus -ge 0) { $raw = $raw.Substring(0, $plus) }
    return $raw.Trim()
}

function Assert-RobocopyOk {
    param([string]$Label)
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy $Label failed, exit $LASTEXITCODE"
    }
}

function Copy-ReleaseTree {
    param(
        [string]$RepoRoot,
        [string]$DestBundle
    )
    if (Test-Path -LiteralPath $DestBundle) {
        Remove-Item -LiteralPath $DestBundle -Recurse -Force
    }
    New-Item -ItemType Directory -Path $DestBundle -Force | Out-Null

    $rootFiles = @('.gitignore', 'LICENSE', 'README.md', 'VERSION')
    foreach ($name in $rootFiles) {
        $src = Join-Path $RepoRoot $name
        if (-not (Test-Path -LiteralPath $src)) {
            throw "Missing release root file: $src"
        }
        Copy-Item -LiteralPath $src -Destination (Join-Path $DestBundle $name) -Force
    }

    $exe = Get-ChildItem -LiteralPath $RepoRoot -File | Where-Object { $_.Extension -eq '.exe' }
    if (-not $exe -or $exe.Count -lt 1) {
        throw "Missing root launcher .exe under $RepoRoot"
    }
    foreach ($item in $exe) {
        Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $DestBundle $item.Name) -Force
    }

    $srcDirector = Join-Path $RepoRoot 'director'
    $dstDirector = Join-Path $DestBundle 'director'
    & robocopy.exe $srcDirector $dstDirector /E /NFL /NDL /NJH /NJS /NC /NS /NP /XF *.bak *.bak* | Out-Null
    Assert-RobocopyOk -Label 'director'

    $srcShare = Join-Path $RepoRoot 'share'
    $dstShare = Join-Path $DestBundle 'share'
    if (-not (Test-Path -LiteralPath $dstShare)) {
        New-Item -ItemType Directory -Path $dstShare -Force | Out-Null
    }
    Get-ChildItem -LiteralPath $srcShare -Force | ForEach-Object {
        $leaf = $_.Name
        if ($leaf -eq 'jre') { return }
        if ($leaf -like '*.bak*') { return }
        if ($_.PSIsContainer) {
            $dstLeaf = Join-Path $dstShare $leaf
            & robocopy.exe $_.FullName $dstLeaf /E /NFL /NDL /NJH /NJS /NC /NS /NP /XF *.bak *.bak* | Out-Null
            Assert-RobocopyOk -Label ("share\" + $leaf)
        } else {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dstShare $leaf) -Force
        }
    }
}

function Find-JlinkExe {
    $candidates = @(
        'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot\bin\jlink.exe',
        'C:\Program Files\Microsoft\jdk-17.0.17.10-hotspot\bin\jlink.exe',
        'C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot\bin\jlink.exe',
        'C:\Program Files\Java\jdk-17\bin\jlink.exe'
    )
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    $found = Get-ChildItem -Path 'C:\Program Files' -Filter 'jlink.exe' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'jdk-17' -and $_.FullName -notmatch '\\jre\\' } |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Copy-FullJre {
    param(
        [string]$RepoRoot,
        [string]$DestBundle
    )
    $srcJre = Join-Path $RepoRoot 'share\jre'
    if (-not (Test-Path -LiteralPath $srcJre)) {
        throw "with-jre pack needs share\jre (Temurin 17) beside the repo; keep it local, not in git."
    }
    $dstJre = Join-Path $DestBundle 'share\jre'
    & robocopy.exe $srcJre $dstJre /E /NFL /NDL /NJH /NJS /NC /NS /NP /XF *.bak *.bak* | Out-Null
    Assert-RobocopyOk -Label 'share\jre'
}

function New-MiniJre {
    param([string]$DestBundle)
    $jlink = Find-JlinkExe
    if (-not $jlink) {
        throw 'with-minijre pack needs a JDK 17 jlink.exe (not the bundled JRE). Install Microsoft Build of OpenJDK 17.'
    }
    $dstJre = Join-Path $DestBundle 'share\jre'
    if (Test-Path -LiteralPath $dstJre) {
        Remove-Item -LiteralPath $dstJre -Recurse -Force
    }
    $modArg = ($MiniJreModules -join ',')
    $args = @(
        '--add-modules', $modArg,
        '--strip-debug',
        '--no-header-files',
        '--no-man-pages',
        '--compress=2',
        '--output', $dstJre
    )
    & $jlink @args
    if ($LASTEXITCODE -ne 0) {
        throw "jlink failed, exit $LASTEXITCODE"
    }
}

function Set-ZipUtf8LanguageFlags {
    param([string]$ZipPath)
    # .NET Framework ZipFile + UTF8Encoding writes UTF-8 entry names but omits GP bit 11 (0x800).
    # Patch local headers and central directory so Windows extractors honor UTF-8 names (e.g. CJK .exe).
    $bytes = [System.IO.File]::ReadAllBytes($ZipPath)
    $len = $bytes.Length
    if ($len -lt 22) {
        throw "ZIP too small: $ZipPath"
    }
    $eocd = -1
    $scanStart = [Math]::Max(0, $len - 65557)
    for ($i = $len - 22; $i -ge $scanStart; $i--) {
        if ($bytes[$i] -eq 0x50 -and $bytes[$i + 1] -eq 0x4B -and $bytes[$i + 2] -eq 0x05 -and $bytes[$i + 3] -eq 0x06) {
            $eocd = $i
            break
        }
    }
    if ($eocd -lt 0) {
        throw "ZIP EOCD not found: $ZipPath"
    }
    $cdOffset = [BitConverter]::ToUInt32($bytes, $eocd + 16)
    $cdSize = [BitConverter]::ToUInt32($bytes, $eocd + 12)
    $cdEnd = $cdOffset + $cdSize

    $pos = 0
    while ($pos -lt $cdOffset) {
        if ($bytes[$pos] -ne 0x50 -or $bytes[$pos + 1] -ne 0x4B -or $bytes[$pos + 2] -ne 0x03 -or $bytes[$pos + 3] -ne 0x04) {
            throw "bad local file header at offset $pos in $ZipPath"
        }
        $flags = [BitConverter]::ToUInt16($bytes, $pos + 6)
        $flags = $flags -bor 0x0800
        [BitConverter]::GetBytes([uint16]$flags).CopyTo($bytes, $pos + 6)
        $fnLen = [BitConverter]::ToUInt16($bytes, $pos + 26)
        $extraLen = [BitConverter]::ToUInt16($bytes, $pos + 28)
        $compSize = [BitConverter]::ToUInt32($bytes, $pos + 18)
        $pos = $pos + 30 + $fnLen + $extraLen + $compSize
    }

    $pos = $cdOffset
    while ($pos -lt $cdEnd) {
        if ($bytes[$pos] -ne 0x50 -or $bytes[$pos + 1] -ne 0x4B -or $bytes[$pos + 2] -ne 0x01 -or $bytes[$pos + 3] -ne 0x02) {
            throw "bad central directory header at offset $pos in $ZipPath"
        }
        $flags = [BitConverter]::ToUInt16($bytes, $pos + 8)
        $flags = $flags -bor 0x0800
        [BitConverter]::GetBytes([uint16]$flags).CopyTo($bytes, $pos + 8)
        $fnLen = [BitConverter]::ToUInt16($bytes, $pos + 28)
        $extraLen = [BitConverter]::ToUInt16($bytes, $pos + 30)
        $commentLen = [BitConverter]::ToUInt16($bytes, $pos + 32)
        $pos = $pos + 46 + $fnLen + $extraLen + $commentLen
    }

    [System.IO.File]::WriteAllBytes($ZipPath, $bytes)
}

function New-Utf8ReleaseZip {
    param(
        [string]$BundleRoot,
        [string]$ZipPath,
        [string]$ZipEntryPrefix
    )
    $utf8 = New-Object System.Text.UTF8Encoding $false
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create, $utf8)
    try {
        $bundleLen = $BundleRoot.Length
        if (-not $BundleRoot.EndsWith('\')) { $bundleLen++ }
        Get-ChildItem -LiteralPath $BundleRoot -Recurse -File -Force | ForEach-Object {
            $rel = $_.FullName.Substring($bundleLen).TrimStart('\')
            $entryName = $ZipEntryPrefix + '\' + ($rel -replace '/', '\')
            $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $inStream = [System.IO.File]::OpenRead($_.FullName)
            try {
                $outStream = $entry.Open()
                try {
                    $inStream.CopyTo($outStream)
                } finally {
                    $outStream.Dispose()
                }
            } finally {
                $inStream.Dispose()
            }
        }
    } finally {
        $zip.Dispose()
    }
    Set-ZipUtf8LanguageFlags -ZipPath $ZipPath
}

function Write-ZipDigest {
    param([string]$ZipPath)
    $hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item -LiteralPath $ZipPath).Length
    Write-Host ""
    Write-Host "Wrote: $ZipPath"
    Write-Host "  size bytes: $size"
    Write-Host "  SHA-256:    $hash"
}

function Invoke-PackVariant {
    param(
        [string]$StageParent,
        [string]$BundleRoot,
        [string]$ShortVer,
        [string]$OutDir,
        [ValidateSet('Jre', 'MiniJre')]
        [string]$Kind
    )
    if ($Kind -eq 'Jre') {
        Copy-FullJre -RepoRoot $script:RepoRoot -DestBundle $BundleRoot
        $zipName = "F1-Director-v$ShortVer-with-jre-win64.zip"
    } else {
        New-MiniJre -DestBundle $BundleRoot
        $zipName = "F1-Director-v$ShortVer-with-minijre-win64.zip"
    }
    $zipPath = Join-Path $OutDir $zipName
    New-Utf8ReleaseZip -BundleRoot $BundleRoot -ZipPath $zipPath -ZipEntryPrefix 'F1-Director'
    Write-ZipDigest -ZipPath $zipPath
}

$script:RepoRoot = Resolve-DirectorRoot -Hint $DirectorRoot
$OutDirResolved = $OutputDir
if (-not (Test-Path -LiteralPath $OutDirResolved)) {
    if ($WhatIf) {
        Write-Host "WhatIf: would create output dir $OutDirResolved"
    } else {
        New-Item -ItemType Directory -Path $OutDirResolved -Force | Out-Null
    }
}

$versionFile = Join-Path $script:RepoRoot 'VERSION'
$shortVer = Get-ShortVersion -VersionPath $versionFile
Write-Host "Repo:    $script:RepoRoot"
Write-Host "Version: $shortVer"
Write-Host "Output:  $OutDirResolved"

if ($WhatIf) {
    Write-Host 'WhatIf: would run Publish-Web.cmd, stage F1-Director tree (no docs/.git/*.bak/jre), pack with UTF-8 zip flag.'
    Write-Host "WhatIf: zip names F1-Director-v$shortVer-with-jre-win64.zip and -with-minijre-win64.zip"
    return
}

$publishCmd = Join-Path $script:RepoRoot 'director\Publish-Web.cmd'
if (-not (Test-Path -LiteralPath $publishCmd)) {
    throw "Publish-Web.cmd not found: $publishCmd"
}
Write-Host 'Publishing share\web via Publish-Web.cmd ...'
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $publishCmd) -Wait -PassThru -WorkingDirectory (Join-Path $script:RepoRoot 'director')
if ($p.ExitCode -ne 0) {
    throw "Publish-Web.cmd failed, exit $($p.ExitCode)"
}

$stageParent = Join-Path $env:TEMP ('F1-Director-pack-' + [guid]::NewGuid().ToString('N'))
$bundleRoot = Join-Path $stageParent 'F1-Director'
try {
    Write-Host "Staging under $stageParent ..."
    Copy-ReleaseTree -RepoRoot $script:RepoRoot -DestBundle $bundleRoot

    $variants = @()
    if ($Variant -eq 'Both' -or $Variant -eq 'Jre') { $variants += 'Jre' }
    if ($Variant -eq 'Both' -or $Variant -eq 'MiniJre') { $variants += 'MiniJre' }

    foreach ($kind in $variants) {
        Write-Host ""
        Write-Host "Packing $kind ..."
        $variantStage = Join-Path $stageParent ('work-' + $kind)
        $variantBundle = Join-Path $variantStage 'F1-Director'
        & robocopy.exe $bundleRoot $variantBundle /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        Assert-RobocopyOk -Label 'variant stage'
        Invoke-PackVariant -StageParent $variantStage -BundleRoot $variantBundle -ShortVer $shortVer -OutDir $OutDirResolved -Kind $kind
        if (Test-Path -LiteralPath $variantStage) {
            Remove-Item -LiteralPath $variantStage -Recurse -Force
        }
    }
} finally {
    if (Test-Path -LiteralPath $stageParent) {
        Remove-Item -LiteralPath $stageParent -Recurse -Force
        Write-Host "Removed staging: $stageParent"
    }
}

Write-Host ""
Write-Host 'Pack complete.'