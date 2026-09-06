package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type listFindingsResponse struct {
	Findings []domain.Finding `json:"findings"`
}

func GetFindings(shipCheckSvc service.ShipCheckService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid ship check ID format"})
			return
		}

		findings, err := shipCheckSvc.GetFindings(r.Context(), id)
		if err != nil {
			if errors.Is(err, service.ErrNotFound) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "ship check not found"})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "failed to get findings"})
			return
		}

		resp := listFindingsResponse{
			Findings: findings,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	}
}
