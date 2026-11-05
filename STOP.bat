@echo off
REM Stop the localhost WorkTracker stack (app on :42780).
REM Order matters: the launcher supervises the server and restarts it on exit, so the
REM supervisor has to die first, otherwise it can resurrect the server during cleanup.
cd /d "%~dp0"
echo [STOP] Stopping WorkTracker ...

REM 1) Ask the server to shut down gracefully (needs the launcher token)
set "TOKEN="
if exist "%TEMP%\worktracker.token" set /p TOKEN=<"%TEMP%\worktracker.token"
curl.exe -s -o nul -m 5 -X POST http://localhost:42780/internal/stop -H "x-stop-token: %TOKEN%" >nul 2>&1

REM 2) Kill the launcher(s) first so nothing schedules a restart
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'employee-work-tracker' -and $_.CommandLine -match 'launcher\.(cjs|js)' -and $_.ProcessId -ne $PID } | ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }"
ping -n 3 127.0.0.1 >nul

REM 3) Then clean up any server/vite/tunnel left running. Repeated because a server
REM    process can be spawned in the window while the supervisor is being killed.
for /L %%i in (1,1,4) do (
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'employee-work-tracker' -and $_.CommandLine -match 'src/server\.ts|vite' -and $_.ProcessId -ne $PID } | ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }"
  ping -n 2 127.0.0.1 >nul
)
del "%TEMP%\worktracker.pid" >nul 2>&1
del "%TEMP%\worktracker.token" >nul 2>&1

echo [STOP] Done. Port 42780 is free.
pause
