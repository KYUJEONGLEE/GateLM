package invocationlog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
)

type TerminalLog struct {
	RequestID     string
	TraceID       string
	TenantID      string
	ProjectID     string
	ApplicationID string
	APIKeyID      string
	AppTokenID    string
	EndUserID     string
	FeatureID     string

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
	RequestID     string
	TraceID       string
	TenantID      string
	ProjectID     string
	ApplicationID string
	APIKeyID      string
	AppTokenID    string
	EndUserID     string
	FeatureID     string

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
	if input.RoutingPolicyHash != "" {
		metadata["routingPolicyHash"] = strings.TrimSpace(input.RoutingPolicyHash)
	}
	if input.RateLimitDecision != nil {
		metadata["rateLimitDecision"] = *input.RateLimitDecision
	}

	rateLimitDecision := input.RateLimitDecision.Clone()

	return TerminalLog{
		RequestID:     requestID,
		TraceID:       traceID,
		TenantID:      strings.TrimSpace(input.TenantID),
		ProjectID:     strings.TrimSpace(input.ProjectID),
		ApplicationID: strings.TrimSpace(input.ApplicationID),
		APIKeyID:      strings.TrimSpace(input.APIKeyID),
		AppTokenID:    strings.TrimSpace(input.AppTokenID),
		EndUserID:     strings.TrimSpace(input.EndUserID),
		FeatureID:     strings.TrimSpace(input.FeatureID),

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

		Status:       strings.TrimSpace(input.Status),
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
