package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	staticruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/static"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	runtimeconfigstage "gatelm/apps/gateway-core/internal/pipeline/stages/runtimeconfig"
	"gatelm/apps/gateway-core/internal/ports"
)

func TestChatCompletionsSafetyRoutingCacheDemo(t *testing.T) {
	demo := newPhase3DemoHarness(t, runtimeconfig.CachePolicy{
		Enabled:    true,
		Type:       runtimeconfig.CacheTypeExact,
		TTLSeconds: 600,
	})

	safePrompt := "Write a short safe refund response."
	first := demo.exercise(t, "request_v1_phase3_safe_miss_001", safePrompt)
	firstResp := decodeChatCompletionResponse(t, first)
	if first.Code != http.StatusOK {
		t.Fatalf("expected first safe request to return 200, got %d: %s", first.Code, first.Body.String())
	}
	if first.Header().Get("X-GateLM-Cache-Status") != "miss" || firstResp.GateLM.CacheStatus != "miss" {
		t.Fatalf("expected first safe request to miss exact cache, header=%q gate_lm=%#v", first.Header().Get("X-GateLM-Cache-Status"), firstResp.GateLM)
	}
	if firstResp.GateLM.SelectedModel != "mock-fast" || firstResp.GateLM.RoutingReason != "short_prompt_low_cost" {
		t.Fatalf("unexpected model=auto routing result: %#v", firstResp.GateLM)
	}
	if *demo.providerCalls != 1 || demo.cacheStore.setCalls != 1 || demo.cacheStore.getCalls != 1 {
		t.Fatalf("unexpected first request evidence: provider=%d cache_get=%d cache_set=%d", *demo.providerCalls, demo.cacheStore.getCalls, demo.cacheStore.setCalls)
	}
	providerCallsAfterFirst := *demo.providerCalls
	cacheGetsAfterFirst := demo.cacheStore.getCalls
	cacheSetsAfterFirst := demo.cacheStore.setCalls
	firstMaterial := demo.keyBuilder.materials[0]
	if firstMaterial.SecurityPolicyVersionID != "hash_security_policy_phase3_demo" ||
		firstMaterial.RoutingPolicyVersionID != "hash_routing_policy_phase3_demo" ||
		firstMaterial.NormalizedRedactedPrompt != safePrompt {
		t.Fatalf("unexpected exact cache key material: %#v", firstMaterial)
	}

	second := demo.exercise(t, "request_v1_phase3_safe_hit_002", safePrompt)
	secondResp := decodeChatCompletionResponse(t, second)
	if second.Code != http.StatusOK {
		t.Fatalf("expected repeated safe request to return 200, got %d: %s", second.Code, second.Body.String())
	}
	if second.Header().Get("X-GateLM-Cache-Status") != "hit" || secondResp.GateLM.CacheStatus != "hit" {
		t.Fatalf("expected repeated safe request to hit exact cache, header=%q gate_lm=%#v", second.Header().Get("X-GateLM-Cache-Status"), secondResp.GateLM)
	}
	if *demo.providerCalls != 1 {
		t.Fatalf("cache hit must bypass provider, got provider calls=%d", *demo.providerCalls)
	}
	providerCallsAfterSecond := *demo.providerCalls
	if len(demo.logWriter.logs) < 2 || demo.logWriter.logs[1].Status != invocationlog.StatusSuccess ||
		demo.logWriter.logs[1].CacheHitRequestID != "request_v1_phase3_safe_miss_001" {
		t.Fatalf("unexpected cache hit terminal log: %#v", demo.logWriter.logs)
	}

	rawEmail := "user@example.invalid"
	rawPhone := "010-0000-0000"
	redactedPrompt := "Write a safe reply to " + rawEmail + " and ask them to call " + rawPhone + "."
	redacted := demo.exercise(t, "request_v1_phase3_redacted_003", redactedPrompt)
	redactedResp := decodeChatCompletionResponse(t, redacted)
	if redacted.Code != http.StatusOK {
		t.Fatalf("expected redacted request to return 200, got %d: %s", redacted.Code, redacted.Body.String())
	}
	if redacted.Header().Get("X-GateLM-Masking-Action") != "redacted" || redactedResp.GateLM.MaskingAction != "redacted" {
		t.Fatalf("expected masking action redacted, header=%q gate_lm=%#v", redacted.Header().Get("X-GateLM-Masking-Action"), redactedResp.GateLM)
	}
	if *demo.providerCalls != 2 {
		t.Fatalf("redacted request should continue to provider once, got provider calls=%d", *demo.providerCalls)
	}
	providerPrompt := providerPromptAt(t, *demo.providerRequests, 1)
	if !strings.Contains(providerPrompt, "[EMAIL_1]") || !strings.Contains(providerPrompt, "[PHONE_NUMBER_1]") {
		t.Fatalf("provider prompt must contain redaction placeholders, got %q", providerPrompt)
	}
	if strings.Contains(providerPrompt, rawEmail) || strings.Contains(providerPrompt, rawPhone) ||
		strings.Contains(redacted.Body.String(), rawEmail) || strings.Contains(redacted.Body.String(), rawPhone) {
		t.Fatalf("redacted flow must not expose raw sensitive values")
	}

	keyBuildsBeforeBlocked := len(demo.keyBuilder.materials)
	cacheGetsBeforeBlocked := demo.cacheStore.getCalls
	cacheSetsBeforeBlocked := demo.cacheStore.setCalls
	providerCallsBeforeBlocked := *demo.providerCalls
	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"
	blocked := demo.exercise(t, "request_v1_phase3_blocked_004", "Summarize api_key="+rawSecret)
	var blockedResp gatewayErrorResponse
	if err := json.NewDecoder(blocked.Body).Decode(&blockedResp); err != nil {
		t.Fatalf("decode blocked response: %v", err)
	}
	if blocked.Code != http.StatusForbidden || blockedResp.Error.Code != "sensitive_data_blocked" {
		t.Fatalf("expected 403 sensitive_data_blocked, got %d %#v", blocked.Code, blockedResp)
	}
	if blocked.Header().Get("X-GateLM-Cache-Status") != "bypass" || blocked.Header().Get("X-GateLM-Masking-Action") != "blocked" {
		t.Fatalf("unexpected blocked headers: cache=%q masking=%q", blocked.Header().Get("X-GateLM-Cache-Status"), blocked.Header().Get("X-GateLM-Masking-Action"))
	}
	if *demo.providerCalls != providerCallsBeforeBlocked ||
		len(demo.keyBuilder.materials) != keyBuildsBeforeBlocked ||
		demo.cacheStore.getCalls != cacheGetsBeforeBlocked ||
		demo.cacheStore.setCalls != cacheSetsBeforeBlocked {
		t.Fatalf("blocked request must stop before cache/provider, provider=%d key_builds=%d cache_get=%d cache_set=%d",
			*demo.providerCalls,
			len(demo.keyBuilder.materials),
			demo.cacheStore.getCalls,
			demo.cacheStore.setCalls,
		)
	}
	if strings.Contains(blocked.Body.String(), rawSecret) {
		t.Fatalf("blocked response must not expose raw credential-like value")
	}

	t.Logf("\n[Given]\n유효한 API Key와 App Token이 있고, active runtime config에서 rule-based safety, model=auto routing, exact cache가 켜져 있다.")
	t.Logf("\n[When #1 - 입력]\n%s", demoHTTPRequest(t, safePrompt))
	t.Logf("\n[Then #1 - 출력]\n%s", demoSuccessHTTPOutput(t, first, firstResp, map[string]any{
		"providerCalls": providerCallsAfterFirst,
		"cacheLookups":  cacheGetsAfterFirst,
		"cacheWrites":   cacheSetsAfterFirst,
		"의미":            "첫 safe 요청은 provider를 1회 호출하고 exact cache에 저장된다.",
	}))
	t.Logf("\n[When #2 - 입력]\n%s", demoHTTPRequest(t, safePrompt))
	t.Logf("\n[Then #2 - 출력]\n%s", demoSuccessHTTPOutput(t, second, secondResp, map[string]any{
		"cacheHitRequestId": demo.logWriter.logs[1].CacheHitRequestID,
		"providerCalls":     providerCallsAfterSecond,
		"providerBypassed":  providerCallsAfterSecond == providerCallsAfterFirst,
		"의미":                "같은 safe 요청은 exact cache hit로 응답하며 provider 비용을 다시 만들지 않는다.",
	}))
	t.Logf("\n[When #3 - 입력]\n%s", demoHTTPRequest(t, "Write a safe reply to <email> and ask them to call <phone_number>."))
	t.Logf("\n[Then #3 - 출력]\n%s", demoSuccessHTTPOutput(t, redacted, redactedResp, map[string]any{
		"providerPromptPreview":           "Write a safe reply to [EMAIL_1] and ask them to call [PHONE_NUMBER_1].",
		"providerPromptContainsMask":      strings.Contains(providerPrompt, "[EMAIL_1]") && strings.Contains(providerPrompt, "[PHONE_NUMBER_1]"),
		"rawSensitiveValueExposed":        false,
		"actualRawValuesHiddenFromOutput": true,
		"의미":                              "email/phone은 차단하지 않고 redaction 후 provider로 전달된다.",
	}))
	t.Logf("\n[When #4 - 입력]\n%s", demoHTTPRequest(t, "Summarize api_key=<credential_like_secret>"))
	t.Logf("\n[Then #4 - 출력]\n%s", demoErrorHTTPOutput(t, blocked, blockedResp, map[string]any{
		"providerCallsUnchanged":    *demo.providerCalls == providerCallsBeforeBlocked,
		"cacheBypassedBeforeKey":    len(demo.keyBuilder.materials) == keyBuildsBeforeBlocked,
		"cacheLookupsBeforeBlocked": cacheGetsBeforeBlocked,
		"cacheLookupsAfterBlocked":  demo.cacheStore.getCalls,
		"의미":                        "credential-like 입력은 403으로 차단되고 cache key build/cache lookup/provider call 전에 멈춘다.",
	}))
}

func TestChatCompletionsHandlerBypassesExactCacheWhenRuntimeCachePolicyDisabled(t *testing.T) {
	demo := newPhase3DemoHarness(t, runtimeconfig.CachePolicy{
		Enabled:    false,
		Type:       runtimeconfig.CacheTypeExact,
		TTLSeconds: 600,
	})

	rr := demo.exercise(t, "request_v1_phase3_cache_disabled_001", "Write a short safe response.")
	resp := decodeChatCompletionResponse(t, rr)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" || resp.GateLM.CacheStatus != "bypass" {
		t.Fatalf("disabled runtime cache policy must keep cache bypass, header=%q gate_lm=%#v", rr.Header().Get("X-GateLM-Cache-Status"), resp.GateLM)
	}
	if len(demo.keyBuilder.materials) != 0 || demo.cacheStore.getCalls != 0 || demo.cacheStore.setCalls != 0 {
		t.Fatalf("disabled runtime cache policy must not build key or touch cache store, key_builds=%d get=%d set=%d",
			len(demo.keyBuilder.materials),
			demo.cacheStore.getCalls,
			demo.cacheStore.setCalls,
		)
	}
	if *demo.providerCalls != 1 {
		t.Fatalf("cache bypass should still continue to provider, got provider calls=%d", *demo.providerCalls)
	}
}

func TestExactCachePolicyAllowsLookupHandlesNilAndLegacyContext(t *testing.T) {
	if exactCachePolicyAllowsLookup(nil) {
		t.Fatal("nil request context must not allow exact cache lookup")
	}

	legacyReqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_legacy_cache_policy",
		TraceID:   "request_legacy_cache_policy",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	if !exactCachePolicyAllowsLookup(legacyReqCtx) {
		t.Fatal("missing runtime cache policy must preserve legacy exact cache behavior")
	}

	disabledReqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_disabled_cache_policy",
		TraceID:   "request_disabled_cache_policy",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	disabledReqCtx.HasRuntimeCachePolicy = true
	disabledReqCtx.RuntimeCachePolicy = runtimeconfig.CachePolicy{
		Enabled: false,
		Type:    runtimeconfig.CacheTypeExact,
	}
	if exactCachePolicyAllowsLookup(disabledReqCtx) {
		t.Fatal("disabled runtime exact cache policy must not allow lookup")
	}
}

type phase3DemoHarness struct {
	handler          *ChatCompletionsHandler
	providerCalls    *int
	providerRequests *[]provider.ChatCompletionRequest
	cacheStore       *phase3MemoryExactCacheStore
	keyBuilder       *phase3RecordingExactKeyBuilder
	logWriter        *recordingTerminalLogWriter
}

func newPhase3DemoHarness(t *testing.T, cachePolicy runtimeconfig.CachePolicy) phase3DemoHarness {
	t.Helper()

	providerCalls := 0
	providerRequests := []provider.ChatCompletionRequest{}
	cacheStore := newPhase3MemoryExactCacheStore()
	keyBuilder := &phase3RecordingExactKeyBuilder{secret: []byte("cache_key_secret_for_v1_phase3_demo_only")}
	logWriter := &recordingTerminalLogWriter{}
	handler := &ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &providerCalls,
			requests: &providerRequests,
		}),
		DefaultModel:         "mock-balanced",
		DefaultProvider:      "mock",
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: keyBuilder,
		CachePolicyHash:      "cache_policy_phase3_demo",
		TerminalLogWriter:    logWriter,
		RateLimitPipeline: pipeline.New(runtimeconfigstage.NewStage(staticruntimeconfig.NewProvider(runtimeconfig.ActiveConfig{
			ConfigVersion:     "runtime_config_phase3_demo",
			ConfigHash:        "hash_runtime_config_phase3_demo",
			PublishState:      runtimeconfig.PublishStateActive,
			TenantID:          testTenantID,
			TenantStatus:      runtimeconfig.StatusActive,
			ProjectID:         testProjectID,
			ProjectStatus:     runtimeconfig.StatusActive,
			ApplicationID:     testAppID,
			ApplicationStatus: runtimeconfig.StatusActive,
			APIKeyID:          testAPIKeyID,
			APIKeyStatus:      runtimeconfig.StatusActive,
			AppTokenID:        testAppTokenID,
			AppTokenStatus:    runtimeconfig.StatusActive,
			SafetyPolicy: runtimeconfig.SafetyPolicy{
				SecurityPolicyHash: "hash_security_policy_phase3_demo",
			},
			RoutingPolicy: runtimeconfig.RoutingPolicy{
				DefaultProvider:     "mock",
				DefaultModel:        "mock-balanced",
				LowCostProvider:     "mock",
				LowCostModel:        "mock-fast",
				FallbackProvider:    "mock",
				FallbackModel:       "mock-balanced",
				ShortPromptMaxChars: 300,
				RoutingPolicyHash:   "hash_routing_policy_phase3_demo",
			},
			CachePolicy: cachePolicy,
		}))),
	}
	withTestAuth(handler)

	return phase3DemoHarness{
		handler:          handler,
		providerCalls:    &providerCalls,
		providerRequests: &providerRequests,
		cacheStore:       cacheStore,
		keyBuilder:       keyBuilder,
		logWriter:        logWriter,
	}
}

func (h phase3DemoHarness) exercise(t *testing.T, requestID string, prompt string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(phase3ChatCompletionBody(t, "auto", prompt)))
	req.Header.Set(middleware.RequestIDHeader, requestID)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	h.handler.ServeHTTP(rr, req)
	return rr
}

func phase3ChatCompletionBody(t *testing.T, model string, prompt string) string {
	t.Helper()

	body, err := json.Marshal(provider.ChatCompletionRequest{
		Model: model,
		Messages: []provider.ChatMessage{
			{
				Role:    "user",
				Content: json.RawMessage(jsonStringLiteral(prompt)),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal chat completion body: %v", err)
	}
	return string(body)
}

func demoHTTPRequest(t *testing.T, prompt string) string {
	t.Helper()

	return "POST /v1/chat/completions\n" +
		"Authorization: Bearer <redacted>\n" +
		"X-GateLM-App-Token: <redacted>\n" +
		"body:\n" +
		indentLines(demoChatBodyJSON(t, prompt), "  ")
}

func demoSuccessHTTPOutput(t *testing.T, rr *httptest.ResponseRecorder, resp provider.ChatCompletionResponse, evidence map[string]any) string {
	t.Helper()

	gateLM := map[string]any{}
	if resp.GateLM != nil {
		gateLM = map[string]any{
			"requestId":        resp.GateLM.RequestID,
			"requestedModel":   resp.GateLM.RequestedModel,
			"selectedProvider": resp.GateLM.SelectedProvider,
			"selectedModel":    resp.GateLM.SelectedModel,
			"routingReason":    resp.GateLM.RoutingReason,
			"cacheStatus":      resp.GateLM.CacheStatus,
			"maskingAction":    resp.GateLM.MaskingAction,
		}
	}

	return demoJSON(t, map[string]any{
		"httpStatus": rr.Code,
		"headers": map[string]string{
			"X-GateLM-Request-Id":      rr.Header().Get("X-GateLM-Request-Id"),
			"X-GateLM-Cache-Status":    rr.Header().Get("X-GateLM-Cache-Status"),
			"X-GateLM-Routed-Provider": rr.Header().Get("X-GateLM-Routed-Provider"),
			"X-GateLM-Routed-Model":    rr.Header().Get("X-GateLM-Routed-Model"),
			"X-GateLM-Masking-Action":  rr.Header().Get("X-GateLM-Masking-Action"),
		},
		"body.gate_lm": gateLM,
		"evidence":     evidence,
	})
}

func demoErrorHTTPOutput(t *testing.T, rr *httptest.ResponseRecorder, resp gatewayErrorResponse, evidence map[string]any) string {
	t.Helper()

	return demoJSON(t, map[string]any{
		"httpStatus": rr.Code,
		"headers": map[string]string{
			"X-GateLM-Request-Id":     rr.Header().Get("X-GateLM-Request-Id"),
			"X-GateLM-Cache-Status":   rr.Header().Get("X-GateLM-Cache-Status"),
			"X-GateLM-Masking-Action": rr.Header().Get("X-GateLM-Masking-Action"),
		},
		"body.error": map[string]any{
			"code":      resp.Error.Code,
			"message":   resp.Error.Message,
			"requestId": resp.Error.RequestID,
		},
		"evidence": evidence,
	})
}

func demoChatBodyJSON(t *testing.T, prompt string) string {
	t.Helper()

	return demoJSON(t, map[string]any{
		"model": "auto",
		"messages": []map[string]string{
			{
				"role":    "user",
				"content": prompt,
			},
		},
	})
}

func demoJSON(t *testing.T, value any) string {
	t.Helper()

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		t.Fatalf("marshal demo json: %v", err)
	}
	return strings.TrimSpace(buffer.String())
}

func indentLines(value string, prefix string) string {
	lines := strings.Split(value, "\n")
	for index, line := range lines {
		lines[index] = prefix + line
	}
	return strings.Join(lines, "\n")
}

func providerPromptAt(t *testing.T, requests []provider.ChatCompletionRequest, index int) string {
	t.Helper()

	if index < 0 || index >= len(requests) {
		t.Fatalf("provider request index out of range: index=%d len=%d", index, len(requests))
	}
	promptText, err := extractTextPrompt(requests[index].Messages)
	if err != nil {
		t.Fatalf("extract provider prompt: %v", err)
	}
	return promptText
}

type phase3RecordingExactKeyBuilder struct {
	secret    []byte
	materials []cachekey.KeyMaterial
}

func (b *phase3RecordingExactKeyBuilder) BuildExactKey(ctx context.Context, material cachekey.KeyMaterial) (string, error) {
	b.materials = append(b.materials, material)
	return cachekey.NewExactKeyBuilder(b.secret).BuildExactKey(ctx, material)
}

type phase3MemoryExactCacheStore struct {
	getCalls int
	setCalls int
	entries  map[string]ports.CacheEntry
}

func newPhase3MemoryExactCacheStore() *phase3MemoryExactCacheStore {
	return &phase3MemoryExactCacheStore{entries: map[string]ports.CacheEntry{}}
}

func (s *phase3MemoryExactCacheStore) GetExact(ctx context.Context, keyHash string) (ports.CacheLookupResult, error) {
	s.getCalls++
	entry, ok := s.entries[keyHash]
	if !ok {
		return ports.CacheLookupResult{}, nil
	}
	return ports.CacheLookupResult{
		Hit:               true,
		CacheHitRequestID: entry.RequestID,
		Payload:           append([]byte(nil), entry.Payload...),
	}, nil
}

func (s *phase3MemoryExactCacheStore) SetExact(ctx context.Context, entry ports.CacheEntry) error {
	s.setCalls++
	entry.Payload = append([]byte(nil), entry.Payload...)
	s.entries[entry.KeyHash] = entry
	return nil
}
