package runtimeconfig

import (
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

func TestActiveConfigValidateActiveRequiresCredentialBindings(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ActiveConfig)
	}{
		{
			name: "missing api key binding",
			mutate: func(config *ActiveConfig) {
				config.APIKeyID = ""
			},
		},
		{
			name: "missing app token binding",
			mutate: func(config *ActiveConfig) {
				config.AppTokenID = ""
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Given active runtime config에서 credential binding만 빠져 있다
			config := testActiveConfig()
			tt.mutate(&config)

			// When active runtime config로 검증한다
			err := config.ValidateActive()

			// Then Gateway hot path는 credential binding 없는 config를 실행하지 않는다
			if !errors.Is(err, ErrMissingCredentialBinding) {
				t.Fatalf("expected missing credential binding, got %v", err)
			}
		})
	}
}

func TestRuntimeSnapshotProvenanceNormalizesV2FacingFields(t *testing.T) {
	publishedAt := time.Date(2026, 6, 29, 1, 2, 3, 0, time.UTC)
	config := testActiveConfig()
	config.Snapshot = RuntimeSnapshotProvenance{
		RuntimeSnapshotVersion: 7,
		RuntimeState:           "no_snapshot",
	}

	provenance := config.RuntimeSnapshotProvenance(publishedAt, "gateway_instance_test")

	if provenance.RuntimeSnapshotVersion != 7 {
		t.Fatalf("expected integer snapshot version 7, got %d", provenance.RuntimeSnapshotVersion)
	}
	if provenance.RuntimeState != RuntimeStateSnapshotActive {
		t.Fatalf("no_snapshot must not be actual provenance state, got %s", provenance.RuntimeState)
	}
	if !provenance.PublishedAt.Equal(publishedAt) || provenance.GatewayInstanceID != "gateway_instance_test" {
		t.Fatalf("unexpected provenance source fields: %+v", provenance)
	}
	if provenance.LegacyHashes.ConfigHash != "hash_runtime_config_test" ||
		provenance.LegacyHashes.SecurityPolicyHash != "hash_security_policy_test" ||
		provenance.LegacyHashes.RoutingPolicyHash != "hash_routing_policy_test" {
		t.Fatalf("unexpected legacy hash bridge: %+v", provenance.LegacyHashes)
	}
}

func TestActiveConfigValidateActiveRejectsInactiveCredentialStatus(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ActiveConfig)
	}{
		{
			name: "inactive api key status",
			mutate: func(config *ActiveConfig) {
				config.APIKeyStatus = "revoked"
			},
		},
		{
			name: "inactive app token status",
			mutate: func(config *ActiveConfig) {
				config.AppTokenStatus = "disabled"
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Given credential binding은 있지만 status가 active가 아니다
			config := testActiveConfig()
			tt.mutate(&config)

			// When active runtime config로 검증한다
			err := config.ValidateActive()

			// Then 기존 inactive config 오류로 fail-closed 처리할 수 있다
			if !errors.Is(err, ErrInactiveConfig) {
				t.Fatalf("expected inactive config, got %v", err)
			}
		})
	}
}

func TestRoutingPolicySimpleRouterConfigUsesHighQualityModelWhenConfigured(t *testing.T) {
	policy := RoutingPolicy{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostProvider:     "mock-cheap",
		LowCostModel:        "mock-fast",
		HighQualityProvider: "mock-premium",
		HighQualityModel:    "mock-smart",
		FallbackProvider:    "mock",
		FallbackModel:       "mock-fallback",
		CandidateStatuses: []routing.RouteCandidateStatus{
			{Provider: "mock-cheap", Model: "mock-fast", Status: routing.RouteCandidateUnavailable, FallbackPriority: 20},
		},
		RoutingPolicyHash: "hash_routing_policy_test",
	}

	config := policy.SimpleRouterConfig()

	if config.LowCostProvider != "mock-cheap" || config.LowCostModel != "mock-fast" {
		t.Fatalf("expected low-cost route to use configured provider/model: %#v", config)
	}
	if config.HighQualityProvider != "mock-premium" || config.HighQualityModel != "mock-smart" {
		t.Fatalf("expected high-quality route to use configured provider/model: %#v", config)
	}
	if len(config.CandidateStatuses) != 1 || config.CandidateStatuses[0].Status != routing.RouteCandidateUnavailable {
		t.Fatalf("expected candidate statuses to pass to simple router config: %#v", config.CandidateStatuses)
	}
}

func TestRoutingPolicySimpleRouterConfigFallsBackHighQualityToDefaultModel(t *testing.T) {
	policy := RoutingPolicy{
		DefaultProvider:   "mock",
		DefaultModel:      "mock-balanced",
		FallbackProvider:  "mock",
		FallbackModel:     "mock-fallback",
		RoutingPolicyHash: "hash_routing_policy_test",
	}

	config := policy.SimpleRouterConfig()

	if config.HighQualityProvider != "mock" || config.HighQualityModel != "mock-balanced" {
		t.Fatalf("expected high-quality route to fall back to default provider/model: %#v", config)
	}
}

func TestRoutingPolicySimpleRouterConfigInitializesEmptyCandidateStatuses(t *testing.T) {
	policy := RoutingPolicy{
		DefaultProvider:   "mock",
		DefaultModel:      "mock-balanced",
		RoutingPolicyHash: "hash_routing_policy_test",
	}

	config := policy.SimpleRouterConfig()

	if config.CandidateStatuses == nil {
		t.Fatal("expected empty candidate statuses slice, got nil")
	}
	if len(config.CandidateStatuses) != 0 {
		t.Fatalf("expected no candidate statuses, got %#v", config.CandidateStatuses)
	}
}

func testActiveConfig() ActiveConfig {
	return ActiveConfig{
		ConfigVersion:     "runtime_config_test",
		ConfigHash:        "hash_runtime_config_test",
		PublishState:      PublishStateActive,
		TenantID:          "tenant_demo",
		TenantStatus:      StatusActive,
		ProjectID:         "project_demo",
		ProjectStatus:     StatusActive,
		ApplicationID:     "app_demo",
		ApplicationStatus: StatusActive,
		APIKeyID:          "api_key_demo",
		APIKeyStatus:      StatusActive,
		AppTokenID:        "app_token_demo",
		AppTokenStatus:    StatusActive,
		RateLimit: ratelimit.Config{
			Enabled:       true,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: 60,
			Limit:         7,
		},
		SafetyPolicy: SafetyPolicy{
			SecurityPolicyHash: "hash_security_policy_test",
		},
		RoutingPolicy: RoutingPolicy{
			DefaultProvider:     "mock",
			DefaultModel:        "mock-balanced",
			LowCostProvider:     "mock",
			LowCostModel:        "mock-fast",
			HighQualityProvider: "mock",
			HighQualityModel:    "mock-smart",
			FallbackProvider:    "mock",
			FallbackModel:       "mock-balanced",
			ShortPromptMaxChars: 500,
			RoutingPolicyHash:   "hash_routing_policy_test",
		},
		CachePolicy: CachePolicy{
			Enabled:    true,
			Type:       CacheTypeExact,
			TTLSeconds: 3600,
		},
	}
}
