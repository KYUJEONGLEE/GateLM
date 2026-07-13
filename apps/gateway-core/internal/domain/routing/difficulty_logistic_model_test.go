package routing

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestStableSigmoidHandlesExtremeLogits(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		value float64
		want  float64
	}{
		{value: 1000, want: 1},
		{value: -1000, want: 0},
		{value: 0, want: 0.5},
	} {
		actual := stableSigmoid(test.value)
		if math.IsNaN(actual) || math.IsInf(actual, 0) || actual != test.want {
			t.Fatalf("stableSigmoid(%v) = %v, want %v", test.value, actual, test.want)
		}
	}
}

func TestDifficultyLogisticModelInferenceAndCalibration(t *testing.T) {
	t.Parallel()
	model := difficultyLogisticModel{
		bias:      0,
		threshold: difficultyThresholdV1,
		calibrator: difficultyCalibrator{
			kind:      difficultyCalibratorIsotonic,
			isotonicX: []float64{0, 0.5, 1},
			isotonicY: []float64{0.1, 0.6, 0.9},
		},
	}
	model.weights[0] = 2
	vector := make([]float64, DifficultyFeatureVectorDimensionV1)
	vector[0] = 1
	actual := model.infer(vector)
	if actual.rawProbability <= 0.88 || actual.rawProbability >= 0.89 {
		t.Fatalf("raw probability = %v", actual.rawProbability)
	}
	if actual.calibratedScore != 0.6 {
		t.Fatalf("calibrated score = %v, want step value 0.6", actual.calibratedScore)
	}
	if actual.difficulty != DifficultyComplex {
		t.Fatalf("difficulty = %q", actual.difficulty)
	}
}

func TestPlattCalibrationUsesRawProbability(t *testing.T) {
	t.Parallel()
	calibrator := difficultyCalibrator{
		kind:             difficultyCalibratorPlatt,
		plattCoefficient: 2,
		plattIntercept:   -1,
	}
	if actual := calibrator.calibrate(0.5); actual != 0.5 {
		t.Fatalf("platt calibration = %v, want 0.5", actual)
	}
}

func TestSingleBlockIsotonicMaterialAndInference(t *testing.T) {
	t.Parallel()
	calibrator, err := newDifficultyCalibrator(DifficultyCalibratorMaterial{
		Kind:      string(difficultyCalibratorIsotonic),
		IsotonicX: []float64{0.35},
		IsotonicY: []float64{0.6},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []float64{0, 0.35, 1} {
		if actual := calibrator.calibrate(input); actual != 0.6 {
			t.Fatalf("single-block calibration for %v = %v, want 0.6", input, actual)
		}
	}
}

func TestCalibrationMatchesSharedGoldenCases(t *testing.T) {
	t.Parallel()
	type goldenCase struct {
		Name     string  `json:"name"`
		Input    float64 `json:"input"`
		Expected float64 `json:"expected"`
	}
	type isotonicGolden struct {
		XThresholds []float64    `json:"xThresholds"`
		YThresholds []float64    `json:"yThresholds"`
		Cases       []goldenCase `json:"cases"`
	}
	var golden struct {
		SchemaVersion       string         `json:"schemaVersion"`
		Isotonic            isotonicGolden `json:"isotonic"`
		SingleBlockIsotonic isotonicGolden `json:"singleBlockIsotonic"`
		Platt               struct {
			Coefficient float64      `json:"coefficient"`
			Intercept   float64      `json:"intercept"`
			Cases       []goldenCase `json:"cases"`
		} `json:"platt"`
	}
	payload, err := os.ReadFile("testdata/difficulty_calibration_lookup_cases.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &golden); err != nil {
		t.Fatal(err)
	}
	if golden.SchemaVersion != "gatelm.difficulty-calibration-lookup-cases.v1" {
		t.Fatalf("unexpected golden schema %q", golden.SchemaVersion)
	}
	for sectionName, section := range map[string]isotonicGolden{
		"isotonic":            golden.Isotonic,
		"singleBlockIsotonic": golden.SingleBlockIsotonic,
	} {
		sectionName := sectionName
		section := section
		t.Run(sectionName, func(t *testing.T) {
			t.Parallel()
			for _, test := range section.Cases {
				actual := lookupIsotonic(test.Input, section.XThresholds, section.YThresholds)
				if math.Abs(actual-test.Expected) > 1e-15 {
					t.Fatalf("%s: lookupIsotonic(%v) = %v, want %v", test.Name, test.Input, actual, test.Expected)
				}
			}
		})
	}
	for _, test := range golden.Platt.Cases {
		actual := stableSigmoid(golden.Platt.Coefficient*test.Input + golden.Platt.Intercept)
		if math.Abs(actual-test.Expected) > 1e-15 {
			t.Fatalf("%s: Platt calibration = %v, want %v", test.Name, actual, test.Expected)
		}
	}
}

func TestDifficultyFromScoreUsesGlobalThresholdV1(t *testing.T) {
	t.Parallel()
	if actual := difficultyFromScore(difficultyThresholdV1, difficultyThresholdV1); actual != DifficultyComplex {
		t.Fatalf("score at global threshold = %q, want complex", actual)
	}
	belowThreshold := math.Nextafter(difficultyThresholdV1, 0)
	if actual := difficultyFromScore(belowThreshold, difficultyThresholdV1); actual != DifficultySimple {
		t.Fatalf("score below global threshold = %q, want simple", actual)
	}
}
