package static

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

func TestProviderReturnsActiveConfigForMatchingScope(t *testing.T) {
	// Given active runtime config가 static provider에 준비되어 있다
	provider := NewProvider(testActiveConfig())

	// When Gateway가 tenant/project/application scope로 active config를 요청한다
	config, err := provider.GetActiveConfig(context.Background(), "tenant_demo", "project_demo", "app_demo")

	// Then active config와 runtime hash를 반환한다
	if err != nil {
		t.Fatalf("expected active config, got %v", err)
	}
	if config.ConfigHash != "hash_runtime_config_test" || config.SafetyPolicy.SecurityPolicyHash != "hash_security_policy_test" {
		t.Fatalf("unexpected runtime hashes: %#v", config)
	}
	if config.RateLimit.Limit != 7 {
		t.Fatalf("expected runtime rate limit 7, got %#v", config.RateLimit)
	}
	if config.BudgetPolicy.EnforcementMode != budget.EnforcementModeWarn || config.BudgetResolution.ID != "app_demo" {
		t.Fatalf("expected runtime budget defaults, got policy=%#v scope=%#v", config.BudgetPolicy, config.BudgetResolution)
	}
}

func TestProviderRejectsScopeMismatch(t *testing.T) {
	// Given active runtime config가 다른 application에 묶여 있다
	provider := NewProvider(testActiveConfig())

	// When 다른 application scope로 조회한다
	_, err := provider.GetActiveConfig(context.Background(), "tenant_demo", "project_demo", "other_app")

	// Then Gateway가 잘못된 scope를 실행하지 못하도록 거부한다
	if !errors.Is(err, runtimeconfig.ErrScopeMismatch) {
		t.Fatalf("expected scope mismatch, got %v", err)
	}
}

func TestProviderRejectsInactiveConfig(t *testing.T) {
	// Given publishState가 active가 아니다
	config := testActiveConfig()
	config.PublishState = "draft"
	provider := NewProvider(config)

	// When Gateway가 active config로 조회한다
	_, err := provider.GetActiveConfig(context.Background(), "tenant_demo", "project_demo", "app_demo")

	// Then fail-closed 판단을 할 수 있는 오류를 반환한다
	if !errors.Is(err, runtimeconfig.ErrInactiveConfig) {
		t.Fatalf("expected inactive config error, got %v", err)
	}
}

func testActiveConfig() runtimeconfig.ActiveConfig {
	return runtimeconfig.ActiveConfig{
		ConfigVersion:     "runtime_config_test",
		ConfigHash:        "hash_runtime_config_test",
		PublishState:      runtimeconfig.PublishStateActive,
		PublishedRuntimeSnapshot: true,
		Snapshot: runtimeconfig.RuntimeSnapshotProvenance{
			RuntimeSnapshotID:      "runtime_snapshot_test",
			RuntimeSnapshotVersion: 1,
			ContentHash:            "hash_runtime_config_test",
			RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
		},
		TenantID:          "tenant_demo",
		TenantStatus:      runtimeconfig.StatusActive,
		ProjectID:         "project_demo",
		ProjectStatus:     runtimeconfig.StatusActive,
		BudgetResolution: budget.Scope{
			Type:       budget.ScopeTypeApplication,
			ID:         "app_demo",
			ResolvedBy: budget.ResolvedByRuntimeSnapshot,
		},
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
			WarningThresholdPercent: 80,
		},
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: "hash_security_policy_test",
			Enabled:            true,
			Mode:               runtimeconfig.SafetyModeEnforce,
			RequestSideRequired: true,
			PolicyHash:         "hash_security_policy_test",
			DetectorSet: []runtimeconfig.SafetyDetector{
				{DetectorType: "email", Action: runtimeconfig.SafetyActionRedact},
				{DetectorType: "api_key", Action: runtimeconfig.SafetyActionBlock},
			},
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
			Enabled:           true,
			Type:              runtimeconfig.CacheTypeExact,
			TTLSeconds:        3600,
			SemanticCacheMode: runtimeconfig.SemanticCacheModeEvidenceOnly,
		},
	}
}
