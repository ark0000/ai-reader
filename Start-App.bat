@echo off
echo =========================================
echo    AuraReader Auto-Updater ^& Launcher
echo =========================================
echo.

echo [1/3] Checking for updates from GitHub...
git pull
echo.

echo [2/3] Starting the local server...
start "AuraReader Server" cmd /c "python src/run_desktop.py"

echo [3/3] Done! The browser should open automatically.
exit
