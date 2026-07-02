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
	provider runtimeconfig.SnapshotProvider
}

func NewStage(provider runtimeconfig.SnapshotProvider) *Stage {
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

	snapshot, err := s.provider.GetExecutionSnapshot(
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

	snapshot = snapshot.Normalize(time.Now().UTC(), runtimeconfig.DefaultGatewayInstanceIDCompat)
	if err := snapshot.Validate(); err != nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway active runtime config is invalid.", StageName)
		gatewayCtx.BypassCache()
		return gatewayerrors.InternalError(StageName, "Gateway active runtime config is invalid.", err)
	}
	if !snapshot.MatchesScope(
		gatewayCtx.Identity.TenantID,
		gatewayCtx.Identity.ProjectID,
		gatewayCtx.Identity.ApplicationID,
	) {
		gatewayCtx.SetError(500, "internal_error", "Gateway active runtime config scope mismatch.", StageName)
		gatewayCtx.BypassCache()
		return gatewayerrors.InternalError(StageName, "Gateway active runtime config scope mismatch.", runtimeconfig.ErrScopeMismatch)
	}

	gatewayCtx.Budget = snapshot.BudgetScope
	gatewayCtx.Runtime = request.RuntimeContext{
		ConfigHash:         snapshot.ConfigHash,
		SecurityPolicyHash: snapshot.SafetyPolicy.SecurityPolicyHash,
		RoutingPolicyHash:  snapshot.RoutingPolicy.RoutingPolicyHash,
		Snapshot:           snapshot.Snapshot,
		RateLimitConfig:    snapshot.RateLimit,
		HasRateLimitConfig: true,
		BudgetPolicy:       snapshot.BudgetPolicy,
		HasBudgetPolicy:    true,
		RoutingPolicy:      snapshot.RoutingPolicy,
		HasRoutingPolicy:   true,
		CachePolicy:        snapshot.CachePolicy,
		HasCachePolicy:     true,
		PromptCapture:      snapshot.PromptCapture,
		HasPromptCapture:   true,
	}

	gatewayCtx.Masking.SecurityPolicyVersionID = snapshot.SafetyPolicy.SecurityPolicyHash
	gatewayCtx.Routing.RoutingPolicyHash = snapshot.RoutingPolicy.RoutingPolicyHash
	return nil
}
