package handlers

import (
	"net/http"
	"testing"

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
