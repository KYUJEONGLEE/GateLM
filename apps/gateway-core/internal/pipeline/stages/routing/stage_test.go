package routingstage

import (
	"context"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

type fakeRouter struct {
	decision routing.Decision
	request  routing.Request
}

func (r *fakeRouter) DecideRoute(_ context.Context, req routing.Request) (routing.Decision, error) {
	r.request = req
	return r.decision, nil
}

func TestStageWritesRoutingFields(t *testing.T) {
	router := &fakeRouter{
		decision: routing.Decision{
			RequestedModel:   "auto",
			SelectedProvider: "mock",
			SelectedModel:    "mock-fast",
			RoutingReason:    routing.ReasonShortPromptLowCost,
			PolicyHash:       "route_p0_v1",
			CategoryDiagnostics: routing.CategoryDiagnostics{
				SelectedCategory: routing.CategorySupportRefund,
				TopCategory:      routing.CategorySupportRefund,
				TopScore:         5,
				ScoreMargin:      5,
				Confidence:       routing.RoutingConfidenceHigh,
			},
			RoutingDecisionMaterial: routing.DecisionMaterial{
				RoutingMode:   routing.RoutingModeAuto,
				Category:      routing.CategorySupportRefund,
				Tier:          routing.TierLowCost,
				Capability:    routing.CapabilityChat,
				PolicyVariant: routing.PolicyVariantDefault,
			},
		},
	}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "short prompt",
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}

	if gatewayCtx.Routing.RequestedModel != "auto" {
		t.Fatalf("expected requested model to remain auto, got %s", gatewayCtx.Routing.RequestedModel)
	}
	if gatewayCtx.Routing.SelectedProvider != "mock" || gatewayCtx.Routing.SelectedModel != "mock-fast" {
		t.Fatalf("expected mock/mock-fast route, got %s/%s", gatewayCtx.Routing.SelectedProvider, gatewayCtx.Routing.SelectedModel)
	}
	if gatewayCtx.Routing.RoutingReason != routing.ReasonShortPromptLowCost {
		t.Fatalf("expected short prompt routing reason, got %s", gatewayCtx.Routing.RoutingReason)
	}
	if gatewayCtx.Routing.RoutingPolicyHash != "route_p0_v1" {
		t.Fatalf("expected route_p0_v1 policy hash, got %s", gatewayCtx.Routing.RoutingPolicyHash)
	}
	if gatewayCtx.Routing.RoutingDecisionMaterial["category"] != routing.CategorySupportRefund {
		t.Fatalf("expected routing category material to be written, got %#v", gatewayCtx.Routing.RoutingDecisionMaterial)
	}
	if gatewayCtx.Routing.CategoryDiagnostics.TopScore != 5 || gatewayCtx.Routing.CategoryDiagnostics.ScoreMargin != 5 {
		t.Fatalf("expected routing diagnostics to be copied, got %#v", gatewayCtx.Routing.CategoryDiagnostics)
	}
}

func TestStageWritesRoutingCategoryMaterial(t *testing.T) {
	router := &fakeRouter{
		decision: routing.Decision{
			RequestedModel:          "auto",
			SelectedProvider:        "mock",
			SelectedModel:           "mock-fast",
			RoutingReason:           routing.ReasonShortPromptLowCost,
			PolicyHash:              "route_p0_v1",
			RoutingDecisionKeyHash:  "sha256:routing-category-test",
			RoutingDecisionMaterial: routing.DecisionMaterial{Category: routing.CategoryTranslation},
		},
	}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "이 문장을 영어로 번역해줘",
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}

	if gatewayCtx.Routing.RoutingDecisionMaterial["category"] != routing.CategoryTranslation {
		t.Fatalf("routing stage는 decision category를 material map에 보존해야 함: %#v", gatewayCtx.Routing.RoutingDecisionMaterial)
	}
	if gatewayCtx.Routing.RoutingDecisionKeyHash != "sha256:routing-category-test" {
		t.Fatalf("routingDecisionKeyHash 보존 불일치: %q", gatewayCtx.Routing.RoutingDecisionKeyHash)
	}
}

func TestStagePassesRuntimeRoutingPolicyToRouter(t *testing.T) {
	router := &fakeRouter{
		decision: routing.Decision{
			RequestedModel:   "auto",
			SelectedProvider: "mock",
			SelectedModel:    "mock-fast",
			RoutingReason:    routing.ReasonShortPromptLowCost,
			PolicyHash:       "hash_routing_policy_test",
		},
	}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "short prompt",
		},
		Runtime: request.RuntimeContext{
			RoutingPolicy: runtimeconfig.RoutingPolicy{
				DefaultProvider:     "mock",
				DefaultModel:        "mock-balanced",
				LowCostProvider:     "mock-cheap",
				LowCostModel:        "mock-fast",
				HighQualityProvider: "mock-premium",
				HighQualityModel:    "mock-smart",
				FallbackProvider:    "mock",
				FallbackModel:       "mock-fallback",
				ShortPromptMaxChars: 500,
				RoutingPolicyHash:   "hash_routing_policy_test",
			},
			HasRoutingPolicy: true,
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}

	if router.request.Config == nil {
		t.Fatal("expected runtime routing config to be passed")
	}
	if router.request.Config.PolicyHash != "hash_routing_policy_test" || router.request.Config.ShortPromptMaxChars != 500 {
		t.Fatalf("unexpected runtime routing config: %#v", router.request.Config)
	}
	if router.request.Config.LowCostProvider != "mock-cheap" || router.request.Config.LowCostModel != "mock-fast" {
		t.Fatalf("expected low-cost provider/model to be passed to router: %#v", router.request.Config)
	}
	if router.request.Config.HighQualityProvider != "mock-premium" || router.request.Config.HighQualityModel != "mock-smart" {
		t.Fatalf("high quality route must not use fallback model as primary route: %#v", router.request.Config)
	}
}

func TestStagePassesBudgetHighQualityRestrictionToRouter(t *testing.T) {
	router := &fakeRouter{
		decision: routing.Decision{
			RequestedModel:   "auto",
			SelectedProvider: "mock",
			SelectedModel:    "mock-balanced",
			RoutingReason:    routing.ReasonBudgetHighQualityDowngrade,
			PolicyHash:       "route_p0_v1",
		},
	}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "Fix this TypeScript function error.",
		},
		Governance: request.GovernanceContext{
			BudgetDecision: &budget.Decision{Allowed: true, Outcome: budget.OutcomeWarned},
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}
	if !router.request.HighQualityRestricted {
		t.Fatal("expected budget warning to restrict high quality routes")
	}
}

func TestStageDoesNotRestrictHighQualityWhenBudgetPolicyDisablesQualityGuard(t *testing.T) {
	restrictHighQuality := false
	router := &fakeRouter{
		decision: routing.Decision{
			RequestedModel:   "auto",
			SelectedProvider: "mock-premium",
			SelectedModel:    "mock-smart",
			RoutingReason:    routing.ReasonCodeHighQuality,
			PolicyHash:       "route_p0_v1",
		},
	}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "Fix this TypeScript function error.",
		},
		Governance: request.GovernanceContext{
			BudgetDecision: &budget.Decision{
				Allowed: true,
				Outcome: budget.OutcomeWarned,
				Policy: budget.Policy{
					Enabled:                         true,
					EnforcementMode:                 budget.EnforcementModeWarn,
					WarningThresholdPercent:         80,
					RestrictHighQualityOnBudgetRisk: &restrictHighQuality,
				},
			},
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}
	if router.request.HighQualityRestricted {
		t.Fatal("expected disabled budget quality guard to keep high quality routes unrestricted")
	}
}

func TestStageRestrictsHighQualityWhenEmployeeQuotaExceeded(t *testing.T) {
	router := &fakeRouter{decision: routing.Decision{RequestedModel: "auto"}}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{RequestedModel: "auto"},
		Governance: request.GovernanceContext{
			EmployeePolicyDecision: &employeepolicy.Decision{
				QuotaOutcome: employeepolicy.QuotaOutcomeExceeded,
			},
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}
	if !router.request.HighQualityRestricted {
		t.Fatal("expected employee quota exceed to restrict high quality")
	}
}

func TestStageDoesNotRestrictHighQualityAtEmployeeWarningThreshold(t *testing.T) {
	router := &fakeRouter{decision: routing.Decision{RequestedModel: "auto"}}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{RequestedModel: "auto"},
		Governance: request.GovernanceContext{
			EmployeePolicyDecision: &employeepolicy.Decision{
				QuotaOutcome: employeepolicy.QuotaOutcomeWarned,
			},
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}
	if router.request.HighQualityRestricted {
		t.Fatal("employee quota warning must not restrict high quality")
	}
}
