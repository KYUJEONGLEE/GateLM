package postgres

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type fakeQueryer struct {
	document []byte
	err      error
	query    string
	args     []any
}

func (q *fakeQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.query = query
	q.args = args
	return fakeRow{document: q.document, err: q.err}
}

type fakeRow struct {
	document []byte
	err      error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	target, ok := dest[0].(*[]byte)
	if !ok {
		return errors.New("unexpected scan target")
	}
	*target = append([]byte(nil), r.document...)
	return nil
}

func TestReaderResolvesOnlyPinnedActiveTenantSnapshot(t *testing.T) {
	document := runtimeSnapshotFixture(t)
	queryer := &fakeQueryer{document: document}
	reader := NewReader(queryer)
	requestContext := runtimeContextFixture()

	snapshot, err := reader.Resolve(context.Background(), requestContext)
	if err != nil {
		t.Fatalf("resolve runtime snapshot: %v", err)
	}
	if snapshot.TenantID != requestContext.ExecutionScope.TenantID || snapshot.Version != requestContext.Snapshot.Version {
		t.Fatalf("resolved wrong snapshot: %+v", snapshot)
	}
	if !strings.Contains(queryer.query, "snapshot.tenant_id = active.tenant_id") ||
		!strings.Contains(queryer.query, "active.tenant_id = $1::uuid") {
		t.Fatalf("query does not enforce tenant-bound active snapshot: %s", queryer.query)
	}
	if len(queryer.args) != 3 || queryer.args[0] != requestContext.ExecutionScope.TenantID {
		t.Fatalf("unexpected query arguments: %#v", queryer.args)
	}
}

func TestReaderRejectsContextVersionMismatch(t *testing.T) {
	reader := NewReader(&fakeQueryer{document: runtimeSnapshotFixture(t)})
	requestContext := runtimeContextFixture()
	requestContext.Snapshot.PolicyVersion++
	if _, err := reader.Resolve(context.Background(), requestContext); !errors.Is(err, ErrSnapshotUnavailable) {
		t.Fatalf("want unavailable snapshot, got %v", err)
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
			Digest:                "sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M",
			PolicyVersion:         8,
			EmployeeNoticeVersion: 3,
			PricingVersion:        5,
		},
	}
}
