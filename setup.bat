@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo   MED-AI: Local Development Setup & Verification
echo ========================================================
echo.

:: 1. Check Python
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python 3.11+.
    pause
    exit /b 1
)

:: 2. Check Node
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js / npm is not installed or not in PATH. Please install Node.js 18+.
    pause
    exit /b 1
)

:: 3. Setup backend environment
cd backend
if not exist ".env" (
    echo [INFO] Creating backend/.env from .env.example...
    copy ".env.example" ".env" >nul
    echo [ACTION REQUIRED] Please edit backend/.env with your DATABASE_URL and GEMINI_API_KEY.
)

if not exist ".venv" (
    echo [INFO] Creating Python virtual environment in backend/.venv...
    python -m venv .venv
)

echo [INFO] Installing backend dependencies...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install backend requirements.
    pause
    exit /b 1
)

:: 4. Run Alembic migrations
echo [INFO] Applying database migrations...
python -m alembic upgrade head
if %ERRORLEVEL% neq 0 (
    echo [WARN] Alembic migration failed. Ensure your PostgreSQL database is running and DATABASE_URL in backend/.env is reachable.
)

cd ..

:: 5. Setup frontend environment
cd frontend
if not exist ".env" (
    echo [INFO] Creating frontend/.env from .env.example...
    copy ".env.example" ".env" >nul
)

echo [INFO] Installing frontend npm dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install frontend npm packages.
    pause
    exit /b 1
)

cd ..

echo.
echo ========================================================
echo   Setup Complete!
echo ========================================================
echo   To run the project:
echo     1. Start backend:  cd backend ^&^& start_backend.bat
echo     2. Start frontend: cd frontend ^&^& npm run dev
echo     3. Open browser:   http://localhost:5173
echo ========================================================
echo.
pause
