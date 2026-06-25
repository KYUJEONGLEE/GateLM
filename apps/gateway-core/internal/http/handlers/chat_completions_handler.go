package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/pipeline/stages/appauth"
	"gatelm/apps/gateway-core/internal/pipeline/stages/authenticate"
	"gatelm/apps/gateway-core/internal/pipeline/stages/identify"
)

type ChatCompletionsHandler struct {
	Providers           *provider.Registry
	DefaultModel        string
	DefaultProvider     string
	MaxRequestBodyBytes int64
	APIKeyAuthenticator authenticate.APIKeyAuthenticator
	AppTokenValidator   appauth.AppTokenValidator
	ExpectedTenantID    string
	ExpectedProjectID   string
	ExpectedAppID       string
	PreProviderPipeline GatewayPipeline
}

func (h ChatCompletionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	requestID := middleware.NormalizeRequestID(r.Header.Get(middleware.RequestIDHeader))
	if requestID == "" {
		requestID = middleware.NewRequestID()
	}

	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: requestID,
		TraceID:   requestID,
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
		StartedAt: startedAt.UTC(),
		EndUserID: r.Header.Get("X-GateLM-End-User-Id"),
		FeatureID: r.Header.Get("X-GateLM-Feature-Id"),
	})

	if h.MaxRequestBodyBytes > 0 {
		if r.ContentLength > h.MaxRequestBodyBytes {
			writeGatewayErrorWithContext(w, reqCtx, http.StatusRequestEntityTooLarge, "request_body_too_large", "Request body is too large.", "parse_openai_compatible_payload")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, h.MaxRequestBodyBytes)
	}

	var chatReq provider.ChatCompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&chatReq); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeGatewayErrorWithContext(w, reqCtx, http.StatusRequestEntityTooLarge, "request_body_too_large", "Request body is too large.", "parse_openai_compatible_payload")
			return
		}
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadRequest, "invalid_request_error", "Request body is invalid.", "parse_openai_compatible_payload")
		return
	}

	reqCtx.Stream = chatReq.Stream
	reqCtx.RequestedModel = chatReq.Model

	if h.APIKeyAuthenticator == nil || h.AppTokenValidator == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway authentication is not initialized.", "authenticate_api_key")
		return
	}

	bearerToken, ok := extractBearerToken(r.Header.Get("Authorization"))
	if !ok {
		handleGatewayAuthError(w, reqCtx, gatewayerrors.InvalidAPIKey(authenticate.StageName))
		return
	}
	appToken := strings.TrimSpace(r.Header.Get("X-GateLM-App-Token"))
	if appToken == "" {
		handleGatewayAuthError(w, reqCtx, gatewayerrors.InvalidAppToken(appauth.StageName))
		return
	}

	authGatewayCtx := newGatewayContext(reqCtx, "")
	apiKeyStage := authenticate.NewStage(h.APIKeyAuthenticator, bearerToken)
	if err := apiKeyStage.Execute(r.Context(), authGatewayCtx); err != nil {
		applyGatewayContext(reqCtx, authGatewayCtx)
		handleGatewayAuthError(w, reqCtx, err)
		return
	}

	appTokenStage := appauth.NewStage(h.AppTokenValidator, appToken)
	if err := appTokenStage.Execute(r.Context(), authGatewayCtx); err != nil {
		applyGatewayContext(reqCtx, authGatewayCtx)
		handleGatewayAuthError(w, reqCtx, err)
		return
	}

	identifyStage := identify.NewStage(h.ExpectedTenantID, h.ExpectedProjectID, h.ExpectedAppID)
	if err := identifyStage.Execute(r.Context(), authGatewayCtx); err != nil {
		applyGatewayContext(reqCtx, authGatewayCtx)
		handleGatewayAuthError(w, reqCtx, err)
		return
	}
	applyGatewayContext(reqCtx, authGatewayCtx)

	if chatReq.Stream {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadRequest, "streaming_not_supported", "Streaming is not supported in P0.", "parse_openai_compatible_payload")
		return
	}

	if chatReq.Model == "" {
		chatReq.Model = h.DefaultModel
		reqCtx.RequestedModel = h.DefaultModel
	}
	if len(chatReq.Messages) == 0 {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadRequest, "invalid_request_error", "messages is required.", "parse_openai_compatible_payload")
		return
	}
	promptText, err := extractTextPrompt(chatReq.Messages)
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadRequest, "invalid_request_error", "messages content must be text-only.", "parse_openai_compatible_payload")
		return
	}

	gatewayCtx := newGatewayContext(reqCtx, promptText)
	if h.PreProviderPipeline != nil {
		if err := h.PreProviderPipeline.Execute(r.Context(), gatewayCtx); err != nil {
			applyGatewayContext(reqCtx, gatewayCtx)
			writeGatewayPipelineFailure(w, reqCtx, err)
			return
		}
		applyGatewayContext(reqCtx, gatewayCtx)
	}

	if h.Providers == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Providers registry is not initialized.", "resolve_provider_adapter")
		return
	}

	providerName := reqCtx.SelectedProvider
	if providerName == "" {
		providerName = h.DefaultProvider
	}
	adapter, err := h.Providers.Get(providerName)
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway provider is not configured.", "resolve_provider_adapter")
		return
	}

	chatReq.RequestID = requestID
	if reqCtx.SelectedProvider == "" {
		reqCtx.SelectedProvider = adapter.Name()
	}
	if reqCtx.SelectedModel == "" {
		reqCtx.SelectedModel = chatReq.Model
	}
	if reqCtx.RoutingReason == "" {
		reqCtx.RoutingReason = "not_routed"
	}
	chatReq.Model = reqCtx.SelectedModel
	reqCtx.Provider = reqCtx.SelectedProvider
	reqCtx.Model = reqCtx.SelectedModel

	providerStartedAt := time.Now()
	providerResp, err := adapter.CreateChatCompletion(r.Context(), chatReq)
	reqCtx.ProviderLatencyMs = time.Since(providerStartedAt).Milliseconds()
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, "provider_error", "Provider request failed.", "call_provider_with_timeout_retry_fallback")
		return
	}
	if providerResp == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, "provider_error", "Provider returned an empty response.", "call_provider_with_timeout_retry_fallback")
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
		TenantID:         reqCtx.TenantID,
		ProjectID:        reqCtx.ProjectID,
		ApplicationID:    reqCtx.ApplicationID,
		RequestedModel:   reqCtx.RequestedModel,
		SelectedProvider: reqCtx.SelectedProvider,
		SelectedModel:    reqCtx.SelectedModel,
		CacheStatus:      reqCtx.CacheStatus,
		RoutingReason:    reqCtx.RoutingReason,
		MaskingAction:    reqCtx.MaskingAction,
		EstimatedCostUSD: formatCostMicroUSD(reqCtx.CostMicroUSD),
		LatencyMs:        reqCtx.LatencyMs,
	}

	setGatewayHeaders(w, reqCtx)
	writeJSON(w, http.StatusOK, providerResp)
}

func extractBearerToken(header string) (string, bool) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return "", false
	}

	return parts[1], true
}

func handleGatewayAuthError(w http.ResponseWriter, reqCtx *pipeline.RequestContext, err error) {
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		switch {
		case errors.Is(err, context.Canceled):
			gatewayErr = gatewayerrors.RequestCancelled(authenticate.StageName, err)
		case errors.Is(err, context.DeadlineExceeded):
			gatewayErr = gatewayerrors.InternalError(authenticate.StageName, "Gateway authentication timed out.", err)
		default:
			gatewayErr = gatewayerrors.InternalError(authenticate.StageName, "Gateway authentication failed.", err)
		}
	}

	if gatewayErr.HTTPStatus == gatewayerrors.StatusClientClosedRequest || errors.Is(err, context.Canceled) {
		reqCtx.Status = "cancelled"
	} else {
		reqCtx.Status = "error"
	}
	reqCtx.HTTPStatus = gatewayErr.HTTPStatus
	reqCtx.ErrorCode = gatewayErr.Code
	reqCtx.ErrorMessage = gatewayErr.Message
	reqCtx.ErrorStage = gatewayErr.Stage
	reqCtx.CacheStatus = "bypass"
	reqCtx.CacheType = "none"

	logGatewayAuthInternalError(reqCtx, gatewayErr)
	setGatewayHeaders(w, reqCtx)
	writeGatewayError(w, gatewayErr.HTTPStatus, reqCtx.RequestID, gatewayErr.Code, gatewayErr.Message)
}

func logGatewayAuthInternalError(reqCtx *pipeline.RequestContext, gatewayErr gatewayerrors.GatewayError) {
	if gatewayErr.HTTPStatus < http.StatusInternalServerError {
		return
	}

	causeType := "<nil>"
	causeMessage := gatewayErr.Message
	if gatewayErr.Cause != nil {
		causeType = fmt.Sprintf("%T", gatewayErr.Cause)
		causeMessage = sanitizeLogValue(gatewayErr.Cause.Error())
	}

	log.Printf("gateway auth internal error request_id=%s stage=%s code=%s http_status=%d cause_type=%s cause=%q",
		reqCtx.RequestID,
		gatewayErr.Stage,
		gatewayErr.Code,
		gatewayErr.HTTPStatus,
		causeType,
		causeMessage,
	)
}

func sanitizeLogValue(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	return strings.ReplaceAll(value, "\n", " ")
}

func extractTextPrompt(messages []provider.ChatMessage) (string, error) {
	var builder strings.Builder
	for index, message := range messages {
		rawContent := strings.TrimSpace(string(message.Content))
		if rawContent == "" || rawContent == "null" {
			return "", fmt.Errorf("messages[%d].content must be a JSON string", index)
		}

		var content string
		if err := json.Unmarshal(message.Content, &content); err != nil {
			return "", fmt.Errorf("messages[%d].content must be a JSON string: %w", index, err)
		}
		if index > 0 {
			builder.WriteByte('\n')
		}
		builder.WriteString(content)
	}

	return builder.String(), nil
}
