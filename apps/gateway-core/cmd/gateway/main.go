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

	cachedauth "gatelm/apps/gateway-core/internal/adapters/auth/cached"
	postgresauth "gatelm/apps/gateway-core/internal/adapters/auth/postgres"
	postgresbudget "gatelm/apps/gateway-core/internal/adapters/budget/postgres"
	rediscache "gatelm/apps/gateway-core/internal/adapters/cache/redis"
	credentialcomposite "gatelm/apps/gateway-core/internal/adapters/credentials/composite"
	credentialenvmap "gatelm/apps/gateway-core/internal/adapters/credentials/envmap"
	credentialpostgres "gatelm/apps/gateway-core/internal/adapters/credentials/postgres"
	postgresemployeepolicy "gatelm/apps/gateway-core/internal/adapters/employeepolicy/postgres"
	redisemployeepolicy "gatelm/apps/gateway-core/internal/adapters/employeepolicy/redis"
	asyncinvocationlog "gatelm/apps/gateway-core/internal/adapters/invocationlog/asyncwriter"
	postgresinvocationlog "gatelm/apps/gateway-core/internal/adapters/invocationlog/postgres"
	cachedpricing "gatelm/apps/gateway-core/internal/adapters/pricing/cached"
	postgrespricing "gatelm/apps/gateway-core/internal/adapters/pricing/postgres"
	cachedprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/cached"
	controlplaneprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/controlplane"
	staticprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/static"
	"gatelm/apps/gateway-core/internal/adapters/providers/anthropic"
	providerhttpclient "gatelm/apps/gateway-core/internal/adapters/providers/httpclient"
	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/adapters/providers/openai"
	postgresratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/postgres"
	redisratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/redis"
	cachedruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/cached"
	controlplaneruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/controlplane"
	staticruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/static"
	postgresadmission "gatelm/apps/gateway-core/internal/adapters/tenantchat/admission/postgres"
	postgrestentantruntime "gatelm/apps/gateway-core/internal/adapters/tenantchat/runtime/postgres"
	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/app"
	"gatelm/apps/gateway-core/internal/config"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/costing"
	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/handlers"
	tenantchathttp "gatelm/apps/gateway-core/internal/http/tenantchat"
	"gatelm/apps/gateway-core/internal/pipeline"
	budgetstage "gatelm/apps/gateway-core/internal/pipeline/stages/budget"
	employeepolicystage "gatelm/apps/gateway-core/internal/pipeline/stages/employeepolicy"
	ratelimitstage "gatelm/apps/gateway-core/internal/pipeline/stages/ratelimit"
	runtimeconfigstage "gatelm/apps/gateway-core/internal/pipeline/stages/runtimeconfig"
	admissionservice "gatelm/apps/gateway-core/internal/services/tenantchat/admission"
	"gatelm/apps/gateway-core/internal/services/tenantchat/requestauth"

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
	if isStrictRuntimeSnapshotMode(cfg) && strings.TrimSpace(cfg.ControlPlaneInternalToken) == "" {
		log.Fatalf("gateway-core strict runtime snapshot mode requires GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN")
	}

	providerHTTPClient := providerhttpclient.New(providerhttpclient.Config{
		RequestTimeout:        cfg.ProviderTimeout,
		MaxIdleConns:          cfg.ProviderTransport.MaxIdleConns,
		MaxIdleConnsPerHost:   cfg.ProviderTransport.MaxIdleConnsPerHost,
		MaxConnsPerHost:       cfg.ProviderTransport.MaxConnsPerHost,
		IdleConnTimeout:       cfg.ProviderTransport.IdleConnTimeout,
		DialTimeout:           cfg.ProviderTransport.DialTimeout,
		DialKeepAlive:         cfg.ProviderTransport.DialKeepAlive,
		TLSHandshakeTimeout:   cfg.ProviderTransport.TLSHandshakeTimeout,
		ResponseHeaderTimeout: cfg.ProviderTransport.ResponseHeaderTimeout,
		ExpectContinueTimeout: cfg.ProviderTransport.ExpectContinueTimeout,
	})
	defer providerHTTPClient.CloseIdleConnections()
	mockAdapter := mock.NewAdapter(cfg.MockProviderBaseURL, providerHTTPClient)
	openAIAdapter := openai.NewAdapter(providerHTTPClient)
	anthropicAdapter := anthropic.NewAdapter(providerHTTPClient)
	providers := provider.NewRegistry(providercatalog.AdapterTypeMock, mockAdapter, openAIAdapter, anthropicAdapter)
	runtimeSnapshotProvider, providerCatalogResolver := buildRuntimePolicySources(cfg)
	metricsRegistry := metrics.NewRegistry()

	postgresPool, err := newPostgresPool(context.Background(), cfg.DatabaseURL, cfg.DatabasePool, "gatelm-gateway-main")
	if err != nil {
		log.Fatalf("gateway-core postgres pool configuration failed: %v", err)
	}
	defer postgresPool.Close()
	logPostgresPool, err := newPostgresPool(context.Background(), cfg.LogDatabaseURL, cfg.LogDatabasePool, "gatelm-gateway-log")
	if err != nil {
		log.Fatalf("gateway-core log postgres pool configuration failed: %v", err)
	}
	defer logPostgresPool.Close()
	credentialResolver, err := buildProviderCredentialResolver(cfg, postgresPool)
	if err != nil {
		log.Fatalf("gateway-core provider credential resolver configuration failed: %v", err)
	}

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
		"postgres_log": {
			Required:       true,
			FailureMessage: "connection failed",
			Check:          logPostgresPool.Ping,
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

	authFailureLogWriter := postgresinvocationlog.NewAuthFailureWriter(logPostgresPool, postgresinvocationlog.AuthFailureDefaults{
		TenantID:      cfg.DemoTenantID,
		ProjectID:     cfg.DemoProjectID,
		ApplicationID: cfg.DemoApplicationID,
	})
	postgresTerminalLogWriter := postgresinvocationlog.NewTerminalLogWriter(logPostgresPool, postgresinvocationlog.TerminalLogDefaults{
		TenantID:      cfg.DemoTenantID,
		ProjectID:     cfg.DemoProjectID,
		ApplicationID: cfg.DemoApplicationID,
	})
	dailyTokenUsageStore := redisemployeepolicy.NewDailyTokenUsageStore(redisClient)
	var terminalLogWriter invocationlog.TerminalLogWriter = postgresTerminalLogWriter
	var asyncTerminalLogWriter *asyncinvocationlog.TerminalLogWriter
	if cfg.AsyncLogEnabled {
		asyncTerminalLogWriter = asyncinvocationlog.NewTerminalLogWriter(postgresTerminalLogWriter, asyncinvocationlog.TerminalLogWriterConfig{
			QueueSize:       cfg.AsyncLogQueueSize,
			WorkerCount:     cfg.AsyncLogWorkerCount,
			BatchSize:       cfg.AsyncLogBatchSize,
			FlushInterval:   cfg.AsyncLogBatchFlushInterval,
			WriteTimeout:    cfg.AsyncLogWriteTimeout,
			MetricsRegistry: metricsRegistry,
		})
		terminalLogWriter = asyncTerminalLogWriter
	}
	terminalLogWriter = redisemployeepolicy.NewTrackingTerminalLogWriter(
		terminalLogWriter,
		dailyTokenUsageStore,
	)
	invocationLogReader := postgresinvocationlog.NewQueryReader(invocationLogQueryer{pool: postgresPool})
	pricingCatalog := cachedpricing.NewReader(postgrespricing.NewReader(postgresPool), cachedpricing.Config{
		Enabled:    cfg.PricingCache.Enabled,
		TTL:        cfg.PricingCache.TTL,
		MaxEntries: cfg.PricingCache.MaxEntries,
	})
	costCalculator := costing.NewCalculator(pricingCatalog)
	routerOptions := []app.RouterOption{
		app.WithAuthFailureLogWriter(authFailureLogWriter),
		app.WithTerminalLogWriter(terminalLogWriter),
		app.WithInvocationLogReader(invocationLogReader),
		app.WithCostCalculator(costCalculator),
		app.WithMetrics(metricsRegistry),
		app.WithExactCache(
			rediscache.NewStore(redisClient, cfg.ExactCacheTTL),
			cachekey.NewExactKeyBuilder([]byte(cfg.ExactCacheKeySecret)),
		),
		app.WithProviderExecution(providerCatalogResolver, credentialResolver),
	}
	if strings.EqualFold(strings.TrimSpace(cfg.AuthSource), "database") {
		gatewayCredentials := cachedauth.NewStore(postgresauth.NewStore(postgresPool), cachedauth.Config{
			Enabled:    cfg.AuthCache.Enabled,
			TTL:        cfg.AuthCache.TTL,
			MaxEntries: cfg.AuthCache.MaxEntries,
			KeySecret:  []byte(cfg.AuthCache.KeySecret),
		})
		routerOptions = append(routerOptions, app.WithGatewayAuth(gatewayCredentials, gatewayCredentials))
	}
	rateLimiter, err := buildRateLimiter(cfg, postgresPool, redisClient)
	if err != nil {
		log.Fatalf("gateway-core rate limiter configuration failed: %v", err)
	}
	runtimePolicyPipeline := pipeline.New(
		runtimeconfigstage.NewStage(runtimeSnapshotProvider),
		employeepolicystage.NewStage(postgresemployeepolicy.NewResolverWithDailyTokenUsage(
			postgresPool,
			dailyTokenUsageStore,
		)),
		budgetstage.NewStage(postgresbudget.NewChecker(postgresPool)),
		ratelimitstage.NewStage(rateLimiter, buildRateLimitStageConfig(cfg)),
	)
	modelsRuntimePipeline := pipeline.New(
		runtimeconfigstage.NewStage(runtimeSnapshotProvider),
	)

	routerOptions = append(routerOptions, app.WithRuntimePolicyPipeline(runtimePolicyPipeline))
	routerOptions = append(routerOptions, app.WithModelsRuntimePipeline(modelsRuntimePipeline))
	router := app.NewRouter(
		cfg,
		providers,
		readinessChecks,
		routerOptions...,
	)
	server := app.NewServer(cfg, router)
	var tenantChatPrivateServer *app.Server
	if cfg.TenantChatPrivate.Enabled {
		workloadVerifier, err := workloadauth.Load(
			cfg.TenantChatPrivate.WorkloadJWKSFile,
			cfg.TenantChatPrivate.BindingHMACKeysFile,
		)
		if err != nil {
			log.Fatalf("gateway-core tenant chat workload verifier failed: %v", err)
		}
		jtiConsumer, err := workloadauth.NewJTIConsumer(redisClient, cfg.TenantChatPrivate.WorkloadJTIPrefix)
		if err != nil {
			log.Fatalf("gateway-core tenant chat jti guard failed: %v", err)
		}
		tenantChatAuthenticator := requestauth.New(workloadVerifier, jtiConsumer)
		tenantChatAdmissions := admissionservice.New(
			postgrestentantruntime.NewReader(postgresPool),
			postgresadmission.NewStore(postgresPool),
		)
		tenantChatPrivateRouter := tenantchathttp.NewRouter(
			tenantChatAuthenticator,
			tenantChatAdmissions,
			cfg.MaxRequestBodyBytes,
		)
		tenantChatPrivateServer = app.NewServerAtAddress(
			cfg.TenantChatPrivate.ListenAddress,
			tenantChatPrivateRouter,
		)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("gateway-core listening on :%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("gateway-core server failed: %v", err)
		}
	}()
	if tenantChatPrivateServer != nil {
		go func() {
			log.Printf("gateway-core tenant chat private listener enabled")
			if err := tenantChatPrivateServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatalf("gateway-core tenant chat private server failed: %v", err)
			}
		}()
	}

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("gateway-core shutdown failed: %v", err)
	}
	if tenantChatPrivateServer != nil {
		if err := tenantChatPrivateServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("gateway-core tenant chat private shutdown failed: %v", err)
		}
	}
	if asyncTerminalLogWriter != nil {
		logCloseCtx, logCloseCancel := context.WithTimeout(context.Background(), cfg.AsyncLogShutdownTimeout)
		defer logCloseCancel()
		if err := asyncTerminalLogWriter.Close(logCloseCtx); err != nil {
			log.Printf("gateway-core async terminal log flush failed: %v", err)
		}
	}
}

func newPostgresPool(ctx context.Context, rawURL string, tuning config.PostgresPoolConfig, applicationName string) (*pgxpool.Pool, error) {
	poolConfig, err := parsePostgresPoolConfig(rawURL, tuning, applicationName)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, poolConfig)
}

func parsePostgresPoolConfig(rawURL string, tuning config.PostgresPoolConfig, applicationName string) (*pgxpool.Config, error) {
	poolConfig, err := pgxpool.ParseConfig(config.DatabaseDriverURL(rawURL))
	if err != nil {
		return nil, errors.New("invalid PostgreSQL pool connection configuration")
	}
	poolConfig.MaxConns = int32(tuning.MaxConns)
	poolConfig.MinConns = int32(tuning.MinConns)
	poolConfig.MaxConnLifetime = tuning.MaxConnLifetime
	poolConfig.MaxConnLifetimeJitter = tuning.MaxConnLifetime / 10
	poolConfig.MaxConnIdleTime = tuning.MaxConnIdleTime
	poolConfig.HealthCheckPeriod = tuning.HealthCheckPeriod
	poolConfig.ConnConfig.RuntimeParams["application_name"] = strings.TrimSpace(applicationName)
	return poolConfig, nil
}

func buildProviderCredentialResolver(cfg config.Config, postgresPool *pgxpool.Pool) (credentials.Resolver, error) {
	envResolver := credentialenvmap.NewResolver(credentialenvmap.ParseBindings(cfg.ProviderCredentialEnvMap))
	if strings.TrimSpace(cfg.ProviderCredentialEncryptionKey) == "" {
		return envResolver, nil
	}

	dbResolver, err := credentialpostgres.NewResolver(postgresPool, credentialpostgres.Config{
		EncryptionKey:        cfg.ProviderCredentialEncryptionKey,
		EncryptionKeyVersion: cfg.ProviderCredentialEncryptionKeyVersion,
	})
	if err != nil {
		return nil, err
	}
	return credentialcomposite.NewResolver(dbResolver, envResolver), nil
}

func buildRuntimePolicySources(cfg config.Config) (runtimeconfig.SnapshotProvider, providercatalog.Resolver) {
	if strings.TrimSpace(cfg.ControlPlaneBaseURL) != "" {
		client := &http.Client{Timeout: cfg.ControlPlaneTimeout}
		var snapshotProvider runtimeconfig.SnapshotProvider = controlplaneruntimeconfig.NewProvider(
			cfg.ControlPlaneBaseURL,
			client,
			cfg.ControlPlaneInternalToken,
		)
		if cfg.RuntimeSnapshotCache.Enabled {
			snapshotProvider = cachedruntimeconfig.NewProvider(snapshotProvider, cachedruntimeconfig.Config{
				FreshTTL: cfg.RuntimeSnapshotCache.TTL,
				StaleTTL: cfg.RuntimeSnapshotCache.StaleTTL,
			})
		}
		var catalogResolver providercatalog.Resolver = controlplaneprovidercatalog.NewResolver(
			cfg.ControlPlaneBaseURL,
			client,
			cfg.ControlPlaneInternalToken,
		)
		if cfg.ProviderCatalogCache.Enabled {
			catalogResolver = cachedprovidercatalog.NewResolver(catalogResolver, cachedprovidercatalog.Config{
				FreshTTL: cfg.ProviderCatalogCache.TTL,
				StaleTTL: cfg.ProviderCatalogCache.StaleTTL,
			})
		}
		return snapshotProvider, catalogResolver
	}

	return staticruntimeconfig.NewProvider(buildStaticRuntimeConfig(cfg)),
		staticprovidercatalog.NewResolver(buildStaticProviderCatalog(cfg))
}

func buildRateLimiter(cfg config.Config, postgresPool *pgxpool.Pool, redisClient redisratelimit.Client) (ratelimit.Limiter, error) {
	backend := strings.TrimSpace(strings.ToLower(cfg.RateLimitBackend))
	if backend == "" {
		backend = config.RateLimitBackendRedis
	}

	switch backend {
	case config.RateLimitBackendPostgres:
		return postgresratelimit.NewLimiter(postgresPool), nil
	case config.RateLimitBackendRedis:
		if redisClient == nil {
			return nil, fmt.Errorf("redis rate limit backend requires redis client")
		}
		return redisratelimit.NewLimiterWithKeyPrefix(redisClient, cfg.RateLimitRedisKeyPrefix), nil
	default:
		return nil, fmt.Errorf("unsupported rate limit backend %q", cfg.RateLimitBackend)
	}
}

func buildRateLimitStageConfig(cfg config.Config) ratelimit.Config {
	algorithm := strings.TrimSpace(strings.ToLower(cfg.RateLimitAlgorithm))
	if algorithm == "" {
		if strings.EqualFold(strings.TrimSpace(cfg.RateLimitBackend), config.RateLimitBackendPostgres) {
			algorithm = ratelimit.AlgorithmFixedWindow
		} else {
			algorithm = ratelimit.AlgorithmTokenBucket
		}
	}
	return ratelimit.Config{
		Enabled:       cfg.RateLimitEnabled,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     algorithm,
		WindowSeconds: cfg.RateLimitWindowSecs,
		Limit:         cfg.RateLimitLimit,
	}
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
			Algorithm:     buildRateLimitStageConfig(cfg).Algorithm,
			WindowSeconds: cfg.RateLimitWindowSecs,
			Limit:         cfg.RateLimitLimit,
		},
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: cfg.SecurityPolicyHash,
		},
		RoutingPolicy: runtimeconfig.BootstrapRoutingPolicy(cfg.RoutingPolicyHash),
		CachePolicy: runtimeconfig.CachePolicy{
			Enabled:         true,
			Type:            runtimeconfig.CacheTypeExact,
			TTLSeconds:      int(cfg.ExactCacheTTL.Seconds()),
			CachePolicyHash: cfg.CachePolicyHash,
		},
		PromptCapture: runtimeconfig.PromptCapturePolicy{
			Enabled:  cfg.PromptCaptureEnabled,
			Mode:     staticPromptCaptureMode(cfg.PromptCaptureEnabled),
			MaxChars: cfg.PromptCaptureMaxChars,
		},
		ResponseCapture: runtimeconfig.ResponseCapturePolicy{
			Enabled:  cfg.ResponseCaptureEnabled,
			Mode:     staticResponseCaptureMode(cfg.ResponseCaptureEnabled),
			MaxChars: cfg.ResponseCaptureMaxChars,
		},
	}
}

func staticPromptCaptureMode(enabled bool) string {
	if enabled {
		return runtimeconfig.PromptCaptureModeLogSafeFull
	}
	return runtimeconfig.PromptCaptureModeDisabled
}

func staticResponseCaptureMode(enabled bool) string {
	if enabled {
		return runtimeconfig.ResponseCaptureModeRawFull
	}
	return runtimeconfig.ResponseCaptureModeDisabled
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
				Models:           buildOpenAIStaticCatalogModels(cfg),
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
				Models:           []providercatalog.Model{mockBootstrapCatalogModel(cfg.MockProviderID)},
			},
		},
	}
}

func buildOpenAIStaticCatalogModels(cfg config.Config) []providercatalog.Model {
	models := []providercatalog.Model{
		{
			ModelID:     staticModelRef(cfg.OpenAIProviderID, cfg.OpenAILowCostModelName),
			ModelRef:    staticModelRef(cfg.OpenAIProviderID, cfg.OpenAILowCostModelName),
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
			ModelID:     staticModelRef(cfg.OpenAIProviderID, cfg.OpenAIBalancedModelName),
			ModelRef:    staticModelRef(cfg.OpenAIProviderID, cfg.OpenAIBalancedModelName),
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
	}
	seen := map[string]struct{}{}
	for _, model := range models {
		seen[strings.TrimSpace(model.ModelName)] = struct{}{}
		seen[strings.TrimSpace(model.ModelID)] = struct{}{}
	}
	for _, modelName := range cfg.OpenAIExtraModelNames {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			continue
		}
		if _, ok := seen[modelName]; ok {
			continue
		}
		modelID := strings.TrimSpace(cfg.OpenAIProviderID) + ":" + modelName
		models = append(models, providercatalog.Model{
			ModelID:     modelID,
			ModelRef:    modelID,
			ModelName:   modelName,
			DisplayName: openAIModelDisplayName(modelName),
			Enabled:     true,
			Capabilities: providercatalog.ModelCapabilities{
				StreamingSupported: true,
				SupportsJSONMode:   true,
				MaxInputTokens:     128000,
				MaxOutputTokens:    4096,
			},
			Routing: providercatalog.ModelRouting{
				AutoRoutingEligible: false,
				CostTier:            "premium",
				FallbackPriority:    5,
			},
		})
		seen[modelName] = struct{}{}
		seen[modelID] = struct{}{}
	}
	return models
}

func openAIModelDisplayName(modelName string) string {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return "OpenAI Model"
	}
	return "OpenAI " + modelName
}

func staticModelRef(providerID string, modelID string) string {
	return strings.TrimSpace(providerID) + ":" + strings.TrimSpace(modelID)
}

func mockBootstrapCatalogModel(providerID string) providercatalog.Model {
	return providercatalog.Model{
		ModelID:     staticModelRef(providerID, routingdomain.MockBootstrapRef),
		ModelRef:    routingdomain.MockBootstrapRef,
		ModelName:   routingdomain.MockBootstrapRef,
		DisplayName: "Mock Bootstrap Model",
		Enabled:     true,
		Capabilities: providercatalog.ModelCapabilities{
			StreamingSupported: true,
			SupportsJSONMode:   false,
			MaxInputTokens:     4096,
			MaxOutputTokens:    1024,
		},
		Routing: providercatalog.ModelRouting{
			AutoRoutingEligible: false,
			CostTier:            "balanced",
			FallbackPriority:    0,
		},
	}
}
