package completion

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync/atomic"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/routing"
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
	if got := usage.transactionCalls(); got != 3 {
		t.Fatalf("primary confirmed transaction budget exceeded: got %d want 3", got)
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

func TestServiceAppliesRoutingV2BeforeUsageReservation(t *testing.T) {
	snapshot := completionRoutingSnapshot()
	usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
		RequestID:     "request_completion_001",
		State:         "reserved",
		Route: tenantchat.SelectedRoute{
			RouteID: "route_cheap", ProviderID: "provider-openai", ModelKey: "gpt-mini",
		},
	}}
	service := New(
		&fakeSnapshotResolver{snapshot: snapshot},
		usage,
		&fakeProviderExecutor{stream: &fakeStream{}},
	)
	request := completionRequest()
	request.Input.Messages = []tenantchat.EphemeralMessage{{Role: "user", Content: "Hello"}}

	execution, err := service.Prepare(context.Background(), request)
	if err != nil {
		t.Fatalf("prepare routed completion: %v", err)
	}
	defer execution.Close()
	if usage.lastContext.Routing == nil {
		t.Fatal("routing decision must be attached before usage reservation")
	}
	decision := usage.lastContext.Routing
	if decision.ModelRef != "tc_cheap" || decision.Category != "general" || decision.Difficulty != "simple" {
		t.Fatalf("unexpected routing decision: %+v", decision)
	}
}

func TestServiceUsesSemanticDifficultyAcrossTenantChatRoutingMatrix(t *testing.T) {
	snapshot := completionDistinctRoutingSnapshot()
	evaluation := &fakeDifficultySemanticEvaluation{result: routing.DifficultySemanticShadowResult{
		Status: routing.DifficultySemanticShadowReady,
		Difficulty: routing.DifficultyResult{
			Difficulty: routing.DifficultyComplex,
		},
	}}
	runtime := routing.NewDifficultySemanticRuntime(evaluation, 50*time.Millisecond)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })

	tests := []struct {
		name         string
		prompt       string
		wantCategory string
		wantModelRef string
	}{
		{name: "general", prompt: "Explain OAuth briefly.", wantCategory: routing.CategoryGeneral, wantModelRef: "general_complex"},
		{name: "code", prompt: "Fix this TypeScript function error.", wantCategory: routing.CategoryCode, wantModelRef: "code_complex"},
		{name: "translation", prompt: "Translate this sentence to Korean.", wantCategory: routing.CategoryTranslation, wantModelRef: "translation_complex"},
		{name: "summarization", prompt: "Summarize this report into key points.", wantCategory: routing.CategorySummarization, wantModelRef: "summarization_complex"},
		{name: "reasoning", prompt: "Compare these options and recommend one with tradeoffs.", wantCategory: routing.CategoryReasoning, wantModelRef: "reasoning_complex"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
				ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
				RequestID:     "request_completion_001",
				State:         "reserved",
				Route: tenantchat.SelectedRoute{
					RouteID: "route_selected", ProviderID: "provider-selected", ModelKey: "model-selected",
				},
			}}
			service := New(
				&fakeSnapshotResolver{snapshot: snapshot},
				usage,
				&fakeProviderExecutor{stream: &fakeStream{}},
				WithDifficultySemanticRuntime(runtime),
			)
			request := completionRequest()
			request.Input.Messages = []tenantchat.EphemeralMessage{{Role: "user", Content: test.prompt}}

			execution, err := service.Prepare(context.Background(), request)
			if err != nil {
				t.Fatalf("prepare semantic routed completion: %v", err)
			}
			defer execution.Close()
			decision := usage.lastContext.Routing
			if decision == nil || decision.Category != test.wantCategory ||
				decision.Difficulty != routing.DifficultyComplex || decision.ModelRef != test.wantModelRef {
				t.Fatalf("semantic matrix route mismatch: got %+v, want category=%s modelRef=%s", decision, test.wantCategory, test.wantModelRef)
			}
		})
	}
	if got := evaluation.calls.Load(); got != int32(len(tests)) {
		t.Fatalf("semantic evaluations = %d, want %d", got, len(tests))
	}
}

func TestServiceFallsBackToRuleDifficultyWhenSemanticRuntimeIsNotReady(t *testing.T) {
	evaluation := &fakeDifficultySemanticEvaluation{result: routing.DifficultySemanticShadowResult{
		Status: routing.DifficultySemanticShadowInferenceFailed,
	}}
	runtime := routing.NewDifficultySemanticRuntime(evaluation, 50*time.Millisecond)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })
	usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
		RequestID:     "request_completion_001",
		State:         "reserved",
		Route: tenantchat.SelectedRoute{
			RouteID: "route_cheap", ProviderID: "provider-openai", ModelKey: "gpt-mini",
		},
	}}
	service := New(
		&fakeSnapshotResolver{snapshot: completionRoutingSnapshot()},
		usage,
		&fakeProviderExecutor{stream: &fakeStream{}},
		WithDifficultySemanticRuntime(runtime),
	)
	request := completionRequest()
	request.Input.Messages = []tenantchat.EphemeralMessage{{Role: "user", Content: "Explain OAuth briefly."}}

	execution, err := service.Prepare(context.Background(), request)
	if err != nil {
		t.Fatalf("prepare fallback routed completion: %v", err)
	}
	defer execution.Close()
	decision := usage.lastContext.Routing
	if decision == nil || decision.ModelRef != "tc_cheap" || decision.Difficulty != routing.DifficultySimple {
		t.Fatalf("rule fallback route mismatch: %+v", decision)
	}
}

func TestServiceSkipsSemanticRuntimeForTenantChatManualRoute(t *testing.T) {
	snapshot := completionRoutingSnapshot()
	snapshot.Policies.Routing.Policy.Mode = routing.RoutingPolicyModeManual
	evaluation := &fakeDifficultySemanticEvaluation{result: routing.DifficultySemanticShadowResult{
		Status: routing.DifficultySemanticShadowReady,
		Difficulty: routing.DifficultyResult{
			Difficulty: routing.DifficultyComplex,
		},
	}}
	runtime := routing.NewDifficultySemanticRuntime(evaluation, 50*time.Millisecond)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })
	usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
		RequestID:     "request_completion_001",
		State:         "reserved",
		Route: tenantchat.SelectedRoute{
			RouteID: "route_premium", ProviderID: "provider-anthropic", ModelKey: "claude",
		},
	}}
	service := New(
		&fakeSnapshotResolver{snapshot: snapshot},
		usage,
		&fakeProviderExecutor{stream: &fakeStream{}},
		WithDifficultySemanticRuntime(runtime),
	)

	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare manual routed completion: %v", err)
	}
	defer execution.Close()
	decision := usage.lastContext.Routing
	if decision == nil || decision.ModelRef != "tc_premium" || evaluation.calls.Load() != 0 {
		t.Fatalf("manual route used semantic runtime: decision=%+v evaluations=%d", decision, evaluation.calls.Load())
	}
}

func TestServiceManualRoutingIncludesSharedFallbackCandidate(t *testing.T) {
	snapshot := completionRoutingSnapshot()
	sharedCell := tenantruntime.RoutingCell{ModelRefs: []string{"tc_premium", "tc_cheap"}}
	sharedDifficulty := tenantruntime.RoutingDifficulty{
		Simple:  sharedCell,
		Complex: sharedCell,
	}
	snapshot.Policies.Routing.Policy.Mode = "manual"
	snapshot.Policies.Routing.Policy.Routes = tenantruntime.RoutingMatrix{
		General:       sharedDifficulty,
		Code:          sharedDifficulty,
		Translation:   sharedDifficulty,
		Summarization: sharedDifficulty,
		Reasoning:     sharedDifficulty,
	}
	snapshot.Policies.Routing.ManualModelRef = "tc_premium"
	snapshot.Policies.Fallback = tenantruntime.FallbackPolicy{
		Enabled:        true,
		MaxAttempts:    2,
		AllowedReasons: []string{"provider_timeout", "provider_error_pre_delta"},
	}
	usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
		RequestID:     "request_completion_001",
		State:         "reserved",
		Route: tenantchat.SelectedRoute{
			RouteID: "route_premium", ProviderID: "provider-anthropic", ModelKey: "claude",
		},
	}}
	service := New(
		&fakeSnapshotResolver{snapshot: snapshot},
		usage,
		&fakeProviderExecutor{stream: &fakeStream{}},
	)
	request := completionRequest()
	request.Input.Messages = []tenantchat.EphemeralMessage{{Role: "user", Content: "Hello"}}

	execution, err := service.Prepare(context.Background(), request)
	if err != nil {
		t.Fatalf("prepare manual routed completion: %v", err)
	}
	defer execution.Close()
	if usage.lastContext.Routing == nil {
		t.Fatal("manual routing decision must be attached before usage reservation")
	}
	decision := usage.lastContext.Routing
	if decision.ModelRef != "tc_premium" || len(decision.CandidateModelRefs) != 2 ||
		decision.CandidateModelRefs[0] != "tc_premium" || decision.CandidateModelRefs[1] != "tc_cheap" {
		t.Fatalf("unexpected manual fallback candidates: %+v", decision)
	}
}

func TestSharedTenantChatFallbackModelRefsRejectsCellsWithoutFallback(t *testing.T) {
	sharedCell := tenantruntime.RoutingCell{ModelRefs: []string{"tc_primary", "tc_fallback"}}
	sharedDifficulty := tenantruntime.RoutingDifficulty{Simple: sharedCell, Complex: sharedCell}

	tests := []struct {
		name   string
		routes tenantruntime.RoutingMatrix
	}{
		{name: "empty matrix", routes: tenantruntime.RoutingMatrix{}},
		{
			name: "later cell has no fallback",
			routes: tenantruntime.RoutingMatrix{
				General: sharedDifficulty,
				Code: tenantruntime.RoutingDifficulty{
					Simple:  tenantruntime.RoutingCell{ModelRefs: []string{"tc_primary"}},
					Complex: sharedCell,
				},
				Translation:   sharedDifficulty,
				Summarization: sharedDifficulty,
				Reasoning:     sharedDifficulty,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sharedTenantChatFallbackModelRefs(test.routes, "tc_manual"); got != nil {
				t.Fatalf("expected no shared fallback, got %v", got)
			}
		})
	}
}

func TestServiceRoutesAnExistingConversationByTheLatestUserMessage(t *testing.T) {
	snapshot := completionRoutingSnapshot()
	usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
		RequestID:     "request_completion_001",
		State:         "reserved",
		Route: tenantchat.SelectedRoute{
			RouteID: "route_cheap", ProviderID: "provider-openai", ModelKey: "gpt-mini",
		},
	}}
	providers := &fakeProviderExecutor{stream: &fakeStream{}}
	service := New(&fakeSnapshotResolver{snapshot: snapshot}, usage, providers)
	request := completionRequest()
	request.Input.Messages = []tenantchat.EphemeralMessage{
		{Role: "user", Content: "Debug a race condition across multiple files, refactor the architecture, and preserve performance."},
		{Role: "assistant", Content: "Here is the detailed architecture analysis."},
		{Role: "user", Content: "Hello"},
	}

	execution, err := service.Prepare(context.Background(), request)
	if err != nil {
		t.Fatalf("prepare routed conversation: %v", err)
	}
	defer execution.Close()
	if usage.lastContext.Routing == nil {
		t.Fatal("routing decision must be attached before usage reservation")
	}
	decision := usage.lastContext.Routing
	if decision.ModelRef != "tc_cheap" || decision.Category != "general" || decision.Difficulty != "simple" {
		t.Fatalf("latest user message must determine the route: %+v", decision)
	}
	if len(providers.lastInput.Messages) != len(request.Input.Messages) {
		t.Fatalf("provider input lost conversation history: got %d messages, want %d", len(providers.lastInput.Messages), len(request.Input.Messages))
	}
}

func TestServiceFailsClosedBeforeReservationWhenExactCacheAdapterIsMissing(t *testing.T) {
	snapshot := completionSnapshot()
	snapshot.Policies.Cache.Enabled = true
	snapshot.Policies.Cache.Strategy = "exact"
	usage := &fakeUsageAccounting{}
	providers := &fakeProviderExecutor{}
	service := New(&fakeSnapshotResolver{snapshot: snapshot}, usage, providers)

	request := completionRequest()
	request.Context.UsageIntent.CacheStrategy = "exact"
	if _, err := service.Prepare(context.Background(), request); err != tenantchat.ErrRuntimeUnavailable {
		t.Fatalf("expected runtime unavailable, got %v", err)
	}
	if usage.reserveCalls != 0 || providers.calls != 0 {
		t.Fatalf("stage two policy must fail before side effects: reserve=%d provider=%d", usage.reserveCalls, providers.calls)
	}
}

func TestServiceReturnsEncryptedExactCacheHitWithoutReservationOrProvider(t *testing.T) {
	snapshot := completionSnapshot()
	snapshot.Policies.Cache = tenantruntime.CachePolicy{
		Strategy: "exact", Enabled: true, TTLSeconds: 300, MaxEntriesPerUser: 100, KeySetID: "keys_001",
	}
	usage := &fakeUsageAccounting{}
	cache := &fakeExactCache{entry: tenantchat.ExactCacheEntry{
		ResponseText: "cached synthetic response", EffectiveModelKey: "model-cached",
	}, hit: true}
	providers := &fakeProviderExecutor{}
	service := New(
		&fakeSnapshotResolver{snapshot: snapshot}, usage, providers,
		WithExactCache(cache),
	)
	request := completionRequest()
	request.Context.UsageIntent.CacheStrategy = "exact"
	execution, err := service.Prepare(context.Background(), request)
	if err != nil {
		t.Fatalf("prepare cache hit: %v", err)
	}
	var events []tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatalf("relay cache hit: %v", err)
	}
	if usage.reserveCalls != 0 || usage.ledgerlessCalls != 1 || providers.calls != 0 || len(events) != 2 ||
		events[1].CacheOutcome != "hit" || events[1].Usage == nil || events[1].Usage.TotalTokens != 0 {
		t.Fatalf("unexpected cache hit path: usage=%+v provider=%d events=%+v", usage, providers.calls, events)
	}
	if got := usage.transactionCalls(); got != 1 {
		t.Fatalf("cache-hit transaction budget exceeded: got %d want 1", got)
	}
}

func TestServiceSafetyBlockConsumesAdmissionWithoutReservation(t *testing.T) {
	snapshot := completionSnapshot()
	snapshot.Policies.Safety = tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: "sha256:synthetic",
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "api_key", Action: "block"}},
	}
	usage := &fakeUsageAccounting{}
	providers := &fakeProviderExecutor{}
	service := New(
		&fakeSnapshotResolver{snapshot: snapshot}, usage, providers,
		WithSafetyEvaluator(&fakeSafetyEvaluator{result: tenantchat.SafetyEvaluation{Blocked: true}}),
	)
	if _, err := service.Prepare(context.Background(), completionRequest()); !errors.Is(err, tenantchat.ErrSafetyBlocked) {
		t.Fatalf("expected safety block, got %v", err)
	}
	if usage.reserveCalls != 0 || usage.ledgerlessCalls != 1 || providers.calls != 0 {
		t.Fatalf("unexpected safety block side effects: usage=%+v provider=%d", usage, providers.calls)
	}
	if got := usage.transactionCalls(); got != 1 {
		t.Fatalf("safety-block transaction budget exceeded: got %d want 1", got)
	}
}

func TestServiceProviderTokenGateRunsAfterReservationBeforeProvider(t *testing.T) {
	snapshot := completionSnapshot()
	snapshot.Policies.ProviderTokenRate = tenantruntime.ProviderTokenRatePolicy{Providers: []tenantruntime.ProviderTokenWindow{{
		ProviderID: "provider", LimitTokens: 40, WindowSeconds: 60,
	}}}
	usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", State: "reserved",
		Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider", ModelKey: "model-standard"},
	}}
	providers := &fakeProviderExecutor{}
	service := New(
		&fakeSnapshotResolver{snapshot: snapshot}, usage, providers,
		WithProviderTokenLimiter(&fakeTokenLimiter{decision: tenantchat.ProviderTokenRateDecision{Allowed: false}}),
	)
	if _, err := service.Prepare(context.Background(), completionRequest()); !errors.Is(err, tenantchat.ErrRateLimited) {
		t.Fatalf("expected provider token limit, got %v", err)
	}
	if usage.reserveCalls != 1 || usage.preCallCalls != 1 || providers.calls != 0 {
		t.Fatalf("unexpected token gate ordering: usage=%+v provider=%d", usage, providers.calls)
	}
}

func TestServicePreCallProviderFailureReleasesWithoutPendingExposure(t *testing.T) {
	usage := &fakeUsageAccounting{reservation: tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", State: "reserved",
		Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider", ModelKey: "model-standard"},
	}}
	providerErr := provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic pre-call failure"))
	providers := &fakeProviderExecutor{err: providerErr, status: tenantchat.ProviderCallNotStarted}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, providers)
	if _, err := service.Prepare(context.Background(), completionRequest()); !errors.Is(err, providerErr) {
		t.Fatalf("expected provider error, got %v", err)
	}
	if usage.preCallCalls != 1 || usage.unconfirmedCalls != 0 {
		t.Fatalf("pre-call failure accounting mismatch: preCall=%d pending=%d", usage.preCallCalls, usage.unconfirmedCalls)
	}
}

func TestServiceMarksProviderDispatchBeforeRelaying(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", State: "reserved",
			Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider", ModelKey: "model-standard"},
		},
		dispatchErr: errors.New("synthetic dispatch persistence failure"),
	}
	stream := &fakeStream{}
	providers := &fakeProviderExecutor{stream: stream}
	service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, providers)

	if _, err := service.Prepare(context.Background(), completionRequest()); !errors.Is(err, tenantchat.ErrUsageGuardUnavailable) {
		t.Fatalf("expected usage guard unavailable, got %v", err)
	}
	if usage.dispatchCalls != 1 || usage.unconfirmedCalls != 1 || usage.lastOutcome != "failed_pre_delta" {
		t.Fatalf("dispatch failure accounting mismatch: usage=%+v", usage)
	}
	if stream.closeCalls != 1 {
		t.Fatalf("provider stream must close when dispatch persistence fails: got %d", stream.closeCalls)
	}
}

func TestServiceEmitsSafeFinalAndKeepsMissingUsagePending(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "reserved", QuotaState: "normal", BudgetState: "normal",
			Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider", ModelKey: "model-standard"},
		},
		settlement: tenantchat.UsageSettlement{
			State: "pending_unconfirmed", QuotaState: "warning", BudgetState: "normal",
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
	snapshot := fallbackCompletionSnapshot()
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
	if got := usage.transactionCalls(); got != 5 {
		t.Fatalf("fallback confirmed transaction budget exceeded: got %d want 5", got)
	}
	if len(events) != 2 || events[0].Delta != "fallback answer" || events[1].TerminalOutcome != "succeeded" ||
		events[1].EffectiveModelKey == nil || *events[1].EffectiveModelKey != "model-economy" {
		t.Fatalf("unexpected fallback events: %+v", events)
	}
}

func TestServiceSkipsRestrictedFallbackAndUsesNextLowerCostRoute(t *testing.T) {
	snapshot := fallbackCompletionSnapshot()
	highRoute := tenantruntime.PriceRoute{
		RouteID: "route_high", ProviderID: "provider-high", ModelKey: "model-high",
		InputMicroUSDPerMillionTokens: 20, OutputMicroUSDPerMillionTokens: 40,
	}
	snapshot.Pricing.Routes = append(snapshot.Pricing.Routes, highRoute)
	snapshot.Policies.Routing.Routes = append(snapshot.Policies.Routing.Routes, tenantruntime.RuntimeRoute{
		RouteID: "route_high", Tier: "high_quality", ProviderID: "provider-high", ModelKey: "model-high", Enabled: true,
	})
	snapshot.Policies.Fallback.RouteIDs = []string{"route_high", "route_economy"}

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
		restrictions: []bool{true, false},
	}
	providers := &fakeProviderExecutor{streams: []provider.ChatCompletionStreamReader{
		&fakeStream{
			events:      []provider.ChatCompletionStreamEvent{{Usage: &provider.Usage{PromptTokens: 8, TotalTokens: 8}}},
			terminalErr: provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic primary failure")),
		},
		&fakeStream{events: []provider.ChatCompletionStreamEvent{
			{Delta: "lower-cost fallback"},
			{Usage: &provider.Usage{PromptTokens: 12, CompletionTokens: 4, TotalTokens: 16}},
		}},
	}}
	service := New(&fakeSnapshotResolver{snapshot: snapshot}, usage, providers)
	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare restricted fallback: %v", err)
	}
	var events []tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatalf("relay restricted fallback: %v", err)
	}

	if providers.calls != 2 || len(providers.routes) != 2 || providers.routes[1].RouteID != "route_economy" {
		t.Fatalf("restricted route must not reach provider: routes=%+v", providers.routes)
	}
	if usage.recordCalls != 2 || usage.dispatchCalls != 2 || usage.transactionCalls() != 6 {
		t.Fatalf("restricted fallback accounting mismatch: usage=%+v", usage)
	}
	if len(events) != 2 || events[1].EffectiveModelKey == nil || *events[1].EffectiveModelKey != "model-economy" {
		t.Fatalf("unexpected restricted fallback events: %+v", events)
	}
}

func TestServiceSettlesCurrentAttemptWhenFallbackTopUpFails(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "reserved", QuotaState: "normal", BudgetState: "normal",
			Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider-primary", ModelKey: "model-standard"},
		},
		settlement: tenantchat.UsageSettlement{
			State: "settled", ConfirmedInputTokens: 8, QuotaState: "normal", BudgetState: "blocked",
		},
		fallbackErr: tenantchat.ErrBudgetHardLimit,
	}
	providers := &fakeProviderExecutor{stream: &fakeStream{
		events:      []provider.ChatCompletionStreamEvent{{Usage: &provider.Usage{PromptTokens: 8, TotalTokens: 8}}},
		terminalErr: provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic primary failure")),
	}}
	service := New(&fakeSnapshotResolver{snapshot: fallbackCompletionSnapshot()}, usage, providers)
	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare fallback top-up failure: %v", err)
	}
	var events []tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatalf("relay fallback top-up failure: %v", err)
	}
	if usage.settleCalls != 1 || providers.calls != 1 || usage.transactionCalls() != 4 {
		t.Fatalf("fallback top-up failure accounting mismatch: usage=%+v provider=%d", usage, providers.calls)
	}
	if len(events) != 1 || events[0].Error == nil || events[0].Error.Code != "CHAT_BUDGET_HARD_LIMIT" {
		t.Fatalf("unexpected fallback top-up terminal event: %+v", events)
	}
}

func TestServiceSettlesConfirmedUsageWhenFallbackAccountingIsUnavailableAfterCancellation(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "reserved", QuotaState: "normal", BudgetState: "normal",
			Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider-primary", ModelKey: "model-standard"},
		},
		settlement: tenantchat.UsageSettlement{
			State: "settled", ConfirmedInputTokens: 8, QuotaState: "normal", BudgetState: "normal",
		},
		fallbackErr: tenantchat.ErrUsageGuardUnavailable,
	}
	relayCtx, cancel := context.WithCancel(context.Background())
	providers := &fakeProviderExecutor{stream: &fakeStream{
		events:      []provider.ChatCompletionStreamEvent{{Usage: &provider.Usage{PromptTokens: 8, TotalTokens: 8}}},
		terminalErr: provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic primary failure")),
		onTerminal:  cancel,
	}}
	service := New(&fakeSnapshotResolver{snapshot: fallbackCompletionSnapshot()}, usage, providers)
	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare fallback accounting failure: %v", err)
	}
	var events []tenantchat.CompletionEvent
	if err := execution.Relay(relayCtx, func(event tenantchat.CompletionEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatalf("relay fallback accounting failure: %v", err)
	}
	if usage.fallbackContextErr != nil || usage.settleCalls != 1 ||
		usage.confirmedUsage.InputTokens != 8 || usage.transactionCalls() != 4 {
		t.Fatalf("confirmed fallback failure accounting mismatch: %+v", usage)
	}
	if len(events) != 1 || events[0].Usage == nil || events[0].Usage.UsageQuality != "confirmed" {
		t.Fatalf("unexpected fallback accounting failure event: %+v", events)
	}
}

func TestServiceUsesFallbackPreCallSettlementWithoutFourthTransaction(t *testing.T) {
	usage := &fakeUsageAccounting{
		reservation: tenantchat.UsageReservation{
			ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15", RequestID: "request_completion_001",
			State: "reserved", QuotaState: "normal", BudgetState: "normal",
			Route: tenantchat.SelectedRoute{RouteID: "route_standard", ProviderID: "provider-primary", ModelKey: "model-standard"},
		},
		settlement: tenantchat.UsageSettlement{
			State: "settled", ConfirmedInputTokens: 8, QuotaState: "normal", BudgetState: "normal",
		},
	}
	providers := &fakeProviderExecutor{
		streams: []provider.ChatCompletionStreamReader{
			&fakeStream{
				events:      []provider.ChatCompletionStreamEvent{{Usage: &provider.Usage{PromptTokens: 8, TotalTokens: 8}}},
				terminalErr: provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic primary failure")),
			},
			nil,
		},
		errors: []error{nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic pre-call failure"))},
		statuses: []tenantchat.ProviderCallStartStatus{
			tenantchat.ProviderCallStartedOrUnknown,
			tenantchat.ProviderCallNotStarted,
		},
	}
	service := New(&fakeSnapshotResolver{snapshot: fallbackCompletionSnapshot()}, usage, providers)
	execution, err := service.Prepare(context.Background(), completionRequest())
	if err != nil {
		t.Fatalf("prepare fallback pre-call failure: %v", err)
	}
	var events []tenantchat.CompletionEvent
	if err := execution.Relay(context.Background(), func(event tenantchat.CompletionEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatalf("relay fallback pre-call failure: %v", err)
	}
	if usage.preCallCalls != 1 || usage.settleCalls != 0 || providers.calls != 2 || usage.transactionCalls() != 4 {
		t.Fatalf("fallback pre-call transaction budget mismatch: usage=%+v provider=%d", usage, providers.calls)
	}
	if len(events) != 1 || events[0].Error == nil || events[0].Error.Code != "CHAT_PROVIDER_FAILED" {
		t.Fatalf("unexpected fallback pre-call terminal event: %+v", events)
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

func fallbackCompletionSnapshot() tenantruntime.Snapshot {
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
	return snapshot
}

func completionRoutingSnapshot() tenantruntime.Snapshot {
	snapshot := completionSnapshot()
	cheap := tenantruntime.RoutingCell{ModelRefs: []string{"tc_cheap"}}
	premium := tenantruntime.RoutingCell{ModelRefs: []string{"tc_premium"}}
	difficulty := tenantruntime.RoutingDifficulty{Simple: cheap, Complex: premium}
	snapshot.Policies.Routing = tenantruntime.RoutingPolicy{
		Routes: []tenantruntime.RuntimeRoute{
			{RouteID: "route_cheap", ModelRef: "tc_cheap", ProviderID: "provider-openai", ModelKey: "gpt-mini", Enabled: true},
			{RouteID: "route_premium", ModelRef: "tc_premium", ProviderID: "provider-anthropic", ModelKey: "claude", Enabled: true},
		},
		Policy: &tenantruntime.RoutingPolicyV2Bridge{
			SchemaVersion:     "gatelm.routing-policy.v2",
			Mode:              "auto",
			BootstrapState:    "configured",
			RoutingPolicyHash: "sha256:919261eed2c088bafd316ea0e7f6f8746c332f3ef7766cc5fa97dfe269aec91c",
			Routes: tenantruntime.RoutingMatrix{
				General: difficulty, Code: difficulty, Translation: difficulty,
				Summarization: difficulty, Reasoning: difficulty,
			},
		},
		ManualModelRef: "tc_premium",
	}
	return snapshot
}

func completionDistinctRoutingSnapshot() tenantruntime.Snapshot {
	snapshot := completionRoutingSnapshot()
	cell := func(modelRef string) tenantruntime.RoutingCell {
		return tenantruntime.RoutingCell{ModelRefs: []string{modelRef}}
	}
	difficulty := func(category string) tenantruntime.RoutingDifficulty {
		return tenantruntime.RoutingDifficulty{
			Simple:  cell(category + "_simple"),
			Complex: cell(category + "_complex"),
		}
	}
	snapshot.Policies.Routing.Policy.Routes = tenantruntime.RoutingMatrix{
		General:       difficulty(routing.CategoryGeneral),
		Code:          difficulty(routing.CategoryCode),
		Translation:   difficulty(routing.CategoryTranslation),
		Summarization: difficulty(routing.CategorySummarization),
		Reasoning:     difficulty(routing.CategoryReasoning),
	}
	return snapshot
}

type fakeSnapshotResolver struct {
	snapshot tenantruntime.Snapshot
	err      error
}

type fakeSafetyEvaluator struct {
	result tenantchat.SafetyEvaluation
	err    error
}

type fakeDifficultySemanticEvaluation struct {
	result routing.DifficultySemanticShadowResult
	calls  atomic.Int32
}

func (f *fakeDifficultySemanticEvaluation) Evaluate(
	context.Context,
	routing.PromptFeatures,
	string,
) routing.DifficultySemanticShadowResult {
	f.calls.Add(1)
	return f.result
}

func (f *fakeDifficultySemanticEvaluation) Close() error { return nil }

func (f *fakeSafetyEvaluator) Evaluate(context.Context, tenantruntime.Snapshot, tenantchat.CompletionInput) (tenantchat.SafetyEvaluation, error) {
	return f.result, f.err
}

type fakeExactCache struct {
	entry tenantchat.ExactCacheEntry
	hit   bool
	err   error
}

func (f *fakeExactCache) Get(context.Context, tenantchat.RequestContext, tenantruntime.Snapshot, tenantchat.CompletionInput) (tenantchat.ExactCacheEntry, bool, error) {
	return f.entry, f.hit, f.err
}

func (f *fakeExactCache) Put(context.Context, tenantchat.RequestContext, tenantruntime.Snapshot, tenantchat.CompletionInput, tenantchat.ExactCacheEntry) error {
	return f.err
}

type fakeTokenLimiter struct {
	decision tenantchat.ProviderTokenRateDecision
	err      error
}

func (f *fakeTokenLimiter) Check(context.Context, tenantchat.RequestContext, tenantruntime.Snapshot, tenantchat.SelectedRoute) (tenantchat.ProviderTokenRateDecision, error) {
	return f.decision, f.err
}

func (f *fakeSnapshotResolver) Resolve(context.Context, tenantchat.RequestContext) (tenantruntime.Snapshot, error) {
	return f.snapshot, f.err
}

type fakeUsageAccounting struct {
	reservation        tenantchat.UsageReservation
	reservations       []tenantchat.UsageReservation
	settlement         tenantchat.UsageSettlement
	err                error
	fallbackErr        error
	fallbackContextErr error
	dispatchErr        error
	restrictions       []bool
	lastContext        tenantchat.RequestContext

	reserveCalls      int
	startAttemptCalls int
	dispatchCalls     int
	settleCalls       int
	recordCalls       int
	releasedCalls     int
	unconfirmedCalls  int
	ledgerlessCalls   int
	preCallCalls      int
	confirmedUsage    tenantchat.ConfirmedUsage
	lastOutcome       string
}

func (f *fakeUsageAccounting) transactionCalls() int {
	return f.reserveCalls + f.recordCalls + f.dispatchCalls + f.settleCalls + f.releasedCalls + f.ledgerlessCalls + f.preCallCalls
}

func (f *fakeUsageAccounting) FinalizeLedgerless(context.Context, tenantchat.RequestContext, tenantruntime.Snapshot, string, string, string) (bool, error) {
	f.ledgerlessCalls++
	return false, f.err
}

func (f *fakeUsageAccounting) FinalizePreCall(context.Context, tenantchat.RequestContext, string, int, string) (tenantchat.UsageSettlement, error) {
	f.preCallCalls++
	return f.settlement, f.err
}

func (f *fakeUsageAccounting) BeginExecution(_ context.Context, requestContext tenantchat.RequestContext, _ tenantruntime.Snapshot) (tenantchat.UsageReservation, error) {
	index := f.reserveCalls
	f.reserveCalls++
	f.startAttemptCalls++
	f.lastContext = requestContext
	if index < len(f.reservations) {
		return f.reservations[index], f.err
	}
	return f.reservation, f.err
}

func (f *fakeUsageAccounting) BeginFallback(
	ctx context.Context,
	_ tenantchat.RequestContext,
	_ tenantruntime.Snapshot,
	_ string,
	_ int,
	_ tenantchat.ConfirmedUsage,
	_ string,
	_ tenantchat.SelectedRoute,
	_ int,
) (bool, error) {
	f.fallbackContextErr = ctx.Err()
	index := f.recordCalls
	f.startAttemptCalls++
	f.recordCalls++
	if f.fallbackErr != nil {
		return false, f.fallbackErr
	}
	if index < len(f.restrictions) && f.restrictions[index] {
		return true, nil
	}
	return false, f.err
}

func (f *fakeUsageAccounting) MarkDispatched(
	context.Context,
	tenantchat.RequestContext,
	string,
	int,
) error {
	f.dispatchCalls++
	return f.dispatchErr
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

func (f *fakeUsageAccounting) MarkPending(_ context.Context, _ tenantchat.RequestContext, _ string, _ int, outcome string) (tenantchat.UsageSettlement, error) {
	f.settleCalls++
	f.unconfirmedCalls++
	f.lastOutcome = outcome
	return f.settlement, f.err
}

func (f *fakeUsageAccounting) ReadTerminal(context.Context, tenantchat.RequestContext, string) (tenantchat.UsageSettlement, error) {
	return f.settlement, f.err
}

type fakeProviderExecutor struct {
	stream    provider.ChatCompletionStreamReader
	streams   []provider.ChatCompletionStreamReader
	errors    []error
	err       error
	status    tenantchat.ProviderCallStartStatus
	statuses  []tenantchat.ProviderCallStartStatus
	routes    []tenantchat.SelectedRoute
	calls     int
	lastInput tenantchat.CompletionInput
}

func (f *fakeProviderExecutor) OpenStream(_ context.Context, _ tenantchat.RequestContext, route tenantchat.SelectedRoute, input tenantchat.CompletionInput) (provider.ChatCompletionStreamReader, tenantchat.ProviderCallStartStatus, error) {
	index := f.calls
	f.calls++
	f.routes = append(f.routes, route)
	f.lastInput = input
	if index < len(f.streams) {
		var err error
		if index < len(f.errors) {
			err = f.errors[index]
		}
		status := tenantchat.ProviderCallStartStatus(tenantchat.ProviderCallStartedOrUnknown)
		if index < len(f.statuses) && f.statuses[index] != "" {
			status = f.statuses[index]
		}
		return f.streams[index], status, err
	}
	status := f.status
	if status == "" {
		status = tenantchat.ProviderCallStartedOrUnknown
	}
	return f.stream, status, f.err
}

type fakeStream struct {
	events      []provider.ChatCompletionStreamEvent
	index       int
	terminalErr error
	onTerminal  func()
	closeCalls  int
}

func (f *fakeStream) Next() (provider.ChatCompletionStreamEvent, error) {
	if f.index >= len(f.events) {
		if f.terminalErr != nil {
			if f.onTerminal != nil {
				f.onTerminal()
				f.onTerminal = nil
			}
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

func (f *fakeStream) Close() error {
	f.closeCalls++
	return nil
}

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
