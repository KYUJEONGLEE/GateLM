package routing

import (
	"context"
	"strings"
	"unicode/utf8"
)

const (
	DefaultPolicyHash          = "route_p0_v1"
	DefaultShortPromptMaxChars = 300

	ReasonShortPromptLowCost = "short_prompt_low_cost"
	ReasonDefaultBalanced    = "default_balanced"
	ReasonPinned             = "pinned"
)

type SimpleRouterConfig struct {
	DefaultProvider     string
	DefaultModel        string
	LowCostModel        string
	HighQualityModel    string
	PolicyHash          string
	ShortPromptMaxChars int
}

type SimpleRouter struct {
	defaultProvider     string
	defaultModel        string
	lowCostModel        string
	highQualityModel    string
	policyHash          string
	shortPromptMaxChars int
}

func NewSimpleRouter(config SimpleRouterConfig) *SimpleRouter {
	router := &SimpleRouter{
		defaultProvider:     strings.TrimSpace(config.DefaultProvider),
		defaultModel:        strings.TrimSpace(config.DefaultModel),
		lowCostModel:        strings.TrimSpace(config.LowCostModel),
		highQualityModel:    strings.TrimSpace(config.HighQualityModel),
		policyHash:          strings.TrimSpace(config.PolicyHash),
		shortPromptMaxChars: config.ShortPromptMaxChars,
	}

	if router.defaultProvider == "" {
		router.defaultProvider = "mock"
	}
	if router.defaultModel == "" {
		router.defaultModel = "mock-balanced"
	}
	if router.lowCostModel == "" {
		router.lowCostModel = "mock-fast"
	}
	if router.highQualityModel == "" {
		router.highQualityModel = "mock-smart"
	}
	if router.policyHash == "" {
		router.policyHash = DefaultPolicyHash
	}
	if router.shortPromptMaxChars <= 0 {
		router.shortPromptMaxChars = DefaultShortPromptMaxChars
	}

	return router
}

func (r *SimpleRouter) DecideRoute(ctx context.Context, req Request) (Decision, error) {
	if req.Config != nil {
		return NewSimpleRouter(*req.Config).DecideRoute(ctx, Request{
			RequestedModel: req.RequestedModel,
			PromptText:     req.PromptText,
		})
	}

	requestedModel := strings.TrimSpace(req.RequestedModel)
	if requestedModel == "" {
		requestedModel = r.defaultModel
	}

	decision := Decision{
		RequestedModel:   requestedModel,
		SelectedProvider: r.defaultProvider,
		PolicyHash:       r.policyHash,
	}

	if strings.EqualFold(requestedModel, "auto") {
		if utf8.RuneCountInString(req.PromptText) <= r.shortPromptMaxChars {
			decision.SelectedModel = r.lowCostModel
			decision.RoutingReason = ReasonShortPromptLowCost
			return decision, nil
		}

		decision.SelectedModel = r.defaultModel
		decision.RoutingReason = ReasonDefaultBalanced
		return decision, nil
	}

	decision.SelectedModel = requestedModel
	decision.RoutingReason = ReasonPinned
	return decision, nil
}
