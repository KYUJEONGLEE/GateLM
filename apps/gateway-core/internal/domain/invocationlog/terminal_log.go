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

	Endpoint          string
	Method            string
	Source            string
	Stream            bool
	RequestedProvider string
	RequestedModel    string
	Provider          string
	Model             string
	SelectedProvider  string
	SelectedModel     string
	RoutingReason     string
	RoutingPolicyHash string

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
	RoutingDecisionKeyHash     string

	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	RedactedPromptPreview   string
	SecurityPolicyVersionID string

	RequestBodyHash string
	PromptHash      string
	DomainOutcomes  DomainOutcomes
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

	Endpoint          string
	Method            string
	Source            string
	Stream            bool
	RequestedProvider string
	RequestedModel    string
	Provider          string
	Model             string
	SelectedProvider  string
	SelectedModel     string
	RoutingReason     string
	RoutingPolicyHash string

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
	RoutingDecisionKeyHash     string

	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	RedactedPromptPreview   string
	SecurityPolicyVersionID string

	RequestBodyHashMaterial string
	RedactedPromptForHash   string
	DomainOutcomes          DomainOutcomes
	StartedAt               time.Time
	CompletedAt             time.Time
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

		Endpoint:          firstNonEmptyString(input.Endpoint, "/v1/chat/completions"),
		Method:            firstNonEmptyString(input.Method, "POST"),
		Source:            source,
		Stream:            input.Stream,
		RequestedProvider: strings.TrimSpace(input.RequestedProvider),
		RequestedModel:    strings.TrimSpace(input.RequestedModel),
		Provider:          strings.TrimSpace(input.Provider),
		Model:             strings.TrimSpace(input.Model),
		SelectedProvider:  strings.TrimSpace(input.SelectedProvider),
		SelectedModel:     strings.TrimSpace(input.SelectedModel),
		RoutingReason:     strings.TrimSpace(input.RoutingReason),
		RoutingPolicyHash: strings.TrimSpace(input.RoutingPolicyHash),

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
		RoutingDecisionKeyHash:     strings.TrimSpace(input.RoutingDecisionKeyHash),

		MaskingAction:           firstNonEmptyString(input.MaskingAction, "none"),
		MaskingDetectedTypes:    append([]string{}, input.MaskingDetectedTypes...),
		MaskingDetectedCount:    input.MaskingDetectedCount,
		RedactedPromptPreview:   strings.TrimSpace(input.RedactedPromptPreview),
		SecurityPolicyVersionID: strings.TrimSpace(input.SecurityPolicyVersionID),

		RequestBodyHash: logHash("request_body", requestBodyHashMaterial),
		PromptHash:      logHash("prompt", promptHashMaterial),
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
