package postgres

import "testing"

func TestDashboardHistogramPercentileMergesBuckets(t *testing.T) {
	first := make([]int64, len(dashboardHistogramUpperBoundsMs))
	second := make([]int64, len(dashboardHistogramUpperBoundsMs))
	first[2] = 5  // <= 100ms
	first[5] = 3  // <= 500ms
	second[5] = 1 // <= 500ms
	second[7] = 1 // <= 1000ms

	if !addDashboardHistograms(first, second) {
		t.Fatal("expected compatible histograms to merge")
	}
	p50 := dashboardHistogramPercentile(first, 0.50)
	p95 := dashboardHistogramPercentile(first, 0.95)
	if p50 == nil || *p50 != 100 {
		t.Fatalf("expected p50 upper bound 100ms, got %v", p50)
	}
	if p95 == nil || *p95 != 1000 {
		t.Fatalf("expected p95 upper bound 1000ms, got %v", p95)
	}
}

func TestDashboardHistogramPercentilePreservesMissingAndRejectsOverflow(t *testing.T) {
	empty := make([]int64, len(dashboardHistogramUpperBoundsMs))
	if got := dashboardHistogramPercentile(empty, 0.95); got != nil {
		t.Fatalf("expected empty histogram percentile to be nil, got %v", *got)
	}
	if got := dashboardHistogramPercentile([]int64{1}, 0.95); got != nil {
		t.Fatalf("expected incompatible histogram percentile to be nil, got %v", *got)
	}

	overflow := make([]int64, len(dashboardHistogramUpperBoundsMs))
	overflow[len(overflow)-1] = 1
	if got := dashboardHistogramPercentile(overflow, 0.99); got != nil {
		t.Fatalf("expected overflow percentile to be unavailable, got %v", *got)
	}
}

func TestAddDashboardHistogramsRejectsInvalidCounts(t *testing.T) {
	destination := make([]int64, len(dashboardHistogramUpperBoundsMs))
	invalid := make([]int64, len(dashboardHistogramUpperBoundsMs))
	invalid[0] = -1
	if addDashboardHistograms(destination, invalid) {
		t.Fatal("expected negative histogram count to be rejected")
	}
	if addDashboardHistograms(destination, []int64{1}) {
		t.Fatal("expected incompatible histogram size to be rejected")
	}
}
