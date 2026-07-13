package postgres

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	admissionpostgres "gatelm/apps/gateway-core/internal/adapters/tenantchat/admission/postgres"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConsumeAndReserveWritesAtomicUsageLedgerIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
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
}

func TestFallbackSettlementIncludesEveryBillableAttemptIntegration(t *testing.T) {
	pool, fixture := setupUsageIntegration(t)
	admissionStore := admissionpostgres.NewStore(pool)
	admissionContext := fixture.admissionContext()
	admissionContext.RequestID = "fallback_request_001"
	admissionContext.TurnID = "fallback_turn_001"
	admissionContext.IdempotencyKey = "fallback_attempt_001"
	admission, err := admissionStore.Create(context.Background(), admissionContext, tenantchat.AdmissionLimits{
		RequestsPerWindow: 100, Window: time.Minute, MaxActiveAdmissionsPerUser: 2, AdmissionTTL: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("create fallback admission: %v", err)
	}
	completionContext := fixture.completionContext(admission.AdmissionID)
	completionContext.RequestID = admissionContext.RequestID
	completionContext.TurnID = admissionContext.TurnID
	completionContext.IdempotencyKey = admissionContext.IdempotencyKey
	snapshot := fixture.snapshot(10_000, 1_000_000)
	store := NewReservationStore(pool)
	reservation, err := store.BeginExecution(context.Background(), completionContext, snapshot)
	if err != nil {
		t.Fatalf("reserve primary exposure: %v", err)
	}
	fallbackRoute, err := selectRoute(snapshot, "economy", "normal", "normal")
	if err != nil {
		t.Fatalf("select fallback route: %v", err)
	}
	if err := store.BeginFallback(
		context.Background(), completionContext, snapshot, reservation.ReservationID,
		1, tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 10}, "failed_post_delta",
		fallbackRoute, 2,
	); err != nil {
		t.Fatalf("record primary, top up, and start fallback: %v", err)
	}
	settlement, err := store.FinalizeConfirmed(
		context.Background(), completionContext, reservation.ReservationID, 2,
		tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 20}, "succeeded",
	)
	if err != nil {
		t.Fatalf("settle fallback: %v", err)
	}
	if settlement.ConfirmedInputTokens != 200 || settlement.ConfirmedOutputTokens != 30 ||
		settlement.ConfirmedCostMicroUSD != 53 || settlement.LedgerVersion != 3 || len(settlement.Attempts) != 2 {
		t.Fatalf("all-attempt settlement mismatch: %+v", settlement)
	}
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

type usageFixture struct {
	tenantID   string
	userID     string
	employeeID string
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
		}}},
		Policies: tenantruntime.Policies{
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
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_invocation_outbox WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_usage_ledger_entries WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_provider_attempts WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_usage_reservations WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_user_token_periods WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_tenant_cost_periods WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant_chat_request_admissions WHERE tenant_id = $1::uuid`, fixture.tenantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM employees WHERE id = $1::uuid`, fixture.employeeID)
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
