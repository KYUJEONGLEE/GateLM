package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/ports"
)

func TestEmployeeCostEstimatedInputUsesMaskedMessageUTF8BytesWithoutSeparators(t *testing.T) {
	messages := []provider.ChatMessage{
		{Role: "user", Content: json.RawMessage(`"가"`)},
		{Role: "assistant", Content: json.RawMessage(`"a"`)},
	}
	got, err := employeeCostEstimatedInput(messages)
	if err != nil || got != 4 {
		t.Fatalf("estimated input = %d, err = %v; want 4", got, err)
	}
}

func TestEmployeeCostMaxOutputUsesBoundedRequestPrecedence(t *testing.T) {
	maxTokens, maxCompletion := 30, 20
	got, invalid := employeeCostMaxOutput(provider.ChatCompletionRequest{
		MaxTokens: &maxTokens, MaxCompletionTokens: &maxCompletion,
	}, 40)
	if invalid || got != 20 {
		t.Fatalf("max output = %d, invalid = %v; want 20,false", got, invalid)
	}
	maxCompletion = 41
	if _, invalid := employeeCostMaxOutput(provider.ChatCompletionRequest{MaxCompletionTokens: &maxCompletion}, 40); !invalid {
		t.Fatal("catalog-bound request must be invalid")
	}
}

func TestEmployeeCostAttemptReleasesOnlyBoundedNotStartedFailure(t *testing.T) {
	accounting := &recordingEmployeeCostAccounting{}
	session := activeEmployeeCostSession()
	tracker := &provider.DispatchTracker{}
	tracker.Observe()
	lifecycle := &employeeCostAttemptLifecycle{accounting: accounting, session: &session, tracker: tracker}

	state, err := lifecycle.Complete(context.Background(), nil, provider.NewNotStartedError(errors.New("encode failed")))
	if err != nil || state != employeeCostAttemptPreCall || accounting.preCall != 1 || accounting.pending != 0 {
		t.Fatalf("state=%s err=%v pre_call=%d pending=%d", state, err, accounting.preCall, accounting.pending)
	}
}

func TestEmployeeCostAttemptKeepsDispatchedMissingUsagePending(t *testing.T) {
	accounting := &recordingEmployeeCostAccounting{}
	session := activeEmployeeCostSession()
	tracker := &provider.DispatchTracker{}
	tracker.Observe()
	tracker.MarkStarted()
	lifecycle := &employeeCostAttemptLifecycle{accounting: accounting, session: &session, tracker: tracker}

	state, err := lifecycle.Complete(context.Background(), nil, errors.New("transport failed"))
	if err != nil || state != employeeCostAttemptPending || accounting.pending != 1 || accounting.preCall != 0 || !session.HasPending {
		t.Fatalf("state=%s err=%v pre_call=%d pending=%d session=%+v", state, err, accounting.preCall, accounting.pending, session)
	}
}

func TestEmployeeCostAttemptRecordsProviderUsage(t *testing.T) {
	accounting := &recordingEmployeeCostAccounting{}
	session := activeEmployeeCostSession()
	tracker := &provider.DispatchTracker{}
	tracker.Observe()
	tracker.MarkStarted()
	lifecycle := &employeeCostAttemptLifecycle{accounting: accounting, session: &session, tracker: tracker}

	state, err := lifecycle.Complete(context.Background(), &provider.Usage{
		PromptTokens: 11, CompletionTokens: 7, CacheReadInputTokens: 3,
	}, nil)
	if err != nil || state != employeeCostAttemptConfirmed || accounting.confirmed != 1 || !session.HasConfirmed || accounting.usage != (ports.EmployeeCostUsage{InputTokens: 11, OutputTokens: 7, CacheReadInputTokens: 3}) {
		t.Fatalf("state=%s err=%v confirmed=%d usage=%+v", state, err, accounting.confirmed, accounting.usage)
	}
}

func TestFinalizeFailedEmployeeCostSettlesConfirmedUsage(t *testing.T) {
	accounting := &recordingEmployeeCostAccounting{settleCost: 37}
	handler := &ChatCompletionsHandler{ProjectEmployeeCostAccounting: accounting}
	session := activeEmployeeCostSession()
	session.HasConfirmed = true
	reqCtx := &pipeline.RequestContext{}

	if err := handler.finalizeFailedProjectEmployeeCost(context.Background(), reqCtx, &session); err != nil {
		t.Fatalf("finalize confirmed usage: %v", err)
	}
	if accounting.settled != 1 || accounting.released != 0 || session.Active || reqCtx.CostMicroUSD != 37 {
		t.Fatalf("settled=%d released=%d active=%v cost=%d", accounting.settled, accounting.released, session.Active, reqCtx.CostMicroUSD)
	}
}

func TestFinalizeFailedEmployeeCostReleasesOnlyPreCallAttempts(t *testing.T) {
	accounting := &recordingEmployeeCostAccounting{}
	handler := &ChatCompletionsHandler{ProjectEmployeeCostAccounting: accounting}
	session := activeEmployeeCostSession()

	if err := handler.finalizeFailedProjectEmployeeCost(context.Background(), &pipeline.RequestContext{}, &session); err != nil {
		t.Fatalf("finalize pre-call attempts: %v", err)
	}
	if accounting.released != 1 || accounting.settled != 0 || session.Active {
		t.Fatalf("settled=%d released=%d active=%v", accounting.settled, accounting.released, session.Active)
	}
}

func TestFinalizeFailedEmployeeCostLeavesPendingForReconciliation(t *testing.T) {
	accounting := &recordingEmployeeCostAccounting{}
	handler := &ChatCompletionsHandler{ProjectEmployeeCostAccounting: accounting}
	session := activeEmployeeCostSession()
	session.HasPending = true

	if err := handler.finalizeFailedProjectEmployeeCost(context.Background(), &pipeline.RequestContext{}, &session); err != nil {
		t.Fatalf("finalize pending attempt: %v", err)
	}
	if accounting.released != 0 || accounting.settled != 0 || !session.Active {
		t.Fatalf("settled=%d released=%d active=%v", accounting.settled, accounting.released, session.Active)
	}
}

func activeEmployeeCostSession() ports.EmployeeCostReservation {
	return ports.EmployeeCostReservation{Active: true, TenantID: "tenant", EmployeeID: "employee", RequestID: "request", ReservationID: "reservation", AttemptNo: 1, LedgerVersion: 1}
}

type recordingEmployeeCostAccounting struct {
	confirmed  int
	dispatched int
	pending    int
	preCall    int
	settled    int
	released   int
	settleCost int64
	usage      ports.EmployeeCostUsage
}

func (a *recordingEmployeeCostAccounting) Reserve(context.Context, ports.EmployeeCostReserveRequest) (ports.EmployeeCostReservation, error) {
	return ports.EmployeeCostReservation{}, nil
}

func (a *recordingEmployeeCostAccounting) TopUp(context.Context, *ports.EmployeeCostReservation, ports.EmployeeCostTopUpRequest) (ports.EmployeeCostAttemptDecision, error) {
	return ports.EmployeeCostAttemptDecision{}, nil
}

func (a *recordingEmployeeCostAccounting) MarkDispatched(context.Context, *ports.EmployeeCostReservation) error {
	a.dispatched++
	return nil
}

func (a *recordingEmployeeCostAccounting) RecordConfirmed(_ context.Context, _ *ports.EmployeeCostReservation, usage ports.EmployeeCostUsage, _ employeecost.AttemptOutcome) error {
	a.confirmed++
	a.usage = usage
	return nil
}

func (a *recordingEmployeeCostAccounting) RecordPreCallFailure(context.Context, *ports.EmployeeCostReservation) error {
	a.preCall++
	return nil
}

func (a *recordingEmployeeCostAccounting) MarkPending(_ context.Context, reservation *ports.EmployeeCostReservation, _ employeecost.AttemptOutcome) error {
	a.pending++
	reservation.HasPending = true
	return nil
}

func (a *recordingEmployeeCostAccounting) Settle(_ context.Context, reservation *ports.EmployeeCostReservation) (int64, error) {
	a.settled++
	reservation.Active = false
	return a.settleCost, nil
}

func (a *recordingEmployeeCostAccounting) Release(_ context.Context, reservation *ports.EmployeeCostReservation) error {
	a.released++
	reservation.Active = false
	return nil
}
