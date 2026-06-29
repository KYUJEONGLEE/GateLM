package postgres

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	"github.com/jackc/pgx/v5"
)

func TestBuildProjectLogsQueryUsesTenantProjectScopeAndSafeColumns(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	query, args := buildProjectLogsQuery(invocationlog.ProjectLogsFilter{
		TenantID:    "tenant_demo",
		ProjectID:   "project_demo",
		From:        from,
		To:          to,
		Status:      invocationlog.StatusSuccess,
		CacheStatus: invocationlog.CacheStatusMiss,
		Limit:       50,
	})

	if !strings.Contains(query, "from p0_llm_invocation_logs") {
		t.Fatalf("expected p0 fallback table query, got %s", query)
	}
	for _, expected := range []string{
		"tenant_id = $1",
		"project_id = $2",
		"created_at >= $3",
		"created_at < $4",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected tenant/project-scoped time range query to contain %q, got %s", expected, query)
		}
	}
	for _, forbidden := range []string{
		"raw_prompt",
		"raw_response",
		"provider_api_key",
		"api_key_plaintext",
		"app_token_plaintext",
		"authorization_header",
		"cookie",
		"raw_provider_error_body",
	} {
		if strings.Contains(strings.ToLower(query), strings.ToLower(forbidden)) {
			t.Fatalf("query must not select forbidden field %q: %s", forbidden, query)
		}
	}
	if len(args) != 7 {
		t.Fatalf("expected tenant/project/from/to/status/cacheStatus/limit args, got %d", len(args))
	}
	if args[0] != "tenant_demo" || args[1] != "project_demo" || args[6] != 50 {
		t.Fatalf("unexpected query args: %#v", args)
	}
}

func TestQueryReaderListProjectLogsScansRows(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	createdAt := from.Add(10 * time.Minute)
	db := &fakeQueryer{
		rows: &fakeRows{
			values: [][]any{{
				"request_001",
				"project_demo",
				sql.NullString{String: "app_demo", Valid: true},
				sql.NullString{String: "application", Valid: true},
				sql.NullString{String: "app_demo", Valid: true},
				sql.NullString{String: "default_application", Valid: true},
				"mock",
				"mock-fast",
				sql.NullString{String: "auto", Valid: true},
				sql.NullString{String: "mock-fast", Valid: true},
				invocationlog.StatusSuccess,
				200,
				int64(32),
				int64(24),
				int64(56),
				int64(1),
				int64(132),
				invocationlog.CacheStatusMiss,
				invocationlog.CacheTypeExact,
				sql.NullString{String: "low_cost", Valid: true},
				"none",
				createdAt,
			}},
		},
	}

	reader := NewQueryReader(db)
	items, err := reader.ListProjectLogs(context.Background(), invocationlog.ProjectLogsFilter{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
		From:      from,
		To:        to,
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("expected list logs to succeed, got %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one list item, got %d", len(items))
	}
	item := items[0]
	if item.RequestID != "request_001" || item.SelectedModel != "mock-fast" || item.CostUSD != "0.000001" {
		t.Fatalf("unexpected list item: %+v", item)
	}
	if item.BudgetScope.Type != "application" || item.BudgetScope.ID != "app_demo" || item.BudgetScope.ResolvedBy != "default_application" {
		t.Fatalf("unexpected budget scope: %+v", item.BudgetScope)
	}
	if item.TerminalStatus != invocationlog.StatusSuccess ||
		item.DomainOutcomes.Provider.Outcome != "success" ||
		item.DomainOutcomes.Cache.Outcome != "miss" {
		t.Fatalf("unexpected list item outcomes: %+v", item)
	}
	if !strings.Contains(db.query, "order by created_at desc, request_id desc") {
		t.Fatalf("expected stable descending sort, got %s", db.query)
	}
	if !strings.Contains(db.query, "tenant_id = $1") || !strings.Contains(db.query, "project_id = $2") {
		t.Fatalf("expected tenant/project scoped list query, got %s", db.query)
	}
	if len(db.args) < 2 || db.args[0] != "tenant_demo" || db.args[1] != "project_demo" {
		t.Fatalf("unexpected list query args: %#v", db.args)
	}
}

func TestQueryReaderGetRequestDetailScansMaskingCacheRouting(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	completedAt := createdAt.Add(132 * time.Millisecond)
	providerLatencyMs := sql.NullInt64{Int64: 86, Valid: true}
	db := &fakeQueryer{
		row: fakeRow{values: []any{
			"request_001",
			"trace_001",
			"tenant_demo",
			"project_demo",
			sql.NullString{String: "app_demo", Valid: true},
			sql.NullString{String: "application", Valid: true},
			sql.NullString{String: "app_demo", Valid: true},
			sql.NullString{String: "default_application", Valid: true},
			invocationlog.StatusSuccess,
			200,
			"mock",
			"mock-fast",
			sql.NullString{String: "auto", Valid: true},
			sql.NullString{String: "mock", Valid: true},
			sql.NullString{String: "mock-fast", Valid: true},
			sql.NullString{String: "low_cost", Valid: true},
			int64(32),
			int64(24),
			int64(56),
			int64(1),
			int64(132),
			providerLatencyMs,
			invocationlog.CacheStatusMiss,
			invocationlog.CacheTypeExact,
			sql.NullString{String: "sha256:cache", Valid: true},
			sql.NullString{},
			"redacted",
			[]byte(`["email"]`),
			1,
			sql.NullString{String: "Send a reply to [EMAIL_REDACTED].", Valid: true},
			sql.NullString{},
			sql.NullString{},
			sql.NullString{},
			createdAt,
			sql.NullTime{Time: completedAt, Valid: true},
			[]byte(`{"runtimeSnapshot":{"runtimeSnapshotId":"runtime_snapshot_query_test","runtimeSnapshotVersion":2,"contentHash":"content_hash_query_test","runtimeState":"snapshot_active","publishedAt":"2026-06-25T00:00:00Z","publishedBy":"runtime_config_compat","gatewayInstanceId":"gateway_query_test","legacyHashes":{"configHash":"config_hash_query_test","securityPolicyHash":"security_hash_query_test","routingPolicyHash":"route_hash_query_test"}},"domainOutcomes":{"auth":{"outcome":"passed","httpStatus":200,"errorCode":null},"runtime":{"outcome":"snapshot_active","runtimeSnapshotId":"runtime_snapshot_query_test","runtimeSnapshotVersion":2,"runtimeState":"snapshot_active"},"rateLimit":{"outcome":"not_checked"},"budget":{"outcome":"not_used","budgetScopeType":"application","budgetScopeId":"app_demo","resolvedBy":"default_application"},"safety":{"outcome":"redacted","maskingAction":"redacted","detectedTypes":["email"],"detectedCount":1,"redactedPromptPreview":"Send a reply to [EMAIL_REDACTED]."},"routing":{"outcome":"selected","requestedModel":"auto","selectedProvider":"mock","selectedModel":"mock-fast","routingReason":"low_cost"},"cache":{"outcome":"miss","cacheType":"exact","cacheHitRequestId":null},"provider":{"outcome":"success","selectedProvider":"mock","selectedModel":"mock-fast","latencyMs":86,"sanitizedErrorCode":null},"fallback":{"outcome":"not_needed","fallbackProvider":null,"reason":null},"streaming":{"outcome":"not_streaming","streamingRequested":false},"logging":{"outcome":"written","requestLogWritten":true,"sanitizedErrorCode":null}}}`),
		}},
	}

	reader := NewQueryReader(db)
	detail, err := reader.GetRequestDetail(context.Background(), invocationlog.RequestDetailFilter{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
		RequestID: "request_001",
	})
	if err != nil {
		t.Fatalf("expected detail to succeed, got %v", err)
	}
	if detail.Masking.MaskingAction != "redacted" || len(detail.Masking.MaskingDetectedTypes) != 1 || detail.Masking.MaskingDetectedTypes[0] != "email" {
		t.Fatalf("unexpected masking detail: %+v", detail.Masking)
	}
	if detail.Cache.CacheKeyHash != "sha256:cache" || detail.Routing.SelectedProvider != "mock" {
		t.Fatalf("unexpected cache/routing detail: %+v %+v", detail.Cache, detail.Routing)
	}
	if detail.BudgetScope.Type != "application" || detail.BudgetScope.ID != "app_demo" || detail.BudgetScope.ResolvedBy != "default_application" {
		t.Fatalf("unexpected budget scope detail: %+v", detail.BudgetScope)
	}
	if detail.TerminalStatus != invocationlog.StatusSuccess ||
		detail.DomainOutcomes.Provider.Outcome != "success" ||
		detail.DomainOutcomes.Cache.Outcome != "miss" ||
		detail.DomainOutcomes.Safety.Outcome != "redacted" {
		t.Fatalf("unexpected detail outcomes: %+v", detail.DomainOutcomes)
	}
	if detail.RuntimeSnapshot == nil ||
		detail.RuntimeSnapshot.RuntimeSnapshotID != "runtime_snapshot_query_test" ||
		detail.RuntimeSnapshot.RuntimeSnapshotVersion != 2 ||
		detail.RuntimeSnapshot.RuntimeState != "snapshot_active" ||
		detail.RuntimeSnapshot.LegacyHashes.RoutingPolicyHash != "route_hash_query_test" {
		t.Fatalf("unexpected runtime snapshot detail: %+v", detail.RuntimeSnapshot)
	}
	for _, expected := range []string{
		"tenant_id = $1",
		"project_id = $2",
		"request_id = $3",
	} {
		if !strings.Contains(db.query, expected) {
			t.Fatalf("expected tenant/project/request scoped detail query to contain %q, got %s", expected, db.query)
		}
	}
	if len(db.args) != 3 || db.args[0] != "tenant_demo" || db.args[1] != "project_demo" || db.args[2] != "request_001" {
		t.Fatalf("unexpected detail query args: %#v", db.args)
	}
}

func TestDecodeDomainOutcomesMetadataNormalizesNullSafetyDetectedTypes(t *testing.T) {
	outcomes, err := decodeDomainOutcomesMetadata([]byte(`{"domainOutcomes":{"safety":{"outcome":"passed","detectedTypes":null,"detectedCount":0}}}`))
	if err != nil {
		t.Fatalf("expected decode to succeed, got %v", err)
	}
	if outcomes.Safety.DetectedTypes == nil {
		t.Fatalf("expected detected types to be normalized to an empty slice")
	}
	if len(outcomes.Safety.DetectedTypes) != 0 {
		t.Fatalf("expected empty detected types, got %#v", outcomes.Safety.DetectedTypes)
	}
}

func TestDecodeDomainOutcomesMetadataNormalizesNullDomainOutcomes(t *testing.T) {
	outcomes, err := decodeDomainOutcomesMetadata([]byte(`{"domainOutcomes":null}`))
	if err != nil {
		t.Fatalf("expected decode to succeed, got %v", err)
	}
	if outcomes.Safety.DetectedTypes == nil {
		t.Fatalf("expected detected types to be normalized to an empty slice")
	}
	if !outcomes.IsZero() {
		t.Fatalf("expected zero domain outcomes, got %+v", outcomes)
	}
}

func TestQueryReaderDashboardOverviewUsesCanonicalSourceCounts(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	lastLogCreatedAt := from.Add(30 * time.Minute)
	db := &fakeQueryer{
		row: fakeRow{values: []any{
			int64(6),
			int64(3),
			int64(1),
			int64(1),
			int64(1),
			int64(1),
			int64(3),
			int64(13),
			int64(20),
			int64(33),
			int64(100),
			int64(50),
			sql.NullFloat64{Float64: 63.3333333333, Valid: true},
			sql.NullFloat64{Float64: 100, Valid: true},
			[]byte(`{"success":3,"blocked":1,"rate_limited":1,"failed":1,"cancelled":1}`),
			[]byte(`{"none":4,"redacted":1,"blocked":1}`),
			[]byte(`[{"selectedProvider":"mock","selectedModel":"mock-fast","routingReason":"short_prompt_low_cost","requestCount":2}]`),
			[]byte(`[{"selectedProvider":"mock","selectedModel":"mock-fast","requestCount":2,"totalTokens":30,"costMicroUsd":100}]`),
			[]byte(`[{"budgetScopeType":"application","budgetScopeId":"app_demo","resolvedBy":"default_application","requestCount":6,"costMicroUsd":100}]`),
			sql.NullTime{Time: lastLogCreatedAt, Valid: true},
		}},
	}

	reader := NewQueryReader(db)
	overview, err := reader.GetDashboardOverview(context.Background(), invocationlog.DashboardOverviewFilter{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
		From:      from,
		To:        to,
	})
	if err != nil {
		t.Fatalf("expected dashboard overview to succeed, got %v", err)
	}
	if overview.TotalRequests != 6 || overview.SuccessfulRequests != 3 || overview.FailedRequests != 1 || overview.BlockedRequests != 1 || overview.RateLimitedRequests != 1 {
		t.Fatalf("unexpected overview counts: %+v", overview)
	}
	if overview.CacheHitRequests != 1 || overview.CacheEligibleRequests != 3 || overview.CacheHitRate == nil || !floatEquals(*overview.CacheHitRate, 1.0/3.0) {
		t.Fatalf("unexpected cache hit rate: %+v", overview.CacheHitRate)
	}
	if overview.PromptTokens != 13 || overview.CompletionTokens != 20 || overview.TotalTokens != 33 || overview.TotalCostUSD != "0.000100" || overview.SavedCostUSD != "0.000050" {
		t.Fatalf("unexpected token/cost totals: %+v", overview)
	}
	if overview.AverageLatencyMs == nil || !floatEquals(*overview.AverageLatencyMs, 63.3333333333) || overview.P95LatencyMs == nil || !floatEquals(*overview.P95LatencyMs, 100) {
		t.Fatalf("unexpected latency metrics: avg=%+v p95=%+v", overview.AverageLatencyMs, overview.P95LatencyMs)
	}
	if overview.StatusCounts[invocationlog.StatusRateLimited] != 1 || overview.MaskingActionCounts["redacted"] != 1 {
		t.Fatalf("unexpected status/masking counts: status=%+v masking=%+v", overview.StatusCounts, overview.MaskingActionCounts)
	}
	if len(overview.RoutingCountByModel) != 1 || overview.RoutingCountByModel[0].SelectedModel != "mock-fast" || overview.RoutingCountByModel[0].RequestCount != 2 {
		t.Fatalf("unexpected routing count by model: %+v", overview.RoutingCountByModel)
	}
	if len(overview.CostByModel) != 1 || overview.CostByModel[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected cost by model: %+v", overview.CostByModel)
	}
	if len(overview.BudgetScopeBreakdown) != 1 || overview.BudgetScopeBreakdown[0].BudgetScope.ID != "app_demo" || overview.BudgetScopeBreakdown[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected budget scope breakdown: %+v", overview.BudgetScopeBreakdown)
	}
	if overview.DataFreshness.RecordCount != 6 || overview.DataFreshness.LastLogCreatedAt == nil || !overview.DataFreshness.LastLogCreatedAt.Equal(lastLogCreatedAt) || overview.DataFreshness.GeneratedAt.IsZero() {
		t.Fatalf("unexpected data freshness: %+v", overview.DataFreshness)
	}
	if !strings.Contains(db.query, "from p0_llm_invocation_logs") || !strings.Contains(db.query, "tenant_id = $3") || !strings.Contains(db.query, "project_id = $4") {
		t.Fatalf("expected tenant/project-scoped dashboard query, got %s", db.query)
	}
	for _, expected := range []string{
		"status = 'failed'",
		"status = 'rate_limited'",
		"cache_eligible_requests",
		"saved_cost_micro_usd",
		"percentile_disc(0.95)",
		"status_counts",
		"masking_action_counts",
		"routing_count_by_model",
		"cost_by_model",
		"budget_scope_breakdown",
	} {
		if !strings.Contains(db.query, expected) {
			t.Fatalf("expected dashboard query to contain %q, got %s", expected, db.query)
		}
	}
	if len(db.args) != 4 || db.args[2] != "tenant_demo" || db.args[3] != "project_demo" {
		t.Fatalf("unexpected dashboard query args: %#v", db.args)
	}
}

func TestQueryReaderGetRequestDetailMapsNoRowsToDomainNotFound(t *testing.T) {
	for _, noRowsErr := range []error{pgx.ErrNoRows, sql.ErrNoRows} {
		reader := NewQueryReader(&fakeQueryer{row: fakeRow{err: noRowsErr}})
		_, err := reader.GetRequestDetail(context.Background(), invocationlog.RequestDetailFilter{
			TenantID:  "tenant_demo",
			ProjectID: "project_demo",
			RequestID: "request_missing",
		})
		if !errors.Is(err, invocationlog.ErrLogNotFound) {
			t.Fatalf("expected domain not found error for %T, got %v", noRowsErr, err)
		}
	}
}

func floatEquals(a float64, b float64) bool {
	return math.Abs(a-b) < 0.0000001
}

type fakeQueryer struct {
	query string
	args  []any
	rows  *fakeRows
	row   fakeRow
}

func (q *fakeQueryer) Query(_ context.Context, query string, arguments ...any) (Rows, error) {
	q.query = query
	q.args = append([]any(nil), arguments...)
	if q.rows == nil {
		q.rows = &fakeRows{}
	}
	return q.rows, nil
}

func (q *fakeQueryer) QueryRow(_ context.Context, query string, arguments ...any) Row {
	q.query = query
	q.args = append([]any(nil), arguments...)
	return q.row
}

type fakeRows struct {
	values [][]any
	index  int
	err    error
}

func (r *fakeRows) Close() {}

func (r *fakeRows) Err() error {
	return r.err
}

func (r *fakeRows) Next() bool {
	return r.index < len(r.values)
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.index >= len(r.values) {
		return errors.New("no row")
	}
	values := r.values[r.index]
	r.index++
	return assignScanValues(dest, values)
}

type fakeRow struct {
	values []any
	err    error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignScanValues(dest, r.values)
}

func assignScanValues(dest []any, values []any) error {
	if len(dest) != len(values) {
		return errors.New("scan destination count mismatch")
	}
	for index := range dest {
		switch target := dest[index].(type) {
		case *string:
			*target = values[index].(string)
		case *int:
			*target = values[index].(int)
		case *int64:
			*target = values[index].(int64)
		case *bool:
			*target = values[index].(bool)
		case *time.Time:
			*target = values[index].(time.Time)
		case *[]byte:
			*target = values[index].([]byte)
		case *sql.NullString:
			*target = values[index].(sql.NullString)
		case *sql.NullInt64:
			*target = values[index].(sql.NullInt64)
		case *sql.NullTime:
			*target = values[index].(sql.NullTime)
		case *sql.NullFloat64:
			*target = values[index].(sql.NullFloat64)
		default:
			return errors.New("unsupported scan destination")
		}
	}
	return nil
}
