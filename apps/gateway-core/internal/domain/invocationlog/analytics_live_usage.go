package invocationlog

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

const (
	AnalyticsLiveUsageTrendUp     = "up"
	AnalyticsLiveUsageTrendDown   = "down"
	AnalyticsLiveUsageTrendStable = "stable"

	AnalyticsLiveUsageCurrentWindowSeconds = 5
	AnalyticsLiveUsageDeltaWindowSeconds   = 10
	AnalyticsLiveUsageProjectLimit         = 10
)

type AnalyticsLiveUsageFilter struct {
	TenantID  string
	ProjectID string
	From      time.Time
	To        time.Time
}

type AnalyticsLiveUsageSummary struct {
	RequestCount            int64
	ProcessedRequestCount   int64
	RateLimitedRequestCount int64
	CurrentIncomingRPS      float64
	PeakIncomingRPS         float64
}

type AnalyticsLiveUsageBucket struct {
	PeriodStart             time.Time
	PeriodEnd               time.Time
	IncomingRPS             float64
	ProcessedRPS            float64
	RateLimitedRPS          float64
	RequestCount            int64
	ProcessedRequestCount   int64
	RateLimitedRequestCount int64
}

type AnalyticsLiveUsageProject struct {
	ProjectID               string
	RequestCount            int64
	ProcessedRequestCount   int64
	RateLimitedRequestCount int64
	CurrentIncomingRPS      float64
	DeltaPercent            *float64
	Trend                   string
}

type AnalyticsLiveUsageFields struct {
	BucketIntervalSeconds int
	CurrentWindowSeconds  int
	DeltaWindowSeconds    int
	Summary               AnalyticsLiveUsageSummary
	Buckets               []AnalyticsLiveUsageBucket
	Projects              []AnalyticsLiveUsageProject
	RateLimitStartedAt    *time.Time
	DataFreshness         DashboardDataFreshness
}

func NormalizeAnalyticsLiveUsageFilter(filter AnalyticsLiveUsageFilter) (AnalyticsLiveUsageFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.From = filter.From.UTC()
	filter.To = filter.To.UTC()

	if filter.TenantID == "" {
		return AnalyticsLiveUsageFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
	if err := validateTimeRange(filter.From, filter.To); err != nil {
		return AnalyticsLiveUsageFilter{}, err
	}
	if !filter.To.Equal(filter.To.Truncate(time.Second)) {
		return AnalyticsLiveUsageFilter{}, fmt.Errorf("%w: live usage range must end on a completed UTC second", ErrInvalidLogQuery)
	}
	if _, ok := AnalyticsLiveUsageRange(filter); !ok {
		return AnalyticsLiveUsageFilter{}, fmt.Errorf("%w: live usage range must be 15m, 1h, 1d, or 1w", ErrInvalidLogQuery)
	}

	return filter, nil
}

func AnalyticsLiveUsageRange(filter AnalyticsLiveUsageFilter) (string, bool) {
	switch filter.To.Sub(filter.From) {
	case 15 * time.Minute:
		return "15m", true
	case time.Hour:
		return "1h", true
	case 24 * time.Hour:
		return "1d", true
	case 7 * 24 * time.Hour:
		return "1w", true
	default:
		return "", false
	}
}

func AnalyticsLiveUsageBucketInterval(filter AnalyticsLiveUsageFilter) time.Duration {
	duration := filter.To.Sub(filter.From)
	switch {
	case duration <= 15*time.Minute+time.Second:
		return 5 * time.Second
	case duration <= time.Hour+time.Second:
		return 30 * time.Second
	case duration <= 24*time.Hour+time.Second:
		return 5 * time.Minute
	default:
		return 30 * time.Minute
	}
}

func BuildAnalyticsLiveUsageProject(
	projectID string,
	requestCount int64,
	processedRequestCount int64,
	rateLimitedRequestCount int64,
	currentWindowRequests int64,
	currentDeltaRequests int64,
	previousDeltaRequests int64,
) AnalyticsLiveUsageProject {
	trend, deltaPercent := analyticsLiveUsageTrend(currentDeltaRequests, previousDeltaRequests)
	return AnalyticsLiveUsageProject{
		ProjectID:               strings.TrimSpace(projectID),
		RequestCount:            requestCount,
		ProcessedRequestCount:   processedRequestCount,
		RateLimitedRequestCount: rateLimitedRequestCount,
		CurrentIncomingRPS:      float64(currentWindowRequests) / AnalyticsLiveUsageCurrentWindowSeconds,
		DeltaPercent:            deltaPercent,
		Trend:                   trend,
	}
}

func SortAnalyticsLiveUsageProjects(items []AnalyticsLiveUsageProject) []AnalyticsLiveUsageProject {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].RequestCount != items[j].RequestCount {
			return items[i].RequestCount > items[j].RequestCount
		}
		return items[i].ProjectID < items[j].ProjectID
	})
	if len(items) > AnalyticsLiveUsageProjectLimit {
		return items[:AnalyticsLiveUsageProjectLimit]
	}
	return items
}

func FillAnalyticsLiveUsageBuckets(
	filter AnalyticsLiveUsageFilter,
	interval time.Duration,
	items []AnalyticsLiveUsageBucket,
) ([]AnalyticsLiveUsageBucket, *time.Time) {
	if interval <= 0 || !filter.To.After(filter.From) {
		return nil, nil
	}

	byStart := make(map[time.Time]AnalyticsLiveUsageBucket, len(items))
	for _, item := range items {
		start := item.PeriodStart.UTC().Truncate(interval)
		item.PeriodStart = start
		item.PeriodEnd = start.Add(interval)
		byStart[start] = item
	}

	first := filter.From.Truncate(interval)
	filled := make([]AnalyticsLiveUsageBucket, 0, int(math.Ceil(filter.To.Sub(first).Seconds()/interval.Seconds())))
	var rateLimitStartedAt *time.Time
	previousRateLimited := int64(0)
	hasPrevious := false

	for start := first; start.Before(filter.To); start = start.Add(interval) {
		item := byStart[start]
		item.PeriodStart = start
		item.PeriodEnd = start.Add(interval)
		effectiveStart := start
		if filter.From.After(effectiveStart) {
			effectiveStart = filter.From
		}
		effectiveEnd := item.PeriodEnd
		if filter.To.Before(effectiveEnd) {
			effectiveEnd = filter.To
		}
		seconds := effectiveEnd.Sub(effectiveStart).Seconds()
		if seconds > 0 {
			item.IncomingRPS = float64(item.RequestCount) / seconds
			item.ProcessedRPS = float64(item.ProcessedRequestCount) / seconds
			item.RateLimitedRPS = float64(item.RateLimitedRequestCount) / seconds
		}
		if rateLimitStartedAt == nil && (!hasPrevious || previousRateLimited == 0) && item.RateLimitedRequestCount > 0 {
			value := start
			rateLimitStartedAt = &value
		}
		previousRateLimited = item.RateLimitedRequestCount
		hasPrevious = true
		filled = append(filled, item)
	}

	return filled, rateLimitStartedAt
}

func analyticsLiveUsageTrend(current, previous int64) (string, *float64) {
	if previous == 0 {
		if current > 0 {
			return AnalyticsLiveUsageTrendUp, nil
		}
		value := 0.0
		return AnalyticsLiveUsageTrendStable, &value
	}

	delta := (float64(current-previous) / float64(previous)) * 100
	if math.Abs(delta) < 1 {
		return AnalyticsLiveUsageTrendStable, &delta
	}
	if delta > 0 {
		return AnalyticsLiveUsageTrendUp, &delta
	}
	return AnalyticsLiveUsageTrendDown, &delta
}
