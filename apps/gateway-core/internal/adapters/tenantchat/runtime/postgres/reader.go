package postgres

import (
	"context"
	"errors"
	"fmt"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
)

var ErrSnapshotUnavailable = errors.New("tenant chat runtime snapshot is unavailable")

type Queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Reader struct {
	db Queryer
}

func NewReader(db Queryer) *Reader {
	return &Reader{db: db}
}

func (r *Reader) Resolve(ctx context.Context, requestContext tenantchat.RequestContext) (tenantruntime.Snapshot, error) {
	if r == nil || r.db == nil {
		return tenantruntime.Snapshot{}, ErrSnapshotUnavailable
	}
	var document []byte
	err := r.db.QueryRow(ctx, `
		SELECT snapshot.snapshot_body
		FROM tenant_chat_active_runtime_snapshots AS active
		JOIN tenant_chat_runtime_snapshots AS snapshot
		  ON snapshot.snapshot_id = active.snapshot_id
		 AND snapshot.tenant_id = active.tenant_id
		WHERE active.tenant_id = $1::uuid
		  AND snapshot.version = $2
		  AND snapshot.digest = $3
		LIMIT 1
	`,
		requestContext.ExecutionScope.TenantID,
		requestContext.Snapshot.Version,
		requestContext.Snapshot.Digest,
	).Scan(&document)
	if err != nil {
		return tenantruntime.Snapshot{}, ErrSnapshotUnavailable
	}
	snapshot, err := tenantruntime.ParseSnapshot(document)
	if err != nil {
		return tenantruntime.Snapshot{}, fmt.Errorf("%w: %v", ErrSnapshotUnavailable, err)
	}
	if snapshot.TenantID != requestContext.ExecutionScope.TenantID ||
		snapshot.Version != requestContext.Snapshot.Version ||
		snapshot.Digest != requestContext.Snapshot.Digest ||
		snapshot.PolicyVersion != requestContext.Snapshot.PolicyVersion ||
		snapshot.EmployeeNoticeVersion != requestContext.Snapshot.EmployeeNoticeVersion ||
		snapshot.Pricing.Version != requestContext.Snapshot.PricingVersion {
		return tenantruntime.Snapshot{}, ErrSnapshotUnavailable
	}
	return snapshot, nil
}
