package invocationlog

import (
	"fmt"
	"strings"
	"time"
)

const (
	AnalyticsCoverageComplete    = "complete"
	AnalyticsCoveragePartial     = "partial"
	AnalyticsCoverageUnavailable = "unavailable"
)

type AnalyticsPolicyImpactFilter struct {
	TenantID  string
	ProjectID string
	Period    string
	From      time.Time
	To        time.Time
}

type AnalyticsPolicyImpactTotals struct {
	RequestCount                    int64
	CostMicroUSD                    int64
	KnownSavedCostMicroUSD          int64
	SavedCostMicroUSD               *int64
	AvoidedProviderCallRequests     int64
	ProtectedRequests               int64
	HighPerformanceRequests         int64
	HighPerformanceEligibleRequests int64
}

type AnalyticsPolicyImpactSurfaceTotal struct {
	Surface                         string
	RequestCount                    int64
	CostMicroUSD                    int64
	KnownSavedCostMicroUSD          int64
	SavedCostMicroUSD               *int64
	AvoidedProviderCallRequests     int64
	ProtectedRequests               int64
	HighPerformanceRequests         int64
	HighPerformanceEligibleRequests int64
	SavedCostKnownRequests          int64
	SavedCostUnknownRequests        int64
	MaskingKnownRequests            int64
	MaskingUnknownRequests          int64
	RoutingKnownRequests            int64
	RoutingUnknownRequests          int64
	ModelKnownRequests              int64
	ModelUnknownRequests            int64
	LastEventAt                     *time.Time
}

type AnalyticsPolicyImpactOutcome struct {
	Surface      string
	Outcome      string
	RequestCount int64
}

type AnalyticsPolicyImpactRoutingRole struct {
	Surface      string
	Scheme       string
	Role         string
	RequestCount int64
}

type AnalyticsPolicyImpactModelBucket struct {
	Surface      string
	PeriodStart  time.Time
	PeriodEnd    time.Time
	Provider     string
	Model        string
	RequestCount int64
}

type AnalyticsPolicyImpactUsageSource struct {
	Surface      string
	ProjectID    string
	RequestCount int64
	CostMicroUSD int64
}

type AnalyticsMetricCoverage struct {
	Metric              string
	Surface             string
	Status              string
	KnownRequestCount   int64
	UnknownRequestCount int64
}

type AnalyticsPolicyImpactFields struct {
	Period              string
	BucketInterval      string
	ExpectedBucketCount int
	Totals              AnalyticsPolicyImpactTotals
	SurfaceTotals       []AnalyticsPolicyImpactSurfaceTotal
	PolicyOutcomes      []AnalyticsPolicyImpactOutcome
	RoutingRoles        []AnalyticsPolicyImpactRoutingRole
	ModelBuckets        []AnalyticsPolicyImpactModelBucket
	UsageSources        []AnalyticsPolicyImpactUsageSource
	MetricCoverage      []AnalyticsMetricCoverage
	DataFreshness       DashboardDataFreshness
}

func NormalizeAnalyticsPolicyImpactFilter(filter AnalyticsPolicyImpactFilter) (AnalyticsPolicyImpactFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.Period = strings.ToLower(strings.TrimSpace(filter.Period))
	if filter.Period == "" {
		filter.Period = "hour"
	}
	if filter.Period != "hour" && filter.Period != "day" && filter.Period != "week" && filter.Period != "month" {
		return AnalyticsPolicyImpactFilter{}, fmt.Errorf("%w: period must be hour, day, week, or month", ErrInvalidLogQuery)
	}
	if filter.TenantID == "" {
		return AnalyticsPolicyImpactFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
	if err := validateTimeRange(filter.From, filter.To); err != nil {
		return AnalyticsPolicyImpactFilter{}, err
	}
	return filter, nil
}
