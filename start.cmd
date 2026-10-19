@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe goto missing
if not exist frontend\dist\index.html goto missing
.venv\Scripts\python.exe run.py
if errorlevel 1 pause
exit /b
:missing
echo Najpierw uruchom setup.cmd.
pause
exit /b 1
