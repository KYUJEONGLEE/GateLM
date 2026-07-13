package completion

import (
	"context"
	"encoding/json"
	"io"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

func TestServiceRelaysPrimaryStreamAndSettlesConfirmedUsage(t *testing.T) {
	snapshots := &fakeSnapshotResolver{snapshot: completionSnapshot()}
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
			RequestID:     "request_completion_001", State: "reserved",
			QuotaState: "normal", BudgetState: "warning",
			Route: tenantchat.SelectedRoute{
				RouteID: "route_standard", Tier: "standard",
				ProviderID: "c80fa013-f1d4-4430-8971-914b78807659", ModelKey: "model-standard",
			},
		},
		settlement: tenantchat.UsageSettlement{
			RequestID: "request_completion_001", ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
			State: "settled", ConfirmedInputTokens: 12, ConfirmedOutputTokens: 5,
			QuotaState: "normal", BudgetState: "warning", LedgerVersion: 2,
		},
	}
	providers := &fakeProviderExecutor{stream: &fakeStream{events: []provider.ChatCompletionStreamEvent{
		{Data: json.RawMessage(`{"choices":[{"delta":{"content":"안녕"}}]}`)},
		{Data: json.RawMessage(`{"choices":[{"delta":{"content":"하세요"}}]}`)},
		{Data: json.RawMessage(`{"choices":[{"delta":{}}],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}`), Usage: &provider.Usage{PromptTokens: 12, CompletionTokens: 5, TotalTokens: 17}},
	}}}
	service := New(snapshots, usage, providers)

	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare completion: %v", err)
	}
	var events []tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatalf("relay completion: %v", err)
	}

	if usage.reserveCalls != 1 || usage.startAttemptCalls != 1 || usage.settleCalls != 1 || providers.calls != 1 {
		t.Fatalf(
			"unexpected call counts reserve=%d start=%d settle=%d provider=%d",
			usage.reserveCalls, usage.startAttemptCalls, usage.settleCalls, providers.calls,
		)
	}
	if len(events) != 3 || events[0].Delta != "안녕" || events[1].Delta != "하세요" {
		t.Fatalf("unexpected delta events: %+v", events)
	}
	final := events[2]
	if final.Type != tenantchat.CompletionEventFinal || final.Sequence != 3 ||
		final.TerminalOutcome != "succeeded" || final.EffectiveModelKey == nil ||
		*final.EffectiveModelKey != "model-standard" || final.Usage == nil ||
		final.Usage.TotalTokens != 17 || final.QuotaState != "normal" || final.BudgetState != "warning" ||
		final.Replayed == nil || *final.Replayed {
		t.Fatalf("unexpected final event: %+v", final)
	}
	if usage.confirmedUsage.InputTokens != 12 || usage.confirmedUsage.OutputTokens != 5 {
		t.Fatalf("unexpected confirmed usage: %+v", usage.confirmedUsage)
	}
}

func TestServiceFailsClosedBeforeReservationForPendingStageTwoPolicies(t *testing.T) {
	snapshot := completionSnapshot()
	snapshot.Policies.Cache.Enabled = true
	usage := &fakeUsageAccounting{}
	providers := &fakeProviderExecutor{}
	service := New(&fakeSnapshotResolver{snapshot: snapshot}, usage, providers)

	if _, err := service.Prepare(context.Background(), completionRequest()); err != tenantchat.ErrRuntimeUnavailable {
		t.Fatalf("expected runtime unavailable, got %v", err)
	}
	if usage.reserveCalls != 0 || providers.calls != 0 {
		t.Fatalf("stage two policy must fail before side effects: reserve=%d provider=%d", usage.reserveCalls, providers.calls)
	}
}

func completionRequest() tenantchat.CompletionRequest {
	return tenantchat.CompletionRequest{
		Context: tenantchat.RequestContext{
			Surface: "tenant_chat", Phase: tenantchat.PhaseCompletion,
			RequestID: "request_completion_001", TurnID: "turn_completion_001",
			IdempotencyKey: "idempotency_completion_001",
			AdmissionID:    "f61d4fb4-b5ca-458a-999c-6a6069b9eb34",
			ExecutionScope: tenantchat.ExecutionScope{
				Kind: "tenant_chat", TenantID: "d51d8e63-4091-48a9-a807-f2603524456b",
				Actor:       tenantchat.Actor{UserID: "6ed1be1c-f665-4b91-bad4-b38744596f73", ActorKind: "tenant_admin"},
				QuotaScope:  tenantchat.ScopeReference{Type: "user", ID: "6ed1be1c-f665-4b91-bad4-b38744596f73"},
				BudgetScope: tenantchat.ScopeReference{Type: "tenant", ID: "d51d8e63-4091-48a9-a807-f2603524456b"},
			},
			Snapshot:      tenantchat.SnapshotReference{Version: 1, Digest: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", PolicyVersion: 1, EmployeeNoticeVersion: 1, PricingVersion: 1},
			BindingDigest: "hmac-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			UsageIntent:   &tenantchat.UsageIntent{EstimatedInputTokens: 12, MaxOutputTokens: 32, RequestedTier: "standard", CacheStrategy: "off"},
		},
		Input: tenantchat.CompletionInput{Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "안녕하세요"}}, Stream: true},
	}
}

func completionSnapshot() tenantruntime.Snapshot {
	return tenantruntime.Snapshot{
		Version: 1, TenantID: "d51d8e63-4091-48a9-a807-f2603524456b",
		Policies: tenantruntime.Policies{
			Cache:     tenantruntime.CachePolicy{Strategy: "off", Enabled: false, TTLSeconds: 300, MaxEntriesPerUser: 100},
			Safety:    tenantruntime.SafetyPolicy{Enabled: false, PolicyDigest: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},
			Streaming: tenantruntime.StreamingPolicy{Enabled: true, MaxDurationSeconds: 120, FinalEventRequired: true},
		},
	}
}

type fakeSnapshotResolver struct {
	snapshot tenantruntime.Snapshot
	err      error
}

func (f *fakeSnapshotResolver) Resolve(context.Context, tenantchat.RequestContext) (tenantruntime.Snapshot, error) {
	return f.snapshot, f.err
}

type fakeUsageAccounting struct {
	reservation tenantchat.UsageReservation
	settlement  tenantchat.UsageSettlement
	err         error

	reserveCalls      int
	startAttemptCalls int
	settleCalls       int
	confirmedUsage    tenantchat.ConfirmedUsage
}

func (f *fakeUsageAccounting) ConsumeAndReserve(context.Context, tenantchat.RequestContext, tenantruntime.Snapshot) (tenantchat.UsageReservation, error) {
	f.reserveCalls++
	return f.reservation, f.err
}

func (f *fakeUsageAccounting) StartAttempt(context.Context, tenantchat.RequestContext, tenantruntime.Snapshot, string, tenantchat.SelectedRoute, int, string) error {
	f.startAttemptCalls++
	return f.err
}

func (f *fakeUsageAccounting) FinalizeConfirmed(_ context.Context, _ tenantchat.RequestContext, _ string, _ int, usage tenantchat.ConfirmedUsage, _ string) (tenantchat.UsageSettlement, error) {
	f.settleCalls++
	f.confirmedUsage = usage
	return f.settlement, f.err
}

type fakeProviderExecutor struct {
	stream provider.ChatCompletionStreamReader
	err    error
	calls  int
}

func (f *fakeProviderExecutor) OpenStream(context.Context, tenantchat.RequestContext, tenantchat.SelectedRoute, tenantchat.CompletionInput) (provider.ChatCompletionStreamReader, error) {
	f.calls++
	return f.stream, f.err
}

type fakeStream struct {
	events []provider.ChatCompletionStreamEvent
	index  int
}

func (f *fakeStream) Next() (provider.ChatCompletionStreamEvent, error) {
	if f.index >= len(f.events) {
		return provider.ChatCompletionStreamEvent{}, io.EOF
	}
	event := f.events[f.index]
	f.index++
	return event, nil
}

func (f *fakeStream) Close() error { return nil }
