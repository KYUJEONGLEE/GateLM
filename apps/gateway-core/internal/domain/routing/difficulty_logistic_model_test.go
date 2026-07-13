package routing

import (
	"math"
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
		threshold: 0.5,
		calibrator: difficultyCalibrator{
			kind:      difficultyCalibratorIsotonic,
			isotonicX: []float64{0, 0.5, 1},
			isotonicY: []float64{0.1, 0.4, 0.9},
		},
	}
	model.weights[0] = 2
	vector := make([]float64, DifficultyFeatureVectorDimensionV1)
	vector[0] = 1
	actual := model.infer(vector)
	if actual.rawProbability <= 0.88 || actual.rawProbability >= 0.89 {
		t.Fatalf("raw probability = %v", actual.rawProbability)
	}
	if actual.calibratedScore <= 0.78 || actual.calibratedScore >= 0.79 {
		t.Fatalf("calibrated score = %v", actual.calibratedScore)
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
