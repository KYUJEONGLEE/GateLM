package clickhouse

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func (r *ProjectReader) GetAnalyticsPolicyImpact(ctx context.Context, filter invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error) {
	normalized, err := invocationlog.NormalizeAnalyticsPolicyImpactFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, err
	}
	normalized.Surface = invocationlog.AnalyticsSurfaceProjectApplication
	var result invocationlog.AnalyticsPolicyImpactFields
	err = r.observe(ctx, "policy_impact", func(readCtx context.Context) error {
		var readErr error
		result, readErr = r.queryPolicyImpact(readCtx, normalized)
		return readErr
	})
	return result, err
}

type policyRow struct {
	Kind         string `json:"kind"`
	Key1         string `json:"key1"`
	Key2         string `json:"key2"`
	BucketMS     int64  `json:"bucket_ms"`
	Requests     int64  `json:"requests"`
	Cost         int64  `json:"cost"`
	KnownSaved   int64  `json:"known_saved"`
	SavedKnown   int64  `json:"saved_known"`
	SavedUnknown int64  `json:"saved_unknown"`
	Avoided      int64  `json:"avoided"`
	Protected    int64  `json:"protected"`
	High         int64  `json:"high"`
	HighEligible int64  `json:"high_eligible"`
	MaskingKnown int64  `json:"masking_known"`
	RoutingKnown int64  `json:"routing_known"`
	ModelKnown   int64  `json:"model_known"`
	LastMS       *int64 `json:"last_ms"`
}

func (r *ProjectReader) queryPolicyImpact(ctx context.Context, filter invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error) {
	where, params := rollupWhere(filter.TenantID, filter.ProjectID, filter.From, filter.To)
	config := policyBucketConfig(filter)
	bucket := rollupBucketExpressionForColumn(config, "source.bucket")
	cte := fmt.Sprintf(`WITH filtered AS (SELECT *,
 cache_outcome='hit' AS cache_hit, masking_action='redacted' AS pii_masked, safety_outcome='blocked' AS safety_blocked,
 terminal_status='rate_limited' AS rate_limited, fallback_outcome='success' AS fallback_success,
 budget_outcome IN ('blocked','hard_limit_exceeded','exceeded') AS budget_blocked,
 (cache_outcome='hit' OR safety_outcome='blocked' OR terminal_status='rate_limited' OR budget_outcome IN ('blocked','hard_limit_exceeded','exceeded')) AS avoided_call,
 (masking_action IN ('redacted','blocked') OR safety_outcome='blocked') AS protected_request
 FROM %s.%s WHERE %s)
`, r.client.database, r.client.dashboardRollupTable(), strings.Join(where, " AND "))
	query := cte + fmt.Sprintf(`SELECT
  'total' kind,
  '' key1,
  '' key2,
  0 bucket_ms,
  sum(source.requests) requests,
  sum(source.cost_micro_usd) cost,
  sum(source.saved_cost_micro_usd) known_saved,
  sum(source.saved_cost_known_requests) saved_known,
  sum(source.requests) - sum(source.saved_cost_known_requests) saved_unknown,
  sumIf(source.requests, source.avoided_call) avoided,
  sumIf(source.requests, source.protected_request) protected,
  sumIf(source.requests, source.routing_difficulty = 'complex') high,
  sumIf(source.requests, source.routing_difficulty != '') high_eligible,
  sumIf(source.requests, source.masking_action != '') masking_known,
  sumIf(source.requests, source.routing_difficulty != '') routing_known,
  sumIf(source.requests, source.provider != '' AND source.model != '') model_known,
  if(sum(source.requests) = 0, NULL, toUnixTimestamp64Milli(max(source.last_created_at))) last_ms
FROM filtered AS source
UNION ALL SELECT 'outcome','cache_hit','',0,sumIf(source.requests,source.cache_hit),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source
UNION ALL SELECT 'outcome','pii_masked','',0,sumIf(source.requests,source.pii_masked),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source
UNION ALL SELECT 'outcome','safety_blocked','',0,sumIf(source.requests,source.safety_blocked),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source
UNION ALL SELECT 'outcome','rate_limited','',0,sumIf(source.requests,source.rate_limited),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source
UNION ALL SELECT 'outcome','fallback_success','',0,sumIf(source.requests,source.fallback_success),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source
UNION ALL SELECT 'outcome','budget_blocked','',0,sumIf(source.requests,source.budget_blocked),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source
UNION ALL SELECT 'routing','difficulty',source.routing_difficulty,0,sum(source.requests),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source WHERE source.routing_difficulty IN ('simple','complex') GROUP BY source.routing_difficulty
UNION ALL SELECT 'model',source.provider,source.model,toUnixTimestamp(%s)*1000,sum(source.requests),0,0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source WHERE source.provider!='' AND source.model!='' GROUP BY %s,source.provider,source.model
UNION ALL SELECT 'usage',toString(source.project_id),'',0,sum(source.requests),sum(source.cost_micro_usd),0,0,0,0,0,0,0,0,0,0,NULL FROM filtered AS source GROUP BY source.project_id
FORMAT JSONEachRow`, bucket, bucket)
	rows, err := queryJSONEachRow[policyRow](ctx, r.client, query, params)
	if err != nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, err
	}
	result := invocationlog.AnalyticsPolicyImpactFields{Period: filter.Period, BucketInterval: config.IntervalLabel, ExpectedBucketCount: config.ExpectedBucketCount, DataFreshness: invocationlog.DashboardDataFreshness{Source: "clickhouse_project_application", GeneratedAt: time.Now().UTC(), LastAggregatedAt: time.Now().UTC()}}
	for _, row := range rows {
		switch row.Kind {
		case "total":
			item := invocationlog.AnalyticsPolicyImpactSurfaceTotal{Surface: invocationlog.AnalyticsSurfaceProjectApplication, RequestCount: row.Requests, CostMicroUSD: row.Cost, KnownSavedCostMicroUSD: row.KnownSaved, SavedCostKnownRequests: row.SavedKnown, SavedCostUnknownRequests: row.SavedUnknown, AvoidedProviderCallRequests: row.Avoided, ProtectedRequests: row.Protected, HighPerformanceRequests: row.High, HighPerformanceEligibleRequests: row.HighEligible, MaskingKnownRequests: row.MaskingKnown, MaskingUnknownRequests: row.Requests - row.MaskingKnown, RoutingKnownRequests: row.RoutingKnown, RoutingUnknownRequests: row.Requests - row.RoutingKnown, ModelKnownRequests: row.ModelKnown, ModelUnknownRequests: row.Requests - row.ModelKnown}
			if row.SavedUnknown == 0 {
				v := row.KnownSaved
				item.SavedCostMicroUSD = &v
			}
			if row.LastMS != nil {
				v := time.UnixMilli(*row.LastMS).UTC()
				item.LastEventAt = &v
				result.DataFreshness.LastLogCreatedAt = &v
			}
			result.SurfaceTotals = append(result.SurfaceTotals, item)
			result.Totals = invocationlog.AnalyticsPolicyImpactTotals{RequestCount: row.Requests, CostMicroUSD: row.Cost, KnownSavedCostMicroUSD: row.KnownSaved, AvoidedProviderCallRequests: row.Avoided, ProtectedRequests: row.Protected, HighPerformanceRequests: row.High, HighPerformanceEligibleRequests: row.HighEligible}
			if row.SavedUnknown == 0 {
				v := row.KnownSaved
				result.Totals.SavedCostMicroUSD = &v
			}
			result.MetricCoverage = []invocationlog.AnalyticsMetricCoverage{coverage("saved_cost", row.SavedKnown, row.SavedUnknown), coverage("pii_masking", row.MaskingKnown, row.Requests-row.MaskingKnown), coverage("high_performance", row.RoutingKnown, row.Requests-row.RoutingKnown), coverage("model_flow", row.ModelKnown, row.Requests-row.ModelKnown)}
			result.DataFreshness.RecordCount = row.Requests
		case "outcome":
			if row.Requests > 0 {
				result.PolicyOutcomes = append(result.PolicyOutcomes, invocationlog.AnalyticsPolicyImpactOutcome{Surface: invocationlog.AnalyticsSurfaceProjectApplication, Outcome: row.Key1, RequestCount: row.Requests})
			}
		case "routing":
			result.RoutingRoles = append(result.RoutingRoles, invocationlog.AnalyticsPolicyImpactRoutingRole{Surface: invocationlog.AnalyticsSurfaceProjectApplication, Scheme: row.Key1, Role: row.Key2, RequestCount: row.Requests})
		case "model":
			start := time.UnixMilli(row.BucketMS).UTC()
			result.ModelBuckets = append(result.ModelBuckets, invocationlog.AnalyticsPolicyImpactModelBucket{Surface: invocationlog.AnalyticsSurfaceProjectApplication, PeriodStart: start, PeriodEnd: costReportBucketEnd(start, config, filter.Period), Provider: row.Key1, Model: row.Key2, RequestCount: row.Requests})
		case "usage":
			result.UsageSources = append(result.UsageSources, invocationlog.AnalyticsPolicyImpactUsageSource{Surface: invocationlog.AnalyticsSurfaceProjectApplication, ProjectID: row.Key1, RequestCount: row.Requests, CostMicroUSD: row.Cost})
		}
	}
	return result, nil
}

func coverage(metric string, known, unknown int64) invocationlog.AnalyticsMetricCoverage {
	status := invocationlog.AnalyticsCoverageComplete
	if unknown > 0 {
		status = invocationlog.AnalyticsCoveragePartial
		if known == 0 {
			status = invocationlog.AnalyticsCoverageUnavailable
		}
	}
	return invocationlog.AnalyticsMetricCoverage{Metric: metric, Surface: invocationlog.AnalyticsSurfaceProjectApplication, Status: status, KnownRequestCount: known, UnknownRequestCount: unknown}
}
func policyBucketConfig(filter invocationlog.AnalyticsPolicyImpactFilter) invocationlog.TimeSeriesBucketConfig {
	return costBucketConfig(invocationlog.CostReportFilter{Period: filter.Period, From: filter.From, To: filter.To})
}

func (r *ProjectReader) GetAnalyticsReliability(ctx context.Context, filter invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error) {
	normalized, err := invocationlog.NormalizeAnalyticsReliabilityFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsReliabilityFields{}, err
	}
	var result invocationlog.AnalyticsReliabilityFields
	err = r.observe(ctx, "reliability", func(readCtx context.Context) error {
		var readErr error
		result, readErr = r.queryReliability(readCtx, normalized)
		return readErr
	})
	return result, err
}

type reliabilityTotalRow struct {
	Requests         int64  `json:"requests"`
	Success          int64  `json:"success"`
	Failed           int64  `json:"failed"`
	Blocked          int64  `json:"blocked"`
	RateLimited      int64  `json:"rate_limited"`
	Cancelled        int64  `json:"cancelled"`
	Unknown          int64  `json:"unknown"`
	FallbackRequests int64  `json:"fallback_requests"`
	FallbackSuccess  int64  `json:"fallback_success"`
	LastMS           *int64 `json:"last_ms"`
}
type reliabilityIncidentRow struct {
	RequestID  string `json:"request_id"`
	ProjectID  string `json:"project_id_text"`
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Status     string `json:"status"`
	Fallback   string `json:"fallback"`
	HTTPStatus int    `json:"http_status"`
	OccurredMS int64  `json:"occurred_ms"`
}

func (r *ProjectReader) queryReliability(ctx context.Context, filter invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error) {
	rollupConditions, params := rollupWhere(filter.TenantID, filter.ProjectID, filter.From, filter.To)
	timeConditions, _ := projectWhere(filter.TenantID, filter.ProjectID, filter.From, filter.To)
	params["limit"] = strconv.Itoa(filter.IncidentLimit)
	rollupBase := fmt.Sprintf("FROM %s.%s AS source WHERE %s", r.client.database, r.client.dashboardRollupTable(), strings.Join(rollupConditions, " AND "))
	timeBase := fmt.Sprintf("FROM %s.%s FINAL WHERE %s", r.client.database, r.client.timeTable(), strings.Join(timeConditions, " AND "))
	totals, err := queryJSONEachRow[reliabilityTotalRow](ctx, r.client, `SELECT sum(source.requests) requests,sumIf(source.requests,source.terminal_status='success') success,sumIf(source.requests,source.terminal_status='failed') failed,sumIf(source.requests,source.terminal_status='blocked') blocked,sumIf(source.requests,source.terminal_status='rate_limited') rate_limited,sumIf(source.requests,source.terminal_status='cancelled') cancelled,sumIf(source.requests,source.terminal_status NOT IN ('success','failed','blocked','rate_limited','cancelled')) unknown,sumIf(source.requests,source.fallback_outcome NOT IN ('','not_called','not_needed')) fallback_requests,sumIf(source.requests,source.fallback_outcome='success') fallback_success,if(sum(source.requests)=0,NULL,toUnixTimestamp64Milli(max(source.last_created_at))) last_ms `+rollupBase+` FORMAT JSONEachRow`, params)
	if err != nil {
		return invocationlog.AnalyticsReliabilityFields{}, err
	}
	if len(totals) != 1 {
		return invocationlog.AnalyticsReliabilityFields{}, unavailableError(fmt.Errorf("unexpected reliability totals row count %d", len(totals)))
	}
	incidents, err := queryJSONEachRow[reliabilityIncidentRow](ctx, r.client, `SELECT request_id,toString(project_id) project_id_text,provider,model,terminal_status status,fallback_outcome fallback,http_status,toUnixTimestamp64Milli(created_at) occurred_ms `+timeBase+` AND terminal_status!='success' ORDER BY created_at DESC,request_id DESC LIMIT {limit:UInt32} FORMAT JSONEachRow`, params)
	if err != nil {
		return invocationlog.AnalyticsReliabilityFields{}, err
	}
	t := totals[0]
	counts := invocationlog.AnalyticsReliabilityTotals{RequestCount: t.Requests, SuccessCount: t.Success, FailedCount: t.Failed, BlockedCount: t.Blocked, RateLimitedCount: t.RateLimited, CancelledCount: t.Cancelled, UnknownCount: t.Unknown, FallbackRequestCount: t.FallbackRequests, FallbackSuccessCount: t.FallbackSuccess}
	now := time.Now().UTC()
	result := invocationlog.AnalyticsReliabilityFields{Scope: invocationlog.AnalyticsReliabilityScope{TenantID: filter.TenantID, Surface: filter.Surface, From: filter.From.UTC(), To: filter.To.UTC()}, GeneratedAt: now, Freshness: invocationlog.AnalyticsReliabilityFreshness{QueryStatus: invocationlog.AnalyticsReliabilityStatusOK, Complete: true}, Totals: counts, Rates: reliabilityRates(counts), TerminalOutcomes: reliabilityOutcomes(counts), Continuity: reliabilityContinuity(counts)}
	if filter.ProjectID != "" {
		v := filter.ProjectID
		result.Scope.ProjectID = &v
	}
	var last *time.Time
	if t.LastMS != nil {
		v := time.UnixMilli(*t.LastMS).UTC()
		last = &v
	}
	result.Freshness.Sources = []invocationlog.AnalyticsReliabilitySourceFreshness{{Surface: invocationlog.AnalyticsSurfaceProjectApplication, QueryMode: invocationlog.AnalyticsReliabilityQueryModeRollup, QueryStatus: invocationlog.AnalyticsReliabilityStatusOK, LastEventAt: last}}
	copyTotals := counts
	result.SurfaceTotals = []invocationlog.AnalyticsReliabilitySurfaceTotals{{Surface: invocationlog.AnalyticsSurfaceProjectApplication, Included: true, Totals: &copyTotals}}
	for _, row := range incidents {
		item := invocationlog.AnalyticsReliabilityIncident{Surface: invocationlog.AnalyticsSurfaceProjectApplication, RequestID: row.RequestID, CanonicalStatus: row.Status, SourceOutcome: row.Status, FallbackOutcome: row.Fallback, OccurredAt: time.UnixMilli(row.OccurredMS).UTC()}
		if row.ProjectID != "" {
			v := row.ProjectID
			item.ProjectID = &v
		}
		if row.Provider != "" {
			v := row.Provider
			item.Provider = &v
		}
		if row.Model != "" {
			v := row.Model
			item.Model = &v
		}
		v := row.HTTPStatus
		item.HTTPStatus = &v
		result.RecentIncidents = append(result.RecentIncidents, item)
	}
	return result, nil
}
func reliabilityRate(n, d int64) *float64 {
	if d <= 0 {
		return nil
	}
	v := float64(n) / float64(d)
	return &v
}
func reliabilityRates(t invocationlog.AnalyticsReliabilityTotals) invocationlog.AnalyticsReliabilityRates {
	return invocationlog.AnalyticsReliabilityRates{SuccessRate: reliabilityRate(t.SuccessCount, t.RequestCount), SystemErrorRate: reliabilityRate(t.FailedCount, t.RequestCount), FallbackRecoveryRate: reliabilityRate(t.FallbackSuccessCount, t.FallbackRequestCount)}
}
func reliabilityOutcomes(t invocationlog.AnalyticsReliabilityTotals) []invocationlog.AnalyticsReliabilityOutcome {
	return []invocationlog.AnalyticsReliabilityOutcome{{Outcome: "success", RequestCount: t.SuccessCount}, {Outcome: "failed", RequestCount: t.FailedCount}, {Outcome: "blocked", RequestCount: t.BlockedCount}, {Outcome: "rate_limited", RequestCount: t.RateLimitedCount}, {Outcome: "cancelled", RequestCount: t.CancelledCount}, {Outcome: "unknown", RequestCount: t.UnknownCount}}
}
func reliabilityContinuity(t invocationlog.AnalyticsReliabilityTotals) invocationlog.AnalyticsReliabilityContinuity {
	without := t.SuccessCount - t.FallbackSuccessCount
	if without < 0 {
		without = 0
	}
	return invocationlog.AnalyticsReliabilityContinuity{SuccessWithoutFallbackCount: without, FallbackRecoveredCount: t.FallbackSuccessCount, FailedCount: t.FailedCount, CancelledCount: t.CancelledCount, ExcludedPolicyCount: t.BlockedCount + t.RateLimitedCount, UnknownCount: t.UnknownCount}
}
