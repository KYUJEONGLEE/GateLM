package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type captureAuthFailureWriter struct {
	logs []invocationlog.AuthFailureLog
}

func (w *captureAuthFailureWriter) WriteAuthFailureLog(_ context.Context, log invocationlog.AuthFailureLog) error {
	w.logs = append(w.logs, log)
	return nil
}

type immediateResponseWriter struct {
	header     http.Header
	status     int
	body       bytes.Buffer
	writeCalls int
	flushed    bool
}

func newImmediateResponseWriter() *immediateResponseWriter {
	return &immediateResponseWriter{header: make(http.Header)}
}

func (w *immediateResponseWriter) Header() http.Header {
	return w.header
}

func (w *immediateResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
}

func (w *immediateResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	w.writeCalls++
	return w.body.Write(body)
}

func (w *immediateResponseWriter) Flush() {
	w.flushed = true
}

func TestAuthFailureLogMiddlewareRecordsInvalidAPIKey(t *testing.T) {
	writer := &captureAuthFailureWriter{}
	handler := AuthFailureLogMiddleware(writer)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(RequestIDHeader, "request_auth_401")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message":    "Invalid Gateway API key.",
				"code":       invocationlog.ErrorCodeInvalidAPIKey,
				"request_id": "request_auth_401",
			},
		})
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-End-User-Id", "user_demo")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected response status to be preserved, got %d", rr.Code)
	}
	if len(writer.logs) != 1 {
		t.Fatalf("expected one auth failure log, got %d", len(writer.logs))
	}

	log := writer.logs[0]
	if log.RequestID != "request_auth_401" || log.Status != invocationlog.StatusBlocked || log.HTTPStatus != http.StatusUnauthorized {
		t.Fatalf("unexpected auth failure log identity/status: %+v", log)
	}
	if log.ErrorCode != invocationlog.ErrorCodeInvalidAPIKey || log.ErrorStage != invocationlog.StageAuthenticateAPIKey {
		t.Fatalf("unexpected auth failure error fields: %+v", log)
	}
	if log.CacheStatus != invocationlog.CacheStatusBypass || log.CacheType != invocationlog.CacheTypeNone {
		t.Fatalf("unexpected cache fields: %+v", log)
	}
	if log.EndUserID != "user_demo" {
		t.Fatalf("expected end user id to be copied, got %q", log.EndUserID)
	}
	if strings.Contains(fmt.Sprintf("%+v", log), "glm_api_test_redacted") {
		t.Fatalf("auth failure log must not include raw Authorization header")
	}
	if !strings.Contains(rr.Body.String(), invocationlog.ErrorCodeInvalidAPIKey) {
		t.Fatalf("expected response body to be preserved, got %s", rr.Body.String())
	}
}

func TestAuthFailureLogMiddlewareRecordsInvalidAppToken(t *testing.T) {
	writer := &captureAuthFailureWriter{}
	handler := AuthFailureLogMiddleware(writer)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(RequestIDHeader, "request_auth_403")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message":    "Invalid GateLM App Token.",
				"code":       invocationlog.ErrorCodeInvalidAppToken,
				"request_id": "request_auth_403",
			},
		})
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected response status to be preserved, got %d", rr.Code)
	}
	if len(writer.logs) != 1 {
		t.Fatalf("expected one auth failure log, got %d", len(writer.logs))
	}
	log := writer.logs[0]
	if log.ErrorCode != invocationlog.ErrorCodeInvalidAppToken || log.ErrorStage != invocationlog.StageValidateAppToken {
		t.Fatalf("unexpected app token failure log: %+v", log)
	}
	if strings.Contains(fmt.Sprintf("%+v", log), "glm_app_token_test_redacted") {
		t.Fatalf("auth failure log must not include raw app token")
	}
}

func TestAuthFailureLogMiddlewarePassesThroughSuccessBodyImmediately(t *testing.T) {
	writer := &captureAuthFailureWriter{}
	underlying := newImmediateResponseWriter()
	observedDuringHandler := false

	handler := AuthFailureLogMiddleware(writer)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("first"))
		observedDuringHandler = underlying.body.String() == "first"
		_, _ = w.Write([]byte("second"))
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
	handler.ServeHTTP(underlying, req)

	if !observedDuringHandler {
		t.Fatalf("expected success response body to pass through before handler returns")
	}
	if underlying.status != http.StatusOK {
		t.Fatalf("expected 200, got %d", underlying.status)
	}
	if underlying.body.String() != "firstsecond" {
		t.Fatalf("expected response body to be passed through, got %q", underlying.body.String())
	}
	if underlying.writeCalls != 2 {
		t.Fatalf("expected two underlying writes, got %d", underlying.writeCalls)
	}
	if len(writer.logs) != 0 {
		t.Fatalf("expected no auth failure logs for success response, got %d", len(writer.logs))
	}
}

func TestAuthFailureLogMiddlewarePreservesFlusherForPassThroughResponses(t *testing.T) {
	writer := &captureAuthFailureWriter{}
	underlying := newImmediateResponseWriter()

	handler := AuthFailureLogMiddleware(writer)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatalf("expected middleware response writer to implement http.Flusher")
		}
		w.WriteHeader(http.StatusOK)
		flusher.Flush()
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
	handler.ServeHTTP(underlying, req)

	if !underlying.flushed {
		t.Fatalf("expected flush to pass through to underlying response writer")
	}
	if underlying.status != http.StatusOK {
		t.Fatalf("expected 200, got %d", underlying.status)
	}
}

func TestAuthFailureLogMiddlewareIgnoresNonAuthErrors(t *testing.T) {
	writer := &captureAuthFailureWriter{}
	handler := AuthFailureLogMiddleware(writer)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message":    "Tenant, project, or application scope mismatch.",
				"code":       "scope_mismatch",
				"request_id": "request_scope_mismatch",
			},
		})
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected response status to be preserved, got %d", rr.Code)
	}
	if len(writer.logs) != 0 {
		t.Fatalf("expected no auth failure logs, got %d", len(writer.logs))
	}
}
