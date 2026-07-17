package postgres

import (
	"encoding/json"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
)

func TestSettlementEventPayloadIncludesTTFT(t *testing.T) {
	ttftMs := int64(84)
	requestContext := tenantchat.RequestContext{
		RequestID:      "request-1",
		TurnID:         "turn-1",
		IdempotencyKey: "idempotency-1",
		ExecutionScope: tenantchat.ExecutionScope{
			TenantID: "00000000-0000-4000-8000-000000000100",
			Actor: tenantchat.Actor{
				UserID:    "00000000-0000-4000-8000-000000000200",
				ActorKind: "employee",
			},
		},
		Snapshot: tenantchat.SnapshotReference{Version: 5},
		TTFTMs:   &ttftMs,
	}
	now := time.Date(2026, time.July, 18, 0, 0, 0, 0, time.UTC)
	payload, err := settlementEventPayload(
		"00000000-0000-4000-8000-000000000300",
		"00000000-0000-4000-8000-000000000400",
		2,
		requestContext,
		settlementReservation{PricingVersion: 1, CacheOutcome: "off"},
		tokenPeriod{Start: now, End: now.Add(7 * 24 * time.Hour), Timezone: "Asia/Seoul"},
		"normal",
		"normal",
		[]tenantchat.ProviderAttempt{{AttemptNo: 1, Outcome: "succeeded"}},
		settlementTotals{},
		"succeeded",
		now,
	)
	if err != nil {
		t.Fatalf("build settlement event payload: %v", err)
	}
	var event map[string]any
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatalf("decode settlement event payload: %v", err)
	}
	if event["ttftMs"] != float64(ttftMs) {
		t.Fatalf("expected ttftMs %d, got %#v", ttftMs, event["ttftMs"])
	}
}

func TestSettlementEventPayloadOmitsMissingTTFT(t *testing.T) {
	now := time.Date(2026, time.July, 18, 0, 0, 0, 0, time.UTC)
	payload, err := settlementEventPayload(
		"00000000-0000-4000-8000-000000000300",
		"00000000-0000-4000-8000-000000000400",
		2,
		tenantchat.RequestContext{
			RequestID:      "request-1",
			TurnID:         "turn-1",
			IdempotencyKey: "idempotency-1",
			ExecutionScope: tenantchat.ExecutionScope{
				TenantID: "00000000-0000-4000-8000-000000000100",
				Actor: tenantchat.Actor{
					UserID:    "00000000-0000-4000-8000-000000000200",
					ActorKind: "employee",
				},
			},
		},
		settlementReservation{PricingVersion: 1, CacheOutcome: "off"},
		tokenPeriod{Start: now, End: now.Add(7 * 24 * time.Hour), Timezone: "Asia/Seoul"},
		"normal",
		"normal",
		[]tenantchat.ProviderAttempt{{AttemptNo: 1, Outcome: "succeeded"}},
		settlementTotals{},
		"succeeded",
		now,
	)
	if err != nil {
		t.Fatalf("build settlement event payload: %v", err)
	}
	var event map[string]any
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatalf("decode settlement event payload: %v", err)
	}
	if _, ok := event["ttftMs"]; ok {
		t.Fatalf("expected missing TTFT to be omitted, got %#v", event["ttftMs"])
	}
}
