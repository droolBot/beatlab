@echo off
rem Puts BeatLab on your Desktop and in the Start menu. Run it again any time; it only refreshes the shortcuts.
cd /d "%~dp0"
title Install BeatLab

rem fails when Python is missing, is the Microsoft Store placeholder, or is older than 3.10
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
if errorlevel 1 (
  echo BeatLab needs Python 3.10 or newer, and this computer doesn't have it.
  echo Press any key to install it now, or close this window to stop.
  pause >nul
  winget install -e --id Python.Python.3.12 --accept-source-agreements
  if errorlevel 1 (
    echo Couldn't install Python. Get it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then run this again.
    pause
    exit /b 1
  )
  echo Python is installed. Close this window and run Install BeatLab again.
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell; $target = Join-Path '%~dp0' 'Start BeatLab.bat';" ^
  "foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {" ^
  "  $l = $s.CreateShortcut((Join-Path $dir 'BeatLab.lnk')); $l.TargetPath = $target; $l.WorkingDirectory = '%~dp0';" ^
  "  $l.WindowStyle = 7; $l.Description = 'BeatLab beat studio'; $l.Save() }"
if errorlevel 1 (
  echo Couldn't make the shortcuts. You can still double-click "Start BeatLab.bat" in this folder.
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 echo Tip: a few FL Studio samples need ffmpeg to play. Install it with: winget install Gyan.FFmpeg

echo.
echo Done. BeatLab is on your Desktop and in the Start menu.
pause
