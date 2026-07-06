package invocationlog

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizeCostReportFilterAllowsHourPeriod(t *testing.T) {
	now := time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC)

	filter, err := NormalizeCostReportFilter(CostReportFilter{
		TenantID: "tenant-1",
		Period:   " HOUR ",
		From:     now,
		To:       now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("expected hour period to be valid: %v", err)
	}

	if filter.Period != "hour" {
		t.Fatalf("expected normalized hour period, got %q", filter.Period)
	}
}

func TestNormalizeCostReportFilterRejectsInvalidPeriod(t *testing.T) {
	now := time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC)

	_, err := NormalizeCostReportFilter(CostReportFilter{
		TenantID: "tenant-1",
		Period:   "minute",
		From:     now,
		To:       now.Add(time.Hour),
	})
	if err == nil {
		t.Fatal("expected invalid period error")
	}

	if !strings.Contains(err.Error(), "period must be hour, day, week, or month") {
		t.Fatalf("unexpected error: %v", err)
	}
}
