package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"

	"github.com/jackc/pgx/v5"
)

func TestResolverLoadsAssignmentPolicyAndMonthlyUsage(t *testing.T) {
	db := &fakeQueryer{row: fakeRow{values: []any{
		"00000000-0000-4000-8000-000000000401",
		[]byte(`{"rateLimit":{"enabled":true,"limit":5,"windowSeconds":60}}`),
		int64(1_000_000),
		80,
		int64(750_000),
	}}}
	resolver := NewResolver(db)
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)

	policy, err := resolver.Resolve(context.Background(), employeepolicy.ResolveRequest{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
		ActorID:   "00000000-0000-4000-8000-000000000401",
		Now:       now,
	})
	if err != nil {
		t.Fatalf("expected resolved policy, got %v", err)
	}
	if !policy.RateLimit.Enabled || policy.RateLimit.Limit != 5 || policy.RateLimit.WindowSeconds != 60 {
		t.Fatalf("unexpected rate limit policy: %#v", policy.RateLimit)
	}
	if !policy.Quota.Enabled || policy.Quota.UsedMicroUSD != 750_000 || policy.Quota.LimitMicroUSD != 1_000_000 {
		t.Fatalf("unexpected quota policy: %#v", policy.Quota)
	}
	if !strings.Contains(db.query, "project_employee_assignments") || !strings.Contains(db.query, "p0_llm_invocation_logs") {
		t.Fatalf("resolver must join assignment and usage sources: %s", db.query)
	}
	if len(db.args) != 5 || db.args[3] != time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("unexpected monthly lookup args: %#v", db.args)
	}
}

func TestResolverReturnsNotFoundForUnknownActor(t *testing.T) {
	resolver := NewResolver(&fakeQueryer{row: fakeRow{err: pgx.ErrNoRows}})
	_, err := resolver.Resolve(context.Background(), employeepolicy.ResolveRequest{
		TenantID:  "tenant",
		ProjectID: "project",
		ActorID:   "actor",
	})
	if !errors.Is(err, employeepolicy.ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
}

type fakeQueryer struct {
	row   fakeRow
	query string
	args  []any
}

func (q *fakeQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.query = query
	q.args = args
	return q.row
}

type fakeRow struct {
	values []any
	err    error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return errors.New("unexpected scan destination count")
	}
	for index := range dest {
		target := reflect.ValueOf(dest[index])
		if target.Kind() != reflect.Pointer || target.IsNil() {
			return errors.New("scan destination must be pointer")
		}
		target.Elem().Set(reflect.ValueOf(r.values[index]))
	}
	return nil
}
