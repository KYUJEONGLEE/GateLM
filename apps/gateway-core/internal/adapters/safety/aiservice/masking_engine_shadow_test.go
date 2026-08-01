package aiservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
)

type shadowPassthroughMaskingEngine struct{}

func (shadowPassthroughMaskingEngine) Apply(_ context.Context, req maskdomain.ApplyRequest) (maskdomain.Result, error) {
	return maskdomain.Result{
		Action:                  maskdomain.ActionNone,
		RedactedPrompt:          req.Prompt,
		LogSafePrompt:           req.Prompt,
		SecurityPolicyVersionID: "security_policy_test",
	}, nil
}

func TestPIIShadowCaptureHeaderUsesOnlyGatewayDecision(t *testing.T) {
	for _, tc := range []struct {
		name       string
		tenantID   string
		wantHeader bool
	}{
		{name: "allowed tenant", tenantID: "tenant_demo", wantHeader: true},
		{name: "other tenant", tenantID: "tenant_other", wantHeader: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var capturedHeader string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				capturedHeader = r.Header.Get(PIIShadowCaptureHeader)
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"contractVersion":       ContractVersion,
					"model":                 map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
					"outcome":               "passed",
					"mode":                  ModeEnforce,
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

			engine := NewMaskingEngine(MaskingEngineConfig{
				Local:                      shadowPassthroughMaskingEngine{},
				EndpointURL:                server.URL,
				ModelID:                    DefaultModelID,
				Mode:                       ModeEnforce,
				PIIShadowEnabled:           true,
				PIIShadowAllowedTenantIDs:  []string{"tenant_demo"},
				PIIShadowSampleBasisPoints: maskdomain.PIIShadowSampleScale,
			})
			ctx := maskdomain.WithPIIShadowScope(context.Background(), tc.tenantID, "request_1")
			if _, err := engine.Apply(ctx, maskdomain.ApplyRequest{Prompt: "synthetic prompt"}); err != nil {
				t.Fatalf("apply masking: %v", err)
			}
			if got := capturedHeader == "1"; got != tc.wantHeader {
				t.Fatalf("unexpected capture header %q", capturedHeader)
			}
		})
	}
}

func TestPIIShadowCaptureHeaderIsAppliedToBatchRequest(t *testing.T) {
	var capturedHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeader = r.Header.Get(PIIShadowCaptureHeader)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"contractVersion": BatchContractVersion,
			"model":           map[string]any{"modelId": DefaultModelID, "runtime": DefaultRuntime},
			"mode":            ModeEnforce,
			"results": []any{map[string]any{
				"itemIndex":             0,
				"outcome":               "passed",
				"redactedPrompt":        "synthetic prompt",
				"logSafePrompt":         "synthetic prompt",
				"redactedPromptPreview": "synthetic prompt",
				"detectorSummary":       map[string]any{"detectedCount": 0, "detectorCategories": []string{}},
				"detections":            []any{},
			}},
			"executionSummary": map[string]any{
				"executionMode":               "rules_only",
				"modelInvocationCount":        0,
				"acceptedModelDetectionCount": 0,
			},
			"latencyMs": 1,
		})
	}))
	defer server.Close()

	engine := NewMaskingEngine(MaskingEngineConfig{
		Local:                      shadowPassthroughMaskingEngine{},
		EndpointURL:                server.URL,
		ModelID:                    DefaultModelID,
		Mode:                       ModeEnforce,
		PIIShadowEnabled:           true,
		PIIShadowAllowedTenantIDs:  []string{"tenant_demo"},
		PIIShadowSampleBasisPoints: maskdomain.PIIShadowSampleScale,
	})
	ctx := maskdomain.WithPIIShadowScope(context.Background(), "tenant_demo", "request_batch")
	if _, err := engine.ApplyBatch(ctx, []maskdomain.ApplyRequest{{Prompt: "synthetic prompt"}}); err != nil {
		t.Fatalf("apply batch masking: %v", err)
	}
	if capturedHeader != "1" {
		t.Fatalf("expected batch capture header, got %q", capturedHeader)
	}
}
