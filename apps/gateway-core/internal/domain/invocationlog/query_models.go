package invocationlog

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/outcome"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

var (
	ErrInvalidLogQuery = errors.New("invalid invocation log query")
	ErrLogNotFound     = errors.New("invocation log not found")
)

type Reader interface {
	ListProjectLogs(ctx context.Context, filter ProjectLogsFilter) ([]RequestLogListItem, error)
	GetRequestDetail(ctx context.Context, filter RequestDetailFilter) (RequestDetail, error)
	GetDashboardOverview(ctx context.Context, filter DashboardOverviewFilter) (DashboardOverviewFields, error)
}

type ProjectLogsFilter struct {
	TenantID      string
	ProjectID     string
	From          time.Time
	To            time.Time
	Status        string
	Provider      string
	Model         string
	CacheStatus   string
	ApplicationID string
	BudgetScope   budget.Scope
	RequestID     string
	Limit         int
}

type RequestDetailFilter struct {
	TenantID  string
	ProjectID string
	RequestID string
}

type DashboardOverviewFilter struct {
	TenantID    string
	ProjectID   string
	BudgetScope budget.Scope
	From        time.Time
	To          time.Time
}

type LlmInvocationLog struct {
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

	Endpoint              string
	Method                string
	Source                string
	Stream                bool
	RequestedProvider     string
	RequestedModel        string
	Provider              string
	Model                 string
	SelectedProvider      string
	SelectedModel         string
	RoutingReason         string
	RoutingRuleID         string
	PromptTokens          int64
	CompletionTokens      int64
	TotalTokens           int64
	CostMicroUSD          int64
	SavedCostMicroUSD     int64
	LatencyMs             int64
	ProviderLatencyMs     *int64
	RateLimitDecision     *ratelimit.Decision
	TerminalStatus        string
	DomainOutcomes        outcome.DomainOutcomes
	Status                string
	HTTPStatus            int
	ErrorCode             string
	ErrorMessage          string
	ErrorStage            string
	CacheStatus           string
	CacheType             string
	CacheKeyHash          string
	CacheHitRequestID     string
	MaskingAction         string
	MaskingDetectedTypes  []string
	MaskingDetectedCount  int
	RedactedPromptPreview string
	RuntimeSnapshot       runtimeconfig.RuntimeSnapshotProvenance
	CreatedAt             time.Time
	CompletedAt           *time.Time
}

type RequestLogListItem struct {
	RequestID        string
	ProjectID        string
	ApplicationID    string
	BudgetScope      budget.Scope
	Provider         string
	Model            string
	RequestedModel   string
	SelectedModel    string
	TerminalStatus   string
	DomainOutcomes   outcome.DomainOutcomes
	Status           string
	HTTPStatus       int
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	CostUSD          string
	CostMicroUSD     int64
	LatencyMs        int64
	CacheStatus      string
	CacheType        string
	RoutingReason    string
	MaskingAction    string
	CreatedAt        time.Time
}

type RequestDetail struct {
	RequestID       string
	TraceID         string
	TenantID        string
	ProjectID       string
	ApplicationID   string
	BudgetScope     budget.Scope
	TerminalStatus  string
	DomainOutcomes  outcome.DomainOutcomes
	Status          string
	HTTPStatus      int
	Provider        string
	Model           string
	RequestedModel  string
	SelectedModel   string
	Usage           UsageFields
	UsageSummary    UsageSummaryFields
	Cost            CostFields
	Latency         LatencyFields
	LatencySummary  LatencySummaryFields
	Cache           CacheFields
	Routing         RoutingFields
	SafetySummary   SafetySummaryFields
	Masking         MaskingFields
	RuntimeSnapshot *runtimeconfig.RuntimeSnapshotProvenance
	Error           ErrorFields
	CreatedAt       time.Time
	CompletedAt     *time.Time
}

type UsageFields struct {
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
}

type UsageSummaryFields struct {
	PromptTokens           int64
	CompletionTokens       int64
	TotalTokens            int64
	EstimatedCostMicroUSD  int64
	SavedCostMicroUSD      int64
}

type CostFields struct {
	CostUSD      string
	CostMicroUSD int64
	Currency     string
}

type LatencyFields struct {
	LatencyMs         int64
	ProviderLatencyMs *int64
}

type LatencySummaryFields struct {
	GatewayInternalLatencyMs int64
	ProviderLatencyMs       *int64
	TotalLatencyMs          int64
}

type CacheFields struct {
	CacheStatus       string
	CacheType         string
	CacheKeyHash      string
	CacheHitRequestID string
}

type RoutingFields struct {
	RoutingReason    string
	RoutingRuleID    string
	SelectedProvider string
	SelectedModel    string
}

type MaskingFields struct {
	MaskingAction         string
	MaskingDetectedTypes  []string
	MaskingDetectedCount  int
	RedactedPromptPreview string
}

type SafetySummaryFields struct {
	Outcome            string
	DetectedCount      int
	DetectorCategories []string
	MaskingAction      string
}

type ErrorFields struct {
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string
}

type RoutingCountByModel struct {
	SelectedProvider string
	SelectedModel    string
	RoutingReason    string
	RequestCount     int64
}

type CostByModel struct {
	SelectedProvider string
	SelectedModel    string
	RequestCount     int64
	TotalTokens      int64
	CostMicroUSD     int64
	CostUSD          string
}

type BudgetScopeBreakdown struct {
	BudgetScope  budget.Scope
	RequestCount int64
	CostMicroUSD int64
	CostUSD      string
}

type ApplicationBreakdown struct {
	ApplicationID          string
	RequestCount           int64
	EstimatedCostMicroUSD  int64
}

type ProviderModelBreakdown struct {
	SelectedProvider       string
	SelectedModel          string
	RequestCount           int64
	P95ProviderLatencyMs   int64
}

type OutcomeBreakdown struct {
	Outcome      string
	RequestCount int64
}

type DashboardBreakdowns struct {
	ByApplication    []ApplicationBreakdown
	ByBudgetScope    []BudgetScopeBreakdown
	ByProviderModel  []ProviderModelBreakdown
	BySafetyOutcome  []OutcomeBreakdown
	ByCacheOutcome   []OutcomeBreakdown
	ByFallbackOutcome []OutcomeBreakdown
	ByTerminalStatus []OutcomeBreakdown
}

type DashboardFreshnessFields struct {
	LastIngestedAt    time.Time
	LastAggregatedAt  time.Time
	Source            string
	IsStale           bool
}

type DashboardQueryBudgetFields struct {
	Status            string
	MaxRangeHours     int
	MaxBreakdownItems int
	Guidance          *string
}

type DashboardPerformanceFields struct {
	P95GatewayInternalLatencyMs int64
	P99GatewayInternalLatencyMs int64
	P95ProviderLatencyMs        int64
	P99ProviderLatencyMs        int64
	SystemErrorRate             float64
}

type DashboardDataFreshness struct {
	Source           string
	RecordCount      int64
	LastLogCreatedAt *time.Time
	GeneratedAt      time.Time
}

type DashboardOverviewFields struct {
	GeneratedAt            time.Time
	TotalRequests         int64
	SuccessfulRequests    int64
	FailedRequests        int64
	BlockedRequests       int64
	RateLimitedRequests   int64
	CancelledRequests     int64
	CacheHitRequests      int64
	CacheEligibleRequests int64
	CacheHitRate          *float64
	PromptTokens          int64
	CompletionTokens      int64
	TotalTokens           int64
	TotalCostMicroUSD     int64
	TotalCostUSD          string
	SavedCostMicroUSD     int64
	SavedCostUSD          string
	AverageLatencyMs      *float64
	P95LatencyMs          *float64
	AverageResponseTimeMs *float64
	MaskingActionCounts   map[string]int64
	RoutingCountByModel   []RoutingCountByModel
	StatusCounts          map[string]int64
	CostByModel           []CostByModel
	BudgetScopeBreakdown  []BudgetScopeBreakdown
	DataFreshness         DashboardDataFreshness
	Freshness             DashboardFreshnessFields
	QueryBudget           DashboardQueryBudgetFields
	Breakdowns            DashboardBreakdowns
	Performance           DashboardPerformanceFields
}

type DashboardOverviewAggregate struct {
	TotalRequests         int64
	SuccessfulRequests    int64
	FailedRequests        int64
	BlockedRequests       int64
	RateLimitedRequests   int64
	CancelledRequests     int64
	CacheHitRequests      int64
	CacheEligibleRequests int64
	PromptTokens          int64
	CompletionTokens      int64
	TotalTokens           int64
	TotalCostMicroUSD     int64
	SavedCostMicroUSD     int64
	AverageLatencyMs      *float64
	P95LatencyMs          *float64
	P99LatencyMs          *float64
	P95GatewayInternalLatencyMs *float64
	P99GatewayInternalLatencyMs *float64
	P95ProviderLatencyMs  *float64
	P99ProviderLatencyMs  *float64
	MaskingActionCounts   map[string]int64
	RoutingCountByModel   []RoutingCountByModel
	StatusCounts          map[string]int64
	CostByModel           []CostByModel
	BudgetScopeBreakdown  []BudgetScopeBreakdown
	ApplicationBreakdown  []ApplicationBreakdown
	ProviderModelBreakdown []ProviderModelBreakdown
	SafetyOutcomeCounts   map[string]int64
	CacheOutcomeCounts    map[string]int64
	FallbackOutcomeCounts map[string]int64
	LastLogCreatedAt      *time.Time
	GeneratedAt           time.Time
}

type dashboardModelKey struct {
	provider string
	model    string
	reason   string
}

type budgetScopeKey struct {
	scopeType  string
	scopeID    string
	resolvedBy string
}

func NormalizeProjectLogsFilter(filter ProjectLogsFilter) (ProjectLogsFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.Status = strings.TrimSpace(filter.Status)
	filter.Provider = strings.TrimSpace(filter.Provider)
	filter.Model = strings.TrimSpace(filter.Model)
	filter.CacheStatus = strings.TrimSpace(filter.CacheStatus)
	filter.ApplicationID = strings.TrimSpace(filter.ApplicationID)
	filter.RequestID = strings.TrimSpace(filter.RequestID)
	var err error
	filter.BudgetScope, err = normalizeBudgetScopeFilter(filter.BudgetScope)
	if err != nil {
		return ProjectLogsFilter{}, err
	}

	if filter.TenantID == "" {
		return ProjectLogsFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
	if filter.ProjectID == "" {
		return ProjectLogsFilter{}, fmt.Errorf("%w: project id is required", ErrInvalidLogQuery)
	}
	if err := validateTimeRange(filter.From, filter.To); err != nil {
		return ProjectLogsFilter{}, err
	}
	if filter.Limit <= 0 {
		filter.Limit = 50
	}
	if filter.Limit > 100 {
		filter.Limit = 100
	}

	return filter, nil
}

func NormalizeRequestDetailFilter(filter RequestDetailFilter) (RequestDetailFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.RequestID = strings.TrimSpace(filter.RequestID)
	if filter.TenantID == "" {
		return RequestDetailFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
	if filter.ProjectID == "" {
		return RequestDetailFilter{}, fmt.Errorf("%w: project id is required", ErrInvalidLogQuery)
	}
	if filter.RequestID == "" {
		return RequestDetailFilter{}, fmt.Errorf("%w: request id is required", ErrInvalidLogQuery)
	}
	return filter, nil
}

func NormalizeDashboardOverviewFilter(filter DashboardOverviewFilter) (DashboardOverviewFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	var err error
	filter.BudgetScope, err = normalizeBudgetScopeFilter(filter.BudgetScope)
	if err != nil {
		return DashboardOverviewFilter{}, err
	}
	if filter.TenantID == "" {
		return DashboardOverviewFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
	if err := validateTimeRange(filter.From, filter.To); err != nil {
		return DashboardOverviewFilter{}, err
	}
	return filter, nil
}

func ToRequestLogListItem(log LlmInvocationLog) RequestLogListItem {
	terminalStatus, domainOutcomes := canonicalOutcomeFromLog(log, false)
	domainOutcomes.Safety.RedactedPromptPreview = nil
	return RequestLogListItem{
		RequestID:        log.RequestID,
		ProjectID:        log.ProjectID,
		ApplicationID:    log.ApplicationID,
		BudgetScope:      budget.NormalizeScope(log.BudgetScope, log.ApplicationID),
		Provider:         log.Provider,
		Model:            log.Model,
		RequestedModel:   log.RequestedModel,
		SelectedModel:    log.SelectedModel,
		TerminalStatus:   terminalStatus,
		DomainOutcomes:   domainOutcomes,
		Status:           terminalStatus,
		HTTPStatus:       log.HTTPStatus,
		PromptTokens:     log.PromptTokens,
		CompletionTokens: log.CompletionTokens,
		TotalTokens:      log.TotalTokens,
		CostUSD:          FormatCostUSDFromMicroUSD(log.CostMicroUSD),
		CostMicroUSD:     log.CostMicroUSD,
		LatencyMs:        log.LatencyMs,
		CacheStatus:      defaultString(log.CacheStatus, CacheStatusBypass),
		CacheType:        defaultString(log.CacheType, CacheTypeNone),
		RoutingReason:    log.RoutingReason,
		MaskingAction:    defaultString(log.MaskingAction, "none"),
		CreatedAt:        log.CreatedAt,
	}
}

func ToRequestDetail(log LlmInvocationLog) RequestDetail {
	terminalStatus, domainOutcomes := canonicalOutcomeFromLog(log, true)
	savedCostMicroUSD := exactSavedCostMicroUSD(log)
	latencySummary := latencySummaryFromLog(log)
	return RequestDetail{
		RequestID:      log.RequestID,
		TraceID:        log.TraceID,
		TenantID:       log.TenantID,
		ProjectID:      log.ProjectID,
		ApplicationID:  log.ApplicationID,
		BudgetScope:    budget.NormalizeScope(log.BudgetScope, log.ApplicationID),
		TerminalStatus: terminalStatus,
		DomainOutcomes: domainOutcomes,
		Status:         terminalStatus,
		HTTPStatus:     log.HTTPStatus,
		Provider:       log.Provider,
		Model:          log.Model,
		RequestedModel: log.RequestedModel,
		SelectedModel:  log.SelectedModel,
		Usage: UsageFields{
			PromptTokens:     log.PromptTokens,
			CompletionTokens: log.CompletionTokens,
			TotalTokens:      log.TotalTokens,
		},
		UsageSummary: UsageSummaryFields{
			PromptTokens:          log.PromptTokens,
			CompletionTokens:      log.CompletionTokens,
			TotalTokens:           log.TotalTokens,
			EstimatedCostMicroUSD: log.CostMicroUSD,
			SavedCostMicroUSD:     savedCostMicroUSD,
		},
		Cost: CostFields{
			CostUSD:      FormatCostUSDFromMicroUSD(log.CostMicroUSD),
			CostMicroUSD: log.CostMicroUSD,
			Currency:     CurrencyUSD,
		},
		Latency: LatencyFields{
			LatencyMs:         log.LatencyMs,
			ProviderLatencyMs: log.ProviderLatencyMs,
		},
		LatencySummary: latencySummary,
		Cache: CacheFields{
			CacheStatus:       defaultString(log.CacheStatus, CacheStatusBypass),
			CacheType:         defaultString(log.CacheType, CacheTypeNone),
			CacheKeyHash:      log.CacheKeyHash,
			CacheHitRequestID: log.CacheHitRequestID,
		},
		Routing: RoutingFields{
			RoutingReason:    log.RoutingReason,
			RoutingRuleID:    log.RoutingRuleID,
			SelectedProvider: log.SelectedProvider,
			SelectedModel:    log.SelectedModel,
		},
		SafetySummary: safetySummaryFromOutcome(domainOutcomes.Safety, log),
		Masking: MaskingFields{
			MaskingAction:         defaultString(log.MaskingAction, "none"),
			MaskingDetectedTypes:  append([]string(nil), log.MaskingDetectedTypes...),
			MaskingDetectedCount:  log.MaskingDetectedCount,
			RedactedPromptPreview: log.RedactedPromptPreview,
		},
		RuntimeSnapshot: runtimeSnapshotPointer(log.RuntimeSnapshot, log.CreatedAt),
		Error: ErrorFields{
			ErrorCode:    log.ErrorCode,
			ErrorMessage: log.ErrorMessage,
			ErrorStage:   log.ErrorStage,
		},
		CreatedAt:   log.CreatedAt,
		CompletedAt: log.CompletedAt,
	}
}

func canonicalOutcomeFromLog(log LlmInvocationLog, requestLogWritten bool) (string, outcome.DomainOutcomes) {
	terminalStatus := outcome.CanonicalizeTerminalStatus(defaultString(log.TerminalStatus, log.Status), log.HTTPStatus, log.ErrorCode)
	if !log.DomainOutcomes.IsZero() {
		return terminalStatus, log.DomainOutcomes
	}
	resolvedBudgetScope := budget.NormalizeScope(log.BudgetScope, log.ApplicationID)
	var remaining *int
	var retryAfterSeconds *int
	var rateLimitAllowed bool
	var rateLimitChecked bool
	if log.RateLimitDecision != nil {
		rateLimitChecked = true
		rateLimitAllowed = log.RateLimitDecision.Allowed
		remainingValue := log.RateLimitDecision.Remaining
		retryAfterValue := log.RateLimitDecision.RetryAfterSeconds
		remaining = &remainingValue
		retryAfterSeconds = &retryAfterValue
	}
	return terminalStatus, outcome.Build(outcome.BuildInput{
		TerminalStatus:             terminalStatus,
		HTTPStatus:                 log.HTTPStatus,
		ErrorCode:                  log.ErrorCode,
		ApplicationID:              log.ApplicationID,
		RuntimeSnapshotID:          log.RuntimeSnapshot.RuntimeSnapshotID,
		RuntimeSnapshotVersion:     log.RuntimeSnapshot.RuntimeSnapshotVersion,
		RuntimeState:               log.RuntimeSnapshot.RuntimeState,
		RateLimitChecked:          rateLimitChecked,
		RateLimitAllowed:          rateLimitAllowed,
		RateLimitRemaining:        remaining,
		RateLimitRetryAfterSeconds: retryAfterSeconds,
		BudgetScopeType:            resolvedBudgetScope.Type,
		BudgetScopeID:              resolvedBudgetScope.ID,
		BudgetResolvedBy:           resolvedBudgetScope.ResolvedBy,
		SafetyChecked:              log.MaskingAction != "",
		MaskingAction:              log.MaskingAction,
		DetectedTypes:              log.MaskingDetectedTypes,
		DetectedCount:              log.MaskingDetectedCount,
		RedactedPromptPreview:      log.RedactedPromptPreview,
		RequestedModel:             log.RequestedModel,
		SelectedProvider:           log.SelectedProvider,
		SelectedModel:              log.SelectedModel,
		RoutingReason:              log.RoutingReason,
		CacheStatus:                log.CacheStatus,
		CacheType:                  log.CacheType,
		CacheHitRequestID:          log.CacheHitRequestID,
		ProviderLatencyMs:          log.ProviderLatencyMs,
		RequestLogWritten:          requestLogWritten,
	}).DomainOutcomes
}

func runtimeSnapshotPointer(snapshot runtimeconfig.RuntimeSnapshotProvenance, createdAt time.Time) *runtimeconfig.RuntimeSnapshotProvenance {
	if snapshot.IsZero() {
		return nil
	}
	normalized := snapshot.Normalize(runtimeconfig.ActiveConfig{}, createdAt, runtimeconfig.DefaultGatewayInstanceIDCompat)
	return &normalized
}

func BuildDashboardOverview(logs []LlmInvocationLog) DashboardOverviewFields {
	var latencies []int64
	var gatewayInternalLatencies []int64
	var providerLatencies []int64
	var maxCreatedAt time.Time
	aggregate := DashboardOverviewAggregate{
		StatusCounts:          defaultStatusCounts(),
		MaskingActionCounts:   defaultMaskingActionCounts(),
		SafetyOutcomeCounts:   defaultSafetyOutcomeCounts(),
		CacheOutcomeCounts:    defaultCacheOutcomeCounts(),
		FallbackOutcomeCounts: defaultFallbackOutcomeCounts(),
	}
	routingCounts := map[dashboardModelKey]int64{}
	costCounts := map[dashboardModelKey]CostByModel{}
	budgetCounts := map[budgetScopeKey]BudgetScopeBreakdown{}
	applicationCounts := map[string]ApplicationBreakdown{}
	providerModelCounts := map[dashboardModelKey]int64{}
	providerModelLatencies := map[dashboardModelKey][]int64{}

	for _, log := range logs {
		terminalStatus, domainOutcomes := canonicalOutcomeFromLog(log, false)
		resolvedBudgetScope := budget.NormalizeScope(log.BudgetScope, log.ApplicationID)
		aggregate.TotalRequests++
		incrementCount(aggregate.StatusCounts, terminalStatus)
		incrementCount(aggregate.MaskingActionCounts, defaultString(log.MaskingAction, "none"))
		incrementCount(aggregate.SafetyOutcomeCounts, defaultString(domainOutcomes.Safety.Outcome, outcome.SafetyNotChecked))
		incrementCount(aggregate.CacheOutcomeCounts, defaultString(domainOutcomes.Cache.Outcome, outcome.CacheNotUsed))
		incrementCount(aggregate.FallbackOutcomeCounts, defaultString(domainOutcomes.Fallback.Outcome, outcome.FallbackNotCalled))
		if isSuccessfulStatus(terminalStatus) {
			aggregate.SuccessfulRequests++
		}
		if terminalStatus == StatusFailed {
			aggregate.FailedRequests++
		}
		if terminalStatus == StatusBlocked {
			aggregate.BlockedRequests++
		}
		if terminalStatus == StatusRateLimited {
			aggregate.RateLimitedRequests++
		}
		if terminalStatus == StatusCancelled {
			aggregate.CancelledRequests++
		}
		if isCacheEligible(log.CacheStatus) {
			aggregate.CacheEligibleRequests++
		}
		if isExactCacheHit(log.CacheStatus, log.CacheType) {
			aggregate.CacheHitRequests++
		}
		aggregate.PromptTokens += log.PromptTokens
		aggregate.CompletionTokens += log.CompletionTokens
		aggregate.TotalTokens += log.TotalTokens
		aggregate.TotalCostMicroUSD += log.CostMicroUSD
		aggregate.SavedCostMicroUSD += exactSavedCostMicroUSD(log)
		if strings.TrimSpace(log.ApplicationID) != "" {
			applicationItem := applicationCounts[log.ApplicationID]
			applicationItem.ApplicationID = log.ApplicationID
			applicationItem.RequestCount++
			applicationItem.EstimatedCostMicroUSD += log.CostMicroUSD
			applicationCounts[log.ApplicationID] = applicationItem
		}
		if resolvedBudgetScope.ID != "" {
			budgetKey := budgetScopeKey{
				scopeType:  resolvedBudgetScope.Type,
				scopeID:    resolvedBudgetScope.ID,
				resolvedBy: resolvedBudgetScope.ResolvedBy,
			}
			budgetItem := budgetCounts[budgetKey]
			budgetItem.BudgetScope = resolvedBudgetScope
			budgetItem.RequestCount++
			budgetItem.CostMicroUSD += log.CostMicroUSD
			budgetCounts[budgetKey] = budgetItem
		}
		if isLatencyEligibleStatus(terminalStatus) {
			latencies = append(latencies, log.LatencyMs)
			gatewayInternalLatencies = append(gatewayInternalLatencies, gatewayInternalLatencyMs(log))
			if log.ProviderLatencyMs != nil {
				providerLatencies = append(providerLatencies, *log.ProviderLatencyMs)
			}
		}
		if !log.CreatedAt.IsZero() && log.CreatedAt.After(maxCreatedAt) {
			maxCreatedAt = log.CreatedAt
		}

		selectedProvider := firstNonEmptyString(log.SelectedProvider, log.Provider)
		selectedModel := firstNonEmptyString(log.SelectedModel, log.Model)
		if selectedProvider != "" && selectedModel != "" {
			routingKey := dashboardModelKey{provider: selectedProvider, model: selectedModel, reason: log.RoutingReason}
			routingCounts[routingKey]++
			costKey := dashboardModelKey{provider: selectedProvider, model: selectedModel}
			cost := costCounts[costKey]
			cost.SelectedProvider = selectedProvider
			cost.SelectedModel = selectedModel
			cost.RequestCount++
			cost.TotalTokens += log.TotalTokens
			cost.CostMicroUSD += log.CostMicroUSD
			costCounts[costKey] = cost
			providerModelKey := dashboardModelKey{provider: selectedProvider, model: selectedModel}
			providerModelCounts[providerModelKey]++
			if log.ProviderLatencyMs != nil {
				providerModelLatencies[providerModelKey] = append(providerModelLatencies[providerModelKey], *log.ProviderLatencyMs)
			}
		}
	}

	if len(latencies) > 0 {
		averageLatency := averageInt64(latencies)
		p95Latency := percentileDiscInt64(latencies, 0.95)
		p99Latency := percentileDiscInt64(latencies, 0.99)
		aggregate.AverageLatencyMs = &averageLatency
		aggregate.P95LatencyMs = &p95Latency
		aggregate.P99LatencyMs = &p99Latency
	}
	if len(gatewayInternalLatencies) > 0 {
		p95GatewayInternalLatency := percentileDiscInt64(gatewayInternalLatencies, 0.95)
		p99GatewayInternalLatency := percentileDiscInt64(gatewayInternalLatencies, 0.99)
		aggregate.P95GatewayInternalLatencyMs = &p95GatewayInternalLatency
		aggregate.P99GatewayInternalLatencyMs = &p99GatewayInternalLatency
	}
	if len(providerLatencies) > 0 {
		p95ProviderLatency := percentileDiscInt64(providerLatencies, 0.95)
		p99ProviderLatency := percentileDiscInt64(providerLatencies, 0.99)
		aggregate.P95ProviderLatencyMs = &p95ProviderLatency
		aggregate.P99ProviderLatencyMs = &p99ProviderLatency
	}
	if !maxCreatedAt.IsZero() {
		aggregate.LastLogCreatedAt = &maxCreatedAt
	}
	aggregate.RoutingCountByModel = routingCountsFromMap(routingCounts)
	aggregate.CostByModel = costCountsFromMap(costCounts)
	aggregate.BudgetScopeBreakdown = budgetScopeBreakdownsFromMap(budgetCounts)
	aggregate.ApplicationBreakdown = applicationBreakdownsFromMap(applicationCounts)
	aggregate.ProviderModelBreakdown = providerModelBreakdownsFromMap(providerModelCounts, providerModelLatencies)

	return BuildDashboardOverviewFromAggregate(aggregate)
}

func BuildDashboardOverviewFromAggregate(aggregate DashboardOverviewAggregate) DashboardOverviewFields {
	generatedAt := generatedAtOrNow(aggregate.GeneratedAt)
	lastIngestedAt := generatedAt
	if aggregate.LastLogCreatedAt != nil && !aggregate.LastLogCreatedAt.IsZero() {
		lastIngestedAt = aggregate.LastLogCreatedAt.UTC()
	}
	safetyOutcomeCounts := mergeDefaultCounts(defaultSafetyOutcomeCounts(), fallbackSafetyOutcomeCounts(aggregate))
	cacheOutcomeCounts := mergeDefaultCounts(defaultCacheOutcomeCounts(), fallbackCacheOutcomeCounts(aggregate))
	fallbackOutcomeCounts := mergeDefaultCounts(defaultFallbackOutcomeCounts(), fallbackFallbackOutcomeCounts(aggregate))
	statusCounts := mergeDefaultCounts(defaultStatusCounts(), aggregate.StatusCounts)
	providerModelBreakdown := aggregate.ProviderModelBreakdown
	if len(providerModelBreakdown) == 0 {
		providerModelBreakdown = providerModelBreakdownsFromRouting(aggregate.RoutingCountByModel)
	}
	p95GatewayInternalLatencyMs := firstFloat64Pointer(aggregate.P95GatewayInternalLatencyMs, aggregate.P95LatencyMs)
	p99GatewayInternalLatencyMs := firstFloat64Pointer(aggregate.P99GatewayInternalLatencyMs, aggregate.P99LatencyMs, aggregate.P95LatencyMs)
	overview := DashboardOverviewFields{
		GeneratedAt:            generatedAt,
		TotalRequests:         aggregate.TotalRequests,
		SuccessfulRequests:    aggregate.SuccessfulRequests,
		FailedRequests:        aggregate.FailedRequests,
		BlockedRequests:       aggregate.BlockedRequests,
		RateLimitedRequests:   aggregate.RateLimitedRequests,
		CancelledRequests:     aggregate.CancelledRequests,
		CacheHitRequests:      aggregate.CacheHitRequests,
		CacheEligibleRequests: aggregate.CacheEligibleRequests,
		PromptTokens:          aggregate.PromptTokens,
		CompletionTokens:      aggregate.CompletionTokens,
		TotalTokens:           aggregate.TotalTokens,
		TotalCostMicroUSD:     aggregate.TotalCostMicroUSD,
		TotalCostUSD:          FormatCostUSDFromMicroUSD(aggregate.TotalCostMicroUSD),
		SavedCostMicroUSD:     aggregate.SavedCostMicroUSD,
		SavedCostUSD:          FormatCostUSDFromMicroUSD(aggregate.SavedCostMicroUSD),
		AverageLatencyMs:      aggregate.AverageLatencyMs,
		P95LatencyMs:          aggregate.P95LatencyMs,
		AverageResponseTimeMs: aggregate.AverageLatencyMs,
		MaskingActionCounts:   mergeDefaultCounts(defaultMaskingActionCounts(), aggregate.MaskingActionCounts),
		RoutingCountByModel:   append([]RoutingCountByModel(nil), aggregate.RoutingCountByModel...),
		StatusCounts:          statusCounts,
		CostByModel:           normalizedCostByModel(aggregate.CostByModel),
		BudgetScopeBreakdown:  normalizedBudgetScopeBreakdowns(aggregate.BudgetScopeBreakdown),
		DataFreshness: DashboardDataFreshness{
			Source:           "postgresql_request_log",
			RecordCount:      aggregate.TotalRequests,
			LastLogCreatedAt: aggregate.LastLogCreatedAt,
			GeneratedAt:      generatedAt,
		},
		Freshness: DashboardFreshnessFields{
			LastIngestedAt:   lastIngestedAt,
			LastAggregatedAt: generatedAt,
			Source:           "request_log",
			IsStale:          generatedAt.Sub(lastIngestedAt) > 5*time.Minute,
		},
		QueryBudget: DashboardQueryBudgetFields{
			Status:            "ok",
			MaxRangeHours:     24,
			MaxBreakdownItems: 50,
			Guidance:          nil,
		},
		Breakdowns: DashboardBreakdowns{
			ByApplication:     normalizedApplicationBreakdowns(aggregate.ApplicationBreakdown),
			ByBudgetScope:     normalizedBudgetScopeBreakdowns(aggregate.BudgetScopeBreakdown),
			ByProviderModel:   normalizedProviderModelBreakdowns(providerModelBreakdown),
			BySafetyOutcome:   outcomeBreakdownsFromCounts(safetyOutcomeCounts),
			ByCacheOutcome:    outcomeBreakdownsFromCounts(cacheOutcomeCounts),
			ByFallbackOutcome: outcomeBreakdownsFromCounts(fallbackOutcomeCounts),
			ByTerminalStatus:  outcomeBreakdownsFromCounts(statusCounts),
		},
		Performance: DashboardPerformanceFields{
			P95GatewayInternalLatencyMs: float64PointerToInt64(p95GatewayInternalLatencyMs),
			P99GatewayInternalLatencyMs: float64PointerToInt64(p99GatewayInternalLatencyMs),
			P95ProviderLatencyMs:        float64PointerToInt64(aggregate.P95ProviderLatencyMs),
			P99ProviderLatencyMs:        float64PointerToInt64(aggregate.P99ProviderLatencyMs),
			SystemErrorRate:             systemErrorRate(aggregate.FailedRequests, aggregate.TotalRequests),
		},
	}
	cacheHitRate := 0.0
	if aggregate.CacheEligibleRequests > 0 {
		cacheHitRate = float64(aggregate.CacheHitRequests) / float64(aggregate.CacheEligibleRequests)
	}
	overview.CacheHitRate = &cacheHitRate
	return overview
}

func FormatCostUSDFromMicroUSD(costMicroUSD int64) string {
	wholeUSD := costMicroUSD / 1_000_000
	fractionalUSD := costMicroUSD % 1_000_000
	if wholeUSD < 0 || fractionalUSD < 0 {
		if wholeUSD < 0 {
			wholeUSD = -wholeUSD
		}
		if fractionalUSD < 0 {
			fractionalUSD = -fractionalUSD
		}
		return fmt.Sprintf("-%d.%06d", wholeUSD, fractionalUSD)
	}
	return fmt.Sprintf("%d.%06d", wholeUSD, fractionalUSD)
}

func validateTimeRange(from time.Time, to time.Time) error {
	if from.IsZero() || to.IsZero() {
		return fmt.Errorf("%w: from and to are required", ErrInvalidLogQuery)
	}
	if !to.After(from) {
		return fmt.Errorf("%w: to must be after from", ErrInvalidLogQuery)
	}
	return nil
}

func normalizeBudgetScopeFilter(scope budget.Scope) (budget.Scope, error) {
	scope.Type = strings.TrimSpace(scope.Type)
	scope.ID = strings.TrimSpace(scope.ID)
	scope.ResolvedBy = strings.TrimSpace(scope.ResolvedBy)
	if scope.Type == "" && scope.ID == "" && scope.ResolvedBy == "" {
		return budget.Scope{}, nil
	}
	if scope.Type == "" || scope.ID == "" || scope.ResolvedBy == "" {
		return budget.Scope{}, fmt.Errorf("%w: budget scope filter requires budgetScopeType, budgetScopeId, and resolvedBy", ErrInvalidLogQuery)
	}
	if !budget.IsAllowedScopeType(scope.Type) {
		return budget.Scope{}, fmt.Errorf("%w: invalid budget scope type", ErrInvalidLogQuery)
	}
	if !budget.IsAllowedResolvedBy(scope.ResolvedBy) {
		return budget.Scope{}, fmt.Errorf("%w: invalid budget scope resolver", ErrInvalidLogQuery)
	}
	return scope, nil
}

func isSuccessfulStatus(status string) bool {
	return status == StatusSuccess
}

func isLatencyEligibleStatus(status string) bool {
	return status == StatusSuccess || status == StatusFailed
}

func isCacheEligible(cacheStatus string) bool {
	return defaultString(cacheStatus, CacheStatusBypass) != CacheStatusBypass
}

func isExactCacheHit(cacheStatus string, cacheType string) bool {
	return defaultString(cacheStatus, CacheStatusBypass) == CacheStatusHit &&
		defaultString(cacheType, CacheTypeNone) == CacheTypeExact
}

func exactSavedCostMicroUSD(log LlmInvocationLog) int64 {
	if !isExactCacheHit(log.CacheStatus, log.CacheType) {
		return 0
	}
	return log.SavedCostMicroUSD
}

func latencySummaryFromLog(log LlmInvocationLog) LatencySummaryFields {
	return LatencySummaryFields{
		GatewayInternalLatencyMs: gatewayInternalLatencyMs(log),
		ProviderLatencyMs:       log.ProviderLatencyMs,
		TotalLatencyMs:          log.LatencyMs,
	}
}

func gatewayInternalLatencyMs(log LlmInvocationLog) int64 {
	if log.ProviderLatencyMs == nil {
		return log.LatencyMs
	}
	gatewayLatency := log.LatencyMs - *log.ProviderLatencyMs
	if gatewayLatency < 0 {
		return 0
	}
	return gatewayLatency
}

func safetySummaryFromOutcome(safety outcome.SafetyOutcome, log LlmInvocationLog) SafetySummaryFields {
	categories := append([]string(nil), safety.DetectedTypes...)
	if len(categories) == 0 {
		categories = append([]string(nil), log.MaskingDetectedTypes...)
	}
	detectedCount := safety.DetectedCount
	if detectedCount == 0 && log.MaskingDetectedCount > 0 {
		detectedCount = log.MaskingDetectedCount
	}
	return SafetySummaryFields{
		Outcome:            defaultString(safety.Outcome, outcome.SafetyNotChecked),
		DetectedCount:      detectedCount,
		DetectorCategories: normalizedStringValues(categories),
		MaskingAction:      firstNonEmptyString(safety.MaskingAction, log.MaskingAction, "none"),
	}
}

func systemErrorRate(failedRequests int64, totalRequests int64) float64 {
	if totalRequests <= 0 || failedRequests <= 0 {
		return 0
	}
	return float64(failedRequests) / float64(totalRequests)
}

func float64PointerToInt64(value *float64) int64 {
	if value == nil || *value <= 0 {
		return 0
	}
	return int64(math.Round(*value))
}

func firstFloat64Pointer(values ...*float64) *float64 {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func fallbackSafetyOutcomeCounts(aggregate DashboardOverviewAggregate) map[string]int64 {
	if len(aggregate.SafetyOutcomeCounts) > 0 {
		return aggregate.SafetyOutcomeCounts
	}
	counts := map[string]int64{}
	for action, count := range aggregate.MaskingActionCounts {
		switch strings.TrimSpace(action) {
		case "blocked":
			counts[outcome.SafetyBlocked] += count
		case "redacted":
			counts[outcome.SafetyRedacted] += count
		case "none":
			counts[outcome.SafetyPassed] += count
		default:
			counts[outcome.SafetyNotChecked] += count
		}
	}
	return counts
}

func fallbackCacheOutcomeCounts(aggregate DashboardOverviewAggregate) map[string]int64 {
	if len(aggregate.CacheOutcomeCounts) > 0 {
		return aggregate.CacheOutcomeCounts
	}
	hitCount := aggregate.CacheHitRequests
	missCount := aggregate.CacheEligibleRequests - aggregate.CacheHitRequests
	if missCount < 0 {
		missCount = 0
	}
	bypassedCount := aggregate.TotalRequests - aggregate.CacheEligibleRequests
	if bypassedCount < 0 {
		bypassedCount = 0
	}
	return map[string]int64{
		outcome.CacheHit:      hitCount,
		outcome.CacheMiss:     missCount,
		outcome.CacheBypassed: bypassedCount,
	}
}

func fallbackFallbackOutcomeCounts(aggregate DashboardOverviewAggregate) map[string]int64 {
	if len(aggregate.FallbackOutcomeCounts) > 0 {
		return aggregate.FallbackOutcomeCounts
	}
	if aggregate.TotalRequests == 0 {
		return map[string]int64{}
	}
	return map[string]int64{outcome.FallbackNotCalled: aggregate.TotalRequests}
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func incrementCount(counts map[string]int64, key string) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "none"
	}
	counts[key]++
}

func defaultStatusCounts() map[string]int64 {
	return map[string]int64{
		StatusSuccess:     0,
		StatusBlocked:     0,
		StatusRateLimited: 0,
		StatusFailed:      0,
		StatusCancelled:   0,
	}
}

func defaultMaskingActionCounts() map[string]int64 {
	return map[string]int64{
		"none":     0,
		"redacted": 0,
		"blocked":  0,
	}
}

func defaultSafetyOutcomeCounts() map[string]int64 {
	return map[string]int64{
		outcome.SafetyPassed:     0,
		outcome.SafetyRedacted:   0,
		outcome.SafetyBlocked:    0,
		outcome.SafetyNotChecked: 0,
	}
}

func defaultCacheOutcomeCounts() map[string]int64 {
	return map[string]int64{
		outcome.CacheHit:      0,
		outcome.CacheMiss:     0,
		outcome.CacheBypassed: 0,
		outcome.CacheError:    0,
		outcome.CacheNotUsed:  0,
	}
}

func defaultFallbackOutcomeCounts() map[string]int64 {
	return map[string]int64{
		outcome.FallbackNotNeeded: 0,
		outcome.FallbackDisabled:  0,
		outcome.FallbackSuccess:   0,
		outcome.FallbackFailed:    0,
		outcome.FallbackNotCalled: 0,
	}
}

func mergeDefaultCounts(defaults map[string]int64, values map[string]int64) map[string]int64 {
	merged := make(map[string]int64, len(defaults)+len(values))
	for key, value := range defaults {
		merged[key] = value
	}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			key = "none"
		}
		merged[key] += value
	}
	return merged
}

func averageInt64(values []int64) float64 {
	var total int64
	for _, value := range values {
		total += value
	}
	return float64(total) / float64(len(values))
}

func percentileDiscInt64(values []int64, percentile float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]int64(nil), values...)
	sort.Slice(ordered, func(i int, j int) bool { return ordered[i] < ordered[j] })
	rank := int(math.Ceil(percentile*float64(len(ordered)))) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= len(ordered) {
		rank = len(ordered) - 1
	}
	return float64(ordered[rank])
}

func routingCountsFromMap(counts map[dashboardModelKey]int64) []RoutingCountByModel {
	items := make([]RoutingCountByModel, 0, len(counts))
	for key, count := range counts {
		items = append(items, RoutingCountByModel{
			SelectedProvider: key.provider,
			SelectedModel:    key.model,
			RoutingReason:    key.reason,
			RequestCount:     count,
		})
	}
	sort.Slice(items, func(i int, j int) bool {
		if items[i].RequestCount != items[j].RequestCount {
			return items[i].RequestCount > items[j].RequestCount
		}
		if items[i].SelectedProvider != items[j].SelectedProvider {
			return items[i].SelectedProvider < items[j].SelectedProvider
		}
		if items[i].SelectedModel != items[j].SelectedModel {
			return items[i].SelectedModel < items[j].SelectedModel
		}
		return items[i].RoutingReason < items[j].RoutingReason
	})
	return items
}

func costCountsFromMap(counts map[dashboardModelKey]CostByModel) []CostByModel {
	items := make([]CostByModel, 0, len(counts))
	for _, item := range counts {
		items = append(items, item)
	}
	return normalizedCostByModel(items)
}

func normalizedCostByModel(items []CostByModel) []CostByModel {
	normalized := append([]CostByModel(nil), items...)
	for index := range normalized {
		normalized[index].CostUSD = FormatCostUSDFromMicroUSD(normalized[index].CostMicroUSD)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		if normalized[i].CostMicroUSD != normalized[j].CostMicroUSD {
			return normalized[i].CostMicroUSD > normalized[j].CostMicroUSD
		}
		if normalized[i].SelectedProvider != normalized[j].SelectedProvider {
			return normalized[i].SelectedProvider < normalized[j].SelectedProvider
		}
		return normalized[i].SelectedModel < normalized[j].SelectedModel
	})
	return normalized
}

func budgetScopeBreakdownsFromMap(counts map[budgetScopeKey]BudgetScopeBreakdown) []BudgetScopeBreakdown {
	items := make([]BudgetScopeBreakdown, 0, len(counts))
	for _, item := range counts {
		items = append(items, item)
	}
	return normalizedBudgetScopeBreakdowns(items)
}

func normalizedBudgetScopeBreakdowns(items []BudgetScopeBreakdown) []BudgetScopeBreakdown {
	normalized := make([]BudgetScopeBreakdown, 0, len(items))
	for _, item := range items {
		item.BudgetScope = budget.NormalizeScope(item.BudgetScope, "")
		if item.BudgetScope.ID == "" {
			continue
		}
		item.CostUSD = FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		normalized = append(normalized, item)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		if normalized[i].CostMicroUSD != normalized[j].CostMicroUSD {
			return normalized[i].CostMicroUSD > normalized[j].CostMicroUSD
		}
		if normalized[i].BudgetScope.Type != normalized[j].BudgetScope.Type {
			return normalized[i].BudgetScope.Type < normalized[j].BudgetScope.Type
		}
		if normalized[i].BudgetScope.ID != normalized[j].BudgetScope.ID {
			return normalized[i].BudgetScope.ID < normalized[j].BudgetScope.ID
		}
		return normalized[i].BudgetScope.ResolvedBy < normalized[j].BudgetScope.ResolvedBy
	})
	return normalized
}

func applicationBreakdownsFromMap(counts map[string]ApplicationBreakdown) []ApplicationBreakdown {
	items := make([]ApplicationBreakdown, 0, len(counts))
	for _, item := range counts {
		items = append(items, item)
	}
	return normalizedApplicationBreakdowns(items)
}

func normalizedApplicationBreakdowns(items []ApplicationBreakdown) []ApplicationBreakdown {
	normalized := make([]ApplicationBreakdown, 0, len(items))
	for _, item := range items {
		item.ApplicationID = strings.TrimSpace(item.ApplicationID)
		if item.ApplicationID == "" {
			continue
		}
		normalized = append(normalized, item)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		if normalized[i].RequestCount != normalized[j].RequestCount {
			return normalized[i].RequestCount > normalized[j].RequestCount
		}
		return normalized[i].ApplicationID < normalized[j].ApplicationID
	})
	return normalized
}

func providerModelBreakdownsFromMap(counts map[dashboardModelKey]int64, latencies map[dashboardModelKey][]int64) []ProviderModelBreakdown {
	items := make([]ProviderModelBreakdown, 0, len(counts))
	for key, count := range counts {
		if strings.TrimSpace(key.provider) == "" || strings.TrimSpace(key.model) == "" {
			continue
		}
		items = append(items, ProviderModelBreakdown{
			SelectedProvider:     key.provider,
			SelectedModel:        key.model,
			RequestCount:         count,
			P95ProviderLatencyMs: int64(percentileDiscInt64(latencies[key], 0.95)),
		})
	}
	return normalizedProviderModelBreakdowns(items)
}

func providerModelBreakdownsFromRouting(items []RoutingCountByModel) []ProviderModelBreakdown {
	breakdowns := make([]ProviderModelBreakdown, 0, len(items))
	for _, item := range items {
		breakdowns = append(breakdowns, ProviderModelBreakdown{
			SelectedProvider:     item.SelectedProvider,
			SelectedModel:        item.SelectedModel,
			RequestCount:         item.RequestCount,
			P95ProviderLatencyMs: 0,
		})
	}
	return normalizedProviderModelBreakdowns(breakdowns)
}

func normalizedProviderModelBreakdowns(items []ProviderModelBreakdown) []ProviderModelBreakdown {
	normalized := make([]ProviderModelBreakdown, 0, len(items))
	for _, item := range items {
		item.SelectedProvider = strings.TrimSpace(item.SelectedProvider)
		item.SelectedModel = strings.TrimSpace(item.SelectedModel)
		if item.SelectedProvider == "" || item.SelectedModel == "" {
			continue
		}
		normalized = append(normalized, item)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		if normalized[i].RequestCount != normalized[j].RequestCount {
			return normalized[i].RequestCount > normalized[j].RequestCount
		}
		if normalized[i].SelectedProvider != normalized[j].SelectedProvider {
			return normalized[i].SelectedProvider < normalized[j].SelectedProvider
		}
		return normalized[i].SelectedModel < normalized[j].SelectedModel
	})
	return normalized
}

func outcomeBreakdownsFromCounts(counts map[string]int64) []OutcomeBreakdown {
	items := make([]OutcomeBreakdown, 0, len(counts))
	for key, count := range counts {
		key = strings.TrimSpace(key)
		if key == "" || count <= 0 {
			continue
		}
		items = append(items, OutcomeBreakdown{Outcome: key, RequestCount: count})
	}
	sort.Slice(items, func(i int, j int) bool {
		if items[i].RequestCount != items[j].RequestCount {
			return items[i].RequestCount > items[j].RequestCount
		}
		return items[i].Outcome < items[j].Outcome
	})
	return items
}

func normalizedStringValues(values []string) []string {
	set := map[string]struct{}{}
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			set[trimmed] = struct{}{}
		}
	}
	normalized := make([]string, 0, len(set))
	for value := range set {
		normalized = append(normalized, value)
	}
	sort.Strings(normalized)
	return normalized
}

func generatedAtOrNow(generatedAt time.Time) time.Time {
	if generatedAt.IsZero() {
		return time.Now().UTC()
	}
	return generatedAt.UTC()
}
