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
			"outcome":"passed",
			"mode":"enforce",
			"redactedPrompt":"Write a safe synthetic reply.",
			"logSafePrompt":"Write a safe synthetic reply.",
			"detectorSummary":{"detectedCount":0,"detectorCategories":[]},
			"detections":[],
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
			"outcome":         "passed",
			"mode":            ModeEnforce,
			"redactedPrompt":  received.Input.PromptText,
			"logSafePrompt":   received.Input.PromptText,
			"detectorSummary": map[string]any{
				"detectedCount":      0,
				"detectorCategories": []string{},
			},
			"detections": []map[string]any{},
			"latencyMs":  1,
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
