package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/repository/postgres"
	"github.com/google/uuid"
)

func TestPostgresMigrationsUpDownUp(t *testing.T) {
	dbURL := getTestDatabaseURL(t)

	// Up
	if err := postgres.RunMigrations(dbURL); err != nil {
		t.Fatalf("first migration up failed: %v", err)
	}

	// Down
	if err := postgres.RunMigrationsDown(dbURL); err != nil {
		t.Fatalf("migration down failed: %v", err)
	}

	// Up again
	if err := postgres.RunMigrations(dbURL); err != nil {
		t.Fatalf("second migration up failed: %v", err)
	}
}

func TestPostgresShipCheckRepository(t *testing.T) {
	dbURL := getTestDatabaseURL(t)
	ctx := context.Background()

	if err := postgres.RunMigrations(dbURL); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	pool, err := postgres.NewPool(ctx, dbURL)
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
	defer pool.Close()

	projectRepo := postgres.NewProjectRepository(pool)
	shipCheckRepo := postgres.NewShipCheckRepository(pool)

	project, err := projectRepo.Create(ctx, domain.Project{Name: "Postgres ShipCheck Test"})
	if err != nil {
		t.Fatalf("failed to create project: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Millisecond)

	t.Run("upsert ship check with findings and retrieve", func(t *testing.T) {
		sc := domain.ShipCheck{
			ProjectID:         project.ID,
			ClientShipCheckID: "client-sc-pg-001",
			TargetOrigin:      "https://example.com",
			Readiness:         domain.ReadinessReady,
			CreatedAt:         now.Add(-time.Minute),
			CompletedAt:       now,
			Steps: []domain.Step{
				{Kind: "fetch_latency", Status: domain.StepDone, Ordinal: 0},
				{Kind: "fetch_failure", Status: domain.StepDone, Ordinal: 1},
			},
		}

		findings := []domain.Finding{
			{
				ClientFindingID: "f-with-evidence-and-rem",
				CheckKind:       "fetch_latency",
				Severity:        domain.SeverityHigh,
				Confidence:      0.95,
				Description:     "Latency threshold exceeded",
				Evidence: []domain.Evidence{
					{Kind: "trace", RefID: "trace-101", CapturedAt: now},
				},
				Remediation: &domain.Remediation{
					Title:        "Cache Route",
					WhatHappened: "Slow API",
					WhyItMatters: "Degrades UX",
					HowToFix:     []string{"Use Redis", "Set cache-control headers"},
					FixPrompt:    "Add cache middleware",
				},
			},
			{
				ClientFindingID: "f-without-rem",
				CheckKind:       "fetch_failure",
				Severity:        domain.SeverityLow,
				Confidence:      0.4,
				Description:     "Minor glitch",
				Evidence:        []domain.Evidence{},
				Remediation:     nil,
			},
		}

		created, err := shipCheckRepo.Upsert(ctx, sc, findings)
		if err != nil {
			t.Fatalf("failed to upsert ship check: %v", err)
		}
		if created.ID == uuid.Nil {
			t.Errorf("expected non-nil ID")
		}

		// Verify GetByID
		fetched, err := shipCheckRepo.GetByID(ctx, created.ID)
		if err != nil {
			t.Fatalf("failed to get ship check by ID: %v", err)
		}
		if fetched.ClientShipCheckID != "client-sc-pg-001" {
			t.Errorf("expected clientShipCheckId 'client-sc-pg-001', got %q", fetched.ClientShipCheckID)
		}
		if len(fetched.Steps) != 2 {
			t.Errorf("expected 2 steps, got %d", len(fetched.Steps))
		}

		// Verify GetFindings
		fetchedFindings, err := shipCheckRepo.GetFindings(ctx, created.ID)
		if err != nil {
			t.Fatalf("failed to get findings: %v", err)
		}
		if len(fetchedFindings) != 2 {
			t.Fatalf("expected 2 findings, got %d", len(fetchedFindings))
		}

		var withRem *domain.Finding
		var withoutRem *domain.Finding
		for i := range fetchedFindings {
			if fetchedFindings[i].ClientFindingID == "f-with-evidence-and-rem" {
				withRem = &fetchedFindings[i]
			} else if fetchedFindings[i].ClientFindingID == "f-without-rem" {
				withoutRem = &fetchedFindings[i]
			}
		}

		if withRem == nil || withRem.Remediation == nil || len(withRem.Evidence) != 1 {
			t.Errorf("expected withRem finding with remediation and evidence, got: %+v", withRem)
		}
		if withRem != nil && withRem.Remediation != nil {
			if len(withRem.Remediation.HowToFix) != 2 {
				t.Errorf("expected 2 howToFix items, got %d", len(withRem.Remediation.HowToFix))
			}
		}
		if withoutRem == nil || withoutRem.Remediation != nil {
			t.Errorf("expected withoutRem finding with nil remediation, got: %+v", withoutRem)
		}
	})

	t.Run("re-ingest same clientShipCheckId replaces findings (idempotent upsert)", func(t *testing.T) {
		sc := domain.ShipCheck{
			ProjectID:         project.ID,
			ClientShipCheckID: "client-sc-pg-001", // same ID
			TargetOrigin:      "https://example.com",
			Readiness:         domain.ReadinessNeedsAttention,
			CreatedAt:         now.Add(-time.Minute),
			CompletedAt:       now,
			Steps: []domain.Step{
				{Kind: "fetch_latency", Status: domain.StepDone, Ordinal: 0},
			},
		}

		newFindings := []domain.Finding{
			{
				ClientFindingID: "f-new-only",
				CheckKind:       "fetch_latency",
				Severity:        domain.SeverityMedium,
				Confidence:      0.8,
				Description:     "Brand new finding",
				Evidence: []domain.Evidence{
					{Kind: "trace", RefID: "trace-999", CapturedAt: now},
				},
				Remediation: nil,
			},
		}

		updated, err := shipCheckRepo.Upsert(ctx, sc, newFindings)
		if err != nil {
			t.Fatalf("failed to re-upsert ship check: %v", err)
		}

		// Verify GetFindings has ONLY the 1 new finding, and old ones are gone
		fetchedFindings, err := shipCheckRepo.GetFindings(ctx, updated.ID)
		if err != nil {
			t.Fatalf("failed to get findings after re-ingest: %v", err)
		}
		if len(fetchedFindings) != 1 {
			t.Fatalf("expected exactly 1 finding after replacement, got %d", len(fetchedFindings))
		}
		if fetchedFindings[0].ClientFindingID != "f-new-only" {
			t.Errorf("expected finding ID 'f-new-only', got %q", fetchedFindings[0].ClientFindingID)
		}
	})
}
