package routing

import (
	"context"
	"errors"
	"strings"
)

const (
	DefaultPolicyHash = "sha256:919261eed2c088bafd316ea0e7f6f8746c332f3ef7766cc5fa97dfe269aec91c"
	MockBootstrapRef  = "mock-balanced"

	BootstrapStateMock       = "mock_bootstrap"
	BootstrapStateConfigured = "configured"

	ReasonMatrixRoute           = "category_difficulty_matrix"
	ReasonManualModelRef        = "manual_model_ref"
	ReasonOrderedHealthFallback = "ordered_model_ref_fallback"
	RouteCandidateAvailable     = "available"
	RouteCandidateDegraded      = "degraded"
	RouteCandidateUnavailable   = "unavailable"
)

var (
	ErrAutoRoutingDisabled = errors.New("auto_routing_disabled")
	ErrNoRouteConfigured   = errors.New("routing route has no model references")
)

type RouteCell struct {
	ModelRefs []string `json:"modelRefs"`
}

type DifficultyRoutes struct {
	Simple  RouteCell `json:"simple"`
	Complex RouteCell `json:"complex"`
}

type RoutingMatrix struct {
	General       DifficultyRoutes `json:"general"`
	Code          DifficultyRoutes `json:"code"`
	Translation   DifficultyRoutes `json:"translation"`
	Summarization DifficultyRoutes `json:"summarization"`
	Reasoning     DifficultyRoutes `json:"reasoning"`
}

type SimpleRouterConfig struct {
	Mode              string                 `json:"mode"`
	BootstrapState    string                 `json:"bootstrapState,omitempty"`
	Routes            RoutingMatrix          `json:"routes"`
	PolicyHash        string                 `json:"routingPolicyHash"`
	CandidateStatuses []RouteCandidateStatus `json:"-"`
}

type RouteCandidateStatus struct {
	ModelRef string
	Status   string
}

type SimpleRouter struct {
	config            SimpleRouterConfig
	promptClassifier  RuleBasedPromptClassifier
	difficultyRuntime DifficultySemanticClassifier
	difficultyShadow  *DifficultySemanticShadowRunner
}

type SimpleRouterOption func(*SimpleRouter)

func WithDifficultySemanticShadow(runner *DifficultySemanticShadowRunner) SimpleRouterOption {
	return func(router *SimpleRouter) {
		router.difficultyShadow = runner
	}
}

func WithDifficultySemanticRuntime(runtime DifficultySemanticClassifier) SimpleRouterOption {
	return func(router *SimpleRouter) {
		router.difficultyRuntime = runtime
	}
}

func NewSimpleRouter(config SimpleRouterConfig, options ...SimpleRouterOption) *SimpleRouter {
	router := &SimpleRouter{
		config:           normalizeSimpleRouterConfig(config),
		promptClassifier: NewRuleBasedPromptClassifier(),
	}
	for _, option := range options {
		if option != nil {
			option(router)
		}
	}
	return router
}

func (r *SimpleRouter) DecideRoute(ctx context.Context, req Request) (Decision, error) {
	config := defaultSimpleRouterConfig()
	promptClassifier := NewRuleBasedPromptClassifier()
	if r != nil {
		config = r.config
		promptClassifier = r.promptClassifier
	}
	if req.Config != nil {
		config = mergeSimpleRouterConfig(config, *req.Config)
	}
	config = normalizeSimpleRouterConfig(config)

	requestedModel := strings.TrimSpace(req.RequestedModel)
	if requestedModel == "" {
		requestedModel = "auto"
	}
	features := ExtractPromptFeatures(req.PromptText)
	if len(req.PromptMessages) > 0 {
		features = ExtractPromptFeaturesFromMessages(req.PromptMessages)
	}
	classification := promptClassifier.ClassifyFeatures(features)
	category := canonicalCategory(classification.Category.Category)
	difficulty := canonicalDifficulty(classification.Difficulty.Difficulty)
	diagnostics := classification.Category.Diagnostics.WithSelectedCategory(category)

	material := DecisionMaterial{
		Category:      category,
		Difficulty:    difficulty,
		Capability:    capabilityForCategory(category),
		PolicyVariant: PolicyVariantDefault,
	}
	decision := Decision{
		RequestedModel:      requestedModel,
		PolicyHash:          config.PolicyHash,
		CategoryDiagnostics: diagnostics,
	}

	if !strings.EqualFold(requestedModel, "auto") {
		material.RoutingMode = RoutingModeManual
		decision.ModelRef = requestedModel
		decision.CandidateModelRefs = []string{requestedModel}
		decision.RoutingReason = ReasonManualModelRef
		decision.RoutingDecisionMaterial = material
		decision.RoutingDecisionKeyHash, _ = DecisionKeyHash(material)
		return decision, nil
	}

	if config.Mode != RoutingPolicyModeAuto {
		return Decision{}, ErrAutoRoutingDisabled
	}
	if r != nil && r.difficultyRuntime != nil &&
		UsesDifficultyModelPath(ExtractDifficultyFeatures(features, category)) {
		semantic := r.difficultyRuntime.Classify(ctx, features, category)
		if semantic.Status == DifficultySemanticShadowReady {
			difficulty = canonicalDifficulty(semantic.Difficulty.Difficulty)
			material.Difficulty = difficulty
		}
	}
	cell := config.Routes.Cell(category, difficulty)
	candidates, usedHealthFallback := availableModelRefs(cell.ModelRefs, config.CandidateStatuses)
	if len(candidates) == 0 {
		return Decision{}, ErrNoRouteConfigured
	}
	material.RoutingMode = RoutingModeAuto
	if usedHealthFallback {
		material.PolicyVariant = PolicyVariantProviderHealthFallback
		decision.RoutingReason = ReasonOrderedHealthFallback
	} else {
		decision.RoutingReason = ReasonMatrixRoute
	}
	decision.ModelRef = candidates[0]
	decision.CandidateModelRefs = candidates
	decision.RoutingDecisionMaterial = material
	decision.RoutingDecisionKeyHash, _ = DecisionKeyHash(material)
	if r != nil && r.difficultyShadow != nil && req.DifficultyShadowEligible {
		r.difficultyShadow.Submit(features, category, difficulty)
	}
	return decision, nil
}

func (m RoutingMatrix) Cell(category string, difficulty string) RouteCell {
	var routes DifficultyRoutes
	switch canonicalCategory(category) {
	case CategoryCode:
		routes = m.Code
	case CategoryTranslation:
		routes = m.Translation
	case CategorySummarization:
		routes = m.Summarization
	case CategoryReasoning:
		routes = m.Reasoning
	default:
		routes = m.General
	}
	if canonicalDifficulty(difficulty) == DifficultyComplex {
		return routes.Complex
	}
	return routes.Simple
}

func defaultSimpleRouterConfig() SimpleRouterConfig {
	cell := RouteCell{ModelRefs: []string{MockBootstrapRef}}
	routes := DifficultyRoutes{Simple: cell, Complex: cell}
	return SimpleRouterConfig{
		Mode:           RoutingPolicyModeAuto,
		BootstrapState: BootstrapStateMock,
		PolicyHash:     DefaultPolicyHash,
		Routes: RoutingMatrix{
			General:       routes,
			Code:          routes,
			Translation:   routes,
			Summarization: routes,
			Reasoning:     routes,
		},
	}
}

func normalizeSimpleRouterConfig(config SimpleRouterConfig) SimpleRouterConfig {
	defaults := defaultSimpleRouterConfig()
	config.Mode = canonicalRoutingMode(config.Mode)
	config.BootstrapState = strings.TrimSpace(config.BootstrapState)
	config.PolicyHash = strings.TrimSpace(config.PolicyHash)
	if config.PolicyHash == "" {
		config.PolicyHash = defaults.PolicyHash
	}
	config.Routes = normalizeRoutingMatrix(config.Routes, defaults.Routes)
	config.CandidateStatuses = normalizeRouteCandidateStatuses(config.CandidateStatuses)
	config.BootstrapState = inferBootstrapState(config.Routes)
	return config
}

func mergeSimpleRouterConfig(base SimpleRouterConfig, override SimpleRouterConfig) SimpleRouterConfig {
	base = normalizeSimpleRouterConfig(base)
	if strings.TrimSpace(override.Mode) != "" {
		base.Mode = override.Mode
	}
	if strings.TrimSpace(override.BootstrapState) != "" {
		base.BootstrapState = override.BootstrapState
	}
	if strings.TrimSpace(override.PolicyHash) != "" {
		base.PolicyHash = override.PolicyHash
	}
	base.Routes = normalizeRoutingMatrix(override.Routes, base.Routes)
	if len(override.CandidateStatuses) > 0 {
		base.CandidateStatuses = append([]RouteCandidateStatus(nil), override.CandidateStatuses...)
	}
	return normalizeSimpleRouterConfig(base)
}

func normalizeRoutingMatrix(matrix RoutingMatrix, fallback RoutingMatrix) RoutingMatrix {
	return RoutingMatrix{
		General:       normalizeDifficultyRoutes(matrix.General, fallback.General),
		Code:          normalizeDifficultyRoutes(matrix.Code, fallback.Code),
		Translation:   normalizeDifficultyRoutes(matrix.Translation, fallback.Translation),
		Summarization: normalizeDifficultyRoutes(matrix.Summarization, fallback.Summarization),
		Reasoning:     normalizeDifficultyRoutes(matrix.Reasoning, fallback.Reasoning),
	}
}

func normalizeDifficultyRoutes(routes DifficultyRoutes, fallback DifficultyRoutes) DifficultyRoutes {
	return DifficultyRoutes{
		Simple:  normalizeRouteCell(routes.Simple, fallback.Simple),
		Complex: normalizeRouteCell(routes.Complex, fallback.Complex),
	}
}

func normalizeRouteCell(cell RouteCell, fallback RouteCell) RouteCell {
	refs := uniqueModelRefs(cell.ModelRefs)
	if len(refs) == 0 {
		refs = uniqueModelRefs(fallback.ModelRefs)
	}
	return RouteCell{ModelRefs: refs}
}

func uniqueModelRefs(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func normalizeRouteCandidateStatuses(statuses []RouteCandidateStatus) []RouteCandidateStatus {
	if len(statuses) == 0 {
		return nil
	}
	result := make([]RouteCandidateStatus, 0, len(statuses))
	for _, candidate := range statuses {
		candidate.ModelRef = strings.TrimSpace(candidate.ModelRef)
		if candidate.ModelRef == "" {
			continue
		}
		candidate.Status = canonicalRouteCandidateStatus(candidate.Status)
		result = append(result, candidate)
	}
	return result
}

func availableModelRefs(refs []string, statuses []RouteCandidateStatus) ([]string, bool) {
	refs = uniqueModelRefs(refs)
	result := make([]string, 0, len(refs))
	removedPrimary := false
	for index, ref := range refs {
		if routeCandidateStatus(ref, statuses) == RouteCandidateUnavailable {
			if index == 0 {
				removedPrimary = true
			}
			continue
		}
		result = append(result, ref)
	}
	return result, removedPrimary
}

func routeCandidateStatus(modelRef string, statuses []RouteCandidateStatus) string {
	for _, candidate := range statuses {
		if strings.TrimSpace(candidate.ModelRef) == strings.TrimSpace(modelRef) {
			return canonicalRouteCandidateStatus(candidate.Status)
		}
	}
	return RouteCandidateAvailable
}

func canonicalRouteCandidateStatus(value string) string {
	switch strings.TrimSpace(value) {
	case RouteCandidateUnavailable:
		return RouteCandidateUnavailable
	case RouteCandidateDegraded:
		return RouteCandidateDegraded
	default:
		return RouteCandidateAvailable
	}
}

func inferBootstrapState(routes RoutingMatrix) string {
	for _, category := range Categories {
		for _, difficulty := range []string{DifficultySimple, DifficultyComplex} {
			for _, ref := range routes.Cell(category, difficulty).ModelRefs {
				if ref == MockBootstrapRef {
					return BootstrapStateMock
				}
			}
		}
	}
	return BootstrapStateConfigured
}
