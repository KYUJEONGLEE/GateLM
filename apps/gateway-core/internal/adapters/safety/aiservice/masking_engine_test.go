package aiservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
)

func TestMaskingEngineForwardsDetectorPolicyOverrides(t *testing.T) {
	var received detectRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode sidecar request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"contractVersion":"ai-safety-detector.v1",
			"model":{"modelId":"openai/privacy-filter","runtime":"cpu_only"},
			"outcome":"passed",
			"mode":"enforce",
			"redactedPrompt":"Write a safe synthetic reply.",
			"logSafePrompt":"Write a safe synthetic reply.",
			"detectorSummary":{"detectedCount":0,"detectorCategories":[]},
			"detections":[],
			"executionSummary":{"executionMode":"rules_only","modelInvocationCount":0,"acceptedModelDetectionCount":0},
			"latencyMs":1
		}`))
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL,
		HTTPClient:  server.Client(),
		Timeout:     time.Second,
	})
	_, err := engine.Apply(context.Background(), maskdomain.ApplyRequest{
		Prompt: "Write a safe synthetic reply.",
		DetectorPolicies: []maskdomain.DetectorPolicy{
			{DetectorType: "email", Action: maskdomain.PolicyActionAllow},
			{DetectorType: "person_name", Action: maskdomain.PolicyActionBlock},
			{DetectorType: "ignored", Action: maskdomain.PolicyAction("unsupported")},
		},
	})
	if err != nil {
		t.Fatalf("apply masking engine: %v", err)
	}

	got := received.DetectorConfig.DetectorPolicies
	if len(got) != 2 {
		t.Fatalf("expected two valid detector policy overrides, got %+v", got)
	}
	if got[0] != (detectPolicy{DetectorType: "email", Action: "allow"}) {
		t.Fatalf("unexpected first detector policy override: %+v", got[0])
	}
	if got[1] != (detectPolicy{DetectorType: "person_name", Action: "block"}) {
		t.Fatalf("unexpected second detector policy override: %+v", got[1])
	}
}

func TestMaskingEngineShadowModeDoesNotChangeProviderPromptOrAction(t *testing.T) {
	rawPrompt := "Review SYNTHETIC-MODEL-ONLY reference."
	redactedPrompt := "Review [ACCOUNT_NUMBER_REDACTED] reference."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var received detectRequest
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode sidecar request: %v", err)
		}
		if received.Mode != ModeShadow {
			t.Fatalf("expected shadow request mode, got %q", received.Mode)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion":       ContractVersion,
			"model":                 map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"outcome":               "blocked",
			"mode":                  ModeShadow,
			"redactedPrompt":        redactedPrompt,
			"logSafePrompt":         redactedPrompt,
			"redactedPromptPreview": redactedPrompt,
			"detectorSummary": map[string]any{
				"detectedCount":      1,
				"detectorCategories": []string{"account_number"},
			},
			"detections": []map[string]any{{
				"detectorType": "account_number",
				"source":       "synthetic_model",
				"action":       "block",
				"mode":         ModeShadow,
			}},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL,
		HTTPClient:  server.Client(),
		Timeout:     time.Second,
		Mode:        ModeShadow,
	})
	result, err := engine.Apply(context.Background(), maskdomain.ApplyRequest{Prompt: rawPrompt})
	if err != nil {
		t.Fatalf("apply masking engine: %v", err)
	}
	if result.Action != maskdomain.ActionNone {
		t.Fatalf("shadow result must keep local action, got %q", result.Action)
	}
	if result.RedactedPrompt != rawPrompt {
		t.Fatalf("shadow result must keep provider prompt unchanged, got %q", result.RedactedPrompt)
	}
	if result.LogSafePrompt != redactedPrompt {
		t.Fatalf("shadow result must keep model-safe log prompt, got %q", result.LogSafePrompt)
	}
	if len(result.DetectedTypes) != 1 || result.DetectedTypes[0] != "account_number" {
		t.Fatalf("shadow result must retain sanitized observation, got %+v", result.DetectedTypes)
	}
	if result.ExecutionSummary == nil || result.ExecutionSummary.ExecutionMode != "hybrid" || result.ExecutionSummary.ModelInvocationCount != 1 {
		t.Fatalf("single response must retain sanitized execution summary, got %+v", result.ExecutionSummary)
	}
}

func TestMaskingEngineSendsLocalRedactedPromptToSidecar(t *testing.T) {
	rawEmail := "local-first@example.invalid"
	rawPrompt := "Contact " + rawEmail + "."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var received detectRequest
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode sidecar request: %v", err)
		}
		if received.Input.PromptText == rawPrompt || received.Input.PromptText == "" {
			t.Fatalf("sidecar must receive the local-redacted prompt")
		}
		if strings.Contains(received.Input.PromptText, rawEmail) {
			t.Fatalf("sidecar input must not contain locally detected email")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": ContractVersion,
			"model":           map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"outcome":         "passed",
			"mode":            ModeEnforce,
			"redactedPrompt":  received.Input.PromptText,
			"logSafePrompt":   received.Input.PromptText,
			"detectorSummary": map[string]any{
				"detectedCount":      0,
				"detectorCategories": []string{},
			},
			"detections": []map[string]any{},
			"executionSummary": map[string]any{
				"executionMode": "rules_only", "modelInvocationCount": 0, "acceptedModelDetectionCount": 0,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL,
		HTTPClient:  server.Client(),
		Timeout:     time.Second,
		Mode:        ModeEnforce,
	})
	result, err := engine.Apply(context.Background(), maskdomain.ApplyRequest{Prompt: rawPrompt})
	if err != nil {
		t.Fatalf("apply masking engine: %v", err)
	}
	if strings.Contains(result.RedactedPrompt, rawEmail) {
		t.Fatalf("provider prompt must keep local email redaction")
	}
}

func TestMaskingEngineSingleResponseModelMismatchFallsBackToLocal(t *testing.T) {
	prompt := "Review model-only marker."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": ContractVersion,
			"model":           map[string]any{"modelId": "unexpected/model", "runtime": DefaultRuntime},
			"outcome":         "redacted",
			"mode":            ModeEnforce,
			"redactedPrompt":  "[MODEL_REDACTED]",
			"logSafePrompt":   "[MODEL_REDACTED]",
			"detectorSummary": map[string]any{"detectedCount": 1, "detectorCategories": []string{"secret"}},
			"detections":      []map[string]any{},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL, HTTPClient: server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})

	result, err := engine.Apply(context.Background(), maskdomain.ApplyRequest{Prompt: prompt})

	if err != nil {
		t.Fatalf("single model mismatch fallback: %v", err)
	}
	if result.RedactedPrompt != prompt || result.ExecutionSummary != nil {
		t.Fatalf("single model mismatch must use local result: %+v", result)
	}
}

func TestMaskingEngineBatchResponseRuntimeMismatchFallsBackAllItems(t *testing.T) {
	prompts := []string{"First model-only marker.", "Second model-only marker."}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": BatchContractVersion,
			"model":           map[string]any{"modelId": DefaultModelID, "runtime": "gpu"},
			"mode":            ModeEnforce,
			"results": []map[string]any{
				{"itemIndex": 0, "outcome": "redacted", "redactedPrompt": "[MODEL_0]", "logSafePrompt": "[MODEL_0]"},
				{"itemIndex": 1, "outcome": "redacted", "redactedPrompt": "[MODEL_1]", "logSafePrompt": "[MODEL_1]"},
			},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})

	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: prompts[0]}, {Prompt: prompts[1]},
	})

	if err != nil {
		t.Fatalf("batch runtime mismatch fallback: %v", err)
	}
	for index, result := range results {
		if result.RedactedPrompt != prompts[index] || result.ExecutionSummary != nil {
			t.Fatalf("batch runtime mismatch must use all-local results: %+v", results)
		}
	}
}

func TestMaskingEngineSingleRedactedResponseWithoutPromptFallsBackToLocal(t *testing.T) {
	prompt := "Review malformed redaction marker."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": ContractVersion,
			"model":           map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"outcome":         "redacted",
			"mode":            ModeEnforce,
			"redactedPrompt":  "   ",
			"logSafePrompt":   "[LOG_SAFE_REDACTED]",
			"detectorSummary": map[string]any{"detectedCount": 1, "detectorCategories": []string{"secret"}},
			"detections":      []map[string]any{},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL, HTTPClient: server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})

	result, err := engine.Apply(context.Background(), maskdomain.ApplyRequest{Prompt: prompt})

	if err != nil {
		t.Fatalf("single malformed redaction fallback: %v", err)
	}
	if result.Action != maskdomain.ActionNone || result.RedactedPrompt != prompt || result.ExecutionSummary != nil {
		t.Fatalf("single malformed redaction must use local result: %+v", result)
	}
}

func TestMaskingEngineBatchRedactedResponseWithoutPromptFallsBackAllItems(t *testing.T) {
	prompts := []string{"First malformed item.", "Second malformed item."}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": BatchContractVersion,
			"model":           map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"mode":            ModeEnforce,
			"results": []map[string]any{
				{"itemIndex": 0, "outcome": "passed", "redactedPrompt": prompts[0], "logSafePrompt": prompts[0]},
				{"itemIndex": 1, "outcome": "redacted", "redactedPrompt": "", "logSafePrompt": "[LOG_SAFE_REDACTED]"},
			},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})

	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: prompts[0]}, {Prompt: prompts[1]},
	})

	if err != nil {
		t.Fatalf("batch malformed redaction fallback: %v", err)
	}
	for index, result := range results {
		if result.Action != maskdomain.ActionNone || result.RedactedPrompt != prompts[index] || result.ExecutionSummary != nil {
			t.Fatalf("batch malformed redaction must use all-local results: %+v", results)
		}
	}
}

func TestMaskingEngineApplyBatchSkipsBlankItemAndMapsDenseResultToOriginalIndex(t *testing.T) {
	prompts := []string{"   ", "Review model-only value."}
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var received detectBatchRequest
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode dense batch request: %v", err)
		}
		if len(received.Inputs) != 1 || received.Inputs[0].ItemIndex != 0 {
			t.Fatalf("nonblank inputs must use dense indexes: %+v", received.Inputs)
		}
		if received.Inputs[0].PromptText != prompts[1] {
			t.Fatalf("unexpected dense batch prompt: %q", received.Inputs[0].PromptText)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": BatchContractVersion,
			"model":           map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"mode":            ModeEnforce,
			"results": []map[string]any{{
				"itemIndex": 0, "outcome": "redacted",
				"redactedPrompt": "[MODEL_REDACTED]", "logSafePrompt": "[MODEL_REDACTED]",
			}},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})

	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: prompts[0]}, {Prompt: prompts[1]},
	})

	if err != nil {
		t.Fatalf("apply dense nonblank batch: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected one dense sidecar call, got %d", calls)
	}
	if results[0].RedactedPrompt != prompts[0] || results[0].ExecutionSummary != nil {
		t.Fatalf("blank item must retain local result: %+v", results[0])
	}
	if results[1].RedactedPrompt != "[MODEL_REDACTED]" || results[1].ExecutionSummary == nil {
		t.Fatalf("dense result must map back to original nonblank index: %+v", results[1])
	}
}

func TestMaskingEngineApplyBatchUsesOneHTTPCallAndPreservesEntityScope(t *testing.T) {
	rawEmail := "batch-scope@example.invalid"
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/internal/ai-safety/v1/detect/batch" {
			t.Fatalf("unexpected batch path: %s", r.URL.Path)
		}
		var received detectBatchRequest
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode batch request: %v", err)
		}
		if len(received.Inputs) != 2 || received.ContractVersion != BatchContractVersion {
			t.Fatalf("unexpected batch request: %+v", received)
		}
		if len(received.PlaceholderCounters) != 2 ||
			received.PlaceholderCounters["EMAIL"] != 1 ||
			received.PlaceholderCounters["PERSON"] != 4 {
			t.Fatalf("batch request must contain raw-free placeholder counters: %+v", received.PlaceholderCounters)
		}
		for _, input := range received.Inputs {
			if strings.Contains(input.PromptText, rawEmail) || !strings.Contains(input.PromptText, "[EMAIL_1]") {
				t.Fatalf("batch input must contain stable local placeholder only: %q", input.PromptText)
			}
		}
		results := make([]map[string]any, 0, len(received.Inputs))
		for _, input := range received.Inputs {
			results = append(results, map[string]any{
				"itemIndex": input.ItemIndex, "outcome": "passed",
				"redactedPrompt": input.PromptText, "logSafePrompt": input.PromptText,
				"redactedPromptPreview": input.PromptText,
				"detectorSummary":       map[string]any{"detectedCount": 0, "detectorCategories": []string{}},
				"detections":            []map[string]any{},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": BatchContractVersion, "mode": ModeEnforce,
			"model":   map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"results": results,
			"executionSummary": map[string]any{
				"executionMode": "rules_only", "modelInvocationCount": 0, "acceptedModelDetectionCount": 0,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})
	scope := maskdomain.NewEntityScope()
	scope.SeedPlaceholderCounters(map[string]int{"PERSON": 4, "UNKNOWN": 99})
	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: "Contact " + rawEmail + ".", EntityScope: scope},
		{Prompt: "Email " + rawEmail + " again.", EntityScope: scope},
	})
	if err != nil {
		t.Fatalf("apply batch: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected one sidecar batch call, got %d", calls)
	}
	for _, result := range results {
		if strings.Contains(result.RedactedPrompt, rawEmail) || !strings.Contains(result.RedactedPrompt, "[EMAIL_1]") {
			t.Fatalf("unexpected entity-scoped result: %q", result.RedactedPrompt)
		}
		if result.ExecutionSummary == nil || result.ExecutionSummary.ExecutionMode != "rules_only" {
			t.Fatalf("missing sanitized execution summary: %+v", result.ExecutionSummary)
		}
	}
}

func TestMaskingEngineApplyBatchFallsBackAllItemsOnPartialResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": BatchContractVersion, "mode": ModeEnforce,
			"model": map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"results": []map[string]any{{
				"itemIndex": 0, "outcome": "redacted", "redactedPrompt": "[MODEL_REDACTED]",
				"logSafePrompt": "[MODEL_REDACTED]", "redactedPromptPreview": "[MODEL_REDACTED]",
				"detectorSummary": map[string]any{"detectedCount": 1, "detectorCategories": []string{"secret"}},
				"detections":      []map[string]any{},
			}},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})
	prompts := []string{"First model-only marker.", "Second model-only marker."}
	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: prompts[0]}, {Prompt: prompts[1]},
	})
	if err != nil {
		t.Fatalf("apply batch with partial response: %v", err)
	}
	for index, result := range results {
		if result.RedactedPrompt != prompts[index] || result.ExecutionSummary != nil {
			t.Fatalf("partial response must fall back every item: %+v", results)
		}
	}
}

func TestMaskingEngineApplyBatchShadowDoesNotEnforceModelBlock(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": BatchContractVersion, "mode": ModeShadow,
			"model": map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"results": []map[string]any{{
				"itemIndex": 0, "outcome": "blocked", "redactedPrompt": "[MODEL_BLOCKED]",
				"logSafePrompt": "[MODEL_BLOCKED]", "redactedPromptPreview": "[MODEL_BLOCKED]",
				"detectorSummary": map[string]any{"detectedCount": 1, "detectorCategories": []string{"secret"}},
				"detections":      []map[string]any{{"detectorType": "secret", "source": "model", "action": "block"}},
			}},
			"executionSummary": map[string]any{
				"executionMode": "hybrid", "modelInvocationCount": 1, "acceptedModelDetectionCount": 1,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeShadow,
	})
	prompt := "Model-only private marker."
	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{{Prompt: prompt}})
	if err != nil {
		t.Fatalf("apply shadow batch: %v", err)
	}
	if results[0].Action != maskdomain.ActionNone || results[0].RedactedPrompt != prompt {
		t.Fatalf("shadow batch must retain local provider result: %+v", results[0])
	}
	if results[0].LogSafePrompt != "[MODEL_BLOCKED]" {
		t.Fatalf("shadow batch must retain log-safe observation: %+v", results[0])
	}
}

func TestMaskingEngineApplyBatchTimeoutFallsBackAllItems(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		time.Sleep(40 * time.Millisecond)
		w.WriteHeader(http.StatusGatewayTimeout)
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: 5 * time.Millisecond, Mode: ModeEnforce,
	})
	prompts := []string{"First safe item.", "Second safe item."}
	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: prompts[0]}, {Prompt: prompts[1]},
	})
	if err != nil {
		t.Fatalf("apply timed out batch: %v", err)
	}
	if calls != 1 || results[0].RedactedPrompt != prompts[0] || results[1].RedactedPrompt != prompts[1] {
		t.Fatalf("timeout must use one call and all-local fallback: calls=%d results=%+v", calls, results)
	}
}

func TestMaskingEngineApplyBatchServerFailureFallsBackAllItems(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})
	prompts := []string{"First model candidate.", "Second model candidate."}
	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: prompts[0]}, {Prompt: prompts[1]},
	})
	if err != nil {
		t.Fatalf("server failure batch fallback: %v", err)
	}
	if calls != 1 || results[0].RedactedPrompt != prompts[0] || results[1].RedactedPrompt != prompts[1] {
		t.Fatalf("server failure must use one call and all-local fallback: calls=%d results=%+v", calls, results)
	}
}

func TestMaskingEngineApplyBatchLocalBlockSkipsSidecar(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	engine := NewMaskingEngine(MaskingEngineConfig{
		EndpointURL: server.URL + "/internal/ai-safety/v1/detect",
		HTTPClient:  server.Client(), Timeout: time.Second, Mode: ModeEnforce,
	})
	results, err := engine.ApplyBatch(context.Background(), []maskdomain.ApplyRequest{
		{Prompt: "Write a safe item."},
		{Prompt: "Authorization: Bearer synthetic-secret-value"},
	})
	if err != nil {
		t.Fatalf("apply locally blocked batch: %v", err)
	}
	if calls != 0 || results[1].Action != maskdomain.ActionBlocked {
		t.Fatalf("local mandatory block must skip sidecar: calls=%d results=%+v", calls, results)
	}
}

func TestValidExecutionSummaryRejectsModelDetectionsOnRulesOnlyPath(t *testing.T) {
	if validExecutionSummary(detectExecutionSummary{
		ExecutionMode:               "rules_only",
		ModelInvocationCount:        0,
		AcceptedModelDetectionCount: 1,
	}) {
		t.Fatal("rules-only response must not claim accepted model detections")
	}
}
