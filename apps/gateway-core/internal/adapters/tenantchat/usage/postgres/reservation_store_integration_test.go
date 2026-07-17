package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	employeepostgres "gatelm/apps/gateway-core/internal/adapters/employeecost/postgres"
	admissionpostgres "gatelm/apps/gateway-core/internal/adapters/tenantchat/admission/postgres"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConsumeAndReserveWritesAtomicUsageLedgerIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	fixture.configureEmployeeLedgerRollout(t, pool, "off")
	now := time.Now().UTC()
	admissionStore := admissionpostgres.NewStore(pool)
	admissionContext := fixture.admissionContext()
	admission, err := admissionStore.Create(context.Background(), admissionContext, tenantchat.AdmissionLimits{
		RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("create admission fixture: %v", err)
	}

	completionContext := fixture.completionContext(admission.AdmissionID)
	store := NewReservationStore(pool)
	store.now = func() time.Time { return now }
	reservation, err := store.BeginExecution(context.Background(), completionContext, fixture.snapshot(10_000, 1_000_000))
	if err != nil {
		t.Fatalf("consume and reserve usage: %v", err)
	}
	if reservation.ReservedTokens != 200 || reservation.ReservedCostMicroUSD != 125 || reservation.LedgerVersion != 1 {
		t.Fatalf("unexpected reservation: %+v", reservation)
	}

	var admissionState string
	var tokenReserved int64
	var costReserved int64
	var ledgerCount int
	var attemptCount int
	var payload []byte
	if err := pool.QueryRow(context.Background(), `
		SELECT admission.state, token_period.reserved_tokens, cost_period.reserved_cost_micro_usd,
		       (SELECT count(*) FROM tenant_chat_usage_ledger_entries WHERE request_id = $2),
		       (SELECT count(*) FROM tenant_chat_provider_attempts WHERE request_id = $2),
		       outbox.payload
		FROM tenant_chat_request_admissions AS admission
		JOIN tenant_chat_user_token_periods AS token_period
		  ON token_period.tenant_id = admission.tenant_id AND token_period.user_id = admission.user_id
		JOIN tenant_chat_tenant_cost_periods AS cost_period
		  ON cost_period.tenant_id = admission.tenant_id AND cost_period.currency = 'USD'
		JOIN tenant_chat_invocation_outbox AS outbox ON outbox.aggregate_id = $2
		WHERE admission.admission_id = $1::uuid
	`, admission.AdmissionID, completionContext.RequestID).Scan(
		&admissionState, &tokenReserved, &costReserved, &ledgerCount, &attemptCount, &payload,
	); err != nil {
		t.Fatalf("read atomic reservation records: %v", err)
	}
	if admissionState != "consumed" || tokenReserved != 200 || costReserved != 125 || ledgerCount != 1 || attemptCount != 1 {
		t.Fatalf("atomic records mismatch: state=%s tokens=%d cost=%d ledger=%d attempts=%d", admissionState, tokenReserved, costReserved, ledgerCount, attemptCount)
	}
	var event map[string]any
	if err := json.Unmarshal(payload, &event); err != nil || event["eventType"] != "usage_reserved" || event["requestId"] != completionContext.RequestID {
		t.Fatalf("invalid outbox event: event=%v err=%v", event, err)
	}

	replayed, err := store.BeginExecution(context.Background(), completionContext, fixture.snapshot(10_000, 1_000_000))
	if err != nil || !replayed.Replayed || replayed.ReservationID != reservation.ReservationID {
		t.Fatalf("replay reservation: result=%+v err=%v", replayed, err)
	}

	ttftMs := int64(84)
	completionContext.TTFTMs = &ttftMs
	settlement, err := store.FinalizeConfirmed(
		context.Background(), completionContext, reservation.ReservationID, 1,
		tenantchat.ConfirmedUsage{InputTokens: 150, OutputTokens: 50}, "succeeded",
	)
	if err != nil {
		t.Fatalf("settle confirmed usage: %v", err)
	}
	if settlement.ConfirmedInputTokens != 150 || settlement.ConfirmedOutputTokens != 50 ||
		settlement.ConfirmedCostMicroUSD != 88 || settlement.LedgerVersion != 2 {
		t.Fatalf("unexpected confirmed settlement: %+v", settlement)
	}
	var remainingReservedTokens int64
	var confirmedTokens int64
	var remainingReservedCost int64
	var confirmedCost int64
	var reservationState string
	var settlementLedgerCount int
	if err := pool.QueryRow(context.Background(), `
		SELECT token_period.reserved_tokens, token_period.confirmed_total_tokens,
		       cost_period.reserved_cost_micro_usd, cost_period.confirmed_cost_micro_usd,
		       reservation.state,
		       (SELECT count(*) FROM tenant_chat_usage_ledger_entries WHERE request_id = $2)
		FROM tenant_chat_usage_reservations AS reservation
		JOIN tenant_chat_user_token_periods AS token_period
		  ON token_period.tenant_id = reservation.tenant_id
		 AND token_period.user_id = reservation.user_id
		 AND token_period.period_start = reservation.user_period_start
		JOIN tenant_chat_tenant_cost_periods AS cost_period
		  ON cost_period.tenant_id = reservation.tenant_id
		 AND cost_period.period_start = reservation.tenant_period_start
		 AND cost_period.currency = reservation.currency
		WHERE reservation.reservation_id = $1::uuid
	`, reservation.ReservationID, completionContext.RequestID).Scan(
		&remainingReservedTokens, &confirmedTokens, &remainingReservedCost,
		&confirmedCost, &reservationState, &settlementLedgerCount,
	); err != nil {
		t.Fatalf("read settlement records: %v", err)
	}
	if remainingReservedTokens != 0 || confirmedTokens != 200 || remainingReservedCost != 0 ||
		confirmedCost != 88 || reservationState != "settled" || settlementLedgerCount != 2 {
		t.Fatalf(
			"settlement records mismatch: reservedTokens=%d confirmedTokens=%d reservedCost=%d confirmedCost=%d state=%s ledger=%d",
			remainingReservedTokens, confirmedTokens, remainingReservedCost, confirmedCost, reservationState, settlementLedgerCount,
		)
	}
	var settlementPayload []byte
	if err := pool.QueryRow(context.Background(), `
		SELECT payload
		FROM tenant_chat_invocation_outbox
		WHERE aggregate_id = $1 AND event_type = 'usage_settled'
		ORDER BY event_version DESC
		LIMIT 1
	`, completionContext.RequestID).Scan(&settlementPayload); err != nil {
		t.Fatalf("read settlement outbox event: %v", err)
	}
	var settlementEvent map[string]any
	if err := json.Unmarshal(settlementPayload, &settlementEvent); err != nil {
		t.Fatalf("decode settlement outbox event: %v", err)
	}
	if settlementEvent["eventType"] != "usage_settled" || settlementEvent["ttftMs"] != float64(ttftMs) {
		t.Fatalf("settlement outbox must preserve TTFT: event=%v", settlementEvent)
	}
	assertNoEmployeeLedgerRows(t, pool, fixture, completionContext.RequestID)
}

func TestConsumeAndReserveAppliesNewMonthlyZeroQuotaToExistingPeriodIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	fixture.configureEmployeeLedgerRollout(t, pool, "off")
	now := time.Now().UTC().Truncate(time.Microsecond)
	admissionStore := admissionpostgres.NewStore(pool)
	firstAdmission, err := admissionStore.Create(context.Background(), fixture.admissionContext(), tenantchat.AdmissionLimits{
		RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("create first admission: %v", err)
	}
	store := NewReservationStore(pool)
	store.now = func() time.Time { return now }
	if _, err := store.BeginExecution(
		context.Background(), fixture.completionContext(firstAdmission.AdmissionID), fixture.snapshot(10_000, 1_000_000),
	); err != nil {
		t.Fatalf("create initial monthly token period: %v", err)
	}

	secondAdmissionContext := fixture.admissionContext()
	secondAdmissionContext.RequestID = "monthly_zero_request_002"
	secondAdmissionContext.TurnID = "monthly_zero_turn_002"
	secondAdmissionContext.IdempotencyKey = "monthly_zero_attempt_002"
	secondAdmission, err := admissionStore.Create(context.Background(), secondAdmissionContext, tenantchat.AdmissionLimits{
		RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("create second admission: %v", err)
	}
	secondCompletionContext := fixture.completionContext(secondAdmission.AdmissionID)
	secondCompletionContext.RequestID = secondAdmissionContext.RequestID
	secondCompletionContext.TurnID = secondAdmissionContext.TurnID
	secondCompletionContext.IdempotencyKey = secondAdmissionContext.IdempotencyKey
	if _, err := store.BeginExecution(
		context.Background(), secondCompletionContext, fixture.snapshot(0, 1_000_000),
	); !errors.Is(err, tenantchat.ErrQuotaHardLimit) {
		t.Fatalf("zero monthly quota must block the next provider request, got %v", err)
	}

	var limit, warning, economy, hardStop int64
	var state string
	if err := pool.QueryRow(context.Background(), `
		SELECT limit_tokens, warning_threshold_tokens, economy_threshold_tokens, hard_stop_tokens, state
		FROM tenant_chat_user_token_periods
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid
	`, fixture.tenantID, fixture.userID).Scan(&limit, &warning, &economy, &hardStop, &state); err != nil {
		t.Fatalf("read synchronized monthly period: %v", err)
	}
	if limit != 0 || warning != 0 || economy != 0 || hardStop != 0 || state != "blocked" {
		t.Fatalf("existing monthly period was not synchronized to the zero policy: limit=%d warning=%d economy=%d hardStop=%d state=%s", limit, warning, economy, hardStop, state)
	}
}

func TestEmployeeWeeklyZeroQuotaBlocksAndPersistsPolicyIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	admission, err := admissionpostgres.NewStore(pool).Create(
		context.Background(), fixture.admissionContext(),
		tenantchat.AdmissionLimits{RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second},
	)
	if err != nil {
		t.Fatalf("create employee zero-quota admission: %v", err)
	}
	completionContext := fixture.completionContext(admission.AdmissionID)
	snapshot := fixture.snapshot(10_000, 1_000_000)
	snapshot.PolicyVersion = 2
	snapshot.Policies.Quota.EmployeeWeeklyTokenLimits = []tenantruntime.EmployeeWeeklyTokenLimit{{
		EmployeeID: fixture.employeeID, LimitTokens: 0,
	}}
	store := NewReservationStore(pool)
	store.now = func() time.Time { return now }

	if _, err := store.BeginExecution(
		context.Background(), completionContext, snapshot,
	); !errors.Is(err, tenantchat.ErrEmployeeWeeklyTokenQuotaHardLimit) {
		t.Fatalf("zero employee weekly quota must block the provider request, got %v", err)
	}

	var limit, reserved, confirmed, unconfirmed, policyVersion int64
	var state string
	if err := pool.QueryRow(context.Background(), `
		SELECT limit_tokens, reserved_tokens, confirmed_total_tokens,
		       unconfirmed_tokens, state, policy_version
		FROM tenant_chat_employee_weekly_token_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
	`, fixture.tenantID, fixture.employeeID).Scan(
		&limit, &reserved, &confirmed, &unconfirmed, &state, &policyVersion,
	); err != nil {
		t.Fatalf("read zero employee weekly token period: %v", err)
	}
	if limit != 0 || reserved != 0 || confirmed != 0 || unconfirmed != 0 || state != "blocked" || policyVersion != 2 {
		t.Fatalf(
			"zero employee weekly token period mismatch: limit=%d reserved=%d confirmed=%d unconfirmed=%d state=%s policy=%d",
			limit, reserved, confirmed, unconfirmed, state, policyVersion,
		)
	}
}

func TestEmployeeWeeklyQuotaLoweringPreservesUsageAndBlocksIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	admissionStore := admissionpostgres.NewStore(pool)
	firstAdmission, err := admissionStore.Create(
		context.Background(), fixture.admissionContext(),
		tenantchat.AdmissionLimits{RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second},
	)
	if err != nil {
		t.Fatalf("create initial employee weekly admission: %v", err)
	}
	store := NewReservationStore(pool)
	store.now = func() time.Time { return now }
	initialSnapshot := fixture.snapshot(10_000, 1_000_000)
	initialSnapshot.PolicyVersion = 1
	initialSnapshot.Policies.Quota.EmployeeWeeklyTokenLimits = []tenantruntime.EmployeeWeeklyTokenLimit{{
		EmployeeID: fixture.employeeID, LimitTokens: 1_000,
	}}
	if _, err := store.BeginExecution(
		context.Background(), fixture.completionContext(firstAdmission.AdmissionID), initialSnapshot,
	); err != nil {
		t.Fatalf("reserve initial employee weekly usage: %v", err)
	}

	secondAdmissionContext := fixture.admissionContext()
	secondAdmissionContext.RequestID = "employee_weekly_lower_request_002"
	secondAdmissionContext.TurnID = "employee_weekly_lower_turn_002"
	secondAdmissionContext.IdempotencyKey = "employee_weekly_lower_attempt_002"
	secondAdmission, err := admissionStore.Create(
		context.Background(), secondAdmissionContext,
		tenantchat.AdmissionLimits{RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second},
	)
	if err != nil {
		t.Fatalf("create lowered employee weekly admission: %v", err)
	}
	secondCompletionContext := fixture.completionContext(secondAdmission.AdmissionID)
	secondCompletionContext.RequestID = secondAdmissionContext.RequestID
	secondCompletionContext.TurnID = secondAdmissionContext.TurnID
	secondCompletionContext.IdempotencyKey = secondAdmissionContext.IdempotencyKey
	loweredSnapshot := fixture.snapshot(10_000, 1_000_000)
	loweredSnapshot.PolicyVersion = 2
	loweredSnapshot.Policies.Quota.EmployeeWeeklyTokenLimits = []tenantruntime.EmployeeWeeklyTokenLimit{{
		EmployeeID: fixture.employeeID, LimitTokens: 150,
	}}
	if _, err := store.BeginExecution(
		context.Background(), secondCompletionContext, loweredSnapshot,
	); !errors.Is(err, tenantchat.ErrEmployeeWeeklyTokenQuotaHardLimit) {
		t.Fatalf("lowered employee weekly quota must block without resetting usage, got %v", err)
	}

	var limit, reserved, confirmed, unconfirmed, policyVersion int64
	var state string
	if err := pool.QueryRow(context.Background(), `
		SELECT limit_tokens, reserved_tokens, confirmed_total_tokens,
		       unconfirmed_tokens, state, policy_version
		FROM tenant_chat_employee_weekly_token_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
	`, fixture.tenantID, fixture.employeeID).Scan(
		&limit, &reserved, &confirmed, &unconfirmed, &state, &policyVersion,
	); err != nil {
		t.Fatalf("read lowered employee weekly token period: %v", err)
	}
	if limit != 150 || reserved != 200 || confirmed != 0 || unconfirmed != 0 || state != "blocked" || policyVersion != 2 {
		t.Fatalf(
			"lowered employee weekly token period mismatch: limit=%d reserved=%d confirmed=%d unconfirmed=%d state=%s policy=%d",
			limit, reserved, confirmed, unconfirmed, state, policyVersion,
		)
	}
}

func TestEmployeeWeeklyFallbackSettlementIsAppliedExactlyOnceIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	admissionContext := fixture.admissionContext()
	admissionContext.RequestID = "employee_weekly_fallback_request_001"
	admissionContext.TurnID = "employee_weekly_fallback_turn_001"
	admissionContext.IdempotencyKey = "employee_weekly_fallback_attempt_001"
	admission, err := admissionpostgres.NewStore(pool).Create(
		context.Background(), admissionContext,
		tenantchat.AdmissionLimits{RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second},
	)
	if err != nil {
		t.Fatalf("create employee weekly fallback admission: %v", err)
	}
	completionContext := fixture.completionContext(admission.AdmissionID)
	completionContext.RequestID = admissionContext.RequestID
	completionContext.TurnID = admissionContext.TurnID
	completionContext.IdempotencyKey = admissionContext.IdempotencyKey
	snapshot := fixture.snapshot(10_000, 1_000_000)
	snapshot.PolicyVersion = 3
	snapshot.Policies.Quota.EmployeeWeeklyTokenLimits = []tenantruntime.EmployeeWeeklyTokenLimit{{
		EmployeeID: fixture.employeeID, LimitTokens: 1_000,
	}}
	store := NewReservationStore(pool)
	store.now = func() time.Time { return now }
	reservation, err := store.BeginExecution(context.Background(), completionContext, snapshot)
	if err != nil {
		t.Fatalf("reserve employee weekly primary exposure: %v", err)
	}
	fallbackRoute, err := selectRoute(snapshot, "economy", "normal", "normal")
	if err != nil {
		t.Fatalf("select employee weekly fallback route: %v", err)
	}
	restricted, err := store.BeginFallback(
		context.Background(), completionContext, snapshot, reservation.ReservationID,
		1, tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 10}, "failed_post_delta",
		fallbackRoute, 2,
	)
	if err != nil || restricted {
		t.Fatalf("begin employee weekly fallback: restricted=%t err=%v", restricted, err)
	}
	settlement, err := store.FinalizeConfirmed(
		context.Background(), completionContext, reservation.ReservationID, 2,
		tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 20}, "succeeded",
	)
	if err != nil {
		t.Fatalf("settle employee weekly fallback: %v", err)
	}
	if settlement.ConfirmedInputTokens != 200 || settlement.ConfirmedOutputTokens != 30 {
		t.Fatalf("employee weekly fallback settlement mismatch: %+v", settlement)
	}
	replayed, err := store.FinalizeConfirmed(
		context.Background(), completionContext, reservation.ReservationID, 2,
		tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 20}, "succeeded",
	)
	if err != nil || !replayed.Replayed {
		t.Fatalf("replay employee weekly fallback settlement: result=%+v err=%v", replayed, err)
	}

	var reserved, confirmed, unconfirmed, policyVersion int64
	var state string
	if err := pool.QueryRow(context.Background(), `
		SELECT reserved_tokens, confirmed_total_tokens, unconfirmed_tokens, state, policy_version
		FROM tenant_chat_employee_weekly_token_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
	`, fixture.tenantID, fixture.employeeID).Scan(
		&reserved, &confirmed, &unconfirmed, &state, &policyVersion,
	); err != nil {
		t.Fatalf("read settled employee weekly token period: %v", err)
	}
	if reserved != 0 || confirmed != 230 || unconfirmed != 0 || state != "normal" || policyVersion != 3 {
		t.Fatalf(
			"employee weekly settlement applied more than once: reserved=%d confirmed=%d unconfirmed=%d state=%s policy=%d",
			reserved, confirmed, unconfirmed, state, policyVersion,
		)
	}
}

func TestEmployeeWeeklyPendingAndLateUsageAreReconciledExactlyOnceIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	admissionContext := fixture.admissionContext()
	admissionContext.RequestID = "employee_weekly_late_request_001"
	admissionContext.TurnID = "employee_weekly_late_turn_001"
	admissionContext.IdempotencyKey = "employee_weekly_late_attempt_001"
	admission, err := admissionpostgres.NewStore(pool).Create(
		context.Background(), admissionContext,
		tenantchat.AdmissionLimits{RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second},
	)
	if err != nil {
		t.Fatalf("create employee weekly late-usage admission: %v", err)
	}
	completionContext := fixture.completionContext(admission.AdmissionID)
	completionContext.RequestID = admissionContext.RequestID
	completionContext.TurnID = admissionContext.TurnID
	completionContext.IdempotencyKey = admissionContext.IdempotencyKey
	snapshot := fixture.snapshot(10_000, 1_000_000)
	snapshot.PolicyVersion = 4
	snapshot.Policies.Quota.EmployeeWeeklyTokenLimits = []tenantruntime.EmployeeWeeklyTokenLimit{{
		EmployeeID: fixture.employeeID, LimitTokens: 1_000,
	}}
	store := NewReservationStore(pool)
	store.now = func() time.Time { return now }
	reservation, err := store.BeginExecution(context.Background(), completionContext, snapshot)
	if err != nil {
		t.Fatalf("reserve employee weekly pending exposure: %v", err)
	}
	if _, err := store.MarkPending(
		context.Background(), completionContext, reservation.ReservationID, 1, "timed_out",
	); err != nil {
		t.Fatalf("mark employee weekly usage pending: %v", err)
	}
	processed, err := store.ReconcileNextPending(context.Background(), now.Add(15*time.Minute))
	if err != nil || !processed {
		t.Fatalf("reconcile employee weekly pending usage: processed=%t err=%v", processed, err)
	}

	var reserved, confirmed, unconfirmed int64
	if err := pool.QueryRow(context.Background(), `
		SELECT reserved_tokens, confirmed_total_tokens, unconfirmed_tokens
		FROM tenant_chat_employee_weekly_token_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
	`, fixture.tenantID, fixture.employeeID).Scan(&reserved, &confirmed, &unconfirmed); err != nil {
		t.Fatalf("read reconciled employee weekly token period: %v", err)
	}
	if reserved != 0 || confirmed != 0 || unconfirmed != 200 {
		t.Fatalf(
			"employee weekly pending reconciliation mismatch: reserved=%d confirmed=%d unconfirmed=%d",
			reserved, confirmed, unconfirmed,
		)
	}

	store.now = func() time.Time { return now.AddDate(0, 0, 8) }
	receipt := tenantchat.UsageReceipt{
		RequestID: completionContext.RequestID, AttemptNo: 1, ProviderID: "provider",
		InputTokens: 80, OutputTokens: 20,
	}
	result, err := store.RecordUsageReceipt(context.Background(), receipt)
	if err != nil || result.State != "settled" || result.Replayed {
		t.Fatalf("record employee weekly late usage: result=%+v err=%v", result, err)
	}
	replayed, err := store.RecordUsageReceipt(context.Background(), receipt)
	if err != nil || !replayed.Replayed {
		t.Fatalf("replay employee weekly late usage: result=%+v err=%v", replayed, err)
	}
	if err := pool.QueryRow(context.Background(), `
		SELECT reserved_tokens, confirmed_total_tokens, unconfirmed_tokens
		FROM tenant_chat_employee_weekly_token_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
	`, fixture.tenantID, fixture.employeeID).Scan(&reserved, &confirmed, &unconfirmed); err != nil {
		t.Fatalf("read late-settled employee weekly token period: %v", err)
	}
	if reserved != 0 || confirmed != 100 || unconfirmed != 0 {
		t.Fatalf(
			"employee weekly late usage applied more than once: reserved=%d confirmed=%d unconfirmed=%d",
			reserved, confirmed, unconfirmed,
		)
	}
}

func TestRoutingV2WithoutTierAllowsRolloutOffIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	now := time.Now().UTC()
	admissionStore := admissionpostgres.NewStore(pool)
	admission, err := admissionStore.Create(context.Background(), fixture.admissionContext(), tenantchat.AdmissionLimits{
		RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("create admission fixture: %v", err)
	}

	completionContext := fixture.completionContext(admission.AdmissionID)
	completionContext.Routing = &tenantchat.RoutingDecision{ModelRef: "tc_standard"}
	snapshot := fixture.snapshot(10_000, 1_000_000)
	snapshot.Policies.Routing = tenantruntime.RoutingPolicy{
		Policy: &tenantruntime.RoutingPolicyV2Bridge{Mode: "auto"},
		Routes: []tenantruntime.RuntimeRoute{{
			RouteID: "standard_route", ModelRef: "tc_standard",
			ProviderID: "provider", ModelKey: "standard_model", Enabled: true,
		}},
	}

	store := NewReservationStore(pool)
	store.now = func() time.Time { return now }
	reservation, err := store.BeginExecution(context.Background(), completionContext, snapshot)
	if err != nil {
		t.Fatalf("reserve Routing v2 route without tier while employee ledger rollout is off: %v", err)
	}
	if reservation.Route.ModelKey != "standard_model" || reservation.Route.Tier != "" {
		t.Fatalf("unexpected Routing v2 reservation route: %+v", reservation.Route)
	}
	assertNoEmployeeLedgerRows(t, pool, fixture, completionContext.RequestID)
}

func TestFinalizeReleasedReturnsReservedExposureIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	admissionStore := admissionpostgres.NewStore(pool)
	admissionContext := fixture.admissionContext()
	admissionContext.RequestID = "released_request_001"
	admissionContext.TurnID = "released_turn_001"
	admissionContext.IdempotencyKey = "released_attempt_001"
	admission, err := admissionStore.Create(context.Background(), admissionContext, tenantchat.AdmissionLimits{
		RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("create released admission: %v", err)
	}
	completionContext := fixture.completionContext(admission.AdmissionID)
	completionContext.RequestID = admissionContext.RequestID
	completionContext.TurnID = admissionContext.TurnID
	completionContext.IdempotencyKey = admissionContext.IdempotencyKey
	store := NewReservationStore(pool)
	reservation, err := store.ConsumeAndReserve(context.Background(), completionContext, fixture.snapshot(10_000, 1_000_000))
	if err != nil {
		t.Fatalf("reserve released exposure: %v", err)
	}
	settlement, err := store.FinalizeReleased(
		context.Background(), completionContext, reservation.ReservationID, "failed",
	)
	if err != nil {
		t.Fatalf("release exposure: %v", err)
	}
	if settlement.State != "released" || settlement.LedgerVersion != 2 {
		t.Fatalf("unexpected released settlement: %+v", settlement)
	}
	replayedSettlement, err := store.FinalizeReleased(
		context.Background(), completionContext, reservation.ReservationID, "failed",
	)
	if err != nil || !replayedSettlement.Replayed {
		t.Fatalf("replay released settlement: result=%+v err=%v", replayedSettlement, err)
	}
	if _, err := store.FinalizeReleased(
		context.Background(), completionContext, reservation.ReservationID, "rate_limited",
	); !errors.Is(err, tenantchat.ErrIdempotencyConflict) {
		t.Fatalf("conflicting released replay must be rejected, got %v", err)
	}
	var reservationState string
	var reservedTokens int64
	var reservedCost int64
	var eventType string
	if err := pool.QueryRow(context.Background(), `
		SELECT reservation.state, token_period.reserved_tokens, cost_period.reserved_cost_micro_usd,
		       ledger.event_type
		FROM tenant_chat_usage_reservations AS reservation
		JOIN tenant_chat_user_token_periods AS token_period
		  ON token_period.tenant_id = reservation.tenant_id
		 AND token_period.user_id = reservation.user_id
		 AND token_period.period_start = reservation.user_period_start
		JOIN tenant_chat_tenant_cost_periods AS cost_period
		  ON cost_period.tenant_id = reservation.tenant_id
		 AND cost_period.period_start = reservation.tenant_period_start
		 AND cost_period.currency = reservation.currency
		JOIN tenant_chat_usage_ledger_entries AS ledger
		  ON ledger.request_id = reservation.request_id AND ledger.ledger_version = 2
		WHERE reservation.reservation_id = $1::uuid
	`, reservation.ReservationID).Scan(&reservationState, &reservedTokens, &reservedCost, &eventType); err != nil {
		t.Fatalf("read released records: %v", err)
	}
	if reservationState != "released" || reservedTokens != 0 || reservedCost != 0 || eventType != "usage_released" {
		t.Fatalf("released records mismatch: state=%s tokens=%d cost=%d event=%s", reservationState, reservedTokens, reservedCost, eventType)
	}
}

func TestFinalizeUnconfirmedMovesExposureToIncidentHoldIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	admissionStore := admissionpostgres.NewStore(pool)
	admissionContext := fixture.admissionContext()
	admissionContext.RequestID = "unconfirmed_request_001"
	admissionContext.TurnID = "unconfirmed_turn_001"
	admissionContext.IdempotencyKey = "unconfirmed_attempt_001"
	admission, err := admissionStore.Create(context.Background(), admissionContext, tenantchat.AdmissionLimits{
		RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("create unconfirmed admission: %v", err)
	}
	completionContext := fixture.completionContext(admission.AdmissionID)
	completionContext.RequestID = admissionContext.RequestID
	completionContext.TurnID = admissionContext.TurnID
	completionContext.IdempotencyKey = admissionContext.IdempotencyKey
	snapshot := fixture.snapshot(10_000, 1_000_000)
	store := NewReservationStore(pool)
	reservation, err := store.ConsumeAndReserve(context.Background(), completionContext, snapshot)
	if err != nil {
		t.Fatalf("reserve unconfirmed exposure: %v", err)
	}
	if err := store.StartAttempt(
		context.Background(), completionContext, snapshot,
		reservation.ReservationID, reservation.Route, 1, "primary",
	); err != nil {
		t.Fatalf("start unconfirmed attempt: %v", err)
	}
	settlement, err := store.FinalizeUnconfirmed(
		context.Background(), completionContext, reservation.ReservationID, 1, "timed_out",
	)
	if err != nil {
		t.Fatalf("mark exposure unconfirmed: %v", err)
	}
	if settlement.State != "unconfirmed" || settlement.UnconfirmedTokens != 200 ||
		settlement.UnconfirmedExposureMicroUSD != 125 || settlement.LedgerVersion != 2 {
		t.Fatalf("unexpected unconfirmed settlement: %+v", settlement)
	}
	replayedSettlement, err := store.FinalizeUnconfirmed(
		context.Background(), completionContext, reservation.ReservationID, 1, "timed_out",
	)
	if err != nil || !replayedSettlement.Replayed {
		t.Fatalf("replay unconfirmed settlement: result=%+v err=%v", replayedSettlement, err)
	}
	if _, err := store.FinalizeUnconfirmed(
		context.Background(), completionContext, reservation.ReservationID, 1, "failed_post_delta",
	); !errors.Is(err, tenantchat.ErrIdempotencyConflict) {
		t.Fatalf("conflicting unconfirmed replay must be rejected, got %v", err)
	}
	var reservationState string
	var reservedTokens int64
	var unconfirmedTokens int64
	var reservedCost int64
	var unconfirmedCost int64
	var usageQuality string
	var outcome string
	if err := pool.QueryRow(context.Background(), `
		SELECT reservation.state, token_period.reserved_tokens, token_period.unconfirmed_tokens,
		       cost_period.reserved_cost_micro_usd, cost_period.unconfirmed_exposure_micro_usd,
		       attempt.usage_quality, attempt.outcome
		FROM tenant_chat_usage_reservations AS reservation
		JOIN tenant_chat_user_token_periods AS token_period
		  ON token_period.tenant_id = reservation.tenant_id
		 AND token_period.user_id = reservation.user_id
		 AND token_period.period_start = reservation.user_period_start
		JOIN tenant_chat_tenant_cost_periods AS cost_period
		  ON cost_period.tenant_id = reservation.tenant_id
		 AND cost_period.period_start = reservation.tenant_period_start
		 AND cost_period.currency = reservation.currency
		JOIN tenant_chat_provider_attempts AS attempt
		  ON attempt.reservation_id = reservation.reservation_id
		 AND attempt.request_id = reservation.request_id
		 AND attempt.tenant_id = reservation.tenant_id
		WHERE reservation.reservation_id = $1::uuid AND attempt.attempt_no = 1
	`, reservation.ReservationID).Scan(
		&reservationState, &reservedTokens, &unconfirmedTokens, &reservedCost, &unconfirmedCost,
		&usageQuality, &outcome,
	); err != nil {
		t.Fatalf("read unconfirmed records: %v", err)
	}
	if reservationState != "unconfirmed" || reservedTokens != 0 || unconfirmedTokens != 200 ||
		reservedCost != 0 || unconfirmedCost != 125 || usageQuality != "pending_unconfirmed" || outcome != "timed_out" {
		t.Fatalf(
			"unconfirmed records mismatch: state=%s reservedTokens=%d unconfirmedTokens=%d reservedCost=%d unconfirmedCost=%d quality=%s outcome=%s",
			reservationState, reservedTokens, unconfirmedTokens, reservedCost, unconfirmedCost, usageQuality, outcome,
		)
	}
}

func replayCommonEmployeeReserve(
	t *testing.T,
	pool *pgxpool.Pool,
	fixture usageFixture,
	requestContext tenantchat.RequestContext,
	reservationID string,
	route tenantchat.SelectedRoute,
	now time.Time,
) employeepostgres.ReserveResult {
	t.Helper()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin common reserve replay: %v", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	pricing := employeeCostPricing(requestContext, route)
	streamDuration, durationErr := (tenantruntime.StreamingPolicy{MaxDurationSeconds: 120}).Duration()
	if durationErr != nil {
		t.Fatalf("resolve common reserve replay duration: %v", durationErr)
	}
	result, err := employeepostgres.NewStore().Reserve(
		context.Background(), tx, employeepostgres.ReserveInput{
			TenantID: requestContext.ExecutionScope.TenantID, EmployeeID: fixture.employeeID,
			Surface: employeecost.SurfaceTenantChat, RequestID: requestContext.RequestID,
			ReservationID: reservationID, CandidateTier: route.Tier, Pricing: pricing,
			PrimaryAttempt: &employeepostgres.AttemptInput{
				AttemptNo: 1, Kind: employeecost.AttemptKindPrimary,
				ProviderID: route.ProviderID, ModelKey: route.ModelKey, Pricing: pricing,
			},
			DispatchIntentExpiresAt: now.Add(streamDuration),
			Now:                     now,
		},
	)
	if err != nil {
		t.Fatalf("replay common employee reserve: %v", err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatalf("commit common reserve replay: %v", err)
	}
	return result
}

type employeePeriodExpectation struct {
	Confirmed     int64
	Reserved      int64
	Unconfirmed   int64
	State         string
	PolicyVersion int64
}

type employeeReservationExpectation struct {
	EmployeeID    string
	State         string
	PolicyVersion int64
	Reserved      int64
	Confirmed     int64
	Unconfirmed   int64
	LedgerVersion int64
	UsagePending  bool
}

type employeeAttemptExpectation struct {
	Kind          string
	ProviderID    string
	ModelKey      string
	PricingRuleID string
	Reserved      int64
	Confirmed     int64
	Unconfirmed   int64
	UsageQuality  string
	Outcome       string
	DispatchState string
	InputTokens   int64
	OutputTokens  int64
	UsagePending  bool
}

type employeeLedgerExpectation struct {
	Version          int64
	EventType        string
	ReservedDelta    int64
	ConfirmedDelta   int64
	UnconfirmedDelta int64
}

func assertNoEmployeeLedgerRows(
	t *testing.T,
	pool *pgxpool.Pool,
	fixture usageFixture,
	requestID string,
) {
	t.Helper()
	var periods int
	var reservations int
	var attempts int
	var ledger int
	if err := pool.QueryRow(context.Background(), `
		SELECT
		  (SELECT count(*) FROM tenant_employee_cost_periods WHERE tenant_id = $1::uuid AND employee_id = $2::uuid),
		  (SELECT count(*) FROM tenant_employee_cost_reservations WHERE surface = 'tenant_chat' AND request_id = $3),
		  (SELECT count(*) FROM tenant_employee_cost_provider_attempts WHERE surface = 'tenant_chat' AND request_id = $3),
		  (SELECT count(*) FROM tenant_employee_cost_ledger_entries WHERE surface = 'tenant_chat' AND request_id = $3)
	`, fixture.tenantID, fixture.employeeID, requestID).Scan(&periods, &reservations, &attempts, &ledger); err != nil {
		t.Fatalf("read rollout-off employee ledger rows: %v", err)
	}
	if periods != 0 || reservations != 0 || attempts != 0 || ledger != 0 {
		t.Fatalf(
			"rollout off wrote employee accounting: periods=%d reservations=%d attempts=%d ledger=%d",
			periods, reservations, attempts, ledger,
		)
	}
}

func assertEmployeePeriods(
	t *testing.T,
	pool *pgxpool.Pool,
	fixture usageFixture,
	expected employeePeriodExpectation,
) {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT period_kind, period_start, period_end, period_timezone, currency,
		       confirmed_cost_micro_usd, reserved_cost_micro_usd,
		       unconfirmed_cost_micro_usd, state, last_evaluated_policy_version
		FROM tenant_employee_cost_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
		ORDER BY period_kind
	`, fixture.tenantID, fixture.employeeID)
	if err != nil {
		t.Fatalf("read employee periods: %v", err)
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var kind string
		var start time.Time
		var end time.Time
		var timezone string
		var currency string
		var confirmed int64
		var reserved int64
		var unconfirmed int64
		var state string
		var policyVersion int64
		if err := rows.Scan(
			&kind, &start, &end, &timezone, &currency,
			&confirmed, &reserved, &unconfirmed, &state, &policyVersion,
		); err != nil {
			t.Fatalf("scan employee period: %v", err)
		}
		if seen[kind] || (kind != "day" && kind != "week") {
			t.Fatalf("unexpected employee period kind %q", kind)
		}
		seen[kind] = true
		if !end.After(start) || timezone != "Asia/Seoul" || currency != "USD" ||
			confirmed != expected.Confirmed || reserved != expected.Reserved ||
			unconfirmed != expected.Unconfirmed || state != expected.State || policyVersion != expected.PolicyVersion {
			t.Fatalf(
				"employee %s period mismatch: start=%s end=%s timezone=%s currency=%s confirmed=%d reserved=%d unconfirmed=%d state=%s policyVersion=%d",
				kind, start, end, timezone, currency, confirmed, reserved, unconfirmed, state, policyVersion,
			)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate employee periods: %v", err)
	}
	if len(seen) != 2 || !seen["day"] || !seen["week"] {
		t.Fatalf("employee day/week periods are incomplete: %+v", seen)
	}
}

func assertEmployeeReservation(
	t *testing.T,
	pool *pgxpool.Pool,
	requestID string,
	expected employeeReservationExpectation,
) {
	t.Helper()
	var employeeID string
	var state string
	var policyVersion int64
	var enforcementMode string
	var dailyEnabled bool
	var dailyLimit int64
	var dailyWarning int64
	var dailyState string
	var weeklyEnabled bool
	var weeklyLimit int64
	var weeklyWarning int64
	var weeklyState string
	var enforcementOutcome string
	var pricingRuleID string
	var pricingVersion string
	var estimateVersion string
	var reserved int64
	var confirmed int64
	var unconfirmed int64
	var ledgerVersion int64
	var usagePending bool
	if err := pool.QueryRow(context.Background(), `
		SELECT employee_id::text, state, pinned_policy_version, enforcement_mode,
		       daily_enabled, daily_limit_micro_usd, daily_warning_micro_usd, daily_state,
		       weekly_enabled, weekly_limit_micro_usd, weekly_warning_micro_usd, weekly_state,
		       enforcement_outcome, pricing_rule_id, pricing_version, estimate_version,
		       reserved_cost_micro_usd, confirmed_cost_micro_usd, unconfirmed_cost_micro_usd,
		       ledger_version, usage_pending_at IS NOT NULL
		FROM tenant_employee_cost_reservations
		WHERE surface = 'tenant_chat' AND request_id = $1
	`, requestID).Scan(
		&employeeID, &state, &policyVersion, &enforcementMode,
		&dailyEnabled, &dailyLimit, &dailyWarning, &dailyState,
		&weeklyEnabled, &weeklyLimit, &weeklyWarning, &weeklyState,
		&enforcementOutcome, &pricingRuleID, &pricingVersion, &estimateVersion,
		&reserved, &confirmed, &unconfirmed, &ledgerVersion, &usagePending,
	); err != nil {
		t.Fatalf("read employee reservation: %v", err)
	}
	if employeeID != expected.EmployeeID || state != expected.State || policyVersion != expected.PolicyVersion ||
		enforcementMode != "restrict_high_cost" || dailyEnabled || dailyLimit != 5_000_000 || dailyWarning != 0 || dailyState != "not_configured" ||
		weeklyEnabled || weeklyLimit != 25_000_000 || weeklyWarning != 0 || weeklyState != "not_configured" ||
		enforcementOutcome != "not_configured" || pricingRuleID != "standard_route" || pricingVersion != "1" ||
		estimateVersion != "utf8_message_bytes_v1" || reserved != expected.Reserved || confirmed != expected.Confirmed ||
		unconfirmed != expected.Unconfirmed || ledgerVersion != expected.LedgerVersion || usagePending != expected.UsagePending {
		t.Fatalf(
			"employee reservation mismatch: employee=%s state=%s policy=%d mode=%s daily=(%t,%d,%d,%s) weekly=(%t,%d,%d,%s) outcome=%s pricing=(%s,%s,%s) balances=(%d,%d,%d) ledger=%d pending=%t",
			employeeID, state, policyVersion, enforcementMode,
			dailyEnabled, dailyLimit, dailyWarning, dailyState,
			weeklyEnabled, weeklyLimit, weeklyWarning, weeklyState,
			enforcementOutcome, pricingRuleID, pricingVersion, estimateVersion,
			reserved, confirmed, unconfirmed, ledgerVersion, usagePending,
		)
	}
}

func assertEmployeeAttempt(
	t *testing.T,
	pool *pgxpool.Pool,
	requestID string,
	attemptNo int,
	expected employeeAttemptExpectation,
) {
	t.Helper()
	var kind string
	var providerID string
	var modelKey string
	var pricingRuleID string
	var pricingVersion string
	var reserved int64
	var confirmed int64
	var unconfirmed int64
	var usageQuality string
	var outcome string
	var dispatchState string
	var inputTokens int64
	var outputTokens int64
	var usagePending bool
	if err := pool.QueryRow(context.Background(), `
		SELECT kind, provider_id, model_key, pricing_rule_id, pricing_version,
		       reserved_cost_micro_usd, confirmed_cost_micro_usd, unconfirmed_cost_micro_usd,
		       usage_quality, COALESCE(outcome, ''), dispatch_state,
		       confirmed_input_tokens, confirmed_output_tokens,
		       usage_pending_at IS NOT NULL
		FROM tenant_employee_cost_provider_attempts
		WHERE surface = 'tenant_chat' AND request_id = $1 AND attempt_no = $2
	`, requestID, attemptNo).Scan(
		&kind, &providerID, &modelKey, &pricingRuleID, &pricingVersion,
		&reserved, &confirmed, &unconfirmed,
		&usageQuality, &outcome, &dispatchState, &inputTokens, &outputTokens, &usagePending,
	); err != nil {
		t.Fatalf("read employee attempt %d: %v", attemptNo, err)
	}
	expectedPricingRuleID := expected.PricingRuleID
	if expectedPricingRuleID == "" {
		switch expected.ModelKey {
		case "standard_model":
			expectedPricingRuleID = "standard_route"
		case "economy_model":
			expectedPricingRuleID = "economy_route"
		}
	}
	if kind != expected.Kind || providerID != expected.ProviderID || modelKey != expected.ModelKey ||
		pricingRuleID != expectedPricingRuleID || pricingVersion != "1" ||
		reserved != expected.Reserved || confirmed != expected.Confirmed || unconfirmed != expected.Unconfirmed ||
		usageQuality != expected.UsageQuality || outcome != expected.Outcome || inputTokens != expected.InputTokens ||
		outputTokens != expected.OutputTokens || usagePending != expected.UsagePending ||
		(expected.DispatchState != "" && dispatchState != expected.DispatchState) {
		t.Fatalf(
			"employee attempt %d mismatch: kind=%s provider=%s model=%s pricing=(%s,%s) balances=(%d,%d,%d) quality=%s outcome=%s dispatch=%s tokens=(%d,%d) pending=%t",
			attemptNo, kind, providerID, modelKey, pricingRuleID, pricingVersion,
			reserved, confirmed, unconfirmed, usageQuality, outcome, dispatchState, inputTokens, outputTokens, usagePending,
		)
	}
}

func assertEmployeeLedger(
	t *testing.T,
	pool *pgxpool.Pool,
	requestID string,
	expected []employeeLedgerExpectation,
) {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT event_version, event_type, reserved_cost_micro_usd_delta,
		       confirmed_cost_micro_usd_delta, unconfirmed_cost_micro_usd_delta
		FROM tenant_employee_cost_ledger_entries
		WHERE surface = 'tenant_chat' AND request_id = $1
		ORDER BY event_version
	`, requestID)
	if err != nil {
		t.Fatalf("read employee ledger: %v", err)
	}
	defer rows.Close()
	actual := make([]employeeLedgerExpectation, 0, len(expected))
	for rows.Next() {
		var entry employeeLedgerExpectation
		if err := rows.Scan(
			&entry.Version, &entry.EventType, &entry.ReservedDelta,
			&entry.ConfirmedDelta, &entry.UnconfirmedDelta,
		); err != nil {
			t.Fatalf("scan employee ledger: %v", err)
		}
		actual = append(actual, entry)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate employee ledger: %v", err)
	}
	if len(actual) != len(expected) {
		t.Fatalf("employee ledger length mismatch: got=%+v want=%+v", actual, expected)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("employee ledger entry %d mismatch: got=%+v want=%+v", index, actual[index], expected[index])
		}
	}
}

type usageFixture struct {
	tenantID   string
	userID     string
	employeeID string
}

func (f usageFixture) configureEmployeeLedgerRollout(t *testing.T, pool *pgxpool.Pool, mode string) {
	t.Helper()
	if mode != "off" && mode != "shadow" {
		t.Fatalf("unsupported integration rollout mode %q", mode)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO tenant_employee_cost_ledger_rollouts (
		  tenant_id, mode, tenant_chat_covered_from,
		  updated_by_kind, updated_by, version, created_at, updated_at
		) VALUES (
		  $1::uuid, $2,
		  CASE WHEN $2 = 'shadow' THEN now() ELSE NULL END,
		  'system', 'tenant_chat_integration', 1, now(), now()
		)
		ON CONFLICT (tenant_id) DO UPDATE SET
		  mode = EXCLUDED.mode,
		  activation_boundary_at = NULL,
		  tenant_chat_covered_from = EXCLUDED.tenant_chat_covered_from,
		  coverage_invalidated_at = NULL,
		  coverage_error_code = NULL,
		  updated_by_kind = EXCLUDED.updated_by_kind,
		  updated_by = EXCLUDED.updated_by,
		  updated_at = now()
	`, f.tenantID, mode); err != nil {
		t.Fatalf("configure employee ledger rollout %s: %v", mode, err)
	}
}

func (f usageFixture) configureShadowDisabledEmployeePolicy(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	f.configureEmployeeLedgerRollout(t, pool, "shadow")
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO tenant_employee_cost_policies (
		  tenant_id, employee_id,
		  daily_enabled, daily_limit_micro_usd,
		  weekly_enabled, weekly_limit_micro_usd,
		  currency, period_timezone, warning_threshold_percent,
		  enforcement_mode, version, updated_by, created_at, updated_at
		) VALUES (
		  $1::uuid, $2::uuid,
		  false, 5000000,
		  false, 25000000,
		  'USD', 'Asia/Seoul', 80,
		  'restrict_high_cost', 7, $3::uuid, now(), now()
		)
		ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
		  daily_enabled = EXCLUDED.daily_enabled,
		  daily_limit_micro_usd = EXCLUDED.daily_limit_micro_usd,
		  weekly_enabled = EXCLUDED.weekly_enabled,
		  weekly_limit_micro_usd = EXCLUDED.weekly_limit_micro_usd,
		  period_timezone = EXCLUDED.period_timezone,
		  warning_threshold_percent = EXCLUDED.warning_threshold_percent,
		  enforcement_mode = EXCLUDED.enforcement_mode,
		  version = EXCLUDED.version,
		  updated_by = EXCLUDED.updated_by,
		  updated_at = now()
	`, f.tenantID, f.employeeID, f.userID); err != nil {
		t.Fatalf("configure disabled employee cost policy: %v", err)
	}
}

func (f usageFixture) configureEnforcedEmployeePolicy(
	t *testing.T,
	pool *pgxpool.Pool,
	now time.Time,
) {
	t.Helper()
	week, err := employeecost.CalendarBounds(now, employeecost.PeriodKindWeek, "Asia/Seoul")
	if err != nil {
		t.Fatalf("calculate enforce coverage boundary: %v", err)
	}
	coveredFrom := week.Start.Add(-time.Second)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO tenant_employee_cost_ledger_rollouts (
		  tenant_id, mode, activation_boundary_at,
		  project_application_covered_from, tenant_chat_covered_from,
		  updated_by_kind, updated_by, version, created_at, updated_at
		) VALUES (
		  $1::uuid, 'enforce', $2, $3, $3,
		  'system', 'tenant_chat_integration', 1, now(), now()
		)
		ON CONFLICT (tenant_id) DO UPDATE SET
		  mode = 'enforce',
		  activation_boundary_at = EXCLUDED.activation_boundary_at,
		  project_application_covered_from = EXCLUDED.project_application_covered_from,
		  tenant_chat_covered_from = EXCLUDED.tenant_chat_covered_from,
		  coverage_invalidated_at = NULL,
		  coverage_error_code = NULL,
		  updated_by_kind = EXCLUDED.updated_by_kind,
		  updated_by = EXCLUDED.updated_by,
		  updated_at = now()
	`, f.tenantID, now.Add(-time.Second), coveredFrom); err != nil {
		t.Fatalf("configure enforce employee ledger rollout: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO tenant_employee_cost_policies (
		  tenant_id, employee_id,
		  daily_enabled, daily_limit_micro_usd,
		  weekly_enabled, weekly_limit_micro_usd,
		  currency, period_timezone, warning_threshold_percent,
		  enforcement_mode, version, updated_by, created_at, updated_at
		) VALUES (
		  $1::uuid, $2::uuid,
		  true, 200,
		  true, 200,
		  'USD', 'Asia/Seoul', 80,
		  'restrict_high_cost', 8, $3::uuid, now(), now()
		)
		ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
		  daily_enabled = EXCLUDED.daily_enabled,
		  daily_limit_micro_usd = EXCLUDED.daily_limit_micro_usd,
		  weekly_enabled = EXCLUDED.weekly_enabled,
		  weekly_limit_micro_usd = EXCLUDED.weekly_limit_micro_usd,
		  period_timezone = EXCLUDED.period_timezone,
		  warning_threshold_percent = EXCLUDED.warning_threshold_percent,
		  enforcement_mode = EXCLUDED.enforcement_mode,
		  version = EXCLUDED.version,
		  updated_by = EXCLUDED.updated_by,
		  updated_at = now()
	`, f.tenantID, f.employeeID, f.userID); err != nil {
		t.Fatalf("configure enforced employee cost policy: %v", err)
	}
}

func (f usageFixture) seedConflictingEmployeeReservation(
	t *testing.T,
	pool *pgxpool.Pool,
	requestID string,
	now time.Time,
) {
	t.Helper()
	otherEmployeeID := mustUsageUUID(t)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO employees (
		  id, "tenantId", email, status, "invitationStatus", "createdAt", "updatedAt"
		) VALUES (
		  $1::uuid, $2::uuid, $1 || '@integration.local', 'active', 'accepted', now(), now()
		)
	`, otherEmployeeID, f.tenantID); err != nil {
		t.Fatalf("create conflicting employee fixture: %v", err)
	}
	day, err := employeecost.CalendarBounds(now, employeecost.PeriodKindDay, "Asia/Seoul")
	if err != nil {
		t.Fatalf("calculate conflicting day period: %v", err)
	}
	week, err := employeecost.CalendarBounds(now, employeecost.PeriodKindWeek, "Asia/Seoul")
	if err != nil {
		t.Fatalf("calculate conflicting week period: %v", err)
	}
	for _, period := range []employeecost.PeriodBounds{day, week} {
		if _, err := pool.Exec(context.Background(), `
			INSERT INTO tenant_employee_cost_periods (
			  tenant_id, employee_id, period_kind, period_start, period_end,
			  period_timezone, currency, created_policy_version,
			  last_evaluated_policy_version, state
			) VALUES (
			  $1::uuid, $2::uuid, $3, $4, $5,
			  $6, 'USD', 0, 0, 'not_configured'
			)
		`, f.tenantID, otherEmployeeID, string(period.Kind), period.Start, period.End, period.Timezone); err != nil {
			t.Fatalf("create conflicting employee %s period: %v", period.Kind, err)
		}
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO tenant_employee_cost_reservations (
		  reservation_id, tenant_id, employee_id, surface, request_id,
		  day_period_start, week_period_start, currency,
		  pinned_policy_version, enforcement_mode,
		  daily_enabled, daily_limit_micro_usd, daily_warning_micro_usd, daily_state,
		  weekly_enabled, weekly_limit_micro_usd, weekly_warning_micro_usd, weekly_state,
		  enforcement_outcome, pricing_rule_id, pricing_version, estimate_version,
		  reserved_cost_micro_usd, confirmed_cost_micro_usd, unconfirmed_cost_micro_usd,
		  state, ledger_version, reserved_at, created_at, updated_at
		) VALUES (
		  gen_random_uuid(), $1::uuid, $2::uuid, 'tenant_chat', $3,
		  $4, $5, 'USD',
		  0, 'monitor',
		  false, 0, 0, 'not_configured',
		  false, 0, 0, 'not_configured',
		  'not_configured', 'conflict_seed_route', '1', 'integration_conflict_seed_v1',
		  0, 0, 0, 'reserved', 0, $6, $6, $6
		)
	`, f.tenantID, otherEmployeeID, requestID, day.Start, week.Start, now); err != nil {
		t.Fatalf("seed conflicting employee reservation: %v", err)
	}
}

func (f usageFixture) admissionContext() tenantchat.RequestContext {
	return tenantchat.RequestContext{
		Surface: "tenant_chat", Phase: tenantchat.PhaseAdmission,
		RequestID: "usage_request_001", TurnID: "usage_turn_001", IdempotencyKey: "usage_attempt_001",
		ExecutionScope: f.executionScope(),
		Snapshot:       tenantchat.SnapshotReference{Version: 1},
		BindingDigest:  "hmac-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	}
}

func (f usageFixture) completionContext(admissionID string) tenantchat.RequestContext {
	return tenantchat.RequestContext{
		Surface: "tenant_chat", Phase: tenantchat.PhaseCompletion,
		RequestID: "usage_request_001", TurnID: "usage_turn_001", IdempotencyKey: "usage_attempt_001",
		AdmissionID: admissionID, ExecutionScope: f.executionScope(),
		Snapshot: tenantchat.SnapshotReference{
			Version: 1, Digest: "sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M",
			PolicyVersion: 1, EmployeeNoticeVersion: 1, PricingVersion: 1,
		},
		BindingDigest: "hmac-sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
		UsageIntent: &tenantchat.UsageIntent{
			EstimatedInputTokens: 100, MaxOutputTokens: 100, RequestedTier: "standard", CacheStrategy: "off",
		},
	}
}

func (f usageFixture) executionScope() tenantchat.ExecutionScope {
	return tenantchat.ExecutionScope{
		Kind: "tenant_chat", TenantID: f.tenantID,
		Actor:       tenantchat.Actor{UserID: f.userID, ActorKind: "employee", EmployeeID: f.employeeID},
		QuotaScope:  tenantchat.ScopeReference{Type: "user", ID: f.userID},
		BudgetScope: tenantchat.ScopeReference{Type: "tenant", ID: f.tenantID},
	}
}

func (f usageFixture) snapshot(tokenLimit, costLimit int64) tenantruntime.Snapshot {
	return tenantruntime.Snapshot{
		Version: 1, TenantID: f.tenantID,
		Pricing: tenantruntime.Pricing{Version: 1, Routes: []tenantruntime.PriceRoute{{
			RouteID: "standard_route", ProviderID: "provider", ModelKey: "standard_model",
			InputMicroUSDPerMillionTokens: 250_000, OutputMicroUSDPerMillionTokens: 1_000_000,
		}, {
			RouteID: "economy_route", ProviderID: "provider", ModelKey: "economy_model",
			InputMicroUSDPerMillionTokens: 100_000, OutputMicroUSDPerMillionTokens: 400_000,
		}, {
			RouteID: "high_quality_route", ProviderID: "provider", ModelKey: "high_quality_model",
			InputMicroUSDPerMillionTokens: 1_000_000, OutputMicroUSDPerMillionTokens: 4_000_000,
		}}},
		Policies: tenantruntime.Policies{
			Streaming: tenantruntime.StreamingPolicy{
				Enabled: true, MaxDurationSeconds: 120, FinalEventRequired: true,
			},
			Quota: tenantruntime.QuotaPolicy{
				Timezone: "Asia/Seoul", DefaultMonthlyTokenLimit: tokenLimit,
				WarningPercent: 80, EconomyPercent: 100, HardStopPercent: 120,
			},
			Budget: tenantruntime.BudgetPolicy{
				Timezone: "Asia/Seoul", MonthlyLimitMicroUSD: costLimit,
				WarningPercent: 80, EconomyPercent: 90, HardStopPercent: 100,
			},
			Routing: tenantruntime.RoutingPolicy{Routes: []tenantruntime.RuntimeRoute{{
				RouteID: "standard_route", Tier: "standard", ProviderID: "provider", ModelKey: "standard_model", Enabled: true,
			}, {
				RouteID: "economy_route", Tier: "economy", ProviderID: "provider", ModelKey: "economy_model", Enabled: true,
			}, {
				RouteID: "high_quality_route", Tier: "high_quality", ProviderID: "provider", ModelKey: "high_quality_model", Enabled: true,
			}}},
		},
	}
}

func setupUsageIntegration(t *testing.T) (*pgxpool.Pool, usageFixture) {
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
	fixture := usageFixture{tenantID: mustUsageUUID(t), userID: mustUsageUUID(t), employeeID: mustUsageUUID(t)}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_ledger_entries WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_provider_attempts WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_reservations WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_periods WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_policy_audits WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_policies WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_ledger_rollout_audits WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_employee_cost_ledger_rollouts WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_invocation_outbox WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_usage_ledger_entries WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_provider_attempts WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_usage_reservations WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_employee_weekly_token_periods WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_user_token_periods WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_tenant_cost_periods WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_request_admissions WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM employees WHERE "tenantId" = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_memberships WHERE "tenantId" = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, fixture.userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenants WHERE id = $1::uuid`, fixture.tenantID)
		pool.Close()
	})
	inserts := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO tenants (id, name, status, "createdAt", "updatedAt") VALUES ($1::uuid, 'tenant chat usage integration', 'ACTIVE', now(), now())`, []any{fixture.tenantID}},
		{`INSERT INTO users (id, email, status, "createdAt", "updatedAt") VALUES ($1::uuid, $1 || '@integration.local', 'active', now(), now())`, []any{fixture.userID}},
		{`INSERT INTO tenant_memberships (id, "tenantId", "userId", role, status, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'employee', 'active', now(), now())`, []any{fixture.tenantID, fixture.userID}},
		{`INSERT INTO employees (id, "tenantId", "userId", email, status, "invitationStatus", "createdAt", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $3 || '@integration.local', 'active', 'accepted', now(), now())`, []any{fixture.employeeID, fixture.tenantID, fixture.userID}},
	}
	for _, insert := range inserts {
		if _, err := pool.Exec(ctx, insert.query, insert.args...); err != nil {
			t.Fatalf("create usage integration fixture: %v", err)
		}
	}
	return pool, fixture
}

func mustUsageUUID(t *testing.T) string {
	t.Helper()
	value, err := newUUID()
	if err != nil {
		t.Fatalf("generate integration UUID: %v", err)
	}
	return value
}
