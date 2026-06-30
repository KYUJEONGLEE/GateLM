package invocationlog

import (
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

const GatewayStageOutcomesContractVersion = "gatelm.gateway-stage-outcomes.v2.0.0"

type GatewayStageOutcomes struct {
	ContractVersion string         `json:"contractVersion"`
	RequestID       string         `json:"requestId"`
	TraceID         string         `json:"traceId"`
	CompletedAt     time.Time      `json:"completedAt"`
	TerminalStatus  string         `json:"terminalStatus"`
	HTTPStatus      int            `json:"httpStatus"`
	ErrorCode       *string        `json:"errorCode"`
	DomainOutcomes  DomainOutcomes `json:"domainOutcomes"`
	LatencySummary  LatencySummary `json:"latencySummary"`
}

type LatencySummary struct {
	GatewayInternalLatencyMs int64  `json:"gatewayInternalLatencyMs"`
	ProviderLatencyMs        *int64 `json:"providerLatencyMs"`
}

type DomainOutcomes struct {
	Auth      AuthOutcome      `json:"auth"`
	Runtime   RuntimeOutcome   `json:"runtime"`
	RateLimit RateLimitOutcome `json:"rateLimit"`
	Budget    BudgetOutcome    `json:"budget"`
	Safety    SafetyOutcome    `json:"safety"`
	Routing   RoutingOutcome   `json:"routing"`
	Cache     CacheOutcome     `json:"cache"`
	Provider  ProviderOutcome  `json:"provider"`
	Fallback  FallbackOutcome  `json:"fallback"`
	Streaming StreamingOutcome `json:"streaming"`
	Logging   LoggingOutcome   `json:"logging"`
}

type AuthOutcome struct {
	Outcome    string  `json:"outcome"`
	HTTPStatus int     `json:"httpStatus,omitempty"`
	ErrorCode  *string `json:"errorCode"`
}

type RuntimeOutcome struct {
	Outcome                string  `json:"outcome"`
	RuntimeSnapshotID      *string `json:"runtimeSnapshotId"`
	RuntimeSnapshotVersion *int    `json:"runtimeSnapshotVersion"`
	RuntimeState           *string `json:"runtimeState"`
}

type RateLimitOutcome struct {
	Outcome           string `json:"outcome"`
	Remaining         *int   `json:"remaining"`
	RetryAfterSeconds *int   `json:"retryAfterSeconds"`
}

type BudgetOutcome struct {
	Outcome         string `json:"outcome"`
	BudgetScopeType string `json:"budgetScopeType"`
	BudgetScopeID   string `json:"budgetScopeId"`
	ResolvedBy      string `json:"resolvedBy"`
}

type SafetyOutcome struct {
	Outcome               string   `json:"outcome"`
	MaskingAction         string   `json:"maskingAction,omitempty"`
	DetectedTypes         []string `json:"detectedTypes,omitempty"`
	DetectedCount         int      `json:"detectedCount"`
	RedactedPromptPreview *string  `json:"redactedPromptPreview"`
}

type RoutingOutcome struct {
	Outcome          string  `json:"outcome"`
	RequestedModel   *string `json:"requestedModel"`
	SelectedProvider *string `json:"selectedProvider"`
	SelectedModel    *string `json:"selectedModel"`
	RoutingReason    *string `json:"routingReason"`
}

type CacheOutcome struct {
	Outcome           string  `json:"outcome"`
	CacheType         string  `json:"cacheType,omitempty"`
	CacheHitRequestID *string `json:"cacheHitRequestId"`
}

type ProviderOutcome struct {
	Outcome            string  `json:"outcome"`
	SelectedProvider   *string `json:"selectedProvider"`
	SelectedModel      *string `json:"selectedModel"`
	LatencyMs          *int64  `json:"latencyMs"`
	SanitizedErrorCode *string `json:"sanitizedErrorCode"`
}

type FallbackOutcome struct {
	Outcome          string  `json:"outcome"`
	FallbackProvider *string `json:"fallbackProvider"`
	Reason           *string `json:"reason"`
}

type StreamingOutcome struct {
	Outcome            string `json:"outcome"`
	StreamingRequested bool   `json:"streamingRequested"`
}

type LoggingOutcome struct {
	Outcome            string  `json:"outcome"`
	RequestLogWritten  bool    `json:"requestLogWritten"`
	SanitizedErrorCode *string `json:"sanitizedErrorCode"`
}

func BuildGatewayStageOutcomes(log TerminalLog) GatewayStageOutcomes {
	domainOutcomes := log.DomainOutcomes
	if domainOutcomes.IsZero() {
		domainOutcomes = BuildDomainOutcomes(log)
	}
	if domainOutcomes.Logging.Outcome == "" {
		domainOutcomes.Logging = LoggingOutcome{Outcome: "written", RequestLogWritten: true}
	}

	return GatewayStageOutcomes{
		ContractVersion: GatewayStageOutcomesContractVersion,
		RequestID:       log.RequestID,
		TraceID:         firstNonEmptyString(log.TraceID, log.RequestID),
		CompletedAt:     log.CompletedAt,
		TerminalStatus:  canonicalTerminalStatus(log.Status),
		HTTPStatus:      log.HTTPStatus,
		ErrorCode:       stringPointer(log.ErrorCode),
		DomainOutcomes:  domainOutcomes,
		LatencySummary: LatencySummary{
			GatewayInternalLatencyMs: log.LatencyMs,
			ProviderLatencyMs:        log.ProviderLatencyMs,
		},
	}
}

func BuildAuthFailureGatewayStageOutcomes(log AuthFailureLog) GatewayStageOutcomes {
	domainOutcomes := BuildAuthFailureDomainOutcomes(log)
	return GatewayStageOutcomes{
		ContractVersion: GatewayStageOutcomesContractVersion,
		RequestID:       log.RequestID,
		TraceID:         firstNonEmptyString(log.TraceID, log.RequestID),
		CompletedAt:     log.CompletedAt,
		TerminalStatus:  StatusBlocked,
		HTTPStatus:      log.HTTPStatus,
		ErrorCode:       stringPointer(log.ErrorCode),
		DomainOutcomes:  domainOutcomes,
		LatencySummary: LatencySummary{
			GatewayInternalLatencyMs: log.LatencyMs,
			ProviderLatencyMs:        log.ProviderLatencyMs,
		},
	}
}

func BuildDomainOutcomes(log TerminalLog) DomainOutcomes {
	return DomainOutcomes{
		Auth:      authOutcome(log.HTTPStatus, log.ErrorCode),
		Runtime:   runtimeOutcome(log),
		RateLimit: rateLimitOutcome(log.RateLimitDecision),
		Budget:    budgetOutcome(log.BudgetScope, log.ApplicationID, log.BudgetDecision),
		Safety:    safetyOutcome(log),
		Routing:   routingOutcome(log),
		Cache:     cacheOutcome(log.CacheStatus, log.CacheType, log.CacheHitRequestID),
		Provider:  providerOutcome(log),
		Fallback:  fallbackOutcome(log),
		Streaming: streamingOutcome(log.Stream, log.Status, log.ErrorCode),
		Logging:   LoggingOutcome{Outcome: "written", RequestLogWritten: true},
	}
}

func BuildAuthFailureDomainOutcomes(log AuthFailureLog) DomainOutcomes {
	return DomainOutcomes{
		Auth:      authOutcome(log.HTTPStatus, log.ErrorCode),
		Runtime:   RuntimeOutcome{Outcome: "not_checked"},
		RateLimit: RateLimitOutcome{Outcome: "not_checked"},
		Budget:    budgetOutcome(log.BudgetScope, log.ApplicationID, nil),
		Safety:    SafetyOutcome{Outcome: "not_checked", DetectedCount: 0},
		Routing:   RoutingOutcome{Outcome: "not_checked"},
		Cache:     CacheOutcome{Outcome: "bypassed", CacheType: CacheTypeNone},
		Provider:  ProviderOutcome{Outcome: "not_called"},
		Fallback:  FallbackOutcome{Outcome: "not_called"},
		Streaming: streamingOutcome(log.Stream, log.Status, log.ErrorCode),
		Logging:   LoggingOutcome{Outcome: "written", RequestLogWritten: true},
	}
}

func DomainOutcomesForInvocationLog(log LlmInvocationLog) DomainOutcomes {
	if !log.DomainOutcomes.IsZero() {
		return log.DomainOutcomes
	}
	terminal := TerminalLog{
		RequestID:             log.RequestID,
		TraceID:               log.TraceID,
		ApplicationID:         log.ApplicationID,
		BudgetScope:           log.BudgetScope,
		RuntimeSnapshot:       log.RuntimeSnapshot,
		RateLimitDecision:     nil,
		Stream:                log.Stream,
		RequestedModel:        log.RequestedModel,
		Provider:              log.Provider,
		Model:                 log.Model,
		SelectedProvider:      log.SelectedProvider,
		SelectedModel:         log.SelectedModel,
		RoutingReason:         log.RoutingReason,
		ProviderLatencyMs:     log.ProviderLatencyMs,
		Status:                log.Status,
		HTTPStatus:            log.HTTPStatus,
		ErrorCode:             log.ErrorCode,
		ErrorStage:            log.ErrorStage,
		CacheStatus:           log.CacheStatus,
		CacheType:             log.CacheType,
		CacheHitRequestID:     log.CacheHitRequestID,
		MaskingAction:         log.MaskingAction,
		MaskingDetectedTypes:  log.MaskingDetectedTypes,
		MaskingDetectedCount:  log.MaskingDetectedCount,
		RedactedPromptPreview: log.RedactedPromptPreview,
		LatencyMs:             log.LatencyMs,
		CreatedAt:             log.CreatedAt,
	}
	if log.CompletedAt != nil {
		terminal.CompletedAt = *log.CompletedAt
	}
	return BuildDomainOutcomes(terminal)
}

func (outcomes DomainOutcomes) IsZero() bool {
	return outcomes.Auth.Outcome == "" &&
		outcomes.Runtime.Outcome == "" &&
		outcomes.RateLimit.Outcome == "" &&
		outcomes.Budget.Outcome == "" &&
		outcomes.Safety.Outcome == "" &&
		outcomes.Routing.Outcome == "" &&
		outcomes.Cache.Outcome == "" &&
		outcomes.Provider.Outcome == "" &&
		outcomes.Fallback.Outcome == "" &&
		outcomes.Streaming.Outcome == "" &&
		outcomes.Logging.Outcome == ""
}

func canonicalTerminalStatus(status string) string {
	switch strings.TrimSpace(status) {
	case StatusSuccess, StatusBlocked, StatusRateLimited, StatusFailed, StatusCancelled:
		return strings.TrimSpace(status)
	default:
		return StatusFailed
	}
}

func authOutcome(httpStatus int, errorCode string) AuthOutcome {
	switch strings.TrimSpace(errorCode) {
	case ErrorCodeInvalidAPIKey:
		return AuthOutcome{Outcome: "invalid_api_key", HTTPStatus: httpStatus, ErrorCode: stringPointer(errorCode)}
	case ErrorCodeInvalidAppToken:
		return AuthOutcome{Outcome: "invalid_app_token", HTTPStatus: httpStatus, ErrorCode: stringPointer(errorCode)}
	case "scope_mismatch":
		return AuthOutcome{Outcome: "scope_mismatch", HTTPStatus: httpStatus, ErrorCode: stringPointer(errorCode)}
	default:
		if httpStatus == 401 {
			return AuthOutcome{Outcome: "invalid_api_key", HTTPStatus: httpStatus, ErrorCode: stringPointer(errorCode)}
		}
		if httpStatus == 403 && strings.TrimSpace(errorCode) == "" {
			return AuthOutcome{Outcome: "not_checked", HTTPStatus: httpStatus, ErrorCode: nil}
		}
		return AuthOutcome{Outcome: "passed", HTTPStatus: httpStatus, ErrorCode: nil}
	}
}

func runtimeOutcome(log TerminalLog) RuntimeOutcome {
	if log.RuntimeSnapshot.IsZero() {
		return RuntimeOutcome{Outcome: "no_snapshot"}
	}
	normalized := log.RuntimeSnapshot.Normalize(runtimeConfigFallback(log), log.CreatedAt, "")
	version := normalized.RuntimeSnapshotVersion
	runtimeState := normalized.RuntimeState
	return RuntimeOutcome{
		Outcome:                firstNonEmptyString(runtimeState, "snapshot_active"),
		RuntimeSnapshotID:      stringPointer(normalized.RuntimeSnapshotID),
		RuntimeSnapshotVersion: &version,
		RuntimeState:           stringPointer(runtimeState),
	}
}

func runtimeConfigFallback(log TerminalLog) runtimeconfig.ActiveConfig {
	return runtimeconfig.ActiveConfig{
		ConfigHash: log.ConfigHash,
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: log.SecurityPolicyHash,
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			RoutingPolicyHash: log.RoutingPolicyHash,
		},
	}
}

func rateLimitOutcome(decision *ratelimit.Decision) RateLimitOutcome {
	if decision == nil {
		return RateLimitOutcome{Outcome: "not_checked"}
	}
	remaining := decision.Remaining
	retryAfterSeconds := decision.RetryAfterSeconds
	if !decision.Allowed {
		return RateLimitOutcome{
			Outcome:           "rate_limited",
			Remaining:         &remaining,
			RetryAfterSeconds: &retryAfterSeconds,
		}
	}
	return RateLimitOutcome{
		Outcome:   "allowed",
		Remaining: &remaining,
	}
}

func budgetOutcome(scope budget.Scope, applicationID string, decision *budget.Decision) BudgetOutcome {
	normalized := budget.NormalizeScope(scope, applicationID)
	outcome := budget.OutcomeNotUsed
	if decision != nil {
		decisionScope := budget.NormalizeScope(decision.Scope, applicationID)
		if strings.TrimSpace(decisionScope.ID) != "" {
			normalized = decisionScope
		}
		switch strings.TrimSpace(decision.Outcome) {
		case budget.OutcomeAllowed, budget.OutcomeWarned, budget.OutcomeBlocked, budget.OutcomeNotUsed, budget.OutcomeNotChecked:
			outcome = strings.TrimSpace(decision.Outcome)
		default:
			if decision.Allowed {
				outcome = budget.OutcomeAllowed
			} else {
				outcome = budget.OutcomeBlocked
			}
		}
	}
	if strings.TrimSpace(normalized.ID) == "" {
		normalized.ID = "unknown_application"
	}
	if strings.TrimSpace(normalized.Type) == "" {
		normalized.Type = budget.ScopeTypeApplication
	}
	if strings.TrimSpace(normalized.ResolvedBy) == "" {
		normalized.ResolvedBy = budget.ResolvedByDefaultApplication
	}
	return BudgetOutcome{
		Outcome:         outcome,
		BudgetScopeType: normalized.Type,
		BudgetScopeID:   normalized.ID,
		ResolvedBy:      normalized.ResolvedBy,
	}
}

func safetyOutcome(log TerminalLog) SafetyOutcome {
	action := strings.TrimSpace(log.MaskingAction)
	if action == "" {
		action = "none"
	}
	outcome := "passed"
	if action == "redacted" {
		outcome = "redacted"
	}
	if action == "blocked" || strings.TrimSpace(log.ErrorCode) == "sensitive_data_blocked" {
		outcome = "blocked"
		action = "blocked"
	}
	if isPreSafetyTerminal(log) {
		outcome = "not_checked"
		action = ""
	}
	return SafetyOutcome{
		Outcome:               outcome,
		MaskingAction:         action,
		DetectedTypes:         append([]string{}, log.MaskingDetectedTypes...),
		DetectedCount:         log.MaskingDetectedCount,
		RedactedPromptPreview: stringPointer(log.RedactedPromptPreview),
	}
}

func routingOutcome(log TerminalLog) RoutingOutcome {
	if isPreRoutingTerminal(log) {
		return RoutingOutcome{Outcome: "not_checked"}
	}
	if strings.TrimSpace(log.SelectedProvider) == "" && strings.TrimSpace(log.SelectedModel) == "" {
		return RoutingOutcome{Outcome: "skipped", RequestedModel: stringPointer(log.RequestedModel)}
	}
	return RoutingOutcome{
		Outcome:          "selected",
		RequestedModel:   stringPointer(log.RequestedModel),
		SelectedProvider: stringPointer(firstNonEmptyString(log.SelectedProvider, log.Provider)),
		SelectedModel:    stringPointer(firstNonEmptyString(log.SelectedModel, log.Model)),
		RoutingReason:    stringPointer(log.RoutingReason),
	}
}

func cacheOutcome(cacheStatus string, cacheType string, cacheHitRequestID string) CacheOutcome {
	outcome := "bypassed"
	switch strings.TrimSpace(cacheStatus) {
	case CacheStatusHit:
		outcome = "hit"
	case CacheStatusMiss:
		outcome = "miss"
	case CacheStatusError:
		outcome = "error"
	case "":
		outcome = "bypassed"
	case CacheStatusBypass:
		outcome = "bypassed"
	default:
		outcome = "bypassed"
	}
	return CacheOutcome{
		Outcome:           outcome,
		CacheType:         firstNonEmptyString(cacheType, CacheTypeNone),
		CacheHitRequestID: stringPointer(cacheHitRequestID),
	}
}

func providerOutcome(log TerminalLog) ProviderOutcome {
	selectedProvider := firstNonEmptyString(log.SelectedProvider, log.Provider)
	selectedModel := firstNonEmptyString(log.SelectedModel, log.Model)
	base := ProviderOutcome{
		SelectedProvider:   stringPointer(selectedProvider),
		SelectedModel:      stringPointer(selectedModel),
		LatencyMs:          log.ProviderLatencyMs,
		SanitizedErrorCode: nil,
	}
	if providerWasNotCalled(log) {
		base.Outcome = "not_called"
		return base
	}
	if log.Status == StatusSuccess {
		base.Outcome = "success"
		return base
	}
	if strings.TrimSpace(log.ErrorCode) == "provider_unauthorized" {
		base.Outcome = "unauthorized"
		base.SanitizedErrorCode = stringPointer(log.ErrorCode)
		return base
	}
	if strings.Contains(strings.TrimSpace(log.ErrorCode), "timeout") {
		base.Outcome = "timeout"
		base.SanitizedErrorCode = stringPointer(log.ErrorCode)
		return base
	}
	if strings.TrimSpace(log.ErrorCode) != "" {
		base.Outcome = "error"
		base.SanitizedErrorCode = stringPointer(log.ErrorCode)
		return base
	}
	base.Outcome = "error"
	return base
}

func fallbackOutcome(log TerminalLog) FallbackOutcome {
	if providerWasNotCalled(log) {
		return FallbackOutcome{Outcome: "not_called"}
	}
	if log.Status == StatusSuccess {
		return FallbackOutcome{Outcome: "not_needed"}
	}
	if strings.TrimSpace(log.ErrorCode) == "provider_error" || strings.Contains(strings.TrimSpace(log.ErrorStage), "fallback") {
		return FallbackOutcome{Outcome: "disabled", Reason: stringPointer("fallback_not_configured")}
	}
	return FallbackOutcome{Outcome: "not_called"}
}

func streamingOutcome(stream bool, status string, errorCode string) StreamingOutcome {
	outcome := "not_streaming"
	if stream && status == StatusCancelled {
		outcome = "cancelled"
	} else if stream && strings.TrimSpace(errorCode) != "streaming_not_supported" {
		outcome = "started"
	}
	return StreamingOutcome{
		Outcome:            outcome,
		StreamingRequested: stream,
	}
}

func providerWasNotCalled(log TerminalLog) bool {
	if log.CacheStatus == CacheStatusHit {
		return true
	}
	if log.Status == StatusBlocked || log.Status == StatusRateLimited || log.Status == StatusCancelled {
		return true
	}
	if strings.TrimSpace(log.SelectedProvider) == "" && strings.TrimSpace(log.Provider) == "" && log.ProviderLatencyMs == nil {
		return true
	}
	return false
}

func isPreSafetyAuthOrRateLimit(log TerminalLog) bool {
	return log.ErrorCode == ErrorCodeInvalidAPIKey ||
		log.ErrorCode == ErrorCodeInvalidAppToken ||
		log.ErrorCode == "scope_mismatch" ||
		log.Status == StatusRateLimited
}

func isPreSafetyTerminal(log TerminalLog) bool {
	return isPreSafetyAuthOrRateLimit(log) ||
		strings.TrimSpace(log.ErrorCode) == "budget_blocked" ||
		strings.TrimSpace(log.ErrorStage) == "check_budget"
}

func isPreRoutingTerminal(log TerminalLog) bool {
	return isPreSafetyTerminal(log) ||
		strings.TrimSpace(log.ErrorCode) == "sensitive_data_blocked"
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
