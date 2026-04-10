@echo off
title SmartPulse Dev — Restart

echo [1/3] Killing existing processes on ports 3001, 5173, 5174, 5175...

for %%P in (3001 5173 5174 5175) do (
    for /f "tokens=5" %%A in ('netstat -aon ^| findstr ":%%P " 2^>nul') do (
        if not "%%A"=="" if not "%%A"=="0" (
            taskkill /PID %%A /F >nul 2>&1
            echo     Killed PID %%A on port %%P
        )
    )
)

echo [2/3] Waiting for ports to free...
timeout /t 2 /nobreak >nul

echo [3/3] Generating Prisma client...
cd /d "%~dp0server"
call npx prisma generate >nul 2>&1
cd /d "%~dp0"
echo     Prisma client generated.

echo [4/4] Starting dev server (client + server concurrently)...
echo.

echo [5/5] Opening Chrome after a short delay...
start "" cmd /c "timeout /t 4 /nobreak >nul && start chrome http://localhost:5173"

npm run dev
