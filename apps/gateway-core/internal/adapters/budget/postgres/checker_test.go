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
	if strings.Contains(db.query, "id::text") || !strings.Contains(db.query, "a.id = $6::uuid") || !strings.Contains(db.query, "p.id = $6::uuid") {
		t.Fatalf("expected derived budget lookup to keep UUID indexes usable, got query=%s", db.query)
	}
	if len(db.args) != 6 || db.args[5] != testApplicationID {
		t.Fatalf("expected derived scope UUID arg to be passed separately, got args=%#v", db.args)
	}
}

func TestCheckerDoesNotCastNonUUIDScopeIDForDerivedLookup(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{err: pgx.ErrNoRows}}
	req := enabledBudgetRequest()
	req.Scope = budget.Scope{
		Type:       budget.ScopeTypeTeam,
		ID:         "team_demo",
		ResolvedBy: budget.ResolvedByControlPlaneRule,
	}

	decision, err := NewChecker(db).Check(context.Background(), req)

	if err != nil {
		t.Fatalf("expected non-UUID team scope to stay text-only for quota lookup, got %v", err)
	}
	if decision.Outcome != budget.OutcomeNotChecked || decision.Reason != "quota_not_configured" {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if len(db.args) != 6 || db.args[2] != "team_demo" || db.args[5] != nil {
		t.Fatalf("expected non-UUID scope id to remain text with nil derived UUID arg, got %#v", db.args)
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
	if !decision.UsageKnown || decision.LimitMicroUSD != 1000 || decision.UsedMicroUSD != 850 || decision.RemainingMicroUSD != 150 {
		t.Fatalf("expected usage snapshot to be carried, got %#v", decision)
	}
}

func TestCheckerDegradesHighQualityWhenQuotaExceededInBlockMode(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{
		limitMicroUSD:           1000,
		warningThresholdPercent: 80,
		usedMicroUSD:            1000,
	}}
	checker := NewChecker(db)

	decision, err := checker.Check(context.Background(), enabledBudgetRequest())

	if err != nil {
		t.Fatalf("expected degraded decision without checker error, got %v", err)
	}
	if !decision.Allowed || decision.Outcome != budget.OutcomeDegraded || decision.Reason != "quota_exceeded_quality_guard" {
		t.Fatalf("unexpected degraded decision: %#v", decision)
	}
}

func TestCheckerDegradesHighQualityWhenQuotaExceededInWarnMode(t *testing.T) {
	db := &fakeBudgetQueryer{row: fakeBudgetRow{
		limitMicroUSD:           1000,
		warningThresholdPercent: 80,
		usedMicroUSD:            1500,
	}}
	req := enabledBudgetRequest()
	req.Policy.EnforcementMode = budget.EnforcementModeWarn

	decision, err := NewChecker(db).Check(context.Background(), req)

	if err != nil {
		t.Fatalf("expected degraded decision without checker error, got %v", err)
	}
	if !decision.Allowed || decision.Outcome != budget.OutcomeDegraded || decision.Reason != "quota_exceeded_quality_guard" {
		t.Fatalf("unexpected degraded decision: %#v", decision)
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
