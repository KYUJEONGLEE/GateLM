package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type AnalyticsLiveUsageReader interface {
	GetAnalyticsLiveUsage(context.Context, invocationlog.AnalyticsLiveUsageFilter) (invocationlog.AnalyticsLiveUsageFields, error)
}

type AnalyticsLiveUsageHandler struct {
	Reader   AnalyticsLiveUsageReader
	TenantID string
}

type analyticsLiveUsageResponse struct {
	Data analyticsLiveUsageDataResponse `json:"data"`
}

type analyticsLiveUsageDataResponse struct {
	Range                 string                              `json:"range"`
	From                  time.Time                           `json:"from"`
	To                    time.Time                           `json:"to"`
	ProjectID             *string                             `json:"projectId"`
	BucketIntervalSeconds int                                 `json:"bucketIntervalSeconds"`
	CurrentWindowSeconds  int                                 `json:"currentWindowSeconds"`
	DeltaWindowSeconds    int                                 `json:"deltaWindowSeconds"`
	Summary               analyticsLiveUsageSummaryResponse   `json:"summary"`
	Buckets               []analyticsLiveUsageBucketResponse  `json:"buckets"`
	Projects              []analyticsLiveUsageProjectResponse `json:"projects"`
	RateLimitStartedAt    *time.Time                          `json:"rateLimitStartedAt"`
	DataFreshness         dashboardDataFreshnessResponse      `json:"dataFreshness"`
}

type analyticsLiveUsageSummaryResponse struct {
	RequestCount            int64   `json:"requestCount"`
	ProcessedRequestCount   int64   `json:"processedRequestCount"`
	RateLimitedRequestCount int64   `json:"rateLimitedRequestCount"`
	RateLimitedRate         float64 `json:"rateLimitedRate"`
	CurrentIncomingRPS      float64 `json:"currentIncomingRps"`
	PeakIncomingRPS         float64 `json:"peakIncomingRps"`
}

type analyticsLiveUsageBucketResponse struct {
	PeriodStart             time.Time `json:"periodStart"`
	PeriodEnd               time.Time `json:"periodEnd"`
	IncomingRPS             float64   `json:"incomingRps"`
	ProcessedRPS            float64   `json:"processedRps"`
	RateLimitedRPS          float64   `json:"rateLimitedRps"`
	RequestCount            int64     `json:"requestCount"`
	ProcessedRequestCount   int64     `json:"processedRequestCount"`
	RateLimitedRequestCount int64     `json:"rateLimitedRequestCount"`
}

type analyticsLiveUsageProjectResponse struct {
	ProjectID               string   `json:"projectId"`
	RequestCount            int64    `json:"requestCount"`
	ProcessedRequestCount   int64    `json:"processedRequestCount"`
	RateLimitedRequestCount int64    `json:"rateLimitedRequestCount"`
	RateLimitedRate         float64  `json:"rateLimitedRate"`
	CurrentIncomingRPS      float64  `json:"currentIncomingRps"`
	DeltaPercent            *float64 `json:"deltaPercent"`
	Trend                   string   `json:"trend"`
}

func (h AnalyticsLiveUsageHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "ANALYTICS_LIVE_USAGE_UNAVAILABLE", "Live usage data is unavailable.")
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

	filter := invocationlog.AnalyticsLiveUsageFilter{
		TenantID:  firstNonEmptyQueryValue(r.URL.Query().Get("tenantId"), h.TenantID),
		ProjectID: r.URL.Query().Get("projectId"),
		From:      from,
		To:        to,
	}
	filter, err = invocationlog.NormalizeAnalyticsLiveUsageFilter(filter)
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}
	fields, err := h.Reader.GetAnalyticsLiveUsage(r.Context(), filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		if errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
			writeGatewayError(w, http.StatusServiceUnavailable, "", "ANALYTICS_LIVE_USAGE_UNAVAILABLE", "Live usage data is unavailable.")
			return
		}
		logInvocationLogInternalError(r, "get_analytics_live_usage", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Live usage could not be loaded.")
		return
	}

	rangeValue, _ := invocationlog.AnalyticsLiveUsageRange(filter)
	writeJSON(w, http.StatusOK, analyticsLiveUsageResponse{
		Data: analyticsLiveUsageData(filter, rangeValue, fields),
	})
}

func analyticsLiveUsageData(
	filter invocationlog.AnalyticsLiveUsageFilter,
	rangeValue string,
	fields invocationlog.AnalyticsLiveUsageFields,
) analyticsLiveUsageDataResponse {
	buckets := make([]analyticsLiveUsageBucketResponse, 0, len(fields.Buckets))
	for _, item := range fields.Buckets {
		buckets = append(buckets, analyticsLiveUsageBucketResponse{
			PeriodStart:             item.PeriodStart,
			PeriodEnd:               item.PeriodEnd,
			IncomingRPS:             item.IncomingRPS,
			ProcessedRPS:            item.ProcessedRPS,
			RateLimitedRPS:          item.RateLimitedRPS,
			RequestCount:            item.RequestCount,
			ProcessedRequestCount:   item.ProcessedRequestCount,
			RateLimitedRequestCount: item.RateLimitedRequestCount,
		})
	}

	projects := make([]analyticsLiveUsageProjectResponse, 0, len(fields.Projects))
	for _, item := range fields.Projects {
		projects = append(projects, analyticsLiveUsageProjectResponse{
			ProjectID:               item.ProjectID,
			RequestCount:            item.RequestCount,
			ProcessedRequestCount:   item.ProcessedRequestCount,
			RateLimitedRequestCount: item.RateLimitedRequestCount,
			RateLimitedRate:         ratio(item.RateLimitedRequestCount, item.RequestCount),
			CurrentIncomingRPS:      item.CurrentIncomingRPS,
			DeltaPercent:            item.DeltaPercent,
			Trend:                   item.Trend,
		})
	}

	return analyticsLiveUsageDataResponse{
		Range:                 rangeValue,
		From:                  filter.From.UTC(),
		To:                    filter.To.UTC(),
		ProjectID:             optionalResponseString(filter.ProjectID),
		BucketIntervalSeconds: fields.BucketIntervalSeconds,
		CurrentWindowSeconds:  fields.CurrentWindowSeconds,
		DeltaWindowSeconds:    fields.DeltaWindowSeconds,
		Summary: analyticsLiveUsageSummaryResponse{
			RequestCount:            fields.Summary.RequestCount,
			ProcessedRequestCount:   fields.Summary.ProcessedRequestCount,
			RateLimitedRequestCount: fields.Summary.RateLimitedRequestCount,
			RateLimitedRate:         ratio(fields.Summary.RateLimitedRequestCount, fields.Summary.RequestCount),
			CurrentIncomingRPS:      fields.Summary.CurrentIncomingRPS,
			PeakIncomingRPS:         fields.Summary.PeakIncomingRPS,
		},
		Buckets:            buckets,
		Projects:           projects,
		RateLimitStartedAt: fields.RateLimitStartedAt,
		DataFreshness: dashboardDataFreshnessResponse{
			Source:           fields.DataFreshness.Source,
			RecordCount:      fields.DataFreshness.RecordCount,
			LastLogCreatedAt: fields.DataFreshness.LastLogCreatedAt,
			GeneratedAt:      fields.DataFreshness.GeneratedAt,
		},
	}
}

func ratio(numerator, denominator int64) float64 {
	if denominator <= 0 {
		return 0
	}
	return float64(numerator) / float64(denominator)
}

func optionalResponseString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
