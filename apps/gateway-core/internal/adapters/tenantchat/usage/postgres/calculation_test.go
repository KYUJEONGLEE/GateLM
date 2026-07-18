package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

func TestReservationCostUsesCeilingIntegerArithmetic(t *testing.T) {
	cost, err := reservationCost(1, 1, 250_000, 1_000_000)
	if err != nil {
		t.Fatalf("calculate reservation cost: %v", err)
	}
	if cost != 2 {
		t.Fatalf("want 2 micro USD, got %d", cost)
	}
}

func TestValidateTerminalWritePreservesContextAndDatabaseErrors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := validateTerminalWrite(ctx, "update fixture", errors.New("driver error"), 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancelled context, got %v", err)
	}
	databaseErr := errors.New("database unavailable")
	if err := validateTerminalWrite(context.Background(), "update fixture", databaseErr, 0); !errors.Is(err, databaseErr) {
		t.Fatalf("expected wrapped database error, got %v", err)
	}
	if err := validateTerminalWrite(context.Background(), "update fixture", nil, 0); err == nil {
		t.Fatal("expected no-rows error")
	}
}

func TestValidateLedgerlessReplayPreservesContextErrors(t *testing.T) {
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := validateLedgerlessReplay(cancelledCtx, errors.New("driver error"), 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancelled context, got %v", err)
	}

	deadlineCtx, deadlineCancel := context.WithDeadline(context.Background(), time.Unix(0, 0))
	defer deadlineCancel()
	if err := validateLedgerlessReplay(deadlineCtx, errors.New("driver error"), 0); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded, got %v", err)
	}
}

func TestValidateLedgerlessReplaySeparatesDatabaseFailureAndConflict(t *testing.T) {
	if err := validateLedgerlessReplay(context.Background(), errors.New("database unavailable"), 0); !errors.Is(err, tenantchat.ErrUsageGuardUnavailable) {
		t.Fatalf("expected usage guard unavailable, got %v", err)
	}
	for _, count := range []int{0, 2} {
		if err := validateLedgerlessReplay(context.Background(), nil, count); !errors.Is(err, tenantchat.ErrIdempotencyConflict) {
			t.Fatalf("expected idempotency conflict for count %d, got %v", count, err)
		}
	}
	if err := validateLedgerlessReplay(context.Background(), nil, 1); err != nil {
		t.Fatalf("expected valid replay, got %v", err)
	}
}

func TestConfirmedAttemptCostRejectsCacheReadPriceAboveRegularInput(t *testing.T) {
	cacheReadPrice := int64(251_000)
	_, err := confirmedAttemptCost(
		settlementAttempt{InputPrice: 250_000, OutputPrice: 1_000_000, CacheReadPrice: &cacheReadPrice},
		tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 10, CacheReadInputTokens: 50},
	)
	if err == nil {
		t.Fatal("settlement accepted a cache-read input price above the regular input price")
	}
}

func TestConfirmedAttemptCostRejectsInvalidUsage(t *testing.T) {
	attempt := settlementAttempt{InputPrice: 250_000, OutputPrice: 1_000_000}
	for _, test := range []struct {
		name  string
		usage tenantchat.ConfirmedUsage
	}{
		{name: "negative input", usage: tenantchat.ConfirmedUsage{InputTokens: -1}},
		{name: "negative output", usage: tenantchat.ConfirmedUsage{OutputTokens: -1}},
		{name: "negative cache read", usage: tenantchat.ConfirmedUsage{CacheReadInputTokens: -1}},
		{name: "cache read exceeds input", usage: tenantchat.ConfirmedUsage{InputTokens: 1, CacheReadInputTokens: 2}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := confirmedAttemptCost(attempt, test.usage); err == nil {
				t.Fatal("settlement accepted invalid confirmed usage")
			}
		})
	}
}

func TestConfirmedAttemptCostUsesPinnedCacheReadDiscount(t *testing.T) {
	cacheReadPrice := int64(25_000)
	cost, err := confirmedAttemptCost(
		settlementAttempt{InputPrice: 250_000, OutputPrice: 1_000_000, CacheReadPrice: &cacheReadPrice},
		tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 10, CacheReadInputTokens: 50},
	)
	if err != nil {
		t.Fatalf("calculate confirmed settlement cost: %v", err)
	}
	if cost != 25 {
		t.Fatalf("want 25 micro USD, got %d", cost)
	}
}

func TestCalendarMonthUsesIANAZoneBoundaries(t *testing.T) {
	start, end, err := calendarMonth(time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC), "Asia/Seoul")
	if err != nil {
		t.Fatalf("calculate calendar month: %v", err)
	}
	if start != time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC) ||
		end != time.Date(2026, 7, 31, 15, 0, 0, 0, time.UTC) {
		t.Fatalf("unexpected Seoul month: start=%s end=%s", start, end)
	}
}

func TestCalendarWeekUsesMondayBoundaryInSeoul(t *testing.T) {

	start, end, err := calendarWeek(time.Date(2026, 7, 19, 16, 0, 0, 0, time.UTC), "Asia/Seoul")
	if err != nil {
		t.Fatalf("calculate calendar week: %v", err)
	}
	if start != time.Date(2026, 7, 19, 15, 0, 0, 0, time.UTC) ||
		end != time.Date(2026, 7, 26, 15, 0, 0, 0, time.UTC) {
		t.Fatalf("unexpected Seoul Monday week: start=%s end=%s", start, end)
	}

	previousStart, previousEnd, err := calendarWeek(time.Date(2026, 7, 19, 14, 59, 59, 0, time.UTC), "Asia/Seoul")
	if err != nil {
		t.Fatalf("calculate previous calendar week: %v", err)
	}
	if previousStart != time.Date(2026, 7, 12, 15, 0, 0, 0, time.UTC) ||
		previousEnd != start {
		t.Fatalf("unexpected boundary before Seoul Monday: start=%s end=%s", previousStart, previousEnd)
	}
}

func TestExactMonthlyQuotaThresholdsUseEightyNinetyAndOneHundred(t *testing.T) {
	warning, economy, hardStop := thresholds(100, 80, 90, 100)
	if warning != 80 || economy != 90 || hardStop != 100 {
		t.Fatalf("unexpected exact quota thresholds: warning=%d economy=%d hardStop=%d", warning, economy, hardStop)
	}
}

func TestTokenPeriodForQuotaPolicyBlocksExistingPeriodAtZero(t *testing.T) {
	configured := tokenPeriodForQuotaPolicy(tokenPeriod{
		Reserved: 30, Confirmed: 40, Unconfirmed: 20,
		Limit: 1_000_000, Warning: 800_000, Economy: 900_000, HardStop: 1_000_000,
		State: "normal",
	}, tenantruntime.QuotaPolicy{
		DefaultMonthlyTokenLimit: 0,
		WarningPercent:           80,
		EconomyPercent:           90,
		HardStopPercent:          100,
	})
	if configured.Limit != 0 || configured.Warning != 0 || configured.Economy != 0 || configured.HardStop != 0 {
		t.Fatalf("zero quota must clear all thresholds: %+v", configured)
	}
	if configured.State != "blocked" {
		t.Fatalf("zero quota must block an existing period immediately, got %q", configured.State)
	}
	if configured.Reserved != 30 || configured.Confirmed != 40 || configured.Unconfirmed != 20 {
		t.Fatalf("policy sync must preserve accumulated usage: %+v", configured)
	}
}

func TestTokenPeriodForQuotaPolicyUsesExistingExposureAfterLoweringLimit(t *testing.T) {
	configured := tokenPeriodForQuotaPolicy(tokenPeriod{
		Reserved: 100, Confirmed: 200, Unconfirmed: 50,
	}, tenantruntime.QuotaPolicy{
		DefaultMonthlyTokenLimit: 300,
		WarningPercent:           80,
		EconomyPercent:           90,
		HardStopPercent:          100,
	})
	if configured.State != "blocked" {
		t.Fatalf("lowered quota must evaluate existing exposure, got %q", configured.State)
	}
}

func TestEconomyStateExcludesHighQualityRoute(t *testing.T) {
	snapshot := tenantruntime.Snapshot{
		Pricing: tenantruntime.Pricing{Version: 1, Routes: []tenantruntime.PriceRoute{
			{RouteID: "high", ProviderID: "provider", ModelKey: "high-model", InputMicroUSDPerMillionTokens: 1, OutputMicroUSDPerMillionTokens: 1},
			{RouteID: "economy", ProviderID: "provider", ModelKey: "economy-model", InputMicroUSDPerMillionTokens: 1, OutputMicroUSDPerMillionTokens: 1},
		}},
		Policies: tenantruntime.Policies{Routing: tenantruntime.RoutingPolicy{Routes: []tenantruntime.RuntimeRoute{
			{RouteID: "high", Tier: "high_quality", ProviderID: "provider", ModelKey: "high-model", Enabled: true},
			{RouteID: "economy", Tier: "economy", ProviderID: "provider", ModelKey: "economy-model", Enabled: true},
		}}},
	}
	route, err := selectRoute(snapshot, "high_quality", "economy", "normal")
	if err != nil {
		t.Fatalf("select economy fallback: %v", err)
	}
	if route.Tier != "economy" {
		t.Fatalf("high quality route was not excluded: %+v", route)
	}

	snapshot.Policies.Routing.Routes[1].Enabled = false
	if _, err := selectRoute(snapshot, "high_quality", "economy", "normal"); !errors.Is(err, tenantchat.ErrNoEligibleRoute) {
		t.Fatalf("want no eligible route, got %v", err)
	}
}

func TestRoutingV2SelectionUsesServerDecisionAndAllowsUnavailablePricing(t *testing.T) {
	snapshot := tenantruntime.Snapshot{
		Pricing: tenantruntime.Pricing{Version: 7, Routes: []tenantruntime.PriceRoute{{
			RouteID: "route_unknown", ProviderID: "provider", ModelKey: "new-model",
			PricingStatus: "unavailable", PricingSource: "unavailable",
		}}},
		Policies: tenantruntime.Policies{Routing: tenantruntime.RoutingPolicy{
			Routes: []tenantruntime.RuntimeRoute{{
				RouteID: "route_unknown", ModelRef: "tc_unknown", ProviderID: "provider", ModelKey: "new-model", Enabled: true,
			}},
			Policy: &tenantruntime.RoutingPolicyV2Bridge{Mode: "auto"},
		}},
	}
	requestContext := tenantchat.RequestContext{
		UsageIntent: &tenantchat.UsageIntent{RequestedTier: "economy"},
		Routing:     &tenantchat.RoutingDecision{ModelRef: "tc_unknown"},
	}

	route, err := selectExecutionRoute(snapshot, requestContext, "economy", "economy")
	if err != nil {
		t.Fatalf("select Routing v2 modelRef: %v", err)
	}
	if route.ModelKey != "new-model" || route.PricingStatus != "unavailable" ||
		route.InputMicroUSDPerMillionTokens != 0 || route.OutputMicroUSDPerMillionTokens != 0 {
		t.Fatalf("unexpected price-unavailable route: %+v", route)
	}
	cost, err := reservationCost(1000, 1000, route.InputMicroUSDPerMillionTokens, route.OutputMicroUSDPerMillionTokens)
	if err != nil || cost != 0 {
		t.Fatalf("unknown monetary price must reserve zero cost, cost=%d err=%v", cost, err)
	}
}

func TestReservationCacheOutcomeRequiresBothSnapshotAndRequestEligibility(t *testing.T) {
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Cache: tenantruntime.CachePolicy{
		Strategy: "exact", Enabled: true,
	}}}
	requestContext := tenantchat.RequestContext{UsageIntent: &tenantchat.UsageIntent{CacheStrategy: "exact"}}

	if outcome := reservationCacheOutcome(requestContext, snapshot); outcome != "miss" {
		t.Fatalf("eligible exact cache request must reserve as miss, got %q", outcome)
	}

	snapshot.Policies.Cache.Enabled = false
	if outcome := reservationCacheOutcome(requestContext, snapshot); outcome != "off" {
		t.Fatalf("disabled cache policy must reserve as off, got %q", outcome)
	}

	snapshot.Policies.Cache.Enabled = true
	requestContext.UsageIntent.CacheStrategy = "off"
	if outcome := reservationCacheOutcome(requestContext, snapshot); outcome != "off" {
		t.Fatalf("cache-ineligible request must reserve as off, got %q", outcome)
	}
}
