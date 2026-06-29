package handlers

import (
	"strings"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/outcome"
	"gatelm/apps/gateway-core/internal/pipeline"
)

func ensureRequestOutcome(reqCtx *pipeline.RequestContext, requestLogWritten bool) outcome.GatewayOutcome {
	if reqCtx == nil {
		return outcome.Build(outcome.BuildInput{})
	}
	if !requestLogWritten && !reqCtx.DomainOutcomes.IsZero() && reqCtx.TerminalStatus != "" {
		return outcome.GatewayOutcome{
			ContractVersion: outcome.ContractVersion,
			TerminalStatus:  reqCtx.TerminalStatus,
			HTTPStatus:      reqCtx.HTTPStatus,
			DomainOutcomes:  reqCtx.DomainOutcomes,
		}
	}
	result := buildRequestOutcome(reqCtx, requestLogWritten)
	reqCtx.TerminalStatus = result.TerminalStatus
	reqCtx.Status = result.TerminalStatus
	reqCtx.DomainOutcomes = result.DomainOutcomes
	return result
}

func buildRequestOutcome(reqCtx *pipeline.RequestContext, requestLogWritten bool) outcome.GatewayOutcome {
	if reqCtx == nil {
		return outcome.Build(outcome.BuildInput{})
	}
	resolvedBudgetScope := budget.NormalizeScope(reqCtx.BudgetScope, reqCtx.ApplicationID)
	remaining, retryAfterSeconds := rateLimitOutcomePointers(reqCtx)
	providerLatency := providerLatencyOutcomePointer(reqCtx)
	runtimeState := reqCtx.RuntimeSnapshot.RuntimeState
	input := outcome.BuildInput{
		TerminalStatus:             firstNonEmpty(reqCtx.TerminalStatus, reqCtx.Status),
		HTTPStatus:                 reqCtx.HTTPStatus,
		ErrorCode:                  reqCtx.ErrorCode,
		ApplicationID:              reqCtx.ApplicationID,
		RuntimeSnapshotID:          reqCtx.RuntimeSnapshot.RuntimeSnapshotID,
		RuntimeSnapshotVersion:     reqCtx.RuntimeSnapshot.RuntimeSnapshotVersion,
		RuntimeState:               runtimeState,
		RateLimitChecked:          reqCtx.RateLimitDecision != nil,
		RateLimitAllowed:          reqCtx.RateLimitDecision != nil && reqCtx.RateLimitDecision.Allowed,
		RateLimitRemaining:        remaining,
		RateLimitRetryAfterSeconds: retryAfterSeconds,
		BudgetScopeType:            resolvedBudgetScope.Type,
		BudgetScopeID:              resolvedBudgetScope.ID,
		BudgetResolvedBy:           resolvedBudgetScope.ResolvedBy,
		SafetyChecked:              reqCtx.SafetyChecked,
		MaskingAction:              reqCtx.MaskingAction,
		DetectedTypes:              reqCtx.MaskingDetectedTypes,
		DetectedCount:              reqCtx.MaskingDetectedCount,
		RedactedPromptPreview:      reqCtx.RedactedPromptPreview,
		RequestedModel:             reqCtx.RequestedModel,
		SelectedProvider:           reqCtx.SelectedProvider,
		SelectedModel:              reqCtx.SelectedModel,
		RoutingReason:              reqCtx.RoutingReason,
		CacheStatus:                reqCtx.CacheStatus,
		CacheType:                  reqCtx.CacheType,
		CacheHitRequestID:          reqCtx.CacheHitRequestID,
		ProviderOutcome:            reqCtx.ProviderOutcome,
		ProviderLatencyMs:          providerLatency,
		ProviderSanitizedErrorCode: providerErrorCodeForOutcome(reqCtx.ErrorCode),
		FallbackOutcome:            reqCtx.FallbackOutcome,
		StreamingRequested:         reqCtx.Stream,
		RequestLogWritten:          requestLogWritten,
	}
	if input.TerminalStatus == "" && reqCtx.HTTPStatus == 0 {
		input.TerminalStatus = outcome.TerminalStatusFailed
	}
	return outcome.Build(input)
}

func rateLimitOutcomePointers(reqCtx *pipeline.RequestContext) (*int, *int) {
	if reqCtx == nil || reqCtx.RateLimitDecision == nil {
		return nil, nil
	}
	remaining := reqCtx.RateLimitDecision.Remaining
	retryAfterSeconds := reqCtx.RateLimitDecision.RetryAfterSeconds
	return &remaining, &retryAfterSeconds
}

func providerLatencyOutcomePointer(reqCtx *pipeline.RequestContext) *int64 {
	if reqCtx == nil || reqCtx.ProviderLatencyMs <= 0 {
		return nil
	}
	latency := reqCtx.ProviderLatencyMs
	return &latency
}

func providerErrorCodeForOutcome(errorCode string) string {
	switch strings.TrimSpace(errorCode) {
	case "provider_error", "provider_timeout", "provider_unauthorized":
		return strings.TrimSpace(errorCode)
	default:
		return ""
	}
}
