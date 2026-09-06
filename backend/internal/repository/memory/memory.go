// Package memory provides an in-memory implementation of the ProjectRepository
// and ShipCheckRepository interfaces using Go maps and sync.RWMutex.
//
// NOTE: This implementation remains permanently useful for fast, dependency-free
// unit and handler-level tests even after Phase 5 adds Postgres persistence.
// It must NOT be deleted in Phase 5.
package memory

import (
	"context"
	"encoding/base64"
	"fmt"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/repository"
	"github.com/google/uuid"
)

type Store struct {
	mu                    sync.RWMutex
	projects              map[uuid.UUID]domain.Project
	shipChecks            map[uuid.UUID]domain.ShipCheck
	shipChecksByClientKey map[string]uuid.UUID
	findingsByShipCheck   map[uuid.UUID][]domain.Finding
}

func NewStore() *Store {
	return &Store{
		projects:              make(map[uuid.UUID]domain.Project),
		shipChecks:            make(map[uuid.UUID]domain.ShipCheck),
		shipChecksByClientKey: make(map[string]uuid.UUID),
		findingsByShipCheck:   make(map[uuid.UUID][]domain.Finding),
	}
}

// NewRepositories returns initialized in-memory Project and ShipCheck repositories sharing the same store.
func NewRepositories() (repository.ProjectRepository, repository.ShipCheckRepository) {
	s := NewStore()
	return &projectRepository{store: s}, &shipCheckRepository{store: s}
}

type projectRepository struct {
	store *Store
}

type shipCheckRepository struct {
	store *Store
}

var (
	_ repository.ProjectRepository   = (*projectRepository)(nil)
	_ repository.ShipCheckRepository = (*shipCheckRepository)(nil)
)

func (s *Store) Projects() repository.ProjectRepository {
	return &projectRepository{store: s}
}

func (s *Store) ShipChecks() repository.ShipCheckRepository {
	return &shipCheckRepository{store: s}
}

// ---------------- ProjectRepository Implementation ----------------

func (r *projectRepository) Create(ctx context.Context, p domain.Project) (domain.Project, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()

	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	if p.CreatedAt.IsZero() {
		p.CreatedAt = time.Now().UTC()
	}

	r.store.projects[p.ID] = p
	return p, nil
}

func (r *projectRepository) GetByID(ctx context.Context, id uuid.UUID) (domain.Project, error) {
	r.store.mu.RLock()
	defer r.store.mu.RUnlock()

	p, ok := r.store.projects[id]
	if !ok {
		return domain.Project{}, repository.ErrNotFound
	}
	return p, nil
}

func (r *projectRepository) List(ctx context.Context, limit int, cursor string) ([]domain.Project, string, error) {
	r.store.mu.RLock()
	defer r.store.mu.RUnlock()

	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	offset := decodeCursor(cursor)

	all := make([]domain.Project, 0, len(r.store.projects))
	for _, p := range r.store.projects {
		all = append(all, p)
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].CreatedAt.After(all[j].CreatedAt)
	})

	if offset >= len(all) {
		return []domain.Project{}, "", nil
	}

	end := offset + limit
	var nextCursor string
	if end < len(all) {
		nextCursor = encodeCursor(end)
	} else {
		end = len(all)
	}

	result := make([]domain.Project, end-offset)
	copy(result, all[offset:end])

	return result, nextCursor, nil
}

// ---------------- ShipCheckRepository Implementation ----------------

func (r *shipCheckRepository) Upsert(ctx context.Context, sc domain.ShipCheck, findings []domain.Finding) (domain.ShipCheck, error) {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()

	// Verify project exists
	if _, ok := r.store.projects[sc.ProjectID]; !ok {
		return domain.ShipCheck{}, repository.ErrNotFound
	}

	clientKey := fmt.Sprintf("%s:%s", sc.ProjectID, sc.ClientShipCheckID)
	existingID, exists := r.store.shipChecksByClientKey[clientKey]
	if exists {
		sc.ID = existingID
	} else {
		if sc.ID == uuid.Nil {
			sc.ID = uuid.New()
		}
		r.store.shipChecksByClientKey[clientKey] = sc.ID
	}

	sc.SyncedAt = time.Now().UTC()
	r.store.shipChecks[sc.ID] = sc

	// Process findings
	storedFindings := make([]domain.Finding, len(findings))
	for i, f := range findings {
		if f.ID == uuid.Nil {
			f.ID = uuid.New()
		}
		f.ShipCheckID = sc.ID
		storedFindings[i] = f
	}
	r.store.findingsByShipCheck[sc.ID] = storedFindings

	return sc, nil
}

func (r *shipCheckRepository) ListByProject(ctx context.Context, projectID uuid.UUID, limit int, cursor string) ([]domain.ShipCheck, string, error) {
	r.store.mu.RLock()
	defer r.store.mu.RUnlock()

	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	offset := decodeCursor(cursor)

	var all []domain.ShipCheck
	for _, sc := range r.store.shipChecks {
		if sc.ProjectID == projectID {
			all = append(all, sc)
		}
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].CreatedAt.After(all[j].CreatedAt)
	})

	if offset >= len(all) {
		return []domain.ShipCheck{}, "", nil
	}

	end := offset + limit
	var nextCursor string
	if end < len(all) {
		nextCursor = encodeCursor(end)
	} else {
		end = len(all)
	}

	result := make([]domain.ShipCheck, end-offset)
	copy(result, all[offset:end])

	return result, nextCursor, nil
}

func (r *shipCheckRepository) GetByID(ctx context.Context, id uuid.UUID) (domain.ShipCheck, error) {
	r.store.mu.RLock()
	defer r.store.mu.RUnlock()

	sc, ok := r.store.shipChecks[id]
	if !ok {
		return domain.ShipCheck{}, repository.ErrNotFound
	}
	return sc, nil
}

func (r *shipCheckRepository) GetFindings(ctx context.Context, shipCheckID uuid.UUID) ([]domain.Finding, error) {
	r.store.mu.RLock()
	defer r.store.mu.RUnlock()

	if _, ok := r.store.shipChecks[shipCheckID]; !ok {
		return nil, repository.ErrNotFound
	}

	findings := r.store.findingsByShipCheck[shipCheckID]
	result := make([]domain.Finding, len(findings))
	copy(result, findings)
	return result, nil
}

func encodeCursor(offset int) string {
	return base64.URLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodeCursor(cursor string) int {
	if cursor == "" {
		return 0
	}
	bytes, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return 0
	}
	offset, err := strconv.Atoi(string(bytes))
	if err != nil || offset < 0 {
		return 0
	}
	return offset
}
