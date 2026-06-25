package app

import (
	"net/http"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/handlers"
	gatewaymiddleware "gatelm/apps/gateway-core/internal/http/middleware"
)

type RouterOptions struct {
	AuthFailureLogWriter invocationlog.AuthFailureLogWriter
}

func NewRouter(cfg config.Config, providers *provider.Registry, readinessChecks map[string]handlers.ReadinessCheck) http.Handler {
	return NewRouterWithOptions(cfg, providers, readinessChecks, RouterOptions{})
}

func NewRouterWithOptions(cfg config.Config, providers *provider.Registry, readinessChecks map[string]handlers.ReadinessCheck, options RouterOptions) http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /healthz", handlers.HealthHandler{ServiceName: "gateway-core"})
	mux.Handle("GET /readyz", handlers.ReadyHandler{
		Timeout: cfg.ReadinessTimeout,
		Checks:  readinessChecks,
	})
	mux.Handle("GET /v1/models", handlers.ModelsHandler{Providers: providers})
	chatCompletionsHandler := http.Handler(handlers.ChatCompletionsHandler{
		Providers:           providers,
		DefaultModel:        cfg.DefaultModel,
		DefaultProvider:     cfg.DefaultProvider,
		MaxRequestBodyBytes: cfg.MaxRequestBodyBytes,
	})
	authFailureLogWriter := options.AuthFailureLogWriter
	if authFailureLogWriter == nil {
		authFailureLogWriter = invocationlog.NoopAuthFailureLogWriter{}
	}
	chatCompletionsHandler = gatewaymiddleware.AuthFailureLogMiddleware(authFailureLogWriter)(chatCompletionsHandler)
	mux.Handle("POST /v1/chat/completions", chatCompletionsHandler)

	return mux
}
