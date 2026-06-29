package runtimeconfigstage

import (
	"context"
	"time"

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
		gatewayCtx.BypassCache()
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
		gatewayCtx.BypassCache()
		return gatewayerrors.InternalError(StageName, "Gateway active runtime config load failed.", err)
	}

	config = config.Normalize()
	if err := config.ValidateActive(); err != nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway active runtime config is invalid.", StageName)
		gatewayCtx.BypassCache()
		return gatewayerrors.InternalError(StageName, "Gateway active runtime config is invalid.", err)
	}
	gatewayCtx.Runtime = request.RuntimeContext{
		ConfigHash:         config.ConfigHash,
		SecurityPolicyHash: config.SafetyPolicy.SecurityPolicyHash,
		RoutingPolicyHash:  config.RoutingPolicy.RoutingPolicyHash,
		Snapshot:           config.RuntimeSnapshotProvenance(time.Now().UTC(), runtimeconfig.DefaultGatewayInstanceIDCompat),
		RateLimitConfig:    config.RateLimit,
		HasRateLimitConfig: true,
		BudgetPolicy:       config.BudgetPolicy,
		HasBudgetPolicy:    true,
		RoutingPolicy:      config.RoutingPolicy,
		HasRoutingPolicy:   true,
		CachePolicy:        config.CachePolicy,
		HasCachePolicy:     true,
	}
	gatewayCtx.Budget = config.BudgetResolution

	gatewayCtx.Masking.SecurityPolicyVersionID = config.SafetyPolicy.SecurityPolicyHash
	gatewayCtx.Routing.RoutingPolicyHash = config.RoutingPolicy.RoutingPolicyHash
	return nil
}
