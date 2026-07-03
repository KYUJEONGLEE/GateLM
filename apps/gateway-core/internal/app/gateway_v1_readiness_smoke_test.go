package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	staticruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/static"
	"gatelm/apps/gateway-core/internal/config"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	ratelimitstage "gatelm/apps/gateway-core/internal/pipeline/stages/ratelimit"
	runtimeconfigstage "gatelm/apps/gateway-core/internal/pipeline/stages/runtimeconfig"
	"gatelm/apps/gateway-core/internal/ports"
)

const (
	readinessModelsRequestID      = "request_v1_readiness_models_001"
	readinessInvalidAPIRequestID  = "request_v1_readiness_invalid_api_key_002"
	readinessInvalidAppRequestID  = "request_v1_readiness_invalid_app_token_003"
	readinessSafeMissRequestID    = "request_v1_readiness_safe_success_004"
	readinessCacheHitRequestID    = "request_v1_readiness_cache_hit_005"
	readinessRedactedRequestID    = "request_v1_readiness_redacted_006"
	readinessBlockedRequestID     = "request_v1_readiness_blocked_007"
	readinessRateLimitedRequestID = "request_v1_readiness_rate_limited_008"
)

func TestGatewayV1ReadinessSmoke(t *testing.T) {
	harness := newGatewayReadinessHarness(t)

	modelsRR := harness.get(t, harness.validRouter, "/v1/models", readinessModelsRequestID)
	modelsResp := readinessDecodeModels(t, modelsRR)
	if modelsRR.Code != http.StatusOK || len(modelsResp.Data) != 2 {
		t.Fatalf("expected /v1/models to return two mock models, status=%d body=%s", modelsRR.Code, modelsRR.Body.String())
	}

	invalidAPI := harness.postChat(t, harness.invalidAPIRouter, readinessInvalidAPIRequestID, "<safe_prompt_not_logged>")
	invalidAPIResp := readinessDecodeError(t, invalidAPI)
	if invalidAPI.Code != http.StatusUnauthorized || invalidAPIResp.Error.Code != "invalid_api_key" {
		t.Fatalf("expected 401 invalid_api_key, got %d %#v", invalidAPI.Code, invalidAPIResp)
	}

	invalidApp := harness.postChat(t, harness.invalidAppRouter, readinessInvalidAppRequestID, "<safe_prompt_not_logged>")
	invalidAppResp := readinessDecodeError(t, invalidApp)
	if invalidApp.Code != http.StatusForbidden || invalidAppResp.Error.Code != "invalid_app_token" {
		t.Fatalf("expected 403 invalid_app_token, got %d %#v", invalidApp.Code, invalidAppResp)
	}

	safePrompt := "Write a short safe refund response."
	safeMiss := harness.postChat(t, harness.validRouter, readinessSafeMissRequestID, safePrompt)
	safeMissResp := readinessDecodeChatCompletion(t, safeMiss)
	if safeMiss.Code != http.StatusOK || safeMissResp.GateLM == nil ||
		safeMissResp.GateLM.CacheStatus != invocationlog.CacheStatusMiss ||
		safeMissResp.GateLM.SelectedProvider != "mock" ||
		safeMissResp.GateLM.SelectedModel != "mock-fast" ||
		safeMissResp.GateLM.RoutingReason != routing.ReasonSupportRefundLowCost {
		t.Fatalf("unexpected safe miss response: status=%d gate_lm=%#v body=%s", safeMiss.Code, safeMissResp.GateLM, safeMiss.Body.String())
	}
	providerCallsAfterMiss := harness.provider.chatCallCount()
	cacheLookupsAfterMiss := harness.cache.getCallCount()
	cacheWritesAfterMiss := harness.cache.setCallCount()

	cacheHit := harness.postChat(t, harness.validRouter, readinessCacheHitRequestID, safePrompt)
	cacheHitResp := readinessDecodeChatCompletion(t, cacheHit)
	if cacheHit.Code != http.StatusOK || cacheHitResp.GateLM == nil || cacheHitResp.GateLM.CacheStatus != invocationlog.CacheStatusHit {
		t.Fatalf("expected cache hit response, got status=%d gate_lm=%#v body=%s", cacheHit.Code, cacheHitResp.GateLM, cacheHit.Body.String())
	}
	if harness.provider.chatCallCount() != providerCallsAfterMiss {
		t.Fatalf("cache hit must not call provider again, before=%d after=%d", providerCallsAfterMiss, harness.provider.chatCallCount())
	}

	rawEmail := "demo.user@example.invalid"
	rawPhone := "010-1234-5678"
	redactedPrompt := "Write a safe reply to " + rawEmail + " and ask them to call " + rawPhone + "."
	redacted := harness.postChat(t, harness.validRouter, readinessRedactedRequestID, redactedPrompt)
	redactedResp := readinessDecodeChatCompletion(t, redacted)
	if redacted.Code != http.StatusOK || redactedResp.GateLM == nil || redactedResp.GateLM.MaskingAction != "redacted" {
		t.Fatalf("expected redacted success response, got status=%d gate_lm=%#v body=%s", redacted.Code, redactedResp.GateLM, redacted.Body.String())
	}
	redactedProviderPrompt := readinessProviderPromptAt(t, harness.provider.chatRequestSnapshot(), 1)
	if !strings.Contains(redactedProviderPrompt, "[EMAIL_1]") ||
		!strings.Contains(redactedProviderPrompt, "[PHONE_NUMBER_1]") ||
		strings.Contains(redactedProviderPrompt, rawEmail) ||
		strings.Contains(redactedProviderPrompt, rawPhone) {
		t.Fatalf("provider prompt must use placeholders only, got %q", redactedProviderPrompt)
	}

	providerCallsBeforeBlocked := harness.provider.chatCallCount()
	cacheLookupsBeforeBlocked := harness.cache.getCallCount()
	cacheWritesBeforeBlocked := harness.cache.setCallCount()
	rawCredentialLikeValue := "test_secret_token_redacted_for_demo_only_1234567890"
	blocked := harness.postChat(t, harness.validRouter, readinessBlockedRequestID, "Summarize api_key="+rawCredentialLikeValue)
	blockedResp := readinessDecodeError(t, blocked)
	if blocked.Code != http.StatusForbidden || blockedResp.Error.Code != "sensitive_data_blocked" {
		t.Fatalf("expected 403 sensitive_data_blocked, got %d %#v", blocked.Code, blockedResp)
	}
	if harness.provider.chatCallCount() != providerCallsBeforeBlocked ||
		harness.cache.getCallCount() != cacheLookupsBeforeBlocked ||
		harness.cache.setCallCount() != cacheWritesBeforeBlocked {
		t.Fatalf("blocked request must stop before cache/provider, provider=%d cache_get=%d cache_set=%d",
			harness.provider.chatCallCount(),
			harness.cache.getCallCount(),
			harness.cache.setCallCount(),
		)
	}

	providerCallsBeforeRateLimit := harness.provider.chatCallCount()
	rateLimited := harness.postChat(t, harness.validRouter, readinessRateLimitedRequestID, "<safe_prompt_after_quota_exhausted>")
	rateLimitedResp := readinessDecodeError(t, rateLimited)
	if rateLimited.Code != http.StatusTooManyRequests || rateLimitedResp.Error.Code != "rate_limited" {
		t.Fatalf("expected 429 rate_limited, got %d %#v", rateLimited.Code, rateLimitedResp)
	}
	if harness.provider.chatCallCount() != providerCallsBeforeRateLimit {
		t.Fatalf("rate limited request must stop before provider, before=%d after=%d", providerCallsBeforeRateLimit, harness.provider.chatCallCount())
	}

	if harness.provider.modelCallCount() != 1 {
		t.Fatalf("expected one provider model catalog call, got %d", harness.provider.modelCallCount())
	}
	if harness.provider.chatCallCount() != 2 {
		t.Fatalf("expected exactly two provider chat calls, got %d", harness.provider.chatCallCount())
	}
	if harness.limiter.callCount() != 5 {
		t.Fatalf("expected five rate limit decisions for authenticated chat requests, got %d", harness.limiter.callCount())
	}
	if len(harness.observability.terminalLogs()) != 5 {
		t.Fatalf("expected five terminal logs, got %d", len(harness.observability.terminalLogs()))
	}
	if len(harness.observability.authFailureLogs()) != 2 {
		t.Fatalf("expected two auth failure logs, got %d", len(harness.observability.authFailureLogs()))
	}

	logListRR := harness.get(t, harness.validRouter, "/api/projects/project_demo/logs?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&limit=20", "request_v1_readiness_log_list_009")
	cacheHitDetailRR := harness.get(t, harness.validRouter, "/api/llm-requests/"+readinessCacheHitRequestID, "request_v1_readiness_detail_010")
	dashboardRR := harness.get(t, harness.validRouter, "/api/dashboard/overview?projectId=project_demo&from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z", "request_v1_readiness_dashboard_011")
	metricsRR := harness.get(t, harness.validRouter, "/metrics", "request_v1_readiness_metrics_012")
	if logListRR.Code != http.StatusOK || cacheHitDetailRR.Code != http.StatusOK || dashboardRR.Code != http.StatusOK || metricsRR.Code != http.StatusOK {
		t.Fatalf("expected log/detail/dashboard/metrics endpoints to return 200, got logs=%d detail=%d dashboard=%d metrics=%d",
			logListRR.Code,
			cacheHitDetailRR.Code,
			dashboardRR.Code,
			metricsRR.Code,
		)
	}

	detailsByID := harness.observability.detailsByRequestID()
	cacheHitDetail := detailsByID[readinessCacheHitRequestID]
	if cacheHitDetail.Cache.CacheStatus != invocationlog.CacheStatusHit ||
		cacheHitDetail.Cache.CacheHitRequestID != readinessSafeMissRequestID ||
		cacheHitDetail.Latency.ProviderLatencyMs != nil {
		t.Fatalf("unexpected cache hit request detail: %#v", cacheHitDetail)
	}
	overview := invocationlog.BuildDashboardOverview(harness.observability.invocationLogs())
	if overview.TotalRequests != 5 ||
		overview.SuccessfulRequests != 3 ||
		overview.BlockedRequests != 1 ||
		overview.RateLimitedRequests != 1 ||
		overview.CacheHitRequests != 1 ||
		overview.FailedRequests != 0 {
		t.Fatalf("unexpected dashboard overview: %#v", overview)
	}

	metricsOutput := metricsRR.Body.String()
	for _, sample := range readinessExpectedMetricSamples() {
		readinessAssertContains(t, metricsOutput, sample)
	}
	readinessAssertNoForbiddenMetricLabels(t, metricsOutput)
	readinessAssertNoForbiddenFragments(t, safePrompt, rawEmail, rawPhone, rawCredentialLikeValue, logListRR.Body.String(), cacheHitDetailRR.Body.String(), dashboardRR.Body.String(), metricsOutput)

	t.Logf("\n[Given]\n%s", "Gateway router가 v1 main path를 한 표면으로 노출하고, Mock Provider, exact cache, rate limit, terminal log, metrics가 주입되어 있다.")
	t.Logf("\n[When - 입력]\n%s", readinessInputOutput(t))
	t.Logf("\n[Then - Gateway 출력]\n%s", readinessGatewayOutput(t, modelsRR, modelsResp, invalidAPI, invalidAPIResp, invalidApp, invalidAppResp, safeMiss, safeMissResp, cacheHit, cacheHitResp, redacted, redactedResp, blocked, blockedResp, rateLimited, rateLimitedResp, providerCallsAfterMiss, harness.provider.chatCallCount(), cacheLookupsAfterMiss, cacheWritesAfterMiss))
	t.Logf("\n[Then - Log/Detail/Dashboard/Metrics 출력]\n%s", readinessObservabilityOutput(t, harness, logListRR, cacheHitDetailRR, dashboardRR, metricsOutput))
	t.Logf("\n[의미]\n%s", "Gateway owner 관점에서 v1 demo freeze 전에 필요한 핵심 surface가 연결되어 있음을 보여준다. 외부 Docker 의존 없이 router-level smoke로 확인하고, 실제 PostgreSQL/Redis/k6 검증은 팀 demo freeze와 Observability 단계에서 이어간다.")
}

type gatewayReadinessHarness struct {
	validRouter       http.Handler
	invalidAPIRouter  http.Handler
	invalidAppRouter  http.Handler
	provider          *readinessProviderAdapter
	cache             *readinessExactCacheStore
	limiter           *readinessSequenceLimiter
	observability     *readinessObservabilityStore
	metricsRegistry   *metrics.Registry
	rateLimitPipeline pipeline.Pipeline
	cfg               config.Config
}

func newGatewayReadinessHarness(t *testing.T) gatewayReadinessHarness {
	t.Helper()

	cfg := config.Config{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		HighQualityModel:    "mock-quality",
		RoutingPolicyHash:   "hash_routing_policy_v1_readiness",
		SecurityPolicyHash:  "hash_security_policy_v1_readiness",
		RuntimeConfigHash:   "hash_runtime_config_v1_readiness",
		CachePolicyHash:     "hash_cache_policy_v1_readiness",
		ShortPromptMaxChars: 300,
		ExactCacheTTL:       10 * time.Minute,
		ExactCacheKeySecret: "cache_key_secret_for_v1_readiness_smoke_only",
		DemoTenantID:        "tenant_demo",
		DemoProjectID:       "project_demo",
		DemoApplicationID:   "app_demo",
		DemoAPIKeyID:        "api_key_demo",
		DemoAppTokenID:      "app_token_demo",
	}
	providerAdapter := &readinessProviderAdapter{}
	cacheStore := newReadinessExactCacheStore()
	limiter := &readinessSequenceLimiter{
		decisions: []ratelimit.Decision{
			readinessAllowedDecision(1),
			readinessAllowedDecision(0),
			readinessAllowedDecision(0),
			readinessAllowedDecision(0),
			readinessBlockedDecision(),
		},
	}
	observability := &readinessObservabilityStore{}
	registry := metrics.NewRegistry()
	runtimeConfigProvider := staticruntimeconfig.NewProvider(runtimeconfig.ActiveConfig{
		ConfigVersion:     "runtime_config_v1_readiness",
		ConfigHash:        cfg.RuntimeConfigHash,
		PublishState:      runtimeconfig.PublishStateActive,
		TenantID:          cfg.DemoTenantID,
		TenantStatus:      runtimeconfig.StatusActive,
		ProjectID:         cfg.DemoProjectID,
		ProjectStatus:     runtimeconfig.StatusActive,
		ApplicationID:     cfg.DemoApplicationID,
		ApplicationStatus: runtimeconfig.StatusActive,
		APIKeyID:          cfg.DemoAPIKeyID,
		APIKeyStatus:      runtimeconfig.StatusActive,
		AppTokenID:        cfg.DemoAppTokenID,
		AppTokenStatus:    runtimeconfig.StatusActive,
		RateLimit: ratelimit.Config{
			Enabled:       true,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: 60,
			Limit:         4,
		},
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: cfg.SecurityPolicyHash,
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			DefaultProvider:     "mock",
			DefaultModel:        "mock-balanced",
			LowCostProvider:     "mock",
			LowCostModel:        "mock-fast",
			FallbackProvider:    "mock",
			FallbackModel:       "mock-balanced",
			ShortPromptMaxChars: 300,
			RoutingPolicyHash:   cfg.RoutingPolicyHash,
		},
		CachePolicy: runtimeconfig.CachePolicy{
			Enabled:    true,
			Type:       runtimeconfig.CacheTypeExact,
			TTLSeconds: 600,
		},
	})
	rateLimitPipeline := pipeline.New(
		runtimeconfigstage.NewStage(runtimeConfigProvider),
		ratelimitstage.NewStage(limiter, ratelimit.Config{
			Enabled:       true,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: 60,
			Limit:         4,
		}),
	)
	harness := gatewayReadinessHarness{
		provider:          providerAdapter,
		cache:             cacheStore,
		limiter:           limiter,
		observability:     observability,
		metricsRegistry:   registry,
		rateLimitPipeline: rateLimitPipeline,
		cfg:               cfg,
	}
	harness.validRouter = harness.newRouter(
		&routerTestAPIKeyAuthenticator{identity: routerTestValidAPIKeyIdentity()},
		&routerTestAppTokenValidator{identity: routerTestValidAppTokenIdentity()},
	)
	harness.invalidAPIRouter = harness.newRouter(
		&routerTestAPIKeyAuthenticator{err: gatewayerrors.InvalidAPIKey("authenticate_api_key")},
		&routerTestAppTokenValidator{identity: routerTestValidAppTokenIdentity()},
	)
	harness.invalidAppRouter = harness.newRouter(
		&routerTestAPIKeyAuthenticator{identity: routerTestValidAPIKeyIdentity()},
		&routerTestAppTokenValidator{err: gatewayerrors.InvalidAppToken("validate_app_token")},
	)
	return harness
}

func (h gatewayReadinessHarness) newRouter(apiKeyAuthenticator *routerTestAPIKeyAuthenticator, appTokenValidator *routerTestAppTokenValidator) http.Handler {
	return NewRouter(
		h.cfg,
		provider.NewRegistry("mock", h.provider),
		nil,
		WithGatewayAuth(apiKeyAuthenticator, appTokenValidator),
		WithAuthFailureLogWriter(h.observability),
		WithTerminalLogWriter(h.observability),
		WithInvocationLogReader(h.observability),
		WithExactCache(h.cache, cachekey.NewExactKeyBuilder([]byte(h.cfg.ExactCacheKeySecret))),
		WithMetrics(h.metricsRegistry),
		WithRateLimitPipeline(h.rateLimitPipeline),
	)
}

func (h gatewayReadinessHarness) get(t *testing.T, router http.Handler, path string, requestID string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set(middleware.RequestIDHeader, requestID)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	return rr
}

func (h gatewayReadinessHarness) postChat(t *testing.T, router http.Handler, requestID string, prompt string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(readinessChatBody(t, "auto", prompt)))
	req.Header.Set(middleware.RequestIDHeader, requestID)
	req.Header.Set("Authorization", "Bearer <redacted>")
	req.Header.Set("X-GateLM-App-Token", "<redacted>")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	return rr
}

type readinessProviderAdapter struct {
	mu           sync.Mutex
	modelCalls   int
	chatRequests []provider.ChatCompletionRequest
}

func (a *readinessProviderAdapter) AdapterType() string {
	return "mock"
}

func (a *readinessProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.modelCalls++

	return &provider.ModelListResponse{
		Object: "list",
		Data: []provider.ModelInfo{
			{ID: "mock-fast", Object: "model", Created: 1782108000, OwnedBy: "mock"},
			{ID: "mock-balanced", Object: "model", Created: 1782108000, OwnedBy: "mock"},
		},
	}, nil
}

func (a *readinessProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	a.mu.Lock()
	a.chatRequests = append(a.chatRequests, req)
	a.mu.Unlock()

	return &provider.ChatCompletionResponse{
		ID:      "mock_chatcmpl_" + req.RequestID,
		Object:  "chat.completion",
		Created: 1782108000,
		Model:   req.Model,
		Choices: []provider.ChatChoice{{
			Index: 0,
			Message: provider.ChatMessage{
				Role:    "assistant",
				Content: readinessJSONString("Readiness mock response."),
			},
			FinishReason: "stop",
		}},
		Usage: &provider.Usage{
			PromptTokens:     12,
			CompletionTokens: 8,
			TotalTokens:      20,
		},
	}, nil
}

func (a *readinessProviderAdapter) modelCallCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.modelCalls
}

func (a *readinessProviderAdapter) chatCallCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.chatRequests)
}

func (a *readinessProviderAdapter) chatRequestSnapshot() []provider.ChatCompletionRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]provider.ChatCompletionRequest(nil), a.chatRequests...)
}

type readinessExactCacheStore struct {
	mu       sync.Mutex
	getCalls int
	setCalls int
	entries  map[string]ports.CacheEntry
}

func newReadinessExactCacheStore() *readinessExactCacheStore {
	return &readinessExactCacheStore{entries: map[string]ports.CacheEntry{}}
}

func (s *readinessExactCacheStore) GetExact(ctx context.Context, keyHash string) (ports.CacheLookupResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

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

func (s *readinessExactCacheStore) SetExact(ctx context.Context, entry ports.CacheEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.setCalls++
	copied := entry
	copied.Payload = append([]byte(nil), entry.Payload...)
	s.entries[entry.KeyHash] = copied
	return nil
}

func (s *readinessExactCacheStore) getCallCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getCalls
}

func (s *readinessExactCacheStore) setCallCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.setCalls
}

type readinessSequenceLimiter struct {
	mu        sync.Mutex
	decisions []ratelimit.Decision
	calls     int
}

func (l *readinessSequenceLimiter) Check(ctx context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.calls++
	index := l.calls - 1
	if index >= len(l.decisions) {
		return readinessAllowedDecision(0), nil
	}
	decision := l.decisions[index]
	if decision.WindowStart.IsZero() {
		decision.WindowStart = req.Now.Truncate(time.Duration(ratelimit.NormalizeConfig(req.Config).WindowSeconds) * time.Second)
	}
	if decision.ResetAt.IsZero() {
		decision.ResetAt = decision.WindowStart.Add(time.Duration(ratelimit.NormalizeConfig(req.Config).WindowSeconds) * time.Second)
	}
	return decision, nil
}

func (l *readinessSequenceLimiter) callCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.calls
}

func readinessAllowedDecision(remaining int) ratelimit.Decision {
	return ratelimit.Decision{
		Allowed:           true,
		Limit:             4,
		Remaining:         remaining,
		WindowSeconds:     60,
		RetryAfterSeconds: 0,
		Reason:            ratelimit.ReasonWithinLimit,
	}
}

func readinessBlockedDecision() ratelimit.Decision {
	return ratelimit.Decision{
		Allowed:           false,
		Limit:             4,
		Remaining:         0,
		WindowSeconds:     60,
		RetryAfterSeconds: 60,
		Reason:            ratelimit.ReasonLimitExceeded,
	}
}

type readinessObservabilityStore struct {
	mu          sync.Mutex
	terminal    []invocationlog.TerminalLog
	authFailure []invocationlog.AuthFailureLog
}

func (s *readinessObservabilityStore) WriteTerminalLog(ctx context.Context, log invocationlog.TerminalLog) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.terminal = append(s.terminal, log)
	return nil
}

func (s *readinessObservabilityStore) WriteAuthFailureLog(ctx context.Context, log invocationlog.AuthFailureLog) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authFailure = append(s.authFailure, log)
	return nil
}

func (s *readinessObservabilityStore) ListProjectLogs(ctx context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	logs := s.invocationLogs()
	items := make([]invocationlog.RequestLogListItem, 0, len(logs))
	for _, log := range logs {
		if filter.ProjectID != "" && log.ProjectID != filter.ProjectID {
			continue
		}
		items = append(items, invocationlog.ToRequestLogListItem(log))
	}
	return items, nil
}

func (s *readinessObservabilityStore) GetRequestDetail(ctx context.Context, filter invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error) {
	for _, log := range s.invocationLogs() {
		if log.RequestID == filter.RequestID {
			return invocationlog.ToRequestDetail(log), nil
		}
	}
	return invocationlog.RequestDetail{}, invocationlog.ErrLogNotFound
}

func (s *readinessObservabilityStore) GetDashboardOverview(ctx context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error) {
	return invocationlog.BuildDashboardOverview(s.invocationLogs()), nil
}

func (s *readinessObservabilityStore) terminalLogs() []invocationlog.TerminalLog {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]invocationlog.TerminalLog(nil), s.terminal...)
}

func (s *readinessObservabilityStore) authFailureLogs() []invocationlog.AuthFailureLog {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]invocationlog.AuthFailureLog(nil), s.authFailure...)
}

func (s *readinessObservabilityStore) detailsByRequestID() map[string]invocationlog.RequestDetail {
	details := map[string]invocationlog.RequestDetail{}
	for _, log := range s.invocationLogs() {
		details[log.RequestID] = invocationlog.ToRequestDetail(log)
	}
	return details
}

func (s *readinessObservabilityStore) invocationLogs() []invocationlog.LlmInvocationLog {
	terminal := s.terminalLogs()
	logs := make([]invocationlog.LlmInvocationLog, 0, len(terminal))
	for _, log := range terminal {
		completedAt := log.CompletedAt
		logs = append(logs, invocationlog.LlmInvocationLog{
			RequestID:             log.RequestID,
			TraceID:               log.TraceID,
			TenantID:              log.TenantID,
			ProjectID:             log.ProjectID,
			ApplicationID:         log.ApplicationID,
			APIKeyID:              log.APIKeyID,
			AppTokenID:            log.AppTokenID,
			EndUserID:             log.EndUserID,
			FeatureID:             log.FeatureID,
			Endpoint:              log.Endpoint,
			Method:                log.Method,
			Source:                log.Source,
			Stream:                log.Stream,
			RequestedProvider:     log.RequestedProvider,
			RequestedModel:        log.RequestedModel,
			Provider:              log.Provider,
			Model:                 log.Model,
			SelectedProvider:      log.SelectedProvider,
			SelectedModel:         log.SelectedModel,
			RoutingReason:         log.RoutingReason,
			PromptTokens:          int64(log.PromptTokens),
			CompletionTokens:      int64(log.CompletionTokens),
			TotalTokens:           int64(log.TotalTokens),
			CostMicroUSD:          log.CostMicroUSD,
			SavedCostMicroUSD:     log.SavedCostMicroUSD,
			LatencyMs:             log.LatencyMs,
			ProviderLatencyMs:     log.ProviderLatencyMs,
			Status:                log.Status,
			HTTPStatus:            log.HTTPStatus,
			ErrorCode:             log.ErrorCode,
			ErrorMessage:          log.ErrorMessage,
			ErrorStage:            log.ErrorStage,
			CacheStatus:           log.CacheStatus,
			CacheType:             log.CacheType,
			CacheKeyHash:          log.CacheKeyHash,
			CacheHitRequestID:     log.CacheHitRequestID,
			MaskingAction:         log.MaskingAction,
			MaskingDetectedTypes:  append([]string(nil), log.MaskingDetectedTypes...),
			MaskingDetectedCount:  log.MaskingDetectedCount,
			RedactedPromptPreview: log.RedactedPromptPreview,
			CreatedAt:             log.CreatedAt,
			CompletedAt:           &completedAt,
		})
	}
	return logs
}

type readinessGatewayErrorResponse struct {
	Error struct {
		Message   string  `json:"message"`
		Type      string  `json:"type"`
		Param     *string `json:"param"`
		Code      string  `json:"code"`
		RequestID string  `json:"request_id"`
	} `json:"error"`
}

func readinessDecodeChatCompletion(t *testing.T, rr *httptest.ResponseRecorder) provider.ChatCompletionResponse {
	t.Helper()

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode chat completion response: %v", err)
	}
	return resp
}

func readinessDecodeError(t *testing.T, rr *httptest.ResponseRecorder) readinessGatewayErrorResponse {
	t.Helper()

	var resp readinessGatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode gateway error response: %v", err)
	}
	return resp
}

func readinessDecodeModels(t *testing.T, rr *httptest.ResponseRecorder) provider.ModelListResponse {
	t.Helper()

	var resp provider.ModelListResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode models response: %v", err)
	}
	return resp
}

func readinessChatBody(t *testing.T, model string, prompt string) string {
	t.Helper()

	body, err := json.Marshal(provider.ChatCompletionRequest{
		Model: model,
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: readinessJSONString(prompt),
		}},
	})
	if err != nil {
		t.Fatalf("marshal chat completion request: %v", err)
	}
	return string(body)
}

func readinessJSONString(value string) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return encoded
}

func readinessProviderPromptAt(t *testing.T, requests []provider.ChatCompletionRequest, index int) string {
	t.Helper()
	if index < 0 || index >= len(requests) {
		t.Fatalf("provider request index out of range: index=%d len=%d", index, len(requests))
	}
	if len(requests[index].Messages) == 0 {
		t.Fatal("provider request has no messages")
	}
	var prompt string
	if err := json.Unmarshal(requests[index].Messages[0].Content, &prompt); err != nil {
		t.Fatalf("decode provider prompt: %v", err)
	}
	return prompt
}

func readinessExpectedMetricSamples() []string {
	return []string{
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="invalid_api_key",http_status="401",method="POST",status="blocked"} 1`,
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="invalid_app_token",http_status="403",method="POST",status="blocked"} 1`,
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 3`,
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="sensitive_data_blocked",http_status="403",method="POST",status="blocked"} 1`,
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="rate_limited",http_status="429",method="POST",status="rate_limited"} 1`,
		`gatelm_gateway_inflight_requests{endpoint="/v1/chat/completions",method="POST"} 0`,
		`gatelm_provider_requests_total{error_code="none",http_status="200",selected_model="mock-fast",selected_provider="mock",status="success"} 2`,
		`gatelm_cache_operations_total{cache_status="miss",cache_type="exact",operation="lookup",status="success"} 2`,
		`gatelm_cache_operations_total{cache_status="hit",cache_type="exact",operation="lookup",status="success"} 1`,
		`gatelm_cache_operations_total{cache_status="miss",cache_type="exact",operation="write",status="success"} 2`,
		`gatelm_rate_limit_decisions_total{rate_limit_allowed="true",status="within_limit"} 4`,
		`gatelm_rate_limit_decisions_total{rate_limit_allowed="false",status="limit_exceeded"} 1`,
		`gatelm_masking_actions_total{masking_action="none"} 5`,
		`gatelm_masking_actions_total{masking_action="redacted"} 1`,
		`gatelm_masking_actions_total{masking_action="blocked"} 1`,
		`gatelm_log_writes_total{operation="terminal",status="success"} 5`,
		`gatelm_log_writes_total{operation="auth_failure",status="success"} 2`,
	}
}

func readinessInputOutput(t *testing.T) string {
	t.Helper()
	return readinessJSON(t, map[string]any{
		"requests": []map[string]any{
			{"name": "model catalog", "http": "GET /v1/models"},
			{"name": "invalid api key", "http": "POST /v1/chat/completions", "headers": map[string]string{"Authorization": "Bearer <redacted>", "X-GateLM-App-Token": "<redacted>"}, "body": map[string]string{"model": "auto", "message": "<safe_prompt_not_logged>"}},
			{"name": "invalid app token", "http": "POST /v1/chat/completions", "headers": map[string]string{"Authorization": "Bearer <redacted>", "X-GateLM-App-Token": "<redacted>"}, "body": map[string]string{"model": "auto", "message": "<safe_prompt_not_logged>"}},
			{"name": "safe miss", "http": "POST /v1/chat/completions", "body": map[string]string{"model": "auto", "message": "<safe_prompt_short>"}},
			{"name": "cache hit", "http": "POST /v1/chat/completions", "body": map[string]string{"model": "auto", "message": "<same_safe_prompt_short>"}},
			{"name": "redacted success", "http": "POST /v1/chat/completions", "body": map[string]string{"model": "auto", "message": "Write a safe reply to <email> and ask them to call <phone_number>."}},
			{"name": "blocked", "http": "POST /v1/chat/completions", "body": map[string]string{"model": "auto", "message": "Summarize api_key=<credential_like_secret>"}},
			{"name": "rate limited", "http": "POST /v1/chat/completions", "body": map[string]string{"model": "auto", "message": "<safe_prompt_after_quota_exhausted>"}},
			{"name": "observability", "http": "GET /api/projects/{projectId}/logs, GET /api/llm-requests/{requestId}, GET /api/dashboard/overview, GET /metrics"},
		},
	})
}

func readinessGatewayOutput(
	t *testing.T,
	modelsRR *httptest.ResponseRecorder,
	models provider.ModelListResponse,
	invalidAPI *httptest.ResponseRecorder,
	invalidAPIResp readinessGatewayErrorResponse,
	invalidApp *httptest.ResponseRecorder,
	invalidAppResp readinessGatewayErrorResponse,
	safeMiss *httptest.ResponseRecorder,
	safeMissResp provider.ChatCompletionResponse,
	cacheHit *httptest.ResponseRecorder,
	cacheHitResp provider.ChatCompletionResponse,
	redacted *httptest.ResponseRecorder,
	redactedResp provider.ChatCompletionResponse,
	blocked *httptest.ResponseRecorder,
	blockedResp readinessGatewayErrorResponse,
	rateLimited *httptest.ResponseRecorder,
	rateLimitedResp readinessGatewayErrorResponse,
	providerCallsAfterMiss int,
	providerCallsAfterAll int,
	cacheLookupsAfterMiss int,
	cacheWritesAfterMiss int,
) string {
	t.Helper()
	return readinessJSON(t, map[string]any{
		"modelCatalog": map[string]any{
			"httpStatus":    modelsRR.Code,
			"catalogStatus": modelsStatus(models),
			"modelIds":      readinessModelIDs(models),
		},
		"invalidApiKey":   readinessErrorSummary(invalidAPI, invalidAPIResp),
		"invalidAppToken": readinessErrorSummary(invalidApp, invalidAppResp),
		"safeMiss": readinessSuccessSummary(safeMiss, safeMissResp, map[string]any{
			"providerCalls": providerCallsAfterMiss,
			"cacheLookups":  cacheLookupsAfterMiss,
			"cacheWrites":   cacheWritesAfterMiss,
		}),
		"cacheHit": readinessSuccessSummary(cacheHit, cacheHitResp, map[string]any{
			"providerCallsAfterAll": providerCallsAfterAll,
			"providerBypassed":      providerCallsAfterAll == providerCallsAfterMiss+1,
		}),
		"redactedSuccess": readinessSuccessSummary(redacted, redactedResp, map[string]any{
			"providerPromptContainsPlaceholders": true,
			"rawSensitiveValueExposed":           false,
		}),
		"blocked":     readinessErrorSummary(blocked, blockedResp),
		"rateLimited": readinessErrorSummary(rateLimited, rateLimitedResp),
	})
}

func readinessObservabilityOutput(t *testing.T, harness gatewayReadinessHarness, logListRR *httptest.ResponseRecorder, detailRR *httptest.ResponseRecorder, dashboardRR *httptest.ResponseRecorder, metricsOutput string) string {
	t.Helper()
	overview := invocationlog.BuildDashboardOverview(harness.observability.invocationLogs())
	return readinessJSON(t, map[string]any{
		"requestLogEndpoint": map[string]any{
			"httpStatus":  logListRR.Code,
			"recordCount": len(harness.observability.terminalLogs()),
		},
		"requestDetailEndpoint": map[string]any{
			"httpStatus": detailRR.Code,
			"requestId":  readinessCacheHitRequestID,
			"meaning":    "cache hit detail이 원본 miss requestId를 추적한다.",
		},
		"dashboardEndpoint": map[string]any{
			"httpStatus": dashboardRR.Code,
			"totals": map[string]any{
				"totalRequests":       overview.TotalRequests,
				"successfulRequests":  overview.SuccessfulRequests,
				"blockedRequests":     overview.BlockedRequests,
				"rateLimitedRequests": overview.RateLimitedRequests,
				"cacheHitRequests":    overview.CacheHitRequests,
				"failedRequests":      overview.FailedRequests,
			},
		},
		"metricsEndpoint": map[string]any{
			"verifiedSamples":        readinessExpectedMetricSamples(),
			"forbiddenLabelsPresent": readinessHasForbiddenMetricLabels(metricsOutput),
		},
		"authFailureLogs": map[string]any{
			"count":   len(harness.observability.authFailureLogs()),
			"meaning": "invalid_api_key와 invalid_app_token은 terminal log가 아니라 auth failure log로 기록된다.",
		},
	})
}

func readinessSuccessSummary(rr *httptest.ResponseRecorder, resp provider.ChatCompletionResponse, evidence map[string]any) map[string]any {
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
	return map[string]any{
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
	}
}

func readinessErrorSummary(rr *httptest.ResponseRecorder, resp readinessGatewayErrorResponse) map[string]any {
	return map[string]any{
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
	}
}

func readinessModelIDs(models provider.ModelListResponse) []string {
	ids := make([]string, 0, len(models.Data))
	for _, model := range models.Data {
		ids = append(ids, model.ID)
	}
	return ids
}

func modelsStatus(models provider.ModelListResponse) string {
	if len(models.Data) == 0 {
		return "empty"
	}
	return "ok"
}

func readinessJSON(t *testing.T, value any) string {
	t.Helper()
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		t.Fatalf("marshal readiness json: %v", err)
	}
	return strings.TrimSpace(buffer.String())
}

func readinessAssertContains(t *testing.T, output string, expected string) {
	t.Helper()
	if !strings.Contains(output, expected) {
		t.Fatalf("expected output to contain %q\noutput:\n%s", expected, output)
	}
}

func readinessAssertNoForbiddenMetricLabels(t *testing.T, output string) {
	t.Helper()
	if readinessHasForbiddenMetricLabels(output) {
		t.Fatalf("metrics output contains forbidden high-cardinality or sensitive labels:\n%s", output)
	}
}

func readinessHasForbiddenMetricLabels(output string) bool {
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
			return true
		}
	}
	return false
}

func readinessAssertNoForbiddenFragments(t *testing.T, safePrompt string, rawEmail string, rawPhone string, rawCredentialLikeValue string, outputs ...string) {
	t.Helper()
	for _, output := range outputs {
		for _, forbidden := range []string{safePrompt, rawEmail, rawPhone, rawCredentialLikeValue, "Bearer <redacted>", "X-GateLM-App-Token"} {
			if strings.Contains(output, forbidden) {
				t.Fatalf("output must not expose forbidden fragment %q\noutput:\n%s", forbidden, output)
			}
		}
	}
}
