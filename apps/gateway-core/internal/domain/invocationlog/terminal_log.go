package invocationlog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/domain/stagetiming"
)

type TerminalLog struct {
	RequestID          string
	TraceID            string
	TenantID           string
	ProjectID          string
	ApplicationID      string
	BudgetScope        budget.Scope
	APIKeyID           string
	AppTokenID         string
	EndUserID          string
	FeatureID          string
	ConfigHash         string
	SecurityPolicyHash string
	RuntimeSnapshot    runtimeconfig.RuntimeSnapshotProvenance

	RateLimitDecision *ratelimit.Decision
	BudgetDecision    *budget.Decision

	Endpoint               string
	Method                 string
	Source                 string
	Stream                 bool
	RequestedProvider      string
	RequestedModel         string
	Provider               string
	Model                  string
	SelectedProvider       string
	SelectedProviderID     string
	SelectedModel          string
	SelectedModelID        string
	RoutingReason          string
	RoutingPolicyHash      string
	PromptCategory         string
	RoutingDecisionKeyHash string

	PromptTokens      int
	CompletionTokens  int
	TotalTokens       int
	CostMicroUSD      int64
	SavedCostMicroUSD int64
	LatencyMs         int64
	ProviderLatencyMs *int64

	Status       string
	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string

	CacheStatus                string
	CacheType                  string
	CacheKeyHash               string
	CacheHitRequestID          string
	CacheKeyVersion            string
	CacheDecisionReason        string
	FallbackOccurred           bool
	ProviderCatalogContentHash string

	SemanticCacheHit            bool
	SemanticCacheEnabled        bool
	SemanticCacheMode           string
	SemanticCacheWouldHit       bool
	SemanticCacheWouldMiss      bool
	SemanticCacheCandidateFound bool
	SemanticCacheCandidateHash  string
	SemanticReturnedFromCache   bool
	SemanticCanonicalIntent     string
	SemanticRequiredSlotsHash   string
	SemanticSimilarity          float64
	SemanticMatchedRequestID    string
	SemanticCacheThreshold      float64
	SemanticCachePolicyVersion  string
	SemanticCacheDecisionReason string
	EmbeddingProvider           string

	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	PolicyAllowedTypes      []string
	MandatoryProtectedTypes []string
	RedactedPromptPreview   string
	SecurityPolicyVersionID string

	RequestBodyHash string
	PromptHash      string
	DomainOutcomes  DomainOutcomes
	StageTimings    stagetiming.Timings
	Metadata        map[string]any
	CreatedAt       time.Time
	CompletedAt     time.Time
}

type TerminalLogInput struct {
	RequestID          string
	TraceID            string
	TenantID           string
	ProjectID          string
	ApplicationID      string
	BudgetScope        budget.Scope
	APIKeyID           string
	AppTokenID         string
	EndUserID          string
	FeatureID          string
	ConfigHash         string
	SecurityPolicyHash string
	RuntimeSnapshot    runtimeconfig.RuntimeSnapshotProvenance

	RateLimitDecision *ratelimit.Decision
	BudgetDecision    *budget.Decision

	Endpoint               string
	Method                 string
	Source                 string
	Stream                 bool
	RequestedProvider      string
	RequestedModel         string
	Provider               string
	Model                  string
	SelectedProvider       string
	SelectedProviderID     string
	SelectedModel          string
	SelectedModelID        string
	RoutingReason          string
	RoutingPolicyHash      string
	PromptCategory         string
	RoutingDecisionKeyHash string

	PromptTokens      int
	CompletionTokens  int
	TotalTokens       int
	CostMicroUSD      int64
	SavedCostMicroUSD int64
	LatencyMs         int64
	ProviderLatencyMs *int64

	Status       string
	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string

	CacheStatus                string
	CacheType                  string
	CacheKeyHash               string
	CacheHitRequestID          string
	CacheKeyVersion            string
	CacheDecisionReason        string
	FallbackOccurred           bool
	ProviderCatalogContentHash string

	SemanticCacheHit            bool
	SemanticCacheEnabled        bool
	SemanticCacheMode           string
	SemanticCacheWouldHit       bool
	SemanticCacheWouldMiss      bool
	SemanticCacheCandidateFound bool
	SemanticCacheCandidateHash  string
	SemanticReturnedFromCache   bool
	SemanticCanonicalIntent     string
	SemanticRequiredSlotsHash   string
	SemanticSimilarity          float64
	SemanticMatchedRequestID    string
	SemanticCacheThreshold      float64
	SemanticCachePolicyVersion  string
	SemanticCacheDecisionReason string
	EmbeddingProvider           string

	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	PolicyAllowedTypes      []string
	MandatoryProtectedTypes []string
	RedactedPromptPreview   string
	SecurityPolicyVersionID string

	RequestBodyHashMaterial string
	RedactedPromptForHash   string
	PromptCapturePolicy     runtimeconfig.PromptCapturePolicy
	CapturedPrompt          string
	ResponseCapturePolicy   runtimeconfig.ResponseCapturePolicy
	CapturedResponse        string
	DomainOutcomes          DomainOutcomes
	StageTimings            stagetiming.Timings
	StartedAt               time.Time
	CompletedAt             time.Time
}

const PromptCaptureVisibilityAdminRequestDetail = "admin_request_detail"

const ResponseCaptureVisibilityAdminRequestDetail = "admin_request_detail"

type PromptCaptureFields struct {
	Enabled        bool   `json:"enabled"`
	Mode           string `json:"mode"`
	Visibility     string `json:"visibility"`
	CapturedPrompt string `json:"capturedPrompt"`
	Truncated      bool   `json:"truncated"`
	MaxChars       int    `json:"maxChars"`
}

type ResponseCaptureFields struct {
	Enabled          bool   `json:"enabled"`
	Mode             string `json:"mode"`
	Visibility       string `json:"visibility"`
	CapturedResponse string `json:"capturedResponse"`
	Truncated        bool   `json:"truncated"`
	MaxChars         int    `json:"maxChars"`
}

type TerminalLogWriter interface {
	WriteTerminalLog(ctx context.Context, log TerminalLog) error
}

type NoopTerminalLogWriter struct{}

func (NoopTerminalLogWriter) WriteTerminalLog(context.Context, TerminalLog) error {
	return nil
}

func BuildTerminalLog(input TerminalLogInput) TerminalLog {
	requestID := strings.TrimSpace(input.RequestID)
	traceID := strings.TrimSpace(input.TraceID)
	if traceID == "" {
		traceID = requestID
	}

	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = SourceCustomerApp
	}

	completedAt := input.CompletedAt
	if completedAt.IsZero() {
		completedAt = input.StartedAt
	}
	latencyMs := input.LatencyMs
	if latencyMs == 0 {
		latencyMs = latencyMillis(input.StartedAt, completedAt)
	}

	requestBodyHashMaterial := strings.TrimSpace(input.RequestBodyHashMaterial)
	if requestBodyHashMaterial == "" {
		requestBodyHashMaterial = strings.TrimSpace(input.RedactedPromptForHash)
	}
	if requestBodyHashMaterial == "" {
		requestBodyHashMaterial = requestID
	}

	promptHashMaterial := strings.TrimSpace(input.RedactedPromptForHash)
	if promptHashMaterial == "" {
		promptHashMaterial = requestID
	}

	metadata := map[string]any{
		"schemaVersion": 1,
		"p0Shortcut":    true,
	}
	if input.SecurityPolicyVersionID != "" {
		metadata["securityPolicyVersionId"] = strings.TrimSpace(input.SecurityPolicyVersionID)
	}
	if input.RateLimitDecision != nil {
		metadata["rateLimitDecision"] = *input.RateLimitDecision
	}
	if input.BudgetDecision != nil {
		metadata["budgetDecision"] = *input.BudgetDecision
	}
	resolvedBudgetScope := budget.NormalizeScope(input.BudgetScope, input.ApplicationID)
	metadata["budgetScope"] = budget.ToMetadata(resolvedBudgetScope, input.ApplicationID)
	runtimeSnapshot := input.RuntimeSnapshot.Normalize(runtimeconfig.ActiveConfig{
		ConfigVersion: strings.TrimSpace(input.ConfigHash),
		ConfigHash:    strings.TrimSpace(input.ConfigHash),
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: strings.TrimSpace(input.SecurityPolicyHash),
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			RoutingPolicyHash: strings.TrimSpace(input.RoutingPolicyHash),
		},
	}, input.StartedAt, runtimeconfig.DefaultGatewayInstanceIDCompat)
	if runtimeSnapshot.ContentHash != "" {
		metadata["runtimeSnapshot"] = runtimeSnapshot.Metadata()
	}
	if strings.TrimSpace(input.CacheKeyVersion) != "" {
		metadata["cacheKeyVersion"] = strings.TrimSpace(input.CacheKeyVersion)
	}
	if strings.TrimSpace(input.CacheDecisionReason) != "" {
		metadata["cacheDecisionReason"] = strings.TrimSpace(input.CacheDecisionReason)
	}
	if strings.TrimSpace(input.ProviderCatalogContentHash) != "" {
		metadata["providerCatalogContentHash"] = strings.TrimSpace(input.ProviderCatalogContentHash)
	}
	if strings.TrimSpace(input.RoutingDecisionKeyHash) != "" {
		metadata["routingDecisionKeyHash"] = strings.TrimSpace(input.RoutingDecisionKeyHash)
	}
	if strings.TrimSpace(input.SelectedProviderID) != "" {
		metadata["selectedProviderId"] = strings.TrimSpace(input.SelectedProviderID)
	}
	if strings.TrimSpace(input.SelectedModelID) != "" {
		metadata["selectedModelId"] = strings.TrimSpace(input.SelectedModelID)
	}
	if strings.TrimSpace(input.PromptCategory) != "" {
		metadata["promptCategory"] = strings.TrimSpace(input.PromptCategory)
	}
	metadata["semanticCacheEnabled"] = input.SemanticCacheEnabled
	if strings.TrimSpace(input.SemanticCacheMode) != "" {
		metadata["semanticCacheMode"] = strings.TrimSpace(input.SemanticCacheMode)
	}
	metadata["semanticCacheHit"] = input.SemanticCacheHit
	metadata["semanticCacheWouldHit"] = input.SemanticCacheWouldHit
	metadata["semanticCacheWouldMiss"] = input.SemanticCacheWouldMiss
	metadata["semanticCandidateFound"] = input.SemanticCacheCandidateFound
	metadata["semanticReturnedFromCache"] = input.SemanticReturnedFromCache
	if strings.TrimSpace(input.SemanticCacheCandidateHash) != "" {
		metadata["semanticCandidateHash"] = strings.TrimSpace(input.SemanticCacheCandidateHash)
	}
	if strings.TrimSpace(input.SemanticCanonicalIntent) != "" {
		metadata["semanticCanonicalIntent"] = strings.TrimSpace(input.SemanticCanonicalIntent)
	}
	if strings.TrimSpace(input.SemanticRequiredSlotsHash) != "" {
		metadata["semanticRequiredSlotsHash"] = strings.TrimSpace(input.SemanticRequiredSlotsHash)
	}
	if input.SemanticSimilarity > 0 {
		metadata["semanticSimilarity"] = input.SemanticSimilarity
	}
	if strings.TrimSpace(input.SemanticMatchedRequestID) != "" {
		metadata["semanticMatchedRequestId"] = strings.TrimSpace(input.SemanticMatchedRequestID)
	}
	if input.SemanticCacheThreshold > 0 {
		metadata["semanticCacheThreshold"] = input.SemanticCacheThreshold
	}
	if strings.TrimSpace(input.SemanticCachePolicyVersion) != "" {
		metadata["semanticCachePolicyVersion"] = strings.TrimSpace(input.SemanticCachePolicyVersion)
	}
	if strings.TrimSpace(input.SemanticCacheDecisionReason) != "" {
		metadata["semanticCacheDecisionReason"] = strings.TrimSpace(input.SemanticCacheDecisionReason)
	}
	if strings.TrimSpace(input.EmbeddingProvider) != "" {
		metadata["embeddingProvider"] = strings.TrimSpace(input.EmbeddingProvider)
	}
	if promptCapture, ok := BuildPromptCaptureFields(input.PromptCapturePolicy, input.CapturedPrompt); ok {
		metadata["promptCapture"] = promptCapture
	}
	if responseCapture, ok := BuildResponseCaptureFields(input.ResponseCapturePolicy, input.CapturedResponse); ok {
		metadata["responseCapture"] = responseCapture
	}
	if len(input.StageTimings) > 0 {
		metadata["stageTimings"] = stagetiming.Clone(input.StageTimings)
	}
	metadata["fallbackOccurred"] = input.FallbackOccurred
	metadata["providerCalled"] = terminalProviderCalled(input)

	rateLimitDecision := input.RateLimitDecision.Clone()
	budgetDecision := input.BudgetDecision.Clone()

	log := TerminalLog{
		RequestID:          requestID,
		TraceID:            traceID,
		TenantID:           strings.TrimSpace(input.TenantID),
		ProjectID:          strings.TrimSpace(input.ProjectID),
		ApplicationID:      strings.TrimSpace(input.ApplicationID),
		BudgetScope:        resolvedBudgetScope,
		APIKeyID:           strings.TrimSpace(input.APIKeyID),
		AppTokenID:         strings.TrimSpace(input.AppTokenID),
		EndUserID:          strings.TrimSpace(input.EndUserID),
		FeatureID:          strings.TrimSpace(input.FeatureID),
		ConfigHash:         strings.TrimSpace(input.ConfigHash),
		SecurityPolicyHash: strings.TrimSpace(input.SecurityPolicyHash),
		RuntimeSnapshot:    runtimeSnapshot,

		RateLimitDecision: rateLimitDecision,
		BudgetDecision:    budgetDecision,

		Endpoint:               firstNonEmptyString(input.Endpoint, "/v1/chat/completions"),
		Method:                 firstNonEmptyString(input.Method, "POST"),
		Source:                 source,
		Stream:                 input.Stream,
		RequestedProvider:      strings.TrimSpace(input.RequestedProvider),
		RequestedModel:         strings.TrimSpace(input.RequestedModel),
		Provider:               strings.TrimSpace(input.Provider),
		Model:                  strings.TrimSpace(input.Model),
		SelectedProvider:       strings.TrimSpace(input.SelectedProvider),
		SelectedProviderID:     strings.TrimSpace(input.SelectedProviderID),
		SelectedModel:          strings.TrimSpace(input.SelectedModel),
		SelectedModelID:        strings.TrimSpace(input.SelectedModelID),
		RoutingReason:          strings.TrimSpace(input.RoutingReason),
		RoutingPolicyHash:      strings.TrimSpace(input.RoutingPolicyHash),
		PromptCategory:         strings.TrimSpace(input.PromptCategory),
		RoutingDecisionKeyHash: strings.TrimSpace(input.RoutingDecisionKeyHash),

		PromptTokens:      input.PromptTokens,
		CompletionTokens:  input.CompletionTokens,
		TotalTokens:       input.TotalTokens,
		CostMicroUSD:      input.CostMicroUSD,
		SavedCostMicroUSD: input.SavedCostMicroUSD,
		LatencyMs:         latencyMs,
		ProviderLatencyMs: input.ProviderLatencyMs,

		Status:       strings.TrimSpace(input.Status),
		HTTPStatus:   input.HTTPStatus,
		ErrorCode:    strings.TrimSpace(input.ErrorCode),
		ErrorMessage: strings.TrimSpace(input.ErrorMessage),
		ErrorStage:   strings.TrimSpace(input.ErrorStage),

		CacheStatus:                firstNonEmptyString(input.CacheStatus, CacheStatusBypass),
		CacheType:                  firstNonEmptyString(input.CacheType, CacheTypeNone),
		CacheKeyHash:               strings.TrimSpace(input.CacheKeyHash),
		CacheHitRequestID:          strings.TrimSpace(input.CacheHitRequestID),
		CacheKeyVersion:            strings.TrimSpace(input.CacheKeyVersion),
		CacheDecisionReason:        strings.TrimSpace(input.CacheDecisionReason),
		FallbackOccurred:           input.FallbackOccurred,
		ProviderCatalogContentHash: strings.TrimSpace(input.ProviderCatalogContentHash),

		SemanticCacheHit:            input.SemanticCacheHit,
		SemanticCacheEnabled:        input.SemanticCacheEnabled,
		SemanticCacheMode:           strings.TrimSpace(input.SemanticCacheMode),
		SemanticCacheWouldHit:       input.SemanticCacheWouldHit,
		SemanticCacheWouldMiss:      input.SemanticCacheWouldMiss,
		SemanticCacheCandidateFound: input.SemanticCacheCandidateFound,
		SemanticCacheCandidateHash:  strings.TrimSpace(input.SemanticCacheCandidateHash),
		SemanticReturnedFromCache:   input.SemanticReturnedFromCache,
		SemanticCanonicalIntent:     strings.TrimSpace(input.SemanticCanonicalIntent),
		SemanticRequiredSlotsHash:   strings.TrimSpace(input.SemanticRequiredSlotsHash),
		SemanticSimilarity:          input.SemanticSimilarity,
		SemanticMatchedRequestID:    strings.TrimSpace(input.SemanticMatchedRequestID),
		SemanticCacheThreshold:      input.SemanticCacheThreshold,
		SemanticCachePolicyVersion:  strings.TrimSpace(input.SemanticCachePolicyVersion),
		SemanticCacheDecisionReason: strings.TrimSpace(input.SemanticCacheDecisionReason),
		EmbeddingProvider:           strings.TrimSpace(input.EmbeddingProvider),

		MaskingAction:           firstNonEmptyString(input.MaskingAction, "none"),
		MaskingDetectedTypes:    append([]string{}, input.MaskingDetectedTypes...),
		MaskingDetectedCount:    input.MaskingDetectedCount,
		PolicyAllowedTypes:      append([]string{}, input.PolicyAllowedTypes...),
		MandatoryProtectedTypes: append([]string{}, input.MandatoryProtectedTypes...),
		RedactedPromptPreview:   strings.TrimSpace(input.RedactedPromptPreview),
		SecurityPolicyVersionID: strings.TrimSpace(input.SecurityPolicyVersionID),

		RequestBodyHash: logHash("request_body", requestBodyHashMaterial),
		PromptHash:      logHash("prompt", promptHashMaterial),
		StageTimings:    stagetiming.Clone(input.StageTimings),
		Metadata:        metadata,
		CreatedAt:       input.StartedAt.UTC(),
		CompletedAt:     completedAt.UTC(),
	}
	if !input.DomainOutcomes.IsZero() {
		log.DomainOutcomes = input.DomainOutcomes
		if log.DomainOutcomes.Logging.Outcome == "" {
			log.DomainOutcomes.Logging = LoggingOutcome{Outcome: "written", RequestLogWritten: true}
		}
	} else {
		log.DomainOutcomes = BuildDomainOutcomes(log)
	}
	log.Metadata["terminalStatus"] = canonicalTerminalStatus(log.Status)
	log.Metadata["domainOutcomes"] = log.DomainOutcomes
	log.Metadata["gatewayStageOutcomes"] = BuildGatewayStageOutcomes(log)
	return log
}

func BuildPromptCaptureFields(policy runtimeconfig.PromptCapturePolicy, logSafePrompt string) (PromptCaptureFields, bool) {
	policy = runtimeconfig.NormalizePromptCapturePolicy(policy)
	if !runtimeconfig.PromptCaptureAllowsLogSafeCapture(policy) {
		return PromptCaptureFields{}, false
	}
	logSafePrompt = strings.TrimSpace(logSafePrompt)
	if logSafePrompt == "" {
		return PromptCaptureFields{}, false
	}

	truncatedPrompt, truncated := truncateRunes(logSafePrompt, policy.MaxChars)
	return PromptCaptureFields{
		Enabled:        true,
		Mode:           policy.Mode,
		Visibility:     PromptCaptureVisibilityAdminRequestDetail,
		CapturedPrompt: truncatedPrompt,
		Truncated:      truncated,
		MaxChars:       policy.MaxChars,
	}, true
}

func BuildResponseCaptureFields(policy runtimeconfig.ResponseCapturePolicy, rawResponse string) (ResponseCaptureFields, bool) {
	policy = runtimeconfig.NormalizeResponseCapturePolicy(policy)
	if !runtimeconfig.ResponseCaptureAllowsRawCapture(policy) {
		return ResponseCaptureFields{}, false
	}
	rawResponse = strings.TrimSpace(rawResponse)
	if rawResponse == "" {
		return ResponseCaptureFields{}, false
	}

	truncatedResponse, truncated := truncateRunes(rawResponse, policy.MaxChars)
	return ResponseCaptureFields{
		Enabled:          true,
		Mode:             policy.Mode,
		Visibility:       ResponseCaptureVisibilityAdminRequestDetail,
		CapturedResponse: truncatedResponse,
		Truncated:        truncated,
		MaxChars:         policy.MaxChars,
	}, true
}

func logHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func terminalProviderCalled(input TerminalLogInput) bool {
	if strings.TrimSpace(input.CacheStatus) == CacheStatusHit {
		return false
	}
	if strings.TrimSpace(input.Status) == StatusBlocked || strings.TrimSpace(input.Status) == StatusRateLimited || strings.TrimSpace(input.Status) == StatusCancelled {
		return false
	}
	if input.ProviderLatencyMs != nil {
		return true
	}
	return strings.TrimSpace(input.Provider) != "" || strings.TrimSpace(input.SelectedProvider) != ""
}

func truncateRunes(value string, maxRunes int) (string, bool) {
	if maxRunes <= 0 {
		return "", value != ""
	}
	count := 0
	for i := range value {
		if count == maxRunes {
			return value[:i], true
		}
		count++
	}
	return value, false
}
