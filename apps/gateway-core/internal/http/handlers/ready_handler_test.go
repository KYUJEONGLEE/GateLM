package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/config"
)

func TestPostgresDriverURLRemovesPrismaSchemaQuery(t *testing.T) {
	rawURL := "postgresql://gatelm:gatelm@postgres:5432/gatelm?schema=public&sslmode=disable"

	got := config.DatabaseDriverURL(rawURL)
	want := "postgresql://gatelm:gatelm@postgres:5432/gatelm?sslmode=disable"

	if got != want {
		t.Fatalf("unexpected postgres driver url: got %q want %q", got, want)
	}
}

func TestReadyHandlerReturnsServiceUnavailableWhenRequiredDependencyFails(t *testing.T) {
	handler := ReadyHandler{
		Timeout: time.Second,
		Checks: map[string]ReadinessCheck{
			"postgres": {
				Required: true,
				Check: func(ctx context.Context) error {
					return nil
				},
			},
			"redis": {
				Required:       true,
				FailureMessage: "connection failed",
				Check: func(ctx context.Context) error {
					return fmt.Errorf("redis unavailable")
				},
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp readinessResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode readiness response: %v", err)
	}
	if resp.Status != "not_ready" {
		t.Fatalf("unexpected readiness status: %s", resp.Status)
	}
	if resp.Dependencies["redis"].Status != "error" {
		t.Fatalf("unexpected redis dependency status: %s", resp.Dependencies["redis"].Status)
	}
}

func TestReadyHandlerRunsDependencyChecksConcurrently(t *testing.T) {
	started := make(chan string, 2)
	release := make(chan struct{})

	blockingCheck := func(name string) func(ctx context.Context) error {
		return func(ctx context.Context) error {
			started <- name
			select {
			case <-release:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}

	handler := ReadyHandler{
		Timeout: time.Second,
		Checks: map[string]ReadinessCheck{
			"postgres": {Required: true, Check: blockingCheck("postgres")},
			"redis":    {Required: true, Check: blockingCheck("redis")},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rr := httptest.NewRecorder()
	done := make(chan struct{})

	go func() {
		handler.ServeHTTP(rr, req)
		close(done)
	}()

	seen := map[string]bool{}
	for len(seen) < 2 {
		select {
		case name := <-started:
			seen[name] = true
		case <-time.After(200 * time.Millisecond):
			t.Fatalf("checks did not start concurrently, seen=%v", seen)
		}
	}

	close(release)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("ready handler did not complete")
	}

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}
