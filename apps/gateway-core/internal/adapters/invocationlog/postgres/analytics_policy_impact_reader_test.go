package postgres

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestQueryReaderGetAnalyticsPolicyImpactCombinesSurfacesWithoutRequestRowCap(t *testing.T) {
	from := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	db := &fakeQueryer{rowsByQuery: []fakeQueryRows{
		{
			contains: "count(*) filter (where saved_cost_micro_usd is null)",
			rows: &fakeRows{values: [][]any{
				{
					invocationlog.AnalyticsSurfaceProjectApplication,
					int64(1500), int64(6000), int64(2000), int64(1500), int64(0),
					int64(300), int64(70), int64(500), int64(1400),
					int64(1500), int64(0), int64(1400), int64(100),
					int64(1200), int64(50), sql.NullTime{Time: from.Add(40 * time.Minute), Valid: true},
				},
				{
					invocationlog.AnalyticsSurfaceTenantChat,
					int64(1000), int64(3000), int64(500), int64(800), int64(200),
					int64(200), int64(10), int64(200), int64(600),
					int64(100), int64(900), int64(600), int64(400),
					int64(900), int64(50), sql.NullTime{Time: from.Add(50 * time.Minute), Valid: true},
				},
			}},
		},
		{
			contains: "as policy_outcome(outcome, matched)",
			rows: &fakeRows{values: [][]any{
				{invocationlog.AnalyticsSurfaceTenantChat, "cache_hit", int64(150)},
				{invocationlog.AnalyticsSurfaceProjectApplication, "fallback_success", int64(40)},
			}},
		},
		{
			contains: "select surface, routing_scheme, routing_role",
			rows: &fakeRows{values: [][]any{
				{invocationlog.AnalyticsSurfaceProjectApplication, "difficulty", "complex", int64(500)},
				{invocationlog.AnalyticsSurfaceTenantChat, "difficulty", "complex", int64(200)},
			}},
		},
		{
			contains: "top_models as",
			rows: &fakeRows{values: [][]any{
				{invocationlog.AnalyticsSurfaceProjectApplication, from, "openai", "gpt-4o", int64(1500)},
				{invocationlog.AnalyticsSurfaceTenantChat, from, "openai", "gpt-4o-mini", int64(1000)},
			}},
		},
		{
			contains: "coalesce(project_id, '')",
			rows: &fakeRows{values: [][]any{
				{invocationlog.AnalyticsSurfaceProjectApplication, "11111111-1111-4111-8111-111111111111", int64(1500), int64(6000)},
				{invocationlog.AnalyticsSurfaceTenantChat, "", int64(1000), int64(3000)},
			}},
		},
	}}
	reader := NewQueryReader(db)

	impact, err := reader.GetAnalyticsPolicyImpact(context.Background(), invocationlog.AnalyticsPolicyImpactFilter{
		TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		Period:   "hour",
		From:     from,
		To:       to,
	})
	if err != nil {
		t.Fatalf("get policy impact: %v", err)
	}
	if impact.Totals.RequestCount != 2500 || impact.Totals.HighPerformanceRequests != 700 ||
		impact.Totals.HighPerformanceEligibleRequests != 2000 {
		t.Fatalf("unexpected totals: %+v", impact.Totals)
	}
	if impact.Totals.SavedCostMicroUSD != nil || impact.Totals.KnownSavedCostMicroUSD != 2500 {
		t.Fatalf("partial Tenant Chat savings must remain explicit: %+v", impact.Totals)
	}
	if len(impact.ModelBuckets) != 2 || impact.ModelBuckets[0].RequestCount != 1500 ||
		impact.ModelBuckets[1].Surface != invocationlog.AnalyticsSurfaceTenantChat {
		t.Fatalf("unexpected uncapped model buckets: %+v", impact.ModelBuckets)
	}
	if len(impact.UsageSources) != 2 || impact.UsageSources[1].Surface != invocationlog.AnalyticsSurfaceTenantChat {
		t.Fatalf("unexpected usage sources: %+v", impact.UsageSources)
	}
	if impact.DataFreshness.LastLogCreatedAt == nil || !impact.DataFreshness.LastLogCreatedAt.Equal(from.Add(50*time.Minute)) {
		t.Fatalf("unexpected freshness: %+v", impact.DataFreshness)
	}
	joined := strings.Join(db.queries, "\n")
	if !strings.Contains(joined, "from tenant_chat_invocation_logs") || strings.Contains(joined, "limit 1000") {
		t.Fatalf("expected Tenant Chat aggregate without request row cap: %s", joined)
	}
	if !strings.Contains(joined, "case routing_difficulty") ||
		strings.Contains(joined, "case effective_route_tier") ||
		strings.Contains(joined, "routing_role in ('complex', 'high_quality')") {
		t.Fatalf("policy impact routing must use only simple/complex difficulty: %s", joined)
	}
}

func TestBuildAnalyticsPolicyImpactFilteredCTEOmitsTenantChatForProjectScope(t *testing.T) {
	from := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	query, _ := buildAnalyticsPolicyImpactFilteredCTE(invocationlog.AnalyticsPolicyImpactFilter{
		TenantID:  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		ProjectID: "11111111-1111-4111-8111-111111111111",
		From:      from,
		To:        from.Add(time.Hour),
	})
	if strings.Contains(query, "tenant_chat_invocation_logs") || !strings.Contains(query, "project_id = $4") {
		t.Fatalf("project scope must exclude Tenant Chat: %s", query)
	}
}

func TestBuildAnalyticsPolicyImpactFilteredCTEUsesPersistedProjectMetadata(t *testing.T) {
	from := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	query, _ := buildAnalyticsPolicyImpactFilteredCTE(invocationlog.AnalyticsPolicyImpactFilter{
		TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		From:     from,
		To:       from.Add(time.Hour),
	})

	for _, expected := range []string{
		"metadata->>'promptDifficulty'",
		"metadata->>'providerCalled'",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("project policy impact must read persisted metadata %q: %s", expected, query)
		}
	}
	for _, nonexistentColumn := range []string{
		"nullif(prompt_difficulty",
		"coalesce(provider_called",
	} {
		if strings.Contains(query, nonexistentColumn) {
			t.Fatalf("project policy impact must not read non-schema column %q: %s", nonexistentColumn, query)
		}
	}
}
