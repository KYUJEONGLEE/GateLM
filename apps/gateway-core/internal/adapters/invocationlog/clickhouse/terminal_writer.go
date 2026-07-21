package clickhouse

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

const maxErrorResponseBytes = 4096

type Config struct {
	EndpointURL                string
	Database                   string
	Table                      string
	Username                   string
	Password                   string
	EmployeeIdentityHMACSecret string
	HTTPClient                 *http.Client
}

type TerminalLogWriter struct {
	endpointURL *url.URL
	database    string
	table       string
	username    string
	password    string
	identityKey []byte
	httpClient  *http.Client
}

type analyticsRow struct {
	RequestID                string  `json:"request_id"`
	TenantID                 string  `json:"tenant_id"`
	ProjectID                string  `json:"project_id"`
	ApplicationID            string  `json:"application_id"`
	EmployeeIdentityHash     string  `json:"employee_identity_hash"`
	Provider                 string  `json:"provider"`
	Model                    string  `json:"model"`
	ProviderID               string  `json:"provider_id"`
	ModelID                  string  `json:"model_id"`
	RequestedModel           string  `json:"requested_model"`
	ModelRef                 string  `json:"model_ref"`
	RoutingReason            string  `json:"routing_reason"`
	Status                   string  `json:"status"`
	HTTPStatus               uint16  `json:"http_status"`
	PromptTokens             uint32  `json:"prompt_tokens"`
	CompletionTokens         uint32  `json:"completion_tokens"`
	TotalTokens              uint32  `json:"total_tokens"`
	CostMicroUSD             int64   `json:"cost_micro_usd"`
	SavedCostMicroUSD        *int64  `json:"saved_cost_micro_usd"`
	LatencyMs                uint64  `json:"latency_ms"`
	ProviderLatencyMs        *uint64 `json:"provider_latency_ms"`
	GatewayInternalLatencyMs uint64  `json:"gateway_internal_latency_ms"`
	TTFTMs                   *uint64 `json:"ttft_ms"`
	Stream                   uint8   `json:"stream"`
	CacheStatus              string  `json:"cache_status"`
	CacheType                string  `json:"cache_type"`
	RoutingCategory          string  `json:"routing_category"`
	RoutingDifficulty        string  `json:"routing_difficulty"`
	TerminalStatus           string  `json:"terminal_status"`
	FallbackOutcome          string  `json:"fallback_outcome"`
	SafetyOutcome            string  `json:"safety_outcome"`
	BudgetOutcome            string  `json:"budget_outcome"`
	MaskingAction            string  `json:"masking_action"`
	ProviderCalled           uint8   `json:"provider_called"`
	BudgetScopeType          string  `json:"budget_scope_type"`
	BudgetScopeID            string  `json:"budget_scope_id"`
	BudgetScopeResolvedBy    string  `json:"budget_scope_resolved_by"`
	CreatedAt                string  `json:"created_at"`
	IngestedAt               string  `json:"ingested_at"`
	IngestVersion            uint64  `json:"ingest_version"`
}

func NewTerminalLogWriter(cfg Config) (*TerminalLogWriter, error) {
	endpoint, err := url.Parse(strings.TrimSpace(cfg.EndpointURL))
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, errors.New("clickhouse terminal log writer requires a valid endpoint URL")
	}
	if endpoint.Scheme != "http" && endpoint.Scheme != "https" {
		return nil, errors.New("clickhouse terminal log writer endpoint must use http or https")
	}
	database := strings.TrimSpace(cfg.Database)
	table := strings.TrimSpace(cfg.Table)
	if !validIdentifier(database) || !validIdentifier(table) {
		return nil, errors.New("clickhouse database and table must be simple identifiers")
	}
	identityKey := []byte(cfg.EmployeeIdentityHMACSecret)
	if len(identityKey) == 0 {
		return nil, errors.New("clickhouse employee identity HMAC secret is required")
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	return &TerminalLogWriter{
		endpointURL: endpoint,
		database:    database,
		table:       table,
		username:    strings.TrimSpace(cfg.Username),
		password:    cfg.Password,
		identityKey: append([]byte(nil), identityKey...),
		httpClient:  client,
	}, nil
}

func (w *TerminalLogWriter) WriteTerminalLog(ctx context.Context, entry invocationlog.TerminalLog) error {
	return w.WriteTerminalLogs(ctx, []invocationlog.TerminalLog{entry})
}

func (w *TerminalLogWriter) WriteTerminalLogs(ctx context.Context, entries []invocationlog.TerminalLog) error {
	if w == nil || w.endpointURL == nil || w.httpClient == nil {
		return errors.New("clickhouse terminal log writer is not configured")
	}
	if len(entries) == 0 {
		return nil
	}

	ingestedAt := time.Now().UTC()
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	encoder.SetEscapeHTML(false)
	for _, entry := range entries {
		if err := encoder.Encode(w.row(entry, ingestedAt)); err != nil {
			return fmt.Errorf("encode clickhouse terminal log row: %w", err)
		}
	}

	endpoint := *w.endpointURL
	query := endpoint.Query()
	query.Set("query", fmt.Sprintf("INSERT INTO `%s`.`%s` FORMAT JSONEachRow", w.database, w.table))
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), &body)
	if err != nil {
		return fmt.Errorf("build clickhouse terminal log request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-ndjson")
	if w.username != "" {
		request.SetBasicAuth(w.username, w.password)
	}

	response, err := w.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("write clickhouse terminal logs: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	message, _ := io.ReadAll(io.LimitReader(response.Body, maxErrorResponseBytes))
	return fmt.Errorf("clickhouse terminal log write returned status %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
}

func (w *TerminalLogWriter) row(entry invocationlog.TerminalLog, ingestedAt time.Time) analyticsRow {
	createdAt := entry.CreatedAt.UTC()
	if createdAt.IsZero() {
		createdAt = entry.CompletedAt.UTC()
	}
	if createdAt.IsZero() {
		createdAt = ingestedAt
	}
	employeeIdentity := strings.TrimSpace(entry.EndUserID)
	if entry.EmployeePolicyDecision != nil && strings.TrimSpace(entry.EmployeePolicyDecision.EmployeeID) != "" {
		employeeIdentity = strings.TrimSpace(entry.EmployeePolicyDecision.EmployeeID)
	}
	domainOutcomes := entry.DomainOutcomes
	if domainOutcomes.IsZero() {
		domainOutcomes = invocationlog.BuildDomainOutcomes(entry)
	}
	terminalStatus := invocationlog.BuildGatewayStageOutcomes(entry).TerminalStatus
	budgetScope := budget.NormalizeScope(entry.BudgetScope, entry.ApplicationID)
	return analyticsRow{
		RequestID:                strings.TrimSpace(entry.RequestID),
		TenantID:                 strings.TrimSpace(entry.TenantID),
		ProjectID:                strings.TrimSpace(entry.ProjectID),
		ApplicationID:            strings.TrimSpace(entry.ApplicationID),
		EmployeeIdentityHash:     hmacIdentity(w.identityKey, employeeIdentity),
		Provider:                 strings.TrimSpace(entry.Provider),
		Model:                    strings.TrimSpace(entry.Model),
		ProviderID:               strings.TrimSpace(entry.ProviderID),
		ModelID:                  strings.TrimSpace(entry.ModelID),
		RequestedModel:           strings.TrimSpace(entry.RequestedModel),
		ModelRef:                 strings.TrimSpace(entry.ModelRef),
		RoutingReason:            strings.TrimSpace(entry.RoutingReason),
		Status:                   strings.TrimSpace(entry.Status),
		HTTPStatus:               boundedUint16(entry.HTTPStatus),
		PromptTokens:             boundedUint32(entry.PromptTokens),
		CompletionTokens:         boundedUint32(entry.CompletionTokens),
		TotalTokens:              boundedUint32(entry.TotalTokens),
		CostMicroUSD:             maxInt64(entry.CostMicroUSD, 0),
		SavedCostMicroUSD:        nullableNonNegativeInt64(entry.SavedCostMicroUSD),
		LatencyMs:                boundedUint64(entry.LatencyMs),
		ProviderLatencyMs:        nullableNonNegativeUint64(entry.ProviderLatencyMs),
		GatewayInternalLatencyMs: gatewayInternalLatency(entry.LatencyMs, entry.ProviderLatencyMs),
		TTFTMs:                   nullableNonNegativeUint64(entry.TTFTMs),
		Stream:                   boolUint8(entry.Stream),
		CacheStatus:              strings.TrimSpace(entry.CacheStatus),
		CacheType:                strings.TrimSpace(entry.CacheType),
		RoutingCategory:          strings.TrimSpace(entry.PromptCategory),
		RoutingDifficulty:        strings.TrimSpace(entry.PromptDifficulty),
		TerminalStatus:           strings.TrimSpace(terminalStatus),
		FallbackOutcome:          strings.TrimSpace(domainOutcomes.Fallback.Outcome),
		SafetyOutcome:            strings.TrimSpace(domainOutcomes.Safety.Outcome),
		BudgetOutcome:            strings.TrimSpace(domainOutcomes.Budget.Outcome),
		MaskingAction:            firstNonEmpty(strings.TrimSpace(entry.MaskingAction), strings.TrimSpace(domainOutcomes.Safety.MaskingAction), "none"),
		ProviderCalled:           boolUint8(entry.ProviderCalled),
		BudgetScopeType:          budgetScope.Type,
		BudgetScopeID:            budgetScope.ID,
		BudgetScopeResolvedBy:    budgetScope.ResolvedBy,
		CreatedAt:                formatDateTime64(createdAt),
		IngestedAt:               formatDateTime64(ingestedAt),
		IngestVersion:            uint64(ingestedAt.UnixNano()),
	}
}

func nullableNonNegativeUint64(value *int64) *uint64 {
	if value == nil || *value < 0 {
		return nil
	}
	bounded := uint64(*value)
	return &bounded
}

func gatewayInternalLatency(total int64, provider *int64) uint64 {
	if total <= 0 {
		return 0
	}
	if provider == nil || *provider <= 0 {
		return uint64(total)
	}
	if *provider >= total {
		return 0
	}
	return uint64(total - *provider)
}

func nullableNonNegativeInt64(value int64) *int64 {
	if value < 0 {
		return nil
	}
	return &value
}

func boolUint8(value bool) uint8 {
	if value {
		return 1
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return ""
}

func hmacIdentity(key []byte, value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return ""
	}
	digest := hmac.New(sha256.New, key)
	_, _ = digest.Write([]byte(normalized))
	return hex.EncodeToString(digest.Sum(nil))
}

func formatDateTime64(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05.000")
}

func validIdentifier(value string) bool {
	if value == "" {
		return false
	}
	for index, character := range value {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character == '_') ||
			(index > 0 && character >= '0' && character <= '9') {
			continue
		}
		return false
	}
	return true
}

func boundedUint16(value int) uint16 {
	if value <= 0 {
		return 0
	}
	if value > int(^uint16(0)) {
		return ^uint16(0)
	}
	return uint16(value)
}

func boundedUint32(value int) uint32 {
	if value <= 0 {
		return 0
	}
	if uint64(value) > uint64(^uint32(0)) {
		return ^uint32(0)
	}
	return uint32(value)
}

func boundedUint64(value int64) uint64 {
	if value <= 0 {
		return 0
	}
	return uint64(value)
}

func maxInt64(value int64, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}
