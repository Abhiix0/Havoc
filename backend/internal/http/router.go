package http

import (
	"net/http"

	"github.com/Abhiix0/Havoc/backend/internal/config"
	"github.com/Abhiix0/Havoc/backend/internal/http/handlers"
	"github.com/Abhiix0/Havoc/backend/internal/http/middleware"
	"github.com/go-chi/chi/v5"
)

func NewRouter(cfg config.Config) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logging)
	r.Use(middleware.Recover)
	r.Get("/healthz", handlers.Health)
	return r
}
