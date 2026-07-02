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

	Endpoint                    string
	Method                      string
	Source                      string
	Stream                      bool
	RequestedProvider           string
	RequestedModel              string
	Provider                    string
	Model                       string
	SelectedProvider            string
	SelectedModel               string
	RoutingReason               string
	RoutingRuleID               string
	PromptTokens                int64
	CompletionTokens            int64
	TotalTokens                 int64
	CostMicroUSD                int64
	SavedCostMicroUSD           int64
	LatencyMs                   int64
	ProviderLatencyMs           *int64
	Status                      string
	TerminalStatus              string
	DomainOutcomes              DomainOutcomes
	HTTPStatus                  int
	ErrorCode                   string
	ErrorMessage                string
	ErrorStage                  string
	CacheStatus                 string
	CacheType                   string
	CacheKeyHash                string
	CacheHitRequestID           string
	CacheDecisionReason         string
	PromptCategory              string
	ProviderCalled              bool
	SelectedProviderID          string
	SelectedModelID             string
	RoutingPolicyHash           string
	RoutingDecisionKeyHash      string
	SemanticCacheHit            bool
	SemanticSimilarity          float64
	SemanticMatchedRequestID    string
	SemanticCacheThreshold      float64
	SemanticCachePolicyVersion  string
	SemanticCacheDecisionReason string
	EmbeddingProvider           string
	MaskingAction               string
	MaskingDetectedTypes        []string
	MaskingDetectedCount        int
	RedactedPromptPreview       string
	PromptCapture               PromptCaptureFields
	RuntimeSnapshot             runtimeconfig.RuntimeSnapshotProvenance
	CreatedAt                   time.Time
	CompletedAt                 *time.Time
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
	Status           string
	TerminalStatus   string
	DomainOutcomes   DomainOutcomes
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
	Status          string
	TerminalStatus  string
	DomainOutcomes  DomainOutcomes
	HTTPStatus      int
	Provider        string
	Model           string
	RequestedModel  string
	SelectedModel   string
	ProviderCalled  bool
	Usage           UsageFields
	UsageSummary    UsageSummaryFields
	Cost            CostFields
	Latency         LatencyFields
	LatencySummary  LatencySummaryFields
	Cache           CacheFields
	Routing         RoutingFields
	Masking         MaskingFields
	SafetySummary   SafetySummaryFields
	PromptCapture   PromptCaptureFields
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

type CostFields struct {
	CostUSD      string
	CostMicroUSD int64
	Currency     string
}

type LatencyFields struct {
	LatencyMs         int64
	ProviderLatencyMs *int64
}

type CacheFields struct {
	CacheStatus                 string
	CacheOutcome                string
	CacheType                   string
	CacheKeyHash                string
	CacheHitRequestID           string
	CacheDecisionReason         string
	SemanticCacheHit            bool
	SemanticSimilarity          float64
	SemanticMatchedRequestID    string
	SemanticCacheThreshold      float64
	SemanticCachePolicyVersion  string
	SemanticCacheDecisionReason string
	EmbeddingProvider           string
	PromptCategory              string
}

type RoutingFields struct {
	RoutingReason          string
	RoutingRuleID          string
	SelectedProvider       string
	SelectedProviderID     string
	SelectedModel          string
	SelectedModelID        string
	RoutingPolicyHash      string
	RoutingDecisionKeyHash string
}

type MaskingFields struct {
	MaskingAction         string
	MaskingDetectedTypes  []string
	MaskingDetectedCount  int
	RedactedPromptPreview string
}

type ErrorFields struct {
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string
}

type LatencySummaryFields struct {
	GatewayInternalLatencyMs int64
	ProviderLatencyMs        *int64
	TotalLatencyMs           int64
}

type UsageSummaryFields struct {
	PromptTokens          int64
	CompletionTokens      int64
	TotalTokens           int64
	EstimatedCostMicroUSD int64
	SavedCostMicroUSD     int64
}

type SafetySummaryFields struct {
	Outcome            string
	DetectedCount      int
	DetectorCategories []string
	MaskingAction      string
}

type RoutingCountByModel struct {
	SelectedProvider string
	SelectedModel    string
	RoutingReason    string
	RequestCount     int64
}

type ApplicationBreakdown struct {
	ApplicationID string
	RequestCount  int64
	CostMicroUSD  int64
	CostUSD       string
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

type DashboardDataFreshness struct {
	Source           string
	RecordCount      int64
	LastLogCreatedAt *time.Time
	GeneratedAt      time.Time
	LastAggregatedAt time.Time
	IsStale          bool
}

type DashboardQueryBudget struct {
	Status            string
	MaxRangeHours     int
	MaxBreakdownItems int
	Guidance          string
}

type DashboardPerformance struct {
	P95GatewayInternalLatencyMs *float64
	P99GatewayInternalLatencyMs *float64
	P95ProviderLatencyMs        *float64
	P99ProviderLatencyMs        *float64
	SystemErrorRate             float64
}

type DashboardOverviewFields struct {
	TotalRequests         int64
	SuccessfulRequests    int64
	FailedRequests        int64
	BlockedRequests       int64
	RateLimitedRequests   int64
	CancelledRequests     int64
	CacheHitRequests      int64
	CacheEligibleRequests int64
	CacheHitRate          *float64
	FallbackSuccessCount  int64
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
	SafetyOutcomeCounts   map[string]int64
	CacheOutcomeCounts    map[string]int64
	FallbackOutcomeCounts map[string]int64
	ApplicationBreakdown  []ApplicationBreakdown
	CostByModel           []CostByModel
	BudgetScopeBreakdown  []BudgetScopeBreakdown
	DataFreshness         DashboardDataFreshness
	QueryBudget           DashboardQueryBudget
	Performance           DashboardPerformance
}

type DashboardOverviewAggregate struct {
	TotalRequests               int64
	SuccessfulRequests          int64
	FailedRequests              int64
	BlockedRequests             int64
	RateLimitedRequests         int64
	CancelledRequests           int64
	CacheHitRequests            int64
	CacheEligibleRequests       int64
	FallbackSuccessCount        int64
	PromptTokens                int64
	CompletionTokens            int64
	TotalTokens                 int64
	TotalCostMicroUSD           int64
	SavedCostMicroUSD           int64
	AverageLatencyMs            *float64
	P95LatencyMs                *float64
	P95GatewayInternalLatencyMs *float64
	P99GatewayInternalLatencyMs *float64
	P95ProviderLatencyMs        *float64
	P99ProviderLatencyMs        *float64
	MaskingActionCounts         map[string]int64
	RoutingCountByModel         []RoutingCountByModel
	StatusCounts                map[string]int64
	SafetyOutcomeCounts         map[string]int64
	CacheOutcomeCounts          map[string]int64
	FallbackOutcomeCounts       map[string]int64
	ApplicationBreakdown        []ApplicationBreakdown
	CostByModel                 []CostByModel
	BudgetScopeBreakdown        []BudgetScopeBreakdown
	LastLogCreatedAt            *time.Time
	GeneratedAt                 time.Time
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

type applicationKey struct {
	applicationID string
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
	terminalStatus := NormalizeTerminalStatus(firstNonEmptyString(log.TerminalStatus, log.Status))
	domainOutcomes := NormalizeDomainOutcomes(log)
	return RequestLogListItem{
		RequestID:        log.RequestID,
		ProjectID:        log.ProjectID,
		ApplicationID:    log.ApplicationID,
		BudgetScope:      budget.NormalizeScope(log.BudgetScope, log.ApplicationID),
		Provider:         log.Provider,
		Model:            log.Model,
		RequestedModel:   log.RequestedModel,
		SelectedModel:    log.SelectedModel,
		Status:           log.Status,
		TerminalStatus:   terminalStatus,
		DomainOutcomes:   domainOutcomes,
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
	terminalStatus := NormalizeTerminalStatus(firstNonEmptyString(log.TerminalStatus, log.Status))
	domainOutcomes := NormalizeDomainOutcomes(log)
	latencySummary := BuildLatencySummary(log.LatencyMs, log.ProviderLatencyMs)
	safetySummary := SafetySummaryFields{
		Outcome:            domainOutcomes.Safety.Outcome,
		DetectedCount:      log.MaskingDetectedCount,
		DetectorCategories: append([]string(nil), log.MaskingDetectedTypes...),
		MaskingAction:      defaultString(log.MaskingAction, "none"),
	}
	return RequestDetail{
		RequestID:      log.RequestID,
		TraceID:        log.TraceID,
		TenantID:       log.TenantID,
		ProjectID:      log.ProjectID,
		ApplicationID:  log.ApplicationID,
		BudgetScope:    budget.NormalizeScope(log.BudgetScope, log.ApplicationID),
		Status:         log.Status,
		TerminalStatus: terminalStatus,
		DomainOutcomes: domainOutcomes,
		HTTPStatus:     log.HTTPStatus,
		Provider:       log.Provider,
		Model:          log.Model,
		RequestedModel: log.RequestedModel,
		SelectedModel:  log.SelectedModel,
		ProviderCalled: requestDetailProviderCalled(log),
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
			SavedCostMicroUSD:     log.SavedCostMicroUSD,
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
			CacheStatus:                 defaultString(log.CacheStatus, CacheStatusBypass),
			CacheOutcome:                legacyCacheOutcome(log.CacheStatus),
			CacheType:                   defaultString(log.CacheType, CacheTypeNone),
			CacheKeyHash:                log.CacheKeyHash,
			CacheHitRequestID:           log.CacheHitRequestID,
			CacheDecisionReason:         log.CacheDecisionReason,
			SemanticCacheHit:            log.SemanticCacheHit,
			SemanticSimilarity:          log.SemanticSimilarity,
			SemanticMatchedRequestID:    log.SemanticMatchedRequestID,
			SemanticCacheThreshold:      log.SemanticCacheThreshold,
			SemanticCachePolicyVersion:  log.SemanticCachePolicyVersion,
			SemanticCacheDecisionReason: log.SemanticCacheDecisionReason,
			EmbeddingProvider:           log.EmbeddingProvider,
			PromptCategory:              log.PromptCategory,
		},
		Routing: RoutingFields{
			RoutingReason:          log.RoutingReason,
			RoutingRuleID:          log.RoutingRuleID,
			SelectedProvider:       log.SelectedProvider,
			SelectedProviderID:     log.SelectedProviderID,
			SelectedModel:          log.SelectedModel,
			SelectedModelID:        log.SelectedModelID,
			RoutingPolicyHash:      log.RoutingPolicyHash,
			RoutingDecisionKeyHash: log.RoutingDecisionKeyHash,
		},
		Masking: MaskingFields{
			MaskingAction:         defaultString(log.MaskingAction, "none"),
			MaskingDetectedTypes:  append([]string(nil), log.MaskingDetectedTypes...),
			MaskingDetectedCount:  log.MaskingDetectedCount,
			RedactedPromptPreview: log.RedactedPromptPreview,
		},
		SafetySummary:   safetySummary,
		PromptCapture:   normalizePromptCaptureFields(log.PromptCapture),
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

func normalizePromptCaptureFields(fields PromptCaptureFields) PromptCaptureFields {
	fields.Mode = strings.TrimSpace(fields.Mode)
	fields.Visibility = strings.TrimSpace(fields.Visibility)
	fields.CapturedPrompt = strings.TrimSpace(fields.CapturedPrompt)
	if fields.MaxChars <= 0 {
		fields.MaxChars = runtimeconfig.PromptCaptureDefaultMaxChars
	}
	if !fields.Enabled {
		fields.Mode = runtimeconfig.PromptCaptureModeDisabled
		fields.Visibility = PromptCaptureVisibilityAdminRequestDetail
		fields.CapturedPrompt = ""
		fields.Truncated = false
	}
	if fields.Visibility == "" {
		fields.Visibility = PromptCaptureVisibilityAdminRequestDetail
	}
	return fields
}

func requestDetailProviderCalled(log LlmInvocationLog) bool {
	if log.ProviderCalled {
		return true
	}
	if defaultString(log.CacheStatus, CacheStatusBypass) == CacheStatusHit {
		return false
	}
	switch NormalizeTerminalStatus(firstNonEmptyString(log.TerminalStatus, log.Status)) {
	case StatusBlocked, StatusRateLimited, StatusCancelled:
		return false
	}
	if log.ProviderLatencyMs != nil {
		return true
	}
	return strings.TrimSpace(log.Provider) != "" || strings.TrimSpace(log.SelectedProvider) != ""
}

func runtimeSnapshotPointer(snapshot runtimeconfig.RuntimeSnapshotProvenance, createdAt time.Time) *runtimeconfig.RuntimeSnapshotProvenance {
	if snapshot.IsZero() {
		return nil
	}
	normalized := snapshot.Normalize(runtimeconfig.ActiveConfig{}, createdAt, runtimeconfig.DefaultGatewayInstanceIDCompat)
	return &normalized
}

func NormalizeTerminalStatus(status string) string {
	switch strings.TrimSpace(status) {
	case StatusSuccess:
		return StatusSuccess
	case StatusBlocked:
		return StatusBlocked
	case StatusRateLimited:
		return StatusRateLimited
	case StatusFailed:
		return StatusFailed
	case StatusCancelled:
		return StatusCancelled
	case "cache_hit":
		return StatusSuccess
	case "error":
		return StatusFailed
	default:
		return StatusFailed
	}
}

func NormalizeDomainOutcomes(log LlmInvocationLog) DomainOutcomes {
	outcomes := log.DomainOutcomes
	if outcomes.IsZero() {
		outcomes = DomainOutcomesForInvocationLog(log)
	}
	return normalizeDomainOutcomeDefaults(outcomes)
}

func normalizeDomainOutcomeDefaults(outcomes DomainOutcomes) DomainOutcomes {
	outcomes.Auth.Outcome = defaultString(outcomes.Auth.Outcome, "not_checked")
	outcomes.Runtime.Outcome = defaultString(outcomes.Runtime.Outcome, "not_checked")
	outcomes.RateLimit.Outcome = defaultString(outcomes.RateLimit.Outcome, "not_checked")
	outcomes.Budget.Outcome = defaultString(outcomes.Budget.Outcome, "not_checked")
	outcomes.Safety.Outcome = defaultString(outcomes.Safety.Outcome, "not_checked")
	if outcomes.Safety.DetectedTypes == nil {
		outcomes.Safety.DetectedTypes = []string{}
	}
	outcomes.Routing.Outcome = defaultString(outcomes.Routing.Outcome, "not_checked")
	outcomes.Cache.Outcome = defaultString(outcomes.Cache.Outcome, "not_used")
	outcomes.Provider.Outcome = defaultString(outcomes.Provider.Outcome, "not_called")
	outcomes.Fallback.Outcome = defaultString(outcomes.Fallback.Outcome, "not_called")
	outcomes.Streaming.Outcome = defaultString(outcomes.Streaming.Outcome, "not_streaming")
	outcomes.Logging.Outcome = defaultString(outcomes.Logging.Outcome, "not_called")
	return outcomes
}

func legacyCacheOutcome(cacheStatus string) string {
	switch defaultString(cacheStatus, CacheStatusBypass) {
	case CacheStatusHit:
		return "hit"
	case CacheStatusMiss:
		return "miss"
	case CacheStatusError:
		return "error"
	case CacheStatusStoreSkipped:
		return "store_skipped"
	case CacheStatusBypass:
		return "bypassed"
	default:
		return "not_used"
	}
}

func BuildLatencySummary(totalLatencyMs int64, providerLatencyMs *int64) LatencySummaryFields {
	gatewayInternalLatencyMs := totalLatencyMs
	if providerLatencyMs != nil {
		gatewayInternalLatencyMs = totalLatencyMs - *providerLatencyMs
		if gatewayInternalLatencyMs < 0 {
			gatewayInternalLatencyMs = 0
		}
	}
	return LatencySummaryFields{
		GatewayInternalLatencyMs: gatewayInternalLatencyMs,
		ProviderLatencyMs:        providerLatencyMs,
		TotalLatencyMs:           totalLatencyMs,
	}
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
	applicationCounts := map[applicationKey]ApplicationBreakdown{}

	for _, log := range logs {
		resolvedBudgetScope := budget.NormalizeScope(log.BudgetScope, log.ApplicationID)
		terminalStatus := NormalizeTerminalStatus(firstNonEmptyString(log.TerminalStatus, log.Status))
		domainOutcomes := NormalizeDomainOutcomes(log)
		latencySummary := BuildLatencySummary(log.LatencyMs, log.ProviderLatencyMs)
		aggregate.TotalRequests++
		incrementCount(aggregate.StatusCounts, terminalStatus)
		incrementCount(aggregate.MaskingActionCounts, defaultString(log.MaskingAction, "none"))
		incrementCount(aggregate.SafetyOutcomeCounts, domainOutcomes.Safety.Outcome)
		incrementCount(aggregate.CacheOutcomeCounts, domainOutcomes.Cache.Outcome)
		incrementCount(aggregate.FallbackOutcomeCounts, domainOutcomes.Fallback.Outcome)
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
		if domainOutcomes.Fallback.Outcome == "success" {
			aggregate.FallbackSuccessCount++
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
		aggregate.SavedCostMicroUSD += log.SavedCostMicroUSD
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
		if log.ApplicationID != "" {
			appKey := applicationKey{applicationID: log.ApplicationID}
			applicationItem := applicationCounts[appKey]
			applicationItem.ApplicationID = log.ApplicationID
			applicationItem.RequestCount++
			applicationItem.CostMicroUSD += log.CostMicroUSD
			applicationCounts[appKey] = applicationItem
		}
		if isLatencyEligibleStatus(terminalStatus) {
			latencies = append(latencies, log.LatencyMs)
			gatewayInternalLatencies = append(gatewayInternalLatencies, latencySummary.GatewayInternalLatencyMs)
			if latencySummary.ProviderLatencyMs != nil {
				providerLatencies = append(providerLatencies, *latencySummary.ProviderLatencyMs)
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
		}
	}

	if len(latencies) > 0 {
		averageLatency := averageInt64(latencies)
		p95Latency := percentileDiscInt64(latencies, 0.95)
		aggregate.AverageLatencyMs = &averageLatency
		aggregate.P95LatencyMs = &p95Latency
	}
	if len(gatewayInternalLatencies) > 0 {
		p95 := percentileDiscInt64(gatewayInternalLatencies, 0.95)
		p99 := percentileDiscInt64(gatewayInternalLatencies, 0.99)
		aggregate.P95GatewayInternalLatencyMs = &p95
		aggregate.P99GatewayInternalLatencyMs = &p99
	}
	if len(providerLatencies) > 0 {
		p95 := percentileDiscInt64(providerLatencies, 0.95)
		p99 := percentileDiscInt64(providerLatencies, 0.99)
		aggregate.P95ProviderLatencyMs = &p95
		aggregate.P99ProviderLatencyMs = &p99
	}
	if !maxCreatedAt.IsZero() {
		aggregate.LastLogCreatedAt = &maxCreatedAt
	}
	aggregate.RoutingCountByModel = routingCountsFromMap(routingCounts)
	aggregate.CostByModel = costCountsFromMap(costCounts)
	aggregate.BudgetScopeBreakdown = budgetScopeBreakdownsFromMap(budgetCounts)
	aggregate.ApplicationBreakdown = applicationBreakdownsFromMap(applicationCounts)

	return BuildDashboardOverviewFromAggregate(aggregate)
}

func BuildDashboardOverviewFromAggregate(aggregate DashboardOverviewAggregate) DashboardOverviewFields {
	generatedAt := generatedAtOrNow(aggregate.GeneratedAt)
	overview := DashboardOverviewFields{
		TotalRequests:         aggregate.TotalRequests,
		SuccessfulRequests:    aggregate.SuccessfulRequests,
		FailedRequests:        aggregate.FailedRequests,
		BlockedRequests:       aggregate.BlockedRequests,
		RateLimitedRequests:   aggregate.RateLimitedRequests,
		CancelledRequests:     aggregate.CancelledRequests,
		CacheHitRequests:      aggregate.CacheHitRequests,
		CacheEligibleRequests: aggregate.CacheEligibleRequests,
		FallbackSuccessCount:  aggregate.FallbackSuccessCount,
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
		StatusCounts:          mergeDefaultCounts(defaultStatusCounts(), aggregate.StatusCounts),
		SafetyOutcomeCounts:   mergeDefaultCounts(defaultSafetyOutcomeCounts(), aggregate.SafetyOutcomeCounts),
		CacheOutcomeCounts:    mergeDefaultCounts(defaultCacheOutcomeCounts(), aggregate.CacheOutcomeCounts),
		FallbackOutcomeCounts: mergeDefaultCounts(defaultFallbackOutcomeCounts(), aggregate.FallbackOutcomeCounts),
		ApplicationBreakdown:  normalizedApplicationBreakdowns(aggregate.ApplicationBreakdown),
		CostByModel:           normalizedCostByModel(aggregate.CostByModel),
		BudgetScopeBreakdown:  normalizedBudgetScopeBreakdowns(aggregate.BudgetScopeBreakdown),
		DataFreshness: DashboardDataFreshness{
			Source:           "postgresql_request_log",
			RecordCount:      aggregate.TotalRequests,
			LastLogCreatedAt: aggregate.LastLogCreatedAt,
			GeneratedAt:      generatedAt,
			LastAggregatedAt: generatedAt,
			IsStale:          isDashboardDataStale(aggregate.LastLogCreatedAt, generatedAt),
		},
		QueryBudget: DashboardQueryBudget{
			Status:            "ok",
			MaxRangeHours:     24,
			MaxBreakdownItems: 50,
		},
		Performance: DashboardPerformance{
			P95GatewayInternalLatencyMs: aggregate.P95GatewayInternalLatencyMs,
			P99GatewayInternalLatencyMs: aggregate.P99GatewayInternalLatencyMs,
			P95ProviderLatencyMs:        aggregate.P95ProviderLatencyMs,
			P99ProviderLatencyMs:        aggregate.P99ProviderLatencyMs,
		},
	}
	cacheHitRate := 0.0
	if aggregate.CacheEligibleRequests > 0 {
		cacheHitRate = float64(aggregate.CacheHitRequests) / float64(aggregate.CacheEligibleRequests)
	}
	overview.CacheHitRate = &cacheHitRate
	if overview.Performance.P95GatewayInternalLatencyMs == nil {
		overview.Performance.P95GatewayInternalLatencyMs = aggregate.P95LatencyMs
	}
	if overview.Performance.P99GatewayInternalLatencyMs == nil {
		overview.Performance.P99GatewayInternalLatencyMs = aggregate.P95LatencyMs
	}
	if overview.Performance.P95ProviderLatencyMs == nil {
		zero := 0.0
		overview.Performance.P95ProviderLatencyMs = &zero
	}
	if overview.Performance.P99ProviderLatencyMs == nil {
		zero := 0.0
		overview.Performance.P99ProviderLatencyMs = &zero
	}
	if aggregate.TotalRequests > 0 {
		overview.Performance.SystemErrorRate = float64(aggregate.FailedRequests) / float64(aggregate.TotalRequests)
	}
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
		"passed":      0,
		"redacted":    0,
		"blocked":     0,
		"not_checked": 0,
	}
}

func defaultCacheOutcomeCounts() map[string]int64 {
	return map[string]int64{
		"hit":      0,
		"miss":     0,
		"bypassed": 0,
		"error":    0,
		"not_used": 0,
	}
}

func defaultFallbackOutcomeCounts() map[string]int64 {
	return map[string]int64{
		"not_needed": 0,
		"disabled":   0,
		"success":    0,
		"failed":     0,
		"not_called": 0,
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

func applicationBreakdownsFromMap(counts map[applicationKey]ApplicationBreakdown) []ApplicationBreakdown {
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
		item.CostUSD = FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		normalized = append(normalized, item)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		if normalized[i].CostMicroUSD != normalized[j].CostMicroUSD {
			return normalized[i].CostMicroUSD > normalized[j].CostMicroUSD
		}
		return normalized[i].ApplicationID < normalized[j].ApplicationID
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

func generatedAtOrNow(generatedAt time.Time) time.Time {
	if generatedAt.IsZero() {
		return time.Now().UTC()
	}
	return generatedAt.UTC()
}

func isDashboardDataStale(lastLogCreatedAt *time.Time, generatedAt time.Time) bool {
	if lastLogCreatedAt == nil || generatedAt.IsZero() {
		return false
	}
	return generatedAt.Sub(lastLogCreatedAt.UTC()) > 5*time.Minute
}
