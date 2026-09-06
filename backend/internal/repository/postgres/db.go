package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/Abhiix0/Havoc/backend/migrations"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool creates a new pgxpool.Pool and pings the database to fail fast if unreachable.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return pool, nil
}

// RunMigrations applies all up migrations to the database.
func RunMigrations(databaseURL string) error {
	driver, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("failed to load embedded migrations: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", driver, databaseURL)
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migration up failed: %w", err)
	}

	return nil
}

// RunMigrationsDown reverts all migrations from the database.
func RunMigrationsDown(databaseURL string) error {
	driver, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("failed to load embedded migrations: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", driver, databaseURL)
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}
	defer m.Close()

	if err := m.Down(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migration down failed: %w", err)
	}

	return nil
}
