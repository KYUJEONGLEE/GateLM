package routing

import (
	"context"
	"math"
	"testing"
)

func TestDifficultyB1ShadowArtifactIdentityIsPinned(t *testing.T) {
	t.Parallel()
	if !DifficultyB1ShadowModelCompatible() {
		t.Fatal("generated B1 shadow artifact is not compatible")
	}
	if generatedDifficultyLogisticModelV1.artifactVersion != DifficultyB1ShadowArtifactVersion ||
		generatedDifficultyLogisticModelV1.contentHash != DifficultyB1ShadowContentHash ||
		generatedDifficultyLogisticModelV1.calibrator.kind != difficultyCalibratorIsotonic ||
		generatedDifficultyLogisticModelV1.threshold != 0.5 {
		t.Fatal("generated B1 shadow artifact identity drifted")
	}
	if len(generatedDifficultyLogisticModelV1.calibrator.isotonicX) != 15 ||
		len(generatedDifficultyLogisticModelV1.calibrator.isotonicY) != 15 {
		t.Fatal("generated B1 isotonic block count drifted")
	}
}

func TestDifficultyB1ShadowUses42DWithoutEncoder(t *testing.T) {
	t.Parallel()
	evaluator := NewDifficultyB1ShadowEvaluator()
	result := evaluator.Evaluate(
		context.Background(),
		ExtractPromptFeatures("Explain one bounded workflow step."),
		CategoryGeneral,
	)
	if result.Status != DifficultySemanticShadowReady ||
		(result.Difficulty.Difficulty != DifficultySimple && result.Difficulty.Difficulty != DifficultyComplex) ||
		!finiteDifficultyFloat(result.Difficulty.ComplexityScore) {
		t.Fatalf("B1 shadow result=%+v", result)
	}
	if err := evaluator.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestDifficultyB1ShadowKeepsSentinelsOutsideModelPath(t *testing.T) {
	t.Parallel()
	evaluator := NewDifficultyB1ShadowEvaluator()
	result := evaluator.Evaluate(context.Background(), ExtractPromptFeatures(""), CategoryGeneral)
	if result.Status != DifficultySemanticShadowNotApplicable {
		t.Fatalf("empty sentinel status=%q", result.Status)
	}
}

func TestDifficultyB1ThresholdUsesInclusiveHalf(t *testing.T) {
	t.Parallel()
	if difficultyFromScore(0.5, generatedDifficultyLogisticModelV1.threshold) != DifficultyComplex ||
		difficultyFromScore(math.Nextafter(0.5, 0), generatedDifficultyLogisticModelV1.threshold) != DifficultySimple {
		t.Fatal("B1 threshold must use score >= 0.5")
	}
}
