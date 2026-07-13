package employeepolicystage

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/request"
)

const StageName = "resolve_employee_policy"

type Stage struct {
	resolver employeepolicy.Resolver
	now      func() time.Time
}

func NewStage(resolver employeepolicy.Resolver) *Stage {
	return &Stage{resolver: resolver, now: time.Now}
}

func (s *Stage) Name() string {
	return StageName
}

func (s *Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	if gatewayCtx == nil {
		return gatewayerrors.InternalError(StageName, "Gateway context is not initialized.", nil)
	}
	actorID := gatewayCtx.Identity.TrustedActorID
	if actorID == "" {
		return nil
	}
	if s == nil || s.resolver == nil {
		return fail(gatewayCtx, employeepolicy.ErrUnavailable)
	}
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	policy, err := s.resolver.Resolve(ctx, employeepolicy.ResolveRequest{
		TenantID:  gatewayCtx.Identity.TenantID,
		ProjectID: gatewayCtx.Identity.ProjectID,
		ActorID:   actorID,
		Now:       now,
	})
	if errors.Is(err, employeepolicy.ErrNotFound) {
		return nil
	}
	if err != nil {
		return fail(gatewayCtx, err)
	}
	policy = employeepolicy.Normalize(policy)
	if policy.EmployeeID == "" ||
		policy.TenantID != gatewayCtx.Identity.TenantID ||
		policy.ProjectID != gatewayCtx.Identity.ProjectID {
		return fail(gatewayCtx, employeepolicy.ErrNotFound)
	}

	gatewayCtx.Identity.EmployeeID = policy.EmployeeID
	gatewayCtx.Identity.EndUserID = policy.EmployeeID
	gatewayCtx.Runtime.EmployeePolicy = policy
	gatewayCtx.Runtime.HasEmployeePolicy = true
	decision := employeepolicy.Evaluate(policy)
	gatewayCtx.Governance.EmployeePolicyDecision = &decision
	return nil
}

func fail(gatewayCtx *request.GatewayContext, err error) error {
	gatewayCtx.SetError(500, "internal_error", "Gateway employee policy resolution failed.", StageName)
	gatewayCtx.BypassCache()
	return gatewayerrors.InternalError(StageName, "Gateway employee policy resolution failed.", err)
}
