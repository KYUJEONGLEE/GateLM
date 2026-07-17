package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/metrics"
)

type ReadyHandler struct {
	Timeout         time.Duration
	Checks          map[string]ReadinessCheck
	MetricsRegistry *metrics.Registry
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
	if h.MetricsRegistry != nil {
		for name, dep := range deps {
			h.MetricsRegistry.SetGatewayDependencyReady(name, dep.Required, dep.Status == "ok")
		}
	}

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
	results := make(chan readinessCheckResult, len(checks))

	for name, check := range checks {
		go func(name string, check ReadinessCheck) {
			results <- readinessCheckResult{
				name: name,
				dep:  runReadinessCheck(ctx, check),
			}
		}(name, check)
	}

	for range checks {
		select {
		case result := <-results:
			deps[result.name] = result.dep
		case <-ctx.Done():
			for {
				select {
				case result := <-results:
					deps[result.name] = result.dep
				default:
					fillTimedOutReadinessChecks(deps, checks)
					return deps
				}
			}
		}
	}

	return deps
}

func fillTimedOutReadinessChecks(deps map[string]dependencyResponse, checks map[string]ReadinessCheck) {
	for name, check := range checks {
		if _, ok := deps[name]; ok {
			continue
		}
		deps[name] = dependencyResponse{
			Status:   "error",
			Required: check.Required,
			Message:  "check timed out or context canceled",
		}
	}
}

func runReadinessCheck(ctx context.Context, check ReadinessCheck) dependencyResponse {
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
	return dep
}

type readinessCheckResult struct {
	name string
	dep  dependencyResponse
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

// HTTPReadinessCheck derives the process-level /readyz endpoint from an
// internal service endpoint. Returned errors are deliberately location-free;
// callers expose only their configured bounded FailureMessage.
func HTTPReadinessCheck(client *http.Client, serviceEndpoint string) func(ctx context.Context) error {
	readyURL, buildErr := processReadinessURL(serviceEndpoint)
	return func(ctx context.Context) error {
		if buildErr != nil {
			return errors.New("readiness endpoint is not configured")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, readyURL, nil)
		if err != nil {
			return errors.New("readiness request could not be created")
		}
		httpClient := client
		if httpClient == nil {
			httpClient = http.DefaultClient
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return errors.New("readiness endpoint call failed")
		}
		defer resp.Body.Close()
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			return errors.New("readiness endpoint is not ready")
		}
		return nil
	}
}

func processReadinessURL(serviceEndpoint string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(serviceEndpoint))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("invalid service endpoint")
	}
	parsed.Path = "/readyz"
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}
