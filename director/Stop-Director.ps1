# Stop F1 Director server processes (no admin required).
$ErrorActionPreference = 'SilentlyContinue'

function Stop-F1Director {
    $killed = @()

    # 1) java/javaw whose command line mentions our jar
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -match '^(java|javaw)\.exe$' -and
            $_.CommandLine -and
            ($_.CommandLine -like '*F1-RaceControl-Desktop*.jar*')
        } |
        ForEach-Object {
            Write-Host ("  kill java PID {0}" -f $_.ProcessId)
            Stop-Process -Id $_.ProcessId -Force
            $script:killed += $_.ProcessId
        }

    # 2) console windows titled F1-Director-Server*
    & taskkill.exe /FI "WINDOWTITLE eq F1-Director-Server*" /T /F 2>$null | Out-Null

    # 3) anything still listening on 8720
    try {
        Get-NetTCPConnection -LocalPort 8720 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object {
                if ($_ -and $_ -notin $script:killed) {
                    Write-Host ("  kill port-8720 PID {0}" -f $_)
                    Stop-Process -Id $_ -Force
                    $script:killed += $_
                }
            }
    } catch {}

    if (-not $killed -or $killed.Count -eq 0) {
        Write-Host '  (no F1 Director java process was running)'
    }
}

Stop-F1Director
