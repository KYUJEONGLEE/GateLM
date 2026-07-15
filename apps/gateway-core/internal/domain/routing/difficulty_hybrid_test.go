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
		Calibrator:      testPlattCalibratorMaterial(),
		Threshold:       difficultyThresholdV1,
	})

	meaningless := ExtractDifficultyFeatures(ExtractPromptFeatures("   "), CategoryGeneral)
	if actual := simpleModel.ClassifyFeatures(meaningless); actual.ComplexityScore != 0 || actual.Difficulty != DifficultySimple {
		t.Fatalf("meaningless result = %#v, want 0.0/simple sentinel", actual)
	}

	payloadOnly := ExtractDifficultyFeatures(
		ExtractPromptFeatures("```text\npayload only\n```"),
		CategoryGeneral,
	)
	if UsesDifficultyModelPath(payloadOnly) {
		t.Fatal("payload-only semantic-empty input unexpectedly used the model path")
	}
	if actual := simpleModel.ClassifyFeatures(payloadOnly); actual.ComplexityScore != 0 || actual.Difficulty != DifficultySimple {
		t.Fatalf("payload-only result = %#v, want 0.0/simple sentinel", actual)
	}

	hardComplex := ExtractDifficultyFeatures(
		ExtractPromptFeatures("Across multiple services, diagnose a race condition and deadlock; preserve behavior, security, and compatibility."),
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

func TestSingleProxyDifficultySignalsDoNotBypassTheModel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		prompt   string
		category string
	}{
		{
			name:     "medium payload alone",
			prompt:   strings.Repeat("background context ", 10) + "state the service window",
			category: CategoryGeneral,
		},
		{
			name:     "large payload alone",
			prompt:   strings.Repeat("background context ", 60) + "state the service window",
			category: CategoryGeneral,
		},
		{
			name:     "large summarization payload alone",
			prompt:   "Summarize this text: " + strings.Repeat("plain context ", 70),
			category: CategorySummarization,
		},
		{name: "debug operation alone", prompt: "Debug this function.", category: CategoryCode},
		{name: "refactor operation alone", prompt: "Refactor this function.", category: CategoryCode},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			features := ExtractDifficultyFeatures(ExtractPromptFeatures(test.prompt), test.category)
			if !UsesDifficultyModelPath(features) {
				t.Fatalf("single proxy signal unexpectedly bypassed the model: %#v", features)
			}
			if actual := NewRuleBasedDifficultyClassifier().ClassifyFeatures(features); actual.Difficulty != DifficultySimple {
				t.Fatalf("single proxy rule result = %#v, want simple", actual)
			}
		})
	}
}

func TestDifficultyDecisionEvidenceForOfflineMatchesCanonicalRoute(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		prompt    string
		category  string
		wantRoute string
	}{
		{name: "semantic empty", prompt: "```text\npayload only\n```", category: CategoryGeneral, wantRoute: DifficultyDecisionRouteSimpleSentinel},
		{name: "hard", prompt: "Across multiple services, diagnose a race condition and deadlock; preserve behavior, security, and compatibility.", category: CategoryCode, wantRoute: DifficultyDecisionRouteHardSentinel},
		{name: "model", prompt: "Explain OAuth briefly.", category: CategoryGeneral, wantRoute: DifficultyDecisionRouteModel},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			features := ExtractDifficultyFeatures(ExtractPromptFeatures(test.prompt), test.category)
			evidence := DifficultyDecisionEvidenceForOffline(features)
			if evidence.Route != test.wantRoute {
				t.Fatalf("route = %q, want %q", evidence.Route, test.wantRoute)
			}
			if (evidence.Route == DifficultyDecisionRouteModel) != UsesDifficultyModelPath(features) {
				t.Fatalf("route/modelPath mismatch: evidence=%#v", evidence)
			}
		})
	}
}

func TestHardComplexSentinelRequiresOverwhelmingCombinedEvidence(t *testing.T) {
	t.Parallel()

	borderline := DifficultyFeatures{
		category: CategoryCode,
		common: CommonDifficultyFeatures{
			payloadSizeBucket: "medium",
			taskCount:         3,
			constraintCount:   2,
		},
		code: &CodeDifficultyFeatures{
			codeOperationKind: "concurrency",
			causalComplexity:  1,
		},
	}
	if evidence := DifficultyDecisionEvidenceForOffline(borderline); evidence.CommonEvidenceScore != 4 || evidence.CategoryEvidenceScore != 3 || evidence.Route != DifficultyDecisionRouteModel {
		t.Fatalf("borderline evidence = %#v, want 4+3 on model path", evidence)
	}

	overwhelming := borderline
	code := *borderline.code
	code.engineeringConstraintCount = 2
	overwhelming.code = &code
	if evidence := DifficultyDecisionEvidenceForOffline(overwhelming); evidence.CommonEvidenceScore != 4 || evidence.CategoryEvidenceScore != 5 || evidence.Route != DifficultyDecisionRouteHardSentinel {
		t.Fatalf("overwhelming evidence = %#v, want 4+5 hard sentinel", evidence)
	}
}

func TestDifficultyClassifierDoesNotApplyBoundedSimpleRuleAfterHardRules(t *testing.T) {
	t.Parallel()

	classifier := newTestDifficultyClassifier(t, DifficultyClassifierMaterial{
		ArtifactVersion: "difficulty-logistic-v1-test",
		ContentHash:     "sha256:test",
		Bias:            100,
		Weights:         make([]float64, DifficultyFeatureVectorDimensionV1),
		Calibrator:      testPlattCalibratorMaterial(),
		Threshold:       difficultyThresholdV1,
	})

	features := ExtractDifficultyFeatures(ExtractPromptFeatures("Explain OAuth briefly."), CategoryGeneral)
	if baseline := NewRuleBasedDifficultyClassifier().ClassifyFeatures(features); baseline.Difficulty != DifficultySimple {
		t.Fatalf("test setup requires bounded-simple baseline, got %#v", baseline)
	}
	if actual := classifier.ClassifyFeatures(features); actual.ComplexityScore <= difficultyThresholdV1 || actual.Difficulty != DifficultyComplex {
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
		Calibrator:      testPlattCalibratorMaterial(),
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
			name: "identity calibrator",
			mutate: func(material *DifficultyClassifierMaterial) {
				material.Calibrator = DifficultyCalibratorMaterial{Kind: "identity"}
			},
			wantError: "unsupported difficulty calibrator",
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

func testPlattCalibratorMaterial() DifficultyCalibratorMaterial {
	coefficient := 20.0
	intercept := -10.0
	return DifficultyCalibratorMaterial{
		Kind:             string(difficultyCalibratorPlatt),
		PlattCoefficient: &coefficient,
		PlattIntercept:   &intercept,
	}
}
