package postgres

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type Queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Checker struct {
	db Queryer
}

func NewChecker(db Queryer) *Checker {
	return &Checker{db: db}
}

func (c *Checker) Check(ctx context.Context, claims workloadauth.Claims) error {
	if c == nil || c.db == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	var tenantStatus string
	if err := c.db.QueryRow(ctx, `
		SELECT status::text FROM tenants WHERE id = $1::uuid
	`, claims.TenantID).Scan(&tenantStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.ErrTenantDisabled
		}
		return tenantchat.ErrUsageGuardUnavailable
	}
	if tenantStatus != "ACTIVE" {
		return tenantchat.ErrTenantDisabled
	}

	var userStatus string
	var userDeleted bool
	if err := c.db.QueryRow(ctx, `
		SELECT status, deleted_at IS NOT NULL FROM users WHERE id = $1::uuid
	`, claims.UserID).Scan(&userStatus, &userDeleted); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.ErrUserDisabled
		}
		return tenantchat.ErrUsageGuardUnavailable
	}
	if userStatus != "active" || userDeleted {
		return tenantchat.ErrUserDisabled
	}

	var membershipActive bool
	if err := c.db.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM tenant_memberships AS membership
		  WHERE membership.tenant_id = $1::uuid
		    AND membership.user_id = $2::uuid
		    AND membership.status = 'active'
		    AND membership.deleted_at IS NULL
		    AND ($3 <> 'tenant_admin' OR membership.role = 'tenant_admin')
		)
	`, claims.TenantID, claims.UserID, claims.ActorKind).Scan(&membershipActive); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if !membershipActive {
		return tenantchat.ErrMembershipDisabled
	}

	if claims.ActorKind == "employee" {
		var employeeActive bool
		if err := c.db.QueryRow(ctx, `
			SELECT EXISTS (
			  SELECT 1 FROM employees AS employee
			  WHERE employee.id = $1::uuid
			    AND employee.tenant_id = $2::uuid
			    AND employee.user_id = $3::uuid
			    AND employee.status = 'active'
			    AND employee.deleted_at IS NULL
			)
		`, claims.EmployeeID, claims.TenantID, claims.UserID).Scan(&employeeActive); err != nil {
			return tenantchat.ErrUsageGuardUnavailable
		}
		if !employeeActive {
			return tenantchat.ErrEmployeeDisabled
		}
	}
	return nil
}
