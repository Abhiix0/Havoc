package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Abhiix0/Havoc/backend/internal/config"
	"github.com/Abhiix0/Havoc/backend/internal/domain"
	internalHttp "github.com/Abhiix0/Havoc/backend/internal/http"
	"github.com/Abhiix0/Havoc/backend/internal/repository/memory"
	"github.com/Abhiix0/Havoc/backend/internal/service"
	"github.com/google/uuid"
)

func setupTestRouter() (http.Handler, *memory.Store) {
	cfg := config.Config{Port: ":8080", Env: "test"}
	store := memory.NewStore()
	projectSvc := service.NewProjectService(store.Projects())
	shipCheckSvc := service.NewShipCheckService(store.ShipChecks())
	return internalHttp.NewRouter(cfg, projectSvc, shipCheckSvc), store
}

func TestProjectsAPI(t *testing.T) {
	router, _ := setupTestRouter()

	t.Run("create project - success (201)", func(t *testing.T) {
		body := []byte(`{"name":"Havoc Frontend"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d: %s", rec.Code, rec.Body.String())
		}

		var created domain.Project
		if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if created.ID == uuid.Nil {
			t.Errorf("expected non-nil UUID for project")
		}
		if created.Name != "Havoc Frontend" {
			t.Errorf("expected name 'Havoc Frontend', got %q", created.Name)
		}
	})

	t.Run("create project - empty name (400)", func(t *testing.T) {
		body := []byte(`{"name":"   "}`)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", rec.Code)
		}
	})

	t.Run("get project - success (200)", func(t *testing.T) {
		// First create
		createBody := []byte(`{"name":"Havoc Docs"}`)
		createReq := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(createBody))
		createRec := httptest.NewRecorder()
		router.ServeHTTP(createRec, createReq)

		var created domain.Project
		_ = json.NewDecoder(createRec.Body).Decode(&created)

		// Get by ID
		getReq := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+created.ID.String(), nil)
		getRec := httptest.NewRecorder()
		router.ServeHTTP(getRec, getReq)

		if getRec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", getRec.Code)
		}

		var fetched domain.Project
		_ = json.NewDecoder(getRec.Body).Decode(&fetched)
		if fetched.ID != created.ID || fetched.Name != "Havoc Docs" {
			t.Errorf("expected project %+v, got %+v", created, fetched)
		}
	})

	t.Run("get unknown project (404)", func(t *testing.T) {
		unknownID := uuid.New().String()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+unknownID, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected status 404, got %d", rec.Code)
		}
	})

	t.Run("get project invalid UUID (400)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/not-a-uuid", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", rec.Code)
		}
	})

	t.Run("list projects (200)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects?limit=10", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}

		var resp struct {
			Projects   []domain.Project `json:"projects"`
			NextCursor string           `json:"nextCursor"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode list response: %v", err)
		}

		if len(resp.Projects) < 2 {
			t.Errorf("expected at least 2 projects, got %d", len(resp.Projects))
		}
	})
}
