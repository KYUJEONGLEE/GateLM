package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	"github.com/jackc/pgx/v5/pgconn"
)

type Execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type AuthFailureDefaults struct {
	TenantID      string
	ProjectID     string
	ApplicationID string
}

type AuthFailureWriter struct {
	db       Execer
	defaults AuthFailureDefaults
}

func NewAuthFailureWriter(db Execer, defaults AuthFailureDefaults) *AuthFailureWriter {
	return &AuthFailureWriter{
		db:       db,
		defaults: defaults,
	}
}

func (w *AuthFailureWriter) WriteAuthFailureLog(ctx context.Context, log invocationlog.AuthFailureLog) error {
	if w == nil || w.db == nil {
		return errors.New("auth failure writer requires a database executor")
	}
	if !invocationlog.IsAuthFailure(log.HTTPStatus, log.ErrorCode) {
		return nil
	}

	record, err := w.record(log)
	if err != nil {
		return err
	}

	_, err = w.db.Exec(ctx, insertAuthFailureLogSQL,
		record.ID,
		record.RequestID,
		record.TraceID,
		record.TenantID,
		record.ProjectID,
		nullableUUID(record.ApplicationID),
		nullableUUID(record.APIKeyID),
		nullableUUID(record.AppTokenID),
		nullableText(record.EndUserID),
		nullableText(record.FeatureID),
		record.Endpoint,
		record.Method,
		record.Source,
		record.Stream,
		nullableText(record.RequestedModel),
		record.PromptTokens,
		record.CompletionTokens,
		record.TotalTokens,
		record.CostMicroUSD,
		record.LatencyMs,
		nullableInt64(record.ProviderLatencyMs),
		record.Status,
		record.HTTPStatus,
		nullableText(record.ErrorCode),
		nullableText(record.ErrorMessage),
		nullableText(record.ErrorStage),
		record.CacheStatus,
		record.CacheType,
		record.MaskingAction,
		record.MaskingDetectedTypesJSON,
		record.MaskingDetectedCount,
		record.RequestBodyHash,
		record.PromptHash,
		record.MetadataJSON,
		record.CreatedAt,
		record.CompletedAt,
	)
	return err
}

type authFailureRecord struct {
	ID                       string
	RequestID                string
	TraceID                  string
	TenantID                 string
	ProjectID                string
	ApplicationID            string
	APIKeyID                 string
	AppTokenID               string
	EndUserID                string
	FeatureID                string
	Endpoint                 string
	Method                   string
	Source                   string
	Stream                   bool
	RequestedModel           string
	PromptTokens             int
	CompletionTokens         int
	TotalTokens              int
	CostMicroUSD             int64
	LatencyMs                int64
	ProviderLatencyMs        *int64
	Status                   string
	HTTPStatus               int
	ErrorCode                string
	ErrorMessage             string
	ErrorStage               string
	CacheStatus              string
	CacheType                string
	MaskingAction            string
	MaskingDetectedTypesJSON []byte
	MaskingDetectedCount     int
	RequestBodyHash          string
	PromptHash               string
	MetadataJSON             []byte
	CreatedAt                time.Time
	CompletedAt              time.Time
}

func (w *AuthFailureWriter) record(log invocationlog.AuthFailureLog) (authFailureRecord, error) {
	requestID := strings.TrimSpace(log.RequestID)
	if requestID == "" {
		return authFailureRecord{}, errors.New("auth failure log requires request id")
	}

	tenantID := firstValidUUID(log.TenantID, w.defaults.TenantID)
	projectID := firstValidUUID(log.ProjectID, w.defaults.ProjectID)
	if tenantID == "" || projectID == "" {
		return authFailureRecord{}, errors.New("auth failure log requires valid tenant and project UUIDs")
	}

	id, err := newUUID()
	if err != nil {
		return authFailureRecord{}, err
	}
	applicationID := firstValidUUID(log.ApplicationID, w.defaults.ApplicationID)
	resolvedBudgetScope := budget.NormalizeScope(log.BudgetScope, applicationID)
	domainOutcomes := log.DomainOutcomes
	if domainOutcomes.IsZero() {
		log.DomainOutcomes = invocationlog.BuildAuthFailureDomainOutcomes(log)
		domainOutcomes = log.DomainOutcomes
	}
	metadataJSON, err := json.Marshal(map[string]any{
		"schemaVersion":        1,
		"budgetScope":          budget.ToMetadata(resolvedBudgetScope, applicationID),
		"terminalStatus":       invocationlog.StatusBlocked,
		"domainOutcomes":       domainOutcomes,
		"gatewayStageOutcomes": invocationlog.BuildAuthFailureGatewayStageOutcomes(log),
	})
	if err != nil {
		return authFailureRecord{}, err
	}

	return authFailureRecord{
		ID:                       id,
		RequestID:                requestID,
		TraceID:                  firstNonEmpty(log.TraceID, requestID),
		TenantID:                 tenantID,
		ProjectID:                projectID,
		ApplicationID:            applicationID,
		APIKeyID:                 strings.TrimSpace(log.APIKeyID),
		AppTokenID:               strings.TrimSpace(log.AppTokenID),
		EndUserID:                strings.TrimSpace(log.EndUserID),
		FeatureID:                strings.TrimSpace(log.FeatureID),
		Endpoint:                 firstNonEmpty(log.Endpoint, "/v1/chat/completions"),
		Method:                   firstNonEmpty(log.Method, "POST"),
		Source:                   firstNonEmpty(log.Source, invocationlog.SourceCustomerApp),
		Stream:                   log.Stream,
		RequestedModel:           strings.TrimSpace(log.RequestedModel),
		PromptTokens:             0,
		CompletionTokens:         0,
		TotalTokens:              0,
		CostMicroUSD:             0,
		LatencyMs:                log.LatencyMs,
		ProviderLatencyMs:        log.ProviderLatencyMs,
		Status:                   invocationlog.StatusBlocked,
		HTTPStatus:               log.HTTPStatus,
		ErrorCode:                strings.TrimSpace(log.ErrorCode),
		ErrorMessage:             strings.TrimSpace(log.ErrorMessage),
		ErrorStage:               firstNonEmpty(log.ErrorStage, invocationlog.AuthFailureStage(log.ErrorCode)),
		CacheStatus:              invocationlog.CacheStatusBypass,
		CacheType:                invocationlog.CacheTypeNone,
		MaskingAction:            "none",
		MaskingDetectedTypesJSON: []byte("[]"),
		MaskingDetectedCount:     0,
		RequestBodyHash:          syntheticHash("auth_failure_request_body", requestID, log.ErrorCode),
		PromptHash:               syntheticHash("auth_failure_prompt", requestID, log.ErrorCode),
		MetadataJSON:             metadataJSON,
		CreatedAt:                log.CreatedAt,
		CompletedAt:              log.CompletedAt,
	}, nil
}

const insertAuthFailureLogSQL = `
insert into p0_llm_invocation_logs (
  id,
  request_id,
  trace_id,
  tenant_id,
  project_id,
  application_id,
  api_key_id,
  app_token_id,
  end_user_id,
  feature_id,
  endpoint,
  method,
  source,
  stream,
  requested_model,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  latency_ms,
  provider_latency_ms,
  status,
  http_status,
  error_code,
  error_message,
  error_stage,
  cache_status,
  cache_type,
  masking_action,
  masking_detected_types,
  masking_detected_count,
  request_body_hash,
  prompt_hash,
  metadata,
  created_at,
  completed_at
) values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
  $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
  $31, $32, $33, $34, $35, $36
)
on conflict do nothing`

func nullableText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nullableUUID(value string) any {
	value = strings.TrimSpace(value)
	if !isValidUUID(value) {
		return nil
	}
	return value
}

func nullableInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func isValidUUID(u string) bool {
	if len(u) != 36 {
		return false
	}
	for i, r := range u {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if r != '-' {
				return false
			}
		} else {
			if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
				return false
			}
		}
	}
	return true
}

func firstValidUUID(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if isValidUUID(trimmed) {
			return trimmed
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func syntheticHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate auth failure log id: %w", err)
	}

	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	), nil
}
