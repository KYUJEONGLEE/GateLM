package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	postgresratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/postgres"
	redisratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/redis"
	"gatelm/apps/gateway-core/internal/adapters/routing/e5onnx"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"

	goredis "github.com/redis/go-redis/v9"
)

type fakeDifficultyE5Encoder struct {
	instruction string
	closed      bool
}

func (encoder *fakeDifficultyE5Encoder) EncodePooled(
	_ context.Context,
	instruction string,
) (routing.DifficultySemanticPooled, error) {
	encoder.instruction = instruction
	var pooled routing.DifficultySemanticPooled
	for index := range pooled {
		pooled[index] = float32(index%17) / 17
	}
	return pooled, nil
}

func (encoder *fakeDifficultyE5Encoder) Close() error {
	encoder.closed = true
	return nil
}

func TestInitializeDifficultyE5RuntimeIsDisabledWithoutConstructingEncoder(t *testing.T) {
	called := false
	runtime, status := initializeDifficultyE5Runtime(
		context.Background(),
		config.DifficultyE5RuntimeConfig{},
		func(e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			called = true
			return nil, errors.New("must not be called")
		},
	)
	if runtime != nil || status != DifficultyE5HotPathRuntimeDisabled || called {
		t.Fatalf("disabled runtime initialized: runtime=%v status=%q called=%v", runtime, status, called)
	}
}

func TestInitializeDifficultyE5RuntimeDegradesInitializationFailureToRuleOnly(t *testing.T) {
	runtime, status := initializeDifficultyE5Runtime(
		context.Background(),
		config.DifficultyE5RuntimeConfig{Enabled: true, Timeout: 10 * time.Millisecond},
		func(e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			return nil, errors.New("sensitive initialization detail")
		},
	)
	if runtime != nil || status != DifficultyE5HotPathRuntimeUnavailable {
		t.Fatalf("initialization failure did not degrade safely: runtime=%v status=%q", runtime, status)
	}
}

func TestInitializeDifficultyE5RuntimeRunsSmokeAndBecomesReady(t *testing.T) {
	encoder := &fakeDifficultyE5Encoder{}
	runtime, status := initializeDifficultyE5Runtime(
		context.Background(),
		config.DifficultyE5RuntimeConfig{
			Enabled:             true,
			ArtifactRoot:        "/bundle",
			EncoderManifestPath: "/bundle/manifest.json",
			RuntimeLockPath:     "/bundle/lock.json",
			Timeout:             50 * time.Millisecond,
		},
		func(bundle e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			if bundle.ArtifactRoot != "/bundle" ||
				bundle.EncoderManifestPath != "/bundle/manifest.json" ||
				bundle.RuntimeLockPath != "/bundle/lock.json" {
				t.Fatalf("unexpected bundle config: %#v", bundle)
			}
			return encoder, nil
		},
	)
	if runtime == nil || status != DifficultyE5HotPathRuntimeReady {
		t.Fatalf("runtime not ready: runtime=%v status=%q", runtime, status)
	}
	if encoder.instruction != difficultyE5StartupSmokeInstruction {
		t.Fatalf("startup smoke input = %q", encoder.instruction)
	}
	if err := runtime.Close(context.Background()); err != nil || !encoder.closed {
		t.Fatalf("close failed: closed=%v err=%v", encoder.closed, err)
	}
}

func TestInitializeDifficultyE5ShadowIsDisabledWithoutConstructingEncoder(t *testing.T) {
	called := false
	evaluator, err := initializeDifficultyE5Shadow(
		context.Background(),
		config.DifficultyE5ShadowConfig{},
		func(e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			called = true
			return nil, errors.New("must not be called")
		},
	)
	if err != nil || evaluator != nil || called {
		t.Fatalf("disabled shadow initialized: evaluator=%v called=%v err=%v", evaluator, called, err)
	}
}

func TestInitializeDifficultyE5ShadowIsDisabledWithoutAllowedScope(t *testing.T) {
	called := false
	evaluator, err := initializeDifficultyE5Shadow(
		context.Background(),
		config.DifficultyE5ShadowConfig{Enabled: true},
		func(e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			called = true
			return nil, errors.New("must not be called")
		},
	)
	if err != nil || evaluator != nil || called {
		t.Fatalf("scope-less shadow initialized: evaluator=%v called=%v err=%v", evaluator, called, err)
	}
}

func TestInitializeDifficultyE5ShadowRunnerDoesNotConstructE5Encoder(t *testing.T) {
	called := false
	runner, status := initializeDifficultyE5ShadowRunner(
		context.Background(),
		config.DifficultyE5ShadowConfig{
			Enabled:       true,
			AllowedScopes: difficultyE5ShadowTestScopes(),
			Timeout:       10 * time.Millisecond,
		},
		func(e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			called = true
			return nil, errors.New("sensitive initialization detail")
		},
		nil,
	)
	if runner == nil || status != DifficultyE5ShadowRuntimeReady || called {
		t.Fatalf("B1 shadow initialization drifted: runner=%v status=%q called=%v", runner, status, called)
	}
	if err := runner.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestInitializeDifficultyE5ShadowAcceptsCurrentDecisionBoundary(t *testing.T) {
	called := false
	evaluator, err := initializeDifficultyE5Shadow(
		context.Background(),
		config.DifficultyE5ShadowConfig{
			Enabled:       true,
			AllowedScopes: difficultyE5ShadowTestScopes(),
		},
		func(e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			called = true
			return nil, errors.New("must not be called")
		},
	)
	if err != nil || evaluator == nil || called {
		t.Fatalf("current boundary not initialized: evaluator=%v called=%v err=%v", evaluator, called, err)
	}
	if err := evaluator.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestInitializeDifficultyE5ShadowIgnoresHistoricalWaiverForCompatibleModel(t *testing.T) {
	called := false
	evaluator, err := initializeDifficultyE5Shadow(
		context.Background(),
		config.DifficultyE5ShadowConfig{
			Enabled:        true,
			AllowedScopes:  difficultyE5ShadowTestScopes(),
			BaselineWaiver: routing.DifficultySemanticShadowBaselineE2EWaiverV3,
		},
		func(e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			called = true
			return nil, errors.New("must not be called")
		},
	)
	if err != nil || evaluator == nil || called {
		t.Fatalf("compatible model not admitted: evaluator=%v called=%v err=%v", evaluator, called, err)
	}
	if err := evaluator.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestInitializeDifficultyE5ShadowRuns42DBaselineSmokeWithoutEncoder(t *testing.T) {
	called := false
	evaluator, err := initializeDifficultyE5ShadowWithCompatibility(
		context.Background(),
		config.DifficultyE5ShadowConfig{
			Enabled:             true,
			AllowedScopes:       difficultyE5ShadowTestScopes(),
			ArtifactRoot:        "/bundle",
			EncoderManifestPath: "/bundle/manifest.json",
			RuntimeLockPath:     "/bundle/lock.json",
		},
		func(bundle e5onnx.BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
			called = true
			return nil, errors.New("must not be called")
		},
		func() bool { return true },
	)
	if err != nil {
		t.Fatal(err)
	}
	if evaluator == nil || called {
		t.Fatalf("42D B1 shadow unexpectedly constructed E5 encoder: called=%v", called)
	}
	if err := evaluator.Close(); err != nil {
		t.Fatalf("close failed: %v", err)
	}
}

func difficultyE5ShadowTestScopes() []config.DifficultyE5ShadowScope {
	return []config.DifficultyE5ShadowScope{{
		TenantID: "tenant_dev", ApplicationID: "application_dev",
	}}
}

func TestParsePostgresPoolConfigAppliesBoundsAndIdentity(t *testing.T) {
	tuning := config.PostgresPoolConfig{
		MaxConns:          16,
		MinConns:          2,
		MaxConnLifetime:   30 * time.Minute,
		MaxConnIdleTime:   5 * time.Minute,
		HealthCheckPeriod: time.Minute,
	}
	poolConfig, err := parsePostgresPoolConfig(
		"postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public",
		tuning,
		"gatelm-gateway-log",
	)
	if err != nil {
		t.Fatalf("parse pool config: %v", err)
	}

	if poolConfig.MaxConns != 16 || poolConfig.MinConns != 2 {
		t.Fatalf("unexpected connection bounds: max=%d min=%d", poolConfig.MaxConns, poolConfig.MinConns)
	}
	if poolConfig.MaxConnLifetime != 30*time.Minute || poolConfig.MaxConnLifetimeJitter != 3*time.Minute {
		t.Fatalf("unexpected connection lifetime: lifetime=%s jitter=%s", poolConfig.MaxConnLifetime, poolConfig.MaxConnLifetimeJitter)
	}
	if poolConfig.MaxConnIdleTime != 5*time.Minute || poolConfig.HealthCheckPeriod != time.Minute {
		t.Fatalf("unexpected idle health config: idle=%s health=%s", poolConfig.MaxConnIdleTime, poolConfig.HealthCheckPeriod)
	}
	if poolConfig.ConnConfig.RuntimeParams["application_name"] != "gatelm-gateway-log" {
		t.Fatalf("unexpected application name: %q", poolConfig.ConnConfig.RuntimeParams["application_name"])
	}
	if strings.Contains(poolConfig.ConnString(), "schema=") {
		t.Fatal("Prisma-only schema query parameter must not reach pgx")
	}
}

func TestParsePostgresPoolConfigRejectsUnsafeConnectionBounds(t *testing.T) {
	base := config.PostgresPoolConfig{
		MaxConns:          16,
		MinConns:          2,
		MaxConnLifetime:   30 * time.Minute,
		MaxConnIdleTime:   5 * time.Minute,
		HealthCheckPeriod: time.Minute,
	}
	tests := []struct {
		name   string
		tuning config.PostgresPoolConfig
	}{
		{name: "maximum is not positive", tuning: config.PostgresPoolConfig{MinConns: base.MinConns}},
		{name: "maximum exceeds supported bound", tuning: config.PostgresPoolConfig{MaxConns: 1001, MinConns: base.MinConns}},
		{name: "minimum is negative", tuning: config.PostgresPoolConfig{MaxConns: base.MaxConns, MinConns: -1}},
		{name: "minimum exceeds supported bound", tuning: config.PostgresPoolConfig{MaxConns: 1000, MinConns: 1001}},
		{name: "minimum exceeds maximum", tuning: config.PostgresPoolConfig{MaxConns: base.MaxConns, MinConns: 17}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tuning := base
			if tt.tuning.MaxConns != 0 {
				tuning.MaxConns = tt.tuning.MaxConns
			}
			if tt.name == "maximum is not positive" {
				tuning.MaxConns = 0
			}
			tuning.MinConns = tt.tuning.MinConns

			if _, err := parsePostgresPoolConfig(
				"postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public",
				tuning,
				"gatelm-gateway-log",
			); err == nil {
				t.Fatal("expected invalid connection bounds to be rejected")
			}
		})
	}
}

func TestIsStrictRuntimeSnapshotMode(t *testing.T) {
	tests := []struct {
		name string
		mode string
		want bool
	}{
		{name: "default demo mode", mode: "demo", want: false},
		{name: "empty mode", mode: "", want: false},
		{name: "strict mode", mode: "strict", want: true},
		{name: "strict snapshot alias", mode: "strict_snapshot", want: true},
		{name: "case and space tolerant", mode: " Strict ", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isStrictRuntimeSnapshotMode(config.Config{RuntimeSnapshotMode: tt.mode})
			if got != tt.want {
				t.Errorf("isStrictRuntimeSnapshotMode(%q) = %v, want %v", tt.mode, got, tt.want)
			}
		})
	}
}

func TestValidateRuntimeSnapshotMode(t *testing.T) {
	tests := []struct {
		name    string
		mode    string
		wantErr bool
	}{
		{name: "demo", mode: "demo", wantErr: false},
		{name: "empty", mode: "", wantErr: false},
		{name: "strict", mode: "strict", wantErr: false},
		{name: "strict snapshot alias", mode: "strict_snapshot", wantErr: false},
		{name: "case and space tolerant", mode: " Strict ", wantErr: false},
		{name: "typo", mode: "stric", wantErr: true},
		{name: "unknown", mode: "control_plane", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRuntimeSnapshotMode(config.Config{RuntimeSnapshotMode: tt.mode})
			if (err != nil) != tt.wantErr {
				t.Errorf("validateRuntimeSnapshotMode(%q) error = %v, wantErr %v", tt.mode, err, tt.wantErr)
			}
		})
	}
}

func TestBuildRateLimiterDefaultsToRedis(t *testing.T) {
	limiter, err := buildRateLimiter(config.Config{}, nil, fakeRedisClient{})
	if err != nil {
		t.Fatalf("expected redis limiter, got error %v", err)
	}
	if _, ok := limiter.(*redisratelimit.Limiter); !ok {
		t.Fatalf("expected redis limiter, got %T", limiter)
	}
}

func TestBuildRateLimiterUsesPostgresRollbackBackend(t *testing.T) {
	limiter, err := buildRateLimiter(config.Config{RateLimitBackend: " Postgres "}, nil, fakeRedisClient{})
	if err != nil {
		t.Fatalf("expected postgres limiter, got error %v", err)
	}
	if _, ok := limiter.(*postgresratelimit.Limiter); !ok {
		t.Fatalf("expected postgres limiter, got %T", limiter)
	}
}

func TestBuildRateLimiterUsesRedisBackend(t *testing.T) {
	limiter, err := buildRateLimiter(config.Config{RateLimitBackend: " Redis "}, nil, fakeRedisClient{})
	if err != nil {
		t.Fatalf("expected redis limiter, got error %v", err)
	}
	if _, ok := limiter.(*redisratelimit.Limiter); !ok {
		t.Fatalf("expected redis limiter, got %T", limiter)
	}
}

func TestBuildRateLimiterRequiresRedisClient(t *testing.T) {
	_, err := buildRateLimiter(config.Config{RateLimitBackend: "redis"}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "requires redis client") {
		t.Fatalf("expected redis client error, got %v", err)
	}
}

func TestBuildRateLimiterRejectsUnsupportedBackend(t *testing.T) {
	_, err := buildRateLimiter(config.Config{RateLimitBackend: "memory"}, nil, fakeRedisClient{})
	if err == nil || !strings.Contains(err.Error(), "unsupported rate limit backend") {
		t.Fatalf("expected unsupported backend error, got %v", err)
	}
}

func TestBuildRateLimitStageConfigDefaultsToTokenBucket(t *testing.T) {
	cfg := buildRateLimitStageConfig(config.Config{
		RateLimitEnabled:    true,
		RateLimitWindowSecs: 60,
		RateLimitLimit:      60,
	})

	if cfg.Algorithm != ratelimit.AlgorithmTokenBucket || cfg.Limit != 60 || cfg.WindowSeconds != 60 {
		t.Fatalf("unexpected rate limit stage config: %#v", cfg)
	}
}

func TestBuildOpenAIStaticCatalogModelsAddsManualExtraModels(t *testing.T) {
	models := buildOpenAIStaticCatalogModels(config.Config{
		OpenAIProviderID:        "provider_openai_main",
		OpenAILowCostModelID:    "openai-low-cost",
		OpenAILowCostModelName:  "gpt-4o-mini",
		OpenAIBalancedModelID:   "openai-balanced",
		OpenAIBalancedModelName: "gpt-4o",
		OpenAIExtraModelNames:   []string{"gpt-5.4-mini", "gpt-5.4", "gpt-4o"},
	})

	if len(models) != 4 {
		t.Fatalf("expected low, balanced, and two unique extra models, got %#v", models)
	}
	if models[0].ModelID != "provider_openai_main:gpt-4o-mini" || models[0].ModelRef != "provider_openai_main:gpt-4o-mini" || models[0].ModelName != "gpt-4o-mini" || !models[0].Routing.AutoRoutingEligible || models[0].Routing.CostTier != "low" {
		t.Fatalf("low-cost model routing changed: %#v", models[0])
	}
	if models[1].ModelID != "provider_openai_main:gpt-4o" || models[1].ModelRef != "provider_openai_main:gpt-4o" || models[1].ModelName != "gpt-4o" || !models[1].Routing.AutoRoutingEligible || models[1].Routing.CostTier != "balanced" {
		t.Fatalf("balanced model routing changed: %#v", models[1])
	}
	if models[2].ModelID != "provider_openai_main:gpt-5.4-mini" || models[2].ModelRef != "provider_openai_main:gpt-5.4-mini" || models[2].ModelName != "gpt-5.4-mini" {
		t.Fatalf("unexpected first extra model: %#v", models[2])
	}
	if models[2].Routing.AutoRoutingEligible {
		t.Fatalf("extra model should be manual/pinned only by default: %#v", models[2])
	}
	if !models[2].Capabilities.StreamingSupported || !models[2].Capabilities.SupportsJSONMode {
		t.Fatalf("extra OpenAI model capabilities were not set: %#v", models[2].Capabilities)
	}
}

func TestBuildStaticProviderCatalogUsesExplicitMockBootstrapOnly(t *testing.T) {
	catalog := buildStaticProviderCatalog(config.Config{
		ProviderCatalogID:      "catalog-test",
		ProviderCatalogVersion: 1,
		ProviderCatalogHash:    "sha256:catalog-test",
		OpenAIProviderID:       "provider-openai",
		OpenAIProviderName:     "openai",
		MockProviderID:         "provider-mock",
		MockProviderName:       "mock",
	})

	provider, model, err := catalog.ResolveModelRef(routing.MockBootstrapRef)
	if err != nil {
		t.Fatalf("resolve mock bootstrap: %v", err)
	}
	if provider.ProviderID != "provider-mock" || model.ModelID != "provider-mock:mock-balanced" || model.ModelRef != routing.MockBootstrapRef || model.ModelName != routing.MockBootstrapRef {
		t.Fatalf("unexpected explicit mock bootstrap target: provider=%#v model=%#v", provider, model)
	}
	if len(catalog.Providers[1].Models) != 1 {
		t.Fatalf("legacy tier model settings must not populate the mock catalog: %#v", catalog.Providers[1].Models)
	}
}

type fakeRedisClient struct{}

func (fakeRedisClient) Eval(context.Context, string, []string, ...any) *goredis.Cmd {
	return goredis.NewCmdResult(nil, nil)
}
