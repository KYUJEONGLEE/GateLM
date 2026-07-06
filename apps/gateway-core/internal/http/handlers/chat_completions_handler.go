package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	cacheadapter "gatelm/apps/gateway-core/internal/adapters/cache/memory"
	"gatelm/apps/gateway-core/internal/domain/auth"
	"gatelm/apps/gateway-core/internal/domain/budget"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/costing"
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
	"gatelm/apps/gateway-core/internal/domain/stagetiming"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
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

type CostCalculator interface {
	Calculate(ctx context.Context, req costing.Request) (costing.Result, error)
}

type CacheabilityClassifier interface {
	Classify(ctx context.Context, request cachekey.CacheabilityClassificationRequest) (cachekey.CacheabilityClassifierResult, error)
}

type ChatCompletionsHandler struct {
	Providers                            *provider.Registry
	ProviderCatalogResolver              providercatalog.Resolver
	CredentialResolver                   credentials.Resolver
	DefaultModel                         string
	DefaultProvider                      string
	MaxRequestBodyBytes                  int64
	APIKeyAuthenticator                  APIKeyAuthenticator
	AppTokenValidator                    AppTokenValidator
	ExpectedTenantID                     string
	ExpectedProjectID                    string
	ExpectedAppID                        string
	RuntimePolicyPipeline                GatewayPipeline
	RateLimitPipeline                    GatewayPipeline
	PreProviderPipeline                  GatewayPipeline
	AuthFailureLogWriter                 invocationlog.AuthFailureLogWriter
	TerminalLogWriter                    invocationlog.TerminalLogWriter
	CostCalculator                       CostCalculator
	MaskingEngine                        MaskingEngine
	MetricsRegistry                      *metrics.Registry
	ExactCacheStore                      ports.CacheStore
	ExactCacheKeyBuilder                 ExactCacheKeyBuilder
	ExactCacheTTL                        time.Duration
	CachePolicyHash                      string
	SecurityPolicyVersionID              string
	SemanticCacheService                 SemanticCacheService
	SemanticCacheEnabled                 bool
	SemanticCacheMode                    string
	SemanticCacheAllowCategories         []string
	SemanticCacheDenyCategories          []string
	SemanticCacheAllowedTenantIDs        []string
	SemanticCacheAllowedApplicationIDs   []string
	SemanticCacheAllowedCategories       []string
	SemanticCachePolicyVersion           string
	SemanticCacheKeyVersion              string
	SemanticCacheClassifier              CacheabilityClassifier
	SemanticCacheClassifierMinConfidence float64
	SemanticCacheClassifierTimeout       time.Duration
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
	h.initializeSemanticCacheContext(reqCtx)
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
		policyChecksStartedAt := time.Now()
		gatewayCtx := newGatewayContext(reqCtx, "")
		err := runtimePolicyPipeline.Execute(r.Context(), gatewayCtx)
		recordRequestStageTiming(reqCtx, stagetiming.StagePolicyChecksTotal, time.Since(policyChecksStartedAt))
		if err != nil {
			applyGatewayContext(reqCtx, gatewayCtx)
			writeGatewayPipelineFailure(w, reqCtx, err)
			return
		}
		applyGatewayContext(reqCtx, gatewayCtx)
	}

	maskingStartedAt := time.Now()
	maskingResult, redactedMessages, redactedPrompt, logSafePrompt, err := h.applyMasking(r.Context(), chatReq.Messages, firstNonEmpty(reqCtx.SecurityPolicyHash, reqCtx.SecurityPolicyVersionID), reqCtx.RuntimeSafetyPolicy)
	recordRequestStageTiming(reqCtx, stagetiming.StagePIIMasking, time.Since(maskingStartedAt))
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway masking failed.", "mask_or_block")
		return
	}
	reqCtx.MaskingAction = string(maskingResult.Action)
	reqCtx.MaskingDetectedTypes = maskingResult.DetectedTypes
	reqCtx.MaskingDetectedCount = maskingResult.DetectedCount
	reqCtx.PolicyAllowedTypes = maskingResult.PolicyAllowedTypes
	reqCtx.MandatoryProtectedTypes = maskingResult.MandatoryProtectedTypes
	if maskingResult.Action == maskdomain.ActionNone && len(maskingResult.PolicyAllowedTypes) == 0 {
		reqCtx.RedactedPromptPreview = ""
	} else {
		reqCtx.RedactedPromptPreview = maskingResult.RedactedPromptPreview
	}
	reqCtx.SecurityPolicyVersionID = maskingResult.SecurityPolicyVersionID
	terminalLogPrompt = firstNonEmpty(logSafePrompt, redactedPrompt)

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

	if shouldLookupExactCache(gatewayCtx) {
		if err := h.populateRoutingAwareCacheIdentity(r.Context(), reqCtx, chatReq.Model); err != nil {
			h.writeProviderResolutionFailure(w, reqCtx, err)
			return
		}
		gatewayCtx = newGatewayContext(reqCtx, promptText)
		cachePayload, cacheHitRequestID, savedCostMicroUSD, cacheHit := h.lookupExactCache(r.Context(), reqCtx, chatReq, promptText)
		applyExactCacheLookupToGatewayContext(gatewayCtx, reqCtx, cachePayload, cacheHitRequestID, savedCostMicroUSD, cacheHit)
	}
	if h.writeCachedChatCompletionIfHit(r.Context(), w, reqCtx, gatewayCtx, startedAt) {
		return
	}
	semanticCacheHit, semanticCacheLookupVector := h.writeSemanticCachedChatCompletionIfHit(r.Context(), w, reqCtx, chatReq, promptText, startedAt)
	if semanticCacheHit {
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

	providerReq := providerRequestForTarget(chatReq, requestID)
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

	if reqCtx.Stream {
		providerReq.Stream = true
		h.handleStreamingProvider(w, r, reqCtx, providerReq, chatReq, target, startedAt)
		return
	}

	providerReq.Stream = false
	providerStartedAt := time.Now()
	providerResp, err := target.Adapter.CreateChatCompletion(r.Context(), target.ExecutionConfig, providerReq)
	providerDuration := time.Since(providerStartedAt)
	recordRequestStageTiming(reqCtx, stagetiming.StageProviderResponse, providerDuration)
	reqCtx.ProviderLatencyMs = providerDuration.Milliseconds()
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonProviderErrorStoreBypass, h.semanticPromptCategory(reqCtx))
		h.handleProviderFailure(w, r, reqCtx, providerReq, target, err, providerDuration, startedAt)
		return
	}
	if providerResp == nil {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonProviderErrorStoreBypass, h.semanticPromptCategory(reqCtx))
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
	h.applyProviderUsageCost(r.Context(), reqCtx, target)
	if exactCachePolicyAllowsLookup(reqCtx) && (reqCtx.CacheStatus == "" || reqCtx.CacheStatus == cachestage.CacheStatusBypass) {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeExact
	}

	h.writeExactCache(r.Context(), reqCtx, providerResp)
	h.writeSemanticCache(r.Context(), reqCtx, chatReq, promptText, semanticCacheLookupVector, providerResp)
	h.writeChatCompletionResponse(r.Context(), w, reqCtx, providerResp)
}

func shouldLookupExactCache(gatewayCtx *request.GatewayContext) bool {
	if gatewayCtx == nil {
		return true
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

func applyExactCacheLookupToGatewayContext(gatewayCtx *request.GatewayContext, reqCtx *pipeline.RequestContext, payload []byte, cacheHitRequestID string, savedCostMicroUSD int64, hit bool) {
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
	gatewayCtx.Cache.SavedCostMicroUSD = 0
	if hit {
		gatewayCtx.Cache.CacheStatus = cachestage.CacheStatusHit
		gatewayCtx.Cache.CacheType = cachestage.CacheTypeExact
		gatewayCtx.Cache.CacheHitRequestID = cacheHitRequestID
		gatewayCtx.Cache.SavedCostMicroUSD = savedCostMicroUSD
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
	Adapter            provider.Adapter
	ExecutionConfig    provider.ExecutionConfig
	Catalog            providercatalog.Catalog
	ProviderID         string
	ProviderName       string
	AdapterType        string
	ModelID            string
	ModelName          string
	CatalogHash        string
	StreamingSupported bool
	FromCatalog        bool
	Fallback           bool
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
		Adapter:            adapter,
		ProviderName:       firstNonEmpty(providerName, adapter.AdapterType()),
		AdapterType:        adapter.AdapterType(),
		ModelID:            modelID,
		ModelName:          modelID,
		CatalogHash:        "legacy-provider-catalog-v1",
		StreamingSupported: legacyAdapterSupportsStreaming(adapter),
		ExecutionConfig: provider.ExecutionConfig{
			ProviderName: firstNonEmpty(providerName, adapter.AdapterType()),
			AdapterType:  adapter.AdapterType(),
		},
	}, nil
}

func legacyAdapterSupportsStreaming(adapter provider.Adapter) bool {
	if adapter == nil {
		return false
	}
	_, ok := adapter.(provider.StreamingAdapter)
	return ok
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
		Adapter:            adapter,
		Catalog:            catalog,
		ProviderID:         catalogProvider.ProviderID,
		ProviderName:       catalogProvider.ProviderName,
		AdapterType:        catalogProvider.AdapterType,
		ModelID:            catalogModel.ModelID,
		ModelName:          catalogModel.ModelName,
		CatalogHash:        catalog.ContentHash,
		StreamingSupported: catalogModel.Capabilities.StreamingSupported,
		FromCatalog:        true,
		Fallback:           fallback,
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

	fallbackReq := providerRequestForTarget(chatReq, reqCtx.RequestID)
	fallbackReq.Model = fallbackTarget.ModelName
	fallbackStartedAt := time.Now()
	fallbackResp, fallbackCallErr := fallbackTarget.Adapter.CreateChatCompletion(r.Context(), fallbackTarget.ExecutionConfig, fallbackReq)
	fallbackDuration := time.Since(fallbackStartedAt)
	recordRequestStageTiming(reqCtx, stagetiming.StageProviderResponse, fallbackDuration)
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
	reqCtx.SelectedProvider = fallbackTarget.ProviderName
	reqCtx.SelectedProviderID = fallbackTarget.ProviderID
	reqCtx.SelectedProviderCatalogKey = firstNonEmpty(fallbackTarget.ProviderName, reqCtx.SelectedProviderCatalogKey)
	reqCtx.SelectedModel = fallbackTarget.ModelID
	reqCtx.SelectedModelID = fallbackTarget.ModelID
	reqCtx.ProviderCatalogContentHash = firstNonEmpty(fallbackTarget.CatalogHash, reqCtx.ProviderCatalogContentHash)
	reqCtx.Provider = fallbackTarget.ProviderName
	reqCtx.Model = fallbackTarget.ModelID
	h.applyProviderUsageCost(r.Context(), reqCtx, fallbackTarget)
	reqCtx.FallbackOccurred = true
	skipExactCacheStore(reqCtx, "fallback_response_store_bypassed")
	h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonFallbackStoreBypass, h.semanticPromptCategory(reqCtx))
	reqCtx.DomainOutcomes = h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
		Outcome:          "success",
		FallbackProvider: stringPointerValue(fallbackTarget.ProviderName),
		Reason:           stringPointerValue(code),
	})

	h.writeChatCompletionResponse(r.Context(), w, reqCtx, fallbackResp)
}

func (h *ChatCompletionsHandler) handleStreamingProvider(w http.ResponseWriter, r *http.Request, reqCtx *pipeline.RequestContext, providerReq provider.ChatCompletionRequest, semanticCacheReq provider.ChatCompletionRequest, target providerCallTarget, startedAt time.Time) {
	streamAdapter, ok := target.Adapter.(provider.StreamingAdapter)
	if !target.StreamingSupported || !ok {
		h.writeStreamingUnsupported(w, reqCtx)
		return
	}

	providerStartedAt := time.Now()
	stream, err := streamAdapter.CreateChatCompletionStream(r.Context(), target.ExecutionConfig, providerReq)
	openDuration := time.Since(providerStartedAt)
	reqCtx.ProviderLatencyMs = openDuration.Milliseconds()
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		h.handleStreamingOpenFailure(w, r, reqCtx, providerReq, target, err, openDuration, startedAt)
		return
	}

	streamMetrics := h.startStreamMetrics(reqCtx.SelectedProvider, reqCtx.SelectedModel, providerStartedAt)
	started, usage, cacheableResp, streamErr := writeProviderStreamingChatCompletion(r.Context(), w, reqCtx, stream, streamMetrics)
	providerDuration := time.Since(providerStartedAt)
	recordRequestStageTiming(reqCtx, stagetiming.StageProviderResponse, providerDuration)
	reqCtx.ProviderLatencyMs = providerDuration.Milliseconds()
	reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
	if usage != nil {
		reqCtx.PromptTokens = usage.PromptTokens
		reqCtx.CompletionTokens = usage.CompletionTokens
		reqCtx.TotalTokens = usage.TotalTokens
	}

	if streamErr == nil {
		streamMetrics.finish("completed", "none", time.Now())
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: reqCtx.SelectedProvider,
			SelectedModel:    reqCtx.SelectedModel,
			Status:           invocationlog.StatusSuccess,
			HTTPStatus:       http.StatusOK,
			ErrorCode:        "none",
			DurationSeconds:  providerDuration.Seconds(),
		})
		reqCtx.Status = invocationlog.StatusSuccess
		reqCtx.HTTPStatus = http.StatusOK
		reqCtx.ErrorCode = ""
		reqCtx.ErrorMessage = ""
		reqCtx.ErrorStage = ""
		reqCtx.SavedCostMicroUSD = 0
		h.applyProviderUsageCost(r.Context(), reqCtx, target)
		reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, "completed")
		cacheCtx := context.WithoutCancel(r.Context())
		h.writeExactCache(cacheCtx, reqCtx, cacheableResp)
		h.writeSemanticCache(cacheCtx, reqCtx, semanticCacheReq, "", nil, cacheableResp)
		return
	}

	status := http.StatusBadGateway
	code := provider.SafeErrorCode(streamErr)
	message := "Provider streaming response failed."
	outcome := "interrupted"
	terminalStatus := invocationlog.StatusFailed
	if errors.Is(streamErr, context.Canceled) {
		status = gatewayerrors.StatusClientClosedRequest
		code = "internal_error"
		message = "Request was cancelled."
		outcome = "cancelled"
		terminalStatus = invocationlog.StatusCancelled
	}
	streamMetrics.finish(outcome, code, time.Now())

	h.recordProviderRequest(metrics.ProviderRequest{
		SelectedProvider: reqCtx.SelectedProvider,
		SelectedModel:    reqCtx.SelectedModel,
		Status:           terminalStatus,
		HTTPStatus:       status,
		ErrorCode:        code,
		DurationSeconds:  providerDuration.Seconds(),
	})
	reqCtx.Status = terminalStatus
	reqCtx.HTTPStatus = status
	reqCtx.ErrorCode = code
	reqCtx.ErrorMessage = message
	reqCtx.ErrorStage = "stream_provider_response"
	reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, outcome)
	reqCtx.DomainOutcomes.Provider = invocationlog.ProviderOutcome{
		Outcome:            streamingProviderFailureOutcome(streamErr),
		SelectedProvider:   stringPointerValue(reqCtx.SelectedProvider),
		SelectedModel:      stringPointerValue(reqCtx.SelectedModel),
		LatencyMs:          providerLatencyForLog(reqCtx),
		SanitizedErrorCode: stringPointerValue(code),
	}
	reqCtx.DomainOutcomes.Fallback = invocationlog.FallbackOutcome{Outcome: "not_called"}
	if !started {
		writeGatewayErrorWithContext(w, reqCtx, status, code, message, "stream_provider_response")
	}
}

func (h *ChatCompletionsHandler) handleStreamingOpenFailure(w http.ResponseWriter, r *http.Request, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, target providerCallTarget, err error, providerDuration time.Duration, startedAt time.Time) {
	recordRequestStageTiming(reqCtx, stagetiming.StageProviderResponse, providerDuration)
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
		writeGatewayErrorWithContext(w, reqCtx, gatewayerrors.StatusClientClosedRequest, "internal_error", "Request was cancelled.", "open_provider_stream")
		reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, "cancelled")
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
		reqCtx.DomainOutcomes = withStreamingOutcome(
			h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{Outcome: "not_called"}),
			reqCtx,
			"not_streaming",
		)
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, code, "Provider streaming request failed.", "open_provider_stream")
		return
	}

	fallbackTarget, fallbackErr := h.resolveFallbackTarget(r.Context(), reqCtx, target)
	if fallbackErr != nil {
		if requestWasCanceled(r.Context(), fallbackErr) {
			h.writeStreamingOpenCancellation(w, reqCtx, reqCtx.SelectedProvider, reqCtx.SelectedModel, providerDuration)
			return
		}
		reqCtx.DomainOutcomes = withStreamingOutcome(
			h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
				Outcome: "disabled",
				Reason:  stringPointerValue("fallback_not_configured"),
			}),
			reqCtx,
			"not_streaming",
		)
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, code, "Provider streaming request failed and fallback is unavailable.", "open_provider_stream")
		return
	}

	fallbackAdapter, ok := fallbackTarget.Adapter.(provider.StreamingAdapter)
	if !fallbackTarget.StreamingSupported || !ok {
		reqCtx.DomainOutcomes = withStreamingOutcome(
			h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
				Outcome:          "disabled",
				FallbackProvider: stringPointerValue(fallbackTarget.ProviderName),
				Reason:           stringPointerValue("streaming_not_supported"),
			}),
			reqCtx,
			"not_streaming",
		)
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, code, "Provider streaming request failed and streaming fallback is unavailable.", "open_provider_stream")
		return
	}

	fallbackReq := providerRequestForTarget(chatReq, reqCtx.RequestID)
	fallbackReq.Model = fallbackTarget.ModelName
	fallbackReq.Stream = true
	fallbackStartedAt := time.Now()
	stream, fallbackCallErr := fallbackAdapter.CreateChatCompletionStream(r.Context(), fallbackTarget.ExecutionConfig, fallbackReq)
	if fallbackCallErr != nil {
		fallbackDuration := time.Since(fallbackStartedAt)
		recordRequestStageTiming(reqCtx, stagetiming.StageProviderResponse, fallbackDuration)
		if requestWasCanceled(r.Context(), fallbackCallErr) {
			h.writeStreamingOpenCancellation(w, reqCtx, fallbackTarget.ProviderName, fallbackTarget.ModelID, fallbackDuration)
			return
		}
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: fallbackTarget.ProviderName,
			SelectedModel:    fallbackTarget.ModelID,
			Status:           invocationlog.StatusFailed,
			HTTPStatus:       http.StatusBadGateway,
			ErrorCode:        "fallback_failed",
			DurationSeconds:  fallbackDuration.Seconds(),
		})
		reqCtx.DomainOutcomes = withStreamingOutcome(
			h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
				Outcome:          "failed",
				FallbackProvider: stringPointerValue(fallbackTarget.ProviderName),
				Reason:           stringPointerValue("fallback_provider_failed"),
			}),
			reqCtx,
			"not_streaming",
		)
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, "fallback_failed", "Provider streaming request failed and fallback failed.", "open_provider_stream")
		return
	}

	primaryOutcomes := h.providerFailureDomainOutcomes(reqCtx, target, err, invocationlog.FallbackOutcome{
		Outcome:          "success",
		FallbackProvider: stringPointerValue(fallbackTarget.ProviderName),
		Reason:           stringPointerValue(code),
	})
	reqCtx.DomainOutcomes = primaryOutcomes
	originalSelectedProvider := reqCtx.SelectedProvider
	originalSelectedModel := reqCtx.SelectedModel
	reqCtx.SelectedProvider = fallbackTarget.ProviderName
	reqCtx.SelectedModel = fallbackTarget.ModelID
	reqCtx.Provider = fallbackTarget.ProviderName
	reqCtx.Model = fallbackTarget.ModelID

	streamMetrics := h.startStreamMetrics(fallbackTarget.ProviderName, fallbackTarget.ModelID, fallbackStartedAt)
	started, usage, _, streamErr := writeProviderStreamingChatCompletion(r.Context(), w, reqCtx, stream, streamMetrics)
	fallbackDuration := time.Since(fallbackStartedAt)
	recordRequestStageTiming(reqCtx, stagetiming.StageProviderResponse, fallbackDuration)
	if usage != nil {
		reqCtx.PromptTokens = usage.PromptTokens
		reqCtx.CompletionTokens = usage.CompletionTokens
		reqCtx.TotalTokens = usage.TotalTokens
	}
	if streamErr == nil {
		streamMetrics.finish("completed", "none", time.Now())
		h.recordProviderRequest(metrics.ProviderRequest{
			SelectedProvider: fallbackTarget.ProviderName,
			SelectedModel:    fallbackTarget.ModelID,
			Status:           invocationlog.StatusSuccess,
			HTTPStatus:       http.StatusOK,
			ErrorCode:        "none",
			DurationSeconds:  fallbackDuration.Seconds(),
		})
		reqCtx.Status = invocationlog.StatusSuccess
		reqCtx.HTTPStatus = http.StatusOK
		reqCtx.ErrorCode = ""
		reqCtx.ErrorMessage = ""
		reqCtx.ErrorStage = ""
		reqCtx.LatencyMs = time.Since(startedAt).Milliseconds()
		reqCtx.SavedCostMicroUSD = 0
		h.applyProviderUsageCost(r.Context(), reqCtx, fallbackTarget)
		reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, "completed")
		return
	}

	reqCtx.SelectedProvider = originalSelectedProvider
	reqCtx.SelectedModel = originalSelectedModel
	reqCtx.Provider = originalSelectedProvider
	reqCtx.Model = originalSelectedModel
	status := http.StatusBadGateway
	streamCode := provider.SafeErrorCode(streamErr)
	outcome := "interrupted"
	terminalStatus := invocationlog.StatusFailed
	if errors.Is(streamErr, context.Canceled) {
		status = gatewayerrors.StatusClientClosedRequest
		streamCode = "internal_error"
		outcome = "cancelled"
		terminalStatus = invocationlog.StatusCancelled
	}
	streamMetrics.finish(outcome, streamCode, time.Now())
	h.recordProviderRequest(metrics.ProviderRequest{
		SelectedProvider: fallbackTarget.ProviderName,
		SelectedModel:    fallbackTarget.ModelID,
		Status:           terminalStatus,
		HTTPStatus:       status,
		ErrorCode:        streamCode,
		DurationSeconds:  fallbackDuration.Seconds(),
	})
	reqCtx.Status = terminalStatus
	reqCtx.HTTPStatus = status
	reqCtx.ErrorCode = streamCode
	reqCtx.ErrorMessage = "Provider streaming fallback response failed."
	reqCtx.ErrorStage = "stream_provider_response"
	reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, outcome)
	reqCtx.DomainOutcomes.Fallback = invocationlog.FallbackOutcome{
		Outcome:          "failed",
		FallbackProvider: stringPointerValue(fallbackTarget.ProviderName),
		Reason:           stringPointerValue("fallback_provider_failed"),
	}
	if !started {
		writeGatewayErrorWithContext(w, reqCtx, status, streamCode, "Provider streaming fallback response failed.", "stream_provider_response")
	}
}

func requestWasCanceled(ctx context.Context, err error) bool {
	if errors.Is(err, context.Canceled) {
		return true
	}
	if ctx == nil {
		return false
	}
	return errors.Is(ctx.Err(), context.Canceled)
}

func (h *ChatCompletionsHandler) writeStreamingOpenCancellation(w http.ResponseWriter, reqCtx *pipeline.RequestContext, selectedProvider string, selectedModel string, duration time.Duration) {
	h.recordProviderRequest(metrics.ProviderRequest{
		SelectedProvider: selectedProvider,
		SelectedModel:    selectedModel,
		Status:           invocationlog.StatusCancelled,
		HTTPStatus:       gatewayerrors.StatusClientClosedRequest,
		ErrorCode:        "internal_error",
		DurationSeconds:  duration.Seconds(),
	})
	writeGatewayErrorWithContext(w, reqCtx, gatewayerrors.StatusClientClosedRequest, "internal_error", "Request was cancelled.", "open_provider_stream")
	reqCtx.DomainOutcomes = streamingFinalDomainOutcomes(reqCtx, "cancelled")
}

func streamingProviderFailureOutcome(err error) string {
	switch provider.ErrorKindOf(err) {
	case provider.ErrorKindTimeout:
		return "timeout"
	case provider.ErrorKindUnauthorized:
		return "unauthorized"
	default:
		return "error"
	}
}

func (h *ChatCompletionsHandler) writeStreamingUnsupported(w http.ResponseWriter, reqCtx *pipeline.RequestContext) {
	writeGatewayErrorWithContext(w, reqCtx, http.StatusBadRequest, "streaming_not_supported", "Selected provider model does not support streaming.", "resolve_provider_streaming")
	outcomes := buildDomainOutcomesFromRequestContext(reqCtx)
	outcomes.Provider = invocationlog.ProviderOutcome{
		Outcome:          "not_called",
		SelectedProvider: stringPointerValue(reqCtx.SelectedProvider),
		SelectedModel:    stringPointerValue(reqCtx.SelectedModel),
	}
	outcomes.Fallback = invocationlog.FallbackOutcome{Outcome: "not_called"}
	outcomes.Streaming = invocationlog.StreamingOutcome{
		Outcome:            "not_streaming",
		StreamingRequested: reqCtx.Stream,
	}
	reqCtx.DomainOutcomes = outcomes
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
	if strings.TrimSpace(h.SemanticCacheMode) == "" {
		h.SemanticCacheMode = cachekey.SemanticCacheModeEnforce
	}
	if len(h.SemanticCacheAllowCategories) == 0 {
		h.SemanticCacheAllowCategories = []string{cachekey.SemanticCacheCategoryGeneral}
	}
	if len(h.SemanticCacheDenyCategories) == 0 {
		h.SemanticCacheDenyCategories = []string{
			cachekey.SemanticCacheCategoryAccountAccess,
			cachekey.SemanticCacheCategorySupportRefund,
			cachekey.SemanticCacheCategoryCode,
			cachekey.SemanticCacheCategoryTranslation,
			cachekey.SemanticCacheCategoryReasoning,
			cachekey.SemanticCacheCategorySensitive,
			cachekey.SemanticCacheCategoryToolCall,
			cachekey.SemanticCacheCategoryUnknown,
		}
	}
}

func (h *ChatCompletionsHandler) applyMasking(ctx context.Context, messages []provider.ChatMessage, securityPolicyVersionID string, safetyPolicy runtimeconfig.SafetyPolicy) (maskdomain.Result, []provider.ChatMessage, string, string, error) {
	redactedMessages := make([]provider.ChatMessage, len(messages))
	results := make([]maskdomain.Result, 0, len(messages))
	redactedPromptParts := make([]string, 0, len(messages))
	entityScope := maskdomain.NewEntityScope()
	logSafePromptParts := make([]string, 0, len(messages))
	if strings.TrimSpace(securityPolicyVersionID) == "" {
		securityPolicyVersionID = h.SecurityPolicyVersionID
	}
	detectorPolicies := maskingDetectorPolicies(safetyPolicy)

	for index, message := range messages {
		content, err := chatMessageText(message)
		if err != nil {
			return maskdomain.Result{}, nil, "", "", err
		}

		result, err := h.MaskingEngine.Apply(ctx, maskdomain.ApplyRequest{
			Prompt:                  content,
			SecurityPolicyVersionID: securityPolicyVersionID,
			EntityScope:             entityScope,
			DetectorPolicies:        detectorPolicies,
		})
		if err != nil {
			return maskdomain.Result{}, nil, "", "", err
		}

		redactedMessages[index] = message
		encodedContent, err := json.Marshal(result.RedactedPrompt)
		if err != nil {
			return maskdomain.Result{}, nil, "", "", err
		}
		redactedMessages[index].Content = encodedContent
		results = append(results, result)
		redactedPromptParts = append(redactedPromptParts, result.RedactedPrompt)
		logSafePromptParts = append(logSafePromptParts, firstNonEmpty(result.LogSafePrompt, result.RedactedPrompt))
	}

	combinedPrompt := strings.Join(redactedPromptParts, "\n")
	combinedLogSafePrompt := strings.Join(logSafePromptParts, "\n")
	combined := combineMaskingResults(results, combinedPrompt, combinedLogSafePrompt, securityPolicyVersionID)
	return combined, redactedMessages, combinedPrompt, combinedLogSafePrompt, nil
}

func combineMaskingResults(results []maskdomain.Result, redactedPrompt string, logSafePrompt string, fallbackPolicyVersion string) maskdomain.Result {
	action := maskdomain.ActionNone
	detectedTypeSet := map[string]struct{}{}
	policyAllowedTypeSet := map[string]struct{}{}
	mandatoryProtectedTypeSet := map[string]struct{}{}
	detectedCount := 0
	policyAllowedCount := 0
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
		for _, detectorType := range result.PolicyAllowedTypes {
			policyAllowedTypeSet[detectorType] = struct{}{}
		}
		for _, detectorType := range result.MandatoryProtectedTypes {
			mandatoryProtectedTypeSet[detectorType] = struct{}{}
		}
		detectedCount += result.DetectedCount
		policyAllowedCount += result.PolicyAllowedCount
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
	policyAllowedTypes := sortedKeys(policyAllowedTypeSet)
	mandatoryProtectedTypes := sortedKeys(mandatoryProtectedTypeSet)
	if strings.TrimSpace(logSafePrompt) == "" {
		logSafePrompt = redactedPrompt
	}

	return maskdomain.Result{
		Action:                  action,
		DetectedTypes:           detectedTypes,
		DetectedCount:           detectedCount,
		PolicyAllowedTypes:      policyAllowedTypes,
		PolicyAllowedCount:      policyAllowedCount,
		MandatoryProtectedTypes: mandatoryProtectedTypes,
		RedactedPrompt:          redactedPrompt,
		LogSafePrompt:           logSafePrompt,
		RedactedPromptPreview:   maskdomain.PreviewRedactedPrompt(logSafePrompt),
		SecurityPolicyVersionID: securityPolicyVersionID,
	}
}

func maskingDetectorPolicies(policy runtimeconfig.SafetyPolicy) []maskdomain.DetectorPolicy {
	policy = policy.Normalize()
	if len(policy.DetectorSet) == 0 {
		return nil
	}
	policies := make([]maskdomain.DetectorPolicy, 0, len(policy.DetectorSet))
	for _, detector := range policy.DetectorSet {
		policies = append(policies, maskdomain.DetectorPolicy{
			DetectorType: detector.DetectorType,
			Action:       maskdomain.PolicyAction(detector.Action),
		})
	}
	return policies
}

func sortedKeys(set map[string]struct{}) []string {
	if len(set) == 0 {
		return nil
	}
	values := make([]string, 0, len(set))
	for value := range set {
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

func (h *ChatCompletionsHandler) lookupExactCache(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string) ([]byte, string, int64, bool) {
	cacheStartedAt := time.Now()
	defer func() {
		recordRequestStageTiming(reqCtx, stagetiming.StageCacheExactLookup, time.Since(cacheStartedAt))
	}()
	if reqCtx.MaskingAction == string(maskdomain.ActionBlocked) {
		bypassExactCache(reqCtx, "masking_blocked")
		return nil, "", 0, false
	}
	if h.ExactCacheStore == nil || h.ExactCacheKeyBuilder == nil {
		bypassExactCache(reqCtx, "cache_dependency_unavailable")
		return nil, "", 0, false
	}

	keyHash, err := h.buildExactCacheKey(ctx, reqCtx, chatReq, redactedPrompt)
	if err != nil {
		reqCtx.CacheStatus = cachestage.CacheStatusError
		reqCtx.CacheType = cachestage.CacheTypeExact
		reqCtx.CacheDecisionReason = "key_build_error"
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "error")
		return nil, "", 0, false
	}
	reqCtx.CacheKeyHash = keyHash

	lookup, err := h.ExactCacheStore.GetExact(ctx, keyHash)
	if err != nil {
		reqCtx.CacheStatus = cachestage.CacheStatusError
		reqCtx.CacheType = cachestage.CacheTypeExact
		reqCtx.CacheDecisionReason = "lookup_error"
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "error")
		return nil, "", 0, false
	}

	if !lookup.Hit {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeExact
		reqCtx.CacheDecisionReason = "routing_aware_key_miss"
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
		return nil, "", 0, false
	}

	reqCtx.CacheStatus = cachestage.CacheStatusHit
	reqCtx.CacheType = cachestage.CacheTypeExact
	reqCtx.CacheDecisionReason = "routing_aware_key_hit"
	h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
	return lookup.Payload, lookup.CacheHitRequestID, lookup.SavedCostMicroUSD, true
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
	if h.ExactCacheStore == nil || reqCtx.CacheStatus != cachestage.CacheStatusMiss || reqCtx.CacheKeyHash == "" || providerResp == nil || reqCtx.FallbackOccurred {
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
		KeyHash:           reqCtx.CacheKeyHash,
		RequestID:         reqCtx.RequestID,
		SavedCostMicroUSD: reqCtx.CostMicroUSD,
		Payload:           payload,
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

func (h *ChatCompletionsHandler) writeSemanticCachedChatCompletionIfHit(ctx context.Context, w http.ResponseWriter, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string, startedAt time.Time) (bool, []float64) {
	if reqCtx == nil {
		return false, nil
	}
	cacheStartedAt := time.Now()
	defer func() { recordRequestStageTiming(reqCtx, stagetiming.StageCacheSemantic, time.Since(cacheStartedAt)) }()
	h.initializeSemanticCacheContext(reqCtx)
	promptCategory := h.semanticPromptCategory(reqCtx)
	if !h.semanticCacheConfiguredEnabled() {
		return false, nil
	}
	if h.semanticCacheMode() == cachekey.SemanticCacheModeOff {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonModeOff, promptCategory)
		return false, nil
	}
	if h.SemanticCacheService == nil || !h.SemanticCacheService.Enabled() {
		return false, nil
	}
	if reqCtx.MaskingAction == string(maskdomain.ActionBlocked) {
		h.markSemanticCacheBypass(reqCtx, "safety_blocked", promptCategory)
		return false, nil
	}
	if reqCtx.CacheStatus == cachestage.CacheStatusHit {
		h.markSemanticCacheBypass(reqCtx, "exact_cache_hit", promptCategory)
		return false, nil
	}
	if !h.semanticRolloutTenantAllowed(reqCtx.TenantID) {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonTenantDenied, promptCategory)
		return false, nil
	}
	if !h.semanticRolloutApplicationAllowed(reqCtx.ApplicationID) {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonApplicationDenied, promptCategory)
		return false, nil
	}
	if reqCtx.RoutingDecisionKeyHash == "" {
		if err := h.populateRoutingAwareCacheIdentity(ctx, reqCtx, chatReq.Model); err != nil {
			h.markSemanticCacheBypass(reqCtx, "semantic_boundary_unavailable", promptCategory)
			return false, nil
		}
	}
	boundary, ok := h.semanticCacheBoundary(reqCtx, chatReq)
	if !ok {
		h.markSemanticCacheBypass(reqCtx, "semantic_boundary_unavailable", promptCategory)
		return false, nil
	}
	if !h.semanticCategoryAllowed(boundary.PromptCategory) {
		h.markSemanticCacheBypass(reqCtx, semanticCacheCategoryDenyReason(boundary.PromptCategory), boundary.PromptCategory)
		return false, nil
	}
	if !h.semanticRolloutCategoryAllowed(boundary.PromptCategory) {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonCategoryScopeDenied, boundary.PromptCategory)
		return false, nil
	}
	embeddingInput, ok := semanticEmbeddingInput(chatReq.Messages)
	if !ok {
		h.markSemanticCacheBypass(reqCtx, firstNonEmpty(embeddingInput.BypassReason, cachekey.SemanticCacheReasonEmbeddingInputUnavailable), boundary.PromptCategory)
		return false, nil
	}
	normalizedText := embeddingInput.Text

	if !h.semanticCacheabilityGateAllowsLookup(ctx, reqCtx, boundary, normalizedText) {
		return false, nil
	}

	result, decision, err := h.SemanticCacheService.Search(ctx, cachekey.SemanticCacheLookupRequest{
		Boundary:               boundary,
		NormalizedText:         normalizedText,
		CacheabilityGatePassed: true,
	})
	h.applySemanticCacheDecision(reqCtx, decision)
	h.applySemanticCacheSearchMetadata(reqCtx, result)
	if err != nil {
		reqCtx.SemanticCacheStoreCandidate = false
		h.recordCacheOperation("lookup", cachestage.CacheStatusError, cachestage.CacheTypeSemantic, "error")
		return false, nil
	}
	if h.semanticCacheMode() == cachekey.SemanticCacheModeShadow {
		reqCtx.SemanticReturnedFromCache = false
		reqCtx.SemanticCacheHit = false
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeSemantic
		if result.Hit && result.MatchedEntry != nil {
			reqCtx.SemanticCacheWouldHit = true
			reqCtx.SemanticCacheWouldMiss = false
			reqCtx.SemanticCacheDecisionReason = cachekey.SemanticCacheReasonShadowWouldHit
			reqCtx.CacheDecisionReason = cachekey.SemanticCacheReasonShadowWouldHit
			reqCtx.SemanticMatchedRequestID = ""
			reqCtx.CacheHitRequestID = ""
			reqCtx.SemanticCacheStoreCandidate = false
			h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
			return false, nil
		}
		reqCtx.SemanticCacheWouldHit = false
		reqCtx.SemanticCacheWouldMiss = true
		reqCtx.SemanticCacheDecisionReason = cachekey.SemanticCacheReasonShadowWouldMiss
		reqCtx.CacheDecisionReason = cachekey.SemanticCacheReasonShadowWouldMiss
		reqCtx.SemanticCacheStoreCandidate = true
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
		reqCtx.SemanticCacheLookupVector = append([]float64(nil), result.QueryVector...)
		return false, append([]float64(nil), reqCtx.SemanticCacheLookupVector...)
	}
	if !result.Hit || result.MatchedEntry == nil {
		reqCtx.CacheStatus = cachestage.CacheStatusMiss
		reqCtx.CacheType = cachestage.CacheTypeSemantic
		reqCtx.CacheDecisionReason = firstNonEmpty(decision.SemanticCacheDecisionReason, cachekey.SemanticCacheReasonThresholdMiss)
		reqCtx.SemanticCacheStoreCandidate = true
		h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")
		reqCtx.SemanticCacheLookupVector = append([]float64(nil), result.QueryVector...)
		return false, append([]float64(nil), reqCtx.SemanticCacheLookupVector...)
	}

	reqCtx.CacheStatus = cachestage.CacheStatusHit
	reqCtx.CacheType = cachestage.CacheTypeSemantic
	reqCtx.CacheKeyHash = ""
	reqCtx.CacheHitRequestID = decision.SemanticMatchedRequestID
	reqCtx.CacheKeyVersion = firstNonEmpty(h.SemanticCacheKeyVersion, "v1")
	reqCtx.CacheDecisionReason = firstNonEmpty(decision.SemanticCacheDecisionReason, cachekey.SemanticCacheReasonHit)
	reqCtx.SemanticCacheStoreCandidate = false
	reqCtx.SemanticReturnedFromCache = true
	reqCtx.SemanticCacheLookupVector = nil
	reqCtx.RoutingReason = firstNonEmpty(reqCtx.RoutingReason, "semantic_cache_hit_provider_bypass")
	h.recordCacheOperation("lookup", reqCtx.CacheStatus, reqCtx.CacheType, "success")

	gatewayCtx := newGatewayContext(reqCtx, "")
	gatewayCtx.Cache.CacheStatus = cachestage.CacheStatusHit
	gatewayCtx.Cache.CacheType = cachestage.CacheTypeSemantic
	gatewayCtx.Cache.CacheHitRequestID = reqCtx.CacheHitRequestID
	gatewayCtx.Cache.CacheDecisionReason = reqCtx.CacheDecisionReason
	gatewayCtx.Cache.Payload = append([]byte(nil), result.MatchedEntry.CachedResponse...)
	return h.writeCachedChatCompletionIfHit(ctx, w, reqCtx, gatewayCtx, startedAt), nil
}

func (h *ChatCompletionsHandler) writeSemanticCache(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, redactedPrompt string, embeddingVector []float64, providerResp *provider.ChatCompletionResponse) {
	if reqCtx == nil {
		return
	}
	h.initializeSemanticCacheContext(reqCtx)
	if !h.semanticCacheConfiguredEnabled() || h.semanticCacheMode() == cachekey.SemanticCacheModeOff || h.SemanticCacheService == nil || !h.SemanticCacheService.Enabled() || !reqCtx.SemanticCacheStoreCandidate {
		return
	}
	promptCategory := h.semanticPromptCategory(reqCtx)
	if reqCtx.FallbackOccurred {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonFallbackStoreBypass, promptCategory)
		return
	}
	if providerResp == nil {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonProviderErrorStoreBypass, promptCategory)
		return
	}
	if !h.semanticRolloutTenantAllowed(reqCtx.TenantID) {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonTenantDenied, promptCategory)
		return
	}
	if !h.semanticRolloutApplicationAllowed(reqCtx.ApplicationID) {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonApplicationDenied, promptCategory)
		return
	}
	boundary, ok := h.semanticCacheBoundary(reqCtx, chatReq)
	if !ok {
		h.markSemanticCacheBypass(reqCtx, "semantic_boundary_unavailable", promptCategory)
		return
	}
	if !h.semanticCategoryAllowed(boundary.PromptCategory) {
		h.markSemanticCacheBypass(reqCtx, semanticCacheCategoryDenyReason(boundary.PromptCategory), boundary.PromptCategory)
		return
	}
	if !h.semanticRolloutCategoryAllowed(boundary.PromptCategory) {
		h.markSemanticCacheBypass(reqCtx, cachekey.SemanticCacheReasonCategoryScopeDenied, boundary.PromptCategory)
		return
	}
	if !h.semanticCacheabilityGateAllowsStore(reqCtx, boundary) {
		return
	}
	embeddingInput, ok := semanticEmbeddingInput(chatReq.Messages)
	if !ok {
		h.markSemanticCacheBypass(reqCtx, firstNonEmpty(embeddingInput.BypassReason, cachekey.SemanticCacheReasonEmbeddingInputUnavailable), boundary.PromptCategory)
		return
	}
	normalizedText := embeddingInput.Text
	if len(embeddingVector) == 0 && len(reqCtx.SemanticCacheLookupVector) > 0 {
		embeddingVector = append([]float64(nil), reqCtx.SemanticCacheLookupVector...)
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
	shadowReason := ""
	if h.semanticCacheMode() == cachekey.SemanticCacheModeShadow {
		shadowReason = reqCtx.SemanticCacheDecisionReason
	}
	responseCacheabilityClass := semanticResponseCacheabilityClass(reqCtx, boundary, payload)
	decision, err := h.SemanticCacheService.Upsert(ctx, cachekey.SemanticCacheStoreRequest{
		EntryID:                   reqCtx.RequestID,
		RequestID:                 reqCtx.RequestID,
		Boundary:                  boundary,
		NormalizedText:            normalizedText,
		EmbeddingVector:           append([]float64(nil), embeddingVector...),
		CachedResponse:            payload,
		ResponseCacheabilityClass: responseCacheabilityClass,
		ProviderOutcome:           cachekey.SemanticCacheProviderOutcomeSuccess,
		FallbackUsed:              reqCtx.FallbackOccurred,
		Stream:                    reqCtx.Stream,
		Now:                       time.Now().UTC(),
	})
	h.applySemanticCacheDecision(reqCtx, decision)
	if shadowReason == cachekey.SemanticCacheReasonShadowWouldMiss || shadowReason == cachekey.SemanticCacheReasonShadowWouldHit {
		reqCtx.SemanticCacheDecisionReason = shadowReason
		reqCtx.CacheDecisionReason = shadowReason
	}
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

func semanticResponseCacheabilityClass(reqCtx *pipeline.RequestContext, boundary cachekey.SemanticCacheBoundary, payload []byte) string {
	if reqCtx == nil || len(payload) == 0 {
		return cachekey.SemanticCacheResponseCacheabilityUnsafeOrUnknown
	}
	if reqCtx.FallbackOccurred {
		return cachekey.SemanticCacheResponseCacheabilityProviderError
	}
	payloadText := strings.ToLower(string(payload))
	if semanticResponseContainsCredentialMarker(payloadText) {
		return cachekey.SemanticCacheResponseCacheabilityCredentialSecret
	}
	if semanticResponseContainsProviderErrorMarker(payloadText) {
		return cachekey.SemanticCacheResponseCacheabilityProviderError
	}
	if semanticResponseContainsDynamicStateMarker(payloadText) {
		return cachekey.SemanticCacheResponseCacheabilityDynamicUserState
	}
	return semanticResponseCacheabilityClassFromIntent(
		cachekey.CanonicalSemanticCacheCategory(firstNonEmpty(reqCtx.PromptCategory, boundary.PromptCategory)),
		reqCtx.SemanticCanonicalIntent,
	)
}

func semanticResponseCacheabilityClassFromIntent(category string, canonicalIntent string) string {
	canonicalIntent = strings.TrimSpace(canonicalIntent)
	if canonicalIntent == "" {
		return cachekey.SemanticCacheResponseCacheabilityUnsafeOrUnknown
	}
	switch {
	case semanticStaticGuidanceIntent(canonicalIntent):
		return cachekey.SemanticCacheResponseCacheabilityStaticGuidance
	case semanticPolicySummaryIntent(canonicalIntent):
		return cachekey.SemanticCacheResponseCacheabilityPolicySummary
	}
	switch cachekey.CanonicalSemanticCacheCategory(category) {
	case cachekey.SemanticCacheCategoryGeneral, cachekey.SemanticCacheCategoryAccountAccess:
		if strings.Contains(canonicalIntent, "_location") || strings.HasSuffix(canonicalIntent, "_check") {
			return cachekey.SemanticCacheResponseCacheabilityStaticGuidance
		}
	case cachekey.SemanticCacheCategorySupportRefund:
		if strings.HasPrefix(canonicalIntent, "support_refund.") && canonicalIntent != "support_refund.order_cancel" {
			return cachekey.SemanticCacheResponseCacheabilityPolicySummary
		}
	}
	return cachekey.SemanticCacheResponseCacheabilityUnsafeOrUnknown
}

func semanticStaticGuidanceIntent(canonicalIntent string) bool {
	switch strings.TrimSpace(canonicalIntent) {
	case "account.password_reset",
		"account.api_key_create",
		"account.app_token_create",
		"account.app_token_delete",
		"account.profile_settings_location",
		"account.security_settings_location",
		"usage.monthly_usage_check",
		"performance.rps_definition",
		"performance.tps_definition",
		"performance.latency_definition",
		"performance.throughput_definition",
		"performance.error_rate_definition",
		"performance.rps_tps_compare",
		"product.help_center_location",
		"billing.invoice_location",
		"billing.payment_method_location",
		"team.member_invite_location",
		"project.settings_location",
		"developer.api_docs_location",
		"product.status_page_location",
		"product.release_notes_location",
		"product.notification_settings_location",
		"team.role_permission_location",
		"billing.plan_pricing_location",
		"product.data_export_location":
		return true
	default:
		return false
	}
}

func semanticPolicySummaryIntent(canonicalIntent string) bool {
	switch strings.TrimSpace(canonicalIntent) {
	case "support_refund.shipping_fee_refund",
		"support_refund.return_shipping_fee",
		"support_refund.refund_request",
		"support_refund.exchange_request":
		return true
	default:
		return false
	}
}

func semanticResponseContainsCredentialMarker(payloadText string) bool {
	for _, marker := range []string{
		"api_key=",
		"app_token=",
		"provider_key=",
		"authorization:",
		"bearer ",
		"raw prompt",
		"raw pii",
		"raw response",
		"raw detected value",
		"raw prompt fragment",
		"actual secret",
	} {
		if strings.Contains(payloadText, marker) {
			return true
		}
	}
	return false
}

func semanticResponseContainsProviderErrorMarker(payloadText string) bool {
	for _, marker := range []string{
		"provider raw error",
		"provider error",
		"provider failed",
		"upstream error",
		"fallback response",
	} {
		if strings.Contains(payloadText, marker) {
			return true
		}
	}
	return false
}

func semanticResponseContainsDynamicStateMarker(payloadText string) bool {
	for _, marker := range []string{
		"account status",
		"billing amount",
		"current usage",
		"invoice status",
		"monthly usage",
		"order status",
		"payment status",
		"quota remaining",
		"refund status",
		"usage_count",
		"계정 상태",
		"결제 상태",
		"남은 한도",
		"사용량:",
		"이번 달",
		"이번 달 사용량",
		"주문 상태",
		"처리 상태",
		"환불 상태",
	} {
		if strings.Contains(payloadText, marker) {
			return true
		}
	}
	return false
}

func (h *ChatCompletionsHandler) writeChatCompletionResponse(ctx context.Context, w http.ResponseWriter, reqCtx *pipeline.RequestContext, providerResp *provider.ChatCompletionResponse) {
	if reqCtx == nil || providerResp == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadGateway, provider.ErrorCodeProviderError, "Provider returned an empty response.", "call_provider_with_timeout_retry_fallback")
		return
	}

	if responseText := capturedChatCompletionResponse(providerResp); responseText != "" {
		reqCtx.CapturedResponse = responseText
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

type streamRelayMetricsRecorder struct {
	registry         *metrics.Registry
	selectedProvider string
	selectedModel    string
	startedAt        time.Time
	ttftRecorded     bool
	finished         bool
}

func (h *ChatCompletionsHandler) startStreamMetrics(selectedProvider string, selectedModel string, startedAt time.Time) *streamRelayMetricsRecorder {
	if h == nil || h.MetricsRegistry == nil {
		return nil
	}
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	h.MetricsRegistry.StreamStarted(selectedProvider, selectedModel)
	return &streamRelayMetricsRecorder{
		registry:         h.MetricsRegistry,
		selectedProvider: selectedProvider,
		selectedModel:    selectedModel,
		startedAt:        startedAt,
	}
}

func (r *streamRelayMetricsRecorder) recordTTFTIfContent(payload json.RawMessage, observedAt time.Time) {
	if r == nil || r.registry == nil || r.ttftRecorded || !streamEventHasContentDelta(payload) {
		return
	}
	if observedAt.IsZero() {
		observedAt = time.Now()
	}
	r.ttftRecorded = true
	r.registry.StreamTimeToFirstToken(metrics.StreamTimeToFirstToken{
		SelectedProvider: r.selectedProvider,
		SelectedModel:    r.selectedModel,
		DurationSeconds:  observedAt.Sub(r.startedAt).Seconds(),
	})
}

func (r *streamRelayMetricsRecorder) finish(outcome string, errorCode string, completedAt time.Time) {
	if r == nil || r.registry == nil || r.finished {
		return
	}
	if completedAt.IsZero() {
		completedAt = time.Now()
	}
	r.finished = true
	r.registry.StreamFinished(metrics.StreamRelay{
		SelectedProvider: r.selectedProvider,
		SelectedModel:    r.selectedModel,
		Outcome:          outcome,
		ErrorCode:        errorCode,
		DurationSeconds:  completedAt.Sub(r.startedAt).Seconds(),
	})
}

func streamEventHasContentDelta(payload json.RawMessage) bool {
	if len(payload) == 0 {
		return false
	}
	if !bytes.Contains(payload, []byte(`"content"`)) {
		return false
	}
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content *string `json:"content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &chunk); err != nil {
		return false
	}
	for _, choice := range chunk.Choices {
		if choice.Delta.Content != nil && *choice.Delta.Content != "" {
			return true
		}
	}
	return false
}

func writeProviderStreamingChatCompletion(
	ctx context.Context,
	w http.ResponseWriter,
	reqCtx *pipeline.RequestContext,
	stream provider.ChatCompletionStreamReader,
	streamMetrics *streamRelayMetricsRecorder,
) (bool, *provider.Usage, *provider.ChatCompletionResponse, error) {
	if err := ctx.Err(); err != nil {
		return false, nil, nil, err
	}
	if stream == nil {
		return false, nil, nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("provider stream is not initialized"))
	}
	defer stream.Close()

	firstEvent, err := stream.Next()
	if err != nil && !errors.Is(err, io.EOF) {
		return false, nil, nil, err
	}

	setGatewayHeaders(w, reqCtx)
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flushResponse(w)

	accumulator := newStreamingCacheAccumulator(reqCtx)
	var usage *provider.Usage
	if err == nil {
		if firstEvent.Usage != nil {
			usage = firstEvent.Usage
		}
		accumulator.add(firstEvent)
		if err := writeSSEDataRaw(w, firstEvent.Data); err != nil {
			return true, usage, nil, err
		}
		flushResponse(w)
		streamMetrics.recordTTFTIfContent(firstEvent.Data, time.Now())
	}

	for err == nil {
		if err := ctx.Err(); err != nil {
			return true, usage, nil, err
		}
		event, nextErr := stream.Next()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			return true, usage, nil, nextErr
		}
		if event.Usage != nil {
			usage = event.Usage
		}
		accumulator.add(event)
		if err := writeSSEDataRaw(w, event.Data); err != nil {
			return true, usage, nil, err
		}
		flushResponse(w)
		streamMetrics.recordTTFTIfContent(event.Data, time.Now())
	}
	if err := ctx.Err(); err != nil {
		return true, usage, nil, err
	}
	if _, err := fmt.Fprint(w, "data: [DONE]\n\n"); err != nil {
		return true, usage, nil, err
	}
	flushResponse(w)
	return true, usage, accumulator.response(usage), nil
}

type streamingCacheAccumulator struct {
	id      string
	created int64
	model   string
	choices map[int]*streamingCacheChoice
	order   []int
}

type streamingCacheChoice struct {
	index        int
	role         string
	content      strings.Builder
	finishReason string
}

func newStreamingCacheAccumulator(reqCtx *pipeline.RequestContext) *streamingCacheAccumulator {
	model := ""
	if reqCtx != nil {
		model = firstNonEmpty(reqCtx.SelectedModel, reqCtx.Model, reqCtx.RequestedModel)
	}

	return &streamingCacheAccumulator{
		model:   model,
		choices: map[int]*streamingCacheChoice{},
	}
}

func (a *streamingCacheAccumulator) add(event provider.ChatCompletionStreamEvent) {
	if a == nil || len(event.Data) == 0 {
		return
	}

	var chunk streamingChatCompletionChunk
	if err := json.Unmarshal(event.Data, &chunk); err != nil {
		return
	}

	if strings.TrimSpace(chunk.ID) != "" && a.id == "" {
		a.id = chunk.ID
	}
	if chunk.Created != 0 && a.created == 0 {
		a.created = chunk.Created
	}
	if strings.TrimSpace(chunk.Model) != "" {
		a.model = chunk.Model
	}

	for _, choice := range chunk.Choices {
		cachedChoice := a.choice(choice.Index)
		if strings.TrimSpace(choice.Delta.Role) != "" {
			cachedChoice.role = choice.Delta.Role
		}
		if choice.Delta.Content != "" {
			cachedChoice.content.WriteString(choice.Delta.Content)
		}
		if choice.FinishReason != nil {
			cachedChoice.finishReason = *choice.FinishReason
		}
	}
}

func (a *streamingCacheAccumulator) choice(index int) *streamingCacheChoice {
	if existing, ok := a.choices[index]; ok {
		return existing
	}

	choice := &streamingCacheChoice{
		index: index,
		role:  "assistant",
	}
	a.choices[index] = choice
	a.order = append(a.order, index)
	return choice
}

func (a *streamingCacheAccumulator) response(usage *provider.Usage) *provider.ChatCompletionResponse {
	if a == nil || len(a.order) == 0 {
		return nil
	}

	choices := make([]provider.ChatChoice, 0, len(a.order))
	for _, index := range a.order {
		choice := a.choices[index]
		if choice == nil {
			continue
		}

		finishReason := choice.finishReason
		if strings.TrimSpace(finishReason) == "" {
			finishReason = "stop"
		}

		content, err := json.Marshal(choice.content.String())
		if err != nil {
			continue
		}

		choices = append(choices, provider.ChatChoice{
			Index: choice.index,
			Message: provider.ChatMessage{
				Role:    firstNonEmpty(choice.role, "assistant"),
				Content: json.RawMessage(content),
			},
			FinishReason: finishReason,
		})
	}

	if len(choices) == 0 {
		return nil
	}

	created := a.created
	if created == 0 {
		created = time.Now().Unix()
	}

	return &provider.ChatCompletionResponse{
		ID:      firstNonEmpty(a.id, "chatcmpl_"+middleware.NewRequestID()),
		Object:  "chat.completion",
		Created: created,
		Model:   a.model,
		Choices: choices,
		Usage:   usage,
	}
}

func writeSSEData(w http.ResponseWriter, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "data: %s\n\n", encoded)
	return err
}

func writeSSEDataRaw(w http.ResponseWriter, payload json.RawMessage) error {
	if len(payload) == 0 {
		return nil
	}
	_, err := fmt.Fprintf(w, "data: %s\n\n", payload)
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

func capturedChatCompletionResponse(resp *provider.ChatCompletionResponse) string {
	if resp == nil {
		return ""
	}
	var builder strings.Builder
	for _, choice := range resp.Choices {
		content := strings.TrimSpace(chatChoiceContent(choice))
		if content == "" {
			continue
		}
		if builder.Len() > 0 {
			builder.WriteByte('\n')
		}
		builder.WriteString(content)
	}
	return strings.TrimSpace(builder.String())
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
	return withStreamingOutcome(outcomes, reqCtx, outcome)
}

func withStreamingOutcome(outcomes invocationlog.DomainOutcomes, reqCtx *pipeline.RequestContext, outcome string) invocationlog.DomainOutcomes {
	if reqCtx == nil {
		return outcomes
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
		SemanticCachePolicyHash:    firstNonEmpty(reqCtx.RuntimeCachePolicy.CachePolicyHash, h.CachePolicyHash, h.SemanticCachePolicyVersion, "v1"),
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

func semanticCacheCategoryDenyReason(category string) string {
	switch cachekey.CanonicalSemanticCacheCategory(category) {
	case cachekey.SemanticCacheCategoryAccountAccess:
		return cachekey.SemanticCacheReasonAccountAccessDenied
	case cachekey.SemanticCacheCategorySupportRefund:
		return cachekey.SemanticCacheReasonSupportRefundDenied
	default:
		return cachekey.SemanticCacheReasonCategoryDenied
	}
}

func (h *ChatCompletionsHandler) semanticRolloutTenantAllowed(tenantID string) bool {
	return semanticStringListAllows(h.SemanticCacheAllowedTenantIDs, tenantID)
}

func (h *ChatCompletionsHandler) semanticRolloutApplicationAllowed(applicationID string) bool {
	return semanticStringListAllows(h.SemanticCacheAllowedApplicationIDs, applicationID)
}

func (h *ChatCompletionsHandler) semanticRolloutCategoryAllowed(category string) bool {
	if len(h.SemanticCacheAllowedCategories) == 0 {
		return true
	}
	category = cachekey.CanonicalSemanticCacheCategory(category)
	for _, allowed := range h.SemanticCacheAllowedCategories {
		if cachekey.CanonicalSemanticCacheCategory(allowed) == category {
			return true
		}
	}
	return false
}

func semanticStringListAllows(allowed []string, value string) bool {
	if len(allowed) == 0 {
		return true
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, allowedValue := range allowed {
		if strings.TrimSpace(allowedValue) == value {
			return true
		}
	}
	return false
}

func (h *ChatCompletionsHandler) semanticPromptCategory(reqCtx *pipeline.RequestContext) string {
	if reqCtx == nil {
		return cachekey.SemanticCacheCategoryUnknown
	}
	return cachekey.CanonicalSemanticCacheCategory(reqCtx.PromptCategory)
}

func (h *ChatCompletionsHandler) semanticCacheabilityGateAllowsLookup(ctx context.Context, reqCtx *pipeline.RequestContext, boundary cachekey.SemanticCacheBoundary, normalizedText string) bool {
	if reqCtx == nil {
		return false
	}
	classifier := h.SemanticCacheClassifier
	if classifier == nil {
		reqCtx.SemanticCacheClassifierEvaluated = false
		reqCtx.SemanticCacheClassifierPassed = false
		h.markSemanticCacheBypass(reqCtx, cachekey.CacheabilityReasonClassifierMissing, boundary.PromptCategory)
		return false
	}

	timeout := h.semanticCacheabilityClassifierTimeout()
	classifierCtx := ctx
	cancel := func() {}
	if timeout > 0 {
		classifierCtx, cancel = context.WithTimeout(ctx, timeout)
	}
	defer cancel()

	result, err := classifier.Classify(classifierCtx, cachekey.CacheabilityClassificationRequest{
		NormalizedText: normalizedText,
		PromptCategory: boundary.PromptCategory,
	})
	if err != nil {
		reqCtx.SemanticCacheClassifierEvaluated = true
		reqCtx.SemanticCacheClassifierPassed = false
		reason := cachekey.CacheabilityReasonClassifierError
		if errors.Is(err, cachekey.ErrCacheabilityClassifierInvalidResult) {
			reason = cachekey.CacheabilityReasonClassifierInvalid
		} else if errors.Is(err, context.DeadlineExceeded) {
			reason = cachekey.CacheabilityReasonClassifierTimeout
		}
		h.markSemanticCacheBypass(reqCtx, reason, boundary.PromptCategory)
		return false
	}

	result = result.Normalize()
	h.applySemanticCacheabilityClassifierResult(reqCtx, result)
	if err := result.Validate(); err != nil {
		reqCtx.SemanticCacheClassifierPassed = false
		h.markSemanticCacheBypass(reqCtx, cachekey.CacheabilityReasonClassifierInvalid, boundary.PromptCategory)
		return false
	}
	if !result.Label.CacheableCandidate() {
		reqCtx.SemanticCacheClassifierPassed = false
		reason := cachekey.CacheabilityReasonClassifierNotCacheable
		if result.ReasonCode == cachekey.CacheabilityReasonClassifierDisabled {
			reason = cachekey.CacheabilityReasonClassifierDisabled
		} else if result.Label.Normalize() == cachekey.CacheabilityLabelDynamicUserState {
			reason = cachekey.SemanticCacheReasonDynamicUserStateDenied
		} else if result.Label.Normalize() == cachekey.CacheabilityLabelUnsafeOrUnknown {
			reason = cachekey.SemanticCacheReasonCategoryDenied
		}
		h.markSemanticCacheBypass(reqCtx, reason, boundary.PromptCategory)
		return false
	}
	if result.Confidence < h.semanticCacheabilityClassifierMinConfidence() {
		reqCtx.SemanticCacheClassifierPassed = false
		h.markSemanticCacheBypass(reqCtx, cachekey.CacheabilityReasonClassifierLowConfidence, boundary.PromptCategory)
		return false
	}
	if result.Label.Normalize() == cachekey.CacheabilityLabelCacheablePolicy && !semanticCachePolicyBoundaryVerified(reqCtx, boundary) {
		reqCtx.SemanticCacheClassifierPassed = false
		h.markSemanticCacheBypass(reqCtx, cachekey.CacheabilityReasonClassifierPolicyBoundaryGap, boundary.PromptCategory)
		return false
	}

	reqCtx.SemanticCacheClassifierPassed = true
	return true
}

func (h *ChatCompletionsHandler) semanticCacheabilityGateAllowsStore(reqCtx *pipeline.RequestContext, boundary cachekey.SemanticCacheBoundary) bool {
	if reqCtx == nil {
		return false
	}
	result := cachekey.CacheabilityClassifierResult{
		Label:        cachekey.CacheabilityLabel(reqCtx.SemanticCacheClassifierLabel),
		Confidence:   reqCtx.SemanticCacheClassifierConfidence,
		ReasonCode:   reqCtx.SemanticCacheClassifierReasonCode,
		ModelVersion: reqCtx.SemanticCacheClassifierModelVersion,
	}.Normalize()
	if !reqCtx.SemanticCacheClassifierEvaluated || !reqCtx.SemanticCacheClassifierPassed {
		h.markSemanticCacheBypass(reqCtx, firstNonEmpty(reqCtx.SemanticCacheDecisionReason, cachekey.CacheabilityReasonClassifierNotCacheable), boundary.PromptCategory)
		return false
	}
	if err := result.Validate(); err != nil {
		reqCtx.SemanticCacheClassifierPassed = false
		h.markSemanticCacheBypass(reqCtx, cachekey.CacheabilityReasonClassifierInvalid, boundary.PromptCategory)
		return false
	}
	if !result.Passes(h.semanticCacheabilityClassifierMinConfidence()) {
		reqCtx.SemanticCacheClassifierPassed = false
		if !result.Label.CacheableCandidate() {
			reason := cachekey.CacheabilityReasonClassifierNotCacheable
			if result.Label.Normalize() == cachekey.CacheabilityLabelDynamicUserState {
				reason = cachekey.SemanticCacheReasonDynamicUserStateDenied
			} else if result.Label.Normalize() == cachekey.CacheabilityLabelUnsafeOrUnknown {
				reason = cachekey.SemanticCacheReasonCategoryDenied
			}
			h.markSemanticCacheBypass(reqCtx, reason, boundary.PromptCategory)
			return false
		}
		h.markSemanticCacheBypass(reqCtx, cachekey.CacheabilityReasonClassifierLowConfidence, boundary.PromptCategory)
		return false
	}
	if result.Label.Normalize() == cachekey.CacheabilityLabelCacheablePolicy && !semanticCachePolicyBoundaryVerified(reqCtx, boundary) {
		reqCtx.SemanticCacheClassifierPassed = false
		h.markSemanticCacheBypass(reqCtx, cachekey.CacheabilityReasonClassifierPolicyBoundaryGap, boundary.PromptCategory)
		return false
	}
	return true
}

func (h *ChatCompletionsHandler) applySemanticCacheabilityClassifierResult(reqCtx *pipeline.RequestContext, result cachekey.CacheabilityClassifierResult) {
	if reqCtx == nil {
		return
	}
	result = result.Normalize()
	reqCtx.SemanticCacheClassifierEvaluated = true
	reqCtx.SemanticCacheClassifierPassed = false
	reqCtx.SemanticCacheClassifierLabel = string(result.Label)
	reqCtx.SemanticCacheClassifierConfidence = result.Confidence
	reqCtx.SemanticCacheClassifierReasonCode = result.ReasonCode
	reqCtx.SemanticCacheClassifierModelVersion = result.ModelVersion
}

func (h *ChatCompletionsHandler) semanticCacheabilityClassifierMinConfidence() float64 {
	if h.SemanticCacheClassifierMinConfidence <= 0 || h.SemanticCacheClassifierMinConfidence > 1 {
		return cachekey.DefaultCacheabilityClassifierMinConfidence
	}
	return h.SemanticCacheClassifierMinConfidence
}

func (h *ChatCompletionsHandler) semanticCacheabilityClassifierTimeout() time.Duration {
	if h.SemanticCacheClassifierTimeout <= 0 {
		return cachekey.DefaultCacheabilityClassifierTimeout
	}
	return h.SemanticCacheClassifierTimeout
}

func semanticCachePolicyBoundaryVerified(reqCtx *pipeline.RequestContext, boundary cachekey.SemanticCacheBoundary) bool {
	if reqCtx == nil {
		return false
	}
	policyHash := strings.TrimSpace(reqCtx.RuntimeCachePolicy.CachePolicyHash)
	if policyHash == "" || !reqCtx.HasRuntimeCachePolicy {
		return false
	}
	return strings.TrimSpace(boundary.SemanticCachePolicyHash) == policyHash
}

func (h *ChatCompletionsHandler) initializeSemanticCacheContext(reqCtx *pipeline.RequestContext) {
	if reqCtx == nil {
		return
	}
	reqCtx.SemanticCacheMode = h.semanticCacheMode()
	reqCtx.SemanticCacheEnabled = h.semanticCacheConfiguredEnabled()
}

func (h *ChatCompletionsHandler) markSemanticCacheBypass(reqCtx *pipeline.RequestContext, reason string, promptCategory string) {
	if reqCtx == nil {
		return
	}
	h.initializeSemanticCacheContext(reqCtx)
	reqCtx.PromptCategory = cachekey.CanonicalSemanticCacheCategory(promptCategory)
	reqCtx.SemanticCacheHit = false
	reqCtx.SemanticCacheWouldHit = false
	reqCtx.SemanticCacheWouldMiss = false
	reqCtx.SemanticCacheCandidateFound = false
	reqCtx.SemanticCacheCandidateHash = ""
	reqCtx.SemanticReturnedFromCache = false
	reqCtx.SemanticLookupAllowed = false
	reqCtx.SemanticStoreAllowed = false
	reqCtx.SemanticDenyReason, reqCtx.SemanticBypassReason = semanticHandlerReasonKinds(reason)
	reqCtx.SemanticCanonicalIntent = ""
	reqCtx.SemanticRequiredSlotsHash = ""
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

func semanticHandlerReasonKinds(reason string) (string, string) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return "", ""
	}
	switch reason {
	case cachekey.SemanticCacheReasonCategoryDenied,
		cachekey.SemanticCacheReasonAccountAccessDenied,
		cachekey.SemanticCacheReasonSupportRefundDenied,
		cachekey.SemanticCacheReasonDynamicUserStateDenied,
		cachekey.SemanticCacheReasonPayloadUnsafe,
		cachekey.SemanticCacheReasonEmbeddingInputCodeLike:
		return reason, ""
	default:
		return "", reason
	}
}

func (h *ChatCompletionsHandler) applySemanticCacheDecision(reqCtx *pipeline.RequestContext, decision cachekey.SemanticCacheDecision) {
	if reqCtx == nil {
		return
	}
	h.initializeSemanticCacheContext(reqCtx)
	reqCtx.SemanticCacheHit = decision.SemanticCacheHit
	reqCtx.SemanticSimilarity = decision.SemanticSimilarity
	reqCtx.SemanticMatchedRequestID = decision.SemanticMatchedRequestID
	reqCtx.SemanticLookupAllowed = decision.LookupAllowed
	reqCtx.SemanticStoreAllowed = decision.StoreAllowed
	reqCtx.SemanticDenyReason = decision.DenyReason
	reqCtx.SemanticBypassReason = decision.BypassReason
	if strings.TrimSpace(decision.CandidateHash) != "" {
		reqCtx.SemanticCacheCandidateHash = decision.CandidateHash
	}
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

func (h *ChatCompletionsHandler) applySemanticCacheSearchMetadata(reqCtx *pipeline.RequestContext, result cachekey.SemanticCacheSearchResult) {
	if reqCtx == nil {
		return
	}
	reqCtx.SemanticCacheCandidateFound = result.MatchedEntry != nil || result.Similarity > 0 || len(result.Matches) > 0
	if result.MatchedEntry != nil {
		reqCtx.SemanticCacheCandidateHash = semanticCandidateHash(firstNonEmpty(result.MatchedEntry.RequestID, result.MatchedEntry.EntryID))
	}
	material := result.IntentMaterial.Normalize()
	if !material.IsZero() {
		reqCtx.SemanticCanonicalIntent = material.CanonicalIntent
		reqCtx.SemanticRequiredSlotsHash = material.RequiredSlotsHash
	}
}

func semanticCandidateHash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func (h *ChatCompletionsHandler) semanticCacheMode() string {
	switch strings.TrimSpace(strings.ToLower(h.SemanticCacheMode)) {
	case cachekey.SemanticCacheModeOff:
		return cachekey.SemanticCacheModeOff
	case cachekey.SemanticCacheModeShadow:
		return cachekey.SemanticCacheModeShadow
	case cachekey.SemanticCacheModeEnforce, "":
		return cachekey.SemanticCacheModeEnforce
	default:
		return cachekey.SemanticCacheModeEnforce
	}
}

func (h *ChatCompletionsHandler) semanticCacheConfiguredEnabled() bool {
	return h.SemanticCacheService != nil && h.SemanticCacheService.Enabled()
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

func semanticEmbeddingInput(messages []provider.ChatMessage) (cachekey.NormalizedEmbeddingInput, bool) {
	normalizer := cachekey.NewSemanticCacheEmbeddingInputNormalizer(cachekey.SemanticCacheEmbeddingInputNormalizationConfig{})
	inputMessages := make([]cachekey.SemanticCacheEmbeddingInputMessage, 0, len(messages))
	for _, message := range messages {
		content, err := chatMessageText(message)
		if err != nil {
			return normalizer.NormalizeMessages(nil)
		}
		inputMessages = append(inputMessages, cachekey.SemanticCacheEmbeddingInputMessage{
			Role:    message.Role,
			Content: content,
		})
	}
	return normalizer.NormalizeMessages(inputMessages)
}

func firstPositiveFloat(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
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
		RequestID:        reqCtx.RequestID,
		TenantID:         reqCtx.TenantID,
		ProjectID:        reqCtx.ProjectID,
		ApplicationID:    reqCtx.ApplicationID,
		RequestedModel:   reqCtx.RequestedModel,
		SelectedProvider: reqCtx.SelectedProvider,
		SelectedModel:    reqCtx.SelectedModel,
		TerminalStatus:   reqCtx.Status,
		DomainOutcomes:   domainOutcomesFromRequestContext(reqCtx),
		CacheStatus:      reqCtx.CacheStatus,
		CacheType:        reqCtx.CacheType,
		ProviderCalled:   providerCalledFromRequestContext(reqCtx),
		RoutingReason:    reqCtx.RoutingReason,
		MaskingAction:    reqCtx.MaskingAction,
		EstimatedCostUSD: formatCostMicroUSD(reqCtx.CostMicroUSD),
		LatencyMs:        reqCtx.LatencyMs,
	}
}

func (h *ChatCompletionsHandler) applyProviderUsageCost(ctx context.Context, reqCtx *pipeline.RequestContext, target providerCallTarget) {
	if h == nil || h.CostCalculator == nil || reqCtx == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	} else {
		ctx = context.WithoutCancel(ctx)
	}
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	result, err := h.CostCalculator.Calculate(ctx, costing.Request{
		ProviderKeys:     providerPricingKeys(reqCtx, target),
		ModelKeys:        modelPricingKeys(reqCtx, target),
		PromptTokens:     reqCtx.PromptTokens,
		CompletionTokens: reqCtx.CompletionTokens,
		TotalTokens:      reqCtx.TotalTokens,
		CompletedAt:      time.Now().UTC(),
	})
	reqCtx.CostingResult = result
	reqCtx.CostMicroUSD = result.CostMicroUSD
	if err != nil {
		log.Printf("cost calculation failed request_id=%s provider=%s model=%s cost_source=%s cause=%q",
			sanitizeLogValue(reqCtx.RequestID),
			sanitizeLogValue(firstNonEmpty(result.PricingProvider, reqCtx.SelectedProvider, target.ProviderName)),
			sanitizeLogValue(firstNonEmpty(result.PricingModel, reqCtx.SelectedModel, target.ModelID)),
			sanitizeLogValue(result.CostSource),
			sanitizeLogValue(err.Error()),
		)
	}
}

func providerPricingKeys(reqCtx *pipeline.RequestContext, target providerCallTarget) []string {
	if reqCtx == nil {
		return uniqueNonEmpty(target.ProviderName, target.ProviderID, target.AdapterType, target.ExecutionConfig.ProviderName, target.ExecutionConfig.ProviderID, target.ExecutionConfig.AdapterType)
	}
	return uniqueNonEmpty(
		target.ProviderName,
		target.ProviderID,
		target.AdapterType,
		target.ExecutionConfig.ProviderName,
		target.ExecutionConfig.ProviderID,
		target.ExecutionConfig.AdapterType,
		reqCtx.SelectedProvider,
		reqCtx.SelectedProviderID,
		reqCtx.SelectedProviderCatalogKey,
		reqCtx.Provider,
	)
}

func modelPricingKeys(reqCtx *pipeline.RequestContext, target providerCallTarget) []string {
	if reqCtx == nil {
		return uniqueNonEmpty(target.ModelID, target.ModelName)
	}
	return uniqueNonEmpty(target.ModelID, target.ModelName, reqCtx.SelectedModelID, reqCtx.SelectedModel, reqCtx.Model, reqCtx.RequestedModel)
}

func uniqueNonEmpty(values ...string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
func providerRequestForTarget(chatReq provider.ChatCompletionRequest, requestID string) provider.ChatCompletionRequest {
	req := chatReq
	req.RequestID = strings.TrimSpace(requestID)
	req.Metadata = nil
	req.GateLM = nil
	return req
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
		RequestID:               reqCtx.RequestID,
		TraceID:                 reqCtx.TraceID,
		ApplicationID:           reqCtx.ApplicationID,
		BudgetScope:             reqCtx.BudgetScope,
		ConfigHash:              reqCtx.ConfigHash,
		SecurityPolicyHash:      reqCtx.SecurityPolicyHash,
		RuntimeSnapshot:         reqCtx.RuntimeSnapshot,
		RateLimitDecision:       reqCtx.RateLimitDecision,
		BudgetDecision:          reqCtx.BudgetDecision,
		Stream:                  reqCtx.Stream,
		RequestedModel:          reqCtx.RequestedModel,
		Provider:                reqCtx.Provider,
		Model:                   reqCtx.Model,
		SelectedProvider:        reqCtx.SelectedProvider,
		SelectedModel:           reqCtx.SelectedModel,
		RoutingReason:           reqCtx.RoutingReason,
		RoutingPolicyHash:       reqCtx.RoutingPolicyHash,
		LatencyMs:               reqCtx.LatencyMs,
		ProviderLatencyMs:       providerLatencyMs,
		Status:                  reqCtx.Status,
		HTTPStatus:              reqCtx.HTTPStatus,
		ErrorCode:               reqCtx.ErrorCode,
		ErrorStage:              reqCtx.ErrorStage,
		CacheStatus:             reqCtx.CacheStatus,
		CacheType:               reqCtx.CacheType,
		CacheHitRequestID:       reqCtx.CacheHitRequestID,
		MaskingAction:           reqCtx.MaskingAction,
		MaskingDetectedTypes:    reqCtx.MaskingDetectedTypes,
		MaskingDetectedCount:    reqCtx.MaskingDetectedCount,
		PolicyAllowedTypes:      reqCtx.PolicyAllowedTypes,
		MandatoryProtectedTypes: reqCtx.MandatoryProtectedTypes,
		RedactedPromptPreview:   reqCtx.RedactedPromptPreview,
		CreatedAt:               reqCtx.StartedAt.UTC(),
		CompletedAt:             time.Now().UTC(),
	})
}

func requestParamsHash(chatReq provider.ChatCompletionRequest) string {
	payload, _ := json.Marshal(struct {
		Temperature *float64 `json:"temperature,omitempty"`
		MaxTokens   *int     `json:"max_tokens,omitempty"`
	}{
		Temperature: chatReq.Temperature,
		MaxTokens:   chatReq.MaxTokens,
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
	case routingdomain.ReasonShortPromptLowCost, routingdomain.ReasonSupportRefundLowCost:
		tier = routingdomain.TierLowCost
	case routingdomain.ReasonCodeHighQuality:
		tier = routingdomain.TierHighQuality
	case routingdomain.ReasonDefaultBalanced, routingdomain.ReasonTranslationBalanced, routingdomain.ReasonPinned, "", "not_routed":
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
		CostingResult:               reqCtx.CostingResult,
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
		SemanticCacheEnabled:        reqCtx.SemanticCacheEnabled,
		SemanticCacheMode:           reqCtx.SemanticCacheMode,
		SemanticCacheWouldHit:       reqCtx.SemanticCacheWouldHit,
		SemanticCacheWouldMiss:      reqCtx.SemanticCacheWouldMiss,
		SemanticCacheCandidateFound: reqCtx.SemanticCacheCandidateFound,
		SemanticCacheCandidateHash:  reqCtx.SemanticCacheCandidateHash,
		SemanticReturnedFromCache:   reqCtx.SemanticReturnedFromCache,
		SemanticLookupAllowed:       reqCtx.SemanticLookupAllowed,
		SemanticStoreAllowed:        reqCtx.SemanticStoreAllowed,
		SemanticDenyReason:          reqCtx.SemanticDenyReason,
		SemanticBypassReason:        reqCtx.SemanticBypassReason,
		SemanticCanonicalIntent:     reqCtx.SemanticCanonicalIntent,
		SemanticRequiredSlotsHash:   reqCtx.SemanticRequiredSlotsHash,
		SemanticSimilarity:          reqCtx.SemanticSimilarity,
		SemanticMatchedRequestID:    reqCtx.SemanticMatchedRequestID,
		SemanticCacheThreshold:      reqCtx.SemanticCacheThreshold,
		SemanticCachePolicyVersion:  reqCtx.SemanticCachePolicyVersion,
		SemanticCacheDecisionReason: reqCtx.SemanticCacheDecisionReason,
		EmbeddingProvider:           reqCtx.EmbeddingProvider,
		ProviderCatalogContentHash:  reqCtx.ProviderCatalogContentHash,
		RoutingDecisionKeyHash:      reqCtx.RoutingDecisionKeyHash,
		RoutingDiagnostics:          reqCtx.CategoryDiagnostics,
		MaskingAction:               reqCtx.MaskingAction,
		MaskingDetectedTypes:        reqCtx.MaskingDetectedTypes,
		MaskingDetectedCount:        reqCtx.MaskingDetectedCount,
		PolicyAllowedTypes:          reqCtx.PolicyAllowedTypes,
		MandatoryProtectedTypes:     reqCtx.MandatoryProtectedTypes,
		RedactedPromptPreview:       reqCtx.RedactedPromptPreview,
		SecurityPolicyVersionID:     reqCtx.SecurityPolicyVersionID,
		DomainOutcomes:              reqCtx.DomainOutcomes,
		StageTimings:                reqCtx.StageTimings,
		RedactedPromptForHash:       redactedPrompt,
		PromptCapturePolicy:         promptCapturePolicyForLog(reqCtx),
		CapturedPrompt:              redactedPrompt,
		ResponseCapturePolicy:       responseCapturePolicyForLog(reqCtx),
		CapturedResponse:            reqCtx.CapturedResponse,
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

func promptCapturePolicyForLog(reqCtx *pipeline.RequestContext) runtimeconfig.PromptCapturePolicy {
	if reqCtx == nil || !reqCtx.HasRuntimePromptCapture {
		return runtimeconfig.DefaultPromptCapturePolicy()
	}
	return reqCtx.RuntimePromptCapture
}

func responseCapturePolicyForLog(reqCtx *pipeline.RequestContext) runtimeconfig.ResponseCapturePolicy {
	if reqCtx == nil || !reqCtx.HasRuntimeResponseCapture {
		return runtimeconfig.DefaultResponseCapturePolicy()
	}
	return reqCtx.RuntimeResponseCapture
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

func recordRequestStageTiming(reqCtx *pipeline.RequestContext, stage string, duration time.Duration) {
	if reqCtx == nil {
		return
	}
	stagetiming.Record(&reqCtx.StageTimings, stage, duration)
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

	for _, stage := range stagetiming.OrderedStages(reqCtx.StageTimings) {
		timing := reqCtx.StageTimings[stage]
		if timing.DurationMs <= 0 {
			continue
		}
		h.MetricsRegistry.GatewayStageDuration(metrics.GatewayStageDuration{
			Stage:           stage,
			Status:          status,
			DurationSeconds: float64(timing.DurationMs) / 1000,
		})
	}

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
	if h.APIKeyAuthenticator == nil {
		return gatewayerrors.InternalError(authenticate.StageName, "Gateway authentication is not initialized.", nil)
	}

	bearerToken, ok := extractBearerToken(r.Header.Get("Authorization"))
	if !ok {
		return gatewayerrors.InvalidAPIKey(authenticate.StageName)
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
	reqCtx.ApplicationID = apiKeyIdentity.ApplicationID
	if reqCtx.ApplicationID == "" {
		return gatewayerrors.InternalError(authenticate.StageName, "Gateway default application is not configured for this project.", nil)
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
