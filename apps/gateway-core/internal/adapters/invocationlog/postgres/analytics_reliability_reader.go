package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type analyticsReliabilitySurfaceRead struct {
	surface                  string
	totals                   invocationlog.AnalyticsReliabilityTotals
	lastEventAt              *time.Time
	unsupportedFallbackCount int64
	incidents                []invocationlog.AnalyticsReliabilityIncident
	aggregateErr             error
	incidentErr              error
}

func (r *QueryReader) GetAnalyticsReliability(
	ctx context.Context,
	filter invocationlog.AnalyticsReliabilityFilter,
) (invocationlog.AnalyticsReliabilityFields, error) {
	if r == nil || r.db == nil {
		return invocationlog.AnalyticsReliabilityFields{}, errors.New("query reader requires a database queryer")
	}

	normalized, err := invocationlog.NormalizeAnalyticsReliabilityFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsReliabilityFields{}, err
	}

	reads := make([]analyticsReliabilitySurfaceRead, 0, 2)
	for _, surface := range invocationlog.AnalyticsReliabilityRequestedSurfaces(normalized) {
		reads = append(reads, r.readAnalyticsReliabilitySurface(ctx, normalized, surface))
	}

	result, includedSources := aggregateAnalyticsReliability(normalized, reads)
	if includedSources == 0 {
		var sourceErrors []error
		for _, read := range reads {
			if read.aggregateErr != nil {
				sourceErrors = append(sourceErrors, read.aggregateErr)
			}
		}
		return invocationlog.AnalyticsReliabilityFields{}, fmt.Errorf(
			"%w: %v",
			invocationlog.ErrReliabilityDataUnavailable,
			errors.Join(sourceErrors...),
		)
	}
	return result, nil
}

func (r *QueryReader) readAnalyticsReliabilitySurface(
	ctx context.Context,
	filter invocationlog.AnalyticsReliabilityFilter,
	surface string,
) analyticsReliabilitySurfaceRead {
	read := analyticsReliabilitySurfaceRead{surface: surface}
	query, args := buildAnalyticsReliabilityTotalsQuery(filter, surface)
	var lastEventAt sql.NullTime
	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&read.totals.RequestCount,
		&read.totals.SuccessCount,
		&read.totals.FailedCount,
		&read.totals.BlockedCount,
		&read.totals.RateLimitedCount,
		&read.totals.CancelledCount,
		&read.totals.UnknownCount,
		&read.totals.FallbackRequestCount,
		&read.totals.FallbackSuccessCount,
		&read.unsupportedFallbackCount,
		&lastEventAt,
	); err != nil {
		read.aggregateErr = err
		return read
	}
	read.lastEventAt = nullableTimePointer(lastEventAt)

	incidentQuery, incidentArgs := buildAnalyticsReliabilityIncidentsQuery(filter, surface)
	rows, err := r.db.Query(ctx, incidentQuery, incidentArgs...)
	if err != nil {
		read.incidentErr = err
		return read
	}
	defer rows.Close()

	for rows.Next() {
		var incident invocationlog.AnalyticsReliabilityIncident
		var projectID sql.NullString
		var provider sql.NullString
		var model sql.NullString
		var httpStatus sql.NullInt64
		if err := rows.Scan(
			&incident.RequestID,
			&projectID,
			&provider,
			&model,
			&incident.CanonicalStatus,
			&incident.SourceOutcome,
			&incident.FallbackOutcome,
			&httpStatus,
			&incident.OccurredAt,
		); err != nil {
			read.incidentErr = err
			return read
		}
		incident.Surface = surface
		incident.ProjectID = nullableStringPointer(projectID)
		incident.Provider = nullableStringPointer(provider)
		incident.Model = nullableStringPointer(model)
		if httpStatus.Valid {
			value := int(httpStatus.Int64)
			incident.HTTPStatus = &value
		}
		incident.OccurredAt = incident.OccurredAt.UTC()
		read.incidents = append(read.incidents, incident)
	}
	read.incidentErr = rows.Err()
	return read
}

func aggregateAnalyticsReliability(
	filter invocationlog.AnalyticsReliabilityFilter,
	reads []analyticsReliabilitySurfaceRead,
) (invocationlog.AnalyticsReliabilityFields, int) {
	generatedAt := time.Now().UTC()
	result := invocationlog.AnalyticsReliabilityFields{
		Scope: invocationlog.AnalyticsReliabilityScope{
			TenantID:  filter.TenantID,
			Surface:   filter.Surface,
			ProjectID: stringPointerOrNil(filter.ProjectID),
			From:      filter.From.UTC(),
			To:        filter.To.UTC(),
		},
		GeneratedAt: generatedAt,
		Freshness: invocationlog.AnalyticsReliabilityFreshness{
			QueryStatus: invocationlog.AnalyticsReliabilityStatusOK,
			Complete:    true,
			Sources:     make([]invocationlog.AnalyticsReliabilitySourceFreshness, 0, len(reads)),
		},
		SurfaceTotals:   make([]invocationlog.AnalyticsReliabilitySurfaceTotals, 0, len(reads)),
		RecentIncidents: []invocationlog.AnalyticsReliabilityIncident{},
	}

	includedSources := 0
	for _, read := range reads {
		if read.aggregateErr != nil {
			result.Freshness.QueryStatus = invocationlog.AnalyticsReliabilityStatusPartial
			result.Freshness.Complete = false
			result.Freshness.Sources = append(result.Freshness.Sources, invocationlog.AnalyticsReliabilitySourceFreshness{
				Surface:     read.surface,
				QueryMode:   invocationlog.AnalyticsReliabilityQueryModeUnavailable,
				QueryStatus: invocationlog.AnalyticsReliabilityStatusUnavailable,
			})
			result.SurfaceTotals = append(result.SurfaceTotals, invocationlog.AnalyticsReliabilitySurfaceTotals{
				Surface:  read.surface,
				Included: false,
				Totals:   nil,
			})
			continue
		}

		includedSources++
		queryStatus := invocationlog.AnalyticsReliabilityStatusOK
		if read.incidentErr != nil || read.unsupportedFallbackCount > 0 || !analyticsReliabilityTotalsConserve(read.totals) {
			queryStatus = invocationlog.AnalyticsReliabilityStatusPartial
			result.Freshness.QueryStatus = invocationlog.AnalyticsReliabilityStatusPartial
			result.Freshness.Complete = false
		}
		result.Freshness.Sources = append(result.Freshness.Sources, invocationlog.AnalyticsReliabilitySourceFreshness{
			Surface:          read.surface,
			QueryMode:        invocationlog.AnalyticsReliabilityQueryModeRaw,
			QueryStatus:      queryStatus,
			LastEventAt:      read.lastEventAt,
			LastAggregatedAt: nil,
		})
		totals := read.totals
		result.SurfaceTotals = append(result.SurfaceTotals, invocationlog.AnalyticsReliabilitySurfaceTotals{
			Surface:  read.surface,
			Included: true,
			Totals:   &totals,
		})
		addAnalyticsReliabilityTotals(&result.Totals, read.totals)
		for _, incident := range read.incidents {
			incident.Surface = read.surface
			result.RecentIncidents = append(result.RecentIncidents, incident)
		}
	}

	if result.Totals.UnknownCount > 0 {
		result.Freshness.QueryStatus = invocationlog.AnalyticsReliabilityStatusPartial
		result.Freshness.Complete = false
	}
	result.Rates = analyticsReliabilityRates(result.Totals)
	result.TerminalOutcomes = analyticsReliabilityTerminalOutcomes(result.Totals)
	result.Continuity = analyticsReliabilityContinuity(result.Totals)
	sort.SliceStable(result.RecentIncidents, func(left, right int) bool {
		leftIncident := result.RecentIncidents[left]
		rightIncident := result.RecentIncidents[right]
		if !leftIncident.OccurredAt.Equal(rightIncident.OccurredAt) {
			return leftIncident.OccurredAt.After(rightIncident.OccurredAt)
		}
		if leftIncident.Surface != rightIncident.Surface {
			return leftIncident.Surface < rightIncident.Surface
		}
		return leftIncident.RequestID < rightIncident.RequestID
	})
	if len(result.RecentIncidents) > filter.IncidentLimit {
		result.RecentIncidents = result.RecentIncidents[:filter.IncidentLimit]
	}
	return result, includedSources
}

func buildAnalyticsReliabilityTotalsQuery(filter invocationlog.AnalyticsReliabilityFilter, surface string) (string, []any) {
	sourceCTE, args := buildAnalyticsReliabilitySourceCTE(filter, surface)
	return fmt.Sprintf(`
%s
select
	count(*)::bigint as request_count,
	count(*) filter (where canonical_status = 'success')::bigint as success_count,
	count(*) filter (where canonical_status = 'failed')::bigint as failed_count,
	count(*) filter (where canonical_status = 'blocked')::bigint as blocked_count,
	count(*) filter (where canonical_status = 'rate_limited')::bigint as rate_limited_count,
	count(*) filter (where canonical_status = 'cancelled')::bigint as cancelled_count,
	count(*) filter (where canonical_status = 'unknown')::bigint as unknown_count,
	count(*) filter (where fallback_attempted)::bigint as fallback_request_count,
	count(*) filter (where fallback_outcome = 'success' and canonical_status = 'success')::bigint as fallback_success_count,
	count(*) filter (where fallback_unsupported)::bigint as unsupported_fallback_count,
	max(occurred_at) as last_event_at
from source`, sourceCTE), args
}

func buildAnalyticsReliabilityIncidentsQuery(filter invocationlog.AnalyticsReliabilityFilter, surface string) (string, []any) {
	sourceCTE, args := buildAnalyticsReliabilitySourceCTE(filter, surface)
	args = append(args, filter.IncidentLimit)
	return fmt.Sprintf(`
%s
select
	request_id,
	project_id,
	provider_key,
	model_key,
	canonical_status,
	source_outcome,
	fallback_outcome,
	http_status,
	occurred_at
from source
where canonical_status in ('failed', 'cancelled')
	 or fallback_outcome in ('success', 'failed', 'unknown')
order by occurred_at desc, request_id
limit $%d`, sourceCTE, len(args)), args
}

func buildAnalyticsReliabilitySourceCTE(filter invocationlog.AnalyticsReliabilityFilter, surface string) (string, []any) {
	if surface == invocationlog.AnalyticsReliabilitySurfaceTenantChat {
		return buildTenantChatReliabilitySourceCTE(filter)
	}
	return buildProjectApplicationReliabilitySourceCTE(filter)
}

func buildProjectApplicationReliabilitySourceCTE(filter invocationlog.AnalyticsReliabilityFilter) (string, []any) {
	where, args := analyticsReliabilityWhere(filter, "created_at", true)
	terminal := terminalStatusSQL
	fallback := metadataOutcomeSQL("fallback", "'not_called'")
	return fmt.Sprintf(`with source as (
	select
		request_id,
		project_id::text as project_id,
		nullif(provider, '') as provider_key,
		nullif(model, '') as model_key,
		case
			when %[1]s in ('success', 'failed', 'blocked', 'rate_limited', 'cancelled') then %[1]s
			else 'unknown'
		end as canonical_status,
		case
			when %[1]s in ('success', 'failed', 'blocked', 'rate_limited', 'cancelled') then %[1]s
			else 'unknown'
		end as source_outcome,
		case
			when %[2]s = 'success' then 'success'
			when %[2]s = 'failed' then 'failed'
			when %[2]s in ('not_needed', 'disabled', 'not_called') then 'not_attempted'
			else 'unknown'
		end as fallback_outcome,
		%[2]s in ('success', 'failed') as fallback_attempted,
		%[2]s not in ('success', 'failed', 'not_needed', 'disabled', 'not_called') as fallback_unsupported,
		http_status,
		created_at as occurred_at
	from p0_llm_invocation_logs
	where %s
)`, terminal, fallback, strings.Join(where, " and ")), args
}

func buildTenantChatReliabilitySourceCTE(filter invocationlog.AnalyticsReliabilityFilter) (string, []any) {
	where, args := analyticsReliabilityWhere(filter, "completed_at", false)
	tenantPredicate := "1 = 0"
	if isPostgresUUID(filter.TenantID) {
		tenantPredicate = "attempt.tenant_id = $1"
	}
	return fmt.Sprintf(`with scoped_logs as (
	select
		request_id,
		nullif(effective_provider_id, '') as provider_key,
		nullif(effective_model_key, '') as model_key,
		terminal_outcome,
		completed_at
	from tenant_chat_invocation_logs
	where %s
), fallback_attempts as (
	select
		attempt.request_id,
		bool_or(attempt.outcome = 'succeeded') as succeeded,
		bool_or(attempt.outcome is null or attempt.outcome not in ('succeeded', 'failed_pre_delta', 'failed_post_delta', 'cancelled', 'timed_out')) as unsupported
	from tenant_chat_provider_attempts attempt
	join scoped_logs logs on logs.request_id = attempt.request_id
	where %s and attempt.kind = 'fallback'
	group by attempt.request_id
), source as (
	select
		logs.request_id,
		null::text as project_id,
		logs.provider_key,
		logs.model_key,
		case
			when logs.terminal_outcome in ('succeeded', 'cache_hit') then 'success'
			when logs.terminal_outcome in ('failed', 'provider_failed', 'provider_timeout', 'runtime_unavailable', 'no_eligible_route') then 'failed'
			when logs.terminal_outcome in ('concurrency_limited', 'safety_blocked', 'policy_ack_required', 'quota_blocked', 'budget_blocked') then 'blocked'
			when logs.terminal_outcome = 'rate_limited' then 'rate_limited'
			when logs.terminal_outcome = 'cancelled' then 'cancelled'
			else 'unknown'
		end as canonical_status,
		case
			when logs.terminal_outcome in (
				'succeeded', 'cache_hit', 'failed', 'provider_failed', 'provider_timeout', 'runtime_unavailable',
				'no_eligible_route', 'concurrency_limited', 'safety_blocked', 'policy_ack_required',
				'quota_blocked', 'budget_blocked', 'rate_limited', 'cancelled'
			) then logs.terminal_outcome
			else 'unknown'
		end as source_outcome,
		case
			when fallback.request_id is null then 'not_attempted'
			when fallback.succeeded then 'success'
			when fallback.unsupported then 'unknown'
			else 'failed'
		end as fallback_outcome,
		fallback.request_id is not null as fallback_attempted,
		coalesce(fallback.unsupported, false) as fallback_unsupported,
		null::integer as http_status,
		logs.completed_at as occurred_at
	from scoped_logs logs
	left join fallback_attempts fallback on fallback.request_id = logs.request_id
)`, strings.Join(where, " and "), tenantPredicate), args
}

func analyticsReliabilityWhere(
	filter invocationlog.AnalyticsReliabilityFilter,
	timeColumn string,
	includeProject bool,
) ([]string, []any) {
	args := []any{}
	where := []string{}
	if isPostgresUUID(filter.TenantID) {
		args = append(args, filter.TenantID)
		where = append(where, "tenant_id = $1")
	} else {
		where = append(where, "1 = 0")
	}
	args = append(args, filter.From.UTC())
	where = append(where, fmt.Sprintf("%s >= $%d", timeColumn, len(args)))
	args = append(args, filter.To.UTC())
	where = append(where, fmt.Sprintf("%s < $%d", timeColumn, len(args)))
	if includeProject && filter.ProjectID != "" {
		addUUIDWhere(&where, &args, "project_id", filter.ProjectID)
	}
	if !includeProject {
		where = append(where, "surface = 'tenant_chat'", "execution_scope_kind = 'tenant_chat'")
	}
	return where, args
}

func addAnalyticsReliabilityTotals(target *invocationlog.AnalyticsReliabilityTotals, value invocationlog.AnalyticsReliabilityTotals) {
	target.RequestCount += value.RequestCount
	target.SuccessCount += value.SuccessCount
	target.FailedCount += value.FailedCount
	target.BlockedCount += value.BlockedCount
	target.RateLimitedCount += value.RateLimitedCount
	target.CancelledCount += value.CancelledCount
	target.UnknownCount += value.UnknownCount
	target.FallbackRequestCount += value.FallbackRequestCount
	target.FallbackSuccessCount += value.FallbackSuccessCount
}

func analyticsReliabilityTotalsConserve(totals invocationlog.AnalyticsReliabilityTotals) bool {
	terminalTotal := totals.SuccessCount + totals.FailedCount + totals.BlockedCount +
		totals.RateLimitedCount + totals.CancelledCount + totals.UnknownCount
	return terminalTotal == totals.RequestCount &&
		totals.FallbackSuccessCount <= totals.FallbackRequestCount &&
		totals.FallbackSuccessCount <= totals.SuccessCount
}

func analyticsReliabilityRates(totals invocationlog.AnalyticsReliabilityTotals) invocationlog.AnalyticsReliabilityRates {
	return invocationlog.AnalyticsReliabilityRates{
		SuccessRate:          analyticsReliabilityRate(totals.SuccessCount, totals.RequestCount),
		SystemErrorRate:      analyticsReliabilityRate(totals.FailedCount, totals.RequestCount),
		FallbackRecoveryRate: analyticsReliabilityRate(totals.FallbackSuccessCount, totals.FallbackRequestCount),
	}
}

func analyticsReliabilityRate(numerator int64, denominator int64) *float64 {
	if denominator <= 0 {
		return nil
	}
	value := float64(numerator) / float64(denominator)
	return &value
}

func analyticsReliabilityTerminalOutcomes(totals invocationlog.AnalyticsReliabilityTotals) []invocationlog.AnalyticsReliabilityOutcome {
	return []invocationlog.AnalyticsReliabilityOutcome{
		{Outcome: "success", RequestCount: totals.SuccessCount},
		{Outcome: "failed", RequestCount: totals.FailedCount},
		{Outcome: "blocked", RequestCount: totals.BlockedCount},
		{Outcome: "rate_limited", RequestCount: totals.RateLimitedCount},
		{Outcome: "cancelled", RequestCount: totals.CancelledCount},
		{Outcome: "unknown", RequestCount: totals.UnknownCount},
	}
}

func analyticsReliabilityContinuity(totals invocationlog.AnalyticsReliabilityTotals) invocationlog.AnalyticsReliabilityContinuity {
	successWithoutFallback := totals.SuccessCount - totals.FallbackSuccessCount
	if successWithoutFallback < 0 {
		successWithoutFallback = 0
	}
	return invocationlog.AnalyticsReliabilityContinuity{
		SuccessWithoutFallbackCount: successWithoutFallback,
		FallbackRecoveredCount:      totals.FallbackSuccessCount,
		FailedCount:                 totals.FailedCount,
		CancelledCount:              totals.CancelledCount,
		ExcludedPolicyCount:         totals.BlockedCount + totals.RateLimitedCount,
		UnknownCount:                totals.UnknownCount,
	}
}

func nullableStringPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	normalized := strings.TrimSpace(value.String)
	if normalized == "" {
		return nil
	}
	return &normalized
}

func stringPointerOrNil(value string) *string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return nil
	}
	return &normalized
}
