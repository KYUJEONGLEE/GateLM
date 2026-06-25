package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type ReadyHandler struct {
	Timeout time.Duration
	Checks  map[string]ReadinessCheck
}

type ReadinessCheck struct {
	Required       bool
	FailureMessage string
	Check          func(ctx context.Context) error
}

type readinessResponse struct {
	Status       string                        `json:"status"`
	Service      string                        `json:"service"`
	Time         string                        `json:"time"`
	Dependencies map[string]dependencyResponse `json:"dependencies"`
}

type dependencyResponse struct {
	Status   string `json:"status"`
	Required bool   `json:"required"`
	Message  string `json:"message,omitempty"`
}

func (h ReadyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.Timeout)
	defer cancel()

	deps := runReadinessChecks(ctx, h.Checks)

	status := "ready"
	httpStatus := http.StatusOK
	for _, dep := range deps {
		if dep.Required && dep.Status != "ok" {
			status = "not_ready"
			httpStatus = http.StatusServiceUnavailable
			break
		}
	}

	writeJSON(w, httpStatus, readinessResponse{
		Status:       status,
		Service:      "gateway-core",
		Time:         time.Now().UTC().Format(time.RFC3339Nano),
		Dependencies: deps,
	})
}

func runReadinessChecks(ctx context.Context, checks map[string]ReadinessCheck) map[string]dependencyResponse {
	deps := make(map[string]dependencyResponse, len(checks))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for name, check := range checks {
		name := name
		check := check
		wg.Add(1)
		go func() {
			defer wg.Done()

			dep := dependencyResponse{Required: check.Required}
			if check.Check == nil {
				dep.Status = "error"
				dep.Message = "readiness check is not configured"
			} else if err := check.Check(ctx); err != nil {
				dep.Status = "error"
				dep.Message = check.failureMessage()
			} else {
				dep.Status = "ok"
			}

			mu.Lock()
			deps[name] = dep
			mu.Unlock()
		}()
	}

	wg.Wait()
	return deps
}

func (c ReadinessCheck) failureMessage() string {
	if c.FailureMessage == "" {
		return "health check failed"
	}
	return c.FailureMessage
}

func HTTPHealthCheck(client *http.Client, baseURL string) func(ctx context.Context) error {
	healthURL := strings.TrimRight(baseURL, "/") + "/healthz"

	return func(ctx context.Context) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
		if err != nil {
			return fmt.Errorf("build health request: %w", err)
		}

		httpClient := client
		if httpClient == nil {
			httpClient = http.DefaultClient
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("call health endpoint: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("health endpoint returned status %d", resp.StatusCode)
		}

		return nil
	}
}
