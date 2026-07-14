package routing

import (
	"errors"
	"fmt"
	"math"
)

var (
	errDifficultyScorerDimension = errors.New("difficulty scorer vector dimension mismatch")
	errDifficultyScorerNonFinite = errors.New("difficulty scorer material must be finite")
)

type difficultyCalibratorKind string

const (
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

// difficultyLinearScorer owns the dimension-independent Logistic Regression
// math shared by the fixed v1 adapter and offline candidate adapters. Artifact
// and feature-shape validation remain adapter responsibilities.
type difficultyLinearScorer struct {
	bias    float64
	weights []float64
}

func newDifficultyLinearScorer(bias float64, weights []float64) (difficultyLinearScorer, error) {
	if !finiteDifficultyFloat(bias) {
		return difficultyLinearScorer{}, fmt.Errorf("%w: bias", errDifficultyScorerNonFinite)
	}
	if len(weights) == 0 {
		return difficultyLinearScorer{}, errors.New("difficulty scorer weights must not be empty")
	}
	ownedWeights := append([]float64(nil), weights...)
	for index, weight := range ownedWeights {
		if !finiteDifficultyFloat(weight) {
			return difficultyLinearScorer{}, fmt.Errorf("%w: weight %d", errDifficultyScorerNonFinite, index)
		}
	}
	return difficultyLinearScorer{bias: bias, weights: ownedWeights}, nil
}

func (scorer difficultyLinearScorer) score(vector []float64) (float64, error) {
	if len(vector) != len(scorer.weights) {
		return 0, fmt.Errorf(
			"%w: vector=%d weights=%d",
			errDifficultyScorerDimension,
			len(vector),
			len(scorer.weights),
		)
	}
	logit := scorer.bias
	for index, value := range vector {
		if !finiteDifficultyFloat(value) {
			return 0, fmt.Errorf("%w: vector value %d", errDifficultyScorerNonFinite, index)
		}
		logit += value * scorer.weights[index]
		if !finiteDifficultyFloat(logit) {
			return 0, fmt.Errorf("%w: dot product", errDifficultyScorerNonFinite)
		}
	}
	return stableSigmoid(logit), nil
}

func newDifficultyLogisticModel(material DifficultyClassifierMaterial) (difficultyLogisticModel, error) {
	if material.ArtifactVersion == "" || material.ContentHash == "" {
		return difficultyLogisticModel{}, errors.New("difficulty model provenance is required")
	}
	if len(material.Weights) != DifficultyFeatureVectorDimensionV1 {
		return difficultyLogisticModel{}, fmt.Errorf("difficulty model must contain exactly %d weights", DifficultyFeatureVectorDimensionV1)
	}
	if material.Threshold != difficultyThresholdV1 {
		return difficultyLogisticModel{}, errors.New("difficulty threshold policy must remain global 0.45")
	}
	scorer, err := newDifficultyLinearScorer(material.Bias, material.Weights)
	if err != nil {
		if !finiteDifficultyFloat(material.Bias) {
			return difficultyLogisticModel{}, errors.New("difficulty model bias must be finite")
		}
		return difficultyLogisticModel{}, fmt.Errorf("difficulty model: %w", err)
	}

	model := difficultyLogisticModel{
		artifactVersion: material.ArtifactVersion,
		contentHash:     material.ContentHash,
		bias:            scorer.bias,
		threshold:       material.Threshold,
	}
	for index, weight := range scorer.weights {
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
	case difficultyCalibratorPlatt:
		if material.PlattCoefficient == nil || material.PlattIntercept == nil ||
			!finiteDifficultyFloat(*material.PlattCoefficient) || !finiteDifficultyFloat(*material.PlattIntercept) ||
			len(material.IsotonicX) != 0 || len(material.IsotonicY) != 0 {
			return difficultyCalibrator{}, errors.New("platt difficulty calibrator parameters are invalid")
		}
		calibrator.plattCoefficient = *material.PlattCoefficient
		calibrator.plattIntercept = *material.PlattIntercept
	case difficultyCalibratorIsotonic:
		if material.PlattCoefficient != nil || material.PlattIntercept != nil || len(material.IsotonicX) < 1 || len(material.IsotonicX) != len(material.IsotonicY) {
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
func (model *difficultyLogisticModel) infer(vector []float64) (difficultyLogisticInference, error) {
	rawProbability, err := model.score(vector)
	if err != nil {
		return difficultyLogisticInference{}, err
	}
	calibratedScore := model.calibrator.calibrate(rawProbability)
	difficulty := difficultyFromScore(calibratedScore, model.threshold)
	return difficultyLogisticInference{
		rawProbability:  rawProbability,
		calibratedScore: calibratedScore,
		difficulty:      difficulty,
	}, nil
}

func (model *difficultyLogisticModel) score(vector []float64) (float64, error) {
	scorer := difficultyLinearScorer{bias: model.bias, weights: model.weights[:]}
	return scorer.score(vector)
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
		return lookupIsotonic(rawProbability, calibrator.isotonicX, calibrator.isotonicY)
	default:
		panic("difficulty calibrator kind must be validated before inference")
	}
}

func lookupIsotonic(value float64, x []float64, y []float64) float64 {
	if value < x[0] {
		return y[0]
	}
	left := 0
	right := len(x)
	for left < right {
		middle := left + (right-left)/2
		if value < x[middle] {
			right = middle
		} else {
			left = middle + 1
		}
	}
	return y[left-1]
}
