cd d:/Youtube_pro/000-Code_develop/주식분석/us_market_complete/marketflow
python backend/app.py

cd d:/Youtube_pro/000-Code_develop/주식분석/us_market_complete/marketflow/frontend
npm run dev

포트 5001 (백엔드) 종료:


netstat -ano | findstr :5001
taskkill /PID <PID번호> /F
포트 3000 (프론트엔드) 종료:


netstat -ano | findstr :3000
taskkill /PID <PID번호> /F

cd d:/Youtube_pro/000-Code_develop/주식분석/us_market_complete/marketflow/backend
python run_all.py --mode data
python run_all.py --mode ml
python run_all.py --mode ai
python run_all.py --mode full


# backend 데이터 갱신(구글시트 연동)
python backend/run_all.py --mode holdings --sheet_id "19qYsx56USljehtNShW5V_hXeci1yftCUw3WbrvGFrBw" --tabs "Goal,sheet1,sheet2,sheet3"

# 프론트 빌드
cd frontend
npm run build
npm run dev



python backend/scripts/list_sheet_tabs.py --sheet_id 13BAFRujSDYhRHtOy9a3xl
python backend/scripts/import_holdings_tabs.py --sheet_id 13BAFRujSDYhRHtOy9a3xl --tabs "Goal,sheet1,sheet2"
dir backend\output


diff --git a//mnt/d/Youtube_pro/000-Code_develop/주식분석/us_market_complete/marketflow/frontend/dev-reset.bat b//mnt/d/Youtube_pro/000-Code_develop/주식분석/us_market_complete/marketflow/frontend/dev-reset.bat
new file mode 100644
--- /dev/null
+++ b//mnt/d/Youtube_pro/000-Code_develop/주식분석/us_market_complete/marketflow/frontend/dev-reset.bat
@@ -0,0 +1,68 @@
+@echo off
+setlocal
+
+REM MarketFlow frontend dev reset helper (Windows CMD)
+REM - Clears Next.js cache folders that often cause UNKNOWN open errors
+REM - Restarts next dev on a chosen port (default 3010)
+
+set "PORT=%~1"
+if "%PORT%"=="" set "PORT=3010"
+
+echo.
+echo [MarketFlow] Frontend dev reset
+echo   Root: %~dp0
+echo   Port: %PORT%
+echo.
+
+cd /d "%~dp0" || (
+  echo [FAIL] Could not change directory to frontend root.
+  exit /b 1
+)
+
+echo [1/4] Cleaning .next cache...
+if exist ".next" (
+  rmdir /s /q ".next"
+  if errorlevel 1 (
+    echo [WARN] Failed to remove .next (possibly locked). Close other dev servers and retry.
+  ) else (
+    echo [OK] Removed .next
+  )
+) else (
+  echo [SKIP] .next not found
+)
+
+echo [2/4] Cleaning node_modules cache...
+if exist "node_modules\.cache" (
+  rmdir /s /q "node_modules\.cache"
+  if errorlevel 1 (
+    echo [WARN] Failed to remove node_modules\.cache
+  ) else (
+    echo [OK] Removed node_modules\.cache
+  )
+) else (
+  echo [SKIP] node_modules\.cache not found
+)
+
+echo [3/4] Checking npm...
+where npm >nul 2>nul
+if errorlevel 1 (
+  echo [FAIL] npm not found in PATH.
+  exit /b 1
+)
+echo [OK] npm found
+
+echo [4/4] Starting dev server...
+echo     npm run dev -- -p %PORT%
+echo.
+npm run dev -- -p %PORT%
+set "RC=%ERRORLEVEL%"
+
+echo.
+if not "%RC%"=="0" (
+  echo [FAIL] Dev server exited with RC=%RC%
+) else (
+  echo [OK] Dev server exited normally.
+)
+
+endlocal & exit /b %RC%
+
