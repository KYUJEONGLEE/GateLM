package handlers

import (
	"net/http"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/pipeline"
)

func TestNewGatewayContextIncludesPromptText(t *testing.T) {
	startedAt := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
		StartedAt: startedAt,
		EndUserID: "user_demo_001",
		FeatureID: "support-reply",
	})
	reqCtx.RequestedModel = "auto"
	reqCtx.CacheStatus = "miss"
	reqCtx.CacheType = "exact"
	reqCtx.CacheKeyHash = "hmac-sha256:cache-key"
	reqCtx.CacheHitRequestID = "request_cached"
	reqCtx.SavedCostMicroUSD = 5
	reqCtx.ConfigHash = "hash_runtime_config_test"
	reqCtx.SecurityPolicyHash = "hash_security_policy_test"
	reqCtx.RuntimeRateLimit = ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         7,
	}
	reqCtx.HasRuntimeRateLimit = true
	reqCtx.RuntimeRoutingPolicy = runtimeconfig.BootstrapRoutingPolicy("hash_routing_policy_test")
	reqCtx.HasRuntimeRoutingPolicy = true
	reqCtx.RateLimitDecision = &ratelimit.Decision{
		Allowed:   true,
		Scope:     ratelimit.ScopeApplication,
		ScopeID:   "app_demo",
		Limit:     10,
		Remaining: 9,
		Reason:    ratelimit.ReasonWithinLimit,
	}

	gatewayCtx := newGatewayContext(reqCtx, "system prompt\nuser prompt")

	if gatewayCtx.Request.PromptText != "system prompt\nuser prompt" {
		t.Fatalf("unexpected prompt text: %q", gatewayCtx.Request.PromptText)
	}
	if gatewayCtx.Request.RequestedModel != "auto" {
		t.Fatalf("unexpected requested model: %s", gatewayCtx.Request.RequestedModel)
	}
	if gatewayCtx.Identity.EndUserID != "user_demo_001" || gatewayCtx.Identity.FeatureID != "support-reply" {
		t.Fatalf("unexpected Day4 identity metadata: %#v", gatewayCtx.Identity)
	}
	if !gatewayCtx.Request.StartedAt.Equal(startedAt) {
		t.Fatalf("unexpected started at: %s", gatewayCtx.Request.StartedAt)
	}
	if gatewayCtx.Cache.CacheStatus != "miss" || gatewayCtx.Cache.CacheType != "exact" {
		t.Fatalf("unexpected cache metadata: %#v", gatewayCtx.Cache)
	}
	if gatewayCtx.Cache.CacheKeyHash != "hmac-sha256:cache-key" || gatewayCtx.Cache.CacheHitRequestID != "request_cached" {
		t.Fatalf("unexpected cache key metadata: %#v", gatewayCtx.Cache)
	}
	if gatewayCtx.Cache.SavedCostMicroUSD != 5 {
		t.Fatalf("unexpected saved cost metadata: %#v", gatewayCtx.Cache)
	}
	if gatewayCtx.Runtime.ConfigHash != "hash_runtime_config_test" ||
		gatewayCtx.Runtime.SecurityPolicyHash != "hash_security_policy_test" ||
		!gatewayCtx.Runtime.HasRateLimitConfig ||
		gatewayCtx.Runtime.RateLimitConfig.Limit != 7 ||
		!gatewayCtx.Runtime.HasRoutingPolicy ||
		gatewayCtx.Runtime.RoutingPolicy.RoutingPolicyHash != "hash_routing_policy_test" {
		t.Fatalf("unexpected runtime metadata: %#v", gatewayCtx.Runtime)
	}
	if gatewayCtx.Governance.RateLimitDecision == nil || !gatewayCtx.Governance.RateLimitDecision.Allowed {
		t.Fatalf("unexpected rate limit metadata: %#v", gatewayCtx.Governance.RateLimitDecision)
	}
}

func TestApplyGatewayContextCopiesDay4IdentityMetadata(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
			APIKeyID:      "api_key_demo",
			AppTokenID:    "app_token_demo",
			EndUserID:     "user_demo_001",
			FeatureID:     "support-reply",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.TenantID != "tenant_demo" || reqCtx.ProjectID != "project_demo" || reqCtx.ApplicationID != "app_demo" {
		t.Fatalf("unexpected tenant/project/application metadata: %#v", reqCtx)
	}
	if reqCtx.APIKeyID != "api_key_demo" || reqCtx.AppTokenID != "app_token_demo" {
		t.Fatalf("unexpected key/token metadata: %#v", reqCtx)
	}
	if reqCtx.EndUserID != "user_demo_001" || reqCtx.FeatureID != "support-reply" {
		t.Fatalf("unexpected end user/feature metadata: %#v", reqCtx)
	}
}

func TestApplyGatewayContextPreservesHTTPStatusWhenOnlyErrorCodeIsProvided(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.HTTPStatus = http.StatusBadGateway
	gatewayCtx := &request.GatewayContext{
		Status: request.StatusContext{
			ErrorCode: "sensitive_data_blocked",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("expected HTTP status %d, got %d", http.StatusBadGateway, reqCtx.HTTPStatus)
	}
	if reqCtx.ErrorCode != "sensitive_data_blocked" {
		t.Fatalf("unexpected error code: %s", reqCtx.ErrorCode)
	}
}

func TestApplyGatewayContextCopiesHTTPStatusOnly(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.ErrorCode = "existing_error"
	gatewayCtx := &request.GatewayContext{
		Status: request.StatusContext{
			HTTPStatus: http.StatusForbidden,
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.HTTPStatus != http.StatusForbidden {
		t.Fatalf("expected HTTP status %d, got %d", http.StatusForbidden, reqCtx.HTTPStatus)
	}
	if reqCtx.ErrorCode != "existing_error" {
		t.Fatalf("unexpected error code: %s", reqCtx.ErrorCode)
	}
}

func TestApplyGatewayContextCopiesCacheMetadata(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Cache: request.CacheContext{
			CacheStatus:       "hit",
			CacheType:         "exact",
			CacheKeyHash:      "hmac-sha256:cache-key",
			CacheHitRequestID: "request_cached",
			SavedCostMicroUSD: 11,
			Payload:           []byte(`{"id":"cached"}`),
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.CacheStatus != "hit" || reqCtx.CacheType != "exact" {
		t.Fatalf("unexpected cache status metadata: %#v", reqCtx)
	}
	if reqCtx.CacheKeyHash != "hmac-sha256:cache-key" || reqCtx.CacheHitRequestID != "request_cached" {
		t.Fatalf("unexpected cache key metadata: %#v", reqCtx)
	}
	if reqCtx.SavedCostMicroUSD != 11 {
		t.Fatalf("unexpected saved cost metadata: %#v", reqCtx)
	}
}

func TestApplyGatewayContextCopiesRateLimitDecision(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Governance: request.GovernanceContext{
			RateLimitDecision: &ratelimit.Decision{
				Allowed:   false,
				Scope:     ratelimit.ScopeApplication,
				ScopeID:   "app_demo",
				Limit:     1,
				Remaining: 0,
				Reason:    ratelimit.ReasonLimitExceeded,
			},
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.RateLimitDecision == nil || reqCtx.RateLimitDecision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("unexpected rate limit decision: %#v", reqCtx.RateLimitDecision)
	}
}

func TestApplyGatewayContextCopiesRuntimeMetadata(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Runtime: request.RuntimeContext{
			ConfigHash:         "hash_runtime_config_test",
			SecurityPolicyHash: "hash_security_policy_test",
			RoutingPolicyHash:  "hash_routing_policy_test",
			RateLimitConfig: ratelimit.Config{
				Enabled:       true,
				Scope:         ratelimit.ScopeApplication,
				Algorithm:     ratelimit.AlgorithmFixedWindow,
				WindowSeconds: 60,
				Limit:         7,
			},
			HasRateLimitConfig: true,
			RoutingPolicy:      runtimeconfig.BootstrapRoutingPolicy("hash_routing_policy_test"),
			HasRoutingPolicy:   true,
			CachePolicy: runtimeconfig.CachePolicy{
				Enabled:    true,
				Type:       runtimeconfig.CacheTypeExact,
				TTLSeconds: 3600,
			},
			HasCachePolicy: true,
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.ConfigHash != "hash_runtime_config_test" || reqCtx.SecurityPolicyHash != "hash_security_policy_test" {
		t.Fatalf("unexpected runtime hashes: %#v", reqCtx)
	}
	if reqCtx.RoutingPolicyHash != "hash_routing_policy_test" {
		t.Fatalf("unexpected routing policy hash: %s", reqCtx.RoutingPolicyHash)
	}
	if !reqCtx.HasRuntimeRateLimit || reqCtx.RuntimeRateLimit.Limit != 7 {
		t.Fatalf("unexpected runtime rate limit: %#v", reqCtx.RuntimeRateLimit)
	}
	if !reqCtx.HasRuntimeRoutingPolicy || reqCtx.RuntimeRoutingPolicy.RoutingPolicyHash != "hash_routing_policy_test" {
		t.Fatalf("unexpected runtime routing policy: %#v", reqCtx.RuntimeRoutingPolicy)
	}
	if !reqCtx.HasRuntimeCachePolicy || reqCtx.RuntimeCachePolicy.TTLSeconds != 3600 {
		t.Fatalf("unexpected runtime cache policy: %#v", reqCtx.RuntimeCachePolicy)
	}
}

func TestApplyGatewayContextCopiesZeroSavedCostMetadata(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.SavedCostMicroUSD = 99
	gatewayCtx := &request.GatewayContext{
		Cache: request.CacheContext{
			SavedCostMicroUSD: 0,
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.SavedCostMicroUSD != 0 {
		t.Fatalf("expected saved cost metadata to be cleared to zero, got %d", reqCtx.SavedCostMicroUSD)
	}
}

func TestApplyGatewayContextCopiesRoutingPolicyHash(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Routing: request.RoutingContext{
			RequestedModel:     "auto",
			ModelRef:           "mock-fast",
			CandidateModelRefs: []string{"mock-fast"},
			RoutingReason:      "category_difficulty_matrix",
			RoutingPolicyHash:  "route_policy_v2",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.RequestedModel != "auto" {
		t.Fatalf("expected requested model auto, got %s", reqCtx.RequestedModel)
	}
	if reqCtx.ModelRef != "mock-fast" || len(reqCtx.CandidateModelRefs) != 1 {
		t.Fatalf("unexpected model reference route: %#v", reqCtx)
	}
	if reqCtx.RoutingPolicyHash != "route_policy_v2" {
		t.Fatalf("expected routing policy hash route_policy_v2, got %s", reqCtx.RoutingPolicyHash)
	}
}

func TestApplyGatewayContextCopiesMaskingMetadata(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Masking: request.MaskingContext{
			Action:                  "redacted",
			DetectedTypes:           []string{"email"},
			DetectedCount:           1,
			RedactedPromptPreview:   "Contact [EMAIL_1].",
			SecurityPolicyVersionID: "security_policy_p0_v1",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.MaskingAction != "redacted" {
		t.Fatalf("expected masking action redacted, got %q", reqCtx.MaskingAction)
	}
	if len(reqCtx.MaskingDetectedTypes) != 1 || reqCtx.MaskingDetectedTypes[0] != "email" {
		t.Fatalf("unexpected masking detected types: %#v", reqCtx.MaskingDetectedTypes)
	}
	if reqCtx.MaskingDetectedCount != 1 {
		t.Fatalf("expected masking detected count 1, got %d", reqCtx.MaskingDetectedCount)
	}
	if reqCtx.RedactedPromptPreview != "Contact [EMAIL_1]." {
		t.Fatalf("unexpected redacted prompt preview: %q", reqCtx.RedactedPromptPreview)
	}
	if reqCtx.SecurityPolicyVersionID != "security_policy_p0_v1" {
		t.Fatalf("unexpected security policy version: %q", reqCtx.SecurityPolicyVersionID)
	}
}
