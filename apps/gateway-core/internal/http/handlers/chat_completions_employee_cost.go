package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/ports"
)

const employeeCostTransitionTimeout = 3 * time.Second

type employeeCostAttemptState string

const (
	employeeCostAttemptInactive  employeeCostAttemptState = "inactive"
	employeeCostAttemptPreCall   employeeCostAttemptState = "pre_call"
	employeeCostAttemptConfirmed employeeCostAttemptState = "confirmed"
	employeeCostAttemptPending   employeeCostAttemptState = "pending"
)

type employeeCostAttemptLifecycle struct {
	accounting ports.ProjectEmployeeCostAccounting
	session    *ports.EmployeeCostReservation
	tracker    *provider.DispatchTracker
	hookErr    error
}

func (h *ChatCompletionsHandler) reserveProjectEmployeeCost(
	ctx context.Context,
	w http.ResponseWriter,
	reqCtx *pipeline.RequestContext,
	chatReq provider.ChatCompletionRequest,
	redactedPrompt string,
	target providerCallTarget,
	startedAt time.Time,
) (*ports.EmployeeCostReservation, providerCallTarget, bool) {
	if h.ProjectEmployeeCostAccounting == nil {
		return nil, target, false
	}
	maxOutput, invalid := employeeCostMaxOutput(chatReq, target.MaxOutputTokens)
	if invalid {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusBadRequest, "invalid_request_error", "max_tokens exceeds the selected model capability.", "reserve_employee_cost")
		return nil, target, true
	}
	estimatedInput, err := employeeCostEstimatedInput(chatReq.Messages)
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway employee cost input could not be prepared.", "reserve_employee_cost")
		return nil, target, true
	}
	reservation, err := h.ProjectEmployeeCostAccounting.Reserve(ctx, h.employeeCostReserveRequest(reqCtx, target, estimatedInput, maxOutput, false))
	if err != nil || reservation.GuardUnavailable {
		h.writeEmployeeCostGuardUnavailable(w, reqCtx)
		return nil, target, true
	}
	if !reservation.RestrictHighCost {
		return &reservation, target, false
	}
	if !strings.EqualFold(strings.TrimSpace(reqCtx.RequestedModel), "auto") {
		h.writeEmployeeCostRouteRestricted(w, reqCtx)
		return nil, target, true
	}

	lowerTarget, found := h.resolveLowerCostTarget(ctx, reqCtx, target, chatReq)
	if !found {
		h.writeEmployeeCostRouteRestricted(w, reqCtx)
		return nil, target, true
	}
	h.applyResolvedProviderTarget(reqCtx, lowerTarget)
	cachePayload, cacheHitRequestID, savedCostMicroUSD, cacheHit := h.lookupExactCache(ctx, reqCtx, chatReq, redactedPrompt)
	lowerGatewayCtx := newGatewayContext(reqCtx, redactedPrompt, nil)
	applyExactCacheLookupToGatewayContext(lowerGatewayCtx, reqCtx, cachePayload, cacheHitRequestID, savedCostMicroUSD, cacheHit)
	if h.writeCachedChatCompletionIfHit(ctx, w, reqCtx, lowerGatewayCtx, startedAt) {
		return nil, lowerTarget, true
	}

	maxOutput, invalid = employeeCostMaxOutput(chatReq, lowerTarget.MaxOutputTokens)
	if invalid {
		h.writeEmployeeCostRouteRestricted(w, reqCtx)
		return nil, lowerTarget, true
	}
	reservation, err = h.ProjectEmployeeCostAccounting.Reserve(ctx, h.employeeCostReserveRequest(reqCtx, lowerTarget, estimatedInput, maxOutput, true))
	if err != nil || reservation.GuardUnavailable {
		h.writeEmployeeCostGuardUnavailable(w, reqCtx)
		return nil, lowerTarget, true
	}
	if reservation.RestrictHighCost || !reservation.Active {
		h.writeEmployeeCostRouteRestricted(w, reqCtx)
		return nil, lowerTarget, true
	}
	return &reservation, lowerTarget, false
}

func (h *ChatCompletionsHandler) employeeCostReserveRequest(reqCtx *pipeline.RequestContext, target providerCallTarget, estimatedInput, maxOutput int64, restricted bool) ports.EmployeeCostReserveRequest {
	return ports.EmployeeCostReserveRequest{
		TenantID: reqCtx.TenantID, EmployeeID: reqCtx.EmployeeID, RequestID: reqCtx.RequestID,
		CandidateTier: target.CostTier, RestrictedFromHigh: restricted,
		ProviderID: firstNonEmpty(target.ProviderID, target.ProviderName), ModelKey: target.ModelName,
		ProviderPricingKeys: providerPricingKeys(reqCtx, target), ModelPricingKeys: modelPricingKeys(reqCtx, target),
		EstimatedInputTokens: estimatedInput, MaxOutputTokens: maxOutput,
		DispatchIntentExpiresAt: time.Now().UTC().Add(employeeCostDispatchWindow(target)),
	}
}

func (h *ChatCompletionsHandler) topUpProjectEmployeeCost(ctx context.Context, reqCtx *pipeline.RequestContext, chatReq provider.ChatCompletionRequest, target providerCallTarget, session *ports.EmployeeCostReservation) (ports.EmployeeCostAttemptDecision, error) {
	if h.ProjectEmployeeCostAccounting == nil || session == nil || !session.Active {
		return ports.EmployeeCostAttemptDecision{}, nil
	}
	maxOutput, invalid := employeeCostMaxOutput(chatReq, target.MaxOutputTokens)
	if invalid {
		return ports.EmployeeCostAttemptDecision{GuardUnavailable: true}, employeecost.ErrGuardUnavailable
	}
	estimatedInput, err := employeeCostEstimatedInput(chatReq.Messages)
	if err != nil {
		return ports.EmployeeCostAttemptDecision{}, err
	}
	return h.ProjectEmployeeCostAccounting.TopUp(ctx, session, ports.EmployeeCostTopUpRequest{
		CandidateTier: target.CostTier,
		ProviderID:    firstNonEmpty(target.ProviderID, target.ProviderName), ModelKey: target.ModelName,
		ProviderPricingKeys: providerPricingKeys(reqCtx, target), ModelPricingKeys: modelPricingKeys(reqCtx, target),
		EstimatedInputTokens: estimatedInput, MaxOutputTokens: maxOutput,
		DispatchIntentExpiresAt: time.Now().UTC().Add(employeeCostDispatchWindow(target)),
	})
}

func (h *ChatCompletionsHandler) newEmployeeCostAttempt(session *ports.EmployeeCostReservation, request *provider.ChatCompletionRequest) *employeeCostAttemptLifecycle {
	if h.ProjectEmployeeCostAccounting == nil || session == nil || !session.Active || request == nil {
		return nil
	}
	lifecycle := &employeeCostAttemptLifecycle{
		accounting: h.ProjectEmployeeCostAccounting, session: session, tracker: &provider.DispatchTracker{},
	}
	request.DispatchTracker = lifecycle.tracker
	request.BeforeDispatch = func(ctx context.Context) error {
		lifecycle.hookErr = lifecycle.accounting.MarkDispatched(ctx, lifecycle.session)
		return lifecycle.hookErr
	}
	return lifecycle
}

func (l *employeeCostAttemptLifecycle) Complete(ctx context.Context, usage *provider.Usage, callErr error) (employeeCostAttemptState, error) {
	if l == nil || l.accounting == nil || l.session == nil || !l.session.Active {
		return employeeCostAttemptInactive, nil
	}
	transitionCtx, cancel := employeeCostContext(ctx)
	defer cancel()
	if l.hookErr != nil {
		if err := l.accounting.RecordPreCallFailure(transitionCtx, l.session); err != nil {
			return employeeCostAttemptPreCall, err
		}
		return employeeCostAttemptPreCall, l.hookErr
	}
	dispatchNotStarted := provider.IsDispatchNotStarted(callErr) || (l.tracker.Observed() && !l.tracker.Started())
	if callErr != nil && dispatchNotStarted {
		if err := l.accounting.RecordPreCallFailure(transitionCtx, l.session); err != nil {
			return employeeCostAttemptPreCall, err
		}
		return employeeCostAttemptPreCall, nil
	}
	if !l.tracker.Started() {
		if err := l.accounting.MarkDispatched(transitionCtx, l.session); err != nil {
			return employeeCostAttemptPending, err
		}
	}
	if usage != nil {
		outcome := employeecost.AttemptOutcomeSucceeded
		if callErr != nil {
			outcome = employeecost.AttemptOutcomeFailedPostDelta
		}
		if err := l.accounting.RecordConfirmed(transitionCtx, l.session, ports.EmployeeCostUsage{
			InputTokens: int64(usage.PromptTokens), OutputTokens: int64(usage.CompletionTokens),
			CacheReadInputTokens: int64(usage.CacheReadInputTokens),
		}, outcome); err != nil {
			return employeeCostAttemptConfirmed, err
		}
		l.session.HasConfirmed = true
		return employeeCostAttemptConfirmed, nil
	}
	outcome := employeecost.AttemptOutcomeSucceeded
	if callErr != nil {
		outcome = employeeCostPendingOutcome(callErr)
	}
	if err := l.accounting.MarkPending(transitionCtx, l.session, outcome); err != nil {
		return employeeCostAttemptPending, err
	}
	return employeeCostAttemptPending, nil
}

func (h *ChatCompletionsHandler) settleProjectEmployeeCost(ctx context.Context, reqCtx *pipeline.RequestContext, session *ports.EmployeeCostReservation) error {
	if h.ProjectEmployeeCostAccounting == nil || session == nil || !session.Active || session.HasPending {
		return nil
	}
	transitionCtx, cancel := employeeCostContext(ctx)
	defer cancel()
	cost, err := h.ProjectEmployeeCostAccounting.Settle(transitionCtx, session)
	if err == nil {
		reqCtx.CostMicroUSD = cost
	}
	return err
}

func (h *ChatCompletionsHandler) releaseProjectEmployeeCost(ctx context.Context, session *ports.EmployeeCostReservation) error {
	if h.ProjectEmployeeCostAccounting == nil || session == nil || !session.Active || session.HasPending {
		return nil
	}
	transitionCtx, cancel := employeeCostContext(ctx)
	defer cancel()
	return h.ProjectEmployeeCostAccounting.Release(transitionCtx, session)
}

func (h *ChatCompletionsHandler) finalizeFailedProjectEmployeeCost(ctx context.Context, reqCtx *pipeline.RequestContext, session *ports.EmployeeCostReservation) error {
	if h.ProjectEmployeeCostAccounting == nil || session == nil || !session.Active || session.HasPending {
		return nil
	}
	if session.HasConfirmed {
		return h.settleProjectEmployeeCost(ctx, reqCtx, session)
	}
	return h.releaseProjectEmployeeCost(ctx, session)
}

func (h *ChatCompletionsHandler) resolveLowerCostTarget(ctx context.Context, reqCtx *pipeline.RequestContext, primary providerCallTarget, chatReq provider.ChatCompletionRequest) (providerCallTarget, bool) {
	for _, modelRef := range reqCtx.CandidateModelRefs {
		catalogProvider, catalogModel, err := primary.Catalog.ResolveModelRef(strings.TrimSpace(modelRef))
		if err != nil || catalogModel.Routing.CostTier == employeecost.ProjectCostTierPremium ||
			employeecost.ClassifyCandidate(employeecost.SurfaceProjectApplication, catalogModel.Routing.CostTier) != employeecost.CandidateCostClassLower {
			continue
		}
		candidate, err := h.providerCallTargetFromCatalog(ctx, primary.Catalog, catalogProvider, catalogModel, false)
		if err != nil || candidate.MaxOutputTokens <= 0 {
			continue
		}
		if _, invalid := employeeCostMaxOutput(chatReq, candidate.MaxOutputTokens); invalid {
			continue
		}
		return candidate, true
	}
	return providerCallTarget{}, false
}

func (h *ChatCompletionsHandler) applyResolvedProviderTarget(reqCtx *pipeline.RequestContext, target providerCallTarget) {
	if reqCtx == nil {
		return
	}
	reqCtx.ModelRef = target.ModelRef
	reqCtx.ResolvedTarget = target.ResolvedTarget
	reqCtx.ResolvedProviderName = target.ProviderName
	reqCtx.ResolvedAdapterType = target.AdapterType
	reqCtx.ResolvedProviderCatalogKey = target.ProviderName
	reqCtx.ResolvedCatalogHash = target.CatalogHash
}

func employeeCostEstimatedInput(messages []provider.ChatMessage) (int64, error) {
	total := int64(0)
	for _, message := range messages {
		text, err := chatMessageText(message)
		if err != nil {
			return 0, err
		}
		total += int64(len([]byte(text)))
	}
	if total < 1 {
		total = 1
	}
	return total, nil
}

func employeeCostMaxOutput(request provider.ChatCompletionRequest, catalogMax int) (int64, bool) {
	selected := 0
	if request.MaxCompletionTokens != nil {
		selected = *request.MaxCompletionTokens
	} else if request.MaxTokens != nil {
		selected = *request.MaxTokens
	} else {
		selected = catalogMax
	}
	if selected <= 0 && (request.MaxCompletionTokens != nil || request.MaxTokens != nil) {
		return int64(selected), true
	}
	if catalogMax <= 0 {
		return 0, false
	}
	if selected > catalogMax {
		return int64(selected), true
	}
	return int64(selected), false
}

func employeeCostDispatchWindow(target providerCallTarget) time.Duration {
	if target.ExecutionConfig.Timeout > 0 {
		return target.ExecutionConfig.Timeout
	}
	return 2 * time.Minute
}

func employeeCostPendingOutcome(err error) employeecost.AttemptOutcome {
	if errors.Is(err, context.Canceled) {
		return employeecost.AttemptOutcomeCancelled
	}
	if provider.ErrorKindOf(err) == provider.ErrorKindTimeout || errors.Is(err, context.DeadlineExceeded) {
		return employeecost.AttemptOutcomeTimedOut
	}
	return employeecost.AttemptOutcomeFailedPostDelta
}

func employeeCostContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	} else {
		ctx = context.WithoutCancel(ctx)
	}
	return context.WithTimeout(ctx, employeeCostTransitionTimeout)
}

func (h *ChatCompletionsHandler) writeEmployeeCostGuardUnavailable(w http.ResponseWriter, reqCtx *pipeline.RequestContext) {
	writeGatewayErrorWithContext(w, reqCtx, http.StatusServiceUnavailable, "employee_cost_guard_unavailable", "Employee cost guard is unavailable.", "reserve_employee_cost")
}

func (h *ChatCompletionsHandler) writeEmployeeCostRouteRestricted(w http.ResponseWriter, reqCtx *pipeline.RequestContext) {
	writeGatewayErrorWithContext(w, reqCtx, http.StatusForbidden, "employee_cost_route_restricted", "The selected high-cost route is restricted by employee cost policy.", "reserve_employee_cost")
}
