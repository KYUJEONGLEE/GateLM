package main

import (
	"math"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

func TestParseDifficultyDecisionLossCostsNormalizesAndSorts(t *testing.T) {
	costs, err := parseDifficultyDecisionLossCosts("10, 1,5,3,5")
	if err != nil {
		t.Fatalf("parseDifficultyDecisionLossCosts returned error: %v", err)
	}
	want := []float64{1, 3, 5, 10}
	if len(costs) != len(want) {
		t.Fatalf("cost count = %d, want %d: %#v", len(costs), len(want), costs)
	}
	for index := range want {
		if costs[index] != want[index] {
			t.Fatalf("costs[%d] = %v, want %v", index, costs[index], want[index])
		}
	}
}

func TestParseDifficultyDecisionLossCostsRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"", "1,,3", "0", "-1", "NaN", "+Inf", "abc"} {
		if _, err := parseDifficultyDecisionLossCosts(value); err == nil {
			t.Fatalf("parseDifficultyDecisionLossCosts(%q) succeeded, want error", value)
		}
	}
}

func TestBuildDifficultyDecisionLossExperimentFindsBreakEvenAndConstrainedOptimum(t *testing.T) {
	samples := []difficultyEvaluationSample{}
	for index := 0; index < 4; index++ {
		samples = append(samples, decisionLossSample(
			routing.CategoryGeneral,
			routing.DifficultySimple,
			routing.DifficultySimple,
			routing.DifficultySimple,
			0.5,
			true,
		))
	}
	// The runtime baseline gets this complex sample right. Thresholds above 0.5
	// therefore fail the existing per-category complex-to-simple safety gate.
	samples = append(samples, decisionLossSample(
		routing.CategoryGeneral,
		routing.DifficultyComplex,
		routing.DifficultyComplex,
		routing.DifficultySimple,
		0.5,
		true,
	))
	// A deterministic empty-input sentinel remains simple at every threshold.
	samples = append(samples, decisionLossSample(
		routing.CategoryCode,
		routing.DifficultySimple,
		routing.DifficultySimple,
		routing.DifficultySimple,
		0,
		false,
	))

	report := difficultyReport{
		Samples: samples,
		Shadow:  &difficultyShadowReport{},
	}
	experiment, err := buildDifficultyDecisionLossExperiment(report, difficultyDecisionLossConfig{
		FalsePositiveCost:  1,
		FalseNegativeCosts: []float64{3, 5},
		ThresholdStep:      0.2,
	})
	if err != nil {
		t.Fatalf("buildDifficultyDecisionLossExperiment returned error: %v", err)
	}
	if !experiment.Applicable || experiment.ProductRuntimeChanged || experiment.ThresholdSelectionForPromotionAllowed {
		t.Fatalf("unexpected experiment boundary: %#v", experiment)
	}
	if experiment.ModelPathSamples != 5 || experiment.SentinelSamples != 1 || experiment.RuntimeBaselineComplexToSimpleCount != 0 {
		t.Fatalf("unexpected experiment population: %#v", experiment)
	}

	transition := findDecisionLossTransition(t, experiment.Transitions, 0.6, 0.4)
	if transition.AdditionalSimpleToComplex != 4 || transition.PreventedComplexToSimple != 1 {
		t.Fatalf("unexpected threshold transition: %#v", transition)
	}
	if transition.BreakEvenFalseNegativeToFP == nil || *transition.BreakEvenFalseNegativeToFP != 4 {
		t.Fatalf("break-even FN:FP ratio = %#v, want 4", transition.BreakEvenFalseNegativeToFP)
	}
	if transition.BreakEvenFalseNegativeCost == nil || *transition.BreakEvenFalseNegativeCost != 4 {
		t.Fatalf("break-even FN cost = %#v, want 4", transition.BreakEvenFalseNegativeCost)
	}

	three := findDecisionLossScenario(t, experiment.Scenarios, 3)
	if three.TheoreticalBayesThreshold != 0.25 || !closeDecisionLossFloat(three.UnconstrainedBest.Threshold, 0.6) {
		t.Fatalf("unexpected C_FN=3 unconstrained selection: %#v", three)
	}
	if three.UnconstrainedBest.SafetyGatePassed || three.SafetyConstrainedBest == nil || !closeDecisionLossFloat(three.SafetyConstrainedBest.Threshold, 0.2) {
		t.Fatalf("C_FN=3 must expose a distinct safety-constrained selection: %#v", three)
	}
	if !closeDecisionLossFloat(three.UnconstrainedBest.ExpectedDecisionLoss, 0.5) || !closeDecisionLossFloat(three.SafetyConstrainedBest.ExpectedDecisionLoss, 4.0/6.0) {
		t.Fatalf("unexpected C_FN=3 EDL values: %#v", three)
	}

	five := findDecisionLossScenario(t, experiment.Scenarios, 5)
	if !closeDecisionLossFloat(five.TheoreticalBayesThreshold, 1.0/6.0) || !closeDecisionLossFloat(five.UnconstrainedBest.Threshold, 0.2) {
		t.Fatalf("unexpected C_FN=5 selection: %#v", five)
	}
	if five.SafetyConstrainedBest == nil || five.UnconstrainedBest.Threshold != five.SafetyConstrainedBest.Threshold {
		t.Fatalf("C_FN=5 optimum should already satisfy the safety gate: %#v", five)
	}
}

func TestBuildDifficultyDecisionLossExperimentKeepsSentinelsFixed(t *testing.T) {
	report := difficultyReport{
		Shadow: &difficultyShadowReport{},
		Samples: []difficultyEvaluationSample{
			decisionLossSample(
				routing.CategoryGeneral,
				routing.DifficultyComplex,
				routing.DifficultySimple,
				routing.DifficultyComplex,
				1,
				false,
			),
		},
	}
	experiment, err := buildDifficultyDecisionLossExperiment(report, difficultyDecisionLossConfig{
		FalsePositiveCost:  1,
		FalseNegativeCosts: []float64{1},
		ThresholdStep:      0.5,
	})
	if err != nil {
		t.Fatalf("buildDifficultyDecisionLossExperiment returned error: %v", err)
	}
	for _, point := range experiment.OperatingPoints {
		if point.ComplexToSimpleCount != 0 {
			t.Fatalf("sentinel changed at threshold %v: %#v", point.Threshold, point)
		}
	}
}

func TestValidateDifficultyDecisionLossConfigRejectsNonDeterministicGrid(t *testing.T) {
	_, err := validateDifficultyDecisionLossConfig(difficultyDecisionLossConfig{
		FalsePositiveCost:  1,
		FalseNegativeCosts: []float64{5},
		ThresholdStep:      0.03,
	})
	if err == nil {
		t.Fatal("threshold step 0.03 succeeded, want exact-grid validation error")
	}
}

func decisionLossSample(category string, expected string, runtimeDifficulty string, shadowDifficulty string, score float64, modelPath bool) difficultyEvaluationSample {
	return difficultyEvaluationSample{
		ExpectedCategory:   category,
		ExpectedDifficulty: expected,
		ActualDifficulty:   runtimeDifficulty,
		ShadowDifficulty:   shadowDifficulty,
		ComplexityScore:    floatPointer(score),
		ModelPath:          boolPointer(modelPath),
	}
}

func boolPointer(value bool) *bool {
	return &value
}

func findDecisionLossTransition(t *testing.T, transitions []difficultyDecisionTransition, from float64, to float64) difficultyDecisionTransition {
	t.Helper()
	for _, transition := range transitions {
		if closeDecisionLossFloat(transition.FromThreshold, from) && closeDecisionLossFloat(transition.ToThreshold, to) {
			return transition
		}
	}
	t.Fatalf("decision-loss transition %.3f -> %.3f not found: %#v", from, to, transitions)
	return difficultyDecisionTransition{}
}

func findDecisionLossScenario(t *testing.T, scenarios []difficultyDecisionScenario, falseNegativeCost float64) difficultyDecisionScenario {
	t.Helper()
	for _, scenario := range scenarios {
		if scenario.FalseNegativeCost == falseNegativeCost {
			return scenario
		}
	}
	t.Fatalf("decision-loss scenario C_FN=%v not found: %#v", falseNegativeCost, scenarios)
	return difficultyDecisionScenario{}
}

func closeDecisionLossFloat(actual float64, expected float64) bool {
	return math.Abs(actual-expected) <= difficultyDecisionLossFloatTolerance
}
