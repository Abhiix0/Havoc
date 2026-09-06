package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Abhiix0/Havoc/backend/internal/config"
	internalHttp "github.com/Abhiix0/Havoc/backend/internal/http"
	"github.com/Abhiix0/Havoc/backend/internal/repository/postgres"
	"github.com/Abhiix0/Havoc/backend/internal/service"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	if cfg.DatabaseURL == "" {
		log.Fatalf("DATABASE_URL environment variable is required")
	}

	// Run database migrations on startup
	if err := postgres.RunMigrations(cfg.DatabaseURL); err != nil {
		log.Fatalf("failed to run database migrations: %v", err)
	}

	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to initialize database connection pool: %v", err)
	}
	defer pool.Close()

	projectRepo := postgres.NewProjectRepository(pool)
	shipCheckRepo := postgres.NewShipCheckRepository(pool)

	projectSvc := service.NewProjectService(projectRepo)
	shipCheckSvc := service.NewShipCheckService(shipCheckRepo)

	router := internalHttp.NewRouter(cfg, projectSvc, shipCheckSvc)

	server := &http.Server{
		Addr:         cfg.Port,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("[HAVOC] server listening on %s (env: %s)", cfg.Port, cfg.Env)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-stop
	log.Println("[HAVOC] shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}

	log.Println("[HAVOC] server exited cleanly")
}
