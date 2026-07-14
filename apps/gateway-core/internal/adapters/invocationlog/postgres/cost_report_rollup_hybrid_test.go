package postgres

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestBuildCostReportRollupPlanUsesOnlyCompatibleCompleteBuckets(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 30, 0, 0, time.UTC)
	filter := invocationlog.CostReportFilter{
		TenantID: testTenantID,
		Period:   "month",
		From:     time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		To:       time.Date(2026, 7, 14, 10, 15, 0, 0, time.UTC),
	}

	plan, ok := buildCostReportRollupPlan(filter, now)
	if !ok {
		t.Fatal("expected a hybrid cost report plan")
	}
	if len(plan.Segments) != 3 {
		t.Fatalf("expected month/day/hour segments, got %+v", plan.Segments)
	}
	if plan.Segments[0].Grain != "month" ||
		!plan.Segments[0].From.Equal(filter.From) ||
		!plan.Segments[0].To.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected complete month segment: %+v", plan.Segments[0])
	}
	if plan.Segments[1].Grain != "day" ||
		!plan.Segments[1].To.Equal(time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected complete day segment: %+v", plan.Segments[1])
	}
	if plan.Segments[2].Grain != "hour" ||
		!plan.Segments[2].To.Equal(time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected complete hour segment: %+v", plan.Segments[2])
	}
	if len(plan.RawRanges) != 1 ||
		!plan.RawRanges[0].From.Equal(time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)) ||
		!plan.RawRanges[0].To.Equal(filter.To) {
		t.Fatalf("expected the open hour to stay raw, got %+v", plan.RawRanges)
	}

	filter.Period = "week"
	plan, ok = buildCostReportRollupPlan(filter, now)
	if !ok {
		t.Fatal("expected a weekly hybrid cost report plan")
	}
	for _, segment := range plan.Segments {
		if segment.Grain == "month" {
			t.Fatalf("weekly output cannot be reconstructed from month rollups: %+v", plan.Segments)
		}
	}
}

func TestBuildCostReportRollupPlanFallsBackForUnsupportedContracts(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 30, 0, 0, time.UTC)
	base := invocationlog.CostReportFilter{
		TenantID: testTenantID,
		Period:   "hour",
		From:     now.Add(-2 * time.Hour),
		To:       now,
	}

	cases := []struct {
		name   string
		filter invocationlog.CostReportFilter
	}{
		{name: "provider filter", filter: func() invocationlog.CostReportFilter { value := base; value.Provider = "openai"; return value }()},
		{name: "model filter", filter: func() invocationlog.CostReportFilter { value := base; value.Model = "gpt-4.1-mini"; return value }()},
		{name: "non uuid tenant", filter: func() invocationlog.CostReportFilter { value := base; value.TenantID = "tenant_demo"; return value }()},
		{name: "one hour range", filter: func() invocationlog.CostReportFilter { value := base; value.From = now.Add(-time.Hour); return value }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if plan, ok := buildCostReportRollupPlan(tc.filter, now); ok {
				t.Fatalf("expected raw fallback, got %+v", plan)
			}
		})
	}
}

func TestAddCostReportRollupRowsClosesTotalsRowsOnScanError(t *testing.T) {
	from := time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC)
	totalsRows := &fakeRows{values: [][]any{{"incomplete row"}}}
	db := &fakeQueryer{rowsQueue: []*fakeRows{totalsRows}}
	aggregate := newCostReportAggregate()
	err := NewQueryReader(db).addCostReportRollupRows(
		context.Background(),
		invocationlog.CostReportFilter{
			TenantID: testTenantID,
			Period:   "hour",
			From:     from,
			To:       from.Add(time.Hour),
		},
		[]dashboardRollupSegment{{Grain: "hour", From: from, To: from.Add(time.Hour)}},
		&aggregate,
	)
	if err == nil {
		t.Fatal("expected an invalid totals row to fail scanning")
	}
	if totalsRows.closeCount == 0 {
		t.Fatal("expected rollup totals rows to close on scan failure")
	}
}

func TestAddCostReportRawRangeRowsClosesTotalsRowsOnScanError(t *testing.T) {
	from := time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC)
	totalsRows := &fakeRows{values: [][]any{{"incomplete row"}}}
	db := &fakeQueryer{rowsQueue: []*fakeRows{totalsRows}}
	aggregate := newCostReportAggregate()
	err := NewQueryReader(db).addCostReportRawRangeRows(
		context.Background(),
		invocationlog.CostReportFilter{
			TenantID: testTenantID,
			Period:   "hour",
			From:     from,
			To:       from.Add(time.Hour),
		},
		[]dashboardTimeRange{{From: from, To: from.Add(time.Hour)}},
		&aggregate,
	)
	if err == nil {
		t.Fatal("expected an invalid raw totals row to fail scanning")
	}
	if totalsRows.closeCount == 0 {
		t.Fatal("expected raw totals rows to close on scan failure")
	}
}

func TestBuildCostReportRollupQueriesPreserveTenantApplicationAndBudgetScope(t *testing.T) {
	from := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	filter := invocationlog.CostReportFilter{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		BudgetScope: budget.Scope{
			Type:       "team",
			ID:         "team_demo",
			ResolvedBy: "control_plane_rule",
		},
	}
	segments := []dashboardRollupSegment{
		{Grain: "day", From: from, To: from.Add(24 * time.Hour)},
		{Grain: "hour", From: from.Add(24 * time.Hour), To: from.Add(26 * time.Hour)},
	}

	query, args := buildCostReportRollupTotalsQuery(filter, segments)
	for _, expected := range []string{
		"from dashboard_rollup_totals",
		"tenant_id = $1::uuid",
		"surface = 'project_application'",
		"grain = $2",
		"grain = $5",
		"project_id = $8",
		"application_id = $9",
		"budget_scope_type = $10",
		"budget_scope_id = $11",
		"budget_scope_resolved_by = $12",
		"prompt_tokens",
		"completion_tokens",
		"saved_cost_micro_usd",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected rollup query to contain %q, got %s", expected, query)
		}
	}
	if len(args) != 12 || args[0] != testTenantID || args[7] != testProjectID || args[8] != testApplicationID {
		t.Fatalf("unexpected rollup args: %#v", args)
	}

	modelQuery, _ := buildCostReportRollupModelQuery(filter, segments)
	if !strings.Contains(modelQuery, "from dashboard_rollup_dimensions") ||
		!strings.Contains(modelQuery, "dimension_type = 'provider_model'") {
		t.Fatalf("unexpected model rollup query: %s", modelQuery)
	}
	rawQuery, rawArgs := buildCostReportRawRangeTotalsQuery(filter, []dashboardTimeRange{
		{From: from, To: from.Add(15 * time.Minute)},
		{From: from.Add(45 * time.Minute), To: from.Add(time.Hour)},
	})
	for _, expected := range []string{
		"from p0_llm_invocation_logs",
		"tenant_id = $1",
		"project_id = $2",
		"application_id = $3",
		"created_at >= $4 and created_at < $5",
		"created_at >= $6 and created_at < $7",
		budgetScopeTypeSQL + " = $8",
		budgetScopeIDSQL + " = $9",
		budgetScopeResolvedBySQL + " = $10",
	} {
		if !strings.Contains(rawQuery, expected) {
			t.Fatalf("expected raw edge query to contain %q, got %s", expected, rawQuery)
		}
	}
	if len(rawArgs) != 10 || rawArgs[0] != testTenantID || rawArgs[1] != testProjectID || rawArgs[2] != testApplicationID {
		t.Fatalf("unexpected raw edge args: %#v", rawArgs)
	}
	for _, forbidden := range []string{"raw_prompt", "raw_response", "authorization", "provider_api_key"} {
		if strings.Contains(strings.ToLower(query+modelQuery+rawQuery), forbidden) {
			t.Fatalf("rollup query must not contain %q", forbidden)
		}
	}
}

func TestTryGetCostReportFromRollupsMergesCompletedAndRawBuckets(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 30, 0, 0, time.UTC)
	from := time.Date(2026, 7, 14, 8, 30, 0, 0, time.UTC)
	to := time.Date(2026, 7, 14, 10, 15, 0, 0, time.UTC)
	rollupAggregatedAt := time.Date(2026, 7, 14, 10, 5, 0, 0, time.UTC)
	rollupSourceAt := time.Date(2026, 7, 14, 9, 59, 0, 0, time.UTC)
	rawSourceAt := time.Date(2026, 7, 14, 10, 10, 0, 0, time.UTC)
	scope := budget.Scope{Type: "application", ID: testApplicationID, ResolvedBy: "default_application"}

	db := &fakeQueryer{
		rowByQuery: []fakeQueryRow{{
			contains: "dashboard_rollup_source_cursors",
			row: fakeRow{values: []any{
				int64(1),
				int64(1),
				int64(0),
				sql.NullTime{Time: rollupSourceAt, Valid: true},
				sql.NullTime{Time: rollupAggregatedAt, Valid: true},
			}},
		}},
		rowsByQuery: []fakeQueryRows{
			{
				contains: "from dashboard_rollup_totals",
				rows: &fakeRows{values: [][]any{{
					time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC),
					testProjectID,
					testApplicationID,
					scope.Type,
					scope.ID,
					scope.ResolvedBy,
					int64(10), int64(100), int64(200), int64(300), int64(100), int64(10),
					sql.NullTime{Time: rollupSourceAt, Valid: true},
				}}},
			},
			{
				contains: "from dashboard_rollup_dimensions",
				rows: &fakeRows{values: [][]any{{
					"openai", "gpt-4.1-mini",
					int64(10), int64(100), int64(200), int64(300), int64(100), int64(10),
				}}},
			},
			{
				contains: "last_log_created_at",
				rows: &fakeRows{values: [][]any{
					{
						time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC),
						testProjectID, testApplicationID, scope.Type, scope.ID, scope.ResolvedBy,
						int64(2), int64(20), int64(40), int64(60), int64(20), int64(2),
						sql.NullTime{Time: time.Date(2026, 7, 14, 8, 59, 0, 0, time.UTC), Valid: true},
					},
					{
						time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC),
						testProjectID, testApplicationID, scope.Type, scope.ID, scope.ResolvedBy,
						int64(3), int64(30), int64(60), int64(90), int64(30), int64(3),
						sql.NullTime{Time: rawSourceAt, Valid: true},
					},
				}},
			},
			{
				contains: "cost_report_raw_models",
				rows: &fakeRows{values: [][]any{{
					"openai", "gpt-4.1-mini",
					int64(5), int64(50), int64(100), int64(150), int64(50), int64(5),
				}}},
			},
		},
	}
	reader := NewQueryReader(db)
	report, used, err := reader.tryGetCostReportFromRollups(context.Background(), invocationlog.CostReportFilter{
		TenantID: testTenantID,
		Period:   "hour",
		From:     from,
		To:       to,
	}, now)
	if err != nil {
		t.Fatalf("expected hybrid cost report to succeed, got %v", err)
	}
	if !used {
		t.Fatal("expected completed rollup coverage to be used")
	}
	if report.DataFreshness.Source != "postgresql_hybrid" ||
		report.DataFreshness.LastLogCreatedAt == nil ||
		!report.DataFreshness.LastLogCreatedAt.Equal(rawSourceAt) ||
		!report.DataFreshness.LastAggregatedAt.Equal(rollupAggregatedAt) {
		t.Fatalf("unexpected hybrid freshness: %+v", report.DataFreshness)
	}
	if report.BucketInterval != "1h" || report.ExpectedBucketCount != 24 || len(report.Buckets) != 24 {
		t.Fatalf("expected the existing 24-hour bucket contract, got interval=%s count=%d buckets=%d", report.BucketInterval, report.ExpectedBucketCount, len(report.Buckets))
	}
	if report.Totals.RequestCount != 15 || report.Totals.CostMicroUSD != 150 || report.Totals.CostUSD != "0.000150" {
		t.Fatalf("unexpected merged totals: %+v", report.Totals)
	}
	assertCostReportBucket(t, report.Buckets, time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC), 2, 20)
	assertCostReportBucket(t, report.Buckets, time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC), 10, 100)
	assertCostReportBucket(t, report.Buckets, time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC), 3, 30)
	if len(report.Breakdowns.ByProject) != 1 || report.Breakdowns.ByProject[0].RequestCount != 15 || report.Breakdowns.ByProject[0].CostMicroUSD != 150 {
		t.Fatalf("unexpected merged project breakdown: %+v", report.Breakdowns.ByProject)
	}
	if len(report.Breakdowns.ByModel) != 1 || report.Breakdowns.ByModel[0].RequestCount != 15 || report.Breakdowns.ByModel[0].SavedCostMicroUSD != 15 {
		t.Fatalf("unexpected merged model breakdown: %+v", report.Breakdowns.ByModel)
	}
	if len(db.queries) != 5 {
		t.Fatalf("expected coverage plus four aggregate queries, got %d", len(db.queries))
	}
}

func TestTryGetCostReportFromRollupsFallsBackWhenCoverageIsIncomplete(t *testing.T) {
	now := time.Date(2026, 7, 14, 10, 30, 0, 0, time.UTC)
	db := &fakeQueryer{row: fakeRow{values: []any{
		int64(1), int64(0), int64(0), sql.NullTime{}, sql.NullTime{},
	}}}
	reader := NewQueryReader(db)
	_, used, err := reader.tryGetCostReportFromRollups(context.Background(), invocationlog.CostReportFilter{
		TenantID: testTenantID,
		Period:   "hour",
		From:     now.Add(-2 * time.Hour),
		To:       now,
	}, now)
	if err != nil {
		t.Fatalf("expected incomplete coverage to trigger fallback, got %v", err)
	}
	if used {
		t.Fatal("incomplete coverage must not use rollup rows")
	}
	if len(db.queries) != 1 || !strings.Contains(db.queries[0], "dashboard_rollup_source_cursors") {
		t.Fatalf("expected only the coverage check before fallback, got %+v", db.queries)
	}
}

func TestBuildCostReportFromAggregatePreservesDayWeekAndMonthBuckets(t *testing.T) {
	generatedAt := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	t.Run("day keeps seven sorted zero-filled buckets", func(t *testing.T) {
		filter := invocationlog.CostReportFilter{
			TenantID: testTenantID,
			Period:   "day",
			From:     time.Date(2026, 7, 7, 10, 0, 0, 0, time.UTC),
			To:       time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC),
		}
		aggregate := newCostReportAggregate()
		aggregate.addScopedRow(
			costReportOutputBucketStart(filter, time.Date(2026, 7, 14, 5, 0, 0, 0, time.UTC)),
			"", "", budget.Scope{}, costReportMetrics{RequestCount: 2, CostMicroUSD: 20}, nil,
		)
		aggregate.addScopedRow(
			costReportOutputBucketStart(filter, time.Date(2026, 7, 8, 20, 0, 0, 0, time.UTC)),
			"", "", budget.Scope{}, costReportMetrics{RequestCount: 1, CostMicroUSD: 10}, nil,
		)
		report := buildCostReportFromAggregate(filter, aggregate, generatedAt, "postgresql_hybrid", nil)
		if report.BucketInterval != "1d" || report.ExpectedBucketCount != 7 || len(report.Buckets) != 7 {
			t.Fatalf("unexpected day bucket contract: %+v", report)
		}
		if !report.Buckets[0].PeriodStart.Equal(time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC)) ||
			!report.Buckets[6].PeriodStart.Equal(time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC)) {
			t.Fatalf("day buckets are not sorted across the expected window: %+v", report.Buckets)
		}
		if report.Buckets[1].RequestCount != 0 || report.Buckets[1].CostUSD != "0.000000" {
			t.Fatalf("expected an explicit empty day bucket, got %+v", report.Buckets[1])
		}
		if report.Totals.RequestCount != 3 || report.Totals.CostMicroUSD != 30 {
			t.Fatalf("unexpected day totals: %+v", report.Totals)
		}
	})

	t.Run("week uses utc monday boundaries without synthetic gaps", func(t *testing.T) {
		filter := invocationlog.CostReportFilter{
			TenantID: testTenantID,
			Period:   "week",
			From:     time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC),
			To:       time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC),
		}
		aggregate := newCostReportAggregate()
		for _, source := range []time.Time{
			time.Date(2026, 7, 13, 8, 0, 0, 0, time.UTC),
			time.Date(2026, 7, 12, 8, 0, 0, 0, time.UTC),
		} {
			aggregate.addScopedRow(
				costReportOutputBucketStart(filter, source),
				"", "", budget.Scope{}, costReportMetrics{RequestCount: 1, CostMicroUSD: 10}, nil,
			)
		}
		report := buildCostReportFromAggregate(filter, aggregate, generatedAt, "postgresql_rollup", nil)
		if report.BucketInterval != "1w" || report.ExpectedBucketCount != 0 || len(report.Buckets) != 2 {
			t.Fatalf("unexpected week bucket contract: %+v", report)
		}
		if !report.Buckets[0].PeriodStart.Equal(time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC)) ||
			!report.Buckets[0].PeriodEnd.Equal(time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)) ||
			!report.Buckets[1].PeriodStart.Equal(time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)) {
			t.Fatalf("unexpected UTC week boundaries: %+v", report.Buckets)
		}
	})

	t.Run("month keeps calendar month boundaries", func(t *testing.T) {
		filter := invocationlog.CostReportFilter{
			TenantID: testTenantID,
			Period:   "month",
			From:     time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
			To:       time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
		}
		aggregate := newCostReportAggregate()
		for _, source := range []time.Time{
			time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC),
			time.Date(2026, 6, 30, 8, 0, 0, 0, time.UTC),
		} {
			aggregate.addScopedRow(
				costReportOutputBucketStart(filter, source),
				"", "", budget.Scope{}, costReportMetrics{RequestCount: 1, CostMicroUSD: 10}, nil,
			)
		}
		report := buildCostReportFromAggregate(filter, aggregate, generatedAt, "postgresql_rollup", nil)
		if report.BucketInterval != "1mo" || report.ExpectedBucketCount != 0 || len(report.Buckets) != 2 {
			t.Fatalf("unexpected month bucket contract: %+v", report)
		}
		if !report.Buckets[0].PeriodStart.Equal(time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)) ||
			!report.Buckets[0].PeriodEnd.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)) ||
			!report.Buckets[1].PeriodStart.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)) {
			t.Fatalf("unexpected month boundaries: %+v", report.Buckets)
		}
	})
}

func TestGetCostReportKeepsProviderFilterOnRawRequestLog(t *testing.T) {
	to := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	db := &fakeQueryer{rowsQueue: []*fakeRows{{}, {}, {}, {}, {}}}
	report, err := NewQueryReader(db).GetCostReport(context.Background(), invocationlog.CostReportFilter{
		TenantID: testTenantID,
		Provider: "openai",
		Period:   "hour",
		From:     to.Add(-2 * time.Hour),
		To:       to,
	})
	if err != nil {
		t.Fatalf("expected provider-filtered raw cost report to succeed, got %v", err)
	}
	if report.DataFreshness.Source != "request_log" {
		t.Fatalf("provider filter must keep canonical raw source, got %+v", report.DataFreshness)
	}
	if len(db.queries) != 5 || anyQueryContains(db.queries, "dashboard_rollup_") {
		t.Fatalf("provider filter must not query rollup tables: %+v", db.queries)
	}
	if !anyQueryContains(db.queries, "provider = $4") {
		t.Fatalf("expected provider predicate in raw queries: %+v", db.queries)
	}
}

func assertCostReportBucket(
	t *testing.T,
	buckets []invocationlog.CostReportBucket,
	start time.Time,
	requests int64,
	costMicroUSD int64,
) {
	t.Helper()
	for _, bucket := range buckets {
		if bucket.PeriodStart.Equal(start) {
			if bucket.RequestCount != requests || bucket.CostMicroUSD != costMicroUSD {
				t.Fatalf("unexpected bucket at %s: %+v", start, bucket)
			}
			return
		}
	}
	t.Fatalf("missing bucket at %s", start)
}
