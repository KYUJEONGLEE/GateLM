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
	if !strings.Contains(query, "tenant_id = $1") || !strings.Contains(query, "project_id = $2") || !strings.Contains(query, "created_at >= $3") || !strings.Contains(query, "created_at < $4") {
		t.Fatalf("expected tenant/project-scoped time range query, got %s", query)
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
	if !strings.Contains(db.query, "order by created_at desc, request_id desc") {
		t.Fatalf("expected stable descending sort, got %s", db.query)
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
}

func TestQueryReaderDashboardOverviewUsesCanonicalSourceCounts(t *testing.T) {
	from := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	db := &fakeQueryer{
		row: fakeRow{values: []any{
			int64(4),
			int64(2),
			int64(1),
			int64(1),
			int64(56),
			int64(1),
			sql.NullFloat64{Float64: 50, Valid: true},
		}},
	}

	reader := NewQueryReader(db)
	overview, err := reader.GetDashboardOverview(context.Background(), invocationlog.DashboardOverviewFilter{
		TenantID: "tenant_demo",
		From:     from,
		To:       to,
	})
	if err != nil {
		t.Fatalf("expected dashboard overview to succeed, got %v", err)
	}
	if overview.TotalRequests != 4 || overview.SuccessfulRequests != 2 || overview.BlockedRequests != 1 || overview.CacheHitRequests != 1 {
		t.Fatalf("unexpected overview counts: %+v", overview)
	}
	if overview.CacheHitRate == nil || !floatEquals(*overview.CacheHitRate, 0.25) {
		t.Fatalf("unexpected cache hit rate: %+v", overview.CacheHitRate)
	}
	if !strings.Contains(db.query, "from p0_llm_invocation_logs") || !strings.Contains(db.query, "tenant_id = $3") {
		t.Fatalf("expected tenant-scoped dashboard query, got %s", db.query)
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
