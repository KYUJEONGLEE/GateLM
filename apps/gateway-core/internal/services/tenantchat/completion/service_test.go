package completion

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"
	"time"

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
		{Data: json.RawMessage(`{"providerSpecific":"first"}`), Delta: "안녕"},
		{Data: json.RawMessage(`{"providerSpecific":"second"}`), Delta: "하세요"},
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

func TestServiceEmitsSafeFinalAndMarksMissingUsageUnconfirmed(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "reserved", QuotaState: "normal", BudgetState: "normal",
			Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider", ModelKey: "model-standard"},
		},
		settlement: tenantchat.UsageSettlement{
			State: "unconfirmed", QuotaState: "warning", BudgetState: "normal",
		},
	}
	providers := &fakeProviderExecutor{stream: &fakeStream{events: []provider.ChatCompletionStreamEvent{{Delta: "부분 응답"}}}}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, providers)
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
	if usage.unconfirmedCalls != 1 || usage.lastOutcome != "failed_post_delta" {
		t.Fatalf("missing usage was not marked unconfirmed: calls=%d outcome=%s", usage.unconfirmedCalls, usage.lastOutcome)
	}
	if len(events) != 2 || events[1].Type != tenantchat.CompletionEventFinal ||
		events[1].TerminalOutcome != "failed" || events[1].Usage == nil ||
		events[1].Usage.UsageQuality != "pending_unconfirmed" || events[1].Error == nil ||
		events[1].Error.Code != "CHAT_PROVIDER_FAILED" {
		t.Fatalf("unexpected safe final event: %+v", events)
	}
}

func TestServiceFallsBackBeforeDeltaAndSettlesAllConfirmedAttempts(t *testing.T) {
	snapshot := completionSnapshot()
	snapshot.Pricing = tenantruntime.Pricing{Version: 3, Routes: []tenantruntime.PriceRoute{
		{RouteID: "route_standard", ProviderID: "provider-primary", ModelKey: "model-standard", InputMicroUSDPerMillionTokens: 10, OutputMicroUSDPerMillionTokens: 20},
		{RouteID: "route_economy", ProviderID: "provider-fallback", ModelKey: "model-economy", InputMicroUSDPerMillionTokens: 5, OutputMicroUSDPerMillionTokens: 10},
	}}
	snapshot.Policies.Routing = tenantruntime.RoutingPolicy{Routes: []tenantruntime.RuntimeRoute{
		{RouteID: "route_standard", Tier: "standard", ProviderID: "provider-primary", ModelKey: "model-standard", Enabled: true},
		{RouteID: "route_economy", Tier: "economy", ProviderID: "provider-fallback", ModelKey: "model-economy", Enabled: true},
	}}
	snapshot.Policies.Fallback = tenantruntime.FallbackPolicy{
		Enabled: true, RouteIDs: []string{"route_economy"}, MaxAttempts: 2,
		AllowedReasons: []string{"provider_error_pre_delta"},
	}
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "reserved", QuotaState: "normal", BudgetState: "normal",
			Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider-primary", ModelKey: "model-standard"},
		},
		settlement: tenantchat.UsageSettlement{
			State: "settled", ConfirmedInputTokens: 20, ConfirmedOutputTokens: 4,
			QuotaState: "normal", BudgetState: "normal",
		},
	}
	providers := &fakeProviderExecutor{streams: []provider.ChatCompletionStreamReader{
		&fakeStream{
			events:      []provider.ChatCompletionStreamEvent{{Usage: &provider.Usage{PromptTokens: 8, CompletionTokens: 0, TotalTokens: 8}}},
			terminalErr: provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic primary failure")),
		},
		&fakeStream{events: []provider.ChatCompletionStreamEvent{
			{Delta: "fallback answer"},
			{Usage: &provider.Usage{PromptTokens: 12, CompletionTokens: 4, TotalTokens: 16}},
		}},
	}}
	service := New(&fakeSnapshotResolver{snapshot: snapshot}, usage, providers)
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
	if usage.recordCalls != 1 || usage.startAttemptCalls != 2 || usage.settleCalls != 1 || providers.calls != 2 {
		t.Fatalf("unexpected fallback calls: record=%d start=%d settle=%d provider=%d", usage.recordCalls, usage.startAttemptCalls, usage.settleCalls, providers.calls)
	}
	if len(events) != 2 || events[0].Delta != "fallback answer" || events[1].TerminalOutcome != "succeeded" ||
		events[1].EffectiveModelKey == nil || *events[1].EffectiveModelKey != "model-economy" {
		t.Fatalf("unexpected fallback events: %+v", events)
	}
}

func TestPreparedExecutionDoesNotFallbackAfterClientCancellation(t *testing.T) {
	snapshot := completionSnapshot()
	snapshot.Policies.Fallback = tenantruntime.FallbackPolicy{
		Enabled: true, RouteIDs: []string{"route_economy"}, MaxAttempts: 2,
		AllowedReasons: []string{"provider_error_pre_delta"},
	}
	execution := &PreparedExecution{snapshot: snapshot, attemptNo: 1}
	err := provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, context.Canceled)
	if execution.canFallback(err) {
		t.Fatal("client cancellation must not trigger a fallback attempt")
	}
}

func TestServiceReplaysTerminalSettlementWithoutProviderCall(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "settled", Replayed: true,
		},
		settlement: tenantchat.UsageSettlement{
			State: "settled", ConfirmedInputTokens: 10, ConfirmedOutputTokens: 3,
			QuotaState: "normal", BudgetState: "warning",
			Attempts: []tenantchat.ProviderAttempt{{AttemptNo: 1, ModelKey: "model-standard", Outcome: "succeeded", UsageQuality: "confirmed"}},
		},
	}
	providers := &fakeProviderExecutor{}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, providers)
	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare replay: %v", err)
	}
	if !execution.IsReplay() {
		t.Fatal("expected replay execution")
	}
	var final tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		final = event
		return nil
	}); err != nil {
		t.Fatalf("relay replay: %v", err)
	}
	if providers.calls != 0 || final.Replayed == nil || !*final.Replayed || final.TerminalOutcome != "succeeded" {
		t.Fatalf("unexpected terminal replay: providerCalls=%d final=%+v", providers.calls, final)
	}
}

func TestServiceReplaysTimeoutWithOriginalSafeError(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "unconfirmed", Replayed: true,
		},
		settlement: tenantchat.UsageSettlement{
			State: "unconfirmed", QuotaState: "normal", BudgetState: "normal",
			Attempts: []tenantchat.ProviderAttempt{{AttemptNo: 1, ModelKey: "model-standard", Outcome: "timed_out", UsageQuality: "pending_unconfirmed"}},
		},
	}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, &fakeProviderExecutor{})
	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare timeout replay: %v", err)
	}
	var final tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		final = event
		return nil
	}); err != nil {
		t.Fatalf("relay timeout replay: %v", err)
	}
	if final.TerminalOutcome != "failed" || final.Error == nil || final.Error.Code != "CHAT_PROVIDER_TIMEOUT" {
		t.Fatalf("unexpected timeout replay: %+v", final)
	}
}

func TestServiceReplaysCancellationWithOriginalSafeError(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "unconfirmed", Replayed: true,
		},
		settlement: tenantchat.UsageSettlement{
			State: "unconfirmed", QuotaState: "normal", BudgetState: "normal",
			Attempts: []tenantchat.ProviderAttempt{{AttemptNo: 1, ModelKey: "model-standard", Outcome: "cancelled", UsageQuality: "pending_unconfirmed"}},
		},
	}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, &fakeProviderExecutor{})
	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare cancelled replay: %v", err)
	}
	var final tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		final = event
		return nil
	}); err != nil {
		t.Fatalf("relay cancelled replay: %v", err)
	}
	if final.TerminalOutcome != "cancelled" || final.Error == nil || final.Error.Code != "CHAT_REQUEST_CANCELLED" {
		t.Fatalf("unexpected cancelled replay: %+v", final)
	}
}

func TestServiceAttachesInFlightReplayWithoutSecondProviderCall(t *testing.T) {
	baseReservation := tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
		State: "reserved", QuotaState: "normal", BudgetState: "normal",
		Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider", ModelKey: "model-standard"},
	}
	replayedReservation := baseReservation
	replayedReservation.Replayed = true
	usage := &fakeUsageAccounting{
		reservations: []tenantchat.UsageReservation{baseReservation, replayedReservation},
		settlement: tenantchat.UsageSettlement{
			State: "settled", ConfirmedInputTokens: 5, ConfirmedOutputTokens: 2,
			QuotaState: "normal", BudgetState: "normal",
		},
	}
	providers := &fakeProviderExecutor{stream: &fakeStream{events: []provider.ChatCompletionStreamEvent{
		{Delta: "공유 응답"},
		{Usage: &provider.Usage{PromptTokens: 5, CompletionTokens: 2, TotalTokens: 7}},
	}}}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, providers)
	owner, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare owner: %v", err)
	}
	attached, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare attached replay: %v", err)
	}
	if !attached.IsReplay() {
		t.Fatal("expected attached execution to be replayed")
	}
	if err := owner.Relay(context.Background(), func(tenantchat.CompletionEvent) error { return nil }); err != nil {
		t.Fatalf("relay owner: %v", err)
	}
	var attachedEvents []tenantchat.CompletionEvent
	if err := attached.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		attachedEvents = append(attachedEvents, event)
		return nil
	}); err != nil {
		t.Fatalf("relay attached replay: %v", err)
	}
	if providers.calls != 1 || len(attachedEvents) != 2 || attachedEvents[0].Delta != "공유 응답" ||
		attachedEvents[1].Replayed == nil || !*attachedEvents[1].Replayed {
		t.Fatalf("unexpected in-flight attach: providerCalls=%d events=%+v", providers.calls, attachedEvents)
	}
}

func TestServiceStreamsOneInFlightExecutionToOwnerAndAttachedRetry(t *testing.T) {
	baseReservation := tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
		State: "reserved", QuotaState: "normal", BudgetState: "normal",
		Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider", ModelKey: "model-standard"},
	}
	replayedReservation := baseReservation
	replayedReservation.Replayed = true
	usage := &fakeUsageAccounting{
		reservations: []tenantchat.UsageReservation{baseReservation, replayedReservation},
		settlement: tenantchat.UsageSettlement{
			State: "settled", ConfirmedInputTokens: 5, ConfirmedOutputTokens: 2,
			QuotaState: "normal", BudgetState: "normal",
		},
	}
	stream := &channelStream{events: make(chan streamResult, 2)}
	providers := &fakeProviderExecutor{stream: stream}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, providers)
	owner, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare owner: %v", err)
	}
	attached, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare attached retry: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ownerDelta := make(chan struct{}, 1)
	ownerDone := make(chan error, 1)
	go func() {
		ownerDone <- owner.Relay(ctx, func(event tenantchat.CompletionEvent) error {
			if event.Type == tenantchat.CompletionEventDelta {
				ownerDelta <- struct{}{}
			}
			return nil
		})
	}()
	stream.events <- streamResult{event: provider.ChatCompletionStreamEvent{Delta: "공유 응답"}}
	select {
	case <-ownerDelta:
	case <-ctx.Done():
		t.Fatal("owner did not receive the shared delta")
	}

	attachedEvents := make(chan tenantchat.CompletionEvent, 2)
	attachedDone := make(chan error, 1)
	go func() {
		attachedDone <- attached.Relay(ctx, func(event tenantchat.CompletionEvent) error {
			attachedEvents <- event
			return nil
		})
	}()
	select {
	case event := <-attachedEvents:
		if event.Delta != "공유 응답" {
			t.Fatalf("unexpected attached delta: %+v", event)
		}
	case <-ctx.Done():
		t.Fatal("attached retry did not receive the shared delta")
	}

	stream.events <- streamResult{event: provider.ChatCompletionStreamEvent{Usage: &provider.Usage{PromptTokens: 5, CompletionTokens: 2, TotalTokens: 7}}}
	close(stream.events)
	if err := <-ownerDone; err != nil {
		t.Fatalf("relay owner: %v", err)
	}
	if err := <-attachedDone; err != nil {
		t.Fatalf("relay attached retry: %v", err)
	}
	final := <-attachedEvents
	if providers.calls != 1 || final.Type != tenantchat.CompletionEventFinal || final.Replayed == nil || !*final.Replayed {
		t.Fatalf("unexpected shared execution: providerCalls=%d final=%+v", providers.calls, final)
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
	reservation  tenantchat.UsageReservation
	reservations []tenantchat.UsageReservation
	settlement   tenantchat.UsageSettlement
	err          error

	reserveCalls      int
	startAttemptCalls int
	settleCalls       int
	recordCalls       int
	releasedCalls     int
	unconfirmedCalls  int
	confirmedUsage    tenantchat.ConfirmedUsage
	lastOutcome       string
}

func (f *fakeUsageAccounting) BeginExecution(context.Context, tenantchat.RequestContext, tenantruntime.Snapshot) (tenantchat.UsageReservation, error) {
	index := f.reserveCalls
	f.reserveCalls++
	f.startAttemptCalls++
	if index < len(f.reservations) {
		return f.reservations[index], f.err
	}
	return f.reservation, f.err
}

func (f *fakeUsageAccounting) BeginFallback(
	context.Context,
	tenantchat.RequestContext,
	tenantruntime.Snapshot,
	string,
	int,
	tenantchat.ConfirmedUsage,
	string,
	tenantchat.SelectedRoute,
	int,
) error {
	f.startAttemptCalls++
	f.recordCalls++
	return f.err
}

func (f *fakeUsageAccounting) FinalizeConfirmed(_ context.Context, _ tenantchat.RequestContext, _ string, _ int, usage tenantchat.ConfirmedUsage, _ string) (tenantchat.UsageSettlement, error) {
	f.settleCalls++
	f.confirmedUsage = usage
	return f.settlement, f.err
}

func (f *fakeUsageAccounting) FinalizeRecordedAttempts(context.Context, tenantchat.RequestContext, string) (tenantchat.UsageSettlement, error) {
	f.settleCalls++
	return f.settlement, f.err
}

func (f *fakeUsageAccounting) FinalizeReleased(context.Context, tenantchat.RequestContext, string, string) (tenantchat.UsageSettlement, error) {
	f.releasedCalls++
	return f.settlement, f.err
}

func (f *fakeUsageAccounting) FinalizeUnconfirmed(_ context.Context, _ tenantchat.RequestContext, _ string, _ int, outcome string) (tenantchat.UsageSettlement, error) {
	f.settleCalls++
	f.unconfirmedCalls++
	f.lastOutcome = outcome
	return f.settlement, f.err
}

func (f *fakeUsageAccounting) ReadTerminal(context.Context, tenantchat.RequestContext, string) (tenantchat.UsageSettlement, error) {
	return f.settlement, f.err
}

type fakeProviderExecutor struct {
	stream  provider.ChatCompletionStreamReader
	streams []provider.ChatCompletionStreamReader
	errors  []error
	err     error
	calls   int
}

func (f *fakeProviderExecutor) OpenStream(context.Context, tenantchat.RequestContext, tenantchat.SelectedRoute, tenantchat.CompletionInput) (provider.ChatCompletionStreamReader, error) {
	index := f.calls
	f.calls++
	if index < len(f.streams) {
		var err error
		if index < len(f.errors) {
			err = f.errors[index]
		}
		return f.streams[index], err
	}
	return f.stream, f.err
}

type fakeStream struct {
	events      []provider.ChatCompletionStreamEvent
	index       int
	terminalErr error
}

func (f *fakeStream) Next() (provider.ChatCompletionStreamEvent, error) {
	if f.index >= len(f.events) {
		if f.terminalErr != nil {
			err := f.terminalErr
			f.terminalErr = nil
			return provider.ChatCompletionStreamEvent{}, err
		}
		return provider.ChatCompletionStreamEvent{}, io.EOF
	}
	event := f.events[f.index]
	f.index++
	return event, nil
}

func (f *fakeStream) Close() error { return nil }

type streamResult struct {
	event provider.ChatCompletionStreamEvent
	err   error
}

type channelStream struct {
	events chan streamResult
}

func (s *channelStream) Next() (provider.ChatCompletionStreamEvent, error) {
	result, ok := <-s.events
	if !ok {
		return provider.ChatCompletionStreamEvent{}, io.EOF
	}
	return result.event, result.err
}

func (s *channelStream) Close() error { return nil }
