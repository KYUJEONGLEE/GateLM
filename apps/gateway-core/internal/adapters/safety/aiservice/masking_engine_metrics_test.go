package aiservice

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

func TestMaskingEngineMetricsRecordSingleSidecarCall(t *testing.T) {
	registry := metrics.NewRegistry()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"contractVersion":"ai-safety-detector.v1","outcome":"redacted","mode":"enforce",
			"model":{"modelId":"openai/privacy-filter","runtime":"cpu_only"},
			"redactedPrompt":"[MODEL_REDACTED]","logSafePrompt":"[MODEL_REDACTED]",
			"detectorSummary":{"detectedCount":1,"detectorCategories":["secret"]},
			"detections":[],
			"executionSummary":{"executionMode":"hybrid","modelInvocationCount":1,"acceptedModelDetectionCount":1},
			"latencyMs":1
		}`))
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL,
		HTTPClient:  server.Client(),
		Timeout:     time.Second,
		Mode:        ModeEnforce,
		Surface:     "tenant_chat",
		Metrics:     registry,
	})
	if _, err := engine.Apply(context.Background(), maskdomain.ApplyRequest{Prompt: "synthetic safe marker"}); err != nil {
		t.Fatalf("apply masking engine: %v", err)
	}

	output := registry.RenderPrometheus()
	assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_calls_total{inference_path="hybrid",mode="enforce",outcome="redacted",surface="tenant_chat"} 1`)
	assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_call_duration_seconds_count{inference_path="hybrid",mode="enforce",outcome="redacted",surface="tenant_chat"} 1`)
	if strings.Contains(output, "synthetic safe marker") {
		t.Fatal("metrics must not contain sidecar input")
	}
}

func TestMaskingEngineMetricsRecordOneBatchCall(t *testing.T) {
	registry := metrics.NewRegistry()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"contractVersion":"ai-safety-detector-batch.v1","mode":"enforce",
			"model":{"modelId":"openai/privacy-filter","runtime":"cpu_only"},
			"results":[
				{"itemIndex":0,"outcome":"passed","redactedPrompt":"first","logSafePrompt":"first"},
				{"itemIndex":1,"outcome":"passed","redactedPrompt":"second","logSafePrompt":"second"}
			],
			"executionSummary":{"executionMode":"rules_only","modelInvocationCount":0,"acceptedModelDetectionCount":0},
			"latencyMs":1
		}`))
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(),
		Timeout:     time.Second,
		Mode:        ModeEnforce,
		Surface:     "tenant_chat",
		Metrics:     registry,
	})
	if _, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: "first"}, {Prompt: "second"},
	}); err != nil {
		t.Fatalf("apply masking batch: %v", err)
	}

	output := registry.RenderPrometheus()
	assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_calls_total{inference_path="rules_only",mode="enforce",outcome="passed",surface="tenant_chat"} 1`)
	if strings.Contains(output, `gatelm_ai_safety_sidecar_calls_total{inference_path="rules_only",mode="enforce",outcome="passed",surface="tenant_chat"} 2`) {
		t.Fatal("one batch request must be counted as one sidecar call")
	}
}

func TestMaskingEngineMetricsRecordOneBatchFallback(t *testing.T) {
	registry := metrics.NewRegistry()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"contractVersion":"ai-safety-detector-batch.v1","mode":"enforce",
			"model":{"modelId":"openai/privacy-filter","runtime":"cpu_only"},
			"results":[{"itemIndex":0,"outcome":"passed","redactedPrompt":"first","logSafePrompt":"first"}],
			"executionSummary":{"executionMode":"rules_only","modelInvocationCount":0,"acceptedModelDetectionCount":0},
			"latencyMs":1
		}`))
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(),
		Timeout:     time.Second,
		Mode:        ModeEnforce,
		Surface:     "tenant_chat",
		Metrics:     registry,
	})
	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: "first"}, {Prompt: "second"},
	})
	if err != nil {
		t.Fatalf("batch fallback must keep local results: %v", err)
	}
	if len(results) != 2 || results[0].RedactedPrompt != "first" || results[1].RedactedPrompt != "second" {
		t.Fatalf("unexpected batch fallback results: %+v", results)
	}

	output := registry.RenderPrometheus()
	assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_calls_total{inference_path="unknown",mode="enforce",outcome="invalid_response",surface="tenant_chat"} 1`)
	assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_fallback_total{mode="enforce",reason="invalid_response",surface="tenant_chat"} 1`)
}

func TestMaskingEngineMetricsClassifyFallbackWithoutErrorDetail(t *testing.T) {
	tests := []struct {
		name       string
		client     *http.Client
		server     func(t *testing.T) *httptest.Server
		timeout    time.Duration
		wantReason string
	}{
		{
			name: "http_error",
			server: func(t *testing.T) *httptest.Server {
				return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					http.Error(w, "internal detail must not appear", http.StatusServiceUnavailable)
				}))
			},
			timeout:    time.Second,
			wantReason: "http_error",
		},
		{
			name: "invalid_response",
			server: func(t *testing.T) *httptest.Server {
				return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					_, _ = w.Write([]byte(`{"status":"unexpected"}`))
				}))
			},
			timeout:    time.Second,
			wantReason: "invalid_response",
		},
		{
			name: "transport_error",
			client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("internal detail must not appear")
			})},
			timeout:    time.Second,
			wantReason: "transport_error",
		},
		{
			name: "timeout",
			client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				<-request.Context().Done()
				return nil, request.Context().Err()
			})},
			timeout:    10 * time.Millisecond,
			wantReason: "timeout",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			registry := metrics.NewRegistry()
			endpoint := "http://sidecar.invalid/internal/ai-safety/v1/detect"
			client := test.client
			var server *httptest.Server
			if test.server != nil {
				server = test.server(t)
				defer server.Close()
				endpoint = server.URL
				client = server.Client()
			}
			engine := NewMaskingEngine(MaskingEngineConfig{
				EndpointURL: endpoint,
				HTTPClient:  client,
				Timeout:     test.timeout,
				Mode:        ModeEnforce,
				Surface:     "gateway_v1",
				Metrics:     registry,
			})
			result, err := engine.Apply(context.Background(), maskdomain.ApplyRequest{Prompt: "safe fallback marker"})
			if err != nil {
				t.Fatalf("fallback must preserve local result: %v", err)
			}
			if result.RedactedPrompt != "safe fallback marker" {
				t.Fatalf("unexpected local fallback result: %+v", result)
			}

			output := registry.RenderPrometheus()
			assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_calls_total{inference_path="unknown",mode="enforce",outcome="`+test.wantReason+`",surface="gateway_v1"} 1`)
			assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_fallback_total{mode="enforce",reason="`+test.wantReason+`",surface="gateway_v1"} 1`)
			if strings.Contains(output, "internal detail") || strings.Contains(output, "safe fallback marker") {
				t.Fatal("metrics must not contain input or upstream error detail")
			}
		})
	}
}

func TestMaskingEngineCallerCancellationDoesNotRecordFallback(t *testing.T) {
	registry := metrics.NewRegistry()
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: "http://sidecar.invalid/internal/ai-safety/v1/detect",
		HTTPClient:  client,
		Timeout:     time.Second,
		Mode:        ModeEnforce,
		Surface:     "tenant_chat",
		Metrics:     registry,
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := engine.Apply(ctx, maskdomain.ApplyRequest{Prompt: "safe cancellation marker"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected caller cancellation, got %v", err)
	}
	output := registry.RenderPrometheus()
	assertSidecarMetric(t, output, `gatelm_ai_safety_sidecar_calls_total{inference_path="unknown",mode="enforce",outcome="cancelled",surface="tenant_chat"} 1`)
	if strings.Contains(output, "gatelm_ai_safety_sidecar_fallback_total{") {
		t.Fatal("caller cancellation must not be counted as availability fallback")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func assertSidecarMetric(t *testing.T, output string, expected string) {
	t.Helper()
	if !strings.Contains(output, expected) {
		t.Fatalf("expected metric %q\n%s", expected, output)
	}
}
