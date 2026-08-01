package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	aiservice "gatelm/apps/gateway-core/internal/adapters/safety/aiservice"
)

func TestRunCountsDeterministicAllowlistedSamplesAndControl(t *testing.T) {
	var captured, notCaptured int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(aiservice.PIIShadowCaptureHeader) == "1" {
			captured++
		} else {
			notCaptured++
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion":       aiservice.ContractVersion,
			"model":                 map[string]any{"modelId": aiservice.DefaultModelID, "runtime": aiservice.DefaultRuntime},
			"outcome":               "passed",
			"mode":                  aiservice.ModeEnforce,
			"redactedPrompt":        "synthetic prompt",
			"logSafePrompt":         "synthetic prompt",
			"redactedPromptPreview": "synthetic prompt",
			"detectorSummary":       map[string]any{"detectedCount": 0, "detectorCategories": []string{}},
			"detections":            []any{},
			"executionSummary": map[string]any{
				"executionMode":               "rules_only",
				"modelInvocationCount":        0,
				"acceptedModelDetectionCount": 0,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()

	input := bytes.NewBufferString(`{"schemaVersion":"gatelm.pii-shadow-e2e-input.v1","items":[{"prompt":"one"},{"prompt":"two"}]}`)
	var stdout, stderr bytes.Buffer
	exitCode := run([]string{
		"--endpoint", server.URL,
		"--tenant-id", "00000000-0000-4000-8000-000000000100",
		"--control-tenant-id", "00000000-0000-4000-8000-000000000101",
		"--sample-basis-points", "10000",
	}, input, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("run exit code %d: %s", exitCode, stderr.String())
	}
	var output outputEnvelope
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if output.SampledRequestCount != 2 || output.DeterministicReplaySampledRequestCount != 2 {
		t.Fatalf("unexpected deterministic sample counts: %+v", output)
	}
	if output.ControlSampledRequestCount != 0 || output.ControlSuccessCount != 1 {
		t.Fatalf("unexpected control counts: %+v", output)
	}
	if output.RequestLatencyMs.Count != 2 || output.SampledRequestLatencyMs.Count != 2 ||
		output.NonSampledRequestLatencyMs.Count != 0 {
		t.Fatalf("unexpected latency counts: %+v", output)
	}
	if captured != 2 || notCaptured != 1 {
		t.Fatalf("unexpected capture headers: captured=%d notCaptured=%d", captured, notCaptured)
	}
}

func TestRunRejectsMatchingControlTenant(t *testing.T) {
	var stdout, stderr bytes.Buffer
	exitCode := run([]string{
		"--endpoint", "http://localhost",
		"--tenant-id", "tenant",
		"--control-tenant-id", "tenant",
	}, bytes.NewBufferString("{}"), &stdout, &stderr)

	if exitCode != 2 {
		t.Fatalf("expected argument failure, got %d", exitCode)
	}
}
