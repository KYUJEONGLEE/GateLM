package postgres

import (
	"encoding/json"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

func TestLedgerlessTerminalPayloadCarriesBoundedCacheObservability(t *testing.T) {
	observability := tenantchat.LedgerlessObservability{
		EffectiveProviderID: "provider_001", EffectiveModelKey: "model_001",
		EffectiveRouteTier: "high_quality", SavedCostMicroUSD: 425,
	}
	payload, err := ledgerlessTerminalPayload(
		"event_001",
		tenantchat.RequestContext{
			RequestID: "request_001", TurnID: "turn_001", IdempotencyKey: "idem_001",
			ExecutionScope: tenantchat.ExecutionScope{
				TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				Actor:    tenantchat.Actor{UserID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ActorKind: "tenant_admin"},
			},
			Snapshot: tenantchat.SnapshotReference{Version: 3},
			Routing:  &tenantchat.RoutingDecision{Difficulty: "complex"},
		},
		tenantruntime.Snapshot{Pricing: tenantruntime.Pricing{Version: 7}},
		"cache_hit", "", "hit", observability,
		1500,
		time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("build ledgerless payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode ledgerless payload: %v", err)
	}
	if decoded["effectiveProviderId"] != "provider_001" ||
		decoded["effectiveModelKey"] != "model_001" ||
		decoded["effectiveRouteTier"] != "high_quality" ||
		decoded["routingDifficulty"] != "complex" ||
		decoded["savedCostMicroUsd"] != float64(425) ||
		decoded["latencyMs"] != float64(1500) {
		t.Fatalf("unexpected cache observability: %+v", decoded)
	}
	if !validLedgerlessObservability("cache_hit", observability) ||
		validLedgerlessObservability("cache_hit", tenantchat.LedgerlessObservability{}) {
		t.Fatal("cache observability validation did not fail closed")
	}
}

func TestLedgerlessLatencyUsesAdmissionLifetimeAndClampsClockSkew(t *testing.T) {
	startedAt := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	if latencyMs := ledgerlessLatencyMs(startedAt, startedAt.Add(1750*time.Millisecond)); latencyMs != 1750 {
		t.Fatalf("expected 1750ms ledgerless latency, got %d", latencyMs)
	}
	if latencyMs := ledgerlessLatencyMs(startedAt, startedAt.Add(-time.Millisecond)); latencyMs != 0 {
		t.Fatalf("expected clock skew to clamp to 0ms, got %d", latencyMs)
	}
}
