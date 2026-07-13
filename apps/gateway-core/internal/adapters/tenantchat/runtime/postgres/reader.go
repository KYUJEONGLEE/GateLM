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
	var tenantStatus string
	err := r.db.QueryRow(ctx, `
		SELECT tenant.status::text, snapshot.snapshot_body
		FROM tenants AS tenant
		LEFT JOIN tenant_chat_active_runtime_snapshots AS active
		  ON active.tenant_id = tenant.id
		LEFT JOIN tenant_chat_runtime_snapshots AS snapshot
		  ON snapshot.snapshot_id = active.snapshot_id
		 AND snapshot.tenant_id = active.tenant_id
		 AND snapshot.version = $2
		 AND snapshot.digest = $3
		WHERE tenant.id = $1::uuid
		LIMIT 1
	`,
		requestContext.ExecutionScope.TenantID,
		requestContext.Snapshot.Version,
		requestContext.Snapshot.Digest,
	).Scan(&tenantStatus, &document)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantruntime.Snapshot{}, tenantchat.ErrTenantDisabled
		}
		return tenantruntime.Snapshot{}, ErrSnapshotUnavailable
	}
	if tenantStatus != "ACTIVE" {
		return tenantruntime.Snapshot{}, tenantchat.ErrTenantDisabled
	}
	if len(document) == 0 {
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
