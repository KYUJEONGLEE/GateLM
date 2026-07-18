package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type recordingPolicyImpactReader struct {
	filter invocationlog.AnalyticsPolicyImpactFilter
	fields invocationlog.AnalyticsPolicyImpactFields
}

func (r *recordingPolicyImpactReader) GetAnalyticsPolicyImpact(
	_ context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (invocationlog.AnalyticsPolicyImpactFields, error) {
	r.filter = filter
	return r.fields, nil
}

func TestAnalyticsPolicyImpactHandlerReturnsUnifiedAggregate(t *testing.T) {
	generatedAt := time.Date(2026, 7, 18, 1, 0, 0, 0, time.UTC)
	reader := &recordingPolicyImpactReader{fields: invocationlog.AnalyticsPolicyImpactFields{
		Period: "hour", BucketInterval: "5m", ExpectedBucketCount: 12,
		Totals: invocationlog.AnalyticsPolicyImpactTotals{
			RequestCount: 2500, CostMicroUSD: 9000, KnownSavedCostMicroUSD: 2500,
			HighPerformanceRequests: 700, HighPerformanceEligibleRequests: 2000,
		},
		SurfaceTotals: []invocationlog.AnalyticsPolicyImpactSurfaceTotal{
			{Surface: invocationlog.AnalyticsSurfaceProjectApplication, RequestCount: 1500},
			{Surface: invocationlog.AnalyticsSurfaceTenantChat, RequestCount: 1000},
		},
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source: "postgresql_unified_policy_impact_raw", RecordCount: 2500, GeneratedAt: generatedAt,
		},
	}}
	handler := AnalyticsPolicyImpactHandler{
		Reader: reader, TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	}
	req := httptest.NewRequest(http.MethodGet,
		"/api/analytics/policy-impact?period=hour&from=2026-07-18T00:00:00Z&to=2026-07-18T01:00:00Z", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.ProjectID != "" || reader.filter.TenantID != handler.TenantID {
		t.Fatalf("unexpected filter: %+v", reader.filter)
	}
	var payload struct {
		Data struct {
			Totals struct {
				RequestCount      int64  `json:"requestCount"`
				SavedCostMicroUSD *int64 `json:"savedCostMicroUsd"`
			} `json:"totals"`
			SurfaceTotals []struct {
				Surface string `json:"surface"`
			} `json:"surfaceTotals"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Data.Totals.RequestCount != 2500 || payload.Data.Totals.SavedCostMicroUSD != nil ||
		len(payload.Data.SurfaceTotals) != 2 || payload.Data.SurfaceTotals[1].Surface != "tenant_chat" {
		t.Fatalf("unexpected response: %+v", payload.Data)
	}
}
