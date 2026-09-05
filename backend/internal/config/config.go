package config

import "os"

type Config struct {
	Port        string // default ":8080", from PORT env var
	DatabaseURL string // from DATABASE_URL env var — loaded but unused and unvalidated until Phase 5
	Env         string // "development" | "production", default "development"
}

func Load() (Config, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = ":8080"
	} else if len(port) > 0 && port[0] != ':' {
		port = ":" + port
	}

	env := os.Getenv("ENV")
	if env == "" {
		env = "development"
	}

	return Config{
		Port:        port,
		DatabaseURL: os.Getenv("DATABASE_URL"),
		Env:         env,
	}, nil
}
