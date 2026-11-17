@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==============================================================================
echo                 MED-AI: Automated One-Click System Setup
echo        Reimagining Healthcare with Generative AI (Project: 27CSPS028)
echo ==============================================================================
echo.

:: 1. Check Python
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python 3.11+ is not found in your PATH.
    echo Please install Python 3.11 from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] Python detected: %PY_VER%

:: 2. Check Node & npm
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js / npm is not found in your PATH.
    echo Please install Node.js 18+ or 20+ from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=1" %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
echo [OK] Node.js detected: %NODE_VER%
echo.

:: 3. Prepare Environment Files
echo ------------------------------------------------------------------------------
echo [Step 1/5] Checking Environment Configuration (.env)...
echo ------------------------------------------------------------------------------

if not exist "backend\.env" (
    if exist "backend\.env.example" (
        echo [INFO] Creating backend\.env from template...
        copy "backend\.env.example" "backend\.env" >nul
        echo [!] IMPORTANT: Please open 'backend\.env' and paste your DATABASE_URL and GEMINI_API_KEY.
    ) else (
        echo [WARN] backend\.env.example was not found.
    )
) else (
    echo [OK] backend\.env already exists.
)

if not exist "frontend\.env" (
    echo [INFO] Creating frontend\.env...
    echo VITE_API_BASE_URL=http://127.0.0.1:8000> "frontend\.env"
) else (
    echo [OK] frontend\.env already exists.
)
echo.

:: 4. Backend Setup
echo ------------------------------------------------------------------------------
echo [Step 2/5] Setting up Python Virtual Environment (backend\.venv)...
echo ------------------------------------------------------------------------------
cd backend
if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Creating virtual environment...
    python -m venv .venv
)
echo [OK] Virtual environment ready.

echo.
echo ------------------------------------------------------------------------------
echo [Step 3/5] Installing Backend Python Dependencies...
echo ------------------------------------------------------------------------------
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul 2>&1
echo [INFO] Installing packages from requirements.txt (this may take 1-2 minutes)...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install Python dependencies. Please check network/pip.
    pause
    exit /b 1
)
echo [OK] Python dependencies installed successfully.

echo.
echo ------------------------------------------------------------------------------
echo [Step 4/5] Checking Database & Applying Alembic Migrations...
echo ------------------------------------------------------------------------------
python -m alembic upgrade head
if %ERRORLEVEL% neq 0 (
    echo [WARN] Alembic migration reported an issue.
    echo If this is your first run, ensure your DATABASE_URL in backend\.env is valid and online.
) else (
    echo [OK] Database schema is up to date.
)

cd ..

:: 5. Frontend Setup
echo.
echo ------------------------------------------------------------------------------
echo [Step 5/5] Installing Frontend Dependencies (npm install)...
echo ------------------------------------------------------------------------------
cd frontend
if not exist "node_modules" (
    echo [INFO] Installing npm packages (this may take 1-2 minutes)...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install npm packages.
        pause
        exit /b 1
    )
) else (
    echo [OK] node_modules already exists. Skipping npm install.
)
cd ..

echo.
echo ==============================================================================
echo                         SETUP COMPLETED SUCCESSFULLY!
echo ==============================================================================
echo.
echo How to run the project anytime:
echo   1. Simply double-click: start_app.bat
echo   2. It will automatically start both Backend and Frontend and open your browser!
echo.
echo Access URLs:
echo   - Web Application: http://localhost:5173
echo   - Backend Swagger API Docs: http://127.0.0.1:8000/docs
echo   - Backend Health Check: http://127.0.0.1:8000/health
echo ==============================================================================
echo.
pause
