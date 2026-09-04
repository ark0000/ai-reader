@echo off
echo =========================================
echo    AuraReader Auto-Updater ^& Launcher
echo =========================================
echo.

echo [1/4] Checking for updates from GitHub...
git pull
echo.

echo [2/4] Installing/updating Python dependencies...
pip install -r src\requirements.txt --quiet
echo.

echo [3/4] Starting the local server...
start "AuraReader Server" cmd /c "python src/run_desktop.py"

echo [4/4] Done! The browser should open automatically.
exit
