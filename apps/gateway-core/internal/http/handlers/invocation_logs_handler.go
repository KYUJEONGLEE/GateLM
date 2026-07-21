package handlers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

const (
	invocationLogInternalErrorMaxLen = 512
	invocationLogLogFieldMaxLen      = 256
)

var invocationLogSecretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)authorization\s*[:=]\s*(bearer\s+)?\S+`),
	regexp.MustCompile(`(?i)(api[_ -]?key|app[_ -]?token|provider[_ -]?key)\s*[:=]\s*\S+`),
	regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9._~+/\-=]+`),
	regexp.MustCompile(`glm_(api|app_token)_[A-Za-z0-9._-]+`),
	regexp.MustCompile(`[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`),
}

type ProjectLogsReader interface {
	ListProjectLogs(ctx context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error)
}

type ProjectLogFilterOptionsReader interface {
	ListProjectLogFilterOptions(ctx context.Context, filter invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error)
}

type RequestDetailReader interface {
	GetRequestDetail(ctx context.Context, filter invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error)
}

type DashboardOverviewReader interface {
	GetDashboardOverview(ctx context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error)
}

type AnalyticsPerformanceReader interface {
	GetAnalyticsPerformance(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error)
}

type ProjectLogsHandler struct {
	Reader   ProjectLogsReader
	TenantID string
}

type RequestDetailHandler struct {
	Reader    RequestDetailReader
	TenantID  string
	ProjectID string
}

type DashboardOverviewHandler struct {
	Reader   DashboardOverviewReader
	TenantID string
}

type AnalyticsPerformanceHandler struct {
	Reader   AnalyticsPerformanceReader
	TenantID string
}

type projectLogsResponse struct {
	Data       []requestLogListItemResponse `json:"data"`
	Pagination paginationResponse           `json:"pagination"`
	Meta       *projectLogsMetaResponse     `json:"meta,omitempty"`
}

type requestDetailResponse struct {
	Data requestDetailDataResponse `json:"data"`
}

type dashboardOverviewResponse struct {
	Data dashboardOverviewDataResponse `json:"data"`
}

type analyticsPerformanceResponse struct {
	Data analyticsPerformanceDataResponse `json:"data"`
}

type projectLogsMetaResponse struct {
	FilterOptions requestLogFilterOptionsResponse `json:"filterOptions"`
}

type requestLogFilterOptionsResponse struct {
	RequestedModels []string              `json:"requestedModels"`
	BudgetScopes    []budgetScopeResponse `json:"budgetScopes"`
}

type dashboardOverviewDataResponse struct {
	GeneratedAt   time.Time                      `json:"generatedAt"`
	TimeRange     dashboardTimeRangeResponse     `json:"timeRange"`
	Freshness     dashboardFreshnessResponse     `json:"freshness"`
	QueryBudget   dashboardQueryBudgetResponse   `json:"queryBudget"`
	Breakdowns    dashboardBreakdownsResponse    `json:"breakdowns"`
	Performance   dashboardPerformanceResponse   `json:"performance"`
	Range         dashboardRangeResponse         `json:"range"`
	Filter        dashboardFilterResponse        `json:"filters"`
	Totals        dashboardTotalsResponse        `json:"totals"`
	DataFreshness dashboardDataFreshnessResponse `json:"dataFreshness"`
}

type analyticsPerformanceDataResponse struct {
	Summary                  analyticsPerformanceSummaryResponse          `json:"summary"`
	SurfaceSummaries         []analyticsSurfaceSummaryResponse            `json:"surfaceSummaries"`
	ProviderModelPerformance []analyticsProviderModelPerformanceResponse  `json:"providerModelPerformance"`
	P95LatencyByProvider     []analyticsProviderLatencyResponse           `json:"p95LatencyByProvider"`
	LatencyDistribution      []analyticsLatencyDistributionBucketResponse `json:"latencyDistribution"`
	SlowestRequests          []analyticsSlowRequestResponse               `json:"slowestRequests"`
	BucketInterval           string                                       `json:"bucketInterval"`
	ExpectedBucketCount      int                                          `json:"expectedBucketCount"`
	Range                    dashboardRangeResponse                       `json:"range"`
	Filter                   analyticsPerformanceFilterResponse           `json:"filters"`
	DataFreshness            dashboardDataFreshnessResponse               `json:"dataFreshness"`
}

type analyticsPerformanceSummaryResponse struct {
	AvgLatencyMs        *float64 `json:"avgLatencyMs"`
	P95LatencyMs        *float64 `json:"p95LatencyMs"`
	P99LatencyMs        *float64 `json:"p99LatencyMs"`
	ThroughputPerMinute *float64 `json:"throughputPerMinute"`
	ErrorRate           *float64 `json:"errorRate"`
	SystemErrorRequests int64    `json:"systemErrorRequests"`
	TotalRequests       int64    `json:"totalRequests"`
}

type analyticsSurfaceSummaryResponse struct {
	Surface     string     `json:"surface"`
	LastEventAt *time.Time `json:"lastEventAt"`
	analyticsPerformanceSummaryResponse
}

type analyticsProviderModelPerformanceResponse struct {
	Surface           string   `json:"surface"`
	Provider          string   `json:"provider"`
	Model             string   `json:"model"`
	Requests          int64    `json:"requests"`
	AvgLatencyMs      *float64 `json:"avgLatencyMs"`
	P95LatencyMs      *float64 `json:"p95LatencyMs"`
	P99LatencyMs      *float64 `json:"p99LatencyMs"`
	ErrorRate         *float64 `json:"errorRate"`
	CostPerRequestUSD *float64 `json:"costPerRequestUsd"`
	TotalCostMicroUSD int64    `json:"totalCostMicroUsd"`
	TotalCostUSD      string   `json:"totalCostUsd"`
	CacheHitRate      *float64 `json:"cacheHitRate"`
}

type analyticsProviderLatencyResponse struct {
	Surface      string   `json:"surface"`
	Provider     string   `json:"provider"`
	P95LatencyMs *float64 `json:"p95LatencyMs"`
	Requests     int64    `json:"requests"`
}

type analyticsLatencyDistributionBucketResponse struct {
	Surface      string    `json:"surface"`
	Bucket       time.Time `json:"bucket"`
	Label        string    `json:"label"`
	P50LatencyMs *float64  `json:"p50LatencyMs"`
	P95LatencyMs *float64  `json:"p95LatencyMs"`
	P99LatencyMs *float64  `json:"p99LatencyMs"`
	Requests     int64     `json:"requests"`
}

type analyticsSlowRequestResponse struct {
	Surface    string    `json:"surface"`
	RequestID  string    `json:"requestId"`
	Timestamp  time.Time `json:"timestamp"`
	ProjectID  *string   `json:"projectId"`
	Provider   string    `json:"provider"`
	Model      string    `json:"model"`
	LatencyMs  int64     `json:"latencyMs"`
	StatusCode *int      `json:"statusCode"`
	Status     string    `json:"status"`
}

type analyticsPerformanceFilterResponse struct {
	TenantID          string  `json:"tenantId"`
	ProjectID         *string `json:"projectId"`
	Provider          *string `json:"provider"`
	Model             *string `json:"model"`
	IncludeTenantChat bool    `json:"includeTenantChat"`
}

type dashboardTimeRangeResponse struct {
	From        time.Time `json:"from"`
	To          time.Time `json:"to"`
	Granularity string    `json:"granularity"`
}

type dashboardRangeResponse struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type dashboardFilterResponse struct {
	TenantID        string  `json:"tenantId"`
	ProjectID       *string `json:"projectId"`
	BudgetScopeType *string `json:"budgetScopeType"`
	BudgetScopeID   *string `json:"budgetScopeId"`
	ResolvedBy      *string `json:"resolvedBy"`
}

type dashboardTotalsResponse struct {
	TotalRequests         int64                          `json:"totalRequests"`
	SuccessfulRequests    int64                          `json:"successfulRequests"`
	FailedRequests        int64                          `json:"failedRequests"`
	BlockedRequests       int64                          `json:"blockedRequests"`
	RateLimitedRequests   int64                          `json:"rateLimitedRequests"`
	CancelledRequests     int64                          `json:"cancelledRequests"`
	CacheHitRequests      int64                          `json:"cacheHitRequests"`
	CacheEligibleRequests int64                          `json:"cacheEligibleRequests"`
	CacheHitRate          *float64                       `json:"cacheHitRate"`
	ExactCacheHitRate     *float64                       `json:"exactCacheHitRate"`
	FallbackSuccessCount  int64                          `json:"fallbackSuccessCount"`
	PromptTokens          int64                          `json:"promptTokens"`
	CompletionTokens      int64                          `json:"completionTokens"`
	TotalTokens           int64                          `json:"totalTokens"`
	TotalCostMicroUSD     int64                          `json:"totalCostMicroUsd"`
	TotalCostUSD          string                         `json:"totalCostUsd"`
	SavedCostMicroUSD     int64                          `json:"savedCostMicroUsd"`
	SavedCostUSD          string                         `json:"savedCostUsd"`
	AverageLatencyMs      *float64                       `json:"averageLatencyMs"`
	P95LatencyMs          *float64                       `json:"p95LatencyMs"`
	AverageResponseTimeMs *float64                       `json:"averageResponseTimeMs"`
	MaskingActionCounts   map[string]int64               `json:"maskingActionCounts"`
	RoutingCountByModel   []routingCountByModelResponse  `json:"routingSummaries"`
	StatusCounts          map[string]int64               `json:"statusCounts"`
	BudgetOutcomeCounts   map[string]int64               `json:"budgetOutcomeCounts"`
	CostByProject         []projectBreakdownResponse     `json:"costByProject"`
	CostByModel           []costByModelResponse          `json:"costByModel"`
	CostByBudgetScope     []budgetScopeBreakdownResponse `json:"costByBudgetScope"`
	BudgetScopeBreakdown  []budgetScopeBreakdownResponse `json:"budgetScopeBreakdown"`
}

type dashboardDataFreshnessResponse struct {
	Source           string     `json:"source"`
	RecordCount      int64      `json:"recordCount"`
	LastLogCreatedAt *time.Time `json:"lastLogCreatedAt"`
	GeneratedAt      time.Time  `json:"generatedAt"`
}

type dashboardFreshnessResponse struct {
	LastIngestedAt   time.Time `json:"lastIngestedAt"`
	LastAggregatedAt time.Time `json:"lastAggregatedAt"`
	Source           string    `json:"source"`
	IsStale          bool      `json:"isStale"`
}

type dashboardQueryBudgetResponse struct {
	Status            string  `json:"status"`
	MaxRangeHours     int     `json:"maxRangeHours"`
	MaxBreakdownItems int     `json:"maxBreakdownItems"`
	Guidance          *string `json:"guidance"`
}

type dashboardPerformanceResponse struct {
	P95GatewayInternalLatencyMs *float64                     `json:"p95GatewayInternalLatencyMs"`
	P99GatewayInternalLatencyMs *float64                     `json:"p99GatewayInternalLatencyMs"`
	P95ProviderLatencyMs        *float64                     `json:"p95ProviderLatencyMs"`
	P99ProviderLatencyMs        *float64                     `json:"p99ProviderLatencyMs"`
	SystemErrorRate             float64                      `json:"systemErrorRate"`
	GatewayTTFT                 dashboardGatewayTTFTResponse `json:"gatewayTtft"`
}

type dashboardGatewayTTFTResponse struct {
	Scope                  string   `json:"scope"`
	AverageMs              *float64 `json:"averageMs"`
	P50Ms                  *float64 `json:"p50Ms"`
	P95Ms                  *float64 `json:"p95Ms"`
	P99Ms                  *float64 `json:"p99Ms"`
	EligibleStreamRequests int64    `json:"eligibleStreamRequests"`
	ObservedRequests       int64    `json:"observedRequests"`
	CoverageRate           *float64 `json:"coverageRate"`
}

type dashboardBreakdownsResponse struct {
	ByProject         []projectBreakdownResponse       `json:"byProject"`
	ByApplication     []applicationBreakdownResponse   `json:"byApplication"`
	ByBudgetScope     []budgetScopeBreakdownResponse   `json:"byBudgetScope"`
	ByProviderModel   []providerModelBreakdownResponse `json:"byProviderModel"`
	BySafetyOutcome   []outcomeBreakdownResponse       `json:"bySafetyOutcome"`
	ByCacheOutcome    []outcomeBreakdownResponse       `json:"byCacheOutcome"`
	ByFallbackOutcome []outcomeBreakdownResponse       `json:"byFallbackOutcome"`
	ByBudgetOutcome   []outcomeBreakdownResponse       `json:"byBudgetOutcome"`
	ByTerminalStatus  []outcomeBreakdownResponse       `json:"byTerminalStatus"`
}

type projectBreakdownResponse struct {
	ProjectID        string `json:"projectId"`
	RequestCount     int64  `json:"requestCount"`
	PromptTokens     int64  `json:"promptTokens"`
	CompletionTokens int64  `json:"completionTokens"`
	TotalTokens      int64  `json:"totalTokens"`
	CostMicroUSD     int64  `json:"costMicroUsd"`
	CostUSD          string `json:"costUsd"`
}

type applicationBreakdownResponse struct {
	ApplicationID string `json:"applicationId"`
	RequestCount  int64  `json:"requestCount"`
	CostMicroUSD  int64  `json:"estimatedCostMicroUsd"`
}

type providerModelBreakdownResponse struct {
	Provider             string  `json:"provider"`
	Model                string  `json:"model"`
	RequestCount         int64   `json:"requestCount"`
	P95ProviderLatencyMs float64 `json:"p95ProviderLatencyMs"`
}

type outcomeBreakdownResponse struct {
	Outcome      string `json:"outcome"`
	RequestCount int64  `json:"requestCount"`
}

type routingCountByModelResponse struct {
	Category      string `json:"category"`
	Difficulty    string `json:"difficulty"`
	RoutingReason string `json:"routingReason"`
	RequestCount  int64  `json:"requestCount"`
}

type costByModelResponse struct {
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	RequestCount int64  `json:"requestCount"`
	TotalTokens  int64  `json:"totalTokens"`
	CostMicroUSD int64  `json:"costMicroUsd"`
	CostUSD      string `json:"costUsd"`
}

type budgetScopeResponse struct {
	BudgetScopeType string `json:"budgetScopeType"`
	BudgetScopeID   string `json:"budgetScopeId"`
	ResolvedBy      string `json:"resolvedBy"`
}

type budgetScopeBreakdownResponse struct {
	BudgetScopeType string `json:"budgetScopeType"`
	BudgetScopeID   string `json:"budgetScopeId"`
	ResolvedBy      string `json:"resolvedBy"`
	RequestCount    int64  `json:"requestCount"`
	CostMicroUSD    int64  `json:"costMicroUsd"`
	CostUSD         string `json:"costUsd"`
}

type runtimeSnapshotProvenanceResponse struct {
	RuntimeSnapshotID      string                       `json:"runtimeSnapshotId"`
	RuntimeSnapshotVersion int                          `json:"runtimeSnapshotVersion"`
	ContentHash            string                       `json:"contentHash"`
	RuntimeState           string                       `json:"runtimeState"`
	PublishedAt            time.Time                    `json:"publishedAt"`
	PublishedBy            string                       `json:"publishedBy"`
	GatewayInstanceID      string                       `json:"gatewayInstanceId"`
	LegacyHashes           *legacyRuntimeHashesResponse `json:"legacyHashes,omitempty"`
}

type legacyRuntimeHashesResponse struct {
	ConfigHash         string `json:"configHash"`
	SecurityPolicyHash string `json:"securityPolicyHash"`
	RoutingPolicyHash  string `json:"routingPolicyHash"`
}

type requestDetailDataResponse struct {
	RequestID       string                             `json:"requestId"`
	TraceID         string                             `json:"traceId"`
	TenantID        string                             `json:"tenantId"`
	ProjectID       string                             `json:"projectId"`
	ApplicationID   *string                            `json:"applicationId"`
	BudgetScope     budgetScopeResponse                `json:"budgetScope"`
	RuntimeSnapshot *runtimeSnapshotProvenanceResponse `json:"runtimeSnapshot"`
	Status          string                             `json:"status"`
	TerminalStatus  string                             `json:"terminalStatus"`
	HTTPStatus      int                                `json:"httpStatus"`
	DomainOutcomes  domainOutcomesResponse             `json:"domainOutcomes"`
	RequestedModel  string                             `json:"requestedModel"`
	ProviderCalled  bool                               `json:"providerCalled"`
	ProviderAttempt *providerAttemptResponse           `json:"providerAttempt"`
	Usage           usageResponse                      `json:"usage"`
	UsageSummary    usageSummaryResponse               `json:"usageSummary"`
	Cost            costResponse                       `json:"cost"`
	Latency         latencyResponse                    `json:"latency"`
	LatencySummary  latencySummaryResponse             `json:"latencySummary"`
	Cache           cacheResponse                      `json:"cache"`
	Routing         routingResponse                    `json:"routing"`
	Masking         maskingResponse                    `json:"masking"`
	SafetySummary   safetySummaryResponse              `json:"safetySummary"`
	PromptCapture   promptCaptureResponse              `json:"promptCapture"`
	ResponseCapture responseCaptureResponse            `json:"responseCapture"`
	Error           detailErrorResponse                `json:"error"`
	CreatedAt       time.Time                          `json:"createdAt"`
	CompletedAt     *time.Time                         `json:"completedAt"`
}

type providerAttemptResponse struct {
	ProviderID         string  `json:"providerId"`
	ModelID            string  `json:"modelId"`
	Outcome            string  `json:"outcome"`
	LatencyMs          *int64  `json:"latencyMs"`
	SanitizedErrorCode *string `json:"sanitizedErrorCode"`
}

type outcomeResponse struct {
	Outcome           string   `json:"outcome"`
	Reason            *string  `json:"reason"`
	Code              *string  `json:"code"`
	LimitMicroUSD     *int64   `json:"limitMicroUsd,omitempty"`
	UsedMicroUSD      *int64   `json:"usedMicroUsd,omitempty"`
	RemainingMicroUSD *int64   `json:"remainingMicroUsd,omitempty"`
	UsagePercent      *float64 `json:"usagePercent,omitempty"`
}

type domainOutcomesResponse struct {
	Auth      outcomeResponse `json:"auth"`
	Runtime   outcomeResponse `json:"runtime"`
	RateLimit outcomeResponse `json:"rateLimit"`
	Budget    outcomeResponse `json:"budget"`
	Safety    outcomeResponse `json:"safety"`
	Routing   outcomeResponse `json:"routing"`
	Cache     outcomeResponse `json:"cache"`
	Provider  outcomeResponse `json:"provider"`
	Fallback  outcomeResponse `json:"fallback"`
	Streaming outcomeResponse `json:"streaming"`
	Logging   outcomeResponse `json:"logging"`
}

type usageResponse struct {
	PromptTokens     int64 `json:"promptTokens"`
	CompletionTokens int64 `json:"completionTokens"`
	TotalTokens      int64 `json:"totalTokens"`
}

type usageSummaryResponse struct {
	PromptTokens          int64 `json:"promptTokens"`
	CompletionTokens      int64 `json:"completionTokens"`
	TotalTokens           int64 `json:"totalTokens"`
	EstimatedCostMicroUSD int64 `json:"estimatedCostMicroUsd"`
	SavedCostMicroUSD     int64 `json:"savedCostMicroUsd"`
}

type costResponse struct {
	CostUSD      string `json:"costUsd"`
	CostMicroUSD int64  `json:"costMicroUsd"`
	Currency     string `json:"currency"`
}

type latencyResponse struct {
	LatencyMs         int64  `json:"latencyMs"`
	ProviderLatencyMs *int64 `json:"providerLatencyMs"`
	TTFTMs            *int64 `json:"ttftMs"`
}

type latencySummaryResponse struct {
	GatewayInternalLatencyMs int64  `json:"gatewayInternalLatencyMs"`
	ProviderLatencyMs        *int64 `json:"providerLatencyMs"`
	TotalLatencyMs           int64  `json:"totalLatencyMs"`
	TTFTMs                   *int64 `json:"ttftMs"`
}

type cacheResponse struct {
	CacheStatus         string  `json:"cacheStatus"`
	CacheOutcome        string  `json:"cacheOutcome"`
	CacheType           string  `json:"cacheType"`
	CacheKeyHash        *string `json:"cacheKeyHash"`
	CacheHitRequestID   *string `json:"cacheHitRequestId"`
	CacheDecisionReason *string `json:"cacheDecisionReason"`
	PromptCategory      *string `json:"promptCategory"`
}

type routingResponse struct {
	RoutingReason          *string `json:"routingReason"`
	RoutingRuleID          *string `json:"routingRuleId"`
	Category               *string `json:"category"`
	Difficulty             *string `json:"difficulty"`
	ModelRef               *string `json:"modelRef"`
	RoutingPolicyHash      *string `json:"routingPolicyHash"`
	RoutingDecisionKeyHash *string `json:"routingDecisionKeyHash"`
}

type maskingResponse struct {
	MaskingAction           string   `json:"maskingAction"`
	MaskingDetectedTypes    []string `json:"maskingDetectedTypes"`
	MaskingDetectedCount    int      `json:"maskingDetectedCount"`
	PolicyAllowedTypes      []string `json:"policyAllowedTypes"`
	MandatoryProtectedTypes []string `json:"mandatoryProtectedTypes"`
	RedactedPromptPreview   *string  `json:"redactedPromptPreview"`
}

type safetySummaryResponse struct {
	Outcome                 string   `json:"outcome"`
	DetectedCount           int      `json:"detectedCount"`
	DetectorCategories      []string `json:"detectorCategories"`
	PolicyAllowedTypes      []string `json:"policyAllowedTypes"`
	MandatoryProtectedTypes []string `json:"mandatoryProtectedTypes"`
	MaskingAction           string   `json:"maskingAction"`
}

type promptCaptureResponse struct {
	Enabled        bool    `json:"enabled"`
	Mode           string  `json:"mode"`
	Visibility     string  `json:"visibility"`
	CapturedPrompt *string `json:"capturedPrompt"`
	Truncated      bool    `json:"truncated"`
	MaxChars       int     `json:"maxChars"`
}

type responseCaptureResponse struct {
	Enabled          bool    `json:"enabled"`
	Mode             string  `json:"mode"`
	Visibility       string  `json:"visibility"`
	CapturedResponse *string `json:"capturedResponse"`
	Truncated        bool    `json:"truncated"`
	MaxChars         int     `json:"maxChars"`
}

type detailErrorResponse struct {
	ErrorCode    *string `json:"errorCode"`
	ErrorMessage *string `json:"errorMessage"`
	ErrorStage   *string `json:"errorStage"`
}

type requestLogListItemResponse struct {
	RequestID        string                   `json:"requestId"`
	ProjectID        string                   `json:"projectId"`
	ApplicationID    string                   `json:"applicationId"`
	BudgetScope      budgetScopeResponse      `json:"budgetScope"`
	UserRef          *string                  `json:"userRef,omitempty"`
	RequestedModel   string                   `json:"requestedModel"`
	ProviderAttempt  *providerAttemptResponse `json:"providerAttempt"`
	Category         string                   `json:"category"`
	Difficulty       string                   `json:"difficulty"`
	ModelRef         string                   `json:"modelRef"`
	Status           string                   `json:"status"`
	TerminalStatus   string                   `json:"terminalStatus"`
	DomainOutcomes   domainOutcomesResponse   `json:"domainOutcomes"`
	HTTPStatus       int                      `json:"httpStatus"`
	PromptTokens     int64                    `json:"promptTokens"`
	CompletionTokens int64                    `json:"completionTokens"`
	TotalTokens      int64                    `json:"totalTokens"`
	CostUSD          string                   `json:"costUsd"`
	CostMicroUSD     int64                    `json:"costMicroUsd"`
	LatencyMs        int64                    `json:"latencyMs"`
	TTFTMs           *int64                   `json:"ttftMs"`
	CacheStatus      string                   `json:"cacheStatus"`
	CacheType        string                   `json:"cacheType"`
	RoutingReason    string                   `json:"routingReason"`
	MaskingAction    string                   `json:"maskingAction"`
	CreatedAt        time.Time                `json:"createdAt"`
}

type paginationResponse struct {
	Limit      int     `json:"limit"`
	NextCursor *string `json:"nextCursor"`
	HasMore    bool    `json:"hasMore"`
}

func (h ProjectLogsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "invocation_log_reader_unavailable", "Invocation log reader is not configured.")
		return
	}

	filter, err := h.projectLogsFilterFromRequest(r)
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}

	items, err := h.Reader.ListProjectLogs(r.Context(), filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		if errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
			writeGatewayError(w, http.StatusServiceUnavailable, "", "ANALYTICS_DATA_UNAVAILABLE", "Request log data is unavailable.")
			return
		}
		logInvocationLogInternalError(r, "list_project_logs", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Request logs could not be loaded.")
		return
	}

	meta, err := h.projectLogsMeta(r, filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		if errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
			writeGatewayError(w, http.StatusServiceUnavailable, "", "ANALYTICS_DATA_UNAVAILABLE", "Request log filter data is unavailable.")
			return
		}
		logInvocationLogInternalError(r, "list_project_log_filter_options", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Request log filter options could not be loaded.")
		return
	}

	writeJSON(w, http.StatusOK, projectLogsResponse{
		Data:       requestLogListItemResponses(items),
		Pagination: paginationResponse{Limit: filter.Limit, NextCursor: nil, HasMore: false},
		Meta:       meta,
	})
}

func (h RequestDetailHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "invocation_log_reader_unavailable", "Invocation log reader is not configured.")
		return
	}

	filter := invocationlog.RequestDetailFilter{
		TenantID:  firstNonEmptyQueryValue(r.URL.Query().Get("tenantId"), h.TenantID),
		ProjectID: firstNonEmptyQueryValue(r.URL.Query().Get("projectId"), h.ProjectID),
		RequestID: r.PathValue("requestId"),
	}
	detail, err := h.Reader.GetRequestDetail(r.Context(), filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		if errors.Is(err, invocationlog.ErrLogNotFound) {
			writeGatewayError(w, http.StatusNotFound, "", "request_log_not_found", "Request log was not found.")
			return
		}
		logInvocationLogInternalError(r, "get_request_detail", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Request detail could not be loaded.")
		return
	}

	writeJSON(w, http.StatusOK, requestDetailResponse{Data: requestDetailData(detail)})
}

func (h DashboardOverviewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "invocation_log_reader_unavailable", "Invocation log reader is not configured.")
		return
	}

	from, err := parseRequiredRFC3339Query(r, "from")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}
	to, err := parseRequiredRFC3339Query(r, "to")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}

	filter := invocationlog.DashboardOverviewFilter{
		TenantID:    firstNonEmptyQueryValue(r.URL.Query().Get("tenantId"), h.TenantID),
		ProjectID:   r.URL.Query().Get("projectId"),
		BudgetScope: budgetScopeFromQuery(r.URL.Query()),
		From:        from,
		To:          to,
	}
	overview, err := h.Reader.GetDashboardOverview(r.Context(), filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		if errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
			writeGatewayError(w, http.StatusServiceUnavailable, "", "ANALYTICS_DATA_UNAVAILABLE", "Dashboard data is unavailable.")
			return
		}
		logInvocationLogInternalError(r, "get_dashboard_overview", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Dashboard overview could not be loaded.")
		return
	}

	writeJSON(w, http.StatusOK, dashboardOverviewResponse{
		Data: dashboardOverviewData(filter, overview),
	})
}

func (h AnalyticsPerformanceHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "invocation_log_reader_unavailable", "Invocation log reader is not configured.")
		return
	}

	from, err := parseRequiredRFC3339Query(r, "from")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}
	to, err := parseRequiredRFC3339Query(r, "to")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}

	query := r.URL.Query()
	includeTenantChat, err := parseOptionalBoolQuery(r, "includeTenantChat")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}
	filter := invocationlog.AnalyticsPerformanceFilter{
		TenantID:          firstNonEmptyQueryValue(query.Get("tenantId"), h.TenantID),
		ProjectID:         query.Get("projectId"),
		Provider:          query.Get("provider"),
		Model:             query.Get("model"),
		IncludeTenantChat: includeTenantChat,
		From:              from,
		To:                to,
	}
	performance, err := h.Reader.GetAnalyticsPerformance(r.Context(), filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		logInvocationLogInternalError(r, "get_analytics_performance", filter.TenantID, filter.ProjectID, err)
		if errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
			writeGatewayError(w, http.StatusServiceUnavailable, "", "ANALYTICS_DATA_UNAVAILABLE", "Analytics performance data is unavailable.")
			return
		}
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Analytics performance could not be loaded.")
		return
	}

	writeJSON(w, http.StatusOK, analyticsPerformanceResponse{
		Data: analyticsPerformanceData(filter, performance),
	})
}

func (h ProjectLogsHandler) projectLogsFilterFromRequest(r *http.Request) (invocationlog.ProjectLogsFilter, error) {
	from, err := parseRequiredRFC3339Query(r, "from")
	if err != nil {
		return invocationlog.ProjectLogsFilter{}, err
	}
	to, err := parseRequiredRFC3339Query(r, "to")
	if err != nil {
		return invocationlog.ProjectLogsFilter{}, err
	}
	limit, err := parseOptionalPositiveIntQuery(r, "limit")
	if err != nil {
		return invocationlog.ProjectLogsFilter{}, err
	}

	query := r.URL.Query()
	return invocationlog.ProjectLogsFilter{
		TenantID:       firstNonEmptyQueryValue(query.Get("tenantId"), h.TenantID),
		ProjectID:      r.PathValue("projectId"),
		From:           from,
		To:             to,
		Status:         query.Get("status"),
		Provider:       query.Get("provider"),
		RequestedModel: query.Get("requestedModel"),
		CacheStatus:    query.Get("cacheStatus"),
		ApplicationID:  query.Get("applicationId"),
		BudgetScope:    budgetScopeFromQuery(query),
		RequestID:      query.Get("requestId"),
		Limit:          limit,
	}, nil
}

func (h ProjectLogsHandler) projectLogsMeta(r *http.Request, filter invocationlog.ProjectLogsFilter) (*projectLogsMetaResponse, error) {
	if !includeProjectLogFilterOptions(r) {
		return nil, nil
	}

	optionsReader, ok := h.Reader.(ProjectLogFilterOptionsReader)
	if !ok {
		return &projectLogsMetaResponse{
			FilterOptions: requestLogFilterOptionsResponse{
				RequestedModels: []string{},
				BudgetScopes:    []budgetScopeResponse{},
			},
		}, nil
	}

	options, err := optionsReader.ListProjectLogFilterOptions(r.Context(), filter)
	if err != nil {
		return nil, err
	}

	return &projectLogsMetaResponse{
		FilterOptions: requestLogFilterOptionsResponseFromDomain(options),
	}, nil
}

func includeProjectLogFilterOptions(r *http.Request) bool {
	value := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("includeFilterOptions")))
	return value == "true" || value == "1"
}

func firstNonEmptyQueryValue(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func dashboardOverviewData(filter invocationlog.DashboardOverviewFilter, overview invocationlog.DashboardOverviewFields) dashboardOverviewDataResponse {
	return dashboardOverviewDataResponse{
		GeneratedAt: overview.DataFreshness.GeneratedAt,
		TimeRange: dashboardTimeRangeResponse{
			From:        filter.From,
			To:          filter.To,
			Granularity: dashboardGranularity(filter.From, filter.To),
		},
		Freshness: dashboardFreshnessResponse{
			LastIngestedAt:   dashboardLastIngestedAt(overview.DataFreshness),
			LastAggregatedAt: dashboardLastAggregatedAt(overview.DataFreshness),
			Source:           overview.DataFreshness.Source,
			IsStale:          overview.DataFreshness.IsStale,
		},
		QueryBudget: dashboardQueryBudgetResponse{
			Status:            overview.QueryBudget.Status,
			MaxRangeHours:     overview.QueryBudget.MaxRangeHours,
			MaxBreakdownItems: overview.QueryBudget.MaxBreakdownItems,
			Guidance:          stringPointerOrNil(overview.QueryBudget.Guidance),
		},
		Breakdowns: dashboardBreakdowns(overview),
		Performance: dashboardPerformanceResponse{
			P95GatewayInternalLatencyMs: overview.Performance.P95GatewayInternalLatencyMs,
			P99GatewayInternalLatencyMs: overview.Performance.P99GatewayInternalLatencyMs,
			P95ProviderLatencyMs:        overview.Performance.P95ProviderLatencyMs,
			P99ProviderLatencyMs:        overview.Performance.P99ProviderLatencyMs,
			SystemErrorRate:             overview.Performance.SystemErrorRate,
			GatewayTTFT: dashboardGatewayTTFTResponse{
				Scope:                  overview.Performance.GatewayTTFT.Scope,
				AverageMs:              overview.Performance.GatewayTTFT.AverageMs,
				P50Ms:                  overview.Performance.GatewayTTFT.P50Ms,
				P95Ms:                  overview.Performance.GatewayTTFT.P95Ms,
				P99Ms:                  overview.Performance.GatewayTTFT.P99Ms,
				EligibleStreamRequests: overview.Performance.GatewayTTFT.EligibleStreamRequests,
				ObservedRequests:       overview.Performance.GatewayTTFT.ObservedRequests,
				CoverageRate:           overview.Performance.GatewayTTFT.CoverageRate,
			},
		},
		Range: dashboardRangeResponse{
			From: filter.From,
			To:   filter.To,
		},
		Filter: dashboardFilterResponse{
			TenantID:        filter.TenantID,
			ProjectID:       stringPointerOrNil(filter.ProjectID),
			BudgetScopeType: stringPointerOrNil(filter.BudgetScope.Type),
			BudgetScopeID:   stringPointerOrNil(filter.BudgetScope.ID),
			ResolvedBy:      stringPointerOrNil(filter.BudgetScope.ResolvedBy),
		},
		Totals: dashboardTotalsResponse{
			TotalRequests:         overview.TotalRequests,
			SuccessfulRequests:    overview.SuccessfulRequests,
			FailedRequests:        overview.FailedRequests,
			BlockedRequests:       overview.BlockedRequests,
			RateLimitedRequests:   overview.RateLimitedRequests,
			CancelledRequests:     overview.CancelledRequests,
			CacheHitRequests:      overview.CacheHitRequests,
			CacheEligibleRequests: overview.CacheEligibleRequests,
			CacheHitRate:          overview.CacheHitRate,
			ExactCacheHitRate:     overview.CacheHitRate,
			FallbackSuccessCount:  overview.FallbackSuccessCount,
			PromptTokens:          overview.PromptTokens,
			CompletionTokens:      overview.CompletionTokens,
			TotalTokens:           overview.TotalTokens,
			TotalCostMicroUSD:     overview.TotalCostMicroUSD,
			TotalCostUSD:          overview.TotalCostUSD,
			SavedCostMicroUSD:     overview.SavedCostMicroUSD,
			SavedCostUSD:          overview.SavedCostUSD,
			AverageLatencyMs:      overview.AverageLatencyMs,
			P95LatencyMs:          overview.P95LatencyMs,
			AverageResponseTimeMs: overview.AverageResponseTimeMs,
			MaskingActionCounts:   copyInt64Map(overview.MaskingActionCounts),
			RoutingCountByModel:   routingCountByModelResponses(overview.RoutingCountByModel),
			StatusCounts:          copyInt64Map(overview.StatusCounts),
			BudgetOutcomeCounts:   copyInt64Map(overview.BudgetOutcomeCounts),
			CostByProject:         projectBreakdownResponses(overview.ProjectBreakdown),
			CostByModel:           costByModelResponses(overview.CostByModel),
			CostByBudgetScope:     budgetScopeBreakdownResponses(overview.BudgetScopeBreakdown),
			BudgetScopeBreakdown:  budgetScopeBreakdownResponses(overview.BudgetScopeBreakdown),
		},
		DataFreshness: dashboardDataFreshnessResponse{
			Source:           overview.DataFreshness.Source,
			RecordCount:      overview.DataFreshness.RecordCount,
			LastLogCreatedAt: overview.DataFreshness.LastLogCreatedAt,
			GeneratedAt:      overview.DataFreshness.GeneratedAt,
		},
	}
}

func analyticsPerformanceData(filter invocationlog.AnalyticsPerformanceFilter, performance invocationlog.AnalyticsPerformanceFields) analyticsPerformanceDataResponse {
	return analyticsPerformanceDataResponse{
		Summary: analyticsPerformanceSummaryResponse{
			AvgLatencyMs:        performance.Summary.AvgLatencyMs,
			P95LatencyMs:        performance.Summary.P95LatencyMs,
			P99LatencyMs:        performance.Summary.P99LatencyMs,
			ThroughputPerMinute: performance.Summary.ThroughputPerMinute,
			ErrorRate:           performance.Summary.ErrorRate,
			SystemErrorRequests: performance.Summary.SystemErrorRequests,
			TotalRequests:       performance.Summary.TotalRequests,
		},
		SurfaceSummaries:         analyticsSurfaceSummaryResponses(performance.SurfaceSummaries),
		ProviderModelPerformance: analyticsProviderModelPerformanceResponses(performance.ProviderModelPerformance),
		P95LatencyByProvider:     analyticsProviderLatencyResponses(performance.P95LatencyByProvider),
		LatencyDistribution:      analyticsLatencyDistributionResponses(filter, performance.LatencyDistribution),
		SlowestRequests:          analyticsSlowRequestResponses(performance.SlowestRequests),
		BucketInterval:           performance.BucketInterval,
		ExpectedBucketCount:      performance.ExpectedBucketCount,
		Range: dashboardRangeResponse{
			From: filter.From,
			To:   filter.To,
		},
		Filter: analyticsPerformanceFilterResponse{
			TenantID:          filter.TenantID,
			ProjectID:         stringPointerOrNil(filter.ProjectID),
			Provider:          stringPointerOrNil(filter.Provider),
			Model:             stringPointerOrNil(filter.Model),
			IncludeTenantChat: filter.IncludeTenantChat,
		},
		DataFreshness: dashboardDataFreshnessResponse{
			Source:           performance.DataFreshness.Source,
			RecordCount:      performance.DataFreshness.RecordCount,
			LastLogCreatedAt: performance.DataFreshness.LastLogCreatedAt,
			GeneratedAt:      performance.DataFreshness.GeneratedAt,
		},
	}
}

func requestDetailData(detail invocationlog.RequestDetail) requestDetailDataResponse {
	return requestDetailDataResponse{
		RequestID:       detail.RequestID,
		TraceID:         detail.TraceID,
		TenantID:        detail.TenantID,
		ProjectID:       detail.ProjectID,
		ApplicationID:   stringPointerOrNil(detail.ApplicationID),
		BudgetScope:     budgetScopeResponseFromScope(detail.BudgetScope, detail.ApplicationID),
		RuntimeSnapshot: runtimeSnapshotResponse(detail.RuntimeSnapshot),
		Status:          detail.Status,
		TerminalStatus:  detail.TerminalStatus,
		HTTPStatus:      detail.HTTPStatus,
		DomainOutcomes:  domainOutcomesResponseFromDomain(detail.DomainOutcomes),
		RequestedModel:  detail.RequestedModel,
		ProviderCalled:  detail.ProviderCalled,
		ProviderAttempt: providerAttemptResponseFromDomain(detail.ProviderAttempt),
		Usage: usageResponse{
			PromptTokens:     detail.Usage.PromptTokens,
			CompletionTokens: detail.Usage.CompletionTokens,
			TotalTokens:      detail.Usage.TotalTokens,
		},
		UsageSummary: usageSummaryResponse{
			PromptTokens:          detail.UsageSummary.PromptTokens,
			CompletionTokens:      detail.UsageSummary.CompletionTokens,
			TotalTokens:           detail.UsageSummary.TotalTokens,
			EstimatedCostMicroUSD: detail.UsageSummary.EstimatedCostMicroUSD,
			SavedCostMicroUSD:     detail.UsageSummary.SavedCostMicroUSD,
		},
		Cost: costResponse{
			CostUSD:      detail.Cost.CostUSD,
			CostMicroUSD: detail.Cost.CostMicroUSD,
			Currency:     detail.Cost.Currency,
		},
		Latency: latencyResponse{
			LatencyMs:         detail.Latency.LatencyMs,
			ProviderLatencyMs: detail.Latency.ProviderLatencyMs,
			TTFTMs:            detail.Latency.TTFTMs,
		},
		LatencySummary: latencySummaryResponse{
			GatewayInternalLatencyMs: detail.LatencySummary.GatewayInternalLatencyMs,
			ProviderLatencyMs:        detail.LatencySummary.ProviderLatencyMs,
			TotalLatencyMs:           detail.LatencySummary.TotalLatencyMs,
			TTFTMs:                   detail.LatencySummary.TTFTMs,
		},
		Cache: cacheResponse{
			CacheStatus:         detail.Cache.CacheStatus,
			CacheOutcome:        detail.Cache.CacheOutcome,
			CacheType:           detail.Cache.CacheType,
			CacheKeyHash:        stringPointerOrNil(detail.Cache.CacheKeyHash),
			CacheHitRequestID:   stringPointerOrNil(detail.Cache.CacheHitRequestID),
			CacheDecisionReason: stringPointerOrNil(detail.Cache.CacheDecisionReason),
			PromptCategory:      stringPointerOrNil(detail.Cache.PromptCategory),
		},
		Routing: routingResponse{
			RoutingReason:          stringPointerOrNil(detail.Routing.RoutingReason),
			RoutingRuleID:          stringPointerOrNil(detail.Routing.RoutingRuleID),
			Category:               stringPointerOrNil(detail.Routing.Category),
			Difficulty:             stringPointerOrNil(detail.Routing.Difficulty),
			ModelRef:               stringPointerOrNil(detail.Routing.ModelRef),
			RoutingPolicyHash:      stringPointerOrNil(detail.Routing.RoutingPolicyHash),
			RoutingDecisionKeyHash: stringPointerOrNil(detail.Routing.RoutingDecisionKeyHash),
		},
		Masking: maskingResponse{
			MaskingAction:           detail.Masking.MaskingAction,
			MaskingDetectedTypes:    append([]string(nil), detail.Masking.MaskingDetectedTypes...),
			MaskingDetectedCount:    detail.Masking.MaskingDetectedCount,
			PolicyAllowedTypes:      append([]string(nil), detail.Masking.PolicyAllowedTypes...),
			MandatoryProtectedTypes: append([]string(nil), detail.Masking.MandatoryProtectedTypes...),
			RedactedPromptPreview:   stringPointerOrNil(detail.Masking.RedactedPromptPreview),
		},
		SafetySummary: safetySummaryResponse{
			Outcome:                 detail.SafetySummary.Outcome,
			DetectedCount:           detail.SafetySummary.DetectedCount,
			DetectorCategories:      append([]string(nil), detail.SafetySummary.DetectorCategories...),
			PolicyAllowedTypes:      append([]string(nil), detail.SafetySummary.PolicyAllowedTypes...),
			MandatoryProtectedTypes: append([]string(nil), detail.SafetySummary.MandatoryProtectedTypes...),
			MaskingAction:           detail.SafetySummary.MaskingAction,
		},
		PromptCapture:   promptCaptureResponseFromDomain(detail.PromptCapture),
		ResponseCapture: responseCaptureResponseFromDomain(detail.ResponseCapture),
		Error: detailErrorResponse{
			ErrorCode:    stringPointerOrNil(detail.Error.ErrorCode),
			ErrorMessage: stringPointerOrNil(detail.Error.ErrorMessage),
			ErrorStage:   stringPointerOrNil(detail.Error.ErrorStage),
		},
		CreatedAt:   detail.CreatedAt,
		CompletedAt: detail.CompletedAt,
	}
}

func providerAttemptResponseFromDomain(attempt *invocationlog.ProviderAttemptFields) *providerAttemptResponse {
	if attempt == nil {
		return nil
	}
	return &providerAttemptResponse{
		ProviderID:         attempt.ProviderID,
		ModelID:            attempt.ModelID,
		Outcome:            attempt.Outcome,
		LatencyMs:          attempt.LatencyMs,
		SanitizedErrorCode: attempt.SanitizedErrorCode,
	}
}

func analyticsSurfaceSummaryResponses(items []invocationlog.AnalyticsSurfaceSummary) []analyticsSurfaceSummaryResponse {
	responses := make([]analyticsSurfaceSummaryResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, analyticsSurfaceSummaryResponse{
			Surface:     item.Surface,
			LastEventAt: item.LastEventAt,
			analyticsPerformanceSummaryResponse: analyticsPerformanceSummaryResponse{
				AvgLatencyMs:        item.Summary.AvgLatencyMs,
				P95LatencyMs:        item.Summary.P95LatencyMs,
				P99LatencyMs:        item.Summary.P99LatencyMs,
				ThroughputPerMinute: item.Summary.ThroughputPerMinute,
				ErrorRate:           item.Summary.ErrorRate,
				SystemErrorRequests: item.Summary.SystemErrorRequests,
				TotalRequests:       item.Summary.TotalRequests,
			},
		})
	}
	return responses
}

func analyticsProviderModelPerformanceResponses(items []invocationlog.AnalyticsProviderModelPerformance) []analyticsProviderModelPerformanceResponse {
	responses := make([]analyticsProviderModelPerformanceResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, analyticsProviderModelPerformanceResponse{
			Surface:           item.Surface,
			Provider:          item.Provider,
			Model:             item.Model,
			Requests:          item.Requests,
			AvgLatencyMs:      item.AvgLatencyMs,
			P95LatencyMs:      item.P95LatencyMs,
			P99LatencyMs:      item.P99LatencyMs,
			ErrorRate:         item.ErrorRate,
			CostPerRequestUSD: item.CostPerRequestUSD,
			TotalCostMicroUSD: item.TotalCostMicroUSD,
			TotalCostUSD:      item.TotalCostUSD,
			CacheHitRate:      item.CacheHitRate,
		})
	}
	return responses
}

func analyticsProviderLatencyResponses(items []invocationlog.AnalyticsProviderLatency) []analyticsProviderLatencyResponse {
	responses := make([]analyticsProviderLatencyResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, analyticsProviderLatencyResponse{
			Surface:      item.Surface,
			Provider:     item.Provider,
			P95LatencyMs: item.P95LatencyMs,
			Requests:     item.Requests,
		})
	}
	return responses
}

func analyticsLatencyDistributionResponses(filter invocationlog.AnalyticsPerformanceFilter, items []invocationlog.AnalyticsLatencyDistributionBucket) []analyticsLatencyDistributionBucketResponse {
	responses := make([]analyticsLatencyDistributionBucketResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, analyticsLatencyDistributionBucketResponse{
			Surface:      item.Surface,
			Bucket:       item.Bucket,
			Label:        analyticsBucketLabel(filter.From, filter.To, item.Bucket),
			P50LatencyMs: item.P50LatencyMs,
			P95LatencyMs: item.P95LatencyMs,
			P99LatencyMs: item.P99LatencyMs,
			Requests:     item.Requests,
		})
	}
	return responses
}

func analyticsSlowRequestResponses(items []invocationlog.AnalyticsSlowRequest) []analyticsSlowRequestResponse {
	responses := make([]analyticsSlowRequestResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, analyticsSlowRequestResponse{
			Surface:    item.Surface,
			RequestID:  item.RequestID,
			Timestamp:  item.CreatedAt,
			ProjectID:  stringPointerOrNil(item.ProjectID),
			Provider:   item.Provider,
			Model:      item.Model,
			LatencyMs:  item.LatencyMs,
			StatusCode: intPointerOrNil(item.HTTPStatus),
			Status:     item.TerminalStatus,
		})
	}
	return responses
}

func analyticsBucketLabel(from time.Time, to time.Time, bucket time.Time) string {
	duration := to.Sub(from)
	if duration <= time.Hour {
		return bucket.UTC().Format("15:04")
	}
	if duration <= 48*time.Hour {
		return bucket.UTC().Format("15:00")
	}
	return bucket.UTC().Format("Jan 2")
}

func requestLogListItemResponses(items []invocationlog.RequestLogListItem) []requestLogListItemResponse {
	responses := make([]requestLogListItemResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, requestLogListItemResponse{
			RequestID:        item.RequestID,
			ProjectID:        item.ProjectID,
			ApplicationID:    item.ApplicationID,
			BudgetScope:      budgetScopeResponseFromScope(item.BudgetScope, item.ApplicationID),
			UserRef:          stringPointerOrNil(item.UserRef),
			RequestedModel:   item.RequestedModel,
			ProviderAttempt:  providerAttemptResponseFromDomain(item.ProviderAttempt),
			Category:         item.Category,
			Difficulty:       item.Difficulty,
			ModelRef:         item.ModelRef,
			Status:           item.Status,
			TerminalStatus:   item.TerminalStatus,
			DomainOutcomes:   domainOutcomesResponseFromDomain(item.DomainOutcomes),
			HTTPStatus:       item.HTTPStatus,
			PromptTokens:     item.PromptTokens,
			CompletionTokens: item.CompletionTokens,
			TotalTokens:      item.TotalTokens,
			CostUSD:          item.CostUSD,
			CostMicroUSD:     item.CostMicroUSD,
			LatencyMs:        item.LatencyMs,
			TTFTMs:           item.TTFTMs,
			CacheStatus:      item.CacheStatus,
			CacheType:        item.CacheType,
			RoutingReason:    item.RoutingReason,
			MaskingAction:    item.MaskingAction,
			CreatedAt:        item.CreatedAt,
		})
	}
	return responses
}

func requestLogFilterOptionsResponseFromDomain(options invocationlog.RequestLogFilterOptions) requestLogFilterOptionsResponse {
	requestedModels := append(make([]string, 0, len(options.RequestedModels)), options.RequestedModels...)
	budgetScopes := make([]budgetScopeResponse, 0, len(options.BudgetScopes))
	for _, scope := range options.BudgetScopes {
		response := budgetScopeResponseFromScope(scope, "")
		if response.BudgetScopeID == "" {
			continue
		}
		budgetScopes = append(budgetScopes, response)
	}
	return requestLogFilterOptionsResponse{
		RequestedModels: requestedModels,
		BudgetScopes:    budgetScopes,
	}
}

func domainOutcomesResponseFromDomain(outcomes invocationlog.DomainOutcomes) domainOutcomesResponse {
	normalized := invocationlog.NormalizeDomainOutcomes(invocationlog.LlmInvocationLog{DomainOutcomes: outcomes})
	return domainOutcomesResponse{
		Auth:      outcomeResponseWithCode(normalized.Auth.Outcome, normalized.Auth.ErrorCode),
		Runtime:   outcomeResponseFromOutcome(normalized.Runtime.Outcome),
		RateLimit: outcomeResponseFromOutcome(normalized.RateLimit.Outcome),
		Budget:    outcomeResponseWithBudget(normalized.Budget),
		Safety:    outcomeResponseFromOutcome(normalized.Safety.Outcome),
		Routing:   outcomeResponseFromOutcome(normalized.Routing.Outcome),
		Cache:     outcomeResponseFromOutcome(normalized.Cache.Outcome),
		Provider:  outcomeResponseWithCode(normalized.Provider.Outcome, normalized.Provider.SanitizedErrorCode),
		Fallback:  outcomeResponseWithReason(normalized.Fallback.Outcome, normalized.Fallback.Reason),
		Streaming: outcomeResponseFromOutcome(normalized.Streaming.Outcome),
		Logging:   outcomeResponseWithCode(normalized.Logging.Outcome, normalized.Logging.SanitizedErrorCode),
	}
}

func outcomeResponseFromOutcome(outcome string) outcomeResponse {
	return outcomeResponse{
		Outcome: outcome,
	}
}

func outcomeResponseWithCode(outcome string, code *string) outcomeResponse {
	return outcomeResponse{
		Outcome: outcome,
		Code:    code,
	}
}

func outcomeResponseWithReason(outcome string, reason *string) outcomeResponse {
	return outcomeResponse{
		Outcome: outcome,
		Reason:  reason,
	}
}

func outcomeResponseWithBudget(outcome invocationlog.BudgetOutcome) outcomeResponse {
	return outcomeResponse{
		Outcome:           outcome.Outcome,
		Reason:            outcome.Reason,
		LimitMicroUSD:     outcome.LimitMicroUSD,
		UsedMicroUSD:      outcome.UsedMicroUSD,
		RemainingMicroUSD: outcome.RemainingMicroUSD,
		UsagePercent:      outcome.UsagePercent,
	}
}
func dashboardBreakdowns(overview invocationlog.DashboardOverviewFields) dashboardBreakdownsResponse {
	return dashboardBreakdownsResponse{
		ByProject:         projectBreakdownResponses(overview.ProjectBreakdown),
		ByApplication:     applicationBreakdownResponses(overview.ApplicationBreakdown),
		ByBudgetScope:     budgetScopeBreakdownResponses(overview.BudgetScopeBreakdown),
		ByProviderModel:   providerModelBreakdownResponses(overview.CostByModel, overview.Performance.P95ProviderLatencyMs),
		BySafetyOutcome:   outcomeBreakdownResponses(overview.SafetyOutcomeCounts),
		ByCacheOutcome:    outcomeBreakdownResponses(overview.CacheOutcomeCounts),
		ByFallbackOutcome: outcomeBreakdownResponses(overview.FallbackOutcomeCounts),
		ByBudgetOutcome:   outcomeBreakdownResponses(overview.BudgetOutcomeCounts),
		ByTerminalStatus:  outcomeBreakdownResponses(overview.StatusCounts),
	}
}

func projectBreakdownResponses(items []invocationlog.ProjectBreakdown) []projectBreakdownResponse {
	responses := make([]projectBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, projectBreakdownResponse{
			ProjectID:        item.ProjectID,
			RequestCount:     item.RequestCount,
			PromptTokens:     item.PromptTokens,
			CompletionTokens: item.CompletionTokens,
			TotalTokens:      item.TotalTokens,
			CostMicroUSD:     item.CostMicroUSD,
			CostUSD:          item.CostUSD,
		})
	}
	return responses
}

func applicationBreakdownResponses(items []invocationlog.ApplicationBreakdown) []applicationBreakdownResponse {
	responses := make([]applicationBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, applicationBreakdownResponse{
			ApplicationID: item.ApplicationID,
			RequestCount:  item.RequestCount,
			CostMicroUSD:  item.CostMicroUSD,
		})
	}
	return responses
}

func providerModelBreakdownResponses(items []invocationlog.CostByModel, p95ProviderLatencyMs *float64) []providerModelBreakdownResponse {
	p95 := 0.0
	if p95ProviderLatencyMs != nil {
		p95 = *p95ProviderLatencyMs
	}
	responses := make([]providerModelBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, providerModelBreakdownResponse{
			Provider:             item.Provider,
			Model:                item.Model,
			RequestCount:         item.RequestCount,
			P95ProviderLatencyMs: p95,
		})
	}
	return responses
}

func outcomeBreakdownResponses(counts map[string]int64) []outcomeBreakdownResponse {
	responses := make([]outcomeBreakdownResponse, 0, len(counts))
	for outcome, count := range counts {
		responses = append(responses, outcomeBreakdownResponse{
			Outcome:      outcome,
			RequestCount: count,
		})
	}
	sort.Slice(responses, func(i int, j int) bool {
		return responses[i].Outcome < responses[j].Outcome
	})
	return responses
}

func dashboardLastIngestedAt(freshness invocationlog.DashboardDataFreshness) time.Time {
	if freshness.LastLogCreatedAt != nil {
		return *freshness.LastLogCreatedAt
	}
	return freshness.GeneratedAt
}

func dashboardLastAggregatedAt(freshness invocationlog.DashboardDataFreshness) time.Time {
	if !freshness.LastAggregatedAt.IsZero() {
		return freshness.LastAggregatedAt
	}
	return freshness.GeneratedAt
}

func dashboardGranularity(from time.Time, to time.Time) string {
	if to.Sub(from) > 48*time.Hour {
		return "day"
	}
	if to.Sub(from) > 6*time.Hour {
		return "hour"
	}
	return "minute"
}

func budgetScopeFromQuery(query map[string][]string) budget.Scope {
	values := func(name string) string {
		if len(query[name]) == 0 {
			return ""
		}
		return query[name][0]
	}
	return budget.Scope{
		Type:       values("budgetScopeType"),
		ID:         values("budgetScopeId"),
		ResolvedBy: values("resolvedBy"),
	}
}

func routingCountByModelResponses(items []invocationlog.RoutingCountByModel) []routingCountByModelResponse {
	responses := make([]routingCountByModelResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, routingCountByModelResponse{
			Category:      item.Category,
			Difficulty:    item.Difficulty,
			RoutingReason: item.RoutingReason,
			RequestCount:  item.RequestCount,
		})
	}
	return responses
}

func costByModelResponses(items []invocationlog.CostByModel) []costByModelResponse {
	responses := make([]costByModelResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, costByModelResponse{
			Provider:     item.Provider,
			Model:        item.Model,
			RequestCount: item.RequestCount,
			TotalTokens:  item.TotalTokens,
			CostMicroUSD: item.CostMicroUSD,
			CostUSD:      item.CostUSD,
		})
	}
	return responses
}

func budgetScopeBreakdownResponses(items []invocationlog.BudgetScopeBreakdown) []budgetScopeBreakdownResponse {
	responses := make([]budgetScopeBreakdownResponse, 0, len(items))
	for _, item := range items {
		scope := budgetScopeResponseFromScope(item.BudgetScope, "")
		if scope.BudgetScopeID == "" {
			continue
		}
		responses = append(responses, budgetScopeBreakdownResponse{
			BudgetScopeType: scope.BudgetScopeType,
			BudgetScopeID:   scope.BudgetScopeID,
			ResolvedBy:      scope.ResolvedBy,
			RequestCount:    item.RequestCount,
			CostMicroUSD:    item.CostMicroUSD,
			CostUSD:         item.CostUSD,
		})
	}
	return responses
}

func budgetScopeResponseFromScope(scope budget.Scope, applicationID string) budgetScopeResponse {
	normalized := budget.NormalizeScope(scope, applicationID)
	return budgetScopeResponse{
		BudgetScopeType: normalized.Type,
		BudgetScopeID:   normalized.ID,
		ResolvedBy:      normalized.ResolvedBy,
	}
}

func runtimeSnapshotResponse(snapshot *runtimeconfig.RuntimeSnapshotProvenance) *runtimeSnapshotProvenanceResponse {
	if snapshot == nil || snapshot.IsZero() {
		return nil
	}
	normalized := snapshot.Normalize(runtimeconfig.ActiveConfig{}, time.Time{}, runtimeconfig.DefaultGatewayInstanceIDCompat)
	response := &runtimeSnapshotProvenanceResponse{
		RuntimeSnapshotID:      normalized.RuntimeSnapshotID,
		RuntimeSnapshotVersion: normalized.RuntimeSnapshotVersion,
		ContentHash:            normalized.ContentHash,
		RuntimeState:           normalized.RuntimeState,
		PublishedAt:            normalized.PublishedAt,
		PublishedBy:            normalized.PublishedBy,
		GatewayInstanceID:      normalized.GatewayInstanceID,
	}
	if !normalized.LegacyHashes.IsZero() {
		response.LegacyHashes = &legacyRuntimeHashesResponse{
			ConfigHash:         normalized.LegacyHashes.ConfigHash,
			SecurityPolicyHash: normalized.LegacyHashes.SecurityPolicyHash,
			RoutingPolicyHash:  normalized.LegacyHashes.RoutingPolicyHash,
		}
	}
	return response
}

func promptCaptureResponseFromDomain(fields invocationlog.PromptCaptureFields) promptCaptureResponse {
	if strings.TrimSpace(fields.Mode) == "" {
		fields.Mode = runtimeconfig.PromptCaptureModeDisabled
	}
	if strings.TrimSpace(fields.Visibility) == "" {
		fields.Visibility = invocationlog.PromptCaptureVisibilityAdminRequestDetail
	}
	if fields.MaxChars <= 0 {
		fields.MaxChars = runtimeconfig.PromptCaptureDefaultMaxChars
	}
	var capturedPrompt *string
	if fields.Enabled && strings.TrimSpace(fields.CapturedPrompt) != "" {
		capturedPrompt = stringPointerOrNil(fields.CapturedPrompt)
	}
	return promptCaptureResponse{
		Enabled:        fields.Enabled,
		Mode:           fields.Mode,
		Visibility:     fields.Visibility,
		CapturedPrompt: capturedPrompt,
		Truncated:      fields.Truncated,
		MaxChars:       fields.MaxChars,
	}
}

func responseCaptureResponseFromDomain(fields invocationlog.ResponseCaptureFields) responseCaptureResponse {
	if strings.TrimSpace(fields.Mode) == "" {
		fields.Mode = runtimeconfig.ResponseCaptureModeDisabled
	}
	if strings.TrimSpace(fields.Visibility) == "" {
		fields.Visibility = invocationlog.ResponseCaptureVisibilityAdminRequestDetail
	}
	if fields.MaxChars <= 0 {
		fields.MaxChars = runtimeconfig.ResponseCaptureDefaultMaxChars
	}
	return responseCaptureResponse{
		Enabled:          fields.Enabled,
		Mode:             fields.Mode,
		Visibility:       fields.Visibility,
		CapturedResponse: nil,
		Truncated:        fields.Truncated,
		MaxChars:         fields.MaxChars,
	}
}

func copyInt64Map(values map[string]int64) map[string]int64 {
	if values == nil {
		return map[string]int64{}
	}
	copied := make(map[string]int64, len(values))
	for key, value := range values {
		copied[key] = value
	}
	return copied
}

func stringPointerOrNil(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func intPointerOrNil(value int) *int {
	if value == 0 {
		return nil
	}
	return &value
}

func logInvocationLogInternalError(r *http.Request, stage string, tenantID string, projectID string, err error) {
	if err == nil {
		return
	}

	slog.ErrorContext(r.Context(), "invocation log query failed",
		"request_id", invocationLogRequestID(r),
		"stage", sanitizeInvocationLogField(stage),
		"error_code", "internal_error",
		"tenant_id", sanitizeInvocationLogField(tenantID),
		"project_id", sanitizeInvocationLogField(projectID),
		"error_type", sanitizeInvocationLogField(fmt.Sprintf("%T", err)),
		"error", sanitizeInvocationLogError(err),
	)
}

func invocationLogRequestID(r *http.Request) string {
	if r == nil {
		return ""
	}
	return middleware.NormalizeRequestID(r.Header.Get(middleware.RequestIDHeader))
}

func sanitizeInvocationLogError(err error) string {
	if err == nil {
		return ""
	}

	value := normalizeInvocationLogText(err.Error())
	for _, pattern := range invocationLogSecretPatterns {
		value = pattern.ReplaceAllString(value, "[REDACTED]")
	}
	return truncateInvocationLogText(value, invocationLogInternalErrorMaxLen)
}

func sanitizeInvocationLogField(value string) string {
	return truncateInvocationLogText(normalizeInvocationLogText(value), invocationLogLogFieldMaxLen)
}

func normalizeInvocationLogText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func truncateInvocationLogText(value string, maxLen int) string {
	if maxLen <= 0 || len(value) <= maxLen {
		return value
	}
	return value[:maxLen] + "...truncated"
}

func parseRequiredRFC3339Query(r *http.Request, name string) (time.Time, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return time.Time{}, errors.New(name + " is required")
	}
	parsed, err := parseRFC3339QueryValue(value)
	if err != nil {
		return time.Time{}, errors.New(name + " must be RFC3339")
	}
	return parsed, nil
}

func parseRFC3339QueryValue(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err == nil {
		return parsed, nil
	}

	restored, ok := restoreDecodedPlusTimezoneOffset(value)
	if !ok {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339Nano, restored)
}

func restoreDecodedPlusTimezoneOffset(value string) (string, bool) {
	if strings.Contains(value, "+") {
		return "", false
	}

	lastSpace := strings.LastIndex(value, " ")
	if lastSpace <= len("2006-01-02T15:04:05")-1 {
		return "", false
	}

	offset := value[lastSpace+1:]
	if !isHHMMOffset(offset) {
		return "", false
	}

	return value[:lastSpace] + "+" + offset, true
}

func isHHMMOffset(value string) bool {
	if len(value) != len("09:00") || value[2] != ':' {
		return false
	}
	for _, index := range []int{0, 1, 3, 4} {
		if value[index] < '0' || value[index] > '9' {
			return false
		}
	}
	return true
}

func parseOptionalPositiveIntQuery(r *http.Request, name string) (int, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, errors.New(name + " must be a positive integer")
	}
	return parsed, nil
}

func parseOptionalBoolQuery(r *http.Request, name string) (bool, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	switch value {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, errors.New(name + " must be true or false")
	}
}
