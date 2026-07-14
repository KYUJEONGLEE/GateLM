package postgres

import (
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type dashboardRollupPlan struct {
	Segments  []dashboardRollupSegment
	RawRanges []dashboardTimeRange
}

type dashboardRollupSegment struct {
	Grain string
	From  time.Time
	To    time.Time
}

type dashboardTimeRange struct {
	From time.Time
	To   time.Time
}

func buildDashboardRollupPlan(filter invocationlog.DashboardOverviewFilter, now time.Time) (dashboardRollupPlan, bool) {
	from := filter.From.UTC()
	to := filter.To.UTC()
	if from.IsZero() || to.IsZero() || !to.After(from) || to.Sub(from) <= time.Hour {
		return dashboardRollupPlan{}, false
	}

	plan := dashboardRollupPlan{}
	rangeDuration := to.Sub(from)
	currentHour := truncateDashboardBucket(now.UTC(), "hour")
	currentDay := truncateDashboardBucket(now.UTC(), "day")
	currentMonth := truncateDashboardBucket(now.UTC(), "month")

	for cursor := from; cursor.Before(to); {
		if !cursor.Before(currentHour) {
			appendDashboardRawRange(&plan, cursor, to)
			break
		}

		if cursor.Equal(truncateDashboardBucket(cursor, "month")) {
			next := cursor.AddDate(0, 1, 0)
			if !next.After(to) && !next.After(currentMonth) {
				appendDashboardRollupSegment(&plan, "month", cursor, next)
				cursor = next
				continue
			}
		}
		if rangeDuration > 36*time.Hour && cursor.Equal(truncateDashboardBucket(cursor, "day")) {
			next := cursor.AddDate(0, 0, 1)
			if !next.After(to) && !next.After(currentDay) {
				appendDashboardRollupSegment(&plan, "day", cursor, next)
				cursor = next
				continue
			}
		}
		if cursor.Equal(truncateDashboardBucket(cursor, "hour")) {
			next := cursor.Add(time.Hour)
			if !next.After(to) && !next.After(currentHour) {
				appendDashboardRollupSegment(&plan, "hour", cursor, next)
				cursor = next
				continue
			}
		}

		next := minDashboardTime(to, ceilDashboardBucket(cursor, "hour"))
		if next.After(currentHour) {
			next = currentHour
		}
		if !next.After(cursor) {
			next = to
		}
		appendDashboardRawRange(&plan, cursor, next)
		cursor = next
	}

	return plan, len(plan.Segments) > 0
}

func appendDashboardRollupSegment(plan *dashboardRollupPlan, grain string, from time.Time, to time.Time) {
	if plan == nil || !to.After(from) {
		return
	}
	if len(plan.Segments) > 0 {
		last := &plan.Segments[len(plan.Segments)-1]
		if last.Grain == grain && last.To.Equal(from) {
			last.To = to
			return
		}
	}
	plan.Segments = append(plan.Segments, dashboardRollupSegment{Grain: grain, From: from, To: to})
}

func appendDashboardRawRange(plan *dashboardRollupPlan, from time.Time, to time.Time) {
	if plan == nil || !to.After(from) {
		return
	}
	if len(plan.RawRanges) > 0 {
		last := &plan.RawRanges[len(plan.RawRanges)-1]
		if last.To.Equal(from) {
			last.To = to
			return
		}
	}
	plan.RawRanges = append(plan.RawRanges, dashboardTimeRange{From: from, To: to})
}

func truncateDashboardBucket(value time.Time, grain string) time.Time {
	value = value.UTC()
	switch grain {
	case "month":
		return time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "day":
		return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
	default:
		return value.Truncate(time.Hour)
	}
}

func ceilDashboardBucket(value time.Time, grain string) time.Time {
	floor := truncateDashboardBucket(value, grain)
	if value.UTC().Equal(floor) {
		return floor
	}
	switch grain {
	case "month":
		return floor.AddDate(0, 1, 0)
	case "day":
		return floor.AddDate(0, 0, 1)
	default:
		return floor.Add(time.Hour)
	}
}

func minDashboardTime(first time.Time, second time.Time) time.Time {
	if first.Before(second) {
		return first
	}
	return second
}
