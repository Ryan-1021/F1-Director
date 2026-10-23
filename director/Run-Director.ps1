# Launch F1 Director (upstream jar + shell) in Edge/Chrome app mode (--app=).
# Lifecycle: director.html pings a local heartbeat port. Closing the tab sends
# /goodbye; if no heartbeat returns within GoodbyeGraceSec, Java is stopped.
# MissGraceSec is a longer safety net for crash/kill-tab without beacon.
# Enter / console close / Stop.cmd remain as backups. F5 is safe: reload
# heartbeats cancel a pending goodbye within a few seconds.
param(
    [Parameter(Mandatory = $true)][string]$JavaExe,
    [Parameter(Mandatory = $true)][string]$Jar,
    [Parameter(Mandatory = $true)][string]$WebDir,
    [string]$ExtraArgs = ''
)

$ErrorActionPreference = 'Stop'
$DirectorUrl = 'http://127.0.0.1:8720/director.html'
$HeartbeatPort = 8721
$HeartbeatPrefix = "http://127.0.0.1:$HeartbeatPort/"
$LaunchCmd = Join-Path $env:TEMP 'F1-Director-Server-Launch.cmd'
# After /goodbye from pagehide: if no heartbeat within this window, stop Java.
# Short enough to feel "close page => stop soon"; long enough that F5 reload
# can reconnect and cancel the pending stop.
$GoodbyeGraceSec = 3
# Safety net if the tab dies without a goodbye beacon (crash / force-kill).
# Worker + setInterval keep pings alive in background tabs; 20s (~3 x 6s beats) is enough.
$MissGraceSec = 20
# How long to wait for the first heartbeat after opening the browser.
$FirstBeatWaitSec = 90

function Find-AppBrowser {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    foreach ($name in @('msedge', 'chrome')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) { return $cmd.Source }
    }
    return $null
}

function Stop-F1Director {
    $ErrorActionPreference = 'SilentlyContinue'
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -match '^(java|javaw)\.exe$' -and
            $_.CommandLine -and
            ($_.CommandLine -like '*F1-RaceControl-Desktop*.jar*')
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    & taskkill.exe /FI "WINDOWTITLE eq F1-Director-Server*" /T /F 2>$null | Out-Null
    & taskkill.exe /FI "WINDOWTITLE eq F1-RaceControl-Server*" /T /F 2>$null | Out-Null
    try {
        Get-NetTCPConnection -LocalPort 8720 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { if ($_) { Stop-Process -Id $_ -Force } }
    } catch {}
}

function Test-Health {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8720/api/health'
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch { return $false }
}

function Quote-Cmd([string]$s) {
    if ($null -eq $s) { return '""' }
    return '"' + ($s -replace '"', '""') + '"'
}

function Stop-HeartbeatListener {
    param($State)
    if (-not $State) { return }
    try {
        if ($State.AsyncResult -and -not $State.AsyncResult.IsCompleted -and $State.Listener) {
            try { $State.Listener.Stop() } catch {}
        }
    } catch {}
    try {
        if ($State.Listener) {
            $State.Listener.Close()
        }
    } catch {}
}

function Start-HeartbeatListener {
    $state = [ordered]@{
        Listener       = $null
        AsyncResult    = $null
        LastBeatUtc    = $null
        SeenBeat       = $false
        PendingStopUtc = $null
        Ok             = $false
        Error          = $null
    }
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add($HeartbeatPrefix)
        $listener.Start()
        $state.Listener = $listener
        $state.AsyncResult = $listener.BeginGetContext($null, $null)
        $state.Ok = $true
    } catch {
        $state.Error = $_.Exception.Message
        $state.Ok = $false
        try { if ($state.Listener) { $state.Listener.Close() } } catch {}
        $state.Listener = $null
    }
    return $state
}

function Pump-HeartbeatListener {
    param($State)
    if (-not $State -or -not $State.Ok -or -not $State.Listener) { return }
    while ($State.AsyncResult -and $State.AsyncResult.IsCompleted) {
        try {
            $ctx = $State.Listener.EndGetContext($State.AsyncResult)
        } catch {
            break
        }
        try {
            $req = $ctx.Request
            $res = $ctx.Response
            $res.AddHeader('Access-Control-Allow-Origin', '*')
            $res.AddHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            $res.AddHeader('Access-Control-Allow-Headers', 'Content-Type')
            $res.AddHeader('Cache-Control', 'no-store')
            if ($req.HttpMethod -eq 'OPTIONS') {
                $res.StatusCode = 204
            } else {
                $path = $req.Url.AbsolutePath.TrimEnd('/')
                if ($path -eq '' -or $path -eq '/heartbeat' -or $path -eq '/ping') {
                    # Any fresh heartbeat cancels a pending goodbye (covers F5).
                    $State.LastBeatUtc = [DateTime]::UtcNow
                    $State.SeenBeat = $true
                    $State.PendingStopUtc = $null
                    $res.StatusCode = 200
                    $buf = [System.Text.Encoding]::UTF8.GetBytes('ok')
                    $res.ContentType = 'text/plain; charset=utf-8'
                    $res.OutputStream.Write($buf, 0, $buf.Length)
                } elseif ($path -eq '/goodbye' -or $path -eq '/stop') {
                    # pagehide beacon: arm a short timer; kill only if no beat returns.
                    $State.PendingStopUtc = [DateTime]::UtcNow
                    $res.StatusCode = 200
                    $buf = [System.Text.Encoding]::UTF8.GetBytes('bye')
                    $res.ContentType = 'text/plain; charset=utf-8'
                    $res.OutputStream.Write($buf, 0, $buf.Length)
                } else {
                    $res.StatusCode = 404
                }
            }
            $res.Close()
        } catch {
            try { $ctx.Response.Abort() } catch {}
        }
        try {
            $State.AsyncResult = $State.Listener.BeginGetContext($null, $null)
        } catch {
            $State.AsyncResult = $null
            break
        }
    }
}

Write-Host 'Cleaning up any previous Director instance...'
Stop-F1Director
Start-Sleep -Milliseconds 500

# Tiny local heartbeat server (director.html pings this; tab close => stop Java)
Write-Host ("Starting heartbeat listener on {0} ..." -f $HeartbeatPrefix)
$hb = Start-HeartbeatListener
if (-not $hb.Ok) {
    Write-Host ("[!] Heartbeat listener failed: {0}" -f $hb.Error)
    Write-Host '    Falling back to Enter / Stop.cmd to stop the server.'
} else {
    Write-Host '  Heartbeat listener ready.'
}

# Write a tiny ASCII launcher so quoting + chcp 65001 + java are reliable.
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('@echo off')
$lines.Add('title F1-Director-Server')
$lines.Add('chcp 65001 >nul')
$javaLine = (
    (Quote-Cmd $JavaExe) +
    ' -Dfile.encoding=UTF-8' +
    ' -Dsun.stdout.encoding=UTF-8' +
    ' -Dsun.stderr.encoding=UTF-8' +
    ' -Dstdout.encoding=UTF-8' +
    ' -Dstderr.encoding=UTF-8' +
    ' -jar ' + (Quote-Cmd $Jar) +
    ' --port 8720 --web ' + (Quote-Cmd $WebDir) +
    ' --no-window'
)
if ($ExtraArgs -and $ExtraArgs.Trim().Length -gt 0) {
    $javaLine += ' ' + $ExtraArgs.Trim()
}
$lines.Add($javaLine)
# UTF-8 no BOM, CRLF — cmd-safe (ASCII only)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($LaunchCmd, (($lines -join "`r`n") + "`r`n"), $utf8NoBom)

Write-Host 'Starting F1-Director-Server (UTF-8 console, minimized)...'
Write-Host ("  launcher: {0}" -f $LaunchCmd)
Start-Process -FilePath $LaunchCmd -WindowStyle Minimized

Write-Host 'Waiting for http://127.0.0.1:8720 ...'
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
    if (Test-Health) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    Write-Host '[!] Health check timed out; opening director anyway.'
}

$browser = Find-AppBrowser
if ($browser) {
    $appArg = "--app=$DirectorUrl"
    Write-Host ("Opening director in app mode: {0} {1}" -f $browser, $appArg)
    Start-Process -FilePath $browser -ArgumentList @($appArg)
} else {
    Write-Host ("[!] Edge/Chrome not found; falling back to default browser: {0}" -f $DirectorUrl)
    Start-Process $DirectorUrl
}

Write-Host ''
Write-Host 'Director opened in app mode (no address bar / browser chrome).'
Write-Host '- Close the director tab/window  => server stops in ~3s (goodbye + heartbeat)'
Write-Host '- Press Enter here               => stop the Director server'
Write-Host '- Or close this console window   => server stops'
Write-Host '- Or run Stop.cmd'
Write-Host '- F5 refresh is safe             => reload cancels a pending goodbye'
Write-Host ''

# Ensure cleanup if this PowerShell host is closed while waiting.
try {
    Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -match '^(java|javaw)\.exe$' -and
                $_.CommandLine -like '*F1-RaceControl-Desktop*.jar*'
            } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } | Out-Null
} catch {}

$openedUtc = [DateTime]::UtcNow
$stopReason = 'enter'
try {
    while ($true) {
        Pump-HeartbeatListener -State $hb

        # Enter: non-blocking check (ignore if host has no console)
        try {
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                if ($key.Key -eq 'Enter') {
                    $stopReason = 'enter'
                    break
                }
            }
        } catch {}

        # Explicit goodbye from pagehide: stop soon unless a heartbeat cancels it.
        if ($hb.Ok -and $hb.PendingStopUtc) {
            $byeAge = ([DateTime]::UtcNow - $hb.PendingStopUtc).TotalSeconds
            if ($byeAge -ge $GoodbyeGraceSec) {
                $stopReason = 'goodbye'
                break
            }
        }

        if ($hb.Ok -and $hb.SeenBeat -and $hb.LastBeatUtc) {
            $age = ([DateTime]::UtcNow - $hb.LastBeatUtc).TotalSeconds
            if ($age -ge $MissGraceSec) {
                $stopReason = 'heartbeat'
                break
            }
        }

        # Optional nudge once if first beat is late (page may have failed to load)
        $waited = ([DateTime]::UtcNow - $openedUtc).TotalSeconds
        if ($hb.Ok -and -not $hb.SeenBeat -and $waited -ge $FirstBeatWaitSec) {
            # Do not auto-kill — user may still be using boards without heartbeat
            # (old cached page). Keep waiting for Enter / Stop.cmd.
            # Print once.
            if (-not $script:LateBeatWarned) {
                $script:LateBeatWarned = $true
                Write-Host '[!] No director heartbeat yet. Close the tab will not auto-stop until the page loads.'
                Write-Host '    Press Enter here or run Stop.cmd to stop the server.'
            }
        }

        Start-Sleep -Milliseconds 400
    }
} catch {
    $stopReason = 'error'
} finally {
    Stop-HeartbeatListener -State $hb
}

if ($stopReason -eq 'goodbye') {
    Write-Host 'Director tab closed (goodbye). Stopping Director server...'
} elseif ($stopReason -eq 'heartbeat') {
    Write-Host 'Director tab closed (heartbeat lost). Stopping Director server...'
} elseif ($stopReason -eq 'enter') {
    Write-Host 'Stopping Director server...'
} else {
    Write-Host 'Stopping Director server...'
}
Stop-F1Director
Write-Host 'Stopped.'
