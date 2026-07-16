package main

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	difficultyDecisionLossExperimentPolicy = "difficulty-decision-loss-threshold-experiment.v1"
	difficultyDecisionLossSafetyPolicy     = "complex_to_simple_non_increase_overall_and_each_expected_category"
	difficultyDecisionLossCostUnit         = "relative_loss_unit"
	difficultyDecisionLossThresholdRule    = "complexity_score_greater_than_or_equal"
	difficultyDecisionLossEvidenceRole     = "exploratory_only_dataset_role_not_verified"
	difficultyDecisionLossMaxGridSteps     = 1000
	difficultyDecisionLossFloatTolerance   = 1e-12
)

type difficultyDecisionLossConfig struct {
	FalsePositiveCost  float64
	FalseNegativeCosts []float64
	ThresholdStep      float64
}

type difficultyDecisionLossExperiment struct {
	Applicable                               bool                               `json:"applicable"`
	Policy                                   string                             `json:"policy"`
	Status                                   string                             `json:"status"`
	EvidenceRole                             string                             `json:"evidenceRole"`
	CostUnit                                 string                             `json:"costUnit"`
	ThresholdRule                            string                             `json:"thresholdRule"`
	ThresholdStep                            float64                            `json:"thresholdStep"`
	FalsePositiveCost                        float64                            `json:"falsePositiveCost"`
	FalseNegativeCosts                       []float64                          `json:"falseNegativeCosts"`
	SafetyPolicy                             string                             `json:"safetyPolicy"`
	TotalSamples                             int                                `json:"totalSamples"`
	ModelPathSamples                         int                                `json:"modelPathSamples"`
	SentinelSamples                          int                                `json:"sentinelSamples"`
	RuntimeBaselineComplexToSimpleCount      int                                `json:"runtimeBaselineComplexToSimpleCount"`
	RuntimeBaselineComplexToSimpleByCategory map[string]int                     `json:"runtimeBaselineComplexToSimpleByExpectedCategory"`
	OperatingPoints                          []difficultyDecisionOperatingPoint `json:"operatingPoints"`
	Transitions                              []difficultyDecisionTransition     `json:"transitions"`
	Scenarios                                []difficultyDecisionScenario       `json:"scenarios"`
	ProductRuntimeChanged                    bool                               `json:"productRuntimeChanged"`
	ThresholdSelectionForPromotionAllowed    bool                               `json:"thresholdSelectionForPromotionAllowed"`
}

type difficultyDecisionOperatingPoint struct {
	Threshold            float64  `json:"threshold"`
	SimpleExpected       int      `json:"simpleExpectedSamples"`
	SimpleToComplexCount int      `json:"simpleToComplexCount"`
	SimpleToComplexRate  float64  `json:"simpleToComplexRate"`
	ComplexExpected      int      `json:"complexExpectedSamples"`
	ComplexToSimpleCount int      `json:"complexToSimpleCount"`
	ComplexToSimpleRate  float64  `json:"complexToSimpleRate"`
	SafetyGatePassed     bool     `json:"safetyGatePassed"`
	FailedCategories     []string `json:"failedCategories,omitempty"`
}

type difficultyDecisionTransition struct {
	FromThreshold               float64  `json:"fromThreshold"`
	ToThreshold                 float64  `json:"toThreshold"`
	AdditionalSimpleToComplex   int      `json:"additionalSimpleToComplex"`
	PreventedComplexToSimple    int      `json:"preventedComplexToSimple"`
	BreakEvenFalseNegativeToFP  *float64 `json:"breakEvenFalseNegativeToFalsePositiveRatio,omitempty"`
	BreakEvenFalseNegativeCost  *float64 `json:"breakEvenFalseNegativeCost,omitempty"`
	BreakEvenInterpretation     string   `json:"breakEvenInterpretation"`
	DestinationSafetyGatePassed bool     `json:"destinationSafetyGatePassed"`
	DestinationFailedCategories []string `json:"destinationFailedCategories,omitempty"`
}

type difficultyDecisionScenario struct {
	FalsePositiveCost          float64                      `json:"falsePositiveCost"`
	FalseNegativeCost          float64                      `json:"falseNegativeCost"`
	FalseNegativeToFPRatio     float64                      `json:"falseNegativeToFalsePositiveRatio"`
	TheoreticalBayesThreshold  float64                      `json:"theoreticalBayesThreshold"`
	UnconstrainedBest          difficultyDecisionSelection  `json:"unconstrainedBest"`
	SafetyConstrainedBest      *difficultyDecisionSelection `json:"safetyConstrainedBest,omitempty"`
	SafetyConstrainedAvailable bool                         `json:"safetyConstrainedAvailable"`
}

type difficultyDecisionSelection struct {
	Threshold                     float64  `json:"threshold"`
	ExpectedDecisionLoss          float64  `json:"expectedDecisionLoss"`
	FalsePositiveLossContribution float64  `json:"falsePositiveLossContribution"`
	FalseNegativeLossContribution float64  `json:"falseNegativeLossContribution"`
	SimpleToComplexCount          int      `json:"simpleToComplexCount"`
	ComplexToSimpleCount          int      `json:"complexToSimpleCount"`
	SafetyGatePassed              bool     `json:"safetyGatePassed"`
	FailedCategories              []string `json:"failedCategories,omitempty"`
}

type difficultyDecisionObservation struct {
	ExpectedCategory   string
	ExpectedDifficulty string
	ShadowDifficulty   string
	ComplexityScore    float64
	ModelPath          bool
}

func parseDifficultyDecisionLossCosts(raw string) ([]float64, error) {
	parts := strings.Split(raw, ",")
	if len(parts) == 0 {
		return nil, errors.New("difficulty decision-loss FN costs are required")
	}
	costs := make([]float64, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			return nil, errors.New("difficulty decision-loss FN costs must be comma-separated positive numbers")
		}
		value, err := strconv.ParseFloat(trimmed, 64)
		if err != nil || !finiteDecisionLossFloat(value) || value <= 0 {
			return nil, fmt.Errorf("difficulty decision-loss FN cost %q must be a finite positive number", trimmed)
		}
		key := strconv.FormatFloat(value, 'g', -1, 64)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		costs = append(costs, value)
	}
	if len(costs) == 0 {
		return nil, errors.New("difficulty decision-loss FN costs are required")
	}
	sort.Float64s(costs)
	return costs, nil
}

func buildDifficultyDecisionLossExperiment(report difficultyReport, config difficultyDecisionLossConfig) (difficultyDecisionLossExperiment, error) {
	gridSteps, err := validateDifficultyDecisionLossConfig(config)
	if err != nil {
		return difficultyDecisionLossExperiment{}, err
	}
	if report.Shadow == nil {
		return difficultyDecisionLossExperiment{}, errors.New("difficulty decision-loss experiment requires an opt-in shadow classifier")
	}
	if len(report.Samples) == 0 {
		return difficultyDecisionLossExperiment{}, errors.New("difficulty decision-loss experiment requires at least one evaluated sample")
	}

	observations := make([]difficultyDecisionObservation, 0, len(report.Samples))
	modelPathSamples := 0
	baselineByCategory := map[string]int{}
	baselineOverall := 0
	for index, sample := range report.Samples {
		if sample.ComplexityScore == nil || sample.ModelPath == nil {
			return difficultyDecisionLossExperiment{}, fmt.Errorf("difficulty decision-loss sample %d has no shadow score/model-path boundary", index+1)
		}
		score := *sample.ComplexityScore
		if !finiteDecisionLossFloat(score) || score < 0 || score > 1 {
			return difficultyDecisionLossExperiment{}, fmt.Errorf("difficulty decision-loss sample %d has an invalid complexity score", index+1)
		}
		if !validDifficultyLabel(sample.ExpectedDifficulty) || !validDifficultyLabel(sample.ActualDifficulty) || !validDifficultyLabel(sample.ShadowDifficulty) {
			return difficultyDecisionLossExperiment{}, fmt.Errorf("difficulty decision-loss sample %d has an invalid difficulty label", index+1)
		}
		category := strings.TrimSpace(sample.ExpectedCategory)
		if category == "" {
			return difficultyDecisionLossExperiment{}, fmt.Errorf("difficulty decision-loss sample %d has no expected category", index+1)
		}
		if _, ok := baselineByCategory[category]; !ok {
			baselineByCategory[category] = 0
		}
		if sample.ExpectedDifficulty == routing.DifficultyComplex && sample.ActualDifficulty == routing.DifficultySimple {
			baselineOverall++
			baselineByCategory[category]++
		}
		if *sample.ModelPath {
			modelPathSamples++
		}
		observations = append(observations, difficultyDecisionObservation{
			ExpectedCategory:   category,
			ExpectedDifficulty: sample.ExpectedDifficulty,
			ShadowDifficulty:   sample.ShadowDifficulty,
			ComplexityScore:    score,
			ModelPath:          *sample.ModelPath,
		})
	}

	points := make([]difficultyDecisionOperatingPoint, 0, gridSteps+1)
	for index := gridSteps; index >= 0; index-- {
		threshold := float64(index) / float64(gridSteps)
		points = append(points, evaluateDifficultyDecisionOperatingPoint(observations, threshold, baselineOverall, baselineByCategory))
	}

	transitions, err := buildDifficultyDecisionTransitions(points, config.FalsePositiveCost)
	if err != nil {
		return difficultyDecisionLossExperiment{}, err
	}
	scenarios := make([]difficultyDecisionScenario, 0, len(config.FalseNegativeCosts))
	for _, falseNegativeCost := range config.FalseNegativeCosts {
		scenario, err := buildDifficultyDecisionScenario(points, len(observations), config.FalsePositiveCost, falseNegativeCost)
		if err != nil {
			return difficultyDecisionLossExperiment{}, err
		}
		scenarios = append(scenarios, scenario)
	}

	return difficultyDecisionLossExperiment{
		Applicable:                               true,
		Policy:                                   difficultyDecisionLossExperimentPolicy,
		Status:                                   "offline_experiment_not_runtime_promotion",
		EvidenceRole:                             difficultyDecisionLossEvidenceRole,
		CostUnit:                                 difficultyDecisionLossCostUnit,
		ThresholdRule:                            difficultyDecisionLossThresholdRule,
		ThresholdStep:                            config.ThresholdStep,
		FalsePositiveCost:                        config.FalsePositiveCost,
		FalseNegativeCosts:                       append([]float64(nil), config.FalseNegativeCosts...),
		SafetyPolicy:                             difficultyDecisionLossSafetyPolicy,
		TotalSamples:                             len(observations),
		ModelPathSamples:                         modelPathSamples,
		SentinelSamples:                          len(observations) - modelPathSamples,
		RuntimeBaselineComplexToSimpleCount:      baselineOverall,
		RuntimeBaselineComplexToSimpleByCategory: copyStringIntMap(baselineByCategory),
		OperatingPoints:                          points,
		Transitions:                              transitions,
		Scenarios:                                scenarios,
		ProductRuntimeChanged:                    false,
		ThresholdSelectionForPromotionAllowed:    false,
	}, nil
}

func validateDifficultyDecisionLossConfig(config difficultyDecisionLossConfig) (int, error) {
	if !finiteDecisionLossFloat(config.FalsePositiveCost) || config.FalsePositiveCost <= 0 {
		return 0, errors.New("difficulty decision-loss FP cost must be a finite positive number")
	}
	if len(config.FalseNegativeCosts) == 0 {
		return 0, errors.New("difficulty decision-loss requires at least one FN cost scenario")
	}
	for _, cost := range config.FalseNegativeCosts {
		if !finiteDecisionLossFloat(cost) || cost <= 0 {
			return 0, errors.New("difficulty decision-loss FN costs must be finite positive numbers")
		}
	}
	if !finiteDecisionLossFloat(config.ThresholdStep) || config.ThresholdStep <= 0 || config.ThresholdStep > 1 {
		return 0, errors.New("difficulty decision-loss threshold step must be within (0, 1]")
	}
	stepsFloat := 1 / config.ThresholdStep
	steps := int(math.Round(stepsFloat))
	if steps < 1 || steps > difficultyDecisionLossMaxGridSteps || math.Abs(stepsFloat-float64(steps)) > difficultyDecisionLossFloatTolerance {
		return 0, fmt.Errorf("difficulty decision-loss threshold step must divide 1.0 exactly with at most %d steps", difficultyDecisionLossMaxGridSteps)
	}
	return steps, nil
}

func evaluateDifficultyDecisionOperatingPoint(observations []difficultyDecisionObservation, threshold float64, baselineOverall int, baselineByCategory map[string]int) difficultyDecisionOperatingPoint {
	point := difficultyDecisionOperatingPoint{
		Threshold:        threshold,
		FailedCategories: []string{},
	}
	candidateFNByCategory := map[string]int{}
	for category := range baselineByCategory {
		candidateFNByCategory[category] = 0
	}
	for _, observation := range observations {
		predicted := observation.ShadowDifficulty
		if observation.ModelPath {
			predicted = routing.DifficultySimple
			if observation.ComplexityScore >= threshold {
				predicted = routing.DifficultyComplex
			}
		}
		switch observation.ExpectedDifficulty {
		case routing.DifficultySimple:
			point.SimpleExpected++
			if predicted == routing.DifficultyComplex {
				point.SimpleToComplexCount++
			}
		case routing.DifficultyComplex:
			point.ComplexExpected++
			if predicted == routing.DifficultySimple {
				point.ComplexToSimpleCount++
				candidateFNByCategory[observation.ExpectedCategory]++
			}
		}
	}
	point.SimpleToComplexRate = ratio(point.SimpleToComplexCount, point.SimpleExpected)
	point.ComplexToSimpleRate = ratio(point.ComplexToSimpleCount, point.ComplexExpected)
	point.SafetyGatePassed = point.ComplexToSimpleCount <= baselineOverall
	for category, baselineCount := range baselineByCategory {
		if candidateFNByCategory[category] > baselineCount {
			point.SafetyGatePassed = false
			point.FailedCategories = append(point.FailedCategories, category)
		}
	}
	sort.Strings(point.FailedCategories)
	return point
}

func buildDifficultyDecisionTransitions(points []difficultyDecisionOperatingPoint, falsePositiveCost float64) ([]difficultyDecisionTransition, error) {
	transitions := []difficultyDecisionTransition{}
	for index := 1; index < len(points); index++ {
		from := points[index-1]
		to := points[index]
		additionalFP := to.SimpleToComplexCount - from.SimpleToComplexCount
		preventedFN := from.ComplexToSimpleCount - to.ComplexToSimpleCount
		if additionalFP < 0 || preventedFN < 0 {
			return nil, errors.New("difficulty decision-loss threshold sweep must be monotonic")
		}
		if additionalFP == 0 && preventedFN == 0 {
			continue
		}
		transition := difficultyDecisionTransition{
			FromThreshold:               from.Threshold,
			ToThreshold:                 to.Threshold,
			AdditionalSimpleToComplex:   additionalFP,
			PreventedComplexToSimple:    preventedFN,
			DestinationSafetyGatePassed: to.SafetyGatePassed,
			DestinationFailedCategories: append([]string(nil), to.FailedCategories...),
		}
		if preventedFN == 0 {
			transition.BreakEvenInterpretation = "no_fn_prevented; lower threshold only adds over-routing on this grid transition"
		} else {
			ratioValue := float64(additionalFP) / float64(preventedFN)
			costValue := falsePositiveCost * ratioValue
			transition.BreakEvenFalseNegativeToFP = floatPointer(ratioValue)
			transition.BreakEvenFalseNegativeCost = floatPointer(costValue)
			transition.BreakEvenInterpretation = "lower threshold has lower EDL when falseNegativeCost is greater than this break-even cost"
		}
		transitions = append(transitions, transition)
	}
	return transitions, nil
}

func buildDifficultyDecisionScenario(points []difficultyDecisionOperatingPoint, totalSamples int, falsePositiveCost float64, falseNegativeCost float64) (difficultyDecisionScenario, error) {
	if totalSamples <= 0 {
		return difficultyDecisionScenario{}, errors.New("difficulty decision-loss scenario requires positive sample count")
	}
	theoreticalThreshold := falsePositiveCost / (falsePositiveCost + falseNegativeCost)
	var unconstrained *difficultyDecisionSelection
	var constrained *difficultyDecisionSelection
	for _, point := range points {
		selection := difficultyDecisionSelection{
			Threshold:                     point.Threshold,
			FalsePositiveLossContribution: falsePositiveCost * float64(point.SimpleToComplexCount) / float64(totalSamples),
			FalseNegativeLossContribution: falseNegativeCost * float64(point.ComplexToSimpleCount) / float64(totalSamples),
			SimpleToComplexCount:          point.SimpleToComplexCount,
			ComplexToSimpleCount:          point.ComplexToSimpleCount,
			SafetyGatePassed:              point.SafetyGatePassed,
			FailedCategories:              append([]string(nil), point.FailedCategories...),
		}
		selection.ExpectedDecisionLoss = selection.FalsePositiveLossContribution + selection.FalseNegativeLossContribution
		if unconstrained == nil || betterDifficultyDecisionSelection(selection, *unconstrained, theoreticalThreshold) {
			candidate := selection
			unconstrained = &candidate
		}
		if point.SafetyGatePassed && (constrained == nil || betterDifficultyDecisionSelection(selection, *constrained, theoreticalThreshold)) {
			candidate := selection
			constrained = &candidate
		}
	}
	if unconstrained == nil {
		return difficultyDecisionScenario{}, errors.New("difficulty decision-loss scenario has no operating points")
	}
	return difficultyDecisionScenario{
		FalsePositiveCost:          falsePositiveCost,
		FalseNegativeCost:          falseNegativeCost,
		FalseNegativeToFPRatio:     falseNegativeCost / falsePositiveCost,
		TheoreticalBayesThreshold:  theoreticalThreshold,
		UnconstrainedBest:          *unconstrained,
		SafetyConstrainedBest:      constrained,
		SafetyConstrainedAvailable: constrained != nil,
	}, nil
}

func betterDifficultyDecisionSelection(candidate difficultyDecisionSelection, current difficultyDecisionSelection, theoreticalThreshold float64) bool {
	if candidate.ExpectedDecisionLoss < current.ExpectedDecisionLoss-difficultyDecisionLossFloatTolerance {
		return true
	}
	if math.Abs(candidate.ExpectedDecisionLoss-current.ExpectedDecisionLoss) > difficultyDecisionLossFloatTolerance {
		return false
	}
	if candidate.ComplexToSimpleCount != current.ComplexToSimpleCount {
		return candidate.ComplexToSimpleCount < current.ComplexToSimpleCount
	}
	candidateDistance := math.Abs(candidate.Threshold - theoreticalThreshold)
	currentDistance := math.Abs(current.Threshold - theoreticalThreshold)
	if candidateDistance < currentDistance-difficultyDecisionLossFloatTolerance {
		return true
	}
	if math.Abs(candidateDistance-currentDistance) > difficultyDecisionLossFloatTolerance {
		return false
	}
	return candidate.Threshold < current.Threshold
}

func validDifficultyLabel(value string) bool {
	return value == routing.DifficultySimple || value == routing.DifficultyComplex
}

func finiteDecisionLossFloat(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func copyStringIntMap(source map[string]int) map[string]int {
	result := make(map[string]int, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
