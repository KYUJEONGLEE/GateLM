package runtimeconfigstage

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/budget"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

func TestStageLoadsActiveRuntimeConfigIntoGatewayContext(t *testing.T) {
	// Given active runtime config provider가 있다
	provider := &fakeProvider{config: testActiveConfig()}
	stage := NewStage(provider)
	gatewayCtx := testGatewayContext()

	// When Gateway가 rate limit 전에 active runtime config를 로드한다
	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected runtime config load, got %v", err)
	}

	// Then runtime hash와 정책 config가 GatewayContext에 남는다
	if gatewayCtx.Runtime.ConfigHash != "hash_runtime_config_test" {
		t.Fatalf("unexpected config hash: %#v", gatewayCtx.Runtime)
	}
	if gatewayCtx.Runtime.SecurityPolicyHash != "hash_security_policy_test" ||
		gatewayCtx.Masking.SecurityPolicyVersionID != "hash_security_policy_test" {
		t.Fatalf("unexpected security policy hash: %#v %#v", gatewayCtx.Runtime, gatewayCtx.Masking)
	}
	if gatewayCtx.Runtime.RoutingPolicyHash != "hash_routing_policy_test" ||
		gatewayCtx.Routing.RoutingPolicyHash != "hash_routing_policy_test" {
		t.Fatalf("unexpected routing policy hash: %#v %#v", gatewayCtx.Runtime, gatewayCtx.Routing)
	}
	if gatewayCtx.Runtime.Snapshot.RuntimeSnapshotVersion != 1 ||
		gatewayCtx.Runtime.Snapshot.RuntimeState != runtimeconfig.RuntimeStateSnapshotActive ||
		gatewayCtx.Runtime.Snapshot.LegacyHashes.ConfigHash != "hash_runtime_config_test" {
		t.Fatalf("unexpected runtime snapshot provenance: %#v", gatewayCtx.Runtime.Snapshot)
	}
	if !gatewayCtx.Runtime.HasRateLimitConfig || gatewayCtx.Runtime.RateLimitConfig.Limit != 7 {
		t.Fatalf("expected runtime rate limit config, got %#v", gatewayCtx.Runtime)
	}
	if !gatewayCtx.Runtime.HasBudgetPolicy ||
		!gatewayCtx.Runtime.BudgetPolicy.Enabled ||
		gatewayCtx.Runtime.BudgetPolicy.EnforcementMode != "warn" ||
		gatewayCtx.Runtime.BudgetPolicy.WarningThresholdPercent != 70 {
		t.Fatalf("expected runtime budget policy, got %#v", gatewayCtx.Runtime)
	}
}

func TestStageFailsClosedWhenRuntimeConfigLoadFails(t *testing.T) {
	// Given active runtime config를 가져올 수 없다
	stage := NewStage(&fakeProvider{err: errors.New("runtime config unavailable")})
	gatewayCtx := testGatewayContext()

	// When stage가 실행된다
	err := stage.Execute(context.Background(), gatewayCtx)

	// Then provider/cache 전에 fail-closed terminal status를 만든다
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected gateway error, got %T %v", err, err)
	}
	if gatewayErr.Code != "internal_error" || gatewayErr.Stage != StageName {
		t.Fatalf("unexpected gateway error: %#v", gatewayErr)
	}
	if gatewayCtx.Status.Status != "failed" || gatewayCtx.Status.HTTPStatus != 500 {
		t.Fatalf("unexpected status: %#v", gatewayCtx.Status)
	}
	if gatewayCtx.Cache.CacheStatus != "bypass" || gatewayCtx.Cache.CacheType != "none" {
		t.Fatalf("runtime config failure must bypass cache, got %#v", gatewayCtx.Cache)
	}
}

type fakeProvider struct {
	config runtimeconfig.ActiveConfig
	err    error
}

func (p *fakeProvider) GetActiveConfig(_ context.Context, _ string, _ string, _ string) (runtimeconfig.ActiveConfig, error) {
	if p.err != nil {
		return runtimeconfig.ActiveConfig{}, p.err
	}
	if err := p.config.ValidateActive(); err != nil {
		return runtimeconfig.ActiveConfig{}, err
	}
	return p.config, nil
}

func (p *fakeProvider) GetExecutionSnapshot(ctx context.Context, tenantID string, projectID string, applicationID string) (runtimeconfig.ExecutionSnapshot, error) {
	config, err := p.GetActiveConfig(ctx, tenantID, projectID, applicationID)
	if err != nil {
		return runtimeconfig.ExecutionSnapshot{}, err
	}
	return config.ExecutionSnapshot(), nil
}

func testGatewayContext() *request.GatewayContext {
	return &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
		},
	}
}

func testActiveConfig() runtimeconfig.ActiveConfig {
	return runtimeconfig.ActiveConfig{
		ConfigVersion:     "runtime_config_test",
		ConfigHash:        "hash_runtime_config_test",
		PublishState:      runtimeconfig.PublishStateActive,
		TenantID:          "tenant_demo",
		TenantStatus:      runtimeconfig.StatusActive,
		ProjectID:         "project_demo",
		ProjectStatus:     runtimeconfig.StatusActive,
		ApplicationID:     "app_demo",
		ApplicationStatus: runtimeconfig.StatusActive,
		APIKeyID:          "api_key_demo",
		APIKeyStatus:      runtimeconfig.StatusActive,
		AppTokenID:        "app_token_demo",
		AppTokenStatus:    runtimeconfig.StatusActive,
		RateLimit: ratelimit.Config{
			Enabled:       true,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: 60,
			Limit:         7,
		},
		BudgetPolicy: budget.Policy{
			Enabled:                 true,
			EnforcementMode:         budget.EnforcementModeWarn,
			WarningThresholdPercent: 70,
		},
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: "hash_security_policy_test",
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			DefaultProvider:     "mock",
			DefaultModel:        "mock-balanced",
			LowCostProvider:     "mock",
			LowCostModel:        "mock-fast",
			FallbackProvider:    "mock",
			FallbackModel:       "mock-balanced",
			ShortPromptMaxChars: 500,
			RoutingPolicyHash:   "hash_routing_policy_test",
		},
		CachePolicy: runtimeconfig.CachePolicy{
			Enabled:    true,
			Type:       runtimeconfig.CacheTypeExact,
			TTLSeconds: 3600,
		},
	}
}
