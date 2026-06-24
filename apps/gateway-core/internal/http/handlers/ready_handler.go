package handlers

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type ReadyHandler struct {
	DatabaseURL         string
	RedisURL            string
	MockProviderBaseURL string
	Timeout             time.Duration
	HTTPClient          *http.Client
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

	deps := map[string]dependencyResponse{
		"postgres":      h.checkPostgres(ctx),
		"redis":         h.checkRedis(ctx),
		"mock_provider": h.checkMockProvider(ctx),
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

func (h ReadyHandler) checkPostgres(ctx context.Context) dependencyResponse {
	conn, err := pgx.Connect(ctx, postgresDriverURL(h.DatabaseURL))
	if err != nil {
		return dependencyResponse{Status: "error", Required: true, Message: "connection failed"}
	}
	defer conn.Close(context.Background())

	if err := conn.Ping(ctx); err != nil {
		return dependencyResponse{Status: "error", Required: true, Message: "ping failed"}
	}

	return dependencyResponse{Status: "ok", Required: true}
}

func postgresDriverURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}

	query := parsed.Query()
	query.Del("schema")
	parsed.RawQuery = query.Encode()

	return parsed.String()
}

func (h ReadyHandler) checkRedis(ctx context.Context) dependencyResponse {
	address, err := tcpAddressFromURL(h.RedisURL, "6379")
	if err != nil {
		return dependencyResponse{Status: "error", Required: true, Message: "invalid dependency url"}
	}

	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return dependencyResponse{Status: "error", Required: true, Message: "connection failed"}
	}
	defer conn.Close()

	deadline, ok := ctx.Deadline()
	if ok {
		_ = conn.SetDeadline(deadline)
	}

	if _, err := fmt.Fprint(conn, "*1\r\n$4\r\nPING\r\n"); err != nil {
		return dependencyResponse{Status: "error", Required: true, Message: "ping failed"}
	}

	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil || !strings.HasPrefix(line, "+PONG") {
		return dependencyResponse{Status: "error", Required: true, Message: "unexpected ping response"}
	}

	return dependencyResponse{Status: "ok", Required: true}
}

func (h ReadyHandler) checkMockProvider(ctx context.Context) dependencyResponse {
	baseURL := strings.TrimRight(h.MockProviderBaseURL, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/healthz", nil)
	if err != nil {
		return dependencyResponse{Status: "error", Required: true, Message: "invalid dependency url"}
	}

	client := h.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Do(req)
	if err != nil {
		return dependencyResponse{Status: "error", Required: true, Message: "connection failed"}
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return dependencyResponse{Status: "error", Required: true, Message: "health check failed"}
	}

	return dependencyResponse{Status: "ok", Required: true}
}

func tcpAddressFromURL(rawURL string, defaultPort string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}

	host := parsed.Hostname()
	if host == "" {
		return "", fmt.Errorf("missing host")
	}

	port := parsed.Port()
	if port == "" {
		port = defaultPort
	}

	return net.JoinHostPort(host, port), nil
}
