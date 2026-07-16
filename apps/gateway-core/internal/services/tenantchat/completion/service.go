package completion

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

const accountingTimeout = 5 * time.Second

type snapshotResolver interface {
	Resolve(ctx context.Context, requestContext tenantchat.RequestContext) (tenantruntime.Snapshot, error)
}

type usageAccounting interface {
	BeginExecution(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
	) (tenantchat.UsageReservation, error)
	BeginFallback(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
		reservationID string,
		previousAttemptNo int,
		previousUsage tenantchat.ConfirmedUsage,
		previousOutcome string,
		route tenantchat.SelectedRoute,
		attemptNo int,
	) (restricted bool, err error)
	MarkDispatched(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
		attemptNo int,
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
	MarkPending(
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
	) (provider.ChatCompletionStreamReader, tenantchat.ProviderCallStartStatus, error)
}

type safetyEvaluator interface {
	Evaluate(
		ctx context.Context,
		snapshot tenantruntime.Snapshot,
		input tenantchat.CompletionInput,
	) (tenantchat.SafetyEvaluation, error)
}

type exactCache interface {
	Get(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
		input tenantchat.CompletionInput,
	) (tenantchat.ExactCacheEntry, bool, error)
	Put(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
		input tenantchat.CompletionInput,
		entry tenantchat.ExactCacheEntry,
	) error
}

type providerTokenLimiter interface {
	Check(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
		route tenantchat.SelectedRoute,
	) (tenantchat.ProviderTokenRateDecision, error)
}

type ledgerlessAccounting interface {
	FinalizeLedgerless(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantruntime.Snapshot,
		terminalOutcome string,
		errorCode string,
		cacheOutcome string,
	) (bool, error)
}

type preCallAccounting interface {
	FinalizePreCall(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		reservationID string,
		attemptNo int,
		terminalOutcome string,
	) (tenantchat.UsageSettlement, error)
}

type Service struct {
	snapshots  snapshotResolver
	usage      usageAccounting
	providers  providerExecutor
	safety     safetyEvaluator
	cache      exactCache
	tokenRate  providerTokenLimiter
	ledgerless ledgerlessAccounting
	preCall    preCallAccounting
	metrics    *metrics.Registry
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
	cache          exactCache
	cacheResponse  []string
	cacheEligible  bool
	tokenRate      providerTokenLimiter
	preCall        preCallAccounting
	metrics        *metrics.Registry
}

type ReplayExecution struct {
	requestContext tenantchat.RequestContext
	settlement     tenantchat.UsageSettlement
	emitted        bool
	metrics        *metrics.Registry
}

type AttachedExecution struct {
	requestContext tenantchat.RequestContext
	session        *sharedSession
}

type CacheExecution struct {
	requestContext tenantchat.RequestContext
	entry          tenantchat.ExactCacheEntry
	replayed       bool
	emitted        bool
	metrics        *metrics.Registry
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

type Option func(*Service)

func WithSafetyEvaluator(evaluator safetyEvaluator) Option {
	return func(service *Service) { service.safety = evaluator }
}

func WithExactCache(cache exactCache) Option {
	return func(service *Service) { service.cache = cache }
}

func WithProviderTokenLimiter(limiter providerTokenLimiter) Option {
	return func(service *Service) { service.tokenRate = limiter }
}

func WithMetrics(registry *metrics.Registry) Option {
	return func(service *Service) { service.metrics = registry }
}

func New(snapshots snapshotResolver, usage usageAccounting, providers providerExecutor, options ...Option) *Service {
	service := &Service{
		snapshots: snapshots, usage: usage, providers: providers,
		sessions: make(map[string]*sharedSession),
	}
	service.ledgerless, _ = usage.(ledgerlessAccounting)
	service.preCall, _ = usage.(preCallAccounting)
	for _, option := range options {
		if option != nil {
			option(service)
		}
	}
	return service
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
	input := request.Input
	if snapshot.Policies.Safety.Enabled {
		if s.safety == nil || s.ledgerless == nil {
			return nil, tenantchat.ErrRuntimeUnavailable
		}
		evaluation, evaluateErr := s.safety.Evaluate(ctx, snapshot, input)
		if evaluateErr != nil {
			return nil, tenantchat.ErrRuntimeUnavailable
		}
		if evaluation.Blocked {
			settleCtx, settleCancel := detachedAccountingContext(ctx)
			_, settleErr := s.ledgerless.FinalizeLedgerless(
				settleCtx, request.Context, snapshot, "safety_blocked", "CHAT_SAFETY_BLOCKED", "off",
			)
			settleCancel()
			if settleErr != nil {
				return nil, tenantchat.ErrUsageGuardUnavailable
			}
			s.recordCompletionOutcome("safety_blocked")
			return nil, tenantchat.ErrSafetyBlocked
		}
		input = evaluation.Input
	}
	if snapshot.Policies.Routing.Policy != nil {
		routingDecision, routingErr := decideTenantChatRoute(ctx, snapshot, input)
		if routingErr != nil {
			return nil, tenantchat.ErrNoEligibleRoute
		}
		request.Context.Routing = &routingDecision
	}
	cacheEligible := snapshot.Policies.Cache.Enabled && request.Context.UsageIntent != nil &&
		request.Context.UsageIntent.CacheStrategy == "exact"
	if cacheEligible {
		if snapshot.Policies.Cache.Strategy != "exact" || s.cache == nil || s.ledgerless == nil {
			return nil, tenantchat.ErrRuntimeUnavailable
		}
		entry, hit, cacheErr := s.cache.Get(ctx, request.Context, snapshot, input)
		if cacheErr != nil {
			return nil, tenantchat.ErrRuntimeUnavailable
		}
		if hit {
			settleCtx, settleCancel := detachedAccountingContext(ctx)
			replayed, settleErr := s.ledgerless.FinalizeLedgerless(
				settleCtx, request.Context, snapshot, "cache_hit", "", "hit",
			)
			settleCancel()
			if settleErr != nil {
				return nil, tenantchat.ErrUsageGuardUnavailable
			}
			return &CacheExecution{
				requestContext: request.Context, entry: entry, replayed: replayed, metrics: s.metrics,
			}, nil
		}
	}

	reservation, err := s.usage.BeginExecution(ctx, request.Context, snapshot)
	if err != nil {
		return nil, err
	}
	if reservation.Replayed {
		if reservation.State == "reserved" {
			if session := s.activeSession(request.Context); session != nil {
				return &AttachedExecution{requestContext: request.Context, session: session}, nil
			}
		}
		settlement, replayErr := s.usage.ReadTerminal(ctx, request.Context, reservation.ReservationID)
		if replayErr != nil {
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		return &ReplayExecution{requestContext: request.Context, settlement: settlement}, nil
	}
	if len(snapshot.Policies.ProviderTokenRate.Providers) > 0 {
		if s.tokenRate == nil || s.preCall == nil {
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		decision, rateErr := s.tokenRate.Check(ctx, request.Context, snapshot, reservation.Route)
		if rateErr != nil || !decision.Allowed {
			terminalOutcome := "rate_limited"
			if rateErr != nil {
				terminalOutcome = "failed"
			}
			settleCtx, settleCancel := detachedAccountingContext(ctx)
			_, settleErr := s.preCall.FinalizePreCall(
				settleCtx, request.Context, reservation.ReservationID, 1, terminalOutcome,
			)
			settleCancel()
			if settleErr != nil {
				return nil, tenantchat.ErrUsageGuardUnavailable
			}
			if rateErr != nil {
				return nil, tenantchat.ErrUsageGuardUnavailable
			}
			s.recordCompletionOutcome("rate_limited")
			return nil, tenantchat.ErrRateLimited
		}
	}
	streamDuration, durationErr := snapshot.Policies.Streaming.Duration()
	if durationErr != nil {
		return nil, tenantchat.ErrRuntimeUnavailable
	}
	streamCtx, cancel := context.WithTimeout(ctx, streamDuration)
	stream, startStatus, err := s.providers.OpenStream(streamCtx, request.Context, reservation.Route, input)
	if err != nil {
		cancel()
		settleCtx, settleCancel := detachedAccountingContext(ctx)
		var settleErr error
		if startStatus == tenantchat.ProviderCallNotStarted && s.preCall != nil {
			_, settleErr = s.preCall.FinalizePreCall(
				settleCtx, request.Context, reservation.ReservationID, 1, "failed",
			)
		} else {
			_, settleErr = s.usage.MarkPending(
				settleCtx, request.Context, reservation.ReservationID, 1, attemptOutcome(err, 0),
			)
		}
		settleCancel()
		if settleErr != nil {
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		return nil, err
	}
	dispatchCtx, dispatchCancel := detachedAccountingContext(ctx)
	dispatchErr := s.usage.MarkDispatched(
		dispatchCtx, request.Context, reservation.ReservationID, 1,
	)
	dispatchCancel()
	if dispatchErr != nil {
		cancel()
		_ = stream.Close()
		settleCtx, settleCancel := detachedAccountingContext(ctx)
		_, settleErr := s.usage.MarkPending(
			settleCtx, request.Context, reservation.ReservationID, 1, "failed_pre_delta",
		)
		settleCancel()
		if settleErr != nil {
			return nil, tenantchat.ErrUsageGuardUnavailable
		}
		return nil, tenantchat.ErrUsageGuardUnavailable
	}
	session := s.registerSession(request.Context)
	return &PreparedExecution{
		requestContext: request.Context,
		reservation:    reservation,
		snapshot:       snapshot,
		input:          input,
		stream:         stream,
		cancel:         cancel,
		usage:          s.usage,
		providers:      s.providers,
		session:        session,
		attemptNo:      1,
		route:          reservation.Route,
		usedRouteIDs:   map[string]struct{}{reservation.Route.RouteID: {}},
		cache:          s.cache,
		cacheEligible:  cacheEligible,
		tokenRate:      s.tokenRate,
		preCall:        s.preCall,
		metrics:        s.metrics,
	}, nil
}

func decideTenantChatRoute(
	ctx context.Context,
	snapshot tenantruntime.Snapshot,
	input tenantchat.CompletionInput,
) (tenantchat.RoutingDecision, error) {
	policy := snapshot.Policies.Routing.Policy
	if policy == nil {
		return tenantchat.RoutingDecision{}, tenantchat.ErrNoEligibleRoute
	}
	requestedModel := "auto"
	if policy.Mode == routing.RoutingPolicyModeManual {
		requestedModel = snapshot.Policies.Routing.ManualModelRef
	}
	messages := currentTurnRoutingMessages(input.Messages)
	if len(messages) == 0 {
		return tenantchat.RoutingDecision{}, tenantchat.ErrNoEligibleRoute
	}
	config := routing.SimpleRouterConfig{
		Mode:           policy.Mode,
		BootstrapState: policy.BootstrapState,
		PolicyHash:     policy.RoutingPolicyHash,
		Routes: routing.RoutingMatrix{
			General:       toRoutingDifficulty(policy.Routes.General),
			Code:          toRoutingDifficulty(policy.Routes.Code),
			Translation:   toRoutingDifficulty(policy.Routes.Translation),
			Summarization: toRoutingDifficulty(policy.Routes.Summarization),
			Reasoning:     toRoutingDifficulty(policy.Routes.Reasoning),
		},
	}
	decision, err := routing.NewSimpleRouter(config).DecideRoute(ctx, routing.Request{
		RequestedModel: requestedModel,
		PromptMessages: messages,
	})
	if err != nil {
		return tenantchat.RoutingDecision{}, err
	}
	if policy.Mode == routing.RoutingPolicyModeManual {
		decision.CandidateModelRefs = append(
			[]string{decision.ModelRef},
			sharedTenantChatFallbackModelRefs(policy.Routes, decision.ModelRef)...,
		)
	}
	return tenantchat.RoutingDecision{
		ModelRef:               decision.ModelRef,
		CandidateModelRefs:     append([]string(nil), decision.CandidateModelRefs...),
		Category:               decision.RoutingDecisionMaterial.Category,
		Difficulty:             decision.RoutingDecisionMaterial.Difficulty,
		RoutingDecisionKeyHash: decision.RoutingDecisionKeyHash,
		RoutingPolicyHash:      decision.PolicyHash,
	}, nil
}

func sharedTenantChatFallbackModelRefs(
	routes tenantruntime.RoutingMatrix,
	manualModelRef string,
) []string {
	cells := routes.Cells()
	if len(cells) == 0 {
		return nil
	}
	shared := cells[0].ModelRefs[1:]
	for _, cell := range cells[1:] {
		candidate := cell.ModelRefs[1:]
		if len(candidate) != len(shared) {
			return nil
		}
		for index := range shared {
			if candidate[index] != shared[index] {
				return nil
			}
		}
	}

	result := make([]string, 0, len(shared))
	seen := map[string]struct{}{manualModelRef: {}}
	for _, modelRef := range shared {
		if _, exists := seen[modelRef]; exists {
			continue
		}
		seen[modelRef] = struct{}{}
		result = append(result, modelRef)
	}
	return result
}

// currentTurnRoutingMessages keeps stable system context, but excludes earlier
// conversation turns so a previous complex request cannot force the next
// simple request onto the complex route. The caller passes safety-processed
// input, while the full input remains unchanged for cache and provider use.
func currentTurnRoutingMessages(messages []tenantchat.EphemeralMessage) []routing.PromptMessage {
	current := make([]routing.PromptMessage, 0, 2)
	latestUserIndex := -1
	for index, message := range messages {
		if message.Role == "system" {
			current = append(current, routing.PromptMessage{Role: message.Role, Text: message.Content})
		}
		if message.Role == "user" {
			latestUserIndex = index
		}
	}
	if latestUserIndex >= 0 {
		message := messages[latestUserIndex]
		current = append(current, routing.PromptMessage{Role: message.Role, Text: message.Content})
	}
	return current
}

func toRoutingDifficulty(value tenantruntime.RoutingDifficulty) routing.DifficultyRoutes {
	return routing.DifficultyRoutes{
		Simple:  routing.RouteCell{ModelRefs: append([]string(nil), value.Simple.ModelRefs...)},
		Complex: routing.RouteCell{ModelRefs: append([]string(nil), value.Complex.ModelRefs...)},
	}
}

func (e *PreparedExecution) Relay(ctx context.Context, emit EventEmitter) error {
	if e == nil || e.stream == nil || e.usage == nil || e.providers == nil || emit == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	defer e.Close()
attemptLoop:
	for {
		result := e.relayAttempt(ctx, emit)
		if result.err == nil && result.usage != nil {
			settlement, err := e.finalizeConfirmed(ctx, result.usage, "succeeded")
			if err != nil {
				return e.emitAccountingFailure(emit, err)
			}
			e.storeConfirmedPrimaryCache(ctx)
			return e.emitEvent(emit, e.finalEvent(settlement, "succeeded", nil, false))
		}

		outcome := attemptOutcome(result.err, result.deltaCount)
		if result.err == nil {
			outcome = attemptOutcome(tenantchat.ErrUsageGuardUnavailable, result.deltaCount)
		}
		if result.usage == nil {
			settlement, err := e.finalizePending(ctx, outcome)
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
			restrictedFallback := false
			for {
				fallbackRoute, ok := e.nextFallbackRoute()
				if !ok {
					if restrictedFallback {
						settlement, settleErr := e.finalizeConfirmed(ctx, result.usage, outcome)
						if settleErr != nil {
							return e.emitAccountingFailure(emit, settleErr)
						}
						return e.emitEvent(emit, e.finalEvent(
							settlement, "failed", completionErrorFor(tenantchat.ErrNoEligibleRoute), false,
						))
					}
					break
				}
				started, restricted, preCallSettlement, openErr := e.openFallback(
					ctx, fallbackRoute, confirmed, outcome,
				)
				if restricted {
					restrictedFallback = true
					continue
				}
				if openErr == nil {
					continue attemptLoop
				}
				if started {
					settlement, settleErr := e.finalizePending(ctx, attemptOutcome(openErr, 0))
					if settleErr != nil {
						return e.emitAccountingFailure(emit, settleErr)
					}
					return e.emitEvent(emit, e.finalEvent(settlement, terminalOutcomeForError(openErr), completionErrorFor(openErr), false))
				}
				if preCallSettlement != nil {
					return e.emitEvent(emit, e.finalEvent(
						*preCallSettlement, terminalOutcomeForError(openErr), completionErrorFor(openErr), false,
					))
				}
				settlement, settleErr := e.finalizeConfirmed(ctx, result.usage, outcome)
				if settleErr != nil {
					return e.emitAccountingFailure(emit, settleErr)
				}
				return e.emitEvent(emit, e.finalEvent(settlement, "failed", completionErrorFor(openErr), false))
			}
			settlement, err := e.finalizeConfirmed(ctx, result.usage, outcome)
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
		if e.attemptNo == 1 && e.cacheEligible {
			e.cacheResponse = append(e.cacheResponse, event.Delta)
		}
		if err := e.emitEvent(emit, e.deltaEvent(event.Delta)); err != nil {
			result.err = err
			result.clientWrite = true
			return result
		}
		result.deltaCount++
	}
}

func (e *PreparedExecution) openFallback(
	ctx context.Context,
	route tenantchat.SelectedRoute,
	previousUsage tenantchat.ConfirmedUsage,
	previousOutcome string,
) (bool, bool, *tenantchat.UsageSettlement, error) {
	e.closeCurrentStream()
	e.cacheResponse = nil
	e.attemptNo++
	fallbackCtx, fallbackCancel := detachedAccountingContext(ctx)
	restricted, err := e.usage.BeginFallback(
		fallbackCtx, e.requestContext, e.snapshot, e.reservation.ReservationID,
		e.attemptNo-1, previousUsage, previousOutcome, route, e.attemptNo,
	)
	fallbackCancel()
	if err != nil {
		e.attemptNo--
		return false, false, nil, err
	}
	if restricted {
		e.attemptNo--
		e.usedRouteIDs[route.RouteID] = struct{}{}
		return false, true, nil, nil
	}
	if len(e.snapshot.Policies.ProviderTokenRate.Providers) > 0 {
		if e.tokenRate == nil || e.preCall == nil {
			return false, false, nil, tenantchat.ErrUsageGuardUnavailable
		}
		decision, rateErr := e.tokenRate.Check(ctx, e.requestContext, e.snapshot, route)
		if rateErr != nil || !decision.Allowed {
			terminalOutcome := "rate_limited"
			if rateErr != nil {
				terminalOutcome = "failed"
			}
			settleCtx, settleCancel := detachedAccountingContext(ctx)
			settlement, settleErr := e.preCall.FinalizePreCall(
				settleCtx, e.requestContext, e.reservation.ReservationID, e.attemptNo, terminalOutcome,
			)
			settleCancel()
			if settleErr != nil {
				return false, false, nil, tenantchat.ErrUsageGuardUnavailable
			}
			if rateErr != nil {
				return false, false, &settlement, rateErr
			}
			return false, false, &settlement, tenantchat.ErrRateLimited
		}
	}
	streamDuration, durationErr := e.snapshot.Policies.Streaming.Duration()
	if durationErr != nil {
		return false, false, nil, tenantchat.ErrRuntimeUnavailable
	}
	streamCtx, cancel := context.WithTimeout(ctx, streamDuration)
	stream, startStatus, err := e.providers.OpenStream(streamCtx, e.requestContext, route, e.input)
	if err != nil {
		cancel()
		e.route = route
		e.usedRouteIDs[route.RouteID] = struct{}{}
		if startStatus == tenantchat.ProviderCallNotStarted && e.preCall != nil {
			settleCtx, settleCancel := detachedAccountingContext(ctx)
			settlement, settleErr := e.preCall.FinalizePreCall(
				settleCtx, e.requestContext, e.reservation.ReservationID, e.attemptNo, "failed",
			)
			settleCancel()
			if settleErr != nil {
				return false, false, nil, tenantchat.ErrUsageGuardUnavailable
			}
			return false, false, &settlement, err
		}
		return true, false, nil, err
	}
	dispatchCtx, dispatchCancel := detachedAccountingContext(ctx)
	dispatchErr := e.usage.MarkDispatched(
		dispatchCtx, e.requestContext, e.reservation.ReservationID, e.attemptNo,
	)
	dispatchCancel()
	if dispatchErr != nil {
		cancel()
		_ = stream.Close()
		e.route = route
		e.usedRouteIDs[route.RouteID] = struct{}{}
		return true, false, nil, dispatchErr
	}
	e.stream = stream
	e.cancel = cancel
	e.route = route
	e.usedRouteIDs[route.RouteID] = struct{}{}
	return true, false, nil, nil
}

func (e *PreparedExecution) canFallback(err error) bool {
	if errors.Is(err, context.Canceled) {
		return false
	}
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
	if e.requestContext.Routing != nil {
		for _, modelRef := range e.requestContext.Routing.CandidateModelRefs {
			route, ok := resolveSnapshotModelRef(e.snapshot, modelRef)
			if !ok {
				continue
			}
			if _, exists := e.usedRouteIDs[route.RouteID]; !exists {
				return route, true
			}
		}
		return tenantchat.SelectedRoute{}, false
	}
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

func resolveSnapshotModelRef(snapshot tenantruntime.Snapshot, modelRef string) (tenantchat.SelectedRoute, bool) {
	for _, route := range snapshot.Policies.Routing.Routes {
		if route.Enabled && route.ModelRef == modelRef {
			return resolveSnapshotRoute(snapshot, route.RouteID)
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
				PricingStatus:                          price.PricingStatus,
				InputMicroUSDPerMillionTokens:          price.InputMicroUSDPerMillionTokens,
				OutputMicroUSDPerMillionTokens:         price.OutputMicroUSDPerMillionTokens,
				CacheReadInputMicroUSDPerMillionTokens: price.CacheReadInputMicroUSDPerMillionTokens,
			}, true
		}
	}
	return tenantchat.SelectedRoute{}, false
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

func (e *PreparedExecution) finalizePending(ctx context.Context, outcome string) (tenantchat.UsageSettlement, error) {
	settleCtx, cancel := detachedAccountingContext(ctx)
	defer cancel()
	return e.usage.MarkPending(
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
	case errors.Is(err, tenantchat.ErrRateLimited):
		return &tenantchat.CompletionError{Code: "CHAT_RATE_LIMITED", Message: "Tenant chat provider token rate was reached.", RetryAfterSeconds: 1}
	case errors.Is(err, tenantchat.ErrNoEligibleRoute):
		return &tenantchat.CompletionError{Code: "CHAT_NO_ELIGIBLE_ROUTE", Message: "Tenant chat has no eligible route.", RetryAfterSeconds: 1}
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
	e.cacheResponse = nil
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

func (e *PreparedExecution) storeConfirmedPrimaryCache(ctx context.Context) {
	if e == nil || e.cache == nil || e.attemptNo != 1 || !e.cacheEligible {
		e.cacheResponse = nil
		return
	}
	response := strings.Join(e.cacheResponse, "")
	e.cacheResponse = nil
	if response == "" {
		return
	}
	cacheCtx, cancel := detachedAccountingContext(ctx)
	defer cancel()
	_ = e.cache.Put(cacheCtx, e.requestContext, e.snapshot, e.input, tenantchat.ExactCacheEntry{
		ResponseText: response, EffectiveModelKey: e.route.ModelKey,
	})
}

func (e *PreparedExecution) IsReplay() bool { return false }

func (e *CacheExecution) Relay(_ context.Context, emit EventEmitter) error {
	if e == nil || emit == nil || e.emitted || e.entry.ResponseText == "" || e.entry.EffectiveModelKey == "" {
		return tenantchat.ErrUsageGuardUnavailable
	}
	e.emitted = true
	if e.metrics != nil {
		e.metrics.AddCounter(
			metrics.TenantChatCompletionTotal,
			[]metrics.Label{{Name: "outcome", Value: "cache_hit"}}, 1,
		)
	}
	modelKey := e.entry.EffectiveModelKey
	replayed := e.replayed
	if err := emit(tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventDelta, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: 1, Delta: e.entry.ResponseText,
	}); err != nil {
		return err
	}
	return emit(tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventFinal, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: 2, TerminalOutcome: "succeeded", EffectiveModelKey: &modelKey,
		Usage:      &tenantchat.CompletionUsage{UsageQuality: "confirmed"},
		QuotaState: "normal", BudgetState: "normal", CacheOutcome: "hit", Replayed: &replayed,
	})
}

func (e *CacheExecution) Close() {
	if e != nil {
		e.entry.ResponseText = ""
	}
}

func (e *CacheExecution) IsReplay() bool { return e != nil && e.replayed }

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
	e.recordCompletionOutcome(terminalOutcome)
	e.sequence++
	modelKey := e.route.ModelKey
	usageQuality := "confirmed"
	inputTokens := settlement.ConfirmedInputTokens
	outputTokens := settlement.ConfirmedOutputTokens
	if settlement.State == "unconfirmed" || settlement.State == "pending_unconfirmed" {
		usageQuality = "pending_unconfirmed"
		inputTokens = 0
		outputTokens = 0
	} else if settlement.State == "released" {
		usageQuality = "not_available"
	}
	cacheOutcome := "off"
	if e.cacheEligible {
		cacheOutcome = "miss"
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
		CacheOutcome: cacheOutcome, Replayed: &replayed, Error: completionErr,
	}
}

func (e *PreparedExecution) emitAccountingFailure(emit EventEmitter, accountingErr error) error {
	e.recordCompletionOutcome("accounting_failed")
	replayed := false
	modelKey := e.route.ModelKey
	e.sequence++
	cacheOutcome := "off"
	if e.cacheEligible {
		cacheOutcome = "miss"
	}
	event := tenantchat.CompletionEvent{
		Type: tenantchat.CompletionEventFinal, SchemaVersion: 1,
		RequestID: e.requestContext.RequestID, TurnID: e.requestContext.TurnID,
		Sequence: e.sequence, TerminalOutcome: "failed", EffectiveModelKey: &modelKey,
		Usage:      &tenantchat.CompletionUsage{UsageQuality: "not_available"},
		QuotaState: e.reservation.QuotaState, BudgetState: e.reservation.BudgetState,
		CacheOutcome: cacheOutcome, Replayed: &replayed,
		Error: &tenantchat.CompletionError{Code: "CHAT_USAGE_GUARD_UNAVAILABLE", Message: "Tenant chat usage guard is unavailable.", RetryAfterSeconds: 1},
	}
	if err := e.emitEvent(emit, event); err != nil {
		return err
	}
	return accountingErr
}

func (s *Service) recordCompletionOutcome(outcome string) {
	if s == nil || s.metrics == nil {
		return
	}
	s.metrics.AddCounter(
		metrics.TenantChatCompletionTotal,
		[]metrics.Label{{Name: "outcome", Value: outcome}}, 1,
	)
}

func (e *PreparedExecution) recordCompletionOutcome(outcome string) {
	if e == nil || e.metrics == nil {
		return
	}
	e.metrics.AddCounter(
		metrics.TenantChatCompletionTotal,
		[]metrics.Label{{Name: "outcome", Value: outcome}}, 1,
	)
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
	} else if e.settlement.State == "unconfirmed" || e.settlement.State == "pending_unconfirmed" {
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
