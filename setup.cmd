@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3.12 -m venv .venv
  if errorlevel 1 goto error
)
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto error
call npm ci --prefix frontend
if errorlevel 1 goto error
call npm run build --prefix frontend
if errorlevel 1 goto error
echo.
echo Gotowe. Uruchom start.cmd, aby otworzyc ModelCheck 3D.
pause
exit /b 0
:error
echo.
echo Instalacja nie powiodla sie. Sprawdz komunikat powyzej.
echo Wymagane: Python 3.12 64-bit i Node.js 22 lub 24.
pause
exit /b 1
