package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	cacheadapter "gatelm/apps/gateway-core/internal/adapters/cache/memory"
	"gatelm/apps/gateway-core/internal/domain/auth"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/request"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/pipeline/stages/appauth"
	"gatelm/apps/gateway-core/internal/pipeline/stages/authenticate"
	cachestage "gatelm/apps/gateway-core/internal/pipeline/stages/cache"
	"gatelm/apps/gateway-core/internal/pipeline/stages/identify"
	routingstage "gatelm/apps/gateway-core/internal/pipeline/stages/routing"
	"gatelm/apps/gateway-core/internal/ports"
)

type APIKeyAuthenticator interface {
	AuthenticateAPIKey(ctx context.Context, bearerToken string) (auth.APIKeyIdentity, error)
}

type AppTokenValidator interface {
	ValidateAppToken(ctx context.Context, appToken string) (auth.AppTokenIdentity, error)
}

type MaskingEngine interface {
	Apply(ctx context.Context, req maskdomain.ApplyRequest) (maskdomain.Result, error)
}

type ExactCacheKeyBuilder interface {
	BuildExactKey(ctx context.Context, material cachekey.KeyMaterial) (string, error)
}

type ChatCompletionsHandler struct {
	Providers               *provider.Registry
	DefaultModel            string
	DefaultProvider         string
	MaxRequestBodyBytes     int64
	APIKeyAuthenticator     APIKeyAuthenticator
	AppTokenValidator       AppTokenValidator
	ExpectedTenantID        string
	ExpectedProjectID       string
	ExpectedAppID           string
	RateLimitPipeline       GatewayPipeline
	PreProviderPipeline     GatewayPipeline
	AuthFailureLogWriter    invocationlog.AuthFailureLogWriter
	TerminalLogWriter       invocationlog.TerminalLogWriter
	MaskingEngine           MaskingEngine
	MetricsRegistry         *metrics.Registry
	ExactCacheStore         ports.CacheStore
	ExactCacheKeyBuilder    ExactCacheKeyBuilder
	ExactCacheTTL           time.Duration
	CachePolicyHash         string
	SecurityPolicyVersionID string
}

func (h *ChatCompletionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.ensureGatewayFlowDefaults()

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
	h.recordGatewayRequestStarted(reqCtx)
	defer func() {
		h.recordGatewayRequestCompleted(reqCtx, startedAt, time.Now())
	}()

	terminalLogEnabled := false
	terminalLogPrompt := ""
	defer func() {
		if terminalLogEnabled {
			h.writeTerminalLog(context.WithoutCancel(r.Context()), reqCtx, terminalLogPrompt, startedAt, time.Now())
		}
	}()

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

	if err := h.authenticateRequest(r.Context(), r, reqCtx); err != nil {
		handleGatewayAuthError(w, reqCtx, err)
		h.writeAuthFailureLog(r.Context(), reqCtx, startedAt, time.Now())
		return
	}
	terminalLogEnabled = true

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

	if h.RateLimitPipeline != nil {
		gatewayCtx := newGatewayContext(reqCtx, "")
		if err := h.RateLimitPipeline.Execute(r.Context(), gatewayCtx); err != nil {
			applyGatewayContext(reqCtx, gatewayCtx)
			writeGatewayPipelineFailure(w, reqCtx, err)
			return
		}
		applyGatewayContext(reqCtx, gatewayCtx)
	}

	maskingResult, redactedMessages, redactedPrompt, err := h.applyMasking(r.Context(), chatReq.Messages, firstNonEmpty(reqCtx.SecurityPolicyHash, reqCtx.SecurityPolicyVersionID))
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway masking failed.", "mask_or_block")
		return
	}
	reqCtx.MaskingAction = string(maskingResult.Action)
	reqCtx.MaskingDetectedTypes = maskingResult.DetectedTypes
	reqCtx.MaskingDetectedCount = maskingResult.DetectedCount
	reqCtx.RedactedPromptPreview = maskingResult.RedactedPromptPreview
	reqCtx.SecurityPolicyVersionID = maskingResult.SecurityPolicyVersionID
	terminalLogPrompt = redactedPrompt

	if maskingResult.Action == maskdomain.ActionBlocked {
		reqCtx.Status = "blocked"
		reqCtx.HTTPStatus = http.StatusForbidden
		reqCtx.ErrorCode = "sensitive_data_blocked"
		reqCtx.ErrorMessage = "Request blocked by GateLM security policy."
		reqCtx.ErrorStage = "mask_or_block"
		reqCtx.CacheStatus = cachestage.CacheStatusBypass
		reqCtx.CacheType = cachestage.CacheTypeNone
		reqCtx.CostMicroUSD = 0
		reqCtx.SavedCostMicroUSD = 0
		reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
		setGatewayHeaders(w, reqCtx)
		writeGatewayErrorWithHeaders(w, http.StatusForbidden, gatewayHeaderValuesFromContext(reqCtx), reqCtx.ErrorCode, reqCtx.ErrorMessage)
		return
	}

	chatReq.Messages = redactedMessages
	promptText = redactedPrompt

	gatewayCtx := newGatewayContext(reqCtx, promptText)
	if h.PreProviderPipeline != nil {
		if err := h.PreProviderPipeline.Execute(r.Context(), gatewayCtx); err != nil {
			applyGatewayContext(reqCtx, gatewayCtx)
			writeGatewayPipelineFailure(w, reqCtx, err)
			return
		}
		applyGatewayContext(reqCtx, gatewayCtx)
	}

	if shouldLookupExactCache(gatewayCtx) {
		cachePayload, cacheHitRequestID, cacheHit := h.lookupExactCache(r.Context(), reqCtx, chatReq, promptText)
		if cacheHit {
			gatewayCtx.Cache.CacheStatus = cachestage.CacheStatusHit
			gatewayCtx.Cache.CacheType = cachestage.CacheTypeExact
			gatewayCtx.Cache.CacheKeyHash = reqCtx.CacheKeyHash
			gatewayCtx.Cache.CacheHitRequestID = cacheHitRequestID
			gatewayCtx.Cache.Payload = cachePayload
		}
	}
	if h.writeCachedChatCompletionIfHit(w, reqCtx, gatewayCtx, chatReq.Model, startedAt) {
		return
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
	ensureCacheDefaults(reqCtx)

	providerStartedAt := time.Now()
	providerResp, err := adapter.CreateChatCompletion(r.Context(), chatReq)
	providerDuration := time.Since(providerStartedAt)
	reqCtx.ProviderLatencyMs = providerDuration.Milliseconds()
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: reqCtx.SelectedProvider,
			SelectedModel:    reqCtx.SelectedModel,
			Status:           "error",
			HTTPStatus:       http.StatusBadGateway,
			ErrorCode:        "provider_error",
			DurationSeconds:  providerDuration.Seconds(),
		})
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, "provider_error", "Provider request failed.", "call_provider_with_timeout_retry_fallback")
		return
	}
	if providerResp == nil {
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: reqCtx.SelectedProvider,
			SelectedModel:    reqCtx.SelectedModel,
			Status:           "error",
			HTTPStatus:       http.StatusBadGateway,
			ErrorCode:        "provider_error",
			DurationSeconds:  providerDuration.Seconds(),
		})
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, "provider_error", "Provider returned an empty response.", "call_provider_with_timeout_retry_fallback")
		return
	}
	h.recordProviderRequest(metrics.ProviderRequest{
		SelectedProvider: reqCtx.SelectedProvider,
		SelectedModel:    reqCtx.SelectedModel,
		Status:           "success",
		HTTPStatus:       http.StatusOK,
		ErrorCode:        "none",
		DurationSeconds:  providerDuration.Seconds(),
	})

	if providerResp.Usage != nil {
		reqCtx.PromptTokens = providerResp.Usage.PromptTokens
		reqCtx.CompletionTokens = providerResp.Usage.CompletionTokens
		reqCtx.TotalTokens = providerResp.Usage.TotalTokens
	}
	reqCtx.Status = "success"
	reqCtx.HTTPStatus = http.StatusOK
	reqCtx.SavedCostMicroUSD = 0
	if reqCtx.CacheStatus == "" || reqCtx.CacheStatus == cachestage.CacheStatusBypass {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeExact
	}

	h.writeExactCache(r.Context(), reqCtx, providerResp)
	attachGateLMMetadata(providerResp, reqCtx)

	setGatewayHeaders(w, reqCtx)
	writeJSON(w, http.StatusOK, providerResp)
}

func shouldLookupExactCache(gatewayCtx *request.GatewayContext) bool {
	if gatewayCtx == nil {
		return true
	}

	switch gatewayCtx.Cache.CacheStatus {
	case "", cachestage.CacheStatusBypass:
		return true
	default:
		return false
	}
}

func (h *ChatCompletionsHandler) ensureGatewayFlowDefaults() {
	if h.MaskingEngine == nil {
		engine := maskdomain.NewP0Engine()
		h.MaskingEngine = engine
	}
	if h.PreProviderPipeline == nil {
		simpleRouter := routingdomain.NewSimpleRouter(routingdomain.SimpleRouterConfig{
			DefaultProvider:     h.DefaultProvider,
			DefaultModel:        h.DefaultModel,
			PolicyHash:          routingdomain.DefaultPolicyHash,
			ShortPromptMaxChars: routingdomain.DefaultShortPromptMaxChars,
		})
		h.PreProviderPipeline = pipeline.New(routingstage.NewStage(simpleRouter))
	}
	if h.ExactCacheTTL <= 0 {
		h.ExactCacheTTL = 10 * time.Minute
	}
	if h.ExactCacheStore == nil {
		h.ExactCacheStore = cacheadapter.NewStore(h.ExactCacheTTL)
	}
	if h.ExactCacheKeyBuilder == nil {
		h.ExactCacheKeyBuilder = cachekey.NewExactKeyBuilder([]byte("cache_key_secret_for_p0_demo_only"))
	}
	if strings.TrimSpace(h.CachePolicyHash) == "" {
		h.CachePolicyHash = "cache_p0_v1"
	}
	if strings.TrimSpace(h.SecurityPolicyVersionID) == "" {
		h.SecurityPolicyVersionID = maskdomain.DefaultSecurityPolicyVersionID
	}
}

func (h *ChatCompletionsHandler) applyMasking(ctx context.Context, messages []provider.ChatMessage, securityPolicyVersionID string) (maskdomain.Result, []provider.ChatMessage, string, error) {
	redactedMessages := make([]provider.ChatMessage, len(messages))
	results := make([]maskdomain.Result, 0, len(messages))
	redactedPromptParts := make([]string, 0, len(messages))
	if strings.TrimSpace(securityPolicyVersionID) == "" {
		securityPolicyVersionID = h.SecurityPolicyVersionID
	}

	for index, message := range messages {
		content, err := chatMessageText(message)
		if err != nil {
			return maskdomain.Result{}, nil, "", err
		}

		result, err := h.MaskingEngine.Apply(ctx, maskdomain.ApplyRequest{
			Prompt:                  content,
			SecurityPolicyVersionID: securityPolicyVersionID,
		})
		if err != nil {
			return maskdomain.Result{}, nil, "", err
		}

		redactedMessages[index] = message
		encodedContent, err := json.Marshal(result.RedactedPrompt)
		if err != nil {
			return maskdomain.Result{}, nil, "", err
		}
		redactedMessages[index].Content = encodedContent
		results = append(results, result)
		redactedPromptParts = append(redactedPromptParts, result.RedactedPrompt)
	}

	combinedPrompt := strings.Join(redactedPromptParts, "\n")
	combined := combineMaskingResults(results, combinedPrompt, securityPolicyVersionID)
	return combined, redactedMessages, combinedPrompt, nil
}

func combineMaskingResults(results []maskdomain.Result, redactedPrompt string, fallbackPolicyVersion string) maskdomain.Result {
	action := maskdomain.ActionNone
	detectedTypeSet := map[string]struct{}{}
	detectedCount := 0
	securityPolicyVersionID := strings.TrimSpace(fallbackPolicyVersion)

	for _, result := range results {
		if result.Action == maskdomain.ActionBlocked {
			action = maskdomain.ActionBlocked
		} else if result.Action == maskdomain.ActionRedacted && action != maskdomain.ActionBlocked {
			action = maskdomain.ActionRedacted
		}
		for _, detectorType := range result.DetectedTypes {
			detectedTypeSet[detectorType] = struct{}{}
		}
		detectedCount += result.DetectedCount
		if result.SecurityPolicyVersionID != "" {
			securityPolicyVersionID = result.SecurityPolicyVersionID
		}
	}
	if securityPolicyVersionID == "" {
		securityPolicyVersionID = maskdomain.DefaultSecurityPolicyVersionID
	}

	detectedTypes := make([]string, 0, len(detectedTypeSet))
	for detectorType := range detectedTypeSet {
		detectedTypes = append(detectedTypes, detectorType)
	}
	sort.Strings(detectedTypes)

	return maskdomain.Result{
		Action:                  action,
		DetectedTypes:           detectedTypes,
		DetectedCount:           detectedCount,
		RedactedPrompt:          redactedPrompt,
		RedactedPromptPreview:   maskdomain.PreviewRedactedPrompt(redactedPrompt),
		SecurityPolicyVersionID: securityPolicyVersionID,
	}
}

func (h *ChatCompletionsHandler) lookupExactCache(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string) ([]byte, string, bool) {
	if reqCtx.MaskingAction == string(maskdomain.ActionBlocked) {
		reqCtx.CacheStatus = cachestage.CacheStatusBypass
		reqCtx.CacheType = cachestage.CacheTypeNone
		return nil, "", false
	}
	if h.ExactCacheStore == nil || h.ExactCacheKeyBuilder == nil {
		reqCtx.CacheStatus = cachestage.CacheStatusBypass
		reqCtx.CacheType = cachestage.CacheTypeNone
		return nil, "", false
	}

	keyHash, err := h.buildExactCacheKey(ctx, reqCtx, chatReq, redactedPrompt)
	if err != nil {
		reqCtx.CacheStatus = cachestage.CacheStatusError
		reqCtx.CacheType = cachestage.CacheTypeExact
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "error")
		return nil, "", false
	}
	reqCtx.CacheKeyHash = keyHash

	lookup, err := h.ExactCacheStore.GetExact(ctx, keyHash)
	if err != nil {
		reqCtx.CacheStatus = cachestage.CacheStatusError
		reqCtx.CacheType = cachestage.CacheTypeExact
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "error")
		return nil, "", false
	}

	if !lookup.Hit {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeExact
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
		return nil, "", false
	}

	reqCtx.CacheStatus = cachestage.CacheStatusHit
	reqCtx.CacheType = cachestage.CacheTypeExact
	h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
	return lookup.Payload, lookup.CacheHitRequestID, true
}

func (h *ChatCompletionsHandler) buildExactCacheKey(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string) (string, error) {
	return h.ExactCacheKeyBuilder.BuildExactKey(ctx, cachekey.KeyMaterial{
		TenantID:                 reqCtx.TenantID,
		ProjectID:                reqCtx.ProjectID,
		ApplicationID:            reqCtx.ApplicationID,
		SelectedProvider:         reqCtx.SelectedProvider,
		SelectedModel:            reqCtx.SelectedModel,
		SecurityPolicyVersionID:  firstNonEmpty(reqCtx.SecurityPolicyHash, reqCtx.SecurityPolicyVersionID),
		RoutingPolicyVersionID:   reqCtx.RoutingPolicyHash,
		CachePolicyHash:          h.CachePolicyHash,
		NormalizedRedactedPrompt: redactedPrompt,
		RequestParamsHash:        requestParamsHash(chatReq),
	})
}

func (h *ChatCompletionsHandler) writeExactCache(ctx context.Context, reqCtx *pipeline.RequestContext, providerResp *provider.ChatCompletionResponse) {
	if h.ExactCacheStore == nil || reqCtx.CacheStatus != cachestage.CacheStatusMiss || reqCtx.CacheKeyHash == "" || providerResp == nil {
		return
	}

	cacheable := *providerResp
	cacheable.GateLM = nil
	cacheable.Raw = nil
	payload, err := json.Marshal(cacheable)
	if err != nil {
		h.recordCacheOperation("write", reqCtx.CacheStatus, cachestage.CacheTypeExact, "error")
		return
	}

	if err := h.ExactCacheStore.SetExact(ctx, ports.CacheEntry{
		KeyHash:   reqCtx.CacheKeyHash,
		RequestID: reqCtx.RequestID,
		Payload:   payload,
	}); err != nil {
		h.recordCacheOperation("write", reqCtx.CacheStatus, cachestage.CacheTypeExact, "error")
		log.Printf("exact cache write failed request_id=%s cache_key_hash=%s cause=%q",
			sanitizeLogValue(reqCtx.RequestID),
			sanitizeLogValue(reqCtx.CacheKeyHash),
			sanitizeLogValue(err.Error()),
		)
		return
	}
	h.recordCacheOperation("write", reqCtx.CacheStatus, cachestage.CacheTypeExact, "success")
}

func (h *ChatCompletionsHandler) writeCachedChatCompletionIfHit(w http.ResponseWriter, reqCtx *pipeline.RequestContext, gatewayCtx *request.GatewayContext, requestedModel string, startedAt time.Time) bool {
	if reqCtx == nil || gatewayCtx == nil || gatewayCtx.Cache.CacheStatus != cachestage.CacheStatusHit {
		return false
	}

	reqCtx.CacheStatus = cachestage.CacheStatusHit
	if gatewayCtx.Cache.CacheType != "" {
		reqCtx.CacheType = gatewayCtx.Cache.CacheType
	} else if reqCtx.CacheType == "" || reqCtx.CacheType == cachestage.CacheTypeNone {
		reqCtx.CacheType = cachestage.CacheTypeExact
	}
	if gatewayCtx.Cache.CacheKeyHash != "" {
		reqCtx.CacheKeyHash = gatewayCtx.Cache.CacheKeyHash
	}

	cachedResp, err := decodeCachedChatCompletionPayload(gatewayCtx.Cache.Payload)
	if err != nil {
		logGatewayCacheDecodeError(reqCtx, err)
		reqCtx.CacheStatus = cachestage.CacheStatusError
		reqCtx.CacheHitRequestID = ""
		if reqCtx.CacheType == "" || reqCtx.CacheType == cachestage.CacheTypeNone {
			reqCtx.CacheType = cachestage.CacheTypeExact
		}
		return false
	}

	if gatewayCtx.Cache.CacheHitRequestID != "" {
		reqCtx.CacheHitRequestID = gatewayCtx.Cache.CacheHitRequestID
	}
	if reqCtx.SelectedProvider == "" {
		reqCtx.SelectedProvider = h.DefaultProvider
	}
	if reqCtx.SelectedModel == "" {
		reqCtx.SelectedModel = requestedModel
	}
	if reqCtx.RoutingReason == "" {
		reqCtx.RoutingReason = "not_routed"
	}
	reqCtx.Provider = reqCtx.SelectedProvider
	reqCtx.Model = reqCtx.SelectedModel
	reqCtx.ProviderLatencyMs = 0
	reqCtx.PromptTokens = 0
	reqCtx.CompletionTokens = 0
	reqCtx.TotalTokens = 0
	reqCtx.CostMicroUSD = 0
	reqCtx.SavedCostMicroUSD = gatewayCtx.Cache.SavedCostMicroUSD
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	reqCtx.Status = "cache_hit"
	reqCtx.HTTPStatus = http.StatusOK

	if reqCtx.SelectedModel != "" {
		cachedResp.Model = reqCtx.SelectedModel
	}
	cachedResp.Usage = &provider.Usage{}
	attachGateLMMetadata(cachedResp, reqCtx)

	setGatewayHeaders(w, reqCtx)
	writeJSON(w, http.StatusOK, cachedResp)
	return true
}

func decodeCachedChatCompletionPayload(payload []byte) (*provider.ChatCompletionResponse, error) {
	if len(bytes.TrimSpace(payload)) == 0 {
		return nil, errors.New("cached chat completion payload is empty")
	}

	var resp provider.ChatCompletionResponse
	if err := json.Unmarshal(payload, &resp); err != nil {
		return nil, fmt.Errorf("decode cached chat completion payload: %w", err)
	}
	if strings.TrimSpace(resp.ID) == "" || resp.Object != "chat.completion" {
		return nil, errors.New("cached chat completion payload has invalid shape")
	}

	return &resp, nil
}

func logGatewayCacheDecodeError(reqCtx *pipeline.RequestContext, err error) {
	if reqCtx == nil || err == nil {
		return
	}

	log.Printf("gateway cache decode error request_id=%s cache_type=%s cache_key_hash=%s error=%q",
		sanitizeLogValue(reqCtx.RequestID),
		sanitizeLogValue(reqCtx.CacheType),
		sanitizeLogValue(reqCtx.CacheKeyHash),
		sanitizeLogValue(err.Error()),
	)
}

func ensureCacheDefaults(reqCtx *pipeline.RequestContext) {
	if reqCtx == nil {
		return
	}
	if reqCtx.CacheStatus == "" {
		reqCtx.CacheStatus = cachestage.CacheStatusBypass
	}
	if reqCtx.CacheType == "" {
		reqCtx.CacheType = cachestage.CacheTypeNone
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func attachGateLMMetadata(resp *provider.ChatCompletionResponse, reqCtx *pipeline.RequestContext) {
	if resp == nil || reqCtx == nil {
		return
	}

	resp.GateLM = &provider.GateLMMetadata{
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
}

func requestParamsHash(chatReq provider.ChatCompletionRequest) string {
	payload, _ := json.Marshal(struct {
		Temperature *float64 `json:"temperature,omitempty"`
		MaxTokens   *int     `json:"maxTokens,omitempty"`
		Stream      bool     `json:"stream"`
	}{
		Temperature: chatReq.Temperature,
		MaxTokens:   chatReq.MaxTokens,
		Stream:      chatReq.Stream,
	})
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func (h *ChatCompletionsHandler) writeAuthFailureLog(ctx context.Context, reqCtx *pipeline.RequestContext, startedAt time.Time, completedAt time.Time) {
	if h.AuthFailureLogWriter == nil || reqCtx == nil || !invocationlog.IsAuthFailure(reqCtx.HTTPStatus, reqCtx.ErrorCode) {
		return
	}

	logStartedAt := time.Now()
	err := h.AuthFailureLogWriter.WriteAuthFailureLog(ctx, invocationlog.BuildAuthFailureLog(invocationlog.AuthFailureInput{
		RequestID:      reqCtx.RequestID,
		TraceID:        reqCtx.TraceID,
		TenantID:       reqCtx.TenantID,
		ProjectID:      reqCtx.ProjectID,
		ApplicationID:  reqCtx.ApplicationID,
		APIKeyID:       reqCtx.APIKeyID,
		AppTokenID:     reqCtx.AppTokenID,
		EndUserID:      reqCtx.EndUserID,
		FeatureID:      reqCtx.FeatureID,
		Endpoint:       reqCtx.Endpoint,
		Method:         reqCtx.Method,
		Source:         invocationlog.SourceCustomerApp,
		Stream:         reqCtx.Stream,
		RequestedModel: reqCtx.RequestedModel,
		HTTPStatus:     reqCtx.HTTPStatus,
		ErrorCode:      reqCtx.ErrorCode,
		ErrorMessage:   reqCtx.ErrorMessage,
		ErrorStage:     reqCtx.ErrorStage,
		StartedAt:      startedAt,
		CompletedAt:    completedAt,
	}))
	h.recordLogWrite("auth_failure", err, time.Since(logStartedAt))
}

func (h *ChatCompletionsHandler) writeTerminalLog(ctx context.Context, reqCtx *pipeline.RequestContext, redactedPrompt string, startedAt time.Time, completedAt time.Time) {
	if h.TerminalLogWriter == nil || reqCtx == nil || !shouldWriteTerminalLog(reqCtx) {
		return
	}

	if reqCtx.LatencyMs == 0 {
		reqCtx.LatencyMs = completedAt.Sub(startedAt).Milliseconds()
	}

	providerLatencyMs := providerLatencyForLog(reqCtx)
	logStartedAt := time.Now()
	err := h.TerminalLogWriter.WriteTerminalLog(ctx, invocationlog.BuildTerminalLog(invocationlog.TerminalLogInput{
		RequestID:               reqCtx.RequestID,
		TraceID:                 reqCtx.TraceID,
		TenantID:                reqCtx.TenantID,
		ProjectID:               reqCtx.ProjectID,
		ApplicationID:           reqCtx.ApplicationID,
		APIKeyID:                reqCtx.APIKeyID,
		AppTokenID:              reqCtx.AppTokenID,
		EndUserID:               reqCtx.EndUserID,
		FeatureID:               reqCtx.FeatureID,
		ConfigHash:              reqCtx.ConfigHash,
		SecurityPolicyHash:      reqCtx.SecurityPolicyHash,
		RateLimitDecision:       reqCtx.RateLimitDecision,
		Endpoint:                reqCtx.Endpoint,
		Method:                  reqCtx.Method,
		Source:                  invocationlog.SourceCustomerApp,
		Stream:                  reqCtx.Stream,
		RequestedProvider:       reqCtx.RequestedProvider,
		RequestedModel:          reqCtx.RequestedModel,
		Provider:                reqCtx.Provider,
		Model:                   reqCtx.Model,
		SelectedProvider:        reqCtx.SelectedProvider,
		SelectedModel:           reqCtx.SelectedModel,
		RoutingReason:           reqCtx.RoutingReason,
		RoutingPolicyHash:       reqCtx.RoutingPolicyHash,
		PromptTokens:            reqCtx.PromptTokens,
		CompletionTokens:        reqCtx.CompletionTokens,
		TotalTokens:             reqCtx.TotalTokens,
		CostMicroUSD:            reqCtx.CostMicroUSD,
		SavedCostMicroUSD:       reqCtx.SavedCostMicroUSD,
		LatencyMs:               reqCtx.LatencyMs,
		ProviderLatencyMs:       providerLatencyMs,
		Status:                  reqCtx.Status,
		HTTPStatus:              reqCtx.HTTPStatus,
		ErrorCode:               reqCtx.ErrorCode,
		ErrorMessage:            reqCtx.ErrorMessage,
		ErrorStage:              reqCtx.ErrorStage,
		CacheStatus:             reqCtx.CacheStatus,
		CacheType:               reqCtx.CacheType,
		CacheKeyHash:            reqCtx.CacheKeyHash,
		CacheHitRequestID:       reqCtx.CacheHitRequestID,
		MaskingAction:           reqCtx.MaskingAction,
		MaskingDetectedTypes:    reqCtx.MaskingDetectedTypes,
		MaskingDetectedCount:    reqCtx.MaskingDetectedCount,
		RedactedPromptPreview:   reqCtx.RedactedPromptPreview,
		SecurityPolicyVersionID: reqCtx.SecurityPolicyVersionID,
		RedactedPromptForHash:   redactedPrompt,
		StartedAt:               startedAt,
		CompletedAt:             completedAt,
	}))
	h.recordLogWrite("terminal", err, time.Since(logStartedAt))
	if err != nil {
		log.Printf("terminal invocation log write failed request_id=%s status=%s cause=%q",
			sanitizeLogValue(reqCtx.RequestID),
			sanitizeLogValue(reqCtx.Status),
			sanitizeLogValue(err.Error()),
		)
	}
}

func shouldWriteTerminalLog(reqCtx *pipeline.RequestContext) bool {
	return reqCtx.Status != "" && reqCtx.HTTPStatus != 0
}

func providerLatencyForLog(reqCtx *pipeline.RequestContext) *int64 {
	if reqCtx == nil || reqCtx.Status == invocationlog.StatusCacheHit || reqCtx.Status == invocationlog.StatusBlocked || reqCtx.Status == invocationlog.StatusRateLimited {
		return nil
	}
	if reqCtx.Provider == "" {
		return nil
	}
	providerLatencyMs := reqCtx.ProviderLatencyMs
	return &providerLatencyMs
}

func (h *ChatCompletionsHandler) recordGatewayRequestStarted(reqCtx *pipeline.RequestContext) {
	if h.MetricsRegistry == nil || reqCtx == nil {
		return
	}
	h.MetricsRegistry.GatewayRequestStarted(reqCtx.Endpoint, reqCtx.Method)
}

func (h *ChatCompletionsHandler) recordGatewayRequestCompleted(reqCtx *pipeline.RequestContext, startedAt time.Time, completedAt time.Time) {
	if h.MetricsRegistry == nil || reqCtx == nil {
		return
	}

	status := reqCtx.Status
	if status == "" {
		status = "error"
	}
	h.MetricsRegistry.GatewayRequestCompleted(metrics.GatewayRequest{
		Endpoint:        reqCtx.Endpoint,
		Method:          reqCtx.Method,
		Status:          status,
		HTTPStatus:      reqCtx.HTTPStatus,
		ErrorCode:       reqCtx.ErrorCode,
		DurationSeconds: completedAt.Sub(startedAt).Seconds(),
	})

	if reqCtx.RateLimitDecision != nil {
		h.MetricsRegistry.RateLimitDecision(metrics.RateLimitDecision{
			Allowed:         reqCtx.RateLimitDecision.Allowed,
			Reason:          reqCtx.RateLimitDecision.Reason,
			DurationSeconds: float64(reqCtx.RateLimitDecision.DurationMS) / 1000,
		})
	}
	if reqCtx.MaskingAction != "" {
		h.MetricsRegistry.MaskingAction(reqCtx.MaskingAction)
	}
}

func (h *ChatCompletionsHandler) recordProviderRequest(request metrics.ProviderRequest) {
	if h.MetricsRegistry == nil {
		return
	}
	h.MetricsRegistry.ProviderRequest(request)
}

func (h *ChatCompletionsHandler) recordCacheOperation(operation string, cacheStatus string, cacheType string, status string) {
	if h.MetricsRegistry == nil {
		return
	}
	h.MetricsRegistry.CacheOperation(metrics.CacheOperation{
		Operation:   operation,
		CacheStatus: cacheStatus,
		CacheType:   cacheType,
		Status:      status,
	})
}

func (h *ChatCompletionsHandler) recordLogWrite(operation string, err error, duration time.Duration) {
	if h.MetricsRegistry == nil {
		return
	}

	status := "success"
	if err != nil {
		status = "error"
	}
	h.MetricsRegistry.LogWrite(metrics.LogWrite{
		Operation:       operation,
		Status:          status,
		DurationSeconds: duration.Seconds(),
	})
}

func (h *ChatCompletionsHandler) authenticateRequest(ctx context.Context, r *http.Request, reqCtx *pipeline.RequestContext) error {
	if h.APIKeyAuthenticator == nil || h.AppTokenValidator == nil {
		return gatewayerrors.InternalError(authenticate.StageName, "Gateway authentication is not initialized.", nil)
	}

	bearerToken, ok := extractBearerToken(r.Header.Get("Authorization"))
	if !ok {
		return gatewayerrors.InvalidAPIKey(authenticate.StageName)
	}
	appToken := strings.TrimSpace(r.Header.Get("X-GateLM-App-Token"))
	if appToken == "" {
		return gatewayerrors.InvalidAppToken(appauth.StageName)
	}

	apiKeyIdentity, err := h.APIKeyAuthenticator.AuthenticateAPIKey(ctx, bearerToken)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidAPIKey) {
			return gatewayerrors.InvalidAPIKey(authenticate.StageName)
		}
		return err
	}

	reqCtx.APIKeyID = apiKeyIdentity.APIKeyID
	reqCtx.TenantID = apiKeyIdentity.TenantID
	reqCtx.ProjectID = apiKeyIdentity.ProjectID
	if apiKeyIdentity.ApplicationID != "" {
		reqCtx.ApplicationID = apiKeyIdentity.ApplicationID
	}

	appTokenIdentity, err := h.AppTokenValidator.ValidateAppToken(ctx, appToken)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidAppToken) {
			return gatewayerrors.InvalidAppToken(appauth.StageName)
		}
		return err
	}

	if reqCtx.TenantID != "" && reqCtx.TenantID != appTokenIdentity.TenantID {
		return gatewayerrors.ScopeMismatch(appauth.StageName)
	}
	if reqCtx.ProjectID != "" && reqCtx.ProjectID != appTokenIdentity.ProjectID {
		return gatewayerrors.ScopeMismatch(appauth.StageName)
	}
	if reqCtx.ApplicationID != "" && reqCtx.ApplicationID != appTokenIdentity.ApplicationID {
		return gatewayerrors.ScopeMismatch(appauth.StageName)
	}

	reqCtx.AppTokenID = appTokenIdentity.AppTokenID
	if reqCtx.TenantID == "" {
		reqCtx.TenantID = appTokenIdentity.TenantID
	}
	if reqCtx.ProjectID == "" {
		reqCtx.ProjectID = appTokenIdentity.ProjectID
	}
	if reqCtx.ApplicationID == "" {
		reqCtx.ApplicationID = appTokenIdentity.ApplicationID
	}

	if h.ExpectedTenantID != "" && reqCtx.TenantID != h.ExpectedTenantID {
		return gatewayerrors.ScopeMismatch(identify.StageName)
	}
	if h.ExpectedProjectID != "" && reqCtx.ProjectID != h.ExpectedProjectID {
		return gatewayerrors.ScopeMismatch(identify.StageName)
	}
	if h.ExpectedAppID != "" && reqCtx.ApplicationID != h.ExpectedAppID {
		return gatewayerrors.ScopeMismatch(identify.StageName)
	}

	return nil
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
	reqCtx.CacheStatus = cachestage.CacheStatusBypass
	reqCtx.CacheType = cachestage.CacheTypeNone

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
		sanitizeLogValue(reqCtx.RequestID),
		sanitizeLogValue(gatewayErr.Stage),
		sanitizeLogValue(gatewayErr.Code),
		gatewayErr.HTTPStatus,
		sanitizeLogValue(causeType),
		causeMessage,
	)
}

func sanitizeLogValue(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	return strings.ReplaceAll(value, "\n", " ")
}

func chatMessageText(message provider.ChatMessage) (string, error) {
	rawContent := strings.TrimSpace(string(message.Content))
	if rawContent == "" || rawContent == "null" {
		return "", fmt.Errorf("message content must be a JSON string")
	}

	var content string
	if err := json.Unmarshal(message.Content, &content); err != nil {
		return "", fmt.Errorf("message content must be a JSON string: %w", err)
	}
	return content, nil
}

func extractTextPrompt(messages []provider.ChatMessage) (string, error) {
	var builder strings.Builder
	for index, message := range messages {
		content, err := chatMessageText(message)
		if err != nil {
			return "", fmt.Errorf("messages[%d].content must be a JSON string: %w", index, err)
		}
		if index > 0 {
			builder.WriteByte('\n')
		}
		builder.WriteString(content)
	}

	return builder.String(), nil
}
