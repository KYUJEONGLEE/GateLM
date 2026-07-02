package pipeline

import (
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

type RequestContext struct {
	RequestID  string
	TraceID    string
	Endpoint   string
	Method     string
	Stream     bool
	StartedAt  time.Time
	PromptText string

	TenantID      string
	ProjectID     string
	ApplicationID string
	BudgetScope   budget.Scope
	APIKeyID      string
	AppTokenID    string
	EndUserID     string
	FeatureID     string

	ConfigHash              string
	SecurityPolicyHash      string
	RuntimeSnapshot         runtimeconfig.RuntimeSnapshotProvenance
	RuntimeRateLimit        ratelimit.Config
	HasRuntimeRateLimit     bool
	RuntimeBudgetPolicy     budget.Policy
	HasRuntimeBudgetPolicy  bool
	RuntimeRoutingPolicy    runtimeconfig.RoutingPolicy
	HasRuntimeRoutingPolicy bool
	RuntimeCachePolicy      runtimeconfig.CachePolicy
	HasRuntimeCachePolicy   bool
	RuntimePromptCapture    runtimeconfig.PromptCapturePolicy
	HasRuntimePromptCapture bool

	RateLimitDecision *ratelimit.Decision
	BudgetDecision    *budget.Decision

	RequestedProvider          string
	RequestedModel             string
	SelectedProvider           string
	SelectedProviderID         string
	SelectedProviderCatalogKey string
	SelectedModel              string
	SelectedModelID            string
	ProviderCatalogContentHash string
	RoutingReason              string
	RoutingPolicyHash          string
	RoutingDecisionKeyHash     string
	PromptCategory             string

	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	RedactedPromptPreview   string
	SecurityPolicyVersionID string

	CacheStatus         string
	CacheType           string
	CacheKeyHash        string
	CacheHitRequestID   string
	CacheKeyVersion     string
	CacheDecisionReason string
	FallbackOccurred    bool

	SemanticCacheHit            bool
	SemanticSimilarity          float64
	SemanticMatchedRequestID    string
	SemanticCacheThreshold      float64
	SemanticCachePolicyVersion  string
	SemanticCacheDecisionReason string
	EmbeddingProvider           string
	SemanticCacheStoreCandidate bool

	Provider          string
	Model             string
	ProviderLatencyMs int64

	PromptTokens      int
	CompletionTokens  int
	TotalTokens       int
	CostMicroUSD      int64
	SavedCostMicroUSD int64
	LatencyMs         int64

	Status       string
	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string

	DomainOutcomes invocationlog.DomainOutcomes
}

func NewRequestContext(input NewRequestContextInput) *RequestContext {
	requestID := input.RequestID
	if requestID == "" {
		requestID = input.TraceID
	}

	traceID := input.TraceID
	if traceID == "" {
		traceID = requestID
	}

	return &RequestContext{
		RequestID:     requestID,
		TraceID:       traceID,
		Endpoint:      input.Endpoint,
		Method:        input.Method,
		Stream:        input.Stream,
		StartedAt:     input.StartedAt,
		EndUserID:     input.EndUserID,
		FeatureID:     input.FeatureID,
		CacheStatus:   "bypass",
		CacheType:     "none",
		MaskingAction: "none",
	}
}

type NewRequestContextInput struct {
	RequestID string
	TraceID   string
	Endpoint  string
	Method    string
	Stream    bool
	StartedAt time.Time
	EndUserID string
	FeatureID string
}
