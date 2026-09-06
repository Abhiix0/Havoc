package repository

import (
	"context"
	"errors"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/google/uuid"
)

var ErrNotFound = errors.New("not found")

type ProjectRepository interface {
	Create(ctx context.Context, p domain.Project) (domain.Project, error)
	List(ctx context.Context, limit int, cursor string) ([]domain.Project, string, error)
	GetByID(ctx context.Context, id uuid.UUID) (domain.Project, error)
}

type ShipCheckRepository interface {
	Upsert(ctx context.Context, sc domain.ShipCheck, findings []domain.Finding) (domain.ShipCheck, error)
	ListByProject(ctx context.Context, projectID uuid.UUID, limit int, cursor string) ([]domain.ShipCheck, string, error)
	GetByID(ctx context.Context, id uuid.UUID) (domain.ShipCheck, error)
	GetFindings(ctx context.Context, shipCheckID uuid.UUID) ([]domain.Finding, error)
}
