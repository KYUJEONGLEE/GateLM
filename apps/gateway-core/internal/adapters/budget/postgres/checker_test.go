package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"

	"github.com/jackc/pgx/v5"
)

func TestCheckerAllowsDisabledPolicyWithoutDatabase(t *testing.T) {
	checker := NewChecker(nil)

	decision, err := checker.Check(context.Background(), budget.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Scope:         budget.DefaultScope(testApplicationID),
		Policy:        budget.Policy{Enabled: false},
		Now:           testNow,
	})

	if err != nil {
		t.Fatalf("expected disabled policy to skip database, got %v", err)
	}
	if !decision.Allowed || decision.Outcome != budget.OutcomeNotUsed || decision.Reason != "policy_disabled" {
		t.Fatalf("unexpected disabled decision: %#v", decision)
	}
}

func TestCheckerAllowsAsNotCheckedWhenQuotaIsMissing(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{err: pgx.ErrNoRows}}
	checker := NewChecker(db)

	decision, err := checker.Check(context.Background(), enabledBudgetRequest())

	if err != nil {
		t.Fatalf("expected missing quota to proceed as not_checked, got %v", err)
	}
	if !decision.Allowed || decision.Outcome != budget.OutcomeNotChecked || decision.Reason != "quota_not_configured" {
		t.Fatalf("unexpected missing quota decision: %#v", decision)
	}
	if db.calls != 1 || !strings.Contains(db.query, "from budget_quotas") || !strings.Contains(db.query, "from budget_ledger_entries") {
		t.Fatalf("expected quota and ledger query, got query=%s calls=%d", db.query, db.calls)
	}
}

func TestCheckerWarnsWhenUsageReachesThreshold(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{
		limitMicroUSD:           1000,
		warningThresholdPercent: 80,
		usedMicroUSD:            850,
	}}
	checker := NewChecker(db)

	decision, err := checker.Check(context.Background(), enabledBudgetRequest())

	if err != nil {
		t.Fatalf("expected warning decision, got %v", err)
	}
	if !decision.Allowed || decision.Outcome != budget.OutcomeWarned || decision.Reason != "warning_threshold_reached" {
		t.Fatalf("unexpected warning decision: %#v", decision)
	}
}

func TestCheckerBlocksWhenQuotaExceededInBlockMode(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{
		limitMicroUSD:           1000,
		warningThresholdPercent: 80,
		usedMicroUSD:            1000,
	}}
	checker := NewChecker(db)

	decision, err := checker.Check(context.Background(), enabledBudgetRequest())

	if err != nil {
		t.Fatalf("expected blocked decision without checker error, got %v", err)
	}
	if decision.Allowed || decision.Outcome != budget.OutcomeBlocked || decision.Reason != "quota_exceeded" {
		t.Fatalf("unexpected blocked decision: %#v", decision)
	}
}

func TestCheckerDoesNotBlockQuotaExceededInWarnMode(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{
		limitMicroUSD:           1000,
		warningThresholdPercent: 80,
		usedMicroUSD:            1500,
	}}
	req := enabledBudgetRequest()
	req.Policy.EnforcementMode = budget.EnforcementModeWarn

	decision, err := NewChecker(db).Check(context.Background(), req)

	if err != nil {
		t.Fatalf("expected warn-only decision without checker error, got %v", err)
	}
	if !decision.Allowed || decision.Outcome != budget.OutcomeWarned || decision.Reason != "quota_exceeded_warn_only" {
		t.Fatalf("unexpected warn-only decision: %#v", decision)
	}
}

func TestCheckerFailsClosedOnDatabaseError(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{err: errors.New("database unavailable")}}

	decision, err := NewChecker(db).Check(context.Background(), enabledBudgetRequest())

	if err == nil {
		t.Fatal("expected database error")
	}
	if !decision.Allowed || decision.Outcome != budget.OutcomeNotChecked || decision.Reason != "checker_error" {
		t.Fatalf("unexpected error decision: %#v", decision)
	}
}

func enabledBudgetRequest() budget.Request {
	return budget.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Scope: budget.Scope{
			Type:       budget.ScopeTypeApplication,
			ID:         testApplicationID,
			ResolvedBy: budget.ResolvedByRuntimeSnapshot,
		},
		Policy: budget.Policy{
			Enabled:                 true,
			EnforcementMode:         budget.EnforcementModeBlock,
			WarningThresholdPercent: 80,
		},
		Now: testNow,
	}
}

type fakeBudgetQueryer struct {
	calls int
	query string
	args  []any
	row   fakeBudgetRow
}

func (q *fakeBudgetQueryer) QueryRow(_ context.Context, query string, arguments ...any) pgx.Row {
	q.calls++
	q.query = query
	q.args = append([]any(nil), arguments...)
	return q.row
}

type fakeBudgetRow struct {
	limitMicroUSD           int64
	warningThresholdPercent int
	usedMicroUSD            int64
	err                     error
}

func (r fakeBudgetRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 3 {
		return fmt.Errorf("expected 3 scan destinations, got %d", len(dest))
	}
	*(dest[0].(*int64)) = r.limitMicroUSD
	*(dest[1].(*int)) = r.warningThresholdPercent
	*(dest[2].(*int64)) = r.usedMicroUSD
	return nil
}

const (
	testTenantID      = "00000000-0000-4000-8000-000000000100"
	testProjectID     = "00000000-0000-4000-8000-000000000200"
	testApplicationID = "00000000-0000-4000-8000-000000000300"
)

var testNow = time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
