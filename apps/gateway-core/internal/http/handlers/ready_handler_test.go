package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/metrics"
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

func TestReadyHandlerReturnsTimeoutWhenDependencyIgnoresContext(t *testing.T) {
	release := make(chan struct{})
	defer close(release)

	handler := ReadyHandler{
		Timeout: 10 * time.Millisecond,
		Checks: map[string]ReadinessCheck{
			"postgres": {
				Required: true,
				Check: func(ctx context.Context) error {
					<-release
					return nil
				},
			},
			"redis": {
				Required: true,
				Check: func(ctx context.Context) error {
					return nil
				},
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rr := httptest.NewRecorder()
	startedAt := time.Now()

	handler.ServeHTTP(rr, req)

	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("ready handler did not honor timeout, elapsed=%s", elapsed)
	}
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp readinessResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode readiness response: %v", err)
	}
	dep := resp.Dependencies["postgres"]
	if dep.Status != "error" {
		t.Fatalf("unexpected postgres dependency status: %s", dep.Status)
	}
	if dep.Message != "check timed out or context canceled" {
		t.Fatalf("unexpected postgres dependency message: %s", dep.Message)
	}
}

func TestReadyHandlerRecordsOptionalDependencyAsDegradedWithoutFailingGateway(t *testing.T) {
	registry := metrics.NewRegistry()
	handler := ReadyHandler{
		Timeout:         time.Second,
		MetricsRegistry: registry,
		Checks: map[string]ReadinessCheck{
			"ai_safety_sidecar": {
				Required:       false,
				FailureMessage: "not ready",
				Check: func(context.Context) error {
					return errors.New("location and raw detail must stay internal")
				},
			},
		},
	}

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("optional sidecar must not fail Gateway readiness: %d", rr.Code)
	}
	if strings.Contains(rr.Body.String(), "location and raw detail") {
		t.Fatal("readiness response must not expose dependency error detail")
	}
	output := registry.RenderPrometheus()
	want := `gatelm_gateway_dependency_ready{dependency="ai_safety_sidecar",required="false"} 0`
	if !strings.Contains(output, want) {
		t.Fatalf("missing optional dependency gauge %q\n%s", want, output)
	}
}

func TestHTTPReadinessCheckReplacesServiceEndpointPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/readyz" || r.URL.RawQuery != "" {
			t.Fatalf("unexpected readiness request location: path=%q query=%q", r.URL.Path, r.URL.RawQuery)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	check := HTTPReadinessCheck(server.Client(), server.URL+"/internal/ai-safety/v1/detect?ignored=true")
	if err := check(context.Background()); err != nil {
		t.Fatalf("readiness check failed: %v", err)
	}
}
