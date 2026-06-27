package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

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
	var failedRequests int64
	var blockedRequests int64
	var rateLimitedRequests int64
	var cacheHitRequests int64
	var cacheEligibleRequests int64
	var promptTokens int64
	var completionTokens int64
	var totalTokens int64
	var totalCostMicroUSD int64
	var savedCostMicroUSD int64
	var averageLatencyMs sql.NullFloat64
	var p95LatencyMs sql.NullFloat64
	var statusCountsJSON []byte
	var maskingActionCountsJSON []byte
	var routingCountByModelJSON []byte
	var costByModelJSON []byte
	var lastLogCreatedAt sql.NullTime
	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&totalRequests,
		&successfulRequests,
		&failedRequests,
		&blockedRequests,
		&rateLimitedRequests,
		&cacheHitRequests,
		&cacheEligibleRequests,
		&promptTokens,
		&completionTokens,
		&totalTokens,
		&totalCostMicroUSD,
		&savedCostMicroUSD,
		&averageLatencyMs,
		&p95LatencyMs,
		&statusCountsJSON,
		&maskingActionCountsJSON,
		&routingCountByModelJSON,
		&costByModelJSON,
		&lastLogCreatedAt,
	); err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}

	statusCounts, err := decodeInt64MapJSON(statusCountsJSON)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	maskingActionCounts, err := decodeInt64MapJSON(maskingActionCountsJSON)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	routingCountByModel, err := decodeRoutingCountByModelJSON(routingCountByModelJSON)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	costByModel, err := decodeCostByModelJSON(costByModelJSON)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}

	var averageLatencyPointer *float64
	if averageLatencyMs.Valid {
		averageLatencyPointer = &averageLatencyMs.Float64
	}
	var p95LatencyPointer *float64
	if p95LatencyMs.Valid {
		p95LatencyPointer = &p95LatencyMs.Float64
	}

	return invocationlog.BuildDashboardOverviewFromAggregate(invocationlog.DashboardOverviewAggregate{
		TotalRequests:         totalRequests,
		SuccessfulRequests:    successfulRequests,
		FailedRequests:        failedRequests,
		BlockedRequests:       blockedRequests,
		RateLimitedRequests:   rateLimitedRequests,
		CacheHitRequests:      cacheHitRequests,
		CacheEligibleRequests: cacheEligibleRequests,
		PromptTokens:          promptTokens,
		CompletionTokens:      completionTokens,
		TotalTokens:           totalTokens,
		TotalCostMicroUSD:     totalCostMicroUSD,
		SavedCostMicroUSD:     savedCostMicroUSD,
		AverageLatencyMs:      averageLatencyPointer,
		P95LatencyMs:          p95LatencyPointer,
		MaskingActionCounts:   maskingActionCounts,
		RoutingCountByModel:   routingCountByModel,
		StatusCounts:          statusCounts,
		CostByModel:           costByModel,
		LastLogCreatedAt:      nullableTimePointer(lastLogCreatedAt),
		GeneratedAt:           time.Now().UTC(),
	}), nil
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
with filtered as (
  select
    request_id,
    status,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost_micro_usd,
    saved_cost_micro_usd,
    latency_ms,
    cache_status,
    cache_type,
    masking_action,
    provider,
    model,
    selected_provider,
    selected_model,
    routing_reason,
    created_at
  from p0_llm_invocation_logs
  where %s
)
select
  count(*)::bigint as total_requests,
  count(*) filter (where status in ('success', 'cache_hit'))::bigint as successful_requests,
  count(*) filter (where status = 'error')::bigint as failed_requests,
  count(*) filter (where status = 'blocked')::bigint as blocked_requests,
  count(*) filter (where status = 'rate_limited')::bigint as rate_limited_requests,
  count(*) filter (where coalesce(nullif(cache_status, ''), 'bypass') = 'hit' and coalesce(nullif(cache_type, ''), 'none') = 'exact')::bigint as cache_hit_requests,
  count(*) filter (where coalesce(nullif(cache_status, ''), 'bypass') <> 'bypass')::bigint as cache_eligible_requests,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as total_cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd,
  (avg(latency_ms) filter (where status in ('success', 'cache_hit', 'error')))::float8 as average_latency_ms,
  (percentile_disc(0.95) within group (order by latency_ms) filter (where status in ('success', 'cache_hit', 'error')))::float8 as p95_latency_ms,
  coalesce((
    select jsonb_object_agg(status_key, request_count)
    from (
      select coalesce(nullif(status, ''), 'unknown') as status_key, count(*)::bigint as request_count
      from filtered
      group by 1
    ) status_rollup
  ), '{}'::jsonb) as status_counts,
  coalesce((
    select jsonb_object_agg(masking_action_key, request_count)
    from (
      select coalesce(nullif(masking_action, ''), 'none') as masking_action_key, count(*)::bigint as request_count
      from filtered
      group by 1
    ) masking_rollup
  ), '{}'::jsonb) as masking_action_counts,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'selectedProvider', selected_provider_key,
      'selectedModel', selected_model_key,
      'routingReason', routing_reason_key,
      'requestCount', request_count
    ) order by request_count desc, selected_provider_key, selected_model_key, routing_reason_key)
    from (
      select
        coalesce(nullif(selected_provider, ''), nullif(provider, '')) as selected_provider_key,
        coalesce(nullif(selected_model, ''), nullif(model, '')) as selected_model_key,
        coalesce(nullif(routing_reason, ''), '') as routing_reason_key,
        count(*)::bigint as request_count
      from filtered
      group by 1, 2, 3
    ) routing_rollup
    where selected_provider_key is not null and selected_model_key is not null
  ), '[]'::jsonb) as routing_count_by_model,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'selectedProvider', selected_provider_key,
      'selectedModel', selected_model_key,
      'requestCount', request_count,
      'totalTokens', total_tokens,
      'costMicroUsd', cost_micro_usd
    ) order by cost_micro_usd desc, selected_provider_key, selected_model_key)
    from (
      select
        coalesce(nullif(selected_provider, ''), nullif(provider, '')) as selected_provider_key,
        coalesce(nullif(selected_model, ''), nullif(model, '')) as selected_model_key,
        count(*)::bigint as request_count,
        coalesce(sum(total_tokens), 0)::bigint as total_tokens,
        coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd
      from filtered
      group by 1, 2
    ) cost_rollup
    where selected_provider_key is not null and selected_model_key is not null
  ), '[]'::jsonb) as cost_by_model,
  max(created_at) as last_log_created_at
from filtered`, strings.Join(where, " and "))

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

func nullableTimePointer(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
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

func decodeInt64MapJSON(raw []byte) (map[string]int64, error) {
	if len(raw) == 0 || (len(raw) == 4 && raw[0] == 'n' && raw[1] == 'u' && raw[2] == 'l' && raw[3] == 'l') {
		return map[string]int64{}, nil
	}
	var values map[string]int64
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return map[string]int64{}, nil
	}
	return values, nil
}

func decodeRoutingCountByModelJSON(raw []byte) ([]invocationlog.RoutingCountByModel, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []invocationlog.RoutingCountByModel{}, nil
	}
	var values []invocationlog.RoutingCountByModel
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return []invocationlog.RoutingCountByModel{}, nil
	}
	return values, nil
}

func decodeCostByModelJSON(raw []byte) ([]invocationlog.CostByModel, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []invocationlog.CostByModel{}, nil
	}
	var values []invocationlog.CostByModel
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return []invocationlog.CostByModel{}, nil
	}
	return values, nil
}
