package completion

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

type snapshotResolver interface {
	Resolve(ctx context.Context, requestContext tenantchat.RequestContext) (tenantruntime.Snapshot, error)
}

type usageAccounting interface {
	ConsumeAndReserve(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
	) (tenantchat.UsageReservation, error)
	StartAttempt(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
		reservationID string,
		route tenantchat.SelectedRoute,
		attemptNo int,
		kind string,
	) error
	FinalizeConfirmed(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
		attemptNo int,
		usage tenantchat.ConfirmedUsage,
		outcome string,
	) (tenantchat.UsageSettlement, error)
}

type providerExecutor interface {
	OpenStream(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		route tenantchat.SelectedRoute,
		input tenantchat.CompletionInput,
	) (provider.ChatCompletionStreamReader, error)
}

type Service struct {
	snapshots snapshotResolver
	usage     usageAccounting
	providers providerExecutor
}

type PreparedExecution struct {
	requestContext tenantchat.RequestContext
	reservation    tenantchat.UsageReservation
	stream         provider.ChatCompletionStreamReader
	cancel         context.CancelFunc
	usage          usageAccounting
	sequence       int
}

type EventEmitter func(tenantchat.CompletionEvent) error

type Execution interface {
	Relay(ctx context.Context, emit EventEmitter) error
	Close()
}

func New(snapshots snapshotResolver, usage usageAccounting, providers providerExecutor) *Service {
	return &Service{snapshots: snapshots, usage: usage, providers: providers}
}

func (s *Service) Prepare(
	ctx context.Context,
	request tenantchat.CompletionRequest,
) (Execution, error) {
	if s == nil || s.snapshots == nil || s.usage == nil || s.providers == nil {
		return nil, tenantchat.ErrUsageGuardUnavailable
	}
	if err := tenantchat.ValidateCompletionInput(request.Input); err != nil {
		return nil, err
	}
	snapshot, err := s.snapshots.Resolve(ctx, request.Context)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, tenantchat.ErrRuntimeUnavailable
	}
	if !snapshot.Policies.Streaming.Enabled || !snapshot.Policies.Streaming.FinalEventRequired {
		return nil, tenantchat.ErrRuntimeUnavailable
	}
	// Stage 1 only opens the normal provider path. Stage 2 supplies the
	// tenant-scoped encrypted cache and executable safety policy adapters.
	if snapshot.Policies.Cache.Enabled || snapshot.Policies.Safety.Enabled {
		return nil, tenantchat.ErrRuntimeUnavailable
	}

	reservation, err := s.usage.ConsumeAndReserve(ctx, request.Context, snapshot)
	if err != nil {
		return nil, err
	}
	if reservation.Replayed {
		return nil, tenantchat.ErrUsageGuardUnavailable
	}
	if err := s.usage.StartAttempt(
		ctx,
		request.Context,
		snapshot,
		reservation.ReservationID,
		reservation.Route,
		1,
		"primary",
	); err != nil {
		return nil, err
	}

	streamCtx, cancel := context.WithTimeout(
		ctx,
		time.Duration(snapshot.Policies.Streaming.MaxDurationSeconds)*time.Second,
	)
	stream, err := s.providers.OpenStream(streamCtx, request.Context, reservation.Route, request.Input)
	if err != nil {
		cancel()
		return nil, err
	}
	return &PreparedExecution{
		requestContext: request.Context,
		reservation:    reservation,
		stream:         stream,
		cancel:         cancel,
		usage:          s.usage,
	}, nil
}

func (e *PreparedExecution) Relay(ctx context.Context, emit EventEmitter) error {
	if e == nil || e.stream == nil || e.usage == nil || emit == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	defer e.Close()
	var confirmedUsage *provider.Usage
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		event, err := e.stream.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		if event.Usage != nil {
			confirmedUsage = event.Usage
		}
		delta, err := completionDelta(event.Data)
		if err != nil {
			return err
		}
		if delta == "" {
			continue
		}
		if err := emit(e.deltaEvent(delta)); err != nil {
			return err
		}
	}
	if confirmedUsage == nil || confirmedUsage.PromptTokens < 0 ||
		confirmedUsage.CompletionTokens < 0 || confirmedUsage.TotalTokens < 0 {
		return tenantchat.ErrUsageGuardUnavailable
	}
	settlement, err := e.usage.FinalizeConfirmed(
		ctx,
		e.requestContext,
		e.reservation.ReservationID,
		1,
		tenantchat.ConfirmedUsage{
			InputTokens:  int64(confirmedUsage.PromptTokens),
			OutputTokens: int64(confirmedUsage.CompletionTokens),
		},
		"succeeded",
	)
	if err != nil {
		return err
	}
	return emit(e.finalEvent(settlement))
}

func (e *PreparedExecution) Close() {
	if e == nil {
		return
	}
	if e.stream != nil {
		_ = e.stream.Close()
		e.stream = nil
	}
	if e.cancel != nil {
		e.cancel()
		e.cancel = nil
	}
}

func (e *PreparedExecution) deltaEvent(delta string) tenantchat.CompletionEvent {
	e.sequence++
	return tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventDelta, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: e.sequence, Delta: delta,
	}
}

func (e *PreparedExecution) finalEvent(settlement tenantchat.UsageSettlement) tenantchat.CompletionEvent {
	e.sequence++
	modelKey := e.reservation.Route.ModelKey
	replayed := false
	return tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventFinal, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: e.sequence, TerminalOutcome: "succeeded", EffectiveModelKey: &modelKey,
		Usage: &tenantchat.CompletionUsage{
			InputTokens: settlement.ConfirmedInputTokens, OutputTokens: settlement.ConfirmedOutputTokens,
			TotalTokens:  settlement.ConfirmedInputTokens + settlement.ConfirmedOutputTokens,
			UsageQuality: "confirmed",
		},
		QuotaState: settlement.QuotaState, BudgetState: settlement.BudgetState,
		CacheOutcome: "off", Replayed: &replayed,
	}
}

func completionDelta(payload json.RawMessage) (string, error) {
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &chunk); err != nil {
		return "", provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
	}
	for _, choice := range chunk.Choices {
		if choice.Delta.Content != "" {
			return choice.Delta.Content, nil
		}
	}
	return "", nil
}
