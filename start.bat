@echo off
REM Label Studio - Start script (CMD)
REM Activates virtual environment and starts the development server.
REM Usage: start.bat

cd /d "%~dp0"

set "VENV_ACTIVATE=.venv\Scripts\activate.bat"
if not exist ".venv\Scripts\activate.bat" (
    echo Virtual environment not found at .venv
    echo Create it with: python -m venv .venv
    pause
    exit /b 1
)

call %VENV_ACTIVATE%

set DJANGO_DB=sqlite
set LOG_DIR=tmp
set DEBUG=true
set LOG_LEVEL=DEBUG
set DJANGO_SETTINGS_MODULE=core.settings.label_studio

echo Starting Label Studio server...
python label_studio/manage.py runserver
pause
