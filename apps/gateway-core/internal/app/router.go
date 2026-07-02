package app

import (
	"net/http"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/auth"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/http/handlers"
	"gatelm/apps/gateway-core/internal/pipeline"
	routingstage "gatelm/apps/gateway-core/internal/pipeline/stages/routing"
	"gatelm/apps/gateway-core/internal/ports"
)

type RouterOptions struct {
	APIKeyAuthenticator   handlers.APIKeyAuthenticator
	AppTokenValidator     handlers.AppTokenValidator
	AuthFailureLogWriter  invocationlog.AuthFailureLogWriter
	TerminalLogWriter     invocationlog.TerminalLogWriter
	InvocationLogReader   invocationlog.Reader
	ExactCacheStore       ports.CacheStore
	ExactCacheKeyBuilder  handlers.ExactCacheKeyBuilder
	SemanticCacheService  handlers.SemanticCacheService
	MetricsRegistry       *metrics.Registry
	RateLimitPipeline     handlers.GatewayPipeline
	RuntimePolicyPipeline handlers.GatewayPipeline
	PreProviderPipeline   handlers.GatewayPipeline
	ProviderCatalogs      providercatalog.Resolver
	Credentials           credentials.Resolver
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

func WithTerminalLogWriter(writer invocationlog.TerminalLogWriter) RouterOption {
	return func(options *RouterOptions) {
		options.TerminalLogWriter = writer
	}
}

func WithInvocationLogReader(reader invocationlog.Reader) RouterOption {
	return func(options *RouterOptions) {
		options.InvocationLogReader = reader
	}
}

func WithExactCache(store ports.CacheStore, keyBuilder handlers.ExactCacheKeyBuilder) RouterOption {
	return func(options *RouterOptions) {
		options.ExactCacheStore = store
		options.ExactCacheKeyBuilder = keyBuilder
	}
}

func WithSemanticCache(service handlers.SemanticCacheService) RouterOption {
	return func(options *RouterOptions) {
		options.SemanticCacheService = service
	}
}

func WithMetrics(registry *metrics.Registry) RouterOption {
	return func(options *RouterOptions) {
		options.MetricsRegistry = registry
	}
}

func WithPreProviderPipeline(preProviderPipeline handlers.GatewayPipeline) RouterOption {
	return func(options *RouterOptions) {
		options.PreProviderPipeline = preProviderPipeline
	}
}

func WithRateLimitPipeline(rateLimitPipeline handlers.GatewayPipeline) RouterOption {
	return func(options *RouterOptions) {
		options.RateLimitPipeline = rateLimitPipeline
		options.RuntimePolicyPipeline = rateLimitPipeline
	}
}

func WithRuntimePolicyPipeline(runtimePolicyPipeline handlers.GatewayPipeline) RouterOption {
	return func(options *RouterOptions) {
		options.RuntimePolicyPipeline = runtimePolicyPipeline
	}
}

func WithProviderExecution(providerCatalogs providercatalog.Resolver, credentialResolver credentials.Resolver) RouterOption {
	return func(options *RouterOptions) {
		options.ProviderCatalogs = providerCatalogs
		options.Credentials = credentialResolver
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
	authFailureLogWriter := routerOptions.AuthFailureLogWriter
	if authFailureLogWriter == nil {
		authFailureLogWriter = invocationlog.NoopAuthFailureLogWriter{}
	}
	terminalLogWriter := routerOptions.TerminalLogWriter
	if terminalLogWriter == nil {
		terminalLogWriter = invocationlog.NoopTerminalLogWriter{}
	}

	simpleRouter := routingdomain.NewSimpleRouter(routingdomain.SimpleRouterConfig{
		DefaultProvider:     cfg.DefaultProvider,
		DefaultModel:        cfg.DefaultModel,
		LowCostModel:        cfg.LowCostModel,
		HighQualityModel:    cfg.HighQualityModel,
		PolicyHash:          cfg.RoutingPolicyHash,
		ShortPromptMaxChars: cfg.ShortPromptMaxChars,
	})
	var preProviderPipeline handlers.GatewayPipeline = pipeline.New(routingstage.NewStage(simpleRouter))
	if routerOptions.PreProviderPipeline != nil {
		preProviderPipeline = routerOptions.PreProviderPipeline
	}

	exactCacheKeyBuilder := routerOptions.ExactCacheKeyBuilder
	if exactCacheKeyBuilder == nil && cfg.ExactCacheKeySecret != "" {
		exactCacheKeyBuilder = cachekey.NewExactKeyBuilder([]byte(cfg.ExactCacheKeySecret))
	}
	metricsRegistry := routerOptions.MetricsRegistry
	if metricsRegistry == nil {
		metricsRegistry = metrics.NewRegistry()
	}
	semanticCacheService := routerOptions.SemanticCacheService
	if semanticCacheService == nil && cfg.SemanticCache.Enabled {
		store, storeErr := cachekey.NewSemanticCacheStore(cfg.SemanticCache.Store, cfg.SemanticCache.MaxEntries)
		embeddingProvider, providerErr := cachekey.NewSemanticCacheEmbeddingProviderWithConfig(cachekey.SemanticCacheEmbeddingProviderConfig{
			Provider:         cfg.SemanticCache.EmbeddingProvider,
			ModelName:        cfg.SemanticCache.EmbeddingModel,
			OpenAIAPIKey:     cfg.SemanticCache.OpenAIAPIKey,
			OpenAIBaseURL:    cfg.SemanticCache.OpenAIBaseURL,
			OpenAIDimensions: cfg.SemanticCache.EmbeddingDimensions,
			Timeout:          cfg.SemanticCache.EmbeddingTimeout,
		})
		if storeErr == nil && providerErr == nil {
			service := cachekey.NewSemanticCacheService(store, embeddingProvider, cachekey.SemanticCacheServiceConfig{
				Enabled:       cfg.SemanticCache.Enabled,
				Threshold:     cfg.SemanticCache.Threshold,
				TopK:          cfg.SemanticCache.TopK,
				TTL:           cfg.SemanticCache.TTL,
				PolicyVersion: cfg.SemanticCache.PolicyVersion,
			})
			semanticCacheService = service
		}
	}

	mux.Handle("GET /healthz", handlers.HealthHandler{ServiceName: "gateway-core"})
	mux.Handle("GET /metrics", handlers.MetricsHandler{Registry: metricsRegistry})
	mux.Handle("GET /readyz", handlers.ReadyHandler{
		Timeout: cfg.ReadinessTimeout,
		Checks:  readinessChecks,
	})
	mux.Handle("GET /v1/models", handlers.ModelsHandler{
		Providers:           providers,
		PreProviderPipeline: preProviderPipeline,
	})
	mux.Handle("GET /api/projects/{projectId}/logs", handlers.ProjectLogsHandler{
		Reader:   routerOptions.InvocationLogReader,
		TenantID: cfg.DemoTenantID,
	})
	mux.Handle("GET /api/llm-requests/{requestId}", handlers.RequestDetailHandler{
		Reader:    routerOptions.InvocationLogReader,
		TenantID:  cfg.DemoTenantID,
		ProjectID: cfg.DemoProjectID,
	})
	mux.Handle("GET /api/dashboard/overview", handlers.DashboardOverviewHandler{
		Reader:   routerOptions.InvocationLogReader,
		TenantID: cfg.DemoTenantID,
	})

	mux.Handle("POST /v1/chat/completions", http.Handler(&handlers.ChatCompletionsHandler{
		Providers:                    providers,
		ProviderCatalogResolver:      routerOptions.ProviderCatalogs,
		CredentialResolver:           routerOptions.Credentials,
		DefaultModel:                 cfg.DefaultModel,
		DefaultProvider:              cfg.DefaultProvider,
		MaxRequestBodyBytes:          cfg.MaxRequestBodyBytes,
		APIKeyAuthenticator:          apiKeyAuthenticator,
		AppTokenValidator:            appTokenValidator,
		ExpectedTenantID:             cfg.ExpectedTenantID,
		ExpectedProjectID:            cfg.ExpectedProjectID,
		ExpectedAppID:                cfg.ExpectedApplicationID,
		RuntimePolicyPipeline:        firstNonNilPipeline(routerOptions.RuntimePolicyPipeline, routerOptions.RateLimitPipeline),
		RateLimitPipeline:            routerOptions.RateLimitPipeline,
		PreProviderPipeline:          preProviderPipeline,
		AuthFailureLogWriter:         authFailureLogWriter,
		TerminalLogWriter:            terminalLogWriter,
		MaskingEngine:                maskdomain.NewP0Engine(),
		MetricsRegistry:              metricsRegistry,
		ExactCacheStore:              routerOptions.ExactCacheStore,
		ExactCacheKeyBuilder:         exactCacheKeyBuilder,
		ExactCacheTTL:                cfg.ExactCacheTTL,
		CachePolicyHash:              cfg.CachePolicyHash,
		SecurityPolicyVersionID:      cfg.SecurityPolicyHash,
		SemanticCacheService:         semanticCacheService,
		SemanticCacheAllowCategories: cfg.SemanticCache.AllowCategories,
		SemanticCacheDenyCategories:  cfg.SemanticCache.DenyCategories,
		SemanticCachePolicyVersion:   cfg.SemanticCache.PolicyVersion,
		SemanticCacheKeyVersion:      cfg.SemanticCache.KeyVersion,
	}))

	return mux
}

func firstNonNilPipeline(pipelines ...handlers.GatewayPipeline) handlers.GatewayPipeline {
	for _, pipeline := range pipelines {
		if pipeline != nil {
			return pipeline
		}
	}
	return nil
}
