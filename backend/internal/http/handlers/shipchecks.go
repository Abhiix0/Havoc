package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ingestShipCheckRequest struct {
	ClientShipCheckID string           `json:"clientShipCheckId"`
	TargetOrigin      string           `json:"targetOrigin"`
	Readiness         domain.Readiness `json:"readiness"`
	CreatedAt         time.Time        `json:"createdAt"`
	CompletedAt       time.Time        `json:"completedAt"`
	Steps             []domain.Step    `json:"steps"`
	Findings          []domain.Finding `json:"findings"`
}

type listShipChecksResponse struct {
	ShipChecks []domain.ShipCheck `json:"shipChecks"`
	NextCursor string             `json:"nextCursor,omitempty"`
}

func IngestShipCheck(shipCheckSvc service.ShipCheckService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		projectIDStr := chi.URLParam(r, "id")
		projectID, err := uuid.Parse(projectIDStr)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid project ID format"})
			return
		}

		var req ingestShipCheckRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON payload"})
			return
		}

		sc := domain.ShipCheck{
			ProjectID:         projectID,
			ClientShipCheckID: req.ClientShipCheckID,
			TargetOrigin:      req.TargetOrigin,
			Readiness:         req.Readiness,
			CreatedAt:         req.CreatedAt,
			CompletedAt:       req.CompletedAt,
			Steps:             req.Steps,
		}

		created, err := shipCheckSvc.Ingest(r.Context(), sc, req.Findings)
		if err != nil {
			var valErr *domain.ValidationError
			if errors.As(err, &valErr) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(valErr)
				return
			}
			if errors.Is(err, service.ErrNotFound) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "project not found"})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "failed to ingest ship check"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(created)
	}
}

func ListShipChecksByProject(shipCheckSvc service.ShipCheckService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		projectIDStr := chi.URLParam(r, "id")
		projectID, err := uuid.Parse(projectIDStr)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid project ID format"})
			return
		}

		limitStr := r.URL.Query().Get("limit")
		cursor := r.URL.Query().Get("cursor")

		limit := 20
		if limitStr != "" {
			if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
				limit = parsed
			}
		}

		shipChecks, nextCursor, err := shipCheckSvc.ListByProject(r.Context(), projectID, limit, cursor)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "failed to list ship checks"})
			return
		}

		resp := listShipChecksResponse{
			ShipChecks: shipChecks,
			NextCursor: nextCursor,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func GetShipCheck(shipCheckSvc service.ShipCheckService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid ship check ID format"})
			return
		}

		sc, err := shipCheckSvc.GetByID(r.Context(), id)
		if err != nil {
			if errors.Is(err, service.ErrNotFound) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "ship check not found"})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "failed to get ship check"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(sc)
	}
}
