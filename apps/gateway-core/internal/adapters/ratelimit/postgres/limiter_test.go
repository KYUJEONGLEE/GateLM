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
	// Given PostgreSQL counter 증가 후 count가 limit을 초과한다
	now := time.Date(2026, 6, 27, 9, 0, 42, 0, time.UTC)
	db := &fakeQueryer{row: fakeRow{requestCount: 4}}
	limiter := NewLimiter(db)

	// When RateLimiter가 fixed window decision을 만든다
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
	db := &sequenceQueryer{counts: []int{1, 2}}
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

	t.Logf("\n[Input #1]\napplicationId: %s\nrateLimit: enabled=true, algorithm=fixed_window, windowSeconds=60, limit=1\ncounter SQL: PostgreSQL upsert increments request_count atomically", req.ApplicationID)
	t.Logf("\n[Output #1]\nallowed: %t\nreason: %s\nremaining: %d\nwindowStart: %s\nGateway outcome: request can continue to safety/cache/provider",
		firstDecision.Allowed,
		firstDecision.Reason,
		firstDecision.Remaining,
		firstDecision.WindowStart.Format(time.RFC3339),
	)
	t.Logf("\n[Input #2]\napplicationId: %s\nsame fixed window request", req.ApplicationID)
	t.Logf("\n[Output #2]\nallowed: %t\nreason: %s\nremaining: %d\nretryAfterSeconds: %d\nGateway outcome: stage returns 429 rate_limited before provider cost",
		secondDecision.Allowed,
		secondDecision.Reason,
		secondDecision.Remaining,
		secondDecision.RetryAfterSeconds,
	)

	if !firstDecision.Allowed || secondDecision.Allowed || secondDecision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("demo scenario failed: first=%#v second=%#v", firstDecision, secondDecision)
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
	calls int
	query string
	args  []any
	row   fakeRow
}

func (q *fakeQueryer) QueryRow(_ context.Context, query string, arguments ...any) pgx.Row {
	q.calls++
	q.query = query
	q.args = append([]any(nil), arguments...)
	return q.row
}

type sequenceQueryer struct {
	counts []int
	calls  int
}

func (q *sequenceQueryer) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	index := q.calls
	if index >= len(q.counts) {
		index = len(q.counts) - 1
	}
	q.calls++
	return fakeRow{requestCount: q.counts[index]}
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
