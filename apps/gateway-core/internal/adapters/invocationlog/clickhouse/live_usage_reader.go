package clickhouse

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type analyticsLiveUsageSummaryRow struct {
	Requests        int64   `json:"requests"`
	Processed       int64   `json:"processed"`
	RateLimited     int64   `json:"rate_limited"`
	CurrentRequests int64   `json:"current_requests"`
	PeakRPS         float64 `json:"peak_rps"`
	LastMS          *int64  `json:"last_ms"`
}

type analyticsLiveUsageBucketRow struct {
	BucketMS    int64 `json:"bucket_ms"`
	Requests    int64 `json:"requests"`
	Processed   int64 `json:"processed"`
	RateLimited int64 `json:"rate_limited"`
}

type analyticsLiveUsageProjectRow struct {
	ProjectID       string `json:"project_id_text"`
	Requests        int64  `json:"requests"`
	Processed       int64  `json:"processed"`
	RateLimited     int64  `json:"rate_limited"`
	CurrentRequests int64  `json:"current_requests"`
	CurrentDelta    int64  `json:"current_delta"`
	PreviousDelta   int64  `json:"previous_delta"`
}

func (r *ProjectReader) GetAnalyticsLiveUsage(
	ctx context.Context,
	filter invocationlog.AnalyticsLiveUsageFilter,
) (invocationlog.AnalyticsLiveUsageFields, error) {
	normalized, err := invocationlog.NormalizeAnalyticsLiveUsageFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsLiveUsageFields{}, err
	}

	var result invocationlog.AnalyticsLiveUsageFields
	err = r.observe(ctx, "live_usage", func(readCtx context.Context) error {
		var readErr error
		result, readErr = r.queryAnalyticsLiveUsage(readCtx, normalized)
		return readErr
	})
	return result, err
}

func (r *ProjectReader) queryAnalyticsLiveUsage(
	ctx context.Context,
	filter invocationlog.AnalyticsLiveUsageFilter,
) (invocationlog.AnalyticsLiveUsageFields, error) {
	where, params := rollupWhere(filter.TenantID, filter.ProjectID, filter.From, filter.To)
	currentTo := filter.To.UTC()
	params["current_from"] = currentTo.Add(-invocationlog.AnalyticsLiveUsageCurrentWindowSeconds * time.Second).Format(time.RFC3339Nano)
	params["current_to"] = currentTo.Format(time.RFC3339Nano)
	params["delta_current_from"] = currentTo.Add(-invocationlog.AnalyticsLiveUsageDeltaWindowSeconds * time.Second).Format(time.RFC3339Nano)
	params["delta_previous_from"] = currentTo.Add(-2 * invocationlog.AnalyticsLiveUsageDeltaWindowSeconds * time.Second).Format(time.RFC3339Nano)

	interval := invocationlog.AnalyticsLiveUsageBucketInterval(filter)
	intervalSeconds := int(interval / time.Second)
	filteredCTE := fmt.Sprintf(
		"WITH filtered AS (SELECT * FROM %s.%s WHERE %s)\n",
		r.client.database,
		r.client.dashboardRollupTable(),
		strings.Join(where, " AND "),
	)

	var summary analyticsLiveUsageSummaryRow
	var bucketRows []analyticsLiveUsageBucketRow
	var projectRows []analyticsLiveUsageProjectRow
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		rows, queryErr := queryJSONEachRow[analyticsLiveUsageSummaryRow](
			groupCtx,
			r.client,
			filteredCTE+`
, per_second AS (
  SELECT
    live.bucket,
    sum(live.requests) AS second_requests,
    sumIf(live.requests, live.terminal_status != 'rate_limited') AS second_processed,
    sumIf(live.requests, live.terminal_status = 'rate_limited') AS second_rate_limited,
    max(live.last_created_at) AS second_last_created_at
  FROM filtered AS live
  GROUP BY live.bucket
)
SELECT
  sum(second_requests) AS requests,
  sum(second_processed) AS processed,
  sum(second_rate_limited) AS rate_limited,
  sumIf(second_requests, bucket >= parseDateTime64BestEffort({current_from:String}, 3, 'UTC')
    AND bucket < parseDateTime64BestEffort({current_to:String}, 3, 'UTC')) AS current_requests,
  if(count() = 0, 0, max(second_requests)) AS peak_rps,
  if(count() = 0, NULL, toUnixTimestamp64Milli(max(second_last_created_at))) AS last_ms
FROM per_second
FORMAT JSONEachRow`,
			params,
		)
		if queryErr != nil {
			return queryErr
		}
		if len(rows) != 1 {
			return unavailableError(fmt.Errorf("unexpected live usage summary row count %d", len(rows)))
		}
		summary = rows[0]
		return nil
	})
	group.Go(func() error {
		query := filteredCTE + fmt.Sprintf(`
SELECT
  toUnixTimestamp(toStartOfInterval(live.bucket, INTERVAL %d SECOND, 'UTC')) * 1000 AS bucket_ms,
  sum(live.requests) AS requests,
  sumIf(live.requests, live.terminal_status != 'rate_limited') AS processed,
  sumIf(live.requests, live.terminal_status = 'rate_limited') AS rate_limited
FROM filtered AS live
GROUP BY toStartOfInterval(live.bucket, INTERVAL %d SECOND, 'UTC')
ORDER BY bucket_ms
FORMAT JSONEachRow`, intervalSeconds, intervalSeconds)
		rows, queryErr := queryJSONEachRow[analyticsLiveUsageBucketRow](groupCtx, r.client, query, params)
		if queryErr == nil {
			bucketRows = rows
		}
		return queryErr
	})
	group.Go(func() error {
		rows, queryErr := queryJSONEachRow[analyticsLiveUsageProjectRow](
			groupCtx,
			r.client,
			filteredCTE+`
SELECT
  toString(live.project_id) AS project_id_text,
  sum(live.requests) AS requests,
  sumIf(live.requests, live.terminal_status != 'rate_limited') AS processed,
  sumIf(live.requests, live.terminal_status = 'rate_limited') AS rate_limited,
  sumIf(live.requests, live.bucket >= parseDateTime64BestEffort({current_from:String}, 3, 'UTC')
    AND live.bucket < parseDateTime64BestEffort({current_to:String}, 3, 'UTC')) AS current_requests,
  sumIf(live.requests, live.bucket >= parseDateTime64BestEffort({delta_current_from:String}, 3, 'UTC')
    AND live.bucket < parseDateTime64BestEffort({current_to:String}, 3, 'UTC')) AS current_delta,
  sumIf(live.requests, live.bucket >= parseDateTime64BestEffort({delta_previous_from:String}, 3, 'UTC')
    AND live.bucket < parseDateTime64BestEffort({delta_current_from:String}, 3, 'UTC')) AS previous_delta
FROM filtered AS live
GROUP BY live.project_id
ORDER BY requests DESC, project_id_text ASC
LIMIT `+strconv.Itoa(invocationlog.AnalyticsLiveUsageProjectLimit)+`
FORMAT JSONEachRow`,
			params,
		)
		if queryErr == nil {
			projectRows = rows
		}
		return queryErr
	})
	if err := group.Wait(); err != nil {
		return invocationlog.AnalyticsLiveUsageFields{}, err
	}

	buckets := make([]invocationlog.AnalyticsLiveUsageBucket, 0, len(bucketRows))
	for _, row := range bucketRows {
		buckets = append(buckets, invocationlog.AnalyticsLiveUsageBucket{
			PeriodStart:             time.UnixMilli(row.BucketMS).UTC(),
			RequestCount:            row.Requests,
			ProcessedRequestCount:   row.Processed,
			RateLimitedRequestCount: row.RateLimited,
		})
	}
	buckets, rateLimitStartedAt := invocationlog.FillAnalyticsLiveUsageBuckets(filter, interval, buckets)

	projects := make([]invocationlog.AnalyticsLiveUsageProject, 0, len(projectRows))
	for _, row := range projectRows {
		projects = append(projects, invocationlog.BuildAnalyticsLiveUsageProject(
			row.ProjectID,
			row.Requests,
			row.Processed,
			row.RateLimited,
			row.CurrentRequests,
			row.CurrentDelta,
			row.PreviousDelta,
		))
	}
	projects = invocationlog.SortAnalyticsLiveUsageProjects(projects)
	sort.SliceStable(buckets, func(i, j int) bool {
		return buckets[i].PeriodStart.Before(buckets[j].PeriodStart)
	})

	now := time.Now().UTC()
	result := invocationlog.AnalyticsLiveUsageFields{
		BucketIntervalSeconds: intervalSeconds,
		CurrentWindowSeconds:  invocationlog.AnalyticsLiveUsageCurrentWindowSeconds,
		DeltaWindowSeconds:    invocationlog.AnalyticsLiveUsageDeltaWindowSeconds,
		Summary: invocationlog.AnalyticsLiveUsageSummary{
			RequestCount:            summary.Requests,
			ProcessedRequestCount:   summary.Processed,
			RateLimitedRequestCount: summary.RateLimited,
			CurrentIncomingRPS:      float64(summary.CurrentRequests) / invocationlog.AnalyticsLiveUsageCurrentWindowSeconds,
			PeakIncomingRPS:         summary.PeakRPS,
		},
		Buckets:            buckets,
		Projects:           projects,
		RateLimitStartedAt: rateLimitStartedAt,
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           "clickhouse_project_application",
			RecordCount:      summary.Requests,
			GeneratedAt:      now,
			LastAggregatedAt: now,
			IsStale:          false,
		},
	}
	if summary.LastMS != nil {
		last := time.UnixMilli(*summary.LastMS).UTC()
		result.DataFreshness.LastLogCreatedAt = &last
	}
	return result, nil
}
