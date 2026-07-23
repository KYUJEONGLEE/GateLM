package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

const maxQueryResponseBytes = 8 * 1024 * 1024

type QueryConfig struct {
	EndpointURL     string
	Database        string
	Table           string
	Username        string
	Password        string
	Timeout         time.Duration
	HTTPClient      *http.Client
	MetricsRegistry *metrics.Registry
}

type queryClient struct {
	endpointURL     *url.URL
	database        string
	table           string
	username        string
	password        string
	timeout         time.Duration
	httpClient      *http.Client
	metricsRegistry *metrics.Registry
}

func (c *queryClient) timeTable() string {
	return c.table + "_by_time"
}

func (c *queryClient) dashboardRollupTable() string {
	return c.table + "_dashboard_second_rollup"
}

func newQueryClient(cfg QueryConfig) (*queryClient, error) {
	endpoint, err := url.Parse(strings.TrimSpace(cfg.EndpointURL))
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, errors.New("clickhouse analytics reader requires a valid endpoint URL")
	}
	if endpoint.Scheme != "http" && endpoint.Scheme != "https" {
		return nil, errors.New("clickhouse analytics reader endpoint must use http or https")
	}
	if endpoint.User != nil {
		return nil, errors.New("clickhouse analytics reader endpoint must not contain credentials")
	}
	if !validIdentifier(strings.TrimSpace(cfg.Database)) || !validIdentifier(strings.TrimSpace(cfg.Table)) {
		return nil, errors.New("clickhouse analytics reader database and table must be simple identifiers")
	}
	if cfg.Timeout <= 0 {
		return nil, errors.New("clickhouse analytics reader timeout must be positive")
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	return &queryClient{
		endpointURL:     endpoint,
		database:        strings.TrimSpace(cfg.Database),
		table:           strings.TrimSpace(cfg.Table),
		username:        strings.TrimSpace(cfg.Username),
		password:        cfg.Password,
		timeout:         cfg.Timeout,
		httpClient:      client,
		metricsRegistry: cfg.MetricsRegistry,
	}, nil
}

func queryJSONEachRow[T any](ctx context.Context, client *queryClient, statement string, parameters map[string]string) ([]T, error) {
	if client == nil || client.endpointURL == nil || client.httpClient == nil {
		return nil, unavailableError(errors.New("clickhouse analytics reader is not configured"))
	}

	queryCtx, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()

	endpoint := *client.endpointURL
	query := endpoint.Query()
	query.Set("database", client.database)
	query.Set("output_format_json_quote_64bit_integers", "0")
	for name, value := range parameters {
		query.Set("param_"+name, value)
	}
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(queryCtx, http.MethodPost, endpoint.String(), strings.NewReader(statement))
	if err != nil {
		return nil, unavailableError(err)
	}
	request.Header.Set("Content-Type", "text/plain; charset=utf-8")
	if client.username != "" {
		request.SetBasicAuth(client.username, client.password)
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, unavailableError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(response.Body, maxErrorResponseBytes))
		return nil, unavailableError(fmt.Errorf("clickhouse query returned status %d: %s", response.StatusCode, strings.TrimSpace(string(message))))
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxQueryResponseBytes+1))
	if err != nil {
		return nil, unavailableError(err)
	}
	if len(body) > maxQueryResponseBytes {
		return nil, unavailableError(errors.New("clickhouse query response exceeded the bounded limit"))
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	items := []T{}
	for decoder.More() {
		var item T
		if err := decoder.Decode(&item); err != nil {
			return nil, unavailableError(err)
		}
		items = append(items, item)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		if err == nil {
			return nil, unavailableError(errors.New("clickhouse query response contained an unexpected trailing value"))
		}
		return nil, unavailableError(err)
	}
	return items, nil
}

func unavailableError(err error) error {
	return fmt.Errorf("%w: %w", invocationlog.ErrAnalyticsDataUnavailable, err)
}
