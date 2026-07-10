package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	aiservice "gatelm/apps/gateway-core/internal/adapters/safety/aiservice"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/provider"
)

func TestChatCompletionsHandlerBlocksWhenAiSafetySidecarBlocks(t *testing.T) {
	syntheticBlockedValue := "ACCT-SYNTHETIC-0001"
	redactedPrompt := "Review synthetic account ref [ACCOUNT_NUMBER_REDACTED]."
	sidecarCalls := 0
	sidecar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/ai-safety/v1/detect" {
			t.Fatalf("unexpected sidecar path: %s", r.URL.Path)
		}
		sidecarCalls++

		var req struct {
			ContractVersion string `json:"contractVersion"`
			Mode            string `json:"mode"`
			Input           struct {
				PromptText string `json:"promptText"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode sidecar request: %v", err)
		}
		if req.ContractVersion != "ai-safety-detector.v1" || req.Mode != "shadow" {
			t.Fatalf("unexpected sidecar request metadata: %+v", req)
		}
		if !strings.Contains(req.Input.PromptText, syntheticBlockedValue) {
			t.Fatalf("sidecar must receive transient prompt text for detection")
		}

		writeTestJSON(t, w, http.StatusOK, map[string]any{
			"contractVersion": "ai-safety-detector.v1",
			"model": map[string]any{
				"modelId": "openai/privacy-filter",
				"runtime": "cpu_only",
			},
			"outcome":               "blocked",
			"mode":                  "shadow",
			"redactedPrompt":        redactedPrompt,
			"redactedPromptPreview": redactedPrompt,
			"detectorSummary": map[string]any{
				"detectedCount":      1,
				"detectorCategories": []string{"account_number"},
			},
			"detections": []map[string]any{
				{
					"detectorType": "account_number",
					"source":       "privacy_filter_adapter",
					"confidence":   0.92,
					"action":       "block",
					"mode":         "shadow",
				},
			},
			"latencyMs": 3,
		})
	}))
	defer sidecar.Close()

	chatCalls := 0
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
		MaskingEngine: aiservice.NewMaskingEngine(aiservice.MaskingEngineConfig{
			Local:       maskdomain.NewP0Engine(),
			EndpointURL: sidecar.URL + "/internal/ai-safety/v1/detect",
			HTTPClient:  sidecar.Client(),
			Timeout:     time.Second,
		}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Review synthetic account ref "+syntheticBlockedValue+".")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if sidecarCalls != 1 {
		t.Fatalf("expected one sidecar call, got %d", sidecarCalls)
	}
	if chatCalls != 0 {
		t.Fatalf("sidecar safety block must bypass provider, got %d provider calls", chatCalls)
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("X-GateLM-Masking-Action"); got != "blocked" {
		t.Fatalf("expected masking action blocked header, got %q", got)
	}
	if got := rr.Header().Get("X-GateLM-Cache-Status"); got != "bypass" {
		t.Fatalf("expected sidecar block to bypass cache, got %q", got)
	}
	assertGatewayErrorCode(t, rr, "sensitive_data_blocked")
	if strings.Contains(rr.Body.String(), syntheticBlockedValue) {
		t.Fatalf("blocked response must not include raw sensitive value: %s", rr.Body.String())
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.Status != invocationlog.StatusBlocked || logged.HTTPStatus != http.StatusForbidden {
		t.Fatalf("unexpected blocked terminal status: %+v", logged)
	}
	if logged.DomainOutcomes.Safety.Outcome != "blocked" ||
		logged.DomainOutcomes.Provider.Outcome != "not_called" ||
		logged.DomainOutcomes.Cache.Outcome != "bypassed" ||
		logged.DomainOutcomes.Streaming.Outcome != "not_streaming" {
		t.Fatalf("unexpected sidecar blocked outcomes: %+v", logged.DomainOutcomes)
	}
	if logged.MaskingAction != "blocked" || logged.MaskingDetectedCount != 1 ||
		strings.Join(logged.MaskingDetectedTypes, ",") != "account_number" {
		t.Fatalf("unexpected sidecar masking metadata: %+v", logged)
	}
	if logged.RedactedPromptPreview != redactedPrompt || strings.Contains(logged.RedactedPromptPreview, syntheticBlockedValue) {
		t.Fatalf("blocked log preview must be sanitized, got %q", logged.RedactedPromptPreview)
	}
}

func TestChatCompletionsHandlerUsesAiSafetySidecarRedactedPrompt(t *testing.T) {
	syntheticRawValue := "SIDE-CAR-ONLY-PRIVATE-URL"
	redactedPrompt := "Summarize [PRIVATE_URL_REDACTED] for the support note."
	sidecarCalls := 0
	sidecar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sidecarCalls++
		writeTestJSON(t, w, http.StatusOK, map[string]any{
			"contractVersion": "ai-safety-detector.v1",
			"model": map[string]any{
				"modelId": "openai/privacy-filter",
				"runtime": "cpu_only",
			},
			"outcome":               "redacted",
			"mode":                  "shadow",
			"redactedPrompt":        redactedPrompt,
			"redactedPromptPreview": redactedPrompt,
			"detectorSummary": map[string]any{
				"detectedCount":      1,
				"detectorCategories": []string{"private_url"},
			},
			"detections": []map[string]any{
				{
					"detectorType": "private_url",
					"source":       "privacy_filter_adapter",
					"action":       "redact",
					"mode":         "shadow",
				},
			},
			"latencyMs": 4,
		})
	}))
	defer sidecar.Close()

	chatCalls := 0
	var providerRequests []provider.ChatCompletionRequest
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &chatCalls,
			requests: &providerRequests,
		}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
		MaskingEngine: aiservice.NewMaskingEngine(aiservice.MaskingEngineConfig{
			Local:       maskdomain.NewP0Engine(),
			EndpointURL: sidecar.URL,
			HTTPClient:  sidecar.Client(),
			Timeout:     time.Second,
		}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Summarize "+syntheticRawValue+" for the support note.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if sidecarCalls != 1 || chatCalls != 1 {
		t.Fatalf("expected one sidecar call and one provider call, got sidecar=%d provider=%d", sidecarCalls, chatCalls)
	}
	if got := rr.Header().Get("X-GateLM-Masking-Action"); got != "redacted" {
		t.Fatalf("expected masking action redacted header, got %q", got)
	}
	providerPrompt := recordedProviderPrompt(t, providerRequests)
	if providerPrompt != redactedPrompt || strings.Contains(providerPrompt, syntheticRawValue) {
		t.Fatalf("provider prompt must use sidecar redacted prompt, got %q", providerPrompt)
	}
	if strings.Contains(rr.Body.String(), syntheticRawValue) {
		t.Fatalf("response body must not include raw sensitive value: %s", rr.Body.String())
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.DomainOutcomes.Safety.Outcome != "redacted" || logged.MaskingAction != "redacted" {
		t.Fatalf("unexpected sidecar redacted safety metadata: %+v", logged)
	}
	if logged.RedactedPromptPreview != redactedPrompt || strings.Contains(logged.RedactedPromptPreview, syntheticRawValue) {
		t.Fatalf("redacted log preview must be sanitized, got %q", logged.RedactedPromptPreview)
	}
}

func TestChatCompletionsHandlerContinuesWhenAiSafetySidecarPasses(t *testing.T) {
	prompt := "Write a short safe refund response."
	sidecarCalls := 0
	sidecar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sidecarCalls++
		writeTestJSON(t, w, http.StatusOK, map[string]any{
			"contractVersion": "ai-safety-detector.v1",
			"model": map[string]any{
				"modelId": "openai/privacy-filter",
				"runtime": "cpu_only",
			},
			"outcome":               "passed",
			"mode":                  "shadow",
			"redactedPrompt":        prompt,
			"redactedPromptPreview": prompt,
			"detectorSummary": map[string]any{
				"detectedCount":      0,
				"detectorCategories": []string{},
			},
			"detections": []map[string]any{},
			"latencyMs":  2,
		})
	}))
	defer sidecar.Close()

	chatCalls := 0
	var providerRequests []provider.ChatCompletionRequest
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &chatCalls,
			requests: &providerRequests,
		}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
		MaskingEngine: aiservice.NewMaskingEngine(aiservice.MaskingEngineConfig{
			Local:       maskdomain.NewP0Engine(),
			EndpointURL: sidecar.URL,
			HTTPClient:  sidecar.Client(),
			Timeout:     time.Second,
		}),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody(prompt)))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if sidecarCalls != 1 || chatCalls != 1 {
		t.Fatalf("expected one sidecar call and one provider call, got sidecar=%d provider=%d", sidecarCalls, chatCalls)
	}
	if got := rr.Header().Get("X-GateLM-Masking-Action"); got != "none" {
		t.Fatalf("expected masking action none header, got %q", got)
	}
	if providerPrompt := recordedProviderPrompt(t, providerRequests); providerPrompt != prompt {
		t.Fatalf("sidecar passed request should keep prompt unchanged, got %q", providerPrompt)
	}
}

func TestChatCompletionsHandlerFallsBackToLocalMaskingWhenAiSafetySidecarTimesOut(t *testing.T) {
	sidecarCalls := 0
	sidecar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sidecarCalls++
		time.Sleep(50 * time.Millisecond)
		writeTestJSON(t, w, http.StatusOK, map[string]any{
			"contractVersion": "ai-safety-detector.v1",
			"outcome":         "passed",
			"mode":            "shadow",
			"redactedPrompt":  "late sidecar result",
			"detectorSummary": map[string]any{
				"detectedCount":      0,
				"detectorCategories": []string{},
			},
			"detections": []map[string]any{},
			"latencyMs":  50,
		})
	}))
	defer sidecar.Close()

	chatCalls := 0
	var providerRequests []provider.ChatCompletionRequest
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &chatCalls,
			requests: &providerRequests,
		}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
		MaskingEngine: aiservice.NewMaskingEngine(aiservice.MaskingEngineConfig{
			Local:       maskdomain.NewP0Engine(),
			EndpointURL: sidecar.URL,
			HTTPClient:  sidecar.Client(),
			Timeout:     50 * time.Millisecond,
		}),
	}
	withTestAuth(&handler)

	rawEmail := "safeuser@example.invalid"
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Email "+rawEmail+" about the refund.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if sidecarCalls != 1 || chatCalls != 1 {
		t.Fatalf("expected one sidecar attempt and one provider call, got sidecar=%d provider=%d", sidecarCalls, chatCalls)
	}
	if got := rr.Header().Get("X-GateLM-Masking-Action"); got != "redacted" {
		t.Fatalf("expected local masking fallback to redact, got %q", got)
	}
	providerPrompt := recordedProviderPrompt(t, providerRequests)
	if !strings.Contains(providerPrompt, "[EMAIL_1]") || strings.Contains(providerPrompt, rawEmail) {
		t.Fatalf("provider prompt must use local redaction after sidecar timeout, got %q", providerPrompt)
	}
}

func TestChatCompletionsHandlerFallsBackToLocalMaskingWhenAiSafetySidecarReturnsServerError(t *testing.T) {
	sidecarCalls := 0
	sidecar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sidecarCalls++
		http.Error(w, "sidecar model load failed", http.StatusInternalServerError)
	}))
	defer sidecar.Close()

	chatCalls := 0
	var providerRequests []provider.ChatCompletionRequest
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &chatCalls,
			requests: &providerRequests,
		}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
		MaskingEngine: aiservice.NewMaskingEngine(aiservice.MaskingEngineConfig{
			Local:       maskdomain.NewP0Engine(),
			EndpointURL: sidecar.URL,
			HTTPClient:  sidecar.Client(),
			Timeout:     time.Second,
		}),
	}
	withTestAuth(&handler)

	rawEmail := "fallbackuser@example.invalid"
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Email "+rawEmail+" about the invoice.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if sidecarCalls != 1 || chatCalls != 1 {
		t.Fatalf("expected one sidecar attempt and one provider call, got sidecar=%d provider=%d", sidecarCalls, chatCalls)
	}
	if got := rr.Header().Get("X-GateLM-Masking-Action"); got != "redacted" {
		t.Fatalf("expected local masking fallback to redact, got %q", got)
	}
	providerPrompt := recordedProviderPrompt(t, providerRequests)
	if !strings.Contains(providerPrompt, "[EMAIL_1]") || strings.Contains(providerPrompt, rawEmail) {
		t.Fatalf("provider prompt must use local redaction after sidecar server error, got %q", providerPrompt)
	}
	if strings.Contains(rr.Body.String(), "sidecar model load failed") {
		t.Fatalf("gateway response must not expose sidecar error body: %s", rr.Body.String())
	}
}
