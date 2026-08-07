@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo    兔丝 - 启动中...
echo ========================================
echo.
npm run dev
pause
