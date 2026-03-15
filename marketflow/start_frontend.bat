@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"

subst X: /D >nul 2>nul
subst X: "%ROOT%" >nul 2>nul

if not exist "X:\marketflow\frontend\package.json" (
  echo Failed to map workspace to X:\
  exit /b 1
)

cd /d "X:\marketflow\frontend"
echo Starting frontend from ASCII path: %CD%
npm run dev

