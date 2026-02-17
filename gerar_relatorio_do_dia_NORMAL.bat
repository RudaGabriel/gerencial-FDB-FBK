@echo off

setlocal

chcp 65001 >nul

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "DATA=%%i"

set "FDB=%ProgramFiles(x86)%\SmallSoft\Small Commerce\SMALL.FDB"

for /f "tokens=1-3 delims=-" %%a in ("%DATA%") do (set "YYYY=%%a" & set "MM=%%b" & set "DD=%%c")

set "DATA_BR=%DD%/%MM%/%YYYY%"

set "DATA_ARQ=%DD%-%MM%-%YYYY%"

set "OUT=%userprofile%\desktop\relatorio_%DATA_ARQ%_gerencial_por_vendedor.html"

cd /d "%~dp0"

node gerencial_por_vendedor_html_fix_width.js --fdb "%FDB%" --data "%DATA%" --saida "%OUT%" --user SYSDBA --pass masterkey

start "" "%OUT%"

exit /b 0
