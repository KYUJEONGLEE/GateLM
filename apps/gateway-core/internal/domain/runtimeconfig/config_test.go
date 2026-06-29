package runtimeconfig

import (
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
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

func TestActiveConfigValidateActiveRejectsEditableRuntimeConfig(t *testing.T) {
	config := testActiveConfig()
	config.PublishedRuntimeSnapshot = false

	err := config.ValidateActive()

	if !errors.Is(err, ErrEditableRuntimeConfig) {
		t.Fatalf("expected editable runtime config rejection, got %v", err)
	}
}

func TestActiveConfigValidateActiveRejectsMissingRuntimeSnapshotProvenance(t *testing.T) {
	config := testActiveConfig()
	config.Snapshot = RuntimeSnapshotProvenance{}

	err := config.ValidateActive()

	if !errors.Is(err, ErrMissingRuntimeSnapshot) {
		t.Fatalf("expected missing runtime snapshot provenance, got %v", err)
	}
}

func TestActiveConfigValidateActiveRejectsRawDetectorTypeShape(t *testing.T) {
	tests := []string{
		"user@example.test",
		"contains spaces",
		"api key",
		"SECRET_VALUE_ABC",
	}

	for _, detectorType := range tests {
		t.Run(detectorType, func(t *testing.T) {
			config := testActiveConfig()
			config.SafetyPolicy.DetectorSet = []SafetyDetector{
				{DetectorType: detectorType, Action: SafetyActionBlock},
			}

			err := config.ValidateActive()

			if !errors.Is(err, ErrInvalidSafetyPolicy) {
				t.Fatalf("expected invalid safety policy for %q, got %v", detectorType, err)
			}
		})
	}
}

func TestActiveConfigValidateActiveRejectsSemanticCacheLiveMode(t *testing.T) {
	config := testActiveConfig()
	config.CachePolicy.SemanticCacheMode = "live"

	err := config.ValidateActive()

	if !errors.Is(err, ErrInvalidCachePolicy) {
		t.Fatalf("expected invalid semantic cache policy, got %v", err)
	}
}

func TestActiveConfigValidateActiveRejectsInvalidBudgetPolicy(t *testing.T) {
	config := testActiveConfig()
	config.BudgetPolicy.EnforcementMode = "strict"

	err := config.ValidateActive()

	if !errors.Is(err, ErrInvalidBudgetPolicy) {
		t.Fatalf("expected invalid budget policy, got %v", err)
	}
}

func testActiveConfig() ActiveConfig {
	return ActiveConfig{
		ConfigVersion:     "runtime_config_test",
		ConfigHash:        "hash_runtime_config_test",
		PublishState:      PublishStateActive,
		PublishedRuntimeSnapshot: true,
		Snapshot: RuntimeSnapshotProvenance{
			RuntimeSnapshotID:      "runtime_snapshot_test",
			RuntimeSnapshotVersion: 1,
			ContentHash:            "hash_runtime_config_test",
			RuntimeState:           RuntimeStateSnapshotActive,
		},
		TenantID:          "tenant_demo",
		TenantStatus:      StatusActive,
		ProjectID:         "project_demo",
		ProjectStatus:     StatusActive,
		BudgetResolution: budget.Scope{
			Type:       budget.ScopeTypeApplication,
			ID:         "app_demo",
			ResolvedBy: budget.ResolvedByRuntimeSnapshot,
		},
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
		BudgetPolicy: budget.Policy{
			Enabled:                 true,
			EnforcementMode:         budget.EnforcementModeWarn,
			WarningThresholdPercent: 80,
		},
		SafetyPolicy: SafetyPolicy{
			SecurityPolicyHash: "hash_security_policy_test",
			Enabled:            true,
			Mode:               SafetyModeEnforce,
			RequestSideRequired: true,
			PolicyHash:         "hash_security_policy_test",
			DetectorSet: []SafetyDetector{
				{DetectorType: "email", Action: SafetyActionRedact},
				{DetectorType: "api_key", Action: SafetyActionBlock},
			},
		},
		RoutingPolicy: RoutingPolicy{
			DefaultProvider:     "mock",
			DefaultModel:        "mock-balanced",
			LowCostProvider:     "mock",
			LowCostModel:        "mock-fast",
			FallbackProvider:    "mock",
			FallbackModel:       "mock-balanced",
			ShortPromptMaxChars: 500,
			RoutingPolicyHash:   "hash_routing_policy_test",
		},
		CachePolicy: CachePolicy{
			Enabled:           true,
			Type:              CacheTypeExact,
			TTLSeconds:        3600,
			SemanticCacheMode: SemanticCacheModeEvidenceOnly,
		},
	}
}
