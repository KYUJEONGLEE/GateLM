package ratelimitstage

import (
	"context"
	"time"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/request"
)

const StageName = "check_rate_limit"

type Stage struct {
	limiter ratelimit.Limiter
	config  ratelimit.Config
	now     func() time.Time
}

func NewStage(limiter ratelimit.Limiter, config ratelimit.Config) *Stage {
	return &Stage{
		limiter: limiter,
		config:  ratelimit.NormalizeConfig(config),
		now:     time.Now,
	}
}

func (s *Stage) Name() string {
	return StageName
}

func (s *Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	if gatewayCtx == nil {
		return gatewayerrors.InternalError(StageName, "Gateway context is not initialized.", nil)
	}
	if s == nil || s.limiter == nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway rate limiter is not initialized.", StageName)
		setCacheBypass(gatewayCtx)
		return gatewayerrors.InternalError(StageName, "Gateway rate limiter is not initialized.", nil)
	}

	nowFn := s.now
	if nowFn == nil {
		nowFn = time.Now
	}
	startedAt := time.Now()
	config := s.config
	if gatewayCtx.Runtime.HasRateLimitConfig {
		config = gatewayCtx.Runtime.RateLimitConfig
	}
	rateLimitReq := ratelimit.Request{
		TenantID:      gatewayCtx.Identity.TenantID,
		ProjectID:     gatewayCtx.Identity.ProjectID,
		ApplicationID: gatewayCtx.Identity.ApplicationID,
		Config:        config,
		Now:           nowFn(),
	}
	decision, err := s.limiter.Check(ctx, rateLimitReq)
	if decision.DurationMS == 0 {
		decision.DurationMS = time.Since(startedAt).Milliseconds()
	}
	decision = ratelimit.NormalizeDecision(decision, rateLimitReq)
	gatewayCtx.Governance.RateLimitDecision = &decision

	if err != nil {
		decision.Allowed = false
		decision.Reason = ratelimit.ReasonInternalError
		decision = ratelimit.NormalizeDecision(decision, rateLimitReq)
		gatewayCtx.Governance.RateLimitDecision = &decision
		gatewayCtx.SetError(500, "internal_error", "Gateway rate limit check failed.", StageName)
		setCacheBypass(gatewayCtx)
		return gatewayerrors.InternalError(StageName, "Gateway rate limit check failed.", err)
	}
	if decision.Allowed {
		return nil
	}

	setCacheBypass(gatewayCtx)
	switch decision.Reason {
	case ratelimit.ReasonLimitExceeded:
		gatewayCtx.Status.Status = "rate_limited"
		gatewayCtx.Status.HTTPStatus = 429
		gatewayCtx.Status.ErrorCode = "rate_limited"
		gatewayCtx.Status.ErrorMessage = "Rate limit exceeded."
		gatewayCtx.Status.ErrorStage = StageName
		return gatewayerrors.RateLimited(StageName)
	default:
		gatewayCtx.SetError(500, "internal_error", "Gateway rate limit check failed.", StageName)
		return gatewayerrors.InternalError(StageName, "Gateway rate limit check failed.", nil)
	}
}

func setCacheBypass(gatewayCtx *request.GatewayContext) {
	gatewayCtx.Cache.CacheStatus = "bypass"
	gatewayCtx.Cache.CacheType = "none"
	gatewayCtx.Cache.CacheKeyHash = ""
	gatewayCtx.Cache.CacheHitRequestID = ""
	gatewayCtx.Cache.SavedCostMicroUSD = 0
}
