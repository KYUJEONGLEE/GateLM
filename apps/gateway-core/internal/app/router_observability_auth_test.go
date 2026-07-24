package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	httpmiddleware "gatelm/apps/gateway-core/internal/http/middleware"
)

func TestNewRouterProtectsEveryObservabilityReadRouteWhenTokenConfigured(t *testing.T) {
	const token = "observability-router-token-4f97209ca67b8d35"
	reader := &routerTestInvocationLogReader{
		detail: invocationlog.RequestDetail{
			RequestID:  "request_001",
			TenantID:   "tenant_demo",
			ProjectID:  "project_demo",
			Status:     invocationlog.StatusSuccess,
			HTTPStatus: http.StatusOK,
		},
	}
	router := NewRouter(config.Config{
		DemoTenantID:               "tenant_demo",
		DemoProjectID:              "project_demo",
		ObservabilityInternalToken: token,
	}, provider.NewRegistry("mock"), nil, WithInvocationLogReader(reader))

	routes := []struct {
		name string
		path string
	}{
		{name: "project logs", path: "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z"},
		{name: "request detail", path: "/api/llm-requests/request_001"},
		{name: "dashboard", path: "/api/dashboard/overview?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z"},
		{name: "analytics", path: "/api/analytics/performance?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z"},
		{name: "live usage", path: "/api/analytics/live-usage?from=2026-06-25T00:00:00Z&to=2026-06-25T00:15:00Z"},
		{name: "policy impact", path: "/api/analytics/policy-impact?period=hour&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z"},
		{name: "analytics reliability", path: "/api/analytics/reliability?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z"},
		{name: "cost report", path: "/api/reports/costs?period=day&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z"},
	}

	for _, route := range routes {
		t.Run(route.name, func(t *testing.T) {
			for _, auth := range []struct {
				name  string
				value string
				want  int
			}{
				{name: "missing", want: http.StatusUnauthorized},
				{name: "wrong", value: "wrong-observability-token", want: http.StatusUnauthorized},
				{name: "valid", value: token, want: http.StatusOK},
			} {
				t.Run(auth.name, func(t *testing.T) {
					request := httptest.NewRequest(http.MethodGet, route.path, nil)
					if auth.value != "" {
						request.Header.Set(httpmiddleware.ObservabilityTokenHeader, auth.value)
					}
					recorder := httptest.NewRecorder()

					router.ServeHTTP(recorder, request)

					if recorder.Code != auth.want {
						t.Fatalf("expected %d, got %d: %s", auth.want, recorder.Code, recorder.Body.String())
					}
					if auth.want == http.StatusUnauthorized && !strings.Contains(recorder.Body.String(), "observability_unauthorized") {
						t.Fatalf("unexpected authorization error: %s", recorder.Body.String())
					}
				})
			}
		})
	}
}

func TestNewRouterFailsClosedWhenObservabilityAuthRequiredWithoutToken(t *testing.T) {
	router := NewRouter(config.Config{
		ObservabilityAuthRequired: true,
	}, provider.NewRegistry("mock"), nil, WithInvocationLogReader(&routerTestInvocationLogReader{}))
	request := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	request.Header.Set(httpmiddleware.ObservabilityTokenHeader, "attacker-supplied-token")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("required observability auth without a configured token must fail closed: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestNewRouterFailsClosedWhenObservabilityAuthRequiredWithWeakToken(t *testing.T) {
	router := NewRouter(config.Config{
		ObservabilityAuthRequired:  true,
		ObservabilityInternalToken: "replace-me-observability-token-1234567890",
	}, provider.NewRegistry("mock"), nil, WithInvocationLogReader(&routerTestInvocationLogReader{}))
	request := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	request.Header.Set(httpmiddleware.ObservabilityTokenHeader, "replace-me-observability-token-1234567890")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("required observability auth with a weak token must fail closed: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestNewRouterDoesNotApplyObservabilityTokenToHealthRoute(t *testing.T) {
	router := NewRouter(config.Config{
		ObservabilityAuthRequired:  true,
		ObservabilityInternalToken: "observability-router-token-4f97209ca67b8d35",
	}, provider.NewRegistry("mock"), nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("health route must remain outside observability auth: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
