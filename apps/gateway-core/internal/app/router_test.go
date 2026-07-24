package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	postgresinvocationlog "gatelm/apps/gateway-core/internal/adapters/invocationlog/postgres"
	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/routing"

	"github.com/jackc/pgx/v5/pgconn"
)

type routerTestInjectedMaskingEngine struct{}

func (*routerTestInjectedMaskingEngine) Apply(context.Context, maskdomain.ApplyRequest) (maskdomain.Result, error) {
	return maskdomain.Result{}, nil
}

func TestResolveRouterMaskingEnginePreservesConfiguredEngineInPersonNameModelOnlyMode(t *testing.T) {
	configured := &routerTestInjectedMaskingEngine{}

	resolved := resolveRouterMaskingEngine(configured, true)

	if resolved != configured {
		t.Fatal("person-name model-only mode replaced the configured masking engine")
	}
}

func TestResolveRouterFallbackMaskingEngineOnlyEnablesFullRulesForPersonNameModelOnlyMode(t *testing.T) {
	if resolveRouterFallbackMaskingEngine(nil, false) != nil {
		t.Fatal("default mode must not add a duplicate fallback engine")
	}
	configured := &routerTestInjectedMaskingEngine{}
	if resolveRouterFallbackMaskingEngine(configured, true) != nil {
		t.Fatal("configured engine must keep ownership of its fallback behavior")
	}
	fallback := resolveRouterFallbackMaskingEngine(nil, true)
	if fallback == nil {
		t.Fatal("person-name model-only mode must configure a full-rule fallback engine")
	}
	result, err := fallback.Apply(context.Background(), maskdomain.ApplyRequest{
		Prompt: "\uace0\uac1d \ubb38\uc758\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.",
	})
	if err != nil {
		t.Fatalf("apply full-rule fallback: %v", err)
	}
	if result.Action != maskdomain.ActionRedacted ||
		len(result.DetectedTypes) != 1 || result.DetectedTypes[0] != "person_name" {
		t.Fatalf("fallback engine did not restore person-name rules: %+v", result)
	}
}

func TestPublicRouterDoesNotExposePrivateRAGEmbeddings(t *testing.T) {
	router := NewRouter(config.Config{}, provider.NewRegistry("mock"), nil)
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/rag/embeddings", strings.NewReader(`{"purpose":"RAG_QUERY","profileVersion":1,"inputs":["synthetic"]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("private RAG embedding route leaked onto public router: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestNewRouterWiresAuthBeforeProviderCall(t *testing.T) {
	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chatCalls++
		writeRouterTestJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_router_auth_safety",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   "mock-balanced",
		})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	apiAuth := &routerTestAPIKeyAuthenticator{
		err: gatewayerrors.InvalidAPIKey("authenticate_api_key"),
	}
	appValidator := &routerTestAppTokenValidator{
		identity: routerTestValidAppTokenIdentity(),
	}
	authFailureWriter := &routerTestAuthFailureLogWriter{}
	router := NewRouter(config.Config{}, registry, nil, WithGatewayAuth(apiAuth, appValidator), WithAuthFailureLogWriter(authFailureWriter))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if chatCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", chatCalls)
	}
	if len(authFailureWriter.logs) != 1 {
		t.Fatalf("expected one auth failure log, got %d", len(authFailureWriter.logs))
	}
	authFailureLog := authFailureWriter.logs[0]
	if authFailureLog.RequestID == "" || authFailureLog.Status != invocationlog.StatusBlocked || authFailureLog.HTTPStatus != http.StatusUnauthorized {
		t.Fatalf("unexpected auth failure log: %+v", authFailureLog)
	}
	if authFailureLog.ErrorCode != invocationlog.ErrorCodeInvalidAPIKey || authFailureLog.ErrorStage != invocationlog.StageAuthenticateAPIKey {
		t.Fatalf("unexpected auth failure error fields: %+v", authFailureLog)
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" {
		t.Fatalf("expected cache bypass header, got %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
}

func TestNewRouterWiresSimpleRoutingBeforeProviderCall(t *testing.T) {
	var providerRequest provider.ChatCompletionRequest
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&providerRequest); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		writeRouterTestJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_router_routing",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   providerRequest.Model,
		})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	apiAuth := &routerTestAPIKeyAuthenticator{
		identity: routerTestValidAPIKeyIdentity(),
	}
	appValidator := &routerTestAppTokenValidator{
		identity: routerTestValidAppTokenIdentity(),
	}
	router := NewRouter(config.Config{
		RoutingPolicyHash:   "route_p0_v1",
		ShortPromptMaxChars: 300,
		DemoTenantID:        "tenant_demo",
		DemoProjectID:       "project_demo",
		DemoApplicationID:   "app_demo",
	}, registry, nil, WithGatewayAuth(apiAuth, appValidator))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if providerRequest.Model != "mock-balanced" {
		t.Fatalf("expected provider request to use mock-balanced, got %s", providerRequest.Model)
	}
	if rr.Header().Get("X-GateLM-Routed-Provider") != "" || rr.Header().Get("X-GateLM-Routed-Model") != "" {
		t.Fatalf("resolved target must not be exposed in response headers: %#v", rr.Header())
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil {
		t.Fatal("expected gate_lm metadata")
	}
	if resp.GateLM.RequestedModel != "auto" {
		t.Fatalf("expected requestedModel auto, got %s", resp.GateLM.RequestedModel)
	}
	if resp.GateLM.ExecutionMode != "mock" {
		t.Fatalf("unexpected execution mode: %#v", resp.GateLM)
	}
	if resp.GateLM.RoutingReason != routing.ReasonMatrixRoute {
		t.Fatalf("expected %s, got %s", routing.ReasonMatrixRoute, resp.GateLM.RoutingReason)
	}
}

func TestNewRouterDoesNotWaitForDifficultyShadowBeforeProviderCall(t *testing.T) {
	providerCalled := make(chan struct{}, 1)
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled <- struct{}{}
		var providerRequest provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&providerRequest); err != nil {
			t.Errorf("decode provider request: %v", err)
		}
		writeRouterTestJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_shadow_non_blocking",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   providerRequest.Model,
		})
	}))
	defer mockServer.Close()

	shadowEntered := make(chan struct{})
	shadowRelease := make(chan struct{})
	shadow := &blockingRouterDifficultyShadowEvaluation{
		entered: shadowEntered,
		release: shadowRelease,
	}
	shadowRunner := routing.NewDifficultySemanticShadowRunner(shadow, time.Second, nil)

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	router := NewRouter(config.Config{
		RoutingPolicyHash:   "route_p0_v1",
		ShortPromptMaxChars: 300,
		DemoTenantID:        "tenant_demo",
		DemoProjectID:       "project_demo",
		DemoApplicationID:   "app_demo",
		DifficultyE5Shadow: config.DifficultyE5ShadowConfig{
			Enabled: true,
			AllowedScopes: []config.DifficultyE5ShadowScope{{
				TenantID: "tenant_demo", ApplicationID: "app_demo",
			}},
		},
	}, registry, nil,
		WithGatewayAuth(
			&routerTestAPIKeyAuthenticator{identity: routerTestValidAPIKeyIdentity()},
			&routerTestAppTokenValidator{identity: routerTestValidAppTokenIdentity()},
		),
		WithDifficultySemanticShadow(shadowRunner),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "Explain OAuth briefly."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()
	requestDone := make(chan struct{})
	go func() {
		router.ServeHTTP(rr, req)
		close(requestDone)
	}()

	select {
	case <-shadowEntered:
	case <-time.After(time.Second):
		t.Fatal("difficulty shadow did not start")
	}
	select {
	case <-providerCalled:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("provider call waited for difficulty shadow")
	}
	select {
	case <-requestDone:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("request completion waited for difficulty shadow")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 while shadow is blocked, got %d: %s", rr.Code, rr.Body.String())
	}

	close(shadowRelease)
	closeCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := shadowRunner.Close(closeCtx); err != nil {
		t.Fatalf("shadow runner Close() error = %v", err)
	}
}

func TestNewRouterIgnoresLegacyAppTokenValidator(t *testing.T) {
	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chatCalls++
		writeRouterTestJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_router_auth_safety",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   "mock-balanced",
		})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	apiAuth := &routerTestAPIKeyAuthenticator{
		identity: routerTestValidAPIKeyIdentity(),
	}
	appValidator := &routerTestAppTokenValidator{
		err: gatewayerrors.InvalidAppToken("validate_app_token"),
	}
	authFailureWriter := &routerTestAuthFailureLogWriter{}
	router := NewRouter(config.Config{}, registry, nil, WithGatewayAuth(apiAuth, appValidator), WithAuthFailureLogWriter(authFailureWriter))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if chatCalls != 1 {
		t.Fatalf("expected one mock provider call, got %d", chatCalls)
	}
	if len(authFailureWriter.logs) != 0 {
		t.Fatalf("expected no auth failure logs, got %d", len(authFailureWriter.logs))
	}
}

func TestNewRouterPersistsInvalidAuthThroughPostgresWriter(t *testing.T) {
	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chatCalls++
		writeRouterTestJSON(w, http.StatusOK, provider.ChatCompletionResponse{})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	logDB := &routerTestInvocationLogDB{}
	authFailureWriter := postgresinvocationlog.NewAuthFailureWriter(logDB, postgresinvocationlog.AuthFailureDefaults{
		TenantID:      "00000000-0000-4000-8000-000000000100",
		ProjectID:     "00000000-0000-4000-8000-000000000200",
		ApplicationID: "00000000-0000-4000-8000-000000000300",
	})
	router := NewRouter(config.Config{}, registry, nil,
		WithGatewayAuth(
			&routerTestAPIKeyAuthenticator{err: gatewayerrors.InvalidAPIKey("authenticate_api_key")},
			&routerTestAppTokenValidator{identity: routerTestValidAppTokenIdentity()},
		),
		WithAuthFailureLogWriter(authFailureWriter),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", chatCalls)
	}
	if logDB.calls != 1 {
		t.Fatalf("expected one auth failure insert, got %d", logDB.calls)
	}
	if !strings.Contains(logDB.query, "insert into p0_llm_invocation_logs") {
		t.Fatalf("expected p0 log insert, got %s", logDB.query)
	}
	if len(logDB.args) != 36 {
		t.Fatalf("expected 36 insert args, got %d", len(logDB.args))
	}
	if logDB.args[21] != invocationlog.StatusBlocked || logDB.args[22] != http.StatusUnauthorized || logDB.args[23] != invocationlog.ErrorCodeInvalidAPIKey {
		t.Fatalf("unexpected status/http/error args: %+v", logDB.args[21:24])
	}
	if logDB.args[26] != invocationlog.CacheStatusBypass || logDB.args[27] != invocationlog.CacheTypeNone {
		t.Fatalf("unexpected cache args: %+v", logDB.args[26:28])
	}

	args := strings.TrimSpace(fmt.Sprint(logDB.args))
	if strings.Contains(args, "glm_api_test_redacted") || strings.Contains(args, "glm_app_token_test_redacted") {
		t.Fatalf("auth failure insert args must not include raw credentials: %s", args)
	}
}

func TestNewRouterWiresPreProviderPipeline(t *testing.T) {
	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chatCalls++
		var req provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if req.Model != routing.MockBootstrapRef {
			t.Fatalf("expected routed mock bootstrap model, got %s", req.Model)
		}

		writeRouterTestJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_router_pipeline",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   req.Model,
		})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	preflight := &routerTestGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Routing.ModelRef = routing.MockBootstrapRef
			gatewayCtx.Routing.CandidateModelRefs = []string{routing.MockBootstrapRef}
			gatewayCtx.Routing.RoutingReason = routing.ReasonMatrixRoute
			gatewayCtx.Cache.CacheStatus = "miss"
			gatewayCtx.Cache.CacheType = "exact"
		},
	}
	router := NewRouter(config.Config{}, registry, nil,
		WithGatewayAuth(
			&routerTestAPIKeyAuthenticator{identity: routerTestValidAPIKeyIdentity()},
			&routerTestAppTokenValidator{identity: routerTestValidAppTokenIdentity()},
		),
		WithPreProviderPipeline(preflight),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if preflight.calls != 1 {
		t.Fatalf("expected pre-provider pipeline to be called once, got %d", preflight.calls)
	}
	if chatCalls != 1 {
		t.Fatalf("expected provider to be called once, got %d", chatCalls)
	}
	if rr.Header().Get("X-GateLM-Routed-Provider") != "" || rr.Header().Get("X-GateLM-Routed-Model") != "" {
		t.Fatalf("resolved target must not be exposed in response headers: %#v", rr.Header())
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "miss" {
		t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
}

func TestNewRouterWiresProjectLogsWithDemoTenantScope(t *testing.T) {
	reader := &routerTestInvocationLogReader{
		items: []invocationlog.RequestLogListItem{{
			RequestID:      "request_001",
			ProjectID:      "project_demo",
			Status:         invocationlog.StatusSuccess,
			HTTPStatus:     http.StatusOK,
			CacheStatus:    invocationlog.CacheStatusMiss,
			CacheType:      invocationlog.CacheTypeExact,
			MaskingAction:  "none",
			RequestedModel: "auto",
		}},
	}
	router := NewRouter(config.Config{
		DemoTenantID: "tenant_demo",
	}, provider.NewRegistry("mock"), nil, WithInvocationLogReader(reader))

	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_demo" || reader.filter.ProjectID != "project_demo" {
		t.Fatalf("expected demo tenant and path project scope, got %+v", reader.filter)
	}
	if strings.Contains(rr.Body.String(), "redactedPromptPreview") || strings.Contains(rr.Body.String(), "metadata") {
		t.Fatalf("list response must not include detail-only fields: %s", rr.Body.String())
	}
}

func TestNewRouterWiresRequestDetailWithDemoTenantProjectScope(t *testing.T) {
	reader := &routerTestInvocationLogReader{
		detail: invocationlog.RequestDetail{
			RequestID:      "request_001",
			TraceID:        "trace_001",
			TenantID:       "tenant_demo",
			ProjectID:      "project_demo",
			Status:         invocationlog.StatusSuccess,
			HTTPStatus:     http.StatusOK,
			RequestedModel: "auto",
			ProviderCalled: true,
			ProviderAttempt: &invocationlog.ProviderAttemptFields{
				ProviderID: "mock",
				ModelID:    "mock-fast",
				Outcome:    "success",
			},
			Cache: invocationlog.CacheFields{
				CacheStatus: invocationlog.CacheStatusMiss,
				CacheType:   invocationlog.CacheTypeExact,
			},
			Masking: invocationlog.MaskingFields{MaskingAction: "none"},
		},
	}
	router := NewRouter(config.Config{
		DemoTenantID:  "tenant_demo",
		DemoProjectID: "project_demo",
	}, provider.NewRegistry("mock"), nil, WithInvocationLogReader(reader))

	req := httptest.NewRequest(http.MethodGet, "/api/llm-requests/request_001", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.detailFilter.TenantID != "tenant_demo" || reader.detailFilter.ProjectID != "project_demo" || reader.detailFilter.RequestID != "request_001" {
		t.Fatalf("expected demo tenant/project and path request scope, got %+v", reader.detailFilter)
	}
	if strings.Contains(rr.Body.String(), "rawPrompt") || strings.Contains(rr.Body.String(), "metadata") {
		t.Fatalf("detail response must not include raw/detail-forbidden fields: %s", rr.Body.String())
	}
}

func TestNewRouterWiresDashboardOverviewWithDemoTenantScope(t *testing.T) {
	cacheHitRate := 0.5
	reader := &routerTestInvocationLogReader{
		overview: invocationlog.DashboardOverviewFields{
			TotalRequests:      2,
			SuccessfulRequests: 2,
			CacheHitRequests:   1,
			CacheHitRate:       &cacheHitRate,
			TotalCostUSD:       "0.000000",
		},
	}
	router := NewRouter(config.Config{
		DemoTenantID: "tenant_demo",
	}, provider.NewRegistry("mock"), nil, WithInvocationLogReader(reader))

	req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?projectId=project_demo&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.dashboardFilter.TenantID != "tenant_demo" || reader.dashboardFilter.ProjectID != "project_demo" {
		t.Fatalf("expected demo tenant and query project dashboard scope, got %+v", reader.dashboardFilter)
	}
	if strings.Contains(rr.Body.String(), "rawPrompt") || strings.Contains(rr.Body.String(), "redactedPromptPreview") {
		t.Fatalf("dashboard response must not include request payload fields: %s", rr.Body.String())
	}
}

func TestNewRouterWiresAnalyticsPerformanceWithDemoTenantScope(t *testing.T) {
	p95LatencyMs := 2153.0
	reader := &routerTestInvocationLogReader{
		analyticsPerformance: invocationlog.AnalyticsPerformanceFields{
			Summary: invocationlog.AnalyticsPerformanceSummary{
				TotalRequests: 2,
				P95LatencyMs:  &p95LatencyMs,
			},
		},
	}
	router := NewRouter(config.Config{
		DemoTenantID: "tenant_demo",
	}, provider.NewRegistry("mock"), nil, WithInvocationLogReader(reader))

	req := httptest.NewRequest(http.MethodGet, "/api/analytics/performance?projectId=project_demo&provider=mock&model=mock-balanced&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.analyticsFilter.TenantID != "tenant_demo" || reader.analyticsFilter.ProjectID != "project_demo" || reader.analyticsFilter.Provider != "mock" || reader.analyticsFilter.Model != "mock-balanced" {
		t.Fatalf("expected demo tenant and query analytics scope, got %+v", reader.analyticsFilter)
	}
	if strings.Contains(rr.Body.String(), "rawPrompt") || strings.Contains(rr.Body.String(), "redactedPromptPreview") {
		t.Fatalf("analytics response must not include request payload fields: %s", rr.Body.String())
	}
}

func TestNewRouterWiresMetricsEndpoint(t *testing.T) {
	registry := metrics.NewRegistry()
	registry.MaskingAction("none")
	router := NewRouter(config.Config{}, provider.NewRegistry("mock"), nil, WithMetrics(registry))

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != metrics.PrometheusTextContentType {
		t.Fatalf("unexpected content type: %q", got)
	}
	if !strings.Contains(rr.Body.String(), `gatelm_masking_actions_total{masking_action="none"} 1`) {
		t.Fatalf("expected router to expose injected registry metrics, got:\n%s", rr.Body.String())
	}
}

func TestNewRouterPanicsWhenSemanticIntentPolicyPathInvalid(t *testing.T) {
	defer func() {
		recovered := recover()
		if recovered == nil {
			t.Fatalf("Semantic Cache intent policy path가 잘못되면 startup에서 실패해야 함")
		}
		if !strings.Contains(fmt.Sprint(recovered), "missing-semantic-cache-policy.json") {
			t.Fatalf("panic에는 잘못된 policy path가 포함되어야 함: %v", recovered)
		}
	}()

	_ = NewRouter(config.Config{
		SemanticCache: config.SemanticCacheConfig{
			Enabled:           true,
			Store:             config.SemanticCacheStoreInMemory,
			MaxEntries:        10,
			EmbeddingProvider: config.SemanticCacheEmbeddingProviderFake,
			EmbeddingModel:    "fake-test",
			IntentPolicyPath:  "missing-semantic-cache-policy.json",
		},
	}, provider.NewRegistry("mock"), nil)
}

func writeRouterTestJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func routerTestValidAPIKeyIdentity() auth.APIKeyIdentity {
	return auth.APIKeyIdentity{
		APIKeyID:      "api_key_demo",
		TenantID:      "tenant_demo",
		ProjectID:     "project_demo",
		ApplicationID: "app_demo",
	}
}

func routerTestValidAppTokenIdentity() auth.AppTokenIdentity {
	return auth.AppTokenIdentity{
		AppTokenID:    "app_token_demo",
		TenantID:      "tenant_demo",
		ProjectID:     "project_demo",
		ApplicationID: "app_demo",
	}
}

type routerTestAuthFailureLogWriter struct {
	logs []invocationlog.AuthFailureLog
}

func (w *routerTestAuthFailureLogWriter) WriteAuthFailureLog(_ context.Context, log invocationlog.AuthFailureLog) error {
	w.logs = append(w.logs, log)
	return nil
}

type routerTestInvocationLogDB struct {
	calls int
	query string
	args  []any
}

func (db *routerTestInvocationLogDB) Exec(_ context.Context, query string, arguments ...any) (pgconn.CommandTag, error) {
	db.calls++
	db.query = query
	db.args = append([]any(nil), arguments...)
	return pgconn.CommandTag{}, nil
}

type routerTestInvocationLogReader struct {
	filter               invocationlog.ProjectLogsFilter
	detailFilter         invocationlog.RequestDetailFilter
	dashboardFilter      invocationlog.DashboardOverviewFilter
	analyticsFilter      invocationlog.AnalyticsPerformanceFilter
	liveUsageFilter      invocationlog.AnalyticsLiveUsageFilter
	policyImpactFilter   invocationlog.AnalyticsPolicyImpactFilter
	reliabilityFilter    invocationlog.AnalyticsReliabilityFilter
	items                []invocationlog.RequestLogListItem
	detail               invocationlog.RequestDetail
	overview             invocationlog.DashboardOverviewFields
	analyticsPerformance invocationlog.AnalyticsPerformanceFields
	liveUsage            invocationlog.AnalyticsLiveUsageFields
	policyImpact         invocationlog.AnalyticsPolicyImpactFields
	analyticsReliability invocationlog.AnalyticsReliabilityFields
}

func (r *routerTestInvocationLogReader) ListProjectLogs(_ context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	r.filter = filter
	return r.items, nil
}

func (r *routerTestInvocationLogReader) GetRequestDetail(_ context.Context, filter invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error) {
	r.detailFilter = filter
	return r.detail, nil
}

func (r *routerTestInvocationLogReader) GetDashboardOverview(_ context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error) {
	r.dashboardFilter = filter
	return r.overview, nil
}

func (r *routerTestInvocationLogReader) GetCostReport(_ context.Context, _ invocationlog.CostReportFilter) (invocationlog.CostReportFields, error) {
	return invocationlog.CostReportFields{}, nil
}

func (r *routerTestInvocationLogReader) GetAnalyticsPerformance(_ context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error) {
	r.analyticsFilter = filter
	return r.analyticsPerformance, nil
}

func (r *routerTestInvocationLogReader) GetAnalyticsLiveUsage(_ context.Context, filter invocationlog.AnalyticsLiveUsageFilter) (invocationlog.AnalyticsLiveUsageFields, error) {
	r.liveUsageFilter = filter
	return r.liveUsage, nil
}

func (r *routerTestInvocationLogReader) GetAnalyticsPolicyImpact(_ context.Context, filter invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error) {
	r.policyImpactFilter = filter
	return r.policyImpact, nil
}

func (r *routerTestInvocationLogReader) GetAnalyticsReliability(_ context.Context, filter invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error) {
	r.reliabilityFilter = filter
	return r.analyticsReliability, nil
}

type routerTestAPIKeyAuthenticator struct {
	identity auth.APIKeyIdentity
	err      error
	calls    int
}

type blockingRouterDifficultyShadowEvaluation struct {
	entered chan struct{}
	release chan struct{}
}

func (evaluation *blockingRouterDifficultyShadowEvaluation) Evaluate(
	_ context.Context,
	_ routing.PromptFeatures,
	_ string,
) routing.DifficultySemanticShadowResult {
	close(evaluation.entered)
	<-evaluation.release
	return routing.DifficultySemanticShadowResult{
		Status: routing.DifficultySemanticShadowReady,
		Difficulty: routing.DifficultyResult{
			Difficulty: routing.DifficultyComplex,
		},
	}
}

func (*blockingRouterDifficultyShadowEvaluation) Close() error { return nil }

func (f *routerTestAPIKeyAuthenticator) AuthenticateAPIKey(_ context.Context, _ string) (auth.APIKeyIdentity, error) {
	f.calls++
	if f.err != nil {
		return auth.APIKeyIdentity{}, f.err
	}
	return f.identity, nil
}

type routerTestAppTokenValidator struct {
	identity auth.AppTokenIdentity
	err      error
	calls    int
}

func (f *routerTestAppTokenValidator) ValidateAppToken(_ context.Context, _ string) (auth.AppTokenIdentity, error) {
	f.calls++
	if f.err != nil {
		return auth.AppTokenIdentity{}, f.err
	}
	return f.identity, nil
}

type routerTestGatewayPipeline struct {
	calls  int
	mutate func(gatewayCtx *request.GatewayContext)
}

func (p *routerTestGatewayPipeline) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	p.calls++
	if p.mutate != nil {
		p.mutate(gatewayCtx)
	}
	return nil
}
