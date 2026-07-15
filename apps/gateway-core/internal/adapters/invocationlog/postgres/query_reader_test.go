package postgres

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	"github.com/jackc/pgx/v5"
)

const (
	testTenantID      = "00000000-0000-4000-8000-000000000100"
	testProjectID     = "00000000-0000-4000-8000-000000000200"
	testApplicationID = "00000000-0000-4000-8000-000000000300"
)

func TestBuildProjectLogsQueryUsesTenantProjectScopeAndSafeColumns(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	query, args := buildProjectLogsQuery(invocationlog.ProjectLogsFilter{
		TenantID:    testTenantID,
		ProjectID:   testProjectID,
		From:        from,
		To:          to,
		Status:      invocationlog.StatusSuccess,
		CacheStatus: invocationlog.CacheStatusMiss,
		Limit:       50,
	})

	if !strings.Contains(query, "from p0_llm_invocation_logs") {
		t.Fatalf("expected p0 fallback table query, got %s", query)
	}
	if !strings.Contains(query, "ttft_ms") {
		t.Fatalf("request log list query must expose nullable TTFT, got %s", query)
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
	if args[0] != testTenantID || args[1] != testProjectID || args[6] != 50 {
		t.Fatalf("unexpected query args: %#v", args)
	}
}

func TestBuildProjectLogsQueryRejectsInvalidUUIDScopeWithoutCasting(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	query, args := buildProjectLogsQuery(invocationlog.ProjectLogsFilter{
		TenantID:      "tenant_demo",
		ProjectID:     testProjectID,
		ApplicationID: "app_demo",
		From:          from,
		To:            to,
		Limit:         50,
	})

	if strings.Contains(query, "tenant_id::text =") || strings.Contains(query, "application_id::text =") {
		t.Fatalf("uuid filters must not cast indexed columns to text: %s", query)
	}
	if !strings.Contains(query, "1 = 0") {
		t.Fatalf("expected invalid uuid scope to short-circuit with false predicate, got %s", query)
	}
	if len(args) != 4 || args[0] != testProjectID || args[3] != 50 {
		t.Fatalf("unexpected query args for invalid uuid scope: %#v", args)
	}
}

func TestBuildProjectLogFilterOptionsQueryUsesOnlyTenantProjectTimeScope(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	normalized, err := normalizeProjectLogFilterOptionsFilter(invocationlog.ProjectLogsFilter{
		TenantID:       testTenantID,
		ProjectID:      testProjectID,
		ApplicationID:  testApplicationID,
		From:           from,
		To:             to,
		Status:         invocationlog.StatusSuccess,
		Provider:       "openai",
		RequestedModel: "gpt-4.1-mini",
		CacheStatus:    invocationlog.CacheStatusHit,
		RequestID:      "request_001",
		Limit:          100,
	})
	if err != nil {
		t.Fatalf("normalize filter options filter: %v", err)
	}
	query, args := buildProjectLogFilterOptionsQuery(normalized)

	for _, expected := range []string{
		"tenant_id = $1",
		"project_id = $2",
		"created_at >= $3",
		"created_at < $4",
		"requested_model_options",
		"budget_scope_options",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected filter options query to contain %q, got %s", expected, query)
		}
	}
	for _, forbidden := range []string{
		"provider =",
		"cache_status =",
		"application_id =",
		"request_id =",
		"raw_prompt",
		"raw_response",
		"provider_api_key",
		"authorization_header",
		"cache_key_hash",
	} {
		if strings.Contains(strings.ToLower(query), strings.ToLower(forbidden)) {
			t.Fatalf("filter options query must not contain %q: %s", forbidden, query)
		}
	}
	if len(args) != 4 || args[0] != testTenantID || args[1] != testProjectID {
		t.Fatalf("unexpected filter options args: %#v", args)
	}
}

func TestQueryReaderListProjectLogFilterOptionsScansRows(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	db := &fakeQueryer{
		rows: &fakeRows{
			values: [][]any{
				{
					"requested_model",
					sql.NullString{String: "mock-fast", Valid: true},
					sql.NullString{},
					sql.NullString{},
					sql.NullString{},
				},
				{
					"requested_model",
					sql.NullString{String: "gpt-4.1-mini", Valid: true},
					sql.NullString{},
					sql.NullString{},
					sql.NullString{},
				},
				{
					"budget_scope",
					sql.NullString{},
					sql.NullString{String: "application", Valid: true},
					sql.NullString{String: testApplicationID, Valid: true},
					sql.NullString{String: "default_application", Valid: true},
				},
			},
		},
	}

	reader := NewQueryReader(db)
	options, err := reader.ListProjectLogFilterOptions(context.Background(), invocationlog.ProjectLogsFilter{
		TenantID:       testTenantID,
		ProjectID:      testProjectID,
		From:           from,
		To:             to,
		Status:         invocationlog.StatusSuccess,
		Provider:       "openai",
		RequestedModel: "ignored-by-options-query",
		CacheStatus:    invocationlog.CacheStatusHit,
		RequestID:      "request_001",
		Limit:          100,
	})
	if err != nil {
		t.Fatalf("expected filter options to succeed, got %v", err)
	}
	if len(options.RequestedModels) != 2 || options.RequestedModels[0] != "gpt-4.1-mini" || options.RequestedModels[1] != "mock-fast" {
		t.Fatalf("unexpected requested models: %#v", options.RequestedModels)
	}
	if len(options.BudgetScopes) != 1 ||
		options.BudgetScopes[0].Type != "application" ||
		options.BudgetScopes[0].ID != testApplicationID ||
		options.BudgetScopes[0].ResolvedBy != "default_application" {
		t.Fatalf("unexpected budget scope options: %#v", options.BudgetScopes)
	}
	if strings.Contains(db.query, "cache_status =") || strings.Contains(db.query, "request_id =") {
		t.Fatalf("option query should ignore narrowing filters, got %s", db.query)
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
				sql.NullString{String: "Yoonji", Valid: true},
				sql.NullString{String: "application", Valid: true},
				sql.NullString{String: "app_demo", Valid: true},
				sql.NullString{String: "default_application", Valid: true},
				"mock",
				"mock-fast",
				sql.NullString{String: "auto", Valid: true},
				invocationlog.StatusSuccess,
				200,
				int64(32),
				int64(24),
				int64(56),
				int64(1),
				int64(132),
				sql.NullInt64{Int64: 84, Valid: true},
				invocationlog.CacheStatusMiss,
				invocationlog.CacheTypeExact,
				sql.NullString{String: "category_difficulty_matrix", Valid: true},
				"none",
				createdAt,
				[]byte(`{}`),
			}},
		},
	}

	reader := NewQueryReader(db)
	items, err := reader.ListProjectLogs(context.Background(), invocationlog.ProjectLogsFilter{
		TenantID:  testTenantID,
		ProjectID: testProjectID,
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
	if item.RequestID != "request_001" || item.CostUSD != "0.000001" {
		t.Fatalf("unexpected list item: %+v", item)
	}
	if item.TTFTMs == nil || *item.TTFTMs != 84 {
		t.Fatalf("unexpected list item TTFT: %+v", item.TTFTMs)
	}
	if item.UserRef != "Yoonji" {
		t.Fatalf("unexpected user ref: %+v", item)
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
	if len(db.args) < 2 || db.args[0] != testTenantID || db.args[1] != testProjectID {
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
			sql.NullString{String: "category_difficulty_matrix", Valid: true},
			int64(32),
			int64(24),
			int64(56),
			int64(1),
			int64(132),
			sql.NullInt64{Int64: 84, Valid: true},
			providerLatencyMs,
			invocationlog.CacheStatusMiss,
			invocationlog.CacheTypeExact,
			sql.NullString{String: "sha256:cache", Valid: true},
			sql.NullString{},
			"redacted",
			[]byte(`["email"]`),
			1,
			sql.NullString{String: "Send a reply to [EMAIL_1].", Valid: true},
			sql.NullString{},
			sql.NullString{},
			sql.NullString{},
			createdAt,
			sql.NullTime{Time: completedAt, Valid: true},
			[]byte(`{"runtimeSnapshot":{"runtimeSnapshotId":"runtime_snapshot_query_test","runtimeSnapshotVersion":2,"contentHash":"content_hash_query_test","runtimeState":"snapshot_active","publishedAt":"2026-06-25T00:00:00Z","publishedBy":"runtime_config_compat","gatewayInstanceId":"gateway_query_test","legacyHashes":{"configHash":"config_hash_query_test","securityPolicyHash":"security_hash_query_test","routingPolicyHash":"route_hash_query_test"}},"providerAttempt":{"providerId":"mock","modelId":"mock-fast"},"promptCategory":"general","promptDifficulty":"simple","domainOutcomes":{"auth":{"outcome":"passed","httpStatus":200,"errorCode":null},"runtime":{"outcome":"snapshot_active","runtimeSnapshotId":"runtime_snapshot_query_test","runtimeSnapshotVersion":2,"runtimeState":"snapshot_active"},"rateLimit":{"outcome":"not_checked"},"budget":{"outcome":"not_used","budgetScopeType":"application","budgetScopeId":"app_demo","resolvedBy":"default_application"},"safety":{"outcome":"redacted","maskingAction":"redacted","detectedTypes":["email"],"detectedCount":1,"redactedPromptPreview":"Send a reply to [EMAIL_1]."},"routing":{"outcome":"selected","requestedModel":"auto","routingReason":"category_difficulty_matrix"},"cache":{"outcome":"miss","cacheType":"exact","cacheHitRequestId":null},"provider":{"outcome":"success","latencyMs":86,"sanitizedErrorCode":null},"fallback":{"outcome":"not_needed","reason":null},"streaming":{"outcome":"not_streaming","streamingRequested":false},"logging":{"outcome":"written","requestLogWritten":true,"sanitizedErrorCode":null}}}`),
		}},
	}

	reader := NewQueryReader(db)
	detail, err := reader.GetRequestDetail(context.Background(), invocationlog.RequestDetailFilter{
		TenantID:  testTenantID,
		ProjectID: testProjectID,
		RequestID: "request_001",
	})
	if err != nil {
		t.Fatalf("expected detail to succeed, got %v", err)
	}
	if detail.Masking.MaskingAction != "redacted" || len(detail.Masking.MaskingDetectedTypes) != 1 || detail.Masking.MaskingDetectedTypes[0] != "email" {
		t.Fatalf("unexpected masking detail: %+v", detail.Masking)
	}
	if detail.Cache.CacheKeyHash != "sha256:cache" || detail.Routing.Category != "general" {
		t.Fatalf("unexpected cache/routing detail: %+v %+v", detail.Cache, detail.Routing)
	}
	if detail.Latency.TTFTMs == nil || *detail.Latency.TTFTMs != 84 || detail.LatencySummary.TTFTMs == nil || *detail.LatencySummary.TTFTMs != 84 {
		t.Fatalf("unexpected detail TTFT: latency=%+v summary=%+v", detail.Latency, detail.LatencySummary)
	}
	if detail.ProviderAttempt == nil || detail.ProviderAttempt.ProviderID != "mock" || detail.ProviderAttempt.ModelID != "mock-fast" || detail.ProviderAttempt.Outcome != "success" {
		t.Fatalf("unexpected provider attempt detail: %+v", detail.ProviderAttempt)
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
	if len(db.args) != 3 || db.args[0] != testTenantID || db.args[1] != testProjectID || db.args[2] != "request_001" {
		t.Fatalf("unexpected detail query args: %#v", db.args)
	}
}

func TestQueryReaderGetRequestDetailRejectsInvalidUUIDScopeBeforeQuery(t *testing.T) {
	db := &fakeQueryer{}
	reader := NewQueryReader(db)

	_, err := reader.GetRequestDetail(context.Background(), invocationlog.RequestDetailFilter{
		TenantID:  "tenant_demo",
		ProjectID: testProjectID,
		RequestID: "request_001",
	})

	if !errors.Is(err, invocationlog.ErrLogNotFound) {
		t.Fatalf("expected invalid uuid scope to map to not found, got %v", err)
	}
	if len(db.queries) != 0 {
		t.Fatalf("expected invalid uuid scope to skip query, got %d queries", len(db.queries))
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

func TestApplyInvocationMetadataFieldsMapsPromptAndResponseCapture(t *testing.T) {
	log := invocationlog.LlmInvocationLog{}
	applyInvocationMetadataFields(&log, []byte(`{"promptCapture":{"enabled":true,"mode":"log_safe_full","visibility":"admin_request_detail","capturedPrompt":"문의: [EMAIL_REDACTED]","truncated":false,"maxChars":8000},"responseCapture":{"enabled":true,"mode":"raw_full","visibility":"admin_request_detail","capturedResponse":"Mock response","truncated":false,"maxChars":8000}}`))

	if !log.PromptCapture.Enabled ||
		log.PromptCapture.Mode != "log_safe_full" ||
		log.PromptCapture.Visibility != invocationlog.PromptCaptureVisibilityAdminRequestDetail ||
		log.PromptCapture.CapturedPrompt != "문의: [EMAIL_REDACTED]" ||
		log.PromptCapture.Truncated ||
		log.PromptCapture.MaxChars != 8000 {
		t.Fatalf("unexpected prompt capture fields: %+v", log.PromptCapture)
	}
	if !log.ResponseCapture.Enabled ||
		log.ResponseCapture.Mode != "raw_full" ||
		log.ResponseCapture.Visibility != invocationlog.ResponseCaptureVisibilityAdminRequestDetail ||
		log.ResponseCapture.CapturedResponse != "" ||
		log.ResponseCapture.Truncated ||
		log.ResponseCapture.MaxChars != 8000 {
		t.Fatalf("unexpected response capture fields: %+v", log.ResponseCapture)
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
			int64(0),
			int64(1),
			int64(3),
			int64(1),
			int64(13),
			int64(20),
			int64(33),
			int64(100),
			int64(50),
			sql.NullFloat64{Float64: 63.3333333333, Valid: true},
			sql.NullFloat64{Float64: 100, Valid: true},
			sql.NullFloat64{Float64: 20, Valid: true},
			sql.NullFloat64{Float64: 34, Valid: true},
			sql.NullFloat64{Float64: 86, Valid: true},
			sql.NullFloat64{Float64: 120, Valid: true},
			sql.NullFloat64{Float64: 80, Valid: true},
			sql.NullFloat64{Float64: 70, Valid: true},
			sql.NullFloat64{Float64: 110, Valid: true},
			sql.NullFloat64{Float64: 130, Valid: true},
			int64(4),
			int64(3),
			[]byte(`{"success":3,"blocked":1,"rate_limited":1,"failed":1,"cancelled":1}`),
			[]byte(`{"none":4,"redacted":1,"blocked":1}`),
			[]byte(`{"passed":4,"redacted":1,"blocked":1}`),
			[]byte(`{"hit":1,"miss":2,"bypassed":3}`),
			[]byte(`{"success":1,"not_called":5}`),
			[]byte(`{"allowed":3,"warned":1,"degraded":2}`),
			[]byte(`[{"category":"general","difficulty":"simple","routingReason":"category_difficulty_matrix","requestCount":2}]`),
			[]byte(`[{"provider":"mock","model":"mock-fast","requestCount":2,"totalTokens":30,"costMicroUsd":100}]`),
			[]byte(`[{"projectId":"project_demo","requestCount":6,"promptTokens":13,"completionTokens":20,"totalTokens":33,"costMicroUsd":100}]`),
			[]byte(`[{"applicationId":"app_demo","requestCount":6,"costMicroUsd":100}]`),
			[]byte(`[{"budgetScopeType":"team","budgetScopeId":"team_demo","resolvedBy":"control_plane_rule","requestCount":6,"costMicroUsd":100}]`),
			sql.NullTime{Time: lastLogCreatedAt, Valid: true},
		}},
	}

	reader := NewQueryReader(db)
	overview, err := reader.GetDashboardOverview(context.Background(), invocationlog.DashboardOverviewFilter{
		TenantID:  testTenantID,
		ProjectID: testProjectID,
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
	if overview.CancelledRequests != 0 || overview.FallbackSuccessCount != 1 {
		t.Fatalf("unexpected cancelled/fallback counts: %+v", overview)
	}
	if overview.SafetyOutcomeCounts["blocked"] != 1 || overview.CacheOutcomeCounts["hit"] != 1 || overview.FallbackOutcomeCounts["success"] != 1 {
		t.Fatalf("unexpected outcome counts: safety=%+v cache=%+v fallback=%+v", overview.SafetyOutcomeCounts, overview.CacheOutcomeCounts, overview.FallbackOutcomeCounts)
	}
	if overview.BudgetOutcomeCounts["degraded"] != 2 || overview.BudgetOutcomeCounts["warned"] != 1 {
		t.Fatalf("unexpected budget outcome counts: counts=%+v", overview.BudgetOutcomeCounts)
	}
	if overview.Performance.P95GatewayInternalLatencyMs == nil || !floatEquals(*overview.Performance.P95GatewayInternalLatencyMs, 20) ||
		overview.Performance.P95ProviderLatencyMs == nil || !floatEquals(*overview.Performance.P95ProviderLatencyMs, 86) {
		t.Fatalf("unexpected performance split: %+v", overview.Performance)
	}
	if overview.Performance.GatewayTTFT.Scope != "project_application" ||
		overview.Performance.GatewayTTFT.AverageMs == nil || !floatEquals(*overview.Performance.GatewayTTFT.AverageMs, 80) ||
		overview.Performance.GatewayTTFT.P50Ms == nil || !floatEquals(*overview.Performance.GatewayTTFT.P50Ms, 70) ||
		overview.Performance.GatewayTTFT.P95Ms == nil || !floatEquals(*overview.Performance.GatewayTTFT.P95Ms, 110) ||
		overview.Performance.GatewayTTFT.P99Ms == nil || !floatEquals(*overview.Performance.GatewayTTFT.P99Ms, 130) ||
		overview.Performance.GatewayTTFT.EligibleStreamRequests != 4 ||
		overview.Performance.GatewayTTFT.ObservedRequests != 3 ||
		overview.Performance.GatewayTTFT.CoverageRate == nil || !floatEquals(*overview.Performance.GatewayTTFT.CoverageRate, 0.75) {
		t.Fatalf("unexpected gateway TTFT: %+v", overview.Performance.GatewayTTFT)
	}
	if len(overview.ProjectBreakdown) != 1 || overview.ProjectBreakdown[0].ProjectID != "project_demo" || overview.ProjectBreakdown[0].TotalTokens != 33 || overview.ProjectBreakdown[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected project breakdown: %+v", overview.ProjectBreakdown)
	}
	if len(overview.ApplicationBreakdown) != 1 || overview.ApplicationBreakdown[0].ApplicationID != "app_demo" {
		t.Fatalf("unexpected application breakdown: %+v", overview.ApplicationBreakdown)
	}
	if len(overview.RoutingCountByModel) != 1 || overview.RoutingCountByModel[0].RequestCount != 2 {
		t.Fatalf("unexpected routing count by model: %+v", overview.RoutingCountByModel)
	}
	if len(overview.CostByModel) != 1 || overview.CostByModel[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected cost by model: %+v", overview.CostByModel)
	}
	if len(overview.BudgetScopeBreakdown) != 1 || overview.BudgetScopeBreakdown[0].BudgetScope.ID != "team_demo" || overview.BudgetScopeBreakdown[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected budget scope breakdown: %+v", overview.BudgetScopeBreakdown)
	}
	if overview.DataFreshness.RecordCount != 6 || overview.DataFreshness.LastLogCreatedAt == nil || !overview.DataFreshness.LastLogCreatedAt.Equal(lastLogCreatedAt) || overview.DataFreshness.GeneratedAt.IsZero() {
		t.Fatalf("unexpected data freshness: %+v", overview.DataFreshness)
	}
	if !strings.Contains(db.query, "from p0_llm_invocation_logs") || !strings.Contains(db.query, "tenant_id = $3") || !strings.Contains(db.query, "project_id = $4") {
		t.Fatalf("expected tenant/project-scoped dashboard query, got %s", db.query)
	}
	for _, expected := range []string{
		"terminal_status = 'failed'",
		"terminal_status = 'rate_limited'",
		"cache_eligible_requests",
		"cache_outcome in ('hit', 'miss', 'error') and coalesce(nullif(cache_type, ''), 'none') = 'exact'",
		"saved_cost_micro_usd",
		"percentile_disc(0.95)",
		"avg(ttft_ms) filter (where stream and ttft_ms is not null)",
		"percentile_disc(0.50) within group (order by ttft_ms) filter (where stream and ttft_ms is not null)",
		"percentile_disc(0.95) within group (order by ttft_ms) filter (where stream and ttft_ms is not null)",
		"percentile_disc(0.99) within group (order by ttft_ms) filter (where stream and ttft_ms is not null)",
		"count(*) filter (where stream)::bigint as eligible_stream_requests",
		"count(*) filter (where stream and ttft_ms is not null)::bigint as observed_ttft_requests",
		"status_counts",
		"masking_action_counts",
		"safety_outcome_counts",
		"cache_outcome_counts",
		"fallback_outcome_counts",
		"routing_count_by_model",
		"cost_by_model",
		"project_breakdown",
		"application_breakdown",
		"budget_scope_breakdown",
	} {
		if !strings.Contains(db.query, expected) {
			t.Fatalf("expected dashboard query to contain %q, got %s", expected, db.query)
		}
	}
	if len(db.args) != 4 || db.args[2] != testTenantID || db.args[3] != testProjectID {
		t.Fatalf("unexpected dashboard query args: %#v", db.args)
	}
}

func TestQueryReaderGetAnalyticsPerformanceAggregatesSafeReadModel(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	lastLogCreatedAt := from.Add(23 * time.Hour)
	db := &fakeQueryer{
		rowByQuery: []fakeQueryRow{{
			contains: "total_requests",
			row: fakeRow{
				values: []any{
					int64(3),
					sql.NullFloat64{Float64: 100, Valid: true},
					sql.NullFloat64{Float64: 300, Valid: true},
					sql.NullFloat64{Float64: 300, Valid: true},
					sql.NullFloat64{Float64: 1.0 / 3.0, Valid: true},
					sql.NullTime{Time: lastLogCreatedAt, Valid: true},
				},
			},
		}},
		rowsByQuery: []fakeQueryRows{
			{
				contains: "total_cost_micro_usd",
				rows: &fakeRows{values: [][]any{{
					"OpenAI",
					"gpt-4o-mini",
					int64(2),
					sql.NullFloat64{Float64: 100, Valid: true},
					sql.NullFloat64{Float64: 300, Valid: true},
					sql.NullFloat64{Float64: 300, Valid: true},
					sql.NullFloat64{Float64: 0.5, Valid: true},
					int64(1200000),
					sql.NullFloat64{Float64: 0.25, Valid: true},
				}}},
			},
			{
				contains: "order by p95_latency_ms",
				rows: &fakeRows{values: [][]any{{
					"OpenAI",
					sql.NullFloat64{Float64: 300, Valid: true},
					int64(2),
				}}},
			},
			{
				contains: " as bucket",
				rows: &fakeRows{values: [][]any{{
					from,
					int64(2),
					sql.NullFloat64{Float64: 80, Valid: true},
					sql.NullFloat64{Float64: 300, Valid: true},
					sql.NullFloat64{Float64: 300, Valid: true},
				}}},
			},
			{
				contains: "order by latency_ms desc",
				rows: &fakeRows{values: [][]any{{
					"request_slow_001",
					"project_demo",
					"OpenAI",
					"gpt-4o-mini",
					int64(300),
					500,
					invocationlog.StatusFailed,
					lastLogCreatedAt,
				}}},
			},
		},
	}

	reader := NewQueryReader(db)
	performance, err := reader.GetAnalyticsPerformance(context.Background(), invocationlog.AnalyticsPerformanceFilter{
		TenantID:  testTenantID,
		ProjectID: testProjectID,
		Provider:  "OpenAI",
		Model:     "gpt-4o-mini",
		From:      from,
		To:        to,
	})
	if err != nil {
		t.Fatalf("expected analytics performance to succeed, got %v", err)
	}
	if performance.Summary.TotalRequests != 3 || performance.Summary.P95LatencyMs == nil || *performance.Summary.P95LatencyMs != 300 {
		t.Fatalf("unexpected analytics summary: %+v", performance.Summary)
	}
	if performance.Summary.ThroughputPerMinute == nil || !floatEquals(*performance.Summary.ThroughputPerMinute, 3.0/1440.0) {
		t.Fatalf("unexpected throughput: %+v", performance.Summary.ThroughputPerMinute)
	}
	if len(performance.ProviderModelPerformance) != 1 || performance.ProviderModelPerformance[0].TotalCostUSD != "1.200000" {
		t.Fatalf("unexpected provider/model performance: %+v", performance.ProviderModelPerformance)
	}
	if performance.ProviderModelPerformance[0].CostPerRequestUSD == nil || !floatEquals(*performance.ProviderModelPerformance[0].CostPerRequestUSD, 0.6) {
		t.Fatalf("unexpected cost per request: %+v", performance.ProviderModelPerformance[0].CostPerRequestUSD)
	}
	if len(performance.P95LatencyByProvider) != 1 || performance.P95LatencyByProvider[0].Provider != "OpenAI" {
		t.Fatalf("unexpected provider latency: %+v", performance.P95LatencyByProvider)
	}
	if len(performance.LatencyDistribution) != 24 || !performance.LatencyDistribution[0].Bucket.Equal(from) {
		t.Fatalf("unexpected latency distribution: %+v", performance.LatencyDistribution)
	}
	if performance.BucketInterval != "1h" || performance.ExpectedBucketCount != 24 {
		t.Fatalf("unexpected analytics bucket metadata: interval=%s count=%d", performance.BucketInterval, performance.ExpectedBucketCount)
	}
	if performance.LatencyDistribution[0].P95LatencyMs == nil || *performance.LatencyDistribution[0].P95LatencyMs != 300 {
		t.Fatalf("expected first latency bucket to keep p95 value, got %+v", performance.LatencyDistribution[0])
	}
	if performance.LatencyDistribution[1].Requests != 0 || performance.LatencyDistribution[1].P95LatencyMs != nil {
		t.Fatalf("expected empty latency bucket to keep null latency, got %+v", performance.LatencyDistribution[1])
	}
	if len(performance.SlowestRequests) != 1 || performance.SlowestRequests[0].RequestID != "request_slow_001" || performance.SlowestRequests[0].TerminalStatus != invocationlog.StatusFailed {
		t.Fatalf("unexpected slowest requests: %+v", performance.SlowestRequests)
	}
	if performance.DataFreshness.RecordCount != 3 || performance.DataFreshness.LastLogCreatedAt == nil || !performance.DataFreshness.LastLogCreatedAt.Equal(lastLogCreatedAt) {
		t.Fatalf("unexpected freshness: %+v", performance.DataFreshness)
	}
	if len(db.queries) != 5 {
		t.Fatalf("expected five analytics queries, got %d", len(db.queries))
	}
	joinedQueries := strings.Join(db.queries, "\n")
	for _, expected := range []string{
		"from p0_llm_invocation_logs",
		"tenant_id = $3",
		"project_id = $4",
		"provider = $5",
		"model = $6",
		"percentile_disc(0.95)",
		"provider_key",
		"model_key",
	} {
		if !strings.Contains(joinedQueries, expected) {
			t.Fatalf("expected analytics query to contain %q, got %s", expected, joinedQueries)
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
		if strings.Contains(strings.ToLower(joinedQueries), strings.ToLower(forbidden)) {
			t.Fatalf("analytics query must not select forbidden field %q: %s", forbidden, joinedQueries)
		}
	}
}

func TestQueryReaderGetCostReportFillsExpectedTimeSeriesBuckets(t *testing.T) {
	cases := []struct {
		name             string
		duration         time.Duration
		expectedInterval string
		expectedCount    int
		expectedUnitSQL  string
	}{
		{name: "last 5 minutes", duration: 5 * time.Minute, expectedInterval: "1s", expectedCount: 300, expectedUnitSQL: "date_trunc('second', created_at)"},
		{name: "last 15 minutes", duration: 15 * time.Minute, expectedInterval: "1m", expectedCount: 15, expectedUnitSQL: "date_trunc('minute', created_at)"},
		{name: "last 1 hour", duration: time.Hour, expectedInterval: "5m", expectedCount: 12, expectedUnitSQL: "interval '5 minutes'"},
		{name: "last 24 hours", duration: 24 * time.Hour, expectedInterval: "1h", expectedCount: 24, expectedUnitSQL: "date_trunc('hour', created_at)"},
		{name: "last 7 days", duration: 7 * 24 * time.Hour, expectedInterval: "1d", expectedCount: 7, expectedUnitSQL: "date_trunc('day', created_at)"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			to := time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC)
			from := to.Add(-tc.duration)
			config := costReportBucketConfig(invocationlog.CostReportFilter{
				TenantID: "tenant_demo",
				Period:   "hour",
				From:     from,
				To:       to,
			})
			firstBucket := invocationlog.AlignTimeSeriesBucketStart(to.Add(-time.Nanosecond), config).
				Add(-time.Duration(config.ExpectedBucketCount-1) * config.Interval)
			lastLogCreatedAt := firstBucket.Add(30 * time.Second)
			db := &fakeQueryer{
				rowsQueue: []*fakeRows{
					{values: [][]any{{
						firstBucket,
						int64(2),
						int64(10),
						int64(20),
						int64(30),
						int64(2500),
						int64(100),
						sql.NullTime{Time: lastLogCreatedAt, Valid: true},
					}}},
					{},
					{},
					{},
					{},
				},
			}

			reader := NewQueryReader(db)
			report, err := reader.GetCostReport(context.Background(), invocationlog.CostReportFilter{
				TenantID: "tenant_demo",
				Period:   "hour",
				From:     from,
				To:       to,
			})
			if err != nil {
				t.Fatalf("expected cost report to succeed, got %v", err)
			}

			if report.BucketInterval != tc.expectedInterval || report.ExpectedBucketCount != tc.expectedCount {
				t.Fatalf("unexpected bucket metadata: interval=%s count=%d", report.BucketInterval, report.ExpectedBucketCount)
			}
			if len(report.Buckets) != tc.expectedCount {
				t.Fatalf("expected %d buckets, got %d: %+v", tc.expectedCount, len(report.Buckets), report.Buckets)
			}
			if !report.Buckets[0].PeriodStart.Equal(firstBucket) || report.Buckets[0].RequestCount != 2 || report.Buckets[0].CostMicroUSD != 2500 {
				t.Fatalf("expected first bucket to retain aggregate values, got %+v", report.Buckets[0])
			}
			if report.Buckets[1].RequestCount != 0 || report.Buckets[1].CostMicroUSD != 0 || report.Buckets[1].CostUSD != "0.000000" {
				t.Fatalf("expected empty cost bucket to be zero-filled, got %+v", report.Buckets[1])
			}
			if !strings.Contains(db.queries[0], tc.expectedUnitSQL) {
				t.Fatalf("expected cost bucket query to contain %q, got %s", tc.expectedUnitSQL, db.queries[0])
			}
		})
	}
}

func TestQueryReaderGetAnalyticsPerformanceFillsExpectedLatencyBuckets(t *testing.T) {
	cases := []struct {
		name             string
		duration         time.Duration
		expectedInterval string
		expectedCount    int
		expectedUnitSQL  string
	}{
		{name: "last 5 minutes", duration: 5 * time.Minute, expectedInterval: "7s", expectedCount: 43, expectedUnitSQL: "extract(epoch from created_at) / 7"},
		{name: "last 15 minutes", duration: 15 * time.Minute, expectedInterval: "1m", expectedCount: 15, expectedUnitSQL: "date_trunc('minute', created_at)"},
		{name: "last 1 hour", duration: time.Hour, expectedInterval: "5m", expectedCount: 12, expectedUnitSQL: "interval '5 minutes'"},
		{name: "last 24 hours", duration: 24 * time.Hour, expectedInterval: "1h", expectedCount: 24, expectedUnitSQL: "date_trunc('hour', created_at)"},
		{name: "last 7 days", duration: 7 * 24 * time.Hour, expectedInterval: "1d", expectedCount: 7, expectedUnitSQL: "date_trunc('day', created_at)"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			to := time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC)
			from := to.Add(-tc.duration)
			db := &fakeQueryer{
				rowByQuery: []fakeQueryRow{{
					contains: "total_requests",
					row: fakeRow{
						values: []any{
							int64(0),
							sql.NullFloat64{},
							sql.NullFloat64{},
							sql.NullFloat64{},
							sql.NullFloat64{},
							sql.NullTime{},
						},
					},
				}},
				rowsByQuery: []fakeQueryRows{
					{contains: "total_cost_micro_usd", rows: &fakeRows{}},
					{contains: "order by p95_latency_ms", rows: &fakeRows{}},
					{contains: " as bucket", rows: &fakeRows{}},
					{contains: "order by latency_ms desc", rows: &fakeRows{}},
				},
			}

			reader := NewQueryReader(db)
			performance, err := reader.GetAnalyticsPerformance(context.Background(), invocationlog.AnalyticsPerformanceFilter{
				TenantID: "tenant_demo",
				From:     from,
				To:       to,
			})
			if err != nil {
				t.Fatalf("expected analytics performance to succeed, got %v", err)
			}

			if performance.BucketInterval != tc.expectedInterval || performance.ExpectedBucketCount != tc.expectedCount {
				t.Fatalf("unexpected analytics bucket metadata: interval=%s count=%d", performance.BucketInterval, performance.ExpectedBucketCount)
			}
			if len(performance.LatencyDistribution) != tc.expectedCount {
				t.Fatalf("expected %d latency buckets, got %d: %+v", tc.expectedCount, len(performance.LatencyDistribution), performance.LatencyDistribution)
			}
			for _, bucket := range performance.LatencyDistribution {
				if bucket.Requests != 0 || bucket.P50LatencyMs != nil || bucket.P95LatencyMs != nil || bucket.P99LatencyMs != nil {
					t.Fatalf("expected empty latency bucket to keep null latency values, got %+v", bucket)
				}
			}
			if !anyQueryContains(db.queries, tc.expectedUnitSQL) {
				t.Fatalf("expected latency bucket query to contain %q, got queries %#v", tc.expectedUnitSQL, db.queries)
			}
		})
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

func anyQueryContains(queries []string, expected string) bool {
	for _, query := range queries {
		if strings.Contains(query, expected) {
			return true
		}
	}
	return false
}

type fakeQueryRows struct {
	contains string
	rows     *fakeRows
}

type fakeQueryRow struct {
	contains string
	row      fakeRow
}

type fakeQueryer struct {
	mu          sync.Mutex
	query       string
	args        []any
	queries     []string
	argsList    [][]any
	rows        *fakeRows
	rowsByQuery []fakeQueryRows
	rowsQueue   []*fakeRows
	row         fakeRow
	rowByQuery  []fakeQueryRow
	rowQueue    []fakeRow
}

func (q *fakeQueryer) Query(_ context.Context, query string, arguments ...any) (Rows, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	q.query = query
	q.args = append([]any(nil), arguments...)
	q.queries = append(q.queries, query)
	q.argsList = append(q.argsList, append([]any(nil), arguments...))
	for _, result := range q.rowsByQuery {
		if strings.Contains(query, result.contains) {
			return result.rows, nil
		}
	}
	if len(q.rowsQueue) > 0 {
		rows := q.rowsQueue[0]
		q.rowsQueue = q.rowsQueue[1:]
		return rows, nil
	}
	if q.rows == nil {
		q.rows = &fakeRows{}
	}
	return q.rows, nil
}

func (q *fakeQueryer) QueryRow(_ context.Context, query string, arguments ...any) Row {
	q.mu.Lock()
	defer q.mu.Unlock()

	q.query = query
	q.args = append([]any(nil), arguments...)
	q.queries = append(q.queries, query)
	q.argsList = append(q.argsList, append([]any(nil), arguments...))
	for _, result := range q.rowByQuery {
		if strings.Contains(query, result.contains) {
			return result.row
		}
	}
	if len(q.rowQueue) > 0 {
		row := q.rowQueue[0]
		q.rowQueue = q.rowQueue[1:]
		return row
	}
	return q.row
}

type fakeRows struct {
	values     [][]any
	index      int
	err        error
	closeCount int
}

func (r *fakeRows) Close() {
	r.closeCount++
}

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
		case *[]int64:
			*target = append((*target)[:0], values[index].([]int64)...)
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
