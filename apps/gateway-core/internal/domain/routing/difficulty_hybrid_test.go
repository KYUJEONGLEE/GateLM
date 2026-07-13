package routing

import (
	"math"
	"strings"
	"testing"
)

func TestDifficultyClassifierUsesDeterministicSentinelsBeforeModel(t *testing.T) {
	t.Parallel()

	simpleModel := newTestDifficultyClassifier(t, DifficultyClassifierMaterial{
		ArtifactVersion: "difficulty-logistic-v1-test",
		ContentHash:     "sha256:test",
		Bias:            -100,
		Weights:         make([]float64, DifficultyFeatureVectorDimensionV1),
		Calibrator:      DifficultyCalibratorMaterial{Kind: string(difficultyCalibratorIdentity)},
		Threshold:       difficultyThresholdV1,
	})

	meaningless := ExtractDifficultyFeatures(ExtractPromptFeatures("   "), CategoryGeneral)
	if actual := simpleModel.ClassifyFeatures(meaningless); actual.ComplexityScore != 0 || actual.Difficulty != DifficultySimple {
		t.Fatalf("meaningless result = %#v, want 0.0/simple sentinel", actual)
	}

	hardComplex := ExtractDifficultyFeatures(
		ExtractPromptFeatures("Debug a race condition across multiple files."),
		CategoryCode,
	)
	if actual := simpleModel.ClassifyFeatures(hardComplex); actual.ComplexityScore != 1 || actual.Difficulty != DifficultyComplex {
		t.Fatalf("hard-complex result = %#v, want 1.0/complex sentinel", actual)
	}
}

func TestDifficultyClassifierUsesCalibratedModelScoreForRemainingRequests(t *testing.T) {
	t.Parallel()

	classifier := newTestDifficultyClassifier(t, DifficultyClassifierMaterial{
		ArtifactVersion: "difficulty-logistic-v1-test",
		ContentHash:     "sha256:test",
		Bias:            0,
		Weights:         make([]float64, DifficultyFeatureVectorDimensionV1),
		Calibrator: DifficultyCalibratorMaterial{
			Kind:      string(difficultyCalibratorIsotonic),
			IsotonicX: []float64{0, 0.5, 1},
			IsotonicY: []float64{0.1, 0.4, 0.9},
		},
		Threshold: difficultyThresholdV1,
	})

	features := ExtractDifficultyFeatures(ExtractPromptFeatures("Explain OAuth briefly."), CategoryGeneral)
	actual := classifier.ClassifyFeatures(features)
	if actual.ComplexityScore != 0.4 || actual.Difficulty != DifficultySimple {
		t.Fatalf("model result = %#v, want calibrated 0.4/simple", actual)
	}
}

func TestDifficultyClassifierDoesNotApplyBoundedSimpleRuleAfterHardRules(t *testing.T) {
	t.Parallel()

	classifier := newTestDifficultyClassifier(t, DifficultyClassifierMaterial{
		ArtifactVersion: "difficulty-logistic-v1-test",
		ContentHash:     "sha256:test",
		Bias:            100,
		Weights:         make([]float64, DifficultyFeatureVectorDimensionV1),
		Calibrator:      DifficultyCalibratorMaterial{Kind: string(difficultyCalibratorIdentity)},
		Threshold:       difficultyThresholdV1,
	})

	features := ExtractDifficultyFeatures(ExtractPromptFeatures("Explain OAuth briefly."), CategoryGeneral)
	if baseline := NewRuleBasedDifficultyClassifier().ClassifyFeatures(features); baseline.Difficulty != DifficultySimple {
		t.Fatalf("test setup requires bounded-simple baseline, got %#v", baseline)
	}
	if actual := classifier.ClassifyFeatures(features); actual.ComplexityScore != 1 || actual.Difficulty != DifficultyComplex {
		t.Fatalf("hybrid classifier must defer bounded requests to the model, got %#v", actual)
	}
}

func TestNewDifficultyClassifierRejectsInvalidInferenceMaterial(t *testing.T) {
	t.Parallel()

	base := DifficultyClassifierMaterial{
		ArtifactVersion: "difficulty-logistic-v1-test",
		ContentHash:     "sha256:test",
		Bias:            0,
		Weights:         make([]float64, DifficultyFeatureVectorDimensionV1),
		Calibrator:      DifficultyCalibratorMaterial{Kind: string(difficultyCalibratorIdentity)},
		Threshold:       difficultyThresholdV1,
	}

	tests := []struct {
		name      string
		mutate    func(*DifficultyClassifierMaterial)
		wantError string
	}{
		{
			name: "missing provenance",
			mutate: func(material *DifficultyClassifierMaterial) {
				material.ContentHash = ""
			},
			wantError: "provenance",
		},
		{
			name: "wrong vector size",
			mutate: func(material *DifficultyClassifierMaterial) {
				material.Weights = material.Weights[:1]
			},
			wantError: "exactly 42 weights",
		},
		{
			name: "non-finite bias",
			mutate: func(material *DifficultyClassifierMaterial) {
				material.Bias = math.Inf(1)
			},
			wantError: "bias must be finite",
		},
		{
			name: "runtime threshold override",
			mutate: func(material *DifficultyClassifierMaterial) {
				material.Threshold = 0.6
			},
			wantError: "global 0.45",
		},
		{
			name: "unknown calibrator",
			mutate: func(material *DifficultyClassifierMaterial) {
				material.Calibrator.Kind = "category-specific"
			},
			wantError: "unsupported difficulty calibrator",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			material := base
			material.Weights = append([]float64(nil), base.Weights...)
			test.mutate(&material)
			_, err := NewDifficultyClassifier(material)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("NewDifficultyClassifier() error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func newTestDifficultyClassifier(t *testing.T, material DifficultyClassifierMaterial) DifficultyClassifier {
	t.Helper()
	classifier, err := NewDifficultyClassifier(material)
	if err != nil {
		t.Fatalf("NewDifficultyClassifier() returned error: %v", err)
	}
	return classifier
}
