package invocationlog

import (
	"errors"
	"testing"
	"time"
)

func TestNormalizeAnalyticsReliabilityFilterDefaultsToTenantWideScope(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	filter, err := NormalizeAnalyticsReliabilityFilter(AnalyticsReliabilityFilter{
		TenantID: " tenant_demo ",
		From:     from,
		To:       from.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("normalize reliability filter: %v", err)
	}
	if filter.TenantID != "tenant_demo" || filter.Surface != AnalyticsReliabilitySurfaceAll || filter.IncidentLimit != 4 {
		t.Fatalf("unexpected normalized filter: %+v", filter)
	}
	if got := AnalyticsReliabilityRequestedSurfaces(filter); len(got) != 2 || got[0] != AnalyticsReliabilitySurfaceProjectApplication || got[1] != AnalyticsReliabilitySurfaceTenantChat {
		t.Fatalf("unexpected tenant-wide surfaces: %#v", got)
	}
}

func TestNormalizeAnalyticsReliabilityFilterRestrictsProjectScope(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	filter, err := NormalizeAnalyticsReliabilityFilter(AnalyticsReliabilityFilter{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
		Surface:   AnalyticsReliabilitySurfaceAll,
		From:      from,
		To:        from.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("normalize reliability filter: %v", err)
	}
	if filter.Surface != AnalyticsReliabilitySurfaceProjectApplication {
		t.Fatalf("project scope must exclude Tenant Chat, got %+v", filter)
	}
}

func TestNormalizeAnalyticsReliabilityFilterRejectsInvalidScopeAndRange(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	_, err := NormalizeAnalyticsReliabilityFilter(AnalyticsReliabilityFilter{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
		Surface:   AnalyticsReliabilitySurfaceTenantChat,
		From:      from,
		To:        from.Add(time.Hour),
	})
	if !errors.Is(err, ErrReliabilityScopeInvalid) {
		t.Fatalf("expected invalid scope, got %v", err)
	}

	_, err = NormalizeAnalyticsReliabilityFilter(AnalyticsReliabilityFilter{
		TenantID: "tenant_demo",
		From:     from,
		To:       from.Add(31*24*time.Hour + time.Second),
	})
	if !errors.Is(err, ErrReliabilityRangeTooBroad) {
		t.Fatalf("expected range-too-broad error, got %v", err)
	}
}
