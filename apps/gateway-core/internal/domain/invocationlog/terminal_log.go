package invocationlog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/outcome"
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

	TerminalStatus string
	DomainOutcomes outcome.DomainOutcomes
	Status       string
	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string

	CacheStatus       string
	CacheType         string
	CacheKeyHash      string
	CacheHitRequestID string

	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	RedactedPromptPreview   string
	SecurityPolicyVersionID string

	RequestBodyHash string
	PromptHash      string
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

	TerminalStatus string
	DomainOutcomes outcome.DomainOutcomes
	Status       string
	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string

	CacheStatus       string
	CacheType         string
	CacheKeyHash      string
	CacheHitRequestID string

	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	RedactedPromptPreview   string
	SecurityPolicyVersionID string

	RequestBodyHashMaterial string
	RedactedPromptForHash   string
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

	rateLimitDecision := input.RateLimitDecision.Clone()
	terminalStatus := outcome.CanonicalizeTerminalStatus(firstNonEmptyString(input.TerminalStatus, input.Status), input.HTTPStatus, input.ErrorCode)
	domainOutcomes := input.DomainOutcomes
	if domainOutcomes.IsZero() {
		var remaining *int
		var retryAfterSeconds *int
		var rateLimitAllowed bool
		var rateLimitChecked bool
		if rateLimitDecision != nil {
			rateLimitChecked = true
			rateLimitAllowed = rateLimitDecision.Allowed
			remainingValue := rateLimitDecision.Remaining
			retryAfterValue := rateLimitDecision.RetryAfterSeconds
			remaining = &remainingValue
			retryAfterSeconds = &retryAfterValue
		}
		domainOutcomes = outcome.Build(outcome.BuildInput{
			TerminalStatus:             terminalStatus,
			HTTPStatus:                 input.HTTPStatus,
			ErrorCode:                  input.ErrorCode,
			ApplicationID:              input.ApplicationID,
			RuntimeSnapshotID:          runtimeSnapshot.RuntimeSnapshotID,
			RuntimeSnapshotVersion:     runtimeSnapshot.RuntimeSnapshotVersion,
			RuntimeState:               runtimeSnapshot.RuntimeState,
			RateLimitChecked:          rateLimitChecked,
			RateLimitAllowed:          rateLimitAllowed,
			RateLimitRemaining:        remaining,
			RateLimitRetryAfterSeconds: retryAfterSeconds,
			BudgetScopeType:            resolvedBudgetScope.Type,
			BudgetScopeID:              resolvedBudgetScope.ID,
			BudgetResolvedBy:           resolvedBudgetScope.ResolvedBy,
			SafetyChecked:              input.MaskingAction != "",
			MaskingAction:              input.MaskingAction,
			DetectedTypes:              input.MaskingDetectedTypes,
			DetectedCount:              input.MaskingDetectedCount,
			RedactedPromptPreview:      input.RedactedPromptPreview,
			RequestedModel:             input.RequestedModel,
			SelectedProvider:           input.SelectedProvider,
			SelectedModel:              input.SelectedModel,
			RoutingReason:              input.RoutingReason,
			CacheStatus:                input.CacheStatus,
			CacheType:                  input.CacheType,
			CacheHitRequestID:          input.CacheHitRequestID,
			ProviderLatencyMs:          input.ProviderLatencyMs,
			RequestLogWritten:          true,
		}).DomainOutcomes
	}
	metadata["domainOutcomes"] = domainOutcomes

	return TerminalLog{
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

		TerminalStatus: terminalStatus,
		DomainOutcomes: domainOutcomes,
		Status:       terminalStatus,
		HTTPStatus:   input.HTTPStatus,
		ErrorCode:    strings.TrimSpace(input.ErrorCode),
		ErrorMessage: strings.TrimSpace(input.ErrorMessage),
		ErrorStage:   strings.TrimSpace(input.ErrorStage),

		CacheStatus:       firstNonEmptyString(input.CacheStatus, CacheStatusBypass),
		CacheType:         firstNonEmptyString(input.CacheType, CacheTypeNone),
		CacheKeyHash:      strings.TrimSpace(input.CacheKeyHash),
		CacheHitRequestID: strings.TrimSpace(input.CacheHitRequestID),

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
