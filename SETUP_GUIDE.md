# MED-AI — Developer Setup & Quickstart Guide

This guide ensures anyone who clones the **MED-AI** repository can set up and run the full stack locally with zero friction.

---

## 1. Prerequisites

Ensure your system has the following installed:

- **Python**: Version `3.11` (or 3.10+)
- **Node.js**: Version `18+` (or 20+) with `npm`
- **PostgreSQL**: Either:
  - Local PostgreSQL running on port `5432` (or `5436` via Docker Compose), or
  - Any cloud PostgreSQL instance (Aiven, Neon, Supabase, AWS RDS, etc.) with SSL support.
- **Git**

---

## 2. Quick Setup (Windows Automated Script)

If you are on Windows, simply run:

```cmd
setup.bat
```

This automated script will:
1. Verify Python and Node/npm installations.
2. Create `backend/.env` from `backend/.env.example`.
3. Create the Python virtual environment at `backend/.venv`.
4. Install all Python dependencies from `backend/requirements.txt`.
5. Run database migrations via Alembic (`alembic upgrade head`).
6. Create `frontend/.env` and install all frontend dependencies (`npm install`).

---

## 3. Manual Step-by-Step Setup

### Step A: Database Configuration

#### Option 1: Using Docker Compose (Local Database)
From the project root:
```bash
docker compose up -d postgres
```
This starts PostgreSQL 16 on port `5436` with database `healthcare_genai`.

#### Option 2: Using Any Existing or Cloud PostgreSQL
Ensure you have a PostgreSQL connection string ready:
```
postgresql+psycopg://<user>:<password>@<host>:<port>/<database>?sslmode=require
```

---

### Step B: Backend Setup (FastAPI + Python)

1. **Navigate to the backend directory**:
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment**:
   - On Windows:
     ```cmd
     python -m venv .venv
     .venv\Scripts\activate
     ```
   - On macOS/Linux:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. **Install dependencies**:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

4. **Configure environment variables**:
   Copy `.env.example` to `.env`:
   ```bash
   copy .env.example .env    # On Windows
   cp .env.example .env      # On Linux/macOS
   ```
   Open `backend/.env` and configure:
   - `DATABASE_URL`: Set your PostgreSQL connection string.
   - `GEMINI_API_KEY`: Enter your Google Gemini API key from [Google AI Studio](https://aistudio.google.com/).

5. **Run Database Migrations**:
   ```bash
   alembic upgrade head
   ```

6. **(Optional) Seed Initial Sample Patients & Guidelines**:
   ```bash
   python seed_data.py
   ```

7. **Start the Backend Server**:
   - On Windows: run `start_backend.bat`, or:
   ```bash
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```
   - API Docs will be available at: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
   - Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

---

### Step C: Frontend Setup (React 19 + TypeScript + Vite)

1. **Open a new terminal and navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install npm dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   copy .env.example .env    # On Windows
   cp .env.example .env      # On Linux/macOS
   ```
   *(Defaults to `VITE_API_BASE_URL=http://127.0.0.1:8000`)*

4. **Start the Frontend Development Server**:
   ```bash
   npm run dev
   ```

5. **Open the Application**:
   Navigate to [http://localhost:5173](http://localhost:5173) in your web browser.

---

## 4. Running Tests to Verify Setup

### Backend Tests
From the `backend` directory:
```bash
pytest
```
Expected result: `49 passed, 1 skipped` (the 1 skipped test is the live opt-in smoke test requiring `RUN_LIVE_GEMINI_TESTS=1`).

### Frontend Tests & Typecheck
From the `frontend` directory:
```bash
npm run lint    # Verifies oxlint (0 errors)
npm test        # Runs Vitest test suite (12 passed)
npm run build   # Verifies TypeScript compilation and production bundle build
```

---

## 5. Troubleshooting

- **Database Connection Error (`503` / `sqlalchemy_error_handler`)**:
  - Verify PostgreSQL is running and credentials in `backend/.env` are correct.
  - If using Aiven or cloud PostgreSQL, verify `?sslmode=require` is present at the end of `DATABASE_URL`.
  - Always use the driver prefix `postgresql+psycopg://` (not `postgres://`).
- **Gemini Quota or Rate Limit**:
  - Ensure `GEMINI_API_KEY` is valid.
  - Free tier Google AI Studio keys provide ample RPM/TPM for evaluation and research demonstrations.
- **Port Conflicts**:
  - Backend default port is `8000`. If occupied, change `--port <PORT>` in `start_backend.bat` and update `VITE_API_BASE_URL` in `frontend/.env`.
  - Frontend default port is `5173`.
