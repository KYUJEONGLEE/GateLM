package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

// ProjectReader is the ClickHouse read model for every bulk Project/Application
// log view. PostgreSQL remains authoritative for writes and request-id detail.
type ProjectReader struct {
	client      *queryClient
	performance *AnalyticsPerformanceReader
}

func NewProjectReader(cfg QueryConfig) (*ProjectReader, error) {
	client, err := newQueryClient(cfg)
	if err != nil {
		return nil, err
	}
	return &ProjectReader{client: client, performance: &AnalyticsPerformanceReader{client: client}}, nil
}

func (r *ProjectReader) GetAnalyticsPerformance(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error) {
	return r.performance.GetAnalyticsPerformance(ctx, filter)
}

func (r *ProjectReader) ListProjectLogs(ctx context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	normalized, err := invocationlog.NormalizeProjectLogsFilter(filter)
	if err != nil {
		return nil, err
	}
	var result []invocationlog.RequestLogListItem
	err = r.observe(ctx, "logs", func(readCtx context.Context) error {
		where, params := projectWhere(normalized.TenantID, normalized.ProjectID, normalized.From, normalized.To)
		addStringFilter(&where, params, "terminal_status", "status", normalized.Status)
		addStringFilter(&where, params, "provider", "provider", normalized.Provider)
		addStringFilter(&where, params, "requested_model", "requested_model", normalized.RequestedModel)
		addStringFilter(&where, params, "cache_status", "cache_status", normalized.CacheStatus)
		addUUIDFilter(&where, params, "application_id", "application_id", normalized.ApplicationID)
		addScopeFilter(&where, params, normalized.BudgetScope)
		addStringFilter(&where, params, "request_id", "request_id", normalized.RequestID)
		params["limit"] = strconv.Itoa(normalized.Limit)
		rows, queryErr := queryJSONEachRow[projectLogRow](readCtx, r.client, fmt.Sprintf(`
SELECT
  request_id, toString(project_id) AS project_id_text, toString(application_id) AS application_id_text,
  budget_scope_type, budget_scope_id, budget_scope_resolved_by,
  provider, model, provider_id, model_id, requested_model, model_ref, routing_reason,
  status, terminal_status, http_status, prompt_tokens, completion_tokens, total_tokens,
	  cost_micro_usd, latency_ms, provider_latency_ms, ttft_ms, stream, cache_status, cache_type,
  routing_category, routing_difficulty, masking_action,
  fallback_outcome, safety_outcome, budget_outcome, provider_called,
  toUnixTimestamp64Milli(created_at) AS created_at_ms
FROM %s.%s FINAL
WHERE %s
ORDER BY created_at DESC, request_id DESC
LIMIT {limit:UInt32}
FORMAT JSONEachRow`, r.client.database, r.client.timeTable(), strings.Join(where, "\n  AND ")), params)
		if queryErr != nil {
			return queryErr
		}
		result = make([]invocationlog.RequestLogListItem, 0, len(rows))
		for _, row := range rows {
			providerLatency := row.ProviderLatencyMs
			log := invocationlog.LlmInvocationLog{
				RequestID: row.RequestID, ProjectID: row.ProjectID, ApplicationID: row.ApplicationID,
				BudgetScope:    budget.Scope{Type: row.BudgetScopeType, ID: row.BudgetScopeID, ResolvedBy: row.BudgetScopeResolvedBy},
				RequestedModel: row.RequestedModel, Provider: row.Provider, Model: row.Model,
				ProviderID: row.ProviderID, ModelID: row.ModelID, ModelRef: row.ModelRef,
				RoutingReason: row.RoutingReason, PromptCategory: row.RoutingCategory,
				PromptDifficulty: row.RoutingDifficulty, Status: row.Status, TerminalStatus: row.TerminalStatus,
				HTTPStatus: row.HTTPStatus, PromptTokens: row.PromptTokens, CompletionTokens: row.CompletionTokens,
				TotalTokens: row.TotalTokens, CostMicroUSD: row.CostMicroUSD, LatencyMs: row.LatencyMs,
				TTFTMs: row.TTFTMs, ProviderLatencyMs: providerLatency, Stream: row.Stream != 0, CacheStatus: row.CacheStatus,
				CacheType: row.CacheType, MaskingAction: row.MaskingAction, ProviderCalled: row.ProviderCalled != 0,
				DomainOutcomes: projectListOutcomes(row),
				CreatedAt:      time.UnixMilli(row.CreatedAtMS).UTC(),
			}
			item := invocationlog.ToRequestLogListItem(log)
			// Employee identities are one-way HMAC values in ClickHouse and must not
			// be exposed as if they were the original user reference.
			item.UserRef = ""
			result = append(result, item)
		}
		return nil
	})
	return result, err
}

func projectListOutcomes(row projectLogRow) invocationlog.DomainOutcomes {
	cacheOutcome := "bypassed"
	switch row.CacheStatus {
	case "hit":
		cacheOutcome = "hit"
	case "miss":
		cacheOutcome = "miss"
	case "error":
		cacheOutcome = "error"
	case "store_skipped":
		cacheOutcome = "store_skipped"
	}
	providerOutcome := "not_called"
	if row.ProviderCalled != 0 {
		if row.TerminalStatus == invocationlog.StatusSuccess {
			providerOutcome = "success"
		} else {
			providerOutcome = "error"
		}
	}
	routingOutcome := "not_checked"
	if row.RequestedModel != "" || row.ModelRef != "" || row.RoutingReason != "" {
		routingOutcome = "selected"
	}
	return invocationlog.DomainOutcomes{
		Budget:    invocationlog.BudgetOutcome{Outcome: row.BudgetOutcome, BudgetScopeType: row.BudgetScopeType, BudgetScopeID: row.BudgetScopeID, ResolvedBy: row.BudgetScopeResolvedBy},
		Safety:    invocationlog.SafetyOutcome{Outcome: row.SafetyOutcome, MaskingAction: row.MaskingAction},
		Routing:   invocationlog.RoutingOutcome{Outcome: routingOutcome, RequestedModel: stringValue(row.RequestedModel), Category: stringValue(row.RoutingCategory), Difficulty: stringValue(row.RoutingDifficulty), ModelRef: stringValue(row.ModelRef), RoutingReason: stringValue(row.RoutingReason)},
		Cache:     invocationlog.CacheOutcome{Outcome: cacheOutcome, CacheType: row.CacheType},
		Provider:  invocationlog.ProviderOutcome{Outcome: providerOutcome, LatencyMs: row.ProviderLatencyMs},
		Fallback:  invocationlog.FallbackOutcome{Outcome: row.FallbackOutcome},
		Streaming: invocationlog.StreamingOutcome{StreamingRequested: row.Stream != 0},
		Logging:   invocationlog.LoggingOutcome{Outcome: "written", RequestLogWritten: true},
	}
}
func stringValue(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

type projectLogRow struct {
	RequestID             string `json:"request_id"`
	ProjectID             string `json:"project_id_text"`
	ApplicationID         string `json:"application_id_text"`
	BudgetScopeType       string `json:"budget_scope_type"`
	BudgetScopeID         string `json:"budget_scope_id"`
	BudgetScopeResolvedBy string `json:"budget_scope_resolved_by"`
	Provider              string `json:"provider"`
	Model                 string `json:"model"`
	ProviderID            string `json:"provider_id"`
	ModelID               string `json:"model_id"`
	RequestedModel        string `json:"requested_model"`
	ModelRef              string `json:"model_ref"`
	RoutingReason         string `json:"routing_reason"`
	Status                string `json:"status"`
	TerminalStatus        string `json:"terminal_status"`
	HTTPStatus            int    `json:"http_status"`
	PromptTokens          int64  `json:"prompt_tokens"`
	CompletionTokens      int64  `json:"completion_tokens"`
	TotalTokens           int64  `json:"total_tokens"`
	CostMicroUSD          int64  `json:"cost_micro_usd"`
	LatencyMs             int64  `json:"latency_ms"`
	TTFTMs                *int64 `json:"ttft_ms"`
	ProviderLatencyMs     *int64 `json:"provider_latency_ms"`
	Stream                uint8  `json:"stream"`
	CacheStatus           string `json:"cache_status"`
	CacheType             string `json:"cache_type"`
	RoutingCategory       string `json:"routing_category"`
	RoutingDifficulty     string `json:"routing_difficulty"`
	MaskingAction         string `json:"masking_action"`
	FallbackOutcome       string `json:"fallback_outcome"`
	SafetyOutcome         string `json:"safety_outcome"`
	BudgetOutcome         string `json:"budget_outcome"`
	ProviderCalled        uint8  `json:"provider_called"`
	CreatedAtMS           int64  `json:"created_at_ms"`
}

func (r *ProjectReader) ListProjectLogFilterOptions(ctx context.Context, filter invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error) {
	filter.Status, filter.Provider, filter.RequestedModel, filter.CacheStatus = "", "", "", ""
	filter.ApplicationID, filter.RequestID, filter.BudgetScope, filter.Limit = "", "", budget.Scope{}, 1
	normalized, err := invocationlog.NormalizeProjectLogsFilter(filter)
	if err != nil {
		return invocationlog.RequestLogFilterOptions{}, err
	}
	result := invocationlog.RequestLogFilterOptions{}
	err = r.observe(ctx, "log_filter_options", func(readCtx context.Context) error {
		where, params := rollupWhere(normalized.TenantID, normalized.ProjectID, normalized.From, normalized.To)
		rows, queryErr := queryJSONEachRow[filterOptionRow](readCtx, r.client, fmt.Sprintf(`
WITH filtered AS (
  SELECT requested_model, budget_scope_type, budget_scope_id, budget_scope_resolved_by
  FROM %s.%s WHERE %s
)
SELECT 'requested_model' AS option_type, requested_model AS value, '' AS scope_type, '' AS scope_id, '' AS resolved_by
FROM filtered WHERE requested_model != '' GROUP BY requested_model
UNION ALL
SELECT 'budget_scope', '', budget_scope_type, budget_scope_id, budget_scope_resolved_by
FROM filtered WHERE budget_scope_id != '' GROUP BY budget_scope_type, budget_scope_id, budget_scope_resolved_by
FORMAT JSONEachRow`, r.client.database, r.client.dashboardRollupTable(), strings.Join(where, " AND ")), params)
		if queryErr != nil {
			return queryErr
		}
		for _, row := range rows {
			if row.OptionType == "requested_model" {
				result.RequestedModels = append(result.RequestedModels, row.Value)
				continue
			}
			result.BudgetScopes = append(result.BudgetScopes, budget.Scope{Type: row.ScopeType, ID: row.ScopeID, ResolvedBy: row.ResolvedBy})
		}
		sort.Strings(result.RequestedModels)
		sort.Slice(result.BudgetScopes, func(i, j int) bool {
			left := result.BudgetScopes[i]
			right := result.BudgetScopes[j]
			if left.Type != right.Type {
				return left.Type < right.Type
			}
			if left.ID != right.ID {
				return left.ID < right.ID
			}
			return left.ResolvedBy < right.ResolvedBy
		})
		return nil
	})
	return result, err
}

type filterOptionRow struct {
	OptionType string `json:"option_type"`
	Value      string `json:"value"`
	ScopeType  string `json:"scope_type"`
	ScopeID    string `json:"scope_id"`
	ResolvedBy string `json:"resolved_by"`
}

func (r *ProjectReader) GetDashboardOverview(ctx context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error) {
	normalized, err := invocationlog.NormalizeDashboardOverviewFilter(filter)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	var summary dashboardSummaryRow
	var dimensions []dashboardDimensionRow
	err = r.observe(ctx, "dashboard", func(readCtx context.Context) error {
		where, params := rollupWhere(normalized.TenantID, normalized.ProjectID, normalized.From, normalized.To)
		addScopeFilter(&where, params, normalized.BudgetScope)
		cte := dashboardFilteredCTE(r.client, where)
		group, groupCtx := errgroup.WithContext(readCtx)
		group.Go(func() error {
			rows, queryErr := queryJSONEachRow[dashboardSummaryRow](groupCtx, r.client, cte+dashboardSummarySQL, params)
			if queryErr != nil {
				return queryErr
			}
			if len(rows) != 1 {
				return unavailableError(fmt.Errorf("unexpected dashboard summary row count %d", len(rows)))
			}
			summary = rows[0]
			return nil
		})
		group.Go(func() error {
			rows, queryErr := queryJSONEachRow[dashboardDimensionRow](groupCtx, r.client, cte+dashboardDimensionsSQL, params)
			if queryErr == nil {
				dimensions = rows
			}
			return queryErr
		})
		return group.Wait()
	})
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, err
	}
	aggregate := dashboardAggregate(summary, dimensions)
	result := invocationlog.BuildDashboardOverviewFromAggregate(aggregate)
	result.DataFreshness.Source = "clickhouse_project_application"
	result.DataFreshness.IsStale = false
	return result, nil
}

type dashboardSummaryRow struct {
	Total            int64    `json:"total"`
	Success          int64    `json:"success"`
	Failed           int64    `json:"failed"`
	Blocked          int64    `json:"blocked"`
	RateLimited      int64    `json:"rate_limited"`
	Cancelled        int64    `json:"cancelled"`
	CacheHits        int64    `json:"cache_hits"`
	CacheEligible    int64    `json:"cache_eligible"`
	FallbackSuccess  int64    `json:"fallback_success"`
	PromptTokens     int64    `json:"prompt_tokens"`
	CompletionTokens int64    `json:"completion_tokens"`
	TotalTokens      int64    `json:"total_tokens"`
	Cost             int64    `json:"cost"`
	SavedCost        int64    `json:"saved_cost"`
	AvgLatency       *float64 `json:"avg_latency"`
	P95Latency       *float64 `json:"p95_latency"`
	P95Gateway       *float64 `json:"p95_gateway"`
	P99Gateway       *float64 `json:"p99_gateway"`
	P95Provider      *float64 `json:"p95_provider"`
	P99Provider      *float64 `json:"p99_provider"`
	AvgTTFT          *float64 `json:"avg_ttft"`
	P50TTFT          *float64 `json:"p50_ttft"`
	P95TTFT          *float64 `json:"p95_ttft"`
	P99TTFT          *float64 `json:"p99_ttft"`
	StreamCount      int64    `json:"stream_count"`
	TTFTCount        int64    `json:"ttft_count"`
	LastMS           *int64   `json:"last_ms"`
}

type dashboardDimensionRow struct {
	Kind       string `json:"kind"`
	Key1       string `json:"key1"`
	Key2       string `json:"key2"`
	Key3       string `json:"key3"`
	Requests   int64  `json:"requests"`
	Prompt     int64  `json:"prompt"`
	Completion int64  `json:"completion"`
	Tokens     int64  `json:"tokens"`
	Cost       int64  `json:"cost"`
}

func dashboardFilteredCTE(client *queryClient, where []string) string {
	return fmt.Sprintf(`WITH filtered AS (
 SELECT *
 FROM %s.%s WHERE %s
)
`, client.database, client.dashboardRollupTable(), strings.Join(where, " AND "))
}

const dashboardSummarySQL = `SELECT
 sum(requests) AS total, sumIf(requests,terminal_status='success') AS success, sumIf(requests,terminal_status='failed') AS failed,
 sumIf(requests,terminal_status='blocked') AS blocked, sumIf(requests,terminal_status='rate_limited') AS rate_limited, sumIf(requests,terminal_status='cancelled') AS cancelled,
 sumIf(requests,cache_outcome='hit' AND cache_type='exact') AS cache_hits, sumIf(requests,cache_outcome IN ('hit','miss','error') AND cache_type='exact') AS cache_eligible,
 sumIf(requests,fallback_outcome='success') AS fallback_success, sum(prompt_tokens) AS prompt_tokens, sum(completion_tokens) AS completion_tokens,
 sum(total_tokens) AS total_tokens, sum(cost_micro_usd) AS cost, sum(ifNull(saved_cost_micro_usd,0)) AS saved_cost,
 if(sumIf(requests,latency_eligible=1)=0,NULL,sumIf(latency_sum_ms,latency_eligible=1)/sumIf(requests,latency_eligible=1)) AS avg_latency,
 if(sumIf(requests,latency_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(latency_quantiles,latency_eligible=1),2)) AS p95_latency,
 if(sumIf(requests,latency_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(gateway_latency_quantiles,latency_eligible=1),2)) AS p95_gateway,
 if(sumIf(requests,latency_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(gateway_latency_quantiles,latency_eligible=1),3)) AS p99_gateway,
 if(sumIf(requests,provider_latency_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(provider_latency_quantiles,provider_latency_eligible=1),2)) AS p95_provider,
 if(sumIf(requests,provider_latency_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(provider_latency_quantiles,provider_latency_eligible=1),3)) AS p99_provider,
 if(sumIf(requests,ttft_eligible=1)=0,NULL,sumIf(ttft_sum_ms,ttft_eligible=1)/sumIf(requests,ttft_eligible=1)) AS avg_ttft,
 if(sumIf(requests,ttft_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(ttft_quantiles,ttft_eligible=1),1)) AS p50_ttft,
 if(sumIf(requests,ttft_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(ttft_quantiles,ttft_eligible=1),2)) AS p95_ttft,
 if(sumIf(requests,ttft_eligible=1)=0,NULL,arrayElement(quantilesTDigestMergeIf(0.50,0.95,0.99)(ttft_quantiles,ttft_eligible=1),3)) AS p99_ttft,
 sum(stream_requests) AS stream_count, sumIf(requests,ttft_eligible=1) AS ttft_count,
 if(sum(requests)=0,NULL,toUnixTimestamp64Milli(max(last_created_at))) AS last_ms
FROM filtered FORMAT JSONEachRow`

const dashboardDimensionsSQL = `SELECT 'status' kind, if(terminal_status='','unknown',terminal_status) key1, '' key2, '' key3, sum(requests) requests, 0 prompt, 0 completion, 0 tokens, 0 cost FROM filtered GROUP BY key1
UNION ALL SELECT 'masking', if(masking_action='','none',masking_action), '', '', sum(requests),0,0,0,0 FROM filtered GROUP BY masking_action
UNION ALL SELECT 'safety', if(safety_outcome='','not_checked',safety_outcome), '', '', sum(requests),0,0,0,0 FROM filtered GROUP BY safety_outcome
UNION ALL SELECT 'cache', cache_outcome, '', '', sum(requests),0,0,0,0 FROM filtered GROUP BY cache_outcome
UNION ALL SELECT 'fallback', if(fallback_outcome='','not_called',fallback_outcome), '', '', sum(requests),0,0,0,0 FROM filtered GROUP BY fallback_outcome
UNION ALL SELECT 'budget', if(budget_outcome='','not_checked',budget_outcome), '', '', sum(requests),0,0,0,0 FROM filtered GROUP BY budget_outcome
UNION ALL SELECT 'routing', routing_category, routing_difficulty, routing_reason, sum(requests),0,0,0,0 FROM filtered GROUP BY routing_category,routing_difficulty,routing_reason
UNION ALL SELECT 'model', provider, model, '', sum(requests),0,0,sum(total_tokens),sum(cost_micro_usd) FROM filtered WHERE provider!='' AND model!='' GROUP BY provider,model
UNION ALL SELECT 'project', toString(project_id), '', '', sum(requests),sum(prompt_tokens),sum(completion_tokens),sum(total_tokens),sum(cost_micro_usd) FROM filtered GROUP BY project_id
UNION ALL SELECT 'application', toString(application_id), '', '', sum(requests),0,0,0,sum(cost_micro_usd) FROM filtered GROUP BY application_id
UNION ALL SELECT 'scope', budget_scope_type,budget_scope_id,budget_scope_resolved_by,sum(requests),0,0,0,sum(cost_micro_usd) FROM filtered WHERE budget_scope_id!='' GROUP BY budget_scope_type,budget_scope_id,budget_scope_resolved_by
FORMAT JSONEachRow`

func dashboardAggregate(row dashboardSummaryRow, dims []dashboardDimensionRow) invocationlog.DashboardOverviewAggregate {
	a := invocationlog.DashboardOverviewAggregate{TotalRequests: row.Total, SuccessfulRequests: row.Success, FailedRequests: row.Failed, BlockedRequests: row.Blocked, RateLimitedRequests: row.RateLimited, CancelledRequests: row.Cancelled, CacheHitRequests: row.CacheHits, CacheEligibleRequests: row.CacheEligible, FallbackSuccessCount: row.FallbackSuccess, PromptTokens: row.PromptTokens, CompletionTokens: row.CompletionTokens, TotalTokens: row.TotalTokens, TotalCostMicroUSD: row.Cost, SavedCostMicroUSD: row.SavedCost, AverageLatencyMs: row.AvgLatency, P95LatencyMs: row.P95Latency, P95GatewayInternalLatencyMs: row.P95Gateway, P99GatewayInternalLatencyMs: row.P99Gateway, P95ProviderLatencyMs: row.P95Provider, P99ProviderLatencyMs: row.P99Provider, AverageTTFTMs: row.AvgTTFT, P50TTFTMs: row.P50TTFT, P95TTFTMs: row.P95TTFT, P99TTFTMs: row.P99TTFT, EligibleStreamRequests: row.StreamCount, ObservedTTFTRequests: row.TTFTCount, StatusCounts: map[string]int64{}, MaskingActionCounts: map[string]int64{}, SafetyOutcomeCounts: map[string]int64{}, CacheOutcomeCounts: map[string]int64{}, FallbackOutcomeCounts: map[string]int64{}, BudgetOutcomeCounts: map[string]int64{}, GeneratedAt: time.Now().UTC()}
	if row.LastMS != nil {
		value := time.UnixMilli(*row.LastMS).UTC()
		a.LastLogCreatedAt = &value
	}
	for _, d := range dims {
		switch d.Kind {
		case "status":
			a.StatusCounts[d.Key1] = d.Requests
		case "masking":
			a.MaskingActionCounts[d.Key1] = d.Requests
		case "safety":
			a.SafetyOutcomeCounts[d.Key1] = d.Requests
		case "cache":
			a.CacheOutcomeCounts[d.Key1] = d.Requests
		case "fallback":
			a.FallbackOutcomeCounts[d.Key1] = d.Requests
		case "budget":
			a.BudgetOutcomeCounts[d.Key1] = d.Requests
		case "routing":
			a.RoutingCountByModel = append(a.RoutingCountByModel, invocationlog.RoutingCountByModel{Category: d.Key1, Difficulty: d.Key2, RoutingReason: d.Key3, RequestCount: d.Requests})
		case "model":
			a.CostByModel = append(a.CostByModel, invocationlog.CostByModel{Provider: d.Key1, Model: d.Key2, RequestCount: d.Requests, TotalTokens: d.Tokens, CostMicroUSD: d.Cost})
		case "project":
			a.ProjectBreakdown = append(a.ProjectBreakdown, invocationlog.ProjectBreakdown{ProjectID: d.Key1, RequestCount: d.Requests, PromptTokens: d.Prompt, CompletionTokens: d.Completion, TotalTokens: d.Tokens, CostMicroUSD: d.Cost})
		case "application":
			a.ApplicationBreakdown = append(a.ApplicationBreakdown, invocationlog.ApplicationBreakdown{ApplicationID: d.Key1, RequestCount: d.Requests, CostMicroUSD: d.Cost})
		case "scope":
			a.BudgetScopeBreakdown = append(a.BudgetScopeBreakdown, invocationlog.BudgetScopeBreakdown{BudgetScope: budget.Scope{Type: d.Key1, ID: d.Key2, ResolvedBy: d.Key3}, RequestCount: d.Requests, CostMicroUSD: d.Cost})
		}
	}
	return a
}

func (r *ProjectReader) GetCostReport(ctx context.Context, filter invocationlog.CostReportFilter) (invocationlog.CostReportFields, error) {
	normalized, err := invocationlog.NormalizeCostReportFilter(filter)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}
	result := invocationlog.CostReportFields{}
	err = r.observe(ctx, "cost", func(readCtx context.Context) error {
		var queryErr error
		result, queryErr = r.queryCostReport(readCtx, normalized)
		return queryErr
	})
	return result, err
}

type costRow struct {
	Kind       string `json:"kind"`
	BucketMS   int64  `json:"bucket_ms"`
	Key1       string `json:"key1"`
	Key2       string `json:"key2"`
	Key3       string `json:"key3"`
	Requests   int64  `json:"requests"`
	Prompt     int64  `json:"prompt"`
	Completion int64  `json:"completion"`
	Tokens     int64  `json:"tokens"`
	Cost       int64  `json:"cost"`
	Saved      int64  `json:"saved"`
	LastMS     *int64 `json:"last_ms"`
}

func (r *ProjectReader) queryCostReport(ctx context.Context, filter invocationlog.CostReportFilter) (invocationlog.CostReportFields, error) {
	where, params := rollupWhere(filter.TenantID, filter.ProjectID, filter.From, filter.To)
	addUUIDFilter(&where, params, "application_id", "application_id", filter.ApplicationID)
	addStringFilter(&where, params, "provider", "provider", filter.Provider)
	addStringFilter(&where, params, "model", "model", filter.Model)
	addScopeFilter(&where, params, filter.BudgetScope)
	bucketConfig := costBucketConfig(filter)
	bucketExpr := rollupBucketExpression(bucketConfig)
	cte := fmt.Sprintf("WITH filtered AS (SELECT * FROM %s.%s WHERE %s)\n", r.client.database, r.client.dashboardRollupTable(), strings.Join(where, " AND "))
	query := cte + fmt.Sprintf(`SELECT 'bucket' kind,toUnixTimestamp(%s)*1000 bucket_ms,'' key1,'' key2,'' key3,sum(requests) requests,sum(prompt_tokens) prompt,sum(completion_tokens) completion,sum(total_tokens) tokens,sum(cost_micro_usd) cost,sum(saved_cost_micro_usd) saved,toUnixTimestamp64Milli(max(last_created_at)) last_ms FROM filtered GROUP BY %s
UNION ALL SELECT 'project',0,toString(project_id),'','',sum(requests),sum(prompt_tokens),sum(completion_tokens),sum(total_tokens),sum(cost_micro_usd),sum(saved_cost_micro_usd),NULL FROM filtered GROUP BY project_id
UNION ALL SELECT 'application',0,toString(application_id),'','',sum(requests),sum(prompt_tokens),sum(completion_tokens),sum(total_tokens),sum(cost_micro_usd),sum(saved_cost_micro_usd),NULL FROM filtered GROUP BY application_id
UNION ALL SELECT 'model_bucket',toUnixTimestamp(%s)*1000,provider,model,'',sum(requests),sum(prompt_tokens),sum(completion_tokens),sum(total_tokens),sum(cost_micro_usd),sum(saved_cost_micro_usd),NULL FROM filtered WHERE provider!='' AND model!='' GROUP BY %s,provider,model
UNION ALL SELECT 'scope',0,budget_scope_type,budget_scope_id,budget_scope_resolved_by,sum(requests),sum(prompt_tokens),sum(completion_tokens),sum(total_tokens),sum(cost_micro_usd),sum(saved_cost_micro_usd),NULL FROM filtered WHERE budget_scope_id!='' GROUP BY budget_scope_type,budget_scope_id,budget_scope_resolved_by
FORMAT JSONEachRow`, bucketExpr, bucketExpr, bucketExpr, bucketExpr)
	rows, err := queryJSONEachRow[costRow](ctx, r.client, query, params)
	if err != nil {
		return invocationlog.CostReportFields{}, err
	}
	result := invocationlog.CostReportFields{Period: filter.Period, BucketInterval: bucketConfig.IntervalLabel, ExpectedBucketCount: bucketConfig.ExpectedBucketCount, Breakdowns: invocationlog.CostReportBreakdowns{}, DataFreshness: invocationlog.DashboardDataFreshness{Source: "clickhouse_project_application", GeneratedAt: time.Now().UTC(), LastAggregatedAt: time.Now().UTC()}}
	modelTotals := map[string]*invocationlog.CostReportModelBreakdown{}
	for _, row := range rows {
		switch row.Kind {
		case "bucket":
			b := invocationlog.CostReportBucket{PeriodStart: time.UnixMilli(row.BucketMS).UTC(), RequestCount: row.Requests, PromptTokens: row.Prompt, CompletionTokens: row.Completion, TotalTokens: row.Tokens, CostMicroUSD: row.Cost, SavedCostMicroUSD: row.Saved}
			b.PeriodEnd = costReportBucketEnd(b.PeriodStart, bucketConfig, filter.Period)
			b.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(b.CostMicroUSD)
			b.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(b.SavedCostMicroUSD)
			result.Buckets = append(result.Buckets, b)
			if row.LastMS != nil {
				v := time.UnixMilli(*row.LastMS).UTC()
				if result.DataFreshness.LastLogCreatedAt == nil || v.After(*result.DataFreshness.LastLogCreatedAt) {
					result.DataFreshness.LastLogCreatedAt = &v
				}
			}
		case "project":
			result.Breakdowns.ByProject = append(result.Breakdowns.ByProject, invocationlog.CostReportProjectBreakdown{ProjectID: row.Key1, RequestCount: row.Requests, PromptTokens: row.Prompt, CompletionTokens: row.Completion, TotalTokens: row.Tokens, CostMicroUSD: row.Cost, CostUSD: invocationlog.FormatCostUSDFromMicroUSD(row.Cost), SavedCostMicroUSD: row.Saved, SavedCostUSD: invocationlog.FormatCostUSDFromMicroUSD(row.Saved)})
		case "application":
			result.Breakdowns.ByApplication = append(result.Breakdowns.ByApplication, invocationlog.CostReportApplicationBreakdown{ApplicationID: row.Key1, RequestCount: row.Requests, PromptTokens: row.Prompt, CompletionTokens: row.Completion, TotalTokens: row.Tokens, CostMicroUSD: row.Cost, CostUSD: invocationlog.FormatCostUSDFromMicroUSD(row.Cost), SavedCostMicroUSD: row.Saved, SavedCostUSD: invocationlog.FormatCostUSDFromMicroUSD(row.Saved)})
		case "model_bucket":
			result.ModelBuckets = append(result.ModelBuckets, invocationlog.CostReportModelBucket{PeriodStart: time.UnixMilli(row.BucketMS).UTC(), PeriodEnd: costReportBucketEnd(time.UnixMilli(row.BucketMS).UTC(), bucketConfig, filter.Period), Provider: row.Key1, Model: row.Key2, RequestCount: row.Requests})
			key := row.Key1 + "\x00" + row.Key2
			if modelTotals[key] == nil {
				modelTotals[key] = &invocationlog.CostReportModelBreakdown{Provider: row.Key1, Model: row.Key2}
			}
			m := modelTotals[key]
			m.RequestCount += row.Requests
			m.PromptTokens += row.Prompt
			m.CompletionTokens += row.Completion
			m.TotalTokens += row.Tokens
			m.CostMicroUSD += row.Cost
			m.SavedCostMicroUSD += row.Saved
		case "scope":
			result.Breakdowns.ByBudgetScope = append(result.Breakdowns.ByBudgetScope, invocationlog.CostReportBudgetScopeBreakdown{BudgetScope: budget.Scope{Type: row.Key1, ID: row.Key2, ResolvedBy: row.Key3}, RequestCount: row.Requests, PromptTokens: row.Prompt, CompletionTokens: row.Completion, TotalTokens: row.Tokens, CostMicroUSD: row.Cost, CostUSD: invocationlog.FormatCostUSDFromMicroUSD(row.Cost), SavedCostMicroUSD: row.Saved, SavedCostUSD: invocationlog.FormatCostUSDFromMicroUSD(row.Saved)})
		}
	}
	sort.Slice(result.Buckets, func(i, j int) bool { return result.Buckets[i].PeriodStart.Before(result.Buckets[j].PeriodStart) })
	result.Buckets = fillCostBuckets(filter, bucketConfig, result.Buckets)
	for _, b := range result.Buckets {
		result.Totals.RequestCount += b.RequestCount
		result.Totals.PromptTokens += b.PromptTokens
		result.Totals.CompletionTokens += b.CompletionTokens
		result.Totals.TotalTokens += b.TotalTokens
		result.Totals.CostMicroUSD += b.CostMicroUSD
		result.Totals.SavedCostMicroUSD += b.SavedCostMicroUSD
	}
	result.Totals.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(result.Totals.CostMicroUSD)
	result.Totals.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(result.Totals.SavedCostMicroUSD)
	result.DataFreshness.RecordCount = result.Totals.RequestCount
	for _, m := range modelTotals {
		m.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(m.CostMicroUSD)
		m.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(m.SavedCostMicroUSD)
		result.Breakdowns.ByModel = append(result.Breakdowns.ByModel, *m)
	}
	sort.Slice(result.Breakdowns.ByModel, func(i, j int) bool {
		return result.Breakdowns.ByModel[i].CostMicroUSD > result.Breakdowns.ByModel[j].CostMicroUSD
	})
	return result, nil
}

func (r *ProjectReader) observe(ctx context.Context, endpoint string, read func(context.Context) error) error {
	started := time.Now()
	status := "error"
	err := read(ctx)
	if err == nil {
		status = "success"
	} else if errors.Is(err, context.DeadlineExceeded) {
		status = "timeout"
	}
	if r != nil && r.client != nil && r.client.metricsRegistry != nil {
		r.client.metricsRegistry.ClickHouseAnalyticsRead(metrics.ClickHouseAnalyticsRead{Endpoint: endpoint, Status: status, DurationSeconds: time.Since(started).Seconds()})
	}
	return err
}

func projectWhere(tenantID, projectID string, from, to time.Time) ([]string, map[string]string) {
	where := []string{"tenant_id={tenant_id:UUID}", "created_at>=parseDateTime64BestEffort({from:String},3,'UTC')", "created_at<parseDateTime64BestEffort({to:String},3,'UTC')"}
	params := map[string]string{"tenant_id": tenantID, "from": from.UTC().Format(time.RFC3339Nano), "to": to.UTC().Format(time.RFC3339Nano)}
	addUUIDFilter(&where, params, "project_id", "project_id", projectID)
	return where, params
}
func rollupWhere(tenantID, projectID string, from, to time.Time) ([]string, map[string]string) {
	where := []string{"tenant_id={tenant_id:UUID}", "bucket>=parseDateTime64BestEffort({from:String},3,'UTC')", "bucket<parseDateTime64BestEffort({to:String},3,'UTC')"}
	params := map[string]string{"tenant_id": tenantID, "from": from.UTC().Format(time.RFC3339Nano), "to": to.UTC().Format(time.RFC3339Nano)}
	addUUIDFilter(&where, params, "project_id", "project_id", projectID)
	return where, params
}
func addStringFilter(where *[]string, params map[string]string, column, name, value string) {
	if strings.TrimSpace(value) != "" {
		*where = append(*where, column+"={"+name+":String}")
		params[name] = value
	}
}
func addUUIDFilter(where *[]string, params map[string]string, column, name, value string) {
	if strings.TrimSpace(value) != "" {
		*where = append(*where, column+"={"+name+":UUID}")
		params[name] = value
	}
}
func addScopeFilter(where *[]string, params map[string]string, scope budget.Scope) {
	addStringFilter(where, params, "budget_scope_type", "scope_type", scope.Type)
	addStringFilter(where, params, "budget_scope_id", "scope_id", scope.ID)
	addStringFilter(where, params, "budget_scope_resolved_by", "scope_resolved_by", scope.ResolvedBy)
}
func costBucketExpression(config invocationlog.TimeSeriesBucketConfig) string {
	return costBucketExpressionForColumn(config, "created_at")
}

func rollupBucketExpression(config invocationlog.TimeSeriesBucketConfig) string {
	return rollupBucketExpressionForColumn(config, "bucket")
}

func rollupBucketExpressionForColumn(config invocationlog.TimeSeriesBucketConfig, column string) string {
	if config.Unit == "second" {
		// The dashboard rollup bucket is already stored as a second-aligned
		// DateTime. ClickHouse 25.3 only accepts DateTime64 here.
		return column
	}
	return costBucketExpressionForColumn(config, column)
}

func costBucketExpressionForColumn(config invocationlog.TimeSeriesBucketConfig, column string) string {
	switch config.Unit {
	case "second":
		return fmt.Sprintf("toStartOfSecond(%s,'UTC')", column)
	case "minute":
		return fmt.Sprintf("toStartOfMinute(%s,'UTC')", column)
	case "5minute":
		return fmt.Sprintf("toStartOfInterval(%s,INTERVAL 5 MINUTE,'UTC')", column)
	case "hour":
		return fmt.Sprintf("toStartOfHour(%s,'UTC')", column)
	case "week":
		return fmt.Sprintf("toStartOfWeek(%s,1,'UTC')", column)
	case "month":
		return fmt.Sprintf("toStartOfMonth(%s,'UTC')", column)
	default:
		return fmt.Sprintf("toStartOfDay(%s,'UTC')", column)
	}
}
func costBucketConfig(filter invocationlog.CostReportFilter) invocationlog.TimeSeriesBucketConfig {
	if filter.Period == "week" {
		return invocationlog.TimeSeriesBucketConfig{Interval: 7 * 24 * time.Hour, IntervalLabel: "1w", Unit: "week"}
	}
	if filter.Period == "month" {
		return invocationlog.TimeSeriesBucketConfig{IntervalLabel: "1mo", Unit: "month"}
	}
	duration := filter.To.Sub(filter.From)
	if duration <= 5*time.Minute+time.Second {
		return invocationlog.TimeSeriesBucketConfig{Interval: time.Second, IntervalLabel: "1s", ExpectedBucketCount: 300, Unit: "second"}
	}
	if duration <= 15*time.Minute+time.Second {
		return invocationlog.TimeSeriesBucketConfig{Interval: time.Minute, IntervalLabel: "1m", ExpectedBucketCount: 15, Unit: "minute"}
	}
	if duration <= time.Hour+time.Second {
		return invocationlog.TimeSeriesBucketConfig{Interval: 5 * time.Minute, IntervalLabel: "5m", ExpectedBucketCount: 12, Unit: "5minute"}
	}
	if duration <= 24*time.Hour+time.Second {
		return invocationlog.TimeSeriesBucketConfig{Interval: time.Hour, IntervalLabel: "1h", ExpectedBucketCount: 24, Unit: "hour"}
	}
	return invocationlog.TimeSeriesBucketConfig{Interval: 24 * time.Hour, IntervalLabel: "1d", ExpectedBucketCount: 7, Unit: "day"}
}
func costReportBucketEnd(start time.Time, config invocationlog.TimeSeriesBucketConfig, period string) time.Time {
	if config.Interval > 0 {
		return start.Add(config.Interval)
	}
	return costBucketEnd(start, period)
}
func fillCostBuckets(filter invocationlog.CostReportFilter, config invocationlog.TimeSeriesBucketConfig, rows []invocationlog.CostReportBucket) []invocationlog.CostReportBucket {
	if config.ExpectedBucketCount <= 0 || config.Interval <= 0 {
		return rows
	}
	byStart := make(map[time.Time]invocationlog.CostReportBucket, len(rows))
	for _, row := range rows {
		start := invocationlog.AlignTimeSeriesBucketStart(row.PeriodStart, config)
		row.PeriodStart = start
		row.PeriodEnd = start.Add(config.Interval)
		byStart[start] = row
	}
	last := invocationlog.AlignTimeSeriesBucketStart(filter.To.Add(-time.Nanosecond), config)
	first := last.Add(-time.Duration(config.ExpectedBucketCount-1) * config.Interval)
	filled := make([]invocationlog.CostReportBucket, 0, config.ExpectedBucketCount)
	for i := 0; i < config.ExpectedBucketCount; i++ {
		start := first.Add(time.Duration(i) * config.Interval)
		if row, ok := byStart[start]; ok {
			filled = append(filled, row)
		} else {
			filled = append(filled, invocationlog.CostReportBucket{PeriodStart: start, PeriodEnd: start.Add(config.Interval), CostUSD: invocationlog.FormatCostUSDFromMicroUSD(0), SavedCostUSD: invocationlog.FormatCostUSDFromMicroUSD(0)})
		}
	}
	return filled
}
func costBucketEnd(start time.Time, period string) time.Time {
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
