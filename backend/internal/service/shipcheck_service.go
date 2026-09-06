package service

import (
	"context"
	"errors"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/repository"
	"github.com/google/uuid"
)

type ShipCheckService interface {
	Ingest(ctx context.Context, sc domain.ShipCheck, findings []domain.Finding) (domain.ShipCheck, error)
	ListByProject(ctx context.Context, projectID uuid.UUID, limit int, cursor string) ([]domain.ShipCheck, string, error)
	GetByID(ctx context.Context, id uuid.UUID) (domain.ShipCheck, error)
	GetFindings(ctx context.Context, shipCheckID uuid.UUID) ([]domain.Finding, error)
}

type shipCheckService struct {
	repo repository.ShipCheckRepository
}

func NewShipCheckService(repo repository.ShipCheckRepository) ShipCheckService {
	return &shipCheckService{repo: repo}
}

func (s *shipCheckService) Ingest(ctx context.Context, sc domain.ShipCheck, findings []domain.Finding) (domain.ShipCheck, error) {
	if err := domain.ValidateShipCheckIngest(sc, findings); err != nil {
		return domain.ShipCheck{}, err
	}

	result, err := s.repo.Upsert(ctx, sc, findings)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return domain.ShipCheck{}, ErrNotFound
		}
		return domain.ShipCheck{}, err
	}

	return result, nil
}

func (s *shipCheckService) ListByProject(ctx context.Context, projectID uuid.UUID, limit int, cursor string) ([]domain.ShipCheck, string, error) {
	return s.repo.ListByProject(ctx, projectID, limit, cursor)
}

func (s *shipCheckService) GetByID(ctx context.Context, id uuid.UUID) (domain.ShipCheck, error) {
	sc, err := s.repo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return domain.ShipCheck{}, ErrNotFound
		}
		return domain.ShipCheck{}, err
	}
	return sc, nil
}

func (s *shipCheckService) GetFindings(ctx context.Context, shipCheckID uuid.UUID) ([]domain.Finding, error) {
	findings, err := s.repo.GetFindings(ctx, shipCheckID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return findings, nil
}
