package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

type AnalyticsPerformanceReader struct {
	client *queryClient
}

func NewAnalyticsPerformanceReader(cfg QueryConfig) (*AnalyticsPerformanceReader, error) {
	client, err := newQueryClient(cfg)
	if err != nil {
		return nil, err
	}
	return &AnalyticsPerformanceReader{client: client}, nil
}

func (r *AnalyticsPerformanceReader) GetAnalyticsPerformance(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error) {
	startedAt := time.Now()
	readStatus := "error"
	defer func() {
		if r != nil && r.client != nil && r.client.metricsRegistry != nil {
			r.client.metricsRegistry.ClickHouseAnalyticsRead(metrics.ClickHouseAnalyticsRead{
				Endpoint:        "performance",
				Status:          readStatus,
				DurationSeconds: time.Since(startedAt).Seconds(),
			})
		}
	}()
	normalized, err := invocationlog.NormalizeAnalyticsPerformanceFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsPerformanceFields{}, err
	}
	normalized.Surface = invocationlog.AnalyticsSurfaceProjectApplication

	var summaries []invocationlog.AnalyticsSurfaceSummary
	var providerModels []invocationlog.AnalyticsProviderModelPerformance
	var providerLatencies []invocationlog.AnalyticsProviderLatency
	var distribution []invocationlog.AnalyticsLatencyDistributionBucket
	var slowest []invocationlog.AnalyticsSlowRequest

	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		var queryErr error
		summaries, queryErr = r.querySummaries(groupCtx, normalized)
		return queryErr
	})
	group.Go(func() error {
		var queryErr error
		providerModels, queryErr = r.queryProviderModels(groupCtx, normalized)
		return queryErr
	})
	group.Go(func() error {
		var queryErr error
		providerLatencies, queryErr = r.queryProviderLatencies(groupCtx, normalized)
		return queryErr
	})
	group.Go(func() error {
		var queryErr error
		distribution, queryErr = r.queryDistribution(groupCtx, normalized)
		return queryErr
	})
	group.Go(func() error {
		var queryErr error
		slowest, queryErr = r.querySlowest(groupCtx, normalized)
		return queryErr
	})
	if err := group.Wait(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			readStatus = "timeout"
		}
		return invocationlog.AnalyticsPerformanceFields{}, err
	}
	readStatus = "success"

	if len(summaries) == 0 {
		summaries = []invocationlog.AnalyticsSurfaceSummary{{Surface: invocationlog.AnalyticsSurfaceProjectApplication}}
	}
	summary := summaries[0].Summary
	summary.ThroughputPerMinute = throughput(summary.TotalRequests, normalized.From, normalized.To)
	lastEventAt := summaries[0].LastEventAt
	generatedAt := time.Now().UTC()
	bucketConfig := invocationlog.TimeSeriesBucketConfigForRange(normalized.From, normalized.To)
	return invocationlog.AnalyticsPerformanceFields{
		Summary:                  summary,
		SurfaceSummaries:         summaries,
		ProviderModelPerformance: providerModels,
		P95LatencyByProvider:     providerLatencies,
		LatencyDistribution:      fillProjectDistribution(normalized, distribution),
		SlowestRequests:          slowest,
		BucketInterval:           bucketConfig.IntervalLabel,
		ExpectedBucketCount:      bucketConfig.ExpectedBucketCount,
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           "clickhouse_project_application",
			RecordCount:      summary.TotalRequests,
			LastLogCreatedAt: lastEventAt,
			GeneratedAt:      generatedAt,
			LastAggregatedAt: generatedAt,
			IsStale:          false,
		},
	}, nil
}

type performanceSummaryRow struct {
	TotalRequests       int64    `json:"total_requests"`
	AvgLatencyMs        *float64 `json:"avg_latency_ms"`
	P95LatencyMs        *float64 `json:"p95_latency_ms"`
	P99LatencyMs        *float64 `json:"p99_latency_ms"`
	SystemErrorRequests int64    `json:"system_error_requests"`
	ErrorRate           *float64 `json:"error_rate"`
	LastEventAtMS       *int64   `json:"last_event_at_ms"`
}

func (r *AnalyticsPerformanceReader) querySummaries(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsSurfaceSummary, error) {
	rows, err := queryJSONEachRow[performanceSummaryRow](ctx, r.client, fmt.Sprintf(`
%s
SELECT
  sum(requests) AS total_requests,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    sumIf(latency_sum_ms, latency_eligible = 1) / sumIf(requests, latency_eligible = 1)) AS avg_latency_ms,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 2)) AS p95_latency_ms,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 3)) AS p99_latency_ms,
  sum(system_error_requests) AS system_error_requests,
  if(sum(requests) = 0, NULL, sum(system_error_requests) / sum(requests)) AS error_rate,
  if(sum(requests) = 0, NULL, toUnixTimestamp64Milli(max(last_created_at))) AS last_event_at_ms
FROM filtered
FORMAT JSONEachRow`, r.filteredCTE(filter)), performanceParameters(filter))
	if err != nil {
		return nil, err
	}
	if len(rows) != 1 {
		return nil, unavailableError(fmt.Errorf("unexpected performance summary row count %d", len(rows)))
	}
	row := rows[0]
	return []invocationlog.AnalyticsSurfaceSummary{{
		Surface: invocationlog.AnalyticsSurfaceProjectApplication,
		Summary: invocationlog.AnalyticsPerformanceSummary{
			AvgLatencyMs:        row.AvgLatencyMs,
			P95LatencyMs:        row.P95LatencyMs,
			P99LatencyMs:        row.P99LatencyMs,
			ThroughputPerMinute: throughput(row.TotalRequests, filter.From, filter.To),
			ErrorRate:           row.ErrorRate,
			SystemErrorRequests: row.SystemErrorRequests,
			TotalRequests:       row.TotalRequests,
		},
		LastEventAt: millisTime(row.LastEventAtMS),
	}}, nil
}

type providerModelRow struct {
	Provider          string   `json:"provider"`
	Model             string   `json:"model"`
	Requests          int64    `json:"requests"`
	AvgLatencyMs      *float64 `json:"avg_latency_ms"`
	P95LatencyMs      *float64 `json:"p95_latency_ms"`
	P99LatencyMs      *float64 `json:"p99_latency_ms"`
	ErrorRate         *float64 `json:"error_rate"`
	TotalCostMicroUSD int64    `json:"total_cost_micro_usd"`
	CacheHitRate      *float64 `json:"cache_hit_rate"`
}

func (r *AnalyticsPerformanceReader) queryProviderModels(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsProviderModelPerformance, error) {
	rows, err := queryJSONEachRow[providerModelRow](ctx, r.client, fmt.Sprintf(`
%s
SELECT
  provider,
  model,
  sum(requests) AS requests,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    sumIf(latency_sum_ms, latency_eligible = 1) / sumIf(requests, latency_eligible = 1)) AS avg_latency_ms,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 2)) AS p95_latency_ms,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 3)) AS p99_latency_ms,
  sum(system_error_requests) / sum(requests) AS error_rate,
  sum(cost_micro_usd) AS total_cost_micro_usd,
  sumIf(requests, cache_outcome = 'hit') / sum(requests) AS cache_hit_rate
FROM filtered
WHERE provider != '' AND model != ''
GROUP BY provider, model
ORDER BY requests DESC, provider, model
LIMIT 100
FORMAT JSONEachRow`, r.filteredCTE(filter)), performanceParameters(filter))
	if err != nil {
		return nil, err
	}
	items := make([]invocationlog.AnalyticsProviderModelPerformance, 0, len(rows))
	for _, row := range rows {
		item := invocationlog.AnalyticsProviderModelPerformance{
			Surface:           invocationlog.AnalyticsSurfaceProjectApplication,
			Provider:          row.Provider,
			Model:             row.Model,
			Requests:          row.Requests,
			AvgLatencyMs:      row.AvgLatencyMs,
			P95LatencyMs:      row.P95LatencyMs,
			P99LatencyMs:      row.P99LatencyMs,
			ErrorRate:         row.ErrorRate,
			TotalCostMicroUSD: row.TotalCostMicroUSD,
			TotalCostUSD:      invocationlog.FormatCostUSDFromMicroUSD(row.TotalCostMicroUSD),
			CacheHitRate:      row.CacheHitRate,
		}
		if row.Requests > 0 {
			value := float64(row.TotalCostMicroUSD) / 1_000_000 / float64(row.Requests)
			item.CostPerRequestUSD = &value
		}
		items = append(items, item)
	}
	return items, nil
}

type providerLatencyRow struct {
	Provider     string   `json:"provider"`
	P95LatencyMs *float64 `json:"p95_latency_ms"`
	Requests     int64    `json:"requests"`
}

func (r *AnalyticsPerformanceReader) queryProviderLatencies(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsProviderLatency, error) {
	rows, err := queryJSONEachRow[providerLatencyRow](ctx, r.client, fmt.Sprintf(`
%s
SELECT
  provider,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 2)) AS p95_latency_ms,
  sum(requests) AS requests
FROM filtered
WHERE provider != ''
GROUP BY provider
ORDER BY p95_latency_ms DESC, requests DESC, provider
LIMIT 20
FORMAT JSONEachRow`, r.filteredCTE(filter)), performanceParameters(filter))
	if err != nil {
		return nil, err
	}
	items := make([]invocationlog.AnalyticsProviderLatency, 0, len(rows))
	for _, row := range rows {
		items = append(items, invocationlog.AnalyticsProviderLatency{
			Surface:      invocationlog.AnalyticsSurfaceProjectApplication,
			Provider:     row.Provider,
			P95LatencyMs: row.P95LatencyMs,
			Requests:     row.Requests,
		})
	}
	return items, nil
}

type distributionRow struct {
	BucketMS   int64    `json:"bucket_ms"`
	Requests   int64    `json:"requests"`
	P50Latency *float64 `json:"p50_latency_ms"`
	P95Latency *float64 `json:"p95_latency_ms"`
	P99Latency *float64 `json:"p99_latency_ms"`
}

func (r *AnalyticsPerformanceReader) queryDistribution(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsLatencyDistributionBucket, error) {
	bucket := clickHouseBucketExpressionForColumn(invocationlog.TimeSeriesBucketConfigForRange(filter.From, filter.To), "bucket")
	rows, err := queryJSONEachRow[distributionRow](ctx, r.client, fmt.Sprintf(`
%s
SELECT
  toInt64(toUnixTimestamp(%s)) * 1000 AS bucket_ms,
  sum(requests) AS requests,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 1)) AS p50_latency_ms,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 2)) AS p95_latency_ms,
  if(sumIf(requests, latency_eligible = 1) = 0, NULL,
    arrayElement(quantilesTDigestMergeIf(0.50, 0.95, 0.99)(latency_quantiles, latency_eligible = 1), 3)) AS p99_latency_ms
FROM filtered
GROUP BY %s
ORDER BY bucket_ms
FORMAT JSONEachRow`, r.filteredCTE(filter), bucket, bucket), performanceParameters(filter))
	if err != nil {
		return nil, err
	}
	items := make([]invocationlog.AnalyticsLatencyDistributionBucket, 0, len(rows))
	for _, row := range rows {
		items = append(items, invocationlog.AnalyticsLatencyDistributionBucket{
			Surface:      invocationlog.AnalyticsSurfaceProjectApplication,
			Bucket:       time.UnixMilli(row.BucketMS).UTC(),
			P50LatencyMs: row.P50Latency,
			P95LatencyMs: row.P95Latency,
			P99LatencyMs: row.P99Latency,
			Requests:     row.Requests,
		})
	}
	return items, nil
}

type slowRequestRow struct {
	RequestID      string `json:"request_id"`
	ProjectID      string `json:"project_id"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	LatencyMs      int64  `json:"latency_ms"`
	HTTPStatus     int    `json:"http_status"`
	TerminalStatus string `json:"terminal_status"`
	CreatedAtMS    int64  `json:"created_at_ms"`
}

func (r *AnalyticsPerformanceReader) querySlowest(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsSlowRequest, error) {
	rows, err := queryJSONEachRow[slowRequestRow](ctx, r.client, fmt.Sprintf(`
%s
SELECT
  request_id,
  project_id,
  if(provider = '', 'unknown', provider) AS provider,
  if(model = '', 'unknown', model) AS model,
  latency_ms,
  http_status,
  terminal_status,
  toUnixTimestamp64Milli(created_at) AS created_at_ms
FROM filtered
WHERE latency_eligible
ORDER BY latency_ms DESC, created_at DESC, request_id DESC
LIMIT 10
FORMAT JSONEachRow`, r.timeFilteredCTE(filter)), performanceParameters(filter))
	if err != nil {
		return nil, err
	}
	items := make([]invocationlog.AnalyticsSlowRequest, 0, len(rows))
	for _, row := range rows {
		items = append(items, invocationlog.AnalyticsSlowRequest{
			Surface:        invocationlog.AnalyticsSurfaceProjectApplication,
			RequestID:      row.RequestID,
			ProjectID:      row.ProjectID,
			Provider:       row.Provider,
			Model:          row.Model,
			LatencyMs:      row.LatencyMs,
			HTTPStatus:     row.HTTPStatus,
			TerminalStatus: row.TerminalStatus,
			CreatedAt:      time.UnixMilli(row.CreatedAtMS).UTC(),
		})
	}
	return items, nil
}

func (r *AnalyticsPerformanceReader) filteredCTE(filter invocationlog.AnalyticsPerformanceFilter) string {
	where := []string{
		"tenant_id = {tenant_id:UUID}",
		"bucket >= parseDateTime64BestEffort({from:String}, 3, 'UTC')",
		"bucket < parseDateTime64BestEffort({to:String}, 3, 'UTC')",
	}
	if filter.ProjectID != "" {
		where = append(where, "project_id = {project_id:UUID}")
	}
	if filter.Provider != "" {
		where = append(where, "provider = {provider:String}")
	}
	if filter.Model != "" {
		where = append(where, "model = {model:String}")
	}
	return fmt.Sprintf(`WITH filtered AS (
  SELECT *
  FROM %s.%s
  WHERE %s
)`, r.client.database, r.client.dashboardRollupTable(), strings.Join(where, "\n    AND "))
}

func (r *AnalyticsPerformanceReader) timeFilteredCTE(filter invocationlog.AnalyticsPerformanceFilter) string {
	where := []string{
		"tenant_id = {tenant_id:UUID}",
		"created_at >= parseDateTime64BestEffort({from:String}, 3, 'UTC')",
		"created_at < parseDateTime64BestEffort({to:String}, 3, 'UTC')",
	}
	if filter.ProjectID != "" {
		where = append(where, "project_id = {project_id:UUID}")
	}
	if filter.Provider != "" {
		where = append(where, "provider = {provider:String}")
	}
	if filter.Model != "" {
		where = append(where, "model = {model:String}")
	}
	return fmt.Sprintf(`WITH filtered AS (
  SELECT
    request_id,
    project_id,
    provider,
    model,
    terminal_status,
    http_status,
    latency_ms,
    created_at,
    terminal_status IN ('success', 'failed') AS latency_eligible
  FROM %s.%s FINAL
  WHERE %s
)`, r.client.database, r.client.timeTable(), strings.Join(where, "\n    AND "))
}

func performanceParameters(filter invocationlog.AnalyticsPerformanceFilter) map[string]string {
	parameters := map[string]string{
		"tenant_id": filter.TenantID,
		"from":      filter.From.UTC().Format(time.RFC3339Nano),
		"to":        filter.To.UTC().Format(time.RFC3339Nano),
	}
	if filter.ProjectID != "" {
		parameters["project_id"] = filter.ProjectID
	}
	if filter.Provider != "" {
		parameters["provider"] = filter.Provider
	}
	if filter.Model != "" {
		parameters["model"] = filter.Model
	}
	return parameters
}

func clickHouseBucketExpression(config invocationlog.TimeSeriesBucketConfig) string {
	return clickHouseBucketExpressionForColumn(config, "created_at")
}

func clickHouseBucketExpressionForColumn(config invocationlog.TimeSeriesBucketConfig, column string) string {
	switch config.Unit {
	case "7second":
		return fmt.Sprintf("toDateTime64(intDiv(toUnixTimestamp(%s), 7) * 7, 3, 'UTC')", column)
	case "minute":
		return fmt.Sprintf("toStartOfMinute(%s, 'UTC')", column)
	case "5minute":
		return fmt.Sprintf("toStartOfInterval(%s, INTERVAL 5 MINUTE, 'UTC')", column)
	case "hour":
		return fmt.Sprintf("toStartOfHour(%s, 'UTC')", column)
	case "day":
		return fmt.Sprintf("toStartOfDay(%s, 'UTC')", column)
	default:
		return fmt.Sprintf("toStartOfSecond(%s, 'UTC')", column)
	}
}

func fillProjectDistribution(filter invocationlog.AnalyticsPerformanceFilter, buckets []invocationlog.AnalyticsLatencyDistributionBucket) []invocationlog.AnalyticsLatencyDistributionBucket {
	config := invocationlog.TimeSeriesBucketConfigForRange(filter.From, filter.To)
	if config.ExpectedBucketCount <= 0 {
		return buckets
	}
	byStart := make(map[time.Time]invocationlog.AnalyticsLatencyDistributionBucket, len(buckets))
	for _, bucket := range buckets {
		start := invocationlog.AlignTimeSeriesBucketStart(bucket.Bucket, config)
		bucket.Bucket = start
		byStart[start] = bucket
	}
	filled := make([]invocationlog.AnalyticsLatencyDistributionBucket, 0, config.ExpectedBucketCount)
	lastStart := invocationlog.AlignTimeSeriesBucketStart(filter.To.Add(-time.Nanosecond), config)
	start := lastStart.Add(-time.Duration(config.ExpectedBucketCount-1) * config.Interval)
	for index := 0; index < config.ExpectedBucketCount; index++ {
		bucketStart := start.Add(time.Duration(index) * config.Interval)
		if bucket, ok := byStart[bucketStart]; ok {
			filled = append(filled, bucket)
			continue
		}
		filled = append(filled, invocationlog.AnalyticsLatencyDistributionBucket{
			Surface: invocationlog.AnalyticsSurfaceProjectApplication,
			Bucket:  bucketStart,
		})
	}
	return filled
}

func millisTime(value *int64) *time.Time {
	if value == nil {
		return nil
	}
	parsed := time.UnixMilli(*value).UTC()
	return &parsed
}

func throughput(total int64, from time.Time, to time.Time) *float64 {
	minutes := to.Sub(from).Minutes()
	if total <= 0 || minutes <= 0 {
		return nil
	}
	value := float64(total) / minutes
	return &value
}
