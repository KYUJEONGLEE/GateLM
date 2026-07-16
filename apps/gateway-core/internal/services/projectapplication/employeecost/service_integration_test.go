package employeecostservice

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/costing"
	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/ports"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestProjectApplicationReserveAndSettleIntegration(t *testing.T) {
	pool, tenantID, employeeID := setupProjectEmployeeCostIntegration(t)
	now := time.Now().UTC()
	service := NewService(pool, fixedPricingCatalog{})
	service.now = func() time.Time { return now }

	reservation, err := service.Reserve(context.Background(), ports.EmployeeCostReserveRequest{
		TenantID: tenantID, EmployeeID: employeeID, RequestID: "project-cost-integration-request",
		CandidateTier: employeecost.ProjectCostTierBalanced,
		ProviderID:    "provider-integration", ModelKey: "model-integration",
		ProviderPricingKeys: []string{"provider-integration"}, ModelPricingKeys: []string{"model-integration"},
		EstimatedInputTokens: 4, MaxOutputTokens: 10,
		DispatchIntentExpiresAt: now.Add(time.Minute),
	})
	if err != nil || !reservation.Active || !reservation.Observed {
		t.Fatalf("reserve project employee cost: reservation=%+v err=%v", reservation, err)
	}
	if err := service.MarkDispatched(context.Background(), &reservation); err != nil {
		t.Fatalf("mark dispatched: %v", err)
	}
	if err := service.RecordConfirmed(context.Background(), &reservation, ports.EmployeeCostUsage{
		InputTokens: 2, OutputTokens: 3,
	}, employeecost.AttemptOutcomeSucceeded); err != nil {
		t.Fatalf("record confirmed: %v", err)
	}
	cost, err := service.Settle(context.Background(), &reservation)
	if err != nil || cost != 8 {
		t.Fatalf("settle: cost=%d err=%v", cost, err)
	}

	var surface, state string
	var confirmed int64
	if err := pool.QueryRow(context.Background(), `
		SELECT surface, state, confirmed_cost_micro_usd
		FROM tenant_employee_cost_reservations
		WHERE request_id = 'project-cost-integration-request'
	`).Scan(&surface, &state, &confirmed); err != nil {
		t.Fatalf("read reservation: %v", err)
	}
	if surface != string(employeecost.SurfaceProjectApplication) || state != string(employeecost.ReservationStateSettled) || confirmed != 8 {
		t.Fatalf("stored reservation surface=%s state=%s confirmed=%d", surface, state, confirmed)
	}
}

func TestInvalidateCoverageIncrementsVersionAndAuditsOnceIntegration(t *testing.T) {
	pool, tenantID, _ := setupProjectEmployeeCostIntegration(t)
	service := NewService(pool, fixedPricingCatalog{})
	now := time.Date(2026, time.July, 16, 1, 2, 3, 456000000, time.UTC)

	const workers = 4
	var calls sync.WaitGroup
	calls.Add(workers)
	for range workers {
		go func() {
			defer calls.Done()
			service.invalidateCoverage(context.Background(), tenantID, "PROJECT_APPLICATION_ACCOUNTING_ERROR", now)
		}()
	}
	calls.Wait()

	var invalidatedAt time.Time
	var errorCode, actorKind, actorID string
	var version int64
	if err := pool.QueryRow(context.Background(), `
		SELECT coverage_invalidated_at, coverage_error_code, version,
		       updated_by_kind, updated_by
		FROM tenant_employee_cost_ledger_rollouts
		WHERE tenant_id = $1::uuid
	`, tenantID).Scan(&invalidatedAt, &errorCode, &version, &actorKind, &actorID); err != nil {
		t.Fatalf("read invalidated rollout: %v", err)
	}
	if !invalidatedAt.Equal(now) || errorCode != "PROJECT_APPLICATION_ACCOUNTING_ERROR" || version != 2 || actorKind != "system" || actorID != "gateway" {
		t.Fatalf("invalid rollout evidence: at=%s code=%s version=%d actor=%s/%s", invalidatedAt, errorCode, version, actorKind, actorID)
	}

	var action, auditActorKind, auditActorID string
	var auditVersion int64
	var previousJSON, nextJSON []byte
	if err := pool.QueryRow(context.Background(), `
		SELECT action, actor_kind, actor_id, rollout_version,
		       previous_rollout, next_rollout
		FROM tenant_employee_cost_ledger_rollout_audits
		WHERE tenant_id = $1::uuid
	`, tenantID).Scan(&action, &auditActorKind, &auditActorID, &auditVersion, &previousJSON, &nextJSON); err != nil {
		t.Fatalf("read coverage invalidation audit: %v", err)
	}
	var previous, next rolloutAuditSnapshot
	if err := json.Unmarshal(previousJSON, &previous); err != nil {
		t.Fatalf("decode previous rollout: %v", err)
	}
	if err := json.Unmarshal(nextJSON, &next); err != nil {
		t.Fatalf("decode next rollout: %v", err)
	}
	if action != "coverage_invalidated" || auditActorKind != "system" || auditActorID != "gateway" || auditVersion != 2 {
		t.Fatalf("invalid audit identity: action=%s actor=%s/%s version=%d", action, auditActorKind, auditActorID, auditVersion)
	}
	if previous.Version != 1 || previous.CoverageInvalidatedAt != nil || previous.CoverageErrorCode != nil {
		t.Fatalf("invalid previous rollout snapshot: %+v", previous)
	}
	if next.Version != 2 || next.CoverageInvalidatedAt == nil || !next.CoverageInvalidatedAt.Equal(now) || next.CoverageErrorCode == nil || *next.CoverageErrorCode != errorCode {
		t.Fatalf("invalid next rollout snapshot: %+v", next)
	}

	var auditCount int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*)
		FROM tenant_employee_cost_ledger_rollout_audits
		WHERE tenant_id = $1::uuid
	`, tenantID).Scan(&auditCount); err != nil {
		t.Fatalf("count coverage invalidation audits: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("coverage invalidation audit count=%d, want 1", auditCount)
	}
}

type fixedPricingCatalog struct{}

func (fixedPricingCatalog) LookupPricingRule(context.Context, costing.PricingLookup) (costing.PricingRule, error) {
	return costing.PricingRule{
		ID: "project-integration-price", Provider: "provider-integration", Model: "model-integration",
		Currency: costing.CurrencyUSD, InputMicroUSDPer1MTokens: 1_000_000,
		OutputMicroUSDPer1MTokens: 2_000_000, PricingVersion: "integration-v1",
	}, nil
}

func setupProjectEmployeeCostIntegration(t *testing.T) (*pgxpool.Pool, string, string) {
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
	tenantID, userID, employeeID := projectCostUUID(t), projectCostUUID(t), projectCostUUID(t)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM tenant_employee_cost_ledger_entries WHERE tenant_id = $1::uuid`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM tenant_employee_cost_provider_attempts WHERE tenant_id = $1::uuid`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM tenant_employee_cost_reservations WHERE tenant_id = $1::uuid`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM tenant_employee_cost_periods WHERE tenant_id = $1::uuid`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM tenant_employee_cost_ledger_rollout_audits WHERE tenant_id = $1::uuid`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM tenant_employee_cost_ledger_rollouts WHERE tenant_id = $1::uuid`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM employees WHERE id = $1::uuid`, employeeID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM tenants WHERE id = $1::uuid`, tenantID)
		pool.Close()
	})
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO tenants (id, name, status, "createdAt", "updatedAt") VALUES ($1::uuid, 'project cost integration', 'ACTIVE', now(), now())`, []any{tenantID}},
		{`INSERT INTO users (id, email, status, "createdAt", "updatedAt") VALUES ($1::uuid, $1 || '@integration.local', 'active', now(), now())`, []any{userID}},
		{`INSERT INTO employees (id, "tenantId", "userId", email, status, "invitationStatus", "createdAt", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $3 || '@integration.local', 'active', 'accepted', now(), now())`, []any{employeeID, tenantID, userID}},
		{`INSERT INTO tenant_employee_cost_ledger_rollouts (tenant_id, mode, updated_by_kind, updated_by, version, created_at, updated_at) VALUES ($1::uuid, 'shadow', 'system', 'project_cost_integration', 1, now(), now())`, []any{tenantID}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("create integration fixture: %v", err)
		}
	}
	return pool, tenantID, employeeID
}

func projectCostUUID(t *testing.T) string {
	t.Helper()
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		t.Fatalf("generate uuid: %v", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s", hex.EncodeToString(value[0:4]), hex.EncodeToString(value[4:6]), hex.EncodeToString(value[6:8]), hex.EncodeToString(value[8:10]), hex.EncodeToString(value[10:16]))
}
