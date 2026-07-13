package runtimeconfig

import (
	"errors"
	"strings"
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

func TestActiveConfigValidateActiveAllowsMissingLegacyAppTokenBinding(t *testing.T) {
	config := testActiveConfig()
	config.AppTokenID = ""
	config.AppTokenStatus = ""

	if err := config.ValidateActive(); err != nil {
		t.Fatalf("expected missing legacy app token binding to be allowed, got %v", err)
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

func TestPromptCapturePolicyNormalizeAndValidate(t *testing.T) {
	enabled := NormalizePromptCapturePolicy(PromptCapturePolicy{
		Enabled: true,
	})
	if enabled.Mode != PromptCaptureModeLogSafeFull || enabled.MaxChars != PromptCaptureDefaultMaxChars {
		t.Fatalf("unexpected enabled prompt capture defaults: %+v", enabled)
	}
	if !PromptCaptureAllowsLogSafeCapture(enabled) {
		t.Fatalf("expected enabled log-safe policy to allow capture")
	}

	disabled := NormalizePromptCapturePolicy(PromptCapturePolicy{
		Enabled: false,
		Mode:    PromptCaptureModeLogSafeFull,
	})
	if disabled.Mode != PromptCaptureModeDisabled || PromptCaptureAllowsLogSafeCapture(disabled) {
		t.Fatalf("unexpected disabled prompt capture policy: %+v", disabled)
	}

	config := testActiveConfig()
	config.PromptCapture = PromptCapturePolicy{
		Enabled:  true,
		Mode:     "raw_full",
		MaxChars: 8000,
	}
	if !errors.Is(config.ValidateActive(), ErrInvalidPromptCapture) {
		t.Fatalf("expected invalid prompt capture policy to fail active validation")
	}
}

func TestResponseCapturePolicyNormalizeAndValidate(t *testing.T) {
	enabled := NormalizeResponseCapturePolicy(ResponseCapturePolicy{
		Enabled: true,
	})
	if enabled.Mode != ResponseCaptureModeRawFull || enabled.MaxChars != ResponseCaptureDefaultMaxChars {
		t.Fatalf("unexpected enabled response capture defaults: %+v", enabled)
	}
	if !ResponseCaptureAllowsRawCapture(enabled) {
		t.Fatalf("expected enabled raw response policy to allow capture")
	}

	disabled := NormalizeResponseCapturePolicy(ResponseCapturePolicy{
		Enabled: false,
		Mode:    ResponseCaptureModeRawFull,
	})
	if disabled.Mode != ResponseCaptureModeDisabled || ResponseCaptureAllowsRawCapture(disabled) {
		t.Fatalf("unexpected disabled response capture policy: %+v", disabled)
	}

	config := testActiveConfig()
	config.ResponseCapture = ResponseCapturePolicy{
		Enabled:  true,
		Mode:     "log_safe_full",
		MaxChars: 8000,
	}
	if !errors.Is(config.ValidateActive(), ErrInvalidResponseCapture) {
		t.Fatalf("expected invalid response capture policy to fail active validation")
	}
}

func TestSafetyPolicyValidateAcceptsPiiAndMandatoryDetectorSet(t *testing.T) {
	policy := SafetyPolicy{
		SecurityPolicyHash: "hash_security_policy_test",
		DetectorSet: []DetectorPolicy{
			{DetectorType: "email", Action: DetectorActionRedact},
			{DetectorType: "phone_number", Action: DetectorActionRedact},
			{DetectorType: "person_name", Action: DetectorActionRedact},
			{DetectorType: "postal_address", Action: DetectorActionRedact},
			{DetectorType: "organization_name", Action: DetectorActionRedact},
			{DetectorType: "resident_registration_number", Action: DetectorActionBlock},
			{DetectorType: "api_key", Action: DetectorActionBlock},
			{DetectorType: "authorization_header", Action: DetectorActionBlock},
			{DetectorType: "jwt", Action: DetectorActionBlock},
			{DetectorType: "private_key", Action: DetectorActionBlock},
		},
	}

	if err := policy.Validate(); err != nil {
		t.Fatalf("expected v2 safety detector set to validate, got %v", err)
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

func TestRoutingPolicySimpleRouterConfigPreservesV2Matrix(t *testing.T) {
	policy := BootstrapRoutingPolicy("hash_routing_policy_test")
	policy.Routes.Code.Complex.ModelRefs = []string{"provider-code:model-smart", "provider-code:model-fallback"}

	config := policy.SimpleRouterConfig()

	if config.Mode != routing.RoutingPolicyModeAuto || config.BootstrapState != routing.BootstrapStateMock {
		t.Fatalf("unexpected routing mode/bootstrap state: %#v", config)
	}
	refs := config.Routes.Code.Complex.ModelRefs
	if len(refs) != 2 || refs[0] != "provider-code:model-smart" || refs[1] != "provider-code:model-fallback" {
		t.Fatalf("ordered modelRefs were not preserved: %#v", refs)
	}
}

func TestRoutingPolicyRequiresAllTenCellsEvenInManualMode(t *testing.T) {
	policy := BootstrapRoutingPolicy("hash_routing_policy_test")
	policy.Mode = routing.RoutingPolicyModeManual
	policy.Routes.Reasoning.Complex.ModelRefs = nil
	if IsValidRoutingPolicy(policy) {
		t.Fatal("manual policy with a missing matrix cell must be invalid")
	}
}

func TestRoutingPolicyRejectsConfiguredStateWhileAnyMockRouteRemains(t *testing.T) {
	policy := BootstrapRoutingPolicy("hash_routing_policy_test")
	policy.BootstrapState = routing.BootstrapStateConfigured
	if IsValidRoutingPolicy(policy) {
		t.Fatal("configured state must be rejected while mock-balanced remains")
	}
}

func TestIsCanonicalRoutingPolicyHash(t *testing.T) {
	if !IsCanonicalRoutingPolicyHash("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef") {
		t.Fatal("expected lowercase sha256 hash to be canonical")
	}
	for _, value := range []string{"hash", "sha256:abc", "sha256:0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"} {
		if IsCanonicalRoutingPolicyHash(value) {
			t.Fatalf("expected non-canonical routing hash rejection: %q", value)
		}
	}
}

func TestRoutingPolicyRejectsMalformedModelRefsWithoutRepair(t *testing.T) {
	for name, mutate := range map[string]func(*RoutingPolicy){
		"blank": func(policy *RoutingPolicy) {
			policy.Routes.General.Simple.ModelRefs = append(policy.Routes.General.Simple.ModelRefs, " ")
		},
		"duplicate": func(policy *RoutingPolicy) {
			policy.Routes.General.Simple.ModelRefs = append(policy.Routes.General.Simple.ModelRefs, routing.MockBootstrapRef)
		},
		"too_long": func(policy *RoutingPolicy) {
			policy.Routes.General.Simple.ModelRefs = []string{strings.Repeat("x", 241)}
		},
	} {
		t.Run(name, func(t *testing.T) {
			policy := BootstrapRoutingPolicy("hash_routing_policy_test")
			mutate(&policy)
			if IsValidRoutingPolicy(policy) {
				t.Fatalf("malformed modelRefs must be rejected without normalization: %#v", policy.Routes.General.Simple.ModelRefs)
			}
		})
	}
}

func TestExecutionSnapshotValidateRejectsMalformedRefsBeforeNormalization(t *testing.T) {
	snapshot := testActiveConfig().ExecutionSnapshot()
	snapshot.Snapshot.RuntimeSnapshotVersion = 2
	snapshot.RoutingPolicy.Routes.General.Simple.ModelRefs = append(snapshot.RoutingPolicy.Routes.General.Simple.ModelRefs, routing.MockBootstrapRef)
	if err := snapshot.Validate(); !errors.Is(err, ErrInvalidRoutingPolicy) {
		t.Fatalf("expected duplicate ref rejection before normalization, got %v", err)
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
		RoutingPolicy: BootstrapRoutingPolicy("hash_routing_policy_test"),
		CachePolicy: CachePolicy{
			Enabled:    true,
			Type:       CacheTypeExact,
			TTLSeconds: 3600,
		},
	}
}
