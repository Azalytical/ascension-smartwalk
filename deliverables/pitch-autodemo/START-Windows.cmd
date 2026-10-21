@echo off
rem Aidem pitch show: double-click to start.
rem From the zip: Node.js is in node-win, so the show starts directly. Otherwise app\start-windows.ps1 finds or downloads Node.
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0app\show.mjs" goto unzip
if exist "%~dp0node-win\node.exe" if exist "%~dp0app\node_modules\playwright-core\package.json" goto bundled
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\start-windows.ps1" %*
if errorlevel 1 pause
exit /b

:bundled
title Aidem: показ питча (не закрывайте это окно)
"%~dp0node-win\node.exe" "%~dp0app\show.mjs" %*
if errorlevel 1 (
  echo.
  echo Показ остановился с ошибкой. Сфотографируйте это окно и пришлите в чат команды. Что делать: README.txt, «Если не запускается».
  pause
)
exit /b

:unzip
echo.
echo Архив не распакован. Правый щелчок по aidem-pitch-autodemo.zip, «Извлечь все», потом START-Windows.cmd в новой папке.
echo The archive is not unpacked: right-click the zip, "Extract All", then run START-Windows.cmd from the new folder.
echo.
pause
