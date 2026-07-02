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
	"gatelm/apps/gateway-core/internal/domain/budget"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/credentials"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/request"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
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

type SemanticCacheService interface {
	Enabled() bool
	Threshold() float64
	PolicyVersion() string
	EmbeddingProviderName() string
	Search(ctx context.Context, request cachekey.SemanticCacheLookupRequest) (cachekey.SemanticCacheSearchResult, cachekey.SemanticCacheDecision, error)
	Upsert(ctx context.Context, request cachekey.SemanticCacheStoreRequest) (cachekey.SemanticCacheDecision, error)
}

type ChatCompletionsHandler struct {
	Providers                    *provider.Registry
	ProviderCatalogResolver      providercatalog.Resolver
	CredentialResolver           credentials.Resolver
	DefaultModel                 string
	DefaultProvider              string
	MaxRequestBodyBytes          int64
	APIKeyAuthenticator          APIKeyAuthenticator
	AppTokenValidator            AppTokenValidator
	ExpectedTenantID             string
	ExpectedProjectID            string
	ExpectedAppID                string
	RuntimePolicyPipeline        GatewayPipeline
	RateLimitPipeline            GatewayPipeline
	PreProviderPipeline          GatewayPipeline
	AuthFailureLogWriter         invocationlog.AuthFailureLogWriter
	TerminalLogWriter            invocationlog.TerminalLogWriter
	MaskingEngine                MaskingEngine
	MetricsRegistry              *metrics.Registry
	ExactCacheStore              ports.CacheStore
	ExactCacheKeyBuilder         ExactCacheKeyBuilder
	ExactCacheTTL                time.Duration
	CachePolicyHash              string
	SecurityPolicyVersionID      string
	SemanticCacheService         SemanticCacheService
	SemanticCacheAllowCategories []string
	SemanticCacheDenyCategories  []string
	SemanticCachePolicyVersion   string
	SemanticCacheKeyVersion      string
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

	if runtimePolicyPipeline := h.runtimePolicyPipeline(); runtimePolicyPipeline != nil {
		gatewayCtx := newGatewayContext(reqCtx, "")
		if err := runtimePolicyPipeline.Execute(r.Context(), gatewayCtx); err != nil {
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
	if maskingResult.Action == maskdomain.ActionNone {
		reqCtx.RedactedPromptPreview = ""
	} else {
		reqCtx.RedactedPromptPreview = maskingResult.RedactedPromptPreview
	}
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
		h.markSemanticCacheBypass(reqCtx, "safety_blocked", cachekey.SemanticCacheCategorySensitive)
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
			if isPreCacheGatewayError(err) {
				gatewayCtx.BypassCache()
			}
			applyGatewayContext(reqCtx, gatewayCtx)
			writeGatewayPipelineFailure(w, reqCtx, err)
			return
		}
		applyGatewayContext(reqCtx, gatewayCtx)
	}

	if reqCtx.Stream {
		bypassExactCache(reqCtx, "streaming_request")
		gatewayCtx = newGatewayContext(reqCtx, promptText)
	} else if shouldLookupExactCache(gatewayCtx) {
		if err := h.populateRoutingAwareCacheIdentity(r.Context(), reqCtx, chatReq.Model); err != nil {
			h.writeProviderResolutionFailure(w, reqCtx, err)
			return
		}
		gatewayCtx = newGatewayContext(reqCtx, promptText)
		cachePayload, cacheHitRequestID, cacheHit := h.lookupExactCache(r.Context(), reqCtx, chatReq, promptText)
		applyExactCacheLookupToGatewayContext(gatewayCtx, reqCtx, cachePayload, cacheHitRequestID, cacheHit)
	}
	if h.writeCachedChatCompletionIfHit(r.Context(), w, reqCtx, gatewayCtx, startedAt) {
		return
	}
	if h.writeSemanticCachedChatCompletionIfHit(r.Context(), w, reqCtx, chatReq, promptText, startedAt) {
		return
	}

	if h.Providers == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Providers registry is not initialized.", "resolve_provider_adapter")
		return
	}

	target, err := h.resolveProviderCallTarget(r.Context(), reqCtx, chatReq.Model)
	if err != nil {
		h.writeProviderResolutionFailure(w, reqCtx, err)
		return
	}

	providerReq := chatReq
	providerReq.RequestID = requestID
	providerReq.Stream = false
	reqCtx.SelectedProvider = target.ProviderName
	reqCtx.SelectedProviderID = target.ProviderID
	reqCtx.SelectedProviderCatalogKey = firstNonEmpty(reqCtx.SelectedProviderCatalogKey, target.ProviderName)
	reqCtx.SelectedModel = target.ModelID
	reqCtx.SelectedModelID = target.ModelID
	reqCtx.ProviderCatalogContentHash = firstNonEmpty(reqCtx.ProviderCatalogContentHash, target.CatalogHash)
	if reqCtx.RoutingReason == "" {
		reqCtx.RoutingReason = "not_routed"
	}
	providerReq.Model = target.ModelName
	reqCtx.Provider = reqCtx.SelectedProvider
	reqCtx.Model = reqCtx.SelectedModel
	ensureCacheDefaults(reqCtx)

	providerStartedAt := time.Now()
	providerResp, err := target.Adapter.CreateChatCompletion(r.Context(), target.ExecutionConfig, providerReq)
	providerDuration := time.Since(providerStartedAt)
	reqCtx.ProviderLatencyMs = providerDuration.Milliseconds()
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		h.markSemanticCacheBypass(reqCtx, "provider_error_store_bypassed", h.semanticPromptCategory(reqCtx))
		h.handleProviderFailure(w, r, reqCtx, providerReq, target, err, providerDuration, startedAt)
		return
	}
	if providerResp == nil {
		h.markSemanticCacheBypass(reqCtx, "provider_error_store_bypassed", h.semanticPromptCategory(reqCtx))
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: reqCtx.SelectedProvider,
			SelectedModel:    reqCtx.SelectedModel,
			Status:           invocationlog.StatusFailed,
			HTTPStatus:       http.StatusBadGateway,
			ErrorCode:        provider.ErrorCodeProviderError,
			DurationSeconds:  providerDuration.Seconds(),
		})
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, provider.ErrorCodeProviderError, "Provider returned an empty response.", "call_provider_with_timeout_retry_fallback")
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
	if exactCachePolicyAllowsLookup(reqCtx) && (reqCtx.CacheStatus == "" || reqCtx.CacheStatus == cachestage.CacheStatusBypass) {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeExact
	}

	h.writeExactCache(r.Context(), reqCtx, providerResp)
	h.writeSemanticCache(r.Context(), reqCtx, chatReq, promptText, providerResp)
	h.writeChatCompletionResponse(r.Context(), w, reqCtx, providerResp)
}

func shouldLookupExactCache(gatewayCtx *request.GatewayContext) bool {
	if gatewayCtx == nil {
		return true
	}
	if gatewayCtx.Request.Stream {
		return false
	}
	if !gatewayExactCachePolicyAllowsLookup(gatewayCtx) {
		return false
	}

	switch gatewayCtx.Cache.CacheStatus {
	case "", cachestage.CacheStatusBypass:
		return true
	default:
		return false
	}
}

func bypassExactCache(reqCtx *pipeline.RequestContext, reason string) {
	if reqCtx == nil {
		return
	}
	reqCtx.CacheStatus = cachestage.CacheStatusBypass
	reqCtx.CacheType = cachestage.CacheTypeNone
	reqCtx.CacheKeyHash = ""
	reqCtx.CacheHitRequestID = ""
	reqCtx.CacheKeyVersion = ""
	reqCtx.CacheDecisionReason = firstNonEmpty(reason, "bypassed")
}

func skipExactCacheStore(reqCtx *pipeline.RequestContext, reason string) {
	if reqCtx == nil {
		return
	}
	reqCtx.CacheStatus = cachestage.CacheStatusStoreSkipped
	reqCtx.CacheType = cachestage.CacheTypeExact
	reqCtx.CacheDecisionReason = firstNonEmpty(reason, "store_skipped")
}

func gatewayExactCachePolicyAllowsLookup(gatewayCtx *request.GatewayContext) bool {
	if gatewayCtx == nil || !gatewayCtx.Runtime.HasCachePolicy {
		return true
	}
	return cachePolicyAllowsExact(gatewayCtx.Runtime.CachePolicy)
}

func isPreCacheGatewayError(err error) bool {
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		return false
	}
	switch gatewayErr.Code {
	case "invalid_api_key", "invalid_app_token", "scope_mismatch":
		return true
	default:
		return false
	}
}

func applyExactCacheLookupToGatewayContext(gatewayCtx *request.GatewayContext, reqCtx *pipeline.RequestContext, payload []byte, cacheHitRequestID string, hit bool) {
	if gatewayCtx == nil || reqCtx == nil {
		return
	}

	gatewayCtx.Cache.CacheStatus = reqCtx.CacheStatus
	gatewayCtx.Cache.CacheType = reqCtx.CacheType
	gatewayCtx.Cache.CacheKeyHash = reqCtx.CacheKeyHash
	gatewayCtx.Cache.CacheHitRequestID = ""
	gatewayCtx.Cache.CacheKeyVersion = reqCtx.CacheKeyVersion
	gatewayCtx.Cache.CacheDecisionReason = reqCtx.CacheDecisionReason
	gatewayCtx.Cache.FallbackOccurred = reqCtx.FallbackOccurred
	gatewayCtx.Cache.Payload = nil
	if hit {
		gatewayCtx.Cache.CacheStatus = cachestage.CacheStatusHit
		gatewayCtx.Cache.CacheType = cachestage.CacheTypeExact
		gatewayCtx.Cache.CacheHitRequestID = cacheHitRequestID
		gatewayCtx.Cache.Payload = payload
	}
}

func exactCachePolicyAllowsLookup(reqCtx *pipeline.RequestContext) bool {
	if reqCtx == nil {
		return false
	}
	if reqCtx.Stream {
		return false
	}
	if !reqCtx.HasRuntimeCachePolicy {
		return true
	}
	return cachePolicyAllowsExact(reqCtx.RuntimeCachePolicy)
}

func cachePolicyAllowsExact(policy runtimeconfig.CachePolicy) bool {
	return policy.Enabled && strings.EqualFold(strings.TrimSpace(policy.Type), runtimeconfig.CacheTypeExact)
}

func (h *ChatCompletionsHandler) runtimePolicyPipeline() GatewayPipeline {
	if h == nil {
		return nil
	}
	if h.RuntimePolicyPipeline != nil {
		return h.RuntimePolicyPipeline
	}
	return h.RateLimitPipeline
}

type providerCallTarget struct {
	Adapter         provider.Adapter
	ExecutionConfig provider.ExecutionConfig
	Catalog         providercatalog.Catalog
	ProviderID      string
	ProviderName    string
	AdapterType     string
	ModelID         string
	ModelName       string
	CatalogHash     string
	FromCatalog     bool
	Fallback        bool
}

type providerResolutionFailure struct {
	httpStatus int
	code       string
	message    string
	stage      string
	err        error
}

func (e providerResolutionFailure) Error() string {
	if e.err != nil {
		return e.err.Error()
	}
	return e.code
}

func (h *ChatCompletionsHandler) resolveProviderCallTarget(ctx context.Context, reqCtx *pipeline.RequestContext, requestedModel string) (providerCallTarget, error) {
	ref := reqCtx.RuntimeSnapshot.ProviderCatalogRef.Normalize()
	if h.ProviderCatalogResolver == nil && ref.IsZero() {
		return h.resolveLegacyProviderCallTarget(reqCtx, requestedModel)
	}
	if h.ProviderCatalogResolver == nil {
		return providerCallTarget{}, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Provider catalog is unavailable.",
			stage:      "resolve_provider_catalog",
			err:        providercatalog.ErrUnavailable,
		}
	}

	catalog, err := h.ProviderCatalogResolver.GetCatalog(ctx, ref, providercatalog.Scope{
		TenantID:      reqCtx.TenantID,
		ProjectID:     reqCtx.ProjectID,
		ApplicationID: reqCtx.ApplicationID,
	})
	if err != nil {
		code := "provider_catalog_unavailable"
		if errors.Is(err, providercatalog.ErrMismatch) {
			code = "provider_catalog_mismatch"
		}
		return providerCallTarget{}, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       code,
			message:    "Provider catalog could not be verified.",
			stage:      "resolve_provider_catalog",
			err:        err,
		}
	}
	catalog = catalog.Normalize()
	if !catalog.Matches(ref) {
		return providerCallTarget{}, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_mismatch",
			message:    "Provider catalog reference mismatch.",
			stage:      "resolve_provider_catalog",
			err:        providercatalog.ErrMismatch,
		}
	}

	providerName := firstNonEmpty(reqCtx.SelectedProvider, h.DefaultProvider)
	catalogProvider, err := catalog.ProviderByName(providerName)
	if err != nil {
		return providerCallTarget{}, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Gateway provider is not configured.",
			stage:      "resolve_provider_catalog",
			err:        err,
		}
	}

	modelID := firstNonEmpty(reqCtx.SelectedModel, requestedModel, h.DefaultModel)
	catalogModel, err := catalogProvider.ModelByID(modelID)
	if err != nil {
		return providerCallTarget{}, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Gateway provider model is not configured.",
			stage:      "resolve_provider_catalog",
			err:        err,
		}
	}

	reqCtx.SelectedProvider = catalogProvider.ProviderName
	reqCtx.SelectedProviderID = catalogProvider.ProviderID
	reqCtx.SelectedProviderCatalogKey = catalogProvider.ProviderName
	reqCtx.SelectedModel = catalogModel.ModelID
	reqCtx.SelectedModelID = catalogModel.ModelID
	reqCtx.ProviderCatalogContentHash = catalog.ContentHash
	reqCtx.Provider = catalogProvider.ProviderName
	reqCtx.Model = catalogModel.ModelID
	return h.providerCallTargetFromCatalog(ctx, catalog, catalogProvider, catalogModel, false)
}

func (h *ChatCompletionsHandler) populateRoutingAwareCacheIdentity(ctx context.Context, reqCtx *pipeline.RequestContext, requestedModel string) error {
	if reqCtx == nil {
		return nil
	}
	ref := reqCtx.RuntimeSnapshot.ProviderCatalogRef.Normalize()
	if h.ProviderCatalogResolver == nil && ref.IsZero() {
		reqCtx.SelectedProviderCatalogKey = firstNonEmpty(reqCtx.SelectedProviderCatalogKey, reqCtx.SelectedProvider, h.DefaultProvider)
		reqCtx.SelectedModelID = firstNonEmpty(reqCtx.SelectedModelID, reqCtx.SelectedModel, requestedModel, h.DefaultModel)
		reqCtx.SelectedModel = firstNonEmpty(reqCtx.SelectedModel, reqCtx.SelectedModelID)
		reqCtx.ProviderCatalogContentHash = firstNonEmpty(reqCtx.ProviderCatalogContentHash, ref.ContentHash, "legacy-provider-catalog-v1")
		if reqCtx.RoutingDecisionKeyHash == "" {
			reqCtx.RoutingDecisionKeyHash = routingDecisionKeyHashFromRequestContext(reqCtx)
		}
		return nil
	}
	if h.ProviderCatalogResolver == nil {
		return providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Provider catalog is unavailable.",
			stage:      "resolve_provider_catalog",
			err:        providercatalog.ErrUnavailable,
		}
	}
	catalog, err := h.ProviderCatalogResolver.GetCatalog(ctx, ref, providercatalog.Scope{
		TenantID:      reqCtx.TenantID,
		ProjectID:     reqCtx.ProjectID,
		ApplicationID: reqCtx.ApplicationID,
	})
	if err != nil {
		code := "provider_catalog_unavailable"
		if errors.Is(err, providercatalog.ErrMismatch) {
			code = "provider_catalog_mismatch"
		}
		return providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       code,
			message:    "Provider catalog could not be verified.",
			stage:      "resolve_provider_catalog",
			err:        err,
		}
	}
	catalog = catalog.Normalize()
	if !catalog.Matches(ref) {
		return providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_mismatch",
			message:    "Provider catalog reference mismatch.",
			stage:      "resolve_provider_catalog",
			err:        providercatalog.ErrMismatch,
		}
	}
	providerName := firstNonEmpty(reqCtx.SelectedProvider, h.DefaultProvider)
	catalogProvider, err := catalog.ProviderByName(providerName)
	if err != nil {
		return providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Gateway provider is not configured.",
			stage:      "resolve_provider_catalog",
			err:        err,
		}
	}
	modelID := firstNonEmpty(reqCtx.SelectedModel, requestedModel, h.DefaultModel)
	catalogModel, err := catalogProvider.ModelByID(modelID)
	if err != nil {
		return providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Gateway provider model is not configured.",
			stage:      "resolve_provider_catalog",
			err:        err,
		}
	}
	reqCtx.SelectedProvider = catalogProvider.ProviderName
	reqCtx.SelectedProviderID = catalogProvider.ProviderID
	reqCtx.SelectedProviderCatalogKey = catalogProvider.ProviderName
	reqCtx.SelectedModel = catalogModel.ModelID
	reqCtx.SelectedModelID = catalogModel.ModelID
	reqCtx.ProviderCatalogContentHash = catalog.ContentHash
	if reqCtx.RoutingDecisionKeyHash == "" {
		reqCtx.RoutingDecisionKeyHash = routingDecisionKeyHashFromRequestContext(reqCtx)
	}
	return nil
}

func (h *ChatCompletionsHandler) resolveLegacyProviderCallTarget(reqCtx *pipeline.RequestContext, requestedModel string) (providerCallTarget, error) {
	providerName := firstNonEmpty(reqCtx.SelectedProvider, h.DefaultProvider)
	adapter, err := h.Providers.Get(providerName)
	if err != nil {
		return providerCallTarget{}, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "internal_error",
			message:    "Gateway provider is not configured.",
			stage:      "resolve_provider_adapter",
			err:        err,
		}
	}
	modelID := firstNonEmpty(reqCtx.SelectedModel, requestedModel, h.DefaultModel)
	return providerCallTarget{
		Adapter:      adapter,
		ProviderName: firstNonEmpty(providerName, adapter.AdapterType()),
		AdapterType:  adapter.AdapterType(),
		ModelID:      modelID,
		ModelName:    modelID,
		CatalogHash:  "legacy-provider-catalog-v1",
		ExecutionConfig: provider.ExecutionConfig{
			ProviderName: firstNonEmpty(providerName, adapter.AdapterType()),
			AdapterType:  adapter.AdapterType(),
		},
	}, nil
}

func (h *ChatCompletionsHandler) providerCallTargetFromCatalog(ctx context.Context, catalog providercatalog.Catalog, catalogProvider providercatalog.Provider, catalogModel providercatalog.Model, fallback bool) (providerCallTarget, error) {
	adapter, err := h.Providers.Get(catalogProvider.AdapterType)
	if err != nil {
		return providerCallTarget{}, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "internal_error",
			message:    "Gateway provider adapter is not configured.",
			stage:      "resolve_provider_adapter",
			err:        err,
		}
	}

	var resolvedCredential *provider.ResolvedCredential
	if catalogProvider.CredentialRequired {
		if catalogProvider.CredentialRef == nil {
			return providerCallTarget{}, provider.NewError(provider.ErrorKindCredential, provider.ErrorCodeProviderCredentialUnavailable, credentials.ErrMissingReference)
		}
		if h.CredentialResolver == nil {
			return providerCallTarget{}, provider.NewError(provider.ErrorKindCredential, provider.ErrorCodeProviderCredentialUnavailable, credentials.ErrUnavailable)
		}
		resolved, err := h.CredentialResolver.Resolve(ctx, *catalogProvider.CredentialRef)
		if err != nil {
			return providerCallTarget{}, provider.NewError(provider.ErrorKindCredential, provider.ErrorCodeProviderCredentialUnavailable, err)
		}
		resolvedCredential = &provider.ResolvedCredential{Value: resolved.Value}
	}

	timeout := time.Duration(catalogProvider.TimeoutMs) * time.Millisecond
	return providerCallTarget{
		Adapter:      adapter,
		Catalog:      catalog,
		ProviderID:   catalogProvider.ProviderID,
		ProviderName: catalogProvider.ProviderName,
		AdapterType:  catalogProvider.AdapterType,
		ModelID:      catalogModel.ModelID,
		ModelName:    catalogModel.ModelName,
		CatalogHash:  catalog.ContentHash,
		FromCatalog:  true,
		Fallback:     fallback,
		ExecutionConfig: provider.ExecutionConfig{
			ProviderID:         catalogProvider.ProviderID,
			ProviderName:       catalogProvider.ProviderName,
			AdapterType:        catalogProvider.AdapterType,
			BaseURL:            catalogProvider.BaseURL,
			Timeout:            timeout,
			CredentialRequired: catalogProvider.CredentialRequired,
			Credential:         resolvedCredential,
			AdapterConfig: provider.AdapterConfig{
				RequestFormat: catalogProvider.AdapterConfig.RequestFormat,
				APIVersion:    catalogProvider.AdapterConfig.APIVersion,
			},
		},
	}, nil
}

func (h *ChatCompletionsHandler) writeProviderResolutionFailure(w http.ResponseWriter, reqCtx *pipeline.RequestContext, err error) {
	var resolutionErr providerResolutionFailure
	if errors.As(err, &resolutionErr) {
		writeGatewayErrorWithContext(w, reqCtx, resolutionErr.httpStatus, resolutionErr.code, resolutionErr.message, resolutionErr.stage)
		return
	}
	code := provider.SafeErrorCode(err)
	writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, code, "Provider credential could not be resolved.", "resolve_provider_credential")
}

func (h *ChatCompletionsHandler) handleProviderFailure(w http.ResponseWriter, r *http.Request, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, target providerCallTarget, err error, providerDuration time.Duration, startedAt time.Time) {
	code := provider.SafeErrorCode(err)
	if errors.Is(err, context.Canceled) {
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: reqCtx.SelectedProvider,
			SelectedModel:    reqCtx.SelectedModel,
			Status:           invocationlog.StatusCancelled,
			HTTPStatus:       gatewayerrors.StatusClientClosedRequest,
			ErrorCode:        "internal_error",
			DurationSeconds:  providerDuration.Seconds(),
		})
		writeGatewayErrorWithContext(w, reqCtx, gatewayerrors.StatusClientClosedRequest, "internal_error", "Request was cancelled.", "call_provider_with_timeout_retry_fallback")
		return
	}
	h.recordProviderRequest(metrics.ProviderRequest{
		SelectedProvider: reqCtx.SelectedProvider,
		SelectedModel:    reqCtx.SelectedModel,
		Status:           invocationlog.StatusFailed,
		HTTPStatus:       http.StatusBadGateway,
		ErrorCode:        code,
		DurationSeconds:  providerDuration.Seconds(),
	})

	if !provider.AllowsFallback(err) {
		reqCtx.DomainOutcomes = h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{Outcome: "not_called"})
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, code, "Provider request failed.", "call_provider_with_timeout_retry_fallback")
		return
	}

	fallbackTarget, fallbackErr := h.resolveFallbackTarget(r.Context(), reqCtx, target)
	if fallbackErr != nil {
		reqCtx.DomainOutcomes = h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
			Outcome: "disabled",
			Reason:  stringPointerValue("fallback_not_configured"),
		})
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, code, "Provider request failed and fallback is unavailable.", "call_provider_with_timeout_retry_fallback")
		return
	}

	fallbackReq := chatReq
	fallbackReq.Model = fallbackTarget.ModelName
	fallbackStartedAt := time.Now()
	fallbackResp, fallbackCallErr := fallbackTarget.Adapter.CreateChatCompletion(r.Context(), fallbackTarget.ExecutionConfig, fallbackReq)
	fallbackDuration := time.Since(fallbackStartedAt)
	if fallbackCallErr != nil || fallbackResp == nil {
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: fallbackTarget.ProviderName,
			SelectedModel:    fallbackTarget.ModelID,
			Status:           invocationlog.StatusFailed,
			HTTPStatus:       http.StatusBadGateway,
			ErrorCode:        "fallback_failed",
			DurationSeconds:  fallbackDuration.Seconds(),
		})
		reqCtx.DomainOutcomes = h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
			Outcome:          "failed",
			FallbackProvider: stringPointerValue(fallbackTarget.ProviderName),
			Reason:           stringPointerValue("fallback_provider_failed"),
		})
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, "fallback_failed", "Provider request failed and fallback failed.", "call_provider_with_timeout_retry_fallback")
		return
	}

	h.recordProviderRequest(metrics.ProviderRequest{
		SelectedProvider: fallbackTarget.ProviderName,
		SelectedModel:    fallbackTarget.ModelID,
		Status:           invocationlog.StatusSuccess,
		HTTPStatus:       http.StatusOK,
		ErrorCode:        "none",
		DurationSeconds:  fallbackDuration.Seconds(),
	})
	if fallbackResp.Usage != nil {
		reqCtx.PromptTokens = fallbackResp.Usage.PromptTokens
		reqCtx.CompletionTokens = fallbackResp.Usage.CompletionTokens
		reqCtx.TotalTokens = fallbackResp.Usage.TotalTokens
	}
	reqCtx.Status = invocationlog.StatusSuccess
	reqCtx.HTTPStatus = http.StatusOK
	reqCtx.ErrorCode = ""
	reqCtx.ErrorMessage = ""
	reqCtx.ErrorStage = ""
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	reqCtx.SavedCostMicroUSD = 0
	reqCtx.FallbackOccurred = true
	skipExactCacheStore(reqCtx, "fallback_response_store_bypassed")
	h.markSemanticCacheBypass(reqCtx, "fallback_response_store_bypassed", h.semanticPromptCategory(reqCtx))
	reqCtx.DomainOutcomes = h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
		Outcome:          "success",
		FallbackProvider: stringPointerValue(fallbackTarget.ProviderName),
		Reason:           stringPointerValue(code),
	})

	h.writeChatCompletionResponse(r.Context(), w, reqCtx, fallbackResp)
}

func (h *ChatCompletionsHandler) resolveFallbackTarget(ctx context.Context, reqCtx *pipeline.RequestContext, primary providerCallTarget) (providerCallTarget, error) {
	if !primary.FromCatalog {
		return providerCallTarget{}, providercatalog.ErrProviderNotFound
	}

	fallbackProviderName := firstNonEmpty(reqCtx.RuntimeRoutingPolicy.FallbackProvider)
	var fallbackProvider providercatalog.Provider
	var fallbackModel providercatalog.Model
	var err error
	if fallbackProviderName != "" {
		fallbackProvider, err = primary.Catalog.ProviderByName(fallbackProviderName)
		if err != nil {
			return providerCallTarget{}, err
		}
		fallbackModelID := firstNonEmpty(reqCtx.RuntimeRoutingPolicy.FallbackModel)
		if fallbackModelID != "" {
			fallbackModel, err = fallbackProvider.ModelByID(fallbackModelID)
		} else {
			fallbackModel, err = fallbackProvider.FirstEnabledFallbackModel()
		}
		if err != nil {
			return providerCallTarget{}, err
		}
	} else {
		fallbackProvider, fallbackModel, err = primary.Catalog.FirstFallbackProvider(primary.ProviderName, primary.ModelID)
		if err != nil {
			return providerCallTarget{}, err
		}
	}

	if fallbackProvider.ProviderName == primary.ProviderName && fallbackModel.ModelID == primary.ModelID {
		return providerCallTarget{}, providercatalog.ErrProviderNotFound
	}
	return h.providerCallTargetFromCatalog(ctx, primary.Catalog, fallbackProvider, fallbackModel, true)
}

func (h *ChatCompletionsHandler) providerFailureDomainOutcomes(reqCtx *pipeline.RequestContext, target providerCallTarget, err error, fallback invocationlog.FallbackOutcome) invocationlog.DomainOutcomes {
	outcomes := buildDomainOutcomesFromRequestContext(reqCtx)
	code := provider.SafeErrorCode(err)
	providerOutcome := "error"
	switch provider.ErrorKindOf(err) {
	case provider.ErrorKindTimeout:
		providerOutcome = "timeout"
	case provider.ErrorKindUnauthorized:
		providerOutcome = "unauthorized"
	}
	outcomes.Provider = invocationlog.ProviderOutcome{
		Outcome:            providerOutcome,
		SelectedProvider:   stringPointerValue(target.ProviderName),
		SelectedModel:      stringPointerValue(target.ModelID),
		LatencyMs:          providerLatencyForLog(reqCtx),
		SanitizedErrorCode: stringPointerValue(code),
	}
	outcomes.Fallback = fallback
	return outcomes
}

func stringPointerValue(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
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
	if strings.TrimSpace(h.SemanticCachePolicyVersion) == "" {
		h.SemanticCachePolicyVersion = "v1"
	}
	if strings.TrimSpace(h.SemanticCacheKeyVersion) == "" {
		h.SemanticCacheKeyVersion = "v1"
	}
	if len(h.SemanticCacheAllowCategories) == 0 {
		h.SemanticCacheAllowCategories = []string{cachekey.SemanticCacheCategoryGeneral, cachekey.SemanticCacheCategorySupportRefund}
	}
	if len(h.SemanticCacheDenyCategories) == 0 {
		h.SemanticCacheDenyCategories = []string{
			cachekey.SemanticCacheCategoryCode,
			cachekey.SemanticCacheCategoryTranslation,
			cachekey.SemanticCacheCategoryReasoning,
			cachekey.SemanticCacheCategorySensitive,
			cachekey.SemanticCacheCategoryToolCall,
			cachekey.SemanticCacheCategoryUnknown,
		}
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
		bypassExactCache(reqCtx, "masking_blocked")
		return nil, "", false
	}
	if h.ExactCacheStore == nil || h.ExactCacheKeyBuilder == nil {
		bypassExactCache(reqCtx, "cache_dependency_unavailable")
		return nil, "", false
	}

	keyHash, err := h.buildExactCacheKey(ctx, reqCtx, chatReq, redactedPrompt)
	if err != nil {
		reqCtx.CacheStatus = cachestage.CacheStatusError
		reqCtx.CacheType = cachestage.CacheTypeExact
		reqCtx.CacheDecisionReason = "key_build_error"
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "error")
		return nil, "", false
	}
	reqCtx.CacheKeyHash = keyHash

	lookup, err := h.ExactCacheStore.GetExact(ctx, keyHash)
	if err != nil {
		reqCtx.CacheStatus = cachestage.CacheStatusError
		reqCtx.CacheType = cachestage.CacheTypeExact
		reqCtx.CacheDecisionReason = "lookup_error"
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "error")
		return nil, "", false
	}

	if !lookup.Hit {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeExact
		reqCtx.CacheDecisionReason = "routing_aware_key_miss"
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
		return nil, "", false
	}

	reqCtx.CacheStatus = cachestage.CacheStatusHit
	reqCtx.CacheType = cachestage.CacheTypeExact
	reqCtx.CacheDecisionReason = "routing_aware_key_hit"
	h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
	return lookup.Payload, lookup.CacheHitRequestID, true
}

func (h *ChatCompletionsHandler) buildExactCacheKey(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string) (string, error) {
	maskedRequestBodyHash := normalizedMaskedRequestBodyHash(chatReq)
	if maskedRequestBodyHash == "" {
		maskedRequestBodyHash = redactedPromptHash(redactedPrompt)
	}
	routingDecisionHash := reqCtx.RoutingDecisionKeyHash
	if routingDecisionHash == "" {
		routingDecisionHash = routingDecisionKeyHashFromRequestContext(reqCtx)
	}
	reqCtx.RoutingDecisionKeyHash = routingDecisionHash
	reqCtx.CacheKeyVersion = cachekey.ExactKeyMaterialVersion
	providerID := reqCtx.SelectedProviderID
	providerCatalogStableKey := ""
	if strings.TrimSpace(providerID) == "" {
		providerCatalogStableKey = firstNonEmpty(reqCtx.SelectedProviderCatalogKey, reqCtx.SelectedProvider, h.DefaultProvider)
	}
	return h.ExactCacheKeyBuilder.BuildExactKey(ctx, cachekey.KeyMaterial{
		TenantID:                        reqCtx.TenantID,
		ProjectID:                       reqCtx.ProjectID,
		ApplicationID:                   reqCtx.ApplicationID,
		RequestedModel:                  firstNonEmpty(reqCtx.RequestedModel, chatReq.Model, h.DefaultModel),
		ProviderCatalogContentHash:      firstNonEmpty(reqCtx.ProviderCatalogContentHash, reqCtx.RuntimeSnapshot.ProviderCatalogRef.ContentHash, "legacy-provider-catalog-v1"),
		ProviderID:                      providerID,
		ProviderCatalogStableKey:        providerCatalogStableKey,
		ModelID:                         firstNonEmpty(reqCtx.SelectedModelID, reqCtx.SelectedModel, chatReq.Model, h.DefaultModel),
		RoutingPolicyHash:               firstNonEmpty(reqCtx.RoutingPolicyHash, reqCtx.RuntimeRoutingPolicy.RoutingPolicyHash, routingdomain.DefaultPolicyHash),
		RoutingDecisionKeyHash:          routingDecisionHash,
		CachePolicyHash:                 firstNonEmpty(reqCtx.RuntimeCachePolicy.CachePolicyHash, h.CachePolicyHash),
		SafetyPolicyHash:                firstNonEmpty(reqCtx.SecurityPolicyHash, reqCtx.SecurityPolicyVersionID, h.SecurityPolicyVersionID),
		MaskingPolicyHash:               firstNonEmpty(reqCtx.SecurityPolicyVersionID, reqCtx.SecurityPolicyHash, h.SecurityPolicyVersionID),
		NormalizedMaskedRequestBodyHash: maskedRequestBodyHash,
		RequestParamsHash:               requestParamsHash(chatReq),
		CacheVersion:                    cachekey.ExactKeyMaterialVersion,
	})
}

func (h *ChatCompletionsHandler) writeExactCache(ctx context.Context, reqCtx *pipeline.RequestContext, providerResp *provider.ChatCompletionResponse) {
	if h.ExactCacheStore == nil || reqCtx.CacheStatus != cachestage.CacheStatusMiss || reqCtx.CacheKeyHash == "" || providerResp == nil || reqCtx.Stream || reqCtx.FallbackOccurred {
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

func (h *ChatCompletionsHandler) writeSemanticCachedChatCompletionIfHit(ctx context.Context, w http.ResponseWriter, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string, startedAt time.Time) bool {
	if reqCtx == nil || h.SemanticCacheService == nil || !h.SemanticCacheService.Enabled() {
		return false
	}
	promptCategory := h.semanticPromptCategory(reqCtx)
	if reqCtx.Stream {
		h.markSemanticCacheBypass(reqCtx, "streaming_request", promptCategory)
		return false
	}
	if reqCtx.MaskingAction == string(maskdomain.ActionBlocked) {
		h.markSemanticCacheBypass(reqCtx, "safety_blocked", promptCategory)
		return false
	}
	if reqCtx.CacheStatus == cachestage.CacheStatusHit {
		h.markSemanticCacheBypass(reqCtx, "exact_cache_hit", promptCategory)
		return false
	}
	if err := h.populateRoutingAwareCacheIdentity(ctx, reqCtx, chatReq.Model); err != nil {
		h.markSemanticCacheBypass(reqCtx, "semantic_boundary_unavailable", promptCategory)
		return false
	}
	boundary, ok := h.semanticCacheBoundary(reqCtx, chatReq)
	if !ok {
		h.markSemanticCacheBypass(reqCtx, "semantic_boundary_unavailable", promptCategory)
		return false
	}
	if !h.semanticCategoryAllowed(boundary.PromptCategory) {
		h.markSemanticCacheBypass(reqCtx, "semantic_category_disabled", boundary.PromptCategory)
		return false
	}
	normalizedText := semanticEmbeddingInput(redactedPrompt)
	if normalizedText == "" {
		h.markSemanticCacheBypass(reqCtx, "semantic_input_unavailable", boundary.PromptCategory)
		return false
	}

	result, decision, err := h.SemanticCacheService.Search(ctx, cachekey.SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: normalizedText,
	})
	h.applySemanticCacheDecision(reqCtx, decision)
	if err != nil {
		reqCtx.SemanticCacheStoreCandidate = false
		h.recordCacheOperation("lookup", cachestage.CacheStatusError, cachestage.CacheTypeSemantic, "error")
		return false
	}
	if !result.Hit || result.MatchedEntry == nil {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeSemantic
		reqCtx.CacheDecisionReason = firstNonEmpty(decision.SemanticCacheDecisionReason, cachekey.SemanticCacheReasonThresholdMiss)
		reqCtx.SemanticCacheStoreCandidate = true
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
		return false
	}

	reqCtx.CacheStatus = cachestage.CacheStatusHit
	reqCtx.CacheType = cachestage.CacheTypeSemantic
	reqCtx.CacheKeyHash = ""
	reqCtx.CacheHitRequestID = decision.SemanticMatchedRequestID
	reqCtx.CacheKeyVersion = firstNonEmpty(h.SemanticCacheKeyVersion, "v1")
	reqCtx.CacheDecisionReason = firstNonEmpty(decision.SemanticCacheDecisionReason, cachekey.SemanticCacheReasonHit)
	reqCtx.SemanticCacheStoreCandidate = false
	reqCtx.RoutingReason = firstNonEmpty(reqCtx.RoutingReason, "semantic_cache_hit_provider_bypass")
	h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")

	gatewayCtx := newGatewayContext(reqCtx, "")
	gatewayCtx.Cache.CacheStatus = cachestage.CacheStatusHit
	gatewayCtx.Cache.CacheType = cachestage.CacheTypeSemantic
	gatewayCtx.Cache.CacheHitRequestID = reqCtx.CacheHitRequestID
	gatewayCtx.Cache.CacheDecisionReason = reqCtx.CacheDecisionReason
	gatewayCtx.Cache.Payload = append([]byte(nil), result.MatchedEntry.CachedResponse...)
	return h.writeCachedChatCompletionIfHit(ctx, w, reqCtx, gatewayCtx, startedAt)
}

func (h *ChatCompletionsHandler) writeSemanticCache(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string, providerResp *provider.ChatCompletionResponse) {
	if reqCtx == nil || h.SemanticCacheService == nil || !h.SemanticCacheService.Enabled() || !reqCtx.SemanticCacheStoreCandidate {
		return
	}
	promptCategory := h.semanticPromptCategory(reqCtx)
	if reqCtx.Stream {
		h.markSemanticCacheBypass(reqCtx, "streaming_request", promptCategory)
		return
	}
	if reqCtx.FallbackOccurred {
		h.markSemanticCacheBypass(reqCtx, "fallback_response_store_bypassed", promptCategory)
		return
	}
	if providerResp == nil {
		h.markSemanticCacheBypass(reqCtx, "provider_error_store_bypassed", promptCategory)
		return
	}
	boundary, ok := h.semanticCacheBoundary(reqCtx, chatReq)
	if !ok {
		h.markSemanticCacheBypass(reqCtx, "semantic_boundary_unavailable", promptCategory)
		return
	}
	if !h.semanticCategoryAllowed(boundary.PromptCategory) {
		h.markSemanticCacheBypass(reqCtx, "semantic_category_disabled", boundary.PromptCategory)
		return
	}
	normalizedText := semanticEmbeddingInput(redactedPrompt)
	if normalizedText == "" {
		h.markSemanticCacheBypass(reqCtx, "semantic_input_unavailable", boundary.PromptCategory)
		return
	}

	cacheable := *providerResp
	cacheable.GateLM = nil
	cacheable.Raw = nil
	payload, err := json.Marshal(cacheable)
	if err != nil {
		h.markSemanticCacheBypass(reqCtx, "semantic_payload_encode_failed", boundary.PromptCategory)
		h.recordCacheOperation("write", cachestage.CacheStatusError, cachestage.CacheTypeSemantic, "error")
		return
	}
	decision, err := h.SemanticCacheService.Upsert(ctx, cachekey.SemanticCacheStoreRequest{
		EntryID:        reqCtx.RequestID,
		RequestID:      reqCtx.RequestID,
		Boundary:       boundary,
		NormalizedText: normalizedText,
		CachedResponse: payload,
		Now:            time.Now().UTC(),
	})
	h.applySemanticCacheDecision(reqCtx, decision)
	if err != nil {
		h.recordCacheOperation("write", cachestage.CacheStatusStoreSkipped, cachestage.CacheTypeSemantic, "error")
		log.Printf("semantic cache write skipped request_id=%s reason=%s cause=%q",
			sanitizeLogValue(reqCtx.RequestID),
			sanitizeLogValue(reqCtx.SemanticCacheDecisionReason),
			sanitizeLogValue(err.Error()),
		)
		return
	}
	h.recordCacheOperation("write", reqCtx.CacheStatus, cachestage.CacheTypeSemantic, "success")
}

func (h *ChatCompletionsHandler) writeChatCompletionResponse(ctx context.Context, w http.ResponseWriter, reqCtx *pipeline.RequestContext, providerResp *provider.ChatCompletionResponse) {
	if reqCtx == nil || providerResp == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, provider.ErrorCodeProviderError, "Provider returned an empty response.", "call_provider_with_timeout_retry_fallback")
		return
	}

	if !reqCtx.Stream {
		attachGateLMMetadata(providerResp, reqCtx)
		setGatewayHeaders(w, reqCtx)
		writeJSON(w, http.StatusOK, providerResp)
		return
	}

	started, err := writeStreamingChatCompletion(ctx, w, reqCtx, providerResp)
	if err == nil {
		reqCtx.Status = invocationlog.StatusSuccess
		reqCtx.HTTPStatus = http.StatusOK
		reqCtx.ErrorCode = ""
		reqCtx.ErrorMessage = ""
		reqCtx.ErrorStage = ""
		reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, "completed")
		return
	}

	status := http.StatusInternalServerError
	code := "internal_error"
	message := "Gateway streaming response failed."
	outcome := "interrupted"
	terminalStatus := invocationlog.StatusFailed
	if errors.Is(err, context.Canceled) {
		status = gatewayerrors.StatusClientClosedRequest
		message = "Request was cancelled."
		outcome = "cancelled"
		terminalStatus = invocationlog.StatusCancelled
	}

	reqCtx.Status = terminalStatus
	reqCtx.HTTPStatus = status
	reqCtx.ErrorCode = code
	reqCtx.ErrorMessage = message
	reqCtx.ErrorStage = "stream_response"
	reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, outcome)
	if !started {
		writeGatewayErrorWithContext(w, reqCtx, status, code, message, "stream_response")
		reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, outcome)
	}
}

type streamingChatCompletionChunk struct {
	ID      string                   `json:"id"`
	Object  string                   `json:"object"`
	Created int64                    `json:"created"`
	Model   string                   `json:"model"`
	Choices []streamingChoice        `json:"choices"`
	GateLM  *provider.GateLMMetadata `json:"gate_lm,omitempty"`
}

type streamingChoice struct {
	Index        int            `json:"index"`
	Delta        streamingDelta `json:"delta"`
	FinishReason *string        `json:"finish_reason"`
}

type streamingDelta struct {
	Role    string `json:"role,omitempty"`
	Content string `json:"content,omitempty"`
}

func writeStreamingChatCompletion(ctx context.Context, w http.ResponseWriter, reqCtx *pipeline.RequestContext, providerResp *provider.ChatCompletionResponse) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}

	setGatewayHeaders(w, reqCtx)
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flushResponse(w)

	for _, chunk := range streamingChunks(providerResp) {
		if err := ctx.Err(); err != nil {
			return true, err
		}
		if err := writeSSEData(w, chunk); err != nil {
			return true, err
		}
		flushResponse(w)
	}
	if err := ctx.Err(); err != nil {
		return true, err
	}
	if _, err := fmt.Fprint(w, "data: [DONE]\n\n"); err != nil {
		return true, err
	}
	flushResponse(w)
	return true, nil
}

func writeSSEData(w http.ResponseWriter, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "data: %s\n\n", encoded)
	return err
}

func streamingChunks(resp *provider.ChatCompletionResponse) []streamingChatCompletionChunk {
	if resp == nil {
		return nil
	}
	created := resp.Created
	if created == 0 {
		created = time.Now().Unix()
	}
	choices := resp.Choices
	if len(choices) == 0 {
		choices = []provider.ChatChoice{{
			Index: 0,
			Message: provider.ChatMessage{
				Role: "assistant",
			},
			FinishReason: "stop",
		}}
	}

	chunks := make([]streamingChatCompletionChunk, 0, len(choices)*3)
	for _, choice := range choices {
		index := choice.Index
		chunks = append(chunks, streamingChatCompletionChunk{
			ID:      resp.ID,
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   resp.Model,
			Choices: []streamingChoice{{
				Index: index,
				Delta: streamingDelta{Role: firstNonEmpty(choice.Message.Role, "assistant")},
			}},
		})

		for _, contentChunk := range splitStreamingContent(chatChoiceContent(choice)) {
			chunks = append(chunks, streamingChatCompletionChunk{
				ID:      resp.ID,
				Object:  "chat.completion.chunk",
				Created: created,
				Model:   resp.Model,
				Choices: []streamingChoice{{
					Index: index,
					Delta: streamingDelta{Content: contentChunk},
				}},
			})
		}

		finishReason := firstNonEmpty(choice.FinishReason, "stop")
		chunks = append(chunks, streamingChatCompletionChunk{
			ID:      resp.ID,
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   resp.Model,
			Choices: []streamingChoice{{
				Index:        index,
				Delta:        streamingDelta{},
				FinishReason: &finishReason,
			}},
		})
	}
	return chunks
}

func chatChoiceContent(choice provider.ChatChoice) string {
	var content string
	if err := json.Unmarshal(choice.Message.Content, &content); err != nil {
		return ""
	}
	return content
}

func splitStreamingContent(content string) []string {
	if content == "" {
		return []string{""}
	}

	chunks := make([]string, 0)
	var current strings.Builder
	for _, r := range content {
		current.WriteRune(r)
		if r == ' ' || r == '\n' || r == '\t' {
			chunks = append(chunks, current.String())
			current.Reset()
		}
	}
	if current.Len() > 0 {
		chunks = append(chunks, current.String())
	}
	return chunks
}

func flushResponse(w http.ResponseWriter) {
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func streamingFinalDomainOutcomes(reqCtx *pipeline.RequestContext, outcome string) invocationlog.DomainOutcomes {
	if reqCtx == nil {
		return invocationlog.DomainOutcomes{}
	}

	outcomes := reqCtx.DomainOutcomes
	if outcomes.IsZero() {
		originalStatus := reqCtx.Status
		originalHTTPStatus := reqCtx.HTTPStatus
		originalErrorCode := reqCtx.ErrorCode
		originalErrorMessage := reqCtx.ErrorMessage
		originalErrorStage := reqCtx.ErrorStage
		if outcome == "cancelled" || outcome == "interrupted" {
			reqCtx.Status = invocationlog.StatusSuccess
			reqCtx.HTTPStatus = http.StatusOK
			reqCtx.ErrorCode = ""
			reqCtx.ErrorMessage = ""
			reqCtx.ErrorStage = ""
		}
		outcomes = buildDomainOutcomesFromRequestContext(reqCtx)
		reqCtx.Status = originalStatus
		reqCtx.HTTPStatus = originalHTTPStatus
		reqCtx.ErrorCode = originalErrorCode
		reqCtx.ErrorMessage = originalErrorMessage
		reqCtx.ErrorStage = originalErrorStage
	}
	outcomes.Streaming = invocationlog.StreamingOutcome{
		Outcome:            outcome,
		StreamingRequested: reqCtx.Stream,
	}
	if outcomes.Logging.Outcome == "" {
		outcomes.Logging = invocationlog.LoggingOutcome{Outcome: "written", RequestLogWritten: true}
	}
	return outcomes
}

func (h *ChatCompletionsHandler) writeCachedChatCompletionIfHit(ctx context.Context, w http.ResponseWriter, reqCtx *pipeline.RequestContext, gatewayCtx *request.GatewayContext, startedAt time.Time) bool {
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
	if gatewayCtx.Cache.CacheDecisionReason != "" {
		reqCtx.CacheDecisionReason = gatewayCtx.Cache.CacheDecisionReason
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
	if reqCtx.RoutingReason == "" {
		if reqCtx.CacheType == cachestage.CacheTypeSemantic {
			reqCtx.RoutingReason = "semantic_cache_hit_provider_bypass"
		} else {
			reqCtx.RoutingReason = "exact_cache_hit_provider_bypass"
		}
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
	reqCtx.Status = invocationlog.StatusSuccess
	reqCtx.HTTPStatus = http.StatusOK

	if reqCtx.SelectedModel != "" {
		cachedResp.Model = reqCtx.SelectedModel
	}
	cachedResp.Usage = &provider.Usage{}
	h.writeChatCompletionResponse(ctx, w, reqCtx, cachedResp)
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

func (h *ChatCompletionsHandler) semanticCacheBoundary(reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest) (cachekey.SemanticCacheBoundary, bool) {
	if reqCtx == nil {
		return cachekey.SemanticCacheBoundary{}, false
	}
	routingDecisionHash := reqCtx.RoutingDecisionKeyHash
	if routingDecisionHash == "" {
		routingDecisionHash = routingDecisionKeyHashFromRequestContext(reqCtx)
	}
	reqCtx.RoutingDecisionKeyHash = routingDecisionHash
	promptCategory := h.semanticPromptCategory(reqCtx)
	reqCtx.PromptCategory = promptCategory
	boundary := cachekey.SemanticCacheBoundary{
		TenantID:                   reqCtx.TenantID,
		ProjectID:                  reqCtx.ProjectID,
		ApplicationID:              reqCtx.ApplicationID,
		PromptCategory:             promptCategory,
		SelectedProviderID:         firstNonEmpty(reqCtx.SelectedProviderID, reqCtx.SelectedProviderCatalogKey, reqCtx.SelectedProvider),
		SelectedModelID:            firstNonEmpty(reqCtx.SelectedModelID, reqCtx.SelectedModel, chatReq.Model, h.DefaultModel),
		ProviderCatalogContentHash: firstNonEmpty(reqCtx.ProviderCatalogContentHash, reqCtx.RuntimeSnapshot.ProviderCatalogRef.ContentHash, "legacy-provider-catalog-v1"),
		RoutingPolicyHash:          firstNonEmpty(reqCtx.RoutingPolicyHash, reqCtx.RuntimeRoutingPolicy.RoutingPolicyHash, routingdomain.DefaultPolicyHash),
		RoutingDecisionKeyHash:     routingDecisionHash,
		SemanticCachePolicyHash:    firstNonEmpty(h.SemanticCachePolicyVersion, "v1"),
		SafetyPolicyHash:           firstNonEmpty(reqCtx.SecurityPolicyHash, reqCtx.SecurityPolicyVersionID, h.SecurityPolicyVersionID),
		MaskingPolicyHash:          firstNonEmpty(reqCtx.SecurityPolicyVersionID, reqCtx.SecurityPolicyHash, h.SecurityPolicyVersionID),
		RequestParamsHash:          requestParamsHash(chatReq),
		CacheVersion:               firstNonEmpty(h.SemanticCacheKeyVersion, "v1"),
	}.Normalize()
	if err := boundary.Validate(); err != nil {
		return boundary, false
	}
	return boundary, true
}

func (h *ChatCompletionsHandler) semanticCategoryAllowed(category string) bool {
	policy := cachekey.NewSemanticCacheCategoryPolicy(h.SemanticCacheAllowCategories, h.SemanticCacheDenyCategories)
	return policy.Allows(category)
}

func (h *ChatCompletionsHandler) semanticPromptCategory(reqCtx *pipeline.RequestContext) string {
	if reqCtx == nil {
		return cachekey.SemanticCacheCategoryUnknown
	}
	return cachekey.CanonicalSemanticCacheCategory(reqCtx.PromptCategory)
}

func (h *ChatCompletionsHandler) markSemanticCacheBypass(reqCtx *pipeline.RequestContext, reason string, promptCategory string) {
	if reqCtx == nil {
		return
	}
	reqCtx.PromptCategory = cachekey.CanonicalSemanticCacheCategory(promptCategory)
	reqCtx.SemanticCacheHit = false
	reqCtx.SemanticSimilarity = 0
	reqCtx.SemanticMatchedRequestID = ""
	reqCtx.SemanticCacheThreshold = h.semanticCacheThreshold()
	reqCtx.SemanticCachePolicyVersion = h.semanticCachePolicyVersion()
	reqCtx.SemanticCacheDecisionReason = strings.TrimSpace(reason)
	reqCtx.EmbeddingProvider = h.semanticEmbeddingProviderName()
	reqCtx.SemanticCacheStoreCandidate = false
	if reqCtx.CacheStatus == "" {
		reqCtx.CacheStatus = cachestage.CacheStatusBypass
	}
	if reqCtx.CacheType == "" {
		reqCtx.CacheType = cachestage.CacheTypeNone
	}
}

func (h *ChatCompletionsHandler) applySemanticCacheDecision(reqCtx *pipeline.RequestContext, decision cachekey.SemanticCacheDecision) {
	if reqCtx == nil {
		return
	}
	reqCtx.SemanticCacheHit = decision.SemanticCacheHit
	reqCtx.SemanticSimilarity = decision.SemanticSimilarity
	reqCtx.SemanticMatchedRequestID = decision.SemanticMatchedRequestID
	reqCtx.SemanticCacheThreshold = firstPositiveFloat(decision.SemanticCacheThreshold, h.semanticCacheThreshold())
	reqCtx.SemanticCachePolicyVersion = firstNonEmpty(decision.SemanticCachePolicyVersion, h.semanticCachePolicyVersion())
	reqCtx.SemanticCacheDecisionReason = firstNonEmpty(decision.SemanticCacheDecisionReason, reqCtx.SemanticCacheDecisionReason)
	reqCtx.EmbeddingProvider = firstNonEmpty(decision.EmbeddingProvider, h.semanticEmbeddingProviderName())
	if decision.SemanticCacheHit {
		reqCtx.CacheStatus = cachestage.CacheStatusHit
		reqCtx.CacheType = cachestage.CacheTypeSemantic
		reqCtx.CacheHitRequestID = decision.SemanticMatchedRequestID
		reqCtx.CacheDecisionReason = reqCtx.SemanticCacheDecisionReason
	}
}

func (h *ChatCompletionsHandler) semanticCacheThreshold() float64 {
	if h.SemanticCacheService == nil {
		return 0
	}
	return h.SemanticCacheService.Threshold()
}

func (h *ChatCompletionsHandler) semanticCachePolicyVersion() string {
	if h.SemanticCacheService != nil {
		if version := strings.TrimSpace(h.SemanticCacheService.PolicyVersion()); version != "" {
			return version
		}
	}
	return firstNonEmpty(h.SemanticCachePolicyVersion, "v1")
}

func (h *ChatCompletionsHandler) semanticEmbeddingProviderName() string {
	if h.SemanticCacheService == nil {
		return ""
	}
	return h.SemanticCacheService.EmbeddingProviderName()
}

func semanticEmbeddingInput(redactedPrompt string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(redactedPrompt))), " ")
}

func firstPositiveFloat(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func positiveFloatPointer(value float64) *float64 {
	if value <= 0 {
		return nil
	}
	return &value
}

func providerCalledFromRequestContext(reqCtx *pipeline.RequestContext) bool {
	if reqCtx == nil {
		return false
	}
	if reqCtx.CacheStatus == cachestage.CacheStatusHit {
		return false
	}
	switch reqCtx.Status {
	case invocationlog.StatusBlocked, invocationlog.StatusRateLimited, invocationlog.StatusCancelled:
		return false
	}
	return reqCtx.ProviderLatencyMs > 0 || strings.TrimSpace(reqCtx.Provider) != "" || strings.TrimSpace(reqCtx.SelectedProvider) != ""
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
		RequestID:                   reqCtx.RequestID,
		TenantID:                    reqCtx.TenantID,
		ProjectID:                   reqCtx.ProjectID,
		ApplicationID:               reqCtx.ApplicationID,
		RequestedModel:              reqCtx.RequestedModel,
		SelectedProvider:            reqCtx.SelectedProvider,
		SelectedModel:               reqCtx.SelectedModel,
		TerminalStatus:              reqCtx.Status,
		DomainOutcomes:              domainOutcomesFromRequestContext(reqCtx),
		CacheStatus:                 reqCtx.CacheStatus,
		CacheType:                   reqCtx.CacheType,
		ProviderCalled:              providerCalledFromRequestContext(reqCtx),
		SemanticCacheHit:            reqCtx.SemanticCacheHit,
		SemanticSimilarity:          positiveFloatPointer(reqCtx.SemanticSimilarity),
		SemanticMatchedRequestID:    reqCtx.SemanticMatchedRequestID,
		SemanticCacheDecisionReason: reqCtx.SemanticCacheDecisionReason,
		RoutingReason:               reqCtx.RoutingReason,
		MaskingAction:               reqCtx.MaskingAction,
		EstimatedCostUSD:            formatCostMicroUSD(reqCtx.CostMicroUSD),
		LatencyMs:                   reqCtx.LatencyMs,
	}
}

func domainOutcomesFromRequestContext(reqCtx *pipeline.RequestContext) invocationlog.DomainOutcomes {
	if reqCtx == nil {
		return invocationlog.DomainOutcomes{}
	}
	if !reqCtx.DomainOutcomes.IsZero() {
		return reqCtx.DomainOutcomes
	}
	return buildDomainOutcomesFromRequestContext(reqCtx)
}

func buildDomainOutcomesFromRequestContext(reqCtx *pipeline.RequestContext) invocationlog.DomainOutcomes {
	providerLatencyMs := providerLatencyForLog(reqCtx)
	return invocationlog.BuildDomainOutcomes(invocationlog.TerminalLog{
		RequestID:             reqCtx.RequestID,
		TraceID:               reqCtx.TraceID,
		ApplicationID:         reqCtx.ApplicationID,
		BudgetScope:           reqCtx.BudgetScope,
		ConfigHash:            reqCtx.ConfigHash,
		SecurityPolicyHash:    reqCtx.SecurityPolicyHash,
		RuntimeSnapshot:       reqCtx.RuntimeSnapshot,
		RateLimitDecision:     reqCtx.RateLimitDecision,
		BudgetDecision:        reqCtx.BudgetDecision,
		Stream:                reqCtx.Stream,
		RequestedModel:        reqCtx.RequestedModel,
		Provider:              reqCtx.Provider,
		Model:                 reqCtx.Model,
		SelectedProvider:      reqCtx.SelectedProvider,
		SelectedModel:         reqCtx.SelectedModel,
		RoutingReason:         reqCtx.RoutingReason,
		RoutingPolicyHash:     reqCtx.RoutingPolicyHash,
		LatencyMs:             reqCtx.LatencyMs,
		ProviderLatencyMs:     providerLatencyMs,
		Status:                reqCtx.Status,
		HTTPStatus:            reqCtx.HTTPStatus,
		ErrorCode:             reqCtx.ErrorCode,
		ErrorStage:            reqCtx.ErrorStage,
		CacheStatus:           reqCtx.CacheStatus,
		CacheType:             reqCtx.CacheType,
		CacheHitRequestID:     reqCtx.CacheHitRequestID,
		MaskingAction:         reqCtx.MaskingAction,
		MaskingDetectedTypes:  reqCtx.MaskingDetectedTypes,
		MaskingDetectedCount:  reqCtx.MaskingDetectedCount,
		RedactedPromptPreview: reqCtx.RedactedPromptPreview,
		CreatedAt:             reqCtx.StartedAt.UTC(),
		CompletedAt:           time.Now().UTC(),
	})
}

func requestParamsHash(chatReq provider.ChatCompletionRequest) string {
	payload, _ := json.Marshal(struct {
		Temperature *float64 `json:"temperature,omitempty"`
		MaxTokens   *int     `json:"max_tokens,omitempty"`
		Stream      bool     `json:"stream"`
	}{
		Temperature: chatReq.Temperature,
		MaxTokens:   chatReq.MaxTokens,
		Stream:      chatReq.Stream,
	})
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func normalizedMaskedRequestBodyHash(chatReq provider.ChatCompletionRequest) string {
	payload, err := json.Marshal(struct {
		Model    string                 `json:"model"`
		Messages []provider.ChatMessage `json:"messages"`
	}{
		Model:    strings.TrimSpace(chatReq.Model),
		Messages: chatReq.Messages,
	})
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func redactedPromptHash(redactedPrompt string) string {
	sum := sha256.Sum256([]byte(cachekey.NormalizeRedactedPrompt(redactedPrompt)))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func routingDecisionKeyHashFromRequestContext(reqCtx *pipeline.RequestContext) string {
	material := routingDecisionMaterialFromRequestContext(reqCtx)
	hash, err := routingdomain.DecisionKeyHash(material)
	if err != nil {
		return ""
	}
	return hash
}

func routingDecisionMaterialFromRequestContext(reqCtx *pipeline.RequestContext) routingdomain.DecisionMaterial {
	if reqCtx == nil {
		return routingdomain.DecisionMaterial{
			RoutingMode:   routingdomain.RoutingModeAuto,
			Category:      routingdomain.CategoryUnknown,
			Tier:          routingdomain.TierBalanced,
			Capability:    routingdomain.CapabilityChat,
			PolicyVariant: routingdomain.PolicyVariantDefault,
		}
	}
	routingMode := routingdomain.RoutingModePinned
	if strings.EqualFold(strings.TrimSpace(reqCtx.RequestedModel), "auto") {
		routingMode = routingdomain.RoutingModeAuto
	}
	tier := routingdomain.TierBalanced
	switch strings.TrimSpace(reqCtx.RoutingReason) {
	case routingdomain.ReasonShortPromptLowCost:
		tier = routingdomain.TierLowCost
	case routingdomain.ReasonDefaultBalanced, routingdomain.ReasonPinned, "", "not_routed":
		tier = routingdomain.TierBalanced
	}
	return routingdomain.DecisionMaterial{
		RoutingMode:   routingMode,
		Category:      routingdomain.CategoryUnknown,
		Tier:          tier,
		Capability:    routingdomain.CapabilityChat,
		PolicyVariant: routingdomain.PolicyVariantDefault,
	}
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
		BudgetScope:    reqCtx.BudgetScope,
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
		RequestID:                   reqCtx.RequestID,
		TraceID:                     reqCtx.TraceID,
		TenantID:                    reqCtx.TenantID,
		ProjectID:                   reqCtx.ProjectID,
		ApplicationID:               reqCtx.ApplicationID,
		BudgetScope:                 reqCtx.BudgetScope,
		APIKeyID:                    reqCtx.APIKeyID,
		AppTokenID:                  reqCtx.AppTokenID,
		EndUserID:                   reqCtx.EndUserID,
		FeatureID:                   reqCtx.FeatureID,
		ConfigHash:                  reqCtx.ConfigHash,
		SecurityPolicyHash:          reqCtx.SecurityPolicyHash,
		RuntimeSnapshot:             reqCtx.RuntimeSnapshot,
		RateLimitDecision:           reqCtx.RateLimitDecision,
		BudgetDecision:              reqCtx.BudgetDecision,
		Endpoint:                    reqCtx.Endpoint,
		Method:                      reqCtx.Method,
		Source:                      invocationlog.SourceCustomerApp,
		Stream:                      reqCtx.Stream,
		RequestedProvider:           reqCtx.RequestedProvider,
		RequestedModel:              reqCtx.RequestedModel,
		Provider:                    reqCtx.Provider,
		Model:                       reqCtx.Model,
		SelectedProvider:            reqCtx.SelectedProvider,
		SelectedProviderID:          reqCtx.SelectedProviderID,
		SelectedModel:               reqCtx.SelectedModel,
		SelectedModelID:             reqCtx.SelectedModelID,
		RoutingReason:               reqCtx.RoutingReason,
		RoutingPolicyHash:           reqCtx.RoutingPolicyHash,
		PromptCategory:              reqCtx.PromptCategory,
		PromptTokens:                reqCtx.PromptTokens,
		CompletionTokens:            reqCtx.CompletionTokens,
		TotalTokens:                 reqCtx.TotalTokens,
		CostMicroUSD:                reqCtx.CostMicroUSD,
		SavedCostMicroUSD:           reqCtx.SavedCostMicroUSD,
		LatencyMs:                   reqCtx.LatencyMs,
		ProviderLatencyMs:           providerLatencyMs,
		Status:                      reqCtx.Status,
		HTTPStatus:                  reqCtx.HTTPStatus,
		ErrorCode:                   reqCtx.ErrorCode,
		ErrorMessage:                reqCtx.ErrorMessage,
		ErrorStage:                  reqCtx.ErrorStage,
		CacheStatus:                 reqCtx.CacheStatus,
		CacheType:                   reqCtx.CacheType,
		CacheKeyHash:                reqCtx.CacheKeyHash,
		CacheHitRequestID:           reqCtx.CacheHitRequestID,
		CacheKeyVersion:             reqCtx.CacheKeyVersion,
		CacheDecisionReason:         reqCtx.CacheDecisionReason,
		FallbackOccurred:            reqCtx.FallbackOccurred,
		SemanticCacheHit:            reqCtx.SemanticCacheHit,
		SemanticSimilarity:          reqCtx.SemanticSimilarity,
		SemanticMatchedRequestID:    reqCtx.SemanticMatchedRequestID,
		SemanticCacheThreshold:      reqCtx.SemanticCacheThreshold,
		SemanticCachePolicyVersion:  reqCtx.SemanticCachePolicyVersion,
		SemanticCacheDecisionReason: reqCtx.SemanticCacheDecisionReason,
		EmbeddingProvider:           reqCtx.EmbeddingProvider,
		ProviderCatalogContentHash:  reqCtx.ProviderCatalogContentHash,
		RoutingDecisionKeyHash:      reqCtx.RoutingDecisionKeyHash,
		MaskingAction:               reqCtx.MaskingAction,
		MaskingDetectedTypes:        reqCtx.MaskingDetectedTypes,
		MaskingDetectedCount:        reqCtx.MaskingDetectedCount,
		RedactedPromptPreview:       reqCtx.RedactedPromptPreview,
		SecurityPolicyVersionID:     reqCtx.SecurityPolicyVersionID,
		DomainOutcomes:              reqCtx.DomainOutcomes,
		RedactedPromptForHash:       redactedPrompt,
		StartedAt:                   startedAt,
		CompletedAt:                 completedAt,
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
	if reqCtx == nil || reqCtx.CacheStatus == cachestage.CacheStatusHit || reqCtx.Status == invocationlog.StatusBlocked || reqCtx.Status == invocationlog.StatusRateLimited {
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
		status = invocationlog.StatusFailed
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
	reqCtx.BudgetScope = budget.NormalizeScope(reqCtx.BudgetScope, reqCtx.ApplicationID)

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
	reqCtx.BudgetScope = budget.NormalizeScope(reqCtx.BudgetScope, reqCtx.ApplicationID)

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

	reqCtx.Status = terminalStatusForGatewayError(gatewayErr.HTTPStatus, gatewayErr.Code)
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
