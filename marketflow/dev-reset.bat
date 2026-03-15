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

echo [1/3] Clearing .next
if exist ".next" rmdir /s /q ".next"

echo [2/3] Clearing tsbuild cache
if exist "tsconfig.tsbuildinfo" del /f /q "tsconfig.tsbuildinfo"

echo [3/3] Starting frontend from ASCII path
npm run dev

