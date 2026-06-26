package handlers

import (
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
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/provider"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/pipeline/stages/appauth"
	"gatelm/apps/gateway-core/internal/pipeline/stages/authenticate"
	"gatelm/apps/gateway-core/internal/pipeline/stages/identify"
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

type RouteDecider interface {
	DecideRoute(ctx context.Context, req routingdomain.Request) (routingdomain.Decision, error)
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
	PreProviderPipeline     GatewayPipeline
	MaskingEngine           MaskingEngine
	Router                  RouteDecider
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
		return
	}

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

	maskingResult, redactedMessages, redactedPrompt, err := h.applyMasking(r.Context(), chatReq.Messages)
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway masking failed.", "mask_or_block")
		return
	}
	reqCtx.MaskingAction = string(maskingResult.Action)
	reqCtx.MaskingDetectedTypes = maskingResult.DetectedTypes
	reqCtx.MaskingDetectedCount = maskingResult.DetectedCount
	reqCtx.RedactedPromptPreview = maskingResult.RedactedPromptPreview
	reqCtx.SecurityPolicyVersionID = maskingResult.SecurityPolicyVersionID

	if maskingResult.Action == maskdomain.ActionBlocked {
		reqCtx.Status = "blocked"
		reqCtx.HTTPStatus = http.StatusForbidden
		reqCtx.ErrorCode = "sensitive_data_blocked"
		reqCtx.ErrorMessage = "Request blocked by GateLM security policy."
		reqCtx.ErrorStage = "mask_or_block"
		reqCtx.CacheStatus = "bypass"
		reqCtx.CacheType = "none"
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

	if err := h.ensureRouting(r.Context(), reqCtx, promptText); err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway routing failed.", "decide_model_route")
		return
	}

	cachePayload, cacheHit := h.lookupExactCache(r.Context(), reqCtx, chatReq, promptText)
	if cacheHit {
		var cachedResp provider.ChatCompletionResponse
		if err := json.Unmarshal(cachePayload, &cachedResp); err != nil {
			reqCtx.CacheStatus = "error"
			reqCtx.CacheType = "exact"
		} else {
			reqCtx.Status = "cache_hit"
			reqCtx.HTTPStatus = http.StatusOK
			reqCtx.CostMicroUSD = 0
			reqCtx.Provider = reqCtx.SelectedProvider
			reqCtx.Model = reqCtx.SelectedModel
			reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
			h.attachGateLMMetadata(&cachedResp, reqCtx)
			setGatewayHeaders(w, reqCtx)
			writeJSON(w, http.StatusOK, cachedResp)
			return
		}
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
	if reqCtx.CacheStatus == "" || reqCtx.CacheStatus == "bypass" {
		reqCtx.CacheStatus = "miss"
		reqCtx.CacheType = "exact"
	}

	h.writeExactCache(r.Context(), reqCtx, providerResp)
	h.attachGateLMMetadata(providerResp, reqCtx)

	setGatewayHeaders(w, reqCtx)
	writeJSON(w, http.StatusOK, providerResp)
}

func (h *ChatCompletionsHandler) ensureGatewayFlowDefaults() {
	if h.MaskingEngine == nil {
		engine := maskdomain.NewP0Engine()
		h.MaskingEngine = engine
	}
	if h.Router == nil {
		router := routingdomain.NewP0SimpleRouter(h.DefaultProvider, h.DefaultModel)
		h.Router = router
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

func (h *ChatCompletionsHandler) applyMasking(ctx context.Context, messages []provider.ChatMessage) (maskdomain.Result, []provider.ChatMessage, string, error) {
	redactedMessages := make([]provider.ChatMessage, len(messages))
	results := make([]maskdomain.Result, 0, len(messages))
	redactedPromptParts := make([]string, 0, len(messages))

	for index, message := range messages {
		content, err := chatMessageText(message)
		if err != nil {
			return maskdomain.Result{}, nil, "", err
		}

		result, err := h.MaskingEngine.Apply(ctx, maskdomain.ApplyRequest{
			Prompt:                  content,
			SecurityPolicyVersionID: h.SecurityPolicyVersionID,
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
	combined := combineMaskingResults(results, combinedPrompt, h.SecurityPolicyVersionID)
	return combined, redactedMessages, combinedPrompt, nil
}

func combineMaskingResults(results []maskdomain.Result, redactedPrompt string, fallbackPolicyVersion string) maskdomain.Result {
	action := maskdomain.ActionNone
	detectedTypeSet := map[string]struct{}{}
	detectedCount := 0
	securityPolicyVersionID := strings.TrimSpace(fallbackPolicyVersion)
	if securityPolicyVersionID == "" {
		securityPolicyVersionID = maskdomain.DefaultSecurityPolicyVersionID
	}

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
		RedactedPromptPreview:   redactedPrompt,
		SecurityPolicyVersionID: securityPolicyVersionID,
	}
}

func (h *ChatCompletionsHandler) ensureRouting(ctx context.Context, reqCtx *pipeline.RequestContext, promptText string) error {
	if reqCtx.SelectedProvider != "" && reqCtx.SelectedModel != "" {
		if reqCtx.RoutingPolicyHash == "" {
			reqCtx.RoutingPolicyHash = routingdomain.DefaultPolicyHash
		}
		return nil
	}

	decision, err := h.Router.DecideRoute(ctx, routingdomain.Request{
		RequestedModel: reqCtx.RequestedModel,
		PromptText:     promptText,
	})
	if err != nil {
		return err
	}

	if decision.RequestedModel != "" {
		reqCtx.RequestedModel = decision.RequestedModel
	}
	reqCtx.SelectedProvider = decision.SelectedProvider
	reqCtx.SelectedModel = decision.SelectedModel
	reqCtx.RoutingReason = decision.RoutingReason
	reqCtx.RoutingPolicyHash = decision.PolicyHash
	return nil
}

func (h *ChatCompletionsHandler) lookupExactCache(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string) ([]byte, bool) {
	if reqCtx.MaskingAction == string(maskdomain.ActionBlocked) {
		reqCtx.CacheStatus = "bypass"
		reqCtx.CacheType = "none"
		return nil, false
	}
	if h.ExactCacheStore == nil || h.ExactCacheKeyBuilder == nil {
		reqCtx.CacheStatus = "bypass"
		reqCtx.CacheType = "none"
		return nil, false
	}

	keyHash, err := h.buildExactCacheKey(ctx, reqCtx, chatReq, redactedPrompt)
	if err != nil {
		reqCtx.CacheStatus = "error"
		reqCtx.CacheType = "exact"
		return nil, false
	}
	reqCtx.CacheKeyHash = keyHash

	lookup, err := h.ExactCacheStore.GetExact(ctx, keyHash)
	if err != nil {
		reqCtx.CacheStatus = "error"
		reqCtx.CacheType = "exact"
		return nil, false
	}

	if !lookup.Hit {
		reqCtx.CacheStatus = "miss"
		reqCtx.CacheType = "exact"
		return nil, false
	}

	reqCtx.CacheStatus = "hit"
	reqCtx.CacheType = "exact"
	reqCtx.CacheHitRequestID = lookup.CacheHitRequestID
	return lookup.Payload, true
}

func (h *ChatCompletionsHandler) buildExactCacheKey(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string) (string, error) {
	return h.ExactCacheKeyBuilder.BuildExactKey(ctx, cachekey.KeyMaterial{
		TenantID:                 reqCtx.TenantID,
		ProjectID:                reqCtx.ProjectID,
		ApplicationID:            reqCtx.ApplicationID,
		SelectedProvider:         reqCtx.SelectedProvider,
		SelectedModel:            reqCtx.SelectedModel,
		SecurityPolicyVersionID:  reqCtx.SecurityPolicyVersionID,
		RoutingPolicyVersionID:   reqCtx.RoutingPolicyHash,
		CachePolicyHash:          h.CachePolicyHash,
		NormalizedRedactedPrompt: redactedPrompt,
		RequestParamsHash:        requestParamsHash(chatReq),
	})
}

func (h *ChatCompletionsHandler) writeExactCache(ctx context.Context, reqCtx *pipeline.RequestContext, providerResp *provider.ChatCompletionResponse) {
	if h.ExactCacheStore == nil || reqCtx.CacheStatus != "miss" || reqCtx.CacheKeyHash == "" || providerResp == nil {
		return
	}

	cacheable := *providerResp
	cacheable.GateLM = nil
	cacheable.Raw = nil
	payload, err := json.Marshal(cacheable)
	if err != nil {
		return
	}

	_ = h.ExactCacheStore.SetExact(ctx, ports.CacheEntry{
		KeyHash:   reqCtx.CacheKeyHash,
		RequestID: reqCtx.RequestID,
		Payload:   payload,
	})
}

func (h *ChatCompletionsHandler) attachGateLMMetadata(providerResp *provider.ChatCompletionResponse, reqCtx *pipeline.RequestContext) {
	if providerResp == nil || reqCtx == nil {
		return
	}

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

func (h ChatCompletionsHandler) authenticateRequest(ctx context.Context, r *http.Request, reqCtx *pipeline.RequestContext) error {
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
