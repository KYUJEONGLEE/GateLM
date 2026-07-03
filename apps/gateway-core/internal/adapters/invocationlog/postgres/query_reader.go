package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"

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

const (
	budgetScopeTypeSQL       = "coalesce(nullif(metadata #>> '{budgetScope,budgetScopeType}', ''), 'application')"
	budgetScopeIDSQL         = "coalesce(nullif(metadata #>> '{budgetScope,budgetScopeId}', ''), application_id::text)"
	budgetScopeResolvedBySQL = "coalesce(nullif(metadata #>> '{budgetScope,resolvedBy}', ''), 'default_application')"
	terminalStatusSQL        = "coalesce(nullif(metadata #>> '{terminalStatus}', ''), nullif(metadata #>> '{gatewayStageOutcomes,terminalStatus}', ''), status)"
)

func metadataOutcomeSQL(domain string, fallbackSQL string) string {
	return fmt.Sprintf("coalesce(nullif(metadata #>> '{domainOutcomes,%[1]s,outcome}', ''), nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,%[1]s,outcome}', ''), %[2]s)", domain, fallbackSQL)
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
	var cancelledRequests int64
	var cacheHitRequests int64
	var cacheEligibleRequests int64
	var fallbackSuccessRequests int64
	var promptTokens int64
	var completionTokens int64
	var totalTokens int64
	var totalCostMicroUSD int64
	var savedCostMicroUSD int64
	var averageLatencyMs sql.NullFloat64
	var p95LatencyMs sql.NullFloat64
	var p95GatewayInternalLatencyMs sql.NullFloat64
	var p99GatewayInternalLatencyMs sql.NullFloat64
	var p95ProviderLatencyMs sql.NullFloat64
	var p99ProviderLatencyMs sql.NullFloat64
	var statusCountsJSON []byte
	var maskingActionCountsJSON []byte
	var safetyOutcomeCountsJSON []byte
	var cacheOutcomeCountsJSON []byte
	var fallbackOutcomeCountsJSON []byte
	var routingCountByModelJSON []byte
	var costByModelJSON []byte
	var applicationBreakdownJSON []byte
	var budgetScopeBreakdownJSON []byte
	var lastLogCreatedAt sql.NullTime
	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&totalRequests,
		&successfulRequests,
		&failedRequests,
		&blockedRequests,
		&rateLimitedRequests,
		&cancelledRequests,
		&cacheHitRequests,
		&cacheEligibleRequests,
		&fallbackSuccessRequests,
		&promptTokens,
		&completionTokens,
		&totalTokens,
		&totalCostMicroUSD,
		&savedCostMicroUSD,
		&averageLatencyMs,
		&p95LatencyMs,
		&p95GatewayInternalLatencyMs,
		&p99GatewayInternalLatencyMs,
		&p95ProviderLatencyMs,
		&p99ProviderLatencyMs,
		&statusCountsJSON,
		&maskingActionCountsJSON,
		&safetyOutcomeCountsJSON,
		&cacheOutcomeCountsJSON,
		&fallbackOutcomeCountsJSON,
		&routingCountByModelJSON,
		&costByModelJSON,
		&applicationBreakdownJSON,
		&budgetScopeBreakdownJSON,
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
	safetyOutcomeCounts, err := decodeInt64MapJSON(safetyOutcomeCountsJSON)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	cacheOutcomeCounts, err := decodeInt64MapJSON(cacheOutcomeCountsJSON)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	fallbackOutcomeCounts, err := decodeInt64MapJSON(fallbackOutcomeCountsJSON)
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
	applicationBreakdown, err := decodeApplicationBreakdownJSON(applicationBreakdownJSON)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	budgetScopeBreakdown, err := decodeBudgetScopeBreakdownJSON(budgetScopeBreakdownJSON)
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
	p95GatewayInternalLatencyPointer := nullableFloat64Pointer(p95GatewayInternalLatencyMs)
	p99GatewayInternalLatencyPointer := nullableFloat64Pointer(p99GatewayInternalLatencyMs)
	p95ProviderLatencyPointer := nullableFloat64Pointer(p95ProviderLatencyMs)
	p99ProviderLatencyPointer := nullableFloat64Pointer(p99ProviderLatencyMs)

	return invocationlog.BuildDashboardOverviewFromAggregate(invocationlog.DashboardOverviewAggregate{
		TotalRequests:               totalRequests,
		SuccessfulRequests:          successfulRequests,
		FailedRequests:              failedRequests,
		BlockedRequests:             blockedRequests,
		RateLimitedRequests:         rateLimitedRequests,
		CancelledRequests:           cancelledRequests,
		CacheHitRequests:            cacheHitRequests,
		CacheEligibleRequests:       cacheEligibleRequests,
		FallbackSuccessCount:        fallbackSuccessRequests,
		PromptTokens:                promptTokens,
		CompletionTokens:            completionTokens,
		TotalTokens:                 totalTokens,
		TotalCostMicroUSD:           totalCostMicroUSD,
		SavedCostMicroUSD:           savedCostMicroUSD,
		AverageLatencyMs:            averageLatencyPointer,
		P95LatencyMs:                p95LatencyPointer,
		P95GatewayInternalLatencyMs: p95GatewayInternalLatencyPointer,
		P99GatewayInternalLatencyMs: p99GatewayInternalLatencyPointer,
		P95ProviderLatencyMs:        p95ProviderLatencyPointer,
		P99ProviderLatencyMs:        p99ProviderLatencyPointer,
		MaskingActionCounts:         maskingActionCounts,
		RoutingCountByModel:         routingCountByModel,
		StatusCounts:                statusCounts,
		SafetyOutcomeCounts:         safetyOutcomeCounts,
		CacheOutcomeCounts:          cacheOutcomeCounts,
		FallbackOutcomeCounts:       fallbackOutcomeCounts,
		ApplicationBreakdown:        applicationBreakdown,
		CostByModel:                 costByModel,
		BudgetScopeBreakdown:        budgetScopeBreakdown,
		LastLogCreatedAt:            nullableTimePointer(lastLogCreatedAt),
		GeneratedAt:                 time.Now().UTC(),
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

	addOptionalWhere(terminalStatusSQL, filter.Status)
	addOptionalWhere("provider", filter.Provider)
	addOptionalWhere("model", filter.Model)
	addOptionalWhere("cache_status", filter.CacheStatus)
	addOptionalWhere("application_id", filter.ApplicationID)
	addOptionalWhere(budgetScopeTypeSQL, filter.BudgetScope.Type)
	addOptionalWhere(budgetScopeIDSQL, filter.BudgetScope.ID)
	addOptionalWhere(budgetScopeResolvedBySQL, filter.BudgetScope.ResolvedBy)
	addOptionalWhere("request_id", filter.RequestID)

	args = append(args, filter.Limit)
	limitPlaceholder := len(args)

	query := fmt.Sprintf(`
select
  request_id,
  project_id::text,
  application_id::text,
  %s as budget_scope_type,
  %s as budget_scope_id,
  %s as budget_scope_resolved_by,
  provider,
  model,
  requested_model,
  selected_model,
  %s as status,
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
  created_at,
  metadata
from p0_llm_invocation_logs
where %s
order by created_at desc, request_id desc
limit $%d`, budgetScopeTypeSQL, budgetScopeIDSQL, budgetScopeResolvedBySQL, terminalStatusSQL, strings.Join(where, " and "), limitPlaceholder)

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
	addOptionalWhere := func(expression string, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		args = append(args, value)
		where = append(where, fmt.Sprintf("%s = $%d", expression, len(args)))
	}
	addOptionalWhere(budgetScopeTypeSQL, filter.BudgetScope.Type)
	addOptionalWhere(budgetScopeIDSQL, filter.BudgetScope.ID)
	addOptionalWhere(budgetScopeResolvedBySQL, filter.BudgetScope.ResolvedBy)

	safetyOutcomeSQL := metadataOutcomeSQL("safety", `case coalesce(nullif(masking_action, ''), 'none') when 'blocked' then 'blocked' when 'redacted' then 'redacted' else 'passed' end`)
	cacheOutcomeSQL := metadataOutcomeSQL("cache", `case coalesce(nullif(cache_status, ''), 'bypass') when 'hit' then 'hit' when 'miss' then 'miss' when 'error' then 'error' when 'bypass' then 'bypassed' else 'not_used' end`)
	fallbackOutcomeSQL := metadataOutcomeSQL("fallback", `'not_called'`)

	query := fmt.Sprintf(`
with filtered as (
  select
    request_id,
    application_id::text,
    %s as terminal_status,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost_micro_usd,
    saved_cost_micro_usd,
    latency_ms,
    greatest(latency_ms - coalesce(provider_latency_ms, 0), 0) as gateway_internal_latency_ms,
    provider_latency_ms,
    cache_status,
    cache_type,
    %s as safety_outcome,
    %s as cache_outcome,
    %s as fallback_outcome,
    masking_action,
    provider,
    model,
    selected_provider,
    selected_model,
    routing_reason,
    %s as budget_scope_type,
    %s as budget_scope_id,
    %s as budget_scope_resolved_by,
    created_at
  from p0_llm_invocation_logs
  where %s
)
select
  count(*)::bigint as total_requests,
  count(*) filter (where terminal_status = 'success')::bigint as successful_requests,
  count(*) filter (where terminal_status = 'failed')::bigint as failed_requests,
  count(*) filter (where terminal_status = 'blocked')::bigint as blocked_requests,
  count(*) filter (where terminal_status = 'rate_limited')::bigint as rate_limited_requests,
  count(*) filter (where terminal_status = 'cancelled')::bigint as cancelled_requests,
  count(*) filter (where cache_outcome = 'hit' and coalesce(nullif(cache_type, ''), 'none') = 'exact')::bigint as cache_hit_requests,
  count(*) filter (where cache_outcome in ('hit', 'miss', 'error'))::bigint as cache_eligible_requests,
  count(*) filter (where fallback_outcome = 'success')::bigint as fallback_success_requests,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as total_cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd,
  (avg(latency_ms) filter (where terminal_status in ('success', 'failed')))::float8 as average_latency_ms,
  (percentile_disc(0.95) within group (order by latency_ms) filter (where terminal_status in ('success', 'failed')))::float8 as p95_latency_ms,
  (percentile_disc(0.95) within group (order by gateway_internal_latency_ms) filter (where terminal_status in ('success', 'failed')))::float8 as p95_gateway_internal_latency_ms,
  (percentile_disc(0.99) within group (order by gateway_internal_latency_ms) filter (where terminal_status in ('success', 'failed')))::float8 as p99_gateway_internal_latency_ms,
  (percentile_disc(0.95) within group (order by provider_latency_ms) filter (where terminal_status in ('success', 'failed') and provider_latency_ms is not null))::float8 as p95_provider_latency_ms,
  (percentile_disc(0.99) within group (order by provider_latency_ms) filter (where terminal_status in ('success', 'failed') and provider_latency_ms is not null))::float8 as p99_provider_latency_ms,
  coalesce((
    select jsonb_object_agg(status_key, request_count)
    from (
      select coalesce(nullif(terminal_status, ''), 'unknown') as status_key, count(*)::bigint as request_count
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
    select jsonb_object_agg(safety_outcome_key, request_count)
    from (
      select coalesce(nullif(safety_outcome, ''), 'not_checked') as safety_outcome_key, count(*)::bigint as request_count
      from filtered
      group by 1
    ) safety_rollup
  ), '{}'::jsonb) as safety_outcome_counts,
  coalesce((
    select jsonb_object_agg(cache_outcome_key, request_count)
    from (
      select coalesce(nullif(cache_outcome, ''), 'not_used') as cache_outcome_key, count(*)::bigint as request_count
      from filtered
      group by 1
    ) cache_rollup
  ), '{}'::jsonb) as cache_outcome_counts,
  coalesce((
    select jsonb_object_agg(fallback_outcome_key, request_count)
    from (
      select coalesce(nullif(fallback_outcome, ''), 'not_called') as fallback_outcome_key, count(*)::bigint as request_count
      from filtered
      group by 1
    ) fallback_rollup
  ), '{}'::jsonb) as fallback_outcome_counts,
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
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'applicationId', application_id,
      'requestCount', request_count,
      'costMicroUsd', cost_micro_usd
    ) order by cost_micro_usd desc, application_id)
    from (
      select
        application_id,
        count(*)::bigint as request_count,
        coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd
      from filtered
      group by 1
    ) application_rollup
    where application_id is not null and application_id <> ''
  ), '[]'::jsonb) as application_breakdown,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'budgetScopeType', budget_scope_type,
      'budgetScopeId', budget_scope_id,
      'resolvedBy', budget_scope_resolved_by,
      'requestCount', request_count,
      'costMicroUsd', cost_micro_usd
    ) order by cost_micro_usd desc, budget_scope_type, budget_scope_id, budget_scope_resolved_by)
    from (
      select
        budget_scope_type,
        budget_scope_id,
        budget_scope_resolved_by,
        count(*)::bigint as request_count,
        coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd
      from filtered
      group by 1, 2, 3
    ) budget_rollup
    where budget_scope_id is not null and budget_scope_id <> ''
  ), '[]'::jsonb) as budget_scope_breakdown,
  max(created_at) as last_log_created_at
from filtered`, terminalStatusSQL, safetyOutcomeSQL, cacheOutcomeSQL, fallbackOutcomeSQL, budgetScopeTypeSQL, budgetScopeIDSQL, budgetScopeResolvedBySQL, strings.Join(where, " and "))

	return query, args
}

var requestDetailSQL = fmt.Sprintf(`
select
  request_id,
  trace_id,
  tenant_id::text,
  project_id::text,
  application_id::text,
  %s as budget_scope_type,
  %s as budget_scope_id,
  %s as budget_scope_resolved_by,
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
	  completed_at,
	  metadata
	from p0_llm_invocation_logs
where tenant_id = $1
  and project_id = $2
  and request_id = $3
limit 1`, budgetScopeTypeSQL, budgetScopeIDSQL, budgetScopeResolvedBySQL)

func scanProjectLogListRow(rows Rows) (invocationlog.LlmInvocationLog, error) {
	var log invocationlog.LlmInvocationLog
	var applicationID sql.NullString
	var budgetScopeType sql.NullString
	var budgetScopeID sql.NullString
	var budgetScopeResolvedBy sql.NullString
	var requestedModel sql.NullString
	var selectedModel sql.NullString
	var routingReason sql.NullString
	var metadataJSON []byte
	if err := rows.Scan(
		&log.RequestID,
		&log.ProjectID,
		&applicationID,
		&budgetScopeType,
		&budgetScopeID,
		&budgetScopeResolvedBy,
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
		&metadataJSON,
	); err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}

	log.ApplicationID = nullableString(applicationID)
	log.BudgetScope = budget.NormalizeScope(budget.Scope{
		Type:       nullableString(budgetScopeType),
		ID:         nullableString(budgetScopeID),
		ResolvedBy: nullableString(budgetScopeResolvedBy),
	}, log.ApplicationID)
	log.RequestedModel = nullableString(requestedModel)
	log.SelectedModel = nullableString(selectedModel)
	log.RoutingReason = nullableString(routingReason)
	var err error
	applyInvocationMetadataFields(&log, metadataJSON)
	log.DomainOutcomes, err = decodeDomainOutcomesMetadata(metadataJSON)
	if err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}
	log.TerminalStatus, err = decodeTerminalStatusBridgeMetadata(metadataJSON)
	if err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}
	return log, nil
}

func scanRequestDetailRow(row Row) (invocationlog.LlmInvocationLog, error) {
	var log invocationlog.LlmInvocationLog
	var applicationID sql.NullString
	var budgetScopeType sql.NullString
	var budgetScopeID sql.NullString
	var budgetScopeResolvedBy sql.NullString
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
	var metadataJSON []byte

	if err := row.Scan(
		&log.RequestID,
		&log.TraceID,
		&log.TenantID,
		&log.ProjectID,
		&applicationID,
		&budgetScopeType,
		&budgetScopeID,
		&budgetScopeResolvedBy,
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
		&metadataJSON,
	); err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}

	detectedTypes, err := decodeStringArrayJSON(maskingDetectedTypes)
	if err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}

	log.ApplicationID = nullableString(applicationID)
	log.BudgetScope = budget.NormalizeScope(budget.Scope{
		Type:       nullableString(budgetScopeType),
		ID:         nullableString(budgetScopeID),
		ResolvedBy: nullableString(budgetScopeResolvedBy),
	}, log.ApplicationID)
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
	applyInvocationMetadataFields(&log, metadataJSON)
	log.RuntimeSnapshot, err = decodeRuntimeSnapshotBridgeMetadata(metadataJSON, log.CreatedAt)
	if err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}
	log.DomainOutcomes, err = decodeDomainOutcomesMetadata(metadataJSON)
	if err != nil {
		return invocationlog.LlmInvocationLog{}, err
	}
	log.TerminalStatus, err = decodeTerminalStatusBridgeMetadata(metadataJSON)
	if err != nil {
		return invocationlog.LlmInvocationLog{}, err
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

func nullableFloat64Pointer(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
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

type invocationMetadataJSON struct {
	TerminalStatus              string                            `json:"terminalStatus"`
	RuntimeSnapshot             *runtimeSnapshotMetadataJSON      `json:"runtimeSnapshot"`
	Runtime                     *runtimeMetadataJSON              `json:"runtime"`
	DomainOutcomes              *invocationlog.DomainOutcomes     `json:"domainOutcomes"`
	GatewayStageOutcomes        *gatewayStageOutcomesMetadataJSON `json:"gatewayStageOutcomes"`
	StageOutcomes               *gatewayStageOutcomesMetadataJSON `json:"stageOutcomes"`
	CacheDecisionReason         string                            `json:"cacheDecisionReason"`
	ProviderCalled              bool                              `json:"providerCalled"`
	SelectedProviderID          string                            `json:"selectedProviderId"`
	SelectedModelID             string                            `json:"selectedModelId"`
	RoutingPolicyHash           string                            `json:"routingPolicyHash"`
	RoutingDecisionKeyHash      string                            `json:"routingDecisionKeyHash"`
	PromptCategory              string                            `json:"promptCategory"`
	SemanticCacheHit            bool                              `json:"semanticCacheHit"`
	SemanticSimilarity          float64                           `json:"semanticSimilarity"`
	SemanticMatchedRequestID    string                            `json:"semanticMatchedRequestId"`
	SemanticCacheThreshold      float64                           `json:"semanticCacheThreshold"`
	SemanticCachePolicyVersion  string                            `json:"semanticCachePolicyVersion"`
	SemanticCacheDecisionReason string                            `json:"semanticCacheDecisionReason"`
	EmbeddingProvider           string                            `json:"embeddingProvider"`
	PromptCapture               *promptCaptureMetadataJSON        `json:"promptCapture"`
}

type promptCaptureMetadataJSON struct {
	Enabled        bool   `json:"enabled"`
	Mode           string `json:"mode"`
	Visibility     string `json:"visibility"`
	CapturedPrompt string `json:"capturedPrompt"`
	Truncated      bool   `json:"truncated"`
	MaxChars       int    `json:"maxChars"`
}

type runtimeMetadataJSON struct {
	RuntimeSnapshot    *runtimeSnapshotMetadataJSON `json:"runtimeSnapshot"`
	LegacyHashes       runtimeconfig.LegacyHashes   `json:"legacyHashes"`
	ConfigHash         string                       `json:"configHash"`
	SecurityPolicyHash string                       `json:"securityPolicyHash"`
	RoutingPolicyHash  string                       `json:"routingPolicyHash"`
}

type runtimeSnapshotMetadataJSON struct {
	RuntimeSnapshotID      string                     `json:"runtimeSnapshotId"`
	RuntimeSnapshotVersion int                        `json:"runtimeSnapshotVersion"`
	ContentHash            string                     `json:"contentHash"`
	RuntimeState           string                     `json:"runtimeState"`
	PublishedAt            *time.Time                 `json:"publishedAt"`
	PublishedBy            string                     `json:"publishedBy"`
	GatewayInstanceID      string                     `json:"gatewayInstanceId"`
	LegacyHashes           runtimeconfig.LegacyHashes `json:"legacyHashes"`
}

type gatewayStageOutcomesMetadataJSON struct {
	TerminalStatus string                        `json:"terminalStatus"`
	DomainOutcomes *invocationlog.DomainOutcomes `json:"domainOutcomes"`
}

func applyInvocationMetadataFields(log *invocationlog.LlmInvocationLog, raw []byte) {
	if log == nil || len(raw) == 0 || string(raw) == "null" {
		return
	}
	var metadata invocationMetadataJSON
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return
	}
	if strings.TrimSpace(metadata.CacheDecisionReason) != "" {
		log.CacheDecisionReason = strings.TrimSpace(metadata.CacheDecisionReason)
	}
	if metadata.ProviderCalled {
		log.ProviderCalled = true
	}
	if strings.TrimSpace(metadata.SelectedProviderID) != "" {
		log.SelectedProviderID = strings.TrimSpace(metadata.SelectedProviderID)
	}
	if strings.TrimSpace(metadata.SelectedModelID) != "" {
		log.SelectedModelID = strings.TrimSpace(metadata.SelectedModelID)
	}
	if routingPolicyHash := routingPolicyHashFromMetadata(metadata); routingPolicyHash != "" {
		log.RoutingPolicyHash = routingPolicyHash
	}
	if strings.TrimSpace(metadata.RoutingDecisionKeyHash) != "" {
		log.RoutingDecisionKeyHash = strings.TrimSpace(metadata.RoutingDecisionKeyHash)
	}
	if strings.TrimSpace(metadata.PromptCategory) != "" {
		log.PromptCategory = strings.TrimSpace(metadata.PromptCategory)
	}
	log.SemanticCacheHit = metadata.SemanticCacheHit
	if metadata.SemanticSimilarity > 0 {
		log.SemanticSimilarity = metadata.SemanticSimilarity
	}
	if strings.TrimSpace(metadata.SemanticMatchedRequestID) != "" {
		log.SemanticMatchedRequestID = strings.TrimSpace(metadata.SemanticMatchedRequestID)
	}
	if metadata.SemanticCacheThreshold > 0 {
		log.SemanticCacheThreshold = metadata.SemanticCacheThreshold
	}
	if strings.TrimSpace(metadata.SemanticCachePolicyVersion) != "" {
		log.SemanticCachePolicyVersion = strings.TrimSpace(metadata.SemanticCachePolicyVersion)
	}
	if strings.TrimSpace(metadata.SemanticCacheDecisionReason) != "" {
		log.SemanticCacheDecisionReason = strings.TrimSpace(metadata.SemanticCacheDecisionReason)
	}
	if strings.TrimSpace(metadata.EmbeddingProvider) != "" {
		log.EmbeddingProvider = strings.TrimSpace(metadata.EmbeddingProvider)
	}
	if metadata.PromptCapture != nil {
		log.PromptCapture = invocationlog.PromptCaptureFields{
			Enabled:        metadata.PromptCapture.Enabled,
			Mode:           strings.TrimSpace(metadata.PromptCapture.Mode),
			Visibility:     strings.TrimSpace(metadata.PromptCapture.Visibility),
			CapturedPrompt: strings.TrimSpace(metadata.PromptCapture.CapturedPrompt),
			Truncated:      metadata.PromptCapture.Truncated,
			MaxChars:       metadata.PromptCapture.MaxChars,
		}
	}
}

func routingPolicyHashFromMetadata(metadata invocationMetadataJSON) string {
	if strings.TrimSpace(metadata.RoutingPolicyHash) != "" {
		return strings.TrimSpace(metadata.RoutingPolicyHash)
	}
	if metadata.RuntimeSnapshot != nil {
		if routingPolicyHash := strings.TrimSpace(metadata.RuntimeSnapshot.LegacyHashes.Normalize().RoutingPolicyHash); routingPolicyHash != "" {
			return routingPolicyHash
		}
	}
	if metadata.Runtime != nil {
		if metadata.Runtime.RuntimeSnapshot != nil {
			if routingPolicyHash := strings.TrimSpace(metadata.Runtime.RuntimeSnapshot.LegacyHashes.Normalize().RoutingPolicyHash); routingPolicyHash != "" {
				return routingPolicyHash
			}
		}
		if routingPolicyHash := strings.TrimSpace(metadata.Runtime.legacyHashes().RoutingPolicyHash); routingPolicyHash != "" {
			return routingPolicyHash
		}
	}
	return ""
}

// decodeRuntimeSnapshotBridgeMetadata accepts v2 RuntimeSnapshot metadata plus v1 runtime hash metadata.
// Legacy hash trio values stay under legacyHashes and are never promoted to primary provenance.
func decodeRuntimeSnapshotBridgeMetadata(raw []byte, createdAt time.Time) (runtimeconfig.RuntimeSnapshotProvenance, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return runtimeconfig.RuntimeSnapshotProvenance{}, nil
	}
	var metadata invocationMetadataJSON
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return runtimeconfig.RuntimeSnapshotProvenance{}, err
	}
	if metadata.RuntimeSnapshot != nil {
		return metadata.RuntimeSnapshot.toProvenance(createdAt), nil
	}
	if metadata.Runtime == nil {
		return runtimeconfig.RuntimeSnapshotProvenance{}, nil
	}
	if metadata.Runtime.RuntimeSnapshot != nil {
		return metadata.Runtime.RuntimeSnapshot.toProvenance(createdAt), nil
	}
	legacyHashes := metadata.Runtime.legacyHashes()
	if legacyHashes.IsZero() {
		return runtimeconfig.RuntimeSnapshotProvenance{}, nil
	}
	return runtimeconfig.RuntimeSnapshotProvenance{
		LegacyHashes: legacyHashes,
	}.Normalize(runtimeconfig.ActiveConfig{}, createdAt, runtimeconfig.DefaultGatewayInstanceIDCompat), nil
}

func decodeDomainOutcomesMetadata(raw []byte) (invocationlog.DomainOutcomes, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return normalizeDomainOutcomes(invocationlog.DomainOutcomes{}), nil
	}
	var metadata invocationMetadataJSON
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return invocationlog.DomainOutcomes{}, err
	}
	if metadata.DomainOutcomes != nil {
		return normalizeDomainOutcomes(*metadata.DomainOutcomes), nil
	}
	if metadata.GatewayStageOutcomes != nil && metadata.GatewayStageOutcomes.DomainOutcomes != nil {
		return normalizeDomainOutcomes(*metadata.GatewayStageOutcomes.DomainOutcomes), nil
	}
	if metadata.StageOutcomes != nil && metadata.StageOutcomes.DomainOutcomes != nil {
		return normalizeDomainOutcomes(*metadata.StageOutcomes.DomainOutcomes), nil
	}
	return normalizeDomainOutcomes(invocationlog.DomainOutcomes{}), nil
}

func normalizeDomainOutcomes(outcomes invocationlog.DomainOutcomes) invocationlog.DomainOutcomes {
	if outcomes.Safety.DetectedTypes == nil {
		outcomes.Safety.DetectedTypes = []string{}
	}
	return outcomes
}

func (m runtimeMetadataJSON) legacyHashes() runtimeconfig.LegacyHashes {
	hashes := m.LegacyHashes.Normalize()
	if hashes.ConfigHash == "" {
		hashes.ConfigHash = strings.TrimSpace(m.ConfigHash)
	}
	if hashes.SecurityPolicyHash == "" {
		hashes.SecurityPolicyHash = strings.TrimSpace(m.SecurityPolicyHash)
	}
	if hashes.RoutingPolicyHash == "" {
		hashes.RoutingPolicyHash = strings.TrimSpace(m.RoutingPolicyHash)
	}
	return hashes
}

func (m runtimeSnapshotMetadataJSON) toProvenance(createdAt time.Time) runtimeconfig.RuntimeSnapshotProvenance {
	provenance := runtimeconfig.RuntimeSnapshotProvenance{
		RuntimeSnapshotID:      m.RuntimeSnapshotID,
		RuntimeSnapshotVersion: m.RuntimeSnapshotVersion,
		ContentHash:            m.ContentHash,
		RuntimeState:           m.RuntimeState,
		PublishedBy:            m.PublishedBy,
		GatewayInstanceID:      m.GatewayInstanceID,
		LegacyHashes:           m.LegacyHashes,
	}
	if m.PublishedAt != nil {
		provenance.PublishedAt = *m.PublishedAt
	}
	return provenance.Normalize(runtimeconfig.ActiveConfig{}, createdAt, runtimeconfig.DefaultGatewayInstanceIDCompat)
}

func decodeTerminalStatusBridgeMetadata(raw []byte) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	var metadata invocationMetadataJSON
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return "", err
	}
	if strings.TrimSpace(metadata.TerminalStatus) != "" {
		return strings.TrimSpace(metadata.TerminalStatus), nil
	}
	if metadata.GatewayStageOutcomes != nil && strings.TrimSpace(metadata.GatewayStageOutcomes.TerminalStatus) != "" {
		return strings.TrimSpace(metadata.GatewayStageOutcomes.TerminalStatus), nil
	}
	if metadata.StageOutcomes != nil && strings.TrimSpace(metadata.StageOutcomes.TerminalStatus) != "" {
		return strings.TrimSpace(metadata.StageOutcomes.TerminalStatus), nil
	}
	return "", nil
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
	if len(raw) == 0 || (len(raw) == 4 && raw[0] == 'n' && raw[1] == 'u' && raw[2] == 'l' && raw[3] == 'l') {
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
	if len(raw) == 0 || (len(raw) == 4 && raw[0] == 'n' && raw[1] == 'u' && raw[2] == 'l' && raw[3] == 'l') {
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

func decodeApplicationBreakdownJSON(raw []byte) ([]invocationlog.ApplicationBreakdown, error) {
	if len(raw) == 0 || (len(raw) == 4 && raw[0] == 'n' && raw[1] == 'u' && raw[2] == 'l' && raw[3] == 'l') {
		return []invocationlog.ApplicationBreakdown{}, nil
	}
	var rows []struct {
		ApplicationID string `json:"applicationId"`
		RequestCount  int64  `json:"requestCount"`
		CostMicroUSD  int64  `json:"costMicroUsd"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	if rows == nil {
		return []invocationlog.ApplicationBreakdown{}, nil
	}
	items := make([]invocationlog.ApplicationBreakdown, 0, len(rows))
	for _, row := range rows {
		if strings.TrimSpace(row.ApplicationID) == "" {
			continue
		}
		items = append(items, invocationlog.ApplicationBreakdown{
			ApplicationID: row.ApplicationID,
			RequestCount:  row.RequestCount,
			CostMicroUSD:  row.CostMicroUSD,
		})
	}
	return items, nil
}

func decodeBudgetScopeBreakdownJSON(raw []byte) ([]invocationlog.BudgetScopeBreakdown, error) {
	if len(raw) == 0 || (len(raw) == 4 && raw[0] == 'n' && raw[1] == 'u' && raw[2] == 'l' && raw[3] == 'l') {
		return []invocationlog.BudgetScopeBreakdown{}, nil
	}
	var rows []struct {
		BudgetScopeType string `json:"budgetScopeType"`
		BudgetScopeID   string `json:"budgetScopeId"`
		ResolvedBy      string `json:"resolvedBy"`
		RequestCount    int64  `json:"requestCount"`
		CostMicroUSD    int64  `json:"costMicroUsd"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	if rows == nil {
		return []invocationlog.BudgetScopeBreakdown{}, nil
	}
	items := make([]invocationlog.BudgetScopeBreakdown, 0, len(rows))
	for _, row := range rows {
		scope := budget.NormalizeScope(budget.Scope{
			Type:       row.BudgetScopeType,
			ID:         row.BudgetScopeID,
			ResolvedBy: row.ResolvedBy,
		}, "")
		if scope.ID == "" {
			continue
		}
		items = append(items, invocationlog.BudgetScopeBreakdown{
			BudgetScope:  scope,
			RequestCount: row.RequestCount,
			CostMicroUSD: row.CostMicroUSD,
		})
	}
	return items, nil
}
