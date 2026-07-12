package postgres

import (
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
