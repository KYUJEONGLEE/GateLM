package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	staticprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/static"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/request"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/ports"
)

func TestChatCompletionsExactCacheRoutingAwareDifferentSelectedProviderMustMiss(t *testing.T) {
	harness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:routing-aware-catalog-provider"))
	harness.routes = map[string]routingAwareRoute{
		"request_provider_a": {providerName: "provider-a", modelID: "model_shared"},
		"request_provider_b": {providerName: "provider-b", modelID: "model_shared"},
	}

	first := harness.exercise(t, "request_provider_a", routingAwareChatBody("auto", "same prompt"))
	second := harness.exercise(t, "request_provider_b", routingAwareChatBody("auto", "same prompt"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 한다. first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if got := second.Header().Get("X-GateLM-Cache-Status"); got == "hit" {
		t.Fatalf("selected provider가 다르면 exact cache hit가 나면 안 된다. cache=%q", got)
	}
	if harness.provider.calls != 2 {
		t.Fatalf("두 번째 요청은 provider를 다시 호출해야 한다. provider_calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsExactCacheRoutingAwareDifferentSelectedModelMustMiss(t *testing.T) {
	harness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:routing-aware-catalog-model"))
	harness.routes = map[string]routingAwareRoute{
		"request_model_low":      {providerName: "provider-a", modelID: "model_low"},
		"request_model_balanced": {providerName: "provider-a", modelID: "model_balanced"},
	}

	first := harness.exercise(t, "request_model_low", routingAwareChatBody("auto", "same prompt"))
	second := harness.exercise(t, "request_model_balanced", routingAwareChatBody("auto", "same prompt"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 한다. first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if got := second.Header().Get("X-GateLM-Cache-Status"); got == "hit" {
		t.Fatalf("selected model이 다르면 exact cache hit가 나면 안 된다. cache=%q", got)
	}
	if harness.provider.calls != 2 {
		t.Fatalf("두 번째 요청은 provider를 다시 호출해야 한다. provider_calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsExactCacheRoutingAwareDifferentProviderCatalogHashMustMiss(t *testing.T) {
	store := &routingAwareMemoryStore{entries: map[string]ports.CacheEntry{}}
	keyBuilder := cachekey.NewExactKeyBuilder([]byte("routing-aware-cache-key-secret"))

	firstHarness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:catalog-before-change"))
	firstHarness.cacheStore = store
	firstHarness.handler.ExactCacheStore = store
	firstHarness.handler.ExactCacheKeyBuilder = keyBuilder
	firstHarness.routes = map[string]routingAwareRoute{
		"request_catalog_before": {providerName: "provider-a", modelID: "model_low"},
	}

	secondHarness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:catalog-after-change"))
	secondHarness.cacheStore = store
	secondHarness.handler.ExactCacheStore = store
	secondHarness.handler.ExactCacheKeyBuilder = keyBuilder
	secondHarness.routes = map[string]routingAwareRoute{
		"request_catalog_after": {providerName: "provider-a", modelID: "model_low"},
	}

	first := firstHarness.exercise(t, "request_catalog_before", routingAwareChatBody("auto", "same prompt"))
	second := secondHarness.exercise(t, "request_catalog_after", routingAwareChatBody("auto", "same prompt"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 한다. first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if got := second.Header().Get("X-GateLM-Cache-Status"); got == "hit" {
		t.Fatalf("providerCatalogContentHash가 다르면 exact cache hit가 나면 안 된다. cache=%q", got)
	}
	if secondHarness.provider.calls != 1 {
		t.Fatalf("catalog 변경 후 요청은 provider를 호출해야 한다. provider_calls=%d", secondHarness.provider.calls)
	}
}

func TestChatCompletionsExactCacheRoutingAwareDifferentRoutingDecisionKeyHashMustMiss(t *testing.T) {
	harness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:routing-aware-catalog-decision"))
	harness.routes = map[string]routingAwareRoute{
		"request_decision_general": {providerName: "provider-a", modelID: "model_low", decisionHash: "sha256:routing-decision-general"},
		"request_decision_code":    {providerName: "provider-a", modelID: "model_low", decisionHash: "sha256:routing-decision-code"},
	}

	first := harness.exercise(t, "request_decision_general", routingAwareChatBody("auto", "same prompt"))
	second := harness.exercise(t, "request_decision_code", routingAwareChatBody("auto", "same prompt"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 한다. first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if got := second.Header().Get("X-GateLM-Cache-Status"); got == "hit" {
		t.Fatalf("routingDecisionKeyHash가 다르면 exact cache hit가 나면 안 된다. cache=%q", got)
	}
	if harness.provider.calls != 2 {
		t.Fatalf("두 번째 요청은 provider를 다시 호출해야 한다. provider_calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsExactCacheRoutingAwareDifferentRequestParamsMustMiss(t *testing.T) {
	harness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:routing-aware-catalog-params"))
	harness.routes = map[string]routingAwareRoute{
		"request_temp_low":  {providerName: "provider-a", modelID: "model_low"},
		"request_temp_high": {providerName: "provider-a", modelID: "model_low"},
	}

	first := harness.exercise(t, "request_temp_low", routingAwareChatBodyWithTemperature("auto", "same prompt", 0.1))
	second := harness.exercise(t, "request_temp_high", routingAwareChatBodyWithTemperature("auto", "same prompt", 0.9))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 한다. first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if got := second.Header().Get("X-GateLM-Cache-Status"); got == "hit" {
		t.Fatalf("requestParamsHash가 다르면 exact cache hit가 나면 안 된다. cache=%q", got)
	}
	if len(harness.keyBuilder.materials) < 2 || harness.keyBuilder.materials[0].RequestParamsHash == harness.keyBuilder.materials[1].RequestParamsHash {
		t.Fatalf("temperature 변경은 requestParamsHash를 바꿔야 한다. materials=%#v", harness.keyBuilder.materials)
	}
}

func TestChatCompletionsExactCacheRoutingAwareStreamBypassesLookupAndStore(t *testing.T) {
	harness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:routing-aware-catalog-stream"))
	harness.routes = map[string]routingAwareRoute{
		"request_stream": {providerName: "provider-a", modelID: "model_low"},
	}

	rr := harness.exercise(t, "request_stream", routingAwareStreamBody("auto", "same prompt"))

	if rr.Code != http.StatusOK {
		t.Fatalf("stream 요청은 성공해야 한다. status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.keyBuilder.calls != 0 || harness.cacheStore.getCalls != 0 || harness.cacheStore.setCalls != 0 {
		t.Fatalf("stream=true는 exact cache lookup/store를 bypass해야 한다. key=%d get=%d set=%d", harness.keyBuilder.calls, harness.cacheStore.getCalls, harness.cacheStore.setCalls)
	}
	if got := rr.Header().Get("X-GateLM-Cache-Status"); got != "bypass" {
		t.Fatalf("stream=true request log/detail 판단을 위해 cache status는 bypass여야 한다. cache=%q", got)
	}
}

func TestChatCompletionsExactCacheRoutingAwareFallbackSuccessDoesNotStore(t *testing.T) {
	primary := &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock, err: provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, context.DeadlineExceeded)}
	fallback := &routingAwareProviderAdapter{adapterType: "mock-fallback-adapter"}
	catalog := routingAwareCatalog("sha256:routing-aware-catalog-fallback")
	catalog.Providers[0].AdapterType = providercatalog.AdapterTypeMock
	catalog.Providers[1].AdapterType = "mock-fallback-adapter"
	cacheStore := &routingAwareMemoryStore{entries: map[string]ports.CacheEntry{}}
	keyBuilder := &routingAwareRecordingExactKeyBuilder{delegate: cachekey.NewExactKeyBuilder([]byte("routing-aware-cache-key-secret"))}
	logWriter := &recordingTerminalLogWriter{}
	routes := map[string]routingAwareRoute{
		"request_fallback_first":  {providerName: "provider-a", modelID: "model_low"},
		"request_fallback_second": {providerName: "provider-a", modelID: "model_low"},
	}
	handler := &ChatCompletionsHandler{
		Providers:               provider.NewRegistry(providercatalog.AdapterTypeMock, primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		DefaultProvider:         "provider-a",
		DefaultModel:            "model_low",
		PreProviderPipeline:     routingAwarePipeline{catalog: catalog, routes: routes},
		ExactCacheStore:         cacheStore,
		ExactCacheKeyBuilder:    keyBuilder,
		CachePolicyHash:         "cache_policy_routing_aware_test",
		TerminalLogWriter:       logWriter,
	}
	withTestAuth(handler)

	first := routingAwareExercise(t, handler, "request_fallback_first", routingAwareChatBody("auto", "same prompt"))
	second := routingAwareExercise(t, handler, "request_fallback_second", routingAwareChatBody("auto", "same prompt"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("fallback success 요청은 성공해야 한다. first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if cacheStore.setCalls != 0 {
		t.Fatalf("fallback success 응답은 exact cache에 저장하면 안 된다. set_calls=%d", cacheStore.setCalls)
	}
	if fallback.calls != 2 {
		t.Fatalf("두 번째 요청이 fallback cache hit로 반환되면 안 된다. fallback_calls=%d", fallback.calls)
	}
}

func TestChatCompletionsExactCacheRoutingAwareTenantProjectApplicationIsolationStillHolds(t *testing.T) {
	base := cachekey.KeyMaterial{
		TenantID:                        "tenant_a",
		ProjectID:                       "project_a",
		ApplicationID:                   "app_a",
		RequestedModel:                  "auto",
		ProviderCatalogContentHash:      "sha256:catalog",
		ProviderID:                      "provider_a",
		ProviderCatalogStableKey:        "provider-a",
		ModelID:                         "model_low",
		RoutingPolicyHash:               "routing_policy",
		RoutingDecisionKeyHash:          "sha256:routing-decision",
		CachePolicyHash:                 "cache_policy",
		SafetyPolicyHash:                "safety_policy",
		MaskingPolicyHash:               "masking_policy",
		NormalizedMaskedRequestBodyHash: "sha256:masked-body",
		RequestParamsHash:               "sha256:params",
		CacheVersion:                    cachekey.ExactKeyMaterialVersion,
	}
	secret := []byte("routing-aware-cache-key-secret")
	baseKey, err := cachekey.BuildExactKey(secret, base)
	if err != nil {
		t.Fatalf("base exact cache key 생성 실패: %v", err)
	}

	cases := map[string]func(cachekey.KeyMaterial) cachekey.KeyMaterial{
		"tenant": func(material cachekey.KeyMaterial) cachekey.KeyMaterial {
			material.TenantID = "tenant_b"
			return material
		},
		"project": func(material cachekey.KeyMaterial) cachekey.KeyMaterial {
			material.ProjectID = "project_b"
			return material
		},
		"application": func(material cachekey.KeyMaterial) cachekey.KeyMaterial {
			material.ApplicationID = "app_b"
			return material
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			changed, err := cachekey.BuildExactKey(secret, mutate(base))
			if err != nil {
				t.Fatalf("changed exact cache key 생성 실패: %v", err)
			}
			if changed == baseKey {
				t.Fatalf("%s가 다르면 exact cache key도 달라져야 한다.", name)
			}
		})
	}
}

func TestChatCompletionsExactCacheRoutingAwareKeyMaterialDoesNotStoreRawPromptOrSecrets(t *testing.T) {
	harness := newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:routing-aware-catalog-secret"))
	harness.routes = map[string]routingAwareRoute{
		"request_secret_check": {providerName: "provider-a", modelID: "model_low"},
	}
	rawPrompt := "plain safe prompt with api_key=test_secret_should_not_appear"
	rr := harness.exercise(t, "request_secret_check", routingAwareChatBody("auto", rawPrompt))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("secret-like prompt는 masking에서 차단되어야 한다. status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.keyBuilder.calls != 0 || harness.cacheStore.getCalls != 0 || harness.cacheStore.setCalls != 0 {
		t.Fatalf("blocked secret-like prompt는 cache key/value/store에 도달하면 안 된다. key=%d get=%d set=%d", harness.keyBuilder.calls, harness.cacheStore.getCalls, harness.cacheStore.setCalls)
	}

	harness = newRoutingAwareCacheHarness(t, routingAwareCatalog("sha256:routing-aware-catalog-raw-prompt"))
	harness.routes = map[string]routingAwareRoute{
		"request_raw_prompt_check": {providerName: "provider-a", modelID: "model_low"},
	}
	safePrompt := "plain safe prompt must not appear in exact cache material"
	rr = harness.exercise(t, "request_raw_prompt_check", routingAwareChatBody("auto", safePrompt))
	if rr.Code != http.StatusOK {
		t.Fatalf("safe prompt 요청은 성공해야 한다. status=%d body=%s", rr.Code, rr.Body.String())
	}
	if len(harness.keyBuilder.materials) != 1 {
		t.Fatalf("safe prompt는 exact cache key를 한 번 생성해야 한다. materials=%#v", harness.keyBuilder.materials)
	}
	materialPayload, err := json.Marshal(harness.keyBuilder.materials[0])
	if err != nil {
		t.Fatalf("key material marshal 실패: %v", err)
	}
	if strings.Contains(string(materialPayload), safePrompt) || harness.keyBuilder.materials[0].NormalizedRedactedPrompt != "" {
		t.Fatalf("raw/redacted prompt text는 key material에 남으면 안 된다. material=%s", string(materialPayload))
	}
}

type routingAwareHarness struct {
	handler    *ChatCompletionsHandler
	catalog    providercatalog.Catalog
	provider   *routingAwareProviderAdapter
	cacheStore *routingAwareMemoryStore
	keyBuilder *routingAwareRecordingExactKeyBuilder
	routes     map[string]routingAwareRoute
}

func newRoutingAwareCacheHarness(t *testing.T, catalog providercatalog.Catalog) *routingAwareHarness {
	t.Helper()

	providerAdapter := &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	cacheStore := &routingAwareMemoryStore{entries: map[string]ports.CacheEntry{}}
	keyBuilder := &routingAwareRecordingExactKeyBuilder{delegate: cachekey.NewExactKeyBuilder([]byte("routing-aware-cache-key-secret"))}
	harness := &routingAwareHarness{
		catalog:    catalog,
		provider:   providerAdapter,
		cacheStore: cacheStore,
		keyBuilder: keyBuilder,
		routes:     map[string]routingAwareRoute{},
	}
	handler := &ChatCompletionsHandler{
		Providers:               provider.NewRegistry(providercatalog.AdapterTypeMock, providerAdapter),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		DefaultProvider:         "provider-a",
		DefaultModel:            "model_low",
		PreProviderPipeline:     routingAwarePipeline{catalog: catalog, routes: harness.routes},
		ExactCacheStore:         cacheStore,
		ExactCacheKeyBuilder:    keyBuilder,
		CachePolicyHash:         "cache_policy_routing_aware_test",
		TerminalLogWriter:       &recordingTerminalLogWriter{},
	}
	withTestAuth(handler)
	harness.handler = handler
	return harness
}

func (h *routingAwareHarness) exercise(t *testing.T, requestID string, body string) *httptest.ResponseRecorder {
	t.Helper()
	h.handler.PreProviderPipeline = routingAwarePipeline{catalog: h.catalog, routes: h.routes}
	return routingAwareExercise(t, h.handler, requestID, body)
}

func routingAwareExercise(t *testing.T, handler *ChatCompletionsHandler, requestID string, body string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set(middleware.RequestIDHeader, requestID)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

type routingAwareRoute struct {
	providerName      string
	modelID           string
	reason            string
	category          string
	routingPolicyHash string
	decisionHash      string
}

type routingAwarePipeline struct {
	catalog providercatalog.Catalog
	routes  map[string]routingAwareRoute
}

func (p routingAwarePipeline) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	route := p.routes[gatewayCtx.Request.RequestID]
	if route.providerName == "" {
		route.providerName = "provider-a"
	}
	if route.modelID == "" {
		route.modelID = "model_low"
	}
	if route.reason == "" {
		route.reason = "routing_aware_test"
	}
	if route.category == "" {
		route.category = routingdomain.CategoryGeneral
	}
	if route.routingPolicyHash == "" {
		route.routingPolicyHash = "routing_policy_routing_aware_test"
	}
	material := routingdomain.DecisionMaterial{
		RoutingMode:   routingdomain.RoutingModeAuto,
		Category:      route.category,
		Tier:          routingdomain.TierBalanced,
		Capability:    routingdomain.CapabilityChat,
		PolicyVariant: routingdomain.PolicyVariantDefault,
	}
	if route.decisionHash == "" {
		route.decisionHash, _ = routingdomain.DecisionKeyHash(material)
	}
	gatewayCtx.Runtime.Snapshot = runtimeconfig.RuntimeSnapshotProvenance{
		RuntimeSnapshotID:      "runtime_snapshot_routing_aware_test",
		RuntimeSnapshotVersion: 1,
		ContentHash:            "sha256:runtime-routing-aware-test",
		RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
		ProviderCatalogRef:     p.catalog.Reference(),
	}
	gatewayCtx.Runtime.RoutingPolicy = runtimeconfig.RoutingPolicy{
		FallbackProvider:  "provider-b",
		FallbackModel:     "model_low",
		RoutingPolicyHash: route.routingPolicyHash,
	}
	gatewayCtx.Runtime.HasRoutingPolicy = true
	gatewayCtx.Routing.RequestedModel = gatewayCtx.Request.RequestedModel
	gatewayCtx.Routing.SelectedProvider = route.providerName
	gatewayCtx.Routing.SelectedModel = route.modelID
	gatewayCtx.Routing.RoutingReason = route.reason
	gatewayCtx.Routing.RoutingPolicyHash = route.routingPolicyHash
	gatewayCtx.Routing.RoutingDecisionKeyHash = route.decisionHash
	gatewayCtx.Routing.RoutingDecisionMaterial = map[string]string{
		"routingMode":   material.RoutingMode,
		"category":      material.Category,
		"tier":          material.Tier,
		"capability":    material.Capability,
		"policyVariant": material.PolicyVariant,
	}
	return nil
}

type routingAwareProviderAdapter struct {
	adapterType string
	err         error
	calls       int
}

func (a *routingAwareProviderAdapter) AdapterType() string {
	return a.adapterType
}

func (a *routingAwareProviderAdapter) ListModels(context.Context, provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a *routingAwareProviderAdapter) CreateChatCompletion(_ context.Context, _ provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	a.calls++
	if a.err != nil {
		return nil, a.err
	}
	return &provider.ChatCompletionResponse{
		ID:      "chatcmpl_routing_aware_test",
		Object:  "chat.completion",
		Created: time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC).Unix(),
		Model:   req.Model,
		Choices: []provider.ChatChoice{{
			Index: 0,
			Message: provider.ChatMessage{
				Role:    "assistant",
				Content: json.RawMessage(`"routing aware response"`),
			},
			FinishReason: "stop",
		}},
		Usage: &provider.Usage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
	}, nil
}

type routingAwareRecordingExactKeyBuilder struct {
	delegate  cachekey.ExactKeyBuilder
	calls     int
	materials []cachekey.KeyMaterial
}

func (b *routingAwareRecordingExactKeyBuilder) BuildExactKey(ctx context.Context, material cachekey.KeyMaterial) (string, error) {
	b.calls++
	b.materials = append(b.materials, material)
	return b.delegate.BuildExactKey(ctx, material)
}

type routingAwareMemoryStore struct {
	getCalls int
	setCalls int
	entries  map[string]ports.CacheEntry
}

func (s *routingAwareMemoryStore) GetExact(_ context.Context, keyHash string) (ports.CacheLookupResult, error) {
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

func (s *routingAwareMemoryStore) SetExact(_ context.Context, entry ports.CacheEntry) error {
	s.setCalls++
	if s.entries == nil {
		s.entries = map[string]ports.CacheEntry{}
	}
	entry.Payload = append([]byte(nil), entry.Payload...)
	s.entries[entry.KeyHash] = entry
	return nil
}

func routingAwareCatalog(contentHash string) providercatalog.Catalog {
	return providercatalog.Catalog{
		CatalogID:      "provider_catalog_routing_aware_test",
		CatalogVersion: 1,
		ContentHash:    contentHash,
		Providers: []providercatalog.Provider{
			routingAwareCatalogProvider("provider_id_a", "provider-a", providercatalog.AdapterTypeMock, "provider-a-low"),
			routingAwareCatalogProvider("provider_id_b", "provider-b", providercatalog.AdapterTypeMock, "provider-b-low"),
		},
	}
}

func routingAwareCatalogProvider(providerID string, providerName string, adapterType string, lowModelName string) providercatalog.Provider {
	return providercatalog.Provider{
		ProviderID:         providerID,
		ProviderName:       providerName,
		AdapterType:        adapterType,
		Enabled:            true,
		BaseURL:            "https://" + providerName + ".example.test/v1",
		TimeoutMs:          1000,
		CredentialRequired: false,
		Models: []providercatalog.Model{
			{
				ModelID:   "model_shared",
				ModelName: lowModelName,
				Enabled:   true,
			},
			{
				ModelID:   "model_low",
				ModelName: lowModelName,
				Enabled:   true,
			},
			{
				ModelID:   "model_balanced",
				ModelName: providerName + "-balanced",
				Enabled:   true,
			},
		},
	}
}

func routingAwareChatBody(model string, prompt string) string {
	body, _ := json.Marshal(provider.ChatCompletionRequest{
		Model: model,
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: json.RawMessage(jsonStringLiteral(prompt)),
		}},
	})
	return string(body)
}

func routingAwareChatBodyWithTemperature(model string, prompt string, temperature float64) string {
	body, _ := json.Marshal(provider.ChatCompletionRequest{
		Model:       model,
		Temperature: &temperature,
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: json.RawMessage(jsonStringLiteral(prompt)),
		}},
	})
	return string(body)
}

func routingAwareStreamBody(model string, prompt string) string {
	body, _ := json.Marshal(provider.ChatCompletionRequest{
		Model:  model,
		Stream: true,
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: json.RawMessage(jsonStringLiteral(prompt)),
		}},
	})
	return string(body)
}

var _ credentials.Resolver = staticCredentialResolver{}
