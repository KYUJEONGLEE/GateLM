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

type RequestDetailReader interface {
	GetRequestDetail(ctx context.Context, filter invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error)
}

type DashboardOverviewReader interface {
	GetDashboardOverview(ctx context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error)
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

type projectLogsResponse struct {
	Data       []requestLogListItemResponse `json:"data"`
	Pagination paginationResponse           `json:"pagination"`
}

type requestDetailResponse struct {
	Data requestDetailDataResponse `json:"data"`
}

type dashboardOverviewResponse struct {
	Data dashboardOverviewDataResponse `json:"data"`
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
	RoutingCountByModel   []routingCountByModelResponse  `json:"routingCountByModel"`
	StatusCounts          map[string]int64               `json:"statusCounts"`
	CostByModel           []costByModelResponse          `json:"costByModel"`
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
	P95GatewayInternalLatencyMs *float64 `json:"p95GatewayInternalLatencyMs"`
	P99GatewayInternalLatencyMs *float64 `json:"p99GatewayInternalLatencyMs"`
	P95ProviderLatencyMs        *float64 `json:"p95ProviderLatencyMs"`
	P99ProviderLatencyMs        *float64 `json:"p99ProviderLatencyMs"`
	SystemErrorRate             float64  `json:"systemErrorRate"`
}

type dashboardBreakdownsResponse struct {
	ByApplication     []applicationBreakdownResponse   `json:"byApplication"`
	ByBudgetScope     []budgetScopeBreakdownResponse   `json:"byBudgetScope"`
	ByProviderModel   []providerModelBreakdownResponse `json:"byProviderModel"`
	BySafetyOutcome   []outcomeBreakdownResponse       `json:"bySafetyOutcome"`
	ByCacheOutcome    []outcomeBreakdownResponse       `json:"byCacheOutcome"`
	ByFallbackOutcome []outcomeBreakdownResponse       `json:"byFallbackOutcome"`
	ByTerminalStatus  []outcomeBreakdownResponse       `json:"byTerminalStatus"`
}

type applicationBreakdownResponse struct {
	ApplicationID string `json:"applicationId"`
	RequestCount  int64  `json:"requestCount"`
	CostMicroUSD  int64  `json:"estimatedCostMicroUsd"`
}

type providerModelBreakdownResponse struct {
	SelectedProvider     string  `json:"selectedProvider"`
	SelectedModel        string  `json:"selectedModel"`
	RequestCount         int64   `json:"requestCount"`
	P95ProviderLatencyMs float64 `json:"p95ProviderLatencyMs"`
}

type outcomeBreakdownResponse struct {
	Outcome      string `json:"outcome"`
	RequestCount int64  `json:"requestCount"`
}

type routingCountByModelResponse struct {
	SelectedProvider string `json:"selectedProvider"`
	SelectedModel    string `json:"selectedModel"`
	RoutingReason    string `json:"routingReason"`
	RequestCount     int64  `json:"requestCount"`
}

type costByModelResponse struct {
	SelectedProvider string `json:"selectedProvider"`
	SelectedModel    string `json:"selectedModel"`
	RequestCount     int64  `json:"requestCount"`
	TotalTokens      int64  `json:"totalTokens"`
	CostMicroUSD     int64  `json:"costMicroUsd"`
	CostUSD          string `json:"costUsd"`
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
	Provider        string                             `json:"provider"`
	Model           string                             `json:"model"`
	RequestedModel  string                             `json:"requestedModel"`
	SelectedModel   string                             `json:"selectedModel"`
	Usage           usageResponse                      `json:"usage"`
	UsageSummary    usageSummaryResponse               `json:"usageSummary"`
	Cost            costResponse                       `json:"cost"`
	Latency         latencyResponse                    `json:"latency"`
	LatencySummary  latencySummaryResponse             `json:"latencySummary"`
	Cache           cacheResponse                      `json:"cache"`
	Routing         routingResponse                    `json:"routing"`
	Masking         maskingResponse                    `json:"masking"`
	SafetySummary   safetySummaryResponse              `json:"safetySummary"`
	Error           detailErrorResponse                `json:"error"`
	CreatedAt       time.Time                          `json:"createdAt"`
	CompletedAt     *time.Time                         `json:"completedAt"`
}

type outcomeResponse struct {
	Outcome string  `json:"outcome"`
	Reason  *string `json:"reason"`
	Code    *string `json:"code"`
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
}

type latencySummaryResponse struct {
	GatewayInternalLatencyMs int64  `json:"gatewayInternalLatencyMs"`
	ProviderLatencyMs        *int64 `json:"providerLatencyMs"`
	TotalLatencyMs           int64  `json:"totalLatencyMs"`
}

type cacheResponse struct {
	CacheStatus       string  `json:"cacheStatus"`
	CacheType         string  `json:"cacheType"`
	CacheKeyHash      *string `json:"cacheKeyHash"`
	CacheHitRequestID *string `json:"cacheHitRequestId"`
}

type routingResponse struct {
	RoutingReason    *string `json:"routingReason"`
	RoutingRuleID    *string `json:"routingRuleId"`
	SelectedProvider *string `json:"selectedProvider"`
	SelectedModel    *string `json:"selectedModel"`
}

type maskingResponse struct {
	MaskingAction         string   `json:"maskingAction"`
	MaskingDetectedTypes  []string `json:"maskingDetectedTypes"`
	MaskingDetectedCount  int      `json:"maskingDetectedCount"`
	RedactedPromptPreview *string  `json:"redactedPromptPreview"`
}

type safetySummaryResponse struct {
	Outcome            string   `json:"outcome"`
	DetectedCount      int      `json:"detectedCount"`
	DetectorCategories []string `json:"detectorCategories"`
	MaskingAction      string   `json:"maskingAction"`
}

type detailErrorResponse struct {
	ErrorCode    *string `json:"errorCode"`
	ErrorMessage *string `json:"errorMessage"`
	ErrorStage   *string `json:"errorStage"`
}

type requestLogListItemResponse struct {
	RequestID        string              `json:"requestId"`
	ProjectID        string              `json:"projectId"`
	ApplicationID    string              `json:"applicationId"`
	BudgetScope      budgetScopeResponse `json:"budgetScope"`
	Provider         string              `json:"provider"`
	Model            string              `json:"model"`
	RequestedModel   string              `json:"requestedModel"`
	SelectedModel    string              `json:"selectedModel"`
	Status           string              `json:"status"`
	TerminalStatus   string              `json:"terminalStatus"`
	HTTPStatus       int                 `json:"httpStatus"`
	PromptTokens     int64               `json:"promptTokens"`
	CompletionTokens int64               `json:"completionTokens"`
	TotalTokens      int64               `json:"totalTokens"`
	CostUSD          string              `json:"costUsd"`
	CostMicroUSD     int64               `json:"costMicroUsd"`
	LatencyMs        int64               `json:"latencyMs"`
	CacheStatus      string              `json:"cacheStatus"`
	CacheType        string              `json:"cacheType"`
	RoutingReason    string              `json:"routingReason"`
	MaskingAction    string              `json:"maskingAction"`
	CreatedAt        time.Time           `json:"createdAt"`
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
		logInvocationLogInternalError(r, "list_project_logs", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Request logs could not be loaded.")
		return
	}

	writeJSON(w, http.StatusOK, projectLogsResponse{
		Data:       requestLogListItemResponses(items),
		Pagination: paginationResponse{Limit: filter.Limit, NextCursor: nil, HasMore: false},
	})
}

func (h RequestDetailHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "invocation_log_reader_unavailable", "Invocation log reader is not configured.")
		return
	}

	filter := invocationlog.RequestDetailFilter{
		TenantID:  h.TenantID,
		ProjectID: h.ProjectID,
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
		TenantID:    h.TenantID,
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
		logInvocationLogInternalError(r, "get_dashboard_overview", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Dashboard overview could not be loaded.")
		return
	}

	writeJSON(w, http.StatusOK, dashboardOverviewResponse{
		Data: dashboardOverviewData(filter, overview),
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
		TenantID:      h.TenantID,
		ProjectID:     r.PathValue("projectId"),
		From:          from,
		To:            to,
		Status:        query.Get("status"),
		Provider:      query.Get("provider"),
		Model:         query.Get("model"),
		CacheStatus:   query.Get("cacheStatus"),
		ApplicationID: query.Get("applicationId"),
		BudgetScope:   budgetScopeFromQuery(query),
		RequestID:     query.Get("requestId"),
		Limit:         limit,
	}, nil
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
			CostByModel:           costByModelResponses(overview.CostByModel),
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
		Provider:        detail.Provider,
		Model:           detail.Model,
		RequestedModel:  detail.RequestedModel,
		SelectedModel:   detail.SelectedModel,
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
		},
		LatencySummary: latencySummaryResponse{
			GatewayInternalLatencyMs: detail.LatencySummary.GatewayInternalLatencyMs,
			ProviderLatencyMs:        detail.LatencySummary.ProviderLatencyMs,
			TotalLatencyMs:           detail.LatencySummary.TotalLatencyMs,
		},
		Cache: cacheResponse{
			CacheStatus:       detail.Cache.CacheStatus,
			CacheType:         detail.Cache.CacheType,
			CacheKeyHash:      stringPointerOrNil(detail.Cache.CacheKeyHash),
			CacheHitRequestID: stringPointerOrNil(detail.Cache.CacheHitRequestID),
		},
		Routing: routingResponse{
			RoutingReason:    stringPointerOrNil(detail.Routing.RoutingReason),
			RoutingRuleID:    stringPointerOrNil(detail.Routing.RoutingRuleID),
			SelectedProvider: stringPointerOrNil(detail.Routing.SelectedProvider),
			SelectedModel:    stringPointerOrNil(detail.Routing.SelectedModel),
		},
		Masking: maskingResponse{
			MaskingAction:         detail.Masking.MaskingAction,
			MaskingDetectedTypes:  append([]string(nil), detail.Masking.MaskingDetectedTypes...),
			MaskingDetectedCount:  detail.Masking.MaskingDetectedCount,
			RedactedPromptPreview: stringPointerOrNil(detail.Masking.RedactedPromptPreview),
		},
		SafetySummary: safetySummaryResponse{
			Outcome:            detail.SafetySummary.Outcome,
			DetectedCount:      detail.SafetySummary.DetectedCount,
			DetectorCategories: append([]string(nil), detail.SafetySummary.DetectorCategories...),
			MaskingAction:      detail.SafetySummary.MaskingAction,
		},
		Error: detailErrorResponse{
			ErrorCode:    stringPointerOrNil(detail.Error.ErrorCode),
			ErrorMessage: stringPointerOrNil(detail.Error.ErrorMessage),
			ErrorStage:   stringPointerOrNil(detail.Error.ErrorStage),
		},
		CreatedAt:   detail.CreatedAt,
		CompletedAt: detail.CompletedAt,
	}
}

func requestLogListItemResponses(items []invocationlog.RequestLogListItem) []requestLogListItemResponse {
	responses := make([]requestLogListItemResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, requestLogListItemResponse{
			RequestID:        item.RequestID,
			ProjectID:        item.ProjectID,
			ApplicationID:    item.ApplicationID,
			BudgetScope:      budgetScopeResponseFromScope(item.BudgetScope, item.ApplicationID),
			Provider:         item.Provider,
			Model:            item.Model,
			RequestedModel:   item.RequestedModel,
			SelectedModel:    item.SelectedModel,
			Status:           item.Status,
			TerminalStatus:   item.TerminalStatus,
			HTTPStatus:       item.HTTPStatus,
			PromptTokens:     item.PromptTokens,
			CompletionTokens: item.CompletionTokens,
			TotalTokens:      item.TotalTokens,
			CostUSD:          item.CostUSD,
			CostMicroUSD:     item.CostMicroUSD,
			LatencyMs:        item.LatencyMs,
			CacheStatus:      item.CacheStatus,
			CacheType:        item.CacheType,
			RoutingReason:    item.RoutingReason,
			MaskingAction:    item.MaskingAction,
			CreatedAt:        item.CreatedAt,
		})
	}
	return responses
}

func domainOutcomesResponseFromDomain(outcomes invocationlog.DomainOutcomes) domainOutcomesResponse {
	normalized := invocationlog.NormalizeDomainOutcomes(invocationlog.LlmInvocationLog{DomainOutcomes: outcomes})
	return domainOutcomesResponse{
		Auth:      outcomeResponseWithCode(normalized.Auth.Outcome, normalized.Auth.ErrorCode),
		Runtime:   outcomeResponseFromOutcome(normalized.Runtime.Outcome),
		RateLimit: outcomeResponseFromOutcome(normalized.RateLimit.Outcome),
		Budget:    outcomeResponseFromOutcome(normalized.Budget.Outcome),
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

func dashboardBreakdowns(overview invocationlog.DashboardOverviewFields) dashboardBreakdownsResponse {
	return dashboardBreakdownsResponse{
		ByApplication:     applicationBreakdownResponses(overview.ApplicationBreakdown),
		ByBudgetScope:     budgetScopeBreakdownResponses(overview.BudgetScopeBreakdown),
		ByProviderModel:   providerModelBreakdownResponses(overview.CostByModel, overview.Performance.P95ProviderLatencyMs),
		BySafetyOutcome:   outcomeBreakdownResponses(overview.SafetyOutcomeCounts),
		ByCacheOutcome:    outcomeBreakdownResponses(overview.CacheOutcomeCounts),
		ByFallbackOutcome: outcomeBreakdownResponses(overview.FallbackOutcomeCounts),
		ByTerminalStatus:  outcomeBreakdownResponses(overview.StatusCounts),
	}
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
			SelectedProvider:     item.SelectedProvider,
			SelectedModel:        item.SelectedModel,
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
			SelectedProvider: item.SelectedProvider,
			SelectedModel:    item.SelectedModel,
			RoutingReason:    item.RoutingReason,
			RequestCount:     item.RequestCount,
		})
	}
	return responses
}

func costByModelResponses(items []invocationlog.CostByModel) []costByModelResponse {
	responses := make([]costByModelResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, costByModelResponse{
			SelectedProvider: item.SelectedProvider,
			SelectedModel:    item.SelectedModel,
			RequestCount:     item.RequestCount,
			TotalTokens:      item.TotalTokens,
			CostMicroUSD:     item.CostMicroUSD,
			CostUSD:          item.CostUSD,
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
