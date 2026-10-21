@echo off
rem Aidem pitch show: double-click to start. The work is done by app\start-windows.ps1.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\start-windows.ps1" %*
if errorlevel 1 pause
