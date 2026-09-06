# HAVOC End-to-End Demonstration Guide

This guide walks through the complete HAVOC verification workflow across all components:
1. **Demo Target Application** (`demo-app/`) running locally on port `4040`.
2. **HAVOC Chrome Extension** (`extension/`) running as a Chrome Manifest V3 extension.
3. **HAVOC Go Backend + Postgres** (`backend/` + Docker Compose) running on port `8080` & `5432`.
4. **Automated End-to-End API Integration Test** (`backend/tests/integration/api_test.go`).

---

## Architecture & Port Mapping

| Component | Role | Local Address |
| :--- | :--- | :--- |
| **Demo App** | Target application with 6 isolated flaws | `http://localhost:4040` |
| **HAVOC Extension** | In-browser autonomous resilience & chaos engine | Chrome Extension (`extension/dist`) |
| **Go API (`havoc-api`)** | REST backend for report persistence & sync | `http://localhost:8080` |
| **Postgres Database** | Relational storage for projects, ship checks & findings | `localhost:5432` |

---

## Step 1: Start the Backend & Database

Start the Go API and Postgres database using Docker Compose:

```bash
docker compose up --build -d
```

Verify that the backend is running and healthy:

```bash
curl -i http://localhost:8080/healthz
```

**Expected Response (`200 OK`):**
```json
{
  "status": "ok",
  "time": "2026-09-06T06:00:00Z"
}
```

---

## Step 2: Start the Demo Target Application in Broken Mode

In a terminal, start the demo application configured in **broken** mode:

```bash
npm run demo:broken --prefix demo-app
```

**Output:**
```
[HAVOC Demo App] Mode: BROKEN (6 deliberate flaws active)
[HAVOC Demo App] Server listening at http://localhost:4040
```

Open `http://localhost:4040` in Google Chrome to inspect the demo dashboard. You will see a banner indicating `Mode: BROKEN` with deliberate flaws in network error handling, latency feedback, input fuzzing, runtime null access, client-side credentials, and viewport layout constraints.

---

## Step 3: Build & Load the HAVOC Chrome Extension

1. Build the extension bundle:
   ```bash
   npm run build --prefix extension
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the directory:
   `<repo-root>/extension/dist`
5. Pin the **HAVOC** extension icon in your Chrome toolbar.

---

## Step 4: Configure Backend Sync in the Extension

1. Click the HAVOC extension icon in your browser toolbar to open the popup.
2. Navigate to **Configure** (or Settings).
3. Set the Backend URL to:
   ```
   http://localhost:8080
   ```
4. Save the configuration.

---

## Step 5: Run Ship Check Against Broken Demo App

1. Navigate to `http://localhost:4040` in your active browser tab.
2. Open the HAVOC extension popup.
3. Click **Start Ship Check**.
4. Observe the real-time execution across the 6 autonomous check phases:
   - `fetch_failure`: Intercepts and tests `/api/items?fail=true`
   - `fetch_latency`: Evaluates UI behavior under delayed `/api/slow-endpoint`
   - `input_stress`: Fuzzes input fields with boundary inputs
   - `runtime_errors`: Observes unhandled exceptions and console errors
   - `secret_scan`: Scans client DOM and scripts for sensitive patterns
   - `viewport_stress`: Tests layout responsiveness across viewport widths

### Expected Results (Broken Mode)
- **Readiness**: `NEEDS_ATTENTION` or `BLOCKED` (Amber/Red status tag)
- **Findings**: Surfaced findings across multiple checks:
  - `fetch_failure`: Uncaught HTTP 500 error / unhandled rejection
  - `fetch_latency`: Missing loading indicators during high-latency requests
  - `input_stress`: Uncaught TypeError on search filter string splitting
  - `runtime_errors`: Uncaught TypeError accessing undefined user properties
  - `secret_scan`: Client-side embedded credential pattern
  - `viewport_stress`: Fixed 1050px table causing horizontal layout overflow
- **Sync Status**: `SYNCED` tag in green indicating successful background ingest to `http://localhost:8080`.

---

## Step 6: Inspect Autopsy & Copy Fix Prompt

1. Click on any finding (e.g. `fetch_failure` or `runtime_errors`) to open the **Autopsy** screen.
2. Review the four structured remediation sections:
   - **What Happened**: Clear root cause breakdown.
   - **Why It Matters**: Business and user experience impact.
   - **How To Fix**: Concrete engineering steps.
   - **Fix Prompt**: A zero-fluff, LLM-ready prompt.
3. Click **Copy Fix Prompt** to copy the actionable instructions to your clipboard.

---

## Step 7: Switch Demo App to Fixed Mode & Re-test

Switch the demo target application to **fixed** mode either by clicking the switch link in the web banner (`http://localhost:4040?mode=fixed`) or running:

```bash
npm run demo:fixed --prefix demo-app
```

Now rerun the Ship Check in HAVOC:
1. Reload `http://localhost:4040`.
2. Open HAVOC and click **Start Ship Check**.
3. Observe all 6 steps complete cleanly.

### Expected Results (Fixed Mode)
- **Readiness**: `READY` (Bright green status tag).
- **Findings**: 0 findings reported.
- **Sync Status**: `SYNCED`.

---

## Step 8: Retrieve Stored Reports from the Go Backend

Verify that reports ingested from HAVOC are persisted in Postgres and queryable via the Go REST API.

### 1. List Projects
```bash
curl -s http://localhost:8080/api/v1/projects
```

**Example Output:**
```json
{
  "projects": [
    {
      "id": "7b0d2d3a-14d2-43e5-82b5-8dc87dfbf4a2",
      "name": "Default Project",
      "createdAt": "2026-09-06T06:05:00Z"
    }
  ]
}
```

### 2. List Ship Checks for the Project
Export your project ID:
```bash
PROJECT_ID="7b0d2d3a-14d2-43e5-82b5-8dc87dfbf4a2"
curl -s "http://localhost:8080/api/v1/projects/${PROJECT_ID}/ship-checks"
```

**Example Output:**
```json
{
  "shipChecks": [
    {
      "id": "e2c34a9b-1188-4e12-b9cf-8924b1720892",
      "projectId": "7b0d2d3a-14d2-43e5-82b5-8dc87dfbf4a2",
      "clientShipCheckId": "c89b1c70-ea8d-4e9b-b0b3-9e598b9bf901",
      "targetOrigin": "http://localhost:4040",
      "readiness": "NEEDS_ATTENTION",
      "createdAt": "2026-09-06T06:10:00Z",
      "completedAt": "2026-09-06T06:10:12Z",
      "syncedAt": "2026-09-06T06:10:13Z",
      "steps": [
        { "kind": "fetch_failure", "status": "DONE", "ordinal": 0 },
        { "kind": "fetch_latency", "status": "DONE", "ordinal": 1 },
        { "kind": "input_stress", "status": "DONE", "ordinal": 2 },
        { "kind": "runtime_errors", "status": "DONE", "ordinal": 3 },
        { "kind": "secret_scan", "status": "DONE", "ordinal": 4 },
        { "kind": "viewport_stress", "status": "DONE", "ordinal": 5 }
      ]
    }
  ]
}
```

### 3. Retrieve Findings & Autopsy Details for a Ship Check
Export your Ship Check ID:
```bash
SHIP_CHECK_ID="e2c34a9b-1188-4e12-b9cf-8924b1720892"
curl -s "http://localhost:8080/api/v1/ship-checks/${SHIP_CHECK_ID}/findings"
```

**Example Output:**
```json
{
  "findings": [
    {
      "id": "90d1bf42-992a-4bc4-bda5-132d91bb14a7",
      "shipCheckId": "e2c34a9b-1188-4e12-b9cf-8924b1720892",
      "clientFindingId": "finding-fetch-fail-001",
      "checkKind": "fetch_failure",
      "severity": "HIGH",
      "confidence": 0.95,
      "description": "Uncaught HTTP 500 on /api/items leaving UI frozen in loading state",
      "evidence": [
        {
          "kind": "network_request",
          "refId": "req-500-error",
          "capturedAt": "2026-09-06T06:10:02Z"
        }
      ],
      "remediation": {
        "title": "Add Error Boundary and Network Retry",
        "whatHappened": "The application made a request to /api/items which returned HTTP 500.",
        "whyItMatters": "Users are left on an infinite spinner with no feedback or retry path.",
        "howToFix": [
          "Wrap network requests in try-catch blocks",
          "Render an error state banner with a retry button"
        ],
        "fixPrompt": "Implement comprehensive error state handling and user-visible feedback on /api/items failure."
      }
    }
  ]
}
```

---

## Step 9: Run Automated Black-Box Integration Tests

You can run the end-to-end Go integration test suite against the running Docker environment or standalone Postgres instance:

```bash
cd backend
INTEGRATION_TEST=1 go test -v ./tests/integration/...
```

**Expected Output:**
```
=== RUN   TestEndToEndAPI
--- PASS: TestEndToEndAPI (0.05s)
PASS
ok      github.com/Abhiix0/Havoc/backend/tests/integration      0.300s
```

---

## Teardown

When finished with testing, shut down the Docker services and clean up volumes:

```bash
docker compose down -v
```
