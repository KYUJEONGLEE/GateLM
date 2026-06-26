package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	"github.com/jackc/pgx/v5"
)

type Queryer interface {
	Query(ctx context.Context, sql string, arguments ...any) (Rows, error)
	QueryRow(ctx context.Context, sql string, arguments ...any) Row
}

type Rows interface {
	Close()
	Err() error
	Next() bool
	Scan(dest ...any) error
}

type Row interface {
	Scan(dest ...any) error
}

type QueryReader struct {
	db Queryer
}

func NewQueryReader(db Queryer) *QueryReader {
	return &QueryReader{db: db}
}

func (r *QueryReader) ListProjectLogs(ctx context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("query reader requires a database queryer")
	}

	normalizedFilter, err := invocationlog.NormalizeProjectLogsFilter(filter)
	if err != nil {
		return nil, err
	}
	query, args := buildProjectLogsQuery(normalizedFilter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]invocationlog.RequestLogListItem, 0, normalizedFilter.Limit)
	for rows.Next() {
		log, err := scanProjectLogListRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, invocationlog.ToRequestLogListItem(log))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}

func (r *QueryReader) GetRequestDetail(ctx context.Context, filter invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error) {
	if r == nil || r.db == nil {
		return invocationlog.RequestDetail{}, errors.New("query reader requires a database queryer")
	}

	normalizedFilter, err := invocationlog.NormalizeRequestDetailFilter(filter)
	if err != nil {
		return invocationlog.RequestDetail{}, err
	}

	log, err := scanRequestDetailRow(r.db.QueryRow(ctx, requestDetailSQL, normalizedFilter.TenantID, normalizedFilter.ProjectID, normalizedFilter.RequestID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			return invocationlog.RequestDetail{}, invocationlog.ErrLogNotFound
		}
		return invocationlog.RequestDetail{}, err
	}

	return invocationlog.ToRequestDetail(log), nil
}

func (r *QueryReader) GetDashboardOverview(ctx context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error) {
	if r == nil || r.db == nil {
		return invocationlog.DashboardOverviewFields{}, errors.New("query reader requires a database queryer")
	}

	normalizedFilter, err := invocationlog.NormalizeDashboardOverviewFilter(filter)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	query, args := buildDashboardOverviewQuery(normalizedFilter)

	var totalRequests int64
	var successfulRequests int64
	var blockedRequests int64
	var cacheHitRequests int64
	var totalTokens int64
	var totalCostMicroUSD int64
	var averageResponseTimeMs sql.NullFloat64
	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&totalRequests,
		&successfulRequests,
		&blockedRequests,
		&cacheHitRequests,
		&totalTokens,
		&totalCostMicroUSD,
		&averageResponseTimeMs,
	); err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}

	var averageLatency *float64
	if averageResponseTimeMs.Valid {
		averageLatency = &averageResponseTimeMs.Float64
	}

	return invocationlog.BuildDashboardOverviewFromAggregate(
		totalRequests,
		successfulRequests,
		blockedRequests,
		cacheHitRequests,
		totalTokens,
		totalCostMicroUSD,
		averageLatency,
	), nil
}

func buildProjectLogsQuery(filter invocationlog.ProjectLogsFilter) (string, []any) {
	args := []any{filter.TenantID, filter.ProjectID, filter.From.UTC(), filter.To.UTC()}
	where := []string{
		"tenant_id = $1",
		"project_id = $2",
		"created_at >= $3",
		"created_at < $4",
	}
	addOptionalWhere := func(column string, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		args = append(args, value)
		where = append(where, fmt.Sprintf("%s = $%d", column, len(args)))
	}

	addOptionalWhere("status", filter.Status)
	addOptionalWhere("provider", filter.Provider)
	addOptionalWhere("model", filter.Model)
	addOptionalWhere("cache_status", filter.CacheStatus)
	addOptionalWhere("application_id", filter.ApplicationID)
	addOptionalWhere("request_id", filter.RequestID)

	args = append(args, filter.Limit)
	limitPlaceholder := len(args)

	query := fmt.Sprintf(`
select
  request_id,
  project_id::text,
  application_id::text,
  provider,
  model,
  requested_model,
  selected_model,
  status,
  http_status,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  latency_ms,
  cache_status,
  cache_type,
  routing_reason,
  masking_action,
  created_at
from p0_llm_invocation_logs
where %s
order by created_at desc, request_id desc
limit $%d`, strings.Join(where, " and "), limitPlaceholder)

	return query, args
}

func buildDashboardOverviewQuery(filter invocationlog.DashboardOverviewFilter) (string, []any) {
	args := []any{filter.From.UTC(), filter.To.UTC()}
	where := []string{
		"created_at >= $1",
		"created_at < $2",
	}
	if filter.TenantID != "" {
		args = append(args, filter.TenantID)
		where = append(where, fmt.Sprintf("tenant_id = $%d", len(args)))
	}
	if filter.ProjectID != "" {
		args = append(args, filter.ProjectID)
		where = append(where, fmt.Sprintf("project_id = $%d", len(args)))
	}

	query := fmt.Sprintf(`
select
  count(*)::bigint as total_requests,
  count(*) filter (where status in ('success', 'cache_hit'))::bigint as successful_requests,
  count(*) filter (where status = 'blocked')::bigint as blocked_requests,
  count(*) filter (where status = 'cache_hit' or cache_status = 'hit')::bigint as cache_hit_requests,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as total_cost_micro_usd,
  avg(latency_ms)::float8 as average_response_time_ms
from p0_llm_invocation_logs
where %s`, strings.Join(where, " and "))

	return query, args
}

const requestDetailSQL = `
select
  request_id,
  trace_id,
  tenant_id::text,
  project_id::text,
  application_id::text,
  status,
  http_status,
  provider,
  model,
  requested_model,
  selected_provider,
  selected_model,
  routing_reason,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  latency_ms,
  provider_latency_ms,
  cache_status,
  cache_type,
  cache_key_hash,
  cache_hit_request_id,
  masking_action,
  masking_detected_types,
  masking_detected_count,
  redacted_prompt_preview,
  error_code,
  error_message,
  error_stage,
  created_at,
  completed_at
from p0_llm_invocation_logs
where tenant_id = $1
  and project_id = $2
  and request_id = $3
limit 1`

func scanProjectLogListRow(rows Rows) (invocationlog.LlmInvocationLog, error) {
	var log invocationlog.LlmInvocationLog
	var applicationID sql.NullString
	var requestedModel sql.NullString
	var selectedModel sql.NullString
	var routingReason sql.NullString
	if err := rows.Scan(
		&log.RequestID,
		&log.ProjectID,
		&applicationID,
		&log.Provider,
		&log.Model,
		&requestedModel,
		&selectedModel,
		&log.Status,
		&log.HTTPStatus,
		&log.PromptTokens,
		&log.CompletionTokens,
		&log.TotalTokens,
		&log.CostMicroUSD,
		&log.LatencyMs,
		&log.CacheStatus,
		&log.CacheType,
		&routingReason,
		&log.MaskingAction,
		&log.CreatedAt,
	); err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}

	log.ApplicationID = nullableString(applicationID)
	log.RequestedModel = nullableString(requestedModel)
	log.SelectedModel = nullableString(selectedModel)
	log.RoutingReason = nullableString(routingReason)
	return log, nil
}

func scanRequestDetailRow(row Row) (invocationlog.LlmInvocationLog, error) {
	var log invocationlog.LlmInvocationLog
	var applicationID sql.NullString
	var requestedModel sql.NullString
	var selectedProvider sql.NullString
	var selectedModel sql.NullString
	var routingReason sql.NullString
	var providerLatencyMs sql.NullInt64
	var cacheKeyHash sql.NullString
	var cacheHitRequestID sql.NullString
	var maskingDetectedTypes []byte
	var redactedPromptPreview sql.NullString
	var errorCode sql.NullString
	var errorMessage sql.NullString
	var errorStage sql.NullString
	var completedAt sql.NullTime

	if err := row.Scan(
		&log.RequestID,
		&log.TraceID,
		&log.TenantID,
		&log.ProjectID,
		&applicationID,
		&log.Status,
		&log.HTTPStatus,
		&log.Provider,
		&log.Model,
		&requestedModel,
		&selectedProvider,
		&selectedModel,
		&routingReason,
		&log.PromptTokens,
		&log.CompletionTokens,
		&log.TotalTokens,
		&log.CostMicroUSD,
		&log.LatencyMs,
		&providerLatencyMs,
		&log.CacheStatus,
		&log.CacheType,
		&cacheKeyHash,
		&cacheHitRequestID,
		&log.MaskingAction,
		&maskingDetectedTypes,
		&log.MaskingDetectedCount,
		&redactedPromptPreview,
		&errorCode,
		&errorMessage,
		&errorStage,
		&log.CreatedAt,
		&completedAt,
	); err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}

	detectedTypes, err := decodeStringArrayJSON(maskingDetectedTypes)
	if err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}

	log.ApplicationID = nullableString(applicationID)
	log.RequestedModel = nullableString(requestedModel)
	log.SelectedProvider = nullableString(selectedProvider)
	log.SelectedModel = nullableString(selectedModel)
	log.RoutingReason = nullableString(routingReason)
	log.ProviderLatencyMs = nullableInt64Pointer(providerLatencyMs)
	log.CacheKeyHash = nullableString(cacheKeyHash)
	log.CacheHitRequestID = nullableString(cacheHitRequestID)
	log.MaskingDetectedTypes = detectedTypes
	log.RedactedPromptPreview = nullableString(redactedPromptPreview)
	log.ErrorCode = nullableString(errorCode)
	log.ErrorMessage = nullableString(errorMessage)
	log.ErrorStage = nullableString(errorStage)
	if completedAt.Valid {
		log.CompletedAt = &completedAt.Time
	}
	return log, nil
}

func nullableString(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func nullableInt64Pointer(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func decodeStringArrayJSON(raw []byte) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []string{}, nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return []string{}, nil
	}
	return values, nil
}
