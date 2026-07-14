package postgres

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestDashboardRollupCoverageRequiresEveryReadyBucketAndNoDirtyBucket(t *testing.T) {
	from := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	aggregatedAt := to.Add(time.Minute)
	db := &fakeQueryer{row: fakeRow{values: []any{
		int64(24),
		int64(24),
		int64(0),
		sql.NullTime{Time: to, Valid: true},
		sql.NullTime{Time: aggregatedAt, Valid: true},
	}}}
	reader := NewQueryReader(db)
	coverage, err := reader.getDashboardRollupCoverage(context.Background(), invocationlog.DashboardOverviewFilter{
		TenantID: testTenantID,
		From:     from,
		To:       to,
	}, dashboardRollupSegment{Grain: "hour", From: from, To: to})
	if err != nil {
		t.Fatalf("expected coverage query to succeed, got %v", err)
	}
	if !coverage.Complete() || coverage.LastAggregatedAt == nil || !coverage.LastAggregatedAt.Equal(aggregatedAt) {
		t.Fatalf("unexpected coverage: %+v", coverage)
	}
	for _, expected := range []string{
		"dashboard_rollup_source_cursors",
		"source = 'project_application'",
		"select caught_up_through",
		"source.ingested_at > source_cursor.caught_up_through",
		"not (select has_unprocessed from unprocessed_source)",
		"from p0_llm_invocation_logs raw_source",
		"covered.state is null",
		"covered.bucket_start + '1 hour'::interval",
		"state.tenant_id = $1::uuid",
		"state.surface = 'project_application'",
		"dashboard_rollup_dirty_buckets",
		"$2 = 'day' and grain = 'hour'",
		"covered.histogram_version = 1",
	} {
		if !strings.Contains(db.query, expected) {
			t.Fatalf("expected coverage query to contain %q, got %s", expected, db.query)
		}
	}
	if len(db.args) != 4 || db.args[0] != testTenantID || db.args[1] != "hour" {
		t.Fatalf("unexpected coverage args: %#v", db.args)
	}
}

func TestDashboardRollupCoverageRejectsPartialOrDirtyState(t *testing.T) {
	for _, values := range [][]any{
		{int64(24), int64(23), int64(0), sql.NullTime{}, sql.NullTime{}},
		{int64(24), int64(24), int64(1), sql.NullTime{}, sql.NullTime{}},
	} {
		db := &fakeQueryer{row: fakeRow{values: values}}
		reader := NewQueryReader(db)
		coverage, err := reader.getDashboardRollupCoverage(context.Background(), invocationlog.DashboardOverviewFilter{
			TenantID: testTenantID,
		}, dashboardRollupSegment{
			Grain: "hour",
			From:  time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC),
			To:    time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC),
		})
		if err != nil {
			t.Fatalf("expected coverage query to succeed, got %v", err)
		}
		if coverage.Complete() {
			t.Fatalf("expected incomplete coverage, got %+v", coverage)
		}
	}
}
