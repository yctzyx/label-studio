# Label Studio - Start script (PowerShell)
# Activates virtual environment and starts the development server.
# Usage: .\start.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$VenvPath = Join-Path $ProjectRoot ".venv"
$ActivateScript = Join-Path $VenvPath "Scripts\Activate.ps1"

if (-not (Test-Path $ActivateScript)) {
    Write-Host "Virtual environment not found at: $VenvPath" -ForegroundColor Red
    Write-Host "Create it with: python -m venv .venv" -ForegroundColor Yellow
    exit 1
}

Write-Host "Activating virtual environment..." -ForegroundColor Cyan
& $ActivateScript

$env:DJANGO_DB = "sqlite"
$env:LOG_DIR = "tmp"
$env:DEBUG = "true"
$env:LOG_LEVEL = "DEBUG"
$env:DJANGO_SETTINGS_MODULE = "core.settings.label_studio"

Write-Host "Starting Label Studio server..." -ForegroundColor Cyan
Set-Location $ProjectRoot
python label_studio/manage.py runserver
