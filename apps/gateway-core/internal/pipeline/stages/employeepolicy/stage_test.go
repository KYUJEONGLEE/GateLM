package employeepolicystage

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
	"gatelm/apps/gateway-core/internal/domain/request"
)

func TestStageCanonicalizesTrustedActorAndEvaluatesQuota(t *testing.T) {
	resolver := &fakeResolver{policy: employeepolicy.Policy{
		TenantID:   "tenant_1",
		ProjectID:  "project_1",
		EmployeeID: "employee_1",
		RateLimit: employeepolicy.RateLimitPolicy{
			Enabled:       true,
			Limit:         5,
			WindowSeconds: 60,
		},
		Quota: employeepolicy.QuotaPolicy{
			Enabled:                 true,
			LimitMicroUSD:           100,
			UsedMicroUSD:            100,
			WarningThresholdPercent: 80,
		},
	}}
	stage := NewStage(resolver)
	gatewayCtx := &request.GatewayContext{Identity: request.IdentityContext{
		TenantID:       "tenant_1",
		ProjectID:      "project_1",
		TrustedActorID: "user_1",
		EndUserID:      "metadata-name-must-not-win",
	}}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected employee policy stage to pass, got %v", err)
	}
	if resolver.request.ActorID != "user_1" {
		t.Fatalf("expected trusted actor lookup, got %#v", resolver.request)
	}
	if gatewayCtx.Identity.EmployeeID != "employee_1" || gatewayCtx.Identity.EndUserID != "employee_1" {
		t.Fatalf("expected canonical employee attribution, got %#v", gatewayCtx.Identity)
	}
	if !gatewayCtx.Runtime.HasEmployeePolicy || gatewayCtx.Governance.EmployeePolicyDecision == nil {
		t.Fatalf("expected policy and decision in context: %#v", gatewayCtx)
	}
	if !employeepolicy.RestrictsHighQuality(gatewayCtx.Governance.EmployeePolicyDecision) {
		t.Fatalf("expected exceeded quota quality guard, got %#v", gatewayCtx.Governance.EmployeePolicyDecision)
	}
}

func TestStageIgnoresUnmatchedActor(t *testing.T) {
	stage := NewStage(&fakeResolver{err: employeepolicy.ErrNotFound})
	gatewayCtx := &request.GatewayContext{Identity: request.IdentityContext{TrustedActorID: "unknown"}}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("unknown actor must preserve legacy behavior, got %v", err)
	}
	if gatewayCtx.Runtime.HasEmployeePolicy || gatewayCtx.Identity.EmployeeID != "" {
		t.Fatalf("unknown actor must not attach employee policy: %#v", gatewayCtx)
	}
}

func TestStageFailsClosedWhenPolicyStoreFails(t *testing.T) {
	stage := NewStage(&fakeResolver{err: errors.New("db unavailable")})
	gatewayCtx := &request.GatewayContext{Identity: request.IdentityContext{TrustedActorID: "actor"}}

	if err := stage.Execute(context.Background(), gatewayCtx); err == nil {
		t.Fatal("expected employee policy store error")
	}
	if gatewayCtx.Status.HTTPStatus != 500 || gatewayCtx.Cache.CacheStatus != "bypass" {
		t.Fatalf("expected fail-closed context, got %#v", gatewayCtx)
	}
}

func TestNilStageFailsClosedWithoutPanicking(t *testing.T) {
	var stage *Stage
	gatewayCtx := &request.GatewayContext{Identity: request.IdentityContext{TrustedActorID: "actor"}}

	if err := stage.Execute(context.Background(), gatewayCtx); err == nil {
		t.Fatal("expected uninitialized employee policy stage error")
	}
	if gatewayCtx.Status.HTTPStatus != 500 || gatewayCtx.Cache.CacheStatus != "bypass" {
		t.Fatalf("expected fail-closed context, got %#v", gatewayCtx)
	}
}

func TestStageRejectsPolicyOutsideAuthenticatedScope(t *testing.T) {
	stage := NewStage(&fakeResolver{policy: employeepolicy.Policy{
		TenantID:   "other_tenant",
		ProjectID:  "project_1",
		EmployeeID: "employee_1",
	}})
	gatewayCtx := &request.GatewayContext{Identity: request.IdentityContext{
		TenantID:       "tenant_1",
		ProjectID:      "project_1",
		TrustedActorID: "actor",
	}}

	if err := stage.Execute(context.Background(), gatewayCtx); err == nil {
		t.Fatal("expected employee policy scope mismatch to fail closed")
	}
	if gatewayCtx.Identity.EmployeeID != "" || gatewayCtx.Runtime.HasEmployeePolicy {
		t.Fatalf("mismatched policy must not be attached: %#v", gatewayCtx)
	}
}

type fakeResolver struct {
	policy  employeepolicy.Policy
	err     error
	request employeepolicy.ResolveRequest
}

func (r *fakeResolver) Resolve(_ context.Context, req employeepolicy.ResolveRequest) (employeepolicy.Policy, error) {
	r.request = req
	return r.policy, r.err
}
