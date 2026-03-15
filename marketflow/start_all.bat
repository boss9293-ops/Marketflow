@echo off
echo Starting MarketFlow servers...

start "MarketFlow Backend" cmd /k "cd /d d:\Youtube_pro\000-Code_develop\주식분석\us_market_complete\marketflow\backend && python app.py"

timeout /t 2 /nobreak >nul

start "MarketFlow Frontend" cmd /k "cd /d d:\Youtube_pro\000-Code_develop\주식분석\us_market_complete\marketflow\frontend && npm run dev"

echo Servers starting...
echo Backend : http://localhost:5001
echo Frontend: http://localhost:3010
echo.
timeout /t 4 /nobreak >nul
start http://localhost:3010
