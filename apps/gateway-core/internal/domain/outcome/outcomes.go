package outcome

import (
	"errors"
	"sort"
	"strings"
)

const (
	ContractVersion = "gatelm.gateway-stage-outcomes.v2.0.0"

	TerminalStatusSuccess     = "success"
	TerminalStatusBlocked     = "blocked"
	TerminalStatusRateLimited = "rate_limited"
	TerminalStatusFailed      = "failed"
	TerminalStatusCancelled   = "cancelled"

	ForbiddenTerminalStatusCacheHit       = "cache_hit"
	ForbiddenTerminalStatusError          = "error"
	ForbiddenTerminalStatusPartialSuccess = "partial_success"

	AuthPassed          = "passed"
	AuthInvalidAPIKey   = "invalid_api_key"
	AuthInvalidAppToken = "invalid_app_token"
	AuthScopeMismatch   = "scope_mismatch"
	AuthNotChecked      = "not_checked"

	RuntimeSnapshotActive   = "snapshot_active"
	RuntimeLastKnownSafe    = "last_known_safe_used"
	RuntimeStaleSnapshot    = "stale_snapshot_used"
	RuntimeNoSnapshot       = "no_snapshot"
	RuntimeNotChecked       = "not_checked"
	RateLimitAllowed        = "allowed"
	RateLimitRateLimited    = "rate_limited"
	RateLimitDisabled       = "disabled"
	RateLimitError          = "error"
	RateLimitNotChecked     = "not_checked"
	BudgetAllowed           = "allowed"
	BudgetWarned            = "warned"
	BudgetBlocked           = "blocked"
	BudgetNotUsed           = "not_used"
	BudgetNotChecked        = "not_checked"
	SafetyPassed            = "passed"
	SafetyRedacted          = "redacted"
	SafetyBlocked           = "blocked"
	SafetyNotChecked        = "not_checked"
	RoutingSelected         = "selected"
	RoutingSkipped          = "skipped"
	RoutingFailed           = "failed"
	RoutingNotChecked       = "not_checked"
	CacheHit                = "hit"
	CacheMiss               = "miss"
	CacheBypassed           = "bypassed"
	CacheError              = "error"
	CacheNotUsed            = "not_used"
	ProviderSuccess         = "success"
	ProviderTimeout         = "timeout"
	ProviderError           = "error"
	ProviderUnauthorized    = "unauthorized"
	ProviderNotCalled       = "not_called"
	FallbackNotNeeded       = "not_needed"
	FallbackDisabled        = "disabled"
	FallbackSuccess         = "success"
	FallbackFailed          = "failed"
	FallbackNotCalled       = "not_called"
	StreamingNotStreaming   = "not_streaming"
	StreamingStarted        = "started"
	StreamingCompleted      = "completed"
	StreamingInterrupted    = "interrupted"
	StreamingCancelled      = "cancelled"
	LoggingWritten          = "written"
	LoggingFailed           = "failed"
	LoggingDeferred         = "deferred"
	LoggingNotCalled        = "not_called"
)

var ErrForbiddenTerminalStatus = errors.New("forbidden terminal status")

type GatewayOutcome struct {
	ContractVersion string         `json:"contractVersion,omitempty"`
	TerminalStatus  string         `json:"terminalStatus"`
	HTTPStatus      int            `json:"httpStatus"`
	ErrorCode       *string        `json:"errorCode,omitempty"`
	DomainOutcomes  DomainOutcomes `json:"domainOutcomes"`
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
	ErrorCode  *string `json:"errorCode,omitempty"`
}

type RuntimeOutcome struct {
	Outcome                string  `json:"outcome"`
	RuntimeSnapshotID      *string `json:"runtimeSnapshotId,omitempty"`
	RuntimeSnapshotVersion *int    `json:"runtimeSnapshotVersion,omitempty"`
	RuntimeState           *string `json:"runtimeState,omitempty"`
}

type RateLimitOutcome struct {
	Outcome           string `json:"outcome"`
	Remaining         *int   `json:"remaining,omitempty"`
	RetryAfterSeconds *int   `json:"retryAfterSeconds,omitempty"`
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
	RedactedPromptPreview *string  `json:"redactedPromptPreview,omitempty"`
}

type RoutingOutcome struct {
	Outcome          string  `json:"outcome"`
	RequestedModel   *string `json:"requestedModel,omitempty"`
	SelectedProvider *string `json:"selectedProvider,omitempty"`
	SelectedModel    *string `json:"selectedModel,omitempty"`
	RoutingReason    *string `json:"routingReason,omitempty"`
}

type CacheOutcome struct {
	Outcome           string  `json:"outcome"`
	CacheType         string  `json:"cacheType,omitempty"`
	CacheHitRequestID *string `json:"cacheHitRequestId,omitempty"`
}

type ProviderOutcome struct {
	Outcome            string  `json:"outcome"`
	SelectedProvider   *string `json:"selectedProvider,omitempty"`
	SelectedModel      *string `json:"selectedModel,omitempty"`
	LatencyMs          *int64  `json:"latencyMs,omitempty"`
	SanitizedErrorCode  *string `json:"sanitizedErrorCode,omitempty"`
}

type FallbackOutcome struct {
	Outcome          string  `json:"outcome"`
	FallbackProvider *string `json:"fallbackProvider,omitempty"`
	Reason           *string `json:"reason,omitempty"`
}

type StreamingOutcome struct {
	Outcome            string `json:"outcome"`
	StreamingRequested bool   `json:"streamingRequested"`
}

type LoggingOutcome struct {
	Outcome            string  `json:"outcome"`
	RequestLogWritten  bool    `json:"requestLogWritten"`
	SanitizedErrorCode *string `json:"sanitizedErrorCode,omitempty"`
}

type BuildInput struct {
	TerminalStatus string
	HTTPStatus     int
	ErrorCode      string

	ApplicationID string

	AuthOutcome string

	RuntimeOutcome          string
	RuntimeSnapshotID       string
	RuntimeSnapshotVersion  int
	RuntimeState            string

	RateLimitChecked           bool
	RateLimitAllowed           bool
	RateLimitReason            string
	RateLimitRemaining         *int
	RateLimitRetryAfterSeconds *int

	BudgetOutcome    string
	BudgetScopeType  string
	BudgetScopeID    string
	BudgetResolvedBy string

	SafetyChecked          bool
	MaskingAction          string
	DetectedTypes          []string
	DetectedCount          int
	RedactedPromptPreview  string

	RequestedModel   string
	SelectedProvider string
	SelectedModel    string
	RoutingReason    string
	RoutingOutcome   string

	CacheStatus       string
	CacheType         string
	CacheHitRequestID string

	ProviderOutcome            string
	ProviderLatencyMs          *int64
	ProviderSanitizedErrorCode string

	FallbackOutcome  string
	FallbackProvider string
	FallbackReason   string

	StreamingRequested bool
	StreamingOutcome   string

	LoggingOutcome    string
	RequestLogWritten bool
	LoggingErrorCode  string
}

func Build(input BuildInput) GatewayOutcome {
	terminalStatus := CanonicalizeTerminalStatus(input.TerminalStatus, input.HTTPStatus, input.ErrorCode)
	domainOutcomes := BuildDomainOutcomes(input, terminalStatus)
	return GatewayOutcome{
		ContractVersion: ContractVersion,
		TerminalStatus:  terminalStatus,
		HTTPStatus:      input.HTTPStatus,
		ErrorCode:       stringPointer(input.ErrorCode),
		DomainOutcomes:  domainOutcomes,
	}
}

func BuildDomainOutcomes(input BuildInput, terminalStatus string) DomainOutcomes {
	cache := cacheOutcome(input)
	provider := providerOutcome(input, terminalStatus, cache.Outcome)
	return DomainOutcomes{
		Auth:      authOutcome(input),
		Runtime:   runtimeOutcome(input),
		RateLimit: rateLimitOutcome(input, terminalStatus),
		Budget:    budgetOutcome(input),
		Safety:    safetyOutcome(input, terminalStatus),
		Routing:   routingOutcome(input, cache.Outcome),
		Cache:     cache,
		Provider:  provider,
		Fallback:  fallbackOutcome(input, terminalStatus, provider.Outcome),
		Streaming: streamingOutcome(input, terminalStatus),
		Logging:   loggingOutcome(input),
	}
}

func (d DomainOutcomes) IsZero() bool {
	return d.Auth.Outcome == "" &&
		d.Runtime.Outcome == "" &&
		d.RateLimit.Outcome == "" &&
		d.Budget.Outcome == "" &&
		d.Safety.Outcome == "" &&
		d.Routing.Outcome == "" &&
		d.Cache.Outcome == "" &&
		d.Provider.Outcome == "" &&
		d.Fallback.Outcome == "" &&
		d.Streaming.Outcome == "" &&
		d.Logging.Outcome == ""
}

func ValidateTerminalStatus(status string) error {
	if IsAllowedTerminalStatus(status) {
		return nil
	}
	return ErrForbiddenTerminalStatus
}

func IsAllowedTerminalStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case TerminalStatusSuccess, TerminalStatusBlocked, TerminalStatusRateLimited, TerminalStatusFailed, TerminalStatusCancelled:
		return true
	default:
		return false
	}
}

func CanonicalizeTerminalStatus(status string, httpStatus int, errorCode string) string {
	status = strings.TrimSpace(status)
	if IsAllowedTerminalStatus(status) {
		return status
	}
	switch status {
	case ForbiddenTerminalStatusCacheHit:
		return TerminalStatusSuccess
	case ForbiddenTerminalStatusError, ForbiddenTerminalStatusPartialSuccess:
		return TerminalStatusFailed
	}
	switch strings.TrimSpace(errorCode) {
	case "rate_limited":
		return TerminalStatusRateLimited
	case "invalid_api_key", "invalid_app_token", "scope_mismatch", "sensitive_data_blocked", "budget_blocked":
		return TerminalStatusBlocked
	}
	if httpStatus == 499 {
		return TerminalStatusCancelled
	}
	if httpStatus >= 200 && httpStatus < 300 {
		return TerminalStatusSuccess
	}
	return TerminalStatusFailed
}

func authOutcome(input BuildInput) AuthOutcome {
	explicit := strings.TrimSpace(input.AuthOutcome)
	if explicit != "" {
		return AuthOutcome{Outcome: explicit, HTTPStatus: input.HTTPStatus, ErrorCode: stringPointer(input.ErrorCode)}
	}
	switch strings.TrimSpace(input.ErrorCode) {
	case "invalid_api_key":
		return AuthOutcome{Outcome: AuthInvalidAPIKey, HTTPStatus: input.HTTPStatus, ErrorCode: stringPointer(input.ErrorCode)}
	case "invalid_app_token":
		return AuthOutcome{Outcome: AuthInvalidAppToken, HTTPStatus: input.HTTPStatus, ErrorCode: stringPointer(input.ErrorCode)}
	case "scope_mismatch":
		return AuthOutcome{Outcome: AuthScopeMismatch, HTTPStatus: input.HTTPStatus, ErrorCode: stringPointer(input.ErrorCode)}
	default:
		return AuthOutcome{Outcome: AuthPassed, HTTPStatus: 200, ErrorCode: nil}
	}
}

func runtimeOutcome(input BuildInput) RuntimeOutcome {
	explicit := strings.TrimSpace(input.RuntimeOutcome)
	if explicit == "" {
		if strings.TrimSpace(input.RuntimeSnapshotID) != "" {
			explicit = firstNonEmpty(input.RuntimeState, RuntimeSnapshotActive)
		} else {
			explicit = RuntimeNotChecked
		}
	}
	version := input.RuntimeSnapshotVersion
	return RuntimeOutcome{
		Outcome:                explicit,
		RuntimeSnapshotID:      stringPointer(input.RuntimeSnapshotID),
		RuntimeSnapshotVersion: intPointer(version),
		RuntimeState:           stringPointer(input.RuntimeState),
	}
}

func rateLimitOutcome(input BuildInput, terminalStatus string) RateLimitOutcome {
	if terminalStatus == TerminalStatusRateLimited || strings.TrimSpace(input.ErrorCode) == "rate_limited" {
		return RateLimitOutcome{
			Outcome:           RateLimitRateLimited,
			Remaining:         input.RateLimitRemaining,
			RetryAfterSeconds: input.RateLimitRetryAfterSeconds,
		}
	}
	if !input.RateLimitChecked {
		return RateLimitOutcome{Outcome: RateLimitNotChecked}
	}
	if input.RateLimitAllowed {
		return RateLimitOutcome{
			Outcome:           RateLimitAllowed,
			Remaining:         input.RateLimitRemaining,
			RetryAfterSeconds: input.RateLimitRetryAfterSeconds,
		}
	}
	return RateLimitOutcome{
		Outcome:           RateLimitError,
		Remaining:         input.RateLimitRemaining,
		RetryAfterSeconds: input.RateLimitRetryAfterSeconds,
	}
}

func budgetOutcome(input BuildInput) BudgetOutcome {
	outcomeValue := firstNonEmpty(input.BudgetOutcome, BudgetNotChecked)
	if strings.TrimSpace(input.ErrorCode) == "budget_blocked" {
		outcomeValue = BudgetBlocked
	}
	scopeType := firstNonEmpty(input.BudgetScopeType, "application")
	scopeID := firstNonEmpty(input.BudgetScopeID, input.ApplicationID, "unknown_application")
	resolvedBy := firstNonEmpty(input.BudgetResolvedBy, "default_application")
	return BudgetOutcome{
		Outcome:         outcomeValue,
		BudgetScopeType: scopeType,
		BudgetScopeID:   scopeID,
		ResolvedBy:      resolvedBy,
	}
}

func safetyOutcome(input BuildInput, terminalStatus string) SafetyOutcome {
	if !input.SafetyChecked {
		return SafetyOutcome{Outcome: SafetyNotChecked, DetectedCount: input.DetectedCount}
	}
	action := strings.TrimSpace(input.MaskingAction)
	switch action {
	case "blocked":
		return SafetyOutcome{
			Outcome:               SafetyBlocked,
			MaskingAction:         "blocked",
			DetectedTypes:         normalizeStringSlice(input.DetectedTypes),
			DetectedCount:         input.DetectedCount,
			RedactedPromptPreview: stringPointer(input.RedactedPromptPreview),
		}
	case "redacted":
		return SafetyOutcome{
			Outcome:               SafetyRedacted,
			MaskingAction:         "redacted",
			DetectedTypes:         normalizeStringSlice(input.DetectedTypes),
			DetectedCount:         input.DetectedCount,
			RedactedPromptPreview: stringPointer(input.RedactedPromptPreview),
		}
	default:
		if terminalStatus == TerminalStatusBlocked && strings.TrimSpace(input.ErrorCode) == "sensitive_data_blocked" {
			return SafetyOutcome{Outcome: SafetyBlocked, MaskingAction: "blocked", DetectedCount: input.DetectedCount}
		}
		return SafetyOutcome{Outcome: SafetyPassed, MaskingAction: "none", DetectedCount: input.DetectedCount}
	}
}

func routingOutcome(input BuildInput, cacheOutcome string) RoutingOutcome {
	outcomeValue := strings.TrimSpace(input.RoutingOutcome)
	if outcomeValue == "" {
		switch {
		case cacheOutcome == CacheHit:
			outcomeValue = RoutingSkipped
		case strings.TrimSpace(input.SelectedProvider) != "" || strings.TrimSpace(input.SelectedModel) != "" || strings.TrimSpace(input.RoutingReason) != "":
			outcomeValue = RoutingSelected
		default:
			outcomeValue = RoutingNotChecked
		}
	}
	return RoutingOutcome{
		Outcome:          outcomeValue,
		RequestedModel:   stringPointer(input.RequestedModel),
		SelectedProvider: stringPointer(input.SelectedProvider),
		SelectedModel:    stringPointer(input.SelectedModel),
		RoutingReason:    stringPointer(input.RoutingReason),
	}
}

func cacheOutcome(input BuildInput) CacheOutcome {
	outcomeValue := CacheNotUsed
	switch strings.TrimSpace(input.CacheStatus) {
	case "hit":
		outcomeValue = CacheHit
	case "miss":
		outcomeValue = CacheMiss
	case "bypass", "bypassed":
		outcomeValue = CacheBypassed
	case "error":
		outcomeValue = CacheError
	case "not_used":
		outcomeValue = CacheNotUsed
	}
	return CacheOutcome{
		Outcome:           outcomeValue,
		CacheType:         firstNonEmpty(input.CacheType, "none"),
		CacheHitRequestID: stringPointer(input.CacheHitRequestID),
	}
}

func providerOutcome(input BuildInput, terminalStatus string, cacheOutcome string) ProviderOutcome {
	outcomeValue := strings.TrimSpace(input.ProviderOutcome)
	if outcomeValue == "" {
		switch {
		case cacheOutcome == CacheHit || terminalStatus == TerminalStatusBlocked || terminalStatus == TerminalStatusRateLimited:
			outcomeValue = ProviderNotCalled
		case strings.TrimSpace(input.ErrorCode) == "provider_unauthorized":
			outcomeValue = ProviderUnauthorized
		case strings.TrimSpace(input.ErrorCode) == "provider_timeout":
			outcomeValue = ProviderTimeout
		case strings.TrimSpace(input.ErrorCode) == "provider_error" || terminalStatus == TerminalStatusFailed:
			outcomeValue = ProviderError
		case terminalStatus == TerminalStatusSuccess && (strings.TrimSpace(input.SelectedProvider) != "" || strings.TrimSpace(input.SelectedModel) != ""):
			outcomeValue = ProviderSuccess
		default:
			outcomeValue = ProviderNotCalled
		}
	}
	return ProviderOutcome{
		Outcome:           outcomeValue,
		SelectedProvider:  stringPointer(input.SelectedProvider),
		SelectedModel:     stringPointer(input.SelectedModel),
		LatencyMs:         input.ProviderLatencyMs,
		SanitizedErrorCode: stringPointer(firstNonEmpty(input.ProviderSanitizedErrorCode, providerErrorCode(input.ErrorCode))),
	}
}

func fallbackOutcome(input BuildInput, terminalStatus string, providerOutcome string) FallbackOutcome {
	outcomeValue := strings.TrimSpace(input.FallbackOutcome)
	if outcomeValue == "" {
		switch {
		case providerOutcome == ProviderTimeout || providerOutcome == ProviderError:
			if terminalStatus == TerminalStatusSuccess {
				outcomeValue = FallbackSuccess
			} else {
				outcomeValue = FallbackDisabled
			}
		case providerOutcome == ProviderSuccess:
			outcomeValue = FallbackNotNeeded
		default:
			outcomeValue = FallbackNotCalled
		}
	}
	return FallbackOutcome{
		Outcome:          outcomeValue,
		FallbackProvider: stringPointer(input.FallbackProvider),
		Reason:           stringPointer(input.FallbackReason),
	}
}

func streamingOutcome(input BuildInput, terminalStatus string) StreamingOutcome {
	outcomeValue := strings.TrimSpace(input.StreamingOutcome)
	if outcomeValue == "" {
		if input.StreamingRequested && terminalStatus == TerminalStatusCancelled {
			outcomeValue = StreamingCancelled
		} else {
			outcomeValue = StreamingNotStreaming
		}
	}
	return StreamingOutcome{
		Outcome:            outcomeValue,
		StreamingRequested: input.StreamingRequested,
	}
}

func loggingOutcome(input BuildInput) LoggingOutcome {
	outcomeValue := strings.TrimSpace(input.LoggingOutcome)
	if outcomeValue == "" {
		if input.RequestLogWritten {
			outcomeValue = LoggingWritten
		} else {
			outcomeValue = LoggingNotCalled
		}
	}
	return LoggingOutcome{
		Outcome:            outcomeValue,
		RequestLogWritten:  input.RequestLogWritten,
		SanitizedErrorCode: stringPointer(input.LoggingErrorCode),
	}
}

func providerErrorCode(errorCode string) string {
	switch strings.TrimSpace(errorCode) {
	case "provider_error", "provider_timeout", "provider_unauthorized":
		return errorCode
	default:
		return ""
	}
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func intPointer(value int) *int {
	if value <= 0 {
		return nil
	}
	return &value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func normalizeStringSlice(values []string) []string {
	set := map[string]struct{}{}
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			set[trimmed] = struct{}{}
		}
	}
	if len(set) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(set))
	for value := range set {
		normalized = append(normalized, value)
	}
	sort.Strings(normalized)
	return normalized
}
