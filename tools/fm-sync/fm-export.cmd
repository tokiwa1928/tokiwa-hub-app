@echo off
rem FileMaker 受注データの書き出し
chcp 65001 >nul
python "%~dp0fm_export.py" %*
