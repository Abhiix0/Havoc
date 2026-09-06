package domain

import (
	"time"

	"github.com/google/uuid"
)

type Readiness string

const (
	ReadinessReady          Readiness = "READY"
	ReadinessNeedsAttention Readiness = "NEEDS_ATTENTION"
	ReadinessBlocked        Readiness = "BLOCKED"
	ReadinessUnknown        Readiness = "UNKNOWN"
)

func (r Readiness) Valid() bool {
	switch r {
	case ReadinessReady, ReadinessNeedsAttention, ReadinessBlocked, ReadinessUnknown:
		return true
	default:
		return false
	}
}

type StepStatus string

const (
	StepDone    StepStatus = "DONE"
	StepErrored StepStatus = "ERRORED"
	StepSkipped StepStatus = "SKIPPED"
)

func (s StepStatus) Valid() bool {
	switch s {
	case StepDone, StepErrored, StepSkipped:
		return true
	default:
		return false
	}
}

type Step struct {
	Kind    string     `json:"kind"`
	Status  StepStatus `json:"status"`
	Ordinal int        `json:"ordinal"`
}

type ShipCheck struct {
	ID                uuid.UUID  `json:"id"`
	ProjectID         uuid.UUID  `json:"projectId"`
	ClientShipCheckID string     `json:"clientShipCheckId"`
	TargetOrigin      string     `json:"targetOrigin"`
	Readiness         Readiness  `json:"readiness"`
	CreatedAt         time.Time  `json:"createdAt"`
	CompletedAt       time.Time  `json:"completedAt"`
	SyncedAt          time.Time  `json:"syncedAt"`
	Steps             []Step     `json:"steps"`
}
