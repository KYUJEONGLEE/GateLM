package middleware

import (
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
	if log.RequestID != "request_auth_401" || log.Status != invocationlog.StatusError || log.HTTPStatus != http.StatusUnauthorized {
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
