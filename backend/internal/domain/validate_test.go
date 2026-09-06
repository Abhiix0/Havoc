package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/google/uuid"
)

func validShipCheck() (domain.ShipCheck, []domain.Finding) {
	now := time.Now().UTC()
	sc := domain.ShipCheck{
		ID:                uuid.New(),
		ProjectID:         uuid.New(),
		ClientShipCheckID: "ship-check-123",
		TargetOrigin:      "https://example.com",
		Readiness:         domain.ReadinessReady,
		CreatedAt:         now.Add(-time.Minute),
		CompletedAt:       now,
		SyncedAt:          now,
		Steps: []domain.Step{
			{Kind: "fetch_latency", Status: domain.StepDone, Ordinal: 0},
			{Kind: "fetch_failure", Status: domain.StepSkipped, Ordinal: 1},
		},
	}

	findings := []domain.Finding{
		{
			ID:              uuid.New(),
			ShipCheckID:     sc.ID,
			ClientFindingID: "finding-1",
			CheckKind:       "fetch_latency",
			Severity:        domain.SeverityHigh,
			Confidence:      0.95,
			Description:     "Network latency exceeded 3000ms threshold",
			Evidence: []domain.Evidence{
				{Kind: "trace", RefID: "ref-1", CapturedAt: now},
			},
			Remediation: &domain.Remediation{
				Title:        "Improve Timeout Handling",
				WhatHappened: "Requests timed out under high latency.",
				WhyItMatters: "User experience degrades on slower connections.",
				HowToFix:     []string{"Add fallback UI", "Configure retry policy"},
				FixPrompt:    "Add request timeout with exponential backoff.",
			},
		},
	}

	return sc, findings
}

func TestValidateShipCheckIngest_Valid(t *testing.T) {
	sc, findings := validShipCheck()
	err := domain.ValidateShipCheckIngest(sc, findings)
	if err != nil {
		t.Fatalf("expected valid payload to pass, got: %v", err)
	}
}

func TestValidateShipCheckIngest_Rejections(t *testing.T) {
	tests := []struct {
		name          string
		mutate        func(sc *domain.ShipCheck, findings *[]domain.Finding)
		expectedField string
	}{
		{
			name: "empty clientShipCheckId",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				sc.ClientShipCheckID = ""
			},
			expectedField: "clientShipCheckId",
		},
		{
			name: "empty targetOrigin",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				sc.TargetOrigin = "   "
			},
			expectedField: "targetOrigin",
		},
		{
			name: "invalid readiness",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				sc.Readiness = domain.Readiness("NOT_A_READINESS")
			},
			expectedField: "readiness",
		},
		{
			name: "invalid step status (RUNNING)",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				sc.Steps = append(sc.Steps, domain.Step{
					Kind:    "input_stress",
					Status:  domain.StepStatus("RUNNING"),
					Ordinal: 2,
				})
			},
			expectedField: "steps[2].status",
		},
		{
			name: "invalid step status (PENDING)",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				sc.Steps = append(sc.Steps, domain.Step{
					Kind:    "input_stress",
					Status:  domain.StepStatus("PENDING"),
					Ordinal: 2,
				})
			},
			expectedField: "steps[2].status",
		},
		{
			name: "invalid finding severity",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Severity = domain.Severity("CRITICAL")
			},
			expectedField: "findings[0].severity",
		},
		{
			name: "negative confidence",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Confidence = -0.1
			},
			expectedField: "findings[0].confidence",
		},
		{
			name: "confidence greater than 1",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Confidence = 1.05
			},
			expectedField: "findings[0].confidence",
		},
		{
			name: "HIGH severity with zero evidence",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Severity = domain.SeverityHigh
				(*findings)[0].Evidence = nil
			},
			expectedField: "findings[0].evidence",
		},
		{
			name: "MEDIUM severity with zero evidence",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Severity = domain.SeverityMedium
				(*findings)[0].Evidence = []domain.Evidence{}
			},
			expectedField: "findings[0].evidence",
		},
		{
			name: "oversized string field",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Description = strings.Repeat("a", 10001)
			},
			expectedField: "findings[0].description",
		},
		{
			name: "fake AKIA secret pattern in description",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Description = "Leak in AKIAFAKEFAKEFAKE1234 header"
			},
			expectedField: "findings[0].description",
		},
		{
			name: "private key secret pattern in remediation fixPrompt",
			mutate: func(sc *domain.ShipCheck, findings *[]domain.Finding) {
				(*findings)[0].Remediation.FixPrompt = "-----BEGIN RSA PRIVATE KEY-----"
			},
			expectedField: "findings[0].remediation.fixPrompt",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sc, findings := validShipCheck()
			tc.mutate(&sc, &findings)

			err := domain.ValidateShipCheckIngest(sc, findings)
			if err == nil {
				t.Fatalf("expected validation error for test case %q, but got nil", tc.name)
			}

			valErr, ok := err.(*domain.ValidationError)
			if !ok {
				t.Fatalf("expected *domain.ValidationError, got %T (%v)", err, err)
			}

			found := false
			for _, violation := range valErr.Violations {
				if violation.Field == tc.expectedField {
					found = true
					break
				}
			}

			if !found {
				t.Errorf("expected violation for field %q, got violations: %+v", tc.expectedField, valErr.Violations)
			}
		})
	}
}
