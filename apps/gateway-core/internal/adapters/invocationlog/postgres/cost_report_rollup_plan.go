package postgres

import (
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

// buildCostReportRollupPlan only selects source buckets that are both complete
// inside the requested range and no longer open at the current time. The
// remaining partial/open edges stay on the request log so a rollup never
// widens the caller's [from, to) contract.
func buildCostReportRollupPlan(
	filter invocationlog.CostReportFilter,
	now time.Time,
) (dashboardRollupPlan, bool) {
	from := filter.From.UTC()
	to := filter.To.UTC()
	if from.IsZero() || to.IsZero() || !to.After(from) || to.Sub(from) <= time.Hour {
		return dashboardRollupPlan{}, false
	}
	if !isPostgresUUID(filter.TenantID) {
		return dashboardRollupPlan{}, false
	}
	// Provider/model predicates can be represented by the dimension table, but
	// the totals and every other breakdown cannot be filtered equivalently from
	// that dimension without changing their contract. Keep the complete report
	// on the canonical request log for either predicate.
	if strings.TrimSpace(filter.Provider) != "" || strings.TrimSpace(filter.Model) != "" {
		return dashboardRollupPlan{}, false
	}

	config := costReportBucketConfig(filter)
	if !costReportAllowsRollupGrain(config.Unit, "hour") {
		return dashboardRollupPlan{}, false
	}

	plan := dashboardRollupPlan{}
	currentHour := truncateDashboardBucket(now.UTC(), "hour")
	currentDay := truncateDashboardBucket(now.UTC(), "day")
	currentMonth := truncateDashboardBucket(now.UTC(), "month")

	for cursor := from; cursor.Before(to); {
		if !cursor.Before(currentHour) {
			appendDashboardRawRange(&plan, cursor, to)
			break
		}

		if costReportAllowsRollupGrain(config.Unit, "month") &&
			cursor.Equal(truncateDashboardBucket(cursor, "month")) {
			next := cursor.AddDate(0, 1, 0)
			if !next.After(to) && !next.After(currentMonth) {
				appendDashboardRollupSegment(&plan, "month", cursor, next)
				cursor = next
				continue
			}
		}
		if costReportAllowsRollupGrain(config.Unit, "day") &&
			cursor.Equal(truncateDashboardBucket(cursor, "day")) {
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

func costReportAllowsRollupGrain(outputUnit string, sourceGrain string) bool {
	switch outputUnit {
	case "hour":
		return sourceGrain == "hour"
	case "day", "week":
		return sourceGrain == "hour" || sourceGrain == "day"
	case "month":
		return sourceGrain == "hour" || sourceGrain == "day" || sourceGrain == "month"
	default:
		return false
	}
}
