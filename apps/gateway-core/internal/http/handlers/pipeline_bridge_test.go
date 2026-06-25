package handlers

import (
	"net/http"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/pipeline"
)

func TestNewGatewayContextIncludesPromptText(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.RequestedModel = "auto"

	gatewayCtx := newGatewayContext(reqCtx, "system prompt\nuser prompt")

	if gatewayCtx.Request.PromptText != "system prompt\nuser prompt" {
		t.Fatalf("unexpected prompt text: %q", gatewayCtx.Request.PromptText)
	}
	if gatewayCtx.Request.RequestedModel != "auto" {
		t.Fatalf("unexpected requested model: %s", gatewayCtx.Request.RequestedModel)
	}
}

func TestApplyGatewayContextCopiesPartialStatusFields(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Status: request.StatusContext{
			HTTPStatus:   http.StatusForbidden,
			ErrorCode:    "sensitive_data_blocked",
			ErrorMessage: "Request blocked by GateLM security policy.",
			ErrorStage:   "mask_or_block",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.HTTPStatus != http.StatusForbidden {
		t.Fatalf("expected HTTP status %d, got %d", http.StatusForbidden, reqCtx.HTTPStatus)
	}
	if reqCtx.ErrorCode != "sensitive_data_blocked" {
		t.Fatalf("unexpected error code: %s", reqCtx.ErrorCode)
	}
	if reqCtx.ErrorStage != "mask_or_block" {
		t.Fatalf("unexpected error stage: %s", reqCtx.ErrorStage)
	}
}
