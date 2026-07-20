package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"

	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/errgroup"
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
	db                              Queryer
	analyticsPolicyImpactReadMode   string
	analyticsPolicyImpactMaxRawTail time.Duration
}

func NewQueryReader(db Queryer) *QueryReader {
	return NewQueryReaderWithOptions(db, QueryReaderOptions{})
}

type QueryReaderOptions struct {
	AnalyticsPolicyImpactReadMode   string
	AnalyticsPolicyImpactMaxRawTail time.Duration
}

func NewQueryReaderWithOptions(db Queryer, options QueryReaderOptions) *QueryReader {
	readMode := strings.ToLower(strings.TrimSpace(options.AnalyticsPolicyImpactReadMode))
	if readMode != "rollup" {
		readMode = "raw"
	}
	maxRawTail := options.AnalyticsPolicyImpactMaxRawTail
	if maxRawTail <= 0 {
		maxRawTail = 2 * time.Minute
	}
	return &QueryReader{
		db:                              db,
		analyticsPolicyImpactReadMode:   readMode,
		analyticsPolicyImpactMaxRawTail: maxRawTail,
	}
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

func (r *QueryReader) ListProjectLogFilterOptions(ctx context.Context, filter invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error) {
	if r == nil || r.db == nil {
		return invocationlog.RequestLogFilterOptions{}, errors.New("query reader requires a database queryer")
	}

	normalizedFilter, err := normalizeProjectLogFilterOptionsFilter(filter)
	if err != nil {
		return invocationlog.RequestLogFilterOptions{}, err
	}
	query, args := buildProjectLogFilterOptionsQuery(normalizedFilter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return invocationlog.RequestLogFilterOptions{}, err
	}
	defer rows.Close()

	modelSet := map[string]struct{}{}
	budgetScopeSet := map[string]budget.Scope{}
	for rows.Next() {
		var optionType string
		var model sql.NullString
		var budgetScopeType sql.NullString
		var budgetScopeID sql.NullString
		var budgetScopeResolvedBy sql.NullString
		if err := rows.Scan(&optionType, &model, &budgetScopeType, &budgetScopeID, &budgetScopeResolvedBy); err != nil {
			return invocationlog.RequestLogFilterOptions{}, err
		}
		switch optionType {
		case "requested_model":
			value := strings.TrimSpace(nullableString(model))
			if value != "" {
				modelSet[value] = struct{}{}
			}
		case "budget_scope":
			scope := budget.NormalizeScope(budget.Scope{
				Type:       nullableString(budgetScopeType),
				ID:         nullableString(budgetScopeID),
				ResolvedBy: nullableString(budgetScopeResolvedBy),
			}, "")
			if scope.ID == "" {
				continue
			}
			budgetScopeSet[scope.Type+":"+scope.ID+":"+scope.ResolvedBy] = scope
		}
	}
	if err := rows.Err(); err != nil {
		return invocationlog.RequestLogFilterOptions{}, err
	}

	models := make([]string, 0, len(modelSet))
	for model := range modelSet {
		models = append(models, model)
	}
	sort.Strings(models)

	budgetScopes := make([]budget.Scope, 0, len(budgetScopeSet))
	for _, scope := range budgetScopeSet {
		budgetScopes = append(budgetScopes, scope)
	}
	sort.Slice(budgetScopes, func(i int, j int) bool {
		if budgetScopes[i].Type != budgetScopes[j].Type {
			return budgetScopes[i].Type < budgetScopes[j].Type
		}
		if budgetScopes[i].ID != budgetScopes[j].ID {
			return budgetScopes[i].ID < budgetScopes[j].ID
		}
		return budgetScopes[i].ResolvedBy < budgetScopes[j].ResolvedBy
	})

	return invocationlog.RequestLogFilterOptions{
		RequestedModels: models,
		BudgetScopes:    budgetScopes,
	}, nil
}

func (r *QueryReader) GetRequestDetail(ctx context.Context, filter invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error) {
	if r == nil || r.db == nil {
		return invocationlog.RequestDetail{}, errors.New("query reader requires a database queryer")
	}

	normalizedFilter, err := invocationlog.NormalizeRequestDetailFilter(filter)
	if err != nil {
		return invocationlog.RequestDetail{}, err
	}
	if !isPostgresUUID(normalizedFilter.TenantID) || !isPostgresUUID(normalizedFilter.ProjectID) {
		return invocationlog.RequestDetail{}, invocationlog.ErrLogNotFound
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
	if overview, used, err := r.tryGetDashboardOverviewFromRollups(ctx, normalizedFilter, time.Now().UTC()); err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	} else if used {
		return overview, nil
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
	var averageTTFTMs sql.NullFloat64
	var p50TTFTMs sql.NullFloat64
	var p95TTFTMs sql.NullFloat64
	var p99TTFTMs sql.NullFloat64
	var eligibleStreamRequests int64
	var observedTTFTRequests int64
	var statusCountsJSON []byte
	var maskingActionCountsJSON []byte
	var safetyOutcomeCountsJSON []byte
	var cacheOutcomeCountsJSON []byte
	var fallbackOutcomeCountsJSON []byte
	var budgetOutcomeCountsJSON []byte
	var routingCountByModelJSON []byte
	var costByModelJSON []byte
	var projectBreakdownJSON []byte
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
		&averageTTFTMs,
		&p50TTFTMs,
		&p95TTFTMs,
		&p99TTFTMs,
		&eligibleStreamRequests,
		&observedTTFTRequests,
		&statusCountsJSON,
		&maskingActionCountsJSON,
		&safetyOutcomeCountsJSON,
		&cacheOutcomeCountsJSON,
		&fallbackOutcomeCountsJSON,
		&budgetOutcomeCountsJSON,
		&routingCountByModelJSON,
		&costByModelJSON,
		&projectBreakdownJSON,
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
	budgetOutcomeCounts, err := decodeInt64MapJSON(budgetOutcomeCountsJSON)
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
	projectBreakdown, err := decodeProjectBreakdownJSON(projectBreakdownJSON)
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
		AverageTTFTMs:               nullableFloat64Pointer(averageTTFTMs),
		P50TTFTMs:                   nullableFloat64Pointer(p50TTFTMs),
		P95TTFTMs:                   nullableFloat64Pointer(p95TTFTMs),
		P99TTFTMs:                   nullableFloat64Pointer(p99TTFTMs),
		EligibleStreamRequests:      eligibleStreamRequests,
		ObservedTTFTRequests:        observedTTFTRequests,
		MaskingActionCounts:         maskingActionCounts,
		RoutingCountByModel:         routingCountByModel,
		StatusCounts:                statusCounts,
		SafetyOutcomeCounts:         safetyOutcomeCounts,
		CacheOutcomeCounts:          cacheOutcomeCounts,
		FallbackOutcomeCounts:       fallbackOutcomeCounts,
		BudgetOutcomeCounts:         budgetOutcomeCounts,
		ProjectBreakdown:            projectBreakdown,
		ApplicationBreakdown:        applicationBreakdown,
		CostByModel:                 costByModel,
		BudgetScopeBreakdown:        budgetScopeBreakdown,
		LastLogCreatedAt:            nullableTimePointer(lastLogCreatedAt),
		GeneratedAt:                 time.Now().UTC(),
	}), nil
}

func (r *QueryReader) GetCostReport(ctx context.Context, filter invocationlog.CostReportFilter) (invocationlog.CostReportFields, error) {
	if r == nil || r.db == nil {
		return invocationlog.CostReportFields{}, errors.New("query reader requires a database queryer")
	}

	normalizedFilter, err := invocationlog.NormalizeCostReportFilter(filter)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}
	generatedAt := time.Now().UTC()
	if report, used, err := r.tryGetCostReportFromRollups(ctx, normalizedFilter, generatedAt); err != nil {
		return invocationlog.CostReportFields{}, err
	} else if used {
		return report, nil
	}

	buckets, lastLogCreatedAt, err := r.queryCostReportBuckets(ctx, normalizedFilter)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}
	projectBreakdown, err := r.queryCostReportProjectBreakdown(ctx, normalizedFilter)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}
	applicationBreakdown, err := r.queryCostReportApplicationBreakdown(ctx, normalizedFilter)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}
	modelBreakdown, modelBuckets, err := r.queryCostReportModelBreakdown(ctx, normalizedFilter)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}
	budgetScopeBreakdown, err := r.queryCostReportBudgetScopeBreakdown(ctx, normalizedFilter)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}

	totals := invocationlog.CostReportTotals{}
	for _, bucket := range buckets {
		totals.RequestCount += bucket.RequestCount
		totals.PromptTokens += bucket.PromptTokens
		totals.CompletionTokens += bucket.CompletionTokens
		totals.TotalTokens += bucket.TotalTokens
		totals.CostMicroUSD += bucket.CostMicroUSD
		totals.SavedCostMicroUSD += bucket.SavedCostMicroUSD
	}
	totals.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(totals.CostMicroUSD)
	totals.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(totals.SavedCostMicroUSD)

	bucketConfig := costReportBucketConfig(normalizedFilter)
	return invocationlog.CostReportFields{
		Period:              normalizedFilter.Period,
		BucketInterval:      bucketConfig.IntervalLabel,
		ExpectedBucketCount: bucketConfig.ExpectedBucketCount,
		Totals:              totals,
		Buckets:             buckets,
		ModelBuckets:        modelBuckets,
		Breakdowns: invocationlog.CostReportBreakdowns{
			ByProject:     projectBreakdown,
			ByApplication: applicationBreakdown,
			ByModel:       modelBreakdown,
			ByBudgetScope: budgetScopeBreakdown,
		},
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           "request_log",
			RecordCount:      totals.RequestCount,
			LastLogCreatedAt: lastLogCreatedAt,
			GeneratedAt:      generatedAt,
			LastAggregatedAt: generatedAt,
			IsStale:          false,
		},
	}, nil
}

func (r *QueryReader) GetAnalyticsPerformance(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error) {
	if r == nil || r.db == nil {
		return invocationlog.AnalyticsPerformanceFields{}, errors.New("query reader requires a database queryer")
	}

	normalizedFilter, err := invocationlog.NormalizeAnalyticsPerformanceFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsPerformanceFields{}, err
	}

	var surfaceSummaries []invocationlog.AnalyticsSurfaceSummary
	var providerModelPerformance []invocationlog.AnalyticsProviderModelPerformance
	var p95LatencyByProvider []invocationlog.AnalyticsProviderLatency
	var latencyDistribution []invocationlog.AnalyticsLatencyDistributionBucket
	var slowestRequests []invocationlog.AnalyticsSlowRequest

	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		var err error
		surfaceSummaries, err = r.queryAnalyticsPerformanceSummaries(groupCtx, normalizedFilter)
		return err
	})
	group.Go(func() error {
		var err error
		providerModelPerformance, err = r.queryAnalyticsProviderModelPerformance(groupCtx, normalizedFilter)
		return err
	})
	group.Go(func() error {
		var err error
		p95LatencyByProvider, err = r.queryAnalyticsP95LatencyByProvider(groupCtx, normalizedFilter)
		return err
	})
	group.Go(func() error {
		var err error
		latencyDistribution, err = r.queryAnalyticsLatencyDistribution(groupCtx, normalizedFilter)
		return err
	})
	group.Go(func() error {
		var err error
		slowestRequests, err = r.queryAnalyticsSlowestRequests(groupCtx, normalizedFilter)
		return err
	})
	if err := group.Wait(); err != nil {
		return invocationlog.AnalyticsPerformanceFields{}, err
	}

	summary, lastLogCreatedAt := aggregateAnalyticsPerformanceSummaries(normalizedFilter, surfaceSummaries)
	generatedAt := time.Now().UTC()
	bucketConfig := invocationlog.TimeSeriesBucketConfigForRange(normalizedFilter.From, normalizedFilter.To)
	return invocationlog.AnalyticsPerformanceFields{
		Summary:                  summary,
		SurfaceSummaries:         surfaceSummaries,
		ProviderModelPerformance: providerModelPerformance,
		P95LatencyByProvider:     p95LatencyByProvider,
		LatencyDistribution:      latencyDistribution,
		SlowestRequests:          slowestRequests,
		BucketInterval:           bucketConfig.IntervalLabel,
		ExpectedBucketCount:      bucketConfig.ExpectedBucketCount,
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           analyticsPerformanceDataSource(normalizedFilter),
			RecordCount:      summary.TotalRequests,
			LastLogCreatedAt: lastLogCreatedAt,
			GeneratedAt:      generatedAt,
			LastAggregatedAt: generatedAt,
			IsStale:          false,
		},
	}, nil
}

func (r *QueryReader) queryAnalyticsPerformanceSummaries(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsSurfaceSummary, error) {
	query, args := buildAnalyticsPerformanceSummaryQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.AnalyticsSurfaceSummary{}
	for rows.Next() {
		var item invocationlog.AnalyticsSurfaceSummary
		var avgLatencyMs sql.NullFloat64
		var p95LatencyMs sql.NullFloat64
		var p99LatencyMs sql.NullFloat64
		var errorRate sql.NullFloat64
		var lastEventAt sql.NullTime
		if err := rows.Scan(
			&item.Surface,
			&item.Summary.TotalRequests,
			&avgLatencyMs,
			&p95LatencyMs,
			&p99LatencyMs,
			&item.Summary.SystemErrorRequests,
			&errorRate,
			&lastEventAt,
		); err != nil {
			return nil, err
		}
		item.Summary.AvgLatencyMs = nullableFloat64Pointer(avgLatencyMs)
		item.Summary.P95LatencyMs = nullableFloat64Pointer(p95LatencyMs)
		item.Summary.P99LatencyMs = nullableFloat64Pointer(p99LatencyMs)
		item.Summary.ErrorRate = nullableFloat64Pointer(errorRate)
		item.Summary.ThroughputPerMinute = analyticsThroughput(item.Summary.TotalRequests, filter)
		item.LastEventAt = nullableTimePointer(lastEventAt)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return fillAnalyticsPerformanceSurfaceSummaries(filter, items), nil
}

func (r *QueryReader) queryAnalyticsProviderModelPerformance(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsProviderModelPerformance, error) {
	query, args := buildAnalyticsProviderModelPerformanceQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.AnalyticsProviderModelPerformance{}
	for rows.Next() {
		var item invocationlog.AnalyticsProviderModelPerformance
		var avgLatencyMs sql.NullFloat64
		var p95LatencyMs sql.NullFloat64
		var p99LatencyMs sql.NullFloat64
		var errorRate sql.NullFloat64
		var cacheHitRate sql.NullFloat64
		if err := rows.Scan(
			&item.Surface,
			&item.Provider,
			&item.Model,
			&item.Requests,
			&avgLatencyMs,
			&p95LatencyMs,
			&p99LatencyMs,
			&errorRate,
			&item.TotalCostMicroUSD,
			&cacheHitRate,
		); err != nil {
			return nil, err
		}
		item.AvgLatencyMs = nullableFloat64Pointer(avgLatencyMs)
		item.P95LatencyMs = nullableFloat64Pointer(p95LatencyMs)
		item.P99LatencyMs = nullableFloat64Pointer(p99LatencyMs)
		item.ErrorRate = nullableFloat64Pointer(errorRate)
		item.CacheHitRate = nullableFloat64Pointer(cacheHitRate)
		item.TotalCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.TotalCostMicroUSD)
		if item.Requests > 0 {
			costPerRequest := float64(item.TotalCostMicroUSD) / 1_000_000 / float64(item.Requests)
			item.CostPerRequestUSD = &costPerRequest
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryAnalyticsP95LatencyByProvider(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsProviderLatency, error) {
	query, args := buildAnalyticsP95LatencyByProviderQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.AnalyticsProviderLatency{}
	for rows.Next() {
		var item invocationlog.AnalyticsProviderLatency
		var p95LatencyMs sql.NullFloat64
		if err := rows.Scan(&item.Surface, &item.Provider, &p95LatencyMs, &item.Requests); err != nil {
			return nil, err
		}
		item.P95LatencyMs = nullableFloat64Pointer(p95LatencyMs)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryAnalyticsLatencyDistribution(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsLatencyDistributionBucket, error) {
	query, args := buildAnalyticsLatencyDistributionQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.AnalyticsLatencyDistributionBucket{}
	for rows.Next() {
		var item invocationlog.AnalyticsLatencyDistributionBucket
		var p50LatencyMs sql.NullFloat64
		var p95LatencyMs sql.NullFloat64
		var p99LatencyMs sql.NullFloat64
		if err := rows.Scan(&item.Surface, &item.Bucket, &item.Requests, &p50LatencyMs, &p95LatencyMs, &p99LatencyMs); err != nil {
			return nil, err
		}
		item.Bucket = item.Bucket.UTC()
		item.P50LatencyMs = nullableFloat64Pointer(p50LatencyMs)
		item.P95LatencyMs = nullableFloat64Pointer(p95LatencyMs)
		item.P99LatencyMs = nullableFloat64Pointer(p99LatencyMs)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return fillAnalyticsLatencyDistributionBuckets(filter, items), nil
}

func (r *QueryReader) queryAnalyticsSlowestRequests(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) ([]invocationlog.AnalyticsSlowRequest, error) {
	query, args := buildAnalyticsSlowestRequestsQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.AnalyticsSlowRequest{}
	for rows.Next() {
		var item invocationlog.AnalyticsSlowRequest
		var projectID sql.NullString
		var httpStatus sql.NullInt64
		if err := rows.Scan(
			&item.Surface,
			&item.RequestID,
			&projectID,
			&item.Provider,
			&item.Model,
			&item.LatencyMs,
			&httpStatus,
			&item.TerminalStatus,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		if projectID.Valid {
			item.ProjectID = projectID.String
		}
		if httpStatus.Valid {
			item.HTTPStatus = int(httpStatus.Int64)
		}
		item.CreatedAt = item.CreatedAt.UTC()
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryCostReportBuckets(ctx context.Context, filter invocationlog.CostReportFilter) ([]invocationlog.CostReportBucket, *time.Time, error) {
	query, args := buildCostReportBucketsQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	buckets := []invocationlog.CostReportBucket{}
	var maxLastLog time.Time
	var hasLastLog bool
	for rows.Next() {
		var bucket invocationlog.CostReportBucket
		var lastLog sql.NullTime
		if err := rows.Scan(
			&bucket.PeriodStart,
			&bucket.RequestCount,
			&bucket.PromptTokens,
			&bucket.CompletionTokens,
			&bucket.TotalTokens,
			&bucket.CostMicroUSD,
			&bucket.SavedCostMicroUSD,
			&lastLog,
		); err != nil {
			return nil, nil, err
		}
		bucket.PeriodStart = bucket.PeriodStart.UTC()
		bucket.PeriodEnd = costReportBucketEnd(bucket.PeriodStart, filter.Period)
		bucket.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(bucket.CostMicroUSD)
		bucket.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(bucket.SavedCostMicroUSD)
		if lastLog.Valid {
			last := lastLog.Time.UTC()
			if !hasLastLog || last.After(maxLastLog) {
				maxLastLog = last
				hasLastLog = true
			}
		}
		buckets = append(buckets, bucket)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	buckets = fillCostReportBuckets(filter, buckets)
	var lastLogCreatedAt *time.Time
	if hasLastLog {
		lastLogCreatedAt = &maxLastLog
	}
	return buckets, lastLogCreatedAt, nil
}

func (r *QueryReader) queryCostReportProjectBreakdown(ctx context.Context, filter invocationlog.CostReportFilter) ([]invocationlog.CostReportProjectBreakdown, error) {
	query, args := buildCostReportProjectBreakdownQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.CostReportProjectBreakdown{}
	for rows.Next() {
		var item invocationlog.CostReportProjectBreakdown
		if err := rows.Scan(&item.ProjectID, &item.RequestCount, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens, &item.CostMicroUSD, &item.SavedCostMicroUSD); err != nil {
			return nil, err
		}
		item.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		item.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.SavedCostMicroUSD)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryCostReportApplicationBreakdown(ctx context.Context, filter invocationlog.CostReportFilter) ([]invocationlog.CostReportApplicationBreakdown, error) {
	query, args := buildCostReportApplicationBreakdownQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.CostReportApplicationBreakdown{}
	for rows.Next() {
		var item invocationlog.CostReportApplicationBreakdown
		if err := rows.Scan(&item.ApplicationID, &item.RequestCount, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens, &item.CostMicroUSD, &item.SavedCostMicroUSD); err != nil {
			return nil, err
		}
		item.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		item.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.SavedCostMicroUSD)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryCostReportModelBreakdown(ctx context.Context, filter invocationlog.CostReportFilter) ([]invocationlog.CostReportModelBreakdown, []invocationlog.CostReportModelBucket, error) {
	query, args := buildCostReportModelBreakdownQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	models := map[string]invocationlog.CostReportModelBreakdown{}
	buckets := map[string]invocationlog.CostReportModelBucket{}
	for rows.Next() {
		var periodStart time.Time
		var item invocationlog.CostReportModelBreakdown
		if err := rows.Scan(&periodStart, &item.Provider, &item.Model, &item.RequestCount, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens, &item.CostMicroUSD, &item.SavedCostMicroUSD); err != nil {
			return nil, nil, err
		}
		modelKey := item.Provider + "\x00" + item.Model
		total := models[modelKey]
		total.Provider = item.Provider
		total.Model = item.Model
		total.RequestCount += item.RequestCount
		total.PromptTokens += item.PromptTokens
		total.CompletionTokens += item.CompletionTokens
		total.TotalTokens += item.TotalTokens
		total.CostMicroUSD += item.CostMicroUSD
		total.SavedCostMicroUSD += item.SavedCostMicroUSD
		models[modelKey] = total

		periodStart = costReportOutputBucketStart(filter, periodStart)
		bucketKey := periodStart.Format(time.RFC3339Nano) + "\x00" + modelKey
		bucket := buckets[bucketKey]
		bucket.PeriodStart = periodStart
		bucket.Provider = item.Provider
		bucket.Model = item.Model
		bucket.RequestCount += item.RequestCount
		buckets[bucketKey] = bucket
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	modelItems := finalizedCostReportModels(models)
	return modelItems, finalizedCostReportModelBuckets(filter, buckets, modelItems), nil
}

func (r *QueryReader) queryCostReportBudgetScopeBreakdown(ctx context.Context, filter invocationlog.CostReportFilter) ([]invocationlog.CostReportBudgetScopeBreakdown, error) {
	query, args := buildCostReportBudgetScopeBreakdownQuery(filter)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.CostReportBudgetScopeBreakdown{}
	for rows.Next() {
		var item invocationlog.CostReportBudgetScopeBreakdown
		if err := rows.Scan(&item.BudgetScope.Type, &item.BudgetScope.ID, &item.BudgetScope.ResolvedBy, &item.RequestCount, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens, &item.CostMicroUSD, &item.SavedCostMicroUSD); err != nil {
			return nil, err
		}
		item.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		item.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.SavedCostMicroUSD)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func buildCostReportBucketsQuery(filter invocationlog.CostReportFilter) (string, []any) {
	whereSQL, args := buildCostReportWhere(filter)
	bucketExpression := costReportBucketExpression(filter)
	query := fmt.Sprintf(`
select
  %s as period_start,
  count(*)::bigint as request_count,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd,
  max(created_at) as last_log_created_at
from p0_llm_invocation_logs
where %s
group by 1
order by 1`, bucketExpression, whereSQL)
	return query, args
}

func buildCostReportProjectBreakdownQuery(filter invocationlog.CostReportFilter) (string, []any) {
	whereSQL, args := buildCostReportWhere(filter)
	query := fmt.Sprintf(`
select
  project_id::text as project_id,
  count(*)::bigint as request_count,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd
from p0_llm_invocation_logs
where %s and project_id is not null
group by 1
order by cost_micro_usd desc, project_id
limit 100`, whereSQL)
	return query, args
}

func buildCostReportApplicationBreakdownQuery(filter invocationlog.CostReportFilter) (string, []any) {
	whereSQL, args := buildCostReportWhere(filter)
	query := fmt.Sprintf(`
select
  application_id::text as application_id,
  count(*)::bigint as request_count,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd
from p0_llm_invocation_logs
where %s and application_id is not null
group by 1
order by cost_micro_usd desc, application_id
limit 100`, whereSQL)
	return query, args
}

func buildCostReportModelBreakdownQuery(filter invocationlog.CostReportFilter) (string, []any) {
	whereSQL, args := buildCostReportWhere(filter)
	query := fmt.Sprintf(`
with filtered as (
  select
	%s as period_start,
    nullif(provider, '') as provider_key,
    nullif(model, '') as model_key,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost_micro_usd,
    saved_cost_micro_usd
  from p0_llm_invocation_logs
  where %s
), top_models as (
  select provider_key, model_key
  from filtered
  where provider_key is not null and model_key is not null
  group by 1, 2
  order by coalesce(sum(cost_micro_usd), 0) desc, provider_key, model_key
  limit 100
)
select
	f.period_start,
  f.provider_key,
  f.model_key,
  count(*)::bigint as request_count,
  coalesce(sum(f.prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(f.completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(f.total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(f.cost_micro_usd), 0)::bigint as cost_micro_usd,
  coalesce(sum(f.saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd
from filtered f
join top_models t on t.provider_key = f.provider_key and t.model_key = f.model_key
group by 1, 2, 3
order by 1, cost_micro_usd desc, f.provider_key, f.model_key`, costReportBucketExpression(filter), whereSQL)
	return query, args
}

func buildCostReportBudgetScopeBreakdownQuery(filter invocationlog.CostReportFilter) (string, []any) {
	whereSQL, args := buildCostReportWhere(filter)
	query := fmt.Sprintf(`
select *
from (
  select
    %s as budget_scope_type,
    %s as budget_scope_id,
    %s as budget_scope_resolved_by,
    count(*)::bigint as request_count,
    coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
    coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
    coalesce(sum(total_tokens), 0)::bigint as total_tokens,
    coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
    coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd
  from p0_llm_invocation_logs
  where %s
  group by 1, 2, 3
) budget_scope_rollup
where budget_scope_id is not null and budget_scope_id <> ''
order by cost_micro_usd desc, budget_scope_type, budget_scope_id, budget_scope_resolved_by
limit 100`, budgetScopeTypeSQL, budgetScopeIDSQL, budgetScopeResolvedBySQL, whereSQL)
	return query, args
}

func buildCostReportWhere(filter invocationlog.CostReportFilter) (string, []any) {
	args := []any{filter.From.UTC(), filter.To.UTC()}
	where := []string{
		"created_at >= $1",
		"created_at < $2",
	}
	addOptionalUUIDWhere := func(expression string, value string) {
		addUUIDWhere(&where, &args, expression, value)
	}
	addOptionalWhere := func(expression string, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		args = append(args, value)
		where = append(where, fmt.Sprintf("%s = $%d", expression, len(args)))
	}

	addOptionalUUIDWhere("tenant_id", filter.TenantID)
	addOptionalUUIDWhere("project_id", filter.ProjectID)
	addOptionalUUIDWhere("application_id", filter.ApplicationID)
	addOptionalWhere("provider", filter.Provider)
	addOptionalWhere("model", filter.Model)
	addOptionalWhere(budgetScopeTypeSQL, filter.BudgetScope.Type)
	addOptionalWhere(budgetScopeIDSQL, filter.BudgetScope.ID)
	addOptionalWhere(budgetScopeResolvedBySQL, filter.BudgetScope.ResolvedBy)

	return strings.Join(where, " and "), args
}

func costReportBucketExpression(filter invocationlog.CostReportFilter) string {
	switch filter.Period {
	case "hour":
		return timeSeriesBucketExpression(costReportBucketConfig(filter))
	case "week":
		return "date_trunc('week', created_at)"
	case "month":
		return "date_trunc('month', created_at)"
	default:
		return timeSeriesBucketExpression(costReportBucketConfig(filter))
	}
}

func costReportBucketEnd(start time.Time, period string) time.Time {
	switch period {
	case "hour":
		return start.Add(time.Hour)
	case "week":
		return start.AddDate(0, 0, 7)
	case "month":
		return start.AddDate(0, 1, 0)
	default:
		return start.AddDate(0, 0, 1)
	}
}

func costReportBucketConfig(filter invocationlog.CostReportFilter) invocationlog.TimeSeriesBucketConfig {
	switch filter.Period {
	case "week":
		return invocationlog.TimeSeriesBucketConfig{
			Interval:            7 * 24 * time.Hour,
			IntervalLabel:       "1w",
			ExpectedBucketCount: 0,
			Unit:                "week",
		}
	case "month":
		return invocationlog.TimeSeriesBucketConfig{
			Interval:            0,
			IntervalLabel:       "1mo",
			ExpectedBucketCount: 0,
			Unit:                "month",
		}
	default:
		if filter.To.Sub(filter.From) <= 5*time.Minute+time.Second {
			return invocationlog.TimeSeriesBucketConfig{
				Interval:            time.Second,
				IntervalLabel:       "1s",
				ExpectedBucketCount: 300,
				Unit:                "second",
			}
		}
		return invocationlog.TimeSeriesBucketConfigForRange(filter.From, filter.To)
	}
}

func timeSeriesBucketExpression(config invocationlog.TimeSeriesBucketConfig) string {
	switch config.Unit {
	case "second":
		return "date_trunc('second', created_at)"
	case "7second":
		return "to_timestamp(floor(extract(epoch from created_at) / 7) * 7)"
	case "minute":
		return "date_trunc('minute', created_at)"
	case "5minute":
		return "date_trunc('hour', created_at) + ((extract(minute from created_at)::int / 5) * interval '5 minutes')"
	case "hour":
		return "date_trunc('hour', created_at)"
	case "day":
		return "date_trunc('day', created_at)"
	default:
		return "date_trunc('day', created_at)"
	}
}

func fillCostReportBuckets(filter invocationlog.CostReportFilter, buckets []invocationlog.CostReportBucket) []invocationlog.CostReportBucket {
	config := costReportBucketConfig(filter)
	if config.ExpectedBucketCount <= 0 {
		return buckets
	}

	bucketByStart := make(map[time.Time]invocationlog.CostReportBucket, len(buckets))
	for _, bucket := range buckets {
		start := invocationlog.AlignTimeSeriesBucketStart(bucket.PeriodStart, config)
		bucket.PeriodStart = start
		bucket.PeriodEnd = start.Add(config.Interval)
		bucketByStart[start] = bucket
	}

	filled := make([]invocationlog.CostReportBucket, 0, config.ExpectedBucketCount)
	start := firstExpectedBucketStart(filter.To, config)
	for index := 0; index < config.ExpectedBucketCount; index++ {
		periodStart := start.Add(time.Duration(index) * config.Interval)
		if bucket, ok := bucketByStart[periodStart]; ok {
			filled = append(filled, bucket)
			continue
		}
		filled = append(filled, invocationlog.CostReportBucket{
			PeriodStart:  periodStart,
			PeriodEnd:    periodStart.Add(config.Interval),
			CostUSD:      invocationlog.FormatCostUSDFromMicroUSD(0),
			SavedCostUSD: invocationlog.FormatCostUSDFromMicroUSD(0),
		})
	}

	return filled
}

func firstExpectedBucketStart(to time.Time, config invocationlog.TimeSeriesBucketConfig) time.Time {
	lastStart := invocationlog.AlignTimeSeriesBucketStart(to.Add(-time.Nanosecond), config)
	return lastStart.Add(-time.Duration(config.ExpectedBucketCount-1) * config.Interval)
}

func buildAnalyticsPerformanceSummaryQuery(filter invocationlog.AnalyticsPerformanceFilter) (string, []any) {
	filteredCTE, args := buildAnalyticsPerformanceFilteredCTE(filter)
	query := fmt.Sprintf(`
%s
select
	 surface,
  count(*)::bigint as total_requests,
	(avg(latency_ms) filter (where latency_eligible))::double precision as avg_latency_ms,
	(percentile_disc(0.95) within group (order by latency_ms) filter (where latency_eligible))::double precision as p95_latency_ms,
	(percentile_disc(0.99) within group (order by latency_ms) filter (where latency_eligible))::double precision as p99_latency_ms,
	count(*) filter (where is_system_error)::bigint as system_error_requests,
	(count(*) filter (where is_system_error))::double precision / nullif(count(*), 0)::double precision as error_rate,
	max(created_at) as last_event_at
from filtered
group by surface
order by surface`, filteredCTE)
	return query, args
}

func buildAnalyticsProviderModelPerformanceQuery(filter invocationlog.AnalyticsPerformanceFilter) (string, []any) {
	filteredCTE, args := buildAnalyticsPerformanceFilteredCTE(filter)
	query := fmt.Sprintf(`
%s
select
	 surface,
  provider_key,
  model_key,
  count(*)::bigint as request_count,
	(avg(latency_ms) filter (where latency_eligible))::double precision as avg_latency_ms,
	(percentile_disc(0.95) within group (order by latency_ms) filter (where latency_eligible))::double precision as p95_latency_ms,
	(percentile_disc(0.99) within group (order by latency_ms) filter (where latency_eligible))::double precision as p99_latency_ms,
	(count(*) filter (where is_system_error))::double precision / nullif(count(*), 0)::double precision as error_rate,
  coalesce(sum(cost_micro_usd), 0)::bigint as total_cost_micro_usd,
  (count(*) filter (where cache_status = 'hit'))::double precision / nullif(count(*), 0)::double precision as cache_hit_rate
from filtered
where provider_key is not null and provider_key <> '' and model_key is not null and model_key <> ''
group by 1, 2, 3
order by request_count desc, surface, provider_key, model_key
limit 100`, filteredCTE)
	return query, args
}

func buildAnalyticsP95LatencyByProviderQuery(filter invocationlog.AnalyticsPerformanceFilter) (string, []any) {
	filteredCTE, args := buildAnalyticsPerformanceFilteredCTE(filter)
	query := fmt.Sprintf(`
%s
select
	 surface,
  provider_key,
	(percentile_disc(0.95) within group (order by latency_ms) filter (where latency_eligible))::double precision as p95_latency_ms,
  count(*)::bigint as request_count
from filtered
where provider_key is not null and provider_key <> ''
group by 1, 2
order by p95_latency_ms desc nulls last, request_count desc, surface, provider_key
limit 20`, filteredCTE)
	return query, args
}

func buildAnalyticsLatencyDistributionQuery(filter invocationlog.AnalyticsPerformanceFilter) (string, []any) {
	filteredCTE, args := buildAnalyticsPerformanceFilteredCTE(filter)
	bucketExpression := analyticsPerformanceBucketExpression(filter.From, filter.To)
	query := fmt.Sprintf(`
%s
select
	 surface,
  %s as bucket,
  count(*)::bigint as request_count,
	(percentile_disc(0.50) within group (order by latency_ms) filter (where latency_eligible))::double precision as p50_latency_ms,
	(percentile_disc(0.95) within group (order by latency_ms) filter (where latency_eligible))::double precision as p95_latency_ms,
	(percentile_disc(0.99) within group (order by latency_ms) filter (where latency_eligible))::double precision as p99_latency_ms
from filtered
group by 1, 2
order by 2, 1`, filteredCTE, bucketExpression)
	return query, args
}

func buildAnalyticsSlowestRequestsQuery(filter invocationlog.AnalyticsPerformanceFilter) (string, []any) {
	filteredCTE, args := buildAnalyticsPerformanceFilteredCTE(filter)
	query := fmt.Sprintf(`
%s
select
	 surface,
  request_id,
  project_id,
  coalesce(provider_key, 'unknown') as provider_key,
  coalesce(model_key, 'unknown') as model_key,
  latency_ms,
  http_status,
  terminal_status,
  created_at
from filtered
where latency_eligible
order by latency_ms desc, created_at desc, request_id desc
limit 10`, filteredCTE)
	return query, args
}

func buildAnalyticsPerformanceFilteredCTE(filter invocationlog.AnalyticsPerformanceFilter) (string, []any) {
	args := []any{filter.From.UTC(), filter.To.UTC()}
	projectApplicationWhere := []string{
		"created_at >= $1",
		"created_at < $2",
	}
	tenantChatWhere := []string{
		"completed_at >= $1",
		"completed_at < $2",
		"surface = 'tenant_chat'",
		"execution_scope_kind = 'tenant_chat'",
	}

	tenantID := strings.TrimSpace(filter.TenantID)
	if !isPostgresUUID(tenantID) {
		projectApplicationWhere = append(projectApplicationWhere, "1 = 0")
		tenantChatWhere = append(tenantChatWhere, "1 = 0")
	} else {
		args = append(args, tenantID)
		placeholder := fmt.Sprintf("$%d", len(args))
		projectApplicationWhere = append(projectApplicationWhere, "tenant_id = "+placeholder)
		tenantChatWhere = append(tenantChatWhere, "tenant_id = "+placeholder)
	}

	includeTenantChat := analyticsPerformanceIncludesTenantChat(filter)
	if strings.TrimSpace(filter.ProjectID) != "" {
		addUUIDWhere(&projectApplicationWhere, &args, "project_id", filter.ProjectID)
	}
	if provider := strings.TrimSpace(filter.Provider); provider != "" {
		args = append(args, provider)
		placeholder := fmt.Sprintf("$%d", len(args))
		projectApplicationWhere = append(projectApplicationWhere, "provider = "+placeholder)
		tenantChatWhere = append(tenantChatWhere, "effective_provider_id::text = "+placeholder)
	}
	if model := strings.TrimSpace(filter.Model); model != "" {
		args = append(args, model)
		placeholder := fmt.Sprintf("$%d", len(args))
		projectApplicationWhere = append(projectApplicationWhere, "model = "+placeholder)
		tenantChatWhere = append(tenantChatWhere, "effective_model_key = "+placeholder)
	}

	branches := []string{fmt.Sprintf(`
  select
	'%s'::text as surface,
    request_id,
    project_id::text as project_id,
    nullif(provider, '') as provider_key,
    nullif(model, '') as model_key,
    %s as terminal_status,
    http_status,
	latency_ms::bigint as latency_ms,
    cost_micro_usd,
    coalesce(nullif(cache_status, ''), 'bypass') as cache_status,
	(http_status >= 500 or %s = 'failed') as is_system_error,
	(%s in ('success', 'failed') and latency_ms is not null) as latency_eligible,
    created_at
  from p0_llm_invocation_logs
	where %s`, invocationlog.AnalyticsSurfaceProjectApplication, terminalStatusSQL, terminalStatusSQL, terminalStatusSQL, strings.Join(projectApplicationWhere, " and "))}

	if includeTenantChat {
		branches = append(branches, fmt.Sprintf(`
  select
	'%s'::text as surface,
	request_id,
	null::text as project_id,
	nullif(effective_provider_id::text, '') as provider_key,
	nullif(effective_model_key, '') as model_key,
	terminal_outcome as terminal_status,
	null::integer as http_status,
	latency_ms::bigint as latency_ms,
	confirmed_cost_micro_usd as cost_micro_usd,
	coalesce(nullif(cache_outcome, ''), 'off') as cache_status,
	terminal_outcome in ('failed', 'provider_failed', 'provider_timeout', 'runtime_unavailable', 'no_eligible_route') as is_system_error,
	latency_ms is not null as latency_eligible,
	completed_at as created_at
  from tenant_chat_invocation_logs
	where %s`, invocationlog.AnalyticsSurfaceTenantChat, strings.Join(tenantChatWhere, " and ")))
	}

	return "with filtered as (" + strings.Join(branches, "\nunion all\n") + "\n)", args
}

func analyticsPerformanceBucketExpression(from time.Time, to time.Time) string {
	return timeSeriesBucketExpression(invocationlog.TimeSeriesBucketConfigForRange(from, to))
}

func fillAnalyticsLatencyDistributionBuckets(filter invocationlog.AnalyticsPerformanceFilter, buckets []invocationlog.AnalyticsLatencyDistributionBucket) []invocationlog.AnalyticsLatencyDistributionBucket {
	config := invocationlog.TimeSeriesBucketConfigForRange(filter.From, filter.To)
	if config.ExpectedBucketCount <= 0 {
		return buckets
	}

	type surfaceBucketKey struct {
		surface string
		start   time.Time
	}
	bucketByStart := make(map[surfaceBucketKey]invocationlog.AnalyticsLatencyDistributionBucket, len(buckets))
	for _, bucket := range buckets {
		start := invocationlog.AlignTimeSeriesBucketStart(bucket.Bucket, config)
		bucket.Bucket = start
		bucketByStart[surfaceBucketKey{surface: bucket.Surface, start: start}] = bucket
	}

	surfaces := []string{invocationlog.AnalyticsSurfaceProjectApplication}
	if analyticsPerformanceIncludesTenantChat(filter) {
		surfaces = append(surfaces, invocationlog.AnalyticsSurfaceTenantChat)
	}
	filled := make([]invocationlog.AnalyticsLatencyDistributionBucket, 0, config.ExpectedBucketCount*len(surfaces))
	start := firstExpectedBucketStart(filter.To, config)
	for _, surface := range surfaces {
		for index := 0; index < config.ExpectedBucketCount; index++ {
			bucketStart := start.Add(time.Duration(index) * config.Interval)
			if bucket, ok := bucketByStart[surfaceBucketKey{surface: surface, start: bucketStart}]; ok {
				filled = append(filled, bucket)
				continue
			}
			filled = append(filled, invocationlog.AnalyticsLatencyDistributionBucket{
				Surface: surface,
				Bucket:  bucketStart,
			})
		}
	}

	return filled
}

func fillAnalyticsPerformanceSurfaceSummaries(filter invocationlog.AnalyticsPerformanceFilter, items []invocationlog.AnalyticsSurfaceSummary) []invocationlog.AnalyticsSurfaceSummary {
	bySurface := make(map[string]invocationlog.AnalyticsSurfaceSummary, len(items))
	for _, item := range items {
		bySurface[item.Surface] = item
	}

	surfaces := []string{invocationlog.AnalyticsSurfaceProjectApplication}
	if analyticsPerformanceIncludesTenantChat(filter) {
		surfaces = append(surfaces, invocationlog.AnalyticsSurfaceTenantChat)
	}
	filled := make([]invocationlog.AnalyticsSurfaceSummary, 0, len(surfaces))
	for _, surface := range surfaces {
		if item, ok := bySurface[surface]; ok {
			filled = append(filled, item)
			continue
		}
		filled = append(filled, invocationlog.AnalyticsSurfaceSummary{Surface: surface})
	}
	return filled
}

func aggregateAnalyticsPerformanceSummaries(
	filter invocationlog.AnalyticsPerformanceFilter,
	items []invocationlog.AnalyticsSurfaceSummary,
) (invocationlog.AnalyticsPerformanceSummary, *time.Time) {
	summary := invocationlog.AnalyticsPerformanceSummary{}
	var conservativeLastEventAt *time.Time
	for _, item := range items {
		summary.TotalRequests += item.Summary.TotalRequests
		summary.SystemErrorRequests += item.Summary.SystemErrorRequests
		if item.LastEventAt != nil && (conservativeLastEventAt == nil || item.LastEventAt.Before(*conservativeLastEventAt)) {
			value := item.LastEventAt.UTC()
			conservativeLastEventAt = &value
		}
	}
	summary.ThroughputPerMinute = analyticsThroughput(summary.TotalRequests, filter)
	if summary.TotalRequests > 0 {
		errorRate := float64(summary.SystemErrorRequests) / float64(summary.TotalRequests)
		summary.ErrorRate = &errorRate
	}

	if !analyticsPerformanceIncludesTenantChat(filter) {
		for _, item := range items {
			if item.Surface != invocationlog.AnalyticsSurfaceProjectApplication {
				continue
			}
			summary.AvgLatencyMs = item.Summary.AvgLatencyMs
			summary.P95LatencyMs = item.Summary.P95LatencyMs
			summary.P99LatencyMs = item.Summary.P99LatencyMs
			break
		}
	}

	return summary, conservativeLastEventAt
}

func analyticsThroughput(totalRequests int64, filter invocationlog.AnalyticsPerformanceFilter) *float64 {
	rangeMinutes := filter.To.Sub(filter.From).Minutes()
	if totalRequests <= 0 || rangeMinutes <= 0 {
		return nil
	}
	throughput := float64(totalRequests) / rangeMinutes
	return &throughput
}

func analyticsPerformanceDataSource(filter invocationlog.AnalyticsPerformanceFilter) string {
	if !analyticsPerformanceIncludesTenantChat(filter) {
		return "postgresql_request_log"
	}
	return "postgresql_unified_raw"
}

func analyticsPerformanceIncludesTenantChat(filter invocationlog.AnalyticsPerformanceFilter) bool {
	return strings.TrimSpace(filter.ProjectID) == "" || filter.IncludeTenantChat
}

func buildProjectLogsQuery(filter invocationlog.ProjectLogsFilter) (string, []any) {
	args := []any{}
	where := []string{}
	addUUIDWhere(&where, &args, "tenant_id", filter.TenantID)
	addUUIDWhere(&where, &args, "project_id", filter.ProjectID)
	args = append(args, filter.From.UTC())
	where = append(where, fmt.Sprintf("created_at >= $%d", len(args)))
	args = append(args, filter.To.UTC())
	where = append(where, fmt.Sprintf("created_at < $%d", len(args)))
	addOptionalUUIDWhere := func(column string, value string) {
		addUUIDWhere(&where, &args, column, value)
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
	addOptionalWhere("requested_model", filter.RequestedModel)
	addOptionalWhere("cache_status", filter.CacheStatus)
	addOptionalUUIDWhere("application_id", filter.ApplicationID)
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
  end_user_id,
  %s as budget_scope_type,
  %s as budget_scope_id,
  %s as budget_scope_resolved_by,
  provider,
  model,
  requested_model,
  %s as status,
  http_status,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  latency_ms,
  ttft_ms,
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

func normalizeProjectLogFilterOptionsFilter(filter invocationlog.ProjectLogsFilter) (invocationlog.ProjectLogsFilter, error) {
	filter.Status = ""
	filter.Provider = ""
	filter.RequestedModel = ""
	filter.CacheStatus = ""
	filter.ApplicationID = ""
	filter.BudgetScope = budget.Scope{}
	filter.RequestID = ""
	filter.Limit = 1
	return invocationlog.NormalizeProjectLogsFilter(filter)
}

func buildProjectLogFilterOptionsQuery(filter invocationlog.ProjectLogsFilter) (string, []any) {
	args := []any{}
	where := []string{}
	addUUIDWhere(&where, &args, "tenant_id", filter.TenantID)
	addUUIDWhere(&where, &args, "project_id", filter.ProjectID)
	args = append(args, filter.From.UTC())
	where = append(where, fmt.Sprintf("created_at >= $%d", len(args)))
	args = append(args, filter.To.UTC())
	where = append(where, fmt.Sprintf("created_at < $%d", len(args)))

	query := fmt.Sprintf(`
with filtered as (
  select
    nullif(requested_model, '') as requested_model_option,
    %s as budget_scope_type,
    %s as budget_scope_id,
    %s as budget_scope_resolved_by
  from p0_llm_invocation_logs
  where %s
),
requested_model_options as (
  select distinct requested_model_option
  from filtered
  where coalesce(nullif(requested_model_option, ''), '') <> ''
),
budget_scope_options as (
  select distinct budget_scope_type, budget_scope_id, budget_scope_resolved_by
  from filtered
  where coalesce(nullif(budget_scope_id, ''), '') <> ''
)
select
  'requested_model' as option_type,
  requested_model_option,
  null::text as budget_scope_type,
  null::text as budget_scope_id,
  null::text as budget_scope_resolved_by
from requested_model_options
union all
select
  'budget_scope' as option_type,
  null::text as requested_model_option,
  budget_scope_type,
  budget_scope_id,
  budget_scope_resolved_by
from budget_scope_options
order by option_type, requested_model_option, budget_scope_type, budget_scope_id, budget_scope_resolved_by`,
		budgetScopeTypeSQL,
		budgetScopeIDSQL,
		budgetScopeResolvedBySQL,
		strings.Join(where, " and "),
	)

	return query, args
}

func buildDashboardOverviewQuery(filter invocationlog.DashboardOverviewFilter) (string, []any) {
	args := []any{filter.From.UTC(), filter.To.UTC()}
	where := []string{
		"created_at >= $1",
		"created_at < $2",
	}
	addUUIDWhere(&where, &args, "tenant_id", filter.TenantID)
	addUUIDWhere(&where, &args, "project_id", filter.ProjectID)
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
	budgetOutcomeSQL := metadataOutcomeSQL("budget", `'not_checked'`)

	query := fmt.Sprintf(`
with filtered as (
  select
    request_id,
    project_id::text as project_id,
    application_id::text,
    %s as terminal_status,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost_micro_usd,
    saved_cost_micro_usd,
    latency_ms,
    stream,
    ttft_ms,
    greatest(latency_ms - coalesce(provider_latency_ms, 0), 0) as gateway_internal_latency_ms,
    provider_latency_ms,
    cache_status,
    cache_type,
    %s as safety_outcome,
    %s as cache_outcome,
    %s as fallback_outcome,
    %s as budget_outcome,
    masking_action,
    provider,
    model,
    routing_reason,
    %s as budget_scope_type,
    %s as budget_scope_id,
    %s as budget_scope_resolved_by,
    metadata,
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
  count(*) filter (where cache_outcome in ('hit', 'miss', 'error') and coalesce(nullif(cache_type, ''), 'none') = 'exact')::bigint as cache_eligible_requests,
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
  (avg(ttft_ms) filter (where stream and ttft_ms is not null))::float8 as average_ttft_ms,
  (percentile_disc(0.50) within group (order by ttft_ms) filter (where stream and ttft_ms is not null))::float8 as p50_ttft_ms,
  (percentile_disc(0.95) within group (order by ttft_ms) filter (where stream and ttft_ms is not null))::float8 as p95_ttft_ms,
  (percentile_disc(0.99) within group (order by ttft_ms) filter (where stream and ttft_ms is not null))::float8 as p99_ttft_ms,
  count(*) filter (where stream)::bigint as eligible_stream_requests,
  count(*) filter (where stream and ttft_ms is not null)::bigint as observed_ttft_requests,
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
    select jsonb_object_agg(budget_outcome_key, request_count)
    from (
      select coalesce(nullif(budget_outcome, ''), 'not_checked') as budget_outcome_key, count(*)::bigint as request_count
      from filtered
      group by 1
    ) budget_outcome_rollup
  ), '{}'::jsonb) as budget_outcome_counts,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'category', category_key,
      'difficulty', difficulty_key,
      'routingReason', routing_reason_key,
      'requestCount', request_count
    ) order by request_count desc, category_key, difficulty_key, routing_reason_key)
    from (
      select
        case lower(coalesce(nullif(metadata->>'promptCategory', ''), 'general'))
          when 'code' then 'code'
          when 'translation' then 'translation'
          when 'summarization' then 'summarization'
          when 'reasoning' then 'reasoning'
          else 'general'
        end as category_key,
        case lower(coalesce(nullif(metadata->>'promptDifficulty', ''), 'simple'))
          when 'complex' then 'complex'
          else 'simple'
        end as difficulty_key,
        coalesce(nullif(routing_reason, ''), '') as routing_reason_key,
        count(*)::bigint as request_count
      from filtered
      group by 1, 2, 3
    ) routing_rollup
  ), '[]'::jsonb) as routing_count_by_model,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'provider', provider_key,
      'model', model_key,
      'requestCount', request_count,
      'totalTokens', total_tokens,
      'costMicroUsd', cost_micro_usd
    ) order by cost_micro_usd desc, provider_key, model_key)
    from (
      select
        nullif(provider, '') as provider_key,
        nullif(model, '') as model_key,
        count(*)::bigint as request_count,
        coalesce(sum(total_tokens), 0)::bigint as total_tokens,
        coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd
      from filtered
      group by 1, 2
    ) cost_rollup
    where provider_key is not null and model_key is not null
  ), '[]'::jsonb) as cost_by_model,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'projectId', project_id,
      'requestCount', request_count,
      'promptTokens', prompt_tokens,
      'completionTokens', completion_tokens,
      'totalTokens', total_tokens,
      'costMicroUsd', cost_micro_usd
    ) order by cost_micro_usd desc, project_id)
    from (
      select
        project_id,
        count(*)::bigint as request_count,
        coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
        coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
        coalesce(sum(total_tokens), 0)::bigint as total_tokens,
        coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd
      from filtered
      where project_id is not null and project_id <> ''
      group by 1
    ) project_rollup
  ), '[]'::jsonb) as project_breakdown,
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
from filtered`, terminalStatusSQL, safetyOutcomeSQL, cacheOutcomeSQL, fallbackOutcomeSQL, budgetOutcomeSQL, budgetScopeTypeSQL, budgetScopeIDSQL, budgetScopeResolvedBySQL, strings.Join(where, " and "))

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
  routing_reason,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  latency_ms,
  ttft_ms,
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

func addUUIDWhere(where *[]string, args *[]any, expression string, value string) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return
	}
	if !isPostgresUUID(normalized) {
		*where = append(*where, "1 = 0")
		return
	}
	*args = append(*args, normalized)
	*where = append(*where, fmt.Sprintf("%s = $%d", expression, len(*args)))
}

func isPostgresUUID(value string) bool {
	normalized := strings.TrimSpace(value)
	if len(normalized) != 36 {
		return false
	}
	for index, char := range normalized {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if !isHexChar(char) {
				return false
			}
		}
	}
	return true
}

func isHexChar(char rune) bool {
	return (char >= '0' && char <= '9') ||
		(char >= 'a' && char <= 'f') ||
		(char >= 'A' && char <= 'F')
}

func scanProjectLogListRow(rows Rows) (invocationlog.LlmInvocationLog, error) {
	var log invocationlog.LlmInvocationLog
	var applicationID sql.NullString
	var endUserID sql.NullString
	var budgetScopeType sql.NullString
	var budgetScopeID sql.NullString
	var budgetScopeResolvedBy sql.NullString
	var requestedModel sql.NullString
	var routingReason sql.NullString
	var ttftMs sql.NullInt64
	var metadataJSON []byte
	if err := rows.Scan(
		&log.RequestID,
		&log.ProjectID,
		&applicationID,
		&endUserID,
		&budgetScopeType,
		&budgetScopeID,
		&budgetScopeResolvedBy,
		&log.Provider,
		&log.Model,
		&requestedModel,
		&log.Status,
		&log.HTTPStatus,
		&log.PromptTokens,
		&log.CompletionTokens,
		&log.TotalTokens,
		&log.CostMicroUSD,
		&log.LatencyMs,
		&ttftMs,
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
	log.EndUserID = nullableString(endUserID)
	log.BudgetScope = budget.NormalizeScope(budget.Scope{
		Type:       nullableString(budgetScopeType),
		ID:         nullableString(budgetScopeID),
		ResolvedBy: nullableString(budgetScopeResolvedBy),
	}, log.ApplicationID)
	log.RequestedModel = nullableString(requestedModel)
	log.RoutingReason = nullableString(routingReason)
	log.TTFTMs = nullableInt64Pointer(ttftMs)
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
	var routingReason sql.NullString
	var ttftMs sql.NullInt64
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
		&routingReason,
		&log.PromptTokens,
		&log.CompletionTokens,
		&log.TotalTokens,
		&log.CostMicroUSD,
		&log.LatencyMs,
		&ttftMs,
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
	log.RoutingReason = nullableString(routingReason)
	log.TTFTMs = nullableInt64Pointer(ttftMs)
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
	ProviderAttempt             *providerAttemptMetadataJSON      `json:"providerAttempt"`
	ModelRef                    string                            `json:"modelRef"`
	RoutingPolicyHash           string                            `json:"routingPolicyHash"`
	RoutingDecisionKeyHash      string                            `json:"routingDecisionKeyHash"`
	PromptCategory              string                            `json:"promptCategory"`
	PromptDifficulty            string                            `json:"promptDifficulty"`
	SemanticCacheHit            bool                              `json:"semanticCacheHit"`
	SemanticSimilarity          float64                           `json:"semanticSimilarity"`
	SemanticMatchedRequestID    string                            `json:"semanticMatchedRequestId"`
	SemanticCacheThreshold      float64                           `json:"semanticCacheThreshold"`
	SemanticCachePolicyVersion  string                            `json:"semanticCachePolicyVersion"`
	SemanticCacheDecisionReason string                            `json:"semanticCacheDecisionReason"`
	EmbeddingProvider           string                            `json:"embeddingProvider"`
	PromptCapture               *promptCaptureMetadataJSON        `json:"promptCapture"`
	ResponseCapture             *responseCaptureMetadataJSON      `json:"responseCapture"`
}

type providerAttemptMetadataJSON struct {
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
}

type promptCaptureMetadataJSON struct {
	Enabled        bool   `json:"enabled"`
	Mode           string `json:"mode"`
	Visibility     string `json:"visibility"`
	CapturedPrompt string `json:"capturedPrompt"`
	Truncated      bool   `json:"truncated"`
	MaxChars       int    `json:"maxChars"`
}

type responseCaptureMetadataJSON struct {
	Enabled          bool   `json:"enabled"`
	Mode             string `json:"mode"`
	Visibility       string `json:"visibility"`
	CapturedResponse string `json:"capturedResponse"`
	Truncated        bool   `json:"truncated"`
	MaxChars         int    `json:"maxChars"`
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
	if metadata.ProviderAttempt != nil {
		log.ProviderID = strings.TrimSpace(metadata.ProviderAttempt.ProviderID)
		log.ModelID = strings.TrimSpace(metadata.ProviderAttempt.ModelID)
	}
	if strings.TrimSpace(metadata.ModelRef) != "" {
		log.ModelRef = strings.TrimSpace(metadata.ModelRef)
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
	if strings.TrimSpace(metadata.PromptDifficulty) != "" {
		log.PromptDifficulty = strings.TrimSpace(metadata.PromptDifficulty)
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
	if metadata.ResponseCapture != nil {
		log.ResponseCapture = invocationlog.ResponseCaptureFields{
			Enabled:          metadata.ResponseCapture.Enabled,
			Mode:             strings.TrimSpace(metadata.ResponseCapture.Mode),
			Visibility:       strings.TrimSpace(metadata.ResponseCapture.Visibility),
			CapturedResponse: "",
			Truncated:        metadata.ResponseCapture.Truncated,
			MaxChars:         metadata.ResponseCapture.MaxChars,
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
	for index := range values {
		values[index].Category = invocationlog.CanonicalRoutingCategory(values[index].Category)
		values[index].Difficulty = invocationlog.CanonicalRoutingDifficulty(values[index].Difficulty)
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

func decodeProjectBreakdownJSON(raw []byte) ([]invocationlog.ProjectBreakdown, error) {
	if len(raw) == 0 || (len(raw) == 4 && raw[0] == 'n' && raw[1] == 'u' && raw[2] == 'l' && raw[3] == 'l') {
		return []invocationlog.ProjectBreakdown{}, nil
	}
	var rows []struct {
		ProjectID        string `json:"projectId"`
		RequestCount     int64  `json:"requestCount"`
		PromptTokens     int64  `json:"promptTokens"`
		CompletionTokens int64  `json:"completionTokens"`
		TotalTokens      int64  `json:"totalTokens"`
		CostMicroUSD     int64  `json:"costMicroUsd"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	if rows == nil {
		return []invocationlog.ProjectBreakdown{}, nil
	}
	items := make([]invocationlog.ProjectBreakdown, 0, len(rows))
	for _, row := range rows {
		if strings.TrimSpace(row.ProjectID) == "" {
			continue
		}
		items = append(items, invocationlog.ProjectBreakdown{
			ProjectID:        row.ProjectID,
			RequestCount:     row.RequestCount,
			PromptTokens:     row.PromptTokens,
			CompletionTokens: row.CompletionTokens,
			TotalTokens:      row.TotalTokens,
			CostMicroUSD:     row.CostMicroUSD,
		})
	}
	return items, nil
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
