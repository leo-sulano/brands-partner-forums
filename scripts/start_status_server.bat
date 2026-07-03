@echo off
REM Wait 10 seconds for OneDrive to finish mounting before starting
timeout /t 10 /nobreak >nul

cd /d "c:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts"
start "Forums Status Server" pythonw status_server.py --no-headless
