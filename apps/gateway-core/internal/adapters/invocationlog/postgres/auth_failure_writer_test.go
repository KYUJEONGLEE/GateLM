package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	"github.com/jackc/pgx/v5/pgconn"
)

type fakeExecer struct {
	called bool
	query  string
	args   []any
	err    error
}

func (f *fakeExecer) Exec(_ context.Context, query string, arguments ...any) (pgconn.CommandTag, error) {
	f.called = true
	f.query = query
	f.args = append([]any(nil), arguments...)
	return pgconn.CommandTag{}, f.err
}

func TestAuthFailureWriterMapsInvalidAPIKeyToP0InvocationLog(t *testing.T) {
	execer := &fakeExecer{}
	writer := NewAuthFailureWriter(execer, AuthFailureDefaults{
		TenantID:      "00000000-0000-4000-8000-000000000100",
		ProjectID:     "00000000-0000-4000-8000-000000000200",
		ApplicationID: "00000000-0000-4000-8000-000000000300",
	})
	startedAt := time.Date(2026, 6, 26, 1, 2, 3, 0, time.UTC)
	completedAt := startedAt.Add(12 * time.Millisecond)

	err := writer.WriteAuthFailureLog(context.Background(), invocationlog.BuildAuthFailureLog(invocationlog.AuthFailureInput{
		RequestID:    "request_invalid_api_key",
		HTTPStatus:   401,
		ErrorCode:    invocationlog.ErrorCodeInvalidAPIKey,
		ErrorMessage: "Invalid Gateway API key.",
		StartedAt:    startedAt,
		CompletedAt:  completedAt,
	}))
	if err != nil {
		t.Fatalf("WriteAuthFailureLog returned error: %v", err)
	}
	if !execer.called {
		t.Fatalf("expected database insert")
	}
	if !strings.Contains(execer.query, "insert into p0_llm_invocation_logs") {
		t.Fatalf("expected p0_llm_invocation_logs insert, got %s", execer.query)
	}
	if len(execer.args) != 36 {
		t.Fatalf("expected 36 insert args, got %d", len(execer.args))
	}

	assertUUIDArg(t, execer.args, 0)
	assertArg(t, execer.args, 1, "request_invalid_api_key")
	assertArg(t, execer.args, 2, "request_invalid_api_key")
	assertArg(t, execer.args, 3, "00000000-0000-4000-8000-000000000100")
	assertArg(t, execer.args, 4, "00000000-0000-4000-8000-000000000200")
	assertArg(t, execer.args, 5, "00000000-0000-4000-8000-000000000300")
	assertArg(t, execer.args, 21, invocationlog.StatusError)
	assertArg(t, execer.args, 22, 401)
	assertArg(t, execer.args, 23, invocationlog.ErrorCodeInvalidAPIKey)
	assertArg(t, execer.args, 25, invocationlog.StageAuthenticateAPIKey)
	assertArg(t, execer.args, 26, invocationlog.CacheStatusBypass)
	assertArg(t, execer.args, 27, invocationlog.CacheTypeNone)
	assertArg(t, execer.args, 28, "none")
	assertArg(t, execer.args, 30, 0)

	for _, index := range []int{15, 16, 17} {
		assertArg(t, execer.args, index, 0)
	}
	assertArg(t, execer.args, 18, int64(0))
	if got, ok := execer.args[19].(int64); !ok || got != 12 {
		t.Fatalf("expected latency arg 19 to be int64(12), got %T %v", execer.args[19], execer.args[19])
	}
	if execer.args[20] != nil {
		t.Fatalf("expected provider latency to be nil, got %v", execer.args[20])
	}
	assertHashArg(t, execer.args, 31)
	assertHashArg(t, execer.args, 32)

	metadata, ok := execer.args[33].([]byte)
	if !ok {
		t.Fatalf("expected metadata JSON []byte, got %T", execer.args[33])
	}
	var decoded map[string]any
	if err := json.Unmarshal(metadata, &decoded); err != nil {
		t.Fatalf("decode metadata JSON: %v", err)
	}
	if decoded["schemaVersion"] != float64(1) {
		t.Fatalf("expected schemaVersion metadata, got %v", decoded)
	}
}

func TestAuthFailureWriterKeepsKnownAPIKeyIDForInvalidAppToken(t *testing.T) {
	execer := &fakeExecer{}
	writer := NewAuthFailureWriter(execer, AuthFailureDefaults{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
	})

	err := writer.WriteAuthFailureLog(context.Background(), invocationlog.BuildAuthFailureLog(invocationlog.AuthFailureInput{
		RequestID:     "request_invalid_app_token",
		TenantID:      "00000000-0000-4000-8000-000000000100",
		ProjectID:     "00000000-0000-4000-8000-000000000200",
		ApplicationID: "00000000-0000-4000-8000-000000000300",
		APIKeyID:      "00000000-0000-4000-8000-000000000400",
		HTTPStatus:    403,
		ErrorCode:     invocationlog.ErrorCodeInvalidAppToken,
		ErrorMessage:  "Invalid GateLM App Token.",
		StartedAt:     time.Now(),
		CompletedAt:   time.Now(),
	}))
	if err != nil {
		t.Fatalf("WriteAuthFailureLog returned error: %v", err)
	}
	assertArg(t, execer.args, 6, "00000000-0000-4000-8000-000000000400")
	assertArg(t, execer.args, 7, nil)
	assertArg(t, execer.args, 22, 403)
	assertArg(t, execer.args, 23, invocationlog.ErrorCodeInvalidAppToken)
	assertArg(t, execer.args, 25, invocationlog.StageValidateAppToken)
}

func TestAuthFailureWriterDoesNotPersistRawCredentials(t *testing.T) {
	execer := &fakeExecer{}
	writer := NewAuthFailureWriter(execer, AuthFailureDefaults{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
	})

	err := writer.WriteAuthFailureLog(context.Background(), invocationlog.BuildAuthFailureLog(invocationlog.AuthFailureInput{
		RequestID:    "request_secret_check",
		HTTPStatus:   401,
		ErrorCode:    invocationlog.ErrorCodeInvalidAPIKey,
		ErrorMessage: "Invalid Gateway API key.",
		StartedAt:    time.Now(),
		CompletedAt:  time.Now(),
	}))
	if err != nil {
		t.Fatalf("WriteAuthFailureLog returned error: %v", err)
	}

	args := fmt.Sprintf("%+v", execer.args)
	for _, forbidden := range []string{
		"glm_api_test_redacted",
		"glm_app_token_test_redacted",
		"Authorization",
		"Bearer",
		"rawPrompt",
		"rawResponse",
	} {
		if strings.Contains(args, forbidden) {
			t.Fatalf("writer args must not contain %q: %s", forbidden, args)
		}
	}
}

func TestAuthFailureWriterIgnoresNonAuthFailures(t *testing.T) {
	execer := &fakeExecer{}
	writer := NewAuthFailureWriter(execer, AuthFailureDefaults{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
	})

	err := writer.WriteAuthFailureLog(context.Background(), invocationlog.AuthFailureLog{
		RequestID:  "request_scope_mismatch",
		HTTPStatus: 403,
		ErrorCode:  "scope_mismatch",
	})
	if err != nil {
		t.Fatalf("WriteAuthFailureLog returned error: %v", err)
	}
	if execer.called {
		t.Fatalf("expected non-auth failure not to be inserted")
	}
}

func assertArg(t *testing.T, args []any, index int, want any) {
	t.Helper()
	if len(args) <= index {
		t.Fatalf("missing arg index %d", index)
	}
	if args[index] != want {
		t.Fatalf("arg %d: expected %T %v, got %T %v", index, want, want, args[index], args[index])
	}
}

func assertHashArg(t *testing.T, args []any, index int) {
	t.Helper()
	value, ok := args[index].(string)
	if !ok {
		t.Fatalf("arg %d: expected hash string, got %T", index, args[index])
	}
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+64 {
		t.Fatalf("arg %d: expected sha256 hash, got %q", index, value)
	}
}

func assertUUIDArg(t *testing.T, args []any, index int) {
	t.Helper()
	value, ok := args[index].(string)
	if !ok {
		t.Fatalf("arg %d: expected uuid string, got %T", index, args[index])
	}
	parts := strings.Split(value, "-")
	if len(parts) != 5 || len(parts[0]) != 8 || len(parts[1]) != 4 || len(parts[2]) != 4 || len(parts[3]) != 4 || len(parts[4]) != 12 {
		t.Fatalf("arg %d: expected uuid string, got %q", index, value)
	}
}
