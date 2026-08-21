# ============================================================
# MusicLens — Environment Setup Script (Windows PowerShell)
# ============================================================
# Usage: .\scripts\setup_env.ps1
# Run from project root directory.
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " MusicLens Environment Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Check Python 3.12 ---
Write-Host "[1/6] Checking Python 3.12..." -ForegroundColor Yellow
try {
    $pythonVersion = py -3.12 --version 2>&1
    Write-Host "  Found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python 3.12 not found. Install from https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

# --- Create virtual environment ---
Write-Host "[2/6] Creating virtual environment (.venv)..." -ForegroundColor Yellow
if (Test-Path ".venv") {
    Write-Host "  .venv already exists, skipping creation." -ForegroundColor DarkYellow
} else {
    py -3.12 -m venv .venv
    Write-Host "  Created .venv" -ForegroundColor Green
}

# --- Activate virtual environment ---
Write-Host "[3/6] Activating virtual environment..." -ForegroundColor Yellow
& .\.venv\Scripts\Activate.ps1
Write-Host "  Activated. Python: $(python --version)" -ForegroundColor Green

# --- Upgrade pip ---
Write-Host "[4/6] Upgrading pip..." -ForegroundColor Yellow
python -m pip install --upgrade pip --quiet
Write-Host "  pip upgraded." -ForegroundColor Green

# --- Install dependencies ---
Write-Host "[5/6] Installing Python dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt --quiet
Write-Host "  Dependencies installed." -ForegroundColor Green

# --- Create data directories ---
Write-Host "[6/6] Creating data directories..." -ForegroundColor Yellow
$dirs = @("data\raw", "data\cleaned", "data\exports")
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  Created $dir" -ForegroundColor Green
    } else {
        Write-Host "  $dir already exists" -ForegroundColor DarkYellow
    }
}

# --- Copy .env if needed ---
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host ""
        Write-Host "  Created .env from .env.example" -ForegroundColor Yellow
        Write-Host "  >>> IMPORTANT: Edit .env with your actual credentials <<<" -ForegroundColor Red
    }
}

# --- Verify ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
python -c "import pandas; import numpy; import scipy; import sklearn; import sqlalchemy; print('All core imports successful!')"

Write-Host ""
Write-Host "Setup complete! Activate the environment with:" -ForegroundColor Green
Write-Host "  .\.venv\Scripts\Activate.ps1" -ForegroundColor White
Write-Host ""
