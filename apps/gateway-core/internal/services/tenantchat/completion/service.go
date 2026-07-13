package completion

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

const accountingTimeout = 5 * time.Second

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
	RecordConfirmedAttempt(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
		attemptNo int,
		usage tenantchat.ConfirmedUsage,
		outcome string,
	) error
	FinalizeConfirmed(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
		attemptNo int,
		usage tenantchat.ConfirmedUsage,
		outcome string,
	) (tenantchat.UsageSettlement, error)
	FinalizeRecordedAttempts(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
	) (tenantchat.UsageSettlement, error)
	FinalizeReleased(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
		terminalOutcome string,
	) (tenantchat.UsageSettlement, error)
	FinalizeUnconfirmed(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
		attemptNo int,
		outcome string,
	) (tenantchat.UsageSettlement, error)
	ReadTerminal(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
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
	snapshots  snapshotResolver
	usage      usageAccounting
	providers  providerExecutor
	sessionsMu sync.Mutex
	sessions   map[string]*sharedSession
}

type PreparedExecution struct {
	requestContext tenantchat.RequestContext
	reservation    tenantchat.UsageReservation
	snapshot       tenantruntime.Snapshot
	input          tenantchat.CompletionInput
	stream         provider.ChatCompletionStreamReader
	cancel         context.CancelFunc
	usage          usageAccounting
	providers      providerExecutor
	session        *sharedSession
	sequence       int
	attemptNo      int
	route          tenantchat.SelectedRoute
	usedRouteIDs   map[string]struct{}
}

type ReplayExecution struct {
	requestContext tenantchat.RequestContext
	settlement     tenantchat.UsageSettlement
	emitted        bool
}

type AttachedExecution struct {
	requestContext tenantchat.RequestContext
	session        *sharedSession
}

type sharedSession struct {
	mu        sync.Mutex
	requestID string
	events    []tenantchat.CompletionEvent
	closed    bool
	notify    chan struct{}
	cleanup   func()
}

type EventEmitter func(tenantchat.CompletionEvent) error

type Execution interface {
	Relay(ctx context.Context, emit EventEmitter) error
	Close()
	IsReplay() bool
}

type attemptRelayResult struct {
	usage       *provider.Usage
	deltaCount  int
	err         error
	clientWrite bool
}

func New(snapshots snapshotResolver, usage usageAccounting, providers providerExecutor) *Service {
	return &Service{
		snapshots: snapshots, usage: usage, providers: providers,
		sessions: make(map[string]*sharedSession),
	}
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
	// The active contract does not yet carry executable safety rules or the
	// encrypted exact-cache key contract. Never silently bypass either policy.
	if snapshot.Policies.Cache.Enabled || snapshot.Policies.Safety.Enabled {
		return nil, tenantchat.ErrRuntimeUnavailable
	}

	reservation, err := s.usage.ConsumeAndReserve(ctx, request.Context, snapshot)
	if err != nil {
		return nil, err
	}
	if reservation.Replayed {
		if reservation.State == "reserved" {
			if session := s.activeSession(request.Context); session != nil {
				return &AttachedExecution{requestContext: request.Context, session: session}, nil
			}
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		settlement, replayErr := s.usage.ReadTerminal(ctx, request.Context, reservation.ReservationID)
		if replayErr != nil {
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		return &ReplayExecution{requestContext: request.Context, settlement: settlement}, nil
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
		settleCtx, cancel := detachedAccountingContext(ctx)
		_, releaseErr := s.usage.FinalizeReleased(
			settleCtx, request.Context, reservation.ReservationID, terminalOutcomeForError(err),
		)
		cancel()
		if releaseErr != nil {
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		return nil, err
	}

	streamCtx, cancel := context.WithTimeout(
		ctx,
		time.Duration(snapshot.Policies.Streaming.MaxDurationSeconds)*time.Second,
	)
	stream, err := s.providers.OpenStream(streamCtx, request.Context, reservation.Route, request.Input)
	if err != nil {
		cancel()
		settleCtx, settleCancel := detachedAccountingContext(ctx)
		_, settleErr := s.usage.FinalizeUnconfirmed(
			settleCtx, request.Context, reservation.ReservationID, 1, attemptOutcome(err, 0),
		)
		settleCancel()
		if settleErr != nil {
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		return nil, err
	}
	session := s.registerSession(request.Context)
	return &PreparedExecution{
		requestContext: request.Context,
		reservation:    reservation,
		snapshot:       snapshot,
		input:          request.Input,
		stream:         stream,
		cancel:         cancel,
		usage:          s.usage,
		providers:      s.providers,
		session:        session,
		attemptNo:      1,
		route:          reservation.Route,
		usedRouteIDs:   map[string]struct{}{reservation.Route.RouteID: {}},
	}, nil
}

func (e *PreparedExecution) Relay(ctx context.Context, emit EventEmitter) error {
	if e == nil || e.stream == nil || e.usage == nil || e.providers == nil || emit == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	defer e.Close()
	for {
		result := e.relayAttempt(ctx, emit)
		if result.err == nil && result.usage != nil {
			settlement, err := e.finalizeConfirmed(ctx, result.usage, "succeeded")
			if err != nil {
				return e.emitAccountingFailure(emit, err)
			}
			return e.emitEvent(emit, e.finalEvent(settlement, "succeeded", nil, false))
		}

		outcome := attemptOutcome(result.err, result.deltaCount)
		if result.err == nil {
			outcome = attemptOutcome(tenantchat.ErrUsageGuardUnavailable, result.deltaCount)
		}
		if result.usage == nil {
			settlement, err := e.finalizeUnconfirmed(ctx, outcome)
			if err != nil {
				return e.emitAccountingFailure(emit, err)
			}
			finalOutcome := terminalOutcomeForError(result.err)
			completionErr := completionErrorFor(result.err)
			if result.err == nil {
				finalOutcome = "failed"
				completionErr = &tenantchat.CompletionError{Code: "CHAT_PROVIDER_FAILED", Message: "Provider usage was not confirmed."}
			}
			if result.clientWrite {
				e.publishEvent(e.finalEvent(settlement, finalOutcome, completionErr, false))
				return result.err
			}
			return e.emitEvent(emit, e.finalEvent(settlement, finalOutcome, completionErr, false))
		}

		confirmed := confirmedUsage(result.usage)
		if !result.clientWrite && result.deltaCount == 0 && e.canFallback(result.err) {
			if err := e.recordConfirmed(ctx, confirmed, outcome); err != nil {
				return e.emitAccountingFailure(emit, err)
			}
			fallbackRoute, ok := e.nextFallbackRoute()
			if ok {
				started, openErr := e.openFallback(ctx, fallbackRoute)
				if openErr == nil {
					continue
				}
				if started {
					settlement, settleErr := e.finalizeUnconfirmed(ctx, attemptOutcome(openErr, 0))
					if settleErr != nil {
						return e.emitAccountingFailure(emit, settleErr)
					}
					return e.emitEvent(emit, e.finalEvent(settlement, terminalOutcomeForError(openErr), completionErrorFor(openErr), false))
				} else {
					settlement, settleErr := e.finalizeRecorded(ctx)
					if settleErr != nil {
						return e.emitAccountingFailure(emit, settleErr)
					}
					return e.emitEvent(emit, e.finalEvent(settlement, "failed", completionErrorFor(openErr), false))
				}
			}
			settlement, err := e.finalizeRecorded(ctx)
			if err != nil {
				return e.emitAccountingFailure(emit, err)
			}
			return e.emitEvent(emit, e.finalEvent(settlement, terminalOutcomeForError(result.err), completionErrorFor(result.err), false))
		}

		settlement, err := e.finalizeConfirmed(ctx, result.usage, outcome)
		if err != nil {
			return e.emitAccountingFailure(emit, err)
		}
		if result.clientWrite {
			e.publishEvent(e.finalEvent(
				settlement,
				terminalOutcomeForError(result.err),
				completionErrorFor(result.err),
				false,
			))
			return result.err
		}
		return e.emitEvent(emit, e.finalEvent(
			settlement,
			terminalOutcomeForError(result.err),
			completionErrorFor(result.err),
			false,
		))
	}
}

func (e *PreparedExecution) relayAttempt(ctx context.Context, emit EventEmitter) attemptRelayResult {
	result := attemptRelayResult{}
	for {
		if err := ctx.Err(); err != nil {
			result.err = err
			return result
		}
		event, err := e.stream.Next()
		if errors.Is(err, io.EOF) {
			return result
		}
		if err != nil {
			result.err = err
			return result
		}
		if event.Usage != nil {
			result.usage = event.Usage
		}
		if event.Delta == "" {
			continue
		}
		if err := e.emitEvent(emit, e.deltaEvent(event.Delta)); err != nil {
			result.err = err
			result.clientWrite = true
			return result
		}
		result.deltaCount++
	}
}

func (e *PreparedExecution) openFallback(ctx context.Context, route tenantchat.SelectedRoute) (bool, error) {
	e.closeCurrentStream()
	e.attemptNo++
	if err := e.usage.StartAttempt(
		ctx, e.requestContext, e.snapshot, e.reservation.ReservationID, route, e.attemptNo, "fallback",
	); err != nil {
		e.attemptNo--
		return false, err
	}
	streamCtx, cancel := context.WithTimeout(
		ctx,
		time.Duration(e.snapshot.Policies.Streaming.MaxDurationSeconds)*time.Second,
	)
	stream, err := e.providers.OpenStream(streamCtx, e.requestContext, route, e.input)
	if err != nil {
		cancel()
		e.route = route
		e.usedRouteIDs[route.RouteID] = struct{}{}
		return true, err
	}
	e.stream = stream
	e.cancel = cancel
	e.route = route
	e.usedRouteIDs[route.RouteID] = struct{}{}
	return true, nil
}

func (e *PreparedExecution) canFallback(err error) bool {
	reason := fallbackReason(err)
	if reason == "" || !e.snapshot.Policies.Fallback.Enabled || e.attemptNo >= e.snapshot.Policies.Fallback.MaxAttempts {
		return false
	}
	for _, allowed := range e.snapshot.Policies.Fallback.AllowedReasons {
		if allowed == reason {
			return true
		}
	}
	return false
}

func (e *PreparedExecution) nextFallbackRoute() (tenantchat.SelectedRoute, bool) {
	for _, routeID := range e.snapshot.Policies.Fallback.RouteIDs {
		if _, exists := e.usedRouteIDs[routeID]; exists {
			continue
		}
		route, ok := resolveSnapshotRoute(e.snapshot, routeID)
		if ok {
			return route, true
		}
	}
	return tenantchat.SelectedRoute{}, false
}

func resolveSnapshotRoute(snapshot tenantruntime.Snapshot, routeID string) (tenantchat.SelectedRoute, bool) {
	var runtimeRoute *tenantruntime.RuntimeRoute
	for index := range snapshot.Policies.Routing.Routes {
		candidate := &snapshot.Policies.Routing.Routes[index]
		if candidate.RouteID == routeID && candidate.Enabled {
			runtimeRoute = candidate
			break
		}
	}
	if runtimeRoute == nil {
		return tenantchat.SelectedRoute{}, false
	}
	for _, price := range snapshot.Pricing.Routes {
		if price.RouteID == routeID && price.ProviderID == runtimeRoute.ProviderID && price.ModelKey == runtimeRoute.ModelKey {
			return tenantchat.SelectedRoute{
				RouteID: routeID, Tier: runtimeRoute.Tier, ProviderID: runtimeRoute.ProviderID,
				ModelKey: runtimeRoute.ModelKey, PricingVersion: snapshot.Pricing.Version,
				InputMicroUSDPerMillionTokens:          price.InputMicroUSDPerMillionTokens,
				OutputMicroUSDPerMillionTokens:         price.OutputMicroUSDPerMillionTokens,
				CacheReadInputMicroUSDPerMillionTokens: price.CacheReadInputMicroUSDPerMillionTokens,
			}, true
		}
	}
	return tenantchat.SelectedRoute{}, false
}

func (e *PreparedExecution) recordConfirmed(ctx context.Context, usage tenantchat.ConfirmedUsage, outcome string) error {
	settleCtx, cancel := detachedAccountingContext(ctx)
	defer cancel()
	return e.usage.RecordConfirmedAttempt(
		settleCtx, e.requestContext, e.reservation.ReservationID, e.attemptNo, usage, outcome,
	)
}

func (e *PreparedExecution) finalizeConfirmed(ctx context.Context, usage *provider.Usage, outcome string) (tenantchat.UsageSettlement, error) {
	if usage == nil || usage.PromptTokens < 0 || usage.CompletionTokens < 0 || usage.TotalTokens < 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	settleCtx, cancel := detachedAccountingContext(ctx)
	defer cancel()
	return e.usage.FinalizeConfirmed(
		settleCtx, e.requestContext, e.reservation.ReservationID, e.attemptNo,
		confirmedUsage(usage), outcome,
	)
}

func (e *PreparedExecution) finalizeRecorded(ctx context.Context) (tenantchat.UsageSettlement, error) {
	settleCtx, cancel := detachedAccountingContext(ctx)
	defer cancel()
	return e.usage.FinalizeRecordedAttempts(settleCtx, e.requestContext, e.reservation.ReservationID)
}

func (e *PreparedExecution) finalizeUnconfirmed(ctx context.Context, outcome string) (tenantchat.UsageSettlement, error) {
	settleCtx, cancel := detachedAccountingContext(ctx)
	defer cancel()
	return e.usage.FinalizeUnconfirmed(
		settleCtx, e.requestContext, e.reservation.ReservationID, e.attemptNo, outcome,
	)
}

func confirmedUsage(usage *provider.Usage) tenantchat.ConfirmedUsage {
	return tenantchat.ConfirmedUsage{
		InputTokens: int64(usage.PromptTokens), OutputTokens: int64(usage.CompletionTokens),
		CacheReadInputTokens: int64(usage.CacheReadInputTokens),
	}
}

func detachedAccountingContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), accountingTimeout)
}

func fallbackReason(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || provider.ErrorKindOf(err) == provider.ErrorKindTimeout {
		return "provider_timeout"
	}
	if provider.AllowsFallback(err) {
		return "provider_error_pre_delta"
	}
	return ""
}

func attemptOutcome(err error, deltaCount int) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case errors.Is(err, context.DeadlineExceeded), provider.ErrorKindOf(err) == provider.ErrorKindTimeout:
		return "timed_out"
	case deltaCount > 0:
		return "failed_post_delta"
	default:
		return "failed_pre_delta"
	}
}

func terminalOutcomeForError(err error) string {
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	return "failed"
}

func completionErrorFor(err error) *tenantchat.CompletionError {
	switch {
	case errors.Is(err, context.DeadlineExceeded), provider.ErrorKindOf(err) == provider.ErrorKindTimeout:
		return &tenantchat.CompletionError{Code: "CHAT_PROVIDER_TIMEOUT", Message: "Tenant chat provider timed out."}
	case errors.Is(err, tenantchat.ErrQuotaHardLimit):
		return &tenantchat.CompletionError{Code: "CHAT_QUOTA_HARD_LIMIT", Message: "Tenant chat user quota was reached."}
	case errors.Is(err, tenantchat.ErrBudgetHardLimit):
		return &tenantchat.CompletionError{Code: "CHAT_BUDGET_HARD_LIMIT", Message: "Tenant chat tenant budget was reached."}
	case errors.Is(err, context.Canceled):
		return &tenantchat.CompletionError{Code: "CHAT_REQUEST_CANCELLED", Message: "Tenant chat request was cancelled."}
	default:
		return &tenantchat.CompletionError{Code: "CHAT_PROVIDER_FAILED", Message: "Tenant chat provider failed."}
	}
}

func (e *PreparedExecution) Close() {
	if e == nil {
		return
	}
	e.closeCurrentStream()
}

func (e *PreparedExecution) closeCurrentStream() {
	if e.stream != nil {
		_ = e.stream.Close()
		e.stream = nil
	}
	if e.cancel != nil {
		e.cancel()
		e.cancel = nil
	}
}

func (e *PreparedExecution) IsReplay() bool { return false }

func (e *PreparedExecution) deltaEvent(delta string) tenantchat.CompletionEvent {
	e.sequence++
	return tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventDelta, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: e.sequence, Delta: delta,
	}
}

func (e *PreparedExecution) finalEvent(
	settlement tenantchat.UsageSettlement,
	terminalOutcome string,
	completionErr *tenantchat.CompletionError,
	replayed bool,
) tenantchat.CompletionEvent {
	e.sequence++
	modelKey := e.route.ModelKey
	usageQuality := "confirmed"
	inputTokens := settlement.ConfirmedInputTokens
	outputTokens := settlement.ConfirmedOutputTokens
	if settlement.State == "unconfirmed" {
		usageQuality = "pending_unconfirmed"
		inputTokens = 0
		outputTokens = 0
	} else if settlement.State == "released" {
		usageQuality = "not_available"
	}
	return tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventFinal, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: e.sequence, TerminalOutcome: terminalOutcome, EffectiveModelKey: &modelKey,
		Usage: &tenantchat.CompletionUsage{
			InputTokens: inputTokens, OutputTokens: outputTokens,
			TotalTokens: inputTokens + outputTokens, UsageQuality: usageQuality,
		},
		QuotaState: settlement.QuotaState, BudgetState: settlement.BudgetState,
		CacheOutcome: "off", Replayed: &replayed, Error: completionErr,
	}
}

func (e *PreparedExecution) emitAccountingFailure(emit EventEmitter, accountingErr error) error {
	replayed := false
	modelKey := e.route.ModelKey
	e.sequence++
	event := tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventFinal, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: e.sequence, TerminalOutcome: "failed", EffectiveModelKey: &modelKey,
		Usage:      &tenantchat.CompletionUsage{UsageQuality: "not_available"},
		QuotaState: e.reservation.QuotaState, BudgetState: e.reservation.BudgetState,
		CacheOutcome: "off", Replayed: &replayed,
		Error: &tenantchat.CompletionError{Code: "CHAT_USAGE_GUARD_UNAVAILABLE", Message: "Tenant chat usage guard is unavailable.", RetryAfterSeconds: 1},
	}
	if err := e.emitEvent(emit, event); err != nil {
		return err
	}
	return accountingErr
}

func (e *ReplayExecution) Relay(_ context.Context, emit EventEmitter) error {
	if e == nil || emit == nil || e.emitted {
		return tenantchat.ErrUsageGuardUnavailable
	}
	e.emitted = true
	terminalOutcome := "failed"
	usageQuality := "not_available"
	inputTokens := e.settlement.ConfirmedInputTokens
	outputTokens := e.settlement.ConfirmedOutputTokens
	var modelKey *string
	if len(e.settlement.Attempts) > 0 {
		last := e.settlement.Attempts[len(e.settlement.Attempts)-1]
		model := last.ModelKey
		modelKey = &model
		terminalOutcome = terminalOutcomeForAttempt(last.Outcome)
	}
	if e.settlement.State == "settled" {
		usageQuality = "confirmed"
	} else if e.settlement.State == "unconfirmed" {
		usageQuality = "pending_unconfirmed"
		inputTokens = 0
		outputTokens = 0
	}
	replayed := true
	event := tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventFinal, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID, Sequence: 1,
		TerminalOutcome: terminalOutcome, EffectiveModelKey: modelKey,
		Usage: &tenantchat.CompletionUsage{
			InputTokens: inputTokens, OutputTokens: outputTokens,
			TotalTokens: inputTokens + outputTokens, UsageQuality: usageQuality,
		},
		QuotaState: e.settlement.QuotaState, BudgetState: e.settlement.BudgetState,
		CacheOutcome: "off", Replayed: &replayed,
	}
	if len(e.settlement.Attempts) > 0 && terminalOutcome != "succeeded" {
		event.Error = completionErrorForAttempt(e.settlement.Attempts[len(e.settlement.Attempts)-1].Outcome)
	} else if terminalOutcome == "failed" {
		event.Error = &tenantchat.CompletionError{Code: "CHAT_PROVIDER_FAILED", Message: "Tenant chat provider failed."}
	}
	return emit(event)
}

func terminalOutcomeForAttempt(outcome string) string {
	switch outcome {
	case "succeeded":
		return "succeeded"
	case "cancelled":
		return "cancelled"
	default:
		return "failed"
	}
}

func completionErrorForAttempt(outcome string) *tenantchat.CompletionError {
	switch outcome {
	case "timed_out":
		return &tenantchat.CompletionError{Code: "CHAT_PROVIDER_TIMEOUT", Message: "Tenant chat provider timed out."}
	case "cancelled":
		return &tenantchat.CompletionError{Code: "CHAT_REQUEST_CANCELLED", Message: "Tenant chat request was cancelled."}
	default:
		return &tenantchat.CompletionError{Code: "CHAT_PROVIDER_FAILED", Message: "Tenant chat provider failed."}
	}
}

func (e *ReplayExecution) Close()         {}
func (e *ReplayExecution) IsReplay() bool { return true }

func (s *Service) sessionKey(requestContext tenantchat.RequestContext) string {
	return requestContext.ExecutionScope.TenantID + ":" +
		requestContext.ExecutionScope.Actor.UserID + ":" + requestContext.IdempotencyKey
}

func (s *Service) registerSession(requestContext tenantchat.RequestContext) *sharedSession {
	session := &sharedSession{
		requestID: requestContext.RequestID,
		events:    make([]tenantchat.CompletionEvent, 0, 16),
		notify:    make(chan struct{}),
	}
	key := s.sessionKey(requestContext)
	session.cleanup = func() {
		s.sessionsMu.Lock()
		defer s.sessionsMu.Unlock()
		if s.sessions[key] == session {
			delete(s.sessions, key)
		}
	}
	s.sessionsMu.Lock()
	s.sessions[key] = session
	s.sessionsMu.Unlock()
	return session
}

func (s *Service) activeSession(requestContext tenantchat.RequestContext) *sharedSession {
	key := s.sessionKey(requestContext)
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	session := s.sessions[key]
	if session == nil || session.requestID != requestContext.RequestID {
		return nil
	}
	return session
}

func (e *PreparedExecution) emitEvent(emit EventEmitter, event tenantchat.CompletionEvent) error {
	e.publishEvent(event)
	return emit(event)
}

func (e *PreparedExecution) publishEvent(event tenantchat.CompletionEvent) {
	if e != nil && e.session != nil {
		e.session.publish(event)
	}
}

func (s *sharedSession) publish(event tenantchat.CompletionEvent) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.events = append(s.events, event)
	close(s.notify)
	s.notify = make(chan struct{})
	if event.Type == tenantchat.CompletionEventFinal {
		s.closed = true
		close(s.notify)
		time.AfterFunc(30*time.Second, s.clear)
	}
}

func (s *sharedSession) snapshot(index int) ([]tenantchat.CompletionEvent, bool, <-chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if index < 0 {
		index = 0
	}
	if index > len(s.events) {
		index = len(s.events)
	}
	events := append([]tenantchat.CompletionEvent(nil), s.events[index:]...)
	return events, s.closed, s.notify
}

func (s *sharedSession) clear() {
	s.mu.Lock()
	for index := range s.events {
		s.events[index].Delta = ""
	}
	s.events = nil
	cleanup := s.cleanup
	s.cleanup = nil
	s.mu.Unlock()
	if cleanup != nil {
		cleanup()
	}
}

func (e *AttachedExecution) Relay(ctx context.Context, emit EventEmitter) error {
	if e == nil || e.session == nil || emit == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	index := 0
	for {
		events, closed, notify := e.session.snapshot(index)
		for _, event := range events {
			if event.Type == tenantchat.CompletionEventFinal {
				replayed := true
				event.Replayed = &replayed
			}
			if err := emit(event); err != nil {
				return err
			}
			index++
		}
		if closed {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-notify:
		}
	}
}

func (e *AttachedExecution) Close()         {}
func (e *AttachedExecution) IsReplay() bool { return true }
