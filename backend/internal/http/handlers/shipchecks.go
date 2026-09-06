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

type flexibleTime time.Time

func (t *flexibleTime) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" || s == `""` {
		return nil
	}
	// Try parsing numeric timestamp (milliseconds or seconds)
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		if n > 1e11 {
			*t = flexibleTime(time.UnixMilli(n).UTC())
		} else {
			*t = flexibleTime(time.Unix(n, 0).UTC())
		}
		return nil
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		sec := int64(f)
		if sec > 1e11 {
			*t = flexibleTime(time.UnixMilli(sec).UTC())
		} else {
			nsec := int64((f - float64(sec)) * 1e9)
			*t = flexibleTime(time.Unix(sec, nsec).UTC())
		}
		return nil
	}

	var str string
	if err := json.Unmarshal(b, &str); err != nil {
		return err
	}
	parsed, err := time.Parse(time.RFC3339Nano, str)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, str)
		if err != nil {
			return err
		}
	}
	*t = flexibleTime(parsed.UTC())
	return nil
}

func (t flexibleTime) Time() time.Time {
	return time.Time(t)
}

type ingestEvidenceRequest struct {
	Kind       string       `json:"kind"`
	RefID      string       `json:"refId"`
	CapturedAt flexibleTime `json:"capturedAt"`
}

type ingestFindingRequest struct {
	ClientFindingID string                  `json:"clientFindingId"`
	CheckKind       string                  `json:"checkKind,omitempty"`
	Severity        domain.Severity         `json:"severity"`
	Confidence      float64                 `json:"confidence"`
	Description     string                  `json:"description"`
	Evidence        []ingestEvidenceRequest `json:"evidence"`
	Remediation     *domain.Remediation     `json:"remediation,omitempty"`
}

type ingestShipCheckRequest struct {
	ClientShipCheckID string                 `json:"clientShipCheckId"`
	TargetOrigin      string                 `json:"targetOrigin"`
	Readiness         domain.Readiness       `json:"readiness"`
	CreatedAt         flexibleTime           `json:"createdAt"`
	CompletedAt       flexibleTime           `json:"completedAt"`
	Steps             []domain.Step          `json:"steps"`
	Findings          []ingestFindingRequest `json:"findings"`
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
			CreatedAt:         req.CreatedAt.Time(),
			CompletedAt:       req.CompletedAt.Time(),
			Steps:             req.Steps,
		}

		findings := make([]domain.Finding, len(req.Findings))
		for i, f := range req.Findings {
			evidenceList := make([]domain.Evidence, len(f.Evidence))
			for j, ev := range f.Evidence {
				evidenceList[j] = domain.Evidence{
					Kind:       ev.Kind,
					RefID:      ev.RefID,
					CapturedAt: ev.CapturedAt.Time(),
				}
			}
			findings[i] = domain.Finding{
				ClientFindingID: f.ClientFindingID,
				CheckKind:       f.CheckKind,
				Severity:        f.Severity,
				Confidence:      f.Confidence,
				Description:     f.Description,
				Evidence:        evidenceList,
				Remediation:     f.Remediation,
			}
		}

		created, err := shipCheckSvc.Ingest(r.Context(), sc, findings)
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
