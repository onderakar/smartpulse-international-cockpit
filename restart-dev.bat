@echo off
title SmartPulse Dev — Restart

echo [1/3] Killing existing processes on ports 3001, 5173, 5174, 5175...

for %%P in (3001 5173 5174 5175) do (
    for /f "tokens=5" %%A in ('netstat -aon ^| findstr ":%%P " 2^>nul') do (
        if not "%%A"=="" (
            taskkill /PID %%A /F >nul 2>&1
            echo     Killed PID %%A on port %%P
        )
    )
)

echo [2/3] Waiting for ports to free...
timeout /t 2 /nobreak >nul

echo [3/3] Starting dev server (client + server concurrently)...
echo.
npm run dev
