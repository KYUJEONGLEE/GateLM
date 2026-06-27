package handlers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
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
	Range         dashboardRangeResponse         `json:"range"`
	Filter        dashboardFilterResponse        `json:"filters"`
	Totals        dashboardTotalsResponse        `json:"totals"`
	DataFreshness dashboardDataFreshnessResponse `json:"dataFreshness"`
}

type dashboardRangeResponse struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type dashboardFilterResponse struct {
	TenantID  string  `json:"tenantId"`
	ProjectID *string `json:"projectId"`
}

type dashboardTotalsResponse struct {
	TotalRequests         int64                         `json:"totalRequests"`
	SuccessfulRequests    int64                         `json:"successfulRequests"`
	FailedRequests        int64                         `json:"failedRequests"`
	BlockedRequests       int64                         `json:"blockedRequests"`
	RateLimitedRequests   int64                         `json:"rateLimitedRequests"`
	CacheHitRequests      int64                         `json:"cacheHitRequests"`
	CacheEligibleRequests int64                         `json:"cacheEligibleRequests"`
	CacheHitRate          *float64                      `json:"cacheHitRate"`
	PromptTokens          int64                         `json:"promptTokens"`
	CompletionTokens      int64                         `json:"completionTokens"`
	TotalTokens           int64                         `json:"totalTokens"`
	TotalCostMicroUSD     int64                         `json:"totalCostMicroUsd"`
	TotalCostUSD          string                        `json:"totalCostUsd"`
	SavedCostMicroUSD     int64                         `json:"savedCostMicroUsd"`
	SavedCostUSD          string                        `json:"savedCostUsd"`
	AverageLatencyMs      *float64                      `json:"averageLatencyMs"`
	P95LatencyMs          *float64                      `json:"p95LatencyMs"`
	AverageResponseTimeMs *float64                      `json:"averageResponseTimeMs"`
	MaskingActionCounts   map[string]int64              `json:"maskingActionCounts"`
	RoutingCountByModel   []routingCountByModelResponse `json:"routingCountByModel"`
	StatusCounts          map[string]int64              `json:"statusCounts"`
	CostByModel           []costByModelResponse         `json:"costByModel"`
}

type dashboardDataFreshnessResponse struct {
	Source           string     `json:"source"`
	RecordCount      int64      `json:"recordCount"`
	LastLogCreatedAt *time.Time `json:"lastLogCreatedAt"`
	GeneratedAt      time.Time  `json:"generatedAt"`
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

type requestDetailDataResponse struct {
	RequestID      string              `json:"requestId"`
	TraceID        string              `json:"traceId"`
	TenantID       string              `json:"tenantId"`
	ProjectID      string              `json:"projectId"`
	ApplicationID  *string             `json:"applicationId"`
	Status         string              `json:"status"`
	HTTPStatus     int                 `json:"httpStatus"`
	Provider       string              `json:"provider"`
	Model          string              `json:"model"`
	RequestedModel string              `json:"requestedModel"`
	SelectedModel  string              `json:"selectedModel"`
	Usage          usageResponse       `json:"usage"`
	Cost           costResponse        `json:"cost"`
	Latency        latencyResponse     `json:"latency"`
	Cache          cacheResponse       `json:"cache"`
	Routing        routingResponse     `json:"routing"`
	Masking        maskingResponse     `json:"masking"`
	Error          detailErrorResponse `json:"error"`
	CreatedAt      time.Time           `json:"createdAt"`
	CompletedAt    *time.Time          `json:"completedAt"`
}

type usageResponse struct {
	PromptTokens     int64 `json:"promptTokens"`
	CompletionTokens int64 `json:"completionTokens"`
	TotalTokens      int64 `json:"totalTokens"`
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

type detailErrorResponse struct {
	ErrorCode    *string `json:"errorCode"`
	ErrorMessage *string `json:"errorMessage"`
	ErrorStage   *string `json:"errorStage"`
}

type requestLogListItemResponse struct {
	RequestID        string    `json:"requestId"`
	ProjectID        string    `json:"projectId"`
	ApplicationID    string    `json:"applicationId"`
	Provider         string    `json:"provider"`
	Model            string    `json:"model"`
	RequestedModel   string    `json:"requestedModel"`
	SelectedModel    string    `json:"selectedModel"`
	Status           string    `json:"status"`
	HTTPStatus       int       `json:"httpStatus"`
	PromptTokens     int64     `json:"promptTokens"`
	CompletionTokens int64     `json:"completionTokens"`
	TotalTokens      int64     `json:"totalTokens"`
	CostUSD          string    `json:"costUsd"`
	CostMicroUSD     int64     `json:"costMicroUsd"`
	LatencyMs        int64     `json:"latencyMs"`
	CacheStatus      string    `json:"cacheStatus"`
	CacheType        string    `json:"cacheType"`
	RoutingReason    string    `json:"routingReason"`
	MaskingAction    string    `json:"maskingAction"`
	CreatedAt        time.Time `json:"createdAt"`
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
		TenantID:  h.TenantID,
		ProjectID: r.URL.Query().Get("projectId"),
		From:      from,
		To:        to,
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
		RequestID:     query.Get("requestId"),
		Limit:         limit,
	}, nil
}

func dashboardOverviewData(filter invocationlog.DashboardOverviewFilter, overview invocationlog.DashboardOverviewFields) dashboardOverviewDataResponse {
	return dashboardOverviewDataResponse{
		Range: dashboardRangeResponse{
			From: filter.From,
			To:   filter.To,
		},
		Filter: dashboardFilterResponse{
			TenantID:  filter.TenantID,
			ProjectID: stringPointerOrNil(filter.ProjectID),
		},
		Totals: dashboardTotalsResponse{
			TotalRequests:         overview.TotalRequests,
			SuccessfulRequests:    overview.SuccessfulRequests,
			FailedRequests:        overview.FailedRequests,
			BlockedRequests:       overview.BlockedRequests,
			RateLimitedRequests:   overview.RateLimitedRequests,
			CacheHitRequests:      overview.CacheHitRequests,
			CacheEligibleRequests: overview.CacheEligibleRequests,
			CacheHitRate:          overview.CacheHitRate,
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
		RequestID:      detail.RequestID,
		TraceID:        detail.TraceID,
		TenantID:       detail.TenantID,
		ProjectID:      detail.ProjectID,
		ApplicationID:  stringPointerOrNil(detail.ApplicationID),
		Status:         detail.Status,
		HTTPStatus:     detail.HTTPStatus,
		Provider:       detail.Provider,
		Model:          detail.Model,
		RequestedModel: detail.RequestedModel,
		SelectedModel:  detail.SelectedModel,
		Usage: usageResponse{
			PromptTokens:     detail.Usage.PromptTokens,
			CompletionTokens: detail.Usage.CompletionTokens,
			TotalTokens:      detail.Usage.TotalTokens,
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
			Provider:         item.Provider,
			Model:            item.Model,
			RequestedModel:   item.RequestedModel,
			SelectedModel:    item.SelectedModel,
			Status:           item.Status,
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
