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
