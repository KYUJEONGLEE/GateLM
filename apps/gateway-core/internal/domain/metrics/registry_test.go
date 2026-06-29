package metrics

import (
	"strings"
	"testing"
)

func TestRegistryRendersPrometheusTextWithDeterministicSafeLabels(t *testing.T) {
	registry := NewRegistry()
	labels := []Label{
		{Name: "method", Value: "POST"},
		{Name: "endpoint", Value: "/v1/chat/completions"},
		{Name: "status", Value: "success"},
		{Name: "http_status", Value: "200"},
		{Name: "error_code", Value: "none"},
		{Name: "request_id", Value: "request_forbidden"},
		{Name: "request_body_hash", Value: "hash_forbidden"},
		{Name: "provider_key", Value: "provider_key_forbidden"},
		{Name: "raw_error_detail", Value: "upstream detail forbidden"},
		{Name: "authorization", Value: "Bearer redacted"},
	}

	registry.AddCounter(GatewayRequestsTotal, labels, 1)
	registry.AddGauge(GatewayInflightRequests, []Label{
		{Name: "method", Value: "POST"},
		{Name: "endpoint", Value: "/v1/chat/completions"},
	}, 1)
	registry.ObserveHistogram(GatewayRequestDurationSeconds, labels, 0.02)
	registry.AddCounter(CacheOperationsTotal, []Label{
		{Name: "operation", Value: "lookup"},
		{Name: "cache_status", Value: "miss"},
		{Name: "cache_type", Value: "exact"},
		{Name: "status", Value: "success\nwith \"quote\""},
	}, 1)

	first := registry.RenderPrometheus()
	second := registry.RenderPrometheus()
	if first != second {
		t.Fatal("expected deterministic metrics rendering")
	}

	assertMetricsContains(t, first, "# HELP gatelm_gateway_requests_total Total Gateway requests by terminal outcome.")
	assertMetricsContains(t, first, "# TYPE gatelm_gateway_request_duration_seconds histogram")
	assertMetricsContains(t, first, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 1`)
	assertMetricsContains(t, first, `gatelm_gateway_inflight_requests{endpoint="/v1/chat/completions",method="POST"} 1`)
	assertMetricsContains(t, first, `gatelm_gateway_request_duration_seconds_bucket{endpoint="/v1/chat/completions",error_code="none",http_status="200",le="0.025",method="POST",status="success"} 1`)
	assertMetricsContains(t, first, `gatelm_gateway_request_duration_seconds_bucket{endpoint="/v1/chat/completions",error_code="none",http_status="200",le="+Inf",method="POST",status="success"} 1`)
	assertMetricsContains(t, first, `gatelm_gateway_request_duration_seconds_sum{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 0.02`)
	assertMetricsContains(t, first, `gatelm_cache_operations_total{cache_status="miss",cache_type="exact",operation="lookup",status="failed"} 1`)
	assertMetricsDoesNotContainForbiddenLabels(t, first)
}

func TestRegistryRenderIncludesAllRequiredMetricFamilies(t *testing.T) {
	output := NewRegistry().RenderPrometheus()
	for _, metricName := range []string{
		GatewayRequestsTotal,
		GatewayRequestDurationSeconds,
		GatewayInflightRequests,
		ProviderRequestsTotal,
		ProviderRequestDurationSeconds,
		CacheOperationsTotal,
		RateLimitDecisionsTotal,
		RateLimitDecisionDurationSeconds,
		MaskingActionsTotal,
		LogWritesTotal,
		LogWriteDurationSeconds,
	} {
		assertMetricsContains(t, output, "# TYPE "+metricName)
	}
}

func TestRegistryRedactsForbiddenHighCardinalityLabelValues(t *testing.T) {
	registry := NewRegistry()
	registry.AddCounter(GatewayRequestsTotal, []Label{
		{Name: "endpoint", Value: "/v1/chat/completions/req_forbidden_123"},
		{Name: "method", Value: "POST"},
		{Name: "status", Value: "trace_forbidden_123"},
		{Name: "http_status", Value: "authorization: Bearer secret"},
		{Name: "error_code", Value: "raw_error_detail upstream body"},
	}, 1)
	registry.AddCounter(ProviderRequestsTotal, []Label{
		{Name: "selected_provider", Value: "provider_key=secret"},
		{Name: "selected_model", Value: "sha256:abcdef"},
		{Name: "status", Value: "success"},
	}, 1)

	output := registry.RenderPrometheus()
	for _, forbidden := range []string{
		"req_forbidden_123",
		"trace_forbidden_123",
		"authorization",
		"Bearer",
		"raw_error_detail",
		"provider_key",
		"sha256:",
	} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("metrics output must redact forbidden label value %q\noutput:\n%s", forbidden, output)
		}
	}
	assertMetricsContains(t, output, `gatelm_gateway_requests_total{endpoint="redacted",error_code="internal_error",http_status="0",method="POST",status="failed"} 1`)
	assertMetricsContains(t, output, `gatelm_provider_requests_total{selected_model="redacted",selected_provider="redacted",status="success"} 1`)
}

func TestRecorderStatusLabelsUseCanonicalTerminalStatuses(t *testing.T) {
	registry := NewRegistry()
	registry.GatewayRequestCompleted(GatewayRequest{
		Endpoint:        "/v1/chat/completions",
		Method:          "POST",
		Status:          "cache_hit",
		HTTPStatus:      200,
		DurationSeconds: 0.01,
	})
	registry.CacheOperation(CacheOperation{
		Operation:   "lookup",
		CacheStatus: "error",
		CacheType:   "exact",
		Status:      "error",
	})
	registry.RateLimitDecision(RateLimitDecision{
		Allowed: false,
		Reason:  "limit_exceeded",
	})
	registry.LogWrite(LogWrite{
		Operation: "terminal",
		Status:    "partial_success",
	})

	output := registry.RenderPrometheus()
	assertMetricsContains(t, output, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 1`)
	assertMetricsContains(t, output, `gatelm_cache_operations_total{cache_status="error",cache_type="exact",operation="lookup",status="failed"} 1`)
	assertMetricsContains(t, output, `gatelm_rate_limit_decisions_total{rate_limit_allowed="false",status="rate_limited"} 1`)
	assertMetricsContains(t, output, `gatelm_log_writes_total{operation="terminal",status="failed"} 1`)
	for _, forbidden := range []string{`status="cache_hit"`, `status="error"`, `status="partial_success"`, `status="limit_exceeded"`} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("metrics output must not contain forbidden status label %s\noutput:\n%s", forbidden, output)
		}
	}
}

func assertMetricsContains(t *testing.T, output string, expected string) {
	t.Helper()
	if !strings.Contains(output, expected) {
		t.Fatalf("expected metrics output to contain %q\noutput:\n%s", expected, output)
	}
}

func assertMetricsDoesNotContainForbiddenLabels(t *testing.T, output string) {
	t.Helper()
	for _, labelName := range []string{
		"request_id",
		"trace_id",
		"tenant_id",
		"project_id",
		"application_id",
		"api_key_id",
		"app_token_id",
		"end_user_id",
		"feature_id",
		"prompt",
		"prompt_hash",
		"request_body_hash",
		"cache_key_hash",
		"provider_key",
		"authorization",
		"raw_error_detail",
	} {
		if strings.Contains(output, labelName+"=") || strings.Contains(output, labelName+"=\"") {
			t.Fatalf("metrics output must not contain forbidden label %q\noutput:\n%s", labelName, output)
		}
	}
}
