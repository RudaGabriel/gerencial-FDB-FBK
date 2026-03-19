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
for %%P in ("%~dp0gerar-relatorio-html.js" "%~dp0\gerar-relatorio-html.js" "%userprofile%\desktop\REL\gerar-relatorio-html.js" "%userprofile%\desktop\gerar-relatorio-html.js" "%userprofile%\documents\gerar-relatorio-html.js" "%userprofile%\downloads\gerar-relatorio-html.js") do if not defined SCRIPT if exist "%%~fP" set "SCRIPT=%%~fP"
if not defined SCRIPT for /f "delims=" %%F in ('where /r "%~dp0" gerar-relatorio-html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
if not defined SCRIPT for %%D in (C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if not defined SCRIPT if exist "%%D:\\" (
    for /f "delims=" %%F in ('where /r "%%D:\\" gerar-relatorio-html.js 2^>nul') do if not defined SCRIPT set "SCRIPT=%%F"
  )
)
if not defined SCRIPT (
  >>"%BATLOG%" echo AVISO: gerar-relatorio-html.js nao encontrado. O servidor ira buscar automaticamente.
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
>>"%B64%" echo InBhdGgiKSxjcD1yZXF1aXJlKCJjaGlsZF9wcm9jZXNzIik7CmNvbnN0IHJvb3Q9cGF0aC5yZXNv
>>"%B64%" echo bHZlKHByb2Nlc3MuYXJndlsyXXx8cHJvY2Vzcy5jd2QoKSk7CmNvbnN0IHBvcnQ9cGFyc2VJbnQo
>>"%B64%" echo cHJvY2Vzcy5hcmd2WzNdfHxwcm9jZXNzLmVudi5QT1JUQXx8IjgwMDAiLDEwKTsKY29uc3QgdHlw
>>"%B64%" echo ZXM9eyIuaHRtbCI6InRleHQvaHRtbDsgY2hhcnNldD11dGYtOCIsIi5jc3MiOiJ0ZXh0L2Nzczsg
>>"%B64%" echo Y2hhcnNldD11dGYtOCIsIi5qcyI6ImFwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRm
>>"%B64%" echo LTgiLCIuanNvbiI6ImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgiLCIucG5nIjoiaW1h
>>"%B64%" echo Z2UvcG5nIiwiLmpwZyI6ImltYWdlL2pwZWciLCIuanBlZyI6ImltYWdlL2pwZWciLCIuc3ZnIjoi
>>"%B64%" echo aW1hZ2Uvc3ZnK3htbCIsIi5pY28iOiJpbWFnZS94LWljb24iLCIudHh0IjoidGV4dC9wbGFpbjsg
>>"%B64%" echo Y2hhcnNldD11dGYtOCJ9Owpjb25zdCBzdD17cnVubmluZzpmYWxzZSxsYXN0X3N0YXJ0OjAsbGFz
>>"%B64%" echo dF9lbmQ6MCxsYXN0X29rOjAsbGFzdF9lcnI6IiIsbmV4dF9ydW46MCx0bTpudWxsfTsKY29uc3Qg
>>"%B64%" echo ZmRiPVN0cmluZyhwcm9jZXNzLmVudi5GREJfRklMRXx8IiIpLnRyaW0oKTsKY29uc3QgZGJ1c2Vy
>>"%B64%" echo PVN0cmluZyhwcm9jZXNzLmVudi5EQlVTRVJ8fCJTWVNEQkEiKS50cmltKCk7CmNvbnN0IGRicGFz
>>"%B64%" echo cz1TdHJpbmcocHJvY2Vzcy5lbnYuREJQQVNTfHwibWFzdGVya2V5IikudHJpbSgpOwpjb25zdCBr
>>"%B64%" echo ZXk9U3RyaW5nKHByb2Nlc3MuZW52LlNSVktFWXx8IiIpLnRyaW0oKTsKY29uc3Qgd2ViaXA9U3Ry
>>"%B64%" echo aW5nKHByb2Nlc3MuZW52LldFQl9JUHx8IjEyNy4wLjAuMSIpLnRyaW0oKTsKY29uc3QgaGlzdD1w
>>"%B64%" echo YXRoLmpvaW4ocm9vdCwiaGlzdG9yaWNvIik7CmNvbnN0IGF0dWFsPXBhdGguam9pbihyb290LCJy
>>"%B64%" echo ZWxhdG9yaW9fYXR1YWwuaHRtbCIpOwpjb25zdCB0bXA9cGF0aC5qb2luKHJvb3QsIl90bXBfcmVs
>>"%B64%" echo YXRvcmlvLmh0bWwiKTsKY29uc3QgY29uZlNjcmlwdD1wYXRoLmpvaW4ocm9vdCwiX2dlbl9zY3Jp
>>"%B64%" echo cHQudHh0Iik7CmNvbnN0IGxvZ0ZpbGU9U3RyaW5nKHByb2Nlc3MuZW52LkxPR19GSUxFfHxwYXRo
>>"%B64%" echo LmpvaW4ocm9vdCwic2VydmVyLmxvZyIpKS50cmltKCk7CmNvbnN0IE1BWF9MT0dfQllURVM9MTAw
>>"%B64%" echo MCoxMDI0Owpjb25zdCBNQVhfTE9HX0FHRT03KjI0KjYwKjYwKjEwMDA7CmNvbnN0IE1TMTU9MTUq
>>"%B64%" echo NjAqMTAwMDsKY29uc3QgdWE9KCk9PlN0cmluZyhwcm9jZXNzLmVudi5VU0VSUFJPRklMRXx8IiIp
>>"%B64%" echo LnRyaW0oKTsKY29uc3QgZW5zdXJlRGlyPXA9PntpZighZnMuZXhpc3RzU3luYyhwKSlmcy5ta2Rp
>>"%B64%" echo clN5bmMocCx7cmVjdXJzaXZlOnRydWV9KTt9Owpjb25zdCBwcm9pYkZpbGU9cGF0aC5qb2luKHJv
>>"%B64%" echo b3QsIl9wcm9pYmlkb3MudHh0Iik7CmNvbnN0IG5vcm1QPXM9PlN0cmluZyhzfHwiIikudHJpbSgp
>>"%B64%" echo LnRvVXBwZXJDYXNlKCkucmVwbGFjZSgvXHMrL2csIiAiKTsKY29uc3QgdW5pcT1hPT5bLi4ubmV3
>>"%B64%" echo IFNldCgoYXx8W10pLmZpbHRlcihCb29sZWFuKSldOwpjb25zdCBwYXJzZUxpc3RhPXM9PnVuaXEo
>>"%B64%" echo U3RyaW5nKHN8fCIiKS5zcGxpdCgvXG58LC9nKS5tYXAobm9ybVApLmZpbHRlcihCb29sZWFuKSk7
>>"%B64%" echo CmNvbnN0IGxlclByb2liPWNiPT57ZnMucmVhZEZpbGUocHJvaWJGaWxlLCJ1dGY4IiwoZSx0eHQp
>>"%B64%" echo PT57Y2IocGFyc2VMaXN0YShlPyIiOnR4dCkpO30pO307CmNvbnN0IHNhbHZhclByb2liPShhcnIs
>>"%B64%" echo Y2IpPT57ZnMud3JpdGVGaWxlKHByb2liRmlsZSx1bmlxKGFycikubWFwKG5vcm1QKS5maWx0ZXIo
>>"%B64%" echo Qm9vbGVhbikuam9pbigiXG4iKSwidXRmOCIsKCk9PntjYiYmY2IoKTt9KTt9OwpsZXQgcmVxSWQ9
>>"%B64%" echo MDsKY29uc3Qgc3RhbXA9KCk9Pntjb25zdCBkPW5ldyBEYXRlKCk7cmV0dXJuIGAke2QuZ2V0RnVs
>>"%B64%" echo bFllYXIoKX0tJHtTdHJpbmcoZC5nZXRNb250aCgpKzEpLnBhZFN0YXJ0KDIsIjAiKX0tJHtTdHJp
>>"%B64%" echo bmcoZC5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsIjAiKX0gJHtTdHJpbmcoZC5nZXRIb3VycygpKS5w
>>"%B64%" echo YWRTdGFydCgyLCIwIil9OiR7U3RyaW5nKGQuZ2V0TWludXRlcygpKS5wYWRTdGFydCgyLCIwIil9
>>"%B64%" echo OiR7U3RyaW5nKGQuZ2V0U2Vjb25kcygpKS5wYWRTdGFydCgyLCIwIil9YDt9Owpjb25zdCBmbGF0
>>"%B64%" echo PXM9PlN0cmluZyhzfHwiIikucmVwbGFjZSgvXHMrL2csIiAiKS50cmltKCk7CmNvbnN0IHRhaWw9
>>"%B64%" echo cz0+e3M9ZmxhdChzKTtyZXR1cm4gcy5sZW5ndGg+MTIwMD9zLnNsaWNlKC0xMjAwKTpzO307CmNv
>>"%B64%" echo bnN0IGxpbmVUcz1saW5lPT57Y29uc3QgbT1TdHJpbmcobGluZXx8IiIpLm1hdGNoKC9eXFsoXGR7
>>"%B64%" echo NH0pLShcZHsyfSktKFxkezJ9KSAoXGR7Mn0pOihcZHsyfSk6KFxkezJ9KVxdLyk7cmV0dXJuIG0/
>>"%B64%" echo bmV3IERhdGUoTnVtYmVyKG1bMV0pLE51bWJlcihtWzJdKS0xLE51bWJlcihtWzNdKSxOdW1iZXIo
>>"%B64%" echo bVs0XSksTnVtYmVyKG1bNV0pLE51bWJlcihtWzZdKSkuZ2V0VGltZSgpOjA7fTsKY29uc3QgdHJp
>>"%B64%" echo bUxvZ1RleHQ9dHh0PT57bGV0IGxpbmVzPVN0cmluZyh0eHR8fCIiKS5yZXBsYWNlKC9cci9nLCIi
>>"%B64%" echo KS5zcGxpdCgiXG4iKTtpZihsaW5lcy5sZW5ndGgmJmxpbmVzW2xpbmVzLmxlbmd0aC0xXT09PSIi
>>"%B64%" echo KWxpbmVzLnBvcCgpO2NvbnN0IG1pbj1EYXRlLm5vdygpLU1BWF9MT0dfQUdFO2xpbmVzPWxpbmVz
>>"%B64%" echo LmZpbHRlcihsaW5lPT57Y29uc3QgdHM9bGluZVRzKGxpbmUpO3JldHVybiAhdHN8fHRzPj1taW47
>>"%B64%" echo fSk7aWYoIWxpbmVzLmxlbmd0aClyZXR1cm4iIjtsZXQgb3V0PWxpbmVzLmpvaW4oIlxuIikrIlxu
>>"%B64%" echo Ijt3aGlsZShCdWZmZXIuYnl0ZUxlbmd0aChvdXQsInV0ZjgiKT5NQVhfTE9HX0JZVEVTJiZsaW5l
>>"%B64%" echo cy5sZW5ndGg+MSl7bGluZXMuc2hpZnQoKTtvdXQ9bGluZXMuam9pbigiXG4iKSsiXG4iO31pZihC
>>"%B64%" echo dWZmZXIuYnl0ZUxlbmd0aChvdXQsInV0ZjgiKT5NQVhfTE9HX0JZVEVTKW91dD1vdXQuc2xpY2Uo
>>"%B64%" echo LU1BWF9MT0dfQllURVMpO3JldHVybiBvdXQ7fTsKY29uc3Qgd3JpdGVMb2dMaW5lPWxpbmU9Pntp
>>"%B64%" echo ZighbG9nRmlsZSl7cHJvY2Vzcy5zdGRvdXQud3JpdGUobGluZSsiXG4iKTtyZXR1cm47fWxldCBw
>>"%B64%" echo cmV2PSIiO3RyeXtpZihmcy5leGlzdHNTeW5jKGxvZ0ZpbGUpKXByZXY9ZnMucmVhZEZpbGVTeW5j
>>"%B64%" echo KGxvZ0ZpbGUsInV0ZjgiKTt9Y2F0Y2h7fWNvbnN0IG5leHQ9dHJpbUxvZ1RleHQocHJlditsaW5l
>>"%B64%" echo KyJcbiIpO3RyeXtmcy53cml0ZUZpbGVTeW5jKGxvZ0ZpbGUsbmV4dCwidXRmOCIpO31jYXRjaHtw
>>"%B64%" echo cm9jZXNzLnN0ZG91dC53cml0ZShsaW5lKyJcbiIpO319Owpjb25zdCBpbml0TG9nPSgpPT57aWYo
>>"%B64%" echo IWxvZ0ZpbGUpcmV0dXJuO2xldCBwcmV2PSIiO3RyeXtpZihmcy5leGlzdHNTeW5jKGxvZ0ZpbGUp
>>"%B64%" echo KXByZXY9ZnMucmVhZEZpbGVTeW5jKGxvZ0ZpbGUsInV0ZjgiKTt9Y2F0Y2h7fXRyeXtmcy53cml0
>>"%B64%" echo ZUZpbGVTeW5jKGxvZ0ZpbGUsdHJpbUxvZ1RleHQocHJldiksInV0ZjgiKTt9Y2F0Y2h7fX07CmNv
>>"%B64%" echo bnN0IGxvZz0odGFnLG1zZyk9PndyaXRlTG9nTGluZShgWyR7c3RhbXAoKX1dICR7dGFnfSR7bXNn
>>"%B64%" echo PyIgIittc2c6IiJ9YCk7CmNvbnN0IHJpcD1yZXE9PntsZXQgaXA9U3RyaW5nKHJlcS5oZWFkZXJz
>>"%B64%" echo WyJ4LWZvcndhcmRlZC1mb3IiXXx8cmVxLnNvY2tldCYmcmVxLnNvY2tldC5yZW1vdGVBZGRyZXNz
>>"%B64%" echo fHwiIikuc3BsaXQoIiwiKVswXS50cmltKCk7aWYoaXAuc3RhcnRzV2l0aCgiOjpmZmZmOiIpKWlw
>>"%B64%" echo PWlwLnNsaWNlKDcpO3JldHVybiBpcHx8Ii0iO307CmNvbnN0IHJ1YT1yZXE9Pntjb25zdCB2PWZs
>>"%B64%" echo YXQocmVxLmhlYWRlcnNbInVzZXItYWdlbnQiXXx8IiIpO3JldHVybiB2Lmxlbmd0aD4xODA/di5z
>>"%B64%" echo bGljZSgwLDE4MCk6djt9Owpjb25zdCBleGlzdGU9cD0+e3RyeXtyZXR1cm4gISFwJiZmcy5leGlz
>>"%B64%" echo dHNTeW5jKHApJiZmcy5zdGF0U3luYyhwKS5pc0ZpbGUoKTt9Y2F0Y2h7cmV0dXJuIGZhbHNlO319
>>"%B64%" echo Owpjb25zdCBsZXJDb25mU2NyaXB0PSgpPT57dHJ5e3JldHVybiBTdHJpbmcoZnMucmVhZEZpbGVT
>>"%B64%" echo eW5jKGNvbmZTY3JpcHQsInV0ZjgiKXx8IiIpLnRyaW0oKTt9Y2F0Y2h7cmV0dXJuICIiO319Owps
>>"%B64%" echo ZXQgc2NyaXB0R2xvYmFsPSIiOwpsZXQgYnVzY2FHbG9iYWxFbUN1cnNvPWZhbHNlOwpjb25zdCBi
>>"%B64%" echo dXNjYXJTY3JpcHRHbG9iYWw9KCk9PnsKaWYoYnVzY2FHbG9iYWxFbUN1cnNvKXJldHVybjsKYnVz
>>"%B64%" echo Y2FHbG9iYWxFbUN1cnNvPXRydWU7CmNvbnN0IGRyaXZlcz1bXTsKZm9yKGxldCBjPTY1O2M8PTkw
>>"%B64%" echo O2MrKyl7Y29uc3QgZD1TdHJpbmcuZnJvbUNoYXJDb2RlKGMpKyI6XFwiO3RyeXtpZihmcy5leGlz
>>"%B64%" echo dHNTeW5jKGQpKWRyaXZlcy5wdXNoKGQpO31jYXRjaHt9fQpjb25zdCBub21lPSJnZXJhci1yZWxh
>>"%B64%" echo dG9yaW8taHRtbC5qcyI7CmxldCBpPTA7CmNvbnN0IHRyeU5leHQ9KCk9PnsKaWYoc2NyaXB0R2xv
>>"%B64%" echo YmFsfHxpPj1kcml2ZXMubGVuZ3RoKXtidXNjYUdsb2JhbEVtQ3Vyc289ZmFsc2U7cmV0dXJuO30K
>>"%B64%" echo Y29uc3QgZHJ2PWRyaXZlc1tpKytdOwpjb25zdCBjbWQ9cHJvY2Vzcy5wbGF0Zm9ybT09PSJ3aW4z
>>"%B64%" echo MiI/YHdoZXJlIC9yICIke2Rydn0iICR7bm9tZX0gMj5udWxgOmBmaW5kICIke2Rydn0iIC1uYW1l
>>"%B64%" echo ICIke25vbWV9IiAyPi9kZXYvbnVsbGA7CmNwLmV4ZWMoY21kLHt0aW1lb3V0OjYwMDAwLHdpbmRv
>>"%B64%" echo d3NIaWRlOnRydWV9LChlcnIsc3Rkb3V0KT0+ewppZighc2NyaXB0R2xvYmFsKXsKY29uc3QgZm91
>>"%B64%" echo bmQ9U3RyaW5nKHN0ZG91dHx8IiIpLnJlcGxhY2UoL1xyL2csIiIpLnNwbGl0KCJcbiIpLm1hcChz
>>"%B64%" echo PT5zLnRyaW0oKSkuZmlsdGVyKHM9PnMmJnMudG9Mb3dlckNhc2UoKS5lbmRzV2l0aChub21lKSYm
>>"%B64%" echo ZXhpc3RlKHMpKVswXXx8IiI7CmlmKGZvdW5kKXtzY3JpcHRHbG9iYWw9Zm91bmQ7bG9nKCJTQ1JJ
>>"%B64%" echo UFRfR0xPQkFMIixgZHJpdmU9JHtkcnZ9IHNjcmlwdD0iJHtmb3VuZH0iYCk7fQp9CnRyeU5leHQo
>>"%B64%" echo KTsKfSk7Cn07CnRyeU5leHQoKTsKfTsKY29uc3QgcmVzb2x2ZXJTY3JpcHQ9KCk9PnsKY29uc3Qg
>>"%B64%" echo dXA9dWEoKTsKY29uc3QgZW52UGF0aD1TdHJpbmcocHJvY2Vzcy5lbnYuR0VOX1NDUklQVHx8IiIp
>>"%B64%" echo LnRyaW0oKTsKY29uc3QgY29uZlBhdGg9bGVyQ29uZlNjcmlwdCgpOwpjb25zdCBjYW5kPVsKZW52
>>"%B64%" echo UGF0aCwKY29uZlBhdGgsCnVwP3BhdGguam9pbih1cCwiRGVza3RvcCIsIlJFTCIsImdlcmFyLXJl
>>"%B64%" echo bGF0b3Jpby1odG1sLmpzIik6IiIsCnVwP3BhdGguam9pbih1cCwiRGVza3RvcCIsImdlcmFyLXJl
>>"%B64%" echo bGF0b3Jpby1odG1sLmpzIik6IiIsCnVwP3BhdGguam9pbih1cCwiRG9jdW1lbnRzIiwiZ2VyYXIt
>>"%B64%" echo cmVsYXRvcmlvLWh0bWwuanMiKToiIiwKdXA/cGF0aC5qb2luKHVwLCJEb3dubG9hZHMiLCJnZXJh
>>"%B64%" echo ci1yZWxhdG9yaW8taHRtbC5qcyIpOiIiLApwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwiZ2VyYXIt
>>"%B64%" echo cmVsYXRvcmlvLWh0bWwuanMiKSwKcGF0aC5qb2luKHJvb3QsImdlcmFyLXJlbGF0b3Jpby1odG1s
>>"%B64%" echo LmpzIiksCnNjcmlwdEdsb2JhbApdLmZpbHRlcihCb29sZWFuKTsKZm9yKGNvbnN0IHAgb2YgY2Fu
>>"%B64%" echo ZCkgaWYoZXhpc3RlKHApKSByZXR1cm4gcDsKcmV0dXJuIGVudlBhdGh8fGNvbmZQYXRofHxzY3Jp
>>"%B64%" echo cHRHbG9iYWx8fCIiOwp9Owpjb25zdCBkZXNrUGF0aD1kPT57Y29uc3QgdXA9dWEoKTtpZighdXAp
>>"%B64%" echo cmV0dXJuIiI7Y29uc3QgZGQ9U3RyaW5nKGQuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCIwIik7Y29u
>>"%B64%" echo c3QgbW09U3RyaW5nKGQuZ2V0TW9udGgoKSsxKS5wYWRTdGFydCgyLCIwIik7Y29uc3QgeXk9U3Ry
>>"%B64%" echo aW5nKGQuZ2V0RnVsbFllYXIoKSk7cmV0dXJuIHBhdGguam9pbih1cCwiRGVza3RvcCIsYChGREIt
>>"%B64%" echo RElBKV9yZWxhdG9yaW9fJHtkZH0tJHttbX0tJHt5eX0uaHRtbGApO307CmNvbnN0IGlzb0RhdGU9
>>"%B64%" echo ZD0+YCR7ZC5nZXRGdWxsWWVhcigpfS0ke1N0cmluZyhkLmdldE1vbnRoKCkrMSkucGFkU3RhcnQo
>>"%B64%" echo MiwiMCIpfS0ke1N0cmluZyhkLmdldERhdGUoKSkucGFkU3RhcnQoMiwiMCIpfWA7CmNvbnN0IG9r
>>"%B64%" echo SnNvbj0ocmVzLG9iaixjb2RlPTIwMCxleHRyYSk9PntyZXMud3JpdGVIZWFkKGNvZGUsT2JqZWN0
>>"%B64%" echo LmFzc2lnbih7IkNvbnRlbnQtVHlwZSI6ImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgi
>>"%B64%" echo LCJDYWNoZS1Db250cm9sIjoibm8tc3RvcmUifSxleHRyYXx8e30pKTtyZXMuZW5kKEpTT04uc3Ry
>>"%B64%" echo aW5naWZ5KG9ianx8e30pKTt9Owpjb25zdCBiYWQ9KHJlcyxjb2RlLG1zZyk9PntyZXMud3JpdGVI
>>"%B64%" echo ZWFkKGNvZGUseyJDb250ZW50LVR5cGUiOiJ0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04IiwiQ2Fj
>>"%B64%" echo aGUtQ29udHJvbCI6Im5vLXN0b3JlIn0pO3Jlcy5lbmQoU3RyaW5nKG1zZ3x8Y29kZSkpO307CmNv
>>"%B64%" echo bnN0IGNvcnM9KCk9Pih7IkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiI6IioiLCJBY2Nlc3Mt
>>"%B64%" echo Q29udHJvbC1BbGxvdy1IZWFkZXJzIjoieC1rZXksY29udGVudC10eXBlIiwiQWNjZXNzLUNvbnRy
>>"%B64%" echo b2wtQWxsb3ctTWV0aG9kcyI6IkdFVCxQT1NULE9QVElPTlMiLCJBY2Nlc3MtQ29udHJvbC1NYXgt
>>"%B64%" echo QWdlIjoiNjAwIn0pOwpjb25zdCBzZXJ2ZUZpbGU9KHJlcyxmcCk9Pntmcy5zdGF0KGZwLChlLHMp
>>"%B64%" echo PT57aWYoZXx8IXMuaXNGaWxlKCkpcmV0dXJuIGJhZChyZXMsNDA0LCI0MDQiKTtjb25zdCBleHQ9
>>"%B64%" echo cGF0aC5leHRuYW1lKGZwKS50b0xvd2VyQ2FzZSgpO3Jlcy53cml0ZUhlYWQoMjAwLHsiQ29udGVu
>>"%B64%" echo dC1UeXBlIjp0eXBlc1tleHRdfHwiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtIiwiQ2FjaGUtQ29u
>>"%B64%" echo dHJvbCI6Im5vLXN0b3JlIn0pO2ZzLmNyZWF0ZVJlYWRTdHJlYW0oZnApLnBpcGUocmVzKTt9KTt9
>>"%B64%" echo Owpjb25zdCBjbGVhbkhpc3Q9ZD0+e2Vuc3VyZURpcihoaXN0KTtjb25zdCBtaWQ9bmV3IERhdGUo
>>"%B64%" echo ZC5nZXRGdWxsWWVhcigpLGQuZ2V0TW9udGgoKSxkLmdldERhdGUoKSkuZ2V0VGltZSgpO2ZzLnJl
>>"%B64%" echo YWRkaXIoaGlzdCwoZSxsaXN0KT0+e2lmKGV8fCFBcnJheS5pc0FycmF5KGxpc3QpfHwhbGlzdC5s
>>"%B64%" echo ZW5ndGgpcmV0dXJuO2Zvcihjb25zdCBuYW1lIG9mIGxpc3Qpe2lmKCFuYW1lfHwhL1wuaHRtbCQv
>>"%B64%" echo aS50ZXN0KG5hbWUpKWNvbnRpbnVlO2NvbnN0IGZwPXBhdGguam9pbihoaXN0LG5hbWUpO2ZzLnN0
>>"%B64%" echo YXQoZnAsKGUyLHMpPT57aWYoZTJ8fCFzfHwhcy5pc0ZpbGUoKSlyZXR1cm47Y29uc3QgbXQ9TnVt
>>"%B64%" echo YmVyKHMubXRpbWVNc3x8MCk7aWYobXQmJm10PG1pZClmcy51bmxpbmsoZnAsKCk9Pnt9KTt9KTt9
>>"%B64%" echo fSk7fTsKY29uc3Qgc2NoZWR1bGVJbj1tcz0+e2lmKHN0LnRtKWNsZWFyVGltZW91dChzdC50bSk7
>>"%B64%" echo aWYobXM8MTAwMCltcz0xMDAwO3N0Lm5leHRfcnVuPURhdGUubm93KCkrbXM7c3QudG09c2V0VGlt
>>"%B64%" echo ZW91dCgoKT0+e2dlcmFyKCJhdXRvIikudGhlbigoKT0+c2NoZWR1bGVJbihNUzE1KSk7fSxtcyk7
>>"%B64%" echo fTsKY29uc3QgaW5pdFNjaGVkdWxlPSgpPT57bGV0IG1zPU1TMTU7dHJ5e2lmKGZzLmV4aXN0c1N5
>>"%B64%" echo bmMoYXR1YWwpKXtjb25zdCBtPWZzLnN0YXRTeW5jKGF0dWFsKS5tdGltZU1zO2NvbnN0IG5leHQ9
>>"%B64%" echo bStNUzE1O2NvbnN0IG5vdz1EYXRlLm5vdygpO2lmKG5leHQ+bm93KzEwMDApbXM9bmV4dC1ub3c7
>>"%B64%" echo fX1jYXRjaHt9c2NoZWR1bGVJbihtcyk7fTsKY29uc3QgZ2VyYXI9KG1vdGl2byxtZXRhKT0+ewpp
>>"%B64%" echo ZihzdC5ydW5uaW5nKXtsb2coIkdFUkFSX1NLSVAiLGBtb3Rpdm89JHttb3Rpdm99IGVzdGFkbz1y
>>"%B64%" echo dW5uaW5nYCk7cmV0dXJuIFByb21pc2UucmVzb2x2ZSh7b2s6ZmFsc2UsZXN0YWRvOiJydW5uaW5n
>>"%B64%" echo In0pO30KY29uc3Qgc2NyaXB0PXJlc29sdmVyU2NyaXB0KCk7CmlmKCFmZGJ8fCFzY3JpcHR8fCFl
>>"%B64%" echo eGlzdGUoc2NyaXB0KSl7CmlmKCFzY3JpcHRHbG9iYWwpYnVzY2FyU2NyaXB0R2xvYmFsKCk7Cmxv
>>"%B64%" echo ZygiR0VSQVJfU0tJUCIsYG1vdGl2bz0ke21vdGl2b30gZXN0YWRvPXNlbV9jZmcgZmRiPSR7ZmRi
>>"%B64%" echo PyJvayI6InZhemlvIn0gc2NyaXB0PSR7c2NyaXB0fHwidmF6aW8ifSBzY3JpcHRfb2s9JHtleGlz
>>"%B64%" echo dGUoc2NyaXB0KT8ic2ltIjoibmFvIn0gYnVzY2FfZ2xvYmFsPSR7YnVzY2FHbG9iYWxFbUN1cnNv
>>"%B64%" echo PyJlbV9jdXJzbyI6Im5hb19pbmljaWFkYSJ9YCk7CnJldHVybiBQcm9taXNlLnJlc29sdmUoe29r
>>"%B64%" echo OmZhbHNlLGVzdGFkbzoic2VtX2NmZyIsZXJybzpgc2NyaXB0PSR7c2NyaXB0fHwidmF6aW8ifWB9
>>"%B64%" echo KTt9CnN0LnJ1bm5pbmc9dHJ1ZTtzdC5sYXN0X3N0YXJ0PURhdGUubm93KCk7c3QubGFzdF9lcnI9
>>"%B64%" echo IiI7CmNvbnN0IGQ9bmV3IERhdGUoKTsKY29uc3QgZGF0YUlTTz1pc29EYXRlKGQpOwpjb25zdCBl
>>"%B64%" echo bnY9T2JqZWN0LmFzc2lnbih7fSxwcm9jZXNzLmVudix7RkRCX1NSVl9LRVk6a2V5LEZEQl9TUlZf
>>"%B64%" echo QkFTRV9MT0NBTDpgaHR0cDovLzEyNy4wLjAuMToke3BvcnR9YCxGREJfU1JWX0JBU0VfUkVERTpg
>>"%B64%" echo aHR0cDovLyR7d2ViaXB9OiR7cG9ydH1gLEdFTl9TQ1JJUFQ6c2NyaXB0fSk7CmNvbnN0IGluZm89
>>"%B64%" echo bWV0YSYmdHlwZW9mIG1ldGE9PT0ib2JqZWN0Ij9tZXRhOnt9Owpsb2coIkdFUkFSX0lOSUNJTyIs
>>"%B64%" echo YG1vdGl2bz0ke21vdGl2b30gaXA9JHtpbmZvLmlwfHwiLSJ9IG9yaWdlbT0ke2luZm8ub3JpZ2Vt
>>"%B64%" echo fHwiLSJ9IHVhPSR7aW5mby51YXx8Ii0ifSBkYXRhPSR7ZGF0YUlTT30gc2NyaXB0PSIke3Njcmlw
>>"%B64%" echo dH0iYCk7CnJldHVybiBuZXcgUHJvbWlzZShyZXM9PntlbnN1cmVEaXIoaGlzdCk7Y29uc3QgYXJn
>>"%B64%" echo cz1bc2NyaXB0LCItLWZkYiIsZmRiLCItLWRhdGEiLGRhdGFJU08sIi0tc2FpZGEiLHRtcCwiLS11
>>"%B64%" echo c2VyIixkYnVzZXIsIi0tcGFzcyIsZGJwYXNzXTtjb25zdCBwPWNwLnNwYXduKHByb2Nlc3MuZXhl
>>"%B64%" echo Y1BhdGgsYXJncyx7ZW52LHdpbmRvd3NIaWRlOnRydWV9KTtsZXQgb3V0PSIiO3Auc3Rkb3V0Lm9u
>>"%B64%" echo KCJkYXRhIixiPT57b3V0Kz1TdHJpbmcoYnx8IiIpO30pO3Auc3RkZXJyLm9uKCJkYXRhIixiPT57
>>"%B64%" echo b3V0Kz1TdHJpbmcoYnx8IiIpO30pO3Aub24oImVycm9yIixlPT57c3QucnVubmluZz1mYWxzZTtz
>>"%B64%" echo dC5sYXN0X2VuZD1EYXRlLm5vdygpO3N0Lmxhc3RfZXJyPWZsYXQoZSYmZS5tZXNzYWdlfHwic3Bh
>>"%B64%" echo d25fZXJyb3IiKTtzY2hlZHVsZUluKE1TMTUpO2xvZygiR0VSQVJfRkFMSEEiLGBtb3Rpdm89JHtt
>>"%B64%" echo b3Rpdm99IGV0YXBhPXNwYXduIGVycm89JHt0YWlsKHN0Lmxhc3RfZXJyKX1gKTtyZXMoe29rOmZh
>>"%B64%" echo bHNlLGVzdGFkbzoic3Bhd25fZXJyb3IiLGVycm86c3QubGFzdF9lcnIsbmV4dF9ydW46c3QubmV4
>>"%B64%" echo dF9ydW59KTt9KTtwLm9uKCJjbG9zZSIsY29kZT0+e3N0LnJ1bm5pbmc9ZmFsc2U7c3QubGFzdF9l
>>"%B64%" echo bmQ9RGF0ZS5ub3coKTtpZihjb2RlPT09MCYmZnMuZXhpc3RzU3luYyh0bXApKXtjb25zdCBkcD1k
>>"%B64%" echo ZXNrUGF0aChkKTtjb25zdCBkZD1TdHJpbmcoZC5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsIjAiKTtj
>>"%B64%" echo b25zdCBtbT1TdHJpbmcoZC5nZXRNb250aCgpKzEpLnBhZFN0YXJ0KDIsIjAiKTtjb25zdCB5eT1T
>>"%B64%" echo dHJpbmcoZC5nZXRGdWxsWWVhcigpKTtjb25zdCBoaD1TdHJpbmcoZC5nZXRIb3VycygpKS5wYWRT
>>"%B64%" echo dGFydCgyLCIwIik7Y29uc3QgbWk9U3RyaW5nKGQuZ2V0TWludXRlcygpKS5wYWRTdGFydCgyLCIw
>>"%B64%" echo Iik7Y29uc3QgaGlzdEZpbGU9cGF0aC5qb2luKGhpc3QsYChGREItRElBKV9yZWxhdG9yaW9fJHtk
>>"%B64%" echo ZH0tJHttbX0tJHt5eX1fJHtoaH0tJHttaX0uaHRtbGApO2xldCBmaWxlRXJyPSIiO3RyeXtmcy5j
>>"%B64%" echo b3B5RmlsZVN5bmModG1wLGF0dWFsKTtpZihkcClmcy5jb3B5RmlsZVN5bmModG1wLGRwKTtmcy5j
>>"%B64%" echo b3B5RmlsZVN5bmModG1wLGhpc3RGaWxlKTtmcy51bmxpbmtTeW5jKHRtcCk7fWNhdGNoKGUpe2Zp
>>"%B64%" echo bGVFcnI9ZmxhdChlJiZlLm1lc3NhZ2V8fCJjb3B5X2Vycm9yIik7fWlmKCFmaWxlRXJyKXtzdC5s
>>"%B64%" echo YXN0X29rPURhdGUubm93KCk7Y2xlYW5IaXN0KGQpO3NjaGVkdWxlSW4oTVMxNSk7bG9nKCJHRVJB
>>"%B64%" echo Ul9PSyIsYG1vdGl2bz0ke21vdGl2b30gYXR1YWw9IiR7YXR1YWx9IiBoaXN0PSIke2hpc3RGaWxl
>>"%B64%" echo fSIgbmV4dF9ydW49JHtzdC5uZXh0X3J1bn1gKTtyZXMoe29rOnRydWUsZXN0YWRvOiJvayIsbW90
>>"%B64%" echo aXZvLHNhaWRhX2F0dWFsOmF0dWFsLG5leHRfcnVuOnN0Lm5leHRfcnVuLGxhc3Rfb2s6c3QubGFz
>>"%B64%" echo dF9vayxzY3JpcHR9KTtyZXR1cm47fXN0Lmxhc3RfZXJyPWZpbGVFcnI7c2NoZWR1bGVJbihNUzE1
>>"%B64%" echo KTtsb2coIkdFUkFSX0ZBTEhBIixgbW90aXZvPSR7bW90aXZvfSBldGFwYT1hcnF1aXZvIGVycm89
>>"%B64%" echo JHt0YWlsKGZpbGVFcnIpfWApO3Jlcyh7b2s6ZmFsc2UsZXN0YWRvOiJlcnJvX2FycXVpdm8iLGVy
>>"%B64%" echo cm86c3QubGFzdF9lcnIsbmV4dF9ydW46c3QubmV4dF9ydW4sc2NyaXB0fSk7cmV0dXJuO31zdC5s
>>"%B64%" echo YXN0X2Vycj10YWlsKG91dCl8fCgiZXJybyAiK2NvZGUpO3NjaGVkdWxlSW4oTVMxNSk7bG9nKCJH
>>"%B64%" echo RVJBUl9GQUxIQSIsYG1vdGl2bz0ke21vdGl2b30gY29kZT0ke2NvZGV9IGVycm89JHt0YWlsKHN0
>>"%B64%" echo Lmxhc3RfZXJyKX1gKTtyZXMoe29rOmZhbHNlLGVzdGFkbzoiZXJybyIsY29kZSxlcnJvOnN0Lmxh
>>"%B64%" echo c3RfZXJyLG5leHRfcnVuOnN0Lm5leHRfcnVuLHNjcmlwdH0pO30pO30pOwp9OwplbnN1cmVEaXIo
>>"%B64%" echo aGlzdCk7aW5pdExvZygpO2NsZWFuSGlzdChuZXcgRGF0ZSgpKTsKYnVzY2FyU2NyaXB0R2xvYmFs
>>"%B64%" echo KCk7CmluaXRTY2hlZHVsZSgpOwpwcm9jZXNzLm9uKCJ1bmNhdWdodEV4Y2VwdGlvbiIsZT0+e2xv
>>"%B64%" echo ZygiVU5DQVVHSFQiLGBlcnJvPSR7dGFpbChlJiZlLnN0YWNrfHxlJiZlLm1lc3NhZ2V8fGV8fCJl
>>"%B64%" echo cnJvIil9YCk7fSk7CnByb2Nlc3Mub24oInVuaGFuZGxlZFJlamVjdGlvbiIsZT0+e2xvZygiVU5I
>>"%B64%" echo QU5ETEVEIixgZXJybz0ke3RhaWwoZSYmZS5zdGFja3x8ZSYmZS5tZXNzYWdlfHxlfHwiZXJybyIp
>>"%B64%" echo fWApO30pOwpjb25zdCBzcnY9aHR0cC5jcmVhdGVTZXJ2ZXIoKHJlcSxyZXMpPT57Y29uc3QgdT1u
>>"%B64%" echo ZXcgVVJMKHJlcS51cmx8fCIvIiwiaHR0cDovLzEyNy4wLjAuMSIpO2NvbnN0IHA9U3RyaW5nKHUu
>>"%B64%" echo cGF0aG5hbWV8fCIvIik7aWYocmVxLm1ldGhvZD09PSJPUFRJT05TIil7cmVzLndyaXRlSGVhZCgy
>>"%B64%" echo MDQsY29ycygpKTtyZXMuZW5kKCk7cmV0dXJuO31pZihwPT09Ii9fX3N0YXR1cyImJnJlcS5tZXRo
>>"%B64%" echo b2Q9PT0iR0VUIil7b2tKc29uKHJlcyx7cnVubmluZzpzdC5ydW5uaW5nLGxhc3Rfc3RhcnQ6c3Qu
>>"%B64%" echo bGFzdF9zdGFydCxsYXN0X2VuZDpzdC5sYXN0X2VuZCxsYXN0X29rOnN0Lmxhc3Rfb2ssbGFzdF9l
>>"%B64%" echo cnI6c3QubGFzdF9lcnIsbmV4dF9ydW46c3QubmV4dF9ydW4scG9ydCx3ZWJpcCxzY3JpcHQ6cmVz
>>"%B64%" echo b2x2ZXJTY3JpcHQoKSxzY3JpcHRfY2ZnOmxlckNvbmZTY3JpcHQoKSxzY3JpcHRfZ2xvYmFsOnNj
>>"%B64%" echo cmlwdEdsb2JhbCxidXNjYV9nbG9iYWxfZW1fY3Vyc286YnVzY2FHbG9iYWxFbUN1cnNvfSwyMDAs
>>"%B64%" echo Y29ycygpKTtyZXR1cm47fWlmKHA9PT0iL19fZ2VyYXIiJiZyZXEubWV0aG9kPT09IlBPU1QiKXtj
>>"%B64%" echo b25zdCBpZD0rK3JlcUlkO2NvbnN0IGs9U3RyaW5nKHJlcS5oZWFkZXJzWyJ4LWtleSJdfHwiIiku
>>"%B64%" echo dHJpbSgpO2NvbnN0IGlwPXJpcChyZXEpO2NvbnN0IG9yaWdlbT1mbGF0KHJlcS5oZWFkZXJzLm9y
>>"%B64%" echo aWdpbnx8cmVxLmhlYWRlcnMucmVmZXJlcnx8Ii0iKTtjb25zdCBhPXJ1YShyZXEpO2xvZygiR0VS
>>"%B64%" echo QVJfUkVRIixgaWQ9JHtpZH0gaXA9JHtpcH0gb3JpZ2VtPSR7b3JpZ2VtfHwiLSJ9IGtleT0ke2tl
>>"%B64%" echo eSYmaz09PWtleT8ib2siOiJpbnZhbGlkYSJ9IHJ1bm5pbmc9JHtzdC5ydW5uaW5nfSB1YT0ke2F8
>>"%B64%" echo fCItIn1gKTtpZigha2V5fHxrIT09a2V5KXtsb2coIkdFUkFSX0RFTlkiLGBpZD0ke2lkfSBpcD0k
>>"%B64%" echo e2lwfSBtb3Rpdm89dW5hdXRoYCk7b2tKc29uKHJlcyx7b2s6ZmFsc2UsZXN0YWRvOiJ1bmF1dGgi
>>"%B64%" echo LHJlcV9pZDppZH0sNDAxLGNvcnMoKSk7cmV0dXJuO31pZihzdC5ydW5uaW5nKXtsb2coIkdFUkFS
>>"%B64%" echo X0JVU1kiLGBpZD0ke2lkfSBpcD0ke2lwfSBsYXN0X3N0YXJ0PSR7c3QubGFzdF9zdGFydH1gKTtv
>>"%B64%" echo a0pzb24ocmVzLHtvazpmYWxzZSxlc3RhZG86InJ1bm5pbmciLHJ1bm5pbmc6dHJ1ZSxsYXN0X3N0
>>"%B64%" echo YXJ0OnN0Lmxhc3Rfc3RhcnQsbGFzdF9vazpzdC5sYXN0X29rLG5leHRfcnVuOnN0Lm5leHRfcnVu
>>"%B64%" echo LHJlcV9pZDppZH0sNDA5LGNvcnMoKSk7cmV0dXJuO31nZXJhcigibWFudWFsIix7aWQsaXAsb3Jp
>>"%B64%" echo Z2VtLHVhOmF9KS50aGVuKHI9Pntsb2coIkdFUkFSX1JFUyIsYGlkPSR7aWR9IG9rPSR7ISEociYm
>>"%B64%" echo ci5vayl9IGVzdGFkbz0ke3ImJnIuZXN0YWRvfHwiLSJ9IGxhc3Rfb2s9JHtzdC5sYXN0X29rfSBz
>>"%B64%" echo Y3JpcHQ9IiR7ciYmci5zY3JpcHR8fHJlc29sdmVyU2NyaXB0KCl8fCIifSIgZXJybz0ke3RhaWwo
>>"%B64%" echo ciYmci5lcnJvfHwiIil8fCItIn1gKTtva0pzb24ocmVzLE9iamVjdC5hc3NpZ24oe3JlcV9pZDpp
>>"%B64%" echo ZH0scnx8e30pLDIwMCxjb3JzKCkpO30pO3JldHVybjt9aWYocD09PSIvX19wcm9pYmlkb3MiJiZy
>>"%B64%" echo ZXEubWV0aG9kPT09IkdFVCIpe2xlclByb2liKGxpc3RhPT5va0pzb24ocmVzLHtvazp0cnVlLGxp
>>"%B64%" echo c3RhfSwyMDAsY29ycygpKSk7cmV0dXJuO31pZihwPT09Ii9fX3Byb2liaWRvcyImJnJlcS5tZXRo
>>"%B64%" echo b2Q9PT0iUE9TVCIpe2NvbnN0IGs9U3RyaW5nKHJlcS5oZWFkZXJzWyJ4LWtleSJdfHwiIikudHJp
>>"%B64%" echo bSgpO2lmKGtleSYmayE9PWtleSl7b2tKc29uKHJlcyx7b2s6ZmFsc2UsZXN0YWRvOiJ1bmF1dGgi
>>"%B64%" echo fSw0MDEsY29ycygpKTtyZXR1cm47fWxldCBib2R5PSIiO3JlcS5vbigiZGF0YSIsYj0+e2JvZHkr
>>"%B64%" echo PVN0cmluZyhifHwiIik7aWYoYm9keS5sZW5ndGg+MjAwMDAwKWJvZHk9Ym9keS5zbGljZSgwLDIw
>>"%B64%" echo MDAwMCk7fSk7cmVxLm9uKCJlbmQiLCgpPT57Y29uc3QgaW5jPXBhcnNlTGlzdGEoYm9keSk7bGVy
>>"%B64%" echo UHJvaWIobGlzdGEwPT57Y29uc3QgbWVyZ2VkPXVuaXEoWy4uLmxpc3RhMCwuLi5pbmNdLm1hcChu
>>"%B64%" echo b3JtUCkuZmlsdGVyKEJvb2xlYW4pKTtzYWx2YXJQcm9pYihtZXJnZWQsKCk9Pm9rSnNvbihyZXMs
>>"%B64%" echo e29rOnRydWUsbGlzdGE6bWVyZ2VkfSwyMDAsY29ycygpKSk7fSk7fSk7cmV0dXJuO31sZXQgcmVs
>>"%B64%" echo PXA7aWYocmVsPT09Ii8ifHxyZWw9PT0iIilyZWw9Ii9yZWxhdG9yaW9fYXR1YWwuaHRtbCI7cmVs
>>"%B64%" echo PXJlbC5yZXBsYWNlKC9eXC8rLywiIik7Y29uc3QgZnA9cGF0aC5yZXNvbHZlKHBhdGguam9pbihy
>>"%B64%" echo b290LHJlbCkpO2lmKGZwLmluZGV4T2Yocm9vdCkhPT0wKXJldHVybiBiYWQocmVzLDQwMywiNDAz
>>"%B64%" echo Iik7c2VydmVGaWxlKHJlcyxmcCk7fSk7CnNydi5saXN0ZW4ocG9ydCwiMC4wLjAuMCIsKCk9Pnts
>>"%B64%" echo b2coIlNFUlZJRE9SX09LIixgJHtwb3J0fSAke3Jvb3R9IHdlYmlwPSR7d2ViaXB9IHNjcmlwdD0i
>>"%B64%" echo JHtyZXNvbHZlclNjcmlwdCgpfSIgY2ZnPSIke2xlckNvbmZTY3JpcHQoKX0iYCk7fSk7Cg==
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
