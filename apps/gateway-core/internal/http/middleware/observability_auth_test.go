package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestObservabilityAuthMiddlewarePassesThroughWhenDisabled(t *testing.T) {
	calls := 0
	handler := ObservabilityAuthMiddleware("", false)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusNoContent)
	}))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/dashboard/overview", nil))

	if recorder.Code != http.StatusNoContent || calls != 1 {
		t.Fatalf("disabled middleware must pass through: status=%d calls=%d", recorder.Code, calls)
	}
}

func TestObservabilityAuthMiddlewareRejectsMissingAndWrongTokens(t *testing.T) {
	const token = "observability-internal-token-for-unit-test"
	calls := 0
	handler := ObservabilityAuthMiddleware(token, false)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, test := range []struct {
		name  string
		value string
	}{
		{name: "missing"},
		{name: "wrong", value: "wrong-token"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview", nil)
			request.Header.Set(RequestIDHeader, "request_observability_auth")
			if test.value != "" {
				request.Header.Set(ObservabilityTokenHeader, test.value)
			}
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d: %s", recorder.Code, recorder.Body.String())
			}
			if calls != 0 {
				t.Fatalf("unauthorized request reached protected handler: calls=%d", calls)
			}
			if recorder.Header().Get(RequestIDHeader) != "request_observability_auth" {
				t.Fatalf("request id was not preserved: %q", recorder.Header().Get(RequestIDHeader))
			}
			if strings.Contains(recorder.Body.String(), token) || strings.Contains(recorder.Body.String(), test.value) && test.value != "" {
				t.Fatalf("authorization response exposed a token: %s", recorder.Body.String())
			}
		})
	}
}

func TestObservabilityAuthMiddlewareAcceptsValidToken(t *testing.T) {
	const token = "observability-internal-token-for-unit-test"
	calls := 0
	handler := ObservabilityAuthMiddleware(token, true)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview", nil)
	request.Header.Set(ObservabilityTokenHeader, token)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent || calls != 1 {
		t.Fatalf("valid token must reach protected handler: status=%d calls=%d", recorder.Code, calls)
	}
}

func TestObservabilityAuthMiddlewareFailsClosedWhenRequiredTokenIsMissing(t *testing.T) {
	handler := ObservabilityAuthMiddleware("", true)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("required auth with no configured token must not call the handler")
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview", nil)
	request.Header.Set(ObservabilityTokenHeader, "any-token")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected fail-closed 401, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
