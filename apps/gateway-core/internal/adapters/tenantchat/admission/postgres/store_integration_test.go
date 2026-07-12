package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestStoreAdmissionLifecycleIntegration(t *testing.T) {
	pool, fixture := setupAdmissionIntegration(t)
	store := NewStore(pool)
	now := time.Date(2026, 7, 13, 1, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	limits := tenantchat.AdmissionLimits{
		RequestsPerWindow:          100,
		Window:                     time.Minute,
		MaxActiveAdmissionsPerUser: 2,
		AdmissionTTL:               30 * time.Second,
	}
	requestContext := fixture.requestContext("request_001", "turn_001", "attempt_001")

	created, err := store.Create(context.Background(), requestContext, limits)
	if err != nil {
		t.Fatalf("create admission: %v", err)
	}
	if created.Replayed || created.State != "active" {
		t.Fatalf("unexpected created admission: %+v", created)
	}
	replayed, err := store.Create(context.Background(), requestContext, limits)
	if err != nil || !replayed.Replayed || replayed.AdmissionID != created.AdmissionID {
		t.Fatalf("replay exact admission: result=%+v err=%v", replayed, err)
	}

	conflict := requestContext
	conflict.BindingDigest = "hmac-sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
	if _, err := store.Create(context.Background(), conflict, limits); !errors.Is(err, tenantchat.ErrIdempotencyConflict) {
		t.Fatalf("want idempotency conflict, got %v", err)
	}

	second, err := store.Create(context.Background(), fixture.requestContext("request_002", "turn_002", "attempt_002"), limits)
	if err != nil {
		t.Fatalf("create second admission: %v", err)
	}
	if _, err := store.Create(context.Background(), fixture.requestContext("request_003", "turn_003", "attempt_003"), limits); !errors.Is(err, tenantchat.ErrConcurrencyLimited) {
		t.Fatalf("want concurrency limit, got %v", err)
	}

	cancelContext := requestContext
	cancelContext.Phase = tenantchat.PhaseCancel
	cancelContext.AdmissionID = created.AdmissionID
	cancelContext.BindingDigest = "hmac-sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
	cancelled, err := store.Cancel(context.Background(), cancelContext)
	if err != nil || !cancelled.SlotReleased || cancelled.Replayed {
		t.Fatalf("cancel admission: result=%+v err=%v", cancelled, err)
	}
	replayedCancel, err := store.Cancel(context.Background(), cancelContext)
	if err != nil || !replayedCancel.Replayed {
		t.Fatalf("replay cancellation: result=%+v err=%v", replayedCancel, err)
	}

	third, err := store.Create(context.Background(), fixture.requestContext("request_003", "turn_003", "attempt_003"), limits)
	if err != nil || third.Replayed {
		t.Fatalf("create after releasing slot: result=%+v err=%v", third, err)
	}

	_ = second
}

func TestStoreSerializesConcurrentAdmissionLimitIntegration(t *testing.T) {
	pool, fixture := setupAdmissionIntegration(t)
	store := NewStore(pool)
	store.now = func() time.Time { return time.Date(2026, 7, 13, 2, 0, 0, 0, time.UTC) }
	limits := tenantchat.AdmissionLimits{
		RequestsPerWindow:          100,
		Window:                     time.Minute,
		MaxActiveAdmissionsPerUser: 1,
		AdmissionTTL:               30 * time.Second,
	}

	start := make(chan struct{})
	errorsByRequest := make([]error, 2)
	var wait sync.WaitGroup
	for index := range errorsByRequest {
		index := index
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, errorsByRequest[index] = store.Create(
				context.Background(),
				fixture.requestContext(
					fmt.Sprintf("request_concurrent_%d", index),
					fmt.Sprintf("turn_concurrent_%d", index),
					fmt.Sprintf("attempt_concurrent_%d", index),
				),
				limits,
			)
		}()
	}
	close(start)
	wait.Wait()

	var admitted int
	var limited int
	for _, err := range errorsByRequest {
		switch {
		case err == nil:
			admitted++
		case errors.Is(err, tenantchat.ErrConcurrencyLimited):
			limited++
		default:
			t.Fatalf("unexpected concurrent admission error: %v", err)
		}
	}
	if admitted != 1 || limited != 1 {
		t.Fatalf("concurrent limit was not atomic: admitted=%d limited=%d", admitted, limited)
	}
}

type admissionFixture struct {
	tenantID   string
	userID     string
	employeeID string
}

func (f admissionFixture) requestContext(requestID, turnID, idempotencyKey string) tenantchat.RequestContext {
	return tenantchat.RequestContext{
		Surface:        "tenant_chat",
		Phase:          tenantchat.PhaseAdmission,
		RequestID:      requestID,
		TurnID:         turnID,
		IdempotencyKey: idempotencyKey,
		ExecutionScope: tenantchat.ExecutionScope{
			Kind:     "tenant_chat",
			TenantID: f.tenantID,
			Actor: tenantchat.Actor{
				UserID:     f.userID,
				ActorKind:  "employee",
				EmployeeID: f.employeeID,
			},
			QuotaScope:  tenantchat.ScopeReference{Type: "user", ID: f.userID},
			BudgetScope: tenantchat.ScopeReference{Type: "tenant", ID: f.tenantID},
		},
		Snapshot:      tenantchat.SnapshotReference{Version: 1},
		BindingDigest: "hmac-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	}
}

func setupAdmissionIntegration(t *testing.T) (*pgxpool.Pool, admissionFixture) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, config.DatabaseDriverURL(databaseURL))
	if err != nil {
		t.Fatalf("open integration database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping integration database: %v", err)
	}
	fixture := admissionFixture{
		tenantID:   mustTestUUID(t),
		userID:     mustTestUUID(t),
		employeeID: mustTestUUID(t),
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_request_admissions WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM employees WHERE id = $1::uuid`, fixture.employeeID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_memberships WHERE "tenantId" = $1::uuid AND "userId" = $2::uuid`, fixture.tenantID, fixture.userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, fixture.userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenants WHERE id = $1::uuid`, fixture.tenantID)
		pool.Close()
	})
	inserts := []struct {
		query string
		args  []any
	}{
		{
			query: `INSERT INTO tenants (id, name, status, "createdAt", "updatedAt") VALUES ($1::uuid, 'tenant chat admission integration', 'ACTIVE', now(), now())`,
			args:  []any{fixture.tenantID},
		},
		{
			query: `INSERT INTO users (id, email, status, "createdAt", "updatedAt") VALUES ($1::uuid, $1 || '@integration.local', 'active', now(), now())`,
			args:  []any{fixture.userID},
		},
		{
			query: `INSERT INTO tenant_memberships (id, "tenantId", "userId", role, status, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'employee', 'active', now(), now())`,
			args:  []any{fixture.tenantID, fixture.userID},
		},
		{
			query: `INSERT INTO employees (id, "tenantId", "userId", email, status, "invitationStatus", "createdAt", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $3 || '@integration.local', 'active', 'accepted', now(), now())`,
			args:  []any{fixture.employeeID, fixture.tenantID, fixture.userID},
		},
	}
	for _, insert := range inserts {
		if _, err := pool.Exec(ctx, insert.query, insert.args...); err != nil {
			t.Fatalf("create integration fixture: %v", err)
		}
	}
	return pool, fixture
}

func mustTestUUID(t *testing.T) string {
	t.Helper()
	value, err := newUUID()
	if err != nil {
		t.Fatalf("generate test UUID: %v", err)
	}
	return value
}
