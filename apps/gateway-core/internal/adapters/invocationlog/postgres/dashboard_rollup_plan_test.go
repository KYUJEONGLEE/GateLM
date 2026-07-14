package postgres

import (
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestBuildDashboardRollupPlanUsesClosedHoursAndRawTail(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 23, 0, 0, time.UTC)
	filter := invocationlog.DashboardOverviewFilter{
		From: time.Date(2026, 7, 13, 11, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 7, 14, 11, 0, 0, 0, time.UTC),
	}

	plan, ok := buildDashboardRollupPlan(filter, now)
	if !ok {
		t.Fatal("expected a rollup plan")
	}
	if len(plan.Segments) != 1 || plan.Segments[0].Grain != "hour" || !plan.Segments[0].From.Equal(filter.From) || !plan.Segments[0].To.Equal(now.Truncate(time.Hour)) {
		t.Fatalf("unexpected hourly plan: %+v", plan)
	}
	if len(plan.RawRanges) != 1 || !plan.RawRanges[0].From.Equal(now.Truncate(time.Hour)) || !plan.RawRanges[0].To.Equal(filter.To) {
		t.Fatalf("expected only current-hour raw tail, got %+v", plan)
	}
}

func TestBuildDashboardRollupPlanUsesClosedDaysForWeek(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 23, 0, 0, time.UTC)
	filter := invocationlog.DashboardOverviewFilter{
		From: time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC),
	}

	plan, ok := buildDashboardRollupPlan(filter, now)
	if !ok || len(plan.Segments) != 2 || plan.Segments[0].Grain != "day" || plan.Segments[1].Grain != "hour" {
		t.Fatalf("expected daily rollup plan, got ok=%v plan=%+v", ok, plan)
	}
	expectedDayTo := time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC)
	if !plan.Segments[0].From.Equal(filter.From) || !plan.Segments[0].To.Equal(expectedDayTo) || !plan.Segments[1].To.Equal(now.Truncate(time.Hour)) || len(plan.RawRanges) != 1 {
		t.Fatalf("unexpected daily plan: %+v", plan)
	}
}

func TestBuildDashboardRollupPlanKeepsUnalignedEdgesRaw(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 23, 0, 0, time.UTC)
	filter := invocationlog.DashboardOverviewFilter{
		From: time.Date(2026, 7, 12, 12, 15, 0, 0, time.UTC),
		To:   time.Date(2026, 7, 14, 9, 45, 0, 0, time.UTC),
	}

	plan, ok := buildDashboardRollupPlan(filter, now)
	if !ok || len(plan.Segments) != 3 || plan.Segments[0].Grain != "hour" || plan.Segments[1].Grain != "day" || plan.Segments[2].Grain != "hour" {
		t.Fatalf("expected daily rollup plan, got ok=%v plan=%+v", ok, plan)
	}
	expectedDayFrom := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	expectedDayTo := time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC)
	if !plan.Segments[1].From.Equal(expectedDayFrom) || !plan.Segments[1].To.Equal(expectedDayTo) || len(plan.RawRanges) != 2 {
		t.Fatalf("unexpected edge plan: %+v", plan)
	}
}

func TestBuildDashboardRollupPlanUsesMonthForCompletedCalendarMonth(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 23, 0, 0, time.UTC)
	filter := invocationlog.DashboardOverviewFilter{
		From: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	}

	plan, ok := buildDashboardRollupPlan(filter, now)
	if !ok || len(plan.Segments) != 1 || plan.Segments[0].Grain != "month" {
		t.Fatalf("expected completed calendar month to use month rollup, got ok=%v plan=%+v", ok, plan)
	}
	if !plan.Segments[0].From.Equal(filter.From) || !plan.Segments[0].To.Equal(filter.To) || len(plan.RawRanges) != 0 {
		t.Fatalf("unexpected completed month plan: %+v", plan)
	}
}

func TestBuildDashboardRollupPlanLeavesShortRangeRaw(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 23, 0, 0, time.UTC)
	filter := invocationlog.DashboardOverviewFilter{From: now.Add(-time.Hour), To: now}
	if _, ok := buildDashboardRollupPlan(filter, now); ok {
		t.Fatal("expected one-hour dashboard range to stay on raw query")
	}
}
