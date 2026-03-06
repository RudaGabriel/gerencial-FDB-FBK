@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "PORTA=8000"
set "WEBROOT=%LOCALAPPDATA%\FDB_REL_WEB"
set "HIST=%WEBROOT%\historico"
set "ATUAL=%WEBROOT%\relatorio_atual.html"
set "SERVER=%WEBROOT%\_server_fdb_rel.js"
set "GENSCRIPTFILE=%WEBROOT%\_gen_script.txt"
set "LOG=%WEBROOT%\server.log"
set "BATLOG=%WEBROOT%\bat.log"
set "KEYFILE=%WEBROOT%\_srv.key"
set "PROIB=%WEBROOT%\_proibidos.txt"
set "PROIB_BAK=%WEBROOT%\_proibidos.bak"
set "AUTO=0"
if /i "%~1"=="--auto" set "AUTO=1"
if /i "%~1"=="--instalar" goto instalar
if /i "%~1"=="--remover" goto remover
if not exist "%WEBROOT%" mkdir "%WEBROOT%" >nul 2>&1
if not exist "%HIST%" mkdir "%HIST%" >nul 2>&1
if not exist "%PROIB%" type nul > "%PROIB%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$max=1000KB;$min=(Get-Date).AddDays(-7);$f='%BATLOG%';if(Test-Path -LiteralPath $f){$raw=Get-Content -LiteralPath $f -Raw -ErrorAction SilentlyContinue;$parts=[regex]::Split([string]$raw,'(?m)(?=^INICIO )')|Where-Object{$_};$keep=New-Object System.Collections.Generic.List[string];foreach($c in $parts){if($c -match '(?m)^INICIO (\d{2})/(\d{2})/(\d{4})'){try{$dt=Get-Date -Day $matches[1] -Month $matches[2] -Year $matches[3];if($dt -ge $min){$keep.Add($c)}}catch{$keep.Add($c)}}else{$keep.Add($c)}};$txt=($keep -join '');while([Text.Encoding]::UTF8.GetByteCount($txt) -gt $max -and $keep.Count -gt 1){$keep.RemoveAt(0);$txt=($keep -join '')};Set-Content -LiteralPath $f -Value $txt -Encoding UTF8}" >nul 2>&1
attrib +h "%WEBROOT%" >nul 2>&1
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE (
  >"%BATLOG%" echo ERRO: node nao encontrado no PATH
  if "%AUTO%"=="0" pause
  exit /b 1
)
set "WEB_IP="
for /f "delims=" %%I in ('powershell -NoProfile -Command "$r=Get-NetRoute -AddressFamily IPv4 ^| Where-Object { $_.DestinationPrefix -eq ''0.0.0.0/0'' -and $_.NextHop -ne ''0.0.0.0'' } ^| Sort-Object RouteMetric,InterfaceMetric ^| Select-Object -First 1; if($r){ Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike ''169.254*'' -and $_.IPAddress -ne ''127.0.0.1'' } ^| Select-Object -First 1 -ExpandProperty IPAddress }" 2^>nul') do if not defined WEB_IP set "WEB_IP=%%I"
if not defined WEB_IP for /f "delims=" %%I in ('powershell -NoProfile -Command "$c=Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq ''Up'' -and $_.IPv4Address -and $_.InterfaceAlias -notmatch ''VMware|WARP|VirtualBox|Hyper-V|vEthernet'' } ^| Select-Object -First 1; if($c){ $c.IPv4Address.IPAddress }" 2^>nul') do if not defined WEB_IP set "WEB_IP=%%I"
if not defined WEB_IP for /f "delims=" %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike ''169.254*'' -and $_.IPAddress -ne ''127.0.0.1'' } ^| Select-Object -First 1 -ExpandProperty IPAddress)" 2^>nul') do if not defined WEB_IP set "WEB_IP=%%I"
if not defined WEB_IP set "WEB_IP=127.0.0.1"
set "REDE_HOST=%WEB_IP%"
if /i "%REDE_HOST%"=="127.0.0.1" set "REDE_HOST=%COMPUTERNAME%"
if not exist "%KEYFILE%" powershell -NoProfile -ExecutionPolicy Bypass -Command "[guid]::NewGuid().ToString('N')" > "%KEYFILE%"
set "SRVKEY="
for /f "usebackq delims=" %%K in ("%KEYFILE%") do if not defined SRVKEY set "SRVKEY=%%K"
if not defined SRVKEY (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[guid]::NewGuid().ToString('N')" > "%KEYFILE%"
  for /f "usebackq delims=" %%K in ("%KEYFILE%") do if not defined SRVKEY set "SRVKEY=%%K"
)
attrib +h +s "%KEYFILE%" >nul 2>&1
set "FDB="
for %%P in ("%ProgramFiles(x86)%\SmallSoft\Small Commerce\SMALL.FDB" "%ProgramFiles%\SmallSoft\Small Commerce\SMALL.FDB" "%ProgramData%\SmallSoft\Small Commerce\SMALL.FDB") do if not defined FDB if exist "%%~fP" set "FDB=%%~fP"
if not defined FDB for /f "delims=" %%F in ('where /r "%ProgramFiles(x86)%" SMALL.FDB 2^>nul') do if not defined FDB set "FDB=%%F"
if not defined FDB for /f "delims=" %%F in ('where /r "%ProgramFiles%" SMALL.FDB 2^>nul') do if not defined FDB set "FDB=%%F"
if not defined FDB (
  >"%BATLOG%" echo ERRO: SMALL.FDB nao encontrado
  if "%AUTO%"=="0" pause
  exit /b 1
)
set "SCRIPT="
for %%P in ("%~dp0gerar-relatorio-html.js" "%~dp0\gerar-relatorio-html.js" "%userprofile%\desktop\gerar-relatorio-html.js" "%userprofile%\documents\gerar-relatorio-html.js" "%userprofile%\downloads\gerar-relatorio-html.js") do if not defined SCRIPT if exist "%%~fP" set "SCRIPT=%%~fP"
if not defined SCRIPT for /f "delims=" %%F in ('where /r "%~dp0" gerar-relatorio-html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
if not defined SCRIPT (
  >"%BATLOG%" echo ERRO: gerar-relatorio-html.js nao encontrado
  if "%AUTO%"=="0" pause
  exit /b 1
)
set "SRV_SRC="
for %%P in ("%~dp0\_server_fdb_rel.js" "%~dp0_server_fdb_rel.js" "%WEBROOT%\_server_fdb_rel.js" "%userprofile%\desktop\_server_fdb_rel.js" "%userprofile%\documents\_server_fdb_rel.js" "%userprofile%\downloads\_server_fdb_rel.js") do if not defined SRV_SRC if exist "%%~fP" set "SRV_SRC=%%~fP"
if not defined SRV_SRC for /f "delims=" %%F in ('where /r "%~dp0" _server_fdb_rel.js 2^>nul') do if not defined SRV_SRC set "SRV_SRC=%%F"
if not defined SRV_SRC call :criar_server
if not defined SRV_SRC (
  >"%BATLOG%" echo ERRO: _server_fdb_rel.js nao encontrado e nao foi possivel criar no WEBROOT
  if "%AUTO%"=="0" pause
  exit /b 1
)
if /i not "%SRV_SRC%"=="%SERVER%" copy /y "%SRV_SRC%" "%SERVER%" >nul 2>&1
attrib +h +s "%SERVER%" >nul 2>&1
> "%BATLOG%" echo INICIO %date% %time%
>>"%BATLOG%" echo WEBROOT=%WEBROOT%
>>"%BATLOG%" echo PORTA=%PORTA%
>>"%BATLOG%" echo IP=%WEB_IP%
>>"%BATLOG%" echo HOST_REDE=%REDE_HOST%
>>"%BATLOG%" echo NODE=%NODE_EXE%
>>"%BATLOG%" echo FDB=%FDB%
>>"%BATLOG%" echo SCRIPT=%SCRIPT%
>>"%BATLOG%" echo GENSCRIPTFILE=%GENSCRIPTFILE%
>>"%BATLOG%" echo SERVER=%SERVER%
attrib +h +s "%BATLOG%" "%LOG%" >nul 2>&1
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "DATA=%%i"
for /f "tokens=1-3 delims=-" %%a in ("%DATA%") do (set "YYYY=%%a" & set "MM=%%b" & set "DD=%%c")
set "DATA_ARQ=%DD%-%MM%-%YYYY%"
set "OUT=%ATUAL%"
set "FDB_SRV_KEY=%SRVKEY%"
set "FDB_SRV_BASE_LOCAL=http://127.0.0.1:%PORTA%"
set "FDB_SRV_BASE_REDE=http://%REDE_HOST%:%PORTA%"
copy /y "%PROIB%" "%PROIB_BAK%" >nul 2>&1
cd /d "%~dp0"
"%NODE_EXE%" "%SCRIPT%" --fdb "%FDB%" --data "%DATA%" --saida "%OUT%" --user SYSDBA --pass masterkey >> "%BATLOG%" 2>&1
if errorlevel 1 (
  >>"%BATLOG%" echo ERRO: falha ao gerar relatorio
  if "%AUTO%"=="0" pause
  exit /b 1
)
if exist "%PROIB_BAK%" powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%PROIB%';$b='%PROIB_BAK%';$a=@();if(Test-Path $b){$a+=Get-Content -LiteralPath $b -Encoding UTF8};$c=@();if(Test-Path $p){$c+=Get-Content -LiteralPath $p -Encoding UTF8};$seen=@{};$out=@();foreach($l in ($a+$c)){$n=([string]$l).Trim().ToUpper();$n=$n -replace '\s+',' ';if($n -and -not $seen.ContainsKey($n)){$seen[$n]=$true;$out+=$n}};Set-Content -LiteralPath $p -Value $out -Encoding UTF8" >nul 2>&1
del /q "%PROIB_BAK%" >nul 2>&1
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format HH-mm"') do set "HHMM=%%t"
copy /y "%OUT%" "%HIST%\(FDB-DIA)_relatorio_%DATA_ARQ%_%HHMM%.html" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=(Get-Date).Date; Get-ChildItem -LiteralPath '%HIST%' -File -Filter '*.html' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime.Date -ne $d } | Remove-Item -Force -ErrorAction SilentlyContinue" >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORTA% .*LISTENING"') do taskkill /PID %%P /F >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*_srv_loop.cmd*' -or $_.CommandLine -like '*_start_server.cmd*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
> "%LOG%" echo INICIANDO %date% %time%
set "SRVLOOP=%WEBROOT%\_srv_loop.cmd"
> "%SRVLOOP%" echo @echo off
>>"%SRVLOOP%" echo setlocal EnableExtensions
>>"%SRVLOOP%" echo chcp 65001 ^>nul
>>"%SRVLOOP%" echo title FDB_REL_SRV
>>"%SRVLOOP%" echo set "FDB_FILE=%FDB%"
>>"%SRVLOOP%" echo set "GEN_SCRIPT=%SCRIPT%"
>>"%SRVLOOP%" echo set "GEN_SCRIPT_FILE=%GENSCRIPTFILE%"
>>"%SRVLOOP%" echo set "DBUSER=SYSDBA"
>>"%SRVLOOP%" echo set "DBPASS=masterkey"
>>"%SRVLOOP%" echo set "SRVKEY=%SRVKEY%"
>>"%SRVLOOP%" echo set "WEB_IP=%REDE_HOST%"
>>"%SRVLOOP%" echo set "PORTA=%PORTA%"
>>"%SRVLOOP%" echo set "LOG_FILE=%LOG%"
>>"%SRVLOOP%" echo :loop
>>"%SRVLOOP%" echo "%NODE_EXE%" "%SERVER%" "%WEBROOT%" %PORTA%
>>"%SRVLOOP%" echo timeout /t 2 /nobreak ^>nul
>>"%SRVLOOP%" echo goto loop
attrib +h +s "%SRVLOOP%" >nul 2>&1
set "RUNVBS=%WEBROOT%\_run_hidden.vbs"
> "%RUNVBS%" echo Set sh=CreateObject("WScript.Shell")
>>"%RUNVBS%" echo sh.Run "cmd.exe /c ""call """"%SRVLOOP%""""""", 0, False
attrib +h +s "%RUNVBS%" >nul 2>&1
wscript.exe "%RUNVBS%"
set "OK="
for /l %%T in (1,1,8) do (
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
if "%AUTO%"=="0" start "" "http://127.0.0.1:%PORTA%/"
exit /b 0
:criar_server
set "B64=%WEBROOT%\_server_fdb_rel.b64"
> "%B64%" echo Y29uc3QgaHR0cD1yZXF1aXJlKCJodHRwIiksZnM9cmVxdWlyZSgiZnMiKSxwYXRoPXJlcXVpcmUo
>>"%B64%" echo InBhdGgiKSx1cmw9cmVxdWlyZSgidXJsIiksY3A9cmVxdWlyZSgiY2hpbGRfcHJvY2VzcyIpOwpj
>>"%B64%" echo b25zdCByb290PXBhdGgucmVzb2x2ZShwcm9jZXNzLmFyZ3ZbMl18fHByb2Nlc3MuY3dkKCkpOwpj
>>"%B64%" echo b25zdCBwb3J0PXBhcnNlSW50KHByb2Nlc3MuYXJndlszXXx8cHJvY2Vzcy5lbnYuUE9SVEF8fCI4
>>"%B64%" echo MDAwIiwxMCk7CmNvbnN0IHR5cGVzPXsiLmh0bWwiOiJ0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLTgi
>>"%B64%" echo LCIuY3NzIjoidGV4dC9jc3M7IGNoYXJzZXQ9dXRmLTgiLCIuanMiOiJhcHBsaWNhdGlvbi9qYXZh
>>"%B64%" echo c2NyaXB0OyBjaGFyc2V0PXV0Zi04IiwiLmpzb24iOiJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0
>>"%B64%" echo PXV0Zi04IiwiLnBuZyI6ImltYWdlL3BuZyIsIi5qcGciOiJpbWFnZS9qcGVnIiwiLmpwZWciOiJp
>>"%B64%" echo bWFnZS9qcGVnIiwiLnN2ZyI6ImltYWdlL3N2Zyt4bWwiLCIuaWNvIjoiaW1hZ2UveC1pY29uIiwi
>>"%B64%" echo LnR4dCI6InRleHQvcGxhaW47IGNoYXJzZXQ9dXRmLTgifTsKY29uc3Qgc3Q9e3J1bm5pbmc6ZmFs
>>"%B64%" echo c2UsbGFzdF9zdGFydDowLGxhc3RfZW5kOjAsbGFzdF9vazowLGxhc3RfZXJyOiIiLG5leHRfcnVu
>>"%B64%" echo OjAsdG06bnVsbH07CmNvbnN0IGZkYj1TdHJpbmcocHJvY2Vzcy5lbnYuRkRCX0ZJTEV8fCIiKS50
>>"%B64%" echo cmltKCk7CmNvbnN0IHNjcmlwdD1TdHJpbmcocHJvY2Vzcy5lbnYuR0VOX1NDUklQVHx8IiIpLnRy
>>"%B64%" echo aW0oKTsKY29uc3QgZGJ1c2VyPVN0cmluZyhwcm9jZXNzLmVudi5EQlVTRVJ8fCJTWVNEQkEiKS50
>>"%B64%" echo cmltKCk7CmNvbnN0IGRicGFzcz1TdHJpbmcocHJvY2Vzcy5lbnYuREJQQVNTfHwibWFzdGVya2V5
>>"%B64%" echo IikudHJpbSgpOwpjb25zdCBrZXk9U3RyaW5nKHByb2Nlc3MuZW52LlNSVktFWXx8IiIpLnRyaW0o
>>"%B64%" echo KTsKY29uc3Qgd2ViaXA9U3RyaW5nKHByb2Nlc3MuZW52LldFQl9JUHx8IjEyNy4wLjAuMSIpLnRy
>>"%B64%" echo aW0oKTsKY29uc3QgaGlzdD1wYXRoLmpvaW4ocm9vdCwiaGlzdG9yaWNvIik7CmNvbnN0IGF0dWFs
>>"%B64%" echo PXBhdGguam9pbihyb290LCJyZWxhdG9yaW9fYXR1YWwuaHRtbCIpOwpjb25zdCB0bXA9cGF0aC5q
>>"%B64%" echo b2luKHJvb3QsIl90bXBfcmVsYXRvcmlvLmh0bWwiKTsKY29uc3QgcHJvaWJGaWxlPXBhdGguam9p
>>"%B64%" echo bihyb290LCJfcHJvaWJpZG9zLnR4dCIpOwpjb25zdCBNUzE1PTE1KjYwKjEwMDA7CmNvbnN0IGVu
>>"%B64%" echo c3VyZURpcj1wPT57aWYoIWZzLmV4aXN0c1N5bmMocCkpZnMubWtkaXJTeW5jKHAse3JlY3Vyc2l2
>>"%B64%" echo ZTp0cnVlfSk7fTsKY29uc3Qgbm9ybVA9cz0+U3RyaW5nKHN8fCIiKS50cmltKCkudG9VcHBlckNh
>>"%B64%" echo c2UoKS5yZXBsYWNlKC9ccysvZywiICIpOwpjb25zdCBzcGxpdFR4dD1zPT5TdHJpbmcoc3x8IiIp
>>"%B64%" echo LnNwbGl0KC9ccj9cbnwsfDt8XHwvZykubWFwKG5vcm1QKS5maWx0ZXIoQm9vbGVhbik7CmNvbnN0
>>"%B64%" echo IHBhcnNlSW5jb21pbmc9cz0+ewpzPVN0cmluZyhzfHwiIik7CmNvbnN0IHQ9cy50cmltKCk7Cmlm
>>"%B64%" echo KCF0KXJldHVybltdOwpsZXQgbT10Lm1hdGNoKC8ibGlzdGEiXHMqOlxzKlxbKFtcc1xTXSo/KVxd
>>"%B64%" echo L2kpOwpsZXQgaW5zaWRlPW0/bVsxXTpudWxsOwppZighaW5zaWRlJiZ0WzBdPT09IlsiJiZ0W3Qu
>>"%B64%" echo bGVuZ3RoLTFdPT09Il0iKWluc2lkZT10LnNsaWNlKDEsLTEpOwppZihpbnNpZGUhPW51bGwpewpj
>>"%B64%" echo b25zdCBvdXQ9W107Cmluc2lkZS5yZXBsYWNlKC8iKCg/OlxcLnxbXiJcXF0pKikiL2csKF8sdik9
>>"%B64%" echo PntvdXQucHVzaChub3JtUCh2LnJlcGxhY2UoL1xcIi9nLCciJykucmVwbGFjZSgvXFxuL2csIlxu
>>"%B64%" echo IikucmVwbGFjZSgvXFxyL2csIlxyIikucmVwbGFjZSgvXFx0L2csIlx0IikpKTtyZXR1cm4iIjt9
>>"%B64%" echo KTsKcmV0dXJuIG91dC5maWx0ZXIoQm9vbGVhbik7Cn0KcmV0dXJuIHNwbGl0VHh0KHQpOwp9Owpj
>>"%B64%" echo b25zdCBtZXJnZUxpc3Q9KGEsYik9PnsKY29uc3Qgc2Vlbj1uZXcgU2V0KCk7CmNvbnN0IG91dD1b
>>"%B64%" echo XTsKZm9yKGNvbnN0IHYgb2YgKGF8fFtdKSl7Y29uc3Qgbj1ub3JtUCh2KTtpZihuJiYhc2Vlbi5o
>>"%B64%" echo YXMobikpe3NlZW4uYWRkKG4pO291dC5wdXNoKG4pO319CmZvcihjb25zdCB2IG9mIChifHxbXSkp
>>"%B64%" echo e2NvbnN0IG49bm9ybVAodik7aWYobiYmIXNlZW4uaGFzKG4pKXtzZWVuLmFkZChuKTtvdXQucHVz
>>"%B64%" echo aChuKTt9fQpyZXR1cm4gb3V0Owp9Owpjb25zdCBsZXJQcm9pYlN5bmM9KCk9PntpZighZnMuZXhp
>>"%B64%" echo c3RzU3luYyhwcm9pYkZpbGUpKXJldHVybltdO3JldHVybiBzcGxpdFR4dChmcy5yZWFkRmlsZVN5
>>"%B64%" echo bmMocHJvaWJGaWxlLCJ1dGY4IikpO307CmNvbnN0IHNhbHZhclByb2liU3luYz1hcnI9Pntmcy53
>>"%B64%" echo cml0ZUZpbGVTeW5jKHByb2liRmlsZSwoYXJyfHxbXSkubWFwKG5vcm1QKS5maWx0ZXIoQm9vbGVh
>>"%B64%" echo bikuam9pbigiXG4iKSwidXRmOCIpO307CmNvbnN0IGlzb0RhdGU9ZD0+YCR7ZC5nZXRGdWxsWWVh
>>"%B64%" echo cigpfS0ke1N0cmluZyhkLmdldE1vbnRoKCkrMSkucGFkU3RhcnQoMiwiMCIpfS0ke1N0cmluZyhk
>>"%B64%" echo LmdldERhdGUoKSkucGFkU3RhcnQoMiwiMCIpfWA7CmNvbnN0IG9rSnNvbj0ocmVzLG9iaixjb2Rl
>>"%B64%" echo PTIwMCxleHRyYSk9PntyZXMud3JpdGVIZWFkKGNvZGUsT2JqZWN0LmFzc2lnbih7IkNvbnRlbnQt
>>"%B64%" echo VHlwZSI6ImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgiLCJDYWNoZS1Db250cm9sIjoi
>>"%B64%" echo bm8tc3RvcmUifSxleHRyYXx8e30pKTtyZXMuZW5kKEpTT04uc3RyaW5naWZ5KG9ianx8e30pKTt9
>>"%B64%" echo Owpjb25zdCBiYWQ9KHJlcyxjb2RlLG1zZyk9PntyZXMud3JpdGVIZWFkKGNvZGUseyJDb250ZW50
>>"%B64%" echo LVR5cGUiOiJ0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04IiwiQ2FjaGUtQ29udHJvbCI6Im5vLXN0
>>"%B64%" echo b3JlIn0pO3Jlcy5lbmQoU3RyaW5nKG1zZ3x8Y29kZSkpO307CmNvbnN0IGNvcnM9KCk9Pih7IkFj
>>"%B64%" echo Y2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiI6IioiLCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFk
>>"%B64%" echo ZXJzIjoieC1rZXksY29udGVudC10eXBlIiwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyI6
>>"%B64%" echo IkdFVCxQT1NULE9QVElPTlMiLCJBY2Nlc3MtQ29udHJvbC1NYXgtQWdlIjoiNjAwIn0pOwpjb25z
>>"%B64%" echo dCBzZXJ2ZUZpbGU9KHJlcyxmcCk9PnsKZnMuc3RhdChmcCwoZSxzKT0+ewppZihlfHwhcy5pc0Zp
>>"%B64%" echo bGUoKSlyZXR1cm4gYmFkKHJlcyw0MDQsIjQwNCIpOwpjb25zdCBleHQ9cGF0aC5leHRuYW1lKGZw
>>"%B64%" echo KS50b0xvd2VyQ2FzZSgpOwpyZXMud3JpdGVIZWFkKDIwMCx7IkNvbnRlbnQtVHlwZSI6dHlwZXNb
>>"%B64%" echo ZXh0XXx8ImFwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSIsIkNhY2hlLUNvbnRyb2wiOiJuby1zdG9y
>>"%B64%" echo ZSJ9KTsKZnMuY3JlYXRlUmVhZFN0cmVhbShmcCkucGlwZShyZXMpOwp9KTsKfTsKY29uc3QgY2xl
>>"%B64%" echo YW5IaXN0PWQ9PnsKZW5zdXJlRGlyKGhpc3QpOwpjb25zdCBtaWQ9bmV3IERhdGUoZC5nZXRGdWxs
>>"%B64%" echo WWVhcigpLGQuZ2V0TW9udGgoKSxkLmdldERhdGUoKSkuZ2V0VGltZSgpOwpmcy5yZWFkZGlyKGhp
>>"%B64%" echo c3QsKGUsbGlzdCk9PnsKaWYoZXx8IUFycmF5LmlzQXJyYXkobGlzdCl8fCFsaXN0Lmxlbmd0aCly
>>"%B64%" echo ZXR1cm47CmZvcihjb25zdCBuYW1lIG9mIGxpc3QpewppZighbmFtZXx8IS9cLmh0bWwkL2kudGVz
>>"%B64%" echo dChuYW1lKSljb250aW51ZTsKY29uc3QgZnA9cGF0aC5qb2luKGhpc3QsbmFtZSk7CmZzLnN0YXQo
>>"%B64%" echo ZnAsKGUyLHMpPT57CmlmKGUyfHwhc3x8IXMuaXNGaWxlKCkpcmV0dXJuOwpjb25zdCBtdD1OdW1i
>>"%B64%" echo ZXIocy5tdGltZU1zfHwwKTsKaWYobXQmJm10PG1pZClmcy51bmxpbmsoZnAsKCk9Pnt9KTsKfSk7
>>"%B64%" echo Cn0KfSk7Cn07CmNvbnN0IHNjaGVkdWxlSW49bXM9PnsKaWYoc3QudG0pY2xlYXJUaW1lb3V0KHN0
>>"%B64%" echo LnRtKTsKaWYobXM8MTAwMCltcz0xMDAwOwpzdC5uZXh0X3J1bj1EYXRlLm5vdygpK21zOwpzdC50
>>"%B64%" echo bT1zZXRUaW1lb3V0KCgpPT57Z2VyYXIoImF1dG8iKS50aGVuKCgpPT5zY2hlZHVsZUluKE1TMTUp
>>"%B64%" echo KTt9LG1zKTsKfTsKY29uc3QgaW5pdFNjaGVkdWxlPSgpPT57CmxldCBtcz1NUzE1OwppZihmcy5l
>>"%B64%" echo eGlzdHNTeW5jKGF0dWFsKSl7CmNvbnN0IG09ZnMuc3RhdFN5bmMoYXR1YWwpLm10aW1lTXM7CmNv
>>"%B64%" echo bnN0IG5leHQ9bStNUzE1Owpjb25zdCBub3c9RGF0ZS5ub3coKTsKaWYobmV4dD5ub3crMTAwMClt
>>"%B64%" echo cz1uZXh0LW5vdzsKfQpzY2hlZHVsZUluKG1zKTsKfTsKY29uc3QgZ2VyYXI9KG1vdGl2byk9PnsK
>>"%B64%" echo aWYoc3QucnVubmluZylyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtvazpmYWxzZSxlc3RhZG86InJ1
>>"%B64%" echo bm5pbmcifSk7CmlmKCFmZGJ8fCFzY3JpcHQpcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7b2s6ZmFs
>>"%B64%" echo c2UsZXN0YWRvOiJzZW1fY2ZnIn0pOwpzdC5ydW5uaW5nPXRydWU7CnN0Lmxhc3Rfc3RhcnQ9RGF0
>>"%B64%" echo ZS5ub3coKTsKc3QubGFzdF9lcnI9IiI7CmNvbnN0IGQ9bmV3IERhdGUoKTsKY29uc3QgZGF0YUlT
>>"%B64%" echo Tz1pc29EYXRlKGQpOwpjb25zdCBlbnY9T2JqZWN0LmFzc2lnbih7fSxwcm9jZXNzLmVudix7RkRC
>>"%B64%" echo X1NSVl9LRVk6a2V5LEZEQl9TUlZfQkFTRV9MT0NBTDpgaHR0cDovLzEyNy4wLjAuMToke3BvcnR9
>>"%B64%" echo YCxGREJfU1JWX0JBU0VfUkVERTpgaHR0cDovLyR7d2ViaXB9OiR7cG9ydH1gfSk7CnJldHVybiBu
>>"%B64%" echo ZXcgUHJvbWlzZShyZXM9PnsKZW5zdXJlRGlyKGhpc3QpOwpjb25zdCBhcmdzPVtzY3JpcHQsIi0t
>>"%B64%" echo ZmRiIixmZGIsIi0tZGF0YSIsZGF0YUlTTywiLS1zYWlkYSIsdG1wLCItLXVzZXIiLGRidXNlciwi
>>"%B64%" echo LS1wYXNzIixkYnBhc3NdOwpjb25zdCBwPWNwLnNwYXduKHByb2Nlc3MuZXhlY1BhdGgsYXJncyx7
>>"%B64%" echo ZW52LHdpbmRvd3NIaWRlOnRydWV9KTsKbGV0IG91dD0iIjsKcC5zdGRvdXQub24oImRhdGEiLGI9
>>"%B64%" echo PntvdXQrPVN0cmluZyhifHwiIik7fSk7CnAuc3RkZXJyLm9uKCJkYXRhIixiPT57b3V0Kz1TdHJp
>>"%B64%" echo bmcoYnx8IiIpO30pOwpwLm9uKCJjbG9zZSIsY29kZT0+ewpzdC5ydW5uaW5nPWZhbHNlOwpzdC5s
>>"%B64%" echo YXN0X2VuZD1EYXRlLm5vdygpOwppZihjb2RlPT09MCYmZnMuZXhpc3RzU3luYyh0bXApKXsKY29u
>>"%B64%" echo c3QgZGQ9U3RyaW5nKGQuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCIwIik7CmNvbnN0IG1tPVN0cmlu
>>"%B64%" echo ZyhkLmdldE1vbnRoKCkrMSkucGFkU3RhcnQoMiwiMCIpOwpjb25zdCB5eT1TdHJpbmcoZC5nZXRG
>>"%B64%" echo dWxsWWVhcigpKTsKY29uc3QgaGg9U3RyaW5nKGQuZ2V0SG91cnMoKSkucGFkU3RhcnQoMiwiMCIp
>>"%B64%" echo Owpjb25zdCBtaT1TdHJpbmcoZC5nZXRNaW51dGVzKCkpLnBhZFN0YXJ0KDIsIjAiKTsKY29uc3Qg
>>"%B64%" echo aGlzdEZpbGU9cGF0aC5qb2luKGhpc3QsYChGREItRElBKV9yZWxhdG9yaW9fJHtkZH0tJHttbX0t
>>"%B64%" echo JHt5eX1fJHtoaH0tJHttaX1fZ2VyZW5jaWFsX3Bvcl92ZW5kZWRvci5odG1sYCk7CmZzLmNvcHlG
>>"%B64%" echo aWxlU3luYyh0bXAsYXR1YWwpOwpmcy5jb3B5RmlsZVN5bmModG1wLGhpc3RGaWxlKTsKZnMudW5s
>>"%B64%" echo aW5rU3luYyh0bXApOwpzdC5sYXN0X29rPURhdGUubm93KCk7CmNsZWFuSGlzdChkKTsKc2NoZWR1
>>"%B64%" echo bGVJbihNUzE1KTsKcmVzKHtvazp0cnVlLGVzdGFkbzoib2siLG1vdGl2byxzYWlkYV9hdHVhbDph
>>"%B64%" echo dHVhbCxuZXh0X3J1bjpzdC5uZXh0X3J1bn0pOwpyZXR1cm47Cn0Kc3QubGFzdF9lcnI9b3V0LnNs
>>"%B64%" echo aWNlKC0yMDAwKXx8KCJlcnJvICIrY29kZSk7CnNjaGVkdWxlSW4oTVMxNSk7CnJlcyh7b2s6ZmFs
>>"%B64%" echo c2UsZXN0YWRvOiJlcnJvIixjb2RlLGVycm86c3QubGFzdF9lcnIsbmV4dF9ydW46c3QubmV4dF9y
>>"%B64%" echo dW59KTsKfSk7Cn0pOwp9OwplbnN1cmVEaXIoaGlzdCk7CmNsZWFuSGlzdChuZXcgRGF0ZSgpKTsK
>>"%B64%" echo aWYoIWZzLmV4aXN0c1N5bmMocHJvaWJGaWxlKSlmcy53cml0ZUZpbGVTeW5jKHByb2liRmlsZSwi
>>"%B64%" echo IiwidXRmOCIpOwppbml0U2NoZWR1bGUoKTsKY29uc3Qgc3J2PWh0dHAuY3JlYXRlU2VydmVyKChy
>>"%B64%" echo ZXEscmVzKT0+ewpjb25zdCB1PXVybC5wYXJzZShyZXEudXJsfHwiIix0cnVlKTsKY29uc3QgcD1T
>>"%B64%" echo dHJpbmcodS5wYXRobmFtZXx8Ii8iKTsKaWYocmVxLm1ldGhvZD09PSJPUFRJT05TIil7cmVzLndy
>>"%B64%" echo aXRlSGVhZCgyMDQsY29ycygpKTtyZXMuZW5kKCk7cmV0dXJuO30KaWYocD09PSIvX19zdGF0dXMi
>>"%B64%" echo JiZyZXEubWV0aG9kPT09IkdFVCIpe29rSnNvbihyZXMse3J1bm5pbmc6c3QucnVubmluZyxsYXN0
>>"%B64%" echo X3N0YXJ0OnN0Lmxhc3Rfc3RhcnQsbGFzdF9lbmQ6c3QubGFzdF9lbmQsbGFzdF9vazpzdC5sYXN0
>>"%B64%" echo X29rLGxhc3RfZXJyOnN0Lmxhc3RfZXJyLG5leHRfcnVuOnN0Lm5leHRfcnVuLHBvcnR9LDIwMCxj
>>"%B64%" echo b3JzKCkpO3JldHVybjt9CmlmKHA9PT0iL19fZ2VyYXIiJiZyZXEubWV0aG9kPT09IlBPU1QiKXsK
>>"%B64%" echo Y29uc3Qgaz1TdHJpbmcocmVxLmhlYWRlcnNbIngta2V5Il18fCIiKS50cmltKCk7CmlmKCFrZXl8
>>"%B64%" echo fGshPT1rZXkpe29rSnNvbihyZXMse29rOmZhbHNlLGVzdGFkbzoidW5hdXRoIn0sNDAxLGNvcnMo
>>"%B64%" echo KSk7cmV0dXJuO30KaWYoc3QucnVubmluZyl7b2tKc29uKHJlcyx7b2s6ZmFsc2UsZXN0YWRvOiJy
>>"%B64%" echo dW5uaW5nIixydW5uaW5nOnRydWUsbGFzdF9zdGFydDpzdC5sYXN0X3N0YXJ0LGxhc3Rfb2s6c3Qu
>>"%B64%" echo bGFzdF9vayxuZXh0X3J1bjpzdC5uZXh0X3J1bn0sNDA5LGNvcnMoKSk7cmV0dXJuO30KZ2VyYXIo
>>"%B64%" echo Im1hbnVhbCIpLnRoZW4ocj0+b2tKc29uKHJlcyxyLDIwMCxjb3JzKCkpKTsKcmV0dXJuOwp9Cmlm
>>"%B64%" echo KHA9PT0iL19fcHJvaWJpZG9zIiYmcmVxLm1ldGhvZD09PSJHRVQiKXsKY29uc3QgbGlzdGE9bGVy
>>"%B64%" echo UHJvaWJTeW5jKCk7Cm9rSnNvbihyZXMse29rOnRydWUsbGlzdGF9LDIwMCxjb3JzKCkpOwpyZXR1
>>"%B64%" echo cm47Cn0KaWYocD09PSIvX19wcm9pYmlkb3MiJiZyZXEubWV0aG9kPT09IlBPU1QiKXsKY29uc3Qg
>>"%B64%" echo az1TdHJpbmcocmVxLmhlYWRlcnNbIngta2V5Il18fCIiKS50cmltKCk7CmlmKGsmJmtleSYmayE9
>>"%B64%" echo PWtleSl7b2tKc29uKHJlcyx7b2s6ZmFsc2UsZXN0YWRvOiJ1bmF1dGgifSw0MDEsY29ycygpKTty
>>"%B64%" echo ZXR1cm47fQpsZXQgYm9keT0iIjsKcmVxLm9uKCJkYXRhIixiPT57Ym9keSs9U3RyaW5nKGJ8fCIi
>>"%B64%" echo KTtpZihib2R5Lmxlbmd0aD4yMDAwMDApYm9keT1ib2R5LnNsaWNlKDAsMjAwMDAwKTt9KTsKcmVx
>>"%B64%" echo Lm9uKCJlbmQiLCgpPT57CmNvbnN0IGluYz1wYXJzZUluY29taW5nKGJvZHkpOwpjb25zdCBsaXN0
>>"%B64%" echo YTA9bGVyUHJvaWJTeW5jKCk7CmNvbnN0IG1lcmdlZD1tZXJnZUxpc3QobGlzdGEwLGluYyk7CnNh
>>"%B64%" echo bHZhclByb2liU3luYyhtZXJnZWQpOwpva0pzb24ocmVzLHtvazp0cnVlLGxpc3RhOm1lcmdlZH0s
>>"%B64%" echo MjAwLGNvcnMoKSk7Cn0pOwpyZXR1cm47Cn0KbGV0IHJlbD1wOwppZihyZWw9PT0iLyJ8fHJlbD09
>>"%B64%" echo PSIiKXJlbD0iL3JlbGF0b3Jpb19hdHVhbC5odG1sIjsKcmVsPXJlbC5yZXBsYWNlKC9eXC8rLywi
>>"%B64%" echo Iik7CmNvbnN0IGZwPXBhdGgucmVzb2x2ZShwYXRoLmpvaW4ocm9vdCxyZWwpKTsKaWYoZnAuaW5k
>>"%B64%" echo ZXhPZihyb290KSE9PTApcmV0dXJuIGJhZChyZXMsNDAzLCI0MDMiKTsKc2VydmVGaWxlKHJlcyxm
>>"%B64%" echo cCk7Cn0pOwpzcnYubGlzdGVuKHBvcnQsIjAuMC4wLjAiLCgpPT57Y29uc29sZS5sb2coIlNFUlZJ
>>"%B64%" echo RE9SX09LIixwb3J0LHJvb3QpO30pOwo=
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=Get-Content -LiteralPath '%WEBROOT%\_server_fdb_rel.b64' -Raw; [IO.File]::WriteAllBytes('%SERVER%',[Convert]::FromBase64String($b))" >nul 2>&1
del /q "%B64%" >nul 2>&1
if exist "%SERVER%" set "SRV_SRC=%SERVER%"
exit /b 0
:instalar
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\FDB_Relatorio_Web.lnk'; $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($lnk); $s.TargetPath='%~f0'; $s.Arguments='--auto'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()" >nul
schtasks /Create /F /TN "FDB_Relatorio_Web" /SC ONLOGON /TR "\"%~f0\" --auto" >nul 2>&1
schtasks /Create /F /TN "FDB_Relatorio_Web_BOOT" /SC ONSTART /RU "SYSTEM" /TR "\"%~f0\" --auto" >nul 2>&1
exit /b 0
:remover
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FDB_Relatorio_Web.lnk" >nul 2>&1
schtasks /Delete /F /TN "FDB_Relatorio_Web" >nul 2>&1
schtasks /Delete /F /TN "FDB_Relatorio_Web_BOOT" >nul 2>&1
exit /b 0
