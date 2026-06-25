package app

import (
	"net/http"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/handlers"
)

func NewRouter(cfg config.Config, providers *provider.Registry, readinessChecks map[string]handlers.ReadinessCheck) http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /healthz", handlers.HealthHandler{ServiceName: "gateway-core"})
	mux.Handle("GET /readyz", handlers.ReadyHandler{
		Timeout: cfg.ReadinessTimeout,
		Checks:  readinessChecks,
	})
	mux.Handle("GET /v1/models", handlers.ModelsHandler{Providers: providers})
	mux.Handle("POST /v1/chat/completions", handlers.ChatCompletionsHandler{
		Providers:           providers,
		DefaultModel:        cfg.DefaultModel,
		DefaultProvider:     cfg.DefaultProvider,
		MaxRequestBodyBytes: cfg.MaxRequestBodyBytes,
	})

	return mux
}
