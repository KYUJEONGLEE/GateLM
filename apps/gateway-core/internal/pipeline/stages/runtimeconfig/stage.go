package runtimeconfigstage

import (
	"context"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

const StageName = "load_active_runtime_config"

type Stage struct {
	provider runtimeconfig.Provider
}

func NewStage(provider runtimeconfig.Provider) *Stage {
	return &Stage{provider: provider}
}

func (s *Stage) Name() string {
	return StageName
}

func (s *Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	if gatewayCtx == nil {
		return gatewayerrors.InternalError(StageName, "Gateway context is not initialized.", nil)
	}
	if s == nil || s.provider == nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway runtime config provider is not initialized.", StageName)
		setCacheBypass(gatewayCtx)
		return gatewayerrors.InternalError(StageName, "Gateway runtime config provider is not initialized.", nil)
	}

	config, err := s.provider.GetActiveConfig(
		ctx,
		gatewayCtx.Identity.TenantID,
		gatewayCtx.Identity.ProjectID,
		gatewayCtx.Identity.ApplicationID,
	)
	if err != nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway active runtime config load failed.", StageName)
		setCacheBypass(gatewayCtx)
		return gatewayerrors.InternalError(StageName, "Gateway active runtime config load failed.", err)
	}

	config = config.Normalize()
	if err := config.ValidateActive(); err != nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway active runtime config is invalid.", StageName)
		setCacheBypass(gatewayCtx)
		return gatewayerrors.InternalError(StageName, "Gateway active runtime config is invalid.", err)
	}
	gatewayCtx.Runtime = request.RuntimeContext{
		ConfigHash:         config.ConfigHash,
		SecurityPolicyHash: config.SafetyPolicy.SecurityPolicyHash,
		RoutingPolicyHash:  config.RoutingPolicy.RoutingPolicyHash,
		RateLimitConfig:    config.RateLimit,
		HasRateLimitConfig: true,
		RoutingPolicy:      config.RoutingPolicy,
		HasRoutingPolicy:   true,
		CachePolicy:        config.CachePolicy,
		HasCachePolicy:     true,
	}

	gatewayCtx.Masking.SecurityPolicyVersionID = config.SafetyPolicy.SecurityPolicyHash
	gatewayCtx.Routing.RoutingPolicyHash = config.RoutingPolicy.RoutingPolicyHash
	return nil
}

func setCacheBypass(gatewayCtx *request.GatewayContext) {
	gatewayCtx.Cache.CacheStatus = "bypass"
	gatewayCtx.Cache.CacheType = "none"
	gatewayCtx.Cache.CacheKeyHash = ""
	gatewayCtx.Cache.CacheHitRequestID = ""
	gatewayCtx.Cache.SavedCostMicroUSD = 0
}
