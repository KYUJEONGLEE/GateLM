package invocationlog

import (
	"context"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/outcome"
)

const (
	StatusSuccess     = "success"
	StatusBlocked     = "blocked"
	StatusRateLimited = "rate_limited"
	StatusFailed      = "failed"
	StatusCancelled   = "cancelled"
	CacheStatusHit    = "hit"
	CacheStatusMiss   = "miss"
	CacheStatusBypass = "bypass"
	CacheStatusError  = "error"
	CacheTypeNone     = "none"
	CacheTypeExact    = "exact"
	SourceCustomerApp = "customer_app"
	CurrencyUSD       = "USD"

	ErrorCodeInvalidAPIKey   = "invalid_api_key"
	ErrorCodeInvalidAppToken = "invalid_app_token"

	StageAuthenticateAPIKey = "authenticate_api_key"
	StageValidateAppToken   = "validate_app_token"
)

// AuthFailureLog는 식별 정보를 항상 신뢰할 수 없는 인증 실패 구간에서 쓰는
// P0 전용 최소 로그다. 원문 헤더, 키, 토큰, 본문 필드는 의도적으로 두지 않는다.
type AuthFailureLog struct {
	RequestID     string
	TraceID       string
	TenantID      string
	ProjectID     string
	ApplicationID string
	BudgetScope   budget.Scope
	APIKeyID      string
	AppTokenID    string
	EndUserID     string
	FeatureID     string

	Endpoint       string
	Method         string
	Source         string
	Stream         bool
	RequestedModel string

	TerminalStatus string
	DomainOutcomes outcome.DomainOutcomes
	Status       string
	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string

	CacheStatus string
	CacheType   string

	PromptTokens      int
	CompletionTokens  int
	TotalTokens       int
	CostMicroUSD      int64
	LatencyMs         int64
	ProviderLatencyMs *int64

	CreatedAt   time.Time
	CompletedAt time.Time
}

type AuthFailureInput struct {
	RequestID     string
	TraceID       string
	TenantID      string
	ProjectID     string
	ApplicationID string
	BudgetScope   budget.Scope
	APIKeyID      string
	AppTokenID    string
	EndUserID     string
	FeatureID     string

	Endpoint       string
	Method         string
	Source         string
	Stream         bool
	RequestedModel string

	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string

	StartedAt   time.Time
	CompletedAt time.Time
}

type AuthFailureLogWriter interface {
	WriteAuthFailureLog(ctx context.Context, log AuthFailureLog) error
}

type NoopAuthFailureLogWriter struct{}

func (NoopAuthFailureLogWriter) WriteAuthFailureLog(context.Context, AuthFailureLog) error {
	return nil
}

func IsAuthFailure(httpStatus int, errorCode string) bool {
	switch strings.TrimSpace(errorCode) {
	case ErrorCodeInvalidAPIKey:
		return httpStatus == 401
	case ErrorCodeInvalidAppToken:
		return httpStatus == 403
	default:
		return false
	}
}

func AuthFailureStage(errorCode string) string {
	switch strings.TrimSpace(errorCode) {
	case ErrorCodeInvalidAPIKey:
		return StageAuthenticateAPIKey
	case ErrorCodeInvalidAppToken:
		return StageValidateAppToken
	default:
		return ""
	}
}

func BuildAuthFailureLog(input AuthFailureInput) AuthFailureLog {
	requestID := strings.TrimSpace(input.RequestID)
	traceID := strings.TrimSpace(input.TraceID)
	if traceID == "" {
		traceID = requestID
	}

	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = SourceCustomerApp
	}

	errorStage := strings.TrimSpace(input.ErrorStage)
	if errorStage == "" {
		errorStage = AuthFailureStage(input.ErrorCode)
	}

	completedAt := input.CompletedAt
	if completedAt.IsZero() {
		completedAt = input.StartedAt
	}
	resolvedBudgetScope := budget.NormalizeScope(input.BudgetScope, input.ApplicationID)
	terminalStatus := outcome.TerminalStatusBlocked
	domainOutcomes := outcome.Build(outcome.BuildInput{
		TerminalStatus:    terminalStatus,
		HTTPStatus:        input.HTTPStatus,
		ErrorCode:         input.ErrorCode,
		ApplicationID:     input.ApplicationID,
		BudgetScopeType:   resolvedBudgetScope.Type,
		BudgetScopeID:     resolvedBudgetScope.ID,
		BudgetResolvedBy:  resolvedBudgetScope.ResolvedBy,
		SafetyChecked:     false,
		CacheStatus:       CacheStatusBypass,
		CacheType:         CacheTypeNone,
		RequestLogWritten: true,
	}).DomainOutcomes

	return AuthFailureLog{
		RequestID:     requestID,
		TraceID:       traceID,
		TenantID:      strings.TrimSpace(input.TenantID),
		ProjectID:     strings.TrimSpace(input.ProjectID),
		ApplicationID: strings.TrimSpace(input.ApplicationID),
		BudgetScope:   resolvedBudgetScope,
		APIKeyID:      strings.TrimSpace(input.APIKeyID),
		AppTokenID:    strings.TrimSpace(input.AppTokenID),
		EndUserID:     strings.TrimSpace(input.EndUserID),
		FeatureID:     strings.TrimSpace(input.FeatureID),

		Endpoint:       strings.TrimSpace(input.Endpoint),
		Method:         strings.TrimSpace(input.Method),
		Source:         source,
		Stream:         input.Stream,
		RequestedModel: strings.TrimSpace(input.RequestedModel),

		TerminalStatus: terminalStatus,
		DomainOutcomes: domainOutcomes,
		Status:       terminalStatus,
		HTTPStatus:   input.HTTPStatus,
		ErrorCode:    strings.TrimSpace(input.ErrorCode),
		ErrorMessage: strings.TrimSpace(input.ErrorMessage),
		ErrorStage:   errorStage,

		CacheStatus: CacheStatusBypass,
		CacheType:   CacheTypeNone,

		PromptTokens:     0,
		CompletionTokens: 0,
		TotalTokens:      0,
		CostMicroUSD:     0,
		LatencyMs:        latencyMillis(input.StartedAt, completedAt),

		CreatedAt:   input.StartedAt.UTC(),
		CompletedAt: completedAt.UTC(),
	}
}

func latencyMillis(startedAt time.Time, completedAt time.Time) int64 {
	if startedAt.IsZero() || completedAt.IsZero() || completedAt.Before(startedAt) {
		return 0
	}
	return completedAt.Sub(startedAt).Milliseconds()
}
