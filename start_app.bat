@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo   MED-AI: Starting Backend and Frontend Services
echo ========================================================
echo.

:: Check backend virtualenv
if not exist "backend\.venv\Scripts\python.exe" (
    echo [ERROR] Backend virtual environment not found in backend\.venv
    echo Run setup.bat first to set up environments.
    pause
    exit /b 1
)

:: Check frontend node_modules
if not exist "frontend\node_modules" (
    echo [ERROR] Frontend node_modules not found in frontend\node_modules
    echo Run setup.bat or 'cd frontend ^&^& npm install' first.
    pause
    exit /b 1
)

echo [1/2] Launching Backend on http://127.0.0.1:8000 ...
start "MED-AI Backend (FastAPI)" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

echo [2/2] Launching Frontend on http://localhost:5173 ...
start "MED-AI Frontend (Vite)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ========================================================
echo   Both services are launching in separate windows!
echo   - Backend:  http://127.0.0.1:8000 (Docs: /docs)
echo   - Frontend: http://localhost:5173
echo ========================================================
echo.
timeout /t 3 >nul
start http://localhost:5173
exit /b 0
