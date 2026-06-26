package routing

import (
	"context"
	"strings"
)

const DefaultPolicyHash = "routing_policy_p0_v1"

type SimpleRouter struct {
	DefaultProvider string
	DefaultModel    string
	LowCostModel    string
	ShortPromptMax  int
	PolicyHash      string
}

func NewP0SimpleRouter(defaultProvider string, defaultModel string) SimpleRouter {
	if strings.TrimSpace(defaultProvider) == "" {
		defaultProvider = "mock"
	}
	if strings.TrimSpace(defaultModel) == "" {
		defaultModel = "mock-balanced"
	}
	return SimpleRouter{
		DefaultProvider: defaultProvider,
		DefaultModel:    defaultModel,
		LowCostModel:    "mock-fast",
		ShortPromptMax:  120,
		PolicyHash:      DefaultPolicyHash,
	}
}

func (r SimpleRouter) DecideRoute(_ context.Context, req Request) (Decision, error) {
	defaultProvider := strings.TrimSpace(r.DefaultProvider)
	if defaultProvider == "" {
		defaultProvider = "mock"
	}
	defaultModel := strings.TrimSpace(r.DefaultModel)
	if defaultModel == "" {
		defaultModel = "mock-balanced"
	}
	lowCostModel := strings.TrimSpace(r.LowCostModel)
	if lowCostModel == "" {
		lowCostModel = "mock-fast"
	}
	shortPromptMax := r.ShortPromptMax
	if shortPromptMax <= 0 {
		shortPromptMax = 120
	}
	policyHash := strings.TrimSpace(r.PolicyHash)
	if policyHash == "" {
		policyHash = DefaultPolicyHash
	}

	requestedModel := strings.TrimSpace(req.RequestedModel)
	if requestedModel == "" {
		requestedModel = defaultModel
	}

	selectedModel := requestedModel
	reason := "pinned"
	if requestedModel == "auto" {
		selectedModel = defaultModel
		reason = "default"
		if len([]rune(strings.Join(strings.Fields(req.PromptText), " "))) <= shortPromptMax {
			selectedModel = lowCostModel
			reason = "low_cost"
		}
	}

	return Decision{
		RequestedModel:   requestedModel,
		SelectedProvider: defaultProvider,
		SelectedModel:    selectedModel,
		RoutingReason:    reason,
		PolicyHash:       policyHash,
	}, nil
}
