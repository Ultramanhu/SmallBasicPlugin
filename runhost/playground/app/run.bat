@echo off
rem Starts the local static server of the web RunHost and opens the default
rem browser. Double-click this file, or call it with extra arguments such as
rem "run.bat --no-open".
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 20 or newer is required to serve the web RunHost: https://nodejs.org
    echo Any other static file server works as well; serve this folder over HTTP.
    pause
    exit /b 1
)

node serve.mjs %*
set "exitCode=%ERRORLEVEL%"

rem Ctrl+C reports 0xC000013A; never keep the window open for it.
if "%exitCode%"=="0" goto :done
if "%exitCode%"=="-1073741510" goto :done

echo.
echo The web RunHost server stopped with exit code %exitCode%.
pause

:done
endlocal
