package handlers_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/google/uuid"
)

func createTestProject(t *testing.T, router http.Handler, name string) domain.Project {
	t.Helper()
	body := []byte(fmt.Sprintf(`{"name":%q}`, name))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("failed to create test project: %d - %s", rec.Code, rec.Body.String())
	}

	var p domain.Project
	_ = json.NewDecoder(rec.Body).Decode(&p)
	return p
}

func sampleIngestPayload(clientShipCheckID string) map[string]interface{} {
	now := time.Now().UTC().Format(time.RFC3339)
	return map[string]interface{}{
		"clientShipCheckId": clientShipCheckID,
		"targetOrigin":      "https://app.example.com",
		"readiness":         "READY",
		"createdAt":         now,
		"completedAt":       now,
		"steps": []map[string]interface{}{
			{"kind": "fetch_latency", "status": "DONE", "ordinal": 0},
			{"kind": "fetch_failure", "status": "DONE", "ordinal": 1},
		},
		"findings": []map[string]interface{}{
			{
				"clientFindingId": "finding-101",
				"checkKind":       "fetch_latency",
				"severity":        "HIGH",
				"confidence":      0.9,
				"description":     "Latency spike detected",
				"evidence": []map[string]interface{}{
					{"kind": "trace", "refId": "ref-101", "capturedAt": now},
				},
				"remediation": map[string]interface{}{
					"title":        "Optimize API Route",
					"whatHappened": "High response time",
					"whyItMatters": "Slow UX",
					"howToFix":     []string{"Cache responses"},
					"fixPrompt":    "Implement caching layer",
				},
			},
		},
	}
}

func TestShipChecksAPI(t *testing.T) {
	router, _ := setupTestRouter()
	project := createTestProject(t, router, "E-Commerce App")

	var createdShipCheckID string

	t.Run("ingest valid ship check (201)", func(t *testing.T) {
		payload := sampleIngestPayload("sc-client-001")
		bodyBytes, _ := json.Marshal(payload)

		url := fmt.Sprintf("/api/v1/projects/%s/ship-checks", project.ID.String())
		req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d: %s", rec.Code, rec.Body.String())
		}

		var sc domain.ShipCheck
		if err := json.NewDecoder(rec.Body).Decode(&sc); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if sc.ID == uuid.Nil {
			t.Errorf("expected non-nil shipCheck ID")
		}
		if sc.ClientShipCheckID != "sc-client-001" {
			t.Errorf("expected clientShipCheckId 'sc-client-001', got %q", sc.ClientShipCheckID)
		}

		createdShipCheckID = sc.ID.String()
	})

	t.Run("get ship check by ID (200)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/ship-checks/"+createdShipCheckID, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}

		var sc domain.ShipCheck
		_ = json.NewDecoder(rec.Body).Decode(&sc)
		if sc.ID.String() != createdShipCheckID {
			t.Errorf("expected ship check ID %s, got %s", createdShipCheckID, sc.ID.String())
		}
	})

	t.Run("ingest same clientShipCheckId again (idempotent upsert)", func(t *testing.T) {
		payload := sampleIngestPayload("sc-client-001")
		payload["readiness"] = "NEEDS_ATTENTION"
		bodyBytes, _ := json.Marshal(payload)

		url := fmt.Sprintf("/api/v1/projects/%s/ship-checks", project.ID.String())
		req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d: %s", rec.Code, rec.Body.String())
		}

		var sc domain.ShipCheck
		_ = json.NewDecoder(rec.Body).Decode(&sc)

		if sc.ID.String() != createdShipCheckID {
			t.Errorf("expected upserted ID to match existing ID %s, got %s", createdShipCheckID, sc.ID.String())
		}
		if sc.Readiness != domain.ReadinessNeedsAttention {
			t.Errorf("expected updated readiness NEEDS_ATTENTION, got %s", sc.Readiness)
		}

		// Verify project has exactly 1 ship check
		listReq := httptest.NewRequest(http.MethodGet, url, nil)
		listRec := httptest.NewRecorder()
		router.ServeHTTP(listRec, listReq)

		var listResp struct {
			ShipChecks []domain.ShipCheck `json:"shipChecks"`
		}
		_ = json.NewDecoder(listRec.Body).Decode(&listResp)

		if len(listResp.ShipChecks) != 1 {
			t.Errorf("expected exactly 1 ship check in project after upsert, got %d", len(listResp.ShipChecks))
		}
	})

	t.Run("ingest invalid payload (400)", func(t *testing.T) {
		payload := sampleIngestPayload("sc-invalid")
		payload["targetOrigin"] = "" // invalid: empty targetOrigin
		bodyBytes, _ := json.Marshal(payload)

		url := fmt.Sprintf("/api/v1/projects/%s/ship-checks", project.ID.String())
		req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", rec.Code)
		}

		var valErr domain.ValidationError
		if err := json.NewDecoder(rec.Body).Decode(&valErr); err != nil {
			t.Fatalf("failed to decode validation error: %v", err)
		}

		found := false
		for _, v := range valErr.Violations {
			if v.Field == "targetOrigin" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected field violation for 'targetOrigin', got %+v", valErr.Violations)
		}
	})

	t.Run("ingest for non-existent project (404)", func(t *testing.T) {
		payload := sampleIngestPayload("sc-client-404")
		bodyBytes, _ := json.Marshal(payload)

		url := fmt.Sprintf("/api/v1/projects/%s/ship-checks", uuid.New().String())
		req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected status 404, got %d", rec.Code)
		}
	})

	t.Run("get findings for ship check (200)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/ship-checks/"+createdShipCheckID+"/findings", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}

		var resp struct {
			Findings []domain.Finding `json:"findings"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode findings response: %v", err)
		}

		if len(resp.Findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(resp.Findings))
		}
		if resp.Findings[0].ClientFindingID != "finding-101" {
			t.Errorf("expected clientFindingId 'finding-101', got %q", resp.Findings[0].ClientFindingID)
		}
		if resp.Findings[0].Remediation == nil || resp.Findings[0].Remediation.Title != "Optimize API Route" {
			t.Errorf("expected remediation title 'Optimize API Route', got %+v", resp.Findings[0].Remediation)
		}
	})
}
