package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestQueryReaderGetAnalyticsPolicyImpactCombinesSurfacesWithoutRequestRowCap(t *testing.T) {
	from := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	projectLastEventAt := from.Add(40 * time.Minute)
	tenantChatLastEventAt := from.Add(50 * time.Minute)
	db := &fakeQueryer{rowByQuery: []fakeQueryRow{{
		contains: "analytics_policy_impact_single_scan",
		row: fakeRow{values: []any{
			mustMarshalPolicyImpactJSON(t, []invocationlog.AnalyticsPolicyImpactSurfaceTotal{
				{
					Surface: invocationlog.AnalyticsSurfaceProjectApplication, RequestCount: 1500,
					CostMicroUSD: 6000, KnownSavedCostMicroUSD: 2000,
					SavedCostKnownRequests: 1500, SavedCostUnknownRequests: 0,
					AvoidedProviderCallRequests: 300, ProtectedRequests: 70,
					HighPerformanceRequests: 500, HighPerformanceEligibleRequests: 1400,
					MaskingKnownRequests: 1500, MaskingUnknownRequests: 0,
					RoutingKnownRequests: 1400, RoutingUnknownRequests: 100,
					ModelKnownRequests: 1200, ModelUnknownRequests: 50,
					LastEventAt: &projectLastEventAt,
				},
				{
					Surface: invocationlog.AnalyticsSurfaceTenantChat, RequestCount: 1000,
					CostMicroUSD: 3000, KnownSavedCostMicroUSD: 500,
					SavedCostKnownRequests: 800, SavedCostUnknownRequests: 200,
					AvoidedProviderCallRequests: 200, ProtectedRequests: 10,
					HighPerformanceRequests: 200, HighPerformanceEligibleRequests: 600,
					MaskingKnownRequests: 100, MaskingUnknownRequests: 900,
					RoutingKnownRequests: 600, RoutingUnknownRequests: 400,
					ModelKnownRequests: 900, ModelUnknownRequests: 50,
					LastEventAt: &tenantChatLastEventAt,
				},
			}),
			mustMarshalPolicyImpactJSON(t, []invocationlog.AnalyticsPolicyImpactOutcome{
				{Surface: invocationlog.AnalyticsSurfaceTenantChat, Outcome: "cache_hit", RequestCount: 150},
				{Surface: invocationlog.AnalyticsSurfaceProjectApplication, Outcome: "fallback_success", RequestCount: 40},
			}),
			mustMarshalPolicyImpactJSON(t, []invocationlog.AnalyticsPolicyImpactRoutingRole{
				{Surface: invocationlog.AnalyticsSurfaceProjectApplication, Scheme: "difficulty", Role: "complex", RequestCount: 500},
				{Surface: invocationlog.AnalyticsSurfaceTenantChat, Scheme: "difficulty", Role: "complex", RequestCount: 200},
			}),
			mustMarshalPolicyImpactJSON(t, []invocationlog.AnalyticsPolicyImpactModelBucket{
				{Surface: invocationlog.AnalyticsSurfaceProjectApplication, PeriodStart: from, Provider: "openai", Model: "gpt-4o", RequestCount: 1500},
				{Surface: invocationlog.AnalyticsSurfaceTenantChat, PeriodStart: from, Provider: "openai", Model: "gpt-4o-mini", RequestCount: 1000},
			}),
			mustMarshalPolicyImpactJSON(t, []invocationlog.AnalyticsPolicyImpactUsageSource{
				{Surface: invocationlog.AnalyticsSurfaceProjectApplication, ProjectID: "11111111-1111-4111-8111-111111111111", RequestCount: 1500, CostMicroUSD: 6000},
				{Surface: invocationlog.AnalyticsSurfaceTenantChat, RequestCount: 1000, CostMicroUSD: 3000},
			}),
		}},
	}}}
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
	if len(db.queries) != 1 || strings.Count(joined, "from p0_llm_invocation_logs") != 1 ||
		!strings.Contains(joined, "with filtered as materialized") {
		t.Fatalf("expected one materialized source query, got %d queries: %s", len(db.queries), joined)
	}
	if !strings.Contains(joined, "from tenant_chat_invocation_logs") || strings.Contains(joined, "limit 1000") {
		t.Fatalf("expected Tenant Chat aggregate without request row cap: %s", joined)
	}
	if !strings.Contains(joined, "case routing_difficulty") ||
		strings.Contains(joined, "case effective_route_tier") ||
		strings.Contains(joined, "routing_role in ('complex', 'high_quality')") {
		t.Fatalf("policy impact routing must use only simple/complex difficulty: %s", joined)
	}
}

func mustMarshalPolicyImpactJSON(t *testing.T, value any) []byte {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal policy impact fixture: %v", err)
	}
	return payload
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
