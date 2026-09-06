package postgres

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/repository"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProjectRepository struct {
	pool *pgxpool.Pool
}

func NewProjectRepository(pool *pgxpool.Pool) *ProjectRepository {
	return &ProjectRepository{pool: pool}
}

var _ repository.ProjectRepository = (*ProjectRepository)(nil)

func (r *ProjectRepository) Create(ctx context.Context, p domain.Project) (domain.Project, error) {
	var result domain.Project
	query := `
		INSERT INTO projects (name)
		VALUES ($1)
		RETURNING id, name, created_at
	`
	err := r.pool.QueryRow(ctx, query, p.Name).Scan(&result.ID, &result.Name, &result.CreatedAt)
	if err != nil {
		return domain.Project{}, fmt.Errorf("failed to insert project: %w", err)
	}
	return result, nil
}

func (r *ProjectRepository) GetByID(ctx context.Context, id uuid.UUID) (domain.Project, error) {
	var p domain.Project
	query := `
		SELECT id, name, created_at
		FROM projects
		WHERE id = $1
	`
	err := r.pool.QueryRow(ctx, query, id).Scan(&p.ID, &p.Name, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Project{}, repository.ErrNotFound
		}
		return domain.Project{}, fmt.Errorf("failed to query project by ID: %w", err)
	}
	return p, nil
}

func (r *ProjectRepository) List(ctx context.Context, limit int, cursor string) ([]domain.Project, string, error) {
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
			SELECT id, name, created_at
			FROM projects
			ORDER BY created_at DESC, id DESC
			LIMIT $1
		`
		rows, err = r.pool.Query(ctx, query, fetchLimit)
	} else {
		cursorCreatedAt, cursorID, decodeErr := decodeProjectCursor(cursor)
		if decodeErr != nil {
			// fallback to first page if invalid cursor
			query := `
				SELECT id, name, created_at
				FROM projects
				ORDER BY created_at DESC, id DESC
				LIMIT $1
			`
			rows, err = r.pool.Query(ctx, query, fetchLimit)
		} else {
			query := `
				SELECT id, name, created_at
				FROM projects
				WHERE (created_at, id) < ($1, $2)
				ORDER BY created_at DESC, id DESC
				LIMIT $3
			`
			rows, err = r.pool.Query(ctx, query, cursorCreatedAt, cursorID, fetchLimit)
		}
	}

	if err != nil {
		return nil, "", fmt.Errorf("failed to query projects: %w", err)
	}
	defer rows.Close()

	var projects []domain.Project
	for rows.Next() {
		var p domain.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt); err != nil {
			return nil, "", fmt.Errorf("failed to scan project row: %w", err)
		}
		projects = append(projects, p)
	}

	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("error iterating project rows: %w", err)
	}

	var nextCursor string
	if len(projects) > limit {
		last := projects[limit-1]
		nextCursor = encodeProjectCursor(last.CreatedAt, last.ID)
		projects = projects[:limit]
	}

	if projects == nil {
		projects = []domain.Project{}
	}

	return projects, nextCursor, nil
}

func encodeProjectCursor(createdAt time.Time, id uuid.UUID) string {
	raw := fmt.Sprintf("%s,%s", createdAt.Format(time.RFC3339Nano), id.String())
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func decodeProjectCursor(cursor string) (time.Time, uuid.UUID, error) {
	bytes, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	parts := strings.Split(string(bytes), ",")
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, errors.New("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return t, id, nil
}
