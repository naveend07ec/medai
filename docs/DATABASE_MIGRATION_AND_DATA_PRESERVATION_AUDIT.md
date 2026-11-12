# Database Migration & Data Preservation Audit

**Audit Date:** 2026-11-12  
**Scope:** Read-only verification of PostgreSQL configuration, connectivity, Alembic migrations, data preservation, Knowledge Base state, local-vs-Aiven comparison, and read-only application endpoints.  
**Overall Classification:** **VERIFIED** *(with one expected post-migration delta: Aiven holds 12 `diagnostic_reports` vs 11 in local PostgreSQL because 1 new report was generated after switching to Aiven).*

---

## 1. Active Database Identification (Sanitized)

- **Configuration Source:** `backend/.env` (`DATABASE_URL`), loaded by `Settings` in `backend/app/core/config.py` (`env_file=BASE_DIR / ".env"`).
- **Active Target:** **Aiven PostgreSQL**
  - **Driver:** `postgresql+psycopg`
  - **Host:** `pg-11e7b808-naveendseven-633b.b.aivencloud.com`
  - **Port:** `19550`
  - **Database:** `defaultdb`
  - **SSL Mode:** `require` (verified active TLS connection via `pg_stat_ssl`)
- **Overrides & Other Config Files:**
  - `backend/alembic.ini` leaves `sqlalchemy.url` blank; `database/migrations/env.py` resolves `Settings().get_database_url()`.
  - Root `.env` (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PORT=5436`) and `docker-compose.yml` (`postgres:16-alpine`, container `healthcare-genai-postgres`) configure the local Docker PostgreSQL instance, not the backend `DATABASE_URL` when `DATABASE_URL` is set in `backend/.env`.
  - `backend/.env.example` contains placeholder values only.
  - `backend/app/core/database.py` creates a module-level `engine` from `get_settings().get_database_url()` with `pool_pre_ping=True`.
- **Running Backend:** Live server on `http://localhost:8000` is healthy (`GET /health` -> `200 OK`, `GET /api/v1/knowledge/status` -> `12` documents, `291` chunks).
- **Status:** **VERIFIED**

---

## 2. Database Connectivity Status

- **SQLAlchemy Engine (`get_engine()`):** Connected cleanly to database `defaultdb`, schema `public`.
- **Direct `psycopg` Connectivity:** Connected cleanly with `ssl_active = True` (`sslmode=require`).
- **Read Access:** Confirmed read queries against all 7 tables in `public`.
- **Status:** **VERIFIED**

---

## 3. PostgreSQL Version and Database Name

- **Active Database (Aiven):**
  - **PostgreSQL Version:** `PostgreSQL 18.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.3.1 20260722 (Red Hat 15.3.1-1), 64-bit`
  - **Database Name:** `defaultdb`
  - **Schema:** `public`
- **Local Docker Database (for comparison):**
  - **PostgreSQL Version:** `PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit`
  - **Database Name:** `healthcare_genai`
  - **Schema:** `public`
- **Status:** **VERIFIED**

---

## 4. Alembic Migration Status

Executed read-only Alembic commands against the active Aiven database (`backend/.venv\Scripts\python.exe -m alembic ...`):

- `alembic current`: `20261112_0004 (head)`
- `alembic heads`: `20261112_0004 (head)` (single head, no branching)
- `alembic history`:
  1. `<base> -> 20261110_0001`: Create `patients` and `clinical_assessments` tables
  2. `20261110_0001 -> 20261110_0002`: Create `diagnostic_reports` table
  3. `20261110_0002 -> 20261111_0003`: Create `knowledge_documents` and `knowledge_chunks` tables
  4. `20261111_0003 -> 20261112_0004 (head)`: Create `assessment_attachments` table
- `alembic check`: `No new upgrade operations detected.` (live Aiven schema matches SQLAlchemy ORM models).
- **Status:** **VERIFIED**

---

## 5. Actual Record Counts for Important Tables (Aiven `defaultdb`)

| Table | Record Count |
|---|---|
| `patients` | 7 |
| `clinical_assessments` | 9 |
| `diagnostic_reports` | 12 |
| `assessment_attachments` | 5 |
| `knowledge_documents` | 12 |
| `knowledge_chunks` | 291 |
| `alembic_version` | 1 (`20261112_0004`) |

- **Status:** **VERIFIED**

---

## 6. Knowledge Base Preservation Verification

- **Totals:** `12` documents and `291` chunks in `defaultdb` (matches expected `12` documents and `291` chunks).
- **Existing NIDDK Reference Preserved:** `NIDDK Diabetes Tests & Diagnosis Guidelines` (`3` chunks) is present.
- **11 Additional Ingested Documents Present:**
  1. `ICMR STW: Acute Respiratory Infection in Adults` (`26` chunks)
  2. `ICMR STW: Cardiology (STEMI / Acute Coronary Syndrome)` (`19` chunks)
  3. `ICMR STW: Chronic Obstructive Pulmonary Disease (COPD)` (`24` chunks)
  4. `ICMR STW: Diabetes Mellitus Type 2 (ICD-10-E11)` (`13` chunks)
  5. `ICMR STW: Hypertension in Adults` (`18` chunks)
  6. `ICMR STW: Management of Asthma (ICD-10-J45)` (`11` chunks)
  7. `ICMR STW: Management of Respiratory Failure` (`23` chunks)
  8. `NHS Shropshire Point-of-Care CRP Testing in Lower Respiratory Tract Infections` (`23` chunks)
  9. `NIH MedlinePlus: White Blood Count (WBC) Medical Test Guide` (`99` chunks)
  10. `WHO Interagency Integrated Triage Tool (Age >= 12)` (`10` chunks)
  11. `WHO Interim Guidance: Pulse Oximetry in Home-Based Monitoring` (`22` chunks)
- **WHO Pulse Oximetry Training Manual:** Confirmed **NOT** ingested in `knowledge_documents` (only the WHO Home-Based Monitoring Pulse Oximetry guidance is present).
- **Status:** **VERIFIED**

---

## 7. Local PostgreSQL vs Aiven Comparison

Both databases were accessible and inspected read-only:

| Aspect | Local PostgreSQL (`healthcare_genai`) | Aiven PostgreSQL (`defaultdb`) | Comparison |
|---|---|---|---|
| PostgreSQL Version | 16.15 (Alpine) | 18.6 (Red Hat) | Different major versions (expected) |
| SSL Active | `False` | `True` (`sslmode=require`) | TLS active on Aiven |
| `public` Tables | Same 7 tables | Same 7 tables | Identical schema |
| `alembic_version` | `20261112_0004` | `20261112_0004` | Identical |
| `patients` | 7 | 7 | Identical |
| `clinical_assessments` | 9 | 9 | Identical |
| `diagnostic_reports` | 11 | 12 | **+1 on Aiven** (new report generated on Aiven after migration) |
| `assessment_attachments` | 5 | 5 | Identical |
| `knowledge_documents` | 12 | 12 | Identical titles & chunk counts |
| `knowledge_chunks` | 291 | 291 | Identical |

- **Missing Records Check:** No records from local PostgreSQL are missing from Aiven. Aiven has 1 additional `diagnostic_reports` row created after the switch to Aiven.
- **Status:** **VERIFIED**

---

## 8. Application Endpoint Verification (Read-Only)

Verified via FastAPI `TestClient(app)` against the active Aiven configuration (no writes or diagnostic generation triggered):

| Check | Result |
|---|---|
| `GET /health` | `200 OK` (`{"status": "healthy", "service": "Healthcare GenAI Backend"}`) |
| `GET /api/v1/patients` | `200 OK` (`7` patients returned) |
| `GET /api/v1/assessments` | `200 OK` (`9` assessments returned) |
| `GET /api/v1/assessments/{id}/report` | `200 OK` |
| `GET /api/v1/knowledge/status` | `200 OK` (`document_count: 12`, `chunk_count: 291`, `embedding_service_ready: true`) |
| `GET /api/v1/knowledge/documents` | `200 OK` (`12` documents returned) |
| Synthetic RAG retrieval (`retrieval_service.retrieve`) | `status: "evidence_found"`, `sufficient_evidence: true`, `total_chunks_searched: 291`, `returned_chunks: 3` (NHS CRP, ICMR Acute Respiratory Infection, ICMR Respiratory Failure) |

- **Status:** **VERIFIED**

---

## 9. Missing Records, Schema Mismatches, or Discrepancies

- **Schema Mismatches:** None (`alembic check` reported `No new upgrade operations detected.`).
- **Missing Records in Aiven:** None (all `7` patients, `9` assessments, `11` prior reports, `5` attachments, `12` knowledge documents, and `291` chunks from local PostgreSQL are present in Aiven).
- **Discrepancy Observed:** `diagnostic_reports` has `12` rows on Aiven vs `11` rows on local PostgreSQL because 1 new diagnostic report was generated directly against Aiven after migration.
- **Status:** **VERIFIED** *(expected post-migration write on Aiven; no data loss)*.

---

## 10. Safety to Continue Using Active Database

- **Safe to Continue Using Aiven `defaultdb`:** **YES — VERIFIED.**
  - Active connection uses TLS (`sslmode=require`, `ssl_active=True`).
  - Alembic schema is at `20261112_0004 (head)` with zero drift.
  - All patient, assessment, attachment, report, and Knowledge Base records are intact and readable by the application.

---

## 11. Recommended Next Action

- **No database migration, data transfer, or `.env` changes are needed.** Continue using the active Aiven PostgreSQL configuration.
- Keep the local Docker PostgreSQL volume untouched as a historical backup until you decide it is no longer needed.

