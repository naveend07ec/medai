@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found at "%~dp0.venv\Scripts\python.exe"
    exit /b 1
)

echo Starting Healthcare GenAI Platform Backend on http://127.0.0.1:8000 ...
echo API Docs: http://127.0.0.1:8000/docs
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

