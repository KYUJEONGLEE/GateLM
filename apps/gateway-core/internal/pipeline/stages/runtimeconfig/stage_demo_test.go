package runtimeconfigstage

import (
	"context"
	"errors"
	"testing"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	ratelimitstage "gatelm/apps/gateway-core/internal/pipeline/stages/ratelimit"
	routingstage "gatelm/apps/gateway-core/internal/pipeline/stages/routing"
)

func TestRuntimeConfigProviderDemo(t *testing.T) {
	ctx := context.Background()
	config := demoActiveConfig()
	gatewayCtx := demoGatewayContext()

	t.Logf("\n[Input]\ntenantId: %s\nprojectId: %s\napplicationId: %s\napiKeyId: %s\nappTokenId: %s\nruntimeConfig.configHash: %s\nruntimeConfig.securityPolicyHash: %s\nruntimeConfig.routingPolicyHash: %s\nruntimeConfig.rateLimit.limit: %d",
		config.TenantID,
		config.ProjectID,
		config.ApplicationID,
		config.APIKeyID,
		config.AppTokenID,
		config.ConfigHash,
		config.SafetyPolicy.SecurityPolicyHash,
		config.RoutingPolicy.RoutingPolicyHash,
		config.RateLimit.Limit,
	)

	if err := NewStage(&demoRuntimeProvider{config: config}).Execute(ctx, gatewayCtx); err != nil {
		t.Fatalf("expected runtime config load, got %v", err)
	}

	limiter := &demoLimiter{
		decision: ratelimit.Decision{
			Allowed:   true,
			Reason:    ratelimit.ReasonWithinLimit,
			Limit:     config.RateLimit.Limit,
			Remaining: config.RateLimit.Limit - 1,
		},
	}
	rateStage := ratelimitstage.NewStage(limiter, ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         1,
	})
	if err := rateStage.Execute(ctx, gatewayCtx); err != nil {
		t.Fatalf("expected rate limit stage to use runtime config, got %v", err)
	}

	routeStage := routingstage.NewStage(routing.NewSimpleRouter(routing.SimpleRouterConfig{}))
	if err := routeStage.Execute(ctx, gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to use runtime config, got %v", err)
	}

	if limiter.request.Config.Limit != config.RateLimit.Limit {
		t.Fatalf("expected runtime rate limit %d, got %#v", config.RateLimit.Limit, limiter.request.Config)
	}
	if gatewayCtx.Routing.RoutingPolicyHash != config.RoutingPolicy.RoutingPolicyHash {
		t.Fatalf("expected runtime routing policy hash, got %#v", gatewayCtx.Routing)
	}

	t.Logf("\n[Output]\nstage: %s\nGatewayContext.runtime.configHash: %s\nGatewayContext.runtime.securityPolicyHash: %s\nGatewayContext.runtime.routingPolicyHash: %s\nRateLimit stage received limit: %d\nRouting selectedProvider: %s\nRouting selectedModel: %s\nRouting reason: %s\nRouting policyHash: %s",
		StageName,
		gatewayCtx.Runtime.ConfigHash,
		gatewayCtx.Runtime.SecurityPolicyHash,
		gatewayCtx.Runtime.RoutingPolicyHash,
		limiter.request.Config.Limit,
		gatewayCtx.Routing.SelectedProvider,
		gatewayCtx.Routing.SelectedModel,
		gatewayCtx.Routing.RoutingReason,
		gatewayCtx.Routing.RoutingPolicyHash,
	)

	invalidConfig := demoActiveConfig()
	invalidConfig.AppTokenID = ""
	invalidCtx := demoGatewayContext()
	err := NewStage(&demoRuntimeProvider{config: invalidConfig}).Execute(ctx, invalidCtx)
	if err == nil {
		t.Fatalf("expected missing credential binding to fail closed")
	}
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T %v", err, err)
	}
	if !errors.Is(err, runtimeconfig.ErrMissingCredentialBinding) {
		t.Fatalf("expected missing credential binding cause, got %v", err)
	}
	if invalidCtx.Cache.CacheStatus != "bypass" || invalidCtx.Cache.CacheType != "none" {
		t.Fatalf("expected invalid runtime config to bypass cache, got %#v", invalidCtx.Cache)
	}

	t.Logf("\n[Security Check]\nmissing appTokenId error.code: %s\nmissing appTokenId error.stage: %s\nmissing appTokenId cacheStatus: %s\nmissing appTokenId cacheType: %s\nraw API Key/App Token stored in GatewayContext: false",
		gatewayErr.Code,
		gatewayErr.Stage,
		invalidCtx.Cache.CacheStatus,
		invalidCtx.Cache.CacheType,
	)
}

type demoRuntimeProvider struct {
	config runtimeconfig.ActiveConfig
}

func (p *demoRuntimeProvider) GetActiveConfig(_ context.Context, _ string, _ string, _ string) (runtimeconfig.ActiveConfig, error) {
	if err := p.config.ValidateActive(); err != nil {
		return runtimeconfig.ActiveConfig{}, err
	}
	return p.config, nil
}

func (p *demoRuntimeProvider) GetExecutionSnapshot(ctx context.Context, tenantID string, projectID string, applicationID string) (runtimeconfig.ExecutionSnapshot, error) {
	config, err := p.GetActiveConfig(ctx, tenantID, projectID, applicationID)
	if err != nil {
		return runtimeconfig.ExecutionSnapshot{}, err
	}
	return config.ExecutionSnapshot(), nil
}

type demoLimiter struct {
	decision ratelimit.Decision
	request  ratelimit.Request
}

func (l *demoLimiter) Check(_ context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	l.request = req
	return l.decision, nil
}

func demoGatewayContext() *request.GatewayContext {
	return &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "Write a short refund reply for a demo customer.",
		},
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
			APIKeyID:      "api_key_demo",
			AppTokenID:    "app_token_demo",
		},
	}
}

func demoActiveConfig() runtimeconfig.ActiveConfig {
	return runtimeconfig.ActiveConfig{
		ConfigVersion:     "runtime_config_demo",
		ConfigHash:        "hash_runtime_config_demo",
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
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: "hash_security_policy_demo",
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			DefaultProvider:     "mock",
			DefaultModel:        "mock-balanced",
			LowCostProvider:     "mock",
			LowCostModel:        "mock-fast",
			FallbackProvider:    "mock",
			FallbackModel:       "mock-balanced",
			ShortPromptMaxChars: 500,
			RoutingPolicyHash:   "hash_routing_policy_demo",
		},
		CachePolicy: runtimeconfig.CachePolicy{
			Enabled:    true,
			Type:       runtimeconfig.CacheTypeExact,
			TTLSeconds: 3600,
		},
	}
}
