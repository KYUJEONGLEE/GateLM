package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestAnalyticsReliabilityHandlerReturnsTenantScopedAggregate(t *testing.T) {
	from := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	successRate := 0.8
	reader := &recordingAnalyticsReliabilityReader{
		result: invocationlog.AnalyticsReliabilityFields{
			Scope: invocationlog.AnalyticsReliabilityScope{
				TenantID: "tenant_demo",
				Surface:  invocationlog.AnalyticsReliabilitySurfaceAll,
				From:     from,
				To:       from.Add(time.Hour),
			},
			GeneratedAt: from.Add(time.Hour),
			Freshness: invocationlog.AnalyticsReliabilityFreshness{
				QueryStatus: invocationlog.AnalyticsReliabilityStatusOK,
				Complete:    true,
				Sources:     []invocationlog.AnalyticsReliabilitySourceFreshness{},
			},
			Totals: invocationlog.AnalyticsReliabilityTotals{RequestCount: 10, SuccessCount: 8, FailedCount: 2},
			Rates:  invocationlog.AnalyticsReliabilityRates{SuccessRate: &successRate},
			TerminalOutcomes: []invocationlog.AnalyticsReliabilityOutcome{
				{Outcome: "success", RequestCount: 8},
				{Outcome: "failed", RequestCount: 2},
			},
			RecentIncidents: []invocationlog.AnalyticsReliabilityIncident{},
		},
	}
	handler := AnalyticsReliabilityHandler{Reader: reader, TenantID: "tenant_demo"}
	req := httptest.NewRequest(
		http.MethodGet,
		"/api/analytics/reliability?from=2026-07-17T00:00:00Z&to=2026-07-17T01:00:00Z&surface=all&incidentLimit=4",
		nil,
	)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_demo" || reader.filter.Surface != "all" || reader.filter.IncidentLimit != 4 {
		t.Fatalf("unexpected reliability filter: %+v", reader.filter)
	}
	var payload analyticsReliabilityResponse
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Data.Totals.RequestCount != 10 || payload.Data.Rates.SuccessRate == nil || *payload.Data.Rates.SuccessRate != 0.8 {
		t.Fatalf("unexpected reliability response: %+v", payload.Data)
	}
	for _, forbidden := range []string{"rawPrompt", "rawResponse", "authorization", "providerApiKey", "employeeId", "userId", "turnId", "snapshotDigest"} {
		if strings.Contains(rr.Body.String(), forbidden) {
			t.Fatalf("response must not contain forbidden field %q: %s", forbidden, rr.Body.String())
		}
	}
}

func TestAnalyticsReliabilityHandlerMapsContractErrors(t *testing.T) {
	from := "2026-07-17T00:00:00Z"
	to := "2026-07-17T01:00:00Z"
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantBody string
	}{
		{name: "invalid scope", err: fmt.Errorf("%w: invalid combination", invocationlog.ErrReliabilityScopeInvalid), wantCode: http.StatusBadRequest, wantBody: "RELIABILITY_SCOPE_INVALID"},
		{name: "range too broad", err: fmt.Errorf("%w: maximum range", invocationlog.ErrReliabilityRangeTooBroad), wantCode: http.StatusBadRequest, wantBody: "RELIABILITY_RANGE_TOO_BROAD"},
		{name: "unavailable", err: fmt.Errorf("%w: database unavailable", invocationlog.ErrReliabilityDataUnavailable), wantCode: http.StatusServiceUnavailable, wantBody: "RELIABILITY_DATA_UNAVAILABLE"},
		{name: "clickhouse unavailable", err: fmt.Errorf("%w: clickhouse unavailable", invocationlog.ErrAnalyticsDataUnavailable), wantCode: http.StatusServiceUnavailable, wantBody: "RELIABILITY_DATA_UNAVAILABLE"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := AnalyticsReliabilityHandler{
				Reader:   &recordingAnalyticsReliabilityReader{err: tc.err},
				TenantID: "tenant_demo",
			}
			req := httptest.NewRequest(http.MethodGet, "/api/analytics/reliability?from="+from+"&to="+to, nil)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != tc.wantCode || !strings.Contains(rr.Body.String(), tc.wantBody) {
				t.Fatalf("expected %d/%s, got %d: %s", tc.wantCode, tc.wantBody, rr.Code, rr.Body.String())
			}
		})
	}
}

type recordingAnalyticsReliabilityReader struct {
	filter invocationlog.AnalyticsReliabilityFilter
	result invocationlog.AnalyticsReliabilityFields
	err    error
}

func (r *recordingAnalyticsReliabilityReader) GetAnalyticsReliability(
	_ context.Context,
	filter invocationlog.AnalyticsReliabilityFilter,
) (invocationlog.AnalyticsReliabilityFields, error) {
	r.filter = filter
	return r.result, r.err
}
