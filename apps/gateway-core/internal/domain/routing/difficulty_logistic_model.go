package routing

import "math"

type difficultyCalibratorKind string

const (
	difficultyCalibratorIdentity difficultyCalibratorKind = "identity"
	difficultyCalibratorPlatt    difficultyCalibratorKind = "platt"
	difficultyCalibratorIsotonic difficultyCalibratorKind = "isotonic"
)

// difficultyLogisticModel is the package-private representation generated
// from a promoted offline artifact. No active instance exists until promotion.
type difficultyLogisticModel struct {
	artifactVersion string
	contentHash     string
	bias            float64
	weights         [DifficultyFeatureVectorDimensionV1]float64
	calibrator      difficultyCalibrator
	threshold       float64
}

type difficultyCalibrator struct {
	kind             difficultyCalibratorKind
	plattCoefficient float64
	plattIntercept   float64
	isotonicX        []float64
	isotonicY        []float64
}

type difficultyLogisticInference struct {
	rawProbability  float64
	calibratedScore float64
	difficulty      string
}

// infer assumes code generation already validated the immutable artifact and
// the caller supplied the canonical v1 vector. It intentionally performs no
// JSON parsing or repeated artifact-shape validation on the hot path.
func (model *difficultyLogisticModel) infer(vector []float64) difficultyLogisticInference {
	logit := model.bias
	for index := 0; index < DifficultyFeatureVectorDimensionV1; index++ {
		logit += vector[index] * model.weights[index]
	}
	rawProbability := stableSigmoid(logit)
	calibratedScore := model.calibrator.calibrate(rawProbability)
	difficulty := DifficultySimple
	if calibratedScore >= model.threshold {
		difficulty = DifficultyComplex
	}
	return difficultyLogisticInference{
		rawProbability:  rawProbability,
		calibratedScore: calibratedScore,
		difficulty:      difficulty,
	}
}

func stableSigmoid(value float64) float64 {
	if value >= 0 {
		return 1 / (1 + math.Exp(-value))
	}
	exponential := math.Exp(value)
	return exponential / (1 + exponential)
}

func (calibrator difficultyCalibrator) calibrate(rawProbability float64) float64 {
	switch calibrator.kind {
	case difficultyCalibratorPlatt:
		return stableSigmoid(calibrator.plattCoefficient*rawProbability + calibrator.plattIntercept)
	case difficultyCalibratorIsotonic:
		return interpolateIsotonic(rawProbability, calibrator.isotonicX, calibrator.isotonicY)
	default:
		return rawProbability
	}
}

func interpolateIsotonic(value float64, x []float64, y []float64) float64 {
	if value <= x[0] {
		return y[0]
	}
	last := len(x) - 1
	if value >= x[last] {
		return y[last]
	}
	left := 0
	right := last
	for right-left > 1 {
		middle := left + (right-left)/2
		if value < x[middle] {
			right = middle
		} else {
			left = middle
		}
	}
	ratio := (value - x[left]) / (x[right] - x[left])
	return y[left] + ratio*(y[right]-y[left])
}
