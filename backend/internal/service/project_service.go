package service

import (
	"context"
	"errors"
	"strings"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/repository"
	"github.com/google/uuid"
)

type ProjectService interface {
	Create(ctx context.Context, name string) (domain.Project, error)
	List(ctx context.Context, limit int, cursor string) ([]domain.Project, string, error)
	GetByID(ctx context.Context, id uuid.UUID) (domain.Project, error)
}

type projectService struct {
	repo repository.ProjectRepository
}

func NewProjectService(repo repository.ProjectRepository) ProjectService {
	return &projectService{repo: repo}
}

func (s *projectService) Create(ctx context.Context, name string) (domain.Project, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		v := &domain.ValidationError{}
		v.Add("name", "project name cannot be empty")
		return domain.Project{}, v
	}
	if len(trimmed) > 255 {
		v := &domain.ValidationError{}
		v.Add("name", "project name cannot exceed 255 characters")
		return domain.Project{}, v
	}

	p := domain.Project{
		Name: trimmed,
	}
	return s.repo.Create(ctx, p)
}

func (s *projectService) List(ctx context.Context, limit int, cursor string) ([]domain.Project, string, error) {
	return s.repo.List(ctx, limit, cursor)
}

func (s *projectService) GetByID(ctx context.Context, id uuid.UUID) (domain.Project, error) {
	p, err := s.repo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return domain.Project{}, ErrNotFound
		}
		return domain.Project{}, err
	}
	return p, nil
}
