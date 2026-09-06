package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/repository"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ShipCheckRepository struct {
	pool *pgxpool.Pool
}

func NewShipCheckRepository(pool *pgxpool.Pool) *ShipCheckRepository {
	return &ShipCheckRepository{pool: pool}
}

var _ repository.ShipCheckRepository = (*ShipCheckRepository)(nil)

func (r *ShipCheckRepository) Upsert(ctx context.Context, sc domain.ShipCheck, findings []domain.Finding) (domain.ShipCheck, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.ShipCheck{}, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check if project exists
	var projectExists bool
	err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)", sc.ProjectID).Scan(&projectExists)
	if err != nil {
		return domain.ShipCheck{}, fmt.Errorf("failed to check project existence: %w", err)
	}
	if !projectExists {
		return domain.ShipCheck{}, repository.ErrNotFound
	}

	var completedAt *time.Time
	if !sc.CompletedAt.IsZero() {
		completedAt = &sc.CompletedAt
	}

	upsertQuery := `
		INSERT INTO ship_checks (project_id, client_ship_check_id, target_origin, readiness, created_at, completed_at, synced_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (project_id, client_ship_check_id)
		DO UPDATE SET
			readiness = EXCLUDED.readiness,
			completed_at = EXCLUDED.completed_at,
			synced_at = now()
		RETURNING id, synced_at
	`
	err = tx.QueryRow(ctx, upsertQuery, sc.ProjectID, sc.ClientShipCheckID, sc.TargetOrigin, sc.Readiness, sc.CreatedAt, completedAt).Scan(&sc.ID, &sc.SyncedAt)
	if err != nil {
		return domain.ShipCheck{}, fmt.Errorf("failed to upsert ship_check: %w", err)
	}

	// Replace steps
	_, err = tx.Exec(ctx, "DELETE FROM ship_check_steps WHERE ship_check_id = $1", sc.ID)
	if err != nil {
		return domain.ShipCheck{}, fmt.Errorf("failed to delete existing steps: %w", err)
	}

	for _, step := range sc.Steps {
		_, err = tx.Exec(ctx, `
			INSERT INTO ship_check_steps (ship_check_id, kind, status, ordinal)
			VALUES ($1, $2, $3, $4)
		`, sc.ID, step.Kind, step.Status, step.Ordinal)
		if err != nil {
			return domain.ShipCheck{}, fmt.Errorf("failed to insert step: %w", err)
		}
	}

	// Replace findings (cascades to evidence and remediations)
	_, err = tx.Exec(ctx, "DELETE FROM findings WHERE ship_check_id = $1", sc.ID)
	if err != nil {
		return domain.ShipCheck{}, fmt.Errorf("failed to delete existing findings: %w", err)
	}

	for _, f := range findings {
		var findingID uuid.UUID
		err = tx.QueryRow(ctx, `
			INSERT INTO findings (ship_check_id, client_finding_id, check_kind, severity, confidence, description)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id
		`, sc.ID, f.ClientFindingID, f.CheckKind, f.Severity, f.Confidence, f.Description).Scan(&findingID)
		if err != nil {
			return domain.ShipCheck{}, fmt.Errorf("failed to insert finding: %w", err)
		}

		for _, ev := range f.Evidence {
			_, err = tx.Exec(ctx, `
				INSERT INTO evidence (finding_id, kind, ref_id, captured_at)
				VALUES ($1, $2, $3, $4)
			`, findingID, ev.Kind, ev.RefID, ev.CapturedAt)
			if err != nil {
				return domain.ShipCheck{}, fmt.Errorf("failed to insert evidence: %w", err)
			}
		}

		if f.Remediation != nil {
			howToFixJSON, err := json.Marshal(f.Remediation.HowToFix)
			if err != nil {
				return domain.ShipCheck{}, fmt.Errorf("failed to marshal howToFix: %w", err)
			}

			_, err = tx.Exec(ctx, `
				INSERT INTO remediations (finding_id, title, what_happened, why_it_matters, how_to_fix, fix_prompt)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, findingID, f.Remediation.Title, f.Remediation.WhatHappened, f.Remediation.WhyItMatters, howToFixJSON, f.Remediation.FixPrompt)
			if err != nil {
				return domain.ShipCheck{}, fmt.Errorf("failed to insert remediation: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.ShipCheck{}, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return sc, nil
}

func (r *ShipCheckRepository) GetByID(ctx context.Context, id uuid.UUID) (domain.ShipCheck, error) {
	var sc domain.ShipCheck
	var completedAt *time.Time

	query := `
		SELECT id, project_id, client_ship_check_id, target_origin, readiness, created_at, completed_at, synced_at
		FROM ship_checks
		WHERE id = $1
	`
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&sc.ID,
		&sc.ProjectID,
		&sc.ClientShipCheckID,
		&sc.TargetOrigin,
		&sc.Readiness,
		&sc.CreatedAt,
		&completedAt,
		&sc.SyncedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ShipCheck{}, repository.ErrNotFound
		}
		return domain.ShipCheck{}, fmt.Errorf("failed to query ship_check: %w", err)
	}

	if completedAt != nil {
		sc.CompletedAt = *completedAt
	}

	stepsQuery := `
		SELECT kind, status, ordinal
		FROM ship_check_steps
		WHERE ship_check_id = $1
		ORDER BY ordinal ASC
	`
	rows, err := r.pool.Query(ctx, stepsQuery, sc.ID)
	if err != nil {
		return domain.ShipCheck{}, fmt.Errorf("failed to query steps: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var s domain.Step
		if err := rows.Scan(&s.Kind, &s.Status, &s.Ordinal); err != nil {
			return domain.ShipCheck{}, fmt.Errorf("failed to scan step: %w", err)
		}
		sc.Steps = append(sc.Steps, s)
	}

	if sc.Steps == nil {
		sc.Steps = []domain.Step{}
	}

	return sc, nil
}

func (r *ShipCheckRepository) ListByProject(ctx context.Context, projectID uuid.UUID, limit int, cursor string) ([]domain.ShipCheck, string, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	fetchLimit := limit + 1
	var rows pgx.Rows
	var err error

	if cursor == "" {
		query := `
			SELECT id, project_id, client_ship_check_id, target_origin, readiness, created_at, completed_at, synced_at
			FROM ship_checks
			WHERE project_id = $1
			ORDER BY created_at DESC, id DESC
			LIMIT $2
		`
		rows, err = r.pool.Query(ctx, query, projectID, fetchLimit)
	} else {
		cursorCreatedAt, cursorID, decodeErr := decodeProjectCursor(cursor)
		if decodeErr != nil {
			query := `
				SELECT id, project_id, client_ship_check_id, target_origin, readiness, created_at, completed_at, synced_at
				FROM ship_checks
				WHERE project_id = $1
				ORDER BY created_at DESC, id DESC
				LIMIT $2
			`
			rows, err = r.pool.Query(ctx, query, projectID, fetchLimit)
		} else {
			query := `
				SELECT id, project_id, client_ship_check_id, target_origin, readiness, created_at, completed_at, synced_at
				FROM ship_checks
				WHERE project_id = $1 AND (created_at, id) < ($2, $3)
				ORDER BY created_at DESC, id DESC
				LIMIT $4
			`
			rows, err = r.pool.Query(ctx, query, projectID, cursorCreatedAt, cursorID, fetchLimit)
		}
	}

	if err != nil {
		return nil, "", fmt.Errorf("failed to query ship_checks: %w", err)
	}
	defer rows.Close()

	var shipChecks []domain.ShipCheck
	for rows.Next() {
		var sc domain.ShipCheck
		var completedAt *time.Time
		if err := rows.Scan(&sc.ID, &sc.ProjectID, &sc.ClientShipCheckID, &sc.TargetOrigin, &sc.Readiness, &sc.CreatedAt, &completedAt, &sc.SyncedAt); err != nil {
			return nil, "", fmt.Errorf("failed to scan ship_check: %w", err)
		}
		if completedAt != nil {
			sc.CompletedAt = *completedAt
		}
		sc.Steps = []domain.Step{}
		shipChecks = append(shipChecks, sc)
	}

	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("error iterating ship_check rows: %w", err)
	}

	var nextCursor string
	if len(shipChecks) > limit {
		last := shipChecks[limit-1]
		nextCursor = encodeProjectCursor(last.CreatedAt, last.ID)
		shipChecks = shipChecks[:limit]
	}

	if shipChecks == nil {
		shipChecks = []domain.ShipCheck{}
	}

	return shipChecks, nextCursor, nil
}

func (r *ShipCheckRepository) GetFindings(ctx context.Context, shipCheckID uuid.UUID) ([]domain.Finding, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM ship_checks WHERE id = $1)", shipCheckID).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("failed to check ship_check existence: %w", err)
	}
	if !exists {
		return nil, repository.ErrNotFound
	}

	findingsQuery := `
		SELECT id, ship_check_id, client_finding_id, check_kind, severity, confidence, description
		FROM findings
		WHERE ship_check_id = $1
		ORDER BY id ASC
	`
	rows, err := r.pool.Query(ctx, findingsQuery, shipCheckID)
	if err != nil {
		return nil, fmt.Errorf("failed to query findings: %w", err)
	}
	defer rows.Close()

	var findings []domain.Finding
	for rows.Next() {
		var f domain.Finding
		var checkKind *string
		if err := rows.Scan(&f.ID, &f.ShipCheckID, &f.ClientFindingID, &checkKind, &f.Severity, &f.Confidence, &f.Description); err != nil {
			return nil, fmt.Errorf("failed to scan finding: %w", err)
		}
		if checkKind != nil {
			f.CheckKind = *checkKind
		}
		f.Evidence = []domain.Evidence{}
		findings = append(findings, f)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating findings rows: %w", err)
	}

	// For each finding, fetch evidence and remediation
	for i := range findings {
		evQuery := `
			SELECT kind, ref_id, captured_at
			FROM evidence
			WHERE finding_id = $1
			ORDER BY captured_at ASC
		`
		evRows, err := r.pool.Query(ctx, evQuery, findings[i].ID)
		if err != nil {
			return nil, fmt.Errorf("failed to query evidence: %w", err)
		}

		for evRows.Next() {
			var ev domain.Evidence
			if err := evRows.Scan(&ev.Kind, &ev.RefID, &ev.CapturedAt); err != nil {
				evRows.Close()
				return nil, fmt.Errorf("failed to scan evidence: %w", err)
			}
			findings[i].Evidence = append(findings[i].Evidence, ev)
		}
		evRows.Close()

		remQuery := `
			SELECT title, what_happened, why_it_matters, how_to_fix, fix_prompt
			FROM remediations
			WHERE finding_id = $1
		`
		var rem domain.Remediation
		var howToFixBytes []byte
		remErr := r.pool.QueryRow(ctx, remQuery, findings[i].ID).Scan(&rem.Title, &rem.WhatHappened, &rem.WhyItMatters, &howToFixBytes, &rem.FixPrompt)
		if remErr == nil {
			if len(howToFixBytes) > 0 {
				_ = json.Unmarshal(howToFixBytes, &rem.HowToFix)
			}
			findings[i].Remediation = &rem
		} else if !errors.Is(remErr, pgx.ErrNoRows) {
			return nil, fmt.Errorf("failed to query remediation: %w", remErr)
		}
	}

	if findings == nil {
		findings = []domain.Finding{}
	}

	return findings, nil
}
