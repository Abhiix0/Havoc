# HAVOC Backend & Persistence Guide

HAVOC includes an optional, production-ready Go REST API backed by PostgreSQL for storing project registries, Ship Check audit reports, findings, and remediation history across development teams.

---

## Configuration & Environment Variables

Environment variables are defined in [`backend/.env.example`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/backend/.env.example):

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://havoc:havoc_dev_password@localhost:5432/havoc?sslmode=disable` |
| `PORT` | HTTP server listen port with colon prefix | `:8080` |

---

## Running the Backend

### Option A: Docker Compose (Recommended)
Docker Compose starts both the PostgreSQL 16 database and the `havoc-api` container in a single command. Database migrations run automatically at startup.

```bash
# From repository root:
docker compose up --build -d
```

Verify service health:
```bash
curl -i http://localhost:8080/healthz
```
*Expected response: `200 OK` with `{"status":"ok"}`.*

To stop and remove containers (including database volume):
```bash
docker compose down -v
```

---

### Option B: Native Go Execution
Ensure a local PostgreSQL instance is running on port 5432 with database `havoc`.

```bash
cd backend

# Copy sample environment variables
cp .env.example .env

# Build and run
go run ./cmd/havoc-api
```

Run backend unit and integration tests:
```bash
cd backend
go test ./...

# Integration tests against running Postgres:
INTEGRATION_TEST=1 go test -v ./tests/integration/...
```

---

## REST API Routes

The HTTP router is defined in [`backend/internal/http/router.go`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/backend/internal/http/router.go):

### System Health
- **`GET /healthz`**: Returns API health status and timestamp.

### Projects
- **`POST /api/v1/projects`**: Create a new project workspace.
  ```json
  // Request
  { "name": "Payment Gateway Frontend" }
  // Response (201 Created)
  { "id": "uuid", "name": "Payment Gateway Frontend", "createdAt": "..." }
  ```
- **`GET /api/v1/projects`**: List all registered projects.
- **`GET /api/v1/projects/{id}`**: Retrieve project details by ID.

### Ship Check Ingestion & Sync
- **`POST /api/v1/projects/{id}/ship-checks`**: Ingest a complete Ship Check report (run metadata, steps, findings, evidence, and remediations) sent from the extension.
- **`GET /api/v1/projects/{id}/ship-checks`**: List all Ship Check audit runs for the specified project.

### Findings & Audit Details
- **`GET /api/v1/ship-checks/{id}`**: Retrieve a specific Ship Check run and its execution step summaries.
- **`GET /api/v1/ship-checks/{id}/findings`**: Retrieve all findings, technical evidence, and remediations associated with a Ship Check run.
