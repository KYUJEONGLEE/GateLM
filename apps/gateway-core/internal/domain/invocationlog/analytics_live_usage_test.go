package invocationlog

import (
	"testing"
	"time"
)

func TestAnalyticsLiveUsageRangeAndBucketInterval(t *testing.T) {
	to := time.Date(2026, 7, 24, 3, 0, 0, 0, time.UTC)
	cases := []struct {
		rangeValue string
		duration   time.Duration
		interval   time.Duration
	}{
		{rangeValue: "15m", duration: 15 * time.Minute, interval: 5 * time.Second},
		{rangeValue: "1h", duration: time.Hour, interval: 30 * time.Second},
		{rangeValue: "1d", duration: 24 * time.Hour, interval: 5 * time.Minute},
		{rangeValue: "1w", duration: 7 * 24 * time.Hour, interval: 30 * time.Minute},
	}

	for _, tc := range cases {
		t.Run(tc.rangeValue, func(t *testing.T) {
			filter, err := NormalizeAnalyticsLiveUsageFilter(AnalyticsLiveUsageFilter{
				TenantID: "tenant-1",
				From:     to.Add(-tc.duration),
				To:       to,
			})
			if err != nil {
				t.Fatalf("normalize filter: %v", err)
			}
			if got, ok := AnalyticsLiveUsageRange(filter); !ok || got != tc.rangeValue {
				t.Fatalf("expected range %q, got %q (%v)", tc.rangeValue, got, ok)
			}
			if got := AnalyticsLiveUsageBucketInterval(filter); got != tc.interval {
				t.Fatalf("expected interval %s, got %s", tc.interval, got)
			}
		})
	}

	if _, err := NormalizeAnalyticsLiveUsageFilter(AnalyticsLiveUsageFilter{
		TenantID: "tenant-1",
		From:     to.Add(-2 * time.Hour),
		To:       to,
	}); err == nil {
		t.Fatal("expected non-whitelisted duration to fail")
	}
	if _, err := NormalizeAnalyticsLiveUsageFilter(AnalyticsLiveUsageFilter{
		TenantID: "tenant-1",
		From:     to.Add(-15 * time.Minute).Add(500 * time.Millisecond),
		To:       to.Add(500 * time.Millisecond),
	}); err == nil {
		t.Fatal("expected incomplete end second to fail")
	}
}

func TestAnalyticsLiveUsageProjectTrendAndStableOrdering(t *testing.T) {
	newTraffic := BuildAnalyticsLiveUsageProject("project-b", 10, 10, 0, 5, 10, 0)
	if newTraffic.Trend != AnalyticsLiveUsageTrendUp || newTraffic.DeltaPercent != nil {
		t.Fatalf("expected new traffic trend, got %+v", newTraffic)
	}
	stable := BuildAnalyticsLiveUsageProject("project-c", 9, 9, 0, 0, 100, 100)
	if stable.Trend != AnalyticsLiveUsageTrendStable || stable.DeltaPercent == nil || *stable.DeltaPercent != 0 {
		t.Fatalf("expected stable trend, got %+v", stable)
	}
	down := BuildAnalyticsLiveUsageProject("project-a", 10, 8, 2, 0, 50, 100)
	if down.Trend != AnalyticsLiveUsageTrendDown || down.DeltaPercent == nil || *down.DeltaPercent != -50 {
		t.Fatalf("expected down trend, got %+v", down)
	}

	sorted := SortAnalyticsLiveUsageProjects([]AnalyticsLiveUsageProject{newTraffic, stable, down})
	if sorted[0].ProjectID != "project-a" || sorted[1].ProjectID != "project-b" || sorted[2].ProjectID != "project-c" {
		t.Fatalf("expected request count and project id ordering, got %+v", sorted)
	}
}

func TestFillAnalyticsLiveUsageBucketsNormalizesRatesAndMarksObservedLimitStart(t *testing.T) {
	from := time.Date(2026, 7, 24, 3, 0, 0, 0, time.UTC)
	filter := AnalyticsLiveUsageFilter{
		TenantID: "tenant-1",
		From:     from,
		To:       from.Add(15 * time.Minute),
	}
	buckets, marker := FillAnalyticsLiveUsageBuckets(filter, 5*time.Second, []AnalyticsLiveUsageBucket{
		{
			PeriodStart:             from.Add(5 * time.Second),
			RequestCount:            10,
			ProcessedRequestCount:   6,
			RateLimitedRequestCount: 4,
		},
	})
	if len(buckets) != 180 {
		t.Fatalf("expected 180 buckets, got %d", len(buckets))
	}
	if buckets[1].IncomingRPS != 2 || buckets[1].ProcessedRPS != 1.2 || buckets[1].RateLimitedRPS != 0.8 {
		t.Fatalf("unexpected normalized rates: %+v", buckets[1])
	}
	if marker == nil || !marker.Equal(from.Add(5*time.Second)) {
		t.Fatalf("expected observed rate-limit marker, got %v", marker)
	}

	firstBucket, firstMarker := FillAnalyticsLiveUsageBuckets(filter, 5*time.Second, []AnalyticsLiveUsageBucket{
		{
			PeriodStart:             from,
			RequestCount:            3,
			ProcessedRequestCount:   2,
			RateLimitedRequestCount: 1,
		},
	})
	if len(firstBucket) != 180 {
		t.Fatalf("expected 180 first-observation buckets, got %d", len(firstBucket))
	}
	if firstMarker == nil || !firstMarker.Equal(from) {
		t.Fatalf("expected first observed bucket to mark rate-limit start, got %v", firstMarker)
	}
}
