# Stamp share/web/director.html <title> from repo VERSION.
# Short form: strip +build metadata, drop a leading v, then prefix v.
# Example: 0.2.12+20261107 -> "F1 ... Director · v0.2.12"
# This file is ASCII-only so Windows PowerShell 5.1 can parse it on any code page.
param(
    [Parameter(Mandatory = $true)][string]$WebDir,
    [Parameter(Mandatory = $true)][string]$VersionFile
)

$ErrorActionPreference = 'Stop'

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

if (-not (Test-Path -LiteralPath $VersionFile)) {
    Write-Host "VERSION not found, skip window-title stamp: $VersionFile"
    exit 0
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$raw = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $VersionFile), $utf8)
$short = Get-DirectorShortVersion $raw
if (-not $short) {
    Write-Host 'VERSION empty, skip window-title stamp'
    exit 0
}

$htmlPath = Join-Path $WebDir 'director.html'
if (Test-Path -LiteralPath $htmlPath) {
    $html = [System.IO.File]::ReadAllText($htmlPath, $utf8)
    $open = '<title>'
    $close = '</title>'
    $start = $html.IndexOf($open)
    $end = $html.IndexOf($close)
    if ($start -ge 0 -and $end -gt $start) {
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
        $next = $keep + $suffix
        if ($cur -ne $next) {
            $html = $html.Substring(0, $start) + $open + $next + $html.Substring($end)
            [System.IO.File]::WriteAllText($htmlPath, $html, $utf8)
        }
    }
}

Copy-Item -LiteralPath $VersionFile -Destination (Join-Path $WebDir 'VERSION') -Force
Write-Host ("Window title stamped v{0}" -f $short)
