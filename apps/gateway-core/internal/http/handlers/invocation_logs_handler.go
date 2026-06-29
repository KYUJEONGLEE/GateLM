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
	"gatelm/apps/gateway-core/internal/domain/outcome"
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
	GeneratedAt time.Time                    `json:"generatedAt"`
	TimeRange   dashboardTimeRangeResponse   `json:"timeRange"`
	Freshness   dashboardFreshnessResponse   `json:"freshness"`
	QueryBudget dashboardQueryBudgetResponse `json:"queryBudget"`
	Filters     dashboardFilterResponse      `json:"filters"`
	Totals      dashboardTotalsResponse      `json:"totals"`
	Breakdowns  dashboardBreakdownsResponse  `json:"breakdowns"`
	Performance dashboardPerformanceResponse `json:"performance"`
}

type dashboardTimeRangeResponse struct {
	From        time.Time `json:"from"`
	To          time.Time `json:"to"`
	Granularity string    `json:"granularity"`
}

type dashboardFilterResponse struct {
	TenantID        string  `json:"tenantId"`
	ProjectID       *string `json:"projectId"`
	ApplicationID   *string `json:"applicationId"`
	BudgetScopeType string  `json:"budgetScopeType"`
	BudgetScopeID   string  `json:"budgetScopeId"`
	ResolvedBy      string  `json:"resolvedBy"`
}

type dashboardTotalsResponse struct {
	RequestCount          int64   `json:"requestCount"`
	SuccessCount          int64   `json:"successCount"`
	BlockedCount          int64   `json:"blockedCount"`
	RateLimitedCount      int64   `json:"rateLimitedCount"`
	FailedCount           int64   `json:"failedCount"`
	CancelledCount        int64   `json:"cancelledCount"`
	EstimatedCostMicroUSD int64   `json:"estimatedCostMicroUsd"`
	ExactCacheHitRate     float64 `json:"exactCacheHitRate"`
	FallbackSuccessCount  int64   `json:"fallbackSuccessCount"`
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

type dashboardBreakdownsResponse struct {
	ByApplication     []applicationBreakdownResponse   `json:"byApplication"`
	ByBudgetScope     []budgetScopeBreakdownResponse   `json:"byBudgetScope"`
	ByProviderModel   []providerModelBreakdownResponse `json:"byProviderModel"`
	BySafetyOutcome   []outcomeBreakdownResponse       `json:"bySafetyOutcome"`
	ByCacheOutcome    []outcomeBreakdownResponse       `json:"byCacheOutcome"`
	ByFallbackOutcome []outcomeBreakdownResponse       `json:"byFallbackOutcome"`
	ByTerminalStatus  []outcomeBreakdownResponse       `json:"byTerminalStatus"`
}

type dashboardPerformanceResponse struct {
	P95GatewayInternalLatencyMs int64   `json:"p95GatewayInternalLatencyMs"`
	P99GatewayInternalLatencyMs int64   `json:"p99GatewayInternalLatencyMs"`
	P95ProviderLatencyMs        int64   `json:"p95ProviderLatencyMs"`
	P99ProviderLatencyMs        int64   `json:"p99ProviderLatencyMs"`
	SystemErrorRate             float64 `json:"systemErrorRate"`
}

type applicationBreakdownResponse struct {
	ApplicationID         string `json:"applicationId"`
	RequestCount          int64  `json:"requestCount"`
	EstimatedCostMicroUSD int64  `json:"estimatedCostMicroUsd"`
}

type providerModelBreakdownResponse struct {
	SelectedProvider      string `json:"selectedProvider"`
	SelectedModel         string `json:"selectedModel"`
	RequestCount          int64  `json:"requestCount"`
	P95ProviderLatencyMs  int64  `json:"p95ProviderLatencyMs"`
}

type outcomeBreakdownResponse struct {
	Outcome      string `json:"outcome"`
	RequestCount int64  `json:"requestCount"`
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
	EstimatedCostMicroUSD int64 `json:"estimatedCostMicroUsd"`
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
	ApplicationID   string                             `json:"applicationId"`
	BudgetScope     budgetScopeResponse                `json:"budgetScope"`
	TerminalStatus  string                             `json:"terminalStatus"`
	HTTPStatus      int                                `json:"httpStatus"`
	ErrorCode       *string                            `json:"errorCode"`
	DomainOutcomes  outcome.DomainOutcomes             `json:"domainOutcomes"`
	RuntimeSnapshot *runtimeSnapshotProvenanceResponse `json:"runtimeSnapshot"`
	Routing         routingSummaryResponse             `json:"routing"`
	LatencySummary  latencySummaryResponse             `json:"latencySummary"`
	UsageSummary    usageSummaryResponse               `json:"usageSummary"`
	SafetySummary   safetySummaryResponse              `json:"safetySummary"`
	CreatedAt       time.Time                          `json:"createdAt"`
	CompletedAt     *time.Time                         `json:"completedAt"`
}

type routingSummaryResponse struct {
	RequestedModel   string  `json:"requestedModel"`
	SelectedProvider *string `json:"selectedProvider"`
	SelectedModel    *string `json:"selectedModel"`
	RoutingReason    *string `json:"routingReason"`
}

type latencySummaryResponse struct {
	GatewayInternalLatencyMs int64  `json:"gatewayInternalLatencyMs"`
	ProviderLatencyMs       *int64 `json:"providerLatencyMs"`
	TotalLatencyMs          int64  `json:"totalLatencyMs"`
}

type usageSummaryResponse struct {
	PromptTokens          int64 `json:"promptTokens"`
	CompletionTokens      int64 `json:"completionTokens"`
	TotalTokens           int64 `json:"totalTokens"`
	EstimatedCostMicroUSD int64 `json:"estimatedCostMicroUsd"`
	SavedCostMicroUSD     int64 `json:"savedCostMicroUsd"`
}

type safetySummaryResponse struct {
	Outcome            string   `json:"outcome"`
	DetectedCount      int      `json:"detectedCount"`
	DetectorCategories []string `json:"detectorCategories"`
	MaskingAction      string   `json:"maskingAction"`
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
	TerminalStatus   string              `json:"terminalStatus"`
	DomainOutcomes   outcome.DomainOutcomes `json:"domainOutcomes"`
	Status           string              `json:"status"`
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
	filterScope := dashboardFilterScope(filter)
	exactCacheHitRate := 0.0
	if overview.CacheHitRate != nil {
		exactCacheHitRate = *overview.CacheHitRate
	}
	generatedAt := overview.GeneratedAt
	if generatedAt.IsZero() {
		generatedAt = overview.DataFreshness.GeneratedAt
	}
	if generatedAt.IsZero() {
		generatedAt = time.Now().UTC()
	}
	freshness := dashboardFreshnessFromOverview(overview, generatedAt)
	queryBudget := dashboardQueryBudgetFromOverview(overview)
	return dashboardOverviewDataResponse{
		GeneratedAt: generatedAt,
		TimeRange: dashboardTimeRangeResponse{
			From:        filter.From,
			To:          filter.To,
			Granularity: dashboardGranularity(filter.From, filter.To),
		},
		Freshness: dashboardFreshnessResponse{
			LastIngestedAt:   freshness.LastIngestedAt,
			LastAggregatedAt: freshness.LastAggregatedAt,
			Source:           freshness.Source,
			IsStale:          freshness.IsStale,
		},
		QueryBudget: dashboardQueryBudgetResponse{
			Status:            queryBudget.Status,
			MaxRangeHours:     queryBudget.MaxRangeHours,
			MaxBreakdownItems: queryBudget.MaxBreakdownItems,
			Guidance:          queryBudget.Guidance,
		},
		Filters: dashboardFilterResponse{
			TenantID:        filter.TenantID,
			ProjectID:       stringPointerOrNil(filter.ProjectID),
			ApplicationID:   nil,
			BudgetScopeType: filterScope.Type,
			BudgetScopeID:   filterScope.ID,
			ResolvedBy:      filterScope.ResolvedBy,
		},
		Totals: dashboardTotalsResponse{
			RequestCount:          overview.TotalRequests,
			SuccessCount:          overview.SuccessfulRequests,
			BlockedCount:          overview.BlockedRequests,
			RateLimitedCount:      overview.RateLimitedRequests,
			FailedCount:           overview.FailedRequests,
			CancelledCount:        overview.CancelledRequests,
			EstimatedCostMicroUSD: overview.TotalCostMicroUSD,
			ExactCacheHitRate:     exactCacheHitRate,
			FallbackSuccessCount:  outcomeRequestCount(overview.Breakdowns.ByFallbackOutcome, outcome.FallbackSuccess),
		},
		Breakdowns: dashboardBreakdownsResponse{
			ByApplication:     applicationBreakdownResponses(overview.Breakdowns.ByApplication),
			ByBudgetScope:     budgetScopeBreakdownResponses(overview.Breakdowns.ByBudgetScope),
			ByProviderModel:   providerModelBreakdownResponses(overview.Breakdowns.ByProviderModel),
			BySafetyOutcome:   outcomeBreakdownResponses(overview.Breakdowns.BySafetyOutcome),
			ByCacheOutcome:    outcomeBreakdownResponses(overview.Breakdowns.ByCacheOutcome),
			ByFallbackOutcome: outcomeBreakdownResponses(overview.Breakdowns.ByFallbackOutcome),
			ByTerminalStatus:  outcomeBreakdownResponses(overview.Breakdowns.ByTerminalStatus),
		},
		Performance: dashboardPerformanceResponse{
			P95GatewayInternalLatencyMs: overview.Performance.P95GatewayInternalLatencyMs,
			P99GatewayInternalLatencyMs: overview.Performance.P99GatewayInternalLatencyMs,
			P95ProviderLatencyMs:        overview.Performance.P95ProviderLatencyMs,
			P99ProviderLatencyMs:        overview.Performance.P99ProviderLatencyMs,
			SystemErrorRate:             overview.Performance.SystemErrorRate,
		},
	}
}

func requestDetailData(detail invocationlog.RequestDetail) requestDetailDataResponse {
	terminalStatus, domainOutcomes := canonicalDetailOutcome(detail)
	domainOutcomes.Safety.RedactedPromptPreview = nil
	usageSummary := requestDetailUsageSummary(detail)
	latencySummary := requestDetailLatencySummary(detail)
	safetySummary := requestDetailSafetySummary(detail, domainOutcomes.Safety)
	return requestDetailDataResponse{
		RequestID:       detail.RequestID,
		TraceID:         detail.TraceID,
		TenantID:        detail.TenantID,
		ProjectID:       detail.ProjectID,
		ApplicationID:   firstNonEmpty(detail.ApplicationID, "unknown_application"),
		BudgetScope:     budgetScopeResponseFromScope(detail.BudgetScope, detail.ApplicationID),
		TerminalStatus:  terminalStatus,
		HTTPStatus:      detail.HTTPStatus,
		ErrorCode:       stringPointerOrNil(detail.Error.ErrorCode),
		DomainOutcomes:  domainOutcomes,
		RuntimeSnapshot: runtimeSnapshotResponse(detail.RuntimeSnapshot),
		Routing: routingSummaryResponse{
			RequestedModel:   firstNonEmpty(detail.RequestedModel, "auto"),
			SelectedProvider: stringPointerOrNil(detail.Routing.SelectedProvider),
			SelectedModel:    stringPointerOrNil(detail.Routing.SelectedModel),
			RoutingReason:    stringPointerOrNil(detail.Routing.RoutingReason),
		},
		LatencySummary: latencySummaryResponse{
			GatewayInternalLatencyMs: latencySummary.GatewayInternalLatencyMs,
			ProviderLatencyMs:       latencySummary.ProviderLatencyMs,
			TotalLatencyMs:          latencySummary.TotalLatencyMs,
		},
		UsageSummary: usageSummaryResponse{
			PromptTokens:          usageSummary.PromptTokens,
			CompletionTokens:      usageSummary.CompletionTokens,
			TotalTokens:           usageSummary.TotalTokens,
			EstimatedCostMicroUSD: usageSummary.EstimatedCostMicroUSD,
			SavedCostMicroUSD:     usageSummary.SavedCostMicroUSD,
		},
		SafetySummary: safetySummaryResponse{
			Outcome:            safetySummary.Outcome,
			DetectedCount:      safetySummary.DetectedCount,
			DetectorCategories: append([]string(nil), safetySummary.DetectorCategories...),
			MaskingAction:      safetySummary.MaskingAction,
		},
		CreatedAt:   detail.CreatedAt,
		CompletedAt: detail.CompletedAt,
	}
}

func requestLogListItemResponses(items []invocationlog.RequestLogListItem) []requestLogListItemResponse {
	responses := make([]requestLogListItemResponse, 0, len(items))
	for _, item := range items {
		terminalStatus, domainOutcomes := canonicalListItemOutcome(item)
		responses = append(responses, requestLogListItemResponse{
			RequestID:        item.RequestID,
			ProjectID:        item.ProjectID,
			ApplicationID:    item.ApplicationID,
			BudgetScope:      budgetScopeResponseFromScope(item.BudgetScope, item.ApplicationID),
			Provider:         item.Provider,
			Model:            item.Model,
			RequestedModel:   item.RequestedModel,
			SelectedModel:    item.SelectedModel,
			TerminalStatus:   terminalStatus,
			DomainOutcomes:   domainOutcomes,
			Status:           terminalStatus,
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

func canonicalDetailOutcome(detail invocationlog.RequestDetail) (string, outcome.DomainOutcomes) {
	terminalStatus := outcome.CanonicalizeTerminalStatus(firstNonEmpty(detail.TerminalStatus, detail.Status), detail.HTTPStatus, detail.Error.ErrorCode)
	if !detail.DomainOutcomes.IsZero() {
		return terminalStatus, detail.DomainOutcomes
	}
	return terminalStatus, outcome.Build(outcome.BuildInput{
		TerminalStatus:        terminalStatus,
		HTTPStatus:            detail.HTTPStatus,
		ErrorCode:             detail.Error.ErrorCode,
		ApplicationID:         detail.ApplicationID,
		BudgetScopeType:       detail.BudgetScope.Type,
		BudgetScopeID:         detail.BudgetScope.ID,
		BudgetResolvedBy:      detail.BudgetScope.ResolvedBy,
		SafetyChecked:         detail.Masking.MaskingAction != "",
		MaskingAction:         detail.Masking.MaskingAction,
		DetectedTypes:         detail.Masking.MaskingDetectedTypes,
		DetectedCount:         detail.Masking.MaskingDetectedCount,
		RedactedPromptPreview: detail.Masking.RedactedPromptPreview,
		RequestedModel:        detail.RequestedModel,
		SelectedProvider:      detail.Routing.SelectedProvider,
		SelectedModel:         detail.Routing.SelectedModel,
		RoutingReason:         detail.Routing.RoutingReason,
		CacheStatus:           detail.Cache.CacheStatus,
		CacheType:             detail.Cache.CacheType,
		CacheHitRequestID:     detail.Cache.CacheHitRequestID,
		ProviderLatencyMs:     detail.Latency.ProviderLatencyMs,
		RequestLogWritten:     true,
	}).DomainOutcomes
}

func canonicalListItemOutcome(item invocationlog.RequestLogListItem) (string, outcome.DomainOutcomes) {
	terminalStatus := outcome.CanonicalizeTerminalStatus(firstNonEmpty(item.TerminalStatus, item.Status), item.HTTPStatus, "")
	if !item.DomainOutcomes.IsZero() {
		domainOutcomes := item.DomainOutcomes
		domainOutcomes.Safety.RedactedPromptPreview = nil
		return terminalStatus, domainOutcomes
	}
	domainOutcomes := outcome.Build(outcome.BuildInput{
		TerminalStatus:   terminalStatus,
		HTTPStatus:       item.HTTPStatus,
		ApplicationID:    item.ApplicationID,
		BudgetScopeType:  item.BudgetScope.Type,
		BudgetScopeID:    item.BudgetScope.ID,
		BudgetResolvedBy: item.BudgetScope.ResolvedBy,
		SafetyChecked:    item.MaskingAction != "",
		MaskingAction:    item.MaskingAction,
		RequestedModel:   item.RequestedModel,
		SelectedModel:    item.SelectedModel,
		RoutingReason:    item.RoutingReason,
		CacheStatus:      item.CacheStatus,
		CacheType:        item.CacheType,
		RequestLogWritten: true,
	}).DomainOutcomes
	domainOutcomes.Safety.RedactedPromptPreview = nil
	return terminalStatus, domainOutcomes
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

func applicationBreakdownResponses(items []invocationlog.ApplicationBreakdown) []applicationBreakdownResponse {
	responses := make([]applicationBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, applicationBreakdownResponse{
			ApplicationID:         item.ApplicationID,
			RequestCount:          item.RequestCount,
			EstimatedCostMicroUSD: item.EstimatedCostMicroUSD,
		})
	}
	return responses
}

func providerModelBreakdownResponses(items []invocationlog.ProviderModelBreakdown) []providerModelBreakdownResponse {
	responses := make([]providerModelBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, providerModelBreakdownResponse{
			SelectedProvider:     item.SelectedProvider,
			SelectedModel:        item.SelectedModel,
			RequestCount:         item.RequestCount,
			P95ProviderLatencyMs: item.P95ProviderLatencyMs,
		})
	}
	return responses
}

func outcomeBreakdownResponses(items []invocationlog.OutcomeBreakdown) []outcomeBreakdownResponse {
	responses := make([]outcomeBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, outcomeBreakdownResponse{
			Outcome:      item.Outcome,
			RequestCount: item.RequestCount,
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
			EstimatedCostMicroUSD: item.CostMicroUSD,
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

func dashboardFilterScope(filter invocationlog.DashboardOverviewFilter) budget.Scope {
	if filter.BudgetScope.Type != "" && filter.BudgetScope.ID != "" && filter.BudgetScope.ResolvedBy != "" {
		return budget.NormalizeScope(filter.BudgetScope, "")
	}
	if strings.TrimSpace(filter.ProjectID) != "" {
		return budget.Scope{
			Type:       budget.ScopeTypeProject,
			ID:         strings.TrimSpace(filter.ProjectID),
			ResolvedBy: budget.ResolvedByControlPlaneRule,
		}
	}
	return budget.Scope{
		Type:       budget.ScopeTypeTeam,
		ID:         firstNonEmpty(filter.TenantID, "unknown_tenant"),
		ResolvedBy: budget.ResolvedByControlPlaneRule,
	}
}

func dashboardGranularity(from time.Time, to time.Time) string {
	duration := to.Sub(from)
	if duration <= 6*time.Hour {
		return "minute"
	}
	if duration <= 7*24*time.Hour {
		return "hour"
	}
	return "day"
}

func dashboardFreshnessFromOverview(overview invocationlog.DashboardOverviewFields, generatedAt time.Time) invocationlog.DashboardFreshnessFields {
	freshness := overview.Freshness
	if freshness.LastAggregatedAt.IsZero() {
		freshness.LastAggregatedAt = generatedAt
	}
	if freshness.LastIngestedAt.IsZero() {
		if overview.DataFreshness.LastLogCreatedAt != nil {
			freshness.LastIngestedAt = overview.DataFreshness.LastLogCreatedAt.UTC()
		} else {
			freshness.LastIngestedAt = generatedAt
		}
	}
	if strings.TrimSpace(freshness.Source) == "" {
		freshness.Source = "request_log"
	}
	return freshness
}

func dashboardQueryBudgetFromOverview(overview invocationlog.DashboardOverviewFields) invocationlog.DashboardQueryBudgetFields {
	queryBudget := overview.QueryBudget
	if strings.TrimSpace(queryBudget.Status) == "" {
		queryBudget.Status = "ok"
	}
	if queryBudget.MaxRangeHours <= 0 {
		queryBudget.MaxRangeHours = 24
	}
	if queryBudget.MaxBreakdownItems <= 0 {
		queryBudget.MaxBreakdownItems = 50
	}
	return queryBudget
}

func outcomeRequestCount(items []invocationlog.OutcomeBreakdown, outcomeValue string) int64 {
	for _, item := range items {
		if item.Outcome == outcomeValue {
			return item.RequestCount
		}
	}
	return 0
}

func requestDetailUsageSummary(detail invocationlog.RequestDetail) invocationlog.UsageSummaryFields {
	if detail.UsageSummary.PromptTokens != 0 ||
		detail.UsageSummary.CompletionTokens != 0 ||
		detail.UsageSummary.TotalTokens != 0 ||
		detail.UsageSummary.EstimatedCostMicroUSD != 0 ||
		detail.UsageSummary.SavedCostMicroUSD != 0 {
		return detail.UsageSummary
	}
	return invocationlog.UsageSummaryFields{
		PromptTokens:          detail.Usage.PromptTokens,
		CompletionTokens:      detail.Usage.CompletionTokens,
		TotalTokens:           detail.Usage.TotalTokens,
		EstimatedCostMicroUSD: detail.Cost.CostMicroUSD,
		SavedCostMicroUSD:     0,
	}
}

func requestDetailLatencySummary(detail invocationlog.RequestDetail) invocationlog.LatencySummaryFields {
	if detail.LatencySummary.TotalLatencyMs != 0 ||
		detail.LatencySummary.ProviderLatencyMs != nil ||
		detail.LatencySummary.GatewayInternalLatencyMs != 0 {
		return detail.LatencySummary
	}
	gatewayInternalLatencyMs := detail.Latency.LatencyMs
	if detail.Latency.ProviderLatencyMs != nil {
		gatewayInternalLatencyMs -= *detail.Latency.ProviderLatencyMs
		if gatewayInternalLatencyMs < 0 {
			gatewayInternalLatencyMs = 0
		}
	}
	return invocationlog.LatencySummaryFields{
		GatewayInternalLatencyMs: gatewayInternalLatencyMs,
		ProviderLatencyMs:       detail.Latency.ProviderLatencyMs,
		TotalLatencyMs:          detail.Latency.LatencyMs,
	}
}

func requestDetailSafetySummary(detail invocationlog.RequestDetail, safety outcome.SafetyOutcome) invocationlog.SafetySummaryFields {
	if detail.SafetySummary.Outcome != "" {
		return detail.SafetySummary
	}
	categories := append([]string(nil), safety.DetectedTypes...)
	if len(categories) == 0 {
		categories = append([]string(nil), detail.Masking.MaskingDetectedTypes...)
	}
	detectedCount := safety.DetectedCount
	if detectedCount == 0 && detail.Masking.MaskingDetectedCount > 0 {
		detectedCount = detail.Masking.MaskingDetectedCount
	}
	return invocationlog.SafetySummaryFields{
		Outcome:            firstNonEmpty(safety.Outcome, outcome.SafetyNotChecked),
		DetectedCount:      detectedCount,
		DetectorCategories: normalizedStringValues(categories),
		MaskingAction:      firstNonEmpty(safety.MaskingAction, detail.Masking.MaskingAction, "none"),
	}
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
