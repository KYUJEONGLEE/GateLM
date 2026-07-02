package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	postgresauth "gatelm/apps/gateway-core/internal/adapters/auth/postgres"
	postgresbudget "gatelm/apps/gateway-core/internal/adapters/budget/postgres"
	rediscache "gatelm/apps/gateway-core/internal/adapters/cache/redis"
	credentialenvmap "gatelm/apps/gateway-core/internal/adapters/credentials/envmap"
	postgresinvocationlog "gatelm/apps/gateway-core/internal/adapters/invocationlog/postgres"
	controlplaneprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/controlplane"
	staticprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/static"
	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/adapters/providers/openai"
	postgresratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/postgres"
	controlplaneruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/controlplane"
	staticruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/static"
	"gatelm/apps/gateway-core/internal/app"
	"gatelm/apps/gateway-core/internal/config"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/handlers"
	"gatelm/apps/gateway-core/internal/pipeline"
	budgetstage "gatelm/apps/gateway-core/internal/pipeline/stages/budget"
	ratelimitstage "gatelm/apps/gateway-core/internal/pipeline/stages/ratelimit"
	runtimeconfigstage "gatelm/apps/gateway-core/internal/pipeline/stages/runtimeconfig"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg, err := config.LoadWithError()
	if err != nil {
		log.Fatalf("gateway-core configuration failed: %v", err)
	}
	if err := validateRuntimeSnapshotMode(cfg); err != nil {
		log.Fatalf("gateway-core invalid GATEWAY_RUNTIME_SNAPSHOT_MODE: %v", err)
	}
	if isStrictRuntimeSnapshotMode(cfg) && strings.TrimSpace(cfg.ControlPlaneBaseURL) == "" {
		log.Fatalf("gateway-core strict runtime snapshot mode requires GATEWAY_CONTROL_PLANE_BASE_URL")
	}

	providerHTTPClient := &http.Client{Timeout: cfg.ProviderTimeout}
	mockAdapter := mock.NewAdapter(cfg.MockProviderBaseURL, providerHTTPClient)
	openAIAdapter := openai.NewAdapter(providerHTTPClient)
	providers := provider.NewRegistry(providercatalog.AdapterTypeMock, mockAdapter, openAIAdapter)
	runtimeSnapshotProvider, providerCatalogResolver := buildRuntimePolicySources(cfg)
	credentialResolver := credentialenvmap.NewResolver(credentialenvmap.ParseBindings(cfg.ProviderCredentialEnvMap))

	postgresPool, err := pgxpool.New(context.Background(), config.DatabaseDriverURL(cfg.DatabaseURL))
	if err != nil {
		log.Fatalf("gateway-core postgres pool configuration failed: %v", err)
	}
	defer postgresPool.Close()

	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("gateway-core redis configuration failed: %v", err)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()

	readinessChecks := map[string]handlers.ReadinessCheck{
		"postgres": {
			Required:       true,
			FailureMessage: "connection failed",
			Check:          postgresPool.Ping,
		},
		"redis": {
			Required:       true,
			FailureMessage: "connection failed",
			Check: func(ctx context.Context) error {
				return redisClient.Ping(ctx).Err()
			},
		},
		"mock_provider": {
			Required:       true,
			FailureMessage: "connection failed",
			Check:          handlers.HTTPHealthCheck(providerHTTPClient, cfg.MockProviderBaseURL),
		},
	}
	if isStrictRuntimeSnapshotMode(cfg) {
		readinessChecks["control_plane"] = handlers.ReadinessCheck{
			Required:       true,
			FailureMessage: "connection failed",
			Check:          handlers.HTTPHealthCheck(&http.Client{Timeout: cfg.ControlPlaneTimeout}, cfg.ControlPlaneBaseURL),
		}
	}

	authFailureLogWriter := postgresinvocationlog.NewAuthFailureWriter(postgresPool, postgresinvocationlog.AuthFailureDefaults{
		TenantID:      cfg.DemoTenantID,
		ProjectID:     cfg.DemoProjectID,
		ApplicationID: cfg.DemoApplicationID,
	})
	terminalLogWriter := postgresinvocationlog.NewTerminalLogWriter(postgresPool, postgresinvocationlog.TerminalLogDefaults{
		TenantID:      cfg.DemoTenantID,
		ProjectID:     cfg.DemoProjectID,
		ApplicationID: cfg.DemoApplicationID,
	})
	invocationLogReader := postgresinvocationlog.NewQueryReader(invocationLogQueryer{pool: postgresPool})
	routerOptions := []app.RouterOption{
		app.WithAuthFailureLogWriter(authFailureLogWriter),
		app.WithTerminalLogWriter(terminalLogWriter),
		app.WithInvocationLogReader(invocationLogReader),
		app.WithExactCache(
			rediscache.NewStore(redisClient, cfg.ExactCacheTTL),
			cachekey.NewExactKeyBuilder([]byte(cfg.ExactCacheKeySecret)),
		),
		app.WithProviderExecution(providerCatalogResolver, credentialResolver),
	}
	if strings.EqualFold(strings.TrimSpace(cfg.AuthSource), "database") {
		gatewayCredentials := postgresauth.NewStore(postgresPool)
		routerOptions = append(routerOptions, app.WithGatewayAuth(gatewayCredentials, gatewayCredentials))
	}
	runtimePolicyPipeline := pipeline.New(
		runtimeconfigstage.NewStage(runtimeSnapshotProvider),
		budgetstage.NewStage(postgresbudget.NewChecker(postgresPool)),
		ratelimitstage.NewStage(
			postgresratelimit.NewLimiter(postgresPool),
			ratelimit.Config{
				Enabled:       cfg.RateLimitEnabled,
				Scope:         ratelimit.ScopeApplication,
				Algorithm:     ratelimit.AlgorithmFixedWindow,
				WindowSeconds: cfg.RateLimitWindowSecs,
				Limit:         cfg.RateLimitLimit,
			},
		),
	)

	routerOptions = append(routerOptions, app.WithRuntimePolicyPipeline(runtimePolicyPipeline))
	router := app.NewRouter(
		cfg,
		providers,
		readinessChecks,
		routerOptions...,
	)
	server := app.NewServer(cfg, router)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("gateway-core listening on :%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("gateway-core server failed: %v", err)
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("gateway-core shutdown failed: %v", err)
	}
}

func buildRuntimePolicySources(cfg config.Config) (runtimeconfig.SnapshotProvider, providercatalog.Resolver) {
	if strings.TrimSpace(cfg.ControlPlaneBaseURL) != "" {
		client := &http.Client{Timeout: cfg.ControlPlaneTimeout}
		return controlplaneruntimeconfig.NewProvider(cfg.ControlPlaneBaseURL, client),
			controlplaneprovidercatalog.NewResolver(cfg.ControlPlaneBaseURL, client)
	}

	return staticruntimeconfig.NewProvider(buildStaticRuntimeConfig(cfg)),
		staticprovidercatalog.NewResolver(buildStaticProviderCatalog(cfg))
}

func isStrictRuntimeSnapshotMode(cfg config.Config) bool {
	mode := normalizedRuntimeSnapshotMode(cfg)
	return mode == "strict" || mode == "strict_snapshot"
}

func validateRuntimeSnapshotMode(cfg config.Config) error {
	switch normalizedRuntimeSnapshotMode(cfg) {
	case "", "demo", "strict", "strict_snapshot":
		return nil
	default:
		return fmt.Errorf("%q (allowed: demo, strict, strict_snapshot)", cfg.RuntimeSnapshotMode)
	}
}

func normalizedRuntimeSnapshotMode(cfg config.Config) string {
	return strings.TrimSpace(strings.ToLower(cfg.RuntimeSnapshotMode))
}

type invocationLogQueryer struct {
	pool *pgxpool.Pool
}

func (q invocationLogQueryer) Query(ctx context.Context, sql string, arguments ...any) (postgresinvocationlog.Rows, error) {
	return q.pool.Query(ctx, sql, arguments...)
}

func (q invocationLogQueryer) QueryRow(ctx context.Context, sql string, arguments ...any) postgresinvocationlog.Row {
	return q.pool.QueryRow(ctx, sql, arguments...)
}

func buildStaticRuntimeConfig(cfg config.Config) runtimeconfig.ActiveConfig {
	return runtimeconfig.ActiveConfig{
		ConfigVersion:     "runtime_config_v1_local_static",
		ConfigHash:        cfg.RuntimeConfigHash,
		PublishState:      runtimeconfig.PublishStateActive,
		TenantID:          cfg.DemoTenantID,
		TenantStatus:      runtimeconfig.StatusActive,
		ProjectID:         cfg.DemoProjectID,
		ProjectStatus:     runtimeconfig.StatusActive,
		ApplicationID:     cfg.DemoApplicationID,
		ApplicationStatus: runtimeconfig.StatusActive,
		APIKeyID:          cfg.DemoAPIKeyID,
		APIKeyStatus:      runtimeconfig.StatusActive,
		AppTokenID:        cfg.DemoAppTokenID,
		AppTokenStatus:    runtimeconfig.StatusActive,
		Snapshot: runtimeconfig.RuntimeSnapshotProvenance{
			ProviderCatalogRef: providercatalog.Reference{
				CatalogID:      cfg.ProviderCatalogID,
				CatalogVersion: cfg.ProviderCatalogVersion,
				ContentHash:    cfg.ProviderCatalogHash,
			},
		},
		RateLimit: ratelimit.Config{
			Enabled:       cfg.RateLimitEnabled,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: cfg.RateLimitWindowSecs,
			Limit:         cfg.RateLimitLimit,
		},
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: cfg.SecurityPolicyHash,
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			DefaultProvider:     cfg.DefaultProvider,
			DefaultModel:        cfg.DefaultModel,
			LowCostProvider:     cfg.DefaultProvider,
			LowCostModel:        cfg.LowCostModel,
			HighQualityProvider: cfg.DefaultProvider,
			HighQualityModel:    cfg.HighQualityModel,
			FallbackProvider:    cfg.DefaultProvider,
			FallbackModel:       cfg.DefaultModel,
			ShortPromptMaxChars: cfg.ShortPromptMaxChars,
			RoutingPolicyHash:   cfg.RoutingPolicyHash,
		},
		CachePolicy: runtimeconfig.CachePolicy{
			Enabled:         true,
			Type:            runtimeconfig.CacheTypeExact,
			TTLSeconds:      int(cfg.ExactCacheTTL.Seconds()),
			CachePolicyHash: cfg.CachePolicyHash,
		},
	}
}

func buildStaticProviderCatalog(cfg config.Config) providercatalog.Catalog {
	return providercatalog.Catalog{
		CatalogID:      cfg.ProviderCatalogID,
		CatalogVersion: cfg.ProviderCatalogVersion,
		ContentHash:    cfg.ProviderCatalogHash,
		UpdatedAt:      time.Now().UTC(),
		Providers: []providercatalog.Provider{
			{
				ProviderID:         cfg.OpenAIProviderID,
				ProviderName:       cfg.OpenAIProviderName,
				AdapterType:        providercatalog.AdapterTypeOpenAICompatible,
				Enabled:            true,
				BaseURL:            cfg.OpenAIProviderBaseURL,
				TimeoutMs:          int(cfg.ProviderTimeout.Milliseconds()),
				CredentialRequired: true,
				CredentialRef: &credentials.Ref{
					CredentialRefID:   cfg.OpenAICredentialRefID,
					CredentialVersion: 1,
					CredentialState:   credentials.StateActive,
				},
				AdapterConfig: providercatalog.AdapterConfig{
					RequestFormat: providercatalog.RequestFormatOpenAIChatCompletions,
				},
				FallbackEligible: false,
				Models: []providercatalog.Model{
					{
						ModelID:     cfg.OpenAILowCostModelID,
						ModelName:   cfg.OpenAILowCostModelName,
						DisplayName: "OpenAI Low Cost",
						Enabled:     true,
						Capabilities: providercatalog.ModelCapabilities{
							StreamingSupported: true,
							SupportsJSONMode:   true,
							MaxInputTokens:     8192,
							MaxOutputTokens:    2048,
						},
						Routing: providercatalog.ModelRouting{
							AutoRoutingEligible: true,
							CostTier:            "low",
							FallbackPriority:    0,
						},
					},
					{
						ModelID:     cfg.OpenAIBalancedModelID,
						ModelName:   cfg.OpenAIBalancedModelName,
						DisplayName: "OpenAI Balanced",
						Enabled:     true,
						Capabilities: providercatalog.ModelCapabilities{
							StreamingSupported: true,
							SupportsJSONMode:   true,
							MaxInputTokens:     128000,
							MaxOutputTokens:    4096,
						},
						Routing: providercatalog.ModelRouting{
							AutoRoutingEligible: true,
							CostTier:            "balanced",
							FallbackPriority:    1,
						},
					},
				},
			},
			{
				ProviderID:         cfg.MockProviderID,
				ProviderName:       cfg.MockProviderName,
				AdapterType:        providercatalog.AdapterTypeMock,
				Enabled:            true,
				BaseURL:            cfg.MockProviderBaseURL,
				TimeoutMs:          int(cfg.ProviderTimeout.Milliseconds()),
				CredentialRequired: false,
				CredentialRef:      nil,
				AdapterConfig: providercatalog.AdapterConfig{
					RequestFormat: providercatalog.RequestFormatMockChatCompletions,
				},
				FallbackEligible: true,
				Models: []providercatalog.Model{
					mockCatalogModel(cfg.LowCostModel, "Mock Low Cost", 10),
					mockCatalogModel(cfg.DefaultModel, "Mock Fallback Chat Model", 20),
					mockCatalogModel(cfg.HighQualityModel, "Mock High Quality", 30),
				},
			},
		},
	}
}

func mockCatalogModel(modelID string, displayName string, fallbackPriority int) providercatalog.Model {
	return providercatalog.Model{
		ModelID:     modelID,
		ModelName:   modelID,
		DisplayName: displayName,
		Enabled:     true,
		Capabilities: providercatalog.ModelCapabilities{
			StreamingSupported: true,
			SupportsJSONMode:   false,
			MaxInputTokens:     4096,
			MaxOutputTokens:    1024,
		},
		Routing: providercatalog.ModelRouting{
			AutoRoutingEligible: false,
			CostTier:            "low",
			FallbackPriority:    fallbackPriority,
		},
	}
}
