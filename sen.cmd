@echo off
REM SentinelOps launcher (Windows). Usage: sen run   (or .\sen run in PowerShell)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0scripts\sen.py" %*
) else (
  python "%~dp0scripts\sen.py" %*
)
exit /b %errorlevel%
