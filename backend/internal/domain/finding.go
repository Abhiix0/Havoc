package domain

import (
	"time"

	"github.com/google/uuid"
)

type Severity string

const (
	SeverityLow    Severity = "LOW"
	SeverityMedium Severity = "MEDIUM"
	SeverityHigh   Severity = "HIGH"
)

func (s Severity) Valid() bool {
	switch s {
	case SeverityLow, SeverityMedium, SeverityHigh:
		return true
	default:
		return false
	}
}

type Evidence struct {
	Kind       string    `json:"kind"`
	RefID      string    `json:"refId"`
	CapturedAt time.Time `json:"capturedAt"`
}

type Finding struct {
	ID              uuid.UUID    `json:"id"`
	ShipCheckID     uuid.UUID    `json:"shipCheckId"`
	ClientFindingID string       `json:"clientFindingId"`
	CheckKind       string       `json:"checkKind,omitempty"`
	Severity        Severity     `json:"severity"`
	Confidence      float64      `json:"confidence"`
	Description     string       `json:"description"`
	Evidence        []Evidence   `json:"evidence"`
	Remediation     *Remediation `json:"remediation,omitempty"`
}
