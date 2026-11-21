# Launch F1 Director (upstream jar + shell) in Edge/Chrome app mode (--app=).
# One window, titled "F1 Director Console" by Start.cmd. Java is a child of
# this console (no second window) so closing it still delivers CTRL_CLOSE.
# Its stdout/stderr are pipes, not the console screen. Writing UTF-8 bytes
# with WriteFile into a console whose code page was switched to 65001 doubles
# every CJK character (ASCII stays single-width, so paths and numbers look
# fine) and shifts the following columns. The old F1-Director-Server cmd did
# chcp 65001 before java and did not share a PowerShell host, so it did not
# hit that. Here the bytes stay UTF-8 on the pipe (-Dsun.stdout.encoding is
# kept, because a pipe is not a console) and each line is painted once with
# WriteConsoleW. Do not chcp this window.
# Lifecycle: director.html pings a local heartbeat port every 4s. Closing the
# tab/window sends /goodbye (fetchLater + visibility hidden + pagehide);
# if no heartbeat returns within GoodbyeGraceSec, Java is stopped.
# MissGraceSec is a longer safety net for crash/kill-tab without beacon.
# Enter / console close / Stop.cmd remain as backups. Stopping does not
# require a separate server window. F5 is safe: reload heartbeats cancel a
# pending goodbye within a few seconds. Tab switch / minimize may arm
# goodbye but a still-alive pulse cancels it.
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
# After /goodbye (visibility hidden / pagehide / fetchLater): if no heartbeat
# within this window, stop Java. Short enough to feel "close page => stop soon";
# long enough that F5 reload can reconnect and cancel the pending stop.
$GoodbyeGraceSec = 3
# Safety net if the tab dies without a goodbye beacon (crash / force-kill).
# Worker + setInterval keep pings alive in background tabs; 5s (~1 missed 4s beat) is enough.
$MissGraceSec = 5
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
    # Our child, if this session started one. HasExited is checked first so a
    # reused PID is not killed. Closing this console also delivers CTRL_CLOSE
    # to Java because it shares the console.
    Stop-TrackedJava
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -match '^(java|javaw)\.exe$' -and
            $_.CommandLine -and
            ($_.CommandLine -like '*F1-RaceControl-Desktop*.jar*')
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    # Leftover consoles from older launches that opened a second server window.
    # Current launches have no F1-Director-Server window; the jar command line
    # above and port 8720 below are what stop the server.
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

function Quote-ProcessArg([string]$s) {
    # CommandLineToArgvW quoting (java.exe), not cmd.exe quoting.
    if ([string]::IsNullOrEmpty($s)) { return '""' }
    if ($s -notmatch '[\s"]') { return $s }
    $escaped = [regex]::Replace($s, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Set-DirectorConsoleTitle {
    try { $Host.UI.RawUI.WindowTitle = 'F1 Director Console' } catch {}
}

function Initialize-DirectorConsoleWriter {
    if ('DirectorConsoleWriter' -as [type]) {
        $script:DirectorConsoleWriterReady = $true
        return
    }
    try {
        Add-Type -ErrorAction Stop -WarningAction SilentlyContinue -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DirectorConsoleWriter {
    const int STD_OUTPUT_HANDLE = -11;
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WriteConsoleW(
        IntPtr hConsole, string text, uint nChars, out uint written, IntPtr reserved);
    public static bool WriteLine(string text) {
        IntPtr handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if (handle == IntPtr.Zero || handle == (IntPtr)(-1)) return false;
        string line = (text ?? string.Empty) + "\r\n";
        uint written;
        return WriteConsoleW(handle, line, (uint)line.Length, out written, IntPtr.Zero);
    }
}
'@
        $script:DirectorConsoleWriterReady = $true
    } catch {
        $script:DirectorConsoleWriterReady = $false
    }
}

function Write-DirectorLine([string]$Text) {
    # WriteConsoleW emits each Unicode character once. It does not depend on
    # the console code page, so we never chcp 65001 in this window.
    if ($script:DirectorConsoleWriterReady) {
        try {
            if ([DirectorConsoleWriter]::WriteLine($Text)) { return }
        } catch {}
    }
    Write-Host $Text
}

function Write-JavaLogs {
    $queue = $script:JavaLines
    if (-not $queue) { return }
    while ($queue.Count -gt 0) {
        Write-DirectorLine ([string]$queue.Dequeue())
    }
}

function Start-JavaLogPump {
    param($Reader, $Queue)
    $rs = [runspacefactory]::CreateRunspace()
    $rs.Open()
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript({
        param($Reader, $Queue)
        try {
            while ($true) {
                $line = $Reader.ReadLine()
                if ($null -eq $line) { break }
                [void]$Queue.Enqueue($line)
            }
        } catch {}
    }).AddArgument($Reader).AddArgument($Queue)
    return [pscustomobject]@{
        Runspace   = $rs
        PowerShell = $ps
        Handle     = $ps.BeginInvoke()
    }
}

function Stop-JavaPumps {
    if (-not $script:JavaPumps) { return }
    foreach ($pump in @($script:JavaPumps)) {
        if (-not $pump) { continue }
        try {
            if ($pump.Handle -and -not $pump.Handle.IsCompleted) {
                [void]$pump.Handle.AsyncWaitHandle.WaitOne(1000)
            }
        } catch {}
        try { if ($pump.PowerShell) { $pump.PowerShell.Stop() } } catch {}
        try { if ($pump.PowerShell) { $pump.PowerShell.Dispose() } } catch {}
        try { if ($pump.Runspace) { $pump.Runspace.Close() } } catch {}
        try { if ($pump.Runspace) { $pump.Runspace.Dispose() } } catch {}
    }
    $script:JavaPumps = @()
}

function Get-DirectorJavaArguments {
    param(
        [string]$Jar,
        [string]$WebDir,
        [string]$ExtraArgs
    )
    $parts = @(
        '-Dfile.encoding=UTF-8',
        '-Dsun.stdout.encoding=UTF-8',
        '-Dsun.stderr.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        '-Dstderr.encoding=UTF-8',
        '-jar',
        (Quote-ProcessArg $Jar),
        '--port',
        '8720',
        '--web',
        (Quote-ProcessArg $WebDir),
        '--no-window'
    )
    $line = $parts -join ' '
    if ($ExtraArgs -and $ExtraArgs.Trim().Length -gt 0) {
        $line += ' ' + $ExtraArgs.Trim()
    }
    return $line
}

function Start-DirectorJava {
    param(
        [string]$JavaExe,
        [string]$Jar,
        [string]$WebDir,
        [string]$ExtraArgs
    )
    Set-DirectorConsoleTitle
    Initialize-DirectorConsoleWriter

    $utf8 = New-Object System.Text.UTF8Encoding $false
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $JavaExe
    $psi.Arguments = (Get-DirectorJavaArguments -Jar $Jar -WebDir $WebDir -ExtraArgs $ExtraArgs)
    $psi.UseShellExecute = $false
    # Attached to this console (no extra window, CTRL_CLOSE on close) but
    # stdout/stderr are pipes. A pipe is not FILE_TYPE_CHAR, so the JRE keeps
    # -Dsun.stdout.encoding=UTF-8 instead of replacing it with the console code page.
    $psi.CreateNoWindow = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $true
    $psi.StandardOutputEncoding = $utf8
    $psi.StandardErrorEncoding = $utf8
    $cwd = [System.IO.Directory]::GetCurrentDirectory()
    if ($cwd) { $psi.WorkingDirectory = $cwd }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    if (-not $proc.Start()) {
        throw 'Java process did not start.'
    }
    $script:JavaProc = $proc
    # Hold stdin open so the server does not see EOF.
    $script:JavaStdin = $proc.StandardInput
    $script:JavaLines = [System.Collections.Queue]::Synchronized((New-Object System.Collections.Queue))
    $script:JavaPumps = @(
        (Start-JavaLogPump -Reader $proc.StandardOutput -Queue $script:JavaLines),
        (Start-JavaLogPump -Reader $proc.StandardError -Queue $script:JavaLines)
    )
    Set-DirectorConsoleTitle
}

function Stop-TrackedJava {
    $proc = $script:JavaProc
    if ($proc) {
        $alive = $false
        try { $alive = -not $proc.HasExited } catch { $alive = $false }
        if ($alive) {
            try { & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null } catch {}
            try {
                if (-not $proc.HasExited) {
                    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                }
            } catch {}
        }
    }
    try { if ($script:JavaStdin) { $script:JavaStdin.Close() } } catch {}
}

function Test-DirectorJavaExited {
    $proc = $script:JavaProc
    if (-not $proc) { return $false }
    try {
        if (-not $proc.HasExited) { return $false }
    } catch { return $false }
    if (-not $script:JavaExitNoted) {
        $script:JavaExitNoted = $true
        $code = '?'
        try { $code = [string]$proc.ExitCode } catch {}
        Write-Host ("[!] Java exited (code {0})." -f $code)
    }
    return $true
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
        GoodbyeLogged  = $false
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
            # Drain POST bodies (sendBeacon / fetchLater / keepalive) so the
            # client connection can complete instead of stalling on Close().
            if ($req.HasEntityBody) {
                try {
                    $drain = New-Object byte[] 1024
                    while ($req.InputStream.Read($drain, 0, $drain.Length) -gt 0) { }
                } catch {}
            }
            if ($req.HttpMethod -eq 'OPTIONS') {
                $res.StatusCode = 204
            } else {
                $path = $req.Url.AbsolutePath.TrimEnd('/')
                if ($path -eq '' -or $path -eq '/heartbeat' -or $path -eq '/ping') {
                    # Any fresh heartbeat cancels a pending goodbye (covers F5
                    # and the still-alive pulse after a tab-switch hide).
                    if ($State.PendingStopUtc) {
                        Write-Host 'Heartbeat resumed; pending goodbye cancelled.'
                    }
                    $State.LastBeatUtc = [DateTime]::UtcNow
                    $State.SeenBeat = $true
                    $State.PendingStopUtc = $null
                    $State.GoodbyeLogged = $false
                    $res.StatusCode = 200
                    $buf = [System.Text.Encoding]::UTF8.GetBytes('ok')
                    $res.ContentType = 'text/plain; charset=utf-8'
                    $res.OutputStream.Write($buf, 0, $buf.Length)
                } elseif ($path -eq '/goodbye' -or $path -eq '/stop') {
                    # Arm a short timer; kill only if no beat returns.
                    $State.PendingStopUtc = [DateTime]::UtcNow
                    if (-not $State.GoodbyeLogged) {
                        $State.GoodbyeLogged = $true
                        Write-Host 'Director sent goodbye; stopping in ~3s unless a heartbeat returns...'
                    }
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

Write-Host 'Starting F1 Director server in this console...'
Write-Host ("  {0}" -f $JavaExe)
try {
    $null = Start-DirectorJava -JavaExe $JavaExe -Jar $Jar -WebDir $WebDir -ExtraArgs $ExtraArgs
    Write-Host ("  java pid {0}" -f $script:JavaProc.Id)
} catch {
    Write-Host ("[!] Failed to start Java: {0}" -f $_.Exception.Message)
}

Write-Host 'Waiting for http://127.0.0.1:8720 ...'
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
    Write-JavaLogs
    if (Test-DirectorJavaExited) { break }
    if (Test-Health) { $ready = $true; break }
    for ($slice = 0; $slice -lt 5; $slice++) {
        Start-Sleep -Milliseconds 200
        Write-JavaLogs
    }
}
Write-JavaLogs
Set-DirectorConsoleTitle
if (-not $ready) {
    if ($script:JavaExitNoted) {
        Write-Host '[!] Director server is not running; opening the page anyway.'
    } else {
        Write-Host '[!] Health check timed out; opening director anyway.'
    }
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
Write-Host '- Server logs                   => this window only'
Write-Host '- Close the director tab/window  => server stops in ~3s (goodbye); ~5s miss is backup'
Write-Host '- Heartbeat every 4s'
Write-Host '- Press Enter here               => stop the Director server'
Write-Host '- Or close this console window   => server stops'
Write-Host '- Or run Stop.cmd'
Write-Host '- F5 refresh is safe             => reload cancels a pending goodbye'
Write-Host '- Switching tabs / minimizing    => does not stop the server'
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
        Write-JavaLogs
        $null = Test-DirectorJavaExited

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

        # Explicit goodbye: stop soon unless a heartbeat cancels it.
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
    Write-Host 'Director tab closed (goodbye, ~3s). Stopping Director server...'
} elseif ($stopReason -eq 'heartbeat') {
    Write-Host 'Director tab closed (heartbeat lost, ~5s miss grace). Stopping Director server...'
} elseif ($stopReason -eq 'enter') {
    Write-Host 'Stopping Director server...'
} else {
    Write-Host 'Stopping Director server...'
}
Stop-F1Director
Start-Sleep -Milliseconds 150
Write-JavaLogs
Stop-JavaPumps
Write-Host 'Stopped.'
