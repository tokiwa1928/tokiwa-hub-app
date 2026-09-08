@echo off
rem FileMaker Cloud 接続テスト
rem   コンソールを UTF-8 にしてから Python を呼ぶ（日本語が化けないように）
chcp 65001 >nul
python "%~dp0fm_client.py" %*
