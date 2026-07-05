package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type TerminalLogDefaults struct {
	TenantID      string
	ProjectID     string
	ApplicationID string
}

type TerminalLogWriter struct {
	db       Execer
	defaults TerminalLogDefaults
}

func NewTerminalLogWriter(db Execer, defaults TerminalLogDefaults) *TerminalLogWriter {
	return &TerminalLogWriter{
		db:       db,
		defaults: defaults,
	}
}

func (w *TerminalLogWriter) WriteTerminalLog(ctx context.Context, log invocationlog.TerminalLog) error {
	if w == nil || w.db == nil {
		return errors.New("terminal log writer requires a database executor")
	}

	record, err := w.record(log)
	if err != nil {
		return err
	}

	_, err = w.db.Exec(ctx, insertTerminalLogSQL,
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
		nullableText(record.RequestedProvider),
		nullableText(record.RequestedModel),
		record.Provider,
		record.Model,
		nullableText(record.SelectedProvider),
		nullableText(record.SelectedModel),
		nullableText(record.RoutingReason),
		record.PromptTokens,
		record.CompletionTokens,
		record.TotalTokens,
		record.CostMicroUSD,
		record.SavedCostMicroUSD,
		record.LatencyMs,
		nullableInt64(record.ProviderLatencyMs),
		record.Status,
		record.HTTPStatus,
		nullableText(record.ErrorCode),
		nullableText(record.ErrorMessage),
		nullableText(record.ErrorStage),
		record.CacheStatus,
		record.CacheType,
		nullableText(record.CacheKeyHash),
		nullableText(record.CacheHitRequestID),
		record.MaskingAction,
		record.MaskingDetectedTypesJSON,
		record.MaskingDetectedCount,
		record.RequestBodyHash,
		record.PromptHash,
		nullableText(record.RedactedPromptPreview),
		record.MetadataJSON,
		record.CreatedAt,
		record.CompletedAt,
	)
	if err != nil {
		return err
	}
	if err := w.writeBudgetNotificationEvents(ctx, record, log.BudgetDecision); err != nil {
		return err
	}
	if record.CostMicroUSD <= 0 {
		return nil
	}

	completedAt := record.CompletedAt
	if completedAt.IsZero() {
		completedAt = record.CreatedAt
	}
	completedAt = completedAt.UTC()
	monthStart := time.Date(completedAt.Year(), completedAt.Month(), 1, 0, 0, 0, 0, time.UTC)
	_, err = w.db.Exec(ctx, upsertBudgetLedgerEntrySQL,
		record.RequestID,
		record.TenantID,
		record.ProjectID,
		nullableUUID(record.ApplicationID),
		record.BudgetScope.Type,
		record.BudgetScope.ID,
		monthStart,
		record.CostMicroUSD,
		record.CreatedAt,
		completedAt,
	)
	return err
}

type terminalLogRecord struct {
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
	RequestedProvider        string
	RequestedModel           string
	Provider                 string
	Model                    string
	SelectedProvider         string
	SelectedModel            string
	RoutingReason            string
	PromptTokens             int
	CompletionTokens         int
	TotalTokens              int
	CostMicroUSD             int64
	SavedCostMicroUSD        int64
	LatencyMs                int64
	ProviderLatencyMs        *int64
	Status                   string
	HTTPStatus               int
	ErrorCode                string
	ErrorMessage             string
	ErrorStage               string
	CacheStatus              string
	CacheType                string
	CacheKeyHash             string
	CacheHitRequestID        string
	MaskingAction            string
	MaskingDetectedTypesJSON []byte
	MaskingDetectedCount     int
	RequestBodyHash          string
	PromptHash               string
	RedactedPromptPreview    string
	BudgetScope              budget.Scope
	MetadataJSON             []byte
	CreatedAt                time.Time
	CompletedAt              time.Time
}

func (w *TerminalLogWriter) record(log invocationlog.TerminalLog) (terminalLogRecord, error) {
	requestID := strings.TrimSpace(log.RequestID)
	if requestID == "" {
		return terminalLogRecord{}, errors.New("terminal log requires request id")
	}

	tenantID := firstValidUUID(log.TenantID, w.defaults.TenantID)
	projectID := firstValidUUID(log.ProjectID, w.defaults.ProjectID)
	if tenantID == "" || projectID == "" {
		return terminalLogRecord{}, errors.New("terminal log requires valid tenant and project UUIDs")
	}
	applicationID := firstValidUUID(log.ApplicationID, w.defaults.ApplicationID)
	resolvedBudgetScope := budget.NormalizeScope(log.BudgetScope, applicationID)

	id, err := newUUID()
	if err != nil {
		return terminalLogRecord{}, err
	}
	maskingDetectedTypesJSON, err := json.Marshal(log.MaskingDetectedTypes)
	if err != nil {
		return terminalLogRecord{}, err
	}
	metadata := log.Metadata
	if metadata == nil {
		metadata = map[string]any{"schemaVersion": 1}
	}
	if _, exists := metadata["budgetScope"]; !exists {
		metadata["budgetScope"] = budget.ToMetadata(resolvedBudgetScope, applicationID)
	}
	if _, exists := metadata["terminalStatus"]; !exists {
		metadata["terminalStatus"] = log.Status
	}
	if _, exists := metadata["domainOutcomes"]; !exists {
		if log.DomainOutcomes.IsZero() {
			log.DomainOutcomes = invocationlog.BuildDomainOutcomes(log)
		}
		metadata["domainOutcomes"] = log.DomainOutcomes
	}
	if _, exists := metadata["gatewayStageOutcomes"]; !exists {
		metadata["gatewayStageOutcomes"] = invocationlog.BuildGatewayStageOutcomes(log)
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return terminalLogRecord{}, err
	}

	return terminalLogRecord{
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
		RequestedProvider:        strings.TrimSpace(log.RequestedProvider),
		RequestedModel:           strings.TrimSpace(log.RequestedModel),
		Provider:                 strings.TrimSpace(log.Provider),
		Model:                    strings.TrimSpace(log.Model),
		SelectedProvider:         strings.TrimSpace(log.SelectedProvider),
		SelectedModel:            strings.TrimSpace(log.SelectedModel),
		RoutingReason:            strings.TrimSpace(log.RoutingReason),
		PromptTokens:             log.PromptTokens,
		CompletionTokens:         log.CompletionTokens,
		TotalTokens:              log.TotalTokens,
		CostMicroUSD:             log.CostMicroUSD,
		SavedCostMicroUSD:        log.SavedCostMicroUSD,
		LatencyMs:                log.LatencyMs,
		ProviderLatencyMs:        log.ProviderLatencyMs,
		Status:                   firstNonEmpty(log.Status, invocationlog.StatusFailed),
		HTTPStatus:               log.HTTPStatus,
		ErrorCode:                strings.TrimSpace(log.ErrorCode),
		ErrorMessage:             strings.TrimSpace(log.ErrorMessage),
		ErrorStage:               strings.TrimSpace(log.ErrorStage),
		CacheStatus:              firstNonEmpty(log.CacheStatus, invocationlog.CacheStatusBypass),
		CacheType:                firstNonEmpty(log.CacheType, invocationlog.CacheTypeNone),
		CacheKeyHash:             strings.TrimSpace(log.CacheKeyHash),
		CacheHitRequestID:        strings.TrimSpace(log.CacheHitRequestID),
		MaskingAction:            firstNonEmpty(log.MaskingAction, "none"),
		MaskingDetectedTypesJSON: maskingDetectedTypesJSON,
		MaskingDetectedCount:     log.MaskingDetectedCount,
		RequestBodyHash:          strings.TrimSpace(log.RequestBodyHash),
		PromptHash:               strings.TrimSpace(log.PromptHash),
		RedactedPromptPreview:    strings.TrimSpace(log.RedactedPromptPreview),
		BudgetScope:              resolvedBudgetScope,
		MetadataJSON:             metadataJSON,
		CreatedAt:                log.CreatedAt,
		CompletedAt:              log.CompletedAt,
	}, nil
}

type budgetNotificationRecipient struct {
	ScopeType string
	ScopeID   string
	Role      string
}

func (w *TerminalLogWriter) writeBudgetNotificationEvents(ctx context.Context, record terminalLogRecord, decision *budget.Decision) error {
	if decision == nil {
		return nil
	}
	severity, eventType, ok := budgetNotificationSeverity(decision.Outcome)
	if !ok {
		return nil
	}
	scope := budget.NormalizeScope(decision.Scope, record.ApplicationID)
	if strings.TrimSpace(scope.Type) == "" || strings.TrimSpace(scope.ID) == "" {
		scope = budget.NormalizeScope(record.BudgetScope, record.ApplicationID)
	}
	if strings.TrimSpace(scope.Type) == "" || strings.TrimSpace(scope.ID) == "" {
		return nil
	}

	completedAt := record.CompletedAt
	if completedAt.IsZero() {
		completedAt = record.CreatedAt
	}
	completedAt = completedAt.UTC()
	monthStart := time.Date(completedAt.Year(), completedAt.Month(), 1, 0, 0, 0, 0, time.UTC)
	recipients := budgetNotificationRecipients(record, scope.Type)
	if len(recipients) == 0 {
		return nil
	}

	metadata, err := json.Marshal(map[string]any{
		"reason":              strings.TrimSpace(decision.Reason),
		"budgetScope":         budget.ToMetadata(scope, record.ApplicationID),
		"source":              "gateway_budget_check",
		"warningThresholdPct": decision.WarningThresholdPercent,
	})
	if err != nil {
		return err
	}

	for _, recipient := range recipients {
		eventKey := budgetNotificationEventKey(record.TenantID, scope, monthStart, severity, recipient)
		_, err := w.db.Exec(ctx, upsertNotificationEventSQL,
			record.TenantID,
			nullableUUID(record.ProjectID),
			budgetNotificationApplicationID(record, scope.Type),
			scope.Type,
			scope.ID,
			eventType,
			severity,
			recipient.ScopeType,
			recipient.ScopeID,
			recipient.Role,
			eventKey,
			nullableNonNegativeInt64(decision.LimitMicroUSD),
			nullableNonNegativeInt64(decision.UsedMicroUSD),
			decision.RemainingMicroUSD,
			decision.UsagePercent,
			nullableText(record.RequestID),
			monthStart,
			metadata,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func budgetNotificationSeverity(outcome string) (string, string, bool) {
	switch strings.TrimSpace(outcome) {
	case budget.OutcomeWarned:
		return "warning", "budget_warning", true
	case budget.OutcomeDegraded, budget.OutcomeBlocked:
		return "exceeded", "budget_exceeded", true
	default:
		return "", "", false
	}
}

func budgetNotificationRecipients(record terminalLogRecord, scopeType string) []budgetNotificationRecipient {
	switch strings.TrimSpace(scopeType) {
	case budget.ScopeTypeApplication:
		if strings.TrimSpace(record.ProjectID) == "" {
			return nil
		}
		return []budgetNotificationRecipient{{ScopeType: "project", ScopeID: record.ProjectID, Role: "project_admin"}}
	case budget.ScopeTypeProject:
		recipients := []budgetNotificationRecipient{{ScopeType: "tenant", ScopeID: record.TenantID, Role: "tenant_admin"}}
		if strings.TrimSpace(record.ProjectID) != "" {
			recipients = append(recipients, budgetNotificationRecipient{ScopeType: "project", ScopeID: record.ProjectID, Role: "project_admin"})
		}
		return recipients
	default:
		return nil
	}
}

func budgetNotificationApplicationID(record terminalLogRecord, scopeType string) any {
	if strings.TrimSpace(scopeType) != budget.ScopeTypeApplication {
		return nil
	}
	return nullableUUID(record.ApplicationID)
}

func budgetNotificationEventKey(tenantID string, scope budget.Scope, monthStart time.Time, severity string, recipient budgetNotificationRecipient) string {
	return fmt.Sprintf(
		"budget:%s:%s:%s:%s:%s:%s:%s",
		strings.TrimSpace(tenantID),
		strings.TrimSpace(scope.Type),
		strings.TrimSpace(scope.ID),
		monthStart.Format("2006-01"),
		strings.TrimSpace(severity),
		strings.TrimSpace(recipient.Role),
		strings.TrimSpace(recipient.ScopeID),
	)
}

func nullableNonNegativeInt64(value int64) any {
	if value < 0 {
		return nil
	}
	return value
}

const insertTerminalLogSQL = `
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
  requested_provider,
  requested_model,
  provider,
  model,
  selected_provider,
  selected_model,
  routing_reason,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  saved_cost_micro_usd,
  latency_ms,
  provider_latency_ms,
  status,
  http_status,
  error_code,
  error_message,
  error_stage,
  cache_status,
  cache_type,
  cache_key_hash,
  cache_hit_request_id,
  masking_action,
  masking_detected_types,
  masking_detected_count,
  request_body_hash,
  prompt_hash,
  redacted_prompt_preview,
  metadata,
  created_at,
  completed_at
) values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
  $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
  $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
  $41, $42, $43, $44, $45, $46
)
on conflict (request_id) do nothing`

const upsertNotificationEventSQL = `
insert into notification_events (
  tenant_id,
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  event_type,
  severity,
  recipient_scope_type,
  recipient_scope_id,
  recipient_role,
  event_key,
  limit_micro_usd,
  used_micro_usd,
  remaining_micro_usd,
  usage_percent,
  source_request_id,
  month_start,
  metadata,
  created_at,
  updated_at
) values (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4,
  $5,
  $6,
  $7,
  $8,
  $9,
  $10,
  $11,
  $12,
  $13,
  $14,
  $15,
  $16,
  $17::date,
  $18::jsonb,
  now(),
  now()
)
on conflict (event_key)
do update set
  limit_micro_usd = excluded.limit_micro_usd,
  used_micro_usd = excluded.used_micro_usd,
  remaining_micro_usd = excluded.remaining_micro_usd,
  usage_percent = excluded.usage_percent,
  source_request_id = excluded.source_request_id,
  metadata = notification_events.metadata || excluded.metadata,
  updated_at = now()`
const upsertBudgetLedgerEntrySQL = `
insert into budget_ledger_entries (
  request_id,
  tenant_id,
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  month_start,
  cost_micro_usd,
  source,
  created_at,
  completed_at,
  updated_at
) values (
  $1,
  $2::uuid,
  $3::uuid,
  $4::uuid,
  $5,
  $6,
  $7::date,
  $8,
  'request_log',
  $9,
  $10,
  now()
)
on conflict (request_id)
do update set
  tenant_id = excluded.tenant_id,
  project_id = excluded.project_id,
  application_id = excluded.application_id,
  budget_scope_type = excluded.budget_scope_type,
  budget_scope_id = excluded.budget_scope_id,
  month_start = excluded.month_start,
  cost_micro_usd = excluded.cost_micro_usd,
  source = excluded.source,
  completed_at = excluded.completed_at,
  updated_at = now()`
