package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

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
	Range  dashboardRangeResponse  `json:"range"`
	Filter dashboardFilterResponse `json:"filters"`
	Totals dashboardTotalsResponse `json:"totals"`
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
	TotalRequests         int64    `json:"totalRequests"`
	SuccessfulRequests    int64    `json:"successfulRequests"`
	BlockedRequests       int64    `json:"blockedRequests"`
	CacheHitRequests      int64    `json:"cacheHitRequests"`
	CacheHitRate          *float64 `json:"cacheHitRate"`
	TotalTokens           int64    `json:"totalTokens"`
	TotalCostMicroUSD     int64    `json:"totalCostMicroUsd"`
	TotalCostUSD          string   `json:"totalCostUsd"`
	AverageResponseTimeMs *float64 `json:"averageResponseTimeMs"`
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

	detail, err := h.Reader.GetRequestDetail(r.Context(), invocationlog.RequestDetailFilter{
		TenantID:  h.TenantID,
		ProjectID: h.ProjectID,
		RequestID: r.PathValue("requestId"),
	})
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		if errors.Is(err, invocationlog.ErrLogNotFound) {
			writeGatewayError(w, http.StatusNotFound, "", "request_log_not_found", "Request log was not found.")
			return
		}
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
			BlockedRequests:       overview.BlockedRequests,
			CacheHitRequests:      overview.CacheHitRequests,
			CacheHitRate:          overview.CacheHitRate,
			TotalTokens:           overview.TotalTokens,
			TotalCostMicroUSD:     overview.TotalCostMicroUSD,
			TotalCostUSD:          overview.TotalCostUSD,
			AverageResponseTimeMs: overview.AverageResponseTimeMs,
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

func stringPointerOrNil(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func parseRequiredRFC3339Query(r *http.Request, name string) (time.Time, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return time.Time{}, errors.New(name + " is required")
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, errors.New(name + " must be RFC3339")
	}
	return parsed, nil
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
