@echo off
REM Start WorkTracker on localhost: MySQL check + app on :42780 (API + built frontend).
REM Requires Node.js and a running MySQL on 127.0.0.1:3306 (start MySQL80 as admin if needed).
SETLOCAL
cd /d "%~dp0"
if not exist server\.env (
  echo [ERROR] server\.env is missing. Copy server\.env.example to server\.env and set MySQL + admin values.
  pause
  exit /b 1
)
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',3306); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo [ERROR] MySQL is not running on 127.0.0.1:3306
  echo         Start it once as Administrator:   net start MYSQL80
  pause
  exit /b 1
)
if not exist web\dist\index.html (
  echo [1/2] No frontend build found - building web ...
  call npm run build -w web
  if errorlevel 1 (
    echo [ERROR] Frontend build failed. Fix the errors and run START.bat again.
    pause
    exit /b 1
  )
)
echo [2/2] Starting WorkTracker on port 42780 ...
start "WT-APP" /B cmd /c "cd /d server && npx tsx src/server.ts >%TEMP%\wt-api.log 2>&1"
echo Waiting for the app ...
for /L %%i in (1,1,60) do (
  curl -sf http://localhost:42780/ready >nul 2>&1 && goto :show
  ping -n 2 127.0.0.1 >nul
)
curl -sf http://localhost:42780/health >nul 2>&1
if errorlevel 1 (
  echo [ERROR] The app did not start - check %TEMP%\wt-api.log
  pause
  exit /b 1
)
echo [WARN] App is up but the database is not ready - check %TEMP%\wt-api.log
:show
echo.
echo App: http://localhost:42780
echo Health: http://localhost:42780/health
echo To show frontend changes run: npm run build -w web
echo Stop with STOP.bat
start "" http://localhost:42780
pause
