package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
)

func TestWriteGatewayErrorSetsCommonHeaders(t *testing.T) {
	rr := httptest.NewRecorder()

	writeGatewayError(rr, http.StatusUnauthorized, "request_test", "invalid_api_key", "Invalid Gateway API key.")

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
	if rr.Header().Get(middleware.RequestIDHeader) != "request_test" {
		t.Fatalf("unexpected request id header: %s", rr.Header().Get(middleware.RequestIDHeader))
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" {
		t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
	if rr.Header().Get("X-GateLM-Masking-Action") != "none" {
		t.Fatalf("unexpected masking action header: %s", rr.Header().Get("X-GateLM-Masking-Action"))
	}
	if rr.Header().Get("X-GateLM-Estimated-Cost-Usd") != "0.000000" {
		t.Fatalf("unexpected cost header: %s", rr.Header().Get("X-GateLM-Estimated-Cost-Usd"))
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != "invalid_api_key" || resp.Error.RequestID != "request_test" {
		t.Fatalf("unexpected error response: %#v", resp.Error)
	}
}

func TestWriteGatewayDomainErrorUsesGatewayErrorContract(t *testing.T) {
	rr := httptest.NewRecorder()
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
		StartedAt: time.Now().UTC(),
	})

	written := writeGatewayDomainError(rr, reqCtx, gatewayerrors.InvalidAppToken("validate_app_token"))

	if !written {
		t.Fatalf("expected gateway domain error to be written")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
	if reqCtx.ErrorCode != "invalid_app_token" || reqCtx.ErrorStage != "validate_app_token" {
		t.Fatalf("unexpected request context error fields: %#v", reqCtx)
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != "invalid_app_token" {
		t.Fatalf("unexpected error code: %s", resp.Error.Code)
	}
}
