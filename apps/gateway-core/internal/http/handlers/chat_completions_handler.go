package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
)

type ChatCompletionsHandler struct {
	Providers       *provider.Registry
	DefaultModel    string
	DefaultProvider string
}

func (h ChatCompletionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now().UTC()
	requestID := middleware.NormalizeRequestID(r.Header.Get(middleware.RequestIDHeader))
	if requestID == "" {
		requestID = middleware.NewRequestID()
	}

	var chatReq provider.ChatCompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&chatReq); err != nil {
		writeGatewayError(w, http.StatusBadRequest, requestID, "invalid_request_error", "Request body is invalid.")
		return
	}

	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: requestID,
		TraceID:   requestID,
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
		Stream:    chatReq.Stream,
		StartedAt: startedAt,
		EndUserID: r.Header.Get("X-GateLM-End-User-Id"),
		FeatureID: r.Header.Get("X-GateLM-Feature-Id"),
	})
	reqCtx.RequestedModel = chatReq.Model

	if chatReq.Stream {
		reqCtx.Status = "error"
		reqCtx.HTTPStatus = http.StatusBadRequest
		reqCtx.ErrorCode = "streaming_not_supported"
		reqCtx.ErrorMessage = "Streaming is not supported in P0."
		reqCtx.ErrorStage = "parse_openai_compatible_payload"
		setGatewayHeaders(w, reqCtx)
		writeGatewayError(w, http.StatusBadRequest, requestID, "streaming_not_supported", "Streaming is not supported in P0.")
		return
	}

	if chatReq.Model == "" {
		chatReq.Model = h.DefaultModel
		reqCtx.RequestedModel = h.DefaultModel
	}
	if len(chatReq.Messages) == 0 {
		writeGatewayError(w, http.StatusBadRequest, requestID, "invalid_request_error", "messages is required.")
		return
	}

	adapter, err := h.Providers.Get(h.DefaultProvider)
	if err != nil {
		writeGatewayError(w, http.StatusServiceUnavailable, requestID, "provider_not_configured", "Gateway provider is not configured.")
		return
	}

	chatReq.RequestID = requestID
	reqCtx.SelectedProvider = adapter.Name()
	reqCtx.SelectedModel = chatReq.Model
	reqCtx.RoutingReason = "not_routed"
	reqCtx.Provider = adapter.Name()
	reqCtx.Model = chatReq.Model

	providerStartedAt := time.Now()
	providerResp, err := adapter.CreateChatCompletion(r.Context(), chatReq)
	reqCtx.ProviderLatencyMs = time.Since(providerStartedAt).Milliseconds()
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		reqCtx.Status = "error"
		reqCtx.HTTPStatus = http.StatusBadGateway
		reqCtx.ErrorCode = "provider_error"
		reqCtx.ErrorMessage = "Provider request failed."
		reqCtx.ErrorStage = "call_provider_with_timeout_retry_fallback"
		setGatewayHeaders(w, reqCtx)
		writeGatewayError(w, http.StatusBadGateway, requestID, "provider_error", "Provider request failed.")
		return
	}

	if providerResp.Usage != nil {
		reqCtx.PromptTokens = providerResp.Usage.PromptTokens
		reqCtx.CompletionTokens = providerResp.Usage.CompletionTokens
		reqCtx.TotalTokens = providerResp.Usage.TotalTokens
	}
	reqCtx.Status = "success"
	reqCtx.HTTPStatus = http.StatusOK
	reqCtx.CacheStatus = "bypass"
	reqCtx.CacheType = "none"

	providerResp.GateLM = &provider.GateLMMetadata{
		RequestID:        reqCtx.RequestID,
		RequestedModel:   reqCtx.RequestedModel,
		SelectedProvider: reqCtx.SelectedProvider,
		SelectedModel:    reqCtx.SelectedModel,
		CacheStatus:      reqCtx.CacheStatus,
		RoutingReason:    reqCtx.RoutingReason,
		MaskingAction:    reqCtx.MaskingAction,
		LatencyMs:        reqCtx.LatencyMs,
	}

	setGatewayHeaders(w, reqCtx)
	writeJSON(w, http.StatusOK, providerResp)
}

func setGatewayHeaders(w http.ResponseWriter, reqCtx *pipeline.RequestContext) {
	w.Header().Set(middleware.RequestIDHeader, reqCtx.RequestID)
	w.Header().Set("X-GateLM-Cache-Status", reqCtx.CacheStatus)
	w.Header().Set("X-GateLM-Routed-Provider", reqCtx.SelectedProvider)
	w.Header().Set("X-GateLM-Routed-Model", reqCtx.SelectedModel)
	w.Header().Set("X-GateLM-Masking-Action", reqCtx.MaskingAction)
	w.Header().Set("X-GateLM-Estimated-Cost-Usd", "0.000000")
}
