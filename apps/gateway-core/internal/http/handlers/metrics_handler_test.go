package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/metrics"
)

func TestMetricsHandlerReturnsPrometheusText(t *testing.T) {
	registry := metrics.NewRegistry()
	registry.MaskingAction("none")
	handler := MetricsHandler{Registry: registry}

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != metrics.PrometheusTextContentType {
		t.Fatalf("unexpected content type: %q", got)
	}
	body := rr.Body.String()
	if !strings.Contains(body, `gatelm_masking_actions_total{masking_action="none"} 1`) {
		t.Fatalf("expected masking metric in response, got:\n%s", body)
	}
	if !strings.Contains(body, "# TYPE gatelm_gateway_requests_total counter") {
		t.Fatalf("expected required metric family in response, got:\n%s", body)
	}
}
