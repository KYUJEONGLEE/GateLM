package postgres

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestResolverPostgresDailyTokenIntegration(t *testing.T) {
	databaseURL := os.Getenv("GATELM_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("GATELM_TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer tx.Rollback(ctx)

	var assignmentID string
	var tenantID string
	var projectID string
	var employeeID string
	err = tx.QueryRow(ctx, `
select pea.id::text, pea."tenantId"::text, pea."projectId"::text, pea."employeeId"::text
from project_employee_assignments pea
join employees e on e.id = pea."employeeId" and e."tenantId" = pea."tenantId"
where pea.status = 'active' and e."deletedAt" is null
limit 1
`).Scan(&assignmentID, &tenantID, &projectID, &employeeID)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no active project employee assignment")
	}
	if err != nil {
		t.Fatalf("select assignment: %v", err)
	}
	_, err = tx.Exec(ctx, `
update project_employee_assignments
set policy = jsonb_set(
  coalesce(policy, '{}'::jsonb),
  '{dailyTokenLimit}',
  '{"enabled":true,"limit":1234}'::jsonb,
  true
)
where id = $1::uuid
`, assignmentID)
	if err != nil {
		t.Fatalf("set temporary daily token policy: %v", err)
	}

	resolved, err := NewResolver(tx).Resolve(ctx, employeepolicy.ResolveRequest{
		TenantID: tenantID, ProjectID: projectID, ActorID: employeeID, Now: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("resolve daily token policy: %v", err)
	}
	if !resolved.DailyToken.Enabled || resolved.DailyToken.Limit != 1234 || resolved.DailyToken.Used < 0 {
		t.Fatalf("unexpected resolved daily token policy: %#v", resolved.DailyToken)
	}
}
