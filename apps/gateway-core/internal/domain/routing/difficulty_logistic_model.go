package routing

import (
	"errors"
	"fmt"
	"math"
)

type difficultyCalibratorKind string

const (
	difficultyCalibratorIdentity difficultyCalibratorKind = "identity"
	difficultyCalibratorPlatt    difficultyCalibratorKind = "platt"
	difficultyCalibratorIsotonic difficultyCalibratorKind = "isotonic"
	difficultyThresholdV1                                 = 0.45
)

// DifficultyClassifierMaterial is the validated, immutable inference material
// accepted by the offline/shadow classifier. It is not an API, event, log, or
// RuntimeSnapshot representation.
type DifficultyClassifierMaterial struct {
	ArtifactVersion string
	ContentHash     string
	Bias            float64
	Weights         []float64
	Calibrator      DifficultyCalibratorMaterial
	Threshold       float64
}

type DifficultyCalibratorMaterial struct {
	Kind             string
	PlattCoefficient *float64
	PlattIntercept   *float64
	IsotonicX        []float64
	IsotonicY        []float64
}

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

func newDifficultyLogisticModel(material DifficultyClassifierMaterial) (difficultyLogisticModel, error) {
	if material.ArtifactVersion == "" || material.ContentHash == "" {
		return difficultyLogisticModel{}, errors.New("difficulty model provenance is required")
	}
	if !finiteDifficultyFloat(material.Bias) {
		return difficultyLogisticModel{}, errors.New("difficulty model bias must be finite")
	}
	if len(material.Weights) != DifficultyFeatureVectorDimensionV1 {
		return difficultyLogisticModel{}, fmt.Errorf("difficulty model must contain exactly %d weights", DifficultyFeatureVectorDimensionV1)
	}
	if material.Threshold != difficultyThresholdV1 {
		return difficultyLogisticModel{}, errors.New("difficulty threshold policy must remain global 0.45")
	}

	model := difficultyLogisticModel{
		artifactVersion: material.ArtifactVersion,
		contentHash:     material.ContentHash,
		bias:            material.Bias,
		threshold:       material.Threshold,
	}
	for index, weight := range material.Weights {
		if !finiteDifficultyFloat(weight) {
			return difficultyLogisticModel{}, fmt.Errorf("difficulty model weight %d must be finite", index)
		}
		model.weights[index] = weight
	}

	calibrator, err := newDifficultyCalibrator(material.Calibrator)
	if err != nil {
		return difficultyLogisticModel{}, err
	}
	model.calibrator = calibrator
	return model, nil
}

func newDifficultyCalibrator(material DifficultyCalibratorMaterial) (difficultyCalibrator, error) {
	calibrator := difficultyCalibrator{kind: difficultyCalibratorKind(material.Kind)}
	switch calibrator.kind {
	case difficultyCalibratorIdentity:
		if material.PlattCoefficient != nil || material.PlattIntercept != nil || len(material.IsotonicX) != 0 || len(material.IsotonicY) != 0 {
			return difficultyCalibrator{}, errors.New("identity difficulty calibrator must not contain parameters")
		}
	case difficultyCalibratorPlatt:
		if material.PlattCoefficient == nil || material.PlattIntercept == nil ||
			!finiteDifficultyFloat(*material.PlattCoefficient) || !finiteDifficultyFloat(*material.PlattIntercept) ||
			len(material.IsotonicX) != 0 || len(material.IsotonicY) != 0 {
			return difficultyCalibrator{}, errors.New("platt difficulty calibrator parameters are invalid")
		}
		calibrator.plattCoefficient = *material.PlattCoefficient
		calibrator.plattIntercept = *material.PlattIntercept
	case difficultyCalibratorIsotonic:
		if material.PlattCoefficient != nil || material.PlattIntercept != nil || len(material.IsotonicX) < 2 || len(material.IsotonicX) != len(material.IsotonicY) {
			return difficultyCalibrator{}, errors.New("isotonic difficulty calibrator thresholds are invalid")
		}
		calibrator.isotonicX = append([]float64(nil), material.IsotonicX...)
		calibrator.isotonicY = append([]float64(nil), material.IsotonicY...)
		for index := range calibrator.isotonicX {
			x := calibrator.isotonicX[index]
			y := calibrator.isotonicY[index]
			if !finiteDifficultyFloat(x) || !finiteDifficultyFloat(y) || x < 0 || x > 1 || y < 0 || y > 1 {
				return difficultyCalibrator{}, errors.New("isotonic difficulty calibrator thresholds must be finite probabilities")
			}
			if index > 0 && (x <= calibrator.isotonicX[index-1] || y < calibrator.isotonicY[index-1]) {
				return difficultyCalibrator{}, errors.New("isotonic difficulty calibrator thresholds must be strictly ordered and monotonic")
			}
		}
	default:
		return difficultyCalibrator{}, fmt.Errorf("unsupported difficulty calibrator kind %q", material.Kind)
	}
	return calibrator, nil
}

// infer assumes code generation already validated the immutable artifact and
// the caller supplied the canonical v1 vector. It intentionally performs no
// JSON parsing or repeated artifact-shape validation on the hot path.
func (model *difficultyLogisticModel) infer(vector []float64) difficultyLogisticInference {
	rawProbability := model.score(vector)
	calibratedScore := model.calibrator.calibrate(rawProbability)
	difficulty := difficultyFromScore(calibratedScore, model.threshold)
	return difficultyLogisticInference{
		rawProbability:  rawProbability,
		calibratedScore: calibratedScore,
		difficulty:      difficulty,
	}
}

func (model *difficultyLogisticModel) score(vector []float64) float64 {
	logit := model.bias
	for index := 0; index < DifficultyFeatureVectorDimensionV1; index++ {
		logit += vector[index] * model.weights[index]
	}
	return stableSigmoid(logit)
}

func finiteDifficultyFloat(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
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
