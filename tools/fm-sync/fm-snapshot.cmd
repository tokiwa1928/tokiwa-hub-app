@echo off
rem FileMaker の設計スナップショット
chcp 65001 >nul
python "%~dp0fm_snapshot.py" %*
