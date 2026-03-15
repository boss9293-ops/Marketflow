@echo off
setlocal
cd /d "%~dp0"

set "MARKET_PROXY=%~1"
if "%MARKET_PROXY%"=="" set "MARKET_PROXY=QQQ"

echo [%date% %time%] START build_validation_snapshot --market-proxy %MARKET_PROXY% >> output\validation_guard_task.log
python scripts\build_validation_snapshot.py --market-proxy %MARKET_PROXY% >> output\validation_guard_task.log 2>&1
set "RC=%ERRORLEVEL%"
echo [%date% %time%] END rc=%RC% >> output\validation_guard_task.log

endlocal & exit /b %RC%
