# Single PowerShell host for everyday Start.cmd: publish then Run-Director (same process).
# ASCII-only for Windows PowerShell 5.1.
param(
    [Parameter(Mandatory = $true)][string]$DirectorRoot,
    [Parameter(Mandatory = $true)][string]$WebDir,
    [Parameter(Mandatory = $true)][string]$JavaExe,
    [Parameter(Mandatory = $true)][string]$Jar,
    [string]$ExtraArgs = '',
    [switch]$SeedLayouts
)

$ErrorActionPreference = 'Stop'

$DirectorRoot = [System.IO.Path]::GetFullPath($DirectorRoot.TrimEnd('\', '/'))
$scriptDir = $DirectorRoot

$forcePublish = $false
$runExtra = New-Object System.Collections.Generic.List[string]
foreach ($tok in ($ExtraArgs -split '\s+')) {
    if ([string]::IsNullOrWhiteSpace($tok)) { continue }
    if ($tok -ieq '--force-publish') {
        $forcePublish = $true
    } else {
        [void]$runExtra.Add($tok)
    }
}
$extraForJava = ($runExtra -join ' ').Trim()

$syncScript = Join-Path $scriptDir 'Sync-WebPublish.ps1'
if (-not (Test-Path -LiteralPath $syncScript)) {
    Write-Error "Sync script not found: $syncScript"
    exit 1
}

try {
    & $syncScript -DirectorRoot $DirectorRoot -WebDir $WebDir -SeedLayouts:$SeedLayouts -ForcePublish:$forcePublish
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
Write-Host ("Published web UI to: {0}" -f $WebDir)
Write-Host ''

$runScript = Join-Path $scriptDir 'Run-Director.ps1'
if (-not (Test-Path -LiteralPath $runScript)) {
    Write-Error "Run script not found: $runScript"
    exit 2
}

try {
    & $runScript -JavaExe $JavaExe -Jar $Jar -WebDir $WebDir -ExtraArgs $extraForJava
} catch {
    Write-Error $_.Exception.Message
    exit 2
}
exit 0