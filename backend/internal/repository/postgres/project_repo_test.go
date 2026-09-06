package postgres_test

import (
	"context"
	"os"
	"testing"

	"github.com/Abhiix0/Havoc/backend/internal/domain"
	"github.com/Abhiix0/Havoc/backend/internal/repository"
	"github.com/Abhiix0/Havoc/backend/internal/repository/postgres"
	"github.com/google/uuid"
)

func getTestDatabaseURL(t *testing.T) string {
	t.Helper()
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("skipping postgres integration test: TEST_DATABASE_URL not set")
	}
	return dbURL
}

func TestPostgresProjectRepository(t *testing.T) {
	dbURL := getTestDatabaseURL(t)
	ctx := context.Background()

	err := postgres.RunMigrations(dbURL)
	if err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	pool, err := postgres.NewPool(ctx, dbURL)
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
	defer pool.Close()

	repo := postgres.NewProjectRepository(pool)

	t.Run("create and get project", func(t *testing.T) {
		p, err := repo.Create(ctx, domain.Project{Name: "Integration Test Project"})
		if err != nil {
			t.Fatalf("failed to create project: %v", err)
		}
		if p.ID == uuid.Nil {
			t.Errorf("expected non-nil ID")
		}
		if p.Name != "Integration Test Project" {
			t.Errorf("expected name 'Integration Test Project', got %q", p.Name)
		}

		fetched, err := repo.GetByID(ctx, p.ID)
		if err != nil {
			t.Fatalf("failed to get project: %v", err)
		}
		if fetched.ID != p.ID || fetched.Name != p.Name {
			t.Errorf("fetched mismatch: got %+v, want %+v", fetched, p)
		}
	})

	t.Run("get unknown project returns ErrNotFound", func(t *testing.T) {
		_, err := repo.GetByID(ctx, uuid.New())
		if err != repository.ErrNotFound {
			t.Fatalf("expected repository.ErrNotFound, got: %v", err)
		}
	})

	t.Run("list projects with keyset pagination", func(t *testing.T) {
		// Insert 3 projects
		for i := 1; i <= 3; i++ {
			_, err := repo.Create(ctx, domain.Project{Name: "Pagination Project"})
			if err != nil {
				t.Fatalf("failed to create pagination project: %v", err)
			}
		}

		firstPage, nextCursor, err := repo.List(ctx, 2, "")
		if err != nil {
			t.Fatalf("failed to list first page: %v", err)
		}
		if len(firstPage) != 2 {
			t.Fatalf("expected 2 projects on first page, got %d", len(firstPage))
		}
		if nextCursor == "" {
			t.Fatalf("expected non-empty nextCursor")
		}

		secondPage, _, err := repo.List(ctx, 2, nextCursor)
		if err != nil {
			t.Fatalf("failed to list second page: %v", err)
		}
		if len(secondPage) == 0 {
			t.Fatalf("expected at least 1 project on second page")
		}
	})
}
