@echo off
setlocal enabledelayedexpansion
rem ===========================================================================
rem  Build a local cache of every Mercenaries 2 character, once.
rem
rem  The skinner needs an export bundle per character, and exporting them one
rem  at a time as you happen to want them is the slowest possible way to work:
rem  you cannot browse what exists, you cannot compare two characters, and the
rem  outfit swap needs two bundles before it can do anything at all. One run of
rem  this gets the whole roster -- about 85 characters and 600 MB.
rem
rem  Budget 20-30 minutes. Most characters take ~2 seconds, but the playable
rem  heroes carry far more animation and take over a minute each. Not stuck.
rem
rem    extract_all.bat [outdir] [filter]
rem
rem      outdir   where the bundles go        (default C:\mercs2-skins)
rem      filter   substring of the model name (default _hum_ = characters)
rem
rem  Examples
rem    extract_all.bat                              every character
rem    extract_all.bat D:\m2cache                   ...somewhere else
rem    extract_all.bat C:\mercs2-skins _veh_        every vehicle instead
rem    extract_all.bat C:\mercs2-skins _            EVERYTHING (very large)
rem
rem  Safe to re-run: a character that already has a manifest.json is skipped,
rem  so an interrupted run resumes instead of starting over.
rem ===========================================================================

set "OUT=%~1"
if "%OUT%"=="" set "OUT=C:\mercs2-skins"
set "FILTER=%~2"
if "%FILTER%"=="" set "FILTER=_hum_"

rem --- find the exporter -------------------------------------------------
rem Next to this script first, then MERCS2_WORKSHOP, then whatever is on PATH.
set "WS="
if exist "%~dp0mercs2_workshop.exe" set "WS=%~dp0mercs2_workshop.exe"
if not defined WS if defined MERCS2_WORKSHOP if exist "%MERCS2_WORKSHOP%" set "WS=%MERCS2_WORKSHOP%"
if not defined WS for %%X in (mercs2_workshop.exe) do if not "%%~$PATH:X"=="" set "WS=%%~$PATH:X"

if not defined WS (
  echo.
  echo   Could not find mercs2_workshop.exe
  echo.
  echo   Put it next to this script, or set MERCS2_WORKSHOP to its full path:
  echo       set MERCS2_WORKSHOP=C:\path\to\mercs2_workshop.exe
  echo.
  echo   Download it from the community toolchain releases:
  echo       https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator/releases
  echo.
  exit /b 1
)

echo.
echo   exporter : %WS%
echo   output   : %OUT%
echo   filter   : %FILTER%
echo.

if not exist "%OUT%" mkdir "%OUT%" 2>nul
if not exist "%OUT%" (
  echo   Could not create "%OUT%" -- check the path and permissions.
  exit /b 1
)

rem --- list the catalogue ------------------------------------------------
rem --no-auto-patch reads the BASE game only. Without it the tool layers any
rem vz-patch.wad sitting next to vz.wad, so a cache built on a modded install
rem would quietly include other people's custom skins.
set "LIST=%TEMP%\m2_extract_list.txt"
"%WS%" --no-auto-patch --list >"%LIST%" 2>nul
if not exist "%LIST%" (
  echo   The exporter produced no catalogue. Is the game installed?
  exit /b 1
)

findstr /b "MODELS" "%LIST%" | findstr /c:"%FILTER%" >"%LIST%.f"
for /f %%C in ('type "%LIST%.f" ^| find /c /v ""') do set "TOTAL=%%C"

if "%TOTAL%"=="0" (
  echo   Nothing in the catalogue matches "%FILTER%".
  del "%LIST%" "%LIST%.f" 2>nul
  exit /b 1
)
echo   %TOTAL% model^(s^) to fetch.
echo.

rem --- export ------------------------------------------------------------
rem Every `set /a` is QUOTED and every command is on its own line, both deliberately.
rem In `set /a` the `&` is the bitwise-AND OPERATOR, so the tidier-looking
rem     set /a FAIL+=1 & echo FAILED: %%A
rem does not run two commands -- cmd folds the echo into the arithmetic expression. That
rem reported a phantom failure on a character that had exported perfectly well, and printed
rem the loop variable as a literal "%A".
set /a "IDX=0"
set /a "DONE=0"
set /a "SKIP=0"
set /a "FAIL=0"
for /f "tokens=3" %%A in ('type "%LIST%.f"') do (
  set /a "IDX+=1"
  if exist "%OUT%\%%A\manifest.json" (
    set /a "SKIP+=1"
  ) else (
    echo   [!IDX!/%TOTAL%] %%A
    "%WS%" --no-auto-patch --export-bundle %%A --out "%OUT%" >nul 2>&1
    if exist "%OUT%\%%A\manifest.json" (
      set /a "DONE+=1"
    ) else (
      set /a "FAIL+=1"
      echo         FAILED: %%A
    )
  )
)

del "%LIST%" "%LIST%.f" 2>nul

echo.
echo   ---------------------------------------------------------------
echo    exported %DONE%   already had %SKIP%   failed %FAIL%
echo    cache: %OUT%
echo   ---------------------------------------------------------------

rem --- index it ----------------------------------------------------------
rem Optional: turns the folder of bundles into a browsable catalogue. Skipped
rem without complaint if Python is not installed -- the bundles are the point,
rem the index is a convenience.
where python >nul 2>&1
if %ERRORLEVEL%==0 (
  if exist "%~dp0index_bundles.py" (
    echo.
    python "%~dp0index_bundles.py" "%OUT%"
  )
) else (
  echo.
  echo   [Python not found -- skipping the index. The bundles are ready to use.]
)

echo.
endlocal
