package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/config"
	"github.com/Abhiix0/Havoc/backend/internal/domain"
	internalHttp "github.com/Abhiix0/Havoc/backend/internal/http"
	"github.com/Abhiix0/Havoc/backend/internal/repository/postgres"
	"github.com/Abhiix0/Havoc/backend/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupTestEnvironment(t *testing.T) (baseURL string, cleanupDB func(projectID string)) {
	t.Helper()

	if os.Getenv("INTEGRATION_TEST") != "1" && os.Getenv("TEST_API_URL") == "" && os.Getenv("DATABASE_URL") == "" && os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("skipping integration test: set INTEGRATION_TEST=1 or TEST_API_URL/DATABASE_URL to run")
	}

	// 1. If explicit TEST_API_URL is provided, use it directly
	if apiURL := os.Getenv("TEST_API_URL"); apiURL != "" {
		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" {
			dbURL = os.Getenv("TEST_DATABASE_URL")
		}
		var pool *pgxpool.Pool
		if dbURL != "" {
			var err error
			pool, err = postgres.NewPool(context.Background(), dbURL)
			if err != nil {
				t.Logf("warning: could not connect to database for cleanup: %v", err)
			}
		}
		return apiURL, func(projectID string) {
			if pool != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if pUUID, err := uuid.Parse(projectID); err == nil {
					_, _ = pool.Exec(ctx, "DELETE FROM projects WHERE id = $1", pUUID)
				}
				pool.Close()
			}
		}
	}

	// 2. Check if a live server is already running on :8080
	client := &http.Client{Timeout: 1 * time.Second}
	resp, err := client.Get("http://localhost:8080/healthz")
	if err == nil && resp.StatusCode == http.StatusOK {
		_ = resp.Body.Close()
		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" {
			dbURL = os.Getenv("TEST_DATABASE_URL")
		}
		if dbURL == "" {
			dbURL = "postgres://havoc:havoc_dev_password@localhost:5432/havoc?sslmode=disable"
		}
		var pool *pgxpool.Pool
		pool, err = postgres.NewPool(context.Background(), dbURL)
		if err != nil {
			t.Logf("warning: could not connect to database for cleanup: %v", err)
		}
		return "http://localhost:8080", func(projectID string) {
			if pool != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if pUUID, err := uuid.Parse(projectID); err == nil {
					_, _ = pool.Exec(ctx, "DELETE FROM projects WHERE id = $1", pUUID)
				}
				pool.Close()
			}
		}
	}

	// 3. Otherwise start an ephemeral httptest.Server backed by Postgres
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = os.Getenv("TEST_DATABASE_URL")
	}
	if dbURL == "" {
		dbURL = "postgres://havoc:havoc_dev_password@localhost:5432/havoc?sslmode=disable"
	}

	ctx := context.Background()
	if err := postgres.RunMigrations(dbURL); err != nil {
		t.Fatalf("failed to run database migrations: %v", err)
	}

	pool, err := postgres.NewPool(ctx, dbURL)
	if err != nil {
		t.Fatalf("failed to connect to database: %v", err)
	}

	projectRepo := postgres.NewProjectRepository(pool)
	shipCheckRepo := postgres.NewShipCheckRepository(pool)
	projectSvc := service.NewProjectService(projectRepo)
	shipCheckSvc := service.NewShipCheckService(shipCheckRepo)

	cfg := config.Config{
		Port:        ":0",
		DatabaseURL: dbURL,
		Env:         "test",
	}
	router := internalHttp.NewRouter(cfg, projectSvc, shipCheckSvc)
	ts := httptest.NewServer(router)

	t.Cleanup(func() {
		ts.Close()
	})

	return ts.URL, func(projectID string) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if pUUID, err := uuid.Parse(projectID); err == nil {
			_, _ = pool.Exec(ctx, "DELETE FROM projects WHERE id = $1", pUUID)
		}
		pool.Close()
	}
}

func TestEndToEndAPI(t *testing.T) {
	baseURL, cleanup := setupTestEnvironment(t)

	client := &http.Client{Timeout: 10 * time.Second}

	// 1. Create a Project via POST /api/v1/projects
	projectName := fmt.Sprintf("E2E Test Project %s", uuid.NewString()[:8])
	createProjBody, err := json.Marshal(map[string]string{
		"name": projectName,
	})
	if err != nil {
		t.Fatalf("failed to marshal create project body: %v", err)
	}

	resp, err := client.Post(baseURL+"/api/v1/projects", "application/json", bytes.NewReader(createProjBody))
	if err != nil {
		t.Fatalf("POST /api/v1/projects failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201 Created for project creation, got %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var createdProject struct {
		ID        string    `json:"id"`
		Name      string    `json:"name"`
		CreatedAt time.Time `json:"createdAt"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&createdProject); err != nil {
		t.Fatalf("failed to decode create project response: %v", err)
	}

	if createdProject.ID == "" || createdProject.Name != projectName {
		t.Fatalf("invalid project response: %+v", createdProject)
	}

	t.Cleanup(func() {
		cleanup(createdProject.ID)
	})

	// 2. Ingest realistic Ship Check payload matching EXACT shape of buildSyncPayload()
	clientShipCheckID := fmt.Sprintf("shipcheck-e2e-%s", uuid.NewString()[:8])
	nowMs := time.Now().UnixMilli()
	createdMs := nowMs - 15000
	completedMs := nowMs

	syncPayload := map[string]any{
		"clientShipCheckId": clientShipCheckID,
		"targetOrigin":      "http://localhost:4040",
		"readiness":         "NEEDS_ATTENTION",
		"createdAt":         createdMs,
		"completedAt":       completedMs,
		"steps": []map[string]any{
			{"kind": "fetch_failure", "status": "DONE", "ordinal": 0},
			{"kind": "fetch_latency", "status": "DONE", "ordinal": 1},
			{"kind": "input_stress", "status": "DONE", "ordinal": 2},
			{"kind": "runtime_errors", "status": "DONE", "ordinal": 3},
			{"kind": "secret_scan", "status": "DONE", "ordinal": 4},
			{"kind": "viewport_stress", "status": "DONE", "ordinal": 5},
		},
		"findings": []map[string]any{
			{
				"clientFindingId": fmt.Sprintf("finding-fetch-fail-%s", uuid.NewString()[:8]),
				"checkKind":       "fetch_failure",
				"severity":        "HIGH",
				"confidence":      0.95,
				"description":     "Uncaught HTTP 500 on /api/items leaving UI frozen in loading state",
				"evidence": []map[string]any{
					{
						"kind":       "network_request",
						"refId":      "req-500-error",
						"capturedAt": createdMs + 1000,
					},
				},
				"remediation": map[string]any{
					"title":        "Add Error Boundary and Network Retry",
					"whatHappened": "The application made a request to /api/items which returned HTTP 500.",
					"whyItMatters": "Users are left on an infinite spinner with no feedback or retry path.",
					"howToFix": []string{
						"Wrap network requests in try-catch blocks",
						"Render an error state banner with a retry button",
					},
					"fixPrompt": "Implement comprehensive error state handling and user-visible feedback on /api/items failure.",
				},
			},
			{
				"clientFindingId": fmt.Sprintf("finding-input-stress-%s", uuid.NewString()[:8]),
				"checkKind":       "input_stress",
				"severity":        "MEDIUM",
				"confidence":      0.85,
				"description":     "Uncaught TypeError on malformed search input string split",
				"evidence": []map[string]any{
					{
						"kind":       "error_log",
						"refId":      "err-typeerror-split",
						"capturedAt": createdMs + 3000,
					},
				},
				"remediation": map[string]any{
					"title":        "Safe Input Sanitization",
					"whatHappened": "Search filter crashed when parsing input lacking colon separator.",
					"whyItMatters": "Malformed user search terms crash the application tab.",
					"howToFix": []string{
						"Validate input structure before array indexing",
					},
					"fixPrompt": "Add defensive bounds checks to search query parser.",
				},
			},
		},
	}

	payloadBytes, err := json.Marshal(syncPayload)
	if err != nil {
		t.Fatalf("failed to marshal sync payload: %v", err)
	}

	ingestURL := fmt.Sprintf("%s/api/v1/projects/%s/ship-checks", baseURL, createdProject.ID)
	ingestResp, err := client.Post(ingestURL, "application/json", bytes.NewReader(payloadBytes))
	if err != nil {
		t.Fatalf("POST %s failed: %v", ingestURL, err)
	}
	defer ingestResp.Body.Close()

	if ingestResp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(ingestResp.Body)
		t.Fatalf("expected 201 Created for Ship Check ingest, got %d: %s", ingestResp.StatusCode, string(bodyBytes))
	}

	var createdSC domain.ShipCheck
	if err := json.NewDecoder(ingestResp.Body).Decode(&createdSC); err != nil {
		t.Fatalf("failed to decode ingested Ship Check response: %v", err)
	}

	if createdSC.ID == uuid.Nil {
		t.Fatalf("expected valid non-nil UUID for ingested ship check")
	}
	if createdSC.ClientShipCheckID != clientShipCheckID {
		t.Errorf("clientShipCheckId mismatch: got %q, want %q", createdSC.ClientShipCheckID, clientShipCheckID)
	}
	if createdSC.TargetOrigin != "http://localhost:4040" {
		t.Errorf("targetOrigin mismatch: got %q, want %q", createdSC.TargetOrigin, "http://localhost:4040")
	}
	if createdSC.Readiness != domain.ReadinessNeedsAttention {
		t.Errorf("readiness mismatch: got %q, want %q", createdSC.Readiness, domain.ReadinessNeedsAttention)
	}
	if len(createdSC.Steps) != 6 {
		t.Errorf("expected 6 steps, got %d", len(createdSC.Steps))
	}

	// 3. List Ship Checks by Project: GET /api/v1/projects/:id/ship-checks
	listURL := fmt.Sprintf("%s/api/v1/projects/%s/ship-checks", baseURL, createdProject.ID)
	listResp, err := client.Get(listURL)
	if err != nil {
		t.Fatalf("GET %s failed: %v", listURL, err)
	}
	defer listResp.Body.Close()

	if listResp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(listResp.Body)
		t.Fatalf("expected 200 OK for list ship checks, got %d: %s", listResp.StatusCode, string(bodyBytes))
	}

	var listData struct {
		ShipChecks []domain.ShipCheck `json:"shipChecks"`
		NextCursor string             `json:"nextCursor,omitempty"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&listData); err != nil {
		t.Fatalf("failed to decode list ship checks: %v", err)
	}
	if len(listData.ShipChecks) != 1 {
		t.Fatalf("expected exactly 1 ship check in project list, got %d", len(listData.ShipChecks))
	}
	if listData.ShipChecks[0].ID != createdSC.ID {
		t.Errorf("listed ship check ID mismatch: got %v, want %v", listData.ShipChecks[0].ID, createdSC.ID)
	}

	// 4. Retrieve single Ship Check: GET /api/v1/ship-checks/:id
	getURL := fmt.Sprintf("%s/api/v1/ship-checks/%s", baseURL, createdSC.ID.String())
	getResp, err := client.Get(getURL)
	if err != nil {
		t.Fatalf("GET %s failed: %v", getURL, err)
	}
	defer getResp.Body.Close()

	if getResp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(getResp.Body)
		t.Fatalf("expected 200 OK for GET ship check, got %d: %s", getResp.StatusCode, string(bodyBytes))
	}

	var fetchedSC domain.ShipCheck
	if err := json.NewDecoder(getResp.Body).Decode(&fetchedSC); err != nil {
		t.Fatalf("failed to decode fetched ship check: %v", err)
	}
	if fetchedSC.ID != createdSC.ID || fetchedSC.ClientShipCheckID != clientShipCheckID {
		t.Errorf("fetched ship check mismatch: got %+v, want ID %s", fetchedSC, createdSC.ID)
	}

	// 5. Retrieve Findings: GET /api/v1/ship-checks/:id/findings
	findingsURL := fmt.Sprintf("%s/api/v1/ship-checks/%s/findings", baseURL, createdSC.ID.String())
	findingsResp, err := client.Get(findingsURL)
	if err != nil {
		t.Fatalf("GET %s failed: %v", findingsURL, err)
	}
	defer findingsResp.Body.Close()

	if findingsResp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(findingsResp.Body)
		t.Fatalf("expected 200 OK for GET findings, got %d: %s", findingsResp.StatusCode, string(bodyBytes))
	}

	var findingsData struct {
		Findings []domain.Finding `json:"findings"`
	}
	if err := json.NewDecoder(findingsResp.Body).Decode(&findingsData); err != nil {
		t.Fatalf("failed to decode findings response: %v", err)
	}

	if len(findingsData.Findings) != 2 {
		t.Fatalf("expected 2 findings, got %d", len(findingsData.Findings))
	}

	var highFinding, medFinding *domain.Finding
	for i := range findingsData.Findings {
		f := &findingsData.Findings[i]
		if f.CheckKind == "fetch_failure" {
			highFinding = f
		} else if f.CheckKind == "input_stress" {
			medFinding = f
		}
	}

	if highFinding == nil {
		t.Fatalf("missing fetch_failure finding in response")
	}
	if highFinding.Severity != domain.SeverityHigh {
		t.Errorf("expected HIGH severity, got %v", highFinding.Severity)
	}
	if highFinding.Confidence != 0.95 {
		t.Errorf("expected 0.95 confidence, got %v", highFinding.Confidence)
	}
	if len(highFinding.Evidence) != 1 || highFinding.Evidence[0].Kind != "network_request" {
		t.Errorf("evidence mismatch on high finding: %+v", highFinding.Evidence)
	}
	if highFinding.Remediation == nil {
		t.Fatalf("expected non-nil remediation on high finding")
	}
	if highFinding.Remediation.Title != "Add Error Boundary and Network Retry" {
		t.Errorf("remediation title mismatch: got %q", highFinding.Remediation.Title)
	}
	if len(highFinding.Remediation.HowToFix) != 2 {
		t.Errorf("expected 2 howToFix items, got %d", len(highFinding.Remediation.HowToFix))
	}
	if highFinding.Remediation.FixPrompt == "" {
		t.Errorf("expected non-empty fixPrompt")
	}

	if medFinding == nil {
		t.Fatalf("missing input_stress finding in response")
	}
	if medFinding.Severity != domain.SeverityMedium {
		t.Errorf("expected MEDIUM severity, got %v", medFinding.Severity)
	}
	if len(medFinding.Evidence) != 1 || medFinding.Evidence[0].Kind != "error_log" {
		t.Errorf("evidence mismatch on med finding: %+v", medFinding.Evidence)
	}
	if medFinding.Remediation == nil {
		t.Fatalf("expected non-nil remediation on med finding")
	}
	if medFinding.Remediation.Title != "Safe Input Sanitization" {
		t.Errorf("remediation title mismatch: got %q", medFinding.Remediation.Title)
	}
}
