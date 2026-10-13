@echo off
rem 名刺中継（GAS）を clasp で作成・公開する。ログは clasp_log.txt
cd /d "%~dp0"
set LOG=clasp_log.txt
echo ==== %date% %time% > %LOG%
if not exist .clasp.json (
  call clasp create --type standalone --title "meishi-relay" --rootDir . >> %LOG% 2>&1
  if not exist .clasp.json call clasp create-script --type standalone --title "meishi-relay" --rootDir . >> %LOG% 2>&1
)
copy /y appsscript.keep.json appsscript.json >> %LOG% 2>&1
call clasp push -f >> %LOG% 2>&1
call clasp deploy -d "meishi-relay v1" >> %LOG% 2>&1
if errorlevel 1 call clasp create-deployment -d "meishi-relay v1" >> %LOG% 2>&1
call clasp deployments >> %LOG% 2>&1
if errorlevel 1 call clasp list-deployments >> %LOG% 2>&1
type .clasp.json >> %LOG% 2>&1
echo ==== END >> %LOG%
