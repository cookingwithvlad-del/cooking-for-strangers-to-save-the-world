@echo off
REM Windows: double-click to run the guided organizer.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 organize.py) else (python organize.py)
pause
