package handlers

import (
	"net/http"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/request"
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
	})
	reqCtx.RequestedModel = "auto"
	reqCtx.CacheStatus = "miss"
	reqCtx.CacheType = "exact"
	reqCtx.CacheKeyHash = "hmac-sha256:cache-key"
	reqCtx.CacheHitRequestID = "request_cached"
	reqCtx.SavedCostMicroUSD = 5

	gatewayCtx := newGatewayContext(reqCtx, "system prompt\nuser prompt")

	if gatewayCtx.Request.PromptText != "system prompt\nuser prompt" {
		t.Fatalf("unexpected prompt text: %q", gatewayCtx.Request.PromptText)
	}
	if gatewayCtx.Request.RequestedModel != "auto" {
		t.Fatalf("unexpected requested model: %s", gatewayCtx.Request.RequestedModel)
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
			RequestedModel:    "auto",
			SelectedProvider:  "mock",
			SelectedModel:     "mock-fast",
			RoutingReason:     "short_prompt_low_cost",
			RoutingPolicyHash: "route_p0_v1",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.RequestedModel != "auto" {
		t.Fatalf("expected requested model auto, got %s", reqCtx.RequestedModel)
	}
	if reqCtx.SelectedProvider != "mock" || reqCtx.SelectedModel != "mock-fast" {
		t.Fatalf("unexpected selected route: %#v", reqCtx)
	}
	if reqCtx.RoutingPolicyHash != "route_p0_v1" {
		t.Fatalf("expected routing policy hash route_p0_v1, got %s", reqCtx.RoutingPolicyHash)
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
			RedactedPromptPreview:   "Contact [EMAIL_REDACTED].",
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
	if reqCtx.RedactedPromptPreview != "Contact [EMAIL_REDACTED]." {
		t.Fatalf("unexpected redacted prompt preview: %q", reqCtx.RedactedPromptPreview)
	}
	if reqCtx.SecurityPolicyVersionID != "security_policy_p0_v1" {
		t.Fatalf("unexpected security policy version: %q", reqCtx.SecurityPolicyVersionID)
	}
}
