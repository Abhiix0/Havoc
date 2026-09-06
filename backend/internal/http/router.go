package http

import (
	"net/http"

	"github.com/Abhiix0/Havoc/backend/internal/config"
	"github.com/Abhiix0/Havoc/backend/internal/http/handlers"
	"github.com/Abhiix0/Havoc/backend/internal/http/middleware"
	"github.com/Abhiix0/Havoc/backend/internal/service"
	"github.com/go-chi/chi/v5"
)

func NewRouter(cfg config.Config, projectSvc service.ProjectService, shipCheckSvc service.ShipCheckService) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logging)
	r.Use(middleware.Recover)

	r.Get("/healthz", handlers.Health)

	r.Route("/api/v1", func(r chi.Router) {
		r.Route("/projects", func(r chi.Router) {
			r.Post("/", handlers.CreateProject(projectSvc))
			r.Get("/", handlers.ListProjects(projectSvc))
			r.Get("/{id}", handlers.GetProject(projectSvc))
			r.Post("/{id}/ship-checks", handlers.IngestShipCheck(shipCheckSvc))
			r.Get("/{id}/ship-checks", handlers.ListShipChecksByProject(shipCheckSvc))
		})

		r.Route("/ship-checks", func(r chi.Router) {
			r.Get("/{id}", handlers.GetShipCheck(shipCheckSvc))
			r.Get("/{id}/findings", handlers.GetFindings(shipCheckSvc))
		})
	})

	return r
}
