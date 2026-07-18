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
	embeddingopenai "gatelm/apps/gateway-core/internal/adapters/embeddings/openai"
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
	ragworkloadauth "gatelm/apps/gateway-core/internal/adapters/rag/workloadauth"
	postgresratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/postgres"
	redisratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/redis"
	"gatelm/apps/gateway-core/internal/adapters/routing/e5onnx"
	cachedruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/cached"
	controlplaneruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/controlplane"
	staticruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/static"
	aiservice "gatelm/apps/gateway-core/internal/adapters/safety/aiservice"
	postgresadmission "gatelm/apps/gateway-core/internal/adapters/tenantchat/admission/postgres"
	redistenantcache "gatelm/apps/gateway-core/internal/adapters/tenantchat/cache/redis"
	postgrestenantprovider "gatelm/apps/gateway-core/internal/adapters/tenantchat/provider/postgres"
	redistenantratelimit "gatelm/apps/gateway-core/internal/adapters/tenantchat/ratelimit/redis"
	postgrestentantruntime "gatelm/apps/gateway-core/internal/adapters/tenantchat/runtime/postgres"
	postgrestenantusage "gatelm/apps/gateway-core/internal/adapters/tenantchat/usage/postgres"
	"gatelm/apps/gateway-core/internal/adapters/tenantchat/usagereceipt"
	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/app"
	"gatelm/apps/gateway-core/internal/config"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/costing"
	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/handlers"
	raghttp "gatelm/apps/gateway-core/internal/http/rag"
	tenantchathttp "gatelm/apps/gateway-core/internal/http/tenantchat"
	"gatelm/apps/gateway-core/internal/pipeline"
	budgetstage "gatelm/apps/gateway-core/internal/pipeline/stages/budget"
	employeepolicystage "gatelm/apps/gateway-core/internal/pipeline/stages/employeepolicy"
	ratelimitstage "gatelm/apps/gateway-core/internal/pipeline/stages/ratelimit"
	runtimeconfigstage "gatelm/apps/gateway-core/internal/pipeline/stages/runtimeconfig"
	projectemployeecost "gatelm/apps/gateway-core/internal/services/projectapplication/employeecost"
	ragembeddingservice "gatelm/apps/gateway-core/internal/services/rag/embedding"
	admissionservice "gatelm/apps/gateway-core/internal/services/tenantchat/admission"
	completionservice "gatelm/apps/gateway-core/internal/services/tenantchat/completion"
	"gatelm/apps/gateway-core/internal/services/tenantchat/reconciliation"
	"gatelm/apps/gateway-core/internal/services/tenantchat/requestauth"
	tenantsafety "gatelm/apps/gateway-core/internal/services/tenantchat/safety"
	sanitizationservice "gatelm/apps/gateway-core/internal/services/tenantchat/sanitization"

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
	metricsRegistry := metrics.NewRegistry()
	difficultyE5InitCtx, difficultyE5InitCancel := context.WithTimeout(context.Background(), difficultyE5StartupSmokeTimeout)
	difficultyE5Runtime, difficultyE5RuntimeStatus := initializeDifficultyE5Runtime(
		difficultyE5InitCtx,
		cfg.DifficultyE5Runtime,
		e5onnx.NewEncoder,
	)
	difficultyE5ShadowRunner, difficultyE5ShadowStatus := initializeDifficultyE5ShadowRunner(
		difficultyE5InitCtx,
		cfg.DifficultyE5Shadow,
		e5onnx.NewEncoder,
		routingdomain.DifficultySemanticShadowObserverFunc(func(observation routingdomain.DifficultySemanticShadowObservation) {
			metricsRegistry.RoutingDifficultyShadow(metrics.RoutingDifficultyShadow{
				Status:          observation.Status,
				Category:        observation.Category,
				Comparison:      observation.Comparison,
				DurationSeconds: observation.Duration.Seconds(),
			})
		}),
	)
	difficultyE5InitCancel()
	if difficultyE5RuntimeStatus == DifficultyE5HotPathRuntimeUnavailable {
		log.Printf("gateway-core difficulty E5 hot-path runtime unavailable; auto routing falls back to rule difficulty")
	}
	if difficultyE5Runtime != nil {
		log.Printf("gateway-core difficulty E5 hot-path runtime initialized; 106D model difficulty is authoritative for eligible auto routes")
	}
	if difficultyE5ShadowStatus == DifficultyE5ShadowRuntimeUnavailable {
		log.Printf("gateway-core difficulty E5 shadow unavailable; product routing unchanged")
	}
	if difficultyE5ShadowRunner != nil {
		log.Printf("gateway-core difficulty E5 shadow initialized; product routing unchanged")
	}

	providerHTTPClient := providerhttpclient.New(providerhttpclient.Config{
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
	if cfg.AISafetySidecar.Enabled {
		readinessChecks["ai_safety_sidecar"] = handlers.ReadinessCheck{
			Required:       false,
			FailureMessage: "not ready",
			Check: handlers.HTTPReadinessCheck(
				&http.Client{Timeout: cfg.AISafetySidecar.Timeout},
				cfg.AISafetySidecar.EndpointURL,
			),
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
	projectEmployeeCosts := projectemployeecost.NewService(postgresPool, pricingCatalog)
	routerOptions := []app.RouterOption{
		app.WithAuthFailureLogWriter(authFailureLogWriter),
		app.WithTerminalLogWriter(terminalLogWriter),
		app.WithInvocationLogReader(invocationLogReader),
		app.WithCostCalculator(costCalculator),
		app.WithProjectEmployeeCostAccounting(projectEmployeeCosts),
		app.WithMetrics(metricsRegistry),
		app.WithExactCache(
			rediscache.NewStore(redisClient, cfg.ExactCacheTTL),
			cachekey.NewExactKeyBuilder([]byte(cfg.ExactCacheKeySecret)),
		),
		app.WithProviderExecution(providerCatalogResolver, credentialResolver),
	}
	if difficultyE5ShadowRunner != nil {
		routerOptions = append(routerOptions, app.WithDifficultySemanticShadow(difficultyE5ShadowRunner))
	}
	if difficultyE5Runtime != nil {
		routerOptions = append(routerOptions, app.WithDifficultySemanticRuntime(difficultyE5Runtime))
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
	var tenantChatReconciliationWorker *reconciliation.Worker
	if cfg.TenantChatPrivate.Enabled {
		tenantChatCacheKeySets, err := redistenantcache.LoadKeySets(cfg.TenantChatPrivate.CacheKeySetsFile)
		if err != nil {
			log.Fatalf("gateway-core tenant chat cache key sets failed: %v", err)
		}
		tenantChatReceiptToken, err := usagereceipt.LoadToken(cfg.TenantChatPrivate.UsageReceiptTokenFile)
		if err != nil {
			log.Fatalf("gateway-core tenant chat usage receipt token failed: %v", err)
		}
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
		tenantChatRuntime := postgrestentantruntime.NewReader(postgresPool)
		tenantChatUsage := postgrestenantusage.NewReservationStore(postgresPool).WithMetrics(metricsRegistry)
		tenantChatReconciliationWorker = reconciliation.NewWorker(tenantChatUsage).WithMetrics(metricsRegistry)
		tenantChatAdmissions := admissionservice.New(
			tenantChatRuntime,
			postgresadmission.NewStore(postgresPool),
		)
		var tenantChatMaskingEngine tenantsafety.MaskingEngine = tenantChatLocalMaskingEngine(
			cfg.AISafetySidecar.PersonNameModelOnly,
		)
		if cfg.AISafetySidecar.Enabled {
			tenantChatMaskingEngine = aiservice.NewMaskingEngine(aiservice.MaskingEngineConfig{
				Local:         tenantChatMaskingEngine,
				FallbackLocal: tenantChatFallbackMaskingEngine(cfg.AISafetySidecar.PersonNameModelOnly),
				EndpointURL:   cfg.AISafetySidecar.EndpointURL,
				Timeout:       cfg.AISafetySidecar.Timeout,
				ModelID:       cfg.AISafetySidecar.ModelID,
				DetectorSet:   cfg.AISafetySidecar.DetectorSet,
				Locale:        cfg.AISafetySidecar.Locale,
				Mode:          cfg.AISafetySidecar.Mode,
				Surface:       "tenant_chat",
				Metrics:       metricsRegistry,
			})
		}
		tenantChatSafety := tenantsafety.NewEvaluatorWithEngine(tenantChatMaskingEngine)
		tenantChatCompletions := completionservice.New(
			tenantChatRuntime,
			tenantChatUsage,
			postgrestenantprovider.NewExecutor(postgresPool, providers, credentialResolver),
			completionservice.WithSafetyEvaluator(tenantChatSafety),
			completionservice.WithDifficultySemanticRuntime(difficultyE5Runtime),
			completionservice.WithExactCache(redistenantcache.NewStore(redisClient, tenantChatCacheKeySets)),
			completionservice.WithProviderTokenLimiter(redistenantratelimit.NewLimiter(redisClient)),
			completionservice.WithMetrics(metricsRegistry),
		)
		tenantChatSanitizations := sanitizationservice.New(
			tenantChatRuntime,
			tenantChatAdmissions,
			tenantChatSafety,
			tenantChatUsage,
		)
		tenantChatPrivateRouter := tenantchathttp.NewRouter(
			tenantChatAuthenticator,
			tenantChatAdmissions,
			cfg.MaxRequestBodyBytes,
			tenantchathttp.WithCompletionService(tenantChatCompletions),
			tenantchathttp.WithSanitizationService(tenantChatSanitizations),
			tenantchathttp.WithUsageReceipts(tenantChatReceiptToken, tenantChatUsage),
		)
		privateRouter := http.NewServeMux()
		privateRouter.Handle("/internal/v1/tenant-chat/", tenantChatPrivateRouter)
		if cfg.RAGEmbedding.Enabled {
			ragWorkloadVerifier, err := ragworkloadauth.Load(
				cfg.RAGEmbedding.WorkloadJWKSFile,
				cfg.RAGEmbedding.BindingHMACKeysFile,
				cfg.RAGEmbedding.WorkloadIdentitiesFile,
			)
			if err != nil {
				log.Fatalf("gateway-core rag embedding workload verifier failed: %v", err)
			}
			ragJTIConsumer, err := ragworkloadauth.NewRedisJTIConsumer(
				redisClient,
				cfg.RAGEmbedding.WorkloadJTIPrefix,
			)
			if err != nil {
				log.Fatalf("gateway-core rag embedding jti guard failed: %v", err)
			}
			ragHTTPClient := providerhttpclient.New(providerhttpclient.Config{
				MaxIdleConns:          cfg.ProviderTransport.MaxIdleConns,
				MaxIdleConnsPerHost:   cfg.ProviderTransport.MaxIdleConnsPerHost,
				MaxConnsPerHost:       cfg.ProviderTransport.MaxConnsPerHost,
				IdleConnTimeout:       cfg.ProviderTransport.IdleConnTimeout,
				DialTimeout:           cfg.ProviderTransport.DialTimeout,
				DialKeepAlive:         cfg.ProviderTransport.DialKeepAlive,
				TLSHandshakeTimeout:   cfg.ProviderTransport.TLSHandshakeTimeout,
				ResponseHeaderTimeout: cfg.RAGEmbedding.AttemptTimeout,
				ExpectContinueTimeout: cfg.ProviderTransport.ExpectContinueTimeout,
			})
			defer ragHTTPClient.CloseIdleConnections()
			ragProvider, err := embeddingopenai.NewResolvingProvider(
				credentialResolver,
				credentials.Ref{
					CredentialRefID:   cfg.RAGEmbedding.CredentialRefID,
					CredentialVersion: 1,
					CredentialState:   credentials.StateActive,
				},
				embeddingopenai.Config{
					BaseURL:          cfg.RAGEmbedding.OpenAIBaseURL,
					Model:            cfg.RAGEmbedding.Model,
					Dimensions:       cfg.RAGEmbedding.Dimensions,
					Timeout:          cfg.RAGEmbedding.AttemptTimeout,
					MaxAttempts:      cfg.RAGEmbedding.MaxAttempts,
					MaxResponseBytes: cfg.RAGEmbedding.MaxResponseBytes,
					MaxInputs:        cfg.RAGEmbedding.MaxInputs,
					HTTPClient:       ragHTTPClient,
				},
			)
			if err != nil {
				log.Fatalf("gateway-core rag embedding provider configuration failed")
			}
			ragEmbeddingService, err := ragembeddingservice.New(ragProvider, ragembeddingservice.Config{
				Provider:          cfg.RAGEmbedding.Provider,
				Model:             cfg.RAGEmbedding.Model,
				Dimensions:        cfg.RAGEmbedding.Dimensions,
				ProfileVersion:    cfg.RAGEmbedding.ProfileVersion,
				MaxInputs:         cfg.RAGEmbedding.MaxInputs,
				MaxTokensPerInput: cfg.RAGEmbedding.MaxTokensPerInput,
				MaxBatchTokens:    cfg.RAGEmbedding.MaxBatchTokens,
			})
			if err != nil {
				log.Fatalf("gateway-core rag embedding service configuration failed")
			}
			privateRouter.Handle(
				"/internal/v1/rag/",
				raghttp.NewRouter(
					ragworkloadauth.NewAuthenticator(ragWorkloadVerifier, ragJTIConsumer),
					ragEmbeddingService,
					cfg.MaxRequestBodyBytes,
					raghttp.WithMetrics(metricsRegistry),
				),
			)
		}
		tenantChatPrivateServer = app.NewServerAtAddress(
			cfg.TenantChatPrivate.ListenAddress,
			privateRouter,
		)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if tenantChatReconciliationWorker != nil {
		go tenantChatReconciliationWorker.Run(ctx)
	}
	go projectEmployeeCosts.RunReconciliation(ctx)

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
	if difficultyE5ShadowRunner != nil {
		shadowCloseCtx, shadowCloseCancel := context.WithTimeout(context.Background(), time.Second)
		if err := difficultyE5ShadowRunner.Close(shadowCloseCtx); err != nil {
			log.Printf("gateway-core difficulty E5 shadow shutdown incomplete; product routing unchanged")
		}
		shadowCloseCancel()
	}
	if difficultyE5Runtime != nil {
		runtimeCloseCtx, runtimeCloseCancel := context.WithTimeout(context.Background(), time.Second)
		if err := difficultyE5Runtime.Close(runtimeCloseCtx); err != nil {
			log.Printf("gateway-core difficulty E5 hot-path runtime shutdown incomplete")
		}
		runtimeCloseCancel()
	}
	if asyncTerminalLogWriter != nil {
		logCloseCtx, logCloseCancel := context.WithTimeout(context.Background(), cfg.AsyncLogShutdownTimeout)
		defer logCloseCancel()
		if err := asyncTerminalLogWriter.Close(logCloseCtx); err != nil {
			log.Printf("gateway-core async terminal log flush failed: %v", err)
		}
	}
}

const (
	difficultyE5StartupSmokeInstruction = "explain one bounded workflow step."
	difficultyE5StartupSmokeTimeout     = 60 * time.Second
)

const (
	DifficultyE5ShadowRuntimeDisabled    = "disabled"
	DifficultyE5ShadowRuntimeReady       = "ready"
	DifficultyE5ShadowRuntimeUnavailable = "unavailable"
)

const (
	DifficultyE5HotPathRuntimeDisabled    = "disabled"
	DifficultyE5HotPathRuntimeReady       = "ready"
	DifficultyE5HotPathRuntimeUnavailable = "unavailable"
)

type difficultyE5EncoderFactory func(e5onnx.BundleConfig) (routingdomain.DifficultySemanticPooledEncoder, error)
type difficultyE5ModelCompatibility func() bool

func initializeDifficultyE5Runtime(
	ctx context.Context,
	cfg config.DifficultyE5RuntimeConfig,
	factory difficultyE5EncoderFactory,
) (*routingdomain.DifficultySemanticRuntime, string) {
	if !cfg.Enabled {
		return nil, DifficultyE5HotPathRuntimeDisabled
	}
	if !routingdomain.DifficultySemanticShadowModelCompatible() || factory == nil {
		return nil, DifficultyE5HotPathRuntimeUnavailable
	}
	evaluator, err := initializeDifficultyE5Evaluator(
		ctx,
		cfg.ArtifactRoot,
		cfg.EncoderManifestPath,
		cfg.RuntimeLockPath,
		factory,
	)
	if err != nil {
		return nil, DifficultyE5HotPathRuntimeUnavailable
	}
	return routingdomain.NewDifficultySemanticRuntime(evaluator, cfg.Timeout), DifficultyE5HotPathRuntimeReady
}

func initializeDifficultyE5ShadowRunner(
	ctx context.Context,
	cfg config.DifficultyE5ShadowConfig,
	factory difficultyE5EncoderFactory,
	observer routingdomain.DifficultySemanticShadowObserver,
) (*routingdomain.DifficultySemanticShadowRunner, string) {
	evaluator, err := initializeDifficultyE5Shadow(ctx, cfg, factory)
	if err != nil {
		return nil, DifficultyE5ShadowRuntimeUnavailable
	}
	if evaluator == nil {
		return nil, DifficultyE5ShadowRuntimeDisabled
	}
	return routingdomain.NewDifficultySemanticShadowRunner(evaluator, cfg.Timeout, observer), DifficultyE5ShadowRuntimeReady
}

func initializeDifficultyE5Shadow(
	ctx context.Context,
	cfg config.DifficultyE5ShadowConfig,
	factory difficultyE5EncoderFactory,
) (*routingdomain.DifficultySemanticShadowEvaluator, error) {
	return initializeDifficultyE5ShadowWithCompatibility(
		ctx,
		cfg,
		factory,
		routingdomain.DifficultySemanticShadowModelCompatible,
	)
}

func initializeDifficultyE5ShadowWithCompatibility(
	ctx context.Context,
	cfg config.DifficultyE5ShadowConfig,
	factory difficultyE5EncoderFactory,
	compatible difficultyE5ModelCompatibility,
) (*routingdomain.DifficultySemanticShadowEvaluator, error) {
	if !cfg.HasAllowedScopes() {
		return nil, nil
	}
	if compatible == nil ||
		(!compatible() && !routingdomain.DifficultySemanticShadowBaselineWaiverAccepted(cfg.BaselineWaiver)) {
		return nil, errors.New("unavailable")
	}
	if factory == nil {
		return nil, errors.New("unavailable")
	}
	return initializeDifficultyE5Evaluator(
		ctx,
		cfg.ArtifactRoot,
		cfg.EncoderManifestPath,
		cfg.RuntimeLockPath,
		factory,
	)
}

func initializeDifficultyE5Evaluator(
	ctx context.Context,
	artifactRoot string,
	encoderManifestPath string,
	runtimeLockPath string,
	factory difficultyE5EncoderFactory,
) (*routingdomain.DifficultySemanticShadowEvaluator, error) {
	encoder, err := factory(e5onnx.BundleConfig{
		ArtifactRoot:        artifactRoot,
		EncoderManifestPath: encoderManifestPath,
		RuntimeLockPath:     runtimeLockPath,
	})
	if err != nil {
		return nil, errors.New("unavailable")
	}
	evaluator := routingdomain.NewDifficultySemanticShadowEvaluator(encoder)
	features := routingdomain.ExtractPromptFeatures(difficultyE5StartupSmokeInstruction)
	category := routingdomain.NewRuleBasedCategoryClassifier().ClassifyFeatures(features).Category
	result := evaluator.Evaluate(ctx, features, category)
	if result.Status != routingdomain.DifficultySemanticShadowReady {
		_ = evaluator.Close()
		return nil, fmt.Errorf("startup_smoke_%s", result.Status)
	}
	return evaluator, nil
}

func newPostgresPool(ctx context.Context, rawURL string, tuning config.PostgresPoolConfig, applicationName string) (*pgxpool.Pool, error) {
	poolConfig, err := parsePostgresPoolConfig(rawURL, tuning, applicationName)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, poolConfig)
}

func parsePostgresPoolConfig(rawURL string, tuning config.PostgresPoolConfig, applicationName string) (*pgxpool.Config, error) {
	if tuning.MaxConns <= 0 || tuning.MaxConns > 1000 {
		return nil, errors.New("invalid PostgreSQL pool maximum connections")
	}
	if tuning.MinConns < 0 || tuning.MinConns > 1000 || tuning.MinConns > tuning.MaxConns {
		return nil, errors.New("invalid PostgreSQL pool minimum connections")
	}

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

func tenantChatLocalMaskingEngine(personNameModelOnly bool) maskdomain.Engine {
	if personNameModelOnly {
		return maskdomain.NewP0EngineWithoutPersonName()
	}
	return maskdomain.NewP0Engine()
}

func tenantChatFallbackMaskingEngine(personNameModelOnly bool) aiservice.LocalMaskingEngine {
	if !personNameModelOnly {
		return nil
	}
	return maskdomain.NewP0Engine()
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
