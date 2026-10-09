@echo off
rem Tokiwa Hub: Excel / Word / PowerPoint -> PDF on Desktop (same file name)
rem Put this .bat and office-pdf.ps1 in the same folder (e.g. Desktop).
rem Drop files or folders on this .bat, or double-click to pick files.
setlocal
set "PS1=%~dp0office-pdf.ps1"
if not exist "%PS1%" (
  echo office-pdf.ps1 is missing. Download it from the Hub page and put it next to this .bat.
  pause
  exit /b 1
)
set ARGS=
:loop
if "%~1"=="" goto run
set ARGS=%ARGS% "%~1"
shift
goto loop
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %ARGS%
echo.
pause
