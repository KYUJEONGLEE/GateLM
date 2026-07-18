package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type AnalyticsPolicyImpactReader interface {
	GetAnalyticsPolicyImpact(
		ctx context.Context,
		filter invocationlog.AnalyticsPolicyImpactFilter,
	) (invocationlog.AnalyticsPolicyImpactFields, error)
}

type AnalyticsPolicyImpactHandler struct {
	Reader   AnalyticsPolicyImpactReader
	TenantID string
}

type analyticsPolicyImpactResponse struct {
	Data analyticsPolicyImpactDataResponse `json:"data"`
}

type analyticsPolicyImpactDataResponse struct {
	GeneratedAt         time.Time                                   `json:"generatedAt"`
	Period              string                                      `json:"period"`
	BucketInterval      string                                      `json:"bucketInterval"`
	ExpectedBucketCount int                                         `json:"expectedBucketCount"`
	Range               dashboardRangeResponse                      `json:"range"`
	Filters             analyticsPolicyImpactFilterResponse         `json:"filters"`
	Totals              analyticsPolicyImpactTotalsResponse         `json:"totals"`
	SurfaceTotals       []analyticsPolicyImpactSurfaceTotalResponse `json:"surfaceTotals"`
	PolicyOutcomes      []analyticsPolicyImpactOutcomeResponse      `json:"policyOutcomes"`
	RoutingRoles        []analyticsPolicyImpactRoutingRoleResponse  `json:"routingRoles"`
	ModelBuckets        []analyticsPolicyImpactModelBucketResponse  `json:"modelBuckets"`
	UsageSources        []analyticsPolicyImpactUsageSourceResponse  `json:"usageSources"`
	MetricCoverage      []analyticsMetricCoverageResponse           `json:"metricCoverage"`
	DataFreshness       dashboardDataFreshnessResponse              `json:"dataFreshness"`
}

type analyticsPolicyImpactFilterResponse struct {
	TenantID  string  `json:"tenantId"`
	ProjectID *string `json:"projectId"`
}

type analyticsPolicyImpactTotalsResponse struct {
	RequestCount                    int64  `json:"requestCount"`
	CostMicroUSD                    int64  `json:"costMicroUsd"`
	KnownSavedCostMicroUSD          int64  `json:"knownSavedCostMicroUsd"`
	SavedCostMicroUSD               *int64 `json:"savedCostMicroUsd"`
	AvoidedProviderCallRequests     int64  `json:"avoidedProviderCallRequests"`
	ProtectedRequests               int64  `json:"protectedRequests"`
	HighPerformanceRequests         int64  `json:"highPerformanceRequests"`
	HighPerformanceEligibleRequests int64  `json:"highPerformanceEligibleRequests"`
}

type analyticsPolicyImpactSurfaceTotalResponse struct {
	Surface                         string `json:"surface"`
	RequestCount                    int64  `json:"requestCount"`
	CostMicroUSD                    int64  `json:"costMicroUsd"`
	KnownSavedCostMicroUSD          int64  `json:"knownSavedCostMicroUsd"`
	SavedCostMicroUSD               *int64 `json:"savedCostMicroUsd"`
	AvoidedProviderCallRequests     int64  `json:"avoidedProviderCallRequests"`
	ProtectedRequests               int64  `json:"protectedRequests"`
	HighPerformanceRequests         int64  `json:"highPerformanceRequests"`
	HighPerformanceEligibleRequests int64  `json:"highPerformanceEligibleRequests"`
}

type analyticsPolicyImpactOutcomeResponse struct {
	Surface      string `json:"surface"`
	Outcome      string `json:"outcome"`
	RequestCount int64  `json:"requestCount"`
}

type analyticsPolicyImpactRoutingRoleResponse struct {
	Surface      string `json:"surface"`
	Scheme       string `json:"scheme"`
	Role         string `json:"role"`
	RequestCount int64  `json:"requestCount"`
}

type analyticsPolicyImpactModelBucketResponse struct {
	Surface      string    `json:"surface"`
	PeriodStart  time.Time `json:"periodStart"`
	PeriodEnd    time.Time `json:"periodEnd"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	RequestCount int64     `json:"requestCount"`
}

type analyticsPolicyImpactUsageSourceResponse struct {
	Surface      string  `json:"surface"`
	ProjectID    *string `json:"projectId"`
	RequestCount int64   `json:"requestCount"`
	CostMicroUSD int64   `json:"costMicroUsd"`
}

type analyticsMetricCoverageResponse struct {
	Metric              string `json:"metric"`
	Surface             string `json:"surface"`
	Status              string `json:"status"`
	KnownRequestCount   int64  `json:"knownRequestCount"`
	UnknownRequestCount int64  `json:"unknownRequestCount"`
}

func (h AnalyticsPolicyImpactHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "invocation_log_reader_unavailable", "Policy impact reader is not configured.")
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
	filter := invocationlog.AnalyticsPolicyImpactFilter{
		TenantID:  firstNonEmptyQueryValue(query.Get("tenantId"), h.TenantID),
		ProjectID: query.Get("projectId"),
		Period:    query.Get("period"),
		From:      from,
		To:        to,
	}
	impact, err := h.Reader.GetAnalyticsPolicyImpact(r.Context(), filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		logInvocationLogInternalError(r, "get_analytics_policy_impact", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Policy impact could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, analyticsPolicyImpactResponse{Data: analyticsPolicyImpactData(filter, impact)})
}

func analyticsPolicyImpactData(
	filter invocationlog.AnalyticsPolicyImpactFilter,
	impact invocationlog.AnalyticsPolicyImpactFields,
) analyticsPolicyImpactDataResponse {
	return analyticsPolicyImpactDataResponse{
		GeneratedAt: impact.DataFreshness.GeneratedAt,
		Period:      impact.Period, BucketInterval: impact.BucketInterval,
		ExpectedBucketCount: impact.ExpectedBucketCount,
		Range:               dashboardRangeResponse{From: filter.From, To: filter.To},
		Filters: analyticsPolicyImpactFilterResponse{
			TenantID: filter.TenantID, ProjectID: stringPointerOrNil(filter.ProjectID),
		},
		Totals:         analyticsPolicyImpactTotals(impact.Totals),
		SurfaceTotals:  analyticsPolicyImpactSurfaceTotals(impact.SurfaceTotals),
		PolicyOutcomes: analyticsPolicyImpactOutcomes(impact.PolicyOutcomes),
		RoutingRoles:   analyticsPolicyImpactRoutingRoles(impact.RoutingRoles),
		ModelBuckets:   analyticsPolicyImpactModelBuckets(impact.ModelBuckets),
		UsageSources:   analyticsPolicyImpactUsageSources(impact.UsageSources),
		MetricCoverage: analyticsMetricCoverage(impact.MetricCoverage),
		DataFreshness: dashboardDataFreshnessResponse{
			Source: impact.DataFreshness.Source, RecordCount: impact.DataFreshness.RecordCount,
			LastLogCreatedAt: impact.DataFreshness.LastLogCreatedAt,
			GeneratedAt:      impact.DataFreshness.GeneratedAt,
		},
	}
}

func analyticsPolicyImpactTotals(item invocationlog.AnalyticsPolicyImpactTotals) analyticsPolicyImpactTotalsResponse {
	return analyticsPolicyImpactTotalsResponse{
		RequestCount: item.RequestCount, CostMicroUSD: item.CostMicroUSD,
		KnownSavedCostMicroUSD: item.KnownSavedCostMicroUSD, SavedCostMicroUSD: item.SavedCostMicroUSD,
		AvoidedProviderCallRequests:     item.AvoidedProviderCallRequests,
		ProtectedRequests:               item.ProtectedRequests,
		HighPerformanceRequests:         item.HighPerformanceRequests,
		HighPerformanceEligibleRequests: item.HighPerformanceEligibleRequests,
	}
}

func analyticsPolicyImpactSurfaceTotals(items []invocationlog.AnalyticsPolicyImpactSurfaceTotal) []analyticsPolicyImpactSurfaceTotalResponse {
	result := make([]analyticsPolicyImpactSurfaceTotalResponse, 0, len(items))
	for _, item := range items {
		result = append(result, analyticsPolicyImpactSurfaceTotalResponse{
			Surface: item.Surface, RequestCount: item.RequestCount, CostMicroUSD: item.CostMicroUSD,
			KnownSavedCostMicroUSD: item.KnownSavedCostMicroUSD, SavedCostMicroUSD: item.SavedCostMicroUSD,
			AvoidedProviderCallRequests:     item.AvoidedProviderCallRequests,
			ProtectedRequests:               item.ProtectedRequests,
			HighPerformanceRequests:         item.HighPerformanceRequests,
			HighPerformanceEligibleRequests: item.HighPerformanceEligibleRequests,
		})
	}
	return result
}

func analyticsPolicyImpactOutcomes(items []invocationlog.AnalyticsPolicyImpactOutcome) []analyticsPolicyImpactOutcomeResponse {
	result := make([]analyticsPolicyImpactOutcomeResponse, 0, len(items))
	for _, item := range items {
		result = append(result, analyticsPolicyImpactOutcomeResponse{
			Surface: item.Surface, Outcome: item.Outcome, RequestCount: item.RequestCount,
		})
	}
	return result
}

func analyticsPolicyImpactRoutingRoles(items []invocationlog.AnalyticsPolicyImpactRoutingRole) []analyticsPolicyImpactRoutingRoleResponse {
	result := make([]analyticsPolicyImpactRoutingRoleResponse, 0, len(items))
	for _, item := range items {
		result = append(result, analyticsPolicyImpactRoutingRoleResponse{
			Surface: item.Surface, Scheme: item.Scheme, Role: item.Role, RequestCount: item.RequestCount,
		})
	}
	return result
}

func analyticsPolicyImpactModelBuckets(items []invocationlog.AnalyticsPolicyImpactModelBucket) []analyticsPolicyImpactModelBucketResponse {
	result := make([]analyticsPolicyImpactModelBucketResponse, 0, len(items))
	for _, item := range items {
		result = append(result, analyticsPolicyImpactModelBucketResponse{
			Surface: item.Surface, PeriodStart: item.PeriodStart, PeriodEnd: item.PeriodEnd,
			Provider: item.Provider, Model: item.Model, RequestCount: item.RequestCount,
		})
	}
	return result
}

func analyticsPolicyImpactUsageSources(items []invocationlog.AnalyticsPolicyImpactUsageSource) []analyticsPolicyImpactUsageSourceResponse {
	result := make([]analyticsPolicyImpactUsageSourceResponse, 0, len(items))
	for _, item := range items {
		result = append(result, analyticsPolicyImpactUsageSourceResponse{
			Surface: item.Surface, ProjectID: stringPointerOrNil(item.ProjectID),
			RequestCount: item.RequestCount, CostMicroUSD: item.CostMicroUSD,
		})
	}
	return result
}

func analyticsMetricCoverage(items []invocationlog.AnalyticsMetricCoverage) []analyticsMetricCoverageResponse {
	result := make([]analyticsMetricCoverageResponse, 0, len(items))
	for _, item := range items {
		result = append(result, analyticsMetricCoverageResponse{
			Metric: item.Metric, Surface: item.Surface, Status: item.Status,
			KnownRequestCount: item.KnownRequestCount, UnknownRequestCount: item.UnknownRequestCount,
		})
	}
	return result
}
