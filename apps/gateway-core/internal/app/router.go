package app

import (
	"net/http"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/auth"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/provider"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/http/handlers"
	gatewaymiddleware "gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/ports"
)

type RouterOptions struct {
	APIKeyAuthenticator  handlers.APIKeyAuthenticator
	AppTokenValidator    handlers.AppTokenValidator
	AuthFailureLogWriter invocationlog.AuthFailureLogWriter
	ExactCacheStore      ports.CacheStore
	ExactCacheKeyBuilder handlers.ExactCacheKeyBuilder
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

func WithExactCache(store ports.CacheStore, keyBuilder handlers.ExactCacheKeyBuilder) RouterOption {
	return func(options *RouterOptions) {
		options.ExactCacheStore = store
		options.ExactCacheKeyBuilder = keyBuilder
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

	chatHandler := &handlers.ChatCompletionsHandler{
		Providers:               providers,
		DefaultModel:            cfg.DefaultModel,
		DefaultProvider:         cfg.DefaultProvider,
		MaxRequestBodyBytes:     cfg.MaxRequestBodyBytes,
		APIKeyAuthenticator:     apiKeyAuthenticator,
		AppTokenValidator:       appTokenValidator,
		ExpectedTenantID:        cfg.DemoTenantID,
		ExpectedProjectID:       cfg.DemoProjectID,
		ExpectedAppID:           cfg.DemoApplicationID,
		MaskingEngine:           maskdomain.NewP0Engine(),
		Router:                  routingdomain.NewP0SimpleRouter(cfg.DefaultProvider, cfg.DefaultModel),
		ExactCacheStore:         routerOptions.ExactCacheStore,
		ExactCacheKeyBuilder:    routerOptions.ExactCacheKeyBuilder,
		ExactCacheTTL:           cfg.ExactCacheTTL,
		CachePolicyHash:         "cache_p0_v1",
		SecurityPolicyVersionID: maskdomain.DefaultSecurityPolicyVersionID,
	}
	if routerOptions.ExactCacheKeyBuilder == nil {
		if cfg.ExactCacheKeySecret != "" {
			chatHandler.ExactCacheKeyBuilder = cachekey.NewExactKeyBuilder([]byte(cfg.ExactCacheKeySecret))
		}
	}
	chatCompletionsHandler := http.Handler(chatHandler)

	authFailureLogWriter := routerOptions.AuthFailureLogWriter
	if authFailureLogWriter == nil {
		authFailureLogWriter = invocationlog.NoopAuthFailureLogWriter{}
	}
	chatCompletionsHandler = gatewaymiddleware.AuthFailureLogMiddleware(authFailureLogWriter)(chatCompletionsHandler)
	mux.Handle("POST /v1/chat/completions", chatCompletionsHandler)

	return mux
}
