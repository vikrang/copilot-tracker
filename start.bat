@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

node -e "if (Number(process.versions.node.split('.')[0]) < 18) process.exit(1)"
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install the current LTS release from https://nodejs.org/.
  pause
  exit /b 1
)

start "Household Investment Tracker" /D "%~dp0" cmd /k "npm.cmd start"
echo Waiting for the tracker to start...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready = $false; for ($i = 0; $i -lt 30; $i++) { try { $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000/api/session' -TimeoutSec 1; $session = $response.Content | ConvertFrom-Json; if ($response.StatusCode -eq 200 -and $null -ne $session.googleConfigured) { $ready = $true; break } } catch {}; Start-Sleep -Seconds 1 }; if (-not $ready) { exit 1 }"
if errorlevel 1 (
  echo The tracker did not respond at http://127.0.0.1:3000.
  echo Check the tracker terminal for errors, or make sure port 3000 is available.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3000/"
echo The tracker is running. Leave its terminal window open while you use it.
