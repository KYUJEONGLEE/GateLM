package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	rediscache "gatelm/apps/gateway-core/internal/adapters/cache/redis"
	postgresinvocationlog "gatelm/apps/gateway-core/internal/adapters/invocationlog/postgres"
	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	postgresratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/postgres"
	"gatelm/apps/gateway-core/internal/app"
	"gatelm/apps/gateway-core/internal/config"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/http/handlers"
	"gatelm/apps/gateway-core/internal/pipeline"
	ratelimitstage "gatelm/apps/gateway-core/internal/pipeline/stages/ratelimit"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.Load()
	providerHTTPClient := &http.Client{Timeout: cfg.ProviderTimeout}
	mockAdapter := mock.NewAdapter(cfg.MockProviderBaseURL, providerHTTPClient)
	providers := provider.NewRegistry(cfg.DefaultProvider, mockAdapter)

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
	rateLimitPipeline := pipeline.New(ratelimitstage.NewStage(
		postgresratelimit.NewLimiter(postgresPool),
		ratelimit.Config{
			Enabled:       cfg.RateLimitEnabled,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: cfg.RateLimitWindowSecs,
			Limit:         cfg.RateLimitLimit,
		},
	))

	router := app.NewRouter(
		cfg,
		providers,
		readinessChecks,
		app.WithAuthFailureLogWriter(authFailureLogWriter),
		app.WithTerminalLogWriter(terminalLogWriter),
		app.WithInvocationLogReader(invocationLogReader),
		app.WithExactCache(
			rediscache.NewStore(redisClient, cfg.ExactCacheTTL),
			cachekey.NewExactKeyBuilder([]byte(cfg.ExactCacheKeySecret)),
		),
		app.WithRateLimitPipeline(rateLimitPipeline),
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

type invocationLogQueryer struct {
	pool *pgxpool.Pool
}

func (q invocationLogQueryer) Query(ctx context.Context, sql string, arguments ...any) (postgresinvocationlog.Rows, error) {
	return q.pool.Query(ctx, sql, arguments...)
}

func (q invocationLogQueryer) QueryRow(ctx context.Context, sql string, arguments ...any) postgresinvocationlog.Row {
	return q.pool.QueryRow(ctx, sql, arguments...)
}
