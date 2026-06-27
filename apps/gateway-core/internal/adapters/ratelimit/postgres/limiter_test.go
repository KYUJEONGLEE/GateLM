package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLimiterAllowsRequestWithinPostgresFixedWindow(t *testing.T) {
	// Given 같은 Application의 현재 window count가 limit 안쪽이다
	now := time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC)
	db := &fakeQueryer{row: fakeRow{requestCount: 2}}
	limiter := NewLimiter(db)

	// When PostgreSQL counter를 atomic하게 증가시키고 판정한다
	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testConfig(3),
		Now:           now,
	})

	// Then 요청은 허용되고 남은 quota가 계산된다
	if err != nil {
		t.Fatalf("expected allowed decision, got error %v", err)
	}
	if !decision.Allowed || decision.Reason != ratelimit.ReasonWithinLimit || decision.Remaining != 1 {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if decision.WindowStart != time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC) {
		t.Fatalf("unexpected window start: %s", decision.WindowStart)
	}
	if decision.ResetAt != time.Date(2026, 6, 27, 9, 1, 0, 0, time.UTC) {
		t.Fatalf("unexpected resetAt: %s", decision.ResetAt)
	}
	if db.calls != 1 {
		t.Fatalf("expected one query, got %d", db.calls)
	}
	if !strings.Contains(db.query, "on conflict (tenant_id, application_id, window_start)") ||
		!strings.Contains(db.query, "request_count = gateway_rate_limit_counters.request_count + 1") ||
		!strings.Contains(db.query, "where gateway_rate_limit_counters.request_count < excluded.limit_value") ||
		!strings.Contains(db.query, "returning request_count") {
		t.Fatalf("expected atomic upsert SQL, got %s", db.query)
	}
	if len(db.args) != 5 || db.args[0] != testTenantID || db.args[1] != testApplicationID || db.args[4] != 3 {
		t.Fatalf("unexpected query args: %#v", db.args)
	}
}

func TestLimiterTrimsScopeIdentifiersOnceForDecisionAndQuery(t *testing.T) {
	// Given tenant/application id에 앞뒤 공백이 섞여 있다
	db := &fakeQueryer{row: fakeRow{requestCount: 1}}
	limiter := NewLimiter(db)

	// When RateLimiter가 요청 scope를 정규화한다
	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      "  " + testTenantID + "  ",
		ProjectID:     testProjectID,
		ApplicationID: "\t" + testApplicationID + "\n",
		Config:        testConfig(3),
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	// Then decision과 DB query에는 trimmed id만 사용된다
	if err != nil {
		t.Fatalf("expected trimmed identifiers to pass, got %v", err)
	}
	if decision.ScopeID != testApplicationID {
		t.Fatalf("expected trimmed application id in decision, got %q", decision.ScopeID)
	}
	if len(db.args) < 2 || db.args[0] != testTenantID || db.args[1] != testApplicationID {
		t.Fatalf("expected trimmed query args, got %#v", db.args)
	}
}

func TestLimiterBlocksRequestWhenCounterExceedsLimit(t *testing.T) {
	// Given PostgreSQL counter가 이미 limit에 도달했다
	now := time.Date(2026, 6, 27, 9, 0, 42, 0, time.UTC)
	db := &fakeQueryer{rows: []fakeRow{
		{err: pgx.ErrNoRows},
		{requestCount: 3},
	}}
	limiter := NewLimiter(db)

	// When RateLimiter가 counter write를 추가하지 않고 현재 count를 읽는다
	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testConfig(3),
		Now:           now,
	})

	// Then 요청은 provider/cache/safety 이전에 rate_limited로 차단될 수 있는 decision이 된다
	if err != nil {
		t.Fatalf("expected limit_exceeded decision without database error, got %v", err)
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if decision.Remaining != 0 || decision.RetryAfterSeconds != 18 {
		t.Fatalf("unexpected quota fields: %#v", decision)
	}
	if db.calls != 2 {
		t.Fatalf("expected capped upsert and current counter read, got %d calls", db.calls)
	}
	if !strings.Contains(db.queries[0], "where gateway_rate_limit_counters.request_count < excluded.limit_value") {
		t.Fatalf("expected capped upsert SQL, got %s", db.queries[0])
	}
	if !strings.Contains(db.queries[1], "select request_count") {
		t.Fatalf("expected current counter read SQL, got %s", db.queries[1])
	}
}

func TestLimiterFailsClosedWhenCappedCounterReadFails(t *testing.T) {
	// Given capped upsert는 count 증가 없이 끝났지만 현재 counter 조회가 실패한다
	db := &fakeQueryer{rows: []fakeRow{
		{err: pgx.ErrNoRows},
		{err: errors.New("select failed")},
	}}
	limiter := NewLimiter(db)

	// When RateLimiter가 현재 counter를 읽으려 한다
	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testConfig(3),
		Now:           time.Date(2026, 6, 27, 9, 0, 42, 0, time.UTC),
	})

	// Then 잘못 허용하지 않고 fail-closed decision을 반환한다
	if err == nil {
		t.Fatal("expected current counter read error")
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonInternalError {
		t.Fatalf("unexpected error decision: %#v", decision)
	}
	if db.calls != 2 {
		t.Fatalf("expected capped upsert and current counter read, got %d calls", db.calls)
	}
}

func TestLimiterDoesNotTouchDatabaseWhenDisabled(t *testing.T) {
	// Given Runtime Config에서 Rate Limit이 비활성화되어 있다
	db := &fakeQueryer{}
	limiter := NewLimiter(db)

	// When RateLimiter가 요청을 확인한다
	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config: ratelimit.Config{
			Enabled:       false,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: 60,
			Limit:         3,
		},
		Now: time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	// Then counter는 증가하지 않고 disabled reason으로 통과한다
	if err != nil {
		t.Fatalf("expected disabled decision, got %v", err)
	}
	if !decision.Allowed || decision.Reason != ratelimit.ReasonRateLimitDisabled {
		t.Fatalf("unexpected disabled decision: %#v", decision)
	}
	if db.calls != 0 {
		t.Fatalf("disabled rate limit must not touch database, got %d calls", db.calls)
	}
}

func TestLimiterFailsClosedOnDatabaseError(t *testing.T) {
	// Given PostgreSQL counter 저장소에서 오류가 발생한다
	db := &fakeQueryer{row: fakeRow{err: errors.New("database unavailable")}}
	limiter := NewLimiter(db)

	// When RateLimiter가 counter를 확인한다
	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testConfig(3),
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	// Then Gateway stage가 fail-closed 500으로 바꿀 수 있는 internal_error decision이 된다
	if err == nil {
		t.Fatal("expected database error")
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonInternalError {
		t.Fatalf("unexpected error decision: %#v", decision)
	}
}

func TestLimiterReturnsConfigMissingForInvalidConfig(t *testing.T) {
	// Given active runtime config에 필수 Rate Limit 값이 없다
	db := &fakeQueryer{}
	limiter := NewLimiter(db)

	// When RateLimiter가 설정을 검증한다
	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config: ratelimit.Config{
			Enabled:       true,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: 60,
			Limit:         0,
		},
		Now: time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	// Then DB를 건드리지 않고 fail-closed decision을 반환한다
	if err == nil {
		t.Fatal("expected config error")
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonConfigMissing {
		t.Fatalf("unexpected config decision: %#v", decision)
	}
	if db.calls != 0 {
		t.Fatalf("invalid config must not touch database, got %d calls", db.calls)
	}
}

func TestLimiterDemoPostgresFixedWindow(t *testing.T) {
	db := &fakeQueryer{rows: []fakeRow{
		{requestCount: 1},
		{err: pgx.ErrNoRows},
		{requestCount: 1},
	}}
	limiter := NewLimiter(db)
	req := ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testConfig(1),
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	}

	firstDecision, err := limiter.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("first check: %v", err)
	}
	secondDecision, err := limiter.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("second check: %v", err)
	}

	t.Logf("\n[Input #1]\napplicationId: %s\nrateLimit: enabled=true, algorithm=fixed_window, windowSeconds=60, limit=1\ncounter SQL: PostgreSQL capped upsert increments request_count while below limit", req.ApplicationID)
	t.Logf("\n[Output #1]\nallowed: %t\nreason: %s\nremaining: %d\nwindowStart: %s\nGateway outcome: request can continue to safety/cache/provider",
		firstDecision.Allowed,
		firstDecision.Reason,
		firstDecision.Remaining,
		firstDecision.WindowStart.Format(time.RFC3339),
	)
	t.Logf("\n[Input #2]\napplicationId: %s\nsame fixed window request", req.ApplicationID)
	t.Logf("\n[Output #2]\nallowed: %t\nreason: %s\nremaining: %d\nretryAfterSeconds: %d\ncounterWrite: skipped_after_limit\nGateway outcome: stage returns 429 rate_limited before provider cost",
		secondDecision.Allowed,
		secondDecision.Reason,
		secondDecision.Remaining,
		secondDecision.RetryAfterSeconds,
	)

	if !firstDecision.Allowed || secondDecision.Allowed || secondDecision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("demo scenario failed: first=%#v second=%#v", firstDecision, secondDecision)
	}
	if db.calls != 3 {
		t.Fatalf("expected first upsert, capped upsert, and current counter read, got %d calls", db.calls)
	}
}

func TestLimiterIntegrationConcurrentFixedWindow(t *testing.T) {
	databaseURL := os.Getenv("GATELM_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set GATELM_TEST_DATABASE_URL to run PostgreSQL concurrency integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pool.Close()

	tenantID := newTestUUID(t)
	projectID := newTestUUID(t)
	applicationID := newTestUUID(t)
	defer cleanupIntegrationScope(t, context.Background(), pool, tenantID, projectID, applicationID)
	ensureIntegrationScope(t, ctx, pool, tenantID, projectID, applicationID)

	limiter := NewLimiter(pool)
	req := ratelimit.Request{
		TenantID:      tenantID,
		ProjectID:     projectID,
		ApplicationID: applicationID,
		Config:        testConfig(5),
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	}

	var allowed atomic.Int32
	var rateLimited atomic.Int32
	errs := make(chan error, 20)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			decision, err := limiter.Check(ctx, req)
			if err != nil {
				errs <- err
				return
			}
			if decision.Allowed {
				allowed.Add(1)
			} else if decision.Reason == ratelimit.ReasonLimitExceeded {
				rateLimited.Add(1)
			}
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Fatalf("concurrent check failed: %v", err)
	}
	if allowed.Load() != 5 {
		t.Fatalf("expected exactly 5 allowed requests, got %d", allowed.Load())
	}
	if rateLimited.Load() != 15 {
		t.Fatalf("expected exactly 15 rate-limited requests, got %d", rateLimited.Load())
	}

	var finalCount int
	if err := pool.QueryRow(ctx, `
select request_count
from gateway_rate_limit_counters
where tenant_id = $1::uuid
  and application_id = $2::uuid
  and window_start = $3::timestamptz`, tenantID, applicationID, time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC)).Scan(&finalCount); err != nil {
		t.Fatalf("read final counter: %v", err)
	}
	if finalCount != 5 {
		t.Fatalf("expected counter to stop at limit 5, got %d", finalCount)
	}
}

func TestCounterPrunerUsesRetentionAndBatch(t *testing.T) {
	// Given old counter cleanup을 실행할 retention과 batch size가 있다
	now := time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC)
	db := &fakeExecer{tag: pgconn.NewCommandTag("DELETE 7")}
	pruner := NewCounterPruner(db)

	// When pruner가 만료 기준 이전 counter를 삭제한다
	result, err := pruner.Prune(context.Background(), PruneRequest{
		Retention: 24 * time.Hour,
		BatchSize: 500,
		Now:       now,
	})

	// Then cutoff과 batch가 SQL argument로 전달되고 삭제 건수가 반환된다
	if err != nil {
		t.Fatalf("expected prune success, got %v", err)
	}
	if result.Deleted != 7 || result.Cutoff != now.Add(-24*time.Hour) || result.BatchSize != 500 {
		t.Fatalf("unexpected prune result: %#v", result)
	}
	if db.calls != 1 {
		t.Fatalf("expected one prune query, got %d", db.calls)
	}
	if !strings.Contains(db.query, "where updated_at < $1::timestamptz") ||
		!strings.Contains(db.query, "limit $2::int") {
		t.Fatalf("unexpected prune SQL: %s", db.query)
	}
	if len(db.args) != 2 || db.args[0] != result.Cutoff || db.args[1] != 500 {
		t.Fatalf("unexpected prune args: %#v", db.args)
	}
}

func TestCounterPrunerUsesDefaults(t *testing.T) {
	// Given retention과 batch size가 명시되지 않았다
	now := time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC)
	db := &fakeExecer{tag: pgconn.NewCommandTag("DELETE 0")}
	pruner := NewCounterPruner(db)

	// When pruner가 기본값으로 실행된다
	result, err := pruner.Prune(context.Background(), PruneRequest{Now: now})

	// Then v1 기본 보존 기간과 batch size가 적용된다
	if err != nil {
		t.Fatalf("expected prune success, got %v", err)
	}
	if result.Retention != DefaultCounterRetention || result.BatchSize != DefaultPruneBatchSize {
		t.Fatalf("unexpected defaults: %#v", result)
	}
	if result.Cutoff != now.Add(-DefaultCounterRetention) {
		t.Fatalf("unexpected cutoff: %s", result.Cutoff)
	}
}

func TestCounterPrunerRequiresDatabaseExecutor(t *testing.T) {
	// Given pruner에 DB executor가 연결되지 않았다
	pruner := NewCounterPruner(nil)

	// When cleanup을 실행한다
	_, err := pruner.Prune(context.Background(), PruneRequest{})

	// Then 운영자가 잘못된 wiring을 알 수 있도록 오류를 반환한다
	if !errors.Is(err, ErrMissingPrunerStore) {
		t.Fatalf("expected missing pruner store error, got %v", err)
	}
}

func TestCounterPrunerIntegrationDeletesExpiredCounters(t *testing.T) {
	databaseURL := os.Getenv("GATELM_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set GATELM_TEST_DATABASE_URL to run PostgreSQL pruning integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pool.Close()

	tenantID := newTestUUID(t)
	projectID := newTestUUID(t)
	applicationID := newTestUUID(t)
	defer cleanupIntegrationScope(t, context.Background(), pool, tenantID, projectID, applicationID)
	ensureIntegrationScope(t, ctx, pool, tenantID, projectID, applicationID)

	now := time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC)
	execIntegrationSQL(t, ctx, pool, `
insert into gateway_rate_limit_counters (
  tenant_id,
  application_id,
  window_start,
  window_seconds,
  limit_value,
  request_count,
  created_at,
  updated_at
) values
  ($1::uuid, $2::uuid, $3::timestamptz, 60, 10, 10, $5::timestamptz, $5::timestamptz),
  ($1::uuid, $2::uuid, $4::timestamptz, 60, 10, 1, $6::timestamptz, $6::timestamptz)`,
		tenantID,
		applicationID,
		now.Add(-48*time.Hour),
		now.Add(-1*time.Hour),
		now.Add(-48*time.Hour),
		now.Add(-1*time.Hour),
	)

	result, err := NewCounterPruner(pool).Prune(ctx, PruneRequest{
		Retention: 24 * time.Hour,
		BatchSize: 100,
		Now:       now,
	})
	if err != nil {
		t.Fatalf("prune counters: %v", err)
	}
	if result.Deleted != 1 {
		t.Fatalf("expected one expired counter deleted, got %#v", result)
	}

	var remaining int
	if err := pool.QueryRow(ctx, `
select count(*)
from gateway_rate_limit_counters
where tenant_id = $1::uuid
  and application_id = $2::uuid`, tenantID, applicationID).Scan(&remaining); err != nil {
		t.Fatalf("count remaining counters: %v", err)
	}
	if remaining != 1 {
		t.Fatalf("expected one recent counter to remain, got %d", remaining)
	}
}

const (
	testTenantID      = "00000000-0000-4000-8000-000000000100"
	testProjectID     = "00000000-0000-4000-8000-000000000200"
	testApplicationID = "00000000-0000-4000-8000-000000000300"
)

func testConfig(limit int) ratelimit.Config {
	return ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         limit,
	}
}

type fakeQueryer struct {
	calls       int
	query       string
	args        []any
	queries     []string
	argsHistory [][]any
	row         fakeRow
	rows        []fakeRow
}

func (q *fakeQueryer) QueryRow(_ context.Context, query string, arguments ...any) pgx.Row {
	q.calls++
	q.query = query
	q.args = append([]any(nil), arguments...)
	q.queries = append(q.queries, query)
	q.argsHistory = append(q.argsHistory, append([]any(nil), arguments...))
	if index := q.calls - 1; index < len(q.rows) {
		return q.rows[index]
	}
	return q.row
}

type fakeExecer struct {
	calls int
	query string
	args  []any
	tag   pgconn.CommandTag
	err   error
}

func (e *fakeExecer) Exec(_ context.Context, query string, arguments ...any) (pgconn.CommandTag, error) {
	e.calls++
	e.query = query
	e.args = append([]any(nil), arguments...)
	if e.err != nil {
		return pgconn.CommandTag{}, e.err
	}
	return e.tag, nil
}

type fakeRow struct {
	requestCount int
	err          error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	count, ok := dest[0].(*int)
	if !ok {
		return fmt.Errorf("expected *int scan destination, got %T", dest[0])
	}
	*count = r.requestCount
	return nil
}

func newTestUUID(t *testing.T) string {
	t.Helper()

	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("generate uuid: %v", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
}

func ensureIntegrationScope(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID string, projectID string, applicationID string) {
	t.Helper()

	suffix := strings.ReplaceAll(applicationID[len(applicationID)-12:], "-", "")
	execIntegrationSQL(t, ctx, pool, `
insert into tenants (id, name, slug, plan, status)
values ($1::uuid, $2, $3, 'starter', 'active')
on conflict (id) do nothing`, tenantID, "Rate Limit Test Tenant", "rl-test-tenant-"+suffix)
	execIntegrationSQL(t, ctx, pool, `
insert into projects (id, tenant_id, name, slug, status)
values ($1::uuid, $2::uuid, $3, $4, 'active')
on conflict (id) do nothing`, projectID, tenantID, "Rate Limit Test Project", "rl-test-project-"+suffix)
	execIntegrationSQL(t, ctx, pool, `
insert into applications (id, tenant_id, project_id, name, slug, status)
values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'active')
on conflict (id) do nothing`, applicationID, tenantID, projectID, "Rate Limit Test Application", "rl-test-app-"+suffix)
}

func cleanupIntegrationScope(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID string, projectID string, applicationID string) {
	t.Helper()

	execIntegrationSQL(t, ctx, pool, `delete from gateway_rate_limit_counters where tenant_id = $1::uuid`, tenantID)
	execIntegrationSQL(t, ctx, pool, `delete from applications where id = $1::uuid`, applicationID)
	execIntegrationSQL(t, ctx, pool, `delete from projects where id = $1::uuid`, projectID)
	execIntegrationSQL(t, ctx, pool, `delete from tenants where id = $1::uuid`, tenantID)
}

func execIntegrationSQL(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()

	if _, err := pool.Exec(ctx, query, args...); err != nil {
		t.Fatalf("exec integration SQL: %v", err)
	}
}
