package app

import (
	"net/http"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/auth"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/http/handlers"
	gatewaymiddleware "gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	routingstage "gatelm/apps/gateway-core/internal/pipeline/stages/routing"
)

type RouterOptions struct {
	APIKeyAuthenticator  handlers.APIKeyAuthenticator
	AppTokenValidator    handlers.AppTokenValidator
	AuthFailureLogWriter invocationlog.AuthFailureLogWriter
}

type RouterOption func(*RouterOptions)

func WithGatewayAuth(apiKeyAuthenticator handlers.APIKeyAuthenticator, appTokenValidator handlers.AppTokenValidator) RouterOption {
	return func(options *RouterOptions) {
		options.APIKeyAuthenticator = apiKeyAuthenticator
		options.AppTokenValidator = appTokenValidator
	}
}

func WithAuthFailureLogWriter(writer invocationlog.AuthFailureLogWriter) RouterOption {
	return func(options *RouterOptions) {
		options.AuthFailureLogWriter = writer
	}
}

func NewRouter(cfg config.Config, providers *provider.Registry, readinessChecks map[string]handlers.ReadinessCheck, opts ...RouterOption) http.Handler {
	routerOptions := RouterOptions{}
	for _, opt := range opts {
		if opt != nil {
			opt(&routerOptions)
		}
	}

	return newRouterWithOptions(cfg, providers, readinessChecks, routerOptions)
}

func NewRouterWithOptions(cfg config.Config, providers *provider.Registry, readinessChecks map[string]handlers.ReadinessCheck, options RouterOptions) http.Handler {
	return newRouterWithOptions(cfg, providers, readinessChecks, options)
}

func newRouterWithOptions(cfg config.Config, providers *provider.Registry, readinessChecks map[string]handlers.ReadinessCheck, routerOptions RouterOptions) http.Handler {
	mux := http.NewServeMux()
	credentials := auth.NewStaticCredentialStore(auth.StaticCredentialConfig{
		APIKey:   cfg.DemoAPIKey,
		AppToken: cfg.DemoAppToken,
		APIKeyIdentity: auth.APIKeyIdentity{
			APIKeyID:      cfg.DemoAPIKeyID,
			TenantID:      cfg.DemoTenantID,
			ProjectID:     cfg.DemoProjectID,
			ApplicationID: cfg.DemoApplicationID,
		},
		AppTokenIdentity: auth.AppTokenIdentity{
			AppTokenID:    cfg.DemoAppTokenID,
			TenantID:      cfg.DemoTenantID,
			ProjectID:     cfg.DemoProjectID,
			ApplicationID: cfg.DemoApplicationID,
		},
	})

	apiKeyAuthenticator := routerOptions.APIKeyAuthenticator
	if apiKeyAuthenticator == nil {
		apiKeyAuthenticator = credentials
	}
	appTokenValidator := routerOptions.AppTokenValidator
	if appTokenValidator == nil {
		appTokenValidator = credentials
	}

	mux.Handle("GET /healthz", handlers.HealthHandler{ServiceName: "gateway-core"})
	mux.Handle("GET /readyz", handlers.ReadyHandler{
		Timeout: cfg.ReadinessTimeout,
		Checks:  readinessChecks,
	})
	mux.Handle("GET /v1/models", handlers.ModelsHandler{Providers: providers})

	simpleRouter := routingdomain.NewSimpleRouter(routingdomain.SimpleRouterConfig{
		DefaultProvider:     cfg.DefaultProvider,
		DefaultModel:        cfg.DefaultModel,
		LowCostModel:        cfg.LowCostModel,
		HighQualityModel:    cfg.HighQualityModel,
		PolicyHash:          cfg.RoutingPolicyHash,
		ShortPromptMaxChars: cfg.ShortPromptMaxChars,
	})
	preProviderPipeline := pipeline.New(routingstage.NewStage(simpleRouter))

	chatCompletionsHandler := http.Handler(handlers.ChatCompletionsHandler{
		Providers:           providers,
		DefaultModel:        cfg.DefaultModel,
		DefaultProvider:     cfg.DefaultProvider,
		MaxRequestBodyBytes: cfg.MaxRequestBodyBytes,
		APIKeyAuthenticator: apiKeyAuthenticator,
		AppTokenValidator:   appTokenValidator,
		ExpectedTenantID:    cfg.DemoTenantID,
		ExpectedProjectID:   cfg.DemoProjectID,
		ExpectedAppID:       cfg.DemoApplicationID,
		PreProviderPipeline: preProviderPipeline,
	})

	authFailureLogWriter := routerOptions.AuthFailureLogWriter
	if authFailureLogWriter == nil {
		authFailureLogWriter = invocationlog.NoopAuthFailureLogWriter{}
	}
	chatCompletionsHandler = gatewaymiddleware.AuthFailureLogMiddleware(authFailureLogWriter)(chatCompletionsHandler)
	mux.Handle("POST /v1/chat/completions", chatCompletionsHandler)

	return mux
}
