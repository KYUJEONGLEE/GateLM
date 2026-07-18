package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestQueryReaderGetAnalyticsReliabilityReadsAggregateAndBoundedIncidents(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	incidentAt := from.Add(30 * time.Minute)
	db := &fakeQueryer{
		rowByQuery: []fakeQueryRow{{
			contains: "unsupported_fallback_count",
			row: fakeRow{values: []any{
				int64(2), int64(1), int64(1), int64(0), int64(0), int64(0), int64(0),
				int64(1), int64(1), int64(0), sql.NullTime{Time: incidentAt, Valid: true},
			}},
		}},
		rowsByQuery: []fakeQueryRows{{
			contains: "where canonical_status in",
			rows: &fakeRows{values: [][]any{{
				"request_failed",
				sql.NullString{String: testProjectID, Valid: true},
				sql.NullString{String: "provider_demo", Valid: true},
				sql.NullString{String: "model_demo", Valid: true},
				"failed",
				"failed",
				"failed",
				sql.NullInt64{Int64: 502, Valid: true},
				incidentAt,
			}}},
		}},
	}

	result, err := NewQueryReader(db).GetAnalyticsReliability(context.Background(), invocationlog.AnalyticsReliabilityFilter{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		Surface:       invocationlog.AnalyticsReliabilitySurfaceAll,
		From:          from,
		To:            from.Add(time.Hour),
		IncidentLimit: 4,
	})
	if err != nil {
		t.Fatalf("get analytics reliability: %v", err)
	}
	if result.Scope.Surface != invocationlog.AnalyticsReliabilitySurfaceProjectApplication || result.Totals.RequestCount != 2 {
		t.Fatalf("unexpected project-scoped result: %+v", result)
	}
	if len(result.RecentIncidents) != 1 || result.RecentIncidents[0].Surface != invocationlog.AnalyticsReliabilitySurfaceProjectApplication || result.RecentIncidents[0].HTTPStatus == nil || *result.RecentIncidents[0].HTTPStatus != 502 {
		t.Fatalf("unexpected incident projection: %+v", result.RecentIncidents)
	}
}

func TestBuildAnalyticsReliabilityQueriesKeepTenantScopeAndCanonicalMappings(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	filter := invocationlog.AnalyticsReliabilityFilter{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		Surface:       invocationlog.AnalyticsReliabilitySurfaceProjectApplication,
		From:          from,
		To:            from.Add(time.Hour),
		IncidentLimit: 4,
	}

	projectQuery, projectArgs := buildAnalyticsReliabilityTotalsQuery(filter, invocationlog.AnalyticsReliabilitySurfaceProjectApplication)
	for _, expected := range []string{
		"tenant_id = $1",
		"created_at >= $2",
		"created_at < $3",
		"project_id = $4",
		"from p0_llm_invocation_logs",
		"{domainOutcomes,fallback,outcome}",
		"canonical_status = 'failed'",
		"fallback_attempted",
		"fallback_outcome = 'success' and canonical_status = 'success'",
	} {
		if !strings.Contains(projectQuery, expected) {
			t.Fatalf("project/application reliability query must contain %q: %s", expected, projectQuery)
		}
	}
	if len(projectArgs) != 4 || projectArgs[0] != testTenantID || projectArgs[3] != testProjectID {
		t.Fatalf("unexpected project/application query args: %#v", projectArgs)
	}

	tenantFilter := filter
	tenantFilter.ProjectID = ""
	tenantFilter.Surface = invocationlog.AnalyticsReliabilitySurfaceTenantChat
	tenantQuery, tenantArgs := buildAnalyticsReliabilityTotalsQuery(tenantFilter, invocationlog.AnalyticsReliabilitySurfaceTenantChat)
	for _, expected := range []string{
		"from tenant_chat_invocation_logs",
		"from tenant_chat_provider_attempts attempt",
		"attempt.tenant_id = $1",
		"attempt.kind = 'fallback'",
		"group by attempt.request_id",
		"'policy_ack_required'",
		"then 'blocked'",
		"fallback.request_id is not null as fallback_attempted",
	} {
		if !strings.Contains(tenantQuery, expected) {
			t.Fatalf("Tenant Chat reliability query must contain %q: %s", expected, tenantQuery)
		}
	}
	if len(tenantArgs) != 3 || tenantArgs[0] != testTenantID {
		t.Fatalf("unexpected Tenant Chat query args: %#v", tenantArgs)
	}

	for _, query := range []string{projectQuery, tenantQuery} {
		for _, forbidden := range []string{
			"raw_prompt",
			"raw_response",
			"authorization_header",
			"provider_api_key",
			"snapshot_digest",
			"user_id",
			"employee_id",
			"turn_id",
		} {
			if strings.Contains(strings.ToLower(query), forbidden) {
				t.Fatalf("reliability query must not select forbidden field %q: %s", forbidden, query)
			}
		}
	}
}

func TestBuildAnalyticsReliabilityIncidentQueryFiltersBeforeLimit(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	query, args := buildAnalyticsReliabilityIncidentsQuery(invocationlog.AnalyticsReliabilityFilter{
		TenantID:      testTenantID,
		Surface:       invocationlog.AnalyticsReliabilitySurfaceTenantChat,
		From:          from,
		To:            from.Add(time.Hour),
		IncidentLimit: 7,
	}, invocationlog.AnalyticsReliabilitySurfaceTenantChat)

	filterIndex := strings.Index(query, "where canonical_status in")
	limitIndex := strings.Index(query, "limit $4")
	if filterIndex < 0 || limitIndex <= filterIndex {
		t.Fatalf("incident condition must be applied before the bounded limit: %s", query)
	}
	if len(args) != 4 || args[3] != 7 {
		t.Fatalf("unexpected incident query args: %#v", args)
	}
}

func TestAggregateAnalyticsReliabilityAddsSurfacesBeforeCalculatingRates(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	projectIncidentAt := from.Add(10 * time.Minute)
	tenantIncidentAt := from.Add(20 * time.Minute)
	result, included := aggregateAnalyticsReliability(invocationlog.AnalyticsReliabilityFilter{
		TenantID:      testTenantID,
		Surface:       invocationlog.AnalyticsReliabilitySurfaceAll,
		From:          from,
		To:            from.Add(time.Hour),
		IncidentLimit: 4,
	}, []analyticsReliabilitySurfaceRead{
		{
			surface: invocationlog.AnalyticsReliabilitySurfaceProjectApplication,
			totals: invocationlog.AnalyticsReliabilityTotals{
				RequestCount: 120, SuccessCount: 106, FailedCount: 2, BlockedCount: 6,
				RateLimitedCount: 4, CancelledCount: 2, FallbackRequestCount: 4, FallbackSuccessCount: 3,
			},
			incidents: []invocationlog.AnalyticsReliabilityIncident{{RequestID: "request_project", OccurredAt: projectIncidentAt}},
		},
		{
			surface: invocationlog.AnalyticsReliabilitySurfaceTenantChat,
			totals: invocationlog.AnalyticsReliabilityTotals{
				RequestCount: 30, SuccessCount: 25, FailedCount: 1, BlockedCount: 2,
				RateLimitedCount: 1, CancelledCount: 1, FallbackRequestCount: 2, FallbackSuccessCount: 1,
			},
			incidents: []invocationlog.AnalyticsReliabilityIncident{{RequestID: "request_tenant", OccurredAt: tenantIncidentAt}},
		},
	})

	if included != 2 || !result.Freshness.Complete || result.Freshness.QueryStatus != invocationlog.AnalyticsReliabilityStatusOK {
		t.Fatalf("unexpected freshness: included=%d freshness=%+v", included, result.Freshness)
	}
	if result.Totals.RequestCount != 150 || result.Totals.SuccessCount != 131 || result.Totals.FallbackSuccessCount != 4 {
		t.Fatalf("unexpected combined totals: %+v", result.Totals)
	}
	if result.Rates.SuccessRate == nil || !floatEquals(*result.Rates.SuccessRate, 131.0/150.0) ||
		result.Rates.SystemErrorRate == nil || !floatEquals(*result.Rates.SystemErrorRate, 3.0/150.0) ||
		result.Rates.FallbackRecoveryRate == nil || !floatEquals(*result.Rates.FallbackRecoveryRate, 4.0/6.0) {
		t.Fatalf("unexpected combined rates: %+v", result.Rates)
	}
	if result.Continuity.SuccessWithoutFallbackCount != 127 || result.Continuity.ExcludedPolicyCount != 13 {
		t.Fatalf("unexpected continuity: %+v", result.Continuity)
	}
	if len(result.RecentIncidents) != 2 || result.RecentIncidents[0].RequestID != "request_tenant" || result.RecentIncidents[0].Surface != invocationlog.AnalyticsReliabilitySurfaceTenantChat {
		t.Fatalf("unexpected deterministic incident merge: %+v", result.RecentIncidents)
	}
}

func TestAggregateAnalyticsReliabilityMarksUnavailableAndUnknownSourcesPartial(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	result, included := aggregateAnalyticsReliability(invocationlog.AnalyticsReliabilityFilter{
		TenantID:      testTenantID,
		Surface:       invocationlog.AnalyticsReliabilitySurfaceAll,
		From:          from,
		To:            from.Add(time.Hour),
		IncidentLimit: 4,
	}, []analyticsReliabilitySurfaceRead{
		{surface: invocationlog.AnalyticsReliabilitySurfaceProjectApplication, aggregateErr: errors.New("project source unavailable")},
		{
			surface:                  invocationlog.AnalyticsReliabilitySurfaceTenantChat,
			totals:                   invocationlog.AnalyticsReliabilityTotals{RequestCount: 1, UnknownCount: 1},
			unsupportedFallbackCount: 1,
		},
	})

	if included != 1 || result.Freshness.Complete || result.Freshness.QueryStatus != invocationlog.AnalyticsReliabilityStatusPartial {
		t.Fatalf("partial response must remain explicit: included=%d freshness=%+v", included, result.Freshness)
	}
	if len(result.SurfaceTotals) != 2 || result.SurfaceTotals[0].Included || result.SurfaceTotals[0].Totals != nil {
		t.Fatalf("unavailable source must not be converted to zero: %+v", result.SurfaceTotals)
	}
}
