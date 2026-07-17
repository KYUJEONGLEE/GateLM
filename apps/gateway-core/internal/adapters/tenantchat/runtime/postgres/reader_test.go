package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type fakeQueryer struct {
	tenantStatus string
	document     []byte
	err          error
	query        string
	args         []any
}

func (q *fakeQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.query = query
	q.args = args
	return fakeRow{tenantStatus: q.tenantStatus, document: q.document, err: q.err}
}

type fakeRow struct {
	tenantStatus string
	document     []byte
	err          error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	statusTarget, statusOK := dest[0].(*string)
	documentTarget, documentOK := dest[1].(*[]byte)
	if !statusOK || !documentOK {
		return errors.New("unexpected scan target")
	}
	*statusTarget = r.tenantStatus
	*documentTarget = append([]byte(nil), r.document...)
	return nil
}

func TestReaderResolvesOnlyPinnedActiveTenantSnapshot(t *testing.T) {
	document := runtimeSnapshotFixture(t)
	queryer := &fakeQueryer{tenantStatus: "ACTIVE", document: document}
	reader := NewReader(queryer)
	requestContext := runtimeContextFixture()

	snapshot, err := reader.Resolve(context.Background(), requestContext)
	if err != nil {
		t.Fatalf("resolve runtime snapshot: %v", err)
	}
	if snapshot.TenantID != requestContext.ExecutionScope.TenantID || snapshot.Version != requestContext.Snapshot.Version {
		t.Fatalf("resolved wrong snapshot: %+v", snapshot)
	}
	if !strings.Contains(queryer.query, "FROM tenants AS tenant") ||
		!strings.Contains(queryer.query, "snapshot.tenant_id = active.tenant_id") ||
		!strings.Contains(queryer.query, "tenant.id = $1::uuid") {
		t.Fatalf("query does not enforce tenant-bound active snapshot: %s", queryer.query)
	}
	for _, forbidden := range []string{"FROM users", "tenant_memberships", "FROM employees"} {
		if strings.Contains(queryer.query, forbidden) {
			t.Fatalf("runtime query crossed the identity ownership boundary with %q", forbidden)
		}
	}
	if len(queryer.args) != 3 || queryer.args[0] != requestContext.ExecutionScope.TenantID {
		t.Fatalf("unexpected query arguments: %#v", queryer.args)
	}
}

func TestReaderRejectsContextVersionMismatch(t *testing.T) {
	reader := NewReader(&fakeQueryer{tenantStatus: "ACTIVE", document: runtimeSnapshotFixture(t)})
	requestContext := runtimeContextFixture()
	requestContext.Snapshot.PolicyVersion++
	if _, err := reader.Resolve(context.Background(), requestContext); !errors.Is(err, ErrSnapshotUnavailable) {
		t.Fatalf("want unavailable snapshot, got %v", err)
	}
}

func TestReaderRejectsInactiveTenantBeforeUsingRuntime(t *testing.T) {
	reader := NewReader(&fakeQueryer{tenantStatus: "SUSPENDED", document: runtimeSnapshotFixture(t)})
	if _, err := reader.Resolve(context.Background(), runtimeContextFixture()); !errors.Is(err, tenantchat.ErrTenantDisabled) {
		t.Fatalf("want tenant disabled, got %v", err)
	}
}

func TestReaderRejectsMissingActiveRuntime(t *testing.T) {
	reader := NewReader(&fakeQueryer{tenantStatus: "ACTIVE"})
	if _, err := reader.Resolve(context.Background(), runtimeContextFixture()); !errors.Is(err, ErrSnapshotUnavailable) {
		t.Fatalf("want unavailable snapshot, got %v", err)
	}
}

func TestReaderPreservesContextErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want error
	}{
		{name: "canceled", err: fmt.Errorf("query canceled: %w", context.Canceled), want: context.Canceled},
		{name: "deadline exceeded", err: fmt.Errorf("query timed out: %w", context.DeadlineExceeded), want: context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			reader := NewReader(&fakeQueryer{err: test.err})
			if _, err := reader.Resolve(context.Background(), runtimeContextFixture()); !errors.Is(err, test.want) {
				t.Fatalf("want %v, got %v", test.want, err)
			}
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	reader := NewReader(&fakeQueryer{err: errors.New("driver stopped")})
	if _, err := reader.Resolve(ctx, runtimeContextFixture()); !errors.Is(err, context.Canceled) {
		t.Fatalf("want canceled context fallback, got %v", err)
	}
}

func runtimeSnapshotFixture(t *testing.T) []byte {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	path := filepath.Join(filepath.Dir(currentFile), "../../../../../../../docs/tenant-chat/fixtures/tenant-runtime-snapshot.fixture.json")
	document, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read runtime snapshot fixture: %v", err)
	}
	return document
}

func runtimeContextFixture() tenantchat.RequestContext {
	return tenantchat.RequestContext{
		ExecutionScope: tenantchat.ExecutionScope{TenantID: "tenant_fixture_001"},
		Snapshot: tenantchat.SnapshotReference{
			Version:               12,
			Digest:                "sha256:6HVo2OWlvT8xUW9oMggJ9ffN3QdsL03jH07n_tP0EOM",
			PolicyVersion:         8,
			EmployeeNoticeVersion: 3,
			PricingVersion:        5,
		},
	}
}
