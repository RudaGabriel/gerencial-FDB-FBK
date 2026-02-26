@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "PORTA=8000"
set "WEBROOT=%LOCALAPPDATA%\FDB_REL_WEB"
set "HIST=%WEBROOT%\historico"
set "ATUAL=%WEBROOT%\relatorio_atual.html"
set "SERVER=%WEBROOT%\_server_fdb_rel.js"
set "LOG=%WEBROOT%\server.log"
set "BATLOG=%WEBROOT%\bat.log"
set "AUTO=0"

if /i "%~1"=="--auto" set "AUTO=1"
if /i "%~1"=="--instalar" goto instalar
if /i "%~1"=="--remover" goto remover

if not exist "%WEBROOT%" mkdir "%WEBROOT%" >nul 2>&1
if not exist "%HIST%" mkdir "%HIST%" >nul 2>&1

> "%BATLOG%" echo INICIO %date% %time%
>>"%BATLOG%" echo WEBROOT=%WEBROOT%
>>"%BATLOG%" echo PORTA=%PORTA%

set "WEB_IP="
for /f "delims=" %%I in ('powershell -NoProfile -Command "$c=Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq ''Up'' -and $_.IPv4Address -and $_.InterfaceAlias -notmatch ''VMware|WARP|VirtualBox|Hyper-V|vEthernet'' } ^| Select-Object -First 1; if($c){$c.IPv4Address.IPAddress}" 2^>nul') do if not defined WEB_IP set "WEB_IP=%%I"
if not defined WEB_IP for /f "delims=" %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike ''169.254*'' -and $_.IPAddress -ne ''127.0.0.1'' } ^| Select-Object -First 1 -ExpandProperty IPAddress)" 2^>nul') do if not defined WEB_IP set "WEB_IP=%%I"
if not defined WEB_IP set "WEB_IP=127.0.0.1"
>>"%BATLOG%" echo IP=%WEB_IP%

set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE (
  >>"%BATLOG%" echo ERRO: node nao encontrado no PATH
  if "%AUTO%"=="0" pause
  exit /b 1
)
>>"%BATLOG%" echo NODE=%NODE_EXE%

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "DATA=%%i"

set "BUSCA_COMPLETA=1"
set "FDB="
set "SCRIPT="

for %%P in (
  "%ProgramFiles(x86)%\SmallSoft\Small Commerce\SMALL.FDB"
  "%ProgramFiles%\SmallSoft\Small Commerce\SMALL.FDB"
  "%ProgramData%\SmallSoft\Small Commerce\SMALL.FDB"
) do if not defined FDB if exist "%%~fP" set "FDB=%%~fP"

if not defined FDB for /f "delims=" %%F in ('where /r "%ProgramFiles(x86)%" SMALL.FDB 2^>nul') do if not defined FDB set "FDB=%%F"
if not defined FDB for /f "delims=" %%F in ('where /r "%ProgramFiles%" SMALL.FDB 2^>nul') do if not defined FDB set "FDB=%%F"

if not defined FDB if "%BUSCA_COMPLETA%"=="1" (
  for /f "delims=" %%R in ('powershell -NoProfile -Command "(Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root)"') do (
    if not defined FDB for /f "delims=" %%F in ('where /r "%%R" SMALL.FDB 2^>nul') do if not defined FDB set "FDB=%%F"
  )
)

if not defined FDB (
  >>"%BATLOG%" echo ERRO: SMALL.FDB nao encontrado
  if "%AUTO%"=="0" pause
  exit /b 1
)

for %%P in (
  "%~dp0gerencial_por_vendedor_html.js"
  "%~dp0\gerencial_por_vendedor_html.js"
  "%userprofile%\desktop\gerencial_por_vendedor_html.js"
  "%userprofile%\documents\gerencial_por_vendedor_html.js"
  "%userprofile%\downloads\gerencial_por_vendedor_html.js"
) do if not defined SCRIPT if exist "%%~fP" set "SCRIPT=%%~fP"

if not defined SCRIPT for /f "delims=" %%F in ('where /r "%~dp0" gerencial_por_vendedor_html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
if not defined SCRIPT for /f "delims=" %%F in ('where /r "%userprofile%\desktop" gerencial_por_vendedor_html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
if not defined SCRIPT for /f "delims=" %%F in ('where /r "%userprofile%\documents" gerencial_por_vendedor_html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
if not defined SCRIPT for /f "delims=" %%F in ('where /r "%userprofile%\downloads" gerencial_por_vendedor_html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
if not defined SCRIPT for /f "delims=" %%F in ('where /r "%userprofile%" gerencial_por_vendedor_html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
if not defined SCRIPT for /f "delims=" %%F in ('where /r "%homedrive%" gerencial_por_vendedor_html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"

if not defined SCRIPT (
  >>"%BATLOG%" echo ERRO: gerencial_por_vendedor_html.js nao encontrado
  if "%AUTO%"=="0" pause
  exit /b 1
)

for /f "tokens=1-3 delims=-" %%a in ("%DATA%") do (set "YYYY=%%a" & set "MM=%%b" & set "DD=%%c")
set "DATA_ARQ=%DD%-%MM%-%YYYY%"
set "OUT=%userprofile%\desktop\(FDB-DIA)_relatorio_%DATA_ARQ%_gerencial_por_vendedor.html"

>>"%BATLOG%" echo FDB=%FDB%
>>"%BATLOG%" echo SCRIPT=%SCRIPT%
>>"%BATLOG%" echo OUT=%OUT%

cd /d "%~dp0"
"%NODE_EXE%" "%SCRIPT%" --fdb "%FDB%" --data "%DATA%" --saida "%OUT%" --user SYSDBA --pass masterkey >> "%BATLOG%" 2>&1
if errorlevel 1 (
  >>"%BATLOG%" echo ERRO: falha ao gerar relatorio
  if "%AUTO%"=="0" pause
  exit /b 1
)

for %%F in ("%OUT%") do set "OUT_NAME=%%~nxF"
copy /y "%OUT%" "%HIST%\%OUT_NAME%" >nul
copy /y "%OUT%" "%ATUAL%" >nul
>>"%BATLOG%" echo ATUAL=%ATUAL%

set "B64_SERVER=dmFyIGh0dHA9cmVxdWlyZSgnaHR0cCcpLGZzPXJlcXVpcmUoJ2ZzJykscGF0aD1yZXF1aXJlKCdwYXRoJyksdXJsPXJlcXVpcmUoJ3VybCcpOwp2YXIgcm9vdD1wYXRoLnJlc29sdmUocHJvY2Vzcy5hcmd2WzJdfHxwcm9jZXNzLmN3ZCgpKTsKdmFyIHBvcnQ9cGFyc2VJbnQocHJvY2Vzcy5hcmd2WzNdfHwnODAwMCcsMTApOwp2YXIgdHlwZXM9eycuaHRtbCc6J3RleHQvaHRtbDsgY2hhcnNldD11dGYtOCcsJy5jc3MnOid0ZXh0L2NzczsgY2hhcnNldD11dGYtOCcsJy5qcyc6J2FwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRmLTgnLCcuanNvbic6J2FwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgnLCcucG5nJzonaW1hZ2UvcG5nJywnLmpwZyc6J2ltYWdlL2pwZWcnLCcuanBlZyc6J2ltYWdlL2pwZWcnLCcuc3ZnJzonaW1hZ2Uvc3ZnK3htbCcsJy5pY28nOidpbWFnZS94LWljb24nfTsKZnVuY3Rpb24gc2VuZChyZXMsY29kZSxib2R5LGhlYWRlcnMpe3Jlcy53cml0ZUhlYWQoY29kZSxoZWFkZXJzfHx7fSk7cmVzLmVuZChib2R5KTt9Cmh0dHAuY3JlYXRlU2VydmVyKGZ1bmN0aW9uKHJlcSxyZXMpewogIHZhciBwPSh1cmwucGFyc2UocmVxLnVybCkucGF0aG5hbWV8fCcvJyk7CiAgaWYocD09PScvJ3x8cD09PScnKSBwPScvcmVsYXRvcmlvX2F0dWFsLmh0bWwnOwogIHZhciByZWw9cC5yZXBsYWNlKC9eXC8rLywnJyk7CiAgdmFyIGZwPXBhdGgucmVzb2x2ZShwYXRoLmpvaW4ocm9vdCxyZWwpKTsKICBpZihmcC5pbmRleE9mKHJvb3QpIT09MCkgcmV0dXJuIHNlbmQocmVzLDQwMywnNDAzJyk7CiAgZnMuc3RhdChmcCxmdW5jdGlvbihlcnIsc3QpewogICAgaWYoZXJyfHwhc3QuaXNGaWxlKCkpIHJldHVybiBzZW5kKHJlcyw0MDQsJzQwNCcpOwogICAgdmFyIGV4dD1wYXRoLmV4dG5hbWUoZnApLnRvTG93ZXJDYXNlKCk7CiAgICByZXMud3JpdGVIZWFkKDIwMCx7J0NvbnRlbnQtVHlwZSc6KHR5cGVzW2V4dF18fCdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nKSwnQ2FjaGUtQ29udHJvbCc6J25vLXN0b3JlJ30pOwogICAgZnMuY3JlYXRlUmVhZFN0cmVhbShmcCkucGlwZShyZXMpOwogIH0pOwp9KS5saXN0ZW4ocG9ydCwnMC4wLjAuMCcsZnVuY3Rpb24oKXtjb25zb2xlLmxvZygnU0VSVklET1JfT0snLHBvcnQscm9vdCk7fSk7Cg=="

powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllBytes('%SERVER%',[Convert]::FromBase64String('%B64_SERVER%'))" >> "%BATLOG%" 2>&1
if errorlevel 1 (
  >>"%BATLOG%" echo ERRO: falha ao criar server js
  if "%AUTO%"=="0" pause
  exit /b 1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORTA% .*LISTENING"') do taskkill /PID %%P /F >nul 2>&1

> "%LOG%" echo INICIANDO %date% %time%

set "RUNVBS=%WEBROOT%\_run_hidden.vbs"
> "%RUNVBS%" echo Set sh=CreateObject("WScript.Shell")
>>"%RUNVBS%" echo sh.Run "cmd.exe /c """"%NODE_EXE%"" ""%SERVER%"" ""%WEBROOT%"" %PORTA% ^>^> ""%LOG%"" 2^>^&1""", 0, False
wscript.exe "%RUNVBS%"

set "OK="
for /l %%T in (1,1,6) do (
  netstat -ano | findstr /r /c:":%PORTA% .*LISTENING" >nul && (set "OK=1" & goto ok)
  timeout /t 1 >nul
)

if not defined OK (
  >>"%BATLOG%" echo ERRO: servidor nao subiu na porta %PORTA%
  if "%AUTO%"=="0" (
    type "%LOG%"
    pause
  )
  exit /b 1
)

:ok
>>"%BATLOG%" echo SERVIDOR_OK

if "%AUTO%"=="0" (
  start "" "%OUT%"
)

exit /b 0

:instalar
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\FDB_Relatorio_Web.lnk'; $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($lnk); $s.TargetPath='%~f0'; $s.Arguments='--auto'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()" >nul
if "%AUTO%"=="0" (
  echo Instalado na inicializacao.
  echo Link rede: http://%WEB_IP%:%PORTA%/
  pause
)
exit /b 0

:remover
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FDB_Relatorio_Web.lnk" >nul 2>&1
if "%AUTO%"=="0" (
  echo Removido da inicializacao.
  pause
)
exit /b 0
